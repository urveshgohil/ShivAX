# SARASWATI S08: three-repository end-to-end integration (SHIVAX → Inspectra → Visynq)

| Field | Value |
| --- | --- |
| Phase | S08, run against the S08 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S08 |
| Repositories | SHIVAX `feat/saraswati-v0.3.0` @ `5ec8084` · Inspectra `feat/learning-feedback` @ `b291e05` · Visynq `feat/learning-feedback` @ `6e17608` |
| Prerequisites | S01–S07 **PASS** (S07 audit). I01 **PASS** (Inspectra audit). I02 **PASS**, with its trusted host missing by design (Visynq audit §7–8); S08 supplies a test host, isolated in `tests/e2e/s08/consumer/host/` |
| Environment | 2026-11-09 · Windows 11 Pro 10.0.26300 x64 · Node 22.23.2 / 24.22.2 / 26.13.0 (nvm-windows) · npm 10.9.8 / 11.19.1 / 11.20.0 · pnpm 12.8.1 · Playwright 1.64.1 (Chromium 1248) · TypeScript 7.0.2 |
| Harness | `node tests/e2e/s08/run.mjs` (new). Raw results: [`saraswati-s08-results.json`](saraswati-s08-results.json) |
| Release | Nothing versioned, tagged, committed, pushed or published. Inspectra and Visynq working trees untouched |
| Gate | **PASS for S08**, one real end-to-end training approval flow on offline fixtures, on three Node versions. **Not production-ready**: 7 release blockers in §9 |

## 1. What was built

The S08 harness was written under `tests/e2e/s08/` for this run only. It was never committed, was not part of `pnpm test` or the package, and was removed from the working tree afterwards. The commands below record how this run was made.

| Path | Purpose |
| --- | --- |
| `run.mjs` | Orchestrator. Packs SHIVAX and Inspectra from staged copies (no hard-link entries, I01 §2.3). Creates fresh consumer projects in a temp directory and installs only from tarballs. Runs every suite under each Node binary, starts the trusted host as a separate process, and parses real pass/fail counts from TAP and Vitest JSON |
| `consumer/fixtures/ui.mjs` | Deterministic offline fixtures: 16 labelled URL pairs with ground truth, a mocked Figma REST boundary, and Inspectra's PNG screenshot with injected (not OCR) observations. The fixture-reviewer policy is here |
| `consumer/host/trusted-host.mjs` | S08 trusted learning host (test host). It covers: session table; evidence store; review journal; consent store; Chitragupt storage via RUDRA and Vijay; NARASIMHA firewall; two S04 registries on a file store; routing switch; Visynq `LearningHost` contract |
| `consumer/host/server.mjs` | HTTP transport for the host, bound to 127.0.0.1. Accepts only its own session cookie; any `Authorization` header is refused |
| `consumer/host/file-store.mjs` | Host-owned durable `ModelRegistryStore`: content-addressed objects with temp file + rename, and a head compare-and-swap under a lock file |
| `consumer/host/features.mjs` | Host feature extraction for the finding-triage model (§4.4) |
| `consumer/s08/*.test.mjs` | Packaging (step 1), capture (steps 2.1–2.2, 3), and lifecycle and security (steps 2.5–2.15, 4) suites |
| `visynq/*` | Visynq HTTP `LearningHostClient` transport and the UI test (steps 2.3–2.5) |
| `standalone/no-inspectra.test.mjs` | SHIVAX alone, without Inspectra (step 5) |

## 2. Packages and versions

| Package | Source | Tarball | Entries | Packed / unpacked | sha256 |
| --- | --- | --- | --- | --- | --- |
| `shivax` | `5ec8084` + rebuilt `dist/` (no source change) | `shivax-0.2.0.tgz` | 509 | 687,753 / 3,151,986 B | `215f8270…8f90ee6` |
| `inspectra-engine` | `b291e05` | `inspectra-engine-1.1.0.tgz` | 47 | 139,045 / 475,294 B | `96b3db60…acd002a` |
| `visynq-workstation` | `6e17608` (private app, not packed) | isolated copy | – | – | – |
| `shivax` (proposed shape) | the same tarball, manifest only: `version` 0.3.0, peer `inspectra-engine: ^1.0.4` | repacked | 509 | – | – |

