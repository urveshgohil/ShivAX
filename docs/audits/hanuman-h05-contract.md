# SHIVAX 0.4.0 HANUMAN · H05-A Jambavan and Kubera contract

Date: 18 November 2026. Base: HEAD `272108c`, branch `feat/hanuman-v0.4.0`. Architecture and contract work only: no production source, test or dependency was changed.

**Summary.**

- **Jambavan** (capability discovery) and **Kubera** (budget reporting) are optional, read-only host utilities. They are not bots, are not registered in `BotRegistry`, and are not planner-selectable.
- **Authorization.** Both are admitted through the existing Jay and Vijay path, `Vijay.protectTask`, using host-registered capability policies. Neither adds a new authorization model.
- **Data sources.** Both read only canonical in-memory sources. Kubera keeps no ledger, adds no rounding, and never sums across sources.
- **Additions.** Two public factory functions, `createJambavanDiscovery` and `createKuberaReporter`, plus their types, exported from the existing `shivax` and `shivax/security` entrypoints. They are backed by four internal, non-exported reader tables. No enforcement path changes.

## 0. Prerequisites, change plan and regression risks

### Prerequisite status

| Phase | Status | Effect on H05 |
| --- | --- | --- |
| H00–H02 | Complete | None |
| H03 | Complete, **NO-GO** (H03C-01 P1, H01D-02 P1, H03C-03/04 P2) | **H03C-01 (implicit routing eligibility):** Jambavan reports *entitlement*, never *routing eligibility* (§2.6). **H03C-03 (in-flight revocation):** discovery and reports are point-in-time (§2.8). |
| H04 | Complete, **NO-GO** (H04C-01 P1, H04B-01/02 P2) | None. Jambavan and Kubera do not use Abhimanyu or Ashwatthama. |

H05-A is design-only, so it proceeds and records these open findings. **H05-B (implementation) should not start until the owner either waives or closes the H03 and H04 NO-GO items**, as was done for H04-A.

### Change plan for H05-B

1. **Internal reader tables.** Add four additive, non-exported tables that expose existing state read-only (§4.1). Enforcement logic stays untouched.
2. **Shared helpers.** Extract two existing private computations into shared helpers so that reporting reuses enforcement code instead of copying it:
   - Vijay's permission-subset check.
   - The firewall's operation matching.
   - The router's admission cost is a third, optional extraction (§4.1).
3. **New modules.** Add `src/security/jambavan.ts` and `src/security/kubera.ts`, and export them from `src/security/index.ts`.
4. **Tests.** Add offline tests (§9). No existing assertion may be weakened.

### Regression risks

| Risk | Where | Mitigation |
| --- | --- | --- |
| Helper extraction changes Vijay or firewall semantics | `vijay.ts` `#assert`; `runtime.ts:700-720` matching | The extraction is a pure function with identical inputs. Run the full security and firewall suites, plus mutation checks (§9.6). |
| The router admission-cost extraction alters reservations | `router.ts:222-238` | Optional. If not approved, ship Kubera without estimates (§3.7). If approved, the existing `$0.30` regression and cost tests must pass unchanged. |
| New root exports collide or break export parity | `src/index.ts`, `sdk/security.ts` | New names are unique. `sdk.test.mjs` ESM/CJS key parity and `verify:package` declaration checks cover this. |
| Reader tables keep objects alive | WeakMaps keyed by router, runtime, run and Vijay | WeakMap keys only, the same pattern as `guardedModelRoutes` and `coreRootChecks`. |
| Discovery and reports consume firewall operations | Firewall `maxOperations` (§2.2) | Documented host requirement, and itself visible in Kubera. |

## 1. Existing API audit

### 1.1 Bot capabilities: `BotRegistry` (`src/agents/registry.ts`)

| Fact | Evidence | Consequence for Jambavan |
| --- | --- | --- |
| `listCapabilities()` returns the first-registered descriptor per capability ID, deduplicated by insertion order. It has no permission filter, no bot binding and no tenant. | `registry.ts:38-45` | Unsuitable as-is. It loses which bot serves the capability, so required tools cannot be derived. Jambavan uses `list()` sorted by bot ID, which is exactly RUDRA's deterministic choice (`orchestrator.ts:220-232`, `eligible[0]` at `:255-260`). |
| Descriptors are frozen snapshots taken at registration: `id`, `description` (≤ 2,048 characters), optional `inputSchema` (≤ 64 KiB), and `requiredTools` `{id, description}`. Up to 128 capabilities per bot. | `validation.ts:192-247` | These are the only capability metadata that exist. There is **no display name, category, schema version or approval flag**; those must come from host descriptors (§2.4). |
| `toolsForCapability(bot, cap)` combines bot-wide and per-capability tools. | `validation.ts:250-261` | This is the tool set Vijay's `runBot` requires in context `toolPermissions` (`vijay.ts:536-543`). |
| Registration is dynamic (`register`/`unregister`, with events). There is no version counter. | `registry.ts:10-22` | Results are point-in-time. A cache cannot be invalidated reliably (§2.8). |
| No global instance. | `registry.ts:6` | Jambavan takes an explicit registry. |

### 1.2 Tools: `ProtectedToolRegistry`, `PermissionPolicyRegistry` and `ToolRegistry`

| Fact | Evidence | Consequence |
| --- | --- | --- |
| `ProtectedToolRegistry` has `get`, `register` and `unregister` only, and **no `list()`**. | `security/registry.ts:61-98` | Tools cannot be enumerated. Jambavan only considers tool IDs declared by a visible bot capability or a workflow binding. It never accepts caller-supplied tool IDs, which closes off probing. |
| `PermissionPolicyRegistry.list()` returns every policy, including the host `validateInput` closures. | `security/registry.ts:55-57` | It is host-only. Policies must never be returned. Jambavan reads `get(kind, id)` through Vijay's own registry (§4.1). |
| A policy is `{kind, id, permissions, effect, requiresApproval, validateInput}`. `requiresApproval` is forced to true for `state-changing`. | `security/registry.ts:17-40`; `types.ts:33-42` | `effect` and `requiresApproval` are the authoritative "operation type" and "approval indicator". `permissions` are never revealed. |
| Workflow `ToolRegistry.list()` returns `RegisteredWorkflowTool`, including the `tool` object with `execute`. | `workflows/registry.ts:236-238` | It must never pass through. Jambavan projects only `capability`, the binding `id` and `effect`. |
| Workflow routing takes `findByCapability(cap)[0]` (sorted by ID) and re-checks that the binding is still the registered tool. | `engine.ts:241`, `:259-263` | Jambavan mirrors this and applies the same stale-binding test. |

### 1.3 Identity and authorization: Jay, Vijay and `ToolLease`

