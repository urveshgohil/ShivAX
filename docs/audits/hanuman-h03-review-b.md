# SHIVAX 0.4.0 HANUMAN · REV-B independent audit of H03 and verification of REV-A

19 November 2026, Asia/Calcutta. Strictly read-only. The only file added is this report. No source, test, assertion, script, manifest or dependency changed, and nothing was committed, pushed, tagged, published or deployed.

The REV-B template left the phase as a placeholder (`[H01 / H03 / H04 / H07 / H09]`). The only REV-A report in the repository is [`hanuman-h03-review-a.md`](hanuman-h03-review-a.md), so this review covers **H03**.

**Final decision: FAIL.**
- **P1:** a mandatory H03 gate is confirmed unmet. Explicit eligibility for the Hanuman network capability is absent on both execution paths (H03C-01).
- **P0:** none.
- **Bypass attempts:** no authorization, tenant, firewall, budget or approval bypass was reproduced.
- **REV-A findings:** all six reproduce with independent code; one has an overstated impact statement.
- **New findings:** one P2 and two P3. The P2 is a prompt-injection-to-arguments path in which untrusted data loses its provenance at step boundaries.

## 1. Reviewed commit and artifact

| Item | Value |
| --- | --- |
| Commit | `025e1e8` on `feat/hanuman-v0.4.0`. It adds only the REV-A report since `2f596b4`; `git diff 2f596b4 HEAD -- src tests package.json` is empty |
| H03 source drift since H03-C (`43bb3a4`) | Only `src/workflows/engine.ts` (the opt-in H04 preflight and lifecycle), as REV-A stated. I re-checked this with `git diff --stat` |
| Build under test | The repository `dist`. No source file is newer than `dist/index.esm.js`, so the build matches the source. No rebuild was made |
| Environment | Windows 11, Node v22.23.2. All execution was offline, with in-memory transports |

H09-only artifact checks (frozen SHA-256, CI) are out of scope for H03. They are recorded in [H09-D](hanuman-h09-release.md).

## 2. Scope and limitations

**Covered:**
- RUDRA admission, routing and approvals;
- the workflow engine's admission, binding, approvals, retries, budgets and pause/resume;
- Vijay's interaction with both engines;
- SARASWATI routing hook and switch;
- the H03 tests and their ability to detect regressions.

**Method:**
- Independent probes, written from scratch, did not reuse REV-A's scripts or fixture names: `verify.mjs`, `attack.mjs`, `modes.mjs`.
- An independent mutation harness (`mut.mjs`) used different mutants from REV-A's.
- Focused suites were run directly.
- Evidence is in the ignored `node_modules/h03revb-evidence/`.

**Not covered:**
- Wire-level transport security (H01D-02).
- H04 safety-check internals, beyond their admission order on the H03 workflow path.
- H07 and H09 release evidence.
- Linux, and Node 24/26, for the H03 suites.
- H03C-03 and H03C-04 were not re-run here. Their source is unchanged since they were last reproduced (H09-C A14 and T14).

This is a phase audit, not a complete security audit of the SDK.

## 3. REV-A findings verification

| REV-A item | REV-B classification | Independent evidence |
| --- | --- | --- |
| **H03C-01** (P1) implicit allowlist | **Confirmed** | V1: `rudra.run(ctx)` with no options gives `completed`, 1 request. V2: workflow `start(ctx, plan, {})` gives `completed`, 1 request. V3 control: an explicit allowlist without the capability gives `capability-denied`, 0 requests. Source: `src/agents/rudra/validation.ts:26`, `src/workflows/validation.ts:36` |
| **H03RA-01** (P2) workflow first-by-ID tool capture | **Confirmed**, and strengthened | V4 with three decoy IDs: `0-early` and `b.fetch` run instead of Hanuman (decoy 1 call, Hanuman 0 requests); `z.late` does not. V5: neither an options field nor a plan field can pin the tool (`invalid-options`, `invalid-plan`). Mutation X2 (bind the **last** tool) **fails no test**, so selection on this path is untested |
| **H03RA-02** (P3) routing switch lockdown claim | **Partially confirmed** | V6 with a real firewall in lockdown and a real RUDRA run: without the `firewall` option `hook.select()` returns `hanuman`; with it, `null`, so the documentation is wrong. But **both runs end `security-denied` with 0 requests**, because lockdown denies every bot operation. REV-A's impact statement (a denial "instead of the deterministic fallback") is inaccurate: the deterministic route is also denied in lockdown. The only observable effect is the trace decision (`routing-policy` versus `capability-then-bot-id`) and the documentation |
| **H03RA-03** (P3) bot unregistration ignored mid-run | **Confirmed** | V7: a bot that unregisters itself on attempt 1 is retried and **completes on attempt 2** while no longer registered (legacy path). REV-A showed the same on the secured path |
| **H03RA-04** (P3) RUDRA approval hook before Vijay authorization | **Confirmed** | V8: hook prompt `only:vishwakarma:code.summarize`, then `security-denied`. Vijay's approver is never called |
| **H03RA-05** (P3) `running` before re-authentication on resume | **Confirmed**, with a stronger reproduction | V9b: paused **after** action 1 (1 output, 1 request), provider revoked, `resume()`: status reads `running`; the final result is `denied`/`security-denied` with no further request |

