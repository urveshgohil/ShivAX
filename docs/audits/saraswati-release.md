# SARASWATI S09: release readiness and GO/NO-GO

| | |
| --- | --- |
| Release | SHIVAX AI 0.3.0 **SARASWATI - The Intelligence & Learning Release** |
| Branch / commit | `feat/saraswati-v0.3.0` @ `f3fbfc5` (source identical to `5ec8084`; `f3fbfc5` adds only the S08 audit files) |
| Date | 2026-11-09 |
| Machine | Windows 11 Pro 10.0.26300 x64; Node 22.23.2, npm 10.9.8, pnpm 12.8.1 |
| Prerequisites | S00–S08, I01 and I02 reports reviewed (§1). Each phase passed its own gate |
| **Decision** | **NO-GO for the tree as it stands**, because of one P0 packaging defect (§7, P0-1). **Conditional GO for `0.3.0-beta.1`** once R-1 to R-3 (§9) are done and the §3 gates pass again. Stable `0.3.0` additionally needs a passing Linux and Windows CI run |

Nothing was published, tagged, pushed or deployed. `package.json` was not changed
(it still says `0.2.0`). No dist-tag was changed and no license was touched. The
only file S09 added to the repository is this report. The S09 probes
(baseline install, candidate install, benchmark and lockdown test) live outside
the repository, as the S08 harness now does.

---

## 1. Release feature summary and phase review (step 1)

| Phase | Delivered | Gate | Carried forward |
| --- | --- | --- | --- |
| S00 architecture audit | Three-repository API map, risk register P0-1…P2-2, decisions D1–D2 | Done | P0-1 (exact Inspectra peer) **still open**; D1 hotfix 0.2.1 never made |
| S01 feedback governance | `GovernedFeedback` v1, `createReviewAttestor`, `curateDataset`, manifests, leakage checks, lineage | PASS (T1–T15) | Attestations are integrity-bound, not signed |
| S02 evaluation | `BenchmarkSuite`/`BenchmarkReport` v1, six domain scorers, `assessBenchmarkCandidate`, `STRICT_BENCHMARK_POLICY` | PASS (B1–B17) | — |
| S03 worker training | `shivax/learning/node`: `trainOfflineCandidateInWorker`, `trainCuratedCandidateInWorker`, `WorkerTrainingPool` | PASS (W1–W16) | No firewall test inside the repo suite (re-tested here, §4) |
| S04 model lifecycle | Durable `ModelRegistry`, CAS head, approvals, atomic activation, rollback, hash-chained audit | PASS (R1–R18) | Host must supply the durable store |
| S05 RUDRA shadow routing | `createRoutingAdvisor`, `runRoutingShadow`, `evaluateRoutingQuality`, `RoutingPolicySwitch` | PASS (L1–L18) | Shadow by default; activation only through S04 |
| S06 memory relevance | `MemoryRanker`, provenance, hashing embeddings, `evaluateMemoryRetrieval` | PASS (M1–M16) | Small labelled fixture (4 queries with ground truth) |
| S07 SDK packaging | Exports, 4 new offline examples, docs, migration notes | PASS | Docs still say "unreleased" (correct until release) |
| I01 Inspectra | Optional `inspectra-engine/feedback` adapter; range `shivax: ^0.2.0 \|\| ^0.3.0` | PASS for I01 | Inspectra 1.2.0 unreleased; prerelease SHIVAX does not satisfy `^0.3.0` |
| I02 Visynq | Review panel, learning dashboard, `LearningHostClient` contract | PASS for I02 | No production trusted host; live-runner suite fails (pre-existing) |
| S08 end to end | Packed three-repository flow, 15 steps, 14 security cases, Node 22/24/26 | PASS (Windows only) | B-1…B-7; harness removed from the tree after the run |

**What SARASWATI is:** governed feedback → curated dataset → reproducible
benchmark → candidate training of ShivAX's own small CPU `NeuralNet` → durable
registry with human approval, atomic activation and rollback → optional
learning-assisted routing (shadow first) and memory ranking. **What it is not:**
it does not fine-tune large language models, does not train from raw feedback,
and nothing trains, promotes or reroutes on its own.

