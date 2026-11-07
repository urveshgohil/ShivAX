# SHIVAX R01 - Exact model cost accounting

Date: 2026-11-02 (Asia/Calcutta)

Status: **R01 complete.** Exact cost reservations and conservative charge reconciliation are implemented. R00's separate malformed-output token-overrun defect remains open; R01 does not claim all router defects are fixed.

## Environment and scope

Validated `shivax@0.1.3` on Windows Node 22.23.2, pnpm 12.8.1. No package version, dependency, export map, ML training, RUDRA, specialist bot, licensing, security-policy or Inspectra change. No paid model calls or publication. All new providers are in-process mocks.

## Before and after evidence

| Scenario | Before (R00) | After (R01), ESM and CommonJS |
| --- | --- | --- |
| $0.30 budget, $0.10 per call | Calls 1/2 complete; calls 3/4 fail `cost-limit`; only $0.20 reserved | Calls 1/2/3 complete; call 4 fails `cost-limit`; exactly $0.30 reserved |
| $1 budget, ten $0.10 calls | No R00 measurement | Ten complete; eleventh fails `cost-limit`; exactly $1 reserved |
| Concurrent/reentrant requests | Existing single-owner design | Twelve contenders and a reentrant request return `busy`; one provider dispatch and one reservation |
| Fractional token rates | Floating-point multiplication/addition | 3 input tokens at $0.00000000035 + 7 output tokens at $0.0000000003 + $0.000000002 fee = $0.00000000515 per call; exactly three fit $0.00000001545 |
| Reported $0.20 charge after $0.10 reservation | Overrun was checked only after valid model output and not added to the ledger | Ledger records $0.20, returns `usage-limit`, blocks fallback/further inference, including malformed model data |
| Cancellation/timeout followed by a late charge | Returned usage was ignored after cancellation | Original cancelled/timeout result preserved; valid late excess increases the ledger once and disables reuse |
| Malformed output plus excess output tokens, zero cost | Both audit formats fail expected behavior | Still fails both audit formats; unchanged separate token defect |

The R00 test file was preserved unchanged. It now reports **2 pass / 2 fail**, compared with **0 pass / 4 fail** during R00. Both cost cases pass; both token cases still fail with `ERR_ASSERTION` because fallback completes instead of reporting `usage-limit`.

## Precision strategy

Public prices, limits, attempt reservations, reported usage and budget displays remain USD `number` values. Internally, validated numbers are parsed from their shortest decimal string representation into BigInt units of **10^-324 USD**. This represents every accepted finite numeric input, including `Number.MIN_VALUE` (5e-324), with no price quantization or underflow into free work. Values remain bounded by the existing finite, nonnegative, at-most-$1,000,000 validation. The corresponding integers are roughly 1,100 bits, not unbounded caller-supplied decimal strings.

All multiplication by token ceilings, summation, retained totals, reconciliation and budget comparisons use integer arithmetic. There is no floating-point accumulated balance and no epsilon allowance. If callers supply an already rounded expression such as `0.1 + 0.2`, its actual supplied decimal value `0.30000000000000004` is preserved; the implementation does not guess a different intended price.

An exact sum of independently supplied rates can fall between representable public Number values. The per-attempt cap is rounded **up** to the smallest Number covering that sum, and that complete cap is converted back to integer units and funded before provider dispatch. Both the exact priced amount and the funded cap must fit the remaining budget. This prevents advertising an unfunded cap to providers. A regression checks a $0.1 fee plus $1e-17 token rate produces the fully funded cap $0.10000000000000002.

`budgetUsage.reservedCostUSD` is a numeric display of the integer ledger. Display rounding never controls admission. No BigInt appears in public results or JSON serialization, and no public configuration fields or error codes were added.

## Reservation and reconciliation policy

- Reserve before invoking provider code. One active inference per router remains the contract; simultaneous/reentrant calls fail with `busy` and consume nothing. Ownership remains held after cancellation until actual pending work settles.
- Each fallback and each caller-initiated retry pays its own reservation. Failed, ambiguous, cancelled and timed-out attempts retain their ceiling. There is no new automatic retry behavior.
- Reconcile conservatively as **max(reserved ceiling, valid reported cost)** per attempt. Lower, zero or unknown charges do not release budget: the existing response contract has no final-invoice marker and historically promises no refunds. Provider-reported usage remains visible separately.
- Valid reported excess is added to the ledger and latches `usage-limit`, stopping fallback and subsequent calls. The ledger can exceed the configured budget when the provider has already exceeded its funded cap; that overrun is shown rather than clamped or hidden.
- Inspect cost independently of model output validation so malformed model data cannot conceal an otherwise valid reported cost overrun. Property accessors are rejected without invoking them. Cost is rechecked on the validated result so a host semantic callback cannot mutate the returned charge past enforcement.
- Late billing is reconciled before cancellation/deadline checks. It cannot turn a returned cancelled/timeout result into success or trigger fallback. Tests verify late excess is accounted exactly once.
- Invalid charge reports remain `invalid-output` and retain the reservation. Invalid provider prices fail `invalid-provider`; invalid budget configuration fails `invalid-input`. Insufficient admission budget fails `cost-limit` before dispatch; reported overrun uses existing `usage-limit`.

