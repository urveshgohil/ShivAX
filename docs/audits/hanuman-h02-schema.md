# SHIVAX 0.4.0 HANUMAN · H02-A specialist schema and registration design

**17 November 2026 (Asia/Calcutta)** · Branch `feat/hanuman-v0.4.0` · Design checkout `0a813e4`

**Design only. No production source changed.** This document specifies the opt-in `hanuman` specialist: its identity, versioned input and evidence schemas, capability availability rules and explicit registration API. It also covers the threat review, the builder checklist for Sol High (H02-B) and the test contract for Sol Medium.

> **Prerequisite not met. H02-B is blocked.** The brief requires H01 to be complete. The H01-D review ([`hanuman-h01-security-review.md`](hanuman-h01-security-review.md)) is **NO-GO**, and no commit since `bb81d38` addresses its findings: H01D-01 (fetch denials are retryable in workflows) and H01D-02 (no reviewed host transport) remain open. This design depends only on the H01-B tool contract, which is implemented and tested. Implementation must wait for an H01 GO re-review or an explicit owner waiver recorded in the audit trail. Notably, this design resolves H01D-03 (the missing `HanumanBot`).

The contract text supplied for this phase says "0.3.2 public exports". The checkout's manifest and runtime are **0.3.3**, and H01-B added exports to `shivax/integrations`. This design preserves every export present at `0a813e4`, which is a superset of 0.3.2.

## 1. Existing API review

| Element | Current contract (source) | Consequence for Hanuman |
| --- | --- | --- |
| `SpecialistBot` | [`src/bots/base.ts`](../../src/bots/base.ts). The constructor is `protected (id, operations)`. Each `Operation` has `description`, `input`, `output`, optional `tools` and an optional synchronous `validate`, plus `run(data, context)`. `execute()` rejects unknown capabilities (`unsupported-capability`), snapshots the input (`snapshotInput`: bounded, no accessors or functions), checks `matches(input)` and `validate`, checks the abort signal before and after `run`, snapshots the output to `limits.maxOutputBytes` and checks `matches(output)`. It maps unknown throws to `bot-error`, and recognized `BotError` codes are preserved. | Subclass it. No change to the base class is needed. |
| Schemas | [`src/bots/schema.ts`](../../src/bots/schema.ts). `SpecialistSchema` is a JSON-Schema subset: type, properties, required, `additionalProperties`, items, min/max items, lengths, numeric range, `enum` and `oneOf`. There is no `pattern`. The `object()` helper sets `additionalProperties: false`. | Strict object schemas everywhere. Identifier syntax and cross-field rules go in `validate` (input) and in `run` (tool-result checks), because output schemas have no predicate. |
| `toolCall()` | `toolCall(context, id, data)`. If there is no `context.tools`, it throws `tool-not-allowed`. Any tool failure is caught and rethrown as `BotError('tool-not-allowed')`. | Hanuman must use `toolCall` unchanged. `tool-not-allowed` is not `bot-error`, so RUDRA never retries it (RUDRA retries only `bot-error`). This keeps the bot path free of the H01D-01 retry issue. |
| Tool scoping | `Operation.tools` becomes `capabilities[].requiredTools`. `toolsForCapability()` merges bot-level and capability-level tools. `Vijay.runBot` leases only those IDs, and only if `root.security.toolPermissions` includes them all. | Declare `shivax.hanuman.fetch` on `fetch.url` only. |
| `BotRegistry` | [`src/agents/registry.ts`](../../src/agents/registry.ts). `register()` snapshots the bot (`snapshotBot`) and throws `duplicate-bot` on an existing ID. `findByCapability()` and `listCapabilities()` provide discovery. There are no global instances and no automatic discovery. | Duplicate protection is already present. Discovery advertises capability metadata only, which confers no authority. |
| Execution context | `BotContext = { task: TaskContext, tools?: BotToolClient }`. The `TaskContext` carries `taskId`, `sessionId`, `security.scope` and `toolPermissions`, a `signal` and `limits`. The tool client exists only under Vijay. | Scope and identity come from `context.task`, never from input. |
| Default factory | [`src/bots/system.ts`](../../src/bots/system.ts). `createSpecialistBots()` returns seven frozen bots. `registerSpecialistBots()` checks collisions first. `createSpecialistSystem()` exposes `registry` and `tools`. | Unchanged. The host adds Hanuman afterwards using the exposed `registry` and `tools`. |
| H01 tool | [`src/integrations/hanuman/`](../../src/integrations/hanuman/). `registerHanumanFetchService(tools, options)` registers `shivax.hanuman.fetch`. Input is exactly `{ targetId }`. Output is `{ version: 1, targetId, status: 200, mediaType, bytes, body, trust: 'untrusted' }`. There are no caller URLs, methods or headers. The tool requires a bound firewall boundary. | The bot wraps this tool and adds nothing on the network side. |
| Public exports | `shivax/bots` re-exports [`src/bots/index.ts`](../../src/bots/index.ts), which the root entry also exports. `shivax/integrations` exports the H01 service, the error, the types and the `HANUMAN_*` constants (`HANUMAN_BOT_ID`, `HANUMAN_FETCH_CAPABILITY = 'hanuman.fetch'`, `HANUMAN_FETCH_TOOL_ID`). | Additive exports only. Keep every H01 constant, including `HANUMAN_FETCH_CAPABILITY`, which is used for workflow binding. |

