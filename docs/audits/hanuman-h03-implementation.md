# SHIVAX 0.4.0 HANUMAN — H03-A prerequisite and integration audit

Date: 17 November 2026 (Asia/Calcutta). Audited HEAD: `013e70d44981f59945039a88facd9f836cbcc115`. Working tree was clean before this audit. Installed runtime: Node `v22.23.2`.

**Implementation gate: FAIL / BLOCKED. H03-A integration is not implemented.** The task explicitly requires H01 and H02 completion. [H01-D](hanuman-h01-security-review.md) says **H01 NO-GO**; [H01-C](hanuman-h01-test-report.md) says **FAIL**. Both H01 P1 findings remain present in current source. [H02-D](hanuman-h02-review.md) grants only conditional GO and retains an additional retry defect. Passing baseline checks do not clear these gates. No waiver is inferred from the request to begin H03-A.

This pass completes the independent execution audit, prerequisite reproductions, baseline validation and proposed integration map. It changes only this report. No production source, committed tests, public APIs, permissions or dependencies changed. H03-B has not begun.

## 1. Prerequisites verified against current source

Read the H00 architecture audit, H01 threat model, enforcement, test and security reports, H02 schema, implementation, test and review reports. Checked their findings against the actual gateway, bot, RUDRA, workflow, Jay/Vijay, firewall, registry and routing source. Documentation alone was not treated as proof of a current defect.

| Finding | Current evidence | Gate consequence |
| --- | --- | --- |
| H01D-01: workflow retries deterministic fetch denials | `HanumanFetchError` extends `Error`; `ToolLease` converts it to `SecurityError('tool-error')`. `RudraWorkflowEngine` retries that code for read-only routes. Fresh offline probes in ESM and CJS each produced **4 approvals, 4 resolves, 4 GET callbacks, 4 closes** for one 302 response with `maxRetries: 3`. | H01 P1 remains open. |
| H01D-02: missing reviewed host transport | `HanumanFetchTransport` remains an interface in `src/integrations/hanuman/types.ts`; repository examples and tests supply mock callbacks. No reviewed Node socket/TLS adapter has been added. `git diff --name-only 0a813e4 HEAD -- src/integrations/hanuman src/workflows/engine.ts src/security` is empty. | H01 P1 remains open. Actual DNS-to-socket binding and TLS safety cannot be certified. |
| H02D-01: clock failure after retrieval is retryable | `src/bots/hanuman.ts` calls `options.now()` after `toolCall` and maps invalid time to `bot-error`. Fresh ESM/CJS probes with a `NaN` clock and four-attempt budget each produced **4 approvals, 4 resolves, 4 GET callbacks, 4 closes, 3 retry events**. | H02 conditional GO does not resolve this H03 retry risk; fix/review before proceeding. |
| H01D-03: missing specialist | Already addressed by H02: `HanumanBot` and `registerHanumanBot` exist and are exported. | Do not add a duplicate implementation task. |

No probe sent an actual network request. “GET” above counts the existing in-memory host transport callback. Each repeated attempt was re-authorized; these findings demonstrate prohibited repetition of denied/completed retrieval, not an authorization bypass.

`package.json` is currently **0.3.3**, with the stale description `ShivAX AI - Narasimha Release`. Neither was changed. Preserve all current exports, including the requested 0.3.2 compatibility surface; this task does not authorize a version bump or ID migration.

## 2. Existing execution architecture (before editing)

