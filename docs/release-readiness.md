# Release readiness

## SHIVAX-C01 compatibility gate (2026-11-13)

**PASS for the current SHIVAX 0.3.1 source.** The task started on 0.3.0; the
repository advanced to 0.3.1 before final verification. No version was changed
by the completion run. All 897 regression tests pass. Lint, build, SDK package
verification and `npm pack --dry-run` pass. Clean npm consumers pass with no
Inspectra, published 1.0.4, 1.1.0 and 1.2.0, and the local 1.2.1 candidate,
including ESM/CJS, five declaration modes, real offline Chromium capture and
security/cancellation/cleanup checks. The optional peer remains `^1.0.4`.

The complete evidence, artifact hashes and limits are in
`docs/audits/shivax-inspectra-c01.md` in the source repository. This is a
compatibility gate, not a new publication or a replacement for platform CI.
No Inspectra or Visynq source was modified; nothing was pushed, tagged or published.
The dated release records below are preserved.

> **Current source: version 0.3.2 SARASWATI.** 0.3.2 is a maintenance patch
> that adds the SHIVAX-C01 compatibility audit and matrix updates; no runtime
> behavior changed from 0.3.1.
>
> **Previous (2026-11-12): version 0.3.1 SARASWATI.** 0.2.0 was published on
> 2026-11-07 and 0.3.0 on 2026-11-12. 0.3.1 widens the optional Inspectra peer to
> `^1.0.4` (verified against 1.0.4, 1.1.0 and 1.2.0). 897/897 tests pass on Node
> 22.23.2 (Windows). The SARASWATI reports are in `docs/audits/` in the source
> repository (not included in the npm package). Sections below are the R10, R09 and
> earlier records, kept as written at the time.

## Status at R09 (2026-11-07, Asia/Calcutta)

**Decision: R09 documentation and SDK packaging work is complete. Nothing was
published.** Releasing these changes still needed a version decision
and the open items below.

### Version and registry state

- `package.json`, `VERSION` in `src/index.ts`, README, SDK guide and SECURITY.md
  all state 0.1.3.
- npm registry, checked 2026-11-07: published versions `0.0.0-stage`, `0.1.2` and
  `0.1.3`; `latest` is 0.1.3, published 2026-11-01T18:24Z with `gitHead`
  `551aa45`. Version 0.1.1 was never published. Version 0.1.0 has a registry
  timestamp but is no longer listed.
- The published 0.1.3 tarball was downloaded and inspected. It contains no
  `createShivaxFirewall`, no `usage-unverifiable` code and no internal cost module.
  The R01, R02 and firewall (R04–R07) work was therefore not yet in a release
  at R09. It shipped in 0.2.0 (see `CHANGELOG.md`).
- These changes include a breaking behaviour change (R02 fail-closed token
  usage). Under 0.x semantic versioning, `^0.1.3` ranges would pick up a 0.1.x patch
  automatically, so the next release should be a minor version.

### Historical findings now resolved

| Finding (Phase 10, 2026-10-29) | Status | Evidence |
| --- | --- | --- |
| P1: malformed output masks reported usage overrun (`ModelRouter`) | **Resolved in R02.** The overrun now fails with `usage-limit` (reason `token-limit-exceeded`), fallback never runs, and later calls are blocked. The original R00 reproduction passes 4/4 in the standard test gate. Released in 0.2.0. | [`docs/audits/shivax-r02.md`](audits/shivax-r02.md), `tests/model-safety.test.mjs`, `tests/router-audit.test.mjs` |
| P2: fractional USD accumulation rejects an affordable call (`ModelRouter`) | **Resolved in R01.** Exact integer cost accounting: three $0.10 calls fit $0.30, the fourth is rejected; ten fit $1. Released in 0.2.0. | [`docs/audits/shivax-r01.md`](audits/shivax-r01.md), `tests/model-cost.test.mjs` |
| P2: CommonJS TypeScript consumers fail with TS1479 | **Resolved in 0.1.3** (published). Conditional CommonJS declaration graph; checked in five consumer modes by `verify:package`. | [`docs/audits/build-stabilization-final.md`](audits/build-stabilization-final.md) |
| Rollup private-field helper and unresolved optional Inspectra warnings | **Resolved in 0.1.3** (published). No build warnings in the R09 build. | `CHANGELOG.md` 0.1.3 |

