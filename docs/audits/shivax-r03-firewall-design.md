# ShivAX R03 - Firewall architecture audit and design

Date: 2026-11-03 (Asia/Calcutta)  
Repository baseline: `464c5b6`  
Package: `shivax@0.1.3`  
Status: **R03 complete: audit and proposed contract only. Firewall implementation is not authorized by this phase.**

## 1. Scope and evidence

Read `shivax-r00.md`, `shivax-r01.md`, `shivax-r02.md`, and `build-stabilization-final.md` in this directory, then inspected the current security, RUDRA, intelligence, workflow, memory, inspection, licensing, SDK security, and Inspectra implementations. Historical audit findings are not treated as current failures when later code and tests fix them. In particular, R02 supersedes the outstanding ModelRouter token failures in R00/R01.

This audit changes this document only. No production functionality, ML training, RUDRA, licensing, Inspectra, dependencies, package version, or exports were changed. No paid model APIs were called and nothing was published.

### Executed validation

Windows Node 22.23.2, pnpm 12.8.1. Commands were executed from the repository root and repeated when finishing the report.

| Exact command | Actual result |
| --- | --- |
| `pnpm lint` | Exit 0; TypeScript no-emit and ESLint passed |
| `pnpm test` | Exit 0; 550 tests, 550 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo |
| `node --test tests/intelligence.test.mjs tests/model-cost.test.mjs tests/model-safety.test.mjs tests/router-audit.test.mjs` | Exit 0; 108 tests, 108 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo |

`pnpm test` runs `pnpm build` first: clean, TypeScript compilation, CommonJS declaration generation, and both Rollup outputs succeeded. No Rollup warning appeared in that build. The 108 focused tests overlap the 550-test full suite; these are not 658 distinct tests. Existing packaged ESM/CJS and declaration verification is recorded in R02; `pnpm verify:package` was not rerun in R03. No additional Node-version matrix is claimed here.

### Completed fixes verified against current code

| Requirement | Current evidence and result |
| --- | --- |
| Three $0.10 calls within $0.30 | ESM and CJS R00 regressions both complete three calls |
| Fourth call rejected before dispatch | Both formats report `cost-limit`; provider calls and reserved calls remain 3; reserved cost is 0.3 |
| Malformed output cannot hide token overrun | Both formats report `usage-limit`, classified as `token-limit-exceeded`; provider A called once, provider B never called |
| Hard budget failures stop fallback | Existing focused tests pass, including budget errors, terminal usage failures, timeout classification, and follow-up admission |
| Existing tests remain valid | All 550 pass without changing or skipping assertions |

Actual preserved R00 diagnostic for cost:

```json
{"outcomes":["completed","completed","completed","cost-limit"],"providerCalls":3,"reservedCalls":3,"reservedCostUSD":0.3}
```

Actual preserved R00 diagnostic for tokens:

```json
{"first":{"status":"failed","error":"usage-limit","providerId":null,"attempts":[{"providerId":"provider-a","outcome":"failed","error":"usage-limit"}]},"followup":{"status":"failed","error":"usage-limit","providerId":null,"attempts":[]},"aCalls":1,"bCalls":0}
```

The exact BigInt USD ledger and conservative attempt reservations in `src/intelligence/cost.ts` and `router.ts` are working fixes. They must be reused or preserved, not reimplemented as part of firewall work. Router usage is checked independently of model output. Unknown usage and verified overruns are terminal; cancellation does not erase potential charges or release ownership of unsettled work.

## 2. Current security architecture

Source references below describe the inspected baseline, not proposed functionality.

