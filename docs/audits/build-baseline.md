# SHIVAX B00 — Build baseline audit

Date: 2026-11-01 (Asia/Calcutta). Package: `shivax@0.1.2`.
Audited commit: `551aa45fda54a3e5d169252fd5356017b046a4b9`.

## Scope and outcome

Inspected `tsconfig.json`, `rollup.config.mjs`, both package manifests, the Inspectra
adapter implementation/declarations, every `src/sdk` entry, root exports, build and
package-check scripts, and the existing tests. Read the local sibling Inspectra
manifest to check its actual dependency and engine declarations.

The current build succeeds with warnings. Lint and all 445 existing tests pass.
All 12 public entrypoints load in both runtime formats. CommonJS declaration
compatibility under TypeScript's `Node16` mode is broken across all 12 entries.
Optional Inspectra dependency metadata and documentation do not match its current
distribution through the main package.

Only this audit document was added. No source/configuration was edited, dependencies
installed, or package published. The normal build regenerated ignored `dist/`.
Temporary consumer probes were removed. Phase B00 ends with this audit; proposed
changes below are future work.

## Environment and baseline results

| Item | Observed value |
| --- | --- |
| Platform | Windows, PowerShell |
| Node | `v26.13.0` |
| pnpm | `12.8.1`, matching `packageManager` |
| npm | `11.20.0` |
| Installed TypeScript | `7.0.2` |
| Installed Rollup | `4.64.6` (manifest range `^4.63.6`) |
| Installed ESLint | `10.12.0` (manifest range `^10.11.0`) |
| Installed Prettier | `3.9.10` (manifest range `^3.9.9`) |
| Initial tracked worktree changes | None |

| Command or probe | Result |
| --- | --- |
| `pnpm lint` | Exit 0: `tsc --noEmit && eslint .` |
| `pnpm test` | Exit 0, including `pnpm build`; 445 passed, 0 failed/cancelled/skipped/todo; test-runner duration 1222.0516 ms |
| Build invoked by `pnpm test` | Exit 0: clean, TypeScript emit, two Rollup configurations; ESM 221 ms, CJS 131 ms in this run |
| Existing SDK runtime/identity tests | Passed for all public entries; shared root/subpath identities checked within each format |
| `npm pack --dry-run --ignore-scripts --json` | Exit 0; 299 package files; estimated archive size 335,920 bytes, unpacked 1,611,938 bytes |
| Runtime imports from package-file mirror | All 12 entries passed both `import` and `require`, with equal runtime export names |
| Package-file mirror: ESNext/bundler `.ts` consumer | Exit 0, all 12 entries, strict, ES2020-only lib, no ambient types, `skipLibCheck: false` |
| Package-file mirror: Node16 `.mts` consumer | Exit 0, same declaration checks |
| Package-file mirror: Node16 `.cts` consumer | Exit 1; TS1479 on all 12 entry imports |
| Package-file mirror: NodeNext `.cts` consumer | Exit 0 with installed TS 7; this mode permits newer Node require-of-ESM semantics |
| Source-checkout all-entry declaration probes | TS2307 for `shivax` inside `adapters/inspectra/index.d.mts`; Node16 `.cts` additionally reports TS1479 |

The package-file mirror was made by copying exactly the dry-run file list into a
temporary directory, then running self-referencing consumers there with the
already installed compiler. This checks shipped files without an install; it is
not an npm-installed-tarball test. No missing public export target or direct
relative declaration target was found. Compiler probes used target/lib ES2020,
strict checking, `types: []`, and `skipLibCheck: false`.

The existing `verify:package` script was inspected but not run: it calls
`npm install --offline` on a temporary tarball, conflicting with the no-install
constraint. `prepack` was not invoked separately; its lint/test components were
run directly. Watch modes, examples, browser/live Inspectra commands, fixture
refresh, dependency vulnerability audit, and publication were not run. Fixture
refresh would modify checked-in captures; live capture is outside the default
suite and requires an existing browser environment.

