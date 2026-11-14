# SHIVAX-C01 — Inspectra package compatibility

Started 2026-11-12; completed 2026-11-13 (Asia/Calcutta).

**Release gate: PASS for compatibility of the current SHIVAX 0.3.1 source.**
All five final consumers and all requested local gates pass. This does not
publish a package or certify untested platforms or future Inspectra artifacts.

## 1. Root cause and source audit

The original SHIVAX 0.3.0 manifest declared optional peer
`inspectra-engine: "1.0.4"`. Optional means the peer may be absent; it does not
allow an installed peer outside its range. A fresh npm install of the original
packed 0.3.0 with published Inspectra 1.1.0 reproduced `ERESOLVE`, identifying
`peerOptional inspectra-engine@"1.0.4"`. No bypass flags were used.

The first session tested a staged artifact with `^1.0.4` before applying the
range to SHIVAX. Published 1.0.4 and 1.1.0 passed, as did the then-current local
feedback checkout, still versioned 1.1.0. The original code was not relabeled as
1.2. During the pause, repository changes committed the compatibility fix and
advanced SHIVAX to 0.3.1; Inspectra published 1.2.0 and its local checkout
advanced to 1.2.1. Final verification used current SHIVAX at `faadd6d` plus the
matrix/documentation changes described below. No versions were reverted or
invented, and historical release entries were retained.

Audited actual paths:

| Path | Finding / disposition |
| --- | --- |
| `package.json` | Optional peer now `^1.0.4`; no mandatory runtime dependency added; 13 conditional ESM/CJS exports |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `node_modules/.pnpm/lock.yaml`, `.gitignore` | pnpm 12.8.1; root lockfile is ignored and contains package-manager bootstrap data; virtual-store lock records optional peer `^1.0.4` resolved to 1.2.0. Existing build allowlist retained. The resumed repository already overrides Rollup to `@rollup/wasm-node` for Windows Application Control; preserved |
| `rollup.config.mjs` | Root and subpaths of Inspectra externalized at package boundaries; no eager bundling or change needed |
| `adapters/inspectra/index.mjs`, `index.d.mts`, `package.json`, `README.md` | Lazy dynamic import, `captureUIPage`, strict normalization, lease identity, abort and cleanup preserved. Private nested manifest synchronized with SHIVAX 0.3 and the optional Inspectra range |
| `src/sdk/` | Reviewed all entry modules; Inspectra re-exports runtime and declarations; no source changes needed |
| `tests/inspectra-adapter.test.mjs`, `tests/inspection.test.mjs`, `tests/fixtures/inspectra-*` | Existing loader/API/normalization/cleanup coverage retained; error assertion updated to version-neutral guidance |
| `tests/firewall-model-integration.test.mjs` | 60 ESM/CJS regressions also run against each installed consumer |
| `scripts/check-inspectra-package.mjs` | Removed exact-version certification assertion; accepts stable 1.x >=1.0.4 and still checks real API behavior |
| `docs/production.md`, `docs/sdk.md`, `docs/release-readiness.md` | Compatibility and host responsibilities updated; dated history preserved |

## 2. Final compatibility matrix

Environment: Windows, Node v22.23.2, npm 10.9.8, pnpm 12.8.1, TypeScript 7.0.2,
Playwright 1.65.0 with Chromium headless shell build 1254. Published version list
was read from npm during the final run: 1.0.4, 1.1.0 and 1.2.0 are all stable
releases in `^1.0.4` at that time. Earlier releases are outside the range.

| Consumer | Clean npm install | `npm ls --all` | 13 ESM + CJS entries | Five TS modes | Real browser / security / cleanup | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| A: SHIVAX 0.3.1, no Inspectra | PASS | PASS | PASS | PASS | Missing-peer capture fails safely before page acquisition; live browser N/A; authorization/firewall checks pass | PASS |
| B: + published Inspectra 1.0.4 | PASS | PASS | PASS | PASS | PASS, both formats | PASS |
| C: + published Inspectra 1.1.0 | PASS | PASS | PASS | PASS | PASS, both formats | PASS |
| D: + published Inspectra 1.2.0 | PASS | PASS | PASS | PASS | PASS, both formats | PASS |
| E: + local Inspectra 1.2.1 candidate | PASS | PASS | PASS | PASS | PASS, both formats | PASS |

