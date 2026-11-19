# H08-A SDK and package preparation

19 November 2026, Asia/Calcutta. Reviewed commit `2c8f0e1`. Package remains `shivax@0.3.3`. Windows, Node v22.23.2, pnpm 12.8.1.

**H08-A acceptance gate — FAIL / BLOCKED.** Packaging validation passes for implemented features. H01, H03, H04, H05 and H07 prerequisite gates remain open in their reviewed reports. Jambavan and Kubera are absent. Their consumer verification cannot pass until those implementations exist. Live deployment and the 0.4.0 release remain NO-GO.

## Baseline and compatibility inventory

Baseline commit `37845c7f880d14a78fae0378a7c0b45fa1116005` identifies itself as 0.3.2. A fresh `git archive` was extracted into ignored `node_modules/h08-baseline` and built with the currently installed TypeScript and Rollup CLIs. The earlier H07 scratch directory was unsuitable because its compiled output had been used for cross-version testing. All comparisons below use the fresh build. This verifies source-level artifacts with the shared toolchain. Historical dependency installation was not reproduced.

The scratch comparator checked all 13 export mappings for exact equality, then checked every baseline runtime name against current ESM and CJS. All passed. The manifest's root `main`, `module` and `types` are `dist/index.cjs`, `dist/index.esm.js` and `dist/index.d.ts`. Conditional entries put `types` before `default` inside the `import` and `require` branches.

| Import | Runtime exports, 0.3.2 → current | ESM / CJS runtime paths under dist |
| --- | --- | --- |
| shivax | 187 → 202 | index.esm.js / index.cjs |
| shivax/core | 12 → 12 | sdk/core.esm.js / sdk/core.cjs |
| shivax/rudra | 14 → 25 | sdk/rudra.esm.js / sdk/rudra.cjs |
| shivax/bots | 14 → 18 | sdk/bots.esm.js / sdk/bots.cjs |
| shivax/security | 9 → 9 | sdk/security.esm.js / sdk/security.cjs |
| shivax/models | 13 → 13 | sdk/models.esm.js / sdk/models.cjs |
| shivax/memory | 13 → 13 | sdk/memory.esm.js / sdk/memory.cjs |
| shivax/integrations | 5 → 10 | sdk/integrations.esm.js / sdk/integrations.cjs |
| shivax/learning | 83 → 83 | sdk/learning.esm.js / sdk/learning.cjs |
| shivax/learning/node | 7 → 7 | sdk/learning-node.esm.js / sdk/learning-node.cjs |
| shivax/diagnostics | 1 → 1 | sdk/diagnostics.esm.js / sdk/diagnostics.cjs |
| shivax/licensing/server | 2 → 2 | licensing/index.esm.js / licensing/index.cjs |
| shivax/adapters/inspectra | 2 → 2 | sdk/inspectra.esm.js / sdk/inspectra.cjs |

For each runtime stem, the import declaration is its sibling `.d.ts`, for example `dist/sdk/bots.d.ts`. Require declarations use the equivalent path inside `dist/types-cjs/`. That tree contains a `package.json` declaring CommonJS and preserves shared declaration identities. The adapter's original `adapters/inspectra/index.d.mts` supplies the generated CJS counterpart. The build uses this dual `.d.ts` graph instead of generating `.d.cts` entry files. Consumer `.mts` and `.cts` files compile in Node16 and NodeNext.

Runtime name and mapping comparisons establish export retention. They do not prove structural compatibility of every historical type signature. The existing legacy declaration consumer tests and the five packed-consumer compilation modes supply additional coverage.

## Implemented functionality and public boundaries

| Phase | Actual public surface |
| --- | --- |
| H01 | `shivax/integrations` exports `registerHanumanFetchService`, `HanumanFetchError`, constants `HANUMAN_BOT_ID`, `HANUMAN_FETCH_CAPABILITY`, `HANUMAN_FETCH_TOOL_ID`, and transport/result types. It reuses protected execution in `shivax/security`. |
| H02 | Root and `shivax/bots` export `HanumanBot`, `registerHanumanBot`, `HANUMAN_FETCH_URL_CAPABILITY`, `HANUMAN_RESERVED_CAPABILITIES` and input/evidence/options types. |
| H03 | Existing `RudraOrchestrator` and `RudraWorkflowEngine` execute registered bots and tools. Explicit routing eligibility remains a reviewed gap, H03C-01. |
| H04 | Root and `shivax/rudra` export `runAbhimanyuPreflight`, `createAshwatthamaObserver`, `validateSafetyProfiles`, `validateSafetyWarning`, `WorkflowSafetyError`, rule/default/limit constants and associated types. |
| H05 | No discovery or budget reporter factories exist. The approved contract alone supplies no runtime API. |
| H06 | Shipped SDK examples and the host-owned fake transport live under `examples/sdk/hanuman`. |
| H07 | Shabari runner and test fixtures remain in `tests/`, excluded from the installed package. |

