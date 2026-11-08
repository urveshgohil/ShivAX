# Learning-assisted RUDRA routing (SARASWATI S05)

Ekalavya (bot id `ekalavy`) can recommend which registered specialist should
handle a capability. The recommendation is learned from verified feedback and
trusted evaluations. **It is shadow-only by default:** RUDRA keeps routing
deterministically unless a trusted host applies an approved routing policy.

Source:

- `src/learning/routing.ts` (advisor, policy, evaluator, quality, switch);
- `src/agents/rudra/{types,orchestrator}.ts` (the optional `routing` hook).

Tests: `tests/learning-routing.test.mjs`. No bot was added, and the Ekalavy bot
and its three capabilities are unchanged.

## When routing has a choice

RUDRA sends each step to the **first registered bot, by bot ID, that offers the
step's capability** (trace decision `capability-then-bot-id`).

- In the built-in specialist system, no two bots share a capability, so there is
  exactly one candidate and learned routing changes nothing there.
- Learned routing matters when a host registers several bots for one
  capability, for example two code bots or a local and a remote reasoning bot.

## Shadow-mode contract

The advisor (`createRoutingAdvisor`) returns recommendations as frozen data.

**It never:**

- changes the route RUDRA takes;
- invokes bots, tools or models (it holds no tool client, model router or Vijay);
- changes firewall configuration, permissions, bot registration or the active
  routing policy;
- deploys model weights or writes to the S04 registry.

`runRoutingShadow(rudra, advisor, context, options)` runs RUDRA exactly as
`rudra.run` would, then asks the advisor what it would have chosen:

- The returned `result` is RUDRA's own result.
- The `shadow` record compares the actual bot with the recommendation.
- Advisor failures become `status: 'advisor-error'` and never affect the run.
- `summarizeRoutingShadow` counts agreement, disagreement, insufficient evidence,
  blocked recommendations and advisor errors.

## Evidence

Evidence is verified when the advisor is created. Labels are counted, never
interpreted; any other text in a row is ignored.

| Source | Requirements |
| --- | --- |
| S01 `CuratedDataset` | `verifyCuratedDataset` passes (digests, leakage); same tenant; purpose `routing-analysis` (the consent purpose); `domain: 'routing'` rows whose input has a `capability` and whose label is a bot ID. Train and validation splits are used; held-out is left for measurement |
| S02 suite and report | Suite and report validate together; the report's evaluator is ground truth and listed in `trustedEvaluators`; same tenant. Routing cases with a non-null `botId` label count as examples |

Handling of problem evidence:

- **Refused:** forged or tampered evidence, untrusted evaluators, another
  purpose, or another tenant (`invalid-evidence` or `cross-tenant`).
- **Excluded and reported:** evidence older than `evidenceTtlMs` (default 30
  days), listed in `evidence.excluded`.

## Recommendation schema (`shivax-routing-recommendation` v1)

```ts
{
  format, version: 1, mode: 'shadow', advisor: 'ekalavy', taskId, capability,
  baseline: { botId, source: 'deterministic' | 'routing-policy', policy: { id, policyVersion } | null, rejections },
  status: 'recommended' | 'same-as-baseline' | 'insufficient-evidence' | 'no-candidates' | 'blocked',
  recommended: botId | null,
  ranking: [{ botId, score, wins, trials, eligible, rejections }],   // every registered candidate, best first
  confidence: { method: 'wilson-lower-bound-95', value, trials },   // an estimate, not a guarantee
  evidence: { digest, ignoredLabels, refs },                         // refs: up to 32 feedback ids or suite case ids
  explanation: [{ code, botId, value }],                             // structured codes only, never evidence text
  wouldChangeRouting: boolean
}
```

## Decision validation

Each candidate is checked; a failing candidate is listed with its reason codes
and is never recommended.

