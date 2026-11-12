# Changelog

All notable changes to this project are listed in this file.

Each minor release line (`0.x.0`) has a release name. Patch releases keep the
name of their line. The npm version stays plain semantic versioning.

| Release line | Name |
| --- | --- |
| 0.1.x | BRAHMA |
| 0.2.x | NARASIMHA |
| 0.3.x | SARASWATI - The Intelligence & Learning Release |

## [0.3.1] SARASWATI - The Intelligence & Learning Release

Patch release. No ML, bot IDs, Jay/Vijay, learning, approval or rollback
behavior changed.

### Fixed

- Widen the optional Inspectra peer from `1.0.4` to `^1.0.4` (SHIVAX-C01). In
  0.3.0 and 0.2.0, installing ShivAX next to `inspectra-engine@1.1.0` or later
  failed with `ERESOLVE`. Verified with clean npm, ESM/CommonJS, declaration, real
  browser and security checks against 1.0.4 and 1.1.0, and with live ESM/CommonJS
  capture, normalization, screenshot and cleanup checks against 1.2.0. Inspectra
  remains optional and lazy-loaded. Errors now describe the required
  `captureUIPage` API without naming one exact package version.

### Added

- `scripts/check-inspectra-matrix.mjs`: a reproducible packed-consumer
  compatibility matrix for Inspectra releases.

## [0.3.0] SARASWATI - The Intelligence & Learning Release - 2026-11-12

All additions are opt-in and additive; the only breaking change is the
Vishwakarma bot id spelling (below). Migration notes: `docs/sdk.md`, section
"Migrating to 0.3.0 SARASWATI". New offline examples (S07):
`feedback-curation.mjs`, `worker-training.mjs`, `routing-shadow.mjs` and
`memory-ranking.mjs` in `examples/sdk/`. The optional Inspectra peer is pinned to
exactly `1.0.4` in this version; use 0.3.1 with newer Inspectra releases.

### Added

