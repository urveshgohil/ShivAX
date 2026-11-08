# SARASWATI S02 — Reproducible evaluation and benchmark engine

| Field | Value |
| --- | --- |
| Phase | S02, run against the S02 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S02 |
| Repository | ShivAX only. Inspectra and Visynq not touched |
| Branch / base | `feat/saraswati-v0.3.0`, base `4d0a372`, on top of the uncommitted, partly staged S01 work. Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisite | S01 **PASS** (`docs/audits/saraswati-s01.md`). Re-verified before S02 started: `pnpm lint` exit 0, `pnpm test` **811/811** |
| Acceptance gate | **PASS** |

## 1. Inspection (step 1)

Read before editing:

- `docs/audits/saraswati-s00.md`, `docs/audits/saraswati-s01.md`
- `src/learning/{index,training,updates,provenance,datasets}.ts`
- `src/intelligence/{types,cost,validation}.ts` (usage and exact cost arithmetic)
- `src/agents/validation.ts`, `src/agents/registry.ts`
- `src/memory/{engine,types,services}.ts` (retrieval shape)
- `src/visual/{types,analysis}` (computed, design, estimated and inferred evidence vocabulary)
- `tests/learning.test.mjs`, `tests/learning-governance.test.mjs`, `tests/fixtures/learning-cases.mjs`
- `docs/learning-evaluation.md`
- `scripts/check-sdk-package.mjs`, `rollup.config.mjs`, `package.json`

RUDRA (`src/agents/rudra/`) was not modified; routing cases use the existing
`BotRegistry.findByCapability`.

| Existing API | Behaviour found | S02 treatment |
| --- | --- | --- |
| `EVALUATION_DOMAINS` | Six domains | Reused as the benchmark domain set. Unchanged |
| `validateEvaluationDataset` | 1–256 cases, unique ids, `expected` is any JSON | Unchanged. `benchmarkSuiteFromEvaluationDataset` builds on it, converting each v1 case into an `exact` benchmark case |
| `evaluateDataset` | Exact canonical match only. One run-wide deadline. No dataset hash, seed, version or per-domain scoring | Unchanged. Its exact rule survives as the `exact` label method, reported separately from domain scoring |
| `validateEvaluationRecord` | Recomputes accuracy and domain rates. No digest | Unchanged. The new report validator follows the same idea for every metric and adds digests |
| `EvaluatedModelUpdates` | Strict: candidate accuracy, completion and validity must all be 1, plus literal-`true` approval | **Unchanged.** It is still the only activation path; S02 never activates |

## 2. Public APIs added (additive `export *` in `shivax` and `shivax/learning`)

| Area | Exports |
| --- | --- |
| Constants | `BENCHMARK_LIMITS`, `BENCHMARK_LABEL_ORIGINS`, `BENCHMARK_EVALUATOR_KINDS`, `BENCHMARK_ERROR_CATEGORIES`, `VISUAL_EVIDENCE_ORIGINS`, `BENCHMARK_GATE_REASONS`, `STRICT_BENCHMARK_POLICY` |
| Suites | `createBenchmarkSuite`, `validateBenchmarkSuite`, `benchmarkSuiteFromEvaluationDataset`, `selectBenchmarkCases`, `checkBenchmarkLeakage` |
| Running | `runBenchmark(suite, evaluator, options)` |
| Reports | `validateBenchmarkReport(report, suite?)`, `checkBenchmarkReproducibility(reports)` |
| Comparison and gate | `compareBenchmarkReports`, `assessBenchmarkCandidate`, `validateBenchmarkPolicy` |
| Types | `BenchmarkSuite`, `BenchmarkCase`, `BenchmarkLabel`, `BenchmarkEvaluator`, `BenchmarkEvaluationRequest`, `BenchmarkObservation`, `BenchmarkUsage`, `BenchmarkRunOptions`, `BenchmarkReport`, `BenchmarkCaseResult`, `BenchmarkCaseScore`, `BenchmarkSummary`, `BenchmarkDomainMetrics`, `BenchmarkLatency`, `BenchmarkComparison`, `BenchmarkPolicy`, `BenchmarkAssessment`, `BenchmarkLeak`, and the enum types |

No existing export, signature or behaviour changed. No new runtime dependency
was added. SHA-256 uses Web Crypto through the S01 `digestLearningValue`; cost
sums use the model router's exact `costUnits` and `costUSD`.