## Test coverage and actual validation results

Exact commands executed from the repository root:

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm lint` | 0 | TypeScript no-emit and ESLint pass |
| `pnpm test` | 0 | **504 tests, 504 pass, 0 fail**; includes clean build |
| `pnpm build` | 0 | Clean TypeScript/declaration generation and ESM/CommonJS Rollup outputs; no build warnings |
| `node --test tests/intelligence.test.mjs tests/model-cost.test.mjs` | 0 | **62 tests, 62 pass, 0 fail** |
| `node --test tests/audits/router-r00.test.mjs` | 1 | **4 tests, 2 pass, 2 fail**; only the known token cases remain red |
| `pnpm verify:package` | 0 | Clean external packed consumer install; all 12 ESM/CommonJS imports; all 12 entrypoints in five declaration modes; 414 packaged files |

All test runs reported zero cancelled, skipped and todo tests. The 504-test suite includes the original 466 tests and **38 new cost tests** (19 per module format). The dedicated router total includes 24 existing router tests plus those 38. Node 24/26 and remote CI were not rerun in this phase.

Package declaration modes: `.ts` ESNext/bundler, `.mts` Node16, `.cts` Node16, `.mts` NodeNext and `.cts` NodeNext. The 414-file package includes three generated files for the new internal cost module; public SDK entrypoints remain unchanged. No pnpm.exe launcher failure occurred.

The new tests cover A-G plus invalid reported charges/accessors, minimum positive prices, large token products, exact representable adapter caps, refusal to forgive caller-side floating-point surplus, lower/zero/null billing, cost overrun with malformed data, semantic callback mutation, over-budget reports, pre-cancellation and late billing after cancellation/timeout.

Full logs are in the host temporary directory: `shivax-r01-lint.log`, `shivax-r01-full.log`, `shivax-r01-build.log`, `shivax-r01-router.log`, `shivax-r01-r00.log`, `shivax-r01-package.log`. Results above are the durable record; no tests were skipped to obtain success.

## Changed files

| File | Change |
| --- | --- |
| `src/intelligence/cost.ts` | Internal decimal-to-BigInt conversion, numeric display and fully funded numeric cap conversion |
| `src/intelligence/router.ts` | Exact lifetime ledger, integer admission checks, conservative reported-cost reconciliation and overrun blocking |
| `src/intelligence/validation.ts` | Safe independent reported-cost validation |
| `src/intelligence/types.ts` | Documentation of budget display semantics; interface shapes unchanged |
| `tests/model-cost.test.mjs` | 38 public ESM/CommonJS mock billing regressions |
| `docs/hybrid-intelligence.md` | Precision, reservation, reconciliation, concurrency and remaining token-defect documentation |
| `docs/audits/shivax-r01.md` | This completion report |

Pre-existing R00 audit/test files are retained, not newly introduced by R01. Generated artifacts were rebuilt through existing scripts. No configuration, export map or package version changed.

## Remaining billing risks and limitations

1. Provider reports are not independently verified invoices. Missing, invalid, out-of-range, unreported or never-returning charges cannot be reconstructed; retaining the full ceiling is conservative but does not prove actual external billing stayed below it.
2. Providers can exceed funded caps before reporting. Host adapters must enforce backend generation/spend controls, truthful pricing and aggregation of any internal retry charges. Internal retries hidden by an SDK are not separate router attempts.
3. Lower reported charges do not reclaim budget. Safe release would require an explicit final-settlement contract, which would be a separately reviewed API change.
4. Budgets are per router instance, not shared across processes, accounts or independently constructed routers. Multi-router billing requires host coordination and durable accounting.
5. Public USD displays can round; funded per-attempt caps may include a minimal conservative rounding surplus. The integer ledger remains authoritative for decisions.
6. R00's malformed-output token-overrun enforcement bug remains unresolved. R01 addresses monetary accounting only and does not certify overall router correctness.

Stop after R01. No automatic phase advancement or publication.
