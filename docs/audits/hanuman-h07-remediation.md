# H07-C remediation

**H07 acceptance gate — FAIL / NO-GO.** All available validation passed. H07-B reported two P2 findings. This phase closed two response-boundary coverage cases within H07B-01. The broader H07 canary matrix and the H05 budget-reporting prerequisite remain open. Neither H07-B finding established a new production vulnerability. Changes are confined to tests and this report.

Reviewed on 19 November 2026 for the 0.4.0 HANUMAN target. The installed and packed SDK identifies itself as 0.3.3. The H06 baseline is `ce947c1`. From that commit to H07-B HEAD `92b67ea66aede1b5eb6c67210456d08b65471134`, Git records two audit documents, the Shabari runner and its self-test. The SDK implementation was identical across those two commits.

## Finding disposition

| Finding | Reproduction and root cause | Boundary and disposition |
| --- | --- | --- |
| H07B-01 · P2 · incomplete test coverage | On the H07-B tree, selecting `SHB-NET-12.6` exited 2. The runner registered seven suite names. The gateway suite exercised general byte and chunk overflow but lacked the planned 512/513-byte pair. | The SDK bounds the stream supplied by the trusted host before it returns evidence. Two stable selectors now verify the inclusive byte limit with an undeclared response length. The larger coverage finding remains open. |
| H07B-02 · P2 · missing H05 feature | Neither the security source tree nor its exports provide `createKuberaReporter`. Loading both `shivax` and `shivax/security` in ESM and CommonJS returned `undefined` for the factory and `function` for the control export `Vijay`. | Authorized tenant-specific reporting cannot be compared with canonical reservations. The cost suite still exercises the existing three US$0.10 admissions under US$0.30 and the fourth-call denial. A reporting or accounting correction requires separate H05 implementation and review. |

The H07-B baseline install and version failures were also reviewed. The historical log records 897/897 passes on the archived 0.3.2 tree with the shared toolchain. Mixing the historical manifest with the current SDK yielded 896/897, with the single failure explicitly comparing 0.3.2 and 0.3.3. These are prior measurements. Historical dependency installation remains unverified. The earlier child test protocol error was already corrected in H07-B by removing the inherited `NODE_TEST_CONTEXT`. The runner self-tests passed again here.

## Changed paths and regression evidence

| Path | Change |
| --- | --- |
| `tests/hanuman-fetch.test.mjs` | Added `SHB-NET-12.6` and `SHB-NET-12.7` through the existing protected workflow, Jay/Vijay, firewall and mock host fixture, for ESM and CommonJS. |
| `tests/fixtures/shabari-runner.mjs` | Added fixed Node test-name filters for the two individual fixtures. All seven suite selections remain available. |
| `tests/shabari-runner.test.mjs` | Added a self-test requiring each named selection to pass exactly two cases, one per module format. |
| `docs/audits/hanuman-h07-remediation.md` | Recorded triage, test evidence and the gate. |

Both streams supplied two bounded chunks. At 512 bytes, the workflow returned exactly one complete untrusted evidence object for the registered target. At 513 bytes, it emitted `response-too-large`, stopped iteration, and returned zero outputs. Each case asserted one resolution, one request, one response close, one iterator finalization and zero active firewall operations after settlement. This exercises SDK consumption of host-provided bytes. DNS, socket identity, TLS and decompression remain responsibilities of the trusted transport.

## Actual validation

Windows, Node v22.23.2, pnpm 12.8.1. The shell used the existing offline dependencies with `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_NODE_LINKER=hoisted`, and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`. Every command below exited 0. All counted test runs reported zero failures, skips, cancellations and TODOs where reported.

| Command | H07-C result |
| --- | --- |
| `pnpm lint` | PASS, TypeScript and ESLint |
| `pnpm test` | 1,452/1,452, up from the H07-B recorded 1,447/1,447 |
| `pnpm build` | PASS |
| `node --test tests/shabari-runner.test.mjs` | 4/4, previously 3/3 |
| `node tests/fixtures/shabari-runner.mjs SHB-NET-12.6 SHB-NET-12.7` | 4/4 focused checks |
| `node tests/fixtures/shabari-runner.mjs examples gateway bot integration firewall cost routing SHB-NET-12.6 SHB-NET-12.7` | All nine available selections passed. Suite counts in order were 13, 186, 88, 108, 58, 38 and 18. The two individual selections ran 2 each. This is 509 distinct suite tests and 513 executions including the four repeated cases. H07-B recorded 505 distinct suite tests. |
| `pnpm verify:package` | PASS in the isolated consumer. 186 gateway tests, 88 Hanuman bot tests, 13 H06 integration tests and 4 H06 examples passed. The verifier also ran 12 offline SDK examples, loaded ESM and CommonJS exports, checked browser-safe entry graphs and compiled 13 declaration entries in five modes. The H06 consumer had neither Inspectra nor Visynq installed. |
| `npm pack --dry-run` | PASS, 551 files for `shivax@0.3.3`. The separate pnpm package verifier reported 550 files. |

Local validation logs are under `node_modules/h07c-*.log`. Installed-package, focus and runner counts overlap with the repository tests. The diff contains no production sources, manifest, default bot registration, routing configuration or policy changes.

## Remaining risk and acceptance

- **H07B-01** still lacks the full planned catalog, per-capability firewall and race matrix, independent log-redaction controls, and tests that verify the harness detects deliberately faulty fixtures. The passing counts cover the implemented selections only.
- **H07B-02** remains blocked on an authorized budget reporter with tenant-isolation tests. The existing router regression supplies evidence for budget enforcement only.
- **H01D-02** remains a live-deployment blocker. Mocks cannot establish wire-level peer binding, certificate verification or redirect handling. **H03C-01** also remains open. The existing integration suite includes a characterization that passes when routing admits the root capability through the implicit allowlist. A passing suite therefore cannot certify explicit host opt-in at that boundary.

The [H07-B results](hanuman-h07-canary-results.md) and [H07 fixture plan](hanuman-h07-attack-plan.md) retain the full inventory. Live deployment and release remain NO-GO.