| Concern | Actual implementation and behavior |
| --- | --- |
| Default discovery | `src/bots/system.ts` returns seven bots: `sanjay`, `brihaspati`, **`vishwakarma`**, `chitragupt`, `narad`, `yudhishthir`, `ekalavy`. They expose 29 capabilities. `BotRegistry` snapshots registrations and rejects duplicate IDs. There is no global registry. |
| Hanuman registration | `src/bots/hanuman.ts`: `registerHanumanBot(registry, { tools, ... })` checks duplicate ID and presence of `shivax.hanuman.fetch`, then registers only the bot. It creates no permission, policy, transport or firewall operation. Direct constructor registration does not perform the helper's availability check. |
| Capability support | Stable bot ID `hanuman`, sole operation **`fetch.url`**. `fetch.api` and `research.search` are reserved, not implemented. The H01 convenience capability **`hanuman.fetch`** is distinct from the H02 bot capability; the protected tool ID is **`shivax.hanuman.fetch`**. No alias or automatic permission relationship exists between them. |
| Planning | `src/agents/rudra/planner.ts`: deterministic single requested-capability step. `validation.ts` snapshots bounded plans; permits only task, literal or earlier-step data sources; rejects invalid schemas, duplicate steps and forward references. Planners cannot specify bot IDs, grants or approval decisions. |
| Bot selection | `RudraOrchestrator` captures descriptors before planning, sorts by bot ID, filters capabilities by the configured allowlist, validates all routes before execution, then picks the first matching bot. An optional synchronous host routing hook can choose only among matching registered candidates. Invalid hook output falls back to the deterministic candidate. |
| Allowlist default | Both RUDRA options and workflow settings default `allowedCapabilities` to the root task capability. Consequently current generic behavior does **not** enforce H03's extra requirement that Hanuman have an explicitly supplied allowlist. Preserve the legacy default for existing bots. |
| Selection versus admission | Candidate discovery checks registration and declared capability, not full tool availability or all security requirements. Root protection happens before planning; the selected bot's effective capability/tool/firewall admission happens later through Vijay. A registered candidate is not proof of authorization. |
| Tool admission | Capability-scoped `requiredTools` flow through `toolsForCapability`, `Vijay.runBot`, `ToolLease` and `ProtectedToolRegistry`. Protected bot tools require the security guard. `toolCall` maps tool failures to non-retryable `tool-not-allowed`; no arbitrary fallback tool/provider is invoked. |
| Jay / Vijay | Jay requires the exact minted context, checks active identity/scope/expiry, and asynchronously verifies provider session validity. Vijay checks capability/tool policies, effective permissions, input predicates, effects, grants, registry identity and protected leases. Retained checkpoints recheck admitted policy identity; admission is not transferable. |
| Approvals | RUDRA's optional host approval handler runs per bot attempt. Vijay separately requires approval when the applicable policy says so and verifies Jay again after approval. A host RUDRA approval is not a substitute for tool-policy approval. Policy/lease checks run before protected invocation. |
| Firewall | Existing protected task/bot/tool descriptors, realm, origins, resources and limits bind execution. ENFORCE denies prohibited operations. MONITOR can observe optional rule violations but preserves mandatory protections. LOCKDOWN fences new work and aborts cooperative leases. No already-transmitted request can be undone. |
| Budgets | RUDRA limits attempts/steps, total time and aggregate output, and passes remaining time to each child. Existing model integrations retain their own accounting. The workflow engine reserves steps/tool calls and model calls/tokens/cost **before** asynchronous approval, with no failure refund. Decimal cost accounting rounds reservations conservatively. Model budgets default to zero. |
| Retry | Defaults are zero retries, capped at three extra attempts. RUDRA retries only `bot-error`, and under security only with a read-only effect. Workflow retries only read-only `tool-error`. Every attempt re-enters security/approval and consumes budget; the two error-classification defects above remain. |
| Pause/resume | `RudraWorkflowEngine` exposes a host-only handle. Pause resolves at a quiescent action boundary; resume revalidates the task through Vijay/Jay before protected work. It does not replay completed actions. The bot orchestrator has no equivalent public pause/resume handle. Workflow retry iterations are inside an action, not separate pause boundaries. |
| Cancellation / cleanup | Both engines use bounded awaits, abort signals, deadlines and pending-work tracking. Leases/busy ownership persist while underlying work drains. The gateway checks before dispatch, after awaits and during stream consumption and closes acquired responses. Host transport cooperation is still required. |
| Workflow plans | `src/workflows/engine.ts` consumes `AutonomousWorkflowPlan.actions` and `ToolRegistry` bindings, not `BotRegistry` specialist steps. Input dependencies refer to earlier actions; only host-attested, policy-checked read-only independent actions can overlap. It cannot be described as already invoking HanumanBot merely because it can invoke the fetch tool. |
| Audit output | RUDRA emits state, plan, selection, outcome, retry and memory metadata; workflow emits state/action/retry metadata. Security and firewall maintain their own audit boundaries. Retrieved bodies are not routing or security configuration fields. |

## 3. Runtime trust boundaries

Current specialist path:

`trusted host registration + Jay context → RUDRA plan/route → Vijay bot admission + NARASIMHA leases → HanumanBot → toolCall → Vijay tool admission → registered H01 gateway → trusted host transport → bounded untrusted envelope → validated Hanuman evidence`

Current tool-workflow path:

`trusted host ToolRegistry binding + Jay context → RudraWorkflowEngine action/budget checks → Vijay.executeTool + NARASIMHA → same registered H01 gateway → untrusted WorkflowOutput`

The tool-workflow path returns the gateway envelope, not automatically the richer HanumanBot evidence. The H02 evidence preserves registered target reference, receipt timestamp, MIME type, byte count, bounded excerpt, truncation, `trust: 'untrusted'` and constant provenance. Its digest identifies data; it is not an authenticity or approval signature. Gateway envelopes retain target ID and untrusted classification.

