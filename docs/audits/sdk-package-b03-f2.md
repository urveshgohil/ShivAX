# SHIVAX B03-F2 — Actual SDK package verification

Date: 2026-11-01 (Asia/Calcutta). Package: shivax@0.1.2.
Environment: Windows, Node 22.23.2, pnpm 12.8.1, TypeScript 7.0.2.

**Result: runtime/package verification passes; Node16-mode CommonJS TypeScript
declarations fail. This is not an unconditional compatibility pass.**

## Commands and artifact

| Check | Result |
| --- | --- |
| `pnpm build` | Exit 0, clean ESM/CJS build, no Rollup warnings |
| `pnpm verify:package` | Exit 0; all 12 packed ESM/CJS entries and ES2020/bundler declarations; 299 files |
| `npm pack --dry-run` | Exit 0; prepack runs lint and tests; 299 files |
| Actual npm pack and offline installation outside repository | Exit 0; package installed into a fresh OS-temp project, with lifecycle scripts disabled |
| All public runtime imports in external consumer | All 12 ESM and 12 CommonJS imports pass; export-name parity passes |
| Optional Inspectra live integration | Exit 0; default loader in ESM/CJS, real 1.0.4 capture, normalized observations, screenshots, cleanup |
| Process/cleanup regressions | 8 passed, 0 failed/skipped/cancelled |

The existing verifier creates its consumer under the repository. F2 additionally
created an independent project under the OS temporary directory, packed the
actual npm tarball there, and installed it using npm offline with no scripts,
audit, funding prompt or package lock. This avoids source-checkout self-reference
masking. Every declared subpath was imported from that installed package.

Artifact: 299 files, 323,117 compressed bytes, 1,474,599 unpacked bytes.
SHA1: `9161d14c867f5e65fed433b3cc841cfdc14629d2`.
All 36 declared types/import/require targets exist. Required LICENSE, NOTICE,
README, SECURITY, CHANGELOG, SDK documentation, adapter runtime and adapter
`.d.mts` files are present. Source, tests, node_modules and temporary consumer
files are not included. The package still includes TypeScript intermediates
under dist, as specified by its existing files policy.

## Inspectra ownership

`pnpm ls inspectra-engine --depth 0` reports 1.0.4 under dependencies in the
development checkout. This is the installed-tree state described in B01: pnpm
prepared the package's own development peers. It is not a mandatory dependency
declaration in the published manifest.

Both source and npm-installed SHIVAX manifests have no `dependencies` or
`optionalDependencies` field. They declare:

```json
{
  "peerDependencies": { "inspectra-engine": "1.0.4" },
  "peerDependenciesMeta": { "inspectra-engine": { "optional": true } }
}
```

The fresh external npm consumer contains no inspectra-engine installation, and
dynamic import of `inspectra-engine/node` rejects with `ERR_MODULE_NOT_FOUND`.
Root SHIVAX and every SDK entry still import successfully in both formats.
Constructing and attempting capture through the installed adapter returns fixed
installation guidance without acquiring a page. The separate live integration
script then tests the installed compatible provider in an isolated package
layout. It passes both ESM/CJS default-loader paths and closes each page lease.

The architecture is therefore optional as intended. Dependency ownership,
version range and runtime requirements were not changed in F2. Live provider
compatibility remains certified for exactly 1.0.4.

## Declaration results and exact failure

All probes use strict checking, no emit, ES2020-only libraries, no ambient types,
and `skipLibCheck: false`, against the actual installed npm package.

| Consumer mode | Result |
| --- | --- |
| `.ts`, ESNext/bundler | Exit 0 |
| `.mts`, Node16/Node16 | Exit 0 |
| `.cts`, NodeNext/NodeNext | Exit 0 with installed TypeScript 7.0.2 |
| `.cts`, Node16/Node16 | **Exit 1: 12 TS1479 diagnostics** |

Exact diagnostic for the root import:

```text
consumer.cts(1,21): error TS1479: The current file is a CommonJS module whose imports will produce 'require' calls; however, the referenced file is an ECMAScript module and cannot be imported with 'require'. Consider writing a dynamic 'import("shivax")' call instead.
```

The identical diagnostic occurs for `/core`, `/rudra`, `/bots`, `/security`,
`/models`, `/memory`, `/integrations`, `/learning`, `/diagnostics`,
`/licensing/server`, and `/adapters/inspectra`, replacing the module name in the
suggested dynamic import. Locations are lines 2–10 column 21 and lines 11–12
column 22. The complete exact compiler output is retained in the host-temp log
`shivax-f2-external.log`.

Cause: unconditional types conditions map both runtime formats to ESM `.d.ts`
files in a type-module package. Runtime require works, but Node16-mode TypeScript
does not accept those declarations for emitted require calls. This previously
reported limitation is confirmed against the installed tarball. It was not
silently fixed, skipped, or treated as passing because newer NodeNext accepts it.

## Cleanup and secrets inspection

The external project's finally block removed its entire exclusively created
directory; a subsequent existence check returned false. No `.shivax-sdk-pack-*`
directories remained after the standard verifier. The existing eight process
tests also passed, including cleanup after an intentionally failed pack command.
The live adapter checker removed its separate temporary layout.

Scanned the paths and contents of all 299 installed package files. No secret-file
paths (`.env`, `.npmrc`, private-key filenames/extensions), private-key headers,
npm/GitHub/AWS credential patterns, or OpenAI-style secret-token patterns matched.
No secret values were printed. **No secrets detected by this inventory/content
scan**; pattern scanning cannot prove the absence of arbitrary unrecognizable
credentials. Only the shipped artifact was inspected, not unrelated host files.

Logs: `shivax-f2-dryrun.log`, `shivax-f2-external.log`, and
`shivax-f2-cleanup.log` in the host temporary directory.

F2 added only this audit. No runtime, dependency metadata, public exports,
declarations, package version or ownership changes were made. No publication.
Stopped after B03-F2; the Node16-mode declaration failure remains open.
