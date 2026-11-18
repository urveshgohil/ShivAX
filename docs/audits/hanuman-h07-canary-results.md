# H07-B Shabari canary results

18 November 2026, Asia/Calcutta. Reviewed HEAD `ce947c1`, current package `0.3.3`. Node v22.23.2, pnpm 12.8.1. All retrieval fixtures use mocks. **H07-B test gate: FAIL / INCOMPLETE.** The runner and selected existing suites pass. The complete H07-A fixture inventory and independent adversarial assertions requested for H07-B are not implemented, so a green runner result does not constitute a full security gate.

## Frozen baseline evidence

Git has no release tag. `git rev-parse 37845c7` produced commit `37845c7f880d14a78fae0378a7c0b45fa1116005`. `git rev-parse '37845c7^{tree}'` produced `b81e4783d06feac7e597cacc59db324c4a11089a`. The commit's `package.json` says `0.3.2` and its changelog names the 0.3.x line SARASWATI. `git archive` extracted the tree under ignored `node_modules/h07-baseline`, preserving the current worktree.

Offline `pnpm install --frozen-lockfile --ignore-scripts` failed with `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`. The offline non-frozen attempt failed with `ERR_PNPM_BAD_CONFIG_DEP` resolving pnpm from the offline cache. A junction to the existing dependencies was denied by the environment. The archived tree was nevertheless built successfully using the current workspace's installed TypeScript and Rollup CLIs and the baseline's own scripts and configuration. This is a **shared-toolchain baseline**, not a verified reproduction of a separately installed historical dependency set.

| Measurement | Actual result |
| --- | --- |
| Baseline build | PASS using `node scripts/clean.mjs`, `node ../typescript/bin/tsc -p tsconfig.json`, `node scripts/build-cjs-declarations.mjs`, `node ../rollup/dist/bin/rollup -c rollup.config.mjs`, run in the archived directory. |
| `node --test 'tests/*.test.mjs'` in archived baseline | **897 pass, 0 fail, 0 skipped, 0 TODO**, exit 0. Log `node_modules/h07-baseline-test.log`. |
| Historical tests against current built `dist`, with archived manifest and support files | **896 pass, 1 fail**, 0 skipped/TODO, exit 1. Log `node_modules/h07-cross-test.log`. The one failure is the historical package-version assertion: baseline manifest expects `0.3.2` while current SDK exports `0.3.3`. This is the expected version difference, not evidence of a behavior regression. |
| Baseline scope | Hanuman gateway/bot/integration/examples, H04 workflow-safety and Shabari tests do not exist in the 0.3.2 tree. No direct historical comparison is possible for them. |

The cross-run uses historical source-side supporting files with the current compiled output. It does not prove every historical public contract or installed dependency combination.

## Harness and fixture inventory

`tests/fixtures/shabari-runner.mjs` is an opt-in Node test-suite runner. It accepts explicit IDs `examples`, `gateway`, `bot`, `integration`, `firewall`, `cost`, `routing`. It starts each suite in its own child process using Node's test runner with process-internal test isolation disabled, bounds concurrency to 1–4 and deadlines to 1–120,000 ms, and waits for each child to close after completion or termination. Output is consumed in a bounded tail and is never returned in the result. Structured JSON contains fixture IDs, status and test counts, not bodies, credentials or request payloads. The test runner performs no deployment, promotion or paid provider call.

`tests/shabari-runner.test.mjs` verifies explicit selection, bounds, duplicate/unknown rejection, two simultaneous suites, sanitized structured results and process timeout reporting. The harness runs **existing suites** at suite granularity. It does not implement the H07-A planned individual `SHB-*` fixture registry, synthetic faulty transport controls, mutation tests or tripwires. A killed child is waited for; the harness has not established cleanup guarantees for arbitrary descendant processes or hostile fixtures.

Command and actual result:

```sh
node tests/fixtures/shabari-runner.mjs examples gateway bot integration firewall cost routing
```

| Selected suite | Pass / total | Existing coverage examples |
| --- | --- | --- |
| examples | 13 / 13 | Documentation, JSON GET, opt-in roster, injection text, denial cases. |
| gateway | 182 / 182 | Mock address denial, redirects, response bounds, media/encoding, policy checkpoints and cleanup. |
| bot | 88 / 88 | Input/output schema, untrusted evidence, opt-in and authorization. |
| integration | 108 / 108 | RUDRA and workflow integration, tenant and policy cases, reviewed known behavior. |
| firewall | 58 / 58 | Existing integration authorization and firewall behavior. |
| cost | 38 / 38 | Exact $0.30 model-router case and other accounting limits. |
| routing | 18 / 18 | Existing SARASWATI routing tests. |

