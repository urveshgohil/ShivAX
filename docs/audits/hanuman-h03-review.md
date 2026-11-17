# SHIVAX 0.4.0 HANUMAN · H03-C independent integration review

Date: 17 November 2026. Reviewed HEAD: `43bb3a4`. Node `v22.23.2`, Windows. Read-only review: no production code, test or dependency was changed.

**Decision: H03 NO-GO.**

- No authorization bypass, cross-tenant leak or unguarded network path was found.
- Every reproduced denial fails closed before the transport is called.
- The decision is NO-GO for three reasons:
  1. The H03 integration itself (H03-A) was never implemented. Its explicit-eligibility controls are missing (H03C-01, H03C-02).
  2. The H01 transport finding is still open (H01D-02).
  3. Two P2 execution-integrity issues were found (H03C-03, H03C-04).

## Scope and method

The H01-D, H02-D, H03-A and H03-B reports were read but not trusted: every claim below was checked against source or reproduced.

- **Git history.** `git diff 013e70d HEAD -- src` covers only four files (+44/−5), the H01D-01/H02D-01 retry fix in `134e367`. Commit `43bb3a4` adds only `tests/hanuman-integration.test.mjs` and `docs/audits/hanuman-h03-tests.md`.
- **Conclusion.** There is no H03-A production change: no eligibility API and no orchestration or routing changes.
- **Source reviewed:**
  - RUDRA: `src/agents/rudra/*`
  - Workflows: `src/workflows/*`
  - Jay, Vijay and tool leases: `src/security/jay.ts`, `src/security/vijay.ts`, `src/security/tools.ts`
  - Firewall: `src/security/firewall/{policy,runtime}.ts`
  - Hanuman: `src/bots/hanuman.ts`, `src/bots/base.ts`, `src/integrations/hanuman/*`
  - SARASWATI: `src/learning/routing.ts`, `src/learning/registry.ts`
  - Exports: `src/index.ts`, `src/security/index.ts`
- **Reproduction probe.** `node_modules/h03c-probe.test.mjs`, with output in `node_modules/h03c-probe.log` (both ignored scratch files). It reuses the committed H03-B host fixture verbatim, so it uses the real Jay, Vijay, NARASIMHA, RUDRA, workflow engine and H01 gateway, with only the transport mocked.

## 1. Architecture findings

| Check | Result | Evidence |
| --- | --- | --- |
| Hanuman is opt-in | ✓ | Nothing registers it by default. `createSpecialistSystem` has no Hanuman bot or tool (H03-B S3; `src/bots/system.ts`). |
| Seven default bots unchanged | ✓ | Exact IDs, including `vishwakarma`, and 29 capabilities. `src/bots/system.ts` is unchanged since H02. |
| Existing RUDRA routing works | ✓ | All 29 default capabilities route identically with and without Hanuman (H03-B S3). `rudra.test.mjs` passes. |
| No second orchestration engine | ✓ | Only `RudraOrchestrator` and the existing `RudraWorkflowEngine`. No new engine, wrapper or scheduler. |
| No duplicate security implementation | ✓ | Hanuman uses `toolCall` → Vijay `ToolLease` → `ProtectedToolRegistry`. The gateway reuses the firewall `resources` boundary. |
| No unguarded network invocation | ✓ | The gateway requires `checkExecution`, `checkNetworkAccess` and an SDK-issued resource boundary (`service.ts:128-133`). Calling the tool's `execute` directly with forged callbacks fails with `network-unprotected` and zero resolve calls (probe P9). Global `fetch` is never referenced (H02 source guard; trapped in the tests). |
| No unexpected public API change | ✓ | `NON_RETRYABLE` and `isNonRetryable` are exported from `security/errors.ts` but not re-exported by `security/index.ts`. The 13 declaration entries pass in 5 module modes. |
| H03-A integration present | ✗ | **Not implemented** (see H03C-01, H03C-02). |

## 2. Execution-path security matrix

Each Hanuman operation was checked against the checkpoints below on both routes. Every cell was reproduced in the H03-B suite or the H03-C probe, and asserts that the transport counters stayed at zero.

