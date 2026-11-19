# H09-A local candidate artifact

19 November 2026, Asia/Calcutta. **Artifact gate — FAIL / NO-GO for v0.4.0 release.** Local packaging and compatibility validation passed. Prerequisite implementation and security gates remain open. This phase freezes the current 0.3.3 verification artifact for further review.

## Source and baseline

Exact source commit `1f814226babdc55cad8f0cd58869664ddd5f6687`, branch `feat/hanuman-v0.4.0`. The checkout was clean before building and packing. This report is the only tracked change from this phase. The artifact contains the committed allowlisted sources and freshly rebuilt dist. The report itself is outside the package allowlist.

The historical 0.3.2 SARASWATI baseline is `37845c7f880d14a78fae0378a7c0b45fa1116005`. H00 identifies it from the manifest, runtime VERSION and release history. No ZIP provenance is available. The H08 archive build is retained under ignored `node_modules/h08-baseline`. This phase reran its export comparator against the current build. Baseline dependencies were built using the workspace toolchain. This supplies no claim of historical dependency reproducibility.

The 0.3.3 source baseline at `3f01ea1` differs from 0.3.2 only in the root VERSION constant, as confirmed again with `git diff 37845c7 3f01ea1 -- src`.

## Feature inventory

| Phase | Actual source and disposition |
| --- | --- |
| H01 | `src/integrations/hanuman/` implements the protected host gateway, exported through `shivax/integrations`. The reviewed connection-level transport remains absent, H01D-02. |
| H02 | `src/bots/hanuman.ts` implements optional HanumanBot and explicit registration. The capability is fetch.url. fetch.api and research.search remain reserved. |
| H03 | Existing RUDRA/workflow execution calls registered bots and protected tools. The implicit root-capability allowlist remains in `src/agents/rudra/validation.ts`, H03C-01. |
| H04 | `src/workflows/safety/` exports Abhimanyu preflight and Ashwatthama lifecycle checks through root and rudra. The phase summary still requires independent acceptance review. |
| H05 | Jambavan discovery and Kubera reporting factories are absent from source and runtime. Consumer checks characterized that absence. |
| H06 | `examples/sdk/hanuman/` supplies portable offline documentation, REST, workflow and denial examples with a host-owned fake transport. All four ran from the frozen installed artifact. |
| H07 | `tests/fixtures/shabari-runner.mjs` is opt-in test infrastructure. H07-D reports only two of the 338 planned numbered variants implemented. |
| H08 | Existing SDK exports, dual declaration graphs and documentation are present. The independent review gives conditional packaging approval with four unresolved P2 items. |

The required H00–H08 completion prerequisite is unsatisfied. H01, H03, H05 and H07 retain substantive open gates. H02 and H06 approval is limited to their reviewed offline scopes.

The frozen-artifact consumer asserted the exact seven default IDs and 29 capabilities through both ESM and CJS. IDs are sanjay, brihaspati, vishwakarma, chitragupt, narad, yudhishthir and ekalavy. Registration of Hanuman without its host tool failed, leaving Hanuman absent. The protected gateway and examples retain explicit host transport registration, authorization and firewall policy.

## Public API and module inventory

All 13 conditional export maps remain identical to 0.3.2. Each map has import and require branches, with types preceding default. The comparator confirmed retention of all historical runtime names in both formats.

| Import | 0.3.2 → current runtime names | Runtime stems beneath dist |
| --- | --- | --- |
| shivax | 187 → 202 | index |
| shivax/core | 12 → 12 | sdk/core |
| shivax/rudra | 14 → 25 | sdk/rudra |
| shivax/bots | 14 → 18 | sdk/bots |
| shivax/security | 9 → 9 | sdk/security |
| shivax/models | 13 → 13 | sdk/models |
| shivax/memory | 13 → 13 | sdk/memory |
| shivax/integrations | 5 → 10 | sdk/integrations |
| shivax/learning | 83 → 83 | sdk/learning |
| shivax/learning/node | 7 → 7 | sdk/learning-node |
| shivax/diagnostics | 1 → 1 | sdk/diagnostics |
| shivax/licensing/server | 2 → 2 | licensing/index |
| shivax/adapters/inspectra | 2 → 2 | sdk/inspectra |

Each stem maps to `.esm.js` for ESM and `.cjs` for CommonJS. Import declarations use the sibling `.d.ts`. Require declarations use the equivalent path inside `dist/types-cjs/`, whose package boundary declares CommonJS. The build copies the complete declaration graph there and derives the Inspectra counterpart from its original `.d.mts`.

The baseline public TypeScript APIs cover core tensors/neural models, bot contracts, registry/RUDRA, Jay/Vijay/firewall, models and budgets, memory, inspection, workflows, learning and diagnostics. H08-C previously walked all baseline declaration exports and compiled 1,012 references. This phase reran the existing legacy consumer tests and the current 13-entry, five-mode compilation. It does not claim to have repeated H08-C's complete declaration-name walk.

HANUMAN additions are the Hanuman bot APIs at root/bots, gateway registration and transport contracts at integrations, and warning APIs at root/rudra. Gateway names are absent from the root import. H08C-01 records the documentation discrepancy.

Both baseline and current manifest require Node >=22. This phase executed Node 22.23.2 on Windows only. H08-C's other Node-major measurements remain historical evidence.

## Frozen artifact