The audit reports linked above are in the source repository; they are not
included in the npm package.

### Open items

1. **Visynq demo startup cancellation (Phase 10 review item 2).** This is in the
   separate Visynq Workstation application, not in ShivAX. As of 2026-11-07 its
   `start()` still awaits `jay.createContext` without publishing a terminal state,
   so cancelling during startup leaves the demo `queued`. Not changed in R09.
2. ~~**Workflow model path (R03 G02).**~~ **Fixed in the pre-R10 review**; see
   *Pre-R10 code review* below.
3. **Live permission refresh (R03 G04).** Session revocation works; changing a
   live session's grants does not. Documented as a limitation.
4. ~~**Intermittent test failure.**~~ **Root-caused and fixed in the pre-R10
   review** (test timing and temp-directory isolation; no product defect).
5. **CI coverage.** The GitHub Actions workflow (Linux/Windows, Node 22/24/26)
   runs only on the GitHub mirror, whose default branch `Beta/0.1.0` was last pushed
   2026-11-01. No CI run exists for any post-0.1.3 change. R09 checks ran locally
   on Windows with Node 22 only.
6. **Lockfile.** `pnpm-lock.yaml` is in `.gitignore` and not committed; CI uses
   `--no-frozen-lockfile`.
7. **Security reporting.** GitHub private vulnerability reporting is disabled on
   the public repository. The GitLab project previously named in SECURITY.md
   returns 404 to anonymous users. SECURITY.md now directs reporters to request a
   private channel through a detail-free GitHub issue.
8. **Audit records.** R05 and R06 have no standalone audit reports; their
   behaviour is documented in `docs/sdk.md` and covered by
   `tests/firewall-integration.test.mjs` and `tests/firewall-model-integration.test.mjs`.

### R09 changes

- SDK examples now ship in the package (option A): `examples/sdk/*.mjs`,
  `examples/sdk/README.md` and `examples/autonomous-workflow.mjs`, which
  `rudra.mjs` imports. Added `examples/sdk/firewall.mjs`. The React demo is no
  longer described as package content. The repository's recorded inspection
  fixture JSON is used only by that separate application and stays out of the package.
- `scripts/check-sdk-package.mjs` now checks that every example named in shipped
  documentation is in the tarball and runs the five offline examples from the
  installed copy.
- `package.json`: added `repository`, `bugs` and `homepage` for the public GitHub
  repository; added `docs/production.md` and the examples to `files`.
- New `docs/production.md`. Updated README, `docs/sdk.md`, SECURITY.md,
  CHANGELOG (0.2.0 section), `examples/README.md` and the Inspectra adapter README.

Package metadata checked: Apache-2.0 license with `LICENSE` and `NOTICE` packed;
`engines.node` `>=22` (the Inspectra adapter needs 22.15+, as documented);
optional peer `inspectra-engine` pinned to 1.0.4, which exists on npm under
Apache-2.0 with `engines.node >=22.15`; 12 conditional ESM/CommonJS export entries.
No license or distribution terms were changed.

### R09 verification

Executed on Windows, Node v22.23.2, pnpm 12.8.1, from the repository root. No paid
model API, Ollama server, browser or network service was used. Nothing was published.