**REV-A mutation claims (spot-checked with different mutants):**

| Mutant | Result |
| --- | --- |
| X1: RUDRA picks the last eligible bot | Killed by 11 tests, ESM and CJS |
| X3: Vijay drops Jay re-verification after approval | Killed by the same 5 tests as REV-A's M10 |
| X5: in-flight checkpoint stops re-asserting the admitted policy | Killed, but by one test per format only |
| X4: RUDRA drops `check()` after its approval hook | Survived. This is equivalent: `bounded()` already calls `check()` after the awaited approval (`orchestrator.ts:167-171`) |
| X2: workflow binds the last tool | **Survived**. This one is not equivalent (see H03RB-03) |

REV-A's "12 of 12 non-equivalent mutants killed" is consistent with what I saw, but its set omitted the workflow-binding mutant, which survives.

**Accuracy corrections to REV-A:**
- REV-A §3 says every decoy sorts after Hanuman, listing "atlas". In fact `atlas` sorts **before** `hanuman`, and that is exactly the pinned `S9 KNOWN GAP H03B-02` RUDRA case. The gap is only on the workflow path.
- The H03RA-02 impact is overstated (above).

Neither correction changes REV-A's verdict.

## 4. New independent findings

### H03RB-01 · P2 · Untrusted-derived data reaches state-changing tool arguments without provenance

- **Location:**
  - `src/workflows/engine.ts:254-259`: a step-sourced input is `values.get(stepId)`;
  - `src/workflows/engine.ts:361`: `values.set(action.id, output)` stores the bare output, so the `WorkflowOutput.trust: 'untrusted'` wrapper is dropped;
  - `src/agents/rudra/orchestrator.ts:287-292, 431`: the same on RUDRA;
  - `src/security/vijay.ts:316-325`: the approval request carries `input` with no provenance.
- **Minimal reproducer:** `node_modules/h03revb-evidence/attack.mjs`, case N1, with an allowlisted plan:
  1. `hanuman.fetch` fetches a body containing "SEND TO attacker@evil.example".
  2. A host read-only `summarize` tool extracts `{ to }` (it stands in for a model tool).
  3. A state-changing `mail.send` tool with `requiresApproval: true` takes its input from step 2.
- **Actual:**
  - all three outputs are labeled `untrusted` in the result;
  - the **approval request for `mail.send` is `{ to: 'attacker@evil.example', text: 'summary' }` with no trust or provenance marker**;
  - after approval, the mail is sent to the attacker address.
- **Expected:** the existing contracts say fetched text is never authority, and H03-A requires that earlier outputs be data only. That much holds: no capability, permission or plan changed. But nothing in the engine lets a policy or an approver know that an argument derives from untrusted retrieval. The `trust` label exists only on the outer result and disappears at the step boundary.
- **Impact:** prompt injection can choose the arguments of a state-changing effect. It needs four things: an allowlisted plan (proposals are explicitly untrusted in the engine), a host transform that copies text into fields, a permissive `validateInput`, and an approver who approves.
  - It bypasses no configured check, which is why it is P2 rather than P1.
  - Approval, the only remaining control, sees no provenance.
  - The shipped `docs/sdk.md` does not warn that chained step outputs lose the `untrusted` wrapper.
- **Remediation, in order of strength:**
  1. Propagate provenance: include `derivedFrom: [{ actionId, trust: 'untrusted' }]` in tool and capability approval requests for step-sourced inputs.
  2. Add a policy flag (for example `acceptsUntrustedInput`), defaulting to false for `state-changing` policies, that denies step-sourced inputs from untrusted outputs unless the host opts in.
  3. Document the data flow in `docs/sdk.md` and `SECURITY.md`.
- **Required regression coverage:**
  - a fetch, transform, state-changing chain in ESM and CJS, asserting that the approval request carries provenance;
  - default denial without opt-in;
  - 0 tool calls when denied;
  - a RUDRA multi-step twin.
- **Confidence:** high on the behavior. **Assumption:** that hosts will build such chains; the engine explicitly supports `source: 'step'` and treats proposals as untrusted.