- Feedback provenance and dataset governance in `shivax/learning` (SARASWATI S01). `GovernedFeedback` v1 wraps an unchanged `FeedbackRecord` v1 with provenance: source, tenant owner, optional session reference, subject agent, model and configuration versions, evidence references, consent purposes, label revision, redaction and retention. Provenance is an untrusted claim and cannot mark itself verified.
- `createReviewAttestor(jay, …)` derives the reviewer from a Jay-verified live session. The reviewer must hold the review permission, belong to the record's tenant, not be the record's source, and pass the host `authorize` check. Reviewer data in the payload is never read. The attestation (`verified` or `rejected`) is bound to the record's SHA-256 content digest. `attestGovernedFeedback` remains for host-asserted reviews, which curation rejects by default.
- `storeGovernedFeedback` saves through the same Vijay-protected Chitragupt tool as `storeLearningFeedback`.
- `curateDataset` admits a record only with a verified, host-confirmed, independent and current attestation, the same owner, an active consent purpose and unexpired retention. It removes duplicates deterministically and partitions by connected components, so no feedback id, canonical input or source group appears in two splits. It returns v1 training exports, a versioned and digested `DatasetManifest` with eligibility metadata, and an exclusion report that holds only ids and reason codes.
- `traceDatasetLineage` lists datasets and trained candidates that used feedback which later became ineligible. It does not claim to remove that influence from trained weights.
- `verifyCuratedDataset` and `validateDatasetManifest` recheck digests and leakage. `checkPartitionLeakage` also works on pre-0.3 v1 exports. See `docs/learning-governance.md`.
- Reproducible benchmarks in `shivax/learning` (SARASWATI S02). A `BenchmarkSuite` v1 has an id, a suite version, a tenant owner, a dataset id, version and SHA-256 digest, an optional fixed seed with fixed-seed sampling, and cases with ground-truth labels whose origin is stated. Inferred labels are rejected. `runBenchmark` calls a host-supplied evaluator, which never sees labels, for one `baseline` or `candidate` configuration. It applies per-case and whole-run time limits, supports cancellation and rejects training-data leakage.
- Domain scoring for routing (correct, misrouted and unrouted bots, fallbacks), reasoning (verified field criteria), code (output and host checks; unsafe changes must be rejected), visual (precision, recall, false positives and negatives, computed versus inferred evidence), permission (mandatory denial cases, violations, over-denials) and memory (hits within top K, recall@K, MRR, scope violations). Exact JSON matching remains available and is reported separately. Error categories, latency percentiles, and verified-only token and cost totals are reported. Model-estimated confidence is kept apart and never scored.
- `BenchmarkReport` v1 keeps per-case scores, a logical digest (equal across reproducible runs) and an integrity digest. `validateBenchmarkReport` recomputes every summary number and rejects forged totals, inconsistent cases, duplicated ids, digest mismatches, a model judge presented as ground truth, and reports that do not match their suite. `checkBenchmarkReproducibility` reports nondeterministic cases.
- `compareBenchmarkReports` and `assessBenchmarkCandidate` add a regression gate. Mandatory and security cases must pass at 100% and must not regress under any policy. Configurable thresholds use a versioned `BenchmarkPolicy`; the default `STRICT_BENCHMARK_POLICY` keeps the existing every-case-must-pass rule. Eligibility never activates a model. New offline example: `examples/sdk/benchmark.mjs`. See `docs/learning-benchmarks.md`.
- New Node.js-only entry point `shivax/learning/node` (SARASWATI S03). `trainOfflineCandidateInWorker`, `trainCuratedCandidateInWorker` and `WorkerTrainingPool` train a candidate from a serialized model in `worker_threads`, so the host event loop stays responsive. Results are bit-identical to the synchronous APIs (documented tolerance 1e-12). Validation happens on the host before any worker starts, and the worker checks the job again. Supports progress events with optional validation metrics, AbortSignal cancellation (cooperative at a batch boundary, then forced termination), per-job deadlines, startup timeouts, V8 heap limits, bounded concurrency and queue, and `close()` for host shutdown. Workers are single-use and every job settles only after its worker has exited. Errors are typed (`WorkerTrainingError`). `shivax` and `shivax/learning` still import no Node built-ins. The synchronous training APIs are unchanged. See `docs/learning-worker-training.md`.
- Durable model registry in `shivax/learning` (SARASWATI S04). `createModelRegistry` and `openModelRegistry` manage model and configuration versions through `candidate`, `evaluated`, `approved`, `active`, `rejected` and `rolled_back`, with validated transitions and no path from an unverified candidate to `active`. Storage is a host-supplied `ModelRegistryStore`: content-addressed immutable objects plus one head record replaced by compare-and-swap (`InMemoryModelRegistryStore` is the isolated reference). Version manifests record the model and version ids, tenant, S01 dataset reference (verified), training configuration, artifact checksum and format, lineage and creator. Evaluation runs the S02 gate on reports bound to the exact version and the current active baseline. Approval requires a trusted administrator, passing security cases, a compatible artifact, an open firewall and a host-journal record. Activation rechecks the approval (expiry, active version, firewall policy version, security profile, host confirmation) and commits atomically; competing activations conflict. Rollback restores a verified, previously active version and appends to a hash-chained audit journal. Recovery is deterministic: missing or corrupt data fails closed and is never recreated, and ambiguous commits are resolved by operation id. Checksums are integrity only; an optional `signer` adds authenticity. Nothing activates automatically and stored weights are never changed. New offline example: `examples/sdk/model-registry.mjs`. See `docs/learning-registry.md`.
- Learning-assisted RUDRA routing, shadow by default (SARASWATI S05). `createRoutingAdvisor` (Ekalavya, bot id `ekalavy`) recommends a registered specialist per capability from verified evidence only: S01 datasets curated for `routing-analysis` and S02 routing cases backed by trusted reports. Each recommendation carries a ranking, a Wilson lower-bound confidence estimate, evidence references and structured explanation codes. Candidates are validated against registration, the RUDRA allowlist, tenant and Jay session scope, Vijay capability permissions, firewall lockdown, bots, capabilities and providers, and host provider budgets. Recommendations never execute anything or change routing; `runRoutingShadow` runs RUDRA unchanged and records the comparison. `evaluateRoutingQuality` compares policies on held-out labels (accuracy, failed routes, estimated regret, coverage, security denials, and measured latency and cost) and only reports `improved` with enough labels. RUDRA gains an optional synchronous `routing` hook that may only choose among the eligible registered bots; without it, routing and traces are unchanged. Routing policies are promoted through the S04 lifecycle using the deterministic `createRoutingEvaluator`, and are applied by `RoutingPolicySwitch` only with a rollback target; lockdown reverts to deterministic routing. No bots were added. See `docs/learning-routing.md`.
- Opt-in memory retrieval ranking (SARASWATI S06). `MemoryRanker` re-orders `MemoryStore.search` results by exact match, keyword coverage, trusted source quality (engine-verified categories or a host `sourceQuality` callback; self-declared metadata is ignored), optional explicit recency and optional semantic similarity. It breaks ties deterministically by record id, suppresses duplicates and bounds results. Each result carries provenance: record reference, claimed source and evidence references only when present, tenant and session scope, score components, freshness and `trust: 'untrusted'`. `searchFor(root)` derives the namespace from a Jay-verified identity and checks Vijay capability permissions; firewall lockdown refuses ranked searches. `hybrid` mode falls back to deterministic lexical ranking when embeddings are missing or fail. `createHashingEmbeddings` is a CPU-only local adapter (no remote provider or vector database). `evaluateMemoryRetrieval` reports precision@K, recall@K, MRR, missing-result rate and cross-tenant denial for a baseline and a candidate. Default search, `MemoryEngine` and the memory services are unchanged. See `docs/memory-ranking.md`.