| Boundary | Current enforcement | Limit of that enforcement |
| --- | --- | --- |
| `src/security/jay.ts`: `createContext`, `authenticate`, `verify`, `assertActive` | Authenticates through a host identity adapter; binds the original context to a private identity snapshot; verifies expiry, cancellation, and session validity | A refreshed validity boolean is not refreshed permission claims. No central revocation subscription or runtime policy epoch |
| `src/security/vijay.ts`: `validateTask`, authorization, `runBot` | Requires registered policies, identity permissions, resource/input predicates, narrowed tool grants, and approval for state-changing actions; rechecks after asynchronous work | No shared enforce/monitor/lockdown controller. Per-operation checks do not themselves broadcast revocation to all active work |
| `src/security/registry.ts`: `PermissionPolicyRegistry` | Validates and freezes policy descriptors; supports registration/removal; state-changing effects cannot disable approval | No revisioned administrative transaction, durable store, compare-and-swap, or change subscription |
| `src/security/registry.ts`: `ProtectedToolRegistry` | Validates/snapshots registered tools | Registration is not invocation authorization. A trusted owner can retrieve the handler and call it directly |
| `src/security/tools.ts`: tool lease | Limits available tools, calls, concurrent use, lifetime, checkpoints, cancellation and cleanup; routes normal bot execution through authorization | No deployment-wide cancellation source. Unknown handler exceptions become `tool-error`, which matters for model errors below |
| `src/security/audit.ts`: `SecurityAuditLog` | Bounded sanitized decision ring; fixed authentication/capability/tool events; default capacity 256, maximum 4096 | Not a durable or tamper-proof log; no policy revision, mode transition, or cancellation lifecycle protocol |
| `src/agents/rudra/orchestrator.ts` | Optional security admission; declared tools require security; secured execution uses Vijay; per-instance disposal/cancellation | Legacy pure bot execution remains available without that security binding. No universal runtime revocation across instances |
| `src/workflows/engine.ts` | Requires Vijay, validates workflow and tools, bounds steps/retries/usage, supports pause/resume and cancellation | Uses its own lifecycle and retry classification; no shared runtime mode or revision |
| `src/workflows/registry.ts`: `registerModel` | Host opt-in for remote providers, authenticated tool context, per-task model reservations, response checks | Invokes the registered provider directly, not ModelRouter; usage/error behavior differs from R02 (G02) |
| `src/intelligence/router.ts` | Scope matching, capability/routing checks, remote opt-in, exact costs, token limits, output validation, cancellation and explicit fallback | Scope strings are not Jay authentication. Direct callers need trusted-host authorization; there is no automatic Vijay admission |
| `src/intelligence/bridge.ts`: `createModelOperation` | Snapshots model routing/output configuration and preserves classified failures | Does not turn caller-supplied context identifiers into authenticated identity or add a runtime permission gate |
| `src/memory/services.ts`, `lifecycle.ts` | Protected tools derive namespaces from authenticated identity; Vijay and lifecycle checks govern managed operations | Raw MemoryEngine/adapters remain host primitives; caller-supplied namespace or approval flags are not independent authentication |
| `src/memory/engine.ts`, `adapters.ts` | Transactions and cooperative cancellation/checkpoints, including checks before persistence steps | A dispatched commit or external embedding request cannot necessarily be undone; no shared policy epoch |
| `src/inspection/services.ts` | Host URL authorization, explicit reference approval, execution/signal checks around scans | Authorizes the requested URLs before scanning; no built-in live policy reevaluation per later acquisition, redirect, subresource, or DNS resolution |
| `adapters/inspectra/index.mjs` | Optional lazy import; host page acquisition; abort handling, capture normalization and page cleanup | Host owns browser isolation, network controls, and cleanup of partially acquired resources; no global runtime policy binding |
| `src/licensing/index.ts`: `ServerLicenseGate.require` | Jay verification before/after host verification; entitlement product, subject, issuer, scope, feature and expiry checks | Explicit host-called gate, not automatic middleware on every feature; no entitlement revocation broadcast |
| `src/sdk/security.ts` | Reexports existing security API | No existing firewall mode/controller contract to extend by assumption |

Existing policies are meaningful enforcement within cooperating SDK paths. Their absence from a raw low-level API does not establish an exploit against a correctly isolated host. The gap is inconsistent coverage if an application assumes every exported API already shares one live runtime policy.

## 3. Verified gaps

### G01 - No common runtime policy or cancellation authority

Current boundaries have separate checks and lifecycle controls. There is no common revisioned mode, active-operation registry, or revocation epoch spanning tools, RUDRA, workflow actions, model attempts, memory and inspection. Removing a policy can prevent a later authorization, but is not an immediate broadcast cancellation of already-authorized work.

### G02 - Workflow model invocation differs from the fixed ModelRouter

Two isolated inline, mock-only Node probes were run during this audit; neither modified source nor used a paid API. Setup used a valid Jay identity (permission `work`), explicit workflow/capability/tool policies, `ToolRegistry.registerModel`, and a single read-only model action with `maxRetries: 2`. The token-based provider declared input/output ceilings of 1 each, zero prices, and workflow budget `maxCalls: 3`, `maxTokens: 6`, `maxCostUSD: 0`.

Probe A returned valid scalar data with `{inputTokens: null, outputTokens: null, costUSD: 0}`. Expected consistent R02 behavior: unverifiable usage terminates the token-based operation. Actual diagnostic fields:

```json
{"probe":"null-usage","status":"completed","providerCalls":1,"error":null,"usage":{"steps":1,"toolCalls":1,"modelCalls":1,"modelTokens":2,"modelCostUSD":0}}
```

Probe B threw `new ModelError('token-limit-exceeded')`. Expected consistent terminal classification: one call, no retry. Actual diagnostic fields (three calls mean two retries):

```json
{"probe":"hard-error","status":"failed","providerCalls":3,"error":"tool-failed","usage":{"steps":3,"toolCalls":3,"modelCalls":3,"modelTokens":6,"modelCostUSD":0}}
```

Root causes:

- `src/workflows/registry.ts:111` defines a separate provider path; around line 162 it calls `provider.infer` directly.
- Its usage loop around line 192 deliberately skips null counts, even for a token-based provider. That is weaker than the R02 router policy.
- Provider exceptions occur before the response-validation catch. The protected tool layer translates an unrecognized ModelError to `tool-error`; `src/workflows/engine.ts` permits bounded retries of read-only tool errors. The terminal model classification is lost.
- This path also has a separate nanodollar reservation calculation, including ordinary Number multiplication/addition before conversion. Its existing boundary tests pass, but it is not the same precision/reconciliation implementation as R01. The audit does not claim a newly reproduced workflow monetary overspend.

These probes demonstrate lifecycle/classification inconsistency, not a failure of the fixed direct router tests. Both probes remained within configured workflow reservations. No production fix was made in R03. A later authorized change needs shared usage/error semantics with explicit ledger ownership, preserving workflow ceilings and avoiding double reservations or refunds.

### G03 - Direct APIs and legacy execution are not automatically authenticated

Direct ModelRouter/createModelOperation calls, raw memory adapters, retrieved tool handlers, and unbound pure RUDRA execution do not share a mandatory Jay/Vijay runtime gate. Such APIs must be documented as trusted host primitives or explicitly bound in a future managed runtime. A firewall facade cannot honestly claim to cover references a host deliberately keeps and invokes elsewhere.

### G04 - Permission snapshots do not provide live claim refresh

Jay binds immutable identity permissions at authentication. `isSessionValid` can revoke a session, but returning true does not replace its grants. Define a trusted refresh/revocation contract if a role or tenant policy can change mid-session. Cached snapshots must never let a now-revoked grant survive indefinitely.

### G05 - Network and persistence boundaries require host participation

Inspection URL approval is not network egress enforcement. Requested page URLs do not describe redirects, subresources, private-address resolution, or browser capabilities. Recheck managed admission before each page acquisition; use host browser/network policy for the actual connections. Likewise, custom providers, embedding services and persistence adapters must cooperate with checkpoints and cancellation. A successful pre-call check cannot undo an already committed external effect.

### G06 - License enforcement is explicit

ServerLicenseGate correctly checks its requested entitlement. The host must still associate a protected operation with a required feature and invoke it. A previously returned entitlement is not a perpetual live authorization. Future managed admission should retain the existing license semantics and bound entitlement freshness; it must not infer licensing requirements or change product behavior silently.

### G07 - Administrative consistency and audit persistence are unspecified

Registries and the bounded audit log do not supply a durable policy source, administrative identity, atomic revisions, anti-rollback protection, or cross-process lockdown propagation. These are new contracts, not capabilities that can be assumed from the current class names.

### G08 - Documentation overstates network limitations

`SECURITY.md` contains broad wording that ShivAX does not make network requests. Current optional remote providers, host transports, embeddings and page acquisition require more precise coverage language. Update it in the implementation/documentation phase to distinguish defaults, explicit host opt-in and enforceable host controls. This audit does not modify that file.

## 4. Proposed additive firewall contract

Everything below is a proposal, not an existing SDK guarantee.

### Scope and modes

Create a controller per trusted deployment/identity issuer/security scope realm. Avoid a mutable process-global singleton, especially in multi-tenant hosts. The host registers exact operation IDs and owns provider, destination and resource profiles; model output cannot register operations or choose its authority.

| Mode | Admission and ongoing work |
| --- | --- |
| `enforce` | Mandatory invariants plus effective runtime rules; default deny for an unregistered operation or absent runtime allow; deny wins |
| `monitor` | Mandatory invariants still enforced. Only the additional runtime rule layer becomes observational: record `would-deny`, then allow only if baseline security permits |
| `lockdown` | Deny all new business operations, including reads and local inference; revoke active managed leases and request cancellation |