| Checkpoint | RUDRA → HanumanBot → tool | Workflow binding → tool | Alternative route |
| --- | --- | --- | --- |
| Explicit registration | `registerHanumanBot` plus `registerHanumanFetchService` | Host `ToolRegistry.bind` | Unregistered → `missing-capability` |
| Trusted host tool | `toolsForCapability` → leased client | Binding identity re-checked every attempt (`engine.ts:199`) | Tool removed → `registry-changed` / `tool-not-allowed` |
| Allowed capability | ⚠ Defaults to the root capability (H03C-01) | ⚠ Same default (`workflows/validation.ts`) | Planner-proposed capability outside the allowlist → `capability-denied` |
| Identity and session | Jay at `protectTask`, every admission, and after approval (`vijay.ts:114,291,332`) | Same, plus `validateTask` on resume | Forged context → `security-denied`; RUDRA with no Vijay → `tool-not-allowed` (P9) |
| Vijay authorization | Capability and tool policies, effective permissions, task grant, input predicate | Same | `fetch.url` policy does not authorize `hanuman.fetch` (P6) |
| Firewall | Task, bot and tool operations; network origin check per URL | Task and tool operations | Vijay without a bound firewall → denied, 0 dispatches (P9) |
| Approval | Tool policy approval; only literal `true`; Jay re-verified afterwards | Same, on every attempt | RUDRA host approval does not replace Vijay's approval |
| Budget | Firewall operation reservations; RUDRA `maxSteps` counts attempts | Steps, tool calls, model budget reserved before approval, never refunded | Exhausted → no dispatch (H03-B S8) |

**Gaps:**
- Execution-time checkpoints re-check identity and policy synchronously, but cannot poll an external session provider (H03C-03).
- Eligibility for the capability is implicit (H03C-01).

## 3. Authorization coverage and tool-argument integrity

- **Retrieved content cannot mutate tool inputs.**
  - Tool inputs are snapshotted, and approval request inputs are frozen (mutation attempts throw).
  - The gateway accepts only `{targetId}` (`service.ts:input`), so a gateway envelope forwarded as the next action's input is rejected.
  - An injected `{"targetId":"evil"}` body fails tool policy before approval (H03-B S6).
- **Task payloads cannot override identity.** Identity comes from the Jay-minted context, never from `input.data`. Hanuman's input schema rejects `principal`, `permissions`, `approved` and `trust` fields (H02 B5).
- **Bot responses cannot change `allowedCapabilities` or extend plans.** Settings and plans are validated and frozen before step 1 (`orchestrator.ts:255-285`). Later outputs are only `values` data. A hostile summarizer or mock-model output produced exactly the validated step count (H03-B S6).
- **Untrusted evidence cannot select a new origin.**
  - Targets come only from the host catalog and must match the session's issuer and scope.
  - Origins are bound by both the firewall operation and the network origin check.
  - **Residual risk:** a workflow action whose input is the output of an earlier *host* tool that parses retrieved text could pick a different target from the same catalog. That target is still limited by the tool policy predicate, the firewall origins and a fresh approval. Hosts should keep tool predicates narrow.
- **Workflow outputs cannot escalate privileges.** Outputs are wrapped with `trust: 'untrusted'`. A fingerprint of permissions, policies, tools, bots and the firewall version and mode is unchanged after injection runs.

## 4. Retry and cancellation findings

| Scenario | Observed |
| --- | --- |
| Approval granted, then the policy changes | Re-checked with no await before invocation (`vijay.ts:334-337`). Stale-approval variants (revoke, policy removal, lockdown, unregister) all give 0 dispatches. |
| Session revoked during approval wait | Jay re-verified after approval → denied, 0 dispatches. |
| Firewall mode changed during execution | Lockdown at DNS, response or stream cancels the lease. An acquired response is closed exactly once. Later work stays fenced. |
| Retry after capability revocation | Every workflow attempt re-enters Vijay. A removed or changed tool policy gives 0 additional dispatches. |
| Retry after budget exhaustion | Reservations happen before approval and are not refunded; `tool-limit` stops the retry. |
| Resume with stale permissions | `validateTask` on resume. Revoke, expiry or lockdown while paused gives 0 dispatches. |
| Deterministic denials | No retry (H01D-01 fix verified). RUDRA never retries Hanuman tool failures (`vijay.ts:526-528`). |
| Retry bound | `maxRetries` is capped at 3 in both engines. Each attempt also consumes `maxSteps` / `maxToolCalls`. No unbounded loop. |
| **Session revoked during an in-flight retrieval** | **The retrieval completes and its evidence is returned** (probe P1: RUDRA and workflow both `completed`, 1 output). The next admission is denied (P1b). See **H03C-03**. |
| **Deadline during retrieval** | **RUDRA reports `security-denied` in 18 of 20 runs** and `timeout` in 2; the workflow engine reports `timeout` in 20 of 20 (probe P3). See **H03C-04**. |
| Parallel `parallelSafe` retrievals with lockdown | Denied, 1 dispatch, 0 retries, firewall drained (probe P5). In this probe the fetches didn't overlap, so concurrent lockdown is not proven (see §8). |

