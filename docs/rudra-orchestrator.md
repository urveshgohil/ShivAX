# Phase 02 — RUDRA cognitive orchestrator

RUDRA coordinates registered bots with deterministic routing and validated,
sequential workflows. It composes the Phase 01 `BotRegistry`, `BotExecutor` and
`TaskContext`; it does not replace any ML implementation. This phase introduces
no model provider, runtime dependency, tool executor, filesystem or network I/O.
The logical architecture maps additively to `src/agents/rudra/`.

## Public API and basic usage

New runtime exports are `RudraOrchestrator`, `CapabilityPlanner`, and `RudraError`.
New type exports are `Planner`, `PlanningContext`, `WorkflowPlan`, `WorkflowStep`,
`WorkflowInput`, `RudraOptions`, `RudraHooks`, `RudraResult`, `RudraTaskStatus`,
`RudraErrorCode`, `RudraErrorDetails`, `StepOutput`, `ApprovalRequest`,
`ApprovalHandler`, and `ExecutionTrace`. Legacy ML `Task` and Phase 01
`TaskStatus` retain their existing meanings and members.

```ts
import { BotRegistry, RudraOrchestrator, createTaskContext } from 'shivax';

// The host supplies real implementations and independently verified identity.
const registry = new BotRegistry().register(reasoningBot).register(reviewBot);
const task = createTaskContext(
    { id: 'request-42', input: { capability: 'reason', data: requestData } },
    { sessionId, security: trustedHostSecurity, signal, limits: { timeoutMs: 5000 } }
);
const rudra = new RudraOrchestrator(registry);
const result = await rudra.run(task);
```

The default `CapabilityPlanner` creates one step using the task input. RUDRA
captures registered bot descriptors for each admitted run. For each capability,
it chooses the matching bot with the smallest ID using JavaScript ordinal string
comparison, independent of registration order or locale. It never silently
switches bots after failure. Changes to the registry affect subsequent runs.

## Planner and dependent workflows

`Planner.plan(context)` returns a proposal (or promise) typed `unknown`. Future
SLM/LLM adapters may implement this interface; no provider is imported by RUDRA.
The planner receives frozen task ID/input, allowed registered capability
descriptors, the maximum steps, and a cancellation signal. It does not receive
caller identity, tool permissions, registry methods, or an execution function.

```ts
const rudra = new RudraOrchestrator(registry, {
    planner: {
        plan: () => ({ steps: [
            { id: 'reason', capability: 'reason', input: { source: 'task' } },
            { id: 'review', capability: 'review',
              input: { source: 'step', stepId: 'reason' } },
        ] }),
    },
});
const result = await rudra.run(task, {
    allowedCapabilities: ['reason', 'review'], maxSteps: 4, maxRetries: 1,
});
```

The host allowlist defaults to **only the task's requested capability**. Additional
capabilities must be explicitly authorized by the host through `run` options;
never populate these options from unvalidated model output or task metadata.
The whole plan is copied, frozen, schema-checked and routed before any bot runs.
Unknown fields, duplicate step IDs, unknown/denied capabilities, accessors,
functions, cycles and forward/self/missing references fail safely. Plans cannot
name a preferred bot, change identity, grant tools, set limits or bypass approval.

Steps execute strictly in array order. Input is one of:

| Source | Data passed to the selected bot |
| --- | --- |
| `{ source: 'task' }` | Original `task.input.data` |
| `{ source: 'literal', data }` | Validated JSON data from the proposal |
| `{ source: 'step', stepId }` | Entire successful `data` output of an earlier step |

This supports chains and reuse of earlier results. It deliberately has no
parallel branches, expression evaluation, template expansion, conditional loops,
dynamic replanning or implicit merging of multiple inputs. Those would require
separately specified contracts. Every resolved input and returned bot result
passes the existing foundation validation. Child contexts retain the root task
ID, session, metadata, identity and tool permissions; traces distinguish step ID
and attempt number. Each child receives only the remaining workflow timeout.