Lockdown leaves only narrowly defined trusted-host administration, audit draining and resource cleanup available. These are internal control paths, not business tools or model-selected exceptions. Monitor is not an authentication bypass or a switch that disables existing security. Entering monitor or leaving lockdown is a policy relaxation requiring administrative authorization and explicit approval.

### Mandatory invariants in every mode

1. Authentic original Jay context, valid session, issuer and tenant/scope binding; reject forged or copied authority.
2. Existing Vijay capability/tool policies, permission ceilings, host resource predicates, and required approvals. Runtime rules can narrow these, never create absent baseline permissions.
3. License requirements explicitly configured by the host, using existing ServerLicenseGate checks.
4. Existing schema, size, resource, deadline, tool-call, token and exact cost limits. Terminal model failures remain terminal across wrappers, retries and fallbacks.
5. Cancellation, disposal, revoked leases, stale revisions and invalid policy state cannot be overridden by prompt text, mode choice, output validation, or a late approval.
6. Tenant isolation, bounded sanitized audit data, and host-only administrative authority. Secrets and raw model/page content never become audit fields or policy commands.

### Effective policy evaluation

For a managed operation, effective authority is the intersection of the authenticated context's original ceiling, currently valid host grants, existing resource/capability/tool policy, required entitlement, and runtime rules. A newly added grant requires a fresh authenticated context if it exceeds the original ceiling. Explicit denies win. Resource checks use actual validated arguments and authenticated scope, not arbitrary labels supplied by a caller.

Persist only validated declarative rules over registered IDs and host-owned profile references. Do not persist executable JavaScript, model-generated predicates, arbitrary regular expressions or prompt instructions as policy. Existing trusted host predicates remain code under the host's control.

Evaluate at admission and again after asynchronous authentication, approvals or loading, immediately before each dispatch or commit boundary. Every fallback/provider attempt has its own check. Workflow resume, delayed tool use, memory embeddings and writes, and each inspection page acquisition require fresh checkpoints. A trusted transport must also check after its own internal awaits before opening a connection.

Within a single JavaScript isolate, do not yield between the final revision check, reservation and dispatch registration. Handle synchronous reentrancy explicitly: mark revocations before invoking listeners. This is not a distributed atomicity guarantee; shared stores and external effects need host fencing.

## 5. Runtime snapshots, leases and cancellation

Mint immutable snapshots containing an opaque controller/operation reference, realm, policy revision, local epoch, authentication epoch, expiry, and allowed operation IDs. Public snapshot data is diagnostic, not a bearer credential. Validate authority through a private WeakMap or equivalent private membership and the exact owning controller. A TypeScript brand or frozen object alone is not security.

Bind each active operation to a lease with a combined caller/deadline/controller signal. Preserve the original authenticated root context: spreading a TaskContext to replace its signal breaks Jay's identity binding. Internal child execution must retain proven root provenance and attach the child signal through a dedicated internal association.

For an initial implementation, any committed policy or mode change should conservatively revoke all active leases in the affected realm. Later selective revocation can be designed separately. A revoked lease never becomes valid again, even if the controller returns to a less restrictive mode. Delayed callbacks must acquire new authority or fail.

Record cancellation requested separately from work settled. Stop new dispatch immediately on local lockdown, propagate abort, close tool clients, and retain ownership until providers, pages and adapters actually settle. Late usage still updates accounting; ambiguous charges remain reserved. A timeout or mode transition must not cause a refund or enable overlapping unsettled work.

Cooperative cancellation cannot preempt synchronous JavaScript, forcibly stop an arbitrary promise, undo an already dispatched payment/commit, or guarantee that a provider stopped billing. A trusted host may terminate an isolated worker/process or revoke its network credentials; report that separately from SDK cancellation. Cleanup must be idempotent and must not reacquire business authority.

## 6. Administrative policy updates and persistence

Expose an administrative capability separately from the bot/tool-facing runtime. Never place it in model context, bot registries, task payloads or a generic tool client. Administrative authentication and approval come from a host-owned authority that a candidate policy cannot grant to itself.

Policy replacement protocol:

1. Validate and canonicalize the candidate schema, realm, registered IDs and expected revision. Authenticate the administrator and obtain required approval for relaxation.
2. Locally close admission, increment the epoch, revoke affected leases and request cancellation before awaiting storage. Serialize administrative changes per realm.
3. Compare-and-swap the persisted policy using the expected revision. The store must be atomic and authenticated; a local mutex alone does not protect multiple processes.
4. Recheck administrator validity before publishing a relaxation. Publish the immutable committed policy/revision only when authority and storage result remain valid. If that check fails after storage commits, keep local admission closed and require explicit recovery; do not silently activate the relaxation.
5. On conflict, uncertain write, corruption or unavailable required storage, remain closed and emit a bounded diagnostic. Never automatically roll back to a permissive snapshot.