| Check | Reason code |
| --- | --- |
| Registered and offering the capability | (not a candidate at all; labels naming other bots are counted in `ignoredLabels`) |
| The request's RUDRA allowlist | `capability-not-allowed` |
| Tenant and session scope | `cross-tenant` error (task scope and, with `security`, the Jay session) |
| Effective permissions (Jay identity holds the Vijay capability policy's permissions) | `permission-denied` |
| Firewall lockdown | `lockdown` |
| Firewall `policy.capabilities` and `policy.bots` | `firewall-capability-denied`, `firewall-bot-denied` |
| Bot's model provider in the firewall's `providers.ids` and `localities` | `provider-not-allowed` |
| Host provider budget (`remainingCalls ≥ 1`, `remainingCostUSD > 0`) | `budget-exhausted` |
| Enough verified evidence | `insufficient-evidence` status |

Errors in a host check fail closed.

## Scoring

For a capability with K registered candidates, `n` is the number of verified
labels naming one of them. For each candidate `b`:

- **Score:** `(wins_b + 1) / (n + K)` (Laplace-smoothed share). Ties are broken
  by bot ID.
- **Recommendation:** the best eligible candidate, but only when all of these
  hold:
  - `n ≥ minEvidence` (default 5);
  - it has strictly more wins than the next eligible candidate;
  - the Wilson 95% lower bound of its share is at least `minConfidence`
    (default 0.5).
- Otherwise the status is `insufficient-evidence` (codes `verified-labels`,
  `tie` or `low-confidence`).

The scorer counts verified labels. It does not read task text and does not use a
language model, so prompt injection in feedback or model output has nothing to
steer.

## Routing quality

`evaluateRoutingQuality` compares a baseline and a candidate policy on held-out
labelled routes.

**Per strategy it reports:**

- decisions;
- correct;
- failed (no route, or the chosen bot is denied);
- accuracy;
- estimated regret: labels that were eligible but not chosen, per decision;
- coverage;
- security denials;
- latency, cost and tokens, taken only from measured `observations` of the
  chosen bots (verified usage for cost and tokens), and `null` when unmeasured.

**Verdict:**

- `improved` only with at least `minLabelled` (default 20) labels, more correct
  routes, and no increase in security denials and no loss of coverage;
- `regressed` when it loses on any of these;
- `insufficient-evidence` below the label minimum.

Labelled routes whose ref was used as advisor evidence are refused (`leakage`).

## Policies and promotion

A routing policy (`shivax-routing-policy` v1) has `id`, `policyVersion`,
`owner`, and `rules: [{ capability, order: [botId…] }]`.

- **Closed schema:** no permissions, tools, providers or free text.
- **Strict validation:** `validateRoutingPolicy(policy, { bots, owner })`
  rejects bots that are not registered for the rule's capability, duplicate
  bots, and policies of another tenant.
- **Default:** capabilities without a rule route deterministically.
- **Drafts:** `draftRoutingPolicy` turns recommendations into a draft, which does
  nothing until promoted.

Promotion uses the S04 lifecycle, with the policy as a configuration-only
version (`artifact.model: null`):

1. **Register** the policy.
2. **Evaluate** it with S02 reports from `createRoutingEvaluator`:
   - The evaluator is deterministic (`shivax-routing-evaluator@1`; the host lists
     it in `trustedEvaluators`).
   - It applies the policy the way RUDRA does.
   - `routingPolicyResolver(registry, …)` maps report configurations to stored
     policies.
   - Permission cases answer `allow` only when a route exists, the chosen bot
     passes the host checks and the caller holds the capability permissions, so
     a routing policy can never grant access.
3. **Gate.** The host's versioned `BenchmarkPolicy`:
   - must keep `maxRegression` at 0 (evaluation non-regression);
   - requires mandatory permission-denial cases (security benchmark).
4. **Approve** by a trusted administrator, then **activate**: S04 approval,
   firewall checks and atomic activation.
5. **Apply.** `RoutingPolicySwitch.syncFromRegistry(registry)` validates the
   active policy against the live bots and tenant, then applies it to
   `switch.hook`.
   - A non-empty policy is applied only when the registry holds a rollback
     target. Activate an empty (deterministic) policy first.
6. **Opt in.** The host passes `routing: switch.hook` to `RudraOrchestrator`, or
   `hooks.routing` to `createSpecialistSystem`.

**Rollback** is S04 `rollback` followed by `syncFromRegistry`. During firewall
lockdown the switch returns `null`, so RUDRA routes deterministically.

## Security limitations

- **Trusted host components:** the hook, the switch, the evaluator and the
  provider and budget callbacks are trusted host code. They are not a sandbox
  for hostile code in the same process.
- **Routing changes the bot, not the authority.** Vijay, the firewall and RUDRA
  approval still check whichever bot is chosen. A permission-blocked route fails
  the same way it would under deterministic routing (`security-denied`).
- **Snapshot staleness.** The advisor reads the registry and firewall when asked.
  A recommendation is a snapshot and can go stale. Recompute rather than cache.
- **Capability-level scoring only.** It is not conditioned on task content. A
  recommendation that is right on average can be wrong for a specific task.
- **Evidence integrity, not authenticity.** Checksums and digests show the
  evidence wasn't changed. Authenticity rests on S01 review attestations and the
  S02 trusted-evaluator allowlist.
