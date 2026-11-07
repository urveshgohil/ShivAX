# SHIVAX R02 - Token and provider fallback safety

Date: 2026-11-03 (Asia/Calcutta)

Status: **R02 complete.** Both R00 token reproductions now pass, alongside the R01 exact-cost regressions. No automatic advancement or publication.

## Scope and environment

Validated `shivax@0.1.3` on Windows Node 22.23.2, pnpm 12.8.1. Tests use mocks and injected transports, not paid LLM APIs. The package version, dependencies and export map were not changed. ML core/training, RUDRA, specialist bots, bot registry, security/firewall policies, memory, licensing and Inspectra were not modified.

Historical R00/R01 reports remain unchanged as records of their phases. This report supersedes their outstanding token-defect status.

## Before and after

Reproduction: output limit 1, provider A returns malformed output and reports 2 output tokens, provider B would return valid output.

| Observation | R00/R01 | R02, ESM and CommonJS |
| --- | --- | --- |
| Provider A attempt | `invalid-output` | `usage-limit`, reason `token-limit-exceeded` |
| Fallback provider B | called and completed | never called |
| Final result | completed, provider B | failed, terminal limit error |
| Subsequent call | allowed | rejected with the retained terminal error |
| Original R00 reproduction file | R00: 0/4 pass; R01: 2/4 pass | 4/4 pass, assertions preserved |

Actual sanitized diagnostic from the preserved reproduction:

```json
{"first":{"status":"failed","error":"usage-limit","providerId":null,"attempts":[{"providerId":"provider-a","outcome":"failed","error":"usage-limit"}]},"followup":{"status":"failed","error":"usage-limit","providerId":null,"attempts":[]},"aCalls":1,"bCalls":0}
```

The original diagnostic summarizes legacy codes. New regression tests also assert `error.reason === 'token-limit-exceeded'` on the result and failed attempt, and preservation of the verified usage snapshot.

## Request lifecycle and enforcement

1. Existing scope, capability, input, routing and remote opt-in checks remain in place. The router still owns one active inference; simultaneous/reentrant requests return `busy`.
2. Before provider dispatch, reserve calls, token ceilings and exact R01 monetary ceilings against lifetime budgets. Each fallback and caller-initiated retry reserves separately.
3. Independently inspect own data properties of the returned usage envelope. Snapshot each valid field without reading model data or invoking getters. Invalid fields cannot hide a different valid field that reports an overrun.
4. Update the lifetime token ledger using per-direction maxima: retain input/output reservations and add verified excess. Update the exact monetary ledger similarly. Both ledgers are updated if both types of excess are reported; token classification takes precedence.
5. A verified overrun latches a terminal error and stops fallback. Unverifiable usage also latches a terminal error. Subsequent calls fail before dispatch.
6. Only after usage passes, validate model data size, structure, schema and semantic predicate. Invalid model output can fall back only when usage was verified and another reservation fits.
7. Recheck usage after semantic validation, including when the predicate fails. This prevents callbacks from mutating usage to conceal a limit violation. Per-attempt maxima prevent double-counting during revalidation.
8. Retain ownership until actual provider work settles. Late returned usage can update ledgers and latch a terminal block after public timeout/cancellation. Late terminal usage exceptions also block reuse. The already returned result remains unchanged.

Failed attempts now retain sanitized usage snapshots where available. `budgetUsage.reservedTokens` represents lifetime retained token ceilings plus verified per-direction excess, not a refunded sum of reported consumption. Per-attempt `reservedTokens` remains the original admission reservation. R01 monetary precision and conservative non-refund behavior remain intact.

## Fail-closed usage policy

- The usage envelope must be an own enumerable data property and a plain record containing `inputTokens`, `outputTokens`, and `costUSD`. Extra keys/symbols, inherited fields, accessors and malformed shapes are unverifiable.
- Token-based providers must report both token counts as nonnegative safe integers, bounded to 100,000,000 per field. Missing/null/fractional/negative/nonfinite/string/oversized counts fail closed. An invalid count is not coerced to zero.
- Host-declared token-free providers may explicitly report null counts; their reserved ceilings remain zero. Any positive reported token use exceeds those ceilings and terminates routing.
- Explicit null cost remains allowed because the full declared upper bound is retained. Missing, malformed or out-of-range cost is unverifiable. Cost must otherwise satisfy the existing nonnegative finite USD range.
- Known valid overrun evidence takes priority over another invalid field. If no known overrun exists but usage is unverifiable, the result is `usage-unverifiable`, with no fallback or router reuse.
- A provider-thrown output-validation error with no verifiable usage cannot trigger fallback. Ordinary provider/transport execution failures (`provider-error`) and explicit `unavailable` remain eligible under host opt-in, with the full attempt reservation retained. Those error categories are trusted adapter signals; they do not establish that the attempt was free or unbilled.
- Timeouts and hard-limit errors never trigger fallback. Confirmed router usage overruns and unverifiable usage block subsequent calls. Admission budget failures reject before dispatch without spending another reservation.

This intentionally tightens the previous behavior for unknown token usage and invalid billing metadata. Existing public signatures and configuration fields remain; providers relying on null token counts must now return verifiable counts or truthfully declare themselves token-free.

## Typed errors and compatibility

The requested names are available as the exported `ModelFailureReason` type and accepted `ModelError` constructor aliases. Existing emitted codes are preserved where equivalent; additive `error.reason` classifies the failure. `usage-unverifiable` is the new terminal code for unverifiable usage.