Raw execution logs are in the host temp directory as `shivax-b00-lint.log`,
`shivax-b00-test.log`, and `shivax-b00-pack.json`; they are not repository artifacts.

## Current build behavior and why Rollup runs twice

`build` is `node scripts/clean.mjs && tsc && rollup -c rollup.config.mjs`.
The cleaner removes only the fixed repository `dist/` directory. TypeScript emits
per-module JavaScript and `.d.ts` files from `src/` into `dist/`, retaining the
source directory structure. Tests are excluded from TypeScript compilation.

Rollup consumes the emitted JavaScript, plus the raw adapter `.mjs`. Its config
exports `['esm', 'cjs'].map(...)`: two independent configurations, each with 12
inputs, both writing to `dist/` with different entry and chunk names. There is one
Rollup CLI invocation, two graph builds, and one TypeScript emit per build command.
The repeated progress lines and warnings are expected from those configurations.

Each configuration creates shared chunks under `dist/chunks/esm/` or
`dist/chunks/cjs/`. This preserves class identity between root and subpaths within
one format. It does not unify ESM and CJS class instances across formats.
TypeScript intermediate `.js` files remain alongside the bundles; package `files`
includes the entire `dist/`, so intermediates and their declarations also ship.
Those intermediate files are not the entrypoints selected by `exports`.

`test` builds before invoking `node --test tests/*.test.mjs`. `test:watch` only
runs tests and can observe stale/missing generated output. `dev` only watches
TypeScript; it does not regenerate the Rollup entrypoints used by package imports.

## Warning root causes

### B00-W1: `THIS_IS_UNDEFINED` in TypeScript helpers

`target: ES2020` lowers TypeScript private fields/methods into WeakMap/WeakSet
machinery and inline helpers, for example:

```js
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (...) { ... };
```

There are 20 emitted modules containing these helper reuse guards, including
`dist/licensing/index.js`, `dist/learning/updates.js`, and
`dist/intelligence/registry.js`. `module: ESNext` makes them ES modules, where
top-level `this` is undefined. Rollup rewrites the guard accordingly and warns for
both output configurations. Generated chunks contain
`(undefined && undefined.__classPrivateFieldGet) || function ...`.

This is a generated helper guard, not evidence of broken instance `this` in SHIVAX
methods. The fallback helper remains selected and the baseline tests pass.
Changing global Rollup context to fabricate a top-level receiver would change
semantics and would not address the compiler/target mismatch.

Future choices require a compatibility decision: preserve ES2020 and handle only
this diagnosed generated warning, use a deliberate helper strategy, or raise the
syntax target to preserve native private fields. Raising the target affects
browser compatibility even though Node 22 supports newer syntax. No warning was
suppressed or compiler setting changed in B00.

### B00-W2: unresolved `inspectra-engine/node`

`adapters/inspectra/index.mjs:69` defaults `load` to a lazy
`import('inspectra-engine/node')`. Rollup's explicit external array contains
`'shivax'` and `'inspectra-engine'`, but not the imported `/node` subpath. The
unmatched bare specifier is unresolved; the config has no resolver plugin and the
dependency is absent from SHIVAX's installed resolution tree. Rollup warns and
leaves it external rather than failing the build. Both bundles retain the lazy
dynamic import, including CJS output; it is not converted into an eager `require`.

The sibling checkout existing at `../inspectra` does not make the package
resolvable from SHIVAX. A direct `require.resolve('inspectra-engine/node')` probe
reports `MODULE_NOT_FOUND`. Its manifest does export `./node`, so the observed
warning does not establish that the provider has a missing export.

Future configuration should explicitly externalize the intended subpath (or
deliberately match the package and its subpaths) while preserving optional lazy
loading. Installing/bundling Inspectra into core is not required to resolve this
configuration warning.

### Additional observed warning

