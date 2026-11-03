# SHIVAX R00 - Model router and security audit

Date: 2026-11-02 (Asia/Calcutta)

Status: **R00 COMPLETE - two reproduced router defects remain open.** No production fix is included. Successful package verification does not establish correct router budget behavior.

## Scope and environment

- Audited checkout: `shivax@0.1.3`, revision `c77afaa` (`Merge branch 'fix/shivax-build-stabilization' into 'Beta/0.1.0'`). The working tree was clean before R00. The request's 0.1.2 status predates the version update; this phase does not change the version.
- Windows, Node **22.23.2**, pnpm **12.8.1**. Earlier Node 24/26 package results were not repeated in this phase.
- Reproductions use freshly built public `shivax/models` exports through ESM import and CommonJS require. No registry copy of published 0.1.2 was downloaded or independently verified in R00.
- Reviewed model providers, token/cost reservations, retries/fallback, cancellation, RUDRA invocation, Jay/Vijay, tool policies, memory scopes and Inspectra integration.
- Mock providers only; no paid LLM calls, dependency installation, live browser capture, publication or production-code modification.

## Commands and actual results

Commands ran from the repository root.

| Command | Exit | Tests | Pass | Fail | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `pnpm test` | 0 | 466 | 466 | 0 | Existing baseline including clean build |
| `node --test tests/audits/router-r00.test.mjs` | 1 | 4 | 0 | 4 | Both reported bugs reproduce in ESM and CommonJS |
| `pnpm lint` | 0 | n/a | n/a | n/a | TypeScript and ESLint pass, including the new test file |
| `node --test tests/*.test.mjs tests/audits/router-r00.test.mjs` | 1 | 470 | 466 | 4 | Only the four new expected-behavior assertions fail |

All test runs reported zero cancelled, skipped and todo tests. The baseline build ran `node scripts/clean.mjs && tsc && node scripts/build-cjs-declarations.mjs && rollup -c rollup.config.mjs`. TypeScript and both Rollup formats succeeded, without build warnings or a pnpm.exe execution error.

The new tests genuinely fail with `ERR_ASSERTION`; they are not inverted assertions that declare the defects successful. Their audit subdirectory preserves the existing top-level baseline selection. The combined command includes them, so the aggregate R00 regression result is **not green**. Include these cases in the normal regression gate when implementing an approved fix.

Full output was retained in the host temporary directory as `shivax-r00-baseline.log`, `shivax-r00-reproductions.log`, `shivax-r00-lint.log` and `shivax-r00-combined.log`. The durable commands, outcomes and failure evidence are recorded below.

## R00-01: Affordable third decimal-cost call is rejected (P2)

Configuration: one mock provider, `tokenBased: false`, `callUSD: 0.1`, zero token rates, router `maxCostUSD: 0.3`. Successful responses report `costUSD: 0.1`. All other limits are nonbinding. Four inferences run sequentially.

| Observation | Expected | Actual in both formats |
| --- | --- | --- |
| Call 1 | completed | completed |
| Call 2 | completed | completed |
| Call 3 | completed | failed, `cost-limit`, provider not called |
| Call 4 | failed, `cost-limit` | failed, `cost-limit` |
| Provider invocations / reserved calls | 3 / 3 | 2 / 2 |
| Reserved USD | 0.3 | 0.2 |

Failure evidence:

```text
code: 'ERR_ASSERTION'
Expected values to be strictly deep-equal:
actual outcomes:   ['completed', 'completed', 'cost-limit', 'cost-limit']
expected outcomes: ['completed', 'completed', 'completed', 'cost-limit']
actual providerCalls: 2; expected: 3
actual reservedCalls: 2; expected: 3
actual reservedCostUSD: 0.2; expected: 0.3
```

Root cause: `src/intelligence/router.ts:204` calculates USD reservations using JavaScript numbers. Line 213 compares `this.#cost + reservedCostUSD` against the configured maximum; line 219 accumulates those floating-point values. The third comparison evaluates `0.2 + 0.1 > 0.3`, which is true because the sum is `0.30000000000000004`. Rejection happens before invoking the provider.

Impact: valid paid work is denied before exhausting the configured budget. This test proves premature rejection, not overspending. Fractional per-token rates also use this arithmetic and need coverage.

Recommendation, not implemented: deterministic fixed-point accounting with explicit precision, conservative reservation/budget conversion, overflow validation and stable public USD conversion. Cover exact boundaries, fractional token rates, mixed providers, tiny nonzero prices and failed/cancelled reservations. Do not use a broad epsilon that authorizes actual overspending. Review existing workflow `moneyUnits` accounting for consistency without assuming it fixes ModelRouter.

Coverage gap: `tests/intelligence.test.mjs:499` checks integer USD reservations. The passing decimal-budget test in `tests/workflows.test.mjs` exercises a separate workflow ledger.

## R00-02: Malformed output hides a reported token overrun (P1)