## 3. Files

| File | Status |
| --- | --- |
| `src/learning/benchmarks.ts` | New: the engine |
| `src/sdk/learning.ts`, `src/index.ts` | One additive `export *` line each |
| `tests/learning-benchmarks.test.mjs` | New: 18 tests (B1–B18) |
| `tests/fixtures/benchmark-suite.mjs` | New: offline 13-case suite and a deterministic mock system |
| `examples/sdk/benchmark.mjs` | New: offline benchmark example that prints summary JSON |
| `examples/sdk/README.md`, `docs/sdk.md` | One row added and one row extended |
| `package.json` | `files` gains `examples/sdk/benchmark.mjs`. No dependency or script change |
| `scripts/check-sdk-package.mjs` | Runs `benchmark.mjs` from the packed install (6 offline examples, was 5) |
| `docs/learning-benchmarks.md` | New: full format and gate specification |
| `CHANGELOG.md` | `[Unreleased]` → Added |
| `docs/audits/saraswati-s02.md` | New (this file) |

**Unchanged.** `git diff HEAD` is empty for:

- `src/security/`, `src/agents/` (including `rudra/`), `src/memory/`,
  `src/intelligence/`, `src/nn/`, `src/core/`, `src/bots/`;
- `src/learning/index.ts`, `training.ts`, `updates.ts`;
- `tests/learning.test.mjs`.

The S01 files (`provenance.ts`, `datasets.ts`, the governance tests and the
fixture) have an empty working-tree diff against the index, so S02 did not
touch them.

## 4. Benchmark format

Full specification: `docs/learning-benchmarks.md`.

- **Suite (`shivax-benchmark-suite` v1):**
  - benchmark `id` and `suiteVersion`;
  - tenant `owner`;
  - `dataset { id, version, digest }`, where the digest is SHA-256 of the
    canonical cases and is recomputed on every load;
  - optional fixed `seed` and `sampling { size }`. The fixed-seed sample always
    keeps mandatory cases;
  - 1–512 cases, each `{ id, domain, input, label, provenance: { origin, ref? }, mandatory? }`.
    Label origin must be `human-review`, `host`, `computed` or `design`;
    `inferred` is rejected.
- **Evaluator:** host-supplied `{ id, version, kind: 'deterministic' | 'fixture' | 'model-judge', evaluate }`.
  It receives `caseId`, `domain`, `input`, `seed`, the configuration identity and
  a per-case signal, but never the label.
- **Run options:**
  - `owner`, which must equal the suite owner;
  - `configuration { role: 'baseline' | 'candidate', id, version, value? }`.
    `value` is digested into the report;
  - `signal`;
  - `timeoutMs`: default 300 s, maximum 1 h. Exceeding it rejects the run;
  - `caseTimeoutMs`: default 30 s, maximum 300 s. Exceeding it fails the case as
    `timeout`;
  - `training` (leakage check);
  - `now`.
- **Report (`shivax-benchmark-report` v1):**
  - benchmark id, suite version and schema version 1;
  - dataset id, version and digest; owner;
  - evaluator `{ id, version, kind, groundTruth }`. `groundTruth` is false
    exactly for `model-judge`;
  - configuration `{ role, id, version, digest }`; seed; whether it was sampled;
    `ranAt`;
  - per-case results: scoring kind, security and mandatory flags, passed,
    category, completed, valid, a domain score, latency, usage and estimated
    confidence;
  - the summary;
  - `trust: 'untrusted'`, `logicalDigest` (everything except timing) and
    `digest`.

## 5. Supported metrics

| Domain | Scoring (case passes when …) | Metrics |
| --- | --- | --- |
| routing | The expected specialist is selected; `null` label means a fallback is expected | correct, misrouted (including a missed fallback), unrouted, fallback expected and correct |
| reasoning | Every verified field criterion holds (or the exact rule) | criteria met and total |
| code | Apply: output equals the expected output and all host checks pass. Reject: the unsafe change is rejected | valid outputs, checks passed and total, unsafe cases rejected and applied |
| visual | No false positives or negatives against ground-truth annotations | TP, FP, FN, precision, recall, evidence origin (computed, design, estimated, inferred) separately for TP and FP |
| permission | Same decision; `deny` cases are mandatory | deny and allow cases, denials held, violations, over-denials |
| memory | All relevant ids within top K, no out-of-scope results, nothing returned when nothing is relevant | hits within K, recall@K, precision@K, MRR, scope violations |

