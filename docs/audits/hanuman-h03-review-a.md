# SHIVAX 0.4.0 HANUMAN · REV-A independent review of H03 (RUDRA admission, workflow approvals, retries, budgets, shadow routing)

19 November 2026, Asia/Calcutta. Read-only review. The only file added is this report. No source, test, script, manifest or dependency changed, and nothing was committed, pushed, tagged or published.

**Preliminary result: FAIL.** No P0 was found, and no authorization, tenant-isolation or budget bypass was reproduced.

- **Why it fails:**
  - The explicit-eligibility requirement of H03 is still not implemented (H03C-01, P1). Re-verified on both the RUDRA and the workflow path.
  - This review found a related P2 gap: the same first-by-ID capture exists on the workflow-engine path and has no test.
  - Several P3 contract and documentation defects were also found.
- **What holds:** the controls that exist are well tested. Mutation checks killed every non-equivalent mutant I tried, in both ESM and CJS (§3).

## 1. Scope and commit

| Item | Value |
| --- | --- |
| Phase reviewed | H03 (RUDRA and workflow integration of the optional Hanuman specialist) |
| Commit under review | `2f596b4` on `feat/hanuman-v0.4.0`. The tree was clean before the review |
| Relevant source drift since H03-C (`43bb3a4`) | `git diff --stat 43bb3a4 HEAD -- src/agents src/learning src/intelligence src/security src/workflows/{engine,registry,validation}.ts` shows **only `src/workflows/engine.ts`** (+118/−9, the opt-in H04 preflight and lifecycle). So the H03-C findings still apply to the current source |
| Build used for probes | The repository `dist` (rebuilt by the H09 phases from the same source). No rebuild was made in this review |
| Environment | Windows 11, Node v22.23.2 |

**Reports read, then checked against source:**
- the [H03-A](hanuman-h03-implementation.md), [H03-B](hanuman-h03-tests.md) and [H03-C](hanuman-h03-review.md) reports;
- the H01-D, H02-D, H04-C, H07-D and H09-C security conclusions where they touch H03;
- the H03 sections of `docs/sdk.md`, `docs/learning-routing.md` and `SECURITY.md`.

**Source read in full or in the relevant parts:**
- RUDRA: `src/agents/rudra/{orchestrator,validation,planner,types}.ts`
- Context and execution: `src/agents/{context,execute,validation}.ts`
- Security: `src/security/{vijay,tools,jay}.ts`
- Workflows: `src/workflows/{engine,registry,validation}.ts`
- SARASWATI routing: `src/learning/routing.ts`

## 2. Contracts checked

| Contract | Verdict | Evidence |
| --- | --- | --- |
| Public API unchanged by H03 | PASS | H03 changed no source. Comparison of exports since v0.3.2 is in H08-C and H09-D |
| Hanuman opt-in; default roster unchanged | PASS | `createSpecialistBots()` has 7 bots; `registerHanumanBot` needs the tool. Re-verified H09-C |
| No permission is created or auto-granted | PASS | `ToolLease #execute` requires both the lease's `allowed` list and `root.security.toolPermissions` (`tools.ts:86-90`). Vijay re-checks grants in `runBot`'s `ensure` (`vijay.ts:536-543`) |
| No unauthorized tool discovery | PASS with a note | Bots receive only a leased `tools.execute`. The **planner** receives `Capability` descriptors (including `requiredTools`) for every registered bot that offers an allowed capability, regardless of the principal's permissions (`orchestrator.ts:224-243`). This is trusted host code (see §7) |
| Strict input and output schemas | PASS | Plans are copied then validated (`rudra/validation.ts:45-82`, `workflows/validation.ts:70-108`). Results are deep-frozen snapshots (`execute.ts` `snapshotResult`). Approvers and tools receive frozen data, so they cannot mutate an input between approval and dispatch |
| Security-context validation | PASS | Jay-minted contexts only (`jay.ts` `assertActive` keyed by the exact object). Identities are deep-frozen copies |
| Mandatory checks on every path | PASS | Every protected call goes through `Vijay.#authorized`: Jay verify, policy and permission, firewall lease, approval, Jay verify again, final `#assert`, `ensure`, then dispatch (`vijay.ts:290-351`) |
| Approvals are per attempt and never cached | PASS | Both engines re-enter `#authorized` on every attempt (probe W6: 4 attempts, 4 approvals, 4 reserved steps) |
| Retries | PASS | RUDRA retries only `bot-error`, only for a read-only effect, at most 3 (`orchestrator.ts:388-440`, `validation.ts:19-23`). The workflow retries only `tool-error`, read-only, not `NON_RETRYABLE` (`engine.ts:386-396`) |
| Budgets and reservations | PASS | The workflow reserves steps, tool calls and model budget synchronously before any `await` (`engine.ts:261-283`), so parallel branches cannot over-reserve. No refunds. Exact decimal units (`workflows/validation.ts:9-20`). RUDRA counts every approved attempt (`orchestrator.ts:301,363`) |
| Explicit allowlist for Hanuman (H03-A requirement) | **FAIL** | Both entry points default to the root capability (`rudra/validation.ts:26`, `workflows/validation.ts:36`). Probes A11 (RUDRA, H09-C replay) and W4 (workflow, this review): a run with no allowlist option completes with 1 request |
| Deterministic, ambiguity-free route binding | **FAIL** | First by ID on both paths (`orchestrator.ts:257-260`, `engine.ts:244` via `registry.ts:239-245`) |
| Shadow routing is advisory only | PASS | `runRoutingShadow` runs RUDRA first, then asks the advisor; the advisor reads only capability and bot ID from evidence (`routing.ts:217-222`); `RoutingPolicySwitch.apply` validates against the live registry and tenant (`routing.ts:791-793`) |
| Accurate SDK documentation | **FAIL** (minor) | The lockdown claim in the routing docs is conditional on an optional argument (H03RA-02) |