An emergency local lockdown must synchronously close admission through a narrow host-held capability; durability is recorded afterward. Persistence failure cannot reopen it. Report local status, persistence status and draining work separately.

Store schema version, realm, revision and canonical declarative policy. Use an authenticated store or signatures with a host-owned trust root; checksums alone do not prevent malicious rollback. Persisted revision rollback protection and bootstrap trust are deployment responsibilities. Do not store authoritative policy as ordinary agent memory. Persistent mode starts closed if policy is absent, invalid or untrusted. An explicit host-owned volatile bootstrap may be supported for embedded applications, with its non-durable status visible.

Cross-process lockdown needs a host coordinator, revocation delivery, revision/fencing checks and defined acknowledgement semantics. A controller must not report deployment-wide lockdown merely because its own isolate stopped admission. A process that cannot confirm policy freshness must follow the configured fail-closed contract; an OS firewall/proxy is needed for externally enforceable egress denial.

## 7. Proposed public TypeScript surface

Illustrative contract for later review; these declarations do not exist yet. Export additively through the existing security entrypoint, keeping the current package export map. Implementation must integrate existing authorization, not trust a caller-supplied `authorized: true` flag.

```ts
import type { BotSignal, TaskContext, SecurityContext, Jay, Vijay } from 'shivax';

export type FirewallMode = 'enforce' | 'monitor' | 'lockdown';
export type RuntimeOperationKind =
  | 'workflow' | 'bot' | 'tool' | 'model'
  | 'memory-read' | 'memory-write' | 'inspection' | 'license';
export type FirewallReason =
  | 'allowed' | 'rule-denied' | 'no-matching-allow' | 'lockdown'
  | 'mandatory-denied' | 'stale-snapshot' | 'policy-unavailable'
  | 'policy-conflict' | 'revoked' | 'expired' | 'audit-unavailable';

export interface FirewallRealm {
  readonly deploymentId: string;
  readonly issuer: string;
  readonly scope: SecurityContext['scope'];
}
export interface FirewallRule {
  readonly id: string;
  readonly decision: 'allow' | 'deny';
  readonly operationIds: readonly string[];
}
export interface FirewallPolicy {
  readonly schemaVersion: 1;
  readonly realm: FirewallRealm;
  readonly mode: FirewallMode;
  readonly rules: readonly FirewallRule[];
}
export interface StoredFirewallPolicy {
  readonly revision: string;
  readonly policy: FirewallPolicy;
}
export interface FirewallPolicyStore {
  read(realm: FirewallRealm, signal: BotSignal): Promise<unknown>;
  compareAndSwap(
    realm: FirewallRealm, expectedRevision: string,
    next: FirewallPolicy, signal: BotSignal
  ): Promise<
    | { readonly status: 'committed'; readonly value: StoredFirewallPolicy }
    | { readonly status: 'conflict' }
  >;
}
export interface RuntimePermissionSnapshot {
  readonly controllerRef: string;
  readonly operationRef: string;
  readonly realm: FirewallRealm;
  readonly revision: string;
  readonly epoch: number;
  readonly authenticationEpoch: string;
  readonly expiresAt: number;
  readonly mode: FirewallMode;
  readonly allowedOperationIds: readonly string[];
}
export interface FirewallLease {
  readonly snapshot: RuntimePermissionSnapshot;
  readonly signal: BotSignal;
  checkpoint(): void;
  run<T>(operationId: string, work: (child: FirewallLease) => Promise<T>): Promise<T>;
}
export interface FirewallStatus {
  readonly mode: FirewallMode;
  readonly revision: string;
  readonly epoch: number;
  readonly admission: 'open' | 'closed';
  readonly durability: 'volatile' | 'pending' | 'confirmed' | 'failed';
  readonly active: number;
  readonly draining: number;
}
export interface FirewallRuntime {
  status(): FirewallStatus;
  run<T>(root: TaskContext, operationId: string,
    work: (lease: FirewallLease) => Promise<T>): Promise<T>;
}
export interface FirewallAdmin {
  // Trusted host capability: may restrict immediately, never relax.
  lockdown(reason: 'incident' | 'host-shutdown'): FirewallStatus;
  replace(root: TaskContext, expectedRevision: string,
    next: FirewallPolicy): Promise<FirewallStatus>;
}
export interface FirewallRegistration {
  readonly id: string;
  readonly kind: RuntimeOperationKind;
  readonly capability: string;
  readonly toolId?: string;
  readonly effect: 'read-only' | 'state-changing';
  readonly providerId?: string;
  readonly destinationProfileId?: string;
  readonly requiredFeature?: string;
}
export interface FirewallAuditEvent {
  readonly sequence: number;
  readonly epoch: number;
  readonly revision: string;
  readonly kind: 'decision' | 'mode' | 'policy' | 'revocation'
    | 'cancellation-requested' | 'settled' | 'audit-gap';
  readonly actionId: string | null;
  readonly decision: 'allow' | 'deny' | 'would-deny' | 'observe';
  readonly reason: FirewallReason;
}
export interface FirewallHostOptions {
  readonly realm: FirewallRealm;
  readonly jay: Jay;
  readonly security: Vijay;
  readonly registrations: readonly FirewallRegistration[];
  readonly initialPolicy: FirewallPolicy;
  readonly store?: FirewallPolicyStore;
  authorizeAdmin(root: TaskContext, next: FirewallPolicy): Promise<boolean>;
  currentGrants(root: TaskContext, signal: BotSignal): Promise<{
    readonly epoch: string;
    readonly permissions: readonly string[];
    readonly expiresAt: number;
  }>;
}
export declare function createFirewallRuntime(options: FirewallHostOptions): {
  readonly runtime: FirewallRuntime;
  readonly admin: FirewallAdmin;
};
```