Across all domains the report has:

- total, passed and failed counts and the pass rate;
- per-domain pass rates;
- mandatory totals and security violations;
- the split between `exact` and domain scoring;
- error categories: `mismatch`, `invalid-output`, `incomplete`,
  `invalid-observation`, `evaluator-error`, `timeout`, `security-violation`;
- latency distributions (count, min, max, mean, p50/p90/p95/p99) overall and per
  domain;
- verified token and cost totals. Only host-`verified` usage with all numbers is
  counted, and `complete` says whether every case qualified;
- model-estimated confidence, reported separately and never scored;
- baseline-to-candidate changes: overall and per-domain deltas, fixed and
  regressed cases, security regressions, latency deltas, and token and cost
  deltas (only when usage is complete on both sides).

Every number is computed from actual observations; none is supplied or estimated
by the library. Fluent text never counts as correct: reasoning needs structured
criteria (test B12), and a code `apply` label must name an expected output or
required checks (B3).

## 6. Thresholds and integrity (steps 5 and 6)

**Gate (`assessBenchmarkCandidate`).** These reasons apply whatever the policy
says:

- `untrusted-evaluator`: the evaluator is not in the host's allowlist of
  `{ id, version }`;
- `not-ground-truth` (model judge);
- `dataset-leakage`;
- `unevaluated-cases`;
- `mandatory-case-failed`;
- `security-violation`;
- `security-regression`.

Configurable through a versioned `BenchmarkPolicy`: minimum pass rates overall
and per domain (`domain-not-evaluated` when a threshold names an empty domain),
maximum regression (default 0 for every scope), p95 latency, cost, tokens, and
required verified usage.

The default `STRICT_BENCHMARK_POLICY` (`shivax-strict-v1`) requires an overall
pass rate of 1 and no regression, matching the existing promotion rule. Test B7
shows the most permissive policy still cannot pass a security regression.
Eligibility returns `activation: 'requires-host-approval'` and never activates
anything; `EvaluatedModelUpdates` is unchanged.

**What is rejected:**

| Prompt item | Where |
| --- | --- |
| Forged summary totals | The summary is recomputed from the cases and compared exactly (B8: rates, counts, precision, cost, latency, extra keys) |
| Invalid case counts | Closed per-domain score schemas; TP + FN = labelled; evidence sums; reciprocal rank must be 1/r; RUN failures cannot claim measurements (B8) |
| Duplicated test ids | Suite and report (B3, B8) |
| Missing labels | Suite validation (B3) |
| Cross-tenant datasets | The run owner must equal the suite owner; comparisons and gates require the same owner (B11) |
| Untrusted evaluator results as ground truth | `groundTruth` must equal `kind !== 'model-judge'` (B8); allowlist and `not-ground-truth` in the gate (B12) |
| Inconsistent benchmark versions | Comparison, reproducibility and the gate require the same benchmark, suite version, dataset digest, evaluator, seed and case list; reports are re-checked against the suite (B4, B9, B11) |

## 7. Test results (steps 7 and 8)

| Command | Result |
| --- | --- |
| `pnpm lint` (`tsc --noEmit && eslint .`) | **exit 0** |
| `pnpm test` (build + `node --test tests/*.test.mjs`) | **829 tests, 829 pass**, 0 fail, cancelled, skipped or todo. 811 existing + 18 new |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports pass; declarations for 12 entries in 5 modes; **464 packaged files** (was 460); 8 documented example files present; **6 offline examples ran** from the packed install, including `benchmark.mjs` |
| `node --test tests/learning-benchmarks.test.mjs` | 18/18 |
| `node examples/sdk/benchmark.mjs` | exit 0; prints summary JSON with `eligible: true` and `reproducible: true` |

