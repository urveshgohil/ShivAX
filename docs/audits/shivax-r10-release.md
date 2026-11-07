# SHIVAX R10 - Security and release verification

Date: 2026-11-07 (Asia/Calcutta)
Status: **R10 complete. Recommendation: conditional GO** (no P0 issues; two
mandatory pre-publish steps, listed in section 9). Nothing was published, tagged
or released, and the license is unchanged.

## 1. Versions and source

| Item | Value |
| --- | --- |
| Source revision | `f34d811` on `feat/shivax-firewall`, plus the uncommitted R10 file `tests/release-r10.test.mjs` and this report |
| `package.json` version | 0.1.3 |
| `VERSION` in `src/index.ts` | 0.1.3 |
| Latest npm version | 0.1.3 (published 2026-11-01T18:24Z, `gitHead` `551aa45`), checked 2026-11-07 |
| Contents of published 0.1.3 | No firewall, R01 cost module or R02 `usage-unverifiable` code (tarball downloaded and inspected in R09) |
| Unreleased changes | R01, R02, R04–R07 firewall, R09 packaging and docs, pre-R10 G02 fix. Two are marked **Breaking** in `CHANGELOG.md` |
| Dry-run tarball | `shivax-0.1.3.tgz`, 453 files, 418.8 kB packed, 2.0 MB unpacked, shasum `a7df1a7c2d541a14430f748c60ea1475c34efd01` |

The source cannot be published as 0.1.3: that version already exists on npm with
different contents. See section 9.

## 2. Commands and exact results

Windows 11, from the repository root. Mock providers, transports and stores only;
no paid model API, live browser, Ollama server or external network.

| Command | Node | Exit | Result |
| --- | --- | ---: | --- |
| `pnpm lint` | 22.23.2 | 0 | TypeScript no-emit and ESLint passed |
| `pnpm test` | 22.23.2 | 0 | Clean build, then **792 tests: 792 pass, 0 fail**, 0 cancelled, 0 skipped, 0 todo |
| `pnpm build` | 22.23.2 | 0 | Clean, TypeScript, CommonJS declarations, ESM and CommonJS Rollup; 0 warnings |
| `pnpm verify:package` | 22.23.2 | 0 | 12 entry points ESM/CJS, 7 documented examples present, 5 offline examples ran, 5 declaration modes; 452 files |
| `npm run verify:package` | 22.23.2 (npm 10) | 0 | Same checks; 453 files |
| `npm pack --dry-run` | 22.23.2 | 0 | 453 files; no tarball written |
| `node --test tests/*.test.mjs` | 24.22.2 | 0 | **792 tests: 792 pass, 0 fail** |
| `node scripts/check-sdk-package.mjs` (npm 11.19.1) | 24.22.2 | 0 | All entry points, examples and 5 declaration modes; 453 files |
| `node --test tests/*.test.mjs` | 26.13.0 | 0 | **792 tests: 792 pass, 0 fail** |
| `node scripts/check-sdk-package.mjs` (npm 11.20.0) | 26.13.0 | 0 | All entry points, examples and 5 declaration modes; 453 files |

Node 24 and 26 ran the suite against the `dist/` built by Node 22; build output
does not depend on the Node version. Packed verification installs the tarball
into a fresh project outside the repository and checks ESM `import`, CommonJS
`require`, and TypeScript consumers in `.ts` (ESNext/bundler), `.mts`/`.cts`
(Node16) and `.mts`/`.cts` (NodeNext) under strict ES2020-only settings.

**No failing tests.** The 792-test suite has no failing, cancelled or skipped
tests on any of the three Node versions. The pre-R10 load test (60 parallel suite
runs, 0 failures) is recorded in `docs/release-readiness.md`.

### Test counts by file

| File | Tests | File | Tests |
| --- | ---: | --- | ---: |
| agents | 31 | model-cost | 38 |
| class-fields | 2 | model-safety | 42 |
| digit-playground | 8 | neuralnet-core | 15 |
| digit-pointer | 1 | package-process | 8 |
| digit-preprocess | 17 | package | 5 |
| digit-training | 9 | **release-r10 (new)** | **14** |
| digit-worker | 2 | router-audit | 4 |
| firewall-integration | 58 | rudra | 32 |
| firewall-management | 40 | sdk | 4 |
| firewall-model-integration | 60 | security | 38 |
| firewall | 66 | slm | 25 |
| foundations | 9 | specialists | 26 |
| inspection | 37 | ui-analysis | 20 |
| inspectra-adapter | 11 | visual-matching-review | 7 |
| intelligence | 24 | visual-matching | 13 |
| learning | 17 | visual | 10 |
| memory | 51 | workflows | 48 |
| **Total** | | | **792** |

Firewall, router, model-safety and R10 suites run each case under both ESM and CommonJS.

