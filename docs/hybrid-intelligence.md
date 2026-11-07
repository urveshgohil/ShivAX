# Phase 05 — Hybrid model intelligence

Implemented 2026-10-26 (Asia/Calcutta). This phase adds a model-independent
inference layer under `src/intelligence/`. It does not relocate or retrain the
existing ML engine, change RUDRA's planner, install a runtime, or configure a
remote account. Basic inference remains entirely offline.

## Architecture and contracts

`ModelProvider` declares a unique ID, supported capabilities, locality,
token accounting mode, host-configured upper-bound pricing, and `infer`.
`ModelProviderRegistry` snapshots descriptors and binds implementations when
registering them. It supports `register`, `unregister`, `get`, `list`, and
`findByCapability`; duplicate IDs and malformed descriptors fail explicitly.
Discovery never loads a model or SDK.

`ModelRouter` owns a single scope and one active operation. It validates and
freezes inference data, output schema and provider context, then chooses a
compatible provider. RUDRA still selects **bots**; this router selects **model
backends**. Neither model output nor input payload can set routing permissions,
alter the registry, supply credentials, grant tools, or modify execution limits.

The five capabilities are `text-reasoning`, `code-generation`,
`visual-interpretation`, `numeric-inference`, and `deterministic-validation`.
Provider declarations are host assertions about an installed model, not a claim
that any particular model understands all five tasks.

`ModelRequest` contains capability, finite JSON input, output schema, task ID,
session ID, scope, abort signal, token/cost ceilings and `checkExecution()`.
Providers must call the checkpoint before starting further work, honor aborts,
and implement their backend's token and billing controls. They receive no tool
client or identity credentials from the bot context.

`ModelResult` is a discriminated completed/failed/cancelled result. Successful
results include validated data, selected provider ID, usage and an immutable
attempt list. Failures use fixed error messages and codes. Attempt records
contain only provider ID, reservation, outcome, optional usage and fixed errors;
they do not retain prompts, response bodies, credentials or raw exceptions.

## Adapters

| Adapter | Implemented behavior |
| --- | --- |
| `NeuralModelProvider(id, network)` | Calls the supplied existing `NeuralNet.predict` for one finite numeric row and returns `{ predictions }`. Never trains or modifies weights. |
| `RulesModelProvider(id, rules)` | Executes a named, injected deterministic rule after input validation. Input is `{ rule, data }`; unknown rules return `unavailable`. No eval or generated code execution. |
| `OllamaModelAdapter(options)` | Reuses the existing loopback-only `OllamaProvider`, verifies local model metadata on every inference, requests structured JSON, and reports actual server token counts. Supports declared text reasoning/code capabilities. |
| `RemoteModelAdapter(options)` | Lazy host `load()` callback returns a narrow `infer(request)` client. Host supplies the endpoint/SDK, credential access, rates, capability support and response normalization. No hardcoded keys, automatic credential lookup or arbitrary URL tool. |

The Ollama transport's existing `generate(request): Promise<string>` is
preserved. Its additive `generateWithUsage` method returns text and input/output
token counts; an optional checkpoint stops a late metadata response from
starting another request after deadline. No existing `SLMProvider`, `SLMClient`
or UI-advice behavior changes.