Plans are validated before step execution. Earlier outputs may become a later step's **data**, never its capability, permissions, tenant, approval, policy or budget. Trusted host planners/providers must preserve this separation when summarizing evidence. Neither engine proves that an arbitrary host callback cannot interpret text incorrectly. Do not promote fetched text to verified SARASWATI feedback, executable code or administrator instructions.

The gateway accepts a host catalog target ID, not caller URLs or credentials. It uses `checkExecution()` and `checkNetworkAccess()` with a protected resource boundary. It validates resolved addresses, response peer membership, no redirects, status, media/encoding, byte/chunk limits and output shape. This validates what the host reports; it **cannot** establish that an arbitrary callback connected to that peer. The missing transport must actually pin DNS-approved destinations, validate TLS, reject unauthorized redirects/credentials, enforce wire limits and clean up cancellation.

**No-network-default invariant remains intact:** seven default bots, no automatic Hanuman registration, no automatically installed transport, no global fetch path, no permission creation. Optional retrieval needs all host registration and effective policy layers.

Synchronous execution checkpoints check minted identity activity/expiry, policy identity, resources and abort state. They cannot poll an asynchronous identity provider after every await. Immediate external session revocation must be propagated by the host through cancellation/current policy state; new admissions, approvals and resume perform asynchronous verification. Do not promise stronger revocation semantics than these APIs provide.

## 4. Proposed integration and file-level change plan (not implemented)

First close and re-review H01D-01/H01D-02, and correct H02D-01. Then implement H03-A as a separate authorized continuation. No new engine, transport in core, future bot, permission grant, or duplicate gateway is needed.

| Files / area | Planned responsibility | Compatibility constraint |
| --- | --- | --- |
| `src/integrations/hanuman/service.ts`, existing gateway tests | Prerequisite correction: preserve non-retryable deterministic denial semantics through the protected-tool boundary. | Preserve sanitized observer codes, output validation and authorization; do not widen retries globally. |
| Node-only host example/adapter and isolated transport tests, exact path to be established in H01-C | Prerequisite transport completion and review. | Outside browser bundles; no new core network client or automatic network access. |
| `src/bots/hanuman.ts`, H02 schema/report and bot tests | Prerequisite clock-error correction: validate before retrieval and use a non-retryable failure. | Stable evidence schema, bot/capability/tool IDs and explicit registration. |
| `src/agents/rudra/orchestrator.ts`, `validation.ts`, `types.ts` | Make Hanuman eligibility require an explicit host capability allowlist, matching registration/tool, and current protected admission before execution. Keep the existing plan structure. Define precisely whether eligibility means candidate visibility or final executable selection; do not claim a synchronous routing hook performs asynchronous Jay verification/approval. | Existing seven-bot defaults, generic plan API, effect-aware retry ceilings and legacy pure execution must remain compatible. No fallback to a different fetch implementation after denial. |
| `src/agents/rudra/planner.ts` | Keep deterministic planner and bounded data-only plan contract. | No fetched text injected into privileged planning fields. No change expected merely to recognize the capability. |
| `src/workflows/engine.ts`, `validation.ts`, `types.ts`, `registry.ts` | Reuse existing action/dependency/binding, reservation, approval and pause/resume machinery. Explicitly define the optional specialist-to-workflow composition because tool bindings are not bot execution. Require fresh admission at every attempt/resume and prohibit denial retries. | No second scheduler, implicit bot-to-tool alias, nested budget reset or default binding. Avoid accidentally authorizing `hanuman.fetch` from a `fetch.url` grant. |
| `src/security/vijay.ts`, `src/security/tools.ts`, `src/security/firewall/` | Reuse current protected admissions, resource checks, policy identity and cooperative revocation. Only consider a narrowly scoped API addition if full preselection checks cannot use current contracts without double approvals or reservations. | Do not weaken mandatory enforcement in MONITOR or change unrelated authorization rules to pass tests. |
| `src/learning/routing.ts` | Require explicit Hanuman eligibility for shadow evaluation and approved policy selection; pass current bounded eligibility through existing host interfaces. | Preserve verified evidence, tenant ownership, approved model registry lifecycle and rollback. Advice must remain data-only and perform no retrieval. |
| Focused RUDRA/workflow/Hanuman/routing test files | Add the acceptance cases below after prerequisites are resolved. | Reuse offline fixtures and real authorization layers; assert zero transport calls for pre-dispatch denials. No dependency additions. |
| SDK entrypoints | Reuse current root/bots/rudra/integrations exports. | No new package; preserve ESM/CJS/declarations/browser graph boundaries. |

