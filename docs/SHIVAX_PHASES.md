# SHIVAX implementation phases

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**  
**One Intelligence. Many Specialized Minds.**

Date: 2026-10-25 (Asia/Calcutta).
Companion: [architecture and complete public API inventory](SHIVAX_ARCHITECTURE.md).
This is the implementation order. **Phases 00–06 have implementations; Phase 05
has two unresolved review findings, and Phase 06 acceptance is recorded below.
Later phases remain proposals.** Phase numbers below describe this new multi-bot
roadmap, not the older neural-network, digit or visual-comparison phase numbers.

## Rules and gates for every future phase

- Inspect relevant existing source/tests and applicable repository instructions
  before changing it. Request a concrete phase; do not implement later phases
  merely because they appear in this plan.
- Preserve the current ML engine, defaults, public APIs, digit assets, dataset,
  serialization format and browser demo. Prefer additive adapters and dependency
  injection. Do not move working files simply to match a proposed folder tree.
- Follow the user's logical responsibility structure and its
  [repository mapping](SHIVAX_ARCHITECTURE.md#mapping-onto-the-existing-repository).
  It is not a required physical reorganization: retain the existing `src/agents/`
  foundation and ML folders. Add new modules only within the requested phase.
- Keep TypeScript, current build tools, ESM/CJS outputs, Node >=22 and portable
  declarations. Keep browser and heavy model runtimes optional.
- Validate runtime input/output; use real implemented capabilities. Missing or
  denied services report unavailable/denied outcomes, never canned success.
- No unrestricted filesystem, shell or network tool. Protected operations pass
  through narrow host services and explicit resource policy. Model output never
  changes identity or permissions.
- Add meaningful tests for new behavior and run relevant existing regressions,
  the build, type checks and lint. No tests are needed for invented bot stubs.
- Do not publish packages or modify production systems.
- Finish with architecture changes, changed files, exact check results,
  limitations and phase status; stop before another phase.

Completion of one phase is a dependency gate, not permission to start the next.
An external adapter cannot be considered complete without its contract and
relevant verification; missing live infrastructure must be reported explicitly.

## Recommended order and dependencies

```text
00 Audit and proposal (complete)
 -> 01 Bot foundation, registry, events and selected-bot execution (complete)
 -> 02 Bounded RUDRA execution (complete)
 -> 03 Jaya / Vijaya and protected service boundaries (complete)
 -> 04 Seven-specialist system and deterministic adapters (complete; expanded user scope)
 -> 05 Concrete optional reasoning/model adapters
 -> 06 Durable memory / retention policies beyond the session interfaces
 -> 07 Hanuman / inspectra-automation adapter
 -> 08 Ekalavya controlled learning
 -> 09 Concrete code backends / further artifact capabilities
 -> 10 Visynq Workstation composition and compatibility acceptance
```

The sequence favors an inspectable executor and access boundaries before
resource-bearing integrations. Each specialist can remain absent until its
real backend/adapter is implemented. Phase 01 adds direct execution of an
explicitly supplied bot; Phase 02 adds RUDRA routing and workflow lifecycle.
Phase 03 supplies the security boundary for explicitly injected protected
services. Ordinary legacy direct ML calls remain available and unchanged throughout.

## Phase 00 — Existing repository audit

Status: complete. Scope: inspect the full repository surface, identify current
AI/ML capability, trace public APIs, inventory reuse, document risks and propose
an additive architecture. No source refactoring or runtime feature work.

Deliverables:

| Requirement | Evidence |
| --- | --- |
| Current architecture report | `SHIVAX_ARCHITECTURE.md`, sections 1–2 and 4 |
| Existing public API inventory | Section 3 retains the original 38 runtime / 66 type-only exports and documents Phase 01–03 additions; classes and methods included |
| Reusable module inventory | Section 5: all nine specialists and RUDRA mapped to existing code and missing responsibilities |
| Logical structure and repository mapping | Section 6; maps the user's intended roles onto current files and future additive modules, without requiring relocation |
| Risk and dependency analysis | Section 7; current zero runtime dependencies and proposed host adapter boundaries |
| Recommended implementation order | This document, Phases 01–10 and dependency gates |
| Detailed initial audit | `shivax-phase00-audit.md`, including dataset hash and validation evidence |

Architecture changes: none. Documentation introduced across this Phase 00 work:

- `docs/shivax-phase00-audit.md` — initial audit snapshot, retained unchanged
  during the expanded deliverable pass.
- `docs/SHIVAX_ARCHITECTURE.md` — current/target architecture and API inventory.
- `docs/SHIVAX_PHASES.md` — implementation order, scope and acceptance gates.

No executable functionality was added, so no new executable tests were added.
Existing tests are the preservation baseline. The repository hygiene findings
remain open; this phase does not silently fix configuration or expand scope.

### Verification

The initial audit ran `pnpm test`: the existing build passed, followed by 140
passing tests, zero failures/skips. `pnpm lint` failed with EPERM creating
`C:\Users\URVISH\AppData\Local\pnpm\store`; direct installed compiler/ESLint
checks passed. A package dry run passed with 31 entries and no source/tests/data.
The local dataset parser/split check accepted 500 unique balanced samples with
a 360/70/70 split; no training or dataset rewrite was performed.

For the expanded documentation pass, use the existing tools directly to avoid
the global pnpm store. Commands run sequentially, stopping on any failure:

```text
node scripts/clean.mjs
node node_modules/typescript/bin/tsc
node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

Expanded-pass results (2026-10-25):

| Check | Result |
| --- | --- |
| Clean + TypeScript + Rollup | Passed; declarations and ESM/CJS bundles rebuilt |
| Node test suite | 140 passed, 0 failed, 0 cancelled, 0 skipped |
| TypeScript `--noEmit` | Passed |
| ESLint | Passed |

The direct commands complete the existing build/test/lint checks without claiming
that the failing pnpm wrapper was repaired. Documentation links, root export
inventory and unchanged source/dataset state are checked separately. No network
dependency installation, package publication or production operation is part of
verification.

Limitations: no fresh browser compatibility matrix, real Ollama/model run,
MNIST provenance/accuracy benchmark, remote CI verification, vulnerability
advisory scan or current related-repository audit. Synthetic regression success
does not establish general intelligence or real-world prediction accuracy.

## Phase 01 — Multi-bot foundation

Status: complete under the user's Phase 01 request. Implement shared contracts,
BotRegistry, typed lifecycle events, trusted-host TaskContext snapshots,
structured validation/errors and two explicit test bots. The request also
includes exercising execution: `BotExecutor` runs only the supplied bot, without
RUDRA, routing, workflow composition or scheduling.

The existing root ML `Task` remains unchanged; the new equivalent is `BotTask`.
New source is confined to `src/agents/` and one additive root re-export. The
[API guide](bot-foundation.md) contains contracts, changed-file inventory,
usage, limits, cancellation semantics and trust boundaries. There are no new
dependencies, real LLMs, built-in filesystem/network tools or real specialists.
Mock bots stay in test fixtures and are not shipped in the package.

Tests cover registry removal/duplicates, discovery, request/host separation,
input/output semantics, executable/oversized data, event dispatch and observer
failures, error sanitization/propagation, permissions metadata, cancellation,
timeouts, late results, busy-slot retention, and portable typed consumers.

Final verification (2026-10-25), using the exact installed-tool commands from
[the API guide](bot-foundation.md#changed-files-and-verification):

| Check | Result |
| --- | --- |
| Clean + TypeScript + Rollup | Passed; declarations and ESM/CJS bundles rebuilt |
| Full Node test suite | **166 passed**, 0 failed, cancelled or skipped; 26 new foundation tests plus the existing 140 regressions |
| TypeScript `--noEmit` | Passed, including the test's ES2020-only typed consumer |
| ESLint | Passed |
| Export/documentation checks | Passed; all 104 original export names retained; current 46 runtime / 87 additional type-only exports documented; guide links resolve |
| `npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>` | Passed; 39 entries, all eight foundation declaration files present, no test/mock files; no publication |
| Preservation | Dataset SHA-256 unchanged; existing engine, demo, scripts, manifests and build configuration unchanged |

These checks use local tools rather than the pnpm wrapper whose global-store
permissions failed during the audit. The package-manager environment has not
been changed or claimed repaired.

At the Phase 01 checkpoint, identity and permissions are host assertions;
Jaya/Vijaya are added separately in Phase 03 below.
Injected code is trusted, and cancellation cannot preempt blocking JavaScript.
The per-object busy guard belongs to one executor, not a process-wide scheduler.
Repository hygiene findings from Phase 00 remain deferred: the explicit Phase 01
request does not include ignore/lockfile/security-document maintenance and
introduces no credentials. Stop after Phase 01.

### Implementation review — 2026-10-26

The [review/debug pass](bot-foundation-review.md) reproduced and fixed five
foundation defects: dropped non-enumerable fields, reentrant busy-slot bypass,
wall-clock-sensitive deadlines, undefined optional limits, and inconsistent
terminal event errors. It also pins all original public export names and runs
legacy ML in both formats without optional provider/browser globals.

Final review results: **172 tests passed**, zero failures/cancellations/skips;
TypeScript/Rollup build, no-emit type checks, ESLint, legacy API inventory,
dataset preservation and package dry run passed. The same original ML/demo
source, package exports and build configuration are preserved. Exact commands,
changed files and limitations are in the review report. No later phase started.

## Phase 02 — RUDRA cognitive orchestrator

Status: complete under the user's Phase 02 request (2026-10-26). Prerequisite:
Phase 01 contracts and registry. The request authorizes deterministic routing,
a provider-independent Planner interface, dependent sequential workflows,
approval lifecycle, bounded retries and traces in this phase.

`src/agents/rudra/` adds `RudraOrchestrator`, `CapabilityPlanner` and `RudraError`.
It reuses existing context/result validation and selected-bot execution.
Routing snapshots the registry and sorts matching bot IDs; plans cannot choose
arbitrary implementations or change the trusted host's capability/tool policy.
All plan schemas, dependencies and routes are validated before dispatch. A
host-owned approval hook gates every attempt when supplied. Defaults allow only
the requested capability, 16 execution attempts and zero retries.

The total deadline includes planning, approval and execution. Retries consume
the same step budget. Pending callbacks retain instance capacity after timeout
or cancellation; late completion cannot revive results. Outputs are accumulated
in plan order with a total data budget, and immutable traces record actual
decisions and failures. `dispose()` stops admission and signals cancellation.

The [Phase 02 implementation guide](rudra-orchestrator.md) lists the full API,
changed files, tests, verification results and limitations. The arithmetic mock
demo is `node examples/rudra.mjs` after building; it makes no provider or I/O
service calls. Existing ML exports, source, digit data/demo and build tools are
preserved. No authentication service, real specialist, unrestricted tool,
autonomous replanning or model adapter is introduced. Stop after Phase 02.

Acceptance results (Node v24.19.0): **204 tests passed** (32 new plus 172 existing),
zero failures/cancellations/skips. TypeScript/Rollup build, no-emit type checks,
ESLint, demo, legacy export inventory and package dry run passed. Packaging has
45 entries including six RUDRA declarations and no mock/test files. Existing
ML/demo source and dataset hash are unchanged. No browser runtime or minimum
Node 22 matrix was run; in-process callbacks require cooperative cancellation.

## Phase 03 — Jaya authentication and Vijaya authorization

Status: complete under the user's Phase 03 request (2026-10-26). Jaya and Vijaya
are mandatory guards for protected services, not planner-selected bot steps.
They are added in `src/security/` and connected through `RudraHooks.security`.
Jaya mints immutable contexts from trusted host adapters and validates provenance,
principal/session correspondence, expiry and revocation. Copied or client-supplied
IDs do not establish identity.

Vijaya adds exact-permission policies, deny-by-default capability/tool checks,
read-only/state-changing classification and mandatory explicit approval for
protected actions. It rechecks session, policy, input, scope and approval at tool
execution. Bots receive only a revocable, bounded tool client; they cannot change
permissions. A bounded audit ring records allow/deny evidence without credentials,
payloads or raw exception bodies. Policies and host handlers are never supplied
to model planners. Real authentication remains configured by the trusted host.

The [security guide](jaya-vijaya-security.md) contains the API, changed files,
integration example, acceptance evidence and limitations. Tests use mock identity
providers and narrow in-memory tools. All unauthorized tool test cases reject
before invoking a handler. No real identity service, unrestricted tool, password
database, cryptography, filesystem/network service or durable log storage is added.

Acceptance: **240 tests passed** (36 new security tests and all 204 prior tests),
zero failures/cancellations/skips on Node v24.19.0. TypeScript/Rollup build,
ES2020 consumer types, lint, Phase 02 demo and package dry run passed. All original
exports remain; package selection contains 53 entries, eight new security
declarations and no test/mock files. ML source, examples, build configuration and
dataset hash remain unchanged. Rollup emits non-fatal warnings for generated
ES2020 private-field helpers; details are in the guide. Stop before Phase 04.

## Phase 04 — Seven-specialist bot system

Status: complete under the user's expanded Phase 04 request (2026-10-26).
The explicit request supersedes the earlier vision/review-only scope: all seven
bots implement `Bot`, declare 16 input schemas/capabilities and compose with
RUDRA in `createSpecialistSystem`. Existing modules remain in place.

Sanjaya preserves supplied observations and supports an injected image adapter.
Brihaspati validates explicit/provider-generated plans and provider decisions. Vishwakarma
reports source metadata and returns unapplied patches. Chitragupta accesses
session memory through protected tools. Hanuman normalizes/compares supplied UI
snapshots using the existing engine. Yudhishthira runs actual deterministic
checks and optional advisory review. Ekalavya stores feedback/training records
and summarizes supplied scores, without updating model weights.

Memory/feedback interfaces have bounded in-memory implementations. Namespace
keys derive from verified principal, issuer, scope and session. Writes require
Jaya/Vijaya permission and approval checks. Capability-specific tool declarations
avoid requiring write IDs for a read operation. Missing model backends and
unsupported operations return explicit errors; no simulated inference is used.

The Phase 03 review's two findings are also corrected as prerequisites: protected
tools recheck the absolute workflow deadline after blocking callbacks, and the
public audit writer accepts only validated scalar fields into stored records.

Acceptance: **268 tests passed**, zero failures/cancellations/skips: 26 specialist
tests, two review regressions and all 240 previous tests. TypeScript/Rollup build,
ES2020-only consumers, lint, the specialist demo and package dry run passed.
Packaging has 68 entries including all 15 specialist declaration files and no
mock/test files. All original exports and the ML/digit source/data are preserved.

The [specialist guide](specialist-bots.md) lists the complete API, changed files,
commands/results, security boundaries and limitations. No actual model runtime,
durable backend, Inspectra capture, automatic training, patch application or
production changes are introduced. Stop before later phases.

## Phase 05 — Hybrid model intelligence

Status: complete under the user's expanded Phase 05 request (2026-10-26).
This replaces the earlier reasoning-only proposal with the requested general
provider interface and five-capability model router. See the full
[hybrid intelligence guide](hybrid-intelligence.md) for contracts, policies,
limits, changed files and limitations.

Added `src/intelligence/`: model contracts, immutable provider registration and
capability discovery, scope-bound routing, structured output validation, explicit
compatible fallback and remote opt-in, fixed errors, usage and lifetime call,
token and cost reservations. The neural adapter calls existing `predict`; rules
execute explicit deterministic host functions. Ollama reuses the existing local
transport with additive actual usage reporting; remote SDK loading and
credentials remain host configured and lazy. A DI function connects providers
to the existing specialist methods without changing RUDRA or Jaya/Vijaya.

Acceptance: **292 tests passed**, including all 268 previous tests and 24 new
provider/router tests; clean TypeScript/Rollup build, portable ES2020 declaration
consumer, type check, existing lint, offline demo and package dry run pass.
Cancellation retains pending work ownership; synchronous loader/metadata delays
cannot start inference past the deadline. No live model/API or real reasoning
quality is claimed. Existing ML internals, training dataset, browser demo and
legacy exports are preserved. Stop before Phase 06.

## Phase 06 — Chitragupta scoped memory

Status: complete under the user's Phase 06 request (2026-10-26).
See [memory engine guide](memory-engine.md) for the complete API, file inventory,
security boundaries, adapter configuration and limitations.

Added `MemoryStore`/`MemoryEngine` with save/retrieve/update/delete/search/list,
export and expiry purge; five categories, bounded metadata/retention, exact
user/issuer/session/workspace namespaces, deterministic relevance and optional
injected embeddings. In-memory, explicit Node file and lazy IndexedDB adapters
support portable persistence. Chitragupta adds eight protected record actions;
the seven-bot system now exposes 24 capabilities, retaining legacy read/write.

RUDRA optionally recalls untrusted relevant records before planning and captures
status-only terminal metadata through Chitragupta/Vijaya. Reads and writes share
step/deadline budgets and authorization. Default admission rejects common
credentials/personal data; no automatic transcript capture. Preferences/outcomes
require separate trusted host consent/verification. Existing digit persistence
and ML internals remain unchanged.

Acceptance: **323 tests pass**, including 31 new memory tests and all 292 previous
tests. Build, type/lint checks, portable declarations, offline demo and package
dry run pass. Real Node files are exercised; IndexedDB uses a protocol fixture,
not a live browser matrix. Durable encryption, multi-process file locking,
comprehensive DLP and live embeddings remain host responsibilities. Phase 05's
two budget-review defects remain outstanding and were not changed here.
Stop before Phase 07.

## Phase 07 — Hanuman and Inspectra inspection bridge

Prerequisites: Phases 03–04; inspect the current `inspectra-automation` package
and its actual API before defining a concrete integration change.

Add a narrow injectable inspection service to SHIVAX. The Node host owns browser
launch, URL policy, navigation, capture, artifact paths and resource cleanup;
Hanuman receives validated snapshots/results and real status events. Reuse
existing snapshot and analysis contracts. Keep browser runtime dependencies in
`inspectra-automation`; compose them in the host, avoiding a dependency cycle.

Acceptance: contract fixtures verify normalization/provenance, bounded requests,
cancel/failure states and scope isolation. Local authorized integration fixtures
verify the actual runner when available; missing runner tests are reported, not
replaced by fake scan success. No arbitrary URL-fetch/shell/filesystem tool and
no React/Playwright dependency in SHIVAX.

## Phase 08 — Ekalavya controlled supervised learning

Prerequisites: Phases 02–03; use Phase 06 only if storing model records.

Wrap existing `NeuralNet` training/inference and metrics in typed learning tasks.
Inject a host worker executor and isolated candidate model ownership. Reuse
existing data/split/augmentation rules where applicable; do not silently promote
demo helpers into public APIs. Evaluate a candidate independently before an
explicit authorized activation operation. Keep version 1 inference serialization
meaning and digit demo behavior unchanged.

Acceptance: deterministic fixtures, held-out isolation, candidate validation,
bounded work, worker cancellation, failed-training containment and unchanged
active models on rejected activation. Imported models are not advertised as
exact resumed checkpoints. No autonomous self-training, shared-model mutation,
dataset downloads or unmeasured accuracy claims.

## Phase 09 — Vishwakarma code artifacts

Phase 04 already provides source summaries, exact replacement artifacts and
validated optional code-provider patch proposals. Further backend adapters or
artifact operations require their own concrete scope; file application remains
separate and is never implied by a generation request.

Prerequisites: Phases 02–03, 05 for a shared optional model service, and 04 review
contracts; add a distinct backend contract only if code tasks require it.

Accept bounded code requests and return validated text/patch artifacts with
provenance and limitations. An absent code backend reports unavailable. Keep
generation separate from applying a patch or executing code. Any future apply/
execution feature is an explicit host capability with workspace/resource policy
and isolation; ordinary generated code has no filesystem, shell or network access.

Acceptance: backend/schema failures, unsafe artifact paths, unsupported edits,
policy denial, cancellation and size limits are tested. Review references real
artifacts; no canned claims that generated code compiles or tests pass. Execution
and repository mutations are outside this phase unless separately requested.

## Phase 10 — Visynq composition and compatibility acceptance

Prerequisites: implemented specialist phases required by the selected product
workflow; inspect the current Workstation repository before changing it.

Compose RUDRA, selected bots, trusted identity/policy, optional models, memory
and inspection services at the application boundary. React remains in Visynq;
SHIVAX owns portable intelligence/contracts and Inspectra owns automation.
Expose actual task events, evidence and errors; account/workspace switching
must cancel and isolate prior work. Package missing capabilities honestly.

Acceptance: existing ML/digit tests remain green; ESM/CJS and ES2020-only
declarations remain compatible; browser demo and selected Workstation flows are
checked in actual supported environments. Verify no model download or network
request on library import, no cross-scope leakage, bounded cleanup and absence
of mandatory heavy runtimes. Run local package dry run; publication/deployment
requires a separate request and is not part of this roadmap's implementation.

## Stop condition

Phases 00–04 are complete when their deliverables and relevant checks pass and
limitations are reported. Later phases remain proposals awaiting an explicit
request. Specialist interface completion does not start runtime/provider,
persistence, browser, training or product integrations automatically.
