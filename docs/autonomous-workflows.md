# Phase 08 — RUDRA autonomous workflow engine

Implemented 2026-10-28. This phase adds controlled action graphs beside the existing
`RudraOrchestrator`; existing bot plans and ML APIs keep their signatures. The canonical
authorization guard is **Vijay** (renamed from Vijaya in the earlier naming update).

## Architecture and public API

`RudraWorkflowEngine` coordinates a finite, validated action graph using `ToolRegistry`
and the existing Jay/Vijay security layer. Every action invokes `Vijay.executeTool`:
authenticated root context → capability policy/approval → tool policy/approval →
validated protected handler → validated result. The engine never evaluates code or
instructions returned by a website, model or tool.

| API | Contract |
| --- | --- |
| `new ToolRegistry(protectedTools?)` | Host-owned capability bindings over an existing or new `ProtectedToolRegistry` |
| `register(WorkflowTool)` | Register a narrow handler with explicit ID, capability, effect, input/output predicates and optional read-only `parallelSafe` attestation; duplicate IDs reject |
| `bind(WorkflowToolBinding)` | Expose an already registered protected service without replacing it; removing this binding leaves the original service registered |
| `get`, `list`, `findByCapability`, `unregister` | Immutable registration snapshots; capability matches sort by tool ID. Removing an owned registration removes its original protected handler |
| `registerModel(WorkflowModelTool)` | One injected Phase 05 `ModelProvider` call per invocation, with fixed output contract, token limits and pricing; remote providers require explicit host opt-in |
| `new RudraWorkflowEngine(tools, vijay)` | One active workflow per instance, including retained ownership of cancelled callbacks |
| `start(context, unknownPlan, options?)` | Returns a host-only `WorkflowRun`; malformed trusted context/options reject synchronously, plan/security/execution failures become structured results |
| `run.snapshot`, `run.result` | Immutable state, ordered partial outputs, bounded trace and cumulative budget usage; `result` resolves to a terminal snapshot |
| `run.pause()`, `run.resume()`, `run.cancel()` | Pause at a quiescent batch boundary, resume the same graph, or cancel. Neither control is exposed to models/tools |
| `engine.dispose()` | Cancel and permanently close admission |
| `WorkflowError` | Fixed error codes/messages, without raw host/model exceptions |

Public contracts: `ToolCallProposal`, `AutonomousWorkflowPlan`, `WorkflowToolBinding`,
`WorkflowTool`, `WorkflowModelTool`, `WorkflowModelBudget`, `WorkflowOptions`,
`WorkflowStatus`, `WorkflowErrorCode`, `WorkflowTrace`, `WorkflowOutput`,
`WorkflowSnapshot`, `WorkflowRun`. Existing `WorkflowPlan` continues to describe
Phase 02 bot workflows. No package subpath or dependency is added.

## Structured proposals and host configuration

```ts
const proposal: AutonomousWorkflowPlan = {
    actions: [
        { id: 'inspect', capability: 'site.inspect', input: { source: 'task' } },
        { id: 'review', capability: 'site.review', input: { source: 'step', stepId: 'inspect' } },
    ],
};
const engine = new RudraWorkflowEngine(tools, vijay);
const run = engine.start(jayMintedContext, proposal, {
    allowedCapabilities: ['site.inspect', 'site.review'],
    maxSteps: 8, maxToolCalls: 8, maxParallel: 1, maxRetries: 0,
});
const outcome = await run.result;
```

The host must separately configure capability and tool policies and pass
`tools.protectedTools` to Vijay. Declaring a tool grants no permission. The root
task capability also needs an admission policy. Model-suggested plans are accepted
as `unknown` and checked against a closed schema; fields such as permissions,
approval flags, handlers, tool IDs, budget overrides and retry policies reject.
The complete proposal is synchronously copied before authentication awaits.
Unknown/disallowed capabilities reject before any handler executes.

Each action has a unique ID, a capability and an input from the task, a literal,
or a previous action. Optional `dependsOn` references must also name earlier
actions. Output references automatically impose dependencies. Cycles, forward
references, duplicate IDs and empty/oversized plans reject. Data cannot introduce
new actions after validation. Output envelopes always say `trust: 'untrusted'`.

To reuse Phase 07's separately maintained Inspectra service:

```ts
registerInspectionService(protectedTools, hostInspectionProvider, hostURLPolicy);
const tools = new ToolRegistry(protectedTools).bind({
    id: 'shivax.inspection.capture',
    capability: 'site.inspect',
    effect: 'read-only',
    parallelSafe: false,
});
```