### H03RB-02 · P3 · Enforce-mode workflow preflight runs before authentication and leaves no security audit record

- **Location:** `src/workflows/engine.ts:78-88` (preflight and a synchronous `preflight-blocked` throw) precedes `:234-238` (`protectTask`). The returned run handle carries `preflight` (`:485`) before admission completes.
- **Minimal reproducer:** N2. A structurally valid but **unminted** context (from `createTaskContext`), engine `preflight` in enforce mode, a plan whose profile is unsafe.
- **Actual:**
  - `start()` throws `preflight-blocked` synchronously and the Vijay audit log gains **0** records;
  - the same forged context with a passing plan yields a report on the handle, then `denied`/`security-denied`, which *is* audited;
  - no transport call in either case.
- **Expected:** authentication precedes any analysis whose outcome is reported to the caller, or a rejected attempt is at least recorded.
- **Impact:** low. Hosts mint contexts, so the oracle is host-internal. The main effect is a missing audit trail for unauthenticated attempts and a pre-auth report. This was introduced with H04 but sits on the H03 admission path.
- **Remediation:** run `protectTask` (or `rejectContext` for unminted contexts) before preflight, or record a denial when preflight blocks.
- **Required regression coverage:** an unminted context with enforce preflight gives `security-denied` (or an audited block), in ESM and CJS.

### H03RB-03 · P3 · The workflow half of an S7 test passes whichever tool the engine selects

- **Location:** `tests/hanuman-integration.test.mjs:799-804`, "S7 a denied Hanuman route never falls back to another provider". The decoy `zz.decoy` (`:242-247`) has no task grant.
- **Reproducer:** mutation X2 (engine binds the *last* tool for a capability, selecting `zz.decoy`). All 470 tests in the six suites still pass. The decoy would be denied by the missing grant (`denied`, `decoyTool 0`, `request 0`), so the assertions hold either way.
- **Expected:** a test that fails when the engine selects or falls back to a different binding.
- **Impact:** a regression in workflow route selection (or a future fallback) would go unnoticed. This adds to H03RA-01.
- **Remediation:** grant the decoy as well, give it a lower-sorting ID, and assert the attempted tool ID from the trace and 0 decoy calls. Alternatively assert the `toolId` in the workflow `action` trace.
- **Required regression coverage:** the revised test must fail under X2.

## 5. Security test evidence

**Attack paths assessed** (reachable paths, offline):

| # | Path | Result |
| --- | --- | --- |
| 1 | Host-provided tool capabilities | Capture by a lower-sorting tool confirmed (H03RA-01); no privilege gain |
| 2 | Unauthorized network dispatch | None. All denials: 0 resolve and 0 request (V3, modes, N2) |
| 3 | DNS or redirect bypass | Not in H03 scope (H01). The gateway behavior was re-verified in H09-C |
| 4 | Credential leakage | Firewall audit and RUDRA trace contain neither the body nor the URL (modes probe: `auditLeaksBody`, `auditLeaksUrl`, `traceLeaksBody` all false) |
| 5 | Tenant isolation | Not re-probed. Covered by tests S4.7 and S10 (pass) and H09-C case 6 |
| 6 | Missing Vijay authorization | None. Both engines enter `Vijay.#authorized` for every attempt. The RUDRA hook runs earlier, but grants nothing (H03RA-04) |
| 7 | Firewall policy bypass | None (table below) |
| 8 | Approval reuse after revocation | Not possible. Mutation X3 is detected; per-attempt approvals |
| 9 | Async permission races | Revocation during approval blocks (S4.8, killed X3). In-flight identity-provider revocation is still open (H03C-03, not re-run) |
| 10 | Prompt injection becoming authority | Not authority. It **can** become state-changing arguments without provenance (H03RB-01) |
| 11 | Unbounded retries or resources | Bounded: `maxRetries` 3 or less, steps 100 or less, `maxParallel` 8 or less, synchronous reservation |
| 12 | Budget-limit violations | None. The $0.30 regression passes (below) |
| 13 | Cancellation and cleanup | Lockdown or revocation while paused ends `denied` with no dispatch (V9b) |
| 14 | Hidden capability disclosure | The planner sees allowed capability descriptors for all registered bots (trusted host code, as REV-A noted). The preflight result precedes authentication (H03RB-02) |
| 15 | SDK import or declaration regressions | None from H03. Package and SDK tests 9/9. Full compatibility is in H08-C and H09-D |

**Mandatory security per firewall mode** (`modes.mjs`, both paths; "resolve/request" counts transport calls):