### Changed

- **Breaking:** the code specialist is now spelled Vishwakarma. Earlier releases dropped the final "a" by mistake. The class is `VishwakarmaBot`, its source file is `src/bots/vishwakarma.ts`, and the bot id is `'vishwakarma'` (was `'vishwakarm'`). Update host policies, firewall `bots` lists and routing expectations that name `vishwakarm`; until you do, they deny the bot. `VishwakarmBot` stays as a deprecated alias of `VishwakarmaBot`.

## [0.2.0] NARASIMHA - 2026-11-07

This release has two breaking changes, marked below.

### Added

- Managed firewall in `shivax/security` (R04). `createShivaxFirewall` offers `enforce`, `monitor` and `lockdown` modes. It denies any operation you have not allowed, shares one exact model budget, versions each policy change with rollback, can cancel running work, and keeps a capped audit log with secrets removed.
- Protected execution (R05). `protectExecution: true` ties the firewall to one Vijay instance, so RUDRA, workflows and protected tools that use it must pass the firewall. Vijay gains a new `runOperation` method.
- Guarded model and integration calls (R06). `createGuardedModelGateway` is in `shivax/models`. Protected tools get live `checkNetworkAccess` and `checkFileAccess` callbacks. Remote models, Ollama, memory embeddings, memory storage and Inspectra page loading now check each destination.
- Firewall management (R07). `openShivaxFirewallManagement` lets a signed-in admin switch to a host-approved policy profile after a person approves. It saves with compare-and-swap, and it supports lockdown and audit reads.
- The `ModelFailureReason` type, a new `error.reason` field on model errors, and `ModelError` constructor aliases (R02).
- The SDK examples now ship in the package under `examples/sdk/`, along with a new `firewall.mjs`. Package checks confirm each documented example is packed, and they run the offline ones from an installed copy.
- `docs/production.md`, which covers scope, bot tasks, model needs, firewall setup, trust boundaries and known limits.
- `repository`, `bugs` and `homepage` fields in the package metadata, pointing to the public GitHub repository.
- R10 attack tests: lockdown during a remote model call and during an Inspectra capture, bad provider and policy URLs, attempts to go around the gateway, mode changes at the same time, stale approvals, and removal of injected input from audit records.

### Changed

- **Breaking:** model providers that bill by token must report token counts ShivAX can check. Counts that are missing, `null`, fractional, negative or too large now fail with the new final error code `usage-unverifiable`. So does a missing or malformed cost. There is no fallback, and that router takes no more calls (R02). Providers that do not bill by token must set `tokenBased: false`. A cost of `null` is still accepted.
- ShivAX now records the larger of the reserved cost and the reported cost. A confirmed token or cost overrun sets `usage-limit` for good. It stops fallback and blocks later calls on that router. This also applies to overruns reported late, after cancellation or a timeout (R01, R02).
- The Ollama adapter keeps the reported token usage when the model's JSON fails to parse, so overruns still count (R02).
- In protected use, `RemoteModelAdapter` loaders must provide `inferGuarded`. Protected use rejects transports that offer only the old method. Unprotected use is unchanged (R06).
- SECURITY.md now states the real network scope, the supported versions and a public way to report issues. The shipped docs no longer describe private sibling apps as part of the package.

### Fixed

- Exact model cost math: three $0.10 calls now fit in a $0.30 budget. Before, floating-point addition rejected the third call (R00-01, fixed in R01).
- Broken model output no longer hides a reported token overrun and lets a fallback provider run (R00-02, fixed in R02).
- **Breaking:** workflow model tools (`ToolRegistry.registerModel`) now follow the R02 usage rules (R03 finding G02). If a provider that bills by token reports `null` or missing counts, or malformed usage, the action fails with no retry. Hard model failures (token, cost or usage limits, unverifiable usage, timeouts and declared output failures) are no longer retried as ordinary tool errors. Plain `provider-error` and `unavailable` failures still retry up to `maxRetries`. ShivAX reads usage without calling getters.
- Workflow model tools now reserve cost with the exact R01 math, not a floating-point sum. The provider gets a fully funded `maxCostUSD` cap, and a charge equal to that cap is accepted.
- Test reliability: six timing tests no longer fail when the CPU is busy. The package cleanup test now uses its own temp folder, so a `verify:package` run at the same time cannot break it.

