# SHIVAX R04 - Firewall core implementation

Date: 2026-11-04 (Asia/Calcutta)  
Package: shivax@0.1.3  
Status: R04 complete. No publication or automatic advancement.

## Implemented boundary

Added `createShivaxFirewall` and typed contracts through the existing
`shivax/security` entrypoint and root aggregate exports. The factory returns a
frozen managed `runtime` and a separate host-only `admin` capability.

The core requires explicit valid configuration and starts in enforce mode. Missing
configuration or a different initial mode is rejected. Policies, operation
descriptors and input data are defensively snapshotted. There is no global mode
setter, task-supplied callback or model-controlled administrative API.

- Enforce requires an explicit mandatory allow and all baseline/resource checks.
- Monitor observes only explicitly optional deny rules. It never grants an
  operation without a mandatory allow, bypasses a mandatory deny, or disables
  authentication, approvals, tenant isolation, sandbox predicates or budgets.
- Lockdown rejects managed tools, workflows, bots, models and external operations.
  Explicitly allowed CPU-only registrations remain available. This is the R04
  requirement's refinement of R03's original broader lockdown proposal. Existing
  Tensor/NeuralNet operations and implementations are unchanged.

Vijay's new additive `runOperation` integration method uses its existing private
authorization path and required approval handler. It supplies a live baseline
checkpoint and preserves trusted callback error classification. Existing
`runBot`, `executeTool`, Jay and existing registries retain their behavior.
Managed tool registrations still use `Vijay.executeTool`.

## Policy and administration

Policies include provider IDs/localities, capability and bot allowlists, exact
file read/write paths, exact network origins, resource ceilings and audit
requirements. All lists are restrictive. File matching does not infer permission
from a parent path. Local/remote model registrations require a declared origin.
Host predicates must bind actual input, credentials and sandbox resources to
their registered declarations.

Versions increase for every successful update, including rollback. Rollback
revalidates one of the last 32 in-memory snapshots and republishes it under a new
version. It does not rewind budgets or restore revoked leases. Expected-version
checks and serialized administrative work prevent lost concurrent updates.

Administrative changes require the original authenticated context, matching
issuer/scope, a separate host role check and a state-changing Vijay administrative
capability with human approval. The host role is rechecked immediately before
commit. A bot/prompt/task cannot obtain the admin object through the runtime.

Authorized invalid updates close admission and revoke active leases; valid
authorized replacement or rollback is necessary to recover. Unauthorized
requests do not close admission. Updates fence active work before waiting for
required audit acknowledgements. Late callbacks cannot commit after timeout.
Authorized lockdown does not depend on an external audit sink being available.

## Budgets, cancellation and audit

Model registrations use the existing ModelRouter with one registered provider and
no implicit fallback. R01 exact BigInt cost units and reservation conversion are
reused for the shared firewall ledger. Reservations occur synchronously after
final checks, before dispatch, and include concurrent operations. R02 token
validation is retained. Hard model budget errors and unverifiable usage block
further managed model dispatch across registrations.

Cancelled/failed attempts do not refund reservations. Verified excess is added,
including late provider responses. Actual provider work remains tracked after a
public timeout/cancellation. Global limits and per-router limits both apply.
Lowering limits or rolling back policy cannot erase lifetime usage.

Operations receive a joined cancellation signal and live checkpoint. Policy
changes revoke existing leases; late approvals do not revive them. Public
cancellation can finish promptly while status reports noncooperative work as
draining. Concurrency ownership remains held until actual work settles.

Audit events contain fixed reasons, versions, modes and registered operation IDs;
they exclude credentials, inputs, outputs, raw exceptions, principal/session IDs,
paths and URLs. The ring and optional observer queue are bounded with visible
drop counts. Required audit delivery must acknowledge before business dispatch.
Optional observers cannot hold permitted work indefinitely.

## Files changed