Node 26 emits `[DEP0205] module.register() is deprecated` during the inspection
tests. `tests/inspection.test.mjs` registers `tests/fixtures/inspectra-loader.mjs`;
the live adapter script also uses registration. Tests still pass. This is test
loader maintenance, separate from either Rollup warning; it was observed on Node
26 and is not claimed to occur on minimum Node 22.

## Actual public SDK entrypoints

All targets below exist after the build. Paths are relative to package root.
The final column counts runtime exports, not erased TypeScript type exports.

| Public import | ESM | CommonJS | Declarations | Runtime exports |
| --- | --- | --- | --- | --- |
| `shivax` | `dist/index.esm.js` | `dist/index.cjs` | `dist/index.d.ts` | 108 |
| `shivax/core` | `dist/sdk/core.esm.js` | `dist/sdk/core.cjs` | `dist/sdk/core.d.ts` | 12 |
| `shivax/rudra` | `dist/sdk/rudra.esm.js` | `dist/sdk/rudra.cjs` | `dist/sdk/rudra.d.ts` | 14 |
| `shivax/bots` | `dist/sdk/bots.esm.js` | `dist/sdk/bots.cjs` | `dist/sdk/bots.d.ts` | 13 |
| `shivax/security` | `dist/sdk/security.esm.js` | `dist/sdk/security.cjs` | `dist/sdk/security.d.ts` | 6 |
| `shivax/models` | `dist/sdk/models.esm.js` | `dist/sdk/models.cjs` | `dist/sdk/models.d.ts` | 12 |
| `shivax/memory` | `dist/sdk/memory.esm.js` | `dist/sdk/memory.cjs` | `dist/sdk/memory.d.ts` | 10 |
| `shivax/integrations` | `dist/sdk/integrations.esm.js` | `dist/sdk/integrations.cjs` | `dist/sdk/integrations.d.ts` | 5 |
| `shivax/learning` | `dist/sdk/learning.esm.js` | `dist/sdk/learning.cjs` | `dist/sdk/learning.d.ts` | 12 |
| `shivax/diagnostics` | `dist/sdk/diagnostics.esm.js` | `dist/sdk/diagnostics.cjs` | `dist/sdk/diagnostics.d.ts` | 1 |
| `shivax/licensing/server` | `dist/licensing/index.esm.js` | `dist/licensing/index.cjs` | `dist/licensing/index.d.ts` | 2 |
| `shivax/adapters/inspectra` | `dist/sdk/inspectra.esm.js` | `dist/sdk/inspectra.cjs` | `dist/sdk/inspectra.d.ts` | 2 |

The nine named SDK inputs in Rollup are core, rudra, bots, security, models,
memory, integrations, learning, and diagnostics. `src/sdk/inspectra.ts` emits a
JavaScript/declaration bridge, but Rollup deliberately takes the adapter's raw
`.mjs` as its runtime input, naming that bundle `sdk/inspectra.*`.
Its `.d.ts` bridge reexports `../../adapters/inspectra/index.mjs`, whose type
counterpart is `index.d.mts`. Both bridge targets ship in the npm file list.

SDK surface review: core selects CPU/ML exports; rudra reexports agents and
workflows; bots, security and memory expose their corresponding modules; models
combines intelligence and SLM; integrations exposes inspection; learning includes
learning/training/updates; diagnostics provides `toSDKDiagnostic`. Licensing is a
separate input outside `src/sdk`. The root retains the broad existing API, without
eagerly exporting the Inspectra implementation. `main`, `module`, and `types`
agree with the root conditional exports. No advertised runtime target is missing.

## Inspectra dependencies and distribution

The root package has no production dependencies, optional dependencies, or peer
dependencies. Importing its root or adapter entrypoint succeeds without Inspectra.
Only capture using the default loader requires `inspectra-engine/node`; callers
can inject `load`. The adapter uses SHIVAX's root validator through an external
self-reference, and expects a host-provided page lease and cleanup implementation.
It does not launch a browser itself. Loader failures are sanitized to
`Inspectra capture failed.`, which limits installation diagnostics at capture time.