The sample reuses the existing scope type. Signatures, bootstrap/store creation and audit subscription need implementation review. `run` callbacks are trusted host code, never serialized model-selected functions. Internal resource validation still receives actual validated input; this facade cannot authorize arbitrary resource access from only an operation ID. Nested calls must use proven parent authority and cannot create or broaden grants.

Add a bounded typed `FirewallError` with fixed reason codes, without raw causes or payloads in public diagnostics. Denials/revocations must survive bot, workflow and model wrappers as terminal errors. Do not rely only on cross-module `instanceof` for ESM/CJS interoperability, nor accept arbitrary untrusted objects claiming terminal or authorized status. Validate internal error provenance and sanitize externally supplied failures.

## 8. Exact future integration files

This table is a change plan, not a list of files changed in R03.

| File(s) | Required integration in a later authorized phase |
| --- | --- |
| New `src/security/firewall/types.ts`, `policy.ts`, `runtime.ts`, `admin.ts`, `audit.ts` | Validated contract, effective evaluator, private leases/epochs, administrative CAS, bounded events |
| `src/security/index.ts`, `src/sdk/security.ts` | Additive public exports; preserve existing declarations/entrypoints |
| `src/security/vijay.ts` | Optional managed binding; reuse/factor existing authorization and approval checks without authorizing twice or changing their semantics |
| `src/security/tools.ts` | Join controller cancellation, checkpoint before invocation, retain terminal classifications and cleanup ownership |
| `src/security/registry.ts` | Revision/change notifications or a managed mutation facade; prevent registry mutation from silently bypassing the bound controller |
| `src/security/jay.ts`, `types.ts` | Trusted grant freshness/authentication epoch association while preserving original context identity |
| `src/agents/rudra/orchestrator.ts`, `types.ts` | Optional managed admission and lease propagation across bot execution; preserve names and legacy behavior |
| `src/workflows/engine.ts`, `types.ts` | Admission/resume/action/retry checkpoints and terminal cancellation/error propagation |
| `src/workflows/registry.ts` | Resolve G02 through common usage/error semantics; agree on exact monetary ledger ownership before implementation |
| `src/intelligence/router.ts`, `types.ts` | Optional trusted managed binding before each provider attempt/fallback; preserve R01/R02 ledgers and terminal states |
| `src/intelligence/bridge.ts`, `remote.ts`, `ollama.ts` | Carry managed provenance; gate lazy remote loading and actual dispatch through trusted host transports |
| `src/bots/system.ts` | Wire managed runtime at the existing system composition boundary, if selected by the host |
| `src/memory/services.ts`, `lifecycle.ts`, `engine.ts`, `adapters.ts` | Protected scope binding; checkpoints for embedding, read/write and commit boundaries, without pretending committed effects can roll back |
| `src/inspection/services.ts` | Fresh admission and URL policy check for each acquisition, with existing approval rules preserved |
| `adapters/inspectra/index.mjs` and its existing host hooks | Prefer host wrapper/binding around acquisition; no extraction or normalization rewrite is required by this design |
| `src/licensing/index.ts` | Bind configured feature checks into managed admission; preserve entitlement and licensing behavior |
| `src/security/audit.ts` | Keep existing event compatibility; introduce the new stream additively rather than widening old events silently |
| `scripts/check-sdk-package.mjs`, `tests/`, `SECURITY.md`, SDK docs | Packaged ESM/CJS/declaration coverage, integration tests, accurate managed/unmanaged guarantees |

