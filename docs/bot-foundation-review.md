# Phase 01 implementation review and compatibility protection

Date: 2026-10-26 (Asia/Calcutta). Scope: review/debug the existing Phase 01
foundation, without starting RUDRA or changing the ML engine.

All five reproduced defects below are fixed. The existing 166 tests initially
passed; targeted new regressions exposed the missing cases. Final verification
passes **172 tests**, including the original ML/digit regressions.

## Findings and fixes

| Finding | Reproduction / consequence | Resolution |
| --- | --- | --- |
| P2: JSON fields could disappear after validation | A non-enumerable required input/result field passed structural validation, then `Object.keys`/spread omitted it from the snapshot. Host identity and metadata could also lose fields. | Agent record validation rejects non-enumerable object properties before snapshots. Tests cover input, result, caller identity and metadata; existing plain JSON and prototype-like data keys remain supported. |
| P2: Input validation could re-enter the same bot | A validator called the same executor again before the outer call reserved its busy slot. Both implementations ran; completion of one could release the slot while another was active. | Reserve before host/bot callbacks. Track reservation ownership separately from started work, so admission failures release only their own reservation and underlying work retains its slot until settlement. Regressions cover nested calls, a third concurrent attempt and reuse afterward. |
| P2: Wall-clock changes could bypass deadline checks | With `Date.now` held constant, synchronous work exceeded its deadline but returned completed before its timer could run. | Use the monotonic performance clock when available on supported hosts; retain a Date fallback for other environments. A regression holds the wall clock constant and checks timeout before output validation. No synchronous preemption is claimed. |
| P2: Typed optional limits rejected explicit undefined | `Partial<ExecutionLimits>` permits undefined optional fields, but spreading those fields replaced valid defaults and caused invalid-context failures. | Apply defaults per field before range validation. Explicit undefined works, mixed overrides work, and null/unknown options still fail. |
| P2: Lifecycle errors could contradict event status | Public event dispatch accepted cancelled events carrying bot-error, failed events carrying timeout, and other inconsistent combinations. | Share one terminal-status/error matcher between result and event validation. Invalid combinations fail with invalid-event; canonical combinations remain accepted. |

The first four new regression cases failed against the original built
implementation (26 prior foundation tests passed, four new cases failed).
The optional-limit case was separately reproduced as an invalid-context failure
before its fix. These were actual failing assertions, not hypothetical findings.

## Protecting the existing ML contract

- Added a pinned [legacy API fixture](../tests/fixtures/legacy-api.mjs) containing
  the original **38 runtime exports and 66 type-only exports**. Its combined
  name set matches the original `e47f462` root export graph exactly.
- Both ESM and CommonJS must retain all legacy runtime names; additional
  foundation exports remain allowed. Both formats still expose 46 runtime names.
- The existing ES2020-only consumer now also imports all 66 legacy type names,
  alongside the generic bot API. No DOM or Node ambient types are required.
  The legacy ML `Task` union and its separation from `BotTask` remain checked.
- A new isolated-process test removes optional AbortController/AbortSignal,
  TextEncoder/TextDecoder, fetch, URL and performance globals before importing
  both builds. Tensor matrix multiplication, the pinned deterministic XOR
  prediction, model JSON round-trip, class prediction and BagOfWords still work.
  The parent test process's globals are unaffected.
- Existing source under `core`, `nn`, `metrics`, `text`, `types`, `visual`, `slm`,
  plus examples, scripts, manifest and build configuration remains unchanged
  relative to the audit checkout. The root entry still has only the prior
  additive agents re-export.
- The existing dataset SHA-256 remains
  `d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9`.

## Changed files in this review

| File | Change |
| --- | --- |
| `src/agents/validation.ts` | Enumerable-field checks, optional limit defaults and shared status/error matching |
| `src/agents/execute.ts` | Reservation ownership/reentry protection, monotonic deadlines and subscription ownership |
| `src/agents/events.ts` | Consistent terminal error validation |
| `tests/agents.test.mjs` | Five reproduced-defect regressions and same-bot retry coverage |
| `tests/fixtures/legacy-api.mjs` | New pinned original public API inventory |
| `tests/package.test.mjs` | Legacy runtime/type preservation and isolated ML compatibility checks |
| `docs/bot-foundation.md` | Clarify corrected validation, execution and event behavior |
| `docs/SHIVAX_PHASES.md` | Record Phase 01 review verification |
| `docs/bot-foundation-review.md` | This review report |

No new public exports, dependencies, runtime architecture modules or ML formats
were introduced by the review. Phase 00/01 work already present in the checkout
was preserved; no commit, package publication or deployment was performed.

## Verification

Host: Node.js v24.19.0 on Windows. The following existing-tool commands were run
sequentially and stopped on failure:

```text
node scripts/clean.mjs
node node_modules/typescript/bin/tsc
node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

| Check | Result |
| --- | --- |
| Clean / TypeScript / Rollup | Passed; declarations and ESM/CJS bundles rebuilt |
| Full suite | **172 passed**, zero failed, cancelled or skipped |
| Type checking | Passed, including legacy and foundation consumer declarations |
| ESLint | Passed |
| Legacy inventory | All 104 original public names pinned, none missing or unexpected |
| Dataset and implementation boundary | Hash unchanged; existing ML/demo/build files unchanged |
| Package dry run (`npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>`) | Passed; 39 entries, all eight foundation declarations, no test/fixture files; no publication |
| Git whitespace check | Passed |

Installed tools were used directly because the earlier audit found a global
pnpm-store permissions error. That package-manager configuration was not changed.

## Remaining limits and phase status

Host identity/permission values remain trusted assertions, not implemented
authentication. Injected bots/validators are trusted JavaScript, not sandboxed;
cancellation cannot forcibly stop blocking code. Busy ownership is local to an
executor and stable supplied bot object, not shared across separately created
executors or re-registered snapshots. Nonstandard hosts without a performance
clock use the wall-clock fallback.

The isolated compatibility test is not a fresh browser matrix. Minimum Node 22,
live models, external integrations and real MNIST accuracy were not exercised
in this review. No new ML quality or security certification is claimed.

**Phase 01 review/debugging is complete. RUDRA and later phases remain unimplemented.**
