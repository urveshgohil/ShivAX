# SHIVAX implementation phases

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**  
**One Intelligence. Many Specialized Minds.**

Date: 2026-10-25 (Asia/Calcutta).
Companion: [architecture and complete public API inventory](SHIVAX_ARCHITECTURE.md).
This is the implementation order. **Phases 00 and 01 are complete; later phases
remain proposals.** Phase numbers below describe this new multi-bot
roadmap, not the older neural-network, digit or visual-comparison phase numbers.

## Rules and gates for every future phase

- Inspect relevant existing source/tests and applicable repository instructions
  before changing it. Request a concrete phase; do not implement later phases
  merely because they appear in this plan.
- Preserve the current ML engine, defaults, public APIs, digit assets, dataset,
  serialization format and browser demo. Prefer additive adapters and dependency
  injection. Do not move working files simply to match a proposed folder tree.
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
 -> 02 Bounded RUDRA execution
 -> 03 Jaya / Vijaya and protected service boundaries
 -> 04 Sanjaya / Yudhishthira using deterministic existing capabilities
 -> 05 Brihaspati using optional existing SLM providers
 -> 06 Chitragupta scoped memory
 -> 07 Hanuman / inspectra-automation adapter
 -> 08 Ekalavya controlled learning
 -> 09 Vishwakarma code artifacts
 -> 10 Visynq Workstation composition and compatibility acceptance
```

The sequence favors an inspectable executor and access boundaries before
resource-bearing integrations. Each specialist can remain absent until its
real backend/adapter is implemented. Phase 01 adds direct execution of an
explicitly supplied bot; Phase 02 remains the RUDRA routing/lifecycle phase.
Protected services wait for Phase 03. Ordinary legacy direct
ML calls remain available and unchanged throughout.

## Phase 00 — Existing repository audit

Status: complete. Scope: inspect the full repository surface, identify current
AI/ML capability, trace public APIs, inventory reuse, document risks and propose
an additive architecture. No source refactoring or runtime feature work.

Deliverables:

| Requirement | Evidence |
| --- | --- |
| Current architecture report | `SHIVAX_ARCHITECTURE.md`, sections 1–2 and 4 |
| Existing public API inventory | Section 3 retains the original 38 runtime / 66 type-only exports and documents the Phase 01 additions; classes and methods included |
| Reusable module inventory | Section 5: all nine specialists and RUDRA mapped to existing code and missing responsibilities |
| Proposed target folders | Section 6; existing directories retained, new modules explicitly marked as proposals |
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

Identity and permissions remain host assertions; Jaya/Vijaya are not implemented.
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

## Phase 02 — RUDRA bounded dispatch and lifecycle

Prerequisite: Phase 01 contracts and registry.

Implement caller-selected sequential dispatch to explicitly registered pure
capabilities. Inject registry and narrow execution dependencies. Validate before
dispatch and after return. Enforce finite steps, size, deadline and concurrency
budgets. Define real lifecycle events, sanitized failures, cancellation,
disposal and rejection of stale/late completions. Preserve underlying operation
ownership; a timeout must not free capacity for still-running work.

Acceptance: routing reaches the selected real handler; unknown/invalid tasks
never invoke one. Tests cover success, thrown/rejected/invalid output, timeout,
pre/during cancellation, busy handling, disposal and late results. No hidden
retry loop, unrestricted tool registry, autonomous planning or protected I/O.

## Phase 03 — Jaya authentication and Vijaya authorization

Prerequisite: Phase 02 executor. Required before protected storage, inspection,
external inference, activation or execution services are exposed through RUDRA.

Define trusted host identity and resource-policy adapters. Jaya verifies the
host session and yields a principal; Vijaya evaluates explicit action/resource
permissions for that verified principal. Scope IDs are not credentials.
Revalidate access at each protected service boundary, including delegated
operations. Supply only the authorized service interface to the specialist.
Any anonymous/local mode is explicit and confined to its configured pure tasks.

Acceptance: missing/expired identity, scope mismatch, revoked/denied permission
and cross-resource access fail before the service call. Tests prove zero calls
after denial and no permission widening through task content or bot output.
No custom password database, token cryptography or model-based auth decisions.

## Phase 04 — Sanjaya vision and Yudhishthira review adapters

Prerequisites: Phases 01–03.

Wrap scene validation, matching and `analyzeUI` for Sanjaya tasks. Preserve
existing result values, unknown measurements, ambiguity and provenance. Add
Yudhishthira review tasks that apply explicit checks to supplied issues/evidence
and report unresolved cases. Make deterministic behavior visible in provenance.

Acceptance: adapter outputs agree with direct APIs; inputs/results are not
silently mutated; uncertainty and real differences survive. Test wrapper
changes, duplicates, missing measurements, cross-scope input and work limits
using existing fixtures where practical. No general image model, screenshot
capture or automatic acceptance/correction is claimed.

## Phase 05 — Brihaspati optional reasoning

Prerequisites: Phases 01–04; trusted provider configured by host when enabled.

Reuse `SLMProvider`/`SLMClient` rather than introduce a second model runtime.
Define bounded reasoning task schemas and semantic evidence validation. Preserve
existing UI advice behavior and external-provider opt-in. Return unavailable or
explicit fallback provenance when disabled/missing; do not invent an answer.
Providers receive only the minimum authorized context and retain no implicit
shared history.

Acceptance: disabled requests make zero inference calls; invalid/hallucinated
output, scope errors, timeout and cancellation preserve valid baseline evidence.
Fixture tests verify contracts and failure behavior. If a live configured model
is unavailable, disclose that its reasoning quality is unverified. No automatic
downloads, mandatory Ollama, embeddings service or unrestricted planner.

## Phase 06 — Chitragupta scoped memory

Prerequisites: Phases 01–03; optional reasoning integration uses Phase 05.

Introduce an injected memory-store contract and an explicit instance-local
in-memory implementation. Require scope/resource keys, bounded values/queries,
expiry/retention policy, explicit read/write/delete and cancellation. Treat
retrieved content as untrusted task data, never executable instructions or
permission grants. Durable storage is a separately supplied host adapter;
do not repurpose the digit model's origin-wide IndexedDB record.

Acceptance: tenant and instance isolation, policy denial, size bounds, expiry,
deletion, unavailable stores, disposal and errors are tested. No global memory,
implicit transcript collection, automatic vector database or indefinite retention.

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

Phases 00 and 01 are complete when their deliverables and relevant checks pass
and limitations are reported. Phase 02 and later remain proposals awaiting an
explicit request. Phase 01 completion does not start RUDRA implementation.