| Prompt test | Test |
| --- | --- |
| Same dataset and seed | B1 (and B17 with real ShivAX components) |
| Identical logical output across runs | B1: same `logicalDigest`, cases and summary without timing; `checkBenchmarkReproducibility` true |
| Baseline vs candidate comparison | B2 |
| Invalid labels | B3 (19 invalid shapes and origins) |
| Missing cases | B4 (including a fully re-digested 12-case forgery that only the suite check catches) |
| Dataset leakage | B5 (by input and by provenance reference; run rejected; gate reason) |
| Timeout and cancellation | B6 (case timeout fails closed, abort reaches the evaluator, run deadline, abort before start and during the run, invalid limits) |
| Permission regression detection | B7 (plus unsafe code and memory scope leaks; over-denial is not a violation) |
| Corrupt benchmark reports | B8 |
| Additional | B9 nondeterminism; B10 domain metrics; B11 cross-tenant; B12 trust and confidence; B13 fail-closed observations without leaking exception text; B14 verified usage and cost; B15 versioned thresholds; B16 sampling; B17 v1 compatibility, real components and the seven bot ids; B18 no mutation, frozen reports, no activation |

**Failures seen during development:**

- **B2, B4, B8 (first run, test-side mistakes):**
  - B2 expected a routing `below-minimum` that the strict policy does not set.
  - B4 and B8 expected digest or suite errors where the summary check, which
    runs first, correctly rejected the input. Editing latency or order changes
    the recomputed summary.
- **Library:** one compile error (a literal-typed default parameter) and one
  pre-test review fix. Summed cost could exceed the per-value range of
  `costUnits`, so the gate now sums exact per-case units.
- No production defect was found by the tests.

## 8. Known limitations

1. **The evaluator is trusted code.** The library validates what the evaluator
   returns, but cannot tell whether a host evaluator observed truthfully. That
   is why trust is an explicit allowlist of `{ id, version }`.
2. **Integrity, not authenticity.** Report and suite digests are SHA-256, not
   signatures, so anyone who can write report storage can re-digest a
   consistent forgery. The suite check catches label and coverage mismatches,
   but not a fabricated observation that matches the labels. Gating should use
   reports the host produced itself; signing is planned for S04.
3. **Latency is measured, not reproducible.** It is excluded from the logical
   digest. The mean depends on case order, which is why reordered reports fail
   validation.
4. **No preemption.** Cases run one after another. A case timeout does not stop
   an evaluator that ignores its signal; it can keep consuming resources in the
   background.
5. **Visual scoring matches ground-truth issue ids.** Mapping detector findings
   to annotation ids (for example, Inspectra fingerprints) is host work; I01
   should define it. Precision and recall are only computed from annotated
   cases.
6. **Memory scoring uses ids and scopes reported by the evaluator.** Retrieval
   relevance metrics beyond top-K hits, recall@K, precision@K and MRR (for
   example nDCG or graded relevance) are left to S06.
7. **Exact-labelled cases are never security cases.** A converted v1 permission
   case needs a domain `decision` label to become a mandatory denial.
8. **Limits:** 512 cases per suite; 64 KiB per case and observation; 1 MiB per
   suite and report. Large benchmarks must be split into several suites.
9. **Not part of this phase:** eligibility does not feed a durable registry
   (S04); no shadow routing (S05). S00/S01 open items are unchanged:
   - P0-1, the peer-range `ERESOLVE` (H01);
   - stale "0.2.0 not published" text;
   - the `vishwakarm` spelling in the roadmap's universal rules (the bot id is
     `vishwakarma`).

## 9. Phase acceptance

| Gate | Status |
| --- | --- |
| Roadmap gate: two identical deterministic fixture runs produce the same logical results (except timing) | **PASS** (B1, B17) |
| Roadmap gate: corrupt reports fail validation | **PASS** (B4, B8) |
| Six domains with domain-specific scoring; no fluency-as-correctness | **PASS** (B10, B12, B3) |
| Measured metrics only; confidence separated; verified usage and cost only | **PASS** (B12, B14) |
| Security denial cases cannot regress; strict promotion preserved; unsafe or unevaluated candidates are never eligible | **PASS** (B6, B7, B15; `EvaluatedModelUpdates` unchanged) |
| Integrity rejections (forged totals, counts, duplicates, missing labels, cross-tenant, untrusted ground truth, inconsistent versions) | **PASS** (B3, B4, B8, B11, B12) |
| v0.2.0 APIs, NARASIMHA firewall, Jay and Vijay, RUDRA, seven bot ids, S01 governance unchanged | **PASS** (empty diffs; 811 existing tests pass) |
| No new bots, no Playwright, no new dependencies, no training or activation, no publish, push or tag | **PASS** |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package` | **PASS** |

**S02: PASS.** S03 has not started.