The host still supplies URL/resource policy, isolated browser leases, corresponding
Vijay policies and tool permissions. No capture engine, shell, arbitrary file
writer, fetch handler or navigation permission is added here. Existing memory
and inspection protected services can be bound the same way. Host code may compose
specialists with narrow protected services; the new engine does not expose their
registries or arbitrary bot invocation to a model.

## Approval, interruption, resume and recovery

State transitions include `queued`, `running`, `waiting_approval`, `paused`,
`completed`, `denied`, `failed`, `cancelled`. Only literal `true` from the existing
`VijayOptions.approve` handler grants an approval. An asynchronous host prompt
keeps the workflow in `waiting_approval`. Both capability and tool gates apply;
approval of one never authorizes the other. Inputs, session validity, policy
identity, effect classification, tool identity, permissions and deadline are
rechecked immediately before execution. Host approval can inspect the exact
resolved operation input. No cached approval is reused by a retry.

`pause()` waits for the active batch (including its approvals) to settle before
reporting `paused`. It does not abandon or replay an uncertain side effect. Use
`cancel()` to interrupt pending approval or signal active handlers. At a pause,
the immutable plan, partial outputs and remaining budgets remain in memory.
`resume()` takes no replacement input or permissions and revalidates the root
session; each subsequent action passes its own current policies again. Changed
tool bindings reject. The original deadline continues during pause and approval.

Sequential execution is the default. With `maxParallel > 1`, independent tools
may overlap only when the host marks each `parallelSafe` and both capability/tool
policies enforce read-only effects. Dependent reads wait. State-changing or
unattested tools are batch barriers and execute alone. Declared effects must match
tool policy, including for writes. One failure cancels peer signals, stops admission
of dependent actions and retains partial successful outputs in plan order.

Recovery consists of at most three extra attempts for read-only `tool-error`
failures. Each attempt spends steps, calls and any model reservations, and gets
fresh authorization/approval. Denial, invalid output, exhausted limits and
state-changing failures are terminal. No automatic write replay, rollback,
compensation, silent skip, replanning or unbounded recursive agent loop occurs.

## Per-task limits and audit

| Limit | Default / hard maximum |
| --- | --- |
| Execution steps (includes retries) | 32 / 100 |
| Proposed tool-call attempts (includes denied/failed attempts) | 32 / 100 |
| Concurrent safe reads | 1 / 8 |
| Additional read retries | 0 / 3 |
| Deadline | Existing `TaskContext.limits.timeoutMs`, up to 300,000 ms |
| Input and aggregate output bytes | Existing task limits, up to 1 MiB each |
| Model calls / tokens / USD | Zero by default; explicit `modelBudget` required |
| Trace retention | Last 1,024 scalar records with monotonically increasing sequence |

Model tools reuse `ModelProvider`, output schemas, provider validation and response
validation from Phase 05. They reserve the full input/output token allowance and
host-declared cost before approval/inference; failed, denied and cancelled attempts
are not refunded. Unknown usage retains the reservation. Reported overrun, malformed
usage or invalid structured output terminates execution without retry. Cost is
accounted in integer nanodollars, rounding reservations upward and host budgets
downward. Decimal conversion avoids floating-point multiplication at rounding
boundaries; a budget below one nanodollar cannot authorize a paid call. There is one fixed
provider per model tool and no implicit fallback. Optional provider runtimes remain
lazy; basic workflows use none. A fresh workflow receives a new budget; pause/resume
does not reset one.

The existing Vijay audit records allow/deny decisions. The workflow trace records
state, registered tool/capability IDs, plan indexes, attempts, approved actions,
outcomes and safe error codes. It omits inputs, outputs, model text and exception
bodies. The host task ID is a correlation field and must not contain credentials.
Result data is returned to the trusted caller separately from logs.

## Demo and tests

After building, run `node examples/autonomous-workflow.mjs`.
The explicitly labelled offline website fixture starts with a 30px heading.
The six actions inspect → detect typography mismatch → propose exact 24px patch →
request host approval/apply → rescan → validate. The host consent callback accepts
only that fixture/resource/property/before/after tuple. Applying the patch checks
the current value immediately before changing the in-memory object. Validation
uses the rescan's actual value. No user file, real website or production system is
modified. Tests also hold approval pending, then approve or deny it, checking the
page state and actual correspondence of the final observation.

Regression coverage includes complete/denied/failed/interrupted/cancelled/resumed
workflows, forged identities, revocation/expiry, protected tool bypass, permission
injection, late approvals, blocking validators, service commit checkpoints, registry
replacement, sequential/parallel dependencies, peer cancellation, reapproval on
retry, no write replay, budgets, output validation, untrusted content, trace
redaction, model overrun, remote opt-in and portable declarations.

Verification on Node v24.19.0 (2026-10-28):