Configuration: `maxOutputTokens: 1`, `maxInputTokens: 1`, sufficient lifetime token budget, explicit provider A and `allowFallback: true`.

- A returns string data against a number schema, with usage `{ inputTokens: 0, outputTokens: 2, costUSD: 0 }`.
- B returns valid numeric data with one output token.
- A subsequent inference explicitly selects B to check whether the overrun disabled the router.

| Observation | Expected | Actual in both formats |
| --- | --- | --- |
| A attempt | failed, `usage-limit` | failed, `invalid-output` |
| Initial fallback to B | never called | called once, completed |
| Initial final result | failed, `usage-limit` | completed, provider B |
| Subsequent inference | failed, `usage-limit`, no attempts | completed, provider B |
| Total A / B invocations | 1 / 0 | 1 / 2 (fallback plus subsequent call) |

`usage-limit` is the existing API error for reported usage exceeding a per-attempt reservation. `token-limit` denotes insufficient lifetime token reservation capacity.

Exact diagnostic payload, identical for ESM and CommonJS:

```json
{"first":{"status":"completed","error":null,"providerId":"provider-b","attempts":[{"providerId":"provider-a","outcome":"failed","error":"invalid-output"},{"providerId":"provider-b","outcome":"completed","error":null}]},"followup":{"status":"completed","error":null,"providerId":"provider-b","attempts":[{"providerId":"provider-b","outcome":"completed","error":null}]},"aCalls":1,"bCalls":2}
```

The expected-behavior assertion fails with `ERR_ASSERTION`: `bCalls: 2` instead of `0`, `completed` instead of `failed`, and `invalid-output` instead of `usage-limit`.

Root cause:

1. `src/intelligence/router.ts:235` calls `response(...)` before checking reported usage.
2. `src/intelligence/validation.ts:173` snapshots data, then validates usage, then rejects schema/semantic mismatch at line 182. Failure becomes `invalid-output`, so no validated response returns to the router.
3. The usage checks and `#overrun` assignment at router lines 238-244 are never reached.
4. `invalid-output` is eligible for fallback at line 276. B succeeds and the router remains reusable.

Impact: known excess output-token usage does not stop routing when output is malformed. Additional provider work is admitted and the intended persistent overrun state is never set. The same conditional also checks input-token and cost overruns; analogous masking is a source-level inference, not a separately reproduced case here.

Recommendation, not implemented: validate/extract usage independently and enforce valid reported overruns before data serialization, schema or semantic validation. Latch the overrun and prevent fallback. Preserve rejection of getters, malformed usage, nonfinite numbers and oversized data; do not interpret unreported/null usage as zero. Define precedence for partially invalid usage, cancellation and late responses. Add regressions for input-token/cost overruns, malformed data, semantic failure, fallback enabled/disabled and both SDK formats. Review adapters for usage lost during parsing.

Coverage gap: `tests/intelligence.test.mjs:519` checks overruns with valid model data. Malformed-output fallback is tested separately; the combined case was absent.

## Router, provider and RUDRA behavior

- Registry validation snapshots provider descriptors, prices and bound methods. Selection orders in-process, local and remote providers deterministically. Remote use and fallback require separate host opt-ins. ModelRouter has no same-provider retry loop; it visits eligible fallback candidates once.
- Attempts reserve call count, maximum tokens and declared cost before invoking host code. Failed, cancelled and uncertain work is not refunded. `budgetUsage` is a reservation ledger, not exact billing reconciliation. Null usage retains full reservations.
- One deadline covers an inference and all fallbacks, with absolute checks around host work. AbortSignal propagates cancellation. Ignored cancellation retains busy ownership until the actual work settles.
- RemoteModelAdapter loads host-configured clients lazily and clears failed loader state for an explicit later attempt. Host providers own transport, credentials, conservative pricing and honoring request limits.
- NeuralModelProvider performs prediction without training or initializing weights. RulesModelProvider invokes registered host rules. Neither requires ML changes for these fixes.
- Ollama transport restricts endpoints to loopback, rejects redirects/cloud aliases/remote metadata, bounds response bytes and checks token counts. Output-token overrun is checked before returned content is parsed. The adapter parses generated JSON before returning input usage to ModelRouter; malformed JSON combined with excess input usage needs a focused follow-up test, not a claim of a reproduced third bug.
- `createModelOperation` throws the router's ModelError code. Specialist `providerCall` then maps thrown failures to `BotError('provider-error')` (`src/bots/base.ts:101`), so RUDRA callers lose the exact model-limit reason. This is a statically confirmed diagnostic limitation, not an authorization bypass. Changing error mapping requires API compatibility review.
- RUDRA validates plans and allowed capabilities before execution. With Vijay configured it authenticates before planning and authorizes each selected capability/tool. State-changing attempts are not automatically retried. Explicit read-only retries apply to `bot-error`; the bridge's `provider-error` is not that retry case.
- RudraWorkflowEngine uses separate integer cost-unit reservations for model tools. Its passing fractional-cost tests do not cover ModelRouter's USD addition.