The private `@shivax/inspectra-adapter@0.1.0` manifest declares peers
`shivax: ^0.1.0` and `inspectra-engine: ^1.0.1`, with Inspectra optional, and Node
`>=22.15`. It exposes only ESM and `.d.mts`, is marked `private: true`, and is not
listed as a workspace package in `pnpm-workspace.yaml`.

The main tarball file list includes adapter `.mjs`, `.d.mts`, and README, but
omits that nested manifest. Its peer/engine metadata therefore does not apply to
the distributed `shivax/adapters/inspectra` entry. Consumers get no root-level
optional peer compatibility declaration. This is a metadata gap, not a missing
core runtime dependency. Any future peer declaration must preserve zero automatic
provider installation and consider the dependency relationship described below.

`adapters/inspectra/README.md` still says the adapter is not bundled into the
SHIVAX npm artifact and demonstrates `@shivax/inspectra-adapter`. Both conflict
with the root export map and observed package file list. The current public
distribution is `shivax/adapters/inspectra`.

The existing sibling checkout is `inspectra-engine@1.0.4`, not the `1.0.1` named
by adapter comments/docs and historical capture fixtures. It declares Node
`>=22.15`, an ESM `./node` export, and dependencies on Playwright, axe-core,
cspell, Lighthouse, and `shivax: ^0.1.2`. Its version satisfies the adapter's
`^1.0.1` peer range, but B00 did not validate live API compatibility against 1.0.4.
Making Inspectra an eager SHIVAX dependency would introduce a dependency cycle
and heavy browser/tooling dependencies; optional host integration should remain
an explicit design constraint.

## Additional export and packaging findings

### B00-E1: CommonJS declarations use ESM identity (confirmed)

Every export has a top-level `types` condition pointing to `.d.ts` inside a
`type: module` package. These are ESM declarations for both runtime branches;
there are no corresponding CommonJS `.d.cts` declarations/conditional mappings.
A strict `.cts` consumer under `module: Node16`, `moduleResolution: Node16`
reports TS1479 on all 12 imports, although runtime `require` succeeds.

The installed compiler's `NodeNext` mode accepts the package under newer Node
semantics, so the problem is mode-dependent. Neither that success nor the passing
bundler declaration tests establish Node16-mode compatibility. Existing
`tests/package.test.mjs` and `scripts/check-sdk-package.mjs` only exercise the
ESNext/bundler declaration mode; the prior release-readiness report had already
identified the Node16-mode problem. Future declarations must represent both
formats and their transitive type dependencies, with tests for actual ESM/CJS
consumer modes.

### B00-E2: adapter package boundary breaks source-checkout type resolution

The nested private manifest establishes a separate package scope named
`@shivax/inspectra-adapter`. Its `index.d.mts` imports types from `shivax`, but
that peer is not installed inside this checkout. Bare `shivax` there is not a
self-reference to the outer package. An ordinary strict all-entry consumer in
the repository fails with TS2307. The existing root declaration test supplies a
`paths` override for `shivax`, and inspection tests use a custom ESM loader, which
hide this distinction. The shipped-file mirror passes ESM declaration probes
because the nested manifest is absent from the package file list. Thus this is a
development/package-boundary issue, not a reproduced missing type in the tarball.

### B00-E3: reproducibility and API boundary considerations

`pnpm-lock.yaml` exists locally but `git ls-files -- pnpm-lock.yaml` returns no
tracked file; `.gitignore` explicitly excludes it. Its current root importer does
not record the root manifest's devDependencies. The installed versions above
are a baseline of this machine, not a reproducible fresh-checkout dependency set.
No installation was attempted to repair or validate the lockfile.