| File | Purpose |
| --- | --- |
| `src/security/firewall/types.ts` | Public policy, operation, runtime, administrative and audit types |
| `src/security/firewall/errors.ts` | Fixed sanitized firewall errors |
| `src/security/firewall/policy.ts` | Validation, immutable snapshots and mandatory/optional evaluation |
| `src/security/firewall/operations.ts` | Trusted operation snapshots and exact model reservation calculation |
| `src/security/firewall/runtime.ts` | Execution, live checks, cancellation, budgets, audit and administration |
| `src/security/vijay.ts` | Additive host operation authorization hook |
| `src/security/index.ts` | Additive exports (the SDK security file already reexports this module) |
| `tests/firewall.test.mjs` | 33 cases in each of ESM and CommonJS: 66 new tests |
| `scripts/check-sdk-package.mjs` | Packed firewall export and declaration checks |
| `docs/sdk.md`, `SECURITY.md` | API usage, host obligations and accurate trust boundaries |
| This report | Actual validation and limitations |

No package version, export-map entry, dependency ownership, ML implementation,
RUDRA implementation, specialist bot, licensing implementation or Inspectra
adapter was changed.

## Actual validation

Executed on Windows, Node v22.23.2. No paid model APIs were used.

| Exact command | Actual result |
| --- | --- |
| `pnpm lint` | Exit 0: TypeScript no-emit and ESLint passed |
| `pnpm test` | Exit 0: 616 tests, 616 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo |
| `pnpm build` | Exit 0: clean, TypeScript, CJS declarations, ESM and CJS Rollup outputs passed |
| `pnpm verify:package` | Exit 0: temporary packed installation; all 12 ESM/CJS entrypoints; strict declarations in five consumer configurations; 431 packaged files |

The five declaration configurations are ESNext/bundler (.ts), Node16 (.mts and
.cts), and NodeNext (.mts and .cts). They include the new factory, policy snapshot,
mode, error and administrative types, and negative checks against a runtime mode
setter and unsupported modes. No pnpm.exe launcher failure or Rollup warning
appeared. The full suite includes the 66 new firewall cases and the existing 550.

The final full test output is recorded at the local temporary path
`C:/Users/URVISH/AppData/Local/Temp/shivax-r04-tests.log`. The initial 48-case
firewall suite and expanded 62-case suite also passed during development; these
are earlier subsets, not additional distinct tests. A temporary approval-review
usage-limit interruption prevented one intermediate test invocation from starting;
resuming through the normal approval path succeeded.

Tests cover mode behavior, default deny, malformed configuration/getters,
snapshot mutation, versions/rollback, concurrent administration, unauthorized
changes, administrator revocation during approval, tenant/session violations,
mandatory sandbox/approval checks, exact resource lists, cooperative and
noncooperative cancellation, late approvals, shared concurrent model budgets,
exact $0.30 boundaries, terminal model usage errors, late billing, audit
redaction/overflow, optional observer isolation and required-audit timeouts.

## Coverage limits and remaining risks

This is an opt-in managed core. Existing raw RUDRA, workflow, ModelRouter, memory,
licensing and Inspectra instances are not automatically attached. Hosts must
register their integrations, propagate signals/checkpoints and route nested
effects through managed paths. A top-level wrapper alone does not intercept all
I/O performed by a host callback.

The R03 G02 findings in the existing workflow `registerModel` path remain a
separate integration issue: null usage and terminal-error translation there have
not been changed in R04. New firewall model registrations use the already-fixed
ModelRouter path instead. Do not claim universal workflow/model parity.

Policy versions/history and administrative serialization are per instance and
in memory. Durable persistence, anti-rollback protection, grant refresh beyond
Jay's existing session validation and cross-process coordination remain trusted
host responsibilities. Administrator role rechecks do not implement a general
session permission-refresh protocol.

Exact path/origin checks validate declared resource contracts; trusted transports
must enforce actual paths, symlinks, redirects, DNS and subresources. Credentials
stay in host adapters. Marking an arbitrary callback CPU-only does not sandbox it;
CPU registrations are trusted host code with no declared I/O.

Cancellation is cooperative. The SDK cannot preempt synchronous JavaScript,
terminate arbitrary promises or remote I/O, undo committed writes, or prove that
provider billing stopped. Isolate untrusted/noncooperative work and enforce
network restrictions through a host, OS firewall, proxy or sandbox. An npm
JavaScript library cannot prevent a malicious host from bypassing its own code.

All required R04 checks passed. Stop after R04.
