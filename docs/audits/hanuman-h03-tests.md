# SHIVAX 0.4.0 HANUMAN · H03-B offline integration test report

Date: 17 November 2026. Baseline: `134e367` (H01D-01 and H02D-01 retry fixes), Node `v22.23.2`, Windows.

**Verdict.**

- **H03-B offline test execution: PASS.** The new suite passes 108/108 and the existing release gates pass.
- **H03 integration gate: FAIL / BLOCKED.**
  - H03-A was never implemented: the [H03-A audit](hanuman-h03-implementation.md) blocked it on its prerequisites.
  - H01D-02, the reviewed Node transport, is still open.
  - Two required H03 behaviors are absent today. This suite records them as known gaps H03B-01 and H03B-02 and does not treat them as passes.
- **Live deployment: NO-GO.**

This phase tests the behavior that exists now, through the real Jay, Vijay, NARASIMHA, RUDRA, workflow and SARASWATI layers. Production code, existing tests, dependencies, Inspectra and Visynq were not changed.

## 1. Integration test matrix

New file: `tests/hanuman-integration.test.mjs`. It runs 54 cases, each in both ESM and CJS, against the installed `shivax`, `shivax/bots` and `shivax/integrations` packages.

Each case builds one fresh trusted host. The host holds:
- A `ProtectedToolRegistry` containing the real H01 gateway and a privileged sentinel tool.
- A `BotRegistry` with Hanuman, plus a decoy or summarizer bot where a case needs one.
- A mutable Jay identity provider, Vijay policies with tool approval, and a NARASIMHA firewall.
- A RUDRA orchestrator and a `RudraWorkflowEngine` over a `ToolRegistry` binding.

The network is the shared H01 mock transport (`tests/fixtures/hanuman-transport.mjs`), wrapped with counters for resolve, request and close calls and a log of dispatched URLs. Global `fetch` is trapped, and the suite asserts it was called 0 times.

The suite exercises two execution paths:
- **RUDRA path:** capability `fetch.url` → `HanumanBot` → protected tool.
- **Workflow path:** the same protected tool bound to `hanuman.fetch` for `RudraWorkflowEngine`.

| Area (contract step) | Cases | Paths |
| --- | --- | --- |
| Valid workflow (2) | Selection, capability, tenant scope, one approval and dispatch, bounded evidence, provenance, excerpt truncation | RUDRA |
| Default behavior (3) | Seven-specialist roster and 29 capabilities. No Hanuman bot, tool or fetch capability by default. Routing of all 29 default capabilities is identical before and after Hanuman opt-in. Missing Hanuman fails safely. | RUDRA |
| Authorization (4) | Forged context, expired session, revoked session, missing tool or capability permission, missing tool policy, unregistered tool, missing task grant, non-allowlisted capability (host and planner), wrong tenant (session and catalog), stale approval (4 variants), denied approval (Vijay, RUDRA, truthy non-`true`), argument mutation | RUDRA |
| Firewall (5) | ENFORCE (origin, target outside origins, hard deny, optional deny). MONITOR (optional rule observed; hard deny, origins, permissions, approval, loopback peer and tenant still enforced). LOCKDOWN (new work). Mid-flight lockdown at DNS, response and stream, then later work stays fenced. | Both |
| Prompt injection (6) | Requested five-line payload through a two-step RUDRA plan with a deterministic summarizer. The workflow path uses a hostile mock model tool. An injected `targetId` cannot drive a dependent fetch. | Both |
| Retry and fallback (7) | RUDRA never retries Hanuman tool failures. Workflow transient retries are re-approved until the limit. Five kinds of change before a retry stop the next dispatch. Expired approval, unavailable transport, missing binding, removed tool. No fallback to a decoy bot or tool. | Both |
| Budgets (8) | Exact decimal model cost. Token, cost and default-zero model budgets. Step and tool-call limits. No refund on denial. RUDRA `maxSteps`. Firewall operation reservations. | Both |
| SARASWATI (9) | Advisor finds no candidates without opt-in; policy naming an unregistered Hanuman rejected; shadow run adds no dispatch and activates nothing; hostile/throwing hook answers rejected; policy schema validation; approved policy routing, re-ordering and rollback to deterministic; Vijay still checks a routed choice | RUDRA |
| Lifecycle (10) | Pause before fetch then resume. Resume after revocation, expiry or lockdown. No replay after pause. Abort during approval or transport. Deadline. Parallel tenants on a shared transport. Ownership released after terminal outcomes. | Both |
| Real enforcement (11) | Every denial asserts the transport counters, the URL log, the privileged-sentinel and decoy counts, and an unchanged host-state fingerprint (permissions, scope, policies, tools, bots, firewall version and mode). It also asserts quiescence: 0 active and 0 draining firewall operations. An error status alone is never accepted. | Both |