## 3. Step 1 - Router regressions

| Requirement | Representative passing tests |
| --- | --- |
| Exact decimal cost budgets | `R00 $0.30 permits exactly three $0.10 calls`; `decimal cost boundaries preserve exact affordable calls and round fractional reservations conservatively`; `firewall exact global model cost budget admits three calls and rejects the fourth`; `R06 three exact ten-cent charges fit and the fourth is blocked`; `model tools reserve exact funded cost and accept a charge equal to the provider cap` |
| Token-limit overrun detection | `R00 malformed output cannot hide reported token overrun`; `input overruns win before cyclic, oversized or accessor model data`; `reported overrun is recorded even above the lifetime budget`; `R06 malformed token overrun is terminal and never falls back` |
| Terminal hard-limit behaviour | `token overrun precedes malformed data and prevents all fallback and reuse`; `R03 G02: thrown hard model failures are not retried; ordinary provider errors still are`; `R03 G02: unverifiable token usage from a token-based model tool is terminal and never retried` |
| Safe provider fallback | `R06 verified malformed output permits fallback and charges both attempts`; `R06 fallback cannot dispatch after the prior attempt exhausts the cost budget`; `R06 route deadline bounds non-cooperative providers without starting fallback` |
| Concurrent request restrictions | `concurrent and reentrant calls cannot reserve the same budget`; `firewall concurrent model operations share exact reservations before provider dispatch`; `R06 concurrent gateway requests reserve the shared budget before dispatch` |
| Cancellation and late usage | `cancelled retains ownership and accounts late token overruns once`; `timeout retains ownership and accounts late token overruns once`; `cancelled/timeout work retains reservations and reconciles late excess once`; `late unverifiable provider failure blocks reuse after cancellation` |

## 4. Step 2 - Firewall security

| Requirement | Representative passing tests |
| --- | --- |
| Default enforce mode | `firewall starts enforce, executes an explicit allow and freezes snapshots`; `firewall default deny applies in enforce and monitor` |
| Monitor keeps mandatory controls | `firewall monitor bypasses only explicit optional deny rules`; `provider capability allowlist is mandatory in monitor` |
| Lockdown | `firewall lockdown cancels cooperative work and revokes retained checkpoints`; `integrated firewall R04 explicit CPU execution uses its own single reservation in lockdown`; `R06 lockdown during an active attempt cancels and blocks fallback and concurrent dispatch` |
| Administrator-only changes | `firewall unauthorized or unapproved administration never changes policy`; `firewall administrator role revoked during approval cannot publish a relaxation`; `firewall late administrator authorization cannot commit after timeout`; R07 unauthorized-action tests for every management operation |
| Provider permissions | `R06 local/remote provider enabled/disabled`; `R06 remote gateway defaults disabled and prompt data cannot grant permission`; `R06 remote legacy-only transport is denied in protected mode` |
| Tool permissions | `unknown tool requests and attempts to inject grants into tool arguments are rejected`; `integrated firewall concurrent tools retain separate leases and reentrant engines stay busy` |
| Bot privilege boundaries | `integrated firewall delegation cannot expand tool grants or expose administrative authority`; `integrated firewall a second controller cannot reuse the bound controller’s dispatch authority` |
| Tenant isolation | `firewall` tenant/session violation tests; `R10 direct gateway bypass attempts never reach the provider` (other-tenant root) |
| Memory permissions | `R06 protected memory derives scope from identity and blocks injected namespace`; `memory tools deny missing permissions, missing tool IDs, denied approval and namespace injection`; `R06 file memory requires actual file and pending sibling permissions` |
| Inspectra restrictions | `R06 protected Inspectra binds session, rejects unapproved subresources and closes once`; `R06 Inspectra rejects unacknowledged leases and closes late acquisition after lockdown` |
| Audit redaction | `audit records exclude secrets, raw identity/task/session IDs and unregistered tool names`; firewall audit redaction/overflow tests; `R10 prompt-injected input and provider errors never reach audit records` |

## 5. Step 3 - Adversarial tests

New in R10 (`tests/release-r10.test.mjs`, 7 cases × ESM/CJS = 14 tests, all pass):