| Fact | Evidence | Consequence |
| --- | --- | --- |
| Identity lives in Jay's private `WeakMap<TaskContext, identity>`. `assertActive` (synchronous expiry check) and `verify` (asynchronous `isSessionValid`) require the **exact minted context**. | `jay.ts:19`, `:144-161` | A copied or forged context fails with `unauthenticated`. Payloads cannot supply a principal. |
| `TaskContext.security` carries `caller {id, issuer}`, `scope {kind, id}` and the host-narrowed `toolPermissions`. **Principal permissions are not in the context.** | `agents/types.ts:24-28`; `jay.ts:114-122` | Effective permissions are available only through Jay, so Jambavan needs Vijay's internal view (§4.1). |
| `Vijay.#assert` checks Jay, policy identity, the permission subset and the input predicate, then re-checks. It is private. | `vijay.ts:66-87` | No public "can this principal use X" API exists. Copying the subset check would create a second authorization implementation; §4.1 extracts it instead. |
| `validateTask` and `protectTask` admit a root capability: Jay verify, policy, `#assert`, and the firewall `task` operation when bound. `protectTask` keeps the lease, and the lease's `check()` re-asserts. | `vijay.ts:97-154` | The admission path for both utilities is reused unchanged. |
| `runBot` requires every `toolsForCapability` ID to be in `root.security.toolPermissions` (`tool-denied`). A read-only parent with a state-changing tool gives `effect-denied`. | `vijay.ts:497-504`, `:536-543` | These rules make an entitled capability "unavailable" (§2.3). |
| `ToolLease` allows only IDs in `allowed` ∩ `toolPermissions`, registered and unchanged. | `tools.ts:86-109` | Same as above. |
| Security errors are sanitized to codes, and the audit records only registered IDs or `null`. | `types.ts:95-103`; `vijay.ts:88-95` | Unknown or hidden IDs never reach the audit. |

### 1.4 Firewall (`src/security/firewall/`)

| Fact | Evidence | Consequence |
| --- | --- | --- |
| One firewall per **realm** `{issuer, scope}`. `checkRoot` rejects other principals with `unauthorized`. The realm is not exposed. | `types.ts:29-32`; `runtime.ts:144-153` | A firewall is single-tenant. Kubera and Jambavan use the firewall **bound to the enforcing Vijay**, so realm checks happen at admission. |
| `runtime.status()` and `snapshot()` have **no authorization**. Any holder of the runtime can read the mode, version, reservations and full policy (bots, providers, origins, paths). | `runtime.ts:810-824` | This is a host-only object today. Neither utility may forward it. Kubera projects a narrow subset after authorization. |
| A bound `task`/`capability` request needs exactly one registered `workflow` operation for that capability. Admission reserves one of `maxOperations` and may wait for an audit acknowledgement. | `runtime.ts:700-790` (`reservedOperations++` at `:787`) | **Host requirement:** register one workflow operation each for the discovery and budget capabilities. Each call consumes one operation. |
| Reservations: `reservedOperations`, `reservedTokens` and the exact `reservedCost` (bigint). They are lifetime counters across policy changes, reserved before dispatch, and **never decremented**. | `runtime.ts:107-109`, `:366-382`, `:441-451`, `:280-293` | Monotonic. "Available" can only rise if a new policy raises a limit (shown by the version). |
| `status().reservedCostUSD` is `costUSD(bigint)`, a Number display. | `runtime.ts:820` | It is not exact, so Kubera needs the bigint from a reader (§4.1). |
| A model operation owns an internal `ModelRouter` per operation. The firewall also reserves its own ceiling. | `runtime.ts:344-347`, `:441-451` | Two ledgers see the same model call. **Never sum firewall and router figures** (§3.4). |
| The lockdown policy mode and `admission` are separate signals. | Finding H03C-09 | Jambavan treats `mode === 'lockdown'` as unavailable. |

### 1.5 Model routing and cost (`src/intelligence/`)

| Fact | Evidence |
| --- | --- |
| **Exact units are 10⁻³²⁴ USD** in a `bigint`. `costUnits(n)` parses the shortest decimal of a Number, with no float arithmetic. | `cost.ts:6-12` |
| `costUSD(units)` is presentation only. `reservationUSD` funds the smallest Number cap covering the exact price. | `cost.ts:15-28` |
| `ModelRouter` limits are lifetime per instance. `maxCostUSD` **defaults to 0**, `maxCalls` to 100 and `maxTokens` to 65,536. Money is validated in [0, 1,000,000]. | `validation.ts:40-83` |
| Admission reserves before the call (`calls++`, token ceilings, funded cost) and never refunds. `reconcile` only raises figures, with per-direction maxima and reported excess. An overrun or unverifiable usage sets `#blocked`. | `router.ts:222-289` |
| One active inference per router (`#owner`, otherwise `busy`). The scope is fixed at construction. | `router.ts:37`, `:103` |
| `budgetUsage = {calls, reservedTokens, reservedCostUSD (Number)}` is public. **The limits and the exact cost are private.** | `router.ts:63-69`; `types.ts:120-126` |
| `ModelResult.attempts[].usage` carries provider-reported usage, **returned only to the caller of `infer`**. | `types.ts:112-139` |
| `ModelProviderRegistry.list()` strips `infer` but exposes `pricing` and `locality`. It is host-only. | `registry.ts:49-55` |

### 1.6 Workflow model budget (`src/workflows/`)

| Fact | Evidence |
| --- | --- |
| **Workflow units are whole nanodollars (10⁻⁹ USD)** stored as safe-integer Numbers. Budgets round **down** and reservations round **up** (`moneyUnits`). | `validation.ts:9-21`, `:48-65`; `registry.ts:13-14`, `:145-158` |
| Per-run counters (`steps`, `toolCalls`, `modelCalls`, `modelTokens`, `modelCostUnits`) live in a `start()` closure and are reserved before approval or invocation, never refunded. | `engine.ts:98-104`, `:264-280` |
| `WorkflowSnapshot.usage.modelCostUSD = units / 1e9` is a float display. **The configured limits are not in the snapshot.** | `engine.ts:135-151` |
| Workflow model tools are protected tools. They go through the firewall as `tool` operations with **no** firewall cost reservation (only `model` operations reserve). | `runtime.ts` `modelReservation`; `registry.ts:160` |

### 1.7 Existing diagnostics and budget surfaces

