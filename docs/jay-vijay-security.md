# Phase 03 — Jay and Vijay security

Jay establishes an authenticated context through a trusted host adapter. Vijay
enforces host-owned policies before RUDRA dispatch and again before every
protected tool handler. They are application guards, not planner-selectable
agents. A model cannot authenticate a user, grant permissions or approve itself.

Implementation is additive in `src/security/`. Existing ML, MNIST, visual and SLM
implementations and package entry points remain unchanged. No real authentication
provider, password database, cryptography, shell, filesystem or network tool is
introduced. Tests use a clearly named mock identity adapter and in-memory tools.

## Trust boundary and Jay

Follow-up: the [Phase 04 specialist work](specialist-bots.md) closes both review
findings from this phase. Protected tool leases receive RUDRA's absolute deadline
check, including a final check before dispatch after synchronous callbacks.
The public audit writer now validates scalar fields and discards extra payload
properties. Two focused regressions pass alongside all original security tests.
Phase 04 also adds optional capability-specific tool declarations; guards combine
bot-wide requirements with only the selected capability's declared tool IDs.

```text
Trusted server/desktop session adapter
  -> Jay.createContext(task, hostOptions)
  -> exact authenticated TaskContext object
  -> RUDRA configured with Vijay
  -> session + capability policy + approval checks
  -> selected bot with a narrow leased tool client
  -> session + tool policy + input + approval checks again
  -> registered host handler -> validated output
```

`IdentityProvider` has two required methods:

- `authenticate(signal)` returns an `AuthenticatedIdentity` or rejects. It closes
  over an already verified host request/session; it receives no client user ID,
  task metadata, planner output or claimed permissions as authentication input.
- `isSessionValid(identity, signal)` returns literal `true` only while that
  verified session remains valid. The host checks revocation, account changes and
  changes to permission grants here; false, non-boolean values and errors deny.

`AuthenticatedIdentity` consists of a principal (`id`, `issuer`, `permissions`)
and a session (`id`, matching `principalId`, `issuedAt`, `expiresAt`, `scope`).
Times are integer Unix milliseconds. Jay validates plain finite data, required
fields, permission uniqueness, principal/session correspondence, scope and time
ordering. Future-issued and expired sessions fail. Values are copied/frozen;
mutating the adapter's original identity cannot grant additional permissions to
an existing task. Renewed grants require a newly authenticated context. The host
must revoke prior sessions when reducing permissions; it cannot silently mutate
an already issued snapshot.

`new Jay(provider, { now?, audit? })` accepts an optional trusted clock for tests
and a shared audit log. `createContext(task, { signal, limits?, toolPermissions? })`
derives session, caller and scope from the adapter; optional tool IDs are a
host-selected narrowing, not permission grants. The method stores provenance in
a private `WeakMap`. Only the **exact returned context object** is accepted by
that Jay instance. `createTaskContext`, JSON reconstruction, object spreading,
copied IDs and even a bot-visible child context cannot manufacture this authority.
Call `verify(context, signal)` to recheck the host session; synchronous
`assertActive` checks provenance, cancellation and current expiry.

Construct/configure Jay and retain the authenticated root context in the trusted
host. Never install an adapter supplied by a model or expose Jay, policies,
registries or raw handlers to bots. In a browser, the host must use a server or
other trusted execution boundary for protected resources; browser claims alone
are not server authentication. Session IDs in these contracts are **non-secret
correlation labels**, not bearer tokens. Credentials stay inside the host adapter.

## Vijay policy and approval

`PermissionPolicyRegistry` supports `register`, `get`, `list` and `unregister`.
Each policy identifies an exact action by `{ kind: 'capability' | 'tool', id }`,
requires a nonempty list of exact permission strings, classifies `effect` as
`read-only` or `state-changing`, and supplies a synchronous `validateInput(input,
identity)` predicate. This predicate must enforce the action's schema and
resource/scope restrictions. Policies have no implicit wildcard or administrator
bypass. All listed permissions must exist in the verified principal. Unknown
actions, missing policies and missing permissions deny by default.

Registration snapshots/freeze descriptors and permissions and rejects duplicate
keys. Only the trusted host retains mutation methods. Policy removal invalidates
pending operations; replacing a policy creates a different snapshot and requires
a fresh authorization/approval. Internal state uses runtime-private fields,
rather than relying on TypeScript visibility modifiers for isolation.

Every state-changing policy requires explicit host approval even if a declaration
sets `requiresApproval: false`. A read-only policy may also require approval via
`requiresApproval: true`. Configure `new Vijay(jay, policies, { tools?, approve?,
audit?, maxToolCalls? })`. Its `approve(request)` callback receives frozen verified
identity, action kind/ID, effect, exact input and signal. Only literal `true`
authorizes that operation. Without a configured callback, a protected action
fails with `approval-required`. False/truthy substitutes and exceptions deny.