## 3. Verified test evidence

**Executed in this review** (all offline, Node v22.23.2, `node --test` on the existing files):

| Suites | Result |
| --- | --- |
| `hanuman-integration` | 108/108 |
| `rudra`, `workflows`, `agents` | 111/111 |
| `security`, `firewall-integration`, `firewall` | 162/162 |
| `learning-routing`, `learning-registry`, `model-cost`, `model-safety` | 116/116 |

There were no skipped, TODO or cancelled tests. The two `KNOWN GAP` cases (`S9 KNOWN GAP H03B-01` and `H03B-02`, `tests/hanuman-integration.test.mjs:932,939`) **pass by pinning the unsafe current behavior**. They are counted in these totals and in the Shabari `integration` canary, so a green run does not show that those two requirements are met.

**Mutation check of the important controls.** For each mutant I copied `dist`, `tests` and `examples` to a scratch directory outside the repository, changed one compiled expression in every compiled copy, and ran the eight relevant test files (526 tests; the unmutated control passed 526/526). Mutants were applied to ESM and CJS builds; the CJS pass needed a second regex round, so every mutant below was confirmed to patch **both** formats.

| # | Mutation | Killed by |
| --- | --- | --- |
| M1 | RUDRA retries after a state-changing effect | 2 tests (`rudra.test`) |
| M2 | RUDRA host approval accepts any truthy value | 1 test |
| M3 | Workflow retries `NON_RETRYABLE` failures | 10 tests, ESM and CJS (`hanuman-fetch`) |
| M4 | Workflow retries state-changing tools | 3 tests |
| M5 | Workflow ignores tool unregistration or replacement | 3 tests (ESM, CJS, `workflows`) |
| M6 | Workflow resume skips re-authentication | 3 tests, ESM and CJS |
| M7 | Workflow tool-call limit off by one | 4 tests |
| M8 | Workflow model-call budget off by one | 2 tests |
| M9 | RUDRA `maxSteps` off by one | 1 test |
| M10 | Vijay skips Jay re-verification after approval | 5 tests, ESM and CJS |
| M11 | Routing policy ignores firewall and provider eligibility | 2 tests (L11, L15) |
| M12 | Vijay accepts any truthy approval | 3 tests, ESM and CJS |
| M13 | Parallel batch ignores the read-only requirement | **survived**. This mutant is equivalent: the registry already rejects `parallelSafe` with a non-read-only effect (`registry.ts:56-57`), so the batch check is a redundant guard |
| M14 | Parallel batch skips the dependency check | 1 test |

That is 12 of 12 non-equivalent mutants killed. For several controls (M1, M2, M9, M11, M14) only 1 to 2 tests kill the mutant, so a regression in those controls is detectable but with little redundancy.