All of `dist/` ships, including TypeScript intermediates. This is extra package
weight and an implementation exposure consideration, but the explicit exports
map blocks undeclared package subpaths. There is no `./package.json` export;
metadata access by package subpath is intentionally unavailable unless added.
The `./core` facade also selects fewer types than the root (for example,
`Initialization`, `Activation`, and optimizer types remain root exports). These
are API design boundaries to document, not proven regressions or missing files.
The audit file itself is not selected by the current package `files` list.

## Minimum runtimes and compatibility limits

| Surface | Declared/observed requirement | Verification limit |
| --- | --- | --- |
| SHIVAX runtime package | Node `>=22` | Tested here only on Node 26.13.0; Node 22.0 floor not executed |
| Actual Inspectra capture | Node `>=22.15`, per adapter and sibling provider manifests, plus host browser/page environment | Not live-tested in B00; root engine field cannot express the higher optional-feature floor |
| TypeScript-emitted core | ES2020 syntax target, ESNext modules; ES2020 + DOM compile libs | Target is not a polyfill or a browser support matrix |
| Raw adapter input | Native private/public class fields, dynamic import, `structuredClone`, `AbortSignal.throwIfAborted` | Bypasses TypeScript lowering, so adapter bundles are not restricted to ES2020 syntax/API support |
| Installed build tools | TypeScript Node `>=16.20.0`; Rollup Node `>=18.0.0`, npm `>=8.0.0`; ESLint `^20.19.0 || ^22.13.0 || >=24`; Prettier Node `>=14` | Full lint/prepack with these tools needs at least Node 22.13 within the Node 22 line; this is distinct from library runtime support |

Node 22 covers the adapter's native class syntax and relevant globals, but the
provider's declared 22.15 floor still governs live capture. Core features use
platform APIs according to feature: agent/workflow execution uses AbortController,
model HTTP adapters use fetch, memory IDs need crypto.getRandomValues, and
IndexedDB persistence needs a browser host; Node file persistence accepts an
injected filesystem interface. The legacy ML test explicitly removes optional
provider/browser globals and still passes. Portable declarations do not guarantee
that every feature runs with ES2020 built-ins alone.

No minimum-browser versions are declared or verified. Raising TypeScript target,
altering CJS declaration conditions, adding peer metadata, or changing shared
chunk strategy requires explicit compatibility review. Mixing root/subpath
imports within a format is tested; mixing ESM and CJS can still produce distinct
class identities and affect `instanceof` checks.

## Files requiring consideration in a later phase

| Files | Required purpose / decision |
| --- | --- |
| `rollup.config.mjs` | Explicit external handling for Inspectra subpath; narrowly justified handling of generated helper warnings |
| `tsconfig.json` | Review target/helper emission strategy only after deciding browser and syntax compatibility; no blanket target bump is implied |
| `package.json` and declaration-generation setup | Conditional ESM/CJS type entrypoints; root optional-adapter metadata and package-file policy |
| `src/sdk/inspectra.ts`, `adapters/inspectra/index.d.mts`, `adapters/inspectra/package.json` | Reconcile adapter package boundary, local peer resolution, and shipped declaration graph |
| `adapters/inspectra/README.md`, `docs/sdk.md`, `README.md` | Align public adapter import/distribution, provider version claims, and core/tooling/feature runtime floors |
| `tests/package.test.mjs`, `tests/sdk.test.mjs`, `scripts/check-sdk-package.mjs` | Add meaningful Node16/NodeNext ESM/CJS declaration consumers and catch source-vs-package resolution differences |
| `tests/inspection.test.mjs`, `tests/fixtures/inspectra-loader.mjs`, `adapters/inspectra/test-live.mjs` | Review custom loader dependence and Node 26 registration deprecation while retaining supported Node 22 operation |
| `.gitignore`, `pnpm-lock.yaml` | Decide and restore a reproducible dependency-lock policy matching the manifest |

These are proposed follow-up change locations, not changes performed by B00.
Warning-free builds alone would not close the declaration, metadata,
reproducibility, or minimum-runtime verification gaps.
