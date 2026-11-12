# SARASWATI S05 — Ekalavya learning-assisted RUDRA routing

| Field | Value |
| --- | --- |
| Phase | S05, run against the S05 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S05 |
| Repository | ShivAX only |
| Branch / base | `feat/saraswati-v0.3.0` at `4635fbc` (the user's commit of S03 and S04). Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisites | S01, S02, S03 and S04 **PASS**. S04 final state: lint 0, `pnpm test` 863/863, build 0, `verify:package` 0 |
| Acceptance gate | **PASS** |

## 1. Existing routing (step 1)

Read before editing:

- `src/agents/rudra/{orchestrator,planner,types,validation}.ts`
- `src/agents/registry.ts`, `src/bots/{ekalavy,system}.ts`
- `src/learning/{index,updates,datasets,benchmarks,registry}.ts`
- `src/intelligence/router.ts`
- `src/security/{jay,vijay}.ts`, `src/security/firewall/{policy,types,runtime}.ts`
- `tests/rudra.test.mjs` and the agent, specialist and workflow suites

**Routing rule.** RUDRA validates the plan, sorts the registered bots by ID, and
sends each step to the **first bot that offers the step's capability** (trace
decision `capability-then-bot-id`). The routing context is:

- The planner proposes capabilities only. It cannot name a bot or grant
  permissions.
- The host's `allowedCapabilities` limits the plan.
- Vijay `runBot` checks the capability policy permissions and approval.
- The firewall enforces `policy.capabilities`, `policy.bots` and the provider
  allowlists.
- `ModelRouter` routes models, not bots: by locality, then id, with exact
  budgets.