| Surface | Authorization | Note |
| --- | --- | --- |
| `toSDKDiagnostic(error)` (`sdk/diagnostics.ts:13-61`, entry `shivax/diagnostics`) | None (pure) | A UI-safe error projection. Both utilities' errors map through it (`permission-denied` becomes `denied`). |
| `SecurityAuditLog.list()` (`audit.ts:52-54`) | Host-only | Not tenant-filtered. It is not used as a source. |
| `RoutingFirewallView` and `RoutingProviderBinding.budget()` (`learning/routing.ts:140-179`) | Host-supplied | The precedent for read-only views. `budget()` returns a Number `remainingCostUSD`, compared with `> 0`. |
| Ashwatthama `status()` and Abhimanyu reports | Host-only | Out of scope. |

### 1.8 Existing `$0.30` regression evidence

| Layer | Test | Covers |
| --- | --- | --- |
| `ModelRouter` | `model-cost.test.mjs:49-73` (ESM and CJS) | Three ten-cent calls complete, the fourth gives `cost-limit`, and `reservedCostUSD === 0.3` |
| Firewall model operation | `firewall-model-integration.test.mjs:79-86`, `firewall.test.mjs:283-287` | Three succeed, the fourth gives `resource-limit` |
| Workflow | `workflows.test.mjs:327-336` | Three succeed with usage `0.3`. **The fourth is not exercised at the workflow level** (`maxCalls` is 3), so Terra adds it (§9.4). |

## 2. Discovery design: Jambavan

### 2.1 Purpose and non-goals

Jambavan answers one question for an authenticated caller: *which capabilities am I entitled to, and are they usable right now?* It returns only host-declared metadata.

Jambavan never:
- executes a tool, bot, planner or predicate;
- grants, registers or modifies anything;
- reads caller-supplied tool IDs;
- changes RUDRA or SARASWATI routing;
- returns another tenant's registrations;
- caches results.

### 2.2 Admission

1. **Host setup.** The host registers a read-only capability policy for the discovery capability (for example `shivax.discovery.read`). If a firewall is bound, it also registers exactly one `workflow` firewall operation for that capability and lists the capability in `policy.capabilities`.
2. **Context.** The host mints the request context with Jay: `jay.createContext({ id, input: { capability: <discovery capability>, data: { version: 1, ids? } } }, { signal, toolPermissions })`. `toolPermissions` must match the set the host would grant for execution (§2.6).
3. **Admission.** `discoverAuthorizedCapabilities(root, signal)` does the following:
   - Requires `root.input.capability === options.capability`. Otherwise it fails with `permission-denied`.
   - Calls `security.protectTask(root, signal)`. This performs Jay verify, the policy check, the permission check, the predicate over the request data, the firewall task operation and the realm check. Failures propagate as the existing sanitized `SecurityError`.
   - Calls `identity = view.assertActive(root, signal)`, then requires `identity.principal.issuer === realm.issuer` and the session scope to equal `realm.scope`. Otherwise it fails with `permission-denied`. This also protects hosts without a firewall.
4. **Filtering.** Runs **synchronously** (no `await`), between `lease.check()` before and `lease.check()` plus `view.assertActive` after. The lease is then closed in `finally`.

### 2.3 Visibility rules

Entries are considered only from host registries: bot capabilities through `bots.list()` sorted by ID, and workflow bindings through `workflowTools.list()`. One entry is produced per capability ID, using the deterministic route.

| Condition | Result |
| --- | --- |
| No capability policy is registered for the ID | **Hidden** (Vijay would give `policy-missing`) |
| The policy's permissions are not all held by the principal | **Hidden** |
| The ID is not in host `allowedCapabilities` (when configured) | **Hidden** |
| The ID is not in the request `ids` filter (when given) | **Hidden**, and indistinguishable from an unknown ID |
| The ID is the discovery or budget capability itself | **Hidden** |
| Entitled, but any required tool is missing from context `toolPermissions`, has no tool policy, needs permissions the principal lacks, is unregistered, or is a stale binding | Shown, **`unavailable`**, with no `tools` field |
| Entitled, but the capability is read-only and a required tool's policy is `state-changing` (`effect-denied`) | Shown, `unavailable` |
| A firewall is bound, and its mode is `lockdown`, the capability is not in `policy.capabilities`, the routed bot is not in `policy.bots`, or the operation does not match exactly one operation that `evaluate` admits | Shown, `unavailable` |
| All checks pass | Shown, **`available`** |

- **Tools.** Tool IDs are returned only when `includeToolIds: true` **and every** required tool passes individually. A partial tool list is never returned, so the number of hidden tools is never revealed.
- **Bot IDs.** Bot IDs are never returned in v1. This avoids exposing host bot names and the H03C-02 route-collision structure.
- **Predicates.** Host `validateInput` predicates are never called, because there is no real input. Every entry therefore carries `inputConditions: 'host-validated-at-execution'`.

### 2.4 Descriptor content

| Field | Source | Rule |
| --- | --- | --- |
| `id` | Registry | Always |
| `source` | `'bot'` or `'workflow-tool'` | Always |
| `description` | `Capability.description`, verbatim from the routed bot | Omitted for workflow bindings, which have no description. **Never generated.** |
| `displayName`, `category`, `schema {ref, version}` | Host `descriptors` only | Omitted when there is no host descriptor. A descriptor alone never makes an ID visible. |
| `operation` | `policy.effect` | `'read-only'` or `'state-changing'` |
| `requiresApproval` | Capability policy, or any required tool's policy, `requiresApproval` | Boolean |
| `availability` | §2.3 | `'available'` or `'unavailable'`. There is no reason code. |
| `inputConditions` | Constant | `'host-validated-at-execution'` |
| `tools` | §2.3 | Optional `{id, operation, requiresApproval}[]` |
| `trust` | Constant | `'host-declared'`. Strings are data, never instructions, for any planner or model consumer. |

Never returned: `inputSchema` in v1 (a host can publish a `schema.ref` instead), policy `permissions`, predicates, tool or bot implementations, firewall origins, paths or provider IDs, Hanuman targets or URLs, other principals' data, and counts of anything hidden.

**Host descriptor validation** (at creation, closed schema):
- Plain objects only, with no accessors or prototypes.
- At most 512 descriptors, unique `capabilityId` values, each passing `identifier()`.
- `displayName`: 1–80 characters with no control or bidirectional-override characters.
- `category`: matches `^[a-z0-9][a-z0-9.-]{0,63}$`.
- `schema.ref`: matches `^[A-Za-z0-9._:-]{1,128}$`, so it cannot contain `/` and is not a URL or path.
- `schema.version`: a safe integer from 1 to 1,000,000.
- A violation throws `SecurityError('invalid-policy')` to the host.

### 2.5 Output bounds and ordering

- Entries are sorted by `id`, at most 256.
- `truncated: true` only when the **visible** set exceeds 256. Hidden entries never count.
- There is no `total`, no hidden count, and no per-entry error.

### 2.6 Semantics