This phase adds no public exports or subpaths. Diagnostics are implemented at `src/sdk/diagnostics.ts`. There is no `src/diagnostics/` directory.

Hanuman registration remains explicit and requires the existing registered tool. The package tests preserve the seven default IDs, including `vishwakarma`, and gateway authorization. `fetch.api` and `research.search` are reserved and unavailable. Host transport registration and permission checks remain necessary before retrieval.

## Changes made

- `scripts/check-sdk-package.mjs` now bundles all ten browser-safe export graphs in the isolated installed consumer. Previously it checked root, bots and integrations. It rejects unresolved or external imports from those graphs.
- The same verifier checks installed contents for LICENSE, NOTICE and the CJS declaration boundary. It rejects packaged tests, node_modules, Git data, environment files and log files.
- The declaration consumer now uses H04 preflight and lifecycle types through `shivax/rudra` in all five resolution modes.
- Added this report at `docs/audits/hanuman-h08-sdk.md`.

The initial plan identified conditional declaration resolution and Node imports in browser graphs as the principal packaging regression risks. The expanded installed-consumer checks exercise those boundaries directly.

## Module and optional integration results

Browser graph validation covers root, core, rudra, bots, security, models, memory, integrations, learning and diagnostics. The explicit Node learning worker entry stays separate. Licensing/server and the optional Inspectra adapter remain separate package boundaries.

The packed consumer loads all 13 ESM and CJS entrypoints. It runs worker training through both module formats. TypeScript compiles all 13 declaration entries with strict checking and no ambient platform types in Bundler, Node16 ESM/CJS and NodeNext ESM/CJS modes.

The optional Inspectra peer remains `^1.0.4`. Release-readiness records previous tests of 1.0.4, 1.1.0 and 1.2.0 plus a local 1.2.1 candidate. These integrations were not installed or rerun here. The adapter dynamically loads `inspectra-engine/node` when used. Packed imports and offline examples succeeded with neither Inspectra nor Visynq installed. No mandatory Playwright or runtime dependency was added.

The declared engine is Node >=22. Execution here verifies Node 22.23.2 only. Other engine-compatible Node versions remain untested in this phase.

## Package contents and validation evidence

The existing files allowlist ships dist, the optional adapter, selected documentation and SDK examples with their offline host fixtures. Internal Shabari fixtures and local logs are excluded. The installed-content check passed. Filename checks cannot establish the absence of every possible embedded secret.

All commands below exited 0. The shell used offline dependencies and process-local settings `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`.

| Command | Actual result |
| --- | --- |
| `pnpm lint` | PASS, TypeScript and ESLint |
| `pnpm test` | 1,452 pass, 0 fail, 0 skipped, 0 cancelled, 0 TODO |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS using a freshly packed tarball installed offline into a temporary consumer outside the repository, without force or legacy peer overrides |
| `npm pack --dry-run` | PASS, 551 files, 771.5 kB packed, 3.5 MB unpacked |
| `node node_modules/h08-compat.mjs` | PASS for 13 exact export maps and retention of every baseline runtime name in ESM and CJS |

The package verifier reports 550 files for its pnpm-produced package. It passes 186 gateway tests, 88 bot tests and 13 H06 integration tests, executes 12 offline SDK examples and four H06 examples, and compiles declarations in five modes. These counts overlap the repository test suite. It also validates the packaged browser graphs and the absence of Inspectra/Visynq in the consumer.

Logs are ignored local files `node_modules/h08-{lint,test,build,package,pack,compat}.log`. Baseline commands were `git archive --format=tar --output=node_modules/h08-baseline.tar 37845c7`, `tar -xf node_modules/h08-baseline.tar -C node_modules/h08-baseline`, then from the archive directory `node ../typescript/bin/tsc -p tsconfig.json`, `node scripts/build-cjs-declarations.mjs`, and `node ../rollup/dist/bin/rollup -c rollup.config.mjs`.

The first scratch comparator could not resolve package self-reference from inside node_modules. It was corrected to compare explicit artifact paths. A first baseline compiler invocation used the wrong working directory and failed before compilation. The successful fresh baseline build and comparison above replace those attempts.

## Remaining issues

The prerequisite reviews retain H01D-02 for the missing reviewed connection-level host transport, H03C-01 for implicit routing eligibility, H05 missing utilities, and H07 incomplete canary coverage. H04 still requests independent acceptance review. H07-D additionally records non-cooperative transport cleanup limitations. Packaging checks supply no evidence closing those findings.

The stale Narasimha package description remains for H08-B editorial review. This phase's package and module checks pass. Full HANUMAN acceptance remains blocked by the implementation and security gates above.