Raw APIs remain explicitly unmanaged unless bound. Merely exporting a controller or wrapping a top-level request is insufficient: each actual dispatch path in this table must participate before claiming managed coverage.

## 9. Audit safety

Keep events bounded and data-only: sequence, local epoch, policy revision, host-registered action IDs, fixed decision/reason, and cancellation lifecycle. Include old/new modes and revisions for administrative transitions in a validated event variant. Unknown requested IDs become null. Do not log principal/session IDs, bearer credentials, prompts, model output, full URLs, filesystem paths, page content or raw exception messages. Any correlation identifier must be opaque and host-approved.

Preserve the distinction between actual denial and monitor `would-deny`. Record policy conflicts, emergency lockdown, failed persistence, cancellation requested and settlement separately. Ring overflow requires a visible gap counter/event; an in-process log cannot prove completeness or withstand a malicious host.

Audit sinks must not execute policy or block emergency lockdown/cleanup. If a deployment requires durable audit before business dispatch, use a bounded acknowledgement path; failure denies dispatch and the policy epoch must be rechecked after acknowledgement. Do not silently convert a required durable audit to best effort. Ordinary optional observers must remain isolated from business execution failures.

## 10. Explicit trust boundaries

**An npm JavaScript SDK cannot prevent a malicious host from bypassing, replacing or directly invoking its own code.** This design provides enforcement for cooperating managed SDK paths under a trusted host, not an OS security perimeter.

| ShivAX can enforce inside managed paths | Requires trusted host or external isolation |
| --- | --- |
| Refuse invalid/unproven contexts and disallowed registered actions | Authenticate users, protect credentials and grant/admin authority |
| Enforce existing approvals, schemas, scoped tools and bounded budgets | Isolate hostile plugins/native modules and raw handlers from privileged references |
| Recheck policy revisions and revoke local leases | Broadcast/fence policy across processes and deployments |
| Stop new provider/tool/page dispatch through integrated paths | Stop arbitrary fetch/socket/browser traffic using OS firewall, proxy, network namespace or sandbox |
| Signal abort and track draining work | Terminate noncooperative processes/workers and revoke external credentials |
| Validate requested resources and configured profiles | Prevent redirect/DNS/subresource escape at the actual network boundary |
| Produce bounded sanitized audit events | Durable append-only storage, access controls, integrity and anti-rollback |
| Retain conservative budget reservations | Determine actual provider invoices, refunds and uncertain remote billing |

Prompt injection is untrusted content, not administrative authority. Refusing model-selected permissions protects the managed path, but does not make arbitrary host tools or browser environments safe. Workers alone are not a universal security sandbox; choose isolation appropriate to the host's threat model. Never use a global fetch monkey-patch as the advertised firewall boundary.

## 11. Planned positive, negative and adversarial tests

These are tests for future implementation, not tests claimed to have run in R03. Use deterministic mock providers, clocks, stores and deferred promises; assert dispatch counts and order, not only final error text.