| Requested classification / constructor alias | Emitted code |
| --- | --- |
| `token-limit-exceeded` | `token-limit` for admission; `usage-limit` for reported overrun |
| `cost-limit-exceeded` | `cost-limit` for admission; `usage-limit` for reported overrun |
| `invalid-provider-output` | `invalid-output` after verified usage |
| `usage-unverifiable` | `usage-unverifiable` |
| `provider-timeout` | `timeout` |

Error messages and classifications are generated from fixed allowlists. Raw provider messages, exception causes, prompts and malformed metadata are not copied into error details. Legacy one-argument `ModelError` construction still works; invalid aliases/reasons cannot inject arbitrary diagnostic text. Result and attempt details are frozen snapshots. The model-operation bridge preserves the classification when throwing; specialist bots retain their existing sanitized mapping.

## Provider adapter handling

Ollama's generated-text JSON parse failure previously discarded known token usage before the router could inspect it. An internal error handoff now preserves that usage. A malformed JSON response with excess input tokens terminates with a token-overrun classification; malformed JSON with valid usage can safely fall back.

Invalid Ollama token counts and malformed response records are internally distinguished from retryable transport failures and mapped to `usage-unverifiable` by the model adapter. The lower-level SLM API retains its existing `provider-error` code and method signatures. Internal error classes are not added to public SDK exports. Provider timeouts/cancellation remain terminal and sanitized.

The shared response validator retains its existing four-argument calling form for workflow tooling; the router supplies an independently validated usage snapshot through an optional internal argument. No workflow-engine or security-policy changes were required.

## Validation and test counts

Exact final commands, executed from the repository root:

| Command | Exit | Actual result |
| --- | ---: | --- |
| `pnpm lint` | 0 | TypeScript no-emit and ESLint pass |
| `pnpm test` | 0 | **550 tests, 550 pass, 0 fail**; includes clean build |
| `pnpm build` | 0 | TypeScript, declaration generation and both Rollup formats pass; no build warnings |
| `node --test tests/intelligence.test.mjs tests/model-cost.test.mjs tests/model-safety.test.mjs tests/router-audit.test.mjs` | 0 | **108 tests, 108 pass, 0 fail** |
| `pnpm verify:package` | 0 | All 12 packaged ESM/CommonJS entrypoints and five declaration modes pass; 414 packaged files |

All test runs report zero cancelled, skipped and todo tests. The full count is the R01 baseline of 504 plus **42 new safety tests** (21 per module format) and the **4 original R00 tests** promoted into the standard gate. The targeted count is 24 original router tests + 38 R01 cost tests + 42 R02 safety tests + 4 R00 reproductions.

Three pre-existing test instances initially failed because they asserted the previous permissive null-token/invalid-cost behavior. Their assertions were updated to require terminal `usage-unverifiable` and retained reservations, rather than deleting or skipping checks. Initial implementation compilation errors were corrected before the successful validation above.

Coverage includes malformed/oversized/cyclic/accessor output, missing/invalid usage, independently valid overrun fields, combined token/cost excess, null costs, token-free providers, aggregate fallback/retry ceilings, boundary rejection, semantic mutation, concurrency, cancellation, provider timeout, late usage/failures, error aliases, bridge propagation and injected Ollama responses. Existing ML, RUDRA, specialist, security, licensing, memory, workflow and inspection regressions pass.

Packed declaration verification covers `.ts` ESNext/bundler, `.mts` Node16, `.cts` Node16, `.mts` NodeNext and `.cts` NodeNext. It now checks the new classification type and aliases plus a negative unknown-error assertion in each mode. No pnpm.exe error occurred. Node 24/26 and remote CI were not rerun in this phase.

Full logs are retained in the host temporary directory: `shivax-r02-lint.log`, `shivax-r02-full.log`, `shivax-r02-build.log`, `shivax-r02-router.log`, `shivax-r02-package.log`. Results above are the durable record.

## R02 changed files

- `src/intelligence/router.ts`: independent usage reconciliation, persistent terminal errors, safe fallback and sanitized failed-attempt usage.
- `src/intelligence/validation.ts`: field-wise usage snapshots and separate model-output validation; shared validator compatibility.
- `src/intelligence/errors.ts`, `types.ts`, `index.ts`: typed classifications, constructor aliases, sanitization and type export.
- `src/intelligence/bridge.ts`: preserve classified errors.
- `src/intelligence/ollama.ts`: preserve usage across generated JSON parse failure and map unverifiable usage/timeout safely.
- `src/slm/provider.ts`, `src/slm/ollama.ts`: internal usage-failure distinction without changing low-level error codes.
- `tests/model-safety.test.mjs`: 42 public ESM/CommonJS regressions.
- `tests/router-audit.test.mjs`: run the unchanged R00 reproduction file in the normal test gate.
- `tests/intelligence.test.mjs`, `tests/model-cost.test.mjs`: assert the authorized fail-closed policy.
- `scripts/check-sdk-package.mjs`: verify new typed classifications in packed consumers.
- `docs/hybrid-intelligence.md`, `docs/audits/shivax-r02.md`: current policy and completion evidence.

R01 cost helpers and historical audit artifacts were already present and are preserved. No package version or dependency change; nothing published.

## Remaining integration risks

The router enforces reported usage and conservative reservations; it cannot independently meter remote tokens or recover omitted invoices. Provider adapters must report known limits, classify failures truthfully, include hidden internal retry charges and enforce backend token/spend limits. Generic provider errors remain retryable only within retained budgets; they are not proof of verified usage. Separate router instances do not share a global billing account. Cancellation cannot undo charges or preempt blocking synchronous JavaScript, and noncooperative callbacks can hold capacity indefinitely.

R02 resolves the reproduced routing defects, not these host/provider trust and resource-isolation boundaries. Stop after R02.