| Check | Result |
| --- | --- |
| Clean, TypeScript and Rollup build | Passed; ESM/CJS and declarations rebuilt |
| `node --test tests/*.test.mjs` | **420 passed**, 0 failed/cancelled/skipped; 40 new workflow tests plus all 380 existing tests |
| TypeScript `--noEmit` and ESLint | Passed |
| ES2020-only public consumer and legacy ESM/CJS ML regression | Passed in the full suite |
| Offline six-action demo | Completed; measured 30px before, 24px after, validated final observation |
| `npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>` | Passed; 103 entries, all six workflow declarations, no test/example files; no publication |
| `git diff --check` | Passed |
| Existing ML, visual/SLM source and digit demo | Unchanged against HEAD |
| Dataset SHA-256 | Unchanged: `D76F8820EACA279A14BE7FF62AF07BD4FB8DDDFDD4CCBA9855E6E620BFE200D9` |

Build used installed local `tsc`, Rollup and ESLint binaries; the previously
reported pnpm global-store issue was not changed. Rollup's existing non-fatal
ES2020 private-field helper warnings remain. No live browser/remote API call was
needed. Phase 08 is complete; later phases have not started.

### Code review and regression pass — 2026-10-28

Two additional P2 defects were reproduced and fixed:

1. A pause requested while resume authentication was pending was ignored at the
   current boundary. A one-action workflow could complete instead of becoming
   paused. Immediate `resume(); pause()` had the same result. The boundary now
   rechecks pause requests after authentication and stays quiescent until the host
   resumes again. Existing deadline, cancellation and authorization checks remain.
2. The same upward nanodollar conversion was used for reservations and host limits.
   A `maxCostUSD` of `1e-12` authorized a `1e-9` model call. Limits now round down,
   reservations round up, and decimal conversion avoids float multiplication drift.
   Subnormal/zero amounts, exact boundaries and fractional reservations are covered.

The three initial regression cases failed before these fixes. Four new tests now
pass, bringing workflow coverage to **44 tests** and the full suite to **424 passed,
0 failed/cancelled/skipped**. Clean TypeScript/Rollup build, `tsc --noEmit`, ESLint,
ES2020-only public consumers, legacy ML compatibility, the six-action demo,
package dry run (103 entries, six workflow declarations) and whitespace checks pass.
The ML/visual/SLM source, digit demo and dataset hash above remain unchanged.

Review changes: `src/workflows/engine.ts`, `src/workflows/validation.ts`,
`tests/workflows.test.mjs`, `docs/autonomous-workflows.md` and `docs/SHIVAX_PHASES.md`.
No architecture or public API change was needed. Review scope included proposal
validation, Vijay/lease enforcement, approval and retry paths, parallel dependency
execution, pending-work ownership, pause/resume and model reservation accounting.
No further reproducible defect was found in this pass. The limitations below and
the separate Phase 05 router findings still apply. Phase 08 review is complete.

## Changed files

- `src/workflows/types.ts`, `errors.ts`, `validation.ts`, `registry.ts`, `engine.ts`, `index.ts`
- `src/security/vijay.ts`: additive protected action entry point reusing existing authorization and leases
- `src/security/tools.ts`, `types.ts`: task correlation for model requests and preservation of sanitized security error codes
- `src/index.ts`: additive workflow exports
- `tests/workflows.test.mjs`, `tests/package.test.mjs`
- `examples/autonomous-workflow.mjs`
- `docs/autonomous-workflows.md`, `docs/SHIVAX_ARCHITECTURE.md`, `docs/SHIVAX_PHASES.md`

Earlier Phase 06 fixes already present in the working tree are preserved separately.

## Limitations

Pause/resume is in-process, using the host-held handle, not a durable checkpoint or
restart/reconnect protocol. Cancelling cannot preempt blocking JavaScript, undo a
committed side effect or force uncooperative host code to stop. Public timeout and
cancellation results may precede handler cleanup; engine capacity remains reserved
until actual work settles. Host services must call `checkExecution()` immediately
before each later side effect and honor cancellation. An uncertain write is never
automatically retried. Host code remains trusted, not sandboxed; `parallelSafe` is
an attestation of resource safety rather than inferred isolation.

Model budgets cover calls through `registerModel`. Ordinary host tools that hide
model calls or invoke external routers independently are outside that accounting
boundary and must not be registered that way when enforcing a task model budget.
Provider pricing/usage are host contracts, not a guarantee of external billing.
The earlier Phase 05 `ModelRouter` budget findings are unchanged; this workflow
model path does not use that router. No new live model, real browser or browser
restart matrix is claimed by the offline demo. No package publication or later
phase implementation is included.