| Test | What it proves |
| --- | --- |
| `lockdown during in-flight remote inference denies the transport and blocks later calls` | Lockdown while a guarded remote transport is mid-request aborts its signal; the transport's required recheck before I/O throws; nothing is sent; the reservation is kept; later calls fail with `lockdown` |
| `lockdown during Inspectra capture denies subresources and closes the page once` | After the page is open, a subresource check through the acknowledged contract is denied and the page is closed exactly once |
| `invalid provider and policy URLs are rejected at construction` | Remote endpoints with `http:`, credentials, query, fragment, other schemes or garbage; Ollama base URLs for private, link-local, public or credentialed hosts or with a path; firewall origins with a path, credentials, `javascript:` or `file:` |
| `direct gateway bypass attempts never reach the provider` | Copied or prototype-derived roots, a root from another Jay, another tenant's root, unregistered or non-model route IDs, a forged runtime object and non-boolean route options: provider call count stays 0 |
| `concurrent mode changes from one version publish exactly once` | Three concurrent admin updates from version 1: one wins, the others fail `version-conflict`; a stale version is still rejected afterwards |
| `stale approval after a version change cannot publish its candidate` | A second update cannot start while one awaits approval; a later update with the old version is rejected |
| `prompt-injected input and provider errors never reach audit records` | Injected input asking for monitor mode or admin rights changes nothing; secret text from input or provider errors is absent from audit records |

Already covered and passing: `prompt injection cannot change the host policy or
create planner-selected security actions`; `unknown tool requests and attempts to
inject grants into tool arguments are rejected`; `R07 stale versions and
simultaneous requests cannot lose updates`; `integrated firewall policy replacement
during approval cannot revive stale authorization`; `async approval deadline cannot
revive a late approved operation`; `R06 remote lazy loading rechecks lockdown
before network dispatch`; `client-supplied user/session IDs and copied authentic
contexts are not proof of identity`; `R06 protected memory derives scope from
identity and blocks injected namespace`.

## 6. Step 4 - Existing functionality retained

| Area | Evidence |
| --- | --- |
| Tensor and NeuralNet | `foundations` (9), `neuralnet-core` (15), `class-fields` (2) |
| Training and inference | `neuralnet-core`, `digit-training` (9), `digit-worker` (2), `digit-playground` (8); example `local-model.mjs` runs from the packed install |
| JSON model serialization | `serialization restores all tasks exactly and returns independent arrays`; `serialization rejects malformed, nonfinite, oversized and executable fields`; `neural provider predictions equal the existing trained engine and never mutate serialized weights` |
| Seven specialist bots | `specialists` (26), `agents` (31); example `registry.mjs` lists all seven |
| RUDRA workflows | `rudra` (32), `workflows` (48); example `rudra.mjs` |
| Jay/Vijay | `security` (38) |
| Memory services | `memory` (51); example `memory-persistence.mjs` |
| Learning and evaluation | `learning` (17) |
| Optional Inspectra | `inspectra-adapter` (11), `inspection` (37); `inspectra-engine` stays an optional peer pinned to 1.0.4 |
| Licensing APIs | `license gate accepts only server-verified subject, scope, product, feature and unexpired grants`; `revocation, cancellation and provider failures deny licenses without disclosing secrets`; packed declaration checks |

Public entry points, export map, root exports and bot names are unchanged since 0.1.3.
New APIs are additive. The two intentional behaviour changes are listed in section 8.

## 7. Published-file inspection

`npm pack --dry-run`: 453 files. 431 are under `dist/` (ESM, CommonJS, shared
chunks and both declaration graphs). The other 22 are `package.json`,
`README.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE`, `NOTICE`, three Inspectra
adapter files, `docs/sdk.md`, `docs/production.md`, `docs/release-readiness.md`,
`examples/README.md`, `examples/autonomous-workflow.mjs`, and seven files plus a
README under `examples/sdk/`.

No source, tests, scripts, audit reports, source maps, lockfiles, tarballs,
`.env`, key or certificate files are included. pnpm packs 452 files because it
does not auto-include `examples/README.md`; both variants pass verification.
License: Apache-2.0, `LICENSE` and `NOTICE` present, unchanged. `engines.node` is
`>=22`; the optional Inspectra adapter documents Node 22.15+.

## 8. Security limitations and compatibility notes

**Intentional breaking behaviour (documented in `CHANGELOG.md`):**

1. R02: token-based `ModelRouter` providers must report verifiable token counts;
   otherwise `usage-unverifiable` is terminal.
2. Pre-R10: workflow `registerModel` tools apply the same rule, and hard model
   failures are no longer retried.

**Trust boundaries (unchanged; documented in `SECURITY.md` and `docs/production.md`):**

- An npm library cannot stop host JavaScript from bypassing it. The firewall covers
  registered managed paths only; raw `ModelRouter`, memory adapters and host I/O
  stay host-owned.
- Network and file checks are declared contracts. Real egress, DNS, redirect,
  symlink and subresource enforcement belongs to the trusted transport, browser,
  proxy, OS or sandbox.
- Cancellation is cooperative and cannot undo committed effects or prove billing stopped.
- Budgets, policy history and audit rings are per process. Durable policy needs the
  R07 host store; budgets are not persisted.
- Provider prices and usage reports are host claims, not verified invoices.
- Jay snapshots permissions at authentication (R03 G04): revoking a session works,
  but changing a live session's grants does not.