**Unfinished requirements found in the review:**

1. S00 P0-1 and S08 B-1: the exact peer `inspectra-engine: "1.0.4"` (P0, §7).
2. S08 B-2 and I01 blocker 2: the candidate is still labelled `0.2.0`, the same
   number as the published, different `shivax@0.2.0`.
3. Stale release-state text that **ships in the tarball**: `CHANGELOG.md` 0.2.0
   ("It is not on npm yet. The latest published version is 0.1.3") and the
   `docs/release-readiness.md` header ("0.2.0 is not published"). npm shows
   0.2.0 published on 2026-11-07 (S00 P1-9, never fixed).
4. S08 B-6: no Linux run and no CI run of any SARASWATI change.
5. S08 B-3, B-4 and B-5 (Visynq): see §7.

## 2. Backward compatibility (step 2)

Method: the published `shivax@0.2.0` (integrity
`sha512-5ymc4tLS…GzX/A==`, `gitHead 776820f`) and the packed candidate were each
installed into a clean project. Then:

- **Exports:** every subpath's ESM and CommonJS keys were listed in both installs.
- **Frozen 0.2.0 tests:** the test suite at `776820f` (34 files, 708 tests),
  with its two example mocks, was run unchanged against each install.

| Item | Result | Evidence |
| --- | --- | --- |
| SDK subpath exports | **Preserved.** 0 runtime exports removed in any of the 12 subpaths, ESM or CJS. Added: root +75, `learning` +71, `memory` +3, `bots` +1 (`VishwakarmaBot`); new subpath `learning/node` (7). ESM/CJS key sets identical in all 13 | export diff |
| Seven specialist bot ids | **Changed by one, as approved.** `vishwakarm` → `vishwakarma` (S00 D2, option A, commit `4d0a372`; CHANGELOG "Breaking"). `VishwakarmBot` remains an alias. Host policies naming `vishwakarm` deny the bot (fail closed). The other six ids are unchanged | both cand-only failures below |
| RUDRA orchestration | Preserved: frozen `rudra` 32/32 and `workflows` 48/48 on both | frozen suite |
| Jay and Vijay | Preserved: `security` 38/38, `agents` 31/31 | frozen suite |
| NARASIMHA firewall | Preserved: `firewall` 66/66, `firewall-integration` 58/58, `firewall-management` 40/40, `firewall-model-integration` 60/60, `release-r10` 14/14 | frozen suite |
| Tensor and NeuralNet; training methods | Preserved: `neuralnet-core` 15/15, `slm` 25/25, `foundations` 9/9; seeded XOR model **byte-identical** (SHA-256 `2f8b9b26…`) | frozen suite; §5 |
| Model JSON format | Preserved: keys `config, format, parameters, version`; a 0.2.0 model loads in the candidate and the reverse, with identical predictions and identical re-serialisation | §5 |
| ModelRouter APIs and exact cost accounting | Preserved: `model-cost` 38/38; identical budget outcome (§5) | frozen suite |
| Terminal token-limit violations | Preserved: `model-safety` 42/42; overrun is terminal with no fallback on both (§5) | frozen suite |
| MemoryEngine APIs | Preserved: `memory` 51/51; S06 M1 | frozen suite |

**Frozen 0.2.0 suite totals:**

| | Tests | Pass | Fail |
| --- | --- | --- | --- |
| Published 0.2.0 | 708 | 693 | 15 |
| Candidate | 708 | 691 | 17 |

The 15 shared failures are environmental and identical on both installs. They
are tests that read repository-only files: `../package.json`, `rollup.config.mjs`,
the digit playground, `../adapters/...`, or an installed Inspectra. The 2
candidate-only failures are both the rename: `specialists` expects
`'vishwakarm'`, and the `learning` contract fixture's `route-code` label expects
`'vishwakarm'` (11/12; 12/12 with the label renamed).