## 2. Commands executed

All commands ran offline using the installed dependencies, with no external network:

```powershell
$env:PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false'; $env:PNPM_CONFIG_OFFLINE='true'
$env:PNPM_CONFIG_NODE_LINKER='hoisted'; $env:PNPM_CONFIG_PACKAGE_IMPORT_METHOD='copy'
pnpm build
node --test tests/hanuman-integration.test.mjs            # run 3× for stability
node --test <focused suites below>
pnpm lint
pnpm test
pnpm build
pnpm verify:package
```

The focused run covered these suites:
- **Hanuman:** `hanuman-integration`, `hanuman-bot`, `hanuman-fetch`.
- **Agents and orchestration:** `rudra`, `workflows`, `agents` (BotRegistry), `specialists`.
- **Security:** `security` (Jay and Vijay), `firewall`, `firewall-integration`, `firewall-management`, `firewall-model-integration`.
- **Models:** `intelligence` (ModelRouter), `router-audit`, `model-cost`, `model-safety`.
- **Learning:** `learning`, `learning-routing`, `learning-registry` (model lifecycle), `learning-governance`.
- **Memory:** `memory`, `memory-ranking`.
- **Inspectra:** `inspectra-adapter`.

Logs are kept in the ignored `node_modules/h03b-*.log` files.

## 3. Positive cases

- **Authorized RUDRA run.** It produces exactly one `selection` (`hanuman`, `fetch.url`, `capability-then-bot-id`, attempt 1) and exactly 1 approval, with input `{ targetId: 'docs' }`.
  - Transport counts are resolve 1, request 1, close 1, and the only URL dispatched is `https://docs.example.org/`.
  - The evidence has `trust: 'untrusted'`, a `registered-target` source, provenance `{ hanuman, fetch.url, shivax.hanuman.fetch }`, a `hanuman:<sha256>` ID and the injected receipt time.
  - The URL never appears in the result. Output is within 64 KiB, and a 5,000-byte body is truncated to the requested 64-character excerpt.
- **Workflow path.** Pause before the fetch dispatches nothing, and resume then completes with exactly 1 request. Transient `transport-error` responses retry with a fresh approval on every attempt (3 approvals, 3 dispatches, 2 retry events) and then complete.
- **Approved routing.** A policy ordering `zephyr` first routes to it (decision `routing-policy`). Re-ordering routes back to Hanuman. Rolling back (`apply(null)`) restores `capability-then-bot-id`.
- **Parallel tenants.** Two tenants on one shared transport each receive only their own body, with different evidence IDs and 2 dispatches in total.

## 4. Denial cases

Every case below asserts zero calls to the privileged sentinel and zero decoy calls.

