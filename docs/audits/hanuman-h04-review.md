# SHIVAX 0.4.0 HANUMAN · H04-C independent review of Abhimanyu and Ashwatthama

Date: 18 November 2026. Reviewed HEAD: `71954fc`. Node `v22.23.2`, Windows. Read-only review: no production or test code changed.

**Decision: H04 NO-GO.**

- **Opt-in and additive.** The checks are correctly opt-in, change nothing for existing users, and never weaken Jay, Vijay or the firewall.
- **One new P1 finding.** H04C-01: the engine's enforce-mode preflight analyzes a different snapshot of the plan from the one it executes, so the preflight decision does not bind what runs.
- **Open P2 findings.** H04B-01 (operation refs collide across tenants) and H04B-02 (a profile can declare an effect that contradicts its tool binding) remain open.
- **Gate.** Enforce mode must not be relied on until H04C-01 and H04B-02 are fixed, and the observer must not be shared across tenants until H04B-01 is fixed. The H03 release decision remains NO-GO, independently.

## Scope and method

- **Code under review.** `git diff e554fe6 71954fc -- src tests` changes only `src/workflows/`:
  - `engine.ts` (+110/−3);
  - additive types, errors and exports;
  - the new `safety/` module (`schema`, `abhimanyu`, `ashwatthama`, `index`).

  Plus two test files. Every other module is byte-identical to the H03 baseline.
- **Reports.** The H04-A implementation report, the H04-B adversarial report and the H03-C review were read but not trusted. Each claim below was checked in source or reproduced.
- **Probes.** The reproduction probes are in the ignored files `node_modules/h04c-probe*.test.mjs`, with output in `node_modules/h04c-probe.log`.
- **Catalog.** The bot-catalog workbook is not in the repository. Its two Warning Checks rows are known only from the H00 audit summary ("workflow with no exit" and "work that never terminates"); the implementation matches that intent.

## 1. Final architecture

| Requirement | Result | Evidence |
| --- | --- | --- |
| Abhimanyu is a preflight validator | ✓ | `analyzeWorkflow` and `runAbhimanyuPreflight` are pure functions of a plan, host profiles and options. They make no tool, network or timer calls. |
| Ashwatthama is a runtime observer | ✓ | `createAshwatthamaObserver` keeps an in-memory record per operation and evaluates only when the host calls `scan()`. |
| Not specialist bots | ✓ | Neither is in `src/bots/`; `createSpecialistBots` still returns the seven IDs, including `vishwakarma` (`specialists.test`, H03-B S3). |
| Existing validators reused | ✓ | `abhimanyu.ts` calls `workflows/validation.plan/settings` and `agents/rudra/validation.plan/options`; it adds no structural checks of its own. |
| No duplicate orchestration engine | ✓ | Engine integration is an optional third constructor argument. Scheduling, retries and pause are unchanged. |
| No new process manager | ✓ | No `child_process`, `process.kill` or `exit`, timers or network modules in `safety/` (static guard in the adversarial suite). The observer's only action is calling a host-registered `cancel` once. |
| Opt-in | ✓ | Without `safety` the engine skips every hook. Every observer call is wrapped in try/catch. Preflight runs only when configured and not `disabled`. |

**One architectural defect: preflight and execution take separate snapshots (H04C-01).** `engine.start()` calls `analyzeWorkflow(this.#preflight, proposal, …)` and then separately `validated = plan(proposal, …)`. Each takes its own snapshot of the untrusted proposal, so a proposal that answers differently on different reads gets a decision about one plan and executes another.

## 2. Abhimanyu rule coverage

| Required detection | Rule(s) | Verified by |
| --- | --- | --- |
| Missing bounded exit strategy | `ABH_NO_EXIT_PATH`, `ABH_UNBOUNDED_DEADLINE` | A-N7, A-N8, A-N10 |
| Unhandled failure paths | `ABH_MISSING_COMPENSATION` (later fallible work after a commit), `ABH_UNREACHABLE_COMPLETION` | A-N1, A-N3, A-N5 |
| Unsafe protected side effects | `sideEffect: 'protected'` gating; enforce mode assumes the least-safe value for omissions | A-N10, M1 and M2 regressions |
| Missing cleanup declaration | `ABH_MISSING_CLEANUP` (insufficient-metadata if omitted, confirmed if `'none'`) | A-N2, A-P9 |
| Missing compensation | `ABH_MISSING_COMPENSATION`; `ABH_INVALID_DECLARATION` for an unusable compensator | A-N3, A-N5, H04-A tests |
| Irrecoverable pause/resume | `ABH_RESUME_UNSAFE` (only when `pausable`) | A-N6 |
| Retry exhaustion | `ABH_UNBOUNDED_RETRY`, `ABH_RETRY_SIDE_EFFECT`, retries counted in `ABH_DEADLINE_INFEASIBLE` | A-N4, A-N9 |