- **Entitlement, not routing.** `available` means the current static checks pass. It does **not** mean RUDRA's `allowedCapabilities` or SARASWATI policy will route the capability, and it does not supersede finding H03C-01. Hosts that want routing narrowing pass `allowedCapabilities`.
- **Context tool permissions.** Tool checks use the discovery context's host-selected `toolPermissions`. The report records `basis.toolPermissions: 'discovery-context'`.
- **Advisory only.** Every execution is re-authorized by Vijay and the firewall. The report says so with `basis.advisory: true`.

### 2.7 Errors

| Situation | Caller sees |
| --- | --- |
| Admission failure | Existing sanitized `SecurityError` code, for example `unauthenticated`, `revoked-session`, `permission-denied` or `policy-missing` (for the discovery policy only) |
| Wrong capability, realm mismatch, source mismatch, lease revoked during filtering, or an internal exception | `SecurityError('permission-denied')` |
| Bad configuration at creation (unknown Vijay, mixed-bundle source, invalid descriptor) | `SecurityError('invalid-policy')`, thrown to the **host** at creation |

No error contains IDs, counts or messages from host code. Results never become partial: any failure fails the whole call. An unfiltered registry is never returned.

### 2.8 Consistency and staleness

- Filtering is synchronous between two lease checks, so the report is consistent within one event-loop turn (`consistency: 'same-tick'`).
- `observedAt` comes from the host's injectable `now`, which must be finite or the call fails.
- `basis.firewallVersion` is `number | null`.
- There is no registry version, because none exists, so the report carries no `validUntil`.
- **There is no cache.** If a host caches reports anyway, its key must include issuer, principal, session, scope, `toolPermissions` and the firewall version. Even then a cache cannot observe policy or tool registry changes, because those registries have no events. **Recommendation: do not cache.**

## 3. Budget reporting design: Kubera

### 3.1 Purpose

Kubera reports budgets that a canonical source already enforces, exactly as that source counts them.

Kubera never:
- reserves, refunds or blocks anything;
- changes limits;
- adds its own totals across sources;
- claims to represent provider invoices.

### 3.2 Admission and detail level

- The same path as Jambavan (§2.2), with `options.capability` (summary detail).
- An optional `options.providerDetailCapability` (provider detail) has its own Vijay policy and firewall operation. Detail is chosen **only** by which admitted capability `root.input.capability` equals, so no Vijay logic is duplicated.
- The request data is `{ version: 1 }`. Callers cannot choose sources.

### 3.3 Sources and canonical authority

| Section | Authoritative source | Scope check (else `permission-denied`) |
| --- | --- | --- |
| `firewall` | The firewall **bound to the enforcing Vijay** (§4.1 reader) | Realm already enforced by admission |
| `model-router` | Each host-configured `ModelRouter` (reader) | Router scope must equal the caller's session scope |
| `workflow` | Host-passed `WorkflowRun` handles (reader) | `run.context.security.scope` and `caller {id, issuer}` must equal the caller's |

Sources outside the caller's scope are a host wiring error. They fail the call closed and are never silently filtered out.

### 3.4 Value categories (STEP 7)

| Category | Kubera field | Backing | Note |
| --- | --- | --- | --- |
| Configured limit | `limit` | The **effective enforced** limit: router `costUnits(maxCostUSD)`, firewall policy limits, workflow nanodollars **after round-down** | Not the host's original Number |
| Reserved usage | `reserved` | Retained admission ceilings plus valid reported excess. Includes completed, failed and in-flight work, never refunded | **This is what enforcement compares.** It is the only "consumed" figure any source has. |
| Outstanding (in flight) | `inFlight` (router boolean), `activeOperations` and `drainingOperations` (firewall counts), `status` (workflow) | Source state | **Amounts** in flight are not tracked by any source, so none are reported (§10) |
| Available | `available` = max(0, limit − reserved), exact | Computed with bigint subtraction only | `atLimit` is an exact boolean. `overrun` is set when reserved > limit. |
| Estimated future usage | `estimates[]`, kind `'estimate'` | Admission arithmetic only (§3.7) | Provider detail only |
| Actual provider-reported usage | Not reported in v1 | `ModelResult.attempts[].usage` belongs to the `infer` caller | Already folded into `reserved` whenever it exceeds the ceiling |
| External provider billing | `externalBilling: 'not-available'` | None | **Never** inferred |

**Never add sections together.**
- A firewall model operation is counted by both the firewall and its internal router.
- Workflow nanodollars and exact router units are different unit systems.
- Kubera therefore provides **no** grand total.

### 3.5 Numeric safety (STEP 8)

- **Comparisons.** All monetary comparisons and subtractions use the source's integer type: bigint for exact units, safe-integer nanodollars for workflows. No floating-point value is compared or summed.
- **Amount serialization** (`KuberaAmount`):
  - `exact` is the canonical decimal string of USD in the source's units, with no rounding. Its grammar is `^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$`: no exponent, sign or trailing zeros, at most 400 characters.
    - Conversion is digit placement only. Exact units use scale 324; nanodollars use scale 9.
  - `unit` is `'exact'` (10⁻³²⁴) or `'nanodollar'`.
  - `display` is the source's **existing** Number projection: `costUSD(units)` for exact units, `units / 1e9` for workflows. It is labeled display-only and must never be compared. It can underflow toward 0, so UIs use `atLimit`.
- **Counts.** Calls, tokens, steps and operations are JS Numbers that must satisfy `Number.isSafeInteger`. If one does not, the call fails closed instead of reporting an imprecise value. All current sources are bounded far below 2⁵³.
- **Formatting.** Kubera adds no currency formatting or rounding helper. A UI that shortens `exact`, for example to "$0.30", must present it as approximate.
- **JSON.** Every report is JSON-serializable with no bigint fields, because bigints exist only inside the readers.

**The required regression** must keep passing unchanged and gains Kubera assertions (§9.4). With a budget of $0.30 and three $0.10 calls, all three succeed and the fourth is rejected. Kubera then reports:

- `reserved.exact = "0.3"`
- `available.exact = "0"`
- `atLimit = true`
- estimate `additionalCalls = 0`

After the rejected fourth call, Kubera's figures are identical, because a rejection reserves nothing (`router.ts:229-238`).

### 3.6 Privacy (STEP 9)

- **Identifiers and labels.**
  - Reports contain no task, session, principal or workflow IDs. Each section has a host-assigned `label` matching `^[A-Za-z0-9._:-]{1,128}$`.
  - Provider IDs appear only at provider detail, and only for providers in the router's registry ∩ firewall `providers.ids` (if bound) ∩ host `visibleProviders`.
- **Never included:**
  - pricing tables;
  - provider locality or endpoints;
  - model limits other than budget dimensions;
  - credentials, billing tokens and raw `usage` objects;
  - firewall rules, origins or paths;
  - other tenants' sources.