Already-sent requests are never claimed to be reversible. Cancellation stops later effects and closes acquired responses.

## 5. Prompt-injection assessment

**Adequate for the current architecture.**

- The H03-B S6 payload (all five requested lines) stays literal untrusted evidence on the RUDRA path (two-step plan with a deterministic summarizer) and the workflow path (with a hostile `registerModel` mock).
- The plan length, tenant scope, permissions and firewall mode are unchanged. The privileged sentinel tool was never called.
- Traces and the firewall audit never contain the payload.
- Approval prompts show only `{ targetId }`, never the body.
- **Limitation:** there is no test where a RUDRA bot sends the evidence through a `ModelRouter` provider. The workflow model-tool path covers model handling but not `ModelRouter` fallback ordering (§8).

## 6. SARASWATI compatibility

| Requirement | Result |
| --- | --- |
| Shadow routing executes no extra tools | ✓ `runRoutingShadow` runs RUDRA exactly once and `recommend` performs no execution. 1 dispatch and 1 approval in total (H03-B S9). |
| Unapproved recommendations cannot activate | ✓ Recommendations are `mode: 'shadow'` and `RoutingPolicySwitch.current` stays `null`. Only trusted `apply`/`syncFromRegistry` change policy. `learning-routing` L8 (unapproved policy never reaches RUDRA) passes. |
| Policy versioning valid | ✓ Closed schema with `policyVersion` from 1 to 1,000,000, owner-bound, bots checked against the live registry. A policy naming an unregistered Hanuman is rejected. |
| Rollback functional | ✓ `apply(null)` restores deterministic routing (S9). Registry rollback in `learning-routing` L10 passes. A non-empty policy needs a rollback target (L9). |
| Feedback cannot grant permissions | ✓ The policy schema carries no authority fields (an extra `grant` is rejected). Labels for unregistered bots are ignored. Vijay still checks a routed choice. |
| Hook constrained to candidates | ✓ Hostile, unknown, wrongly cased, non-string or thrown answers → `routing-policy-rejected`, falling back to the baseline choice. |

There is no SARASWATI regression. Shadow eligibility for Hanuman uses the same implicit allowlist, so H03C-01 applies here too.

## 7. Test evidence reviewed

Commands were run on `43bb3a4` with the offline pnpm settings from H03-B.

| Command | Result |
| --- | --- |
| `node --test` focused set (12 suites: Hanuman ×3, RUDRA, workflows, security, firewall, firewall integration, learning routing and registry, intelligence, model cost) | 718 / 718 |
| H03-C probe (`node_modules/h03c-probe.test.mjs`) | Ran to completion; findings recorded above |
| `pnpm lint` | PASS |
| `pnpm test` | **1,275 / 1,275**, 0 failed, cancelled, skipped or todo |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS: 13 entries, 5 declaration modes, 532 files |

**H03-B test-quality audit:**
- **Enforcement paths are real.** The fixture uses the real Jay, Vijay, firewall, RUDRA, engine and H01 gateway; only the transport is mocked.
- **Denials check side effects.** `noDispatch()` asserts zero transport calls, zero sentinel and decoy calls, and an unchanged state fingerprint.
- **Mutation evidence is credible.** Disabling three guards (post-approval Jay check, resume validation, RUDRA allowlist) each failed the intended cases.
- **Weaknesses:**