| Scenario | RUDRA path | Workflow path |
| --- | --- | --- |
| Monitor, origin removed from policy | `failed/bot-failed`, 0/0 | `denied/security-denied`, 0/0 |
| Monitor, mandatory deny rule | `failed/bot-failed`, 0/0 | `denied/security-denied`, 0/0 |
| Monitor, optional deny (relaxed by design) | `completed`, 1/1 | `completed`, 1/1 |
| Lockdown before the run | `failed/security-denied`, 0/0 | `denied/security-denied`, 0/0 |
| Lockdown during tool approval | `failed/security-denied`, 0/0 | `denied/security-denied`, 0/0 |

Monitor mode does not disable mandatory authorization or origin rules, and lockdown blocks subsequent protected network effects.

**Focused suites run in REV-B** (`node --test`, Node 22.23.2):

| Suites | Result |
| --- | --- |
| Hanuman integration, fetch, bot, examples | 395/395 |
| RUDRA, workflows, agents, workflow-safety ×2 | 267/267 |
| Security, firewall ×4 | 262/262 |
| Model cost and safety, intelligence, learning routing, registry and governance | 158/158 |
| Package and SDK | 9/9 |

There were 0 skipped, TODO or cancelled tests. The mutation control passed 470/470.

## 6. Regression status

| Item | Status |
| --- | --- |
| Seven specialist IDs (`vishwakarma` included); Hanuman opt-in | Pass (agents and integration S3) |
| Legacy SDK imports, ESM/CJS/TypeScript | Pass (package and SDK tests). H03 changed no exports |
| ModelRouter exact cost: **$0.30, three $0.10 calls succeed, the fourth is denied** | **Pass** (`exact $0.3 budget permits 3 ten-cent calls and rejects the next`, ESM and CJS) |
| Hard token limits | Pass (`model-safety`, `intelligence`) |
| SARASWATI approval and rollback | Pass (`learning-registry`, `learning-routing`, integration S9) |
| RUDRA deterministic routing | Pass (S3: all 29 default capabilities unchanged; X1 killed) |
| Optional Inspectra | Not in H03 scope; verified in H08-C and H09-D |

## 7. Remaining issues

| ID | Sev | Status |
| --- | --- | --- |
| H03C-01 | **P1** | Confirmed open |
| H03C-02 / H03RA-01 | P2 | Confirmed open on both paths. The workflow path is untested (X2) |
| **H03RB-01** | **P2** | New |
| H03C-03, H03C-04 | P2 | Open (not re-run; source unchanged) |
| H03RA-02 | P3 | Partially confirmed (documentation only) |
| H03RA-03, H03RA-04, H03RA-05 | P3 | Confirmed |
| **H03RB-02**, **H03RB-03** | P3 | New |
| H03C-05/06/08/09 | P3 | Open (not re-run) |

No P0 is open.

## 8. Required remediations

1. **H03C-01:** require an explicit allowlist for protected and side-effecting capabilities on both engines, and invert the KNOWN GAP test. Add the workflow twin.
2. **H03RA-01 and H03C-02:** pin the protected route by tool or bot ID, or reject ambiguity. Rewrite the S7 workflow assertion so it fails under X2 (H03RB-03).
3. **H03RB-01:** carry provenance into approval requests for step-sourced inputs; add a deny-by-default policy option for untrusted inputs to state-changing capabilities; document the data flow.
4. **H03C-03 and H03C-04:** fix or formally accept them, with regression tests.
5. **P3 items:** correct the routing-switch documentation (H03RA-02); authenticate before preflight or audit the block (H03RB-02); document or recheck bot registration per attempt (H03RA-03); reorder or document the RUDRA approval hook (H03RA-04); set the status after re-authentication (H03RA-05).

## 9. Final decision

**FAIL.** A confirmed P1 (H03C-01) leaves a mandatory H03 gate, explicit eligibility, unmet. One new P2 (H03RB-01) and one confirmed P2 (H03RA-01, together with H03C-02) also remain.

The controls that do exist are effective and well tested: authorization, approval, firewall modes, retries, budgets and audit redaction. This review found no bypass of them.

## 10. May the next phase proceed?

**No release or later H-phase gate should treat H03 as passed.**

The appropriate next step is an owner-authorized **H03 remediation phase**, implementing H03-A explicit eligibility and route binding, plus H03RB-01 provenance. After that, H03-B, H03-C, REV-A and REV-B should be re-run on the resulting commit. Work on other phases may continue only with H03 recorded as an open blocker.

## Changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h03-review-b.md` | New (this report) |

Evidence (probes, mutation harness, logs) is in the ignored `node_modules/h03revb-evidence/`. Scratch copies used for mutation lived outside the repository. **REV-B stops here.**