| Command | Exit | Actual result |
| --- | ---: | --- |
| `pnpm lint` | 0 | TypeScript no-emit and ESLint passed |
| `pnpm test` | 0 | Clean build, then **774 tests: 774 pass, 0 fail**, 0 cancelled, 0 skipped, 0 todo; no build warnings |
| `pnpm verify:package` | 0 | Packed install outside the repository; 12 ESM/CommonJS entry points; 7 documented examples present; 5 offline examples ran from the installed copy; declarations in five consumer modes; 452 packaged files |
| `npm run verify:package` | 0 | Same checks with npm; 453 packaged files (npm also packs `examples/README.md`) |
| `npm pack --dry-run` | 0 | `shivax@0.1.3`, 453 files, 415.1 kB packed, 2.0 MB unpacked; no tarball written |

The first R09 `verify:package` run failed as intended: the new documented-example
check found a shipped document naming an example path that is not packed. That
wording was corrected, and the final runs above passed. `pnpm lint` and `pnpm test`
ran before that one-line documentation correction.

The 774 tests include, counted per file on 2026-11-07 (each file runs its cases in
both ESM and CommonJS): `firewall` 66, `firewall-integration` 58,
`firewall-model-integration` 60, `firewall-management` 40, `model-safety` 42,
`model-cost` 38 and `router-audit` 4 (the original R00 reproductions). Node 24/26 and Linux were not run in R09.

## Pre-R10 code review (2026-11-07)

Manual review of the security-critical source: firewall runtime, policy,
operations, binding and management; Jay, Vijay and protected tool leases;
`ModelRouter`, remote and Ollama adapters; the guarded model gateway; memory
resource checks; the Inspectra adapter; and the workflow model path. Plus
`pnpm audit` and a load test of the suite.

### Fixed

| # | Severity | Finding | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Medium | **R03 G02, unverified usage.** `ToolRegistry.registerModel` accepted `null` or missing token counts from token-based providers, so usage limits could not be enforced on that path. | Usage is read with the R02 `usageReport` (no accessors invoked). Missing, `null` or malformed usage on a token-based provider fails the action with no retry. | `tests/workflows.test.mjs` "R03 G02: unverifiable token usage…" |
| 2 | Medium | **R03 G02, terminal errors retried.** A thrown hard model failure (token/cost/usage limit, unverifiable usage, timeout, declared output failure) became a generic `tool-error` and was retried up to `maxRetries`, spending extra calls. | Only `provider-error`, `unavailable` and non-model errors stay retryable, matching `ModelRouter` fallback rules. | "R03 G02: thrown hard model failures are not retried…" |
| 3 | Low | **Workflow cost arithmetic.** The reservation summed prices and token rates as floating-point numbers before rounding, unlike the exact R01 ledger. | Exact BigInt arithmetic; the provider receives a fully funded `maxCostUSD`, and a charge equal to that cap is accepted. | "model tools reserve exact funded cost…" |
| 4 | Test | **Intermittent suite failure.** Under CPU load (four parallel suites), 30 of 40 runs failed. 29 failures were the package-process cleanup test, which checked the shared OS temp directory. The others were tests with 10–30 ms wall-clock windows in which work had to start or finish before the deadline; a second stress pass found one more. No product defect was involved: the router checks `busy` synchronously, and those timeouts were real. | The cleanup test uses a private temp directory. Six windows were widened to 250–300 ms. | Stress results below |

All three G02 regressions fail against the previous `registry.ts` and pass with
the fix. Existing workflow tests pass unchanged.

### Reviewed, no change needed

- Firewall: no await between final checks, budget reservation and dispatch; every
  await before a policy commit is followed by an epoch/version/authorization
  recheck; lockdown blocks every non-CPU kind; monitor relaxes only optional denies.
- Protected-execution bypass tags use a closure-private owner object.
- Management: commands are snapshotted before any await, a single mutation slot
  has no await gap, and authorization is rechecked around the durable commit.
- Jay/Vijay: identity comes only from minted contexts; permissions, policy identity
  and input predicates are rechecked after approval and before dispatch.
- File checks are exact matches that fail closed on case, alias and relative paths.

### Not fixed, reported

