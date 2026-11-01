# SHIVAX B01 — Optional Inspectra import

Date: 2026-11-01 (Asia/Calcutta). Package: `shivax@0.1.2`.
Baseline: [B00 build audit](build-baseline.md).

## Changes

- Retained the pre-existing working-tree Rollup predicate matching `shivax`,
  `inspectra-engine`, and their `/` subpaths. Inspectra's `/node` dynamic import is
  now explicitly external in both output formats. Prefixes such as
  `inspectra-engine-other` are not matched.
- Added `inspectra-engine: "1.0.4"` as an **optional peer** to the root manifest;
  aligned the private adapter manifest to the same exact tested version.
  Neither `dependencies` nor `optionalDependencies` was added. No provider code
  is bundled into SHIVAX.
- Kept `load = () => import('inspectra-engine/node')`, including in generated CJS.
  Imports and construction remain lazy. Loader rejection now returns fixed setup
  guidance; modules missing a callable `captureUIPage` return fixed compatibility
  guidance, including null/undefined module results.
- Kept normalization and security validation unchanged. Existing host execution
  checkpoints, cancellation precedence, host-owned page acquisition, single
  cleanup promise, awaited cleanup, and cleanup-error precedence are unchanged.
  No raw loader/capture exception, token, URL, path, or cause is attached.
- Updated adapter/SDK documentation and added failure-path tests for both formats
  plus a reusable isolated live integration check.

## Actual Inspectra 1.0.4 API verification

Queried npm metadata and installed the published `inspectra-engine@1.0.4` into an
isolated temporary consumer, with lifecycle scripts disabled. No Inspectra source
repository was modified. Registry integrity:

```text
sha512-gkk3Bz+FwC+8aWiZnzHcJPnTy62RvE3/olldEN/GZID3JYLNaXhz6a7XsWxOFopEe+wtdvDJtS0n5A9aGtk78Q==
```

The published `node/index.mjs` reexports `captureUIPage` from
`scanner/browser-snapshot.js`. The published declarations specify:

```ts
captureUIPage(page: Page, options: CaptureOptions & { screenshotPath?: string }): Promise<PageCapture>;
```

`CaptureOptions` includes the adapter's `scope`, `maxNodes`, `timeout`, and
`includeText`. `PageCapture` contains a SHIVAX `UISnapshot`, metadata sidecar, and
optional `{ path, width, height }` screenshot. Runtime extraction produces
`snapshot.sourceType: 'url'`, `metadata.nodes[node.id]` with `tag`, positional
`path`, and measured `flexGrid` data. The adapter's maximum of 64 nodes is within
Inspectra's supported 1–10000 range. These observations were verified in the
published implementation, not inferred solely from its broad metadata type.

Real Chromium capture through each built adapter's **default loader** confirmed:

- Scope and untrusted-observation validation succeed.
- Heading font size normalizes to 30px, positional selectors are retained, and
  the section's flex-direction sidecar normalizes to `column`.
- PNG screenshot files exist; results contain safe artifact references rather
  than the host screenshot path.
- Each capture acquires one isolated browser context and awaits one lease close.

The pre-existing live workflow check also passed against the installed npm
provider: capture → Narad → Yudhishthir → RUDRA, reference/target typography
30px/24px, screenshots, and two closed leases.

Compatibility is certified for **exactly 1.0.4**. No compatibility claim was made
for untested earlier/future versions. Runtime checks require the expected API;
the adapter does not read provider package metadata or promise to reject every
out-of-range module that has a structurally compatible API. Live execution still
requires Node >=22.15 and a host-owned Playwright page/browser environment.

## Validation

Environment: Windows, Node 26.13.0, pnpm 12.8.1, TypeScript 7.0.2,
Playwright 1.64.1 with existing Chromium 1248. No browser download was needed.

| Check | Result |
| --- | --- |
| `pnpm build` | Pass; no unresolved Inspectra warning in ESM or CJS |
| `pnpm lint` | Pass |
| `node --test tests/*.test.mjs` after build | 456 passed, 0 failed/skipped/cancelled |
| `node scripts/check-inspectra-package.mjs` with installed provider root | Pass: all 12 public imports work with provider absent; both adapters give setup guidance before page acquisition; ESM/CJS default-loader live capture with installed 1.0.4 passes |
| `node adapters/inspectra/test-live.mjs` with installed provider root | Pass: real provider, screenshots, workflow, cleanup |
| `npm run verify:package` | Pass: actual packed offline consumer, all 12 ESM/CJS import surfaces and ES2020/bundler declarations; 299 package files |
| Export/declaration preservation | `exports`, `main`, `module`, `types`, engines and adapter `.d.mts` unchanged; no `src/` changes |
| Inspectra source repository | Clean after verification; no modifications performed |

The missing-provider test uses a fresh isolated SHIVAX package layout with no
resolvable Inspectra, then links the independently installed npm provider for
the configured-provider phase. Separate processes prevent module-cache masking.
It does not substitute a mock for the provider or inject the adapter's `load`.
The live script installs nothing and removes its temporary package layout.

When `pnpm build` ran, this pnpm 12 environment automatically refreshed the
development dependency tree after the manifest change and installed the optional
peer into SHIVAX's own `node_modules`. This is development-checkout behavior,
not a new mandatory runtime dependency. Absence was therefore verified in the
isolated consumer rather than inferred from this development checkout. The
optional-peer metadata is present in the distributed root package manifest.

Automatic approval review rejected final removal of the isolated npm installation
as "blocked by policy". The temporary `shivax-b01-4380b61eee634ffc8f1603555fbe1b14`
consumer remains in the host temp directory. The integration script's separate
temporary package layouts and the packed-consumer check cleaned up successfully.

To repeat the default-loader live check after building, set `INSPECTRA_ROOT` to
an already installed `inspectra-engine@1.0.4` package directory and run
`node scripts/check-inspectra-package.mjs`. It requires an existing browser cache.

## Remaining limits

The B00 private-field helper warnings remain; suppressing them is outside B01.
The Node 26 test-loader deprecation and Node16-mode CommonJS declaration issue
also remain outside scope. Minimum Node 22.15 was not executed in this phase.
Provider API compatibility does not replace the application's URL, redirect,
subresource, authentication, isolation, or browser lifecycle policies.

No package publication occurred. Phase B01 stops here.