- **Firewall mode.** It is not reported, since budget readers do not need it.
- **Enforcement.** None changes. Filtering happens only on the report.

### 3.7 Estimates (bounded projection, provider detail only)

For each visible provider *p* of a router:

- *perCallTokens* = `maxInputTokens + maxOutputTokens` if `p.tokenBased`, otherwise 0.
- *perCallUnits* = `costUnits(reservationUSD(priced))`, where *priced* is computed by **the same function the router uses** (§4.1 extraction).
- `additionalCalls` = min(available calls, ⌊available tokens / *perCallTokens*⌋ when *perCallTokens* > 0, ⌊available cost units / *perCallUnits*⌋ when *perCallUnits* > 0). The floor is integer division, a count, not monetary rounding.
- `limitedBy` is one of `calls | tokens | cost | blocked`. It is 0 with `'blocked'` when the router is blocked, disposed or disabled.
- **Zero-priced providers:** cost does not limit them, so `limitedBy` is never `'cost'`. Combined with the default `maxCostUSD: 0`, they remain callable. This is reported, not hidden.
- **Labels:** `kind: 'estimate'`, `basis: 'admission-ceiling'`, `excludes: ['reported-excess', 'fallback', 'concurrency', 'external-billing']`. Never described as a guarantee.
- **If the extraction is not approved:** estimates are omitted from v1. Kubera never copies the admission arithmetic.

### 3.8 Consistency (STEP 10)

- **Same-tick reads.** All source reads happen synchronously in one turn after admission, so each section's counters are mutually consistent. Routers, the firewall and the workflow engine update their counters together without awaits.
- **Report header.** Contains `observedAt`, `consistency: 'same-tick'`, `firewallVersion: number | null`, and `complete`.
  - `complete` is false when a configured section could not be produced. In that case the whole call fails instead; `complete` stays in the schema for future optional sources and is always `true` in v1.
- **Per-section `settled`:**
  - router: not in flight and not able to change;
  - firewall: `active + draining === 0`;
  - workflow: terminal status.
- **Not settled means figures may still grow.** In-flight reconciliation only increases `reserved`, so `available` can only decrease. It never over-reports funds.
- **No atomicity across sources** is claimed. In particular, Kubera does not claim consistency with provider invoices or with a source read in a different call.

## 4. Proposed TypeScript interfaces

### 4.1 Internal readers (not exported from any entrypoint)

```ts
// src/security/vijay.ts — set in the constructor, like coreRootChecks
/** @internal */ export const securityViews: WeakMap<Vijay, {
    assertActive(root: TaskContext, signal: BotSignal): AuthenticatedIdentity;
    policy(kind: SecurityActionKind, id: string): Readonly<Pick<PermissionPolicy,
        'id' | 'effect' | 'requiresApproval'>> | undefined;
    /** Same predicate #assert uses (extracted helper); never calls validateInput. */
    entitled(identity: AuthenticatedIdentity, kind: SecurityActionKind, id: string): boolean;
    toolRegistered(id: string): boolean;
    /** The firewall reader bound through bindProtectedExecution, if any. */
    firewall(): FirewallReader | undefined;
}>;

// src/security/firewall/runtime.ts
/** @internal */ interface FirewallReader {
    version: number; mode: FirewallMode;
    capabilities: readonly string[]; bots: readonly string[];
    providerIds: readonly string[];
    /** Same matching + evaluate as the binding (extracted); no reservation, audit or lease. */
    admits(request: ProtectedRequest): boolean;
    limits: { operations: number; tokens: number; cost: bigint };
    reserved: { operations: number; tokens: number; cost: bigint };
    active: number; draining: number;
}

// src/intelligence/router.ts
/** @internal */ export const routerLedgers: WeakMap<ModelRouter, () => {
    scope: SLMScope;
    limits: { calls: number; tokens: number; cost: bigint };
    reserved: { calls: number; tokens: number; cost: bigint };
    inFlight: boolean; blocked: boolean; disposed: boolean; enabled: boolean;
    perCall: { inputTokens: number; outputTokens: number };
    providers(): readonly ModelProviderDescriptor[];
}>;
// Optional, needs approval: src/intelligence/cost.ts
/** @internal Router admission now calls this; Kubera estimates reuse it. */
export function admissionUnits(provider: ModelProviderDescriptor,
    inputTokens: number, outputTokens: number): { priced: bigint; funded: bigint };

// src/workflows/engine.ts — set when start() creates the run object
/** @internal */ export const workflowLedgers: WeakMap<WorkflowRun, () => {
    context: TaskContext; status: WorkflowStatus;
    limits: { steps: number; toolCalls: number; modelCalls: number; modelTokens: number; nanodollars: number };
    reserved: { steps: number; toolCalls: number; modelCalls: number; modelTokens: number; nanodollars: number };
}>;
```

- **Read-only and fresh.** Readers return new frozen plain objects. They expose nothing that can mutate state, and no functions except `providers()` and `admits()`. Neither of those runs host code.
- **Bundle constraint.** WeakMaps are per bundle, as with `guardedModelRoutes`, `coreRootChecks` and the H01 `Symbol.for` lesson. Objects created from a different entry bundle are not recognized. **Creation must throw `invalid-policy` in that case**, so the host sees the problem at composition time.

### 4.2 Public API (additive, exported from `src/security/index.ts` and therefore from `shivax` and `shivax/security`)