All installs used fresh directories outside repositories and the packed current
SHIVAX artifact. The candidate was packed from `D:/Project/packages/inspectra`
without editing it or running its build scripts. `npm install --no-audit --no-fund`
ran with lifecycle scripts and normal optional/peer resolution enabled. Neither
`--force` nor `--legacy-peer-deps` was used. Pack used `--ignore-scripts` only to
reuse the separately built and tested artifact; this is not an install bypass.

The five declaration modes are ESNext/bundler (`.ts`), Node16 (`.mts`, `.cts`),
and NodeNext (`.mts`, `.cts`), with strict checking, `skipLibCheck: false`,
ES2020 libraries and no ambient types. The real adapter uses its default lazy
loader in both ESM and CommonJS; Inspectra's own `/node` API is ESM-only.

Published Inspectra 1.0.4 and 1.1.0 depend on older SHIVAX minor lines, so npm may
install nested older SHIVAX copies for their own internals. Their capture data
still passes the current adapter's validation. Published 1.2.0 requires SHIVAX
`^0.3.1`; the local 1.2.1 candidate declares `^0.2.0 || ^0.3.0`. No dependency
overrides or edits to Inspectra were used to make these consumers pass.

## 3. Security and model regression

Each installed consumer ran 60 firewall/model integration tests: **300/300**
across five cases. The real-browser probe additionally exercised both formats:

- Unauthorized tool permissions and forged contexts denied before acquisition.
- A separately Jay-authenticated cross-tenant session denied before acquisition.
- Firewall enforce mode allowed the authorized fixture capture; lockdown denied
  later captures before acquiring any page.
- Disallowed start URLs and page fetch requests blocked by the allowlist.
- The trusted fixture host checked redirect destinations before following them;
  a forbidden destination aborted navigation and closed the context.
- Fresh isolated browser contexts bound to the exact host-supplied security
  contract; a copied contract was rejected and its page closed.
- Successful extraction preserved scope, untrusted status, heading font size,
  flex layout metadata, selectors and opaque screenshot references. Local paths
  did not appear in the observation.
- Closed-page extraction failures, cancellation during real extraction, rejected
  leases and failed redirect navigation all closed acquired contexts. No browser
  contexts remained after each scenario. Ordinary captures used no injected
  extractor; the cancellation probe triggered abort on the real page's evaluate.

The full **897/897** suite preserves RUDRA, all seven current specialist bots and
public IDs, token limits, exact cost accounting, Ekalavya feedback, SARASWATI
governance/model lifecycle, approval and rollback. Existing cancellation tests
also verify that the adapter awaits the original cleanup promise. No ML,
security, bot or learning implementation was rewritten, and no future bots
were introduced. Only adapter setup-error wording changed in runtime code.

## 4. Files changed

Initial C01 changes, already committed in the repository when work resumed:
`package.json`, `adapters/inspectra/package.json`, `adapters/inspectra/index.mjs`,
`tests/inspectra-adapter.test.mjs`, `scripts/check-inspectra-package.mjs`, new
`scripts/check-inspectra-matrix.mjs` and `scripts/inspectra-consumer-probe.mjs`,
plus README, adapter README, SDK/production documentation and changelog entries.
The unrelated original README/changelog/S07 edits were preserved.

Completion changes against resumed HEAD:

- `scripts/check-inspectra-matrix.mjs`: discover and record every published stable
  1.x release >=1.0.4, and record the actual SHIVAX version in results.
- `README.md`, `adapters/inspectra/README.md`, `docs/sdk.md`, `docs/production.md`,
  `docs/release-readiness.md`, `CHANGELOG.md`: final evidence and tested-version
  distinctions; new maintenance entry rather than rewriting past releases.
- `docs/audits/shivax-inspectra-c01.md`: this report.

The pnpm lockfile is locally regenerated and ignored, consistent with existing
repository policy. No source or config in Inspectra or Visynq was modified.

## 5. Actual verification results

