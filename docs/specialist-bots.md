# Phase 04 — SHIVAX specialist bot system

Seven specialists implement the shared `Bot` contract and register explicitly
with RUDRA through `createSpecialistSystem()`. They use the existing foundation,
visual engine and security layer. No ML code is relocated or replaced. There are
no new runtime dependencies, automatic model downloads, built-in network tools,
filesystem mutations or automatic model-weight updates.

The user's Phase 04 request expands the earlier roadmap's vision/review-only
scope to all seven bot interfaces, deterministic behavior, pluggable providers,
session storage and feedback recording. Future phases still require a separate
request for concrete model runtimes, durable storage, Inspectra or training.

## Bot IDs, capabilities and actual behavior

| Bot ID | Capability | Input and behavior |
| --- | --- | --- |
| `sanjay` | `vision.observe` | `{ observations: [{ label, confidence, bounds? }] }`; validates and preserves supplied observations, counts them, labels provenance as `supplied-observations`. Unknown confidence stays null. |
| `sanjay` | `vision.analyze` | `{ image: { mimeType, base64 }, observations? }`; invokes an injected `VisionModelAdapter`. PNG/JPEG/WebP MIME labels and base64 syntax are validated; actual decoding belongs to the adapter. |
| `brihaspati` | `reasoning.plan` | An explicit `{ steps }` workflow, or `{goal,allowedCapabilities,maxSteps?}` for an injected provider's optional `plan` method. Both paths reuse RUDRA's dependency validation and return a plan with provenance. Provider proposals must respect the requested capability/step limits and never execute automatically. |
| `brihaspati` | `reasoning.decide` | `{ question, options: [{id,label}], evidence: [{id,text}] }`; a replaceable `ReasoningProvider` returns a decision. Selected option/evidence IDs must exist in the input. |
| `vishwakarm` | `code.summarize` | `{ files: [{path,content,language}] }`; reports actual supplied paths, languages, line/character counts. It does not claim semantic parsing or program correctness. |
| `vishwakarm` | `code.patch` | `{ files, edits: [{path,oldText,newText}] }`; produces unapplied whole-file before/after artifacts from unique exact matches. Ambiguous replacements and unknown paths fail. |
| `vishwakarm` | `code.suggest` | `{ files, instruction }`; optional `CodeProvider` suggests patch artifacts. Paths must be supplied files and `before` must match the supplied content. Nothing is applied. |
| `chitragupt` | `memory.read` | `{ key }`; reads the verified session namespace through `MemoryStorage`. Returns `{found:false}` or `{found:true,value,revision}`. |
| `chitragupt` | `memory.write` | `{ key, value }`; writes through an approved storage tool. Returns the actual storage revision. |
| `narad` | `inspection.normalize` | `{ snapshot: UISnapshot }`; validates full existing scene contracts and normalizes units with the existing engine. Returns snapshot, counts and provenance. |
| `narad` | `inspection.compare` | `{ baseline: UISnapshot, target: UISnapshot }`; validates scope, normalizes both snapshots to CSS pixels and calls the existing deterministic `analyzeUI` implementation. |
| `yudhishthir` | `review.check` | `{ result, checks: [{id,path,operation,expected?}] }`; executes own-property existence, type or deep-equality checks. Reports actual pass/fail per check and overall. |
| `yudhishthir` | `review.inspection` | Consumes Narad's normalization output directly; checks CSS coordinates, counts and source consistency. It checks structural consistency, not image correctness. |
| `yudhishthir` | `review.model` | `{ result, criteria }`; optional `ReviewProvider` returns pass/fail/uncertain and findings. Output is explicitly advisory and never overrides deterministic review. |
| `ekalavy` | `learning.record` | `{ kind: 'feedback' | 'training', data, score? }`; appends a real record through a protected `FeedbackStorage` service. It never trains a model. |
| `ekalavy` | `learning.summarize` | `{ records }`; counts feedback/training records and computes the mean of supplied 0–1 scores, or null with no scores. Reports `weightsUpdated:false`. |

Every registered specialist capability exposes a frozen `inputSchema` in the
registry. The small declarative JSON Schema subset covers object/array/string/
numeric/boolean/null types, required fields, extra-field rejection, enums,
one-of alternatives and size/range limits. Semantic validation additionally
checks complete `UISnapshot` contracts, plan dependencies, relative paths,
references and scope. Schemas are discoverable contracts; validators remain
authoritative. Bot input/output still passes the foundation's finite JSON,
depth, node-count, byte-budget, task/bot correlation and cancellation checks.