**Confirmed vs unknown is distinguished correctly.**
- Omitted metadata is reported as `insufficient-metadata` or `potential`, never `confirmed`.
- In enforce mode it blocks only through `assumedWorstCase`, which the evidence records.
- No rule claims host cleanup is missing when it is merely undeclared.

**False negatives.**
- **Proxy/TOCTOU path:** H04C-01.
- **Effect taken on trust:** a profile `effect` that contradicts the live binding is believed (H04B-02).
- **Durations exclude waits:** deadline feasibility ignores approval wait time and firewall queueing, because only declared durations are summed. This is an estimate, as documented, not a defect.

**False positives.** In enforce mode (with `requireDeclarations` on by default), any action without a profile is analyzed as a protected state change and blocked through `ABH_NO_EXIT_PATH`, even a pure computation. This is intentional (M2) and explicit, but a legitimate workflow using an unprofiled pure capability will be blocked until it is declared `sideEffect: 'none'` (§5).

## 3. Ashwatthama rule coverage

| Required behavior | Result | Evidence |
| --- | --- | --- |
| Lease tracking | ✓ Expiry is strict (`>`). Renewal is refused once expired, released, completed or cancelled, and never extends past the deadline. | W-N1, W-N6, the exact-instant race test |
| Deadline checks | ✓ Strict comparison against the deadline. Long deadlines need an approval reference or a host cap. | W-N13, W-P1 |
| Cancellation observation | ✓ First request time kept; host cancel invoked at most once. ✗ A request arriving after completion becomes a high-severity `CANCEL_STUCK` (H04B-04). | W-N2, W-N8 |
| Progress and heartbeat | ✓ Reported only when heartbeats were declared; silence up to exactly 2× the interval is tolerated; paused operations are exempt. | W-N4, W-N7, W-P1 |
| Cleanup acknowledgement | ✓ `CLEANUP_UNACKNOWLEDGED` (potential), `COMPLETION_UNACKNOWLEDGED`, `CLEANUP_FAILED_REPEATEDLY` | W-N3, W-N10 |
| Stale operations and restart | ✓ Old handles are inert after `dispose`; a handle from another observer cannot become a parent. | W-N11 |
| Duplicate events | ✓ First terminal status and first acknowledgement win; late progress and renewal are ignored. | Race fixtures |
| Runtime bounds | ✓ Operations, history and warnings are capped. ✗ The per-scope untracked counter map is not bounded (H04C-04), and truncation hides the tracking-limit signal (H04B-05). | Probe P4 |
| Evidence, not elapsed time | ✓ Every rule needs a lifecycle fact: a declared deadline, lease, heartbeat, cancellation request, terminal event or acknowledgement. W-N4 shows a quiet job without heartbeats is reported only at its deadline. | W-N4, W-P1 |

## 4. Warning code registry

Every rule is at version 1, with static remediation text.

**Abhimanyu (14 rules)**

| Rule | Severity | Certainty used | Enforced by default |
| --- | --- | --- | --- |
| `ABH_INVALID_PLAN` | high | confirmed | ✓ |
| `ABH_UNREACHABLE_COMPLETION` | high | confirmed | ✓ |
| `ABH_MISSING_PROFILE` | medium | insufficient-metadata | |
| `ABH_NO_EXIT_PATH` | high | confirmed / potential / insufficient-metadata | ✓ |
| `ABH_UNBOUNDED_DEADLINE` | medium | insufficient-metadata / potential | |
| `ABH_DEADLINE_INFEASIBLE` | medium | potential | |
| `ABH_UNBOUNDED_RETRY` | high | confirmed | ✓ |
| `ABH_RETRY_SIDE_EFFECT` | high | confirmed / potential | ✓ |
| `ABH_MISSING_CLEANUP` | medium | confirmed / insufficient-metadata | |
| `ABH_MISSING_COMPENSATION` | medium | potential / insufficient-metadata | |
| `ABH_RESUME_UNSAFE` | medium | potential / insufficient-metadata | |
| `ABH_INVALID_DECLARATION` | high | confirmed | ✓ |
| `ABH_ANALYSIS_TRUNCATED` | medium | insufficient-metadata | |
| `ABH_ENFORCEMENT_RELAXED` | medium | confirmed | (never blocks) |