```ts
import type { FirewallRealm } from './firewall/types.js';

/* ---------------- Jambavan ---------------- */
export interface JambavanHostDescriptor {
    readonly capabilityId: string;
    readonly displayName?: string;
    readonly category?: string;
    readonly schema?: { readonly ref: string; readonly version: number };
}
export interface JambavanOptions {
    /** The Vijay that enforces execution; its own policies, tools and bound firewall are used. */
    readonly security: Vijay;
    readonly realm: FirewallRealm;
    /** Read-only Vijay capability that admits discovery. */
    readonly capability: string;
    readonly bots?: BotRegistry;
    readonly workflowTools?: ToolRegistry;
    readonly descriptors?: readonly JambavanHostDescriptor[];
    /** Optional narrowing only. */
    readonly allowedCapabilities?: readonly string[];
    readonly includeToolIds?: boolean;
    readonly now?: () => number;
}
export interface AuthorizedToolDescriptor {
    readonly id: string;
    readonly operation: ActionEffect;
    readonly requiresApproval: boolean;
}
export interface AuthorizedCapabilityDescriptor {
    readonly id: string;
    readonly source: 'bot' | 'workflow-tool';
    readonly description?: string;
    readonly displayName?: string;
    readonly category?: string;
    readonly schema?: { readonly ref: string; readonly version: number };
    readonly operation: ActionEffect;
    readonly requiresApproval: boolean;
    readonly availability: 'available' | 'unavailable';
    readonly inputConditions: 'host-validated-at-execution';
    readonly trust: 'host-declared';
    readonly tools?: readonly AuthorizedToolDescriptor[];
}
export interface CapabilityDiscoveryReport {
    readonly format: 'shivax-capability-discovery';
    readonly version: 1;
    readonly observedAt: number;
    readonly basis: {
        readonly consistency: 'same-tick';
        readonly advisory: true;
        readonly toolPermissions: 'discovery-context';
        readonly firewallVersion: number | null;
    };
    readonly capabilities: readonly AuthorizedCapabilityDescriptor[];
    readonly truncated: boolean;
}
export interface JambavanDiscovery {
    /** Untrusted request data in root.input.data: { version: 1, ids?: string[] (≤128) }. */
    discoverAuthorizedCapabilities(root: TaskContext, signal: BotSignal): Promise<CapabilityDiscoveryReport>;
}
export function createJambavanDiscovery(options: JambavanOptions): JambavanDiscovery;

/* ---------------- Kubera ---------------- */
export interface BudgetAmount {
    readonly currency: 'USD';
    readonly exact: string;
    readonly unit: 'exact' | 'nanodollar';
    /** Existing Number projection; display only, never compare. */
    readonly display: number;
}
export interface BudgetDimension<T extends number | BudgetAmount> {
    readonly limit: T;
    readonly reserved: T;
    readonly available: T;
    readonly atLimit: boolean;
    readonly overrun: T | null;
}
export interface RouterBudgetSection {
    readonly source: 'model-router';
    readonly label: string;
    readonly calls: BudgetDimension<number>;
    readonly tokens: BudgetDimension<number>;
    readonly cost: BudgetDimension<BudgetAmount>;
    readonly inFlight: boolean;
    readonly blocked: boolean;
    readonly settled: boolean;
    readonly estimates?: readonly BudgetEstimate[];
}
export interface FirewallBudgetSection {
    readonly source: 'firewall';
    readonly label: string;
    readonly policyVersion: number;
    readonly operations: BudgetDimension<number>;
    readonly tokens: BudgetDimension<number>;
    readonly cost: BudgetDimension<BudgetAmount>;
    readonly activeOperations: number;
    readonly drainingOperations: number;
    readonly settled: boolean;
}
export interface WorkflowBudgetSection {
    readonly source: 'workflow';
    readonly label: string;
    readonly status: WorkflowStatus;
    readonly steps: BudgetDimension<number>;
    readonly toolCalls: BudgetDimension<number>;
    readonly modelCalls: BudgetDimension<number>;
    readonly modelTokens: BudgetDimension<number>;
    readonly modelCost: BudgetDimension<BudgetAmount>;
    readonly settled: boolean;
}
export interface BudgetEstimate {
    readonly kind: 'estimate';
    readonly basis: 'admission-ceiling';
    readonly providerId: string;
    readonly perCall: { readonly tokens: number; readonly cost: BudgetAmount };
    readonly additionalCalls: number;
    readonly limitedBy: 'calls' | 'tokens' | 'cost' | 'blocked';
    readonly excludes: readonly ('reported-excess' | 'fallback' | 'concurrency' | 'external-billing')[];
}
export interface BudgetSummary {
    readonly format: 'shivax-budget-summary';
    readonly version: 1;
    readonly observedAt: number;
    readonly detail: 'summary' | 'provider';
    readonly consistency: 'same-tick';
    readonly externalBilling: 'not-available';
    readonly complete: boolean;
    readonly sections: readonly (RouterBudgetSection | FirewallBudgetSection | WorkflowBudgetSection)[];
}
export interface KuberaOptions {
    readonly security: Vijay;
    readonly realm: FirewallRealm;
    readonly capability: string;
    readonly providerDetailCapability?: string;
    /** ≤ 32; labels unique. */
    readonly routers?: readonly { readonly label: string; readonly router: ModelRouter }[];
    readonly visibleProviders?: readonly string[];
    /** Default true when Vijay has a bound firewall. */
    readonly includeFirewall?: boolean;
    readonly firewallLabel?: string;
    readonly now?: () => number;
}
export interface KuberaReporter {
    /** `runs` are host-held handles (≤ 16, labels unique); request data is { version: 1 }. */
    getBudgetSummary(
        root: TaskContext,
        signal: BotSignal,
        runs?: readonly { readonly label: string; readonly run: WorkflowRun }[]
    ): Promise<BudgetSummary>;
}
export function createKuberaReporter(options: KuberaOptions): KuberaReporter;
```

**Conventions followed:**
- `create*` factories with closed option records, as with `createShivaxFirewall`, `createAshwatthamaObserver` and `createRoutingAdvisor`.
- Frozen outputs, and `SecurityError` codes only.
- The `FirewallRealm` type is reused.
- No new entrypoint: `shivax/diagnostics` stays the error projection. Both utilities need Vijay, so they belong with security.

## 5. Authorization requirements

1. **Admission.** Every call is admitted by `Vijay.protectTask` on the exact Jay-minted root context. A payload can never carry a principal, permissions, scope or detail level.
2. **Fail closed.** Any inability to determine authorization fails the whole call: missing view, realm or scope mismatch, revoked lease, non-finite clock, or a reader that throws. An unfiltered or partial registry is never returned.
3. **Effective permissions.** These come only from Jay's stored identity, through the Vijay view. Entitlement uses the **same** extracted helper as `#assert`.
4. **Freshness.** The session is re-verified asynchronously at admission (`protectTask` calls `jay.verify`). The lease and `assertActive` are re-checked synchronously before and after the reads. A stale or revoked session fails, and a later revocation cannot change a report already returned (§10).
5. **Tenant scope.** The configured `realm` must match the caller. Router scope and workflow run owner must match. Multi-tenant hosts create one utility per tenant registry set. Registries are not tenant-tagged, so this is the only sound isolation.
6. **Separate policies.** Discovery, budget summary and provider detail are separate host-registered **read-only** policies (and firewall workflow operations). The utilities never register them.
7. **No escalation path.** Neither utility is a bot or a tool. If a host chooses to expose one as a protected tool, that tool needs its own Vijay policy. Bots must never receive the utility object, a Vijay or a registry.
8. **Firewall authority.** Lockdown blocks admission, through the firewall task operation, and marks entitled capabilities unavailable. Monitor mode never creates an allow.
9. **Audit.** Admission decisions already land in Vijay's and the firewall's audits under the registered capability ID. The utilities add no audit or log of their own and never record hidden IDs.

## 6. Canonical accounting sources