**Shared capabilities.** The built-in system's seven bots share **no**
capability, so deterministic routing has exactly one candidate there. Learned
routing matters only when a host registers several bots for one capability,
which RUDRA already supports by choosing in ID order (test "RUDRA selection is
ordinal bot ID order").

**Ekalavy** keeps exactly three capabilities: `learning.feedback`,
`learning.record`, `learning.summarize`. S01 already defines
`routing-analysis` consent and `routing` feedback, where the curated label is the
correct bot. `EvaluatedModelUpdates` and the S04 registry provide the promotion
lifecycle.

## 2. What was added

| Area | Change |
| --- | --- |
| RUDRA | Optional synchronous `hooks.routing.select(request)`. The request is frozen: task, step, capability, the eligible candidate IDs and the deterministic baseline. Only a returned candidate ID is honoured (trace `routing-policy`). `null` keeps the baseline (`capability-then-bot-id`). Anything else, including exceptions, promises or unregistered IDs, keeps the baseline (`routing-policy-rejected`). Without the hook, the code path and trace are unchanged |
| Advisor | `createRoutingAdvisor(options, evidence)`, Ekalavya's shadow recommender (`src/learning/routing.ts`) |
| Shadow | `runRoutingShadow`, `summarizeRoutingShadow` |
| Quality | `evaluateRoutingQuality` |
| Policies | `validateRoutingPolicy`, `draftRoutingPolicy`, `RoutingPolicySwitch` (`hook`, `apply`, `syncFromRegistry`) |
| Promotion | `createRoutingEvaluator` (trusted deterministic S02 evaluator `shivax-routing-evaluator@1`), `routingPolicyResolver` (S04 versions to policies) |
| Errors and constants | `RoutingAdvisorError`, `ROUTING_LIMITS`, `ROUTING_REJECTIONS`, `ROUTING_ERROR_CODES` |

Exports are additive from `shivax` and `shivax/learning`. The RUDRA types
`RudraRoutingHook` and `RoutingSelectionRequest` come from `shivax` and
`shivax/rudra`. No bots were added. Full guide: `docs/learning-routing.md`.

## 3. Shadow-mode contract

- The advisor holds no tool client, model router, Vijay, firewall admin or
  registry write access. It returns frozen data only.
- Recommendations never change RUDRA's route. RUDRA reads a routing policy only
  when a host passes `routing: switch.hook`.
- `runRoutingShadow` returns RUDRA's own result, then records the advisor's
  view. Advisor errors become `advisor-error`.
- Test **L1**: the shadow run's outputs and selections deep-equal a plain run.
  `alpha` still runs while `beta` is recommended, only `alpha` executed, and the
  registry is unchanged.
- Test **L18**: firewall configuration, permission policies, registrations and
  the registry are unchanged after recommending and routing.

## 4. Recommendation schema

`shivax-routing-recommendation` v1 contains:

- `mode: 'shadow'`, `advisor: 'ekalavy'`, `taskId`, `capability`;
- `baseline`: bot, source, active policy id and version, and the baseline's
  rejection codes;
- `status`: `recommended`, `same-as-baseline`, `insufficient-evidence`,
  `no-candidates` or `blocked`;
- `recommended`;
- `ranking`: every registered candidate with `score`, `wins`, `trials`,
  `eligible` and `rejections`;
- `confidence`: Wilson 95% lower bound and trials, documented as an estimate;
- `evidence`: digest, ignored-label count, and up to 32 refs (feedback ids or
  `suite:case`);
- `explanation`: structured codes (`label-share`, `runner-up-share`,
  `verified-labels`, `minimum-labels`, `tie`, `low-confidence`,
  `ignored-labels`, plus rejection codes);
- `wouldChangeRouting`.

The full schema is in `docs/learning-routing.md`.

## 5. Inputs and decision validation (steps 2 and 4)

| Input | Source and verification |
| --- | --- |
| Verified feedback history | S01 `CuratedDataset`: `verifyCuratedDataset`, same tenant, purpose `routing-analysis`, train and validation splits, `routing` rows only |
| Trusted evaluation results | S02 suite plus report: `validateBenchmarkReport(report, suite)`, evaluator ground truth and allowlisted, same tenant, routing cases with bot labels |
| Current routing policy | `currentPolicy()`, for example `RoutingPolicySwitch.current`; the baseline is computed exactly as RUDRA would route |
| Available specialist capabilities | Live `BotRegistry` (read-only `list()`) |
| Task context within authorized scope | The task scope must equal the advisor tenant. With `security`, a Jay-minted live context from the same tenant |

Stale evidence (older than 30 days by default) is excluded and reported, and
nothing stale is used (L5).

Validation per candidate (L14):

- the request's RUDRA allowlist;
- Vijay capability permissions;
- firewall lockdown, capabilities and bots;
- the provider allowlist (ids and localities);
- host provider budgets.

Unknown bots are never candidates: labels naming them are counted in
`ignoredLabels` (L3). Policies naming them are rejected. A hook returning them
falls back to the baseline.

## 6. Scoring approach

- **Score:** the Laplace-smoothed share of verified labels, `(wins+1)/(n+K)`,
  over the registered candidates for the capability.
- **Recommend only when all hold:**
  - `n ≥ 5`;
  - a strict win over the next eligible candidate;
  - a Wilson 95% lower bound of at least 0.5.
- **Otherwise:** `insufficient-evidence` (L4).
- **Determinism:** ties are broken by bot ID, and the evidence digest identifies
  the data used.
- **No content is read:** the scorer reads only `{ capability, label }`. No task
  text or model output is interpreted, so injected instructions in evidence have
  nothing to steer (L6).

## 7. Routing quality (step 5)

`evaluateRoutingQuality` measures baseline and candidate on held-out labelled
routes:

- correct routes and accuracy;
- failed routing decisions;
- **estimated regret** (avoidable error, when ground truth exists);
- coverage;
- security denials;
- latency, cost and tokens **only from measured observations** of the chosen
  bots, and `null` otherwise.

Its verdict is `improved` only with at least 20 labels, more correct routes,
and no increase in denials or loss of coverage. Labelled routes that were also
advisor evidence are refused (`leakage`) (L15).

**Regression evidence from the tests:**

| Test | Comparison | Result |
| --- | --- | --- |
| L15 | 25 labels; deterministic against beta-first | Accuracy 0 → 0.8, regret 1 → 0.2, verdict `improved` |
| L15 | beta-first against gamma-first | Verdict `regressed` |
| L15 | 5 labels | Verdict `insufficient-evidence` |
| L15 | No observations | Latency `null`, not invented |
| L9 | Promotion against the S04 gate | A gamma-first policy is **rejected for regression** against the active beta-first policy |

No claim is made about real-world routing improvement. The numbers above come
from labelled test fixtures.

## 8. Activation requirements (step 6)

Routing policies go through the S04 lifecycle as configuration-only versions:

1. **Valid policy version:** `validateRoutingPolicy` with a closed schema, an
   integer `policyVersion`, registered bots only and the same tenant.
2. **Evaluation non-regression and security benchmark pass:**
   - S02 reports come from `createRoutingEvaluator` and are bound to the version
     by S04.
   - The host's versioned gate keeps `maxRegression` at 0.
   - Mandatory permission-denial cases are required (S04
     `requireSecurityCases`).
   - Under every policy, the evaluator answers `allow` only for callers who hold
     the permissions (L9, L17).
3. **Approved candidate:** S04 approval by a trusted administrator (Jay, role,
   host journal, firewall). A refused approval leaves RUDRA unchanged (L8).
4. **Rollback capability:** `RoutingPolicySwitch.syncFromRegistry` refuses a
   non-empty policy unless the registry has a rollback target (L9). S04 rollback
   plus a re-sync restores the previous routing (L10).
5. **Opt-in:** the host passes the switch's hook to RUDRA. Nothing activates
   automatically.
6. **Lockdown:** the advisor reports `blocked`, S04 refuses promotion, and the
   switch's hook returns `null`, so routing is deterministic (L11).

## 9. Security (step 7)

| Threat | Control | Test |
| --- | --- | --- |
| Model or evidence text grants permissions | Labels are counted only. Policies have a closed schema without permission, tool or provider fields. Vijay still checks the chosen bot (`security-denied`) | L6, L13 |
| Change specialist registration | The hook gets frozen candidate IDs and no registry. The advisor reads `list()` only | L6, L18 |
| Bypass Vijay or RUDRA checks | The hook chooses only among RUDRA's eligible bots, after the allowlist check; Vijay, approval and the firewall run unchanged | L13 |
| Modify firewall rules | No firewall administration access anywhere | L18 |
| Select unapproved providers | `provider-not-allowed` and `budget-exhausted` rejections | L14 |
| Execute arbitrary code | No evaluation of any string. Code-like IDs fail the reference pattern | L6 |
| Cross-tenant | Task, session, dataset, suite, policy and registry tenant checks | L7 |
| Delegation and budget limits | The hook cannot add steps, retries or capabilities (`maxSteps` and `maxRetries` unchanged). Provider budgets are checked. Evidence is bounded (10,000 examples, 16 evaluations, 32 refs) | L13, L14 |

## 10. Tests (step 8)

`tests/learning-routing.test.mjs`, 18 tests. Fixtures are in
`tests/fixtures/routing.mjs`:

- three bots share `mock.reason`;
- S01 routing feedback includes an unregistered-bot label and an injection
  string;
- an S02 routing suite;
- a trusted routing evaluator;
- a firewall view.

| Prompt test | Test |
| --- | --- |
| Shadow mode leaves routing unchanged | L1 |
| Valid recommendations | L2 (feedback and trusted-evaluation evidence) |
| Invalid bot recommendation | L3 |
| Missing evidence | L4 |
| Stale evaluation history | L5 (also forged, untrusted and unconsented evidence) |
| Prompt injection | L6 |
| Cross-tenant recommendation | L7 |
| Approval denied | L8 |
| Promotion approved | L9 |
| Policy rollback | L10 |
| Lockdown | L11 |
| Cancellation | L12 |
| Legacy deterministic routing compatibility | L13 (plus all 138 existing RUDRA, agent, specialist and workflow tests) |
| Additional | L14 decision validation; L15 quality and leakage; L16 drafts are inert; L17 the evaluator mirrors RUDRA and is deterministic; L18 no side effects |

## 11. Files

| File | Status |
| --- | --- |
| `src/agents/rudra/types.ts`, `orchestrator.ts`, `index.ts` | Additive optional `routing` hook and trace decisions (+57 / −5 lines) |
| `src/learning/routing.ts` | New |
| `src/index.ts`, `src/sdk/learning.ts` | One additive `export *` line each |
| `tests/learning-routing.test.mjs`, `tests/fixtures/routing.mjs` | New |
| `docs/learning-routing.md` | New guide |
| `README.md`, `docs/sdk.md`, `CHANGELOG.md` | Entry descriptions and `[Unreleased]` → Added |
| `docs/audits/saraswati-s05.md` | New (this file) |

**Unchanged.** `git diff HEAD` (`4635fbc`) is empty for:

- `src/security`, `src/memory`, `src/intelligence`, `src/nn`, `src/core`,
  `src/bots` (no bot or capability changed), `src/workflows`;
- `src/agents/{registry,execute,validation}.ts`, the RUDRA planner and
  validation;
- every earlier learning module, including the S04 registry;
- every existing test file.

## 12. Commands and results

| Command | Result |
| --- | --- |
| `pnpm lint` | **exit 0** |
| `pnpm test` | **881 tests, 881 pass**, 0 fail, cancelled, skipped or todo. 863 existing + 18 new |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports for 13 entries; 7 offline examples ran; packed worker training passed; declarations for 13 entries in 5 modes; **491 packaged files** (was 488) |
| `node --test tests/learning-routing.test.mjs` | 18/18, two consecutive runs |

**Defects found and fixed during S05:**

1. **Quality bookkeeping.** A correct "no route" outcome for a `null` label was
   counted as both correct and failed. It is now counted once (fixed before the
   tests ran).
2. **Evaluator types.** The routing evaluator's inferred return type was not an
   S02 observation; it is now typed explicitly.
3. **Lint.** A duplicate `shivax` import in the new test file failed lint.

**Test-side corrections**, where the code behaved correctly:

- L7: the S01 fixture's reviewer belongs to one tenant, so a foreign-tenant
  dataset cannot be curated there. That cross-tenant path is already covered by
  S01.
- L14: with `beta` firewall-denied, `gamma`'s label share is too low to
  recommend, so the result is `insufficient-evidence`, not `gamma`.
- L15: a floating-point mean needed a tolerance.
- L15: a `beta`-only policy under a `gamma`-only firewall correctly falls back to
  the denied deterministic `alpha`.

## 13. Security limitations

1. **Trusted host components:** the hook, `RoutingPolicySwitch`, the evaluator,
   and the provider and budget callbacks are trusted host code. They are not a
   sandbox for hostile in-process code.
2. **Routing changes the bot, not the authority.** A route to a bot the caller
   cannot use still fails at Vijay or the firewall. The policy cannot fix that,
   and must not try.
3. **Snapshots go stale.** Recommendations reflect the registry, firewall and
   evidence at the time of the call. Recompute rather than cache.
4. **Capability-level scoring only.** It is not conditioned on task content, so
   a recommendation that is right on average can be wrong for a specific task.
5. **Evidence integrity, not authenticity.** Authenticity relies on S01 review
   attestations and the S02 trusted-evaluator allowlist.
6. **The firewall check reads `policy.bots`.** The firewall itself enforces bot
   IDs only for operations that name a bot. The advisor and switch apply
   `policy.bots` to all routing, which is stricter.
7. **No real-world improvement is claimed.** All quality figures come from
   labelled test fixtures.
8. **Open items carried over:**
   - S00 P0-1, the peer-range `ERESOLVE` (H01);
   - stale "0.2.0 not published" text;
   - the roadmap's universal rules still list `vishwakarm` (the bot id is
     `vishwakarma`).

## 14. Phase acceptance

| Gate | Status |
| --- | --- |
| Deterministic capability routing preserved and authoritative by default | **PASS** (L1, L13; 138 existing routing-related tests) |
| Optional shadow recommendation engine with the required inputs and outputs; no tool execution | **PASS** (L1, L2, L18) |
| Recommendations validated against registration, capability, tenant, permissions, budgets, firewall and evidence; unknown or unauthorized bots rejected | **PASS** (L3, L4, L5, L7, L14) |
| Baseline and recommended routes compared with accuracy, failures, regret, latency, cost, denials and coverage; no unlabelled improvement claims | **PASS** (L15) |
| Opt-in activation only through S04 approval, with non-regression, security pass, a valid version and a rollback target | **PASS** (L8, L9, L10, L11) |
| Untrusted responses cannot grant permissions, change registration, bypass Vijay or RUDRA, modify the firewall, choose unapproved providers or execute code | **PASS** (L6, L13, L14, L18) |
| No new bots, no autonomous routing changes, no new dependencies, nothing published | **PASS** |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package` | **PASS** |

**S05: PASS.** S06 has not started.