Ollama structured output and usage fields follow its
[official API documentation](https://github.com/ollama/ollama/blob/main/docs/api.md).
The local adapter uses `/api/show` and `/api/chat`, no streaming, redirects or
credentials, `keep_alive: 0`, existing response byte limits and no truncation.
Models are never downloaded automatically. Localhost cloud aliases/metadata are
rejected. This adapter does not send image payloads; a host provider declaring
`visual-interpretation` must implement image transport itself.

The remote SDK loader runs only on a permitted, budgeted inference. A failed
load can be tried again by a later explicit inference. Successful clients are
cached in that adapter instance, not globally. Host clients must remain stateless
or correctly scope their own retained state; use separate adapters when needed.
No heavy runtime is imported at package load.

## Routing, fallback and authorization

Choose an explicit `providerId` to pin the first candidate. Otherwise providers
are ordered by locality (`in-process`, `local`, `remote`), then ordinal ID.
All candidates must support the requested capability. A missing or incompatible
explicit ID fails, rather than silently ignoring the configuration.

`allowFallback` and `allowRemote` are **false by default**, independent host
options. Fallback tries the next compatible permitted provider once, only for
`provider-error`, `unavailable` or `invalid-output`. It never falls back after
cancellation, timeout, invalid input, permission/configuration failure, or a
budget/usage violation. Failed attempts remain visible and consume reservations.
Remote fallback requires both opt-ins. Input fields with the same names have no
effect. `enabled: false` prevents all provider calls and SDK loading.

The scope check is isolation, not authentication. Application code must configure
Jay/Vijay capability authorization when exposing specialist inference to users.
Remote opt-in is a host data-egress decision and must not be copied from model
proposals or untrusted request data. The new layer does not weaken existing tool
permissions or automatically register any new protected action.

## Execution limits and accounting

Limits are immutable per router. Lifetime budgets are shared across all its
inferences and fallbacks; they are not reset per task. Instantiate routers under
host control, rather than creating a new router for each untrusted retry.

| Limit | Default | Meaning |
| --- | --- | --- |
| `maxCalls` | 100 | Attempt admissions over the router lifetime, including failed/preflight-rejected attempts |
| `maxTokens` | 65,536 | Retained input/output token ceilings plus verified per-direction excess over all attempts |
| `maxCostUSD` | 0 | Admission budget for retained ceilings plus reported excess; paid inference requires explicit configuration |
| `timeoutMs` | 30,000 | Total elapsed budget for one inference and all fallback attempts |
| `maxInputTokens` | 4,096 | Reserved per token-based attempt; adapter must enforce backend input limits |
| `maxOutputTokens` | 1,024 | Reserved per token-based attempt; adapter must pass generation limits to its backend |
| `maxInputBytes`, `maxOutputBytes` | 65,536 each | Finite JSON snapshot byte limits, independently of tokens |

Reservation = input ceiling × `inputTokenUSD` + output ceiling ×
`outputTokenUSD` + `callUSD`. Rules/neural adapters reserve zero tokens and zero
cost, but still consume call budgets and obey byte/deadline limits. Rates must
include fees/overheads and represent a conservative maximum. No live pricing
lookup or billing account is configured.

USD configuration and result fields remain numbers. Internally, ModelRouter
converts each validated number's shortest decimal representation into BigInt
units of 10^-324 USD. This covers every supported finite price, even 5e-324,
without making tiny positive prices free. Integer multiplication/addition and
comparison govern admissions; no epsilon or floating-point accumulated cost is
used. A value already computed as 0.30000000000000004 by the caller retains that
value; the router does not guess that the caller intended 0.30.

An attempt's exact price sum is converted to the smallest representable Number
cap that covers it, rounding upward only if needed. That entire public cap is
reserved and checked before dispatch. Thus numeric adapter limits are fully
funded. Extremely fine mixed rates can conservatively reserve a small surplus.
Public totals are numeric displays; all decisions use the integer ledger.

`budgetUsage.reservedCostUSD` reports retained ceilings plus valid reported
excess. Reservations are never refunded, including when a successful response
reports a lower or zero charge: the API has no final-invoice indicator. Unknown,
failed, timed-out and cancelled work retains its full reservation. `ModelUsage`
preserves the provider's reported usage; `null` means unreported, not zero.
Each attempt is reconciled conservatively as max(reservation, valid reported
cost). Reported excess is debited, fails with `usage-limit` and disables the
router without fallback, even if model data is malformed. The total can exceed
the configured budget after an already incurred provider overrun; it is not
clamped or hidden. Late reports after cancellation/timeout can increase this
ledger and latch the overrun but cannot change the returned cancelled/timeout
result. Malformed or out-of-range billing reports retain the reservation and
cannot be treated as authoritative charges.

One active inference per router remains the contract: simultaneous or reentrant
requests return `busy` without consuming budget. The owning call reserves before
provider dispatch; retries initiated by callers and each fallback reserve again.
Separate router instances do not share an account-level budget.

R02 validates usage independently before inspecting model data. Input and output
token overruns stop fallback even when the data has the wrong schema, is cyclic,
is oversized or contains accessors. The lifetime token ledger retains each
attempt's input/output ceilings and adds valid reported excess per direction.
Failed attempts retain sanitized usage snapshots where available; revalidation
does not debit the same excess twice. See `docs/audits/shivax-r02.md`.

A token-based provider must supply both token counts as nonnegative safe integers
no greater than 100,000,000. Missing, null, invalid, inherited or accessor usage
metadata fails closed with `usage-unverifiable`: no fallback and no router reuse.
Each valid field is still checked independently, so a known overrun takes
precedence over another invalid field. Only host-declared token-free providers
may return null token counts; any positive count still exceeds their zero ceiling.
The full usage envelope must contain inputTokens, outputTokens and costUSD.
Explicit null cost remains permitted because a conservative monetary ceiling is
already reserved; an absent or invalid cost field is unverifiable.

Schema/semantic output failures can fall back only after usage was verified.
Provider-declared invalid output without usage cannot establish that condition.
Ordinary execution/transport failures mapped to `provider-error` and explicit
`unavailable` remain retryable with host opt-in and full retained reservations:
these trusted adapter error categories are not evidence of free or unbilled work.
Adapters must report known hard limits or unverifiable returned usage explicitly.
Provider timeouts and hard limit errors are terminal for the inference. Router
usage overruns and unverifiable usage latch a persistent block. A late returned
report or terminal usage failure can latch that block after cancellation, without
changing the result already returned to the caller.

### Typed, sanitized failures

Existing code values remain compatible. New `ModelError` constructor aliases
normalize to those codes; `error.reason` is the additive `ModelFailureReason`
classification. Both result and attempt error details carry fixed messages and
these bounded classifications, never provider exception text, prompts or secrets.

| Classification / accepted constructor alias | Emitted code |
| --- | --- |
| `token-limit-exceeded` | `token-limit` for admission, `usage-limit` for a reported overrun |
| `cost-limit-exceeded` | `cost-limit` for admission, `usage-limit` for a reported overrun |
| `invalid-provider-output` | `invalid-output` after verifiable usage |
| `usage-unverifiable` | `usage-unverifiable` |
| `provider-timeout` | `timeout` |

When both token and cost excess are reported, both ledgers are updated and the
token classification takes precedence. The model-operation bridge preserves the
classification; specialist bots retain their existing sanitized error mapping.
Ollama preserves known usage when generated JSON cannot be parsed, and distinguishes
invalid token metadata from retryable transport failures. Its low-level SLM error
codes and public method signatures remain unchanged.

These are admission limits, not a remote billing guarantee. A remote backend can
already have incurred a charge before returning an over-limit report. Host
adapters must enforce server token/spend controls; a malicious or faulty adapter
cannot be sandboxed by TypeScript contracts. Ollama uses a conservative UTF-8
prompt/schema estimate plus template reserve before dispatch and validates actual
reported counts afterward; the estimate is not an exact model tokenizer.

Timeout/cancellation bounds the caller's wait and aborts the provider signal.
The router remains busy until actual pending provider/loader work settles. Late
responses cannot become success or trigger fallback. Monotonic elapsed checks
also cover synchronous work that delays timers. Synchronous JS/ML work cannot
be preempted mid-call; its late result is rejected. `dispose()` cancels admission
and active work permanently; it does not own a remote SDK's host-managed cleanup.

## Structured output and specialist integration

Use a host-supplied `ModelOutputContract`: schema plus an optional synchronous
semantic predicate. Both must pass before output is accepted. Schema keywords
are the existing specialist subset: `type`, `properties`, `required`,
`additionalProperties`, `items`, array/string/number bounds, primitive `enum`,
and `oneOf`. Unknown keywords and constraints without their required type are
rejected. This is not a complete JSON Schema implementation. An empty schema is
intentionally unconstrained JSON; use narrow schemas for exposed operations.
Getters, functions, non-finite numbers, cycles and oversized structures fail.
Async predicates fail closed, with rejected promises observed.

`createModelOperation(router, capability, contract, routingOptions)` returns an
injected specialist method. For example, supply its result as Brihaspati's
`decide`/`plan`, Vishwakarm's `suggest`, Sanjay's `analyze`, or Yudhishthir's
`review`. Each operation needs the matching raw provider-output contract from
the [specialist guide](specialist-bots.md); specialist semantic validation still
runs afterward. Scope/task/session context and cancellation propagate.

```ts
import { ModelProviderRegistry, ModelRouter, NeuralModelProvider } from 'shivax';

// `trainedNetwork` is an existing host-owned NeuralNet; no automatic training.
const registry = new ModelProviderRegistry()
    .register(new NeuralModelProvider('existing-network', trainedNetwork));
const scope = { kind: 'personal' as const, id: 'workspace' };
const router = new ModelRouter(registry, { scope, limits: { maxCalls: 10, maxTokens: 0 } });
const result = await router.infer({
    capability: 'numeric-inference', input: [0, 1],
    context: { taskId: 'task', sessionId: 'session', scope, signal },
    output: { schema: {
        type: 'object', properties: { predictions: { type: 'array', items: { type: 'number' } } },
        required: ['predictions'], additionalProperties: false,
    } },
});
```

The runnable offline demo is `node examples/hybrid-intelligence.mjs`. It explicitly
trains a small regression example, routes numeric inference, then checks its
output through a real rule. Training there is a demo instruction, not a provider
side effect. No remote API or Ollama installation is needed.

## Changed files and validation

New modules: `src/intelligence/types.ts`, `errors.ts`, `validation.ts`,
`registry.ts`, `router.ts`, `neural.ts`, `rules.ts`, `ollama.ts`, `remote.ts`,
`bridge.ts`, `index.ts`.

Other files: additive exports in `src/index.ts`; additive usage/checkpoint method
in `src/slm/ollama.ts`; new `tests/intelligence.test.mjs` and
`examples/hybrid-intelligence.mjs`; portable declaration coverage in
`tests/package.test.mjs`; this guide, `SHIVAX_ARCHITECTURE.md` and `SHIVAX_PHASES.md`.

Verification: **292 tests passed, zero failures**, including all 268 prior tests
and 24 new provider/router tests. Coverage includes all capability selections,
registration, actual neural prediction equivalence/weight preservation, real
rules, local transport fixtures, remote lazy loading, invalid output, scope,
fallback permissions, budgets, cancellation, timeout ownership, synchronous
deadline regressions and RUDRA/specialist integration. The declaration consumer
compiles with ES2020 only and no ambient DOM/Node types. Legacy ESM/CJS loading,
ML use without optional browser globals, serialization and digit tests pass.

Build/type checks use installed TypeScript and Rollup binaries; JavaScript
tooling uses the existing ESLint configuration. The offline demo and package dry
run pass. Rollup retains its pre-existing nonfatal TypeScript private-field helper
warnings. No new dependency, package publication or production change.

Limitations: no live model quality evaluation, live Ollama service, remote SDK,
actual credentials, real vision backend, browser matrix or billing integration
was exercised. Transport/client fixtures test behavior, not model intelligence.
Existing neural/MNIST/browser source and training data are unchanged.

Phase 05 implementation passed the checks above. Subsequent review reproduced
two unresolved defects: an invalid output can hide a reported usage overrun and
permit fallback, and binary floating-point costs can reject an exact budget
boundary (three $0.10 calls under a $0.30 ceiling). These require corrections
before Phase 05 review sign-off. Phase 06 does not modify this router or depend
on it for memory by default.