| Metric | Authoritative source | Unit | Read via |
| --- | --- | --- | --- |
| Router call, token and cost limit | `ModelRouter.#limits`, `#costLimit` | Count; exact 10⁻³²⁴ USD | `routerLedgers` |
| Router reserved calls, tokens and cost | `#calls`, `#tokens`, `#costUnits` | Count; exact | `routerLedgers` (public `budgetUsage` is display) |
| Router in flight or blocked | `#owner`, `#blocked`, `#disposed`, `#enabled` | Boolean | `routerLedgers` |
| Per-call ceiling | `#limits.maxInputTokens` / `maxOutputTokens`; provider pricing | Tokens; exact | `routerLedgers`, `admissionUnits` |
| Firewall limits | `current.policy.limits` | Count; exact via `costUnits(maxCostUSD)` | `FirewallReader` |
| Firewall reserved | `reservedOperations`, `reservedTokens`, `reservedCost` | Count; exact | `FirewallReader` (public `status()` is display) |
| Firewall active or draining | `active` set | Count | `FirewallReader` |
| Workflow limits | `settings()` result (`costUnits` rounded **down**) | Count; nanodollars | `workflowLedgers` |
| Workflow reserved | Closure counters (`modelCostUnits` rounded **up** per call) | Count; nanodollars | `workflowLedgers` |
| Provider-reported usage | `ModelResult.attempts[].usage` | Mixed, nullable | Not read (caller-owned) |
| External billing | None in SHIVAX | — | Never |

**No second ledger.** Kubera stores nothing between calls, holds no counter, and derives `available` by subtraction on each read.

## 7. Security threat matrix

| # | Threat | Vector | Control | Residual |
| --- | --- | --- | --- | --- |
| T1 | Hidden capability enumeration | Probing with the `ids` filter, measuring list size, error differences | Hidden and unknown IDs both result in absence. There are no counts, and `truncated` counts visible entries only. A single generic error, and no caller-supplied tool IDs. | Timing scales with registry size (§10). |
| T2 | Cross-tenant metadata disclosure | Shared registries, foreign routers or runs, firewall realm | Mandatory `realm` match. The bound firewall checks the realm at admission. Router scope and run-owner checks. Mismatch fails the whole call. | A host that shares one registry across tenants without per-tenant utilities: documented as unsupported. |
| T3 | Stale authorization | Revocation after admission, policy swap mid-read | `protectTask` lease with `check()` and `assertActive` around a synchronous read. No caching. Reports labeled advisory and point-in-time. | A returned report can outlive revocation (as with H03C-03), but it carries metadata only, never execution authority. |
| T4 | Provider name leakage | Budget sections, estimates, errors | Provider IDs only at provider detail ∩ firewall allowlist ∩ `visibleProviders`. Sections use host labels. No pricing or locality. | — |
| T5 | Cache poisoning | Host or intermediate cache, mutable descriptors | No internal cache. Descriptors are validated and frozen at creation. Each report is a fresh frozen object. Host caching is advised against. | A host cache that ignores the advice. |
| T6 | Concurrent reservations | Report during an in-flight call | Reserve-before-call sources mean `reserved` already includes in-flight ceilings. `settled: false` is shown. `available` can only fall. | In-flight **amounts** are not itemized (§10). |
| T7 | Integer overflow or serialization | bigint into JSON, Number precision, exponent notation | Bigints stay inside readers. `exact` decimal strings use a strict grammar and a 400-character bound. Counts must be safe integers, or the call fails closed. | — |
| T8 | Misreported available funds | Float subtraction, the host's original Number vs the effective limit, cross-source sums | Bigint or integer subtraction on enforced units. Workflow limits shown after round-down. No totals. `available` clamped at 0, with an explicit `overrun`. | A firewall policy change can raise a limit. `policyVersion` shows it. |
| T9 | Zero budgets | Default `maxCostUSD: 0`; zero-priced providers | `limit.exact = "0"`. Estimates for zero-priced providers are limited only by calls and tokens. `atLimit` on cost does not imply no calls are left. Terra tests both. | UI misreading. Documented. |
| T10 | Missing provider | Unregistered, hidden or firewall-denied provider | Identical result: the provider is simply absent from `estimates`. A router with no providers gives no estimates. | — |
| T11 | Untrusted host descriptors | Accessors, prototype keys, URLs in fields, injection text | Closed schema, plain data, bounded character sets. `schema.ref` cannot contain `/`. `trust: 'host-declared'`. Descriptors cannot create visibility. | Host-declared text reaching an LLM planner must still be treated as data. |
| T12 | Unauthorized diagnostics access | Calling without policy, via a bot, through `firewall.status()` | Separate Vijay policies and firewall operations. Exact context required. Not a bot or tool. Raw `status()`/`snapshot()` are never forwarded. | `runtime.status()` and `snapshot()` remain unauthenticated for any **host** holder (existing, §1.4). |
| T13 | Forged source objects | Structural fake router, runtime or run | Reader WeakMaps recognize only SDK-created objects. Creation fails otherwise. | Mixed-bundle composition is rejected, not supported. |
| T14 | Denial of service | Huge registries, repeated calls | 256 visible entries, 512 descriptors, 32 routers, 16 runs. Each call consumes a firewall operation and passes host policy. | Hosts must rate-limit outside SHIVAX. |

## 8. Implementation checklist for Sol (H05-B)

Before starting, confirm the owner's decision on the H03 and H04 NO-GO items (§0).

1. [ ] **`vijay.ts`.** Extract the permission-subset expression from `#assert` into a private helper used by `#assert` itself, with no behavior change. Register `securityViews` in the constructor. `policy()` must return only `{id, effect, requiresApproval}`.
2. [ ] **`firewall/binding.ts` and `runtime.ts`.**
   - Extract the operation `matches` filter (`runtime.ts:702-721`) into a function used by the binding.
   - Add the `FirewallReader` (exact bigint fields) and record the bound reader for the Vijay in `bindProtectedExecution`.
   - No new counters.
3. [ ] **`router.ts`.** Register `routerLedgers` in the constructor, reading the existing private fields.
4. [ ] *(Optional, needs separate approval.)* **`cost.ts`.** Add `admissionUnits()`, make `router.ts:222-238` call it, and change no logic. If declined, skip estimates.
5. [ ] **`engine.ts`.** Register `workflowLedgers` for each `WorkflowRun` created by `start()`, reading the existing closure counters and `config`. No change to reservation order.
6. [ ] **`src/security/jambavan.ts`.**
   - Validate options at creation, and throw `invalid-policy` for an unknown Vijay, a reader miss, or a bad descriptor or realm.
   - Admission per §2.2, visibility per §2.3, output per §2.4–2.5.
   - Synchronous filtering between lease checks, lease closed in `finally`.