## Security findings and boundaries

R00-02 is the confirmed limit-enforcement defect. The following table distinguishes inspected controls from host obligations and untested follow-up concerns.

| Area | Inspected enforcement | Gap or host responsibility |
| --- | --- | --- |
| Jay: `src/security/jay.ts` | Frozen identities, expiry/session verification, exact minted context identity in a WeakMap; copying fields does not copy authority. | Context creation awaits authentication before the RUDRA deadline exists. Noncooperative authentication can wait indefinitely. Host identity adapters need bounded transport/cancellation; this documented availability boundary was not newly exploited. |
| Vijay: `src/security/vijay.ts`, `registry.ts` | Missing policy denies; permissions checked; state-changing policy requires approval; session/input/policy rechecked after approval; tool replacement and read-only effect violations denied. | Resource ownership depends on host input policies, and effect classifications must be truthful. Existing forged/revoked identity, policy replacement and denied-approval tests pass. No additional bypass demonstrated. |
| Bot/tool execution: `src/security/tools.ts`, `src/agents/rudra/orchestrator.ts` | Required tools intersect host permissions; bounded sequential leases; saved clients expire; pending calls drain; bots declaring protected tools require security. | Legacy pure RUDRA and standalone BotExecutor can run without Jay/Vijay. Injected JS can perform ambient I/O: this is not a JS sandbox or network firewall. Isolate untrusted code and enforce host network policy. |
| Model admission: `src/intelligence/router.ts`, `types.ts` | Scope kind/id checks, explicit remote routing, capabilities, byte/call/token/cost reservations and output validation. | Scope/session strings are not authenticated principals. Locality/prices/usage are integration claims, with null usage allowed. Do not expose router configuration or remote opt-in directly to untrusted clients; use secured application admission. |
| Cancellation/ownership | Router, RUDRA and leases keep ownership until callbacks settle; existing ignored-signal/deadline tests pass. | Timers cannot preempt blocking synchronous JS; permanently pending callbacks can retain capacity indefinitely. Cancellation cannot undo effects or charges. Late response usage needs follow-up coverage because cancellation is checked before returned usage. |
| Memory: `src/memory/services.ts`, `engine.ts`, `validation.ts` | Protected services derive namespace from authenticated principal, issuer, session and scope. Stored namespace, consent, verification, retention, revisions and generations are checked. Content remains untrusted. | Direct MemoryEngine accepts host-provided namespaces/approval flags and is not an authentication API. Privacy patterns are heuristic, not comprehensive data-loss prevention. Persistence and embedding adapters remain trusted. |
| Inspectra: `src/inspection/services.ts`, `adapters/inspectra/index.mjs` | URL admission, scoped/viewport-checked observations, lazy loading, sanitized failures, safe screenshot handles and once-only awaited cleanup. Existing inspection/adapter tests pass. | Redirects, resolved addresses, subresources, browser isolation and cleanup on rejected acquisition are delegated to host `openPage` (adapter line 113). Top-level URL approval alone does not prevent SSRF. No live SSRF test or adapter change was made. |
| Security documentation: `SECURITY.md` | Detailed host-boundary guidance exists in `docs/jay-vijay-security.md`. | Top-level statements that the library makes no network requests or implements no authentication/authorization no longer describe optional Ollama and Jay/Vijay. This is a confirmed documentation gap. Clarify core defaults, optional integrations and host responsibilities. |

Security audit records are bounded in-memory and exclude raw payloads/credentials. They are not durable or tamper-proof storage. Hosts must provide persistence where required. These tests and source review do not establish security for every integration or hostile workload.

## Files and recommended future work

R00 adds only:

- `tests/audits/router-r00.test.mjs`: four mock-only regressions asserting correct behavior in ESM/CommonJS.
- `docs/audits/shivax-r00.md`: this report.

| Future change target | Purpose |
| --- | --- |
| `src/intelligence/router.ts` | Deterministic cost accounting; usage-limit precedence and persistent overrun state |
| `src/intelligence/validation.ts` | Separate safe usage validation from model-data validation |
| `tests/intelligence.test.mjs` and audit regressions | Permanent combined-condition and decimal-boundary coverage |
| `src/intelligence/ollama.ts`, `src/slm/ollama.ts` | Investigate usage preservation during parsing with focused tests before changing behavior |
| `src/intelligence/bridge.ts`, `src/bots/base.ts` | Review model error observability through RUDRA without unapproved API changes |
| `SECURITY.md` | Correct stale scope and optional-network claims |

Production code, configuration, dependencies, package version, ML training, bot names, licensing and Inspectra remain unchanged. R00 stops with the two defects documented and failing tests preserved. No automatic advancement or publication.