## 3. Actual test counts (steps 5 and 6)

### SHIVAX (this repository, Node 22.23.2)

| Command | Result |
| --- | --- |
| `pnpm lint` (`tsc --noEmit && eslint .`) | exit 0 |
| `pnpm test` (build + `node --test tests/*.test.mjs`) | **897/897** pass, 0 fail, 0 skipped |
| `pnpm build` | exit 0 |
| `pnpm verify:package` | exit 0: ESM/CJS imports; 13 documented examples present, 11 offline examples ran; worker training ESM and CJS; declarations in 5 modes × 13 entries |
| `npm pack --dry-run` | exit 0 (its `prepack` re-ran lint and the 897 tests): `shivax@0.2.0`, **509 files**, 687,753 B packed, 3,151,986 B unpacked |
| `pnpm install --frozen-lockfile --lockfile-only` | exit 0 (lockfile matches `package.json`) |
| Clean-project install of the packed tarball | ok; frozen 0.2.0 suite and the S09 benchmark ran from it (§2, §5) |
| Lockdown during worker training (new probe, packed candidate) | 1/1 (§4) |
| Same source on Node 24.22.2 and 26.13.0 | 897/897 on each in S08 (same day, same source). Not re-run in S09 |

### Inspectra (its own repository, `inspectra-engine` 1.1.0 working tree, installed SHIVAX = local `file:../shivax` copy)

| Command | Result |
| --- | --- |
| `npm run build` (`scripts/check-build.mjs`) | exit 0 |
| `test:unit` | 24/24 |
| `test:feedback` | 17/17 |
| `test:security` | 45/45 |
| `test:extraction` | 12/12 |
| `test:ui-check` (UI comparison regression + dynamic content) | **55/55** |
| `test:integration` | 80 tests: **72 pass, 6 fail, 2 skipped**. Same as I01 and S08 |
| `npm test` (`playwright test` a11y spec) | **Not run.** It scans the live app at `pages.json` `baseURL` (`http://localhost:4015`), which is not part of this repository or an offline fixture |

The 6 integration failures:

- **5 need local OCR** (`tesseract` is not installed): tests 45, 46, 49, 51 and 53.
- **1 is P0-1 from SHIVAX** (test 36, `install.mjs`): "packed packages install
  outside workspace" fails with `ERESOLVE … While resolving: shivax@0.2.0 …
  Found: inspectra-engine@1.1.0`.

The 2 skips are Windows SIGINT tests that cannot run on this platform.

### Visynq (its own repository, `visynq-workstation` 1.0.0)

| Command | Result |
| --- | --- |
| `pnpm test` (`vitest run`) | **31 files, 303/303** pass |
| Learning UI tests (`vitest run learning`) | **4 files, 60/60** pass (review 17, dashboard 36, real registry 2, styles 5) |
| `pnpm build` = `tsc -b && vite build` | **FAIL at `tsc`**: 4 × TS2339 in `src/hooks/useScan.ts:162` and `src/live/useScan.ts:159` (`error` missing on the Inspectra 1.1 event union). Pre-existing (S08 B-4). Run as `tsc -p tsconfig.json --noEmit` so the tracked `tsconfig.tsbuildinfo` was not rewritten |
| `vite build` alone (output to a scratch folder) | exit 0; `LearningPage` lazy chunk 78.66 kB (gzip 22.54 kB); main bundle 481.70 kB |
| Runner integration `test:integration` | **Not run to completion.** Its first step is `npm run build`, which fails at `tsc` (above). I02 recorded the live suite itself as 0/6 on the baseline (it looks for a `Runner origin` label that only the unrouted legacy component has) |
| `test:settings` | 13/13 |
| `test:ngrok` | 3/3 |
| `test:env` | 1/1. The first attempt, while Inspectra's browser suite ran at the same time, failed only at cleanup (`EBUSY` removing its temp folder). The rerun on its own passed |
| Lint | No lint script or ESLint config exists in Visynq |

S08's B-7 did not reproduce: Windows Application Control did not block rollup's
native addon today, and Vite and Vitest started in the Visynq repository as
installed. Neither Inspectra nor Visynq has a working-tree change after these
runs.

## 4. Security findings (step 3)

Every case below is covered by a test that ran and passed in §3 (repository
suite, 897/897), and the rightmost column names it. S08 also exercised the
cases across all three packages on Node 22, 24 and 26.

| Case | Result | Tests |
| --- | --- | --- |
| Unauthorized feedback verification | Refused | T4, T5, T11, T13; S08 S4.1, S4.2 |
| Forged training labels | Refused (inferred labels, revised labels, forged totals) | B3, B8, T8 |
| Dataset partition leakage | Detected; blocks runs and eligibility | T9, B5; S08 held-out dedupe |
| Cross-tenant access | Refused at every boundary | T6, B11, R11, L7, M10; firewall forged/cross-tenant contexts |
| Malicious model output | Cannot verify itself, carry secrets or reach tools; invalid output is never accepted as data | T13, B13; R06 malformed-output tests; §5 |
| Unapproved model activation | No path to `active` without approval; nothing deploys on its own | R4, R5, R18, L8 |
| Concurrent promotion | Exactly one activation wins, in-process and across processes | R10 |
| Corrupt model persistence | Fails closed; never recreated | R7, R8, R13; S08 S4.5 |
| Stale approval | Refused | R9, R14; firewall "policy replacement during approval cannot revive stale authorization" |
| Lockdown during worker execution | **Re-tested on the packed candidate.** A worker job running inside a firewall `workflow` operation: lockdown → firewall outcome `revoked`, worker `cancelled`, **no model produced**, next job `lockdown` | new S09 probe (1/1); S08 S4.9 |
| Invalid provider fallback | Token overrun is terminal with no fallback; malformed output may fall back only when allowed and both attempts are charged; fallback cannot start after the budget is spent or during lockdown | `model-safety`, R06 fallback tests; §5 |
| Prompt injection against tools and routing | Cannot steer routing or authority; cannot reach audit records; namespace injection blocked | L6, L13, R10 "prompt-injected input", R06 protected memory |
| Secret leakage in logs | Audit records exclude secrets and raw ids; privacy policy rejects credentials before storage or embedding | "audit records exclude secrets…", "default privacy policy rejects credential fields…", T13 |

**Tarball scan.** 509 regular files. **0 symlink or hard-link entries** (the I01
hazard). **0 source maps** and 0 `sourceMappingURL` comments. No `src/`,
`tests/` or `scripts/`. 0 matches for private keys, `sk-`, `ghp_`, `npm_`,
`glpat-`, `AKIA` or Slack tokens. No local paths (`D:\Project`,
`C:\Users`). `dependencies` is empty and there are no install scripts. The
license is unchanged: Apache-2.0.

**No unresolved P0 security issue.** The single P0 is a packaging defect (§7).

**Observation (not a vulnerability):** a worker job rejected by its own limits
(for example 50,000 epochs × 64 rows over the 250M work cap) surfaces through
the firewall as a generic `denied`, because the firewall hides operation
errors. That is safe, but hosts need their own logging to diagnose it.

## 5. Benchmark comparison against the frozen NARASIMHA 0.2.0 baseline (step 4)

Same script, same fixtures, run from each clean install on Node 22.23.2,
Windows x64. Only 0.2.0-era public APIs were used, so both installs ran
identical code paths. Domain cases are the 0.2.0 contract fixture
(`tests/fixtures/learning-cases.mjs`, 2 cases per domain). That is a
regression check, **not** a measure of general model quality.

| Domain (0.2.0 fixture) | 0.2.0 | Candidate | Candidate, rename-normalised label |
| --- | --- | --- | --- |
| Routing correctness | 2/2 | 1/2 (`route-code` → `vishwakarma`) | 2/2 |
| Reasoning evaluation | 2/2 | 2/2 | 2/2 |
| Code evaluation | 2/2 | 2/2 | 2/2 |
| Visual evaluation | 2/2 | 2/2 | 2/2 |
| Permission correctness | 2/2 | 2/2 | 2/2 |
| Memory relevance (exact retrieve) | 2/2 | 2/2 | 2/2 |

| Behaviour | 0.2.0 | Candidate |
| --- | --- | --- |
| Training: seeded XOR 2-8-1, 2,000 epochs | model SHA-256 `2f8b9b26…f332b`; p(0,0) = 0.0005891139621383979 | **identical** |
| Training wall time (one run) | 32.3 ms | 32.7 ms |
| Model JSON cross-load | candidate model loads, same predictions, identical re-serialisation | 0.2.0 model loads, same |
| Verified provider cost: $0.30 budget, $0.10 calls | 3 completed, 4th `cost-limit/cost-limit-exceeded`; reserved $0.30 | **identical** |
| Token overrun (limit 1, reported 2) | `usage-limit/token-limit-exceeded`, 1 attempt, 0 fallback calls, terminal on reuse | **identical** |
| Invalid provider output then valid fallback | `invalid-output/invalid-provider-output` → fallback ok, both charged ($0.20) | **identical** |

**Latency** (ms per call; 200 measured runs per case after 20 warm-ups; one
machine, one run):

| Domain | p50, 0.2.0 → candidate | p95, 0.2.0 → candidate |
| --- | --- | --- |
| Routing | 0.0011 → 0.0011 | 0.0013 → 0.0013 |
| Reasoning | 0.323 → 0.316 | 0.455 → 0.429 |
| Code | 0.278 → 0.280 | 0.375 → 0.377 |
| Visual | 0.454 → 0.447 | 0.604 → 0.601 |
| Permission (Jay + Vijay + RUDRA) | 2.866 → 2.866 | 3.866 → 3.929 |
| Memory | 0.073 → 0.073 | 0.115 → 0.121 |

All differences are within single-run noise. **No measured regression** in
accuracy, cost accounting, token safety or latency, and no security regression.

**Candidate-only capabilities** (no 0.2.0 equivalent; measured in earlier
phases on labelled fixtures, not re-measured here):

| Capability | Measurement | Source |
| --- | --- | --- |
| Learning-assisted routing (shadow) | 25 held-out labels: accuracy 0 → 0.8, regret 1 → 0.2, verdict `improved`; 5 labels → `insufficient-evidence` | S05 L15 |
| Memory ranking | MRR 0.417 → 1.000; precision@3 0.333 = 0.333; recall@3 1.0 = 1.0; cross-tenant denial 1.0 = 1.0 (4 queries; `insufficient-evidence` at 10) | S06 §7 |
| Worker training | Bit-identical to synchronous; longest host timer gap 15.5–21.0 ms against 371–786 ms synchronous; workers not always faster | S03 §8 |
| End-to-end triage candidate | Held-out pass rate 0.667 → 1.000 (5 cases), 0 regressions | S08 §5 |

Provider costs above come from in-process mock providers with declared usage.
No real or paid provider was called.

## 6. Known limitations

- SARASWATI trains only ShivAX's CPU `NeuralNet` models. It does not fine-tune
  LLMs, and UI feedback cannot train an arbitrary model without a suitable
  model and a host training pipeline.
- Attestation and manifest digests are integrity checks, not signatures.
  Authenticity rests on the host journal (or the optional S04 `signer`).
- The host must supply the durable registry store, the review journal, the
  consent store, identity and roles, and a job tracker. SHIVAX ships reference
  in-memory versions only.
- The benchmark fixtures are small (2 cases per domain; 4 to 25 labels in
  S05, S06 and S08). They are regression gates, not quality claims.
- Tested on Windows x64 only. Node 22, 24 and 26 ran in S08; S09 ran on Node 22.
- Worker training is Node-only (`shivax/learning/node`). Browsers keep the
  synchronous API.
- A prerelease such as `0.3.0-beta.1` does not satisfy `^0.3.0` or
  `^0.2.0 || ^0.3.0`. Inspectra cannot pick it up through its range.

## 7. Remaining open issues

| ID | Severity | Issue | Owner |
| --- | --- | --- | --- |
| **P0-1** | **P0** | `peerDependencies.inspectra-engine` is exactly `"1.0.4"`. Reproduced in S09: `npm install <candidate.tgz> inspectra-engine@1.1.0` → `ERESOLVE` (exit 1). `inspectra-engine@latest` is 1.1.0, so anyone who has current Inspectra cannot install the candidate without `--legacy-peer-deps`, which leaves an invalid tree. The same defect is already live in published 0.2.0. Fix: `^1.0.4` (S08 installed that shape cleanly). The adapter messages, `adapters/inspectra/README.md`, `README.md`, `docs/production.md`, `docs/sdk.md`, `docs/release-readiness.md` and `scripts/check-inspectra-package.mjs` (which asserts `1.0.4`) must change with it, and the adapter must be certified against 1.1.0 | SHIVAX |
| P1-a | P1 | Version label `0.2.0` equals the published, different 0.2.0. npm would refuse to publish it, but a shared tarball is misleading | SHIVAX |
| P1-b | P1 | Shipped docs state 0.2.0 is unpublished: `CHANGELOG.md` 0.2.0 section and the `docs/release-readiness.md` header. At release, the "unreleased" wording for 0.3.0 in `README.md`, `SECURITY.md`, `docs/production.md` and `docs/sdk.md` must also change | SHIVAX |
| P1-c | P1 | No Linux run and no CI run of any change since 0.1.3. `.github/workflows/package-verification.yml` has an `ubuntu-latest` and `windows-latest` matrix but has never run on this branch (nothing pushed) | Maintainer |
| P1-d | P1 | Bot id `vishwakarm` → `vishwakarma` is breaking for hosts that name the old id (fail closed). It is allowed in a 0.x minor and is documented, but must lead the release notes | SHIVAX docs |
| P1-e | P1 | Visynq `tsc` fails (4 × TS2339), so `npm run build` and `test:integration` fail (S08 B-4) | Visynq |
| P1-f | P1 | Visynq does not declare `shivax`; it uses `../shivax` aliases and paths and imports a sibling fixture (S08 B-3) | Visynq |
| P1-g | P1 | No production trusted learning host (I02 §7, S08 B-5) | Host / Visynq |
| P2-a | P2 | Visynq live-runner integration suite fails on its baseline (I02 §6) | Visynq |
| P2-b | P2 | Inspectra integration needs `tesseract` for 5 OCR tests; it is not installed here | Environment |
| P2-c | P2 | Worker limit errors appear as a generic firewall `denied` (§4) | SHIVAX docs |
| P2-d | P2 | The S08 and S09 harnesses are kept outside the repository, so CI cannot re-run the cross-repository flow | Maintainer |

## 8. Dependency compatibility

Registry state, checked 2026-11-09 with `npm view`:

| Package | Versions on npm | dist-tags |
| --- | --- | --- |
| `shivax` | 0.0.0-stage, 0.1.2, 0.1.3, 0.2.0 (2026-11-07T16:22Z, `gitHead 776820f`) | `{"latest": "0.2.0"}` |
| `inspectra-engine` | latest 1.1.0 (`dependencies.shivax: "^0.2.0"`) | `{"latest": "1.1.0"}` |

`0.3.0-beta.1` and `0.3.0` are both unpublished.

| Pair | Status |
| --- | --- |
| Candidate (as is) + `inspectra-engine@1.1.0` | **ERESOLVE** (P0-1) |
| Candidate with peer `^1.0.4` + Inspectra 1.2.0 candidate | Clean install (S08, proposed shape) |
| Candidate alone (no Inspectra, no Playwright) | All 13 entries load; 11 examples run (S08, `verify:package`) |
| Inspectra 1.1.0 (npm) + SHIVAX 0.3.x | Not compatible by range (`^0.2.0`). Needs Inspectra 1.2.0 (`^0.2.0 \|\| ^0.3.0`, I01) |
| Visynq | Uses `inspectra-engine ^1.1.0` and sibling SHIVAX aliases; no `shivax` dependency (P1-f) |
| Runtime dependencies | None. Node `>=22` (Inspectra `>=22.15`) |

## 9. Candidate version recommendation

**`0.3.0-beta.1`, published under the dist-tag `next`, never `latest`.** The
reasons:

- 0.2.0 is on npm and no 0.3 version exists.
- The release adds large new APIs and one breaking id change. That makes it a
  0.x minor.
- It has never run on Linux or in CI.
- Inspectra 1.2.0 and a production host are not ready.

Stable `0.3.0` follows once a CI run passes on both platforms and the beta has
been exercised.

Required before any publish (each needs your approval, because each changes
the release candidate):

- **R-1:** widen the peer to `"inspectra-engine": "^1.0.4"`. Update the
  messages, docs and certification script listed under P0-1, then certify the
  adapter against `inspectra-engine@1.1.0`.
- **R-2:** run `npm version 0.3.0-beta.1 --no-git-tag-version`. Move the
  CHANGELOG `[Unreleased]` section to `[0.3.0-beta.1] SARASWATI - <date>` and fix
  the stale 0.2.0 text (P1-b).
- **R-3:** re-run §3 and the clean-project install, and check that
  `npm install <tgz> inspectra-engine@1.1.0` resolves.

**Prepared commands. Do not run without your explicit approval:**

```sh
# after R-1..R-3, on a clean tree
npm view shivax version && npm view shivax dist-tags --json   # expect 0.2.0 / {"latest":"0.2.0"}
pnpm lint && pnpm test && pnpm build && pnpm verify:package && npm pack --dry-run
npm publish --tag next --access public          # prerelease; leaves "latest" on 0.2.0
npm view shivax dist-tags --json                 # expect {"latest":"0.2.0","next":"0.3.0-beta.1"}
git tag -a v0.3.0-beta.1 -m "SARASWATI - The Intelligence & Learning Release (beta 1)"   # only if you approve tags
# stable, later: npm version 0.3.0 --no-git-tag-version; same gates; npm publish (sets latest)
```

## 10. GO / NO-GO

| Gate | Status |
| --- | --- |
| All P0 security tests pass | **PASS**: 13/13 cases (§4); no unresolved P0 security issue |
| Backward compatibility | **PASS with one approved break**: no export removed; firewall, Jay, Vijay, RUDRA, NeuralNet, model JSON, ModelRouter cost and token behaviour, and MemoryEngine all unchanged against the frozen 0.2.0 suite; bot id `vishwakarma` |
| Benchmarks against 0.2.0 | **PASS**: no measured regression (§5) |
| SHIVAX lint, test, build, verify:package, pack | **PASS** (897/897) |
| Inspectra documented checks | **PASS except known items**: build, unit, feedback, security, extraction and UI regression all pass. Integration 72/80: 5 OCR tests need `tesseract`, 1 fails on P0-1, 2 are Windows skips |
| Visynq documented checks | **Partial**: tests 303/303 and learning UI 60/60; build fails at `tsc` (pre-existing); runner integration blocked by the build |
| Package metadata and tarball | **FAIL**: P0-1 exact peer reproduces `ERESOLVE`; version label `0.2.0` |
| Linux and CI | **Not tested** |

**Decision: NO-GO** for publishing the current tree.

**Conditional GO for `0.3.0-beta.1` on the `next` tag** after R-1 to R-3
pass. The core SDK is safe to release, and the optional Inspectra and Visynq
work may ship separately, as the roadmap gate allows.

**Stable `0.3.0`: NO-GO** until P1-c is closed (CI on Linux and Windows).

S09 is complete. Nothing will be published until you approve it.