## [0.1.3] - 2026-11-01

### Added

- Conditional ESM and CommonJS declaration graphs for every public SDK entrypoint, including the optional Inspectra adapter.
- Packed-consumer verification for strict bundler, Node16 and NodeNext TypeScript consumers, with ESM/CommonJS type compatibility checks.
- Cross-platform package verification CI for Linux and Windows on Node.js 22, 24 and 26.

### Changed

- Target ES2022 JavaScript while preserving the previous public class-field assignment semantics. Older browser targets require application-side dependency transpilation.
- Declare inspectra-engine 1.0.4 as an optional peer, verified separately from ShivAX core.
- Install verification tarballs into isolated temporary projects outside the repository and retain cleanup on failures.

### Fixed

- Rollup private-field helper warnings and unresolved optional Inspectra subpath imports.
- Windows pnpm.exe execution in package verification, with safe native/JavaScript CLI dispatch, wrapper handling and actionable child-process diagnostics.
- TS1479 errors for CommonJS SDK consumers using TypeScript Node16 resolution.
- Missing or incompatible Inspectra modules now produce sanitized setup guidance while preserving lazy loading, cancellation and page cleanup.

## [0.1.2] - 2026-10-29

### Added

- Supported SDK entry points for core intelligence, RUDRA, specialists, security, models, memory, learning and integrations, with ESM/CommonJS declarations and shared runtime classes.
- UI-safe structured diagnostics and a server-verified licensing interface for a future Lemon Squeezy adapter.
- Registry, local inference, workflow, durable memory, Inspectra and React examples, plus an approval-gated ShivAX demo in Visynq Workstation.
- Packed-consumer export/type verification and release-readiness reporting.

### Changed

- Build shared SDK chunks while preserving the existing package name and root exports.

## [0.1.1] - 2026-10-28

### Changed

- Expand npm discovery keywords and describe ShivAX as a JavaScript/TypeScript multi-agent AI framework.
- Add feature-based use cases and concise README answers about platforms, model providers, controlled workflows, UI inspection, and learning.

## [0.1.0] BRAHMA - 2026-10-03

This entry records the current development baseline. The date is the documentation
baseline date and does not assert that a package release was published or tagged.

### Added

- CPU tensors, matrix operations, dense neural networks, classification/regression metrics, and bag-of-words text features.
- Configurable activations, SGD/momentum/Adam optimizers, initialization options, and JSON inference-model serialization.
- Handwritten digit training and inference playground with local model storage.
- Shared bot contracts, registry, capability discovery, lifecycle events, input/output validation, and execution contexts.
- RUDRA task coordination, deterministic routing, dependent workflows, approval handling, cancellation, retries, limits, and execution traces.
- Jay authentication and Vijay authorization with trusted host identities, session checks, protected tools, deny-by-default policies, and audit records.
- Sanjay, Brihaspati, Vishwakarm, Chitragupt, Narad, Yudhishthir, and Ekalavy specialist bots.
- Model-provider interfaces, neural/rules adapters, optional Ollama-compatible inference, configurable remote adapters, and capability-aware routing.
- Scoped memory with retention, search, export/deletion, optional embeddings, and in-memory, Node file, and IndexedDB adapters.
- UI observation contracts, semantic/structural matching, visual comparison, validated findings, and a separately maintained Inspectra adapter.
- Controlled autonomous workflows with structured tool proposals, pause/resume, safe parallel reads, approval checks, and per-task model/tool budgets.
- Verified feedback storage, evaluation datasets and metrics, curated training exports, isolated offline neural training, evaluated model/configuration updates, and approved rollback.
- ESM/CommonJS entry points and portable TypeScript declarations.

### Changed

- Adopt ShivAX AI branding: Synthetic Hybrid Intelligence with Versatile Autonomous eXperts.
- Standardize bot names to Sanjay, Vishwakarm, Chitragupt, Narad, Yudhishthir, Ekalavy, Jay, and Vijay.

### Fixed

- Screenshot-to-UI correspondence and Inspectra cancellation cleanup.
- Memory delete/recreate concurrency checks, semantic score stability, and deadline enforcement before storage commits.
- Pause requests during workflow resume authentication and fractional cost-budget rounding.
- Evaluation report consistency and held-out classification-target validation.
- Training weight-change reporting for zero-gradient updates.

[0.1.3]: https://www.npmjs.com/package/shivax/v/0.1.3
[0.1.2]: https://www.npmjs.com/package/shivax/v/0.1.2
