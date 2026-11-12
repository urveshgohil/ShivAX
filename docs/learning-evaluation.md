# Phase 09 — Ekalavy learning and evaluation

Status: complete for the controlled offline scope, reviewed 2026-10-28.

Changed files: `src/learning/index.ts`, `src/learning/updates.ts`,
`src/learning/training.ts`, `src/bots/ekalavy.ts`, `src/index.ts`,
`tests/learning.test.mjs`, `tests/fixtures/learning-cases.mjs`,
`tests/specialists.test.mjs`, `tests/package.test.mjs`, this document,
`docs/SHIVAX_ARCHITECTURE.md`, and `docs/SHIVAX_PHASES.md`.

Feedback validation supports accept/reject/correct. `storeLearningFeedback` sends
records through Chitragupt's existing protected `shivax.memory.records.save`
service as verified outcomes; host outcome verification and Vijay policies must
be configured. The helper grants no verification or permission itself.
Ekalavy exposes `learning.feedback` using that service. The legacy `learning.record`
and `learning.summarize` capabilities remain compatible. Denied permissions,
missing verification and rejected approval all leave memory unchanged in tests.

Evaluation datasets declare one of six task domains and expected JSON outcomes.
The runner measures completion, exact expected-outcome accuracy, routing accuracy,
invalid outputs, boolean false positives/negatives, latency, reported model usage
and permission-case pass rate. Exact matching ignores object-key order. Latency
is measured, not expected to repeat exactly. Host evaluators are trusted code.
Exceptions count as failed/invalid observations without retaining exception bodies.
Unknown or invalid usage sets `usageComplete: false`; numeric totals then cover
only valid reported usage and must not be interpreted as total actual consumption.
The runner has a 30-second default deadline, configurable up to five minutes,
and forwards cancellation. A timed-out callback may continue if it ignores its
signal; the runner starts no further cases. Host callbacks must own their resources.

Public APIs: `learningFeedbackSchema`, `validateFeedback`, `storeLearningFeedback`,
`EVALUATION_DOMAINS`, `validateEvaluationDataset`, `evaluateDataset`,
`validateEvaluationRecord`, `exportTrainingData`, `validateTrainingExport`,
`trainOfflineCandidate`, `trainCuratedCandidate`, and `EvaluatedModelUpdates`.
Public types: `FeedbackRecord`, `EvaluationDomain`, `EvaluationCase`,
`EvaluationObservation`, `EvaluationRecord`, `CuratedTrainingRow`,
`ModelConfigurationVersion`. Validators implement closed runtime contracts.
Imported evaluation records are data, never authorization for an update.

Curated exports require explicit host selection and exclude rejected feedback.
Offline training accepts numeric rows supported by NeuralNet and clones the
serialized model before training. This performs real training; storing feedback
does not update weights. Training remains synchronous and requires host worker
isolation for responsive cancellation. Serialized inference models are not exact
optimizer checkpoints.
`trainCuratedCandidate` requires nonempty training and held-out exports with no
shared feedback IDs or numeric inputs. It rejects nonnumeric or dimensionally
incompatible rows. Held-out rows are returned separately and never passed to
training. Callers must evaluate the candidate against independent held-out
expectations before proposing activation. The lower-level `trainOfflineCandidate`
remains available for explicit compatible numeric training. `weightsUpdated`
compares actual parameters, including correctly reporting false for zero-gradient
training. No activation happens implicitly after either training function.

The model/config owner evaluates baseline and candidate on the same dataset,
requires every candidate expectation to pass, then requires explicit host approval.
It retains up to 16 immutable rollback versions in memory. Rollback also requires
approval. This is not a durable deployment or process-restart mechanism.

Validation: **437 tests passed**, including 13 learning tests; clean TypeScript/
Rollup build, portable ES2020 public consumer, type checking and ESLint passed.
Package dry run includes 106 entries and three learning declarations. Existing ML
source, digit demo and dataset are unchanged. Rollup's existing private-field-helper
warnings remain non-fatal. No remote model or live browser was required.

