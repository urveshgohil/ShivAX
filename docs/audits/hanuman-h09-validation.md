# H09-B release validation

19 November 2026, Asia/Calcutta. **Validation gate FAIL / NO-GO.** All executed tests passed. The target 0.4.0 artifact does not exist, required security fixtures and earlier phase gates are incomplete, and the requested CI matrix was not executed.

## Environment and artifact

Windows x64, OS version 10.0.26300, Node v22.23.2, pnpm 12.8.1. Source commit `1f814226babdc55cad8f0cd58869664ddd5f6687`. The prior H09-A report was untracked at the start of this phase. No source modifications were present.

The tested H09-A tarball is `node_modules/h09-candidate-1f814226/shivax-0.3.3.tgz`, SHA-256 `e35aef8e0f810e60b2e57b466b2f11c30855f392f91b5f02e7e4518a9b6dbd12`. The measured hash matched H09-A before testing. The package manifest is 0.3.3. It is a verification artifact for the 0.4.0 target.

The pnpm checks used existing dependencies with process-local `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`. No CI status is inferred.

## Local execution

| Command | Exit | Results |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | 1,452 pass, 0 fail, 0 skipped, 0 cancelled, 0 TODO |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | 186 gateway, 88 bot and 13 H06 tests. All 13 ESM/CJS entrypoints, ten browser-safe graphs, 16 offline examples and worker training pass. Five TypeScript modes compile. |
| `npm pack --dry-run` | 0 | 551 files |
| `node tests/fixtures/shabari-runner.mjs examples gateway bot integration firewall cost routing SHB-NET-12.6 SHB-NET-12.7` | 0 | 509 distinct suite cases pass and four named cases pass again. No failures/skips/cancellations/TODOs. |
| `node --test tests/security.test.mjs tests/firewall.test.mjs tests/firewall-integration.test.mjs tests/firewall-model-integration.test.mjs tests/model-cost.test.mjs tests/learning.test.mjs tests/learning-governance.test.mjs tests/learning-benchmarks.test.mjs tests/learning-worker.test.mjs tests/learning-registry.test.mjs tests/learning-routing.test.mjs tests/memory.test.mjs tests/memory-ranking.test.mjs tests/workflow-safety.test.mjs tests/workflow-safety-adversarial.test.mjs` | 0 | 588 pass, 0 fail/skipped/cancelled/TODO |
| `node node_modules/h08-compat.mjs` | 0 | 13 baseline export maps identical and all legacy ESM/CJS runtime names retained |
| `node --test 'tests/*.test.mjs'` in `node_modules/h08-baseline` | 0 | Baseline 897 pass, 0 fail/skipped/cancelled/TODO |

Test counts overlap. Logs are `node_modules/h09b-{lint,test,build,package,pack,canary,focused,compat,baseline}.log`.

## CI matrix

The repository workflow `.github/workflows/package-verification.yml` defines Windows and Ubuntu with Node 22, 24 and 26. The package declares Node >=22. This phase ran locally on Windows/Node 22. It did not trigger or observe any CI job.

| CI job | Status |
| --- | --- |
| Windows Node 22 | NOT RUN |
| Windows Node 24 | NOT RUN |
| Windows Node 26 | NOT RUN |
| Linux Node 22 | NOT RUN |
| Linux Node 24 | NOT RUN |
| Linux Node 26 | NOT RUN |

On each provisioned host, the workflow commands are `pnpm install --ignore-scripts --no-frozen-lockfile`, `pnpm lint`, `pnpm test`, `pnpm verify:package`, and `npm run verify:package`, using pnpm 12.8.1. Node 24 and 26 and Linux were not tested during H09-B. H08-C previously reported separate local Windows runs, which are not H09-B CI results.

## Frozen package installation

A fresh temporary standalone consumer installed the exact frozen tarball using `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false <tarball>`, exit 0. A script loaded all 13 entries in ESM and CJS, asserted the seven IDs and 29 capabilities, verified Hanuman registration fails without a tool, and confirmed Inspectra and Visynq were absent. It exited 0. All 16 shipped offline SDK examples exited 0.

A second temporary consumer installed the same tarball and `inspectra-engine@1.2.1` from the machine cache using the same offline options. Install, `npm ls shivax inspectra-engine`, and ESM adapter/Inspectra function imports each exited 0. The tree showed a single deduplicated SHIVAX 0.3.3. No browser capture was run. H08C-04 still applies to Inspectra's dependency range for 0.4.0.

The full type-resolution and browser-graph checks in `pnpm verify:package` used a newly packed pnpm tarball from the same source and build. They were not independently repeated against the frozen npm tarball. H09-A previously tested declaration modes using its own clean package verifier. Logs include `node_modules/h09b-{install,consumer,peer,peer-tree,peer-import}.log`.

## Baseline and regression interpretation

The verified historical 0.3.2 source commit is `37845c7f880d14a78fae0378a7c0b45fa1116005`. Its archived tree was built earlier with the workspace toolchain. The historical suite passed 897/897 in this phase. Runtime export retention was rechecked against the current build. A full historical-to-current behavioral cross-run was not repeated. H07-B recorded 896/897 for its mixed-version cross-run, with the sole failure comparing the historical 0.3.2 manifest to current 0.3.3 VERSION. That earlier run is not a direct equivalent-version benchmark.

The baseline and current test elapsed times, 4,618 ms and 10,209 ms respectively, cover different test inventories and are not comparable performance measurements. Existing seven-bot, routing, accounting, security, learning and memory suites passed within their respective source builds. The complete capability equivalence comparison was independently recorded in H08-C. H01–H07 additions have no equivalent 0.3.2 fixtures.

The focused suites cover Jay/Vijay, firewall enforcement and monitor behavior, protected tools, tenant and approval checks, model-cost admission including three $0.10 calls and a denied fourth call, concurrent accounting, learning governance, benchmarks, worker training, lifecycle/registry, routing and memory. The gateway, bot and integration canary suites cover mock destination rejection, response bounds, cancellation, prompt injection, policy checks and workflow safety. These results overlap the full suite and do not establish wire-level DNS, TLS, redirect or decompression behavior.

H07-D records only two of 338 planned individually named canary variants. H01D-02 lacks a reviewed real host transport. H03C-01 leaves implicit routing eligibility. Jambavan and Kubera are absent. These are open findings, not skipped passing tests. H04 retains its independent review condition. H08-C retains documentation and Inspectra forward-compatibility findings.

No H09-B command reported a test failure or skip. Remote CI, unsupported or unavailable fixture variants, live host transport protections, and exact-frozen-tarball declaration/browser checks were not executed. No production source was changed. H09-B ends here.