| Field | Value |
| --- | --- |
| Manifest version | 0.3.3 |
| Target under review | 0.4.0 HANUMAN |
| Filename | shivax-0.3.3.tgz |
| SHA-256 | e35aef8e0f810e60b2e57b466b2f11c30855f392f91b5f02e7e4518a9b6dbd12 |
| Compressed bytes | 782,997 |
| Unpacked bytes | 3,531,937 |
| Files | 551 |
| Node / pnpm | v22.23.2 / 12.8.1 |

The retained artifact is `node_modules/h09-candidate-1f814226/shivax-0.3.3.tgz`. Its sibling `artifact.json` stores the commit, hash, size, version, gate, tool versions and full export map. `contents.txt` stores all packaged paths. These are ignored local review artifacts for H09-B/C. They must be retained or copied before cleaning node_modules. Check the recorded SHA-256 before consuming them.

Command after successful validation was `npm pack --ignore-scripts --json --pack-destination node_modules/h09-candidate-1f814226`. The repository manifest was used as committed. A prerelease label was unnecessary for testing the blocked artifact.

## Contents and lifecycle audit

The contents list includes LICENSE, NOTICE, metadata, runtime ESM/CJS, declaration graphs, adapter files, selected documentation, public SDK examples and the offline host fixture. Path scanning found no tests, node_modules, .pnpm-store, environment files, private key files or development logs. The installed-package verifier additionally checked its required files and browser graphs. Path inspection cannot prove the absence of arbitrary embedded credentials.

There are no mandatory runtime dependencies, optional runtime dependencies, or installation hooks. The optional Inspectra peer is `^1.0.4`. The prepack lifecycle runs `pnpm lint && pnpm test`. The lifecycle-enabled npm dry run passed. The final freeze used ignore-scripts after the gates completed. No publish hook is defined.

The local pnpm-lock.yaml was inspected and remains ignored by Git. Its importer lists package-manager configuration rather than the manifest's full development dependency set. This phase used installed dependencies and process-local offline settings. A frozen-lockfile reconstruction of this development toolchain remains unverified.

## Dependency compatibility

- Standalone and absent-Inspectra checks passed using the exact frozen npm tarball in a fresh temporary consumer outside the repository. All 13 ESM/CJS entrypoints loaded, the optional adapter imported lazily, and Inspectra/Visynq failed to resolve as expected. All 16 offline SDK scripts completed successfully.
- With Inspectra, an offline install from the machine cache passed for `inspectra-engine@1.2.1` and the same frozen tarball. `npm ls shivax inspectra-engine` exited 0 and showed one deduplicated `shivax@0.3.3`. Importing the SHIVAX adapter and `inspectra-engine/node` returned the expected provider constructor and captureUIPage function. Capture/browser execution was outside this phase's dependency check.
- H08C-04 remains open for the future 0.4.0 version. Inspectra 1.2.1's SHIVAX dependency range excludes 0.4.x. H08-C observed a nested 0.3.2 copy with its staged 0.4.0 probe. The successful 0.3.3 install here supplies no closure for that finding.

Both installs used offline mode, ignore-scripts, no-audit, no-fund and package-lock=false, with neither force nor legacy-peer-deps. The sandbox cache lacked Inspectra. A retry outside that cache boundary used the machine cache and passed, with network access still disabled by npm offline mode.

An initial scratch attempt reused a temporary path across sandbox calls and failed because that path was unavailable. The failed directory change caused package-manager commands to run from the repository and fail with workspace/cache errors. Git status stayed clean. The successful attempt created, installed and verified its isolated consumer in one invocation.

## Local validation

All five required commands exited 0. Process-local pnpm settings were OFFLINE=true, VERIFY_DEPS_BEFORE_RUN=false, NODE_LINKER=hoisted and PACKAGE_IMPORT_METHOD=copy.

| Command | Actual result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm test` | 1,452 passed, 0 failed/skipped/cancelled/TODO |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS, fresh temporary installed consumer |
| `npm pack --dry-run` | PASS, 551 files |
| `node node_modules/h08-compat.mjs` | PASS, 13 exact maps and all baseline runtime names retained |
| Frozen npm artifact consumer | PASS, 13 ESM/CJS entries, seven-bot roster, tool-required registration and 16 offline examples |
| Cached Inspectra consumer | Install, dependency tree and import checks all exited 0 |

Package verification ran 186 gateway tests, 88 Hanuman bot tests, 13 H06 tests, 12 general offline examples, four H06 examples and worker training through ESM/CJS. It compiled declarations in Bundler, Node16 ESM/CJS and NodeNext ESM/CJS modes and bundled all ten browser-safe entrypoints. Its pnpm-produced verification tarball reported 550 files. The frozen npm tarball is the 551-file artifact identified above. Counts overlap with repository tests.

Logs are ignored `node_modules/h09-*.log`, with pack metadata in `node_modules/h09-pack.json`. Local results establish no CI status.

## Remaining issues and gate

The release remains blocked by H01D-02, H03C-01, absent H05 utilities and incomplete H07 canaries. H07-D also records non-cooperative transport resource retention. H08-C requires corrections to root-import claims, cancellation recovery wording and release description, plus a resolution of the Inspectra dependency range for 0.4.0. These issues were recorded without feature or policy edits.

**Local artifact construction and implemented-API validation passed. The v0.4.0 release candidate gate is FAIL / NO-GO.** H09-A ends with this artifact and report.