| Area | Positive case | Negative/adversarial cases and required assertion |
| --- | --- | --- |
| Existing router fixes | Three $0.10 calls in $0.30, ten in $1.00, safe verified fallback | Fourth call denied; malformed output with token overrun terminal; preserve exact R01/R02 results in ESM/CJS |
| Authentication and bypass | Genuine Jay root plus authorized registered action | Forged/cloned root, forged snapshot, other-controller lease, changed issuer/scope, expired/revoked session: zero dispatch |
| Modes | Enforce allows explicit permitted operation; monitor records runtime would-deny | Monitor never bypasses baseline permission, approval, token/cost or license failures; lockdown blocks reads/local models too |
| G02 workflow provider path | Verified token metadata and safe bounded retry | Token-based null usage rejected; thrown hard budget error not retried; terminal reason retained through tool/workflow wrappers |
| Provider fallback | Explicit fallback authorized independently with its own reservation | Change policy between attempts; blocked destination/provider cannot run; unknown usage/timeout/hard limit never falls back |
| Prompt injection | Page/model text remains plain data | Text requesting unlock, admin, approval, tool IDs, changed tenant or policy cannot mutate authority or trigger extra calls |
| In-flight lockdown | Cooperative operation aborts and cleanup settles | Lockdown while awaiting auth, approval, SDK loading, provider response, embedding, page acquisition or precommit; no late approval/result revives lease; charges retained |
| Concurrent mode changes | Single revision update accepted | Competing relax/lockdown, stale CAS, synchronous observer reentry and rapid mode toggles: no transient permissive admission or stale lease reuse |
| Tools and RUDRA | Managed bot uses its scoped client within limits | Retained client after completion, undeclared tool, registry replacement during approval, delayed task, nested privilege escalation: denied |
| Tenant isolation | Independent realms operate without leaking state | Same principal/session/scope ID under different issuer, other-tenant namespace/profile/snapshot, shared cache collision: no cross-tenant access |
| Memory | Authorized scoped read/write and cancellation before commit | Policy change during embedding/transaction; block subsequent effects, report already-committed outcome honestly, no namespace chosen by model |
| Inspection | Authorized target/reference, explicit approval, successful page close | Lockdown between scans and during acquisition; close owned pages exactly once; host tests cover redirects, DNS rebinding and subresources |
| Licensing | Valid entitlement for configured operation | Expiry/revocation while paused, wrong product/issuer/scope/feature; monitor cannot bypass license check |
| Persistence | Valid startup and atomic revision replacement | Missing/corrupt/old policy, wrong realm, interrupted write, uncertain CAS, revoked administrator, failed durable store: closed admission and explicit recovery |
| Audit | Sanitized ordered decisions and mode transitions | Secret-bearing errors/IDs, getters, circular objects, throwing/reentrant sink, overflow and durable ack timeout: no secrets or permission expansion |
| Noncooperative host services | Abort-aware transport settles cleanly | Ignored abort retains draining ownership; do not claim stopped billing or completed termination; host isolation integration validates forced stop |
| Package compatibility | Existing 12 SDK subpaths and existing call signatures | ESM/CJS terminal errors and declarations work; optional Inspectra remains optional; no duplicate budget charging from nested bindings |

Add focused new tests under `tests/firewall*.test.mjs` and regression cases to existing workflow/router/security suites in the implementation phase. Exercise packed ESM/CJS imports and all existing declaration modes with `pnpm verify:package`. Run lint, full tests, build and package verification after integration. No test should use paid LLM APIs or require mandatory Inspectra installation.

## 12. Backward compatibility, unresolved questions and stop point

Adopt opt-in managed runtime binding first. Preserve current public constructors and signatures through optional configuration or new factories, existing export paths, RUDRA/specialist names, ML behavior, tool approval requirements, exact cost accounting and R02 terminal semantics. Do not silently claim legacy/raw calls are managed. Existing workflows must not lose checks when a controller is introduced, and monitor must not weaken their baseline.

Keep immutable root identity semantics. Do not create an API that lets a model or caller edit permission snapshots. Keep current audit event consumers working; add a distinct validated event stream. No package version or dependency ownership change is implied by this design. Any behavioral tightening for G02 needs explicit regression evidence and release documentation in its authorized phase.

Outstanding decisions and risks:

- Resolve G02 before claiming consistent model enforcement across the managed runtime. Decide the shared invocation/error validator and ledger owner without changing working router reservations or double-charging workflow calls.
- Finalize how the runtime reuses Vijay authorization with actual operation input and how child signals retain Jay provenance. The illustrative public surface is not an implementation-ready substitute for those internal checks.
- Define grant refresh frequency, maximum snapshot lifetime and revocation delivery SLA; a boolean session check alone does not update permissions.
- Choose persistence bootstrap, trust root, anti-rollback protection and administrator approval/recovery rules for each host deployment.
- Define multi-process lockdown acknowledgement and partition behavior. Local cancellation does not prove global network denial.
- Specify destination/resource profile schemas and enforce them at trusted transports; do not promise generic SSRF prevention from URL strings alone.
- Decide whether durable audit is mandatory for a deployment and how bounded admission delay is configured; lockdown and cleanup must remain available.
- Define host termination/drain deadlines for noncooperative work, and document irrevocable commits and ambiguous provider charges.

R03 ends with this audit and design. Existing ModelRouter fixes are verified. The current passing suite does not cover the two newly observed workflow inconsistencies. No firewall implementation or next phase has been started.