**Smallest compatible extension:** one new file `src/bots/hanuman.ts` containing `HanumanBot extends SpecialistBot` and `registerHanumanBot()`, plus one export line in `src/bots/index.ts`. There are no changes to the base class, schema, registry, Vijay, firewall, factory or integrations code.

## 2. Proposed Hanuman architecture

| Item | Decision |
| --- | --- |
| Bot ID | `hanuman` (equals the existing `HANUMAN_BOT_ID`) |
| Role | Approved external evidence retrieval through a trusted host: it reads host-registered sources and packages them as untrusted evidence. |
| `fetch.url` | **Advertised.** Retrieves one host-registered target via `shivax.hanuman.fetch`. |
| `fetch.api` | **Not advertised.** H01 defines no distinct API contract. It has no method, query, header or credential support, and JSON targets are already covered by `fetch.url` with `mediaType: 'application/json'`. A second capability on the same tool would add no enforcement and would widen grants. The ID is reserved. |
| `research.search` | **Not advertised.** There is no search-provider contract or protected tool. The ID is reserved for a future phase, which must define a distinct tool, policy and threat model. |

```text
host composition (trusted)
  createSpecialistSystem({ security, tools })        // seven default bots, unchanged
  registerHanumanFetchService(system.tools, {...})   // H01 protected tool
  registerHanumanBot(system.registry, { tools: system.tools })   // H02 opt-in bot
  Vijay policies: capability 'fetch.url', tool 'shivax.hanuman.fetch' (read-only, approval)
  NARASIMHA ops: workflow(fetch.url) · bot(hanuman) · tool(shivax.hanuman.fetch, botId hanuman)
  Jay context: toolPermissions ['shivax.hanuman.fetch']

RUDRA.run({ capability: 'fetch.url', data: HanumanFetchUrlInput })
  → Vijay.runBot (bot lease) → HanumanBot.run
      validate input (schema + predicate)  — no network
      toolCall(context, 'shivax.hanuman.fetch', { targetId })   ← only side-effect path
          → ToolLease → Vijay tool policy + approval → firewall tool lease
          → H01 service → host transport
      verify tool envelope (version, targetId, trust, status, media, bytes)
      build HanumanEvidence (excerpt, digest id, timestamp, trust:'untrusted')
```

Hanuman contains no `fetch`, `node:http`, `node:https`, `node:net`, `node:dns`, `child_process`, filesystem, Playwright or Inspectra usage. Its only effect is `toolCall`. Whether that call runs is decided by Vijay, approval and NARASIMHA.

