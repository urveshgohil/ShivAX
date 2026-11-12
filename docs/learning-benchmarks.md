# Reproducible benchmarks (SARASWATI S02)

`shivax/learning` (and the root `shivax` entry) adds a versioned benchmark engine on
top of the 0.2.0 evaluation APIs. `evaluateDataset`, `validateEvaluationDataset`,
`validateEvaluationRecord`, `EVALUATION_DOMAINS` and `EvaluatedModelUpdates` are
unchanged. Source: `src/learning/benchmarks.ts`. Tests:
`tests/learning-benchmarks.test.mjs`. Example: `examples/sdk/benchmark.mjs`.

## Flow

1. `createBenchmarkSuite` builds a suite and computes its dataset digest.
   `benchmarkSuiteFromEvaluationDataset` converts a v1 evaluation dataset into
   `exact` cases.
2. `runBenchmark(suite, evaluator, options)` runs one configuration (`baseline` or
   `candidate`) and returns a `BenchmarkReport`.
3. `compareBenchmarkReports(baseline, candidate, suite?)` reports the changes.
4. `assessBenchmarkCandidate({ suite, baseline, candidate, trustedEvaluators, policy?, training? })`
   applies the regression gate.
5. `checkBenchmarkReproducibility([reportA, reportB, …])` detects nondeterminism.

Eligibility is evidence, not activation. Activating a model still needs
`EvaluatedModelUpdates` (strict: every case must pass) and literal-`true` host
approval.

## Suite format (`shivax-benchmark-suite` v1)

```ts
{
  format: 'shivax-benchmark-suite', version: 1,
  id, suiteVersion,                        // benchmark identifier and version (opaque refs)
  owner: { scopeKind, scopeId },           // tenant; runs, comparisons and gates never cross it
  dataset: { id, version, digest },        // digest = SHA-256 of canonical `cases`, rechecked on every load
  seed?,                                   // fixed seed passed to the evaluator and used for sampling
  sampling?: { size },                     // fixed-seed sample; mandatory cases are always kept
  cases: [{ id, domain, input, label, provenance: { origin, ref? }, mandatory? }]   // 1..512 cases, unique ids
}
```

- **Label origin** is `human-review`, `host`, `computed` or `design`. `inferred`
  (model or heuristic) labels are rejected, because they are not ground truth.
- `provenance.ref` is an opaque reference, for example the feedback id the case
  came from. It is used for leakage checks.
- Permission `deny` and code `reject` cases are always **mandatory**. Any case can
  also set `mandatory: true`.

### Labels and observations by domain

The evaluator returns
`{ completed, valid, actual, usage?, estimatedConfidence? }`. `valid` is the host's
structured-output check.

| Domain | Label | `actual` | Pass rule | Metrics |
| --- | --- | --- | --- | --- |
| any | `{ method: 'exact', expected }` | any value | Canonical JSON equal (the v1 rule) | Counted as `scoring.exact` |
| routing | `{ botId }`, where `null` means a fallback is expected | `{ botId }` | Same bot, or `null` for a fallback | correct, misrouted, unrouted, fallback expected and correct |
| reasoning | `{ method: 'fields', fields: [{ path, equals }] }` | any value | Every path exists and equals its value | Criteria met and total |
| code | `{ outcome: 'apply', expected?, requireChecks? }` or `{ outcome: 'reject' }` | `{ outcome: 'applied' \| 'rejected', output?, checks?: { passed, total } }` | Apply: output matches and all checks pass. Reject: rejected | Valid outputs, checks, unsafe rejected and applied |
| visual | `{ issues: [ids] }` (ground-truth annotations; `[]` means no issues) | `{ issues: [{ id, evidence }] }`, evidence `computed`/`design`/`estimated`/`inferred` | No false positives or negatives | TP, FP, FN, precision, recall, evidence origin for TP and FP |
| permission | `{ decision: 'allow' \| 'deny' }` | `{ decision }` | Same decision | Deny cases, denials held, violations, over-denials |
| memory | `{ relevant: [ids], k, scope }` | `{ results: [{ id, scopeKind, scopeId }] }`, ranked | All relevant ids within the top `k`, nothing outside `scope`, and nothing returned when `relevant` is empty | Hits within K, recall@K, precision@K, MRR, scope violations |

- A code `apply` label must have `expected` or `requireChecks: true`. Fluent output
  is never treated as correct.
- **Security violations** are: allowing a `deny` case, applying a `reject` case,
  and returning a memory result outside the label scope. They fail the case,
  whatever else the case reports.

## Running

```ts
runBenchmark(suite, evaluator, {
  owner,                                                     // must equal suite.owner
  configuration: { role: 'baseline' | 'candidate', id, version, value? },   // value is digested into the report
  signal,
  timeoutMs?,         // whole run: default 300 000, max 3 600 000. Exceeding it rejects the run
  caseTimeoutMs?,     // each case: default 30 000, max 300 000. Exceeding it fails the case as `timeout`
  training?,          // v1 training exports; any overlap with case inputs or provenance refs rejects the run
  now?,               // host clock for `ranAt`
})
```