Results contain `taskId`, terminal `status`, ordered `outputs`, and `trace`.
Each output is `{ stepId, botId, data }`. On failure, validated successful earlier
outputs remain available; the failing step contributes no aggregate output.
The result and all output data are frozen snapshots. There is no fabricated
final answer or conversion of unavailable capabilities into success.

## Lifecycle, approval and execution limits

```text
queued -> running -> completed
               |-> waiting_approval -> running
               |-> failed / cancelled
waiting_approval -> failed / cancelled
queued -> failed / cancelled
```

`queued` denotes admission, not a persistent FIFO scheduler. Each instance owns
at most one workflow; overlapping calls return `failed` with `busy`. Valid calls
after `dispose()` return `failed` with `disposed`. Invalid host contexts/options
reject before lifecycle callbacks. Workflow failures return structured results.
Timeouts use lifecycle `failed` with error code `timeout`; there is no additional
RUDRA timeout state, and the existing bot `timed-out` state is unchanged.

An optional trusted-host `approve(request)` hook is called before **every
attempt**, including retries. While awaiting its promise, the lifecycle is
`waiting_approval`. Only literal `true` approves; false/other values fail with
`approval-denied`, and exceptions fail with `approval-error`. The request includes
root task/session IDs, step/bot IDs, validated input, attempt and signal. The host
can resolve the promise from its own UI; RUDRA adds no UI, approval storage or
resume tokens. Without this hook, pure operations proceed immediately. The
planner cannot remove or grant host approval. This hook does not implement
Jaya/Vijaya authentication or resource authorization.

| Budget | Default and enforcement |
| --- | --- |
| `maxSteps` | 16, host-configurable 1–100; every bot attempt consumes one step, including retries. A plan with more steps is rejected before dispatch. |
| `maxRetries` | 0, host-configurable 0–3 extra attempts per step. Only canonical `bot-error` is retried, on the same selected bot. No retries for invalid input/output, missing capabilities, permissions, cancellation or timeouts. |
| Total deadline | `TaskContext.limits.timeoutMs` (default 30 seconds; foundation cap 300 seconds). Covers planning, approvals, all steps and retries; never reset between stages. |
| Input/plan size | `maxInputBytes` bounds the task envelope, full proposed plan, and every resolved bot-input envelope independently; default 65,536 bytes. |
| Output size | `maxOutputBytes` bounds each bot result envelope and the entire accumulated output array; default 65,536 bytes. Exceeding the aggregate cap returns `output-limit` and retains only prior bounded outputs. |
| Data traversal | Foundation limits: depth 32, 10,000 values, finite JSON data, maximum configurable byte budget 1,048,576. |
| Traces | At most 504 fixed-schema entries per run; IDs inherit the 256-character bound. Traces have a separate structural bound and are not charged to the output-data byte budget. |

Retries are explicit and traceable. Enable them only for pure or idempotent
implementations: a thrown error does not prove that an external effect did not
happen. This phase neither executes nor retries protected resource services.

Cancellation propagates a linked signal through planning, approval and execution.
The deadline uses a monotonic clock when available and wall-clock fallback on
nonstandard hosts. Late success cannot change the returned result. The instance
remains busy until the actual pending planner, approval callback or bot execution
settles, including after cancellation/timeout. `dispose()` permanently stops
admission and requests cancellation; it does not dispose caller-owned services.

Injected JavaScript remains trusted application code. In-process cancellation
cannot preempt blocking synchronous code, cancel detached work that an adapter
does not return/await, or guarantee rollback of effects. Non-cooperative callbacks
may retain capacity indefinitely. Isolation and protected adapters remain future
phases. Separate RUDRA instances have separate capacity; there is no global bot
ownership coordinator. Hosts sharing stateful bots must serialize access.

## Traces and errors

`onTrace(entry)` observes immutable entries as execution proceeds; the final
result also includes the complete trace. Entries have sequence, task/session IDs,
elapsed milliseconds, event type, and applicable state/step/bot/capability,
attempt, decision, outcome and sanitized error. Decisions are explicit labels
(`validated-plan`, `capability-then-bot-id`, `retry-bot-error`), not hidden model
reasoning. Traces omit task payloads, output values, caller identity and raw
exception messages. Host-supplied IDs are still visible. Observer exceptions
and rejected promises are isolated and observers are never awaited.