**Capability ID versus the H01 constant.** The bot capability is `fetch.url`, as the brief requires. H01's `HANUMAN_FETCH_CAPABILITY = 'hanuman.fetch'` remains the capability for host workflow bindings (`ToolRegistry.bind`). The bot path uses Vijay capability policy `fetch.url` and firewall descriptors with `capability: 'fetch.url'`. Both are documented, and neither changes the other.

## 3. Input and output schemas

### Input: `fetch.url` v1

```ts
export interface HanumanFetchUrlInput {
    readonly version: 1;
    readonly operation: 'fetch.url';          // must equal BotInput.capability
    readonly request: {
        readonly targetId: string;            // host catalog reference, never a URL
    };
    readonly options?: {
        readonly maxExcerptChars?: number;    // integer 1..8192; ≤ bot-level cap
    };
}
```

Validation: the `SpecialistSchema` is checked first, then the `validate` predicate. Both run before any tool call.

| Rule | Mechanism | Outcome |
| --- | --- | --- |
| Exactly the keys above at every level (no `url`, `headers`, `method`, `body`, `timeoutMs`, `principal`, `permissions`, `approval`, `approved`, `trust`, `__proto__`) | `object()` with `additionalProperties: false` at the root, in `request` and in `options` | `invalid-input` |
| `version === 1` and `operation === 'fetch.url'` | `enum` | `invalid-input` |
| `operation` equals `BotInput.capability` | `validate` cannot see the capability. `run` asserts it, and only `fetch.url` exists, so the enum already forces equality. | `invalid-input` |
| `targetId` is an H01 identifier: a string of 1–256 characters, not blank after trim, and no URL syntax (`:`, `/`, `\`, `?`, `#`, `@`, whitespace or control characters) | schema `minLength`/`maxLength` plus `validate` | `invalid-input` |
| `maxExcerptChars` is a safe integer in 1..8192 | schema `minimum`/`maximum` plus `validate` (`Number.isSafeInteger`) | `invalid-input` |
| Functions, accessors, cycles, sparse arrays, non-plain prototypes, more than `maxInputBytes` | existing `snapshotInput` in `SpecialistBot.execute` | `invalid-input` |
| Unknown capability (`fetch.api`, `research.search`, anything else) | `SpecialistBot.execute` | `unsupported-capability` |

There is no URL, method, header, timeout or credential field. Rejecting them is structural: unknown properties are always refused. Time limits come only from host `ExecutionLimits`, the firewall `timeoutMs` and the H01 service limits. Caller-supplied identity, permission or approval fields cannot even be expressed. Identity comes only from the Jay-minted `TaskContext`.

### Output: `HanumanEvidence` v1

```ts
export interface HanumanEvidence {
    readonly version: 1;
    readonly evidenceId: string;              // 'hanuman:' + 64 lowercase hex (SHA-256, see below)
    readonly source: {
        readonly kind: 'registered-target';
        readonly targetId: string;            // opaque catalog reference (no URL, by H01 design)
    };
    readonly retrievedAt: string;             // ISO-8601 UTC; bot receipt time from options.now
    readonly status: 'retrieved';
    readonly mediaType: 'text/plain' | 'application/json';
    readonly bytes: number;                   // full body size in UTF-8 bytes, from the tool envelope
    readonly excerpt: string;                 // ≤ maxExcerptChars UTF-16 units, no lone surrogate
    readonly truncated: boolean;              // excerpt shorter than the full body
    readonly trust: 'untrusted';
    readonly provenance: {
        readonly botId: 'hanuman';
        readonly capability: 'fetch.url';
        readonly toolId: 'shivax.hanuman.fetch';
    };
}
```

| Field | Source and rule |
| --- | --- |
| `evidenceId` | `sha256(canonical JSON { v: 1, scopeKind, scopeId, targetId, mediaType, body })` via `globalThis.crypto.subtle`. If that is unavailable, the bot fails with `unavailable`; there is no weak fallback. Including the scope prevents cross-tenant correlation of identical content. The ID is deterministic, so identical evidence de-duplicates within a tenant. |
| Source URL or origin | **Omitted on purpose.** H01 keeps URLs out of results, traces and audit (I-9, I-13). `targetId` is the reference into the host catalog, which the host can resolve for display. A future option to project a host-approved display label requires a new review (see unresolved risks). |
| `retrievedAt` | `new Date(now()).toISOString()`. `now` must return a finite number in the valid `Date` range. It is checked once before retrieval and again at receipt; a throwing or invalid clock fails with non-retryable `unavailable` (amended for H02D-01; `bot-error` would replay the fetch). It records the bot's receipt time, not the transport's server time. |
| `excerpt` / `truncated` | The bot excerpts the already validated, inert body. H01 still fails closed on oversize transport bodies; truncation here only bounds what downstream steps see. Truncation backs off one unit if it would split a surrogate pair. A truncated JSON excerpt is text, not parseable data. |
| Error classification | Failures are `BotResult` failures with existing `BotErrorCode`s, so no evidence object is emitted on failure. `toolCall` deliberately collapses tool failures to `tool-not-allowed`. Fine-grained H01 codes reach only the host observer (`HanumanFetchEvent`). An `error` field on evidence would always be null, so it is omitted rather than faked. |
| Excluded | API keys, `Authorization`, cookies, session IDs, principal IDs, response headers, peer addresses, raw URLs, raw exceptions, HTML and full unbounded bodies. H01 admits only `text/plain` and `application/json`. |

Output schema: strict `object()` with `additionalProperties: false` at every level. `enum` covers `version`, `status`, `mediaType`, `trust`, `source.kind` and the `provenance` constants. `excerpt` uses `maxLength` 8192 and `bytes` uses a `minimum` of 0. The runtime builds the value only from checked fields. Because there is no output predicate, `run` performs all cross-field checks before returning.

**Tool-envelope verification in `run`** (output-spoofing defense). The tool result must be a plain object whose keys are exactly `version`, `targetId`, `status`, `mediaType`, `bytes`, `body` and `trust`, with these values:

- `version === 1`
- `targetId === input.request.targetId`
- `status === 200`
- `trust === 'untrusted'`
- `mediaType` is one of the two allowed types
- `body` is a string
- `bytes === utf8Length(body)`

Any mismatch produces `invalid-output`. This duplicates the tool's `validateOutput` on purpose, so the bot is safe even if a host registers a different `shivax.hanuman.fetch` implementation.

## 4. Capability registration design

```ts
// src/bots/hanuman.ts
import type { ProtectedToolRegistry } from '../security/registry.js';
import type { BotRegistry } from '../agents/registry.js';

export const HANUMAN_FETCH_URL_CAPABILITY = 'fetch.url';
/** Reserved: never advertised until a reviewed contract exists. */
export const HANUMAN_RESERVED_CAPABILITIES = Object.freeze(['fetch.api', 'research.search'] as const);

export interface HanumanBotOptions {
    /** Upper bound for excerpts; integer 1..8192; default 4096. */
    readonly maxExcerptChars?: number;
    /** Injectable clock for retrievedAt; default Date.now. */
    readonly now?: () => number;
}
export interface RegisterHanumanBotOptions extends HanumanBotOptions {
    /** Availability check only: must already contain the H01 tool. Grants nothing. */
    readonly tools: ProtectedToolRegistry;
}

export class HanumanBot extends SpecialistBot {
    constructor(options?: HanumanBotOptions);      // id 'hanuman', one capability 'fetch.url'
}
/** Opt-in. Throws duplicate-bot if 'hanuman' exists; 'unavailable' if the H01 tool is absent. */
export function registerHanumanBot(
    registry: BotRegistry,
    options: RegisterHanumanBotOptions
): HanumanBot;
```

Rules:

1. **Opt-in only.** `createSpecialistBots()`, `registerSpecialistBots()` and `createSpecialistSystem()` are unchanged and still yield exactly seven bots with 29 capabilities. Importing a module never registers anything.
2. **No implicit grants.** Registration touches only the supplied `BotRegistry`. It never creates policies, tool permissions, firewall operations, approvals or transports.
3. **Availability.** `registerHanumanBot` validates its options, then checks `options.tools.get(HANUMAN_FETCH_TOOL_ID)`. If the tool is missing, it throws `BotError('unavailable')` and registers nothing. This check is advertisement hygiene only. If the tool is later removed or denied, execution still fails at Vijay or `ToolLease`.
4. **No duplicates.** If `registry.get('hanuman')` exists, it throws `duplicate-bot` before construction. `BotRegistry.register` also enforces this.
5. **Stable identity.** The ID is `hanuman` and the capability `fetch.url`. The descriptor declares `requiredTools: [{ id: 'shivax.hanuman.fetch', … }]` for `fetch.url` only. Reserved capabilities never appear in `capabilities`.
6. **Hosts may also call `registry.register(new HanumanBot())` directly.** That skips the availability check but is otherwise identical. Document `registerHanumanBot` as the recommended path.

Host recipe (bot path, reference only):

```js
const system = createSpecialistSystem({ security: { jay, policies }, tools });
registerHanumanFetchService(system.tools, { transport, targets });
registerHanumanBot(system.registry, { tools: system.tools });
policies.register({ kind: 'capability', id: 'fetch.url', effect: 'read-only', permissions: ['evidence.fetch'], validateInput: isFetchUrlInput });
policies.register({ kind: 'tool', id: 'shivax.hanuman.fetch', effect: 'read-only', requiresApproval: true, permissions: ['network.fetch'], validateInput: isTargetIdOnly });
// NARASIMHA (protectExecution: true): workflow op {capability:'fetch.url'}, bot op {botId:'hanuman'},
// tool op {toolId:'shivax.hanuman.fetch', botId:'hanuman', networkOrigins:[…]}; maxConcurrent ≥ 3
// Jay context: toolPermissions ['shivax.hanuman.fetch']; RUDRA allowedCapabilities ['fetch.url'], maxRetries 0
```

## 5. Security invariants

| ID | Invariant |
| --- | --- |
| H2-1 | The default roster is unchanged: seven bots in the same order (`sanjay`, `brihaspati`, `vishwakarma`, `chitragupt`, `narad`, `yudhishthir`, `ekalavy`) with 29 capabilities. `VishwakarmBot` remains an alias of `VishwakarmaBot`. |
| H2-2 | Hanuman is registered only by explicit host calls. Registration grants no permission, policy, tool, approval or firewall allow. |
| H2-3 | Only `fetch.url` is advertised. `fetch.api` and `research.search` are never in `capabilities` and execute as `unsupported-capability`. |
| H2-4 | The only side-effect path is `toolCall(context, 'shivax.hanuman.fetch', { targetId })`. There are no network, process, filesystem or browser APIs in `src/bots/hanuman.ts`. |
| H2-5 | Input cannot carry URLs, methods, headers, timeouts, identity, permissions, approval or trust. Unknown properties fail before any tool call. |
| H2-6 | Scope and identity come only from `context.task`. The bot never reads caller-supplied authority. |
| H2-7 | Every tool failure surfaces as `tool-not-allowed`. The bot never converts a failure into `bot-error` and never retries. |
| H2-8 | The tool envelope is re-verified, and the evidence is built only from verified fields. Output always has `trust: 'untrusted'` and strict, closed schemas. |
| H2-9 | Evidence excludes credentials, headers, cookies, peer addresses, URLs and raw errors. The excerpt is bounded, and truncation is explicit. |
| H2-10 | Fetched text never becomes a plan, capability selection, approval, grant, policy change, verified feedback, memory write or executable code inside Hanuman. Downstream use requires the existing governed paths. |
| H2-11 | Cancellation or timeout before or after the tool call yields `cancelled` or `timed-out` with no evidence. The tool lease keeps ownership until the transport settles (existing H01 behavior). |
| H2-12 | All 0.3.3 and H01 exports keep their names, values and identities in ESM and CJS. New exports are additive. |

## 6. Threat review

| Threat | Analysis and control |
| --- | --- |
| Missing security context | Without Vijay, `context.tools` is undefined, `toolCall` throws `tool-not-allowed`, and RUDRA without security rejects tool-declaring bots. A forged or copied context fails at Jay. A missing grant fails at `Vijay.runBot` (`requiredTools ⊄ toolPermissions`). |
| Missing registered provider | `registerHanumanBot` refuses with `unavailable`. At runtime, a missing tool or service, or no bound firewall (H01 `network-unprotected`), becomes `tool-not-allowed`, with zero transport calls. |
| Prompt injection in content | Content enters only `excerpt`, marked untrusted. Hanuman never interprets it. RUDRA plans come from the host planner, but a host planner that feeds evidence into later steps can pass text onward. H2-10 and the recipe's `allowedCapabilities: ['fetch.url']` and `maxSteps: 1` limit this. Residual risk is listed below. |
| Permission escalation | Input has no authority fields. The read-only capability cannot lease a state-changing tool (Vijay `effect-denied`). The bot declares exactly one tool. Discovery metadata grants nothing. |
| Output schema spoofing | A malicious or replaced tool could return `trust:'trusted'`, a different `targetId`, extra keys or a wrong `bytes`. The `run` re-verification turns these into `invalid-output`, and the closed output schema applies. A downstream consumer can still forge an evidence-shaped object. Evidence is data, not a credential (residual). |
| Tenant leakage | The tool enforces catalog issuer and scope (H01 T14). The evidence ID hashes the scope. There is no cache or shared state in the bot instance. The `now` and `maxExcerptChars` options are not tenant data. |
| Malformed provider responses | These are handled by the H01 service (status, media, encoding, size and peer checks) and then by the bot's envelope verification. Any failure becomes `invalid-output` or `tool-not-allowed`, with no partial evidence. |
| Cancellation and timeout | `SpecialistBot` checks the signal before and after `run`. Tool-side deadlines and draining are H01 behavior. A late tool result after abort yields `cancelled`. |
| Stale permissions | H01-B's re-assertion of Vijay and `ToolLease` at checkpoints applies to the bot path. Revocation during approval or transport yields `tool-not-allowed` with no evidence (covered for an ad hoc bot in `tests/hanuman-fetch.test.mjs`; must be repeated with `HanumanBot`). |
| Untrusted data becoming instructions | No code path in Hanuman evaluates, parses (except length), plans from or stores content. Ekalavy and SARASWATI admission require host attestation, so evidence cannot self-verify. |

## 7. Implementation checklist for Sol High (H02-B, after H01 GO)

1. Create `src/bots/hanuman.ts`. Import `SpecialistBot`, `toolCall` and `Operation` from `./base.js`, `object`, `id` and `list` from `./schema.js`, and `HANUMAN_BOT_ID` and `HANUMAN_FETCH_TOOL_ID` from `../integrations/hanuman/types.js` (constants only). Do not import `service.ts`.
2. Define the input and output schemas exactly as in §3, with `additionalProperties: false` at every level.
3. The `validate(data)` predicate checks the `targetId` character rules and `Number.isSafeInteger(maxExcerptChars)`. It must stay synchronous and side-effect-free.
4. `run(data, context)` does the following:
   1. Read `targetId` and the effective `maxExcerptChars = min(input ?? botDefault, botDefault)`.
   2. Call `const raw = await toolCall(context, HANUMAN_FETCH_TOOL_ID, { targetId })`.
   3. Verify the envelope (§3).
   4. Excerpt the body.
   5. Compute the digest. Throw `unavailable` if `crypto.subtle` is missing.
   6. Build and return the evidence.

   Throw only `BotError` (`invalid-output` or `unavailable`, including an invalid clock; never `bot-error`, per H02D-01). Do not wrap `toolCall`'s `tool-not-allowed`.
5. Validate `HanumanBotOptions` in the constructor with `record()` from `agents/validation.ts`: `maxExcerptChars` must be 1..8192 and `now` must be a function. Otherwise throw `BotError('invalid-input')`.
6. Implement `registerHanumanBot(registry, options)` as in §4, in this order: validate options, check for a duplicate, check tool availability, construct, then `registry.register`. Return the instance.
7. Add exports to `src/bots/index.ts`: `HanumanBot`, `registerHanumanBot`, `HANUMAN_FETCH_URL_CAPABILITY`, `HANUMAN_RESERVED_CAPABILITIES`, and the types `HanumanFetchUrlInput`, `HanumanEvidence`, `HanumanBotOptions` and `RegisterHanumanBotOptions`. Do not edit `system.ts`.
8. Keep public declarations ES2020-only (no `crypto` or `TextEncoder` types in `.d.ts`). Access Web Crypto through a local internal interface.
9. Docs: add a `docs/sdk.md` section on bot registration and the recipe (§4), and update `SECURITY.md` to state that the bot adds no authority. Record the capability naming (`fetch.url` versus `hanuman.fetch`).
10. Run the focused tests plus `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm verify:package`. Report results and stop.

**Expected errors (existing codes only).**

| Condition | Result |
| --- | --- |
| Unknown or reserved capability | `unsupported-capability` |
| Schema or predicate failure, invalid options | `invalid-input` |
| Missing tool client, denied, revoked or failed tool | `tool-not-allowed` |
| Spoofed or malformed envelope, output schema mismatch | `invalid-output` |
| Missing Web Crypto, or tool unavailable at registration | `unavailable` |
| Duplicate registration | `duplicate-bot` |
| Abort or deadline | `cancelled` or `timed-out` (status) |
| Invalid clock value | `unavailable` (before retrieval: zero tool calls; after: no retry). Amended by H02D-01. |

## 8. Test requirements for Sol Medium

Add `tests/hanuman-bot.test.mjs` running in ESM and CJS against the built SDK, with mock transports through the real H01 service and a `globalThis.fetch` tripwire. Extend the package verifier to run it in the packed consumer and assert a nonzero test count.

| # | Test | Assertion |
| --- | --- | --- |
| B1 | Default roster | `createSpecialistBots()` and `createSpecialistSystem()` give seven IDs in order, 29 capabilities, no `hanuman`, and zero transport calls. |
| B2 | Explicit registration | `registerHanumanBot` adds exactly `hanuman` with the single capability `fetch.url`. Its `requiredTools` is `[shivax.hanuman.fetch]`. Reserved IDs are absent from `listCapabilities()`. |
| B3 | Duplicate / unavailable | A second registration gives `duplicate-bot`. A missing H01 tool gives `unavailable`, and the registry is unchanged. Invalid options give `invalid-input`. |
| B4 | Authorized RUDRA run | Full recipe: one approval, one `resolve`, one `request`, evidence fields exact. `trust` is `untrusted`, `evidenceId` matches `/^hanuman:[0-9a-f]{64}$/`, and `retrievedAt` comes from the injected clock. |
| B5 | Input rejection | `url`, `headers`, `method`, `timeoutMs`, `principal`, `permissions`, `approved`, `trust`, extra `request` or `options` keys, wrong `version` or `operation`, URL-like `targetId`, `maxExcerptChars` 0, 8193 or 1.5, functions, accessors and oversized input → `invalid-input` and zero tool calls. |
| B6 | Reserved and unknown capabilities | `fetch.api`, `research.search` and `fetch.other` → `unsupported-capability`, zero tool calls. |
| B7 | Missing security | RUDRA without Vijay, Vijay without a firewall, a forged context, a missing grant, a missing capability or tool policy, a missing permission, denied approval or lockdown → failure, zero `resolve` calls. |
| B8 | Envelope spoofing | A substitute `shivax.hanuman.fetch` tool returning `trust:'trusted'`, a different `targetId`, extra `headers`, wrong `bytes`, `status: 302`, `text/html` or a non-string body → `invalid-output`, no evidence. |
| B9 | Excerpt bounds | A body longer than the cap gives `truncated: true` and exact length. An exact-cap body gives `truncated: false`. A surrogate pair at the boundary is not split. The per-input cap cannot exceed the bot cap. |
| B10 | Tenant isolation | Evidence IDs for identical content differ across scopes and match within a scope. A foreign-tenant target is denied at the tool, so the bot reports `tool-not-allowed`. |
| B11 | No retries | RUDRA `maxRetries: 3` with a failing transport, a redirect or a peer mismatch → exactly one `request`, result `bot-failed`, error `tool-not-allowed`. |
| B12 | Cancellation and revocation | Abort or policy revocation during approval, `resolve`, `request` and stream → no evidence and a non-completed result. The positive control completes, so this test is not vacuous. |
| B13 | Injection inertness | A body containing instructions, fake grants or a fake plan → evidence returned verbatim in `excerpt`. No other bot or tool runs, and the planner, approval and audit records contain no body text. |
| B14 | Secrets | Transport exception text, headers and credentials never appear in evidence, traces or events. |
| B15 | Static guard | The `src/bots/hanuman.ts` source contains none of `fetch(`, `node:http`, `node:https`, `node:net`, `node:dns`, `child_process`, `node:fs` or `playwright`. |
| B16 | Exports and declarations | Root and `shivax/bots` exports have identical identities in each format. H01 exports are unchanged. All five declaration modes pass, including `@ts-expect-error` for a `url` field in `HanumanFetchUrlInput`. |
| B17 | Mutation checklist | Removing the `targetId` mismatch check, the `trust` check, the `bytes` check or the truncation boundary logic must each fail at least one test. |

## 9. Unresolved risks

1. **The H01 gate is open.** H01D-01 (workflow retries of denials) does not affect the bot path (H2-7), but it affects hosts that also bind the tool into workflows. H01D-02 (no reviewed transport) means Hanuman evidence is only as trustworthy as the host transport. H02-B must not start before H01 GO or a recorded waiver.
2. **No source URL in evidence.** Consumers need the host catalog to resolve `targetId`. Projecting a display label or origin would reintroduce URLs into traces. That decision needs its own review.
3. **Generic capability name.** `fetch.url` could collide with a host bot advertising the same capability. RUDRA selects by bot ID order, so a host bot `fetcher` would win over `hanuman`. Hosts should keep `allowedCapabilities` and registry contents deliberate. A routing switch or explicit bot pinning is out of scope.
4. **Downstream injection.** Multi-step host plans can route `excerpt` into models or other bots. Hanuman cannot enforce downstream provenance handling.
5. **Evidence forgery downstream.** Evidence objects are unsigned data. Anyone can construct one. Signing or attestation (similar to SARASWATI attestation) is a future option.
6. **Web Crypto dependency.** Runtimes without `crypto.subtle` cannot produce evidence (fail closed). This covers older embedded runtimes only. Node 18+ and modern browsers have it.
7. **Approval remains host configuration** (H01D-10). The recipe sets `requiresApproval: true`, but the SDK cannot enforce it.
8. **Truncated JSON** is not valid JSON. Consumers must not parse excerpts that have `truncated: true`.

## H02-A validation results

Windows x64, Node `22.23.2`, pnpm `12.8.1`, offline. The only change is this new document.

| Command | Result |
| --- | --- |
| Focused: `specialists`, `hanuman-fetch`, `agents` | PASS: 228/228 |
| `pnpm lint` | PASS (exit 0) |
| `pnpm test` | PASS: 1067/1067, 0 failed |
| `pnpm build` | PASS (exit 0) |
| `pnpm verify:package` | PASS: 13 entries, five declaration modes, 528 files |

**H02-A: PASS (design complete). H02-B is BLOCKED pending H01 GO. Stopped.**