| Weakness | Classification |
| --- | --- |
| The S10 deadline test accepts `timeout` or `security-denied`, which hides a 90% misclassification. | Part of H03C-04 |
| No test for session revocation during an in-flight transport call. | Part of H03C-03 |
| The two KNOWN GAP tests assert behavior that violates H03, yet `pnpm test` stays green. Readers can misread the green result as gate compliance. | H03C-06 |
| The "permission revocation before retry" case actually replaces the tool policy; principal-permission revocation mid-session is impossible by design and documented. | Naming, P3 |
| The cross-tenant parallel case uses separate host instances, so its isolation is partly structural. Shared-transport bodies, session-scope swaps and foreign-catalog targets (S4.7) are the meaningful assertions. | P3 |
| `quiescent()` waits 5 macrotask ticks. It was stable across 4 full runs but is timing-sensitive under load. | P3 |
| No overlapping `parallelSafe` Hanuman retrieval with mid-flight lockdown, and no `ModelRouter`-backed summarizer. | H03C-07 |

## 8. Findings (classification)

| ID | Severity | Location | Reproduction | Expected / actual | Impact | Remediation | Required regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **H03C-01** | **P1** | `src/agents/rudra/validation.ts:25-26`; `src/workflows/validation.ts` (`allowed` default); `src/learning/routing.ts` `recommend` default | H03-B "KNOWN GAP H03B-01": `rudra.run(ctx)` with no options → `completed`, 1 request | Expected: H03 requires the host to allowlist Hanuman's network capability explicitly. Actual: the root capability is allowlisted implicitly. | A network capability is used whenever the host registers it, without an explicit routing opt-in. All other layers (registration, grant, policy, firewall, approval) still apply. | Implement H03-A explicit eligibility for side-effecting capabilities (for example, mark Hanuman's capability as requiring explicit allowlisting) while keeping the legacy default for the seven built-ins. | Invert the KNOWN GAP case: without an explicit allowlist → `capability-denied`, 0 transport calls. The seven-bot defaults stay unchanged. Run on RUDRA, workflow and advisor eligibility. |
| **H03C-02** | P2 | `src/agents/rudra/orchestrator.ts:256-260` (`eligible[0]`) | "KNOWN GAP H03B-02": `atlas` offering `fetch.url` takes the route. Probe P4: if `atlas` is not firewall-allowed, the run is `security-denied` and Hanuman never runs. | Expected: a defined, reviewed binding of the protected fetch route. Actual: the first bot by ID wins. | Route capture or loss of availability by any colliding host-registered provider. It fails closed and there is no fallback, but which provider runs depends on ID sort order. | As part of H03-A, bind Hanuman eligibility to its registered tool and bot ID, or reject ambiguous providers for protected network capabilities. | A colliding provider is rejected or ignored for the protected route, and is never silently selected. |
| **H03C-03** | P2 | `src/security/tools.ts:117-140` (synchronous `checkpoint`); `vijay.ts` (Jay polled only at admission and approval) | Probe P1: revoke the session (`isSessionValid → false`) while the response streams. RUDRA and workflow both return `completed` with the evidence. | Expected: H03 says subsequent protected effects are blocked; a revoked session should not receive newly completed evidence. Actual: the in-flight retrieval completes and its evidence is published. The next step is denied (P1b). | A revoked principal can receive the result of one already-admitted retrieval. Only an external host cancel or lockdown stops it. | Asynchronously re-verify Jay after the protected tool returns and before the output is released (in `ToolLease` or Vijay), and fail with a non-retryable denial. Alternatively, explicitly document and test that hosts must cancel or lock down on revocation. | Revoke mid-stream → no output published, status denied, response closed once, 0 retries, on both paths. |
| **H03C-04** | P2 | `src/agents/rudra/orchestrator.ts:132` (`revokeFirewall` → `security-denied`), reached from `check()` when the lease's own deadline aborts first | Probe P3: 20 RUDRA runs with `timeoutMs: 40` gave 18 `security-denied` and 2 `timeout`. Workflow runs gave 20 `timeout`. | Expected: a deadline reports `timeout`. Actual: it is mostly reported as a security denial. | Hosts and audits misclassify timeouts as authorization failures (false security alerts, wrong backoff). It still fails closed. The H03-B test masks it. | Map a firewall lease aborted for timeout, or a passed task deadline, to `timeout` before treating the abort as a revocation. Apply the same rule in `engine.ts:64`. | Deterministic deadline test asserting `timeout` on both paths over ≥20 iterations. Replace the either-code assertion in H03-B S10. |
| **H01D-02** | **P1** (carried over) | No Node transport adapter | See H01-C and H01-D | A reviewed DNS-pinned TLS transport is required | Wire-level SSRF and TLS safety is unproven | Implement and independently review it | Isolated socket and TLS suite |
| **H03C-05** | P3 | `src/security/vijay.ts:316` (approval request) | Probe P8: retry approvals were identical `{targetId:'docs'}` prompts with no attempt number | Expected: the approver can tell a retry from a first request. Actual: there is no attempt or retry context. | Approval fatigue; retries are indistinguishable. | Add bounded `attempt` metadata to `SecurityApprovalRequest` (additive) | Approval request includes the attempt and increments on retry |
| **H03C-06** | P3 | `src/security/vijay.ts:526-528`; `tests/hanuman-integration.test.mjs` KNOWN GAP cases | Probe P2: a missing tool permission gives `bot-failed`, but lockdown at approval gives `security-denied` | Expected: consistent classification of security denials at the tool level. Actual: a tool-level denial looks like a bot failure. The KNOWN GAP tests keep the suite green. | Observability; possible misreading of gate status. | Carry a non-retryable security classification into the RUDRA result. Convert the KNOWN GAP cases into explicit pending requirements tracked by the H03-A gate. | Tool-level denials report `security-denied` with 0 retries |
| **H03C-07** | P2 (coverage) | `tests/hanuman-integration.test.mjs` | — | Missing: in-flight revocation (H03C-03), deterministic deadline (H03C-04), overlapping `parallelSafe` retrievals under lockdown, `ModelRouter` fallback with evidence input | Gaps in race and summary-path coverage | Add these cases | As listed |
| **H03C-08** | P3 | `src/security/errors.ts:43`, `src/integrations/hanuman/error.ts:5` | — | The `Symbol.for('shivax.security.nonRetryable')` marker is an undocumented internal protocol. Other protected tools' deterministic failures can still be retried by workflows (existing behavior). | Maintainability; inconsistent retry semantics across tools | Document the marker as an internal contract, or expose a typed, additive opt-in. Review the other built-in tools. | Per-tool deterministic-denial retry tests |
| **H03C-09** | P3 | `src/security/firewall/runtime.ts:815` | Probe diagnostics: `status()` during lockdown reported `admission: 'open'` | `admission` reports whether the policy is available, not lockdown. Consumers must also check `mode`, which `learning/registry.ts:700` does. | Easy to misuse in new integrations | Document `admission` semantics next to `FirewallStatus` | — |