| Check | Exit | Result |
| --- | ---: | --- |
| Original 0.3.0 artifact + Inspectra 1.1.0 | 1 | Expected `ERESOLVE` reproduces exact optional-peer defect |
| Staged `^1.0.4` matrix, first session | 0 | No provider, published 1.0.4/1.1.0, then-local feedback checkout all pass |
| `pnpm lint` | 0 | TypeScript and ESLint pass |
| `pnpm test` | 0 | 897 pass, 0 fail/cancelled/skipped/todo; includes clean build |
| `pnpm build` | 0 | ESM, CJS, shared chunks, worker and declarations; no build warnings |
| `pnpm verify:package` | 0 | Fresh packed consumer; 13 entries in both formats, 13 documented examples present, 11 offline examples run, worker training both formats, five declaration modes; 508 files |
| `npm pack --dry-run --json` | 0 | Normal prepack lint/test lifecycle passes; 509 files (npm also includes examples README) |
| `node scripts/check-inspectra-matrix.mjs` | 0 | All five final cases pass; 300 additional installed firewall/model tests |
| `node scripts/check-inspectra-package.mjs` | 0 | Missing-provider imports/errors and actual local 1.2.1 ESM/CJS capture, normalization, screenshot and cleanup pass |

Initial harness attempts were not counted as passes: sandbox DNS prevented the
first registry request; the clean Playwright install required Chromium 1254;
the probe initially declared screenshot writes read-only/used noncanonical
Windows paths; and a deliberately blocked image correctly prevented strict
Inspectra settling. The harness now declares authorized state-changing writes,
uses canonical paths, and tests blocked fetches without an incomplete required
image. Product security and extraction behavior were not relaxed. On resumption,
the Windows sandbox launcher failed before command execution; authorized commands
ran outside it. pnpm refreshed the local dependency state using normal policies.

## 6. Evidence and reproduction

Final matrix directory (outside every repository):
`C:/Users/URVISH/AppData/Local/Temp/shivax-c01-dB26Bb`.
Contains `results.json`, `registry-versions.json`, tarballs, per-case npm lockfiles,
`install.log`, `npm-ls.json`, `probe.log`, five type-check logs and `security.log`.
The packed runtime tested before the final documentation updates has SHA-256
`d3f311b299a836bdbba7afa1f9ca1dca7367c36548f501631825c23dc948fd04`.
The local Inspectra 1.2.1 candidate tarball has SHA-256
`a7b5fb015607cd5c6744d150f959059a49b554ea57777ead5b36b2a1cd705015`.
Documentation-only completion edits do not change that tested runtime.

From the current SHIVAX repository, in PowerShell:

```powershell
pnpm lint
pnpm test
pnpm build
pnpm verify:package
npm pack --dry-run
$env:SHIVAX_NPM_CLI = 'C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js'
$env:INSPECTRA_CANDIDATE = 'D:\Project\packages\inspectra'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\URVISH\AppData\Local\ms-playwright'
node scripts/check-inspectra-matrix.mjs
$env:INSPECTRA_ROOT = $env:INSPECTRA_CANDIDATE
node scripts/check-inspectra-package.mjs
```

Use paths appropriate to the host. Matrix execution retains its fresh temporary
directories as evidence and does not publish or modify other repositories.

## 7. Supported versions, remaining risks and gate

Optional peer: **`^1.0.4`**, stable >=1.0.4 <2.0.0. Published **1.0.4, 1.1.0 and
1.2.0** are verified; the **local 1.2.1 artifact** above also passes. Future 1.x
compatibility relies on semver and preservation of `captureUIPage(page, options)`
and the validated snapshot/metadata contract. Prereleases and 2.x are excluded;
no future version is claimed to have been tested.

Remaining limits: only Windows/Node 22.23.2/Chromium were run in C01, not Linux,
other Node versions, Firefox/WebKit, paid model endpoints or arbitrary live sites.
The browser fixtures are offline and cannot establish correctness of every
production host's DNS/proxy isolation or interception. Those remain trusted host
responsibilities. SHIVAX 0.3.0's published exact pin is not repaired retroactively;
integrated consumers need the corrected 0.3.1 line. Temporary evidence is local
and may be deleted by OS cleanup; this report records the durable summary.

**PASS — SHIVAX-C01 complete.** Standalone and integrated package use, security,
model/learning regressions and requested packaging gates passed on current source.
No push, tag, publication, Inspectra/Visynq modification or subsequent phase was
performed by this task.