**False-positive and gap review:**
- The `S9 KNOWN GAP` pins are visible, but they inflate pass counts (above).
- Every `decoy` in the H03-B host sorts **after** Hanuman: the bots `zephyr` and `atlas`-as-the-only-collision, and the decoy tool `zz.decoy` (`tests/hanuman-integration.test.mjs:200,208,244`). A decoy tool that sorts first is never exercised, so first-by-ID capture on the workflow path cannot fail any existing test (probe W3 reproduces it).
- `RoutingPolicySwitch` is constructed **without** `firewall` in the S9 tests. The lockdown fallback is covered only by `learning-routing` L11, which passes a firewall view.

## 4. Findings

Severity follows the project scale. Carried findings are listed first, with what this review re-verified. New findings have IDs `H03RA-nn`.

### Carried findings (unchanged)

| ID | Sev | Status in this review |
| --- | --- | --- |
| **H03C-01** implicit allowlist | **P1** | **Reproduced** on both paths (see below) |
| H03C-02 first-by-ID bot capture | P2 | Characterized by `S9 KNOWN GAP H03B-02` (passes). Extended to the workflow path by H03RA-01 |
| H03C-03 in-flight identity-provider revocation | P2 | Not re-run. The sources involved (`vijay.ts`, `tools.ts`, `jay.ts`) are unchanged since the H03-C probe, and H09-C A14 reproduced it on the frozen artifact |
| H03C-04 deadline reported as `security-denied` | P2 | Not re-run. H09-C T14 reproduced it; sources unchanged |
| H03C-05/06/08/09 | P3 | Not re-run |

#### H03C-01 · P1 · re-verified: no explicit allowlist is required for the Hanuman capability

- **Location:** `src/agents/rudra/validation.ts:26`; `src/workflows/validation.ts:36`; and the advisor default in `src/learning/routing.ts` (`allowed = request?.allowedCapabilities ?? [capability]`).
- **Evidence:** the options code reads `input.allowedCapabilities === undefined ? [capability] : input.allowedCapabilities`.
- **Reproduction (workflow path, this review):** probe W4, `engine.start(ctx, plan, {})` with a registered `hanuman.fetch` binding gives `completed`, 1 request. For RUDRA, the H09-C replay of A11 and the pinned test `S9 KNOWN GAP H03B-01` give the same result.
- **Expected:** a side-effecting network capability needs an explicit host allowlist (H03-A).
- **Actual:** the root capability is allowlisted implicitly.
- **Impact:** one defense-in-depth layer is missing. Registration, tool grant, Vijay policy, approval and the firewall still apply, so this is not a bypass.
- **Remediation:** make eligibility explicit for protected or side-effecting capabilities, keeping the legacy default for the seven built-ins.
- **Regression test:** invert the pinned test (without an allowlist, `capability-denied` and 0 transport calls), in ESM and CJS, and add the workflow-path twin, which does not exist today.
- **Confidence:** high. **Unverified:** how hosts that rely on the legacy default for non-Hanuman protected tools would be affected.

### New findings

#### H03RA-01 · P2 · The workflow engine binds a capability to the lowest-sorting registered tool; the same capture as H03C-02, with no test

- **Location:** `src/workflows/engine.ts:244` (`this.#tools.findByCapability(action.capability)[0]`) and `src/workflows/registry.ts:239-245` (sorted by tool ID).
- **Evidence:** the engine resolves the route once, at `start()`, from the first match by tool ID. Nothing lets the host name the tool in the plan or the options.
- **Minimal reproducer:** probes W2 and W3 (`node_modules/h03rev-evidence/probes.mjs`):
  1. Bind the Hanuman tool to capability `hanuman.fetch`.
  2. Also register a read-only decoy tool `aaa.decoy` with the same capability.
  3. W2, grant only the Hanuman tool: the run is `denied` with `security-denied`, 0 Hanuman requests, 0 decoy calls. The capability is unavailable.
  4. W3, grant both tools: the run is `completed`; **the decoy executes once and Hanuman makes 0 requests**; the output is classified `untrusted`.