**Report-accuracy notes:**
- **H03-B.** Its §8 calls H03B-03 an occasional race, but RUDRA misclassifies about 90% of deadlines. Its counts (108 new cases, 1,275 total) and mutation claims were confirmed.
- **H03-A.** Its statement that synchronous checkpoints cannot poll the identity provider is accurate, and H03C-03 is the concrete consequence.

## 9. Remaining risks

- The live transport is unreviewed (H01D-02). The gateway trusts the peer address the host transport reports.
- An in-flight retrieval outlives session revocation unless the host cancels it or locks down (H03C-03).
- Eligibility is implicit and the route can be captured by a colliding provider (H03C-01, H03C-02).
- Data-dependent target selection through host parsing tools is bounded only by tool predicates, catalog, origins and approval.
- `fetch.api` and `research.search` remain unimplemented and denied.

## 10. H03 GO / NO-GO

**NO-GO.**

- **Blocking:** H03C-01 (P1, H03-A not implemented), H01D-02 (P1), H03C-03 (P2) and H03C-04 (P2).
- **Required next steps:**
  1. Implement and review H03-A eligibility, closing H03C-01 and H03C-02.
  2. Fix H03C-03 and H03C-04 and add their regression tests (H03C-07).
  3. Implement and review the H01 transport.
  4. Re-run H03-B and H03-C.
- **Non-blocking items:** H03C-05, -06, -08 and -09 can be scheduled separately.

**Changed paths in this phase:** `docs/audits/hanuman-h03-review.md` (new). Probe and logs are kept only in ignored `node_modules/h03c-*` files. Nothing was committed, pushed, tagged or published. Work stops after H03-C.