Capability and tool approvals are separate. RUDRA's older `hooks.approve` remains
an additional application gate; it cannot substitute for Vijay approval. The
planner cannot supply an approval flag or token. Session validity, expiry,
current policy, input and tool registration are rechecked after an approval
wait. The input snapshot cannot change between approval and invocation.

## RUDRA integration

```ts
import {
    Jay, Vijay, SecurityAuditLog, PermissionPolicyRegistry,
    ProtectedToolRegistry, BotRegistry, RudraOrchestrator,
} from 'shivax';

const audit = new SecurityAuditLog();
const jay = new Jay(trustedHostIdentityProvider, { audit });
const policies = new PermissionPolicyRegistry();
policies.register({
    kind: 'capability', id: 'notes.lookup', permissions: ['notes:read'],
    effect: 'read-only',
    validateInput: (input, identity) => isLookupForScope(input, identity.session.scope),
});
policies.register({
    kind: 'tool', id: 'notes.read', permissions: ['notes:read'],
    effect: 'read-only',
    validateInput: (input, identity) => isLookupForScope(input, identity.session.scope),
});
const tools = new ProtectedToolRegistry().register(narrowHostNotesTool);
const security = new Vijay(jay, policies, { tools, audit, approve: trustedHostApproval });
const rudra = new RudraOrchestrator(new BotRegistry().register(notesBot), { security });
const context = await jay.createContext(task, { signal, toolPermissions: ['notes.read'] });
const result = await rudra.run(context);
const decisions = audit.list();
```

Host/provider/tool/validator variables in this example are explicitly supplied
implementations, not built-in services. `notesBot.requiredTools` must declare
`notes.read`; it calls `context.tools.execute('notes.read', input.data)` from its
`execute` method. `BotContext.tools` is optional for compatibility and only exists
inside a secured invocation. Task data cannot choose the security instance.

RUDRA performs admission authentication and root capability validation before
planning. Every selected step receives a fresh capability check and necessary
approval, and validation callbacks cannot bypass a subsequent dispatch check.
The existing planner capability allowlist also remains in force. Security
approval transitions use RUDRA's real `waiting_approval` and `running` states.
Admission/capability failures return `failed` with `security-denied`; structural
context errors still reject before execution and are now audited. Security/tool
failures inside a bot map to non-retryable `tool-not-allowed` outcomes, with
authorization details in the separate audit records.

State-changing attempts are never automatically retried. Classification is
captured from the policy that actually authorized the attempt, so replacing it
after a failure cannot make that previous operation retryable. Explicit bounded
retries still work for read-only capability failures; security denials and tool
failures are not retried.

For backwards compatibility, a RUDRA instance with no security configuration can
still run the existing pure Phase 02 workflows. It supplies no tool client and
rejects execution of bots declaring tools even if their legacy context lists
tool IDs. **Configure Vijay for every workflow exposed to untrusted callers or
protected resources.** A legacy context is not authenticated. Ordinary direct
ML calls and the original standalone `BotExecutor` remain low-level trusted-code
APIs; they are not advertised as secured application entry points.

## Tool execution and ownership

`ProtectedToolRegistry.register` requires an ID, synchronous input/output type
predicates and an explicitly supplied handler. Descriptors are frozen; duplicates
are rejected. No handler is found or executed by its name alone. Before a handler
runs, all of these conditions must hold:

1. Jay recognizes the original root context; its signal and session remain valid.
2. The parent capability remains authorized and its policy snapshot is unchanged.
3. The selected bot declares the tool, and the host context permits that tool ID.
4. Both a tool implementation and a current tool policy exist.
5. The verified principal holds all required policy permissions.
6. Finite JSON, input byte bounds, the tool schema and the resource/scope policy pass.
7. Any required explicit tool approval succeeds and the checks still hold afterward.
8. A read-only capability never invokes a state-changing tool.

The bot receives a frozen `BotToolClient` with only `execute(id, input)`. It cannot
set identity, scope, permissions, policy, approval, implementation or execution
limits. Each tool receives only the frozen authenticated identity and linked
signal. Outputs pass structural size checks and the tool output predicate before
being returned. Handler exceptions are replaced by fixed error messages.

A client is leased to one bot attempt. Calls are sequential, with a default limit
of 32 (host-configurable 1–100) per attempt, including rejected calls admitted to
the lease. The bot input/output byte budgets apply to each tool input/output.
The workflow deadline and cancellation signal apply throughout authorization,
approval and handler execution. Leases close at bot completion; saved clients
cannot execute later or release the capacity reservation of a newer workflow.

Pending tool calls are cancelled and drained before a bot can relinquish
ownership. Returning while a tool is still pending fails the bot rather than
claiming completion. Work that already started with valid authorization may have
effects: cancellation does not imply rollback. After a workflow timeout RUDRA
retains capacity until the actual pending callbacks settle, and late results
cannot change the returned result. A permanently non-cooperative callback may
retain capacity indefinitely.