- **Expected:** a defined, reviewed binding for a protected network capability, or rejection of ambiguity.
- **Actual:** the ID sort order decides which provider runs.
- **Impact:** availability loss, or another host-registered tool answering the capability. It requires the host to register a colliding tool, and Vijay still checks whichever tool wins (W2). It is not a privilege escalation.
- **Remediation:** let the engine options or the plan name the tool ID, or reject more than one binding per protected capability at `start()`.
- **Regression test:** a decoy that sorts before Hanuman (for example `aaa.decoy`) in the H03-B host, on the workflow path, asserting the chosen tool and 0 decoy calls. The existing decoys cannot fail.
- **Confidence:** high (reproduced). **Unverified assumption:** that collisions are realistic in the hosts this SDK targets; the finding is consistent with H03C-02's severity.

#### H03RA-02 · P3 · The documented lockdown fallback of `RoutingPolicySwitch` depends on an optional constructor argument

- **Location:** `src/learning/routing.ts:159` (`if (env.firewall)`), `:778`; the claims at `routing.ts:766` and `docs/learning-routing.md:184-185`.
- **Evidence:** the class comment and the guide say "During firewall lockdown the hook returns null". `rejectionsFor` skips every firewall check when `options.firewall` is absent.
- **Minimal reproducer:** probe S1. A policy ordering `['zzz','aaa']` and a firewall view reporting `mode: 'lockdown'`: the switch built **with** `firewall` returns `null`; the switch built **without** it returns `'zzz'`.
- **Expected:** the documented behavior, or documentation that names the requirement.
- **Actual:** unconditional in the docs, conditional in code.
- **Impact:** low. The chosen bot is still denied by the firewall in lockdown (fail closed), so a host that forgets `firewall` gets a `security-denied` run instead of the deterministic fallback.
- **Remediation:** document the requirement. Optionally reject `apply()` of a non-empty policy when no firewall view was supplied.
- **Regression test:** a lockdown case for a switch constructed without `firewall`, asserting the documented outcome.
- **Confidence:** high.

#### H03RA-03 · P3 · RUDRA ignores `BotRegistry` changes after planning, including between retries

- **Location:** `src/agents/rudra/orchestrator.ts:220-223` (descriptors captured once) and `:375-387` (`trackedBot` built from the captured descriptor); contrast `src/workflows/engine.ts:263-266` (tool unregistration is rechecked on every attempt, `registry-changed`).
- **Evidence and reproducer:** probe R1. A planner that calls `registry.unregister('hanuman')` during planning: the run still **completes** with 1 request, and the registry no longer holds `hanuman`.
- **Expected:** consistent revocation semantics across the two engines, or documentation that bot registration is not a kill switch.
- **Actual:** the RUDRA path honors only the firewall `bots` list, Vijay and lockdown.
- **Impact:** low. Capture is intentional ("registry changes during planning cannot redirect this run"), and the firewall and Vijay still apply. A host that unregisters a bot as an emergency off switch would be surprised.
- **Remediation:** document that the firewall, not the registry, revokes. Optionally verify `registry.get(bot.id) === bot` before each attempt.
- **Regression test:** unregister the bot between attempts 1 and 2 of a retryable bot error, with the expected outcome stated.
- **Confidence:** high on the behavior; medium on whether it is a defect. **Unverified:** the original design intent.

#### H03RA-04 · P3 · The RUDRA host approval hook runs before Vijay authorizes the step

- **Location:** `src/agents/rudra/orchestrator.ts:338-361` (approval) precedes `:389-411` (`runBot`, which performs the permission check).
- **Evidence and reproducer:** probe PA. A custom planner proposes a `code.summarize` step; the principal lacks `code.run`. The RUDRA `approve` hook is called once (`s1:vishwakarma`), then Vijay denies with `security-denied`. Vijay's own approval handler is never called.
- **Expected:** approvers are asked only about steps that the principal is permitted to attempt.
- **Actual:** the approver is prompted, then the step fails.
- **Impact:** low. No dispatch occurs. It can cause approval fatigue or a misleading prompt, bounded by `maxSteps` (at most 100). It matters only for multi-step plans from a custom planner, because the root capability is authorized before planning.
- **Remediation:** check admission before the host approval, or document the order.
- **Regression test:** a step the principal cannot run must produce 0 approval prompts.
- **Confidence:** high. **Unverified:** whether H03 intended RUDRA's hook as an earlier, advisory gate.

#### H03RA-05 · P3 · After `resume()` the workflow reports `running` before it has re-authenticated