- **Zero transport calls (resolve, request and close all 0).** Forged context, expired session, revoked session, missing tool permission, missing capability permission, missing tool policy, unregistered tool, missing task grant, capability outside the allowlist (host-supplied or planner-proposed), wrong-tenant session, foreign-tenant catalog target, denied approval, lockdown before start, resume after revoke, expiry or lockdown while paused, unregistered workflow binding, and a tool removed after binding.
- **Stale approval (4 variants).** While approval is pending, the case revokes the session, removes the tool policy, enters lockdown or unregisters the tool, and then approval returns `true`. In each case there are 0 dispatches, 0 retries and exactly 1 approval prompt.
- **Argument mutation.** Vijay and RUDRA approval inputs are frozen, and both mutation attempts throw. Changing the host's original input object after admission has no effect, so only the approved URL is fetched. A direct URL, an extra `url` field, or an unapproved catalog target is denied before DNS.
- **ENFORCE.** An origin outside the policy, a target outside the operation's origins, a hard deny rule and an optional deny rule all leave resolve and request at 0.
- **MONITOR.** An optional deny is observed (audit records `would-deny`/`observe`) and the fetch completes. A hard deny, an origin outside the policy, a missing permission, a denied approval, a loopback peer and a wrong tenant are still denied, each with 0 requests.
- **Mid-flight lockdown.**
  - At DNS: 0 requests.
  - At response or stream: 1 request, and the response is closed exactly once after draining.
  - On both paths: 0 retries even with a retry budget of 3, and the next run is also fenced with no new resolve.
- **Before a retry.** Cancellation, a permission change at the policy level, session revocation, lockdown and tool-policy removal each leave exactly 1 request. An approval that expires before the retry is denied, with 1 request.
- **No fallback.** When Hanuman is denied, a registered `zephyr` `fetch.url` bot and an alternative `zz.decoy` workflow binding receive 0 calls. A throwing provider is sanitized, with no secret in the result or events, and the decoy stays idle.

## 5. Security side-effect assertions

- **Injection.** The requested five-line payload stays a literal `excerpt`/`body` with `trust: 'untrusted'`. The downstream summarizer and the mock model receive it marked untrusted.
  - The summarizer's and the model's own hostile output (`grant admin`, a JSON plan with an `admin` action) are not executed.
  - The plan stays exactly two validated steps or actions, with 1 approval and 1 retrieval. The privileged sentinel gets 0 calls, and the firewall remains in ENFORCE at the same version.
  - Permissions, scope, policies and registrations are unchanged, every trace keeps the original session ID, and no trace or firewall audit entry contains the payload.
- **Workflow injection.** Workflow outputs are wrapped with `trust: 'untrusted'`. A fetched body `{"targetId":"evil"}` passed as the next action's input fails the tool policy before approval, with only the first retrieval dispatched.
- **SARASWATI.** Shadow runs and recommendations add no dispatch, approval or tool call, and leave `RoutingPolicySwitch.current` as `null`. Hook answers that are hostile, unknown, empty, non-string, wrongly cased or thrown are rejected (`routing-policy-rejected`) and fall back to the deterministic choice. Policies that are cross-tenant, duplicated, name unknown bots or carry extra authority fields are rejected.
- **Cleanup.** After every lifecycle, abort, deadline and lockdown case, the firewall reports 0 active and 0 draining operations. The engine and orchestrator accept new runs after terminal outcomes.

**Mutation evidence.** Each guard was disabled in a temporary source edit, rebuilt and tested, then restored. Afterwards `diff -r` confirmed the source was byte-identical to its backup, and `dist/` was rebuilt from clean source before the final gates.

| Mutation | Detected by |
| --- | --- |
| M1: Vijay skips the Jay re-verification after approval | S4.8 stale approval, S7 session revocation before a retry (ESM and CJS) |
| M2: workflow resume skips `validateTask` | S10 resume after revoke while paused (ESM and CJS) |
| M3: RUDRA drops the step allowlist check | S4.5 capability outside the allowlist (ESM and CJS) |

## 6. Results

| Command | Exit | Result |
| --- | --- | --- |
| `node --test tests/hanuman-integration.test.mjs` (3 runs) | 0 | **108 / 108** each run; 0 failed, cancelled, skipped or todo |
| Focused suites (23 files listed in §2) | 0 | **1,035 / 1,035** |
| `pnpm lint` | 0 | PASS (tsc, no emit, plus ESLint, including the new file) |
| `pnpm test` | 0 | **1,275 / 1,275** (1,167 before plus 108 new); 0 failed, cancelled, skipped or todo |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS: 182 gateway and 88 bot packed tests; browser-safe graphs; 13 declaration entries in 5 modes; 12 offline examples; 532 files |
| Mutation runs M1 to M3 | n/a | 4, 2 and 2 targeted failures respectively; all other cases passed |