Total **505 / 505** in the selected runs, all zero failed/skipped/TODO/cancelled. These counts overlap with the full suite and each other only as independently invoked test files. The structured result is in `node_modules/h07b-canary.log`.

## Security and compatibility assessment

- **Positive canaries:** the existing examples exercise approved documentation, REST, the RUDRA bot path and seven default IDs. H05 budget reporting is unavailable, so it cannot be tested. Existing cost/routing suites cover canonical router reservations and approved SARASWATI routing independently.
- **Network restrictions:** the gateway suite uses a simulated host transport and covers classified private/link-local/metadata addresses, redirect rejection, peer mismatch, unsupported media, byte limits, identity encoding, timeout and cleanup. It cannot prove real DNS pinning, TLS, wire-level redirects or host credential omission. Multi-hop redirects, transparent decompression sabotage, slow headers and TLS failure simulations requested in H07-B are not independently implemented here.
- **Prompt injection:** existing integration/example tests retain untrusted evidence and assert fixed routing and no extra transport request for their fixtures. The entire seven-vector H07-A injection matrix and a model-driven summarizer tripwire are not delivered.
- **Firewall modes and races:** existing suites cover monitor/enforce behavior and selected lockdown, policy, cancellation and cleanup checkpoints. A complete per-capability mode matrix, adapter-ignoring-cancellation controls, duplicate terminal event and all requested approval/retry race fixtures remain unverified.
- **Redaction:** runner results omit raw child output. Existing tests check selected synthetic secrets in outputs. Comprehensive log, private-address and cross-tenant redaction checks and detector sabotage controls remain outstanding.
- **Cost:** the existing ESM and CJS `model-cost.test.mjs` validates three $0.10 calls under a $0.30 router budget and denial of a fourth. Kubera is absent, so there is no budget-report comparison. No new accounting implementation was introduced.
- **Baseline:** the historical suite passes against its archived build with the current installed toolchain. The cross-run's single failure is the intentional version difference described above. New H07-specific and H01–H06 behavior has no 0.3.2 equivalent.

## Findings and remaining work

**H07B-01, P2 — requested adversarial harness is incomplete.** Affected `tests/fixtures/shabari-runner.mjs` and the missing H07 `SHB-*` test files. Reproduce by running the selected suites above and comparing them to `hanuman-h07-attack-plan.md` sections 3–9. Expected: individual network, prompt, race, mode, budget and detector-control fixtures with required assertions. Actual: the runner selects pre-existing suites and does not implement the full inventory. The downstream effect is incomplete security evidence, not a demonstrated bypass. Correction requires implementing the remaining offline fixtures and their regression tests, including harness-control sabotage cases, before declaring H07-B PASS.

**H07B-02, P2 — budget reporting canary unavailable.** `src/security/kubera.ts` and its public factory are absent, as recorded in H05 review. Expected: compare authorized budget reporting with canonical reservations. Actual: no reporter exists. Correct H05-B and add authorized, tenant-isolated numeric and concurrency canaries.

Previous review findings H01D-02 and H03C-01 remain relevant but were not independently reproduced in this phase. H01D-02 requires a reviewed host transport and isolated wire-level tests. No production defect is claimed solely from a mock suite result.

## Validation results

All commands ran locally with process-local `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted`, `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`.

| Command | Actual outcome | Ignored log |
| --- | --- | --- |
| `pnpm lint` | PASS, exit 0 | `node_modules/h07b-lint.log` |
| `pnpm test` | PASS, exit 0; **1,447 passed**, 0 failed/skipped/TODO/cancelled | `node_modules/h07b-test.log` |
| `pnpm build` | PASS, exit 0 | `node_modules/h07b-build.log` |
| `pnpm verify:package` | PASS, exit 0; 182 gateway, 88 bot, 13 H06 installed tests, 4 H06 examples, ESM/CJS and 13 declaration entries in five modes, 550 package files | `node_modules/h07b-package.log` |
| `npm pack --dry-run` | PASS, exit 0; 551 files | `node_modules/h07b-pack.log` |
| `node --test tests/shabari-runner.test.mjs` | PASS, **3 / 3** | Direct run |
| Selected canary command above | PASS, **505 / 505** | `node_modules/h07b-canary.log` |

The first runner self-test revealed that `NODE_TEST_CONTEXT` leaked the parent test runner's protocol into nested Node test processes. The child environment now removes it; the final self-tests pass. Earlier baseline install failures and the cross-run failure remain reported above rather than being hidden.

## Changed paths

Added `tests/fixtures/shabari-runner.mjs`, `tests/shabari-runner.test.mjs` and this report. The pre-existing staged `docs/audits/hanuman-h07-attack-plan.md` was preserved. Build output, baseline archive, scratch tree and logs are ignored workspace artifacts. No production source was modified. H07-C has not begun.