- **Location:** `src/workflows/engine.ts:495-500` (`resume` calls `state('running')`) versus `:220` (`validateTask` runs after the wake).
- **Evidence and reproducer:** probe W7. Pause, revoke at the identity provider, resume: `snapshot.status` is `running` immediately, then the run ends `denied`/`security-denied` with 0 requests.
- **Expected:** a status that does not claim execution before admission.
- **Actual:** a brief false `running`.
- **Impact:** cosmetic (no dispatch before the re-check). Monitoring UIs could mislead for a moment.
- **Remediation:** set the status after validation, or add a distinct state.
- **Regression test:** assert the status while the identity check is still pending.
- **Confidence:** medium. The H03-B test `S10 resume after revoke while paused is denied without dispatch` already covers the important property (no dispatch).

## 5. Missing negative cases

| # | Case | Why it matters |
| --- | --- | --- |
| 1 | A decoy tool sorting before `shivax.hanuman.fetch` on the workflow path | The existing decoys all sort last, so H03RA-01 cannot fail today |
| 2 | A `KNOWN GAP` twin for the workflow path without an allowlist | Only the RUDRA path has the characterization (W4 shows the same behavior) |
| 3 | `RoutingPolicySwitch` without `firewall` during lockdown | H03RA-02 |
| 4 | Bot unregistration between attempts 1 and 2 | H03RA-03 |
| 5 | A step the principal cannot run, with a RUDRA approval hook | H03RA-04 |
| 6 | Status asserted while `resume` re-authentication is pending | H03RA-05 |
| 7 | An explicit-allowlist-required case for Hanuman in the RUDRA and workflow paths (after the H03-A fix) | Closes H03C-01 |
| 8 | Mutation redundancy: M1, M2, M9, M11 and M14 are killed by 1 to 2 tests each | A single weakened test would hide a regression |

## 6. API compatibility issues

None attributable to H03. H03 added no source; the additive export set and the 13 entry points were checked in H08-C and H09-D. The only H03-relevant public typing note: the `RudraOptions.allowedCapabilities` comment says "Defaults to the request's single capability" (`rudra/types.ts:38`), which accurately documents the behavior behind H03C-01. Changing the default for protected capabilities (the fix) would be a behavior change that needs a compatibility decision.

## 7. Unverified assumptions

- Planners, routing hooks, approval handlers, observers and identity providers are trusted host code, as the documentation states. Their behavior when written by a third party or backed by a model was not tested.
- H03C-03 and H03C-04 were not re-run here. I rely on unchanged sources and the H09-C replay.
- `maxToolCalls` per bot attempt (default 32) and the bot code of other specialists were not audited for retrieval behavior.
- Probes use an in-memory transport and one tenant. The cross-tenant checks for H03 rest on the existing tests (S4.7, S10 parallel tenants, L7), which I read and spot-checked through the mutation run but did not extend.
- The mutation harness changes compiled output in a scratch copy. It shows that tests detect the changes, not that no other equivalent regression exists.

## 8. Scope limitations

- Read-only review; production code and tests were not modified, and no fixes were attempted.
- H03 only: H01 transport behavior, H04 safety checks, H07 canaries and H09 release evidence were not re-reviewed.
- One platform (Windows) and one Node major (22.23.2) for the suites and the mutation harness.
- 14 mutants, chosen from the controls named in the H03 task; this is not exhaustive.
- No wire-level network testing (the SDK ships no transport, H01D-02).

## 9. Preliminary PASS / FAIL

**FAIL for H03.**

| Aspect | Result |
| --- | --- |
| P0 | None |
| Authorization, tenant, budget and retry controls | Effective. No bypass found |
| Test strength for those controls | Good. 12 of 12 non-equivalent mutants killed in ESM and CJS |
| H03 contract: explicit eligibility (H03C-01, P1) | **Not met** |
| H03 contract: deterministic route binding (H03C-02, H03RA-01, P2) | **Not met** on either path |
| Documentation accuracy | Minor defect (H03RA-02) |
| Other open H03 findings | H03C-03, H03C-04 (P2) remain; five new P3 observations |

No change in the H03 NO-GO recorded in the [H03-C review](hanuman-h03-review.md) is warranted by this review. It adds one P2 (H03RA-01), four P3 findings and eight missing negative cases.

## Evidence and changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h03-review-a.md` | New (this report) |

Probes, the mutation harness and logs are under the ignored `node_modules/h03rev-evidence/`. The scratch copies used for mutation lived outside the repository. **REV-A stops here.**