- **`pnpm audit`: 2 moderate advisories, development and optional-peer only.**
  `minimatch` < 11.0.1 (GHSA-g3hv-75wg-m249) through `eslint`, and `glob` ≤ 14.0.1
  (GHSA-3g3m-2fjr-6pw4) through `inspectra-engine` → `lighthouse` → `@sentry`.
  Neither is in the ShivAX package. The latest `eslint` (10.14.0) still requires
  `minimatch ^10`, so there is no non-breaking upgrade yet. The `glob` path is in
  the separate `inspectra-engine` package.
- **Ollama `localhost`.** The adapter accepts `localhost` as well as `127.0.0.1` and
  `[::1]`; `localhost` relies on the host resolver. Low severity; unchanged for
  compatibility.
- **R03 G04** (live permission refresh) remains a documented limitation.

### Stress results

Load test: four full suites in parallel, repeated, on Windows with Node v22.23.2.

| Tree | Suite runs | Runs with a failure |
| --- | ---: | ---: |
| Before the review fixes | 40 | 30 |
| After the first fixes | 40 | 1 (a sixth timing window, then widened) |
| Final | 60 | **0** |

Sequential runs before the fixes: 54 more passed, after one failure in the first
`pnpm test` of the day.

Final gate on the reviewed tree, same environment:

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm lint` | 0 | Passed |
| `pnpm test` | 0 | **778 tests: 778 pass, 0 fail**, 0 cancelled, 0 skipped; no build warnings (774 plus 4 new G02 regressions) |
| `pnpm verify:package` | 0 | 12 entry points, 7 documented examples present, 5 offline examples ran, five declaration modes; 452 files |
| `npm run verify:package` | 0 | Same checks with npm; 453 files |
| `npm pack --dry-run` | 0 | `shivax@0.1.3`, 453 files, 418.5 kB; no tarball written |

## Historical record: Phase 10 report (2026-10-29, shivax 0.1.2)

The text below is preserved as written on 2026-10-29. Statuses above supersede
its blocker and review findings. References to Visynq describe the author's
separate application, which is not distributed with ShivAX.

Date: 2026-10-29 (Asia/Calcutta). Package: shivax 0.1.2.

**Decision (2026-10-29): Phase 10 SDK/demo implemented; review fixes pending; publication blocked.**
No package publication, production operation or deployment was performed.

### Phase 10 review and retest

> **Status (2026-11-07):** issue 1 was resolved in 0.1.3
> ([evidence](audits/build-stabilization-final.md)). Issue 2 is in the separate
> Visynq application and remains open; see *Open items* above.

Review date: 2026-10-29. Two additional reproducible Phase 10 issues need fixes:

1. **P2: CommonJS TypeScript consumers cannot use the declared SDK subpaths.**
   The unconditional `types` condition in package.json points at ESM `.d.ts`
   declarations for both runtime formats. A `.cts` consumer importing Jay from
   `shivax/security` and ServerLicenseGate from `shivax/licensing/server`, compiled
   with `module: Node16` and `moduleResolution: Node16`, fails with TS1479 for
   both imports. Reproduced with the installed TypeScript 7 compiler and Visynq's
   TypeScript 5 compiler. Runtime `require` succeeds; the current package check
   only compiles ESNext/bundler consumers and misses this mismatch. Supply matching
   CommonJS declaration entry points/dependencies and conditional type mappings,
   then check actual ESM and CommonJS TypeScript consumers of the packed package.
   The root had the same mapping before Phase 10; the new subpaths extend it.
2. **P2: cancellation during initial authentication leaves the demo queued.**
   `createShivaxDemo.start` publishes `queued`, then awaits Jay context creation
   outside a terminal-state error handler. Cancelling at that await rejects start;
   the page displays the cancellation message but never clears its busy status.
   A React regression probe clicked Run and Cancel before flushing promises:
   progress remained `queued` and Run stayed disabled. Publish a terminal
   cancellation/failure state for startup errors and verify the user can start
   another task. Existing cancellation tests wait until approval and miss this.

The existing suites again passed: **445 ShivAX tests and 214 Visynq tests**.
The additional cancellation regression probe failed as described above; the two
CommonJS compile probes produced TS1479. Temporary probes were removed after
recording their results. No implementation code was changed during this review.
Both builds, ShivAX type checking/lint, all 12 packed runtime imports and the
existing ES2020/bundler declaration check passed. Registry, CPU inference, RUDRA
and file persistence examples passed. Chromium approval/denial and the actual
Inspectra capture/review workflow passed, including page cleanup. The two older
ModelRouter blockers below were independently reproduced again. ML source and
the dataset hash below remain unchanged. Browser/runtime matrix limits still apply.

The clean SDK build also emits an unresolved external warning for the optional
`inspectra-engine/node` import, in addition to the private-field-helper warnings.
It remains lazy in the output and the injected live adapter test passes.

### Release blockers reconfirmed

> **Status (2026-11-07): both blockers below are resolved and shipped in 0.2.0.**
> Blocker 1 was fixed in R02 ([evidence](audits/shivax-r02.md)); blocker 2 was
> fixed in R01 ([evidence](audits/shivax-r01.md)). The line numbers below refer to
> the 2026-10-29 source.

Two previously documented Phase 05 defects remain in ModelRouter. They were
reproduced again during this phase and were not hidden by passing regression tests:

1. **P1: malformed output masks reported usage overrun.** In
   `src/intelligence/router.ts:235`, output validation precedes usage-overrun
   handling. With one permitted output token, a provider returning invalid numeric
   data and reporting two output tokens becomes `invalid-output`; compatible
   fallback then succeeds. Reproduced result: completed, attempts invalid-output
   and completed. Enforce reported-usage limits before allowing invalid-output
   fallback and add a regression before release.
2. **P2: fractional USD accumulation rejects an affordable call.** In
   `src/intelligence/router.ts:213`, three $0.10 calls under a $0.30 limit produce
   completed, completed, cost-limit due to floating-point addition. Correct the
   accounting boundary and add a three-call regression before release.

The Phase 08 workflow model-tool path has separate conservative nanodollar
accounting and does not fix these earlier ModelRouter defects. Core CPU/rules
examples in this phase do not rely on the affected paid/fallback paths.

### Delivered architecture

- Existing package name/version and compatible root exports retained. VERSION now
  matches package.json at 0.1.2; the stale 0.1.0 runtime constant was detected and fixed.
- Twelve supported entry points covering core, RUDRA, specialists, security, models,
  memory, integrations, optional Inspectra, learning, diagnostics and server licensing.
- Shared Rollup chunks preserve class identity across root/subpath imports within
  ESM and CJS. Optional runtimes remain lazy and absent from core dependencies.
- Structured diagnostics use fixed messages without copying unknown errors or secrets.
- ServerLicenseGate validates an entitlement from a trusted host verifier against
  Jay identity, tenant scope, product, feature, expiry, session and cancellation.
  Lemon Squeezy HTTP/webhook/billing verification remains future server adapter work.
- Real Visynq React route `/shivax`, lazy-loaded, displays user request, selected bots,
  progress, bot results, explicit approval, reviewed inspection issues and final result.
  It uses recorded Inspectra evidence and a labelled local mock identity. Actual
  capture stays in the separate adapter; the existing live runner remains separate.

### Acceptance evidence

| Check | Result |
| --- | --- |
| Clean ShivAX TypeScript/Rollup build | Passed, ESM/CJS shared chunks and declarations |
| Full ShivAX regression suite | 445 passed, zero failed/cancelled/skipped; includes security/ML/package checks and four new SDK tests |
| TypeScript --noEmit and ESLint | Passed |
| Public root/subpath identity | All supported shared ESM/CJS exports retain identity within their format |
| Packed offline consumer | All 12 ESM/CJS imports and ES2020-only declarations passed; 299 packaged files |
| Visynq TypeScript/Vite production build | Passed; lazy demo chunk 174.72 kB (40.14 kB gzip), main JS 438.04 kB (140.55 kB gzip) |
| Full Visynq Vitest suite | 214 passed across 24 files, including four new demo tests |
| Focused demo tests after cleanup fix | Four passed; approval, denial, scope disposal and cancellation |
| Chromium workstation smoke | Approved workflow returned measured findings; denied workflow failed; no page errors; external requests blocked |
| Actual Inspectra integration | captureUIPage -> Narad -> Yudhishthir -> RUDRA passed; two isolated pages, screenshots, 30px/24px finding, both leases closed |
| CLI examples | Registry, actual local neural inference, RUDRA workflow and actual file persistence passed |
| ML preservation | Neural/tensor/metrics/text/visual/SLM source and digit demo unchanged against HEAD |
| Dataset SHA-256 | D76F8820EACA279A14BE7FF62AF07BD4FB8DDDFDD4CCBA9855E6E620BFE200D9, unchanged |

Execution used Node v24.19.0, Windows, installed Chromium and existing local tool
binaries. No minimum-Node-22 matrix, Firefox/WebKit matrix or live remote/Ollama
model inference was run. The Ollama example requires a host-installed model.
Existing Rollup private-field-helper warnings remain non-fatal. The optional
Inspectra live check emits its existing module-type warning. No dependency install
or lockfile change was needed for either workspace; the packed consumer install
was offline and ignored lifecycle scripts.

### Reproduction commands

Build with installed local tsc/Rollup or the existing build script, then:

- `node --test tests/*.test.mjs`
- `npm run verify:package` (local pack, offline install, consumer types/imports, cleanup)
- `node examples/sdk/registry.mjs`
- `node examples/sdk/local-model.mjs`
- `node examples/sdk/rudra.mjs`
- `node examples/sdk/memory-persistence.mjs`
- In Visynq: `npm run build` and `npm test -- --reporter=dot`
- Start Visynq at 127.0.0.1:4185; run `node scripts/check-workstation-browser.mjs`
- With PLAYWRIGHT_BROWSERS_PATH set to the existing cache:
  `node adapters/inspectra/test-live.mjs`

### Changed files

ShivAX:
- package.json, rollup.config.mjs, src/index.ts.
- src/sdk/core.ts, rudra.ts, bots.ts, security.ts, models.ts, memory.ts,
  integrations.ts, inspectra.ts, learning.ts, diagnostics.ts.
- src/licensing/index.ts and tests/sdk.test.mjs.
- scripts/check-sdk-package.mjs and scripts/check-workstation-browser.mjs.
- examples/sdk/registry.mjs, local-model.mjs, ollama.mjs, rudra.mjs,
  memory-persistence.mjs, inspectra.mjs and inspection-fixture.json.
- README.md, CHANGELOG.md, docs/sdk.md, docs/release-readiness.md,
  docs/SHIVAX_ARCHITECTURE.md and docs/SHIVAX_PHASES.md.

Visynq Workstation:
- src/app/App.tsx and src/app/navigation.ts.
- src/lib/shivax-demo.ts and src/pages/ShivaxDemoPage.tsx.
- src/test/shivax-demo.test.tsx and docs/shivax-sdk.md.
- vite.config.ts and tsconfig.json (SDK mapping and legacy Inspectra type aliases).

### Practical limits

The generic license gate is host code, not browser security or a billing provider
implementation. Real authentication and secrets stay on the server/desktop host;
entitlement never bypasses Vijay. Mock identity and fixture reads are demo-only.
The demo uses user text as task metadata, not unrestricted agent instructions.
Memory, models and browser services still require explicit host adapters/policies.
Pause/resume, rollback and the demo's results remain in-process; cancellation is
cooperative. Consumer code must keep generated shared chunks. ESM and CJS do not
share runtime identities across formats. The known budget blockers above must be
resolved before a release decision. No subsequent phase was started.
(2026-11-07: those budget blockers are now resolved; see the current status above.)