Both tarballs passed the link-entry check: 0 hard or symbolic link entries.

**Labels are not release versions.** The SHIVAX candidate is still labelled 0.2.0, the same as the published 0.2.0 but with different contents. The Inspectra candidate is labelled 1.1.0, the same as the published 1.1.0 but with the I01 `./feedback` export added. Both are §9 blockers.

## 3. Dependency graph

```text
visynq-workstation 1.0.0 (private)
├── inspectra-engine ^1.1.0 ──────────► candidate tarball 1.1.0
│     ├── shivax "^0.2.0 || ^0.3.0" ──► candidate tarball (one shared copy, pnpm override)
│     ├── playwright ^1.64.1, @axe-core/playwright, lighthouse, cspell
├── shivax  (NOT declared in the repo; resolved via ../shivax/dist aliases) ── harness adds it: same tarball
└── react 19, react-router-dom 7, vite 7, vitest 5, tailwind 4 (dev)

shivax 0.2.0-labelled candidate
└── peerOptional inspectra-engine "1.0.4"  ✗ excludes 1.1.0 (installed) and 1.2.0 (I01 recommendation)
```

**Range evaluation** (npm's `semver`, recorded by the harness):

| Range | 0.1.2 | 0.2.0 | 0.3.0 | 0.3.4 | 0.4.0 | 1.1.0 | 1.2.0 | 2.0.0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inspectra `shivax: ^0.2.0 \|\| ^0.3.0` | ✗ | ✓ | ✓ | ✓ | ✗ | | | |
| SHIVAX peer `inspectra-engine: 1.0.4` | | | | | | **✗** | **✗** | ✗ |
| Proposed SHIVAX peer `^1.0.4` | | | | | | ✓ | ✓ | ✗ |
| Visynq `inspectra-engine: ^1.1.0` | | | | | | ✓ | ✓ | ✗ |

**Engines.** SHIVAX needs `node >=22`; Inspectra and Visynq need `>=22.15`. All three tested Node versions satisfy them.

## 4. Step 2: end-to-end flow (identical on Node 22, 24 and 26)

| # | Step | Evidence |
| --- | --- | --- |
| 1–2 | Inspectra captures reference and target and detects a labelled difference | Primary pair `font-h1-up`: `typography.fontSize`, expected 32 / actual 40, both sides `computed` evidence. Persisted `report.json` equals the result and `analyzeUI` |
| 3 | Visynq displays the finding and its evidence | Isolated Visynq copy. The real report is imported through Visynq's own `parseReport`. The issue page shows the heading, measurements, fingerprint and a provenance table with every row `computed` |
| 4 | Reviewer marks the finding **Correct** | Through the UI with `user-event`: Correct, severity `high`, notes, Submit. The HTTP command is exactly `{reportRef, issueId, decision, correction, notes, expectedPolicyVersion}` with no reviewer, role, status or approval field. The UI shows "Proposal recorded: correct, revision 1. Pending host verification." |
| 5 | Trusted host verifies reviewer authority | Separate Node process. Identity comes from the host's own session cookie, then Jay. `createReviewAttestor` checks `learning.review`, the same tenant, and that the reviewer still holds that permission in the host directory. Attestation digest goes in the review journal. Spoofs: §6 |
| 6 | SHIVAX stores scoped feedback | `storeGovernedFeedback` through RUDRA, a host bot, Vijay approval (only host-attested ids) and Chitragupt `verified-outcome` memory (file-persisted). A new process reopens it: correction `{severity:'high', basis:'reviewer'}`; notes stay in the journal, not the label; 0 records in the other tenant |
| 7 | Curator selects eligible records | 49 fixture reviews through the same host path give 43 proposed, 3 needs-review and 3 refused (§8, I-6). 44 stored labels |
| 8 | S01 curated dataset | `curateDataset` + `verifyCuratedDataset`. **23 eligible** of 44: 14 `rejected-decision`, 7 `not-selected` (6 PNG + 1 structure finding with no measurement, all `inferred`). Splits: train 17, validation 0, held-out 6. No partition leakage. Order-independent digest |
| 9 | S02 evaluates baseline and candidate | Strict policy `shivax-strict-v1`; trusted evaluator `s08-triage-evaluator`; §5 |
| 10 | S03 trains a compatible candidate | The raw curated split is rejected by `trainCuratedCandidate` ("incompatible with numeric training"), as it must be. The host featurizes it (§4.4), then trains with `trainCuratedCandidateInWorker` inside a firewall `workflow` operation. Result is byte-identical to synchronous training |
| 11 | S04 stores the candidate version | `register` with the dataset manifest (lineage) and `evaluate` with the train and validation splits. The registry also rejects held-out data passed as training evidence (`training-mismatch`). An untrained candidate is `rejected` (`below-minimum`, `regression`) and cannot be approved |
| 12 | Unauthorized promotion is rejected | `approve` by mallory, alice (registrant) and rhea gives `unauthorized`; gita (other tenant) gives `cross-tenant`. `activate` before approval gives `invalid-transition`. Nothing active |
| 13 | Authorized promotion only after every requirement | Evaluated and eligible; bob approves; the approver cannot activate (`unauthorized`); carol activates. `loadActive` returns v1 |
| 14 | RUDRA uses an approved policy | Default route `triage-baseline`. Routing policy p0 (deterministic) is activated first as the rollback target. p1 (`inspectra.triage` → `triage-candidate`) is **evaluated but unapproved: RUDRA still runs `triage-baseline`**. Mallory's approval is refused. After approval and activation, RUDRA runs `triage-candidate` with the S04-active model `v1`. The seven specialist bot ids are unchanged |
| 15 | Authorized rollback | Non-operators are refused rollback. Routing rolls back to p0 (RUDRA deterministic again). Model: v3 activated, then rolled back to v1 (`v3` → `rolled_back`). Firewall version and policy are byte-equal before and after. A **host restart** on the same state directory shows active v1, p0, and `verify().ok`. Audit chain: create, register, evaluate, approve, activate, register, evaluate, register, evaluate, approve, activate, rollback |

### 4.4 What was trained, and what was not

UI feedback did **not** train a language model, and nothing here implies it can. Inspectra's curated rows are `inspectra-finding` objects, which SHIVAX's CPU trainer correctly refuses. The trusted host defines an explicit model:

- **Model:** a 19-input `NeuralNet` multiclass classifier (layers `[19, 10, 3]`, seed 7) that predicts the severity a reviewer would assign to a reported finding.
- **Features:** property one-hot, reported severity, measured flag, relative magnitude (including the colour channel delta), and element role.
- **Labels:** the fixture reviewer's convention (font size → high; colour, padding and margin → low; gap, width and missing → as reported; cascaded bounds and position → reject).

That convention is fixture ground truth written for this test, not a claim about real reviewers. One held-out row had the same feature vector as a training row; it was **dropped**, so 5 held-out rows remain, and that is reported. The held-out set is small.

## 5. Benchmark results (measured; same on every Node version unless noted)

| Measure | Value |
| --- | --- |
| Inspectra URL detection vs labels (16 pairs, 36 reported findings) | TP 25 · FP 11 · FN 0 → **precision 0.694, recall 1.000**. All 11 FPs are cascades (`bounds.height@document`, `position.y`) that the labels define as not-real |
| Figma-to-URL (mocked API) | 5 findings, 3 mocked API calls, baseline evidence `design` and `estimated` (never `computed`), token absent from the report |
| PNG-to-URL (injected observations) | 9 findings, all `needs-review`; baseline evidence only `estimated`; 0 proposals reach training |
| External network requests during capture | **0** |
| Capture time | ≈ 2.5 s per URL comparison (one Chromium launch each); capture cancellation 83–87 ms, partial output removed |
| S02 suite | 9 cases: 5 held-out severity cases + 4 permission cases (3 mandatory `deny`) |
| Baseline (Inspectra-reported severity) | pass rate **0.667** (reasoning 0.4, permission 1.0) |
| Candidate v1 | pass rate **1.000** (reasoning 1.0, permission 1.0); 3 fixed, 0 regressed, 0 security regressions; eligible under `shivax-strict-v1` |
| Reproducibility | Two identical candidate runs: `checkBenchmarkReproducibility` true. Baseline logical digest `sha256:56f986e3…` is identical across Node 22, 24 and 26. Candidate digests differ **between** runs by design: the registry binding includes the registration-time version manifest |
| Evaluator latency p50 / p95 | baseline 0.013–0.016 / 0.10–0.14 ms; candidate 0.92–1.33 / 1.36–2.56 ms (includes the registry's verified artifact load) |
| Worker training (17 rows, 1,200 epochs) | wall 121–141 ms; worker startup 8–21 ms; host timer kept ticking (10–11 ticks of 5 ms); final loss 0.00035; train and held-out accuracy 1.0 (5 rows) |
| No-Inspectra packaged examples | 11/11 exit 0, 41–177 ms each |

## 6. Step 3 and step 4: source coverage and security (all passed on all three Node versions)

| Case | Result |
| --- | --- |
| URL-to-URL | §5; proposals `measured` with `computed` origins |
| Figma-to-URL (mocked) | Design-measured labels are eligible. Neither the token nor Figma hosts appear in reports or proposals (also covered by I01's `feedback.mjs`, run here against the tarball) |
| PNG-to-URL (inferred only) | Every PNG label is `inferred` and excluded by `selectMeasuredEvidence`. No PNG value is treated as a measurement |
| Spoofed reviewer | 5 identity or status fields on a command are refused (`invalid-input`); forged, expired and revoked sessions give `unauthorized`; tampered attestations give `review-unconfirmed` (30) and 0 admitted. In the UI, mallory has no submit control and the host refuses her too |
| Cross-tenant data | Another tenant's review gives `unknown-report` (no existence oracle); curation for globex excludes 30 records as `cross-tenant` (plus 14 rejects); a globex registry admin is refused; the UI blocks across tenants |
| Duplicate feedback | The host refuses the same revision (`duplicate-review`) both in-process and over HTTP from Visynq; curation drops the duplicated record (`duplicate` 1) |
| Withdrawn consent | v2 dataset 22 records (1 `consent-withdrawn`); the v1 manifest still verifies unchanged |
| Corrupt model manifest | Tampered object on a store copy: `verify().ok = false`, `loadActive` gives `checksum-mismatch`; the real store still verifies |
| Invalid evaluation report | A forged pass rate and a missing case are rejected by `validateBenchmarkReport`; a forged domain rate is rejected by `registry.evaluate`; the version stays `candidate` |
| Unapproved candidate | `activate` refused |
| Stale approval | Approval at firewall v1, then an admin policy replace to v2, then `activate` gives `stale-approval`; v1 stays active |
| Lockdown during training | Lockdown mid-job: firewall outcome `revoked`, worker `cancelled`; a new job gives `lockdown`; `activate` gives `lockdown` |
| Lockdown during provider dispatch | In-flight model call `revoked`; next call `lockdown`; provider called exactly once (no fallback) |
| Worker cancellation | `cancelled`, `liveWorkers` 0 |
| Browser capture cancellation | Abort during capture rejects; output directory removed |
| Runner token separation | The host refuses an Inspectra runner token as bearer **and** as cookie (401). The runner refuses a learning session (401) but accepts its own token (400, so auth passed: positive control) |
| Memory isolation | acme 44 / globex 0 / reviewer-session namespace 0. An unattested record stored through Chitragupt is refused by Vijay (`failed`), count unchanged |

## 7. Step 1 and step 5: packaging and compatibility

| Check | Result |
| --- | --- |
| Installed from tarballs, not links | Real copies inside each consumer; one shared `shivax` copy; no `src/` or `tests/` in installed packages |
| ESM | All 13 SHIVAX entries and all 5 Inspectra entries import |
| CJS | All 13 SHIVAX entries `require()`, with keys equal to ESM. Inspectra is ESM-only: `require()` gives `ERR_PACKAGE_PATH_NOT_EXPORTED` on 22, 24 and 26 (documented behaviour) |
| TypeScript declarations | SHIVAX alone (lib ES2022+DOM, no Node types): bundler, Node16 and NodeNext in `.ts`, `.mts` and `.cts`, all pass. SHIVAX + Inspectra: bundler, Node16 and NodeNext pass **with `@types/node` and lib ESNext**, because `inspectra-engine/node` re-exports Playwright types (I-7) |
| Optional dependency | SHIVAX keeps `inspectra-engine` an optional peer. **SHIVAX without Inspectra:** no Inspectra or Playwright installed; all 13 entries load (including `shivax/adapters/inspectra`); 7 bots unchanged; 11 packaged examples run |
| Existing Inspectra reports | Report format v1 unchanged; I01's own suites against the tarball 38/38; repo suites §8 |
| Existing Visynq scanner UI | Visynq's complete existing suite on the installed packages: **303/303** (after the I-2/I-3 patches; 218 as-is, §8) |
| Seven specialist bots | `sanjay, brihaspati, vishwakarma, chitragupt, narad, yudhishthir, ekalavy` (in E2E, standalone and SHIVAX tests) |
| NARASIMHA firewall | `firewall*.test.mjs` inside SHIVAX 897/897, plus the S08 lockdown, stale-approval and dispatch cases |
| Router cost and token fixes | `model-cost.test.mjs`, `router-audit.test.mjs`, `model-safety.test.mjs` inside SHIVAX 897/897 |

## 8. Test commands and actual counts

Run: `node tests/e2e/s08/run.mjs --keep --node <node22>,<node24>,<node26>`, 2026-11-09 05:41–06:06 UTC. Every count comes from the runner (TAP `# pass/# fail`, Vitest JSON).

| Suite (command, cwd) | Node 22.23.2 | Node 24.22.2 | Node 26.13.0 |
| --- | --- | --- | --- |
| S08 packaging `node --test s08/packaging.test.mjs` (Inspectra consumer) | 4/4 | 4/4 | 4/4 |
| S08 capture `s08/capture.test.mjs` | 4/4 | 4/4 | 4/4 |
| Inspectra I01 suites on the tarball (`feedback-adapter`, `feedback`, `shivax-adapter`, `figma`) | 38/38 | 38/38 | 38/38 |
| S08 no-Inspectra `no-inspectra.test.mjs` (SHIVAX-only project) | 4/4 | 4/4 | 4/4 |
| S08 Visynq UI `vitest run s08/` (isolated Visynq + host process) | 5/5 | 5/5 | 5/5 |
| S08 lifecycle + security `s08/lifecycle.test.mjs` (host restart) | 23/23 | 23/23 | 23/23 |
| Visynq existing suite `vitest run --exclude s08/**` (isolated copy) | 303/303 | 303/303 | 303/303 |
| Visynq `tsc -b` / `vite build` | **tsc fails** (I-4) / build ok, boundary ok | same | same |
| SHIVAX `node --test tests/*.test.mjs` (repo) | 897/897 | 897/897 | 897/897 |
| Inspectra `test:unit` / `test:feedback` / `test:security` | 24/24 · 17/17 · 45/45 | same | same |
| Inspectra `test:extraction` / `test:ui-check` | 12/12 · 55/55 | same | same |
| Inspectra `test:integration` | 72 pass, **6 fail**, 2 skip | same | same |
| **Total** (excluding the build row) | **1,511 tests: 1,503 pass, 6 fail, 2 skip** | identical | identical |

The **6 failures** are identical on all three Node versions, and they are exactly the pre-existing I01 failures:

- 5 need a local tesseract OCR engine, which is not installed;
- 1 is the packed-install test, failing on the `ERESOLVE` peer conflict (B-1).

The 2 skips are POSIX-only SIGINT tests. S08 added **40 new tests**: 4 + 4 + 4 + 5 + 23.

Not run: Inspectra's Playwright `npm test` a11y spec (targets the user's app at `localhost:4015`) and Visynq's `test:integration` live suite (pre-existing failure per I02 §6).

## 9. Integration issues found

| # | Issue | Severity | Evidence |
| --- | --- | --- | --- |
| I-1 | SHIVAX `peerOptional inspectra-engine: "1.0.4"` excludes Inspectra 1.1.x and 1.2.0 | **P0** (B-1) | Plain `npm install` of both tarballs gives `ERESOLVE` on npm 10.9.8, 11.19.1 and 11.20.0. `--legacy-peer-deps` installs but `npm ls` marks the tree **invalid**. The proposed shape (0.3.0, peer `^1.0.4`) installs plainly with a valid tree, and the I01 adapter, curation and `compare` load |
| I-2 | Visynq does not declare `shivax` and resolves `shivax/*` through `vite.config.ts` aliases and `tsconfig.json` paths to `../shivax/dist` | **P0** for any packaged build (B-3) | Isolated copy as-is: 6 of 31 test files fail to load and only 218 tests run; `tsc` cannot find modules. With the aliases removed and `shivax` declared: 303/303 |
| I-3 | Visynq **app code** `src/lib/shivax-demo.ts` imports `../../../shivax/examples/sdk/inspection-fixture.json`, which is **not in the SHIVAX package**. `learning-dashboard.test.tsx` imports `../../../shivax/dist/sdk/learning-node.esm.js` | **P0** (B-3) | No package import can reach the fixture; the harness vendored a copy for this run only. The test import maps to `shivax/learning/node` (then its `@ts-expect-error` becomes unused: 1 harness-induced tsc line) |
| I-4 | Visynq `tsc` fails against `inspectra-engine` 1.1.0 client types: 4 × TS2339 `event.error` in `src/hooks/useScan.ts:162` and `src/live/useScan.ts:159` | **P1** (B-4) | Reproduced in the **Visynq repo itself** (`tsc -p .`, 4 errors), so it predates S08; it came in with `6e17608` (`^1.1.0`). `npm run build` (`tsc -b && vite build`) therefore fails in the repo today. `vite build` alone succeeds and the server-only boundary holds |
| I-5 | Candidate labels collide with published versions (SHIVAX 0.2.0, Inspectra 1.1.0) | **P0** (B-2) | Tarball contents differ from npm |
| I-6 | Inspectra I01 refuses relationship (`*.gap`) findings with `evidence-limit` | P2 | 3 of 49 fixture reviews; asserted as the only refusals. Reviewed gap findings cannot become labels |
| I-7 | `inspectra-engine/node` declarations require `@types/node` and lib ESNext (Playwright types) | P2 | Undocumented consumer requirement; SHIVAX alone needs neither |
| I-8 | Chitragupt namespaces hold at most 128 records and 1 MiB; `MemoryEngine.list()` is paged | P1 for real volumes | 44 labels fit. A real tenant's learning-service namespace would fill quickly; the host must use `export()` (S08 host does) or shard |
| I-9 | Small, fixture-defined dataset | Limit | 23 eligible labels, 5 held-out cases. The 1.0 held-out accuracy says the pipeline works; it says nothing about real triage quality |

## 10. Remaining production blockers

1. **B-1 (SHIVAX):** widen the peer to `inspectra-engine: ^1.0.4`; tested here as the proposed shape. Then rerun Inspectra's `scripts/shivax-compat.mjs` and its `install.mjs` test.
2. **B-2 (SHIVAX, Inspectra):** S09 must bump SHIVAX to `0.3.0` (or `0.3.0-beta.1`) and Inspectra to `1.2.0` before any tarball is shared. Note: a prerelease such as `0.3.0-beta.1` does **not** satisfy Inspectra's `^0.3.0`.
3. **B-3 (Visynq):** declare `shivax` as a dependency; remove the `../shivax` aliases and paths; stop importing `../../../shivax/...` from app and test code. Either ship `examples/sdk/inspection-fixture.json` in SHIVAX `files`, or vendor it into Visynq.
4. **B-4 (Visynq):** fix the 4 `useScan.ts` type errors against `inspectra-engine` 1.1.x client types, so `npm run build` passes.
5. **B-5 (Visynq):** a production trusted learning host and authenticated transport are still missing (I02 §7). The S08 host is a test host: its session table, directory and journals are JSON files. Its attestations are integrity-bound but not signed, and authenticity rests on the host journal.
6. **B-6 (platforms):** **Linux and CI were not tested.** No WSL distribution, Docker or CI runner access existed on this machine, and nothing was pushed. `.github/workflows/package-verification.yml` covers SHIVAX only, not the three-repository flow. Run `tests/e2e/s08/run.mjs` on `ubuntu-latest` and `windows-latest` before release.
7. **B-7 (environment):** Windows Application Control on this machine blocks rollup's unsigned native addon (`ERR_DLOPEN_FAILED`), **including in the Visynq repo's own `node_modules`**. Vite and Vitest cannot start there as installed. The isolated copy used `@rollup/wasm-node@4.68.0` (the same version, the official WASM build); the policy was not changed. Production CI is unaffected, but local Visynq development on this machine needs the WASM override or a signed binary.

## 11. Environment deviations and harness-only changes

- **Visynq isolated copy only** (the repository is unchanged): tarball dependencies, a shared `shivax` override, removal of the `../shivax` aliases and paths, the two sibling-path imports (I-3), and `rollup → @rollup/wasm-node@4.68.0` because of B-7. Each change is recorded in `visynqProject.patches` and `environment` in the results JSON.
- **Inspectra consumer:** `npm install --legacy-peer-deps` for the as-shipped candidate (because of I-1). A `bin/inspectra.mjs` shim lets the copied CLI test run the **installed** package's bin. `@types/node@<major>` and `typescript@7.0.2` are added for declaration checks.
- Tesseract is not installed, so PNG coverage uses injected observations, as the S08 prompt allows for inferred evidence.
- Figma used only the mocked REST boundary; no real Figma call or token.
- No paid or remote model call; the firewall `model` operation uses an in-process mock provider.

## 12. Gate

| S08 gate | Status |
| --- | --- |
| Packed SHIVAX installed into an isolated Inspectra project; packed Inspectra into an isolated Visynq project; no linked sources | **PASS** (with I-1 `--legacy-peer-deps` and the B-3 patches recorded) |
| Ranges, ESM/CJS, declarations, optional peer, engines verified | **PASS**; I-1 and I-7 reported |
| One real end-to-end training approval flow on offline fixtures, steps 1–15 | **PASS** on Node 22, 24 and 26 |
| URL, Figma (mocked) and PNG (inferred-only) covered separately with provenance preserved | **PASS** |
| All 14 security cases | **PASS** |
| SHIVAX without Inspectra; existing reports, Visynq UI, seven bots, firewall, router cost/token preserved | **PASS** (Visynq build: I-4, pre-existing) |
| Node 22/24/26 | **PASS** (Windows only) |
| Linux / CI | **NOT TESTED** (B-6) |
| No publishing, tagging or pushing | **PASS** |

**S08: PASS.** S09 has not started.