The review closed the initial checkpoint gaps with 12 positive/negative cases
covering actual bot routing, explicit plan validation, exact code patch generation,
measured visual comparison, authorization and scoped memory lookup. These are small
deterministic regression datasets, not general reasoning/vision quality benchmarks.
Additional tests cover report corruption, evaluator exceptions, timeout/cancellation,
verified feedback security, numeric export validation, held-out overlap, unchanged
active weights, failed candidate evaluation, denied approval, concurrent rollback,
cancelled approval and restoration of both model/configuration snapshots.

Limits: host-configured authentication, verification, curation and evaluators remain
trusted. The generic model/configuration owner manages snapshots, not a live provider
deployment; the host must construct its runtime from `active`. Approval hooks must
connect to the host's authorization UI; they must not be exposed as model tools.
Rollback is in-memory (16 versions), not durable crash recovery. Training is CPU-only
and synchronous, not automatic feedback learning or LLM fine-tuning. Latency depends
on runtime load. No later phase started or package published.

## Follow-up code review — 2026-10-28

Two P2 validation defects were reproduced with failing tests and corrected:

- Imported evaluation reports accepted security/routing rates that contradicted
  their own outcomes. Domain rates are now recomputed from case domains and
  outcome flags; null is accepted only for absent domains. Impossible confusion
  counts and completion/invalid-output bounds also reject. Imported reports still
  cannot authorize activation; the model owner generates its own evaluation.
- Curated training checked held-out label dimensions and finiteness but not
  classification semantics. Binary labels outside [0, 1] and multiclass labels
  not summing to one are now rejected in both splits before training starts.
  Validation matches the existing engine's 1e-6 sum tolerance and permits soft
  labels. Regression targets remain unrestricted finite numbers.

Four added regression tests cover these failures, absent-domain metrics and valid
soft classification/regression labels. **441 tests pass**, including 17 learning
tests, with zero failures/cancellations/skips. Clean TypeScript/Rollup build,
ES2020 public consumer checks, ESLint, package dry run (106 entries) and whitespace
checks pass. Existing ML/demo source and dataset are unchanged; dataset SHA-256:
`D76F8820EACA279A14BE7FF62AF07BD4FB8DDDFDD4CCBA9855E6E620BFE200D9`.

This review changed `src/learning/index.ts`, `src/learning/training.ts`,
`tests/learning.test.mjs`, this guide and `docs/SHIVAX_PHASES.md`. Architecture and
public signatures are unchanged. No further reproducible issue was found in this
pass. Imported aggregate counts without underlying observations cannot establish
the truth of external evaluations; host evaluators remain trusted. The existing
in-memory rollback and cooperative cancellation limitations still apply.

## SARASWATI additions (new in 0.3.0)

The 0.2.0 APIs above are unchanged. SARASWATI - The Intelligence & Learning
Release adds:

- [Feedback provenance and dataset governance](learning-governance.md) (S01):
  `createGovernedFeedback`, `createReviewAttestor`, `curateDataset`,
  `verifyCuratedDataset`, `checkPartitionLeakage`, `traceDatasetLineage`.
- [Reproducible benchmarks](learning-benchmarks.md) (S02): `createBenchmarkSuite`,
  `runBenchmark`, `validateBenchmarkReport`, `compareBenchmarkReports`,
  `assessBenchmarkCandidate`.
- [Worker training](learning-worker-training.md) (S03, Node only):
  `trainOfflineCandidateInWorker`, `trainCuratedCandidateInWorker`,
  `WorkerTrainingPool`.
- [Durable model registry](learning-registry.md) (S04): `createModelRegistry`,
  `openModelRegistry`, `InMemoryModelRegistryStore`.
- [Shadow routing](learning-routing.md) (S05): `createRoutingAdvisor`,
  `runRoutingShadow`, `evaluateRoutingQuality`, `RoutingPolicySwitch`.
- [Memory ranking](memory-ranking.md) (S06): `MemoryRanker`,
  `createHashingEmbeddings`, `evaluateMemoryRetrieval`.

Learning stays controlled. Unverified feedback never trains. Training never
activates. Activation needs evidence and human approval. SARASWATI does not
fine-tune large language models.
