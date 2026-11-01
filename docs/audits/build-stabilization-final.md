# SHIVAX — Build stabilization final acceptance

Date: 2026-11-01 (Asia/Calcutta). Package: **shivax@0.1.2**, unchanged.

**Stage 1 COMPLETE.** All five required commands pass. The previously blocking
TS1479 errors now pass in the permanent packed-consumer verification matrix.
This acceptance result supersedes the earlier incomplete B04 review.

## Declaration fix

`package.json` now selects declarations within each import/require condition.
ESM keeps the existing `dist/**/*.d.ts` targets. CommonJS selects a parallel
`dist/types-cjs` graph with a `package.json` containing `type: commonjs`.
The root legacy `types` field is retained. All runtime import/require target
filenames and the public entrypoint names remain unchanged.

`scripts/build-cjs-declarations.mjs` copies the entire emitted declaration graph,
including the adapter's declaration counterpart, after TypeScript compilation.
The CommonJS adapter bridge points inside that graph rather than crossing into
an ESM `.d.mts` file. Shared root/subpath declarations preserve private class
identity within each format. The build cleans dist before generating either
format; declarations are derived from the existing sources, not maintained as
independent API definitions.

The packed verifier now installs into a fresh project under the OS temporary
directory, outside the repository, and checks every public entrypoint in five
strict declaration-consumer modes. It also assigns root/subpath Tensor and Jay
types, passes Jay to ServerLicenseGate, checks the Inspectra provider contract,
and checks rejection of an invalid Tensor argument. No checks were removed.
Cleanup is guarded and runs in finally; the failure-cleanup regression was
updated to inspect the external temporary directory.

## Exact acceptance commands

Executed on Windows Node **22.23.2**, pnpm **12.8.1**, TypeScript **7.0.2**.

| Command | Exit | Actual result |
| --- | --- | --- |
| `pnpm lint` | 0 | Strict no-emit TypeScript and ESLint pass |
| `pnpm test` | 0 | Clean rebuild; **466 tests, 466 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**; test-runner duration 1768.5743 ms |
| `pnpm build` | 0 | Clean emit, CommonJS declaration generation, ESM/CJS Rollup; no warnings; output times 278 ms and 164 ms |
| `pnpm verify:package` | 0 | 12 packed runtime entries in ESM/CJS; all five declaration modes pass; 411 files |
| `npm pack --dry-run` | 0 | Prepack reruns lint and tests: **466 pass, 0 fail, 0 cancelled, 0 skipped**; 411 files, approximately 329.0 kB compressed |

`npm run verify:package` also passes on Node 22.23.2. The pnpm verifier passes
again on Windows Node **24.22.2** and **26.13.0**, including all five type modes.
These additional runs use the installed Node versions without switching the
system-wide selected installation.

## Declaration and package matrix

Every row covers all **12** public entrypoints, strict checking,
`skipLibCheck: false`, ES2020-only libraries and no ambient platform types.

| Consumer | Resolution | Result on Node 22/24/26 verifier runs |
| --- | --- | --- |
| `.ts` / ESNext | bundler | PASS |
| `.mts` / Node16 | Node16 | PASS |
| `.cts` / Node16 | Node16 | PASS — previously 12 TS1479 errors |
| `.mts` / NodeNext | NodeNext | PASS |
| `.cts` / NodeNext | NodeNext | PASS |

The archive grows from 299 to **411** files: 110 copied declaration files, one
adapter declaration counterpart, and the CommonJS package-scope marker account
for the 112 added files. The existing `files: ["dist", ...]` policy includes this
graph automatically. Runtime exports still resolve to the same ESM/CJS files;
no library code or new runtime dependency is added. Preserve `dist/types-cjs`
and its package.json when copying a package manually.

`node scripts/check-inspectra-package.mjs`, with INSPECTRA_ROOT selecting the
installed 1.0.4 package, passes again: all public imports without Inspectra,
then real default-loader ESM/CJS capture, normalization, screenshots and cleanup.
Inspectra remains an optional peer certified for exactly 1.0.4. No dependency
ownership or engine requirement changed.

## Required confirmations

1. **PASS:** no unexplained Rollup warnings, no global warning suppression.
2. **PASS:** no pnpm.exe JavaScript execution error.
3. **PASS:** source compilation and all five tested declaration modes pass.
4. **PASS:** packed ESM and CommonJS runtime imports load.
5. **PASS:** every public SDK entrypoint resolves.
6. **PASS:** optional Inspectra imports and live integration remain compatible.
7. **PASS:** RUDRA, workflow, agent and specialist tests remain in the green suite.
8. **PASS:** existing security and licensing regression tests pass.
9. **PASS:** ML training, inference, Tensor, NeuralNet and digit tests pass.
10. **PASS:** runtime public API and signatures are unchanged; the authorized
    declaration-resolution fix changes only how TypeScript finds matching types.

## Review of prior phases

- [B00](build-baseline.md): established the 445-test baseline, helper warnings,
  unresolved optional import and CJS declaration limitation.
- [B01](optional-inspectra-b01.md): resolved the optional import warning, added
  tested optional-peer metadata and sanitized setup errors.
- [B02](typescript-helpers-b02.md): ES2022 removed generated helper warnings;
  explicit assignment semantics preserved field behavior.
- [B03-F1](package-verifier-b03-f1.md): corrected native/JavaScript/wrapper process
  dispatch and added safe cross-platform verification tooling.
- [B03-F2](sdk-package-b03-f2.md): verified the actual external npm consumer,
  optional dependency ownership and artifact contents; confirmed the declaration
  failure now resolved by this follow-up.

## Files changed by the declaration follow-up

- `package.json`: conditional type targets and declaration-generation build step.
- `scripts/build-cjs-declarations.mjs`: generated CommonJS declaration graph.
- `scripts/check-sdk-package.mjs`: external consumer and five-mode type matrix.
- `tests/package-process.test.mjs`: external temporary-directory cleanup check.
- `docs/sdk.md`: conditional declaration and package-layout guidance.
- `docs/audits/build-stabilization-final.md`: this completed acceptance record.

No `src/` implementation changes, package version bump, or publication occurred.
The existing ML, RUDRA, firewall/security and licensing behavior was preserved.
`git diff --check` passes. Earlier phase changes remain in the working tree.

## Remaining work outside Stage 1

The known model-router reported-usage-overrun and fractional-cost defects still
need focused regressions and fixes; build stabilization does not claim to repair
them. Remote Linux/Windows CI has been configured but not executed here. The
lockfile policy and historical-browser coverage limits remain documented.
ES2022 requires compatible browser engines or consumer dependency transpilation.
Mixed ESM/CJS runtime class identities remain separate, as before.

**Stage 1 COMPLETE; ready to begin model-router fixes. No publication.**