### Regression risks to resolve before implementation

1. Treating the default root capability as an explicit fetch allowlist would silently opt hosts into routing. Tightening all capabilities instead would break existing seven-bot behavior.
2. Candidate discovery currently precedes full bot/tool admission. A generic `fetch.url` collision or invalid routing-hook fallback can select another bot; Hanuman-specific denial must not become unapproved alternate-provider execution.
3. Preflight authorization can accidentally duplicate human prompts, consume resources twice or cache a stale approval. Actual dispatch must always recheck effective policy and identity.
4. Confusing `fetch.url`, `hanuman.fetch`, and `shivax.hanuman.fetch` can misbind firewall descriptors or widen capability policies.
5. Retrying deterministic denial or post-fetch formatting failure repeats side effects despite fresh authorization. Both current failures were reproduced; zero default retries is not a fix for host-enabled retries.
6. Wrapping one engine in another can reset model/time budgets or create orphaned leases. Preserve shared deadline/cancellation and budget accounting, including task/bot/tool concurrent reservations.
7. Stripping the untrusted wrapper/provenance when forwarding dependency results can make downstream summaries appear authoritative. Keep evidence intact as data.
8. Changing shadow eligibility must not execute probes, alter current routing or bypass versioned model approval/rollback.

## 5. SARASWATI compatibility

`src/learning/routing.ts` uses registered capability candidates, verified curated/evaluation evidence, tenant ownership, optional Jay/policy checks, firewall views and provider-budget views. The advisor is shadow-only. `RoutingPolicySwitch` applies a closed policy schema; registry synchronization requires an approved configuration artifact and a rollback target for nonempty policy rules. RUDRA limits hook answers to registered capability candidates and still invokes Vijay.

Current shadow security/environment inputs are optional, and tool availability is not a complete part of advisor eligibility. Therefore existing shadow behavior is **not yet proof** of H03's stricter explicit Hanuman eligibility requirement. During lockdown a policy hook can return null, allowing deterministic selection; execution enforcement must still deny. Preserve this distinction between advice, selection and authorization. No learning, model approval or rollback source changed in this pass.

## 6. Acceptance tests for resumed H03-A

These are the required new integration assertions, **not tests claimed as implemented by this report**. Existing focused tests cover many underlying mechanisms but do not establish the new H03 admission contract.

| Case | Required assertion |
| --- | --- |
| Default / opt-in | Exact seven IDs/29 capabilities; no Hanuman without registration; opt-in adds one bot and zero grants/tools. |
| Allowed route | Explicit `fetch.url` allowlist + registered Hanuman/tool + active Jay + permitted Vijay/firewall + budget + required approval produces one bounded untrusted evidence result. |
| Denied capability | Missing explicit allowlist or omitted capability fails before transport; no alternative provider or arbitrary tool fallback. |
| Tool/session | Missing/unregistered host tool, invalid/expired/revoked session, denied grants or tenant mismatch produce zero initial dispatches. |
| Firewall modes | ENFORCE denial and LOCKDOWN block; MONITOR never weakens mandatory identity/tenant/network/budget checks. Mid-flight lockdown cancels cooperative work and blocks later dispatch/retry. |
| Approval races | Change permission, identity validity, tool registration or firewall during approval; approve true afterward must not revive stale authority. |
| Budgets | Exhausted steps/time/model tokens/cost deny; reservations remain shared and conservatively accounted; denial does not refund or reset them. |
| Retries | Deterministic gateway denial and invalid clock have no additional dispatch/retry. Any admitted transient retry rechecks policy and approval and consumes the existing budget. |
| Pause/resume | Pause at action boundary; revoke while paused; resume denies protected work. Completed actions are not replayed. |
| Evidence | Injection text remains untrusted data with provenance; no grants, workflow changes, privileged calls or verified-feedback insertion. |
| Routing / learning | Existing seven-bot routing unchanged; Hanuman absent/ineligible never recommended; shadow calls perform zero tools and approved policy rollback stays intact. |
| Optional capabilities | `fetch.api` and `research.search` remain unavailable until separately implemented and approved; no automatic aliases/providers. |

Comprehensive H03-B integration work remains deferred.

## 7. Actual validation evidence

All commands ran locally, without dependency installation or external network tests. pnpm commands used these process-local settings to reuse the installed dependency layout offline:

```powershell
$env:PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false'
$env:PNPM_CONFIG_OFFLINE='true'
$env:PNPM_CONFIG_NODE_LINKER='hoisted'
$env:PNPM_CONFIG_PACKAGE_IMPORT_METHOD='copy'
pnpm lint
pnpm test
pnpm build
pnpm verify:package
```