RUDRA error codes are `invalid-options`, `invalid-plan`, `planner-error`,
`missing-capability`, `capability-denied`, `approval-denied`, `approval-error`,
`max-steps`, `output-limit`, `bot-failed`, `timeout`, `cancelled`, `busy`, and
`disposed`. Bot outcome traces retain canonical Phase 01 errors such as
`invalid-input`, `invalid-output`, and `tool-not-allowed`. RUDRA terminal errors
include step/bot context in the terminal trace when known. Messages are fixed;
planner/host/provider exception text is never forwarded.

## Demo, changes and verification

After building, run `node examples/rudra.mjs`. The explicitly named mock
reasoning bot sums `[2, 3, 5]`; the mock review bot independently checks the sum.
The demo prints single-step and dependent-workflow results with real traces.
The review test also checks an incorrect proposed sum and returns `verified:
false`. These are arithmetic test doubles, not implemented specialist models.

Files added:

- `src/agents/rudra/types.ts` — planner, workflow, lifecycle, limits, approval and trace contracts.
- `src/agents/rudra/errors.ts` — canonical orchestration errors.
- `src/agents/rudra/planner.ts` — deterministic single-capability planner.
- `src/agents/rudra/validation.ts` — host option and untrusted plan validation.
- `src/agents/rudra/orchestrator.ts` — routing, execution, ownership and lifecycle.
- `src/agents/rudra/index.ts` — additive public exports.
- `examples/rudra-mocks.mjs`, `examples/rudra.mjs` — pure mock bots and runnable demo.
- `tests/rudra.test.mjs` — orchestration acceptance and failure tests.
- `docs/rudra-orchestrator.md` — this implementation guide.

Files updated:

- `src/agents/index.ts` — re-export the RUDRA module.
- `tests/package.test.mjs` — portable ES2020 consumer checks for the new contracts.
- `docs/SHIVAX_ARCHITECTURE.md`, `docs/SHIVAX_PHASES.md` — current API, mapping and phase status; retain the existing logical-structure clarification.

The original ML source, digit demo/data, public package entry points, manifest,
build configuration and Phase 01 contracts are unchanged. The three new runtime
exports are additive. No package is published and no production system is used.

Verification uses installed tools, avoiding the previously observed global pnpm
store permission issue:

```text
node scripts/clean.mjs
node node_modules/typescript/bin/tsc
node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node examples/rudra.mjs
npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>
git diff --check
```

Final verification (2026-10-26, Node v24.19.0):

| Check | Result |
| --- | --- |
| Clean + TypeScript + Rollup | Passed; ESM/CJS bundles and declarations rebuilt |
| Full Node test suite | **204 passed**, 0 failed, cancelled or skipped: 32 RUDRA tests plus all 172 existing regressions |
| TypeScript `--noEmit` and ESLint | Passed |
| Package compatibility | ESM/CJS exports match; ES2020-only consumers compile, including new planner/workflow types; legacy ML executes with optional browser/provider globals absent |
| Mock demo | Passed; single-bot and reasoning-to-review workflows completed |
| Package dry run | Passed: 45 entries, all six RUDRA declaration files, no test/mock files; nothing published |
| API inventory | Original 104 export names retained; current 49 runtime and 102 additional type-only exports |
| Preservation | No diff in ML, visual, SLM, digit demo/data, scripts, package manifest or build configuration; dataset SHA-256 remains `d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9` |
| Whitespace check | `git diff --check` passed |

The supplemental API inventory checks source export declarations; the package
tests also compile consumers of every original public type. The pnpm wrapper
environment remains unchanged.

Browser runtime and minimum Node 22 testing are separate from portable
declarations and Node 24 regressions; no live model or new MNIST accuracy
benchmark is claimed. **Phase 02 is complete.**

Phase 03 authentication/authorization and later specialist integrations remain
outside this phase and require a separate request.