Successful operations return ordinary `BotResult` values. Missing model adapters
return `failed` with `unavailable`; provider exceptions use fixed `provider-error`
messages; invalid provider data uses `invalid-output`. Unknown operations use
`unsupported-capability` (or RUDRA's `missing-capability` if no bot declares them).
Missing/denied storage tools fail through the existing permission boundary.
There is no fallback that invents successful inference, persistence or training.

## Composition and dependent workflows

```ts
import { createSpecialistSystem } from 'shivax';

const system = createSpecialistSystem({
    hooks: {
        planner: { plan: () => ({ steps: [
            { id: 'inspect', capability: 'inspection.normalize', input: { source: 'task' } },
            { id: 'review', capability: 'review.inspection',
              input: { source: 'step', stepId: 'inspect' } },
        ] }) },
    },
});
const result = await system.rudra.run(trustedTaskContext, {
    allowedCapabilities: ['inspection.normalize', 'review.inspection'], maxSteps: 2,
});
```

`system` exposes the host-owned registry, all seven bot instances, tool registry,
optional security guard and configured RUDRA instance. There is no global
singleton or registration side effect on import. `createSpecialistBots()` creates
the instances without a registry; `registerSpecialistBots(registry, providers?)`
adds the complete suite, checking duplicate IDs before registering any bot.

RUDRA preserves task/session IDs, host identity/scope, permissions and metadata
across the workflow; only step input and remaining deadline change. The result
aggregates ordered outputs from Narad and Yudhishthir. Run the working local
example after building with `node examples/specialists.mjs`. It uses supplied
structured data; it performs no capture, provider inference or remote operation.

## Optional provider interfaces

`SpecialistProviders` accepts `vision`, `reasoning`, `code`, and `review`. Each
provider has a nonempty ID and a replaceable method: `analyze`, `decide`,
`suggest` or `review`; reasoning providers can additionally implement `plan`.
Constructors bind/snapshot descriptors once. No provider
is mandatory and the package does not implement a new SLM/LLM runtime. A host
may adapt the existing optional `SLMClient` to these contracts explicitly.

Providers receive bounded, frozen input and a `SpecialistProviderContext` with
task ID, session ID, scope and linked signal. They receive no tool client or
permission-setting interface. Provider outputs are treated as untrusted data.
The output envelopes expected before provenance tags are:

| Interface | Provider output |
| --- | --- |
| `VisionModelAdapter` | `{ summary, observations: [{label,confidence,bounds?}] }` |
| `ReasoningProvider` | `{ selectedOptionId, rationale, evidenceIds }` |
| `ReasoningProvider.plan` (optional) | `{ steps: WorkflowStep[] }`; full dependency/step validation and requested-capability checks before returning the proposal |
| `CodeProvider` | `{ explanation, patches: [{path,before,after}] }` |
| `ReviewProvider` | `{ assessment: 'pass'|'fail'|'uncertain', findings: string[] }` |

Reference/schema validation cannot establish that model claims are true. Such
outputs retain provider provenance and appropriate review/advisory status.
Live model quality, actual image decoding and semantic code understanding are
not claimed by deterministic metadata operations or fixture-provider tests.

## Protected session memory and feedback

`MemoryStorage` exposes `read(namespace,key,signal)` and
`write(namespace,key,value,signal)`. `FeedbackStorage` exposes
`append(namespace,record,signal)`. `SessionMemoryStore` and `SessionFeedbackStore`
are real bounded in-memory implementations. Defaults are 256 total entries,
65,536 bytes per value and 1,048,576 total bytes per instance. Configurable caps
are 4,096 entries, 1,048,576 bytes per value and 16,777,216 total bytes. Writes
check capacity before changing state; returned/read values are frozen snapshots.

The host can inspect feedback with `SessionFeedbackStore.list` and explicitly
clean either implementation using `clearSession(namespace)`. Namespace keys
include verified principal, issuer, company/personal scope and session ID.
Cross-session, principal, issuer and scope reads cannot retrieve another key.
No shared transcripts, vector database, filesystem persistence, origin-wide
IndexedDB state, TTL scheduler or automatic model promotion is introduced.

```ts
const system = createSpecialistSystem({
    memory: new SessionMemoryStore(),
    feedback: new SessionFeedbackStore(),
    security: { jay, policies, options: { approve: trustedHostApproval, audit } },
});
```

The host must register capability and tool policies and obtain the exact root
context from Jay. Service registration never grants permissions or installs
policies automatically. For a separately composed application, call
`registerSpecialistServices(tools,{memory,feedback})` to register the narrow
handlers, then use those tools in the host's Vijay instance.

| Capability | Required tool | Minimum effect classification |
| --- | --- | --- |
| `memory.read` | `shivax.memory.read` | read-only |
| `memory.write` | `shivax.memory.write` | state-changing; explicit approval |
| `learning.record` | `shivax.feedback.append` | state-changing; explicit approval |

The foundation now supports optional `Capability.requiredTools`. Requirements
combine bot-wide declarations with **only the selected capability's** tools.
Thus a read needs only the read tool ID, and a read lease cannot invoke the write
tool even if the principal/host otherwise permits writes. Existing bot-wide
declarations retain their prior behavior. The guards and executor use the same
selection helper. Tool registry schemas, session validity, authorization,
approval and input/output validation still apply at execution time.

Storage never accepts caller-supplied namespace arguments: registered handlers
derive them from the verified identity passed by Vijay. Plain Phase 02 contexts
and pure RUDRA instances cannot invoke storage capabilities. Model-backed
operations are trusted injected services; configure secured RUDRA entry points
and suitable policies for untrusted callers or protected providers. Low-level
direct bot/ML APIs retain the trusted-code assumptions of the foundation.

## Phase 03 review corrections included as prerequisites

Both reported review findings are closed with regression tests:

- RUDRA passes its monotonic deadline check to the protected tool lease. Checks
  surround host policy validation and run immediately before a handler, so a
  blocking approval/validator cannot start a write after the workflow deadline.
  The reproduced 20 ms deadline / 50 ms approval case now records zero tool calls.
- `SecurityAuditLog.record` validates documented scalar fields and constructs a
  whitelist record. Extra credential objects are discarded, cannot be mutated
  through log references, and invalid reason/kind/decision values are rejected.

These corrections do not add new security services or change the ML APIs.
Injected JavaScript still requires host trust; a deadline cannot preempt an
already-running synchronous handler or roll back an effect.

## Changed files

Added specialist modules:

- `src/bots/sanjay.ts`, `brihaspati.ts`, `vishwakarm.ts`, `chitragupt.ts`,
  `narad.ts`, `yudhishthir.ts`, `ekalavy.ts` — the seven implementations.
- `src/bots/base.ts`, `schema.ts`, `types.ts`, `provider.ts` — shared result/schema
  handling and narrow provider contracts.
- `src/bots/storage.ts`, `services.ts` — session storage interfaces/implementations
  and protected tool adapters.
- `src/bots/system.ts`, `index.ts` — explicit composition and public exports.
- `tests/specialists.test.mjs`, `examples/specialists.mjs`,
  `docs/specialist-bots.md` — acceptance cases, runnable example and this report.

Updated foundation/security integration:

- `src/agents/types.ts`, `errors.ts`, `validation.ts`, `execute.ts` — additive
  capability schemas/tool metadata, explicit provider errors and tool selection.
- `src/agents/rudra/orchestrator.ts` — selected-capability tool handling and the
  existing absolute deadline check supplied to security.
- `src/security/vijay.ts`, `tools.ts` — selected tool leases and final deadline checks.
- `src/security/audit.ts`, `errors.ts` — validated scalar audit records.
- `src/index.ts` — additive specialist re-export.
- `tests/security.test.mjs`, `tests/package.test.mjs` — review regressions and
  portable typed consumers of all seven bots and storage/provider contracts.
- `docs/SHIVAX_ARCHITECTURE.md`, `docs/SHIVAX_PHASES.md`,
  `docs/jay-vijay-security.md` — current API, requested phase scope/status and
  security review resolution.

Existing ML, visual and SLM engines, digit demo/data, manifest and build
configuration are preserved. No files are moved to match the logical diagram.

## Verification and phase status

On 2026-10-26, Node v24.19.0:

| Check | Result |
| --- | --- |
| Clean + TypeScript + Rollup | Passed; declarations and ESM/CJS bundles rebuilt |
| Full tests | **268 passed**, 0 failed/cancelled/skipped: 26 specialist tests, two security-review regressions and all 240 prior tests |
| TypeScript no-emit and ESLint | Passed |
| Portable consumers | All specialist/provider/storage contracts compile with ES2020-only libraries; ESM/CJS exports match; legacy ML still works without optional browser/provider globals |
| Specialist example | Passed; all seven bots registered and Narad → Yudhishthir returned a combined completed result |
| Package dry run | Passed: 68 entries, all 15 specialist declaration files, no mock/test files; nothing published |
| Public API | Original 104 names retained; current 68 runtime and 133 additional type-only exports |
| Preservation | Existing ML/visual/SLM/digit source, dataset, scripts, manifest and build configuration unchanged; dataset SHA-256 remains `d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9` |

Checks use the installed compiler/Rollup/ESLint binaries as in prior phases; the
pnpm environment is unchanged. Existing non-fatal Rollup warnings from generated
ES2020 private-field helpers remain. No real model runtime, actual browser/
Inspectra integration, minimum Node 22 matrix, model-quality/accuracy benchmark,
durable storage or weight update is claimed. These implementations are bounded
adapters and deterministic checks, with optional host services where stated.

**Phase 04 is complete under the user's seven-specialist scope.** Stop before
any further provider, persistence, Inspectra, training or product-integration phase.