7. [ ] **`src/security/kubera.ts`.**
   - Admission and detail per §3.2, scope checks per §3.3.
   - Exact decimal formatting by digit placement (scales 324 and 9), with no rounding.
   - `display` comes from the existing `costUSD` / `/1e9` paths.
   - Estimates per §3.7, only if step 4 is approved.
8. [ ] **`security/index.ts`.** Export the two factories and the §4.2 types. The readers must not be exported from any entrypoint. Confirm ESM/CJS key parity and `verify:package`.
9. [ ] **No changes** to bots, default specialists, bot IDs, `BotRegistry`, RUDRA routing, SARASWATI, enforcement code paths, limits, rounding, Inspectra or Visynq.
10. [ ] **Docs.** Document the host setup (policies and firewall workflow operations) in an implementation report, including the per-call firewall operation cost.

## 9. Test requirements for Terra

All tests are offline, using the real Jay, Vijay, firewall, router and engine with mock providers and tools. No network.

### 9.1 Jambavan disclosure

1. Hidden, unknown and `ids`-filtered IDs give byte-identical reports.
   - Probe 50 random IDs plus every hidden ID: no output difference.
   - Errors are identical, with no `total` or hidden count.
2. A missing capability policy or a missing permission gives hidden. A missing tool permission, tool policy or registration, a stale binding, `effect-denied`, a firewall denial or lockdown gives `unavailable` with no `tools`.
3. With `includeToolIds`, a capability with one hidden tool returns no `tools` array, never a partial one.
4. No output contains `permissions`, `inputSchema`, functions, bot IDs, provider IDs, origins, paths or Hanuman target URLs. Check by a deep scan against fixture sentinels.
5. Descriptors cannot create visibility. Invalid descriptors (accessor, `__proto__`, URL in `schema.ref`, control characters) throw at creation.

### 9.2 Authorization and staleness

1. A forged or copied context gives `unauthenticated`.
2. A revoked session gives `revoked-session`.
3. A wrong `root.input.capability` gives `permission-denied`.
4. A realm or scope mismatch gives `permission-denied`.
5. Lockdown before the call gives a denial. A lease revoked inside the read window (forced through a hook) gives `permission-denied`, never a partial report.
6. Default seven specialists with no policies: the report is empty, and RUDRA routing of all 29 capabilities is unchanged.
7. Calling a utility performs zero tool, bot, provider, predicate or approval calls. It reserves exactly one firewall operation when a firewall is bound.

### 9.3 Kubera privacy and scope

1. A router with a foreign scope, or a workflow run of another principal or scope, gives `permission-denied`.
2. Summary detail contains no provider IDs. Provider detail shows only router registry ∩ firewall `providers.ids` ∩ `visibleProviders`.
3. A deep scan finds no task, session or principal IDs, pricing, locality, raw `usage` or rules.

### 9.4 Numeric regression (required)

1. **Router, ESM and CJS.** Budget $0.30, ten-cent calls. After each call, Kubera reports `reserved.exact` `"0.1"`, `"0.2"`, `"0.3"`, `available.exact` `"0.2"`, `"0.1"`, `"0"`, and estimates 2, 1, 0. The fourth call gives `cost-limit`, and Kubera's figures stay identical. The existing `model-cost.test.mjs:49-73` stays unchanged and passing.
2. **Firewall.** The same sequence, with the fourth call giving `resource-limit` and `reserved.exact === "0.3"`.
3. **Workflow (new coverage).** `modelBudget {maxCalls: 4, maxTokens: 20, maxCostUSD: 0.3}`. Three calls complete, the fourth action gives `model-budget` with 3 provider calls, and the nanodollar `exact` is `"0.3"`.
4. Assert no float drift: `0.1+0.1+0.1` is never compared. `display` equals the existing `budgetUsage`/`usage` values.
5. Zero budget with a zero-priced provider: `cost.atLimit === true` and `additionalCalls === min(calls, tokens)`.
6. Extreme values: limits of `1_000_000` and `5e-324` give canonical `exact` strings (grammar and length). Reported excess gives an `overrun`. JSON round-trips without bigint.
7. Workflow round-down: a budget of `0.0000000015` reports `limit.exact === "0.000000001"`.

### 9.5 Consistency

1. An in-flight router call (gated provider) gives `inFlight: true` and `settled: false`, with `reserved` including the ceiling. After reconciliation with excess, `available` decreases and never increases.
2. A firewall with active operations gives `settled: false`. A policy update that raises a limit increases `policyVersion`.
3. A mixed-bundle router or runtime (CJS object with the ESM factory) throws `invalid-policy` at creation.

### 9.6 Non-regression and mutation evidence

1. The full existing suite passes: security, firewall, model-cost, workflows, RUDRA, SARASWATI, H04 safety, and Hanuman.
2. **Mutations:**
   - Disable the realm check: T2 tests fail.
   - Return a partial `tools` array: 9.1-3 fails.
   - Use float subtraction for `available`: 9.4 fails.
   - Revert the Vijay extraction to a copy with a typo: entitlement tests fail.
3. `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm verify:package` all pass.

## 10. Known limitations

- **No "actual usage" total.** Sources keep retained reservations, not settled spend. Provider-reported usage stays with the `infer` caller. Kubera reports `reserved` and never calls it spend or billing.
- **No in-flight amounts.** Routers and the firewall expose only whether work is in flight, not the size of the reservation in flight. Itemizing it would need new bookkeeping in enforcement code, which this contract excludes.
- **Entitlement, not routing.** `available` does not predict RUDRA or SARASWATI route selection, approval outcomes or host predicates. H03C-01 and H03C-02 still stand.
- **Point-in-time.** Registries have no versions or (for policies and tools) events. Reports cannot be invalidated and can outlive revocation as metadata.
- **Tool checks use the discovery context's `toolPermissions`.** Accuracy depends on the host minting it with the same set as for execution.
- **Per-bundle readers.** Mixing objects from different SHIVAX entry bundles is rejected at creation, as with the existing firewall binding.
- **Timing side channel.** Filtering cost grows with registry size. This is bounded but not constant-time.
- **Per-call firewall cost.** Each call consumes one firewall operation and requires a registered workflow operation and policy for the utility's capability.
- **Unauthenticated host objects remain.** `runtime.status()`/`snapshot()`, `ModelProviderRegistry.list()` and `SecurityAuditLog.list()` are unchanged and must stay host-only.
- **Optional estimates.** Estimates depend on approval of the `admissionUnits` extraction. Without it, Kubera ships without projections.
- **Open findings.** H03 and H04 NO-GO items remain open and are not addressed here.

**Changed paths in H05-A:** `docs/audits/hanuman-h05-contract.md` (new). Nothing was committed, pushed, tagged or published. Work stops after H05-A.