These protections govern the provided tool boundary. Injected JavaScript is
trusted application code in a shared runtime, not sandboxed hostile code. Hosts
must supply genuinely narrow services and truthful effect classifications;
untrusted native code must be isolated separately. Jay context creation precedes
the RUDRA workflow deadline; identity adapters must bound their own authentication
transport and honor the supplied signal. No detached I/O or durable transaction
rollback mechanism is added in this phase.

## Audit records and secret handling

`SecurityAuditLog` is a bounded in-memory ring (default 256 records, maximum
4096). `list()` returns frozen snapshots. Records contain sequence and operation
numbers, action kind, a registered host action ID or null, allow/deny, and a fixed
reason code. Unknown tool IDs are never copied into records. Session/principal/
task IDs, credentials, input/output values and raw exceptions are excluded.
Registered policy IDs must be non-secret host configuration identifiers.

The log records authentication and authorization decisions, not a promise that
an allowed operation succeeded or rolled back. RUDRA's outcome traces report
execution failures. RUDRA's existing traces still contain non-secret task/session
correlation IDs; never put tokens or passwords into those IDs. Hosts can keep a
separate log per host session and correlate/export snapshots at their trusted
boundary. This phase does not provide persistent or tamper-evident audit storage,
external log transport or an observer that receives credentials.

## Changed files and verification

Added:

- `src/security/types.ts` — principal/session, policy, tool, approval and decision contracts.
- `src/security/errors.ts` — fixed security errors and sanitization.
- `src/security/audit.ts` — bounded decision records.
- `src/security/jay.ts` — trusted adapter validation and context provenance.
- `src/security/registry.ts` — host-owned permission and protected-tool registries.
- `src/security/tools.ts` — bounded, revocable tool leases.
- `src/security/vijay.ts` — authorization, approvals and dispatch/tool enforcement.
- `src/security/index.ts` — additive public exports.
- `tests/fixtures/mock-identity.mjs` — local test provider; no real credential verification claimed.
- `tests/security.test.mjs` — security acceptance and regression cases.
- `docs/jay-vijay-security.md` — this guide.

Updated:

- `src/index.ts` — security re-export.
- `src/agents/types.ts` — optional `BotContext.tools`.
- `src/agents/rudra/types.ts`, `errors.ts`, `orchestrator.ts` — security dependency, error, lifecycle integration and reservation ownership fix.
- `tests/package.test.mjs` — ES2020-only consumers of new security APIs.
- `docs/SHIVAX_ARCHITECTURE.md`, `docs/SHIVAX_PHASES.md`, `docs/rudra-orchestrator.md` — current API, phase status and security boundaries.

Tests cover unauthorized/missing/forged identities, expired/revoked sessions,
missing policies/permissions, explicit approvals, prompt injections, scope and
schema attacks, tool permission bypasses, revocation during approval, immutable
identities/inputs, lease reuse, detached work, limits, timeout ownership, retries,
audit redaction and portable declarations. The saved-client reservation defect
was reproduced with a failing regression before its fix.

Acceptance commands use installed tools, preserving the existing pnpm setup:

```text
node scripts/clean.mjs
node node_modules/typescript/bin/tsc
node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>
git diff --check
```

Final results (2026-10-26, Node v24.19.0):

| Check | Result |
| --- | --- |
| Clean, TypeScript and Rollup | Passed; declarations and ESM/CJS bundles rebuilt |
| Full tests | **240 passed**, 0 failed, cancelled or skipped; 36 security tests plus all 204 prior regressions |
| No-emit type checks and ESLint | Passed |
| Portable consumers | New security APIs compile with ES2020-only libraries and no ambient Node/DOM types; ESM/CJS exports match |
| ML compatibility | Original exports retained; legacy ML executes in both formats without optional browser/provider globals |
| Phase 02 mock workflow demo | Passed |
| Package dry run | 53 entries, including all eight security declaration files; no mock/test files and no publication |
| API inventory | 55 runtime and 119 additional type-only exports; all original 104 names retained |
| Preservation | No changes to ML/visual/SLM source, examples, scripts, manifest or build configuration; dataset SHA-256 remains `d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9` |
| Documentation and whitespace | Local guide links/fences and `git diff --check` passed |

Build warnings about top-level
`this` originate in TypeScript's generated ES2020 private-field helpers; Rollup
replaces that optional global-helper lookup with undefined and retains the local
helper implementation. The ESM/CJS runtime and declaration checks verify the
result; build targets/configuration are not changed to suppress the warnings.

Real host authentication, browser/minimum-Node runtime matrices, worker/process
isolation, external service adapters and durable audit persistence remain host
configuration or future work. No package publication or production changes are
part of this phase. Stop before Phase 04.