**Ashwatthama (9 rules)**

| Rule | Severity | Certainty used | Enforced by default (cooperative cancel) |
| --- | --- | --- | --- |
| `ASH_LEASE_EXPIRED` | high | confirmed | ✓ |
| `ASH_DEADLINE_EXCEEDED` | high | confirmed | ✓ |
| `ASH_HEARTBEAT_MISSED` | medium | potential | |
| `ASH_CANCEL_STUCK` | high | confirmed | |
| `ASH_OPERATION_ORPHANED` | high | confirmed | |
| `ASH_COMPLETION_UNACKNOWLEDGED` | medium | confirmed | |
| `ASH_CLEANUP_UNACKNOWLEDGED` | medium | potential | |
| `ASH_CLEANUP_FAILED_REPEATEDLY` | high | confirmed | |
| `ASH_TRACKING_LIMIT` | medium | confirmed | |

The severities fit their impact: a definite loss of control is high, missing metadata is medium. The catalog is frozen, and `validateSafetyWarning` checks rule, version, validator, severity and remediation against it.

## 5. False-positive assessment

Covered and passing:
- an approved long-running task (two hours under a one-hour host cap);
- heartbeat-based operations;
- valid lease renewal, including at the exact expiry instant;
- graceful cooperative cancellation;
- bounded retries, including idempotent state-changing retries;
- verified compensation;
- paused workflows (heartbeat suppressed; the engine's pause mirrored);
- parallel join;
- delayed cleanup or audit inside the acknowledgement window;
- 20 concurrent operations for 50 simulated minutes.

All produce zero warnings (H04-B W-P1–P8 and A-P1–P10).

Legitimate workflows that would still be **blocked** or **wrongly warned**:

| Case | Mode | Behavior | Assessment |
| --- | --- | --- | --- |
| Unprofiled pure or local capability | enforce | Blocked (assumed protected) | Intentional fail-closed behavior; remedy is a one-line `sideEffect: 'none'` profile. Document it as an adoption step. |
| A profile that omits `cancellation` but has verified cleanup | enforce | Allowed | Correct: verified cleanup is a valid exit |
| A cancellation request after a normal completion | any | High-severity `ASH_CANCEL_STUCK` | **False positive** (H04B-04) |
| A disabled observer | — | Still emits warnings | **False positive** (M5) |
| Engine runs whose deadline exceeds observer `maxDeadlineMs` | — | Unobserved | Not reachable with defaults: tasks are capped at 300,000 ms (`agents/validation.ts` `limits`) and the observer default is 900,000 ms. It occurs only if a host lowers the observer cap below its task deadlines. The H04-A report and the DX research matrix (M6) overstate this. |

## 6. Performance and resource assessment

Measured with `performance.now()` on this machine in a single run each (probe P3). These are indicative, not benchmarks.

| Workload | Result |
| --- | --- |
| Preflight, 100 actions, each depending on all earlier ones (≈4,950 edges), full profiles | **3.5 ms** per evaluation (mean of 20), depth 100, 0 warnings |
| Preflight, the same plan without profiles | 100 warnings, bounded by `maxWarnings` |
| Observer `begin` × 4,096 | **7.2 ms** |
| `scan` of 4,096 expired operations | **2.0 ms** (warnings capped at 64 by default) |
| `complete` + `cleanup` × 4,096 (retire) | **17.5 ms**. `retire` scans all active records for unsettled children, so the cost is O(n²) in tracked operations; acceptable at the 4,096 cap. |
| Heap for 4,096 tracked operations with lease and heartbeat | ≈ **5.8 MB** (≈1.4 KB each) |
| 10,000 distinct tenants overflowing the cap | `status().untracked = 10,000`; the per-scope map holds 10,000 entries until each scope is scanned (**H04C-04**) |

Algorithmic bounds:
- Preflight is linear in actions plus dependency edges (≤ 100 × 100) after the existing validator's bounded snapshot.
- `scan` is O(tracked).
- History uses `shift()` (O(n) per eviction, bounded by `maxHistory` ≤ 4,096).

**Timers and listeners.** The safety module adds no timers. The engine adds one abort listener per run, with `{ once: true }`, on the per-run controller, which is collected with the run.

**After host shutdown.** `dispose()` clears records, callbacks and the scope map, and later calls are inert.

**Retained memory.** A tracked operation keeps its host `cancel` closure until it retires. For engine runs that closure keeps the run's internal state reachable, including outputs, but only while the operation is unsettled. It is never exposed.

## 7. Security findings

Confirmed, in source and in tests:
- **Jay and Vijay remain authoritative.** A passing or relaxed preflight still needs approval and the tool grant.
- **The firewall still wins.** Lockdown overrides an allowing preflight and an enforcing observer.
- **No permission is granted.** A state fingerprint of permissions, scope, grants, policies, tools and firewall is unchanged.
- **Tenant isolation holds.** `scan`, `list`, `history`, `cancel` and parent linkage are scoped to one tenant.
- **No process control.** The observer never terminates processes or touches the firewall.
- **No execution from payloads.** Metadata, evidence and policies reject functions, accessors, prototype keys and non-finite numbers.
- **No secrets in records.** Records hold no session or principal data.

Weaknesses:
- **TOCTOU (H04C-01).** The enforce-mode preflight decision can be decoupled from the executed plan.
- **Cross-tenant ref collision (H04B-01).** Refs collide across tenants: an existence oracle and a way to block another tenant's refs.
- **Untrusted text in evidence (H04B-03).** An untrusted plan capability is echoed into evidence, bounded to 128 characters of `[A-Za-z0-9._:-]`.

## 8. Test evidence

All runs were offline with the project's pnpm settings. Logs are in `node_modules/h04c-*.log`.

| Command | Result |
| --- | --- |
| `node --test tests/workflow-safety.test.mjs` (run on its own) | **50 / 50** |
| `node --test tests/workflow-safety-adversarial.test.mjs` (run on its own) | **104: 92 pass, 0 fail, 12 todo** (H04B-01…05 and M5, each in ESM and CJS) |
| Compatibility: `workflows`, `rudra`, `agents`, `specialists`, `security`, `firewall`, `firewall-integration`, `hanuman-fetch`, `hanuman-bot`, `hanuman-integration`, `learning-routing`, `learning-registry`, `learning`, `package`, `sdk` | **740 / 740** |
| H04-C probes (TOCTOU, observer policy, performance, scope map) | Ran; results above |
| `pnpm lint` | PASS |
| `pnpm test` | **1,429: 1,417 pass, 0 fail, 12 todo**, 0 cancelled or skipped |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS: ESM/CJS export parity, browser-safe graphs, 13 declaration entries × 5 modes, 544 files |

**Test-quality review of the H04-B fixtures.**
- They use the real validators and the real engine, with real Jay, Vijay and firewall in the non-interference test. Mocks are limited to the transport-free tool, identity and clock.
- Each fixture asserts the exact rule, severity, certainty, disposition, subject and evidence, plus the complete warning list, and deduplication is checked.
- Positive and negative cases are paired.
- Races are deterministic thanks to injected clocks.
- Secret-like evidence and tenant isolation are asserted.
- Defects are kept as `todo` with the correct assertion, not weakened.

**Gaps.**
- No fixture covers H04C-01 (an inconsistent proposal).
- No fixture covers silent relaxation in the observer (H04C-02).
- The engine-level race tests use one action each.
- There is no concurrent-runs test on a shared observer.

## 9. Findings

H04-C findings are new. H04-B findings are re-confirmed here.

| ID | Sev | Source | Reproduction | Expected | Actual | Remediation | Required regression |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **H04C-01** | **P1** | `src/workflows/engine.ts` `start()`: preflight on `proposal`, then a separate `plan(proposal)` snapshot | Proposal action is a `Proxy` whose `capability` reads `read` 3 times, then `risky`. Engine has enforce-mode preflight (`risky` = no exit). `node_modules/h04c-probe2.test.mjs` FLIP4. | Preflight decides on exactly the plan that executes; an unsafe executed plan is blocked | `preflight: allow`, then the engine executes the `risky` tool (1 call). Flipping earlier (reads 1–3) is blocked, which proves the two snapshots differ. | Snapshot and validate the proposal once (`plan()`), run `analyzeWorkflow` on that frozen snapshot, and execute the same object. Vijay authorization is unaffected. | A Proxy or inconsistent proposal: preflight and execution see the same plan; FLIP1–4 all blocked or all allowed consistently; zero tool calls when blocked |
| **H04B-01** | P2 | `src/workflows/safety/ashwatthama.ts` `begin` (`active` keyed by `ref`) | Tenant A `ref: 'job-42'`, then tenant B `begin` with the same ref | Tenants are independent | B gets `invalid-input`: an existence oracle and a way to block A | Key by scope and ref; look up within the scope; unguessable generated refs | The existing `todo` W-N12b turns to pass |
| **H04B-02** | P2 | `src/workflows/safety/abhimanyu.ts` `effectOf` | A profile declares `effect: 'read-only'` for a capability bound `state-changing`, with retries and later steps | `ABH_INVALID_DECLARATION`, blocked | Allowed with no warnings; the compensation and retry checks are suppressed | Compare with the binding; report a confirmed invalid declaration; analyze with the stricter effect | The existing `todo` A-N11 turns to pass |
| **H04C-02** | P3 | `src/workflows/safety/ashwatthama.ts` (`resolvePolicy` result unused for reporting); `schema.ts` | Observer `{ mode: 'enforce', relaxRules: ['ASH_DEADLINE_EXCEEDED', 'ASH_LEASE_EXPIRED'] }` (probe P2) | Relaxing enforcement is visible, as in Abhimanyu (`ABH_ENFORCEMENT_RELAXED`) | Enforce mode silently enforces nothing; no warning or status field. `blockUncertain` is accepted on the observer and ignored. | Expose `relaxedRules` in `status()` or an observer warning; reject `blockUncertain` for the observer | Observer relax test asserting the visible signal; `invalid-policy` for `blockUncertain` |
| **H04C-04** | P3 | `ashwatthama.ts` `untrackedByScope` | 10,000 distinct scopes overflow `maxOperations: 1` (probe P4) | All observer state bounded | One map entry per distinct overflowing scope until that scope is scanned | Cap the map (fold overflow into a single global counter), or clear it on `status()` | Bounded-size test with many scopes |
| **H04B-03** | P3 | `abhimanyu.ts` (`UNREACHABLE_COMPLETION` evidence) | Capability not allowlisted, `sk-live-…` | Untrusted plan text not echoed | Echoed (bounded) | Use `null` for capabilities that are not allowlisted | Existing `todo` A-N12 |
| **H04B-04** | P3 | `ashwatthama.ts` `requestCancellation` | Complete, then request cancellation | `CLEANUP_UNACKNOWLEDGED` (medium) | `CANCEL_STUCK` (high) | Ignore cancellation after completion | Existing `todo` |
| **H04B-05** | P3 | `ashwatthama.ts` `scan` | Warnings at the cap | A tracking-limit or truncation signal | Silently withheld | Reserve a slot and add a truncation flag | Existing `todo` |
| **M5** | P3 | `ashwatthama.ts` `scan` | Disabled observer | No warnings | Warnings | Honor `disabled` | Existing `todo` |
| **H04C-05** | P3 | `docs/audits/hanuman-h04-implementation.md` §10; DX research doc M6 | — | Accurate limitation | Says overlong engine deadlines leave runs unobserved by default. Impossible with defaults: tasks are capped at 300,000 ms. | Restate as "only when a host lowers the observer `maxDeadlineMs` below its task deadlines" | — |

Also still open from the DX research matrix: M4 (`blockUncertain` silently ignored in warn mode) and M9 (verification is attestation only), both P3.

## 10. Remaining limitations

- Declarations are attestations. Neither check can inspect host adapters.
- Feasibility is an estimate from declared maxima.
- The observer is in-memory, per process, with no persistence or cross-process view.
- Only `RudraWorkflowEngine` is wired. RUDRA bot runs need host wiring, and RUDRA exposes no ownership-release signal.
- Stuck work is detected, never terminated; terminating a worker is the host's job.
- The enforce-mode `cancel` is cooperative and cannot stop a non-cooperative tool.

## 11. H04 GO / NO-GO

**NO-GO.**

- **Blocking:**
  - **H04C-01 (P1):** the preflight decision is not bound to the executed plan.
  - **H04B-02 (P2):** an enforce-mode false negative through a contradictory effect declaration.
  - **H04B-01 (P2):** cross-tenant ref interference in a shared observer.
- **Warn mode alone is acceptable to pilot.** It cannot block, and Jay, Vijay and the firewall remain authoritative. Use only with trusted, plain-object proposals and one observer per tenant.
- **To reach GO:**
  1. Fix H04C-01, H04B-02 and H04B-01, with regression tests (the existing `todo` fixtures plus a TOCTOU fixture).
  2. Schedule the P3 findings.
  3. Re-run H04-B and H04-C.
- **H03 is unchanged.** The H03 NO-GO findings (H03C-01, H01D-02, H03C-03, H03C-04) still block the 0.4.0 release independently of H04.

**Changed paths in this phase:**
- `docs/audits/hanuman-h04-review.md` (new);
- `docs/audits/hanuman-h04.md` (new phase summary).

Probes and logs are in ignored `node_modules/h04c-*` files. Nothing was committed, pushed, tagged or published. Work stops after H04-C.