| Command | Exit | Actual outcome | Local log (ignored scratch files) |
| --- | --- | --- | --- |
| `pnpm lint` | 0 | PASS TypeScript/no-emit and ESLint | `node_modules/h03a-lint.log` |
| `pnpm test` | 0 | PASS **1,143 / 1,143**, fail/cancelled/skipped/todo **0**; includes build | `node_modules/h03a-test.log` |
| `pnpm build` | 0 | PASS declarations, CJS declaration generation, ESM/CJS bundles and learning worker | `node_modules/h03a-build.log` |
| `pnpm verify:package` | 0 | PASS packed ESM/CJS imports; **170** gateway + **76** bot tests; browser-safe root/bots/integrations graphs; **13** declaration entries in **5** TS modes; **12** offline examples; worker training ESM/CJS; **532** packaged files | `node_modules/h03a-package.log` |
| Focused command below | 0 | PASS **832 / 832**, fail/cancelled/skipped/todo **0** | `node_modules/h03a-focused.log` |
| `node node_modules/h03a-fetch-probe.mjs` | 1 | **FAIL 2 / 2**, pass **0**, skipped/cancelled **0**: H01D-01, ESM and CJS | `node_modules/h03a-fetch-probe.log` |
| `node node_modules/h03a-bot-probe.mjs` | 1 | **FAIL 2 / 2**, pass **0**, skipped/cancelled **0**: H02D-01, ESM and CJS | `node_modules/h03a-bot-probe.log` |

Focused command, run against the freshly built source:

```powershell
node --test tests/hanuman-bot.test.mjs tests/hanuman-fetch.test.mjs tests/rudra.test.mjs tests/workflows.test.mjs tests/agents.test.mjs tests/specialists.test.mjs tests/security.test.mjs tests/firewall.test.mjs tests/firewall-integration.test.mjs tests/firewall-management.test.mjs tests/firewall-model-integration.test.mjs tests/learning-routing.test.mjs tests/learning.test.mjs tests/learning-registry.test.mjs tests/learning-governance.test.mjs tests/model-cost.test.mjs tests/model-safety.test.mjs tests/intelligence.test.mjs tests/inspectra-adapter.test.mjs
```

Counts above overlap; they are not additive unique coverage. The four failed probes are separate from the unchanged 1,143-test baseline and are not skipped, marked TODO or represented as passes.

### Reproduction details

Scratch scripts reuse the fixture definitions from `tests/hanuman-fetch.test.mjs` and `tests/hanuman-bot.test.mjs`, including the existing Jay, Vijay, firewall, approval and mock transport composition. Imports point to the freshly built ESM/CJS artifacts and shared `tests/fixtures/hanuman-transport.mjs`. Global fetch remains trapped. No production code was mutated.

- **Workflow denial:** set fixture `response.status = 302`; count approval callbacks; start one `hanuman.fetch` task-input action with explicit `allowedCapabilities: ['hanuman.fetch']` and `maxRetries: 3`. Assert request count equals one. Actual count is four in each format, and all four responses close.
- **Bot clock:** set the fixture registration clock to `() => NaN`; keep the real protected bot path, explicit `allowedCapabilities: ['fetch.url']`, `maxSteps: 4`, `maxRetries: 3`. Assert zero retry trace events. Actual count is three in each format, with four transport requests/approvals/closes.

Initial scratch-runner setup had generation syntax, test-file discovery under `node_modules`, and package-self-import errors. These were corrected before the final direct script runs above; they were not SHIVAX test failures. Scripts/logs remain local ignored scratch artifacts and may be removed by dependency cleanup; the reproduction procedure and observed counts are recorded here permanently.

## 8. Changed paths, limitations and next gate

**Only source-controlled change:** `docs/audits/hanuman-h03-implementation.md` (this report). Validation rebuilt ignored `dist/`; scratch probes/logs are under ignored `node_modules/`. Existing source, tests, package metadata, dependencies, Inspectra and Visynq were not edited. Nothing was pushed, tagged or published.

Baseline compatibility validation is **PASS**. The H03-A implementation gate is **FAIL / BLOCKED**, and live deployment remains **NO-GO**. No H03 production integration, new eligibility API, new permanent focused integration suite, transport implementation or wire-level security claim is delivered by this audit. Existing test success does not demonstrate those missing features.

Required next action: complete and review the outstanding H01 corrections and transport, correct the H02 clock retry defect, then explicitly resume H03-A against that reviewed baseline. This report neither waives prerequisites nor starts their implementation or H03-B automatically.