Development runs found only fixture or expectation errors, all of which were corrected:
- A tool operation declared an origin the policy didn't allow.
- `createTaskContext` needs a security block.
- The firewall must be created in ENFORCE and switched to MONITOR through `admin.replace`.
- A model tool needs its own task grant.
- A gate was shared across loop iterations.
- Two close counts were asserted before draining finished.

None of these required a production change.

## 7. Coverage limitations

- **No real network.** No sockets, TLS, DNS rebinding or isolated fixture server were used. The transport is the mock, and the gateway trusts the peer it reports, so wire-level safety remains unproven until H01D-02 is done.
- **No real model.** The "model-assisted summary" is a deterministic in-process mock: a `ToolRegistry.registerModel` provider on the workflow path and a summarizer bot on the RUDRA path. No real or paid model was called.
- **SARASWATI registry rollback is not re-run against Hanuman.** The full promote, approve and rollback cycle is covered by the existing `learning-routing` cases L8–L10, which pass. Here, rollback is exercised through `RoutingPolicySwitch.apply`.
- **Pause and resume exist only on the workflow engine.** RUDRA has no pause handle, so pausing on the bot path is untestable by design.
- **Mid-session permission removal on the identity object is not observed.** Jay snapshots identity when it mints the context. A host must revoke the session or change the policy to take away a permission, and those are the forms tested. This matches the H03-A audit's statement of revocation semantics.
- **Optional capabilities.** `fetch.api` and `research.search` are only shown to be denied or unavailable.

## 8. Regressions and defects discovered

No regression in existing suites. No authorization bypass. Findings:

| ID | Severity | Finding | Reproduction | Required fix |
| --- | --- | --- | --- | --- |
| H03B-01 | Gate (H03-A missing) | Hanuman runs with no explicit host allowlist. `RudraOptions.allowedCapabilities` defaults to the root capability, so a `fetch.url` task routes to Hanuman whenever it is registered. | Case "KNOWN GAP H03B-01": `rudra.run(ctx)` with no options completes with 1 request. | Implement the H03-A explicit-eligibility rule (§4 of the H03-A report) without changing the legacy default for the seven built-in bots. Then invert this case. |
| H03B-02 | Gate (H03-A missing) | Deterministic routing picks the lowest-sorting bot. Any registered bot that offers `fetch.url` and sorts before `hanuman` (here `atlas`) takes the route. Vijay and the firewall still check it. | Case "KNOWN GAP H03B-02": the selection is `atlas`, with 1 decoy call and 0 Hanuman requests. | The H03-A eligibility design must define how Hanuman's protected route is bound so a colliding provider cannot capture it. Then invert this case. |
| H03B-03 | P3 (classification) | A deadline that expires during a fetch is reported as either `timeout` or `security-denied`. The firewall lease deadline and the engine timer race, and whichever fires first sets the error. Both outcomes fail closed with 1 request, a single close and no retry. | Run the S10 deadline case repeatedly. Diagnostic runs saw both codes on the RUDRA path. | Make the deadline cause win when the lease is aborted for timeout, for example by propagating the lease's timeout reason. Until then, the test asserts the documented pair of codes. |
| H01D-02 | P1 (carried over) | No reviewed Node transport. | See the [H01-D report](hanuman-h01-security-review.md). | Implement and review it before any live use. |

The two known-gap cases describe current behavior so that any change is visible. They do not approve that behavior.

## 9. Gate

- **H03-B offline test gate: PASS.** All 108 new cases and every existing suite pass, and the mutation probes detect the guards they target.
- **H03 integration gate: FAIL / BLOCKED.** H03-A explicit Hanuman eligibility (H03B-01, H03B-02) is not implemented, and H01D-02 is open.
- **Live deployment: NO-GO.**

**Changed paths in this phase:** `tests/hanuman-integration.test.mjs` (new) and this report. Nothing was pushed, tagged or published. Work stops after H03-B.