## 9. Outstanding issues

| # | Priority | Issue | Status |
| --- | --- | --- | --- |
| 1 | **P1, pre-publish** | Version is 0.1.3, which is already on npm with different contents. npm will refuse it, and the breaking changes need a new minor version under 0.x semver. | Bump to **0.2.0** in `package.json`, `src/index.ts`, README, the SDK guide and SECURITY.md, and date the `Unreleased` CHANGELOG section. Not done in R10 (version changes need your approval). |
| 2 | **P1, pre-publish** | No Linux run. The GitHub Actions matrix (Ubuntu/Windows × Node 22/24/26) only runs on the GitHub mirror, last pushed 2026-11-01. This machine has no WSL distribution or Docker. | Push the branch to GitHub and confirm the workflow passes. Not done (pushing needs your approval). |
| 3 | P2 | `pnpm-lock.yaml` is gitignored; CI installs with `--no-frozen-lockfile`. | Recommend committing the lockfile. |
| 4 | P2 | GitHub private vulnerability reporting is disabled. SECURITY.md asks reporters to request a private channel. | Recommend enabling it in the repository settings. |
| 5 | P3 | `pnpm audit`: 2 moderate advisories (`minimatch` via eslint, `glob` via `inspectra-engine` → lighthouse → @sentry). Development and optional-peer only; not in the package. No non-breaking upstream fix yet. | Monitor. |
| 6 | P3 | Ollama accepts `localhost` as a loopback host, which depends on the OS resolver. | Unchanged for compatibility. |
| 7 | P3 | R03 G04 live permission refresh. | Documented limitation. |
| 8 | Info | Denial error codes differ by path: the gateway surfaces Jay's `unauthenticated`, `runtime.execute` reports `denied` or `unauthorized`. All deny; none leaks data. | Consider normalizing in a later minor version. |
| 9 | Info | Visynq Workstation demo stays `queued` if cancelled during startup. Separate application, not in this package. | Fix in Visynq. |
| 10 | Info | Live Inspectra capture (`adapters/inspectra/test-live.mjs`, needs a browser) and live Ollama/remote inference were not run in R10. | Mock-based coverage only. |

**No P0 issues are open.**

## 10. Recommendation

**Conditional GO** for releasing the current source as **0.2.0**, once:

1. the version is bumped to 0.2.0 and the CHANGELOG `Unreleased` section is dated (issue 1), and
2. the GitHub Actions matrix passes on Linux and Windows for Node 22, 24 and 26 (issue 2).

After those, rerun `pnpm test`, `pnpm verify:package` and `npm pack --dry-run`
and check the tarball version. Then publishing is the maintainer's decision.

**NO-GO** for publishing the tree exactly as it is now: the version collides with
the published 0.1.3.

Issues 3–10 do not block the release; issues 3 and 4 should be done before 1.0.

R10 stops here. No npm publish, Git release, tag, push or license change was made.

## Addendum: version bump to 0.2.0 (2026-11-07)

On the maintainer's instruction, outstanding issue 1 was resolved after R10:

- `package.json` and `VERSION` in `src/index.ts` now read 0.2.0. ESM and CommonJS
  imports both report `VERSION` 0.2.0.
- `CHANGELOG.md`: the former `Unreleased` section is now `[0.2.0] - 2026-11-07`,
  marked as not yet published, with a new empty `Unreleased` section above it. No
  npm link was added for 0.2.0.
- README, SECURITY.md, `docs/sdk.md` and `docs/production.md` describe version
  0.2.0 and mark new APIs *new in 0.2.0* instead of *Unreleased*.

Rerun after the bump, Windows:

| Command | Node | Exit | Result |
| --- | --- | ---: | --- |
| `pnpm lint` | 22.23.2 | 0 | Passed |
| `pnpm test` | 22.23.2 | 0 | 792 tests: 792 pass, 0 fail, 0 cancelled, 0 skipped |
| `node --test tests/*.test.mjs` | 24.22.2 | 0 | 792 pass, 0 fail |
| `node --test tests/*.test.mjs` | 26.13.0 | 0 | 792 pass, 0 fail |
| `pnpm verify:package` | 22.23.2 | 0 | All checks; 452 files |
| `npm run verify:package` | 22.23.2 | 0 | All checks; 453 files |
| `npm pack --dry-run` | 22.23.2 | 0 | `shivax-0.2.0.tgz`, 453 files, 419.0 kB, shasum `9748478c47a2e992000fa08c6134fe80a7cd897c` |

The version collision is resolved. **Remaining condition for GO:** outstanding issue 2,
a passing GitHub Actions run on Linux and Windows for Node 22, 24 and 26. 0.2.0 has
not been published.