- The evaluator is trusted host code `{ id, version, kind, evaluate(request) }`.
  `kind` is `deterministic`, `fixture` or `model-judge`.
- The `request` holds `caseId`, `domain`, `input`, `seed`, `configuration` and a
  per-case `signal`. **It never contains the label.**
- Cases run one after another, in suite order.
- Cancellation, or passing the run deadline, rejects the run, so a partial report
  never exists.
- An evaluator that ignores its signal can keep running in the background after
  its case times out. The host owns its resources.

## Report format (`shivax-benchmark-report` v1)

```ts
{
  format, version: 1, benchmark: { id, suiteVersion, schemaVersion: 1 }, dataset, owner,
  evaluator: { id, version, kind, groundTruth },  // groundTruth is false exactly for model-judge
  configuration: { role, id, version, digest }, seed, sampled, ranAt,
  cases: [{ id, domain, scoring, security, mandatory, passed, category, completed, valid, score, latencyMs, usage, estimatedConfidence }],
  summary: { total, passed, failed, passRate, mandatory, securityViolations, scoring, errors, domains, latency, usage, estimatedConfidence },
  trust: 'untrusted', logicalDigest, digest
}
```

- **Error categories:** `mismatch`, `invalid-output`, `incomplete`,
  `invalid-observation`, `evaluator-error`, `timeout`, `security-violation`.
  Exception text is never stored.
- **Latency:** count, min, max, mean, and p50/p90/p95/p99 (nearest rank), overall
  and per domain. These are measured values; they are not expected to repeat.
- **Usage:** totals include only cases whose usage the host marked `verified`
  with every number reported. `complete` is true only when all cases qualify.
  Cost is summed with the exact decimal arithmetic the model router uses.
- **`estimatedConfidence`** (the model's self-estimate) is summarised separately
  and is never used for pass or fail.
- **`logicalDigest`** covers everything except `ranAt` and latency. Two runs of the
  same suite, seed, configuration and deterministic evaluator have the same
  logical digest. **`digest`** covers the whole report. Both are integrity checks,
  not signatures.

## Validation

`validateBenchmarkReport(report, suite?)` rejects:

- unknown keys and wrong versions;
- duplicated case ids;
- scores that contradict their pass flag or category;
- security or mandatory flags that do not follow from the score;
- a run failure that claims measured data;
- any summary number that differs from the value recomputed from the cases
  (forged totals and rates);
- digests that do not match;
- a `model-judge` evaluator presented as ground truth.

With `suite`, it also requires:

- the same benchmark id, suite version, dataset digest, owner, seed and sampling;
- exactly the selected cases, in order;
- label-derived facts that match the suite (expected decision, unsafe flag,
  number of labelled issues, `k`, number of relevant ids), with code cases
  re-judged using the suite's `requireChecks`.

## Gate

`assessBenchmarkCandidate` throws on any invalid, forged, cross-tenant or
mismatched input. Otherwise it returns `{ eligible, reasons, policy, comparison, activation: 'requires-host-approval' }`.

These reasons always apply, whatever the policy says:

- `untrusted-evaluator`: the evaluator's `{ id, version }` is not in the host's
  `trustedEvaluators` list.
- `not-ground-truth`: the evaluator is a `model-judge`.
- `dataset-leakage`
- `unevaluated-cases`: a case timed out, errored, was invalid or did not complete.
- `mandatory-case-failed`
- `security-violation`
- `security-regression`: a mandatory case passed in the baseline and fails in the
  candidate.

Policy-driven reasons (`shivax-benchmark-policy` v1):

| Field | Reason when exceeded |
| --- | --- |
| `minimumPassRate: { overall?, routing?, … }` | `below-minimum`, or `domain-not-evaluated` if the suite has no cases in that domain |
| `maxRegression: { … }` | `regression`. Unlisted scopes default to 0 |
| `maxLatencyP95Ms` | `latency-limit` |
| `maxCostUSD` | `cost-limit` |
| `maxTotalTokens` | `token-limit` |
| `requireVerifiedUsage`, and any cost or token limit | `usage-unverified` when verified usage is incomplete |

The default `STRICT_BENCHMARK_POLICY` (`shivax-strict-v1`) requires an overall
pass rate of 1 and no regression, which matches the existing strict promotion
rule. Lowering it needs an explicit, versioned host policy.

## Limits

- 512 cases per suite.
- 64 KiB per case and per observation.
- 1 MiB per suite and per report.
- Labels: 16 reasoning criteria with paths up to 16 deep; 256 visual issues;
  memory `k` up to 100.
- 64 trusted evaluators and 16 training exports.
