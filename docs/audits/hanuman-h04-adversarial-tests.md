# SHIVAX 0.4.0 HANUMAN · H04-B adversarial test report

Date: 17 November 2026. Baseline: `c97523f` (H04-A plus the M1–M3 fixes). Node `v22.23.2`, Windows. Test-only phase: no production code changed.

**Gate: PASS with documented defects.** The suite has 104 tests (52 test cases, some grouping several fixtures, each run in ESM and CJS). 92 pass and 0 fail.

Twelve tests are `todo`. They are six defect fixtures, run in both module formats; each keeps its correct assertion and fails as expected until the defect is fixed:

| Finding | Severity | Status |
| --- | --- | --- |
| H04B-01 | P2 | New |
| H04B-02 | P2 | New |
| H04B-03 | P3 | New |
| H04B-04 | P3 | New |
| H04B-05 | P3 | New |
| M5 | — | Known from the DX research matrix |

No authorization bypass or cross-tenant data exposure was found. The checks never weakened Jay, Vijay or firewall enforcement. The H03 NO-GO findings are outside this phase and unchanged.

New file: `tests/workflow-safety-adversarial.test.mjs`. It covers the real `AutonomousWorkflowPlan` and RUDRA plan schemas only. The schema has no conditional branches, so "branch" fixtures are modeled as parallel siblings and as dependent actions after a commit. The suite uses:
- injected clocks;
- a fake host: a mock Jay provider whose sessions can be revoked, Vijay with approval, an optional NARASIMHA firewall, and one workflow tool;
- a `process.kill` spy, asserted at zero calls.

## 1. Fixture matrix

| Threat area | Fixtures | Validator |
| --- | --- | --- |
| Unsafe workflow topology | A-N1 unreachable completion (not allowlisted, unbound, deadline infeasible) · A-N8 sibling that outlives the terminal state · A-N9 parallel partial failure on the critical path | Abhimanyu |
| Failure-path omissions | A-N3 missing compensation · A-N5 two commits before a fallible step · A-N6 irrecoverable pause | Abhimanyu |
| Protected effects without cleanup | A-N2 cleanup `none` · A-N7 cancellation ignored with no cleanup · A-N10 missing exit metadata | Abhimanyu |
| Retry and deadline interactions | A-N4 unbounded and side-effecting retries · A-N1 and A-N9 retries counted in feasibility | Abhimanyu |
| Declaration integrity | A-N11 profile effect contradicts the binding (**H04B-02**) · A-N12 untrusted plan text in evidence (**H04B-03**) | Abhimanyu |
| Lifecycle observation races | Completion vs cancellation (**H04B-04**) · lease boundary · dispose inside a callback · duplicate terminal events · late progress · engine timeout vs cleanup · resume after revocation · host shutdown | Ashwatthama and engine |
| False positives | A-P1–P10 · W-P1–P8 · W-N4 (silence without declared heartbeats) | Both |
| Scope isolation | W-N12 · W-N12b (**H04B-01**) · scope spoofing · enforce-mode cancel limited to one tenant | Ashwatthama |
| Resource exhaustion | Oversized, overly large and deeply nested or cyclic plans · 5,000 operations against a 4,096 cap · warning caps · tracking-limit visibility (**H04B-05**) | Both |
| Policy behavior | Disabled, warn and enforce · high-impact rules · invalid and conflicting configuration · deduplication · repeated evaluation · disabled observer (**M5**) | Both |
| Security non-interference | Engine with firewall: relaxed preflight, missing grant, lockdown, state fingerprint · static import scan | Both |

**Assertion standard.** Each fixture asserts the exact rule ID, severity, certainty, disposition, subject index or reference, and the relevant evidence fields, using `expectWarning` and `one()`. Each also asserts the complete list of warnings for the report or scan, so unexpected extra warnings fail. `unique()` checks deduplication by rule and subject. No assertion accepts "some warning was emitted".

## 2. Positive cases (Abhimanyu: no false positives)

| Fixture | Warn | Enforce |
| --- | --- | --- |
| P1 Successful exit | none | allow |
| P2 Bounded failure exit (2 retries, deadline fits) | none | allow |
| P3 Explicit cooperative cancellation with cleanup `none` | only `ABH_MISSING_CLEANUP` (medium) | allow |
| P4 Host-verified cleanup with cancellation ignored | none | allow |
| P5 Verified compensating action, allowlisted and profiled | none | allow |
| P6 Pause and resume with verified resume recovery | none | allow |
| P7 Bounded idempotent retries on a state change | none | allow |
| P8 Parallel join (`dependsOn`, `maxParallel: 2`) | none | allow |
| P9 Minimal metadata | `insufficient-metadata` only: never `confirmed`, never `blocked` | — |
| P10 The P8 plan in the engine under enforce-mode preflight | report `allow`; run completes | — |

No positive fixture produced a high-severity warning.

## 3. Negative cases

**Abhimanyu.** Each row is the complete warning list for the fixture.

| Fixture | Rule · severity · certainty · disposition (enforce) |
| --- | --- |
| A-N1 not allowlisted | `ABH_UNREACHABLE_COMPLETION` · high · confirmed · blocked · index 1 · `reason: not-allowlisted` |
| A-N1 unbound | same rule · `reason: unbound` |
| A-N1 deadline infeasible | `ABH_DEADLINE_INFEASIBLE` · medium · potential · reported · `requiredMs` 6000 > 5000 |
| A-N2 | `ABH_MISSING_CLEANUP` · medium · confirmed · reported; `blocked` with `enforceRules: ['ABH_MISSING_CLEANUP']` |
| A-N3 | `ABH_MISSING_COMPENSATION` · medium · insufficient-metadata (omitted) or potential (`none`) · `laterActions` 1 |
| A-N4 | `ABH_UNBOUNDED_RETRY` · high · confirmed · blocked (no deadline estimate invented) · `ABH_RETRY_SIDE_EFFECT` · high · confirmed · blocked |
| A-N5 | `ABH_MISSING_COMPENSATION` at index 0 (`laterActions` 2) and index 1 (`laterActions` 1) |
| A-N6 | `ABH_RESUME_UNSAFE` · medium · potential, only when `pausable` |
| A-N7 | `ABH_NO_EXIT_PATH` · high · confirmed · blocked, reported once (no duplicate `MISSING_CLEANUP`) |
| A-N8 | `ABH_NO_EXIT_PATH` on the sibling only (index 1) |
| A-N9 | `ABH_DEADLINE_INFEASIBLE` · `requiredMs` 2200 on the parallel critical path, 6200 sequential (the read-only join is retried too); depth 2 |
| A-N10 | enforce: `ABH_NO_EXIT_PATH` · high · insufficient-metadata · blocked · `assumedWorstCase`; warn: `ABH_MISSING_CLEANUP` · insufficient-metadata · reported, with nothing assumed |

**Every negative plan passes the existing structural validators** (no `ABH_INVALID_PLAN`). Acyclicity alone is not treated as safety.

**Ashwatthama.** Each row is the complete scan result.

| # | Fixture | Result |
| --- | --- | --- |
| W-N1 | Expired lease | `ASH_LEASE_EXPIRED` · high · confirmed · `overdueMs` 1; record `expired` |
| W-N2 | Cancellation ignored past the grace period | None at the window edge; at +1 ms `ASH_CANCEL_STUCK` · high · confirmed · `waitedMs` 1001 |
| W-N3 | Missing completion acknowledgement | `ASH_COMPLETION_UNACKNOWLEDGED` · medium · confirmed |
| W-N4 | Abandoned job | Reported only by declared heartbeat or deadline evidence, never by duration alone |
| W-N5 | Orphaned child | `ASH_OPERATION_ORPHANED` · high · confirmed · `parentRef`; parent retained while the child is unsettled |
| W-N6 | Renewal after expiry | Refused (`false`); the expiry stands |
| W-N7 | Heartbeat lost | Silence of exactly 2× the interval tolerated; +1 ms gives `ASH_HEARTBEAT_MISSED` · medium · potential |
| W-N8 | Duplicate cancellation | First request time kept; `cancel()` true then false; host callback invoked once |
| W-N9 | Late completion after timeout | The deadline warning clears; history shows `completedAt` > `deadlineAt` |
| W-N10 | Cleanup never acknowledged | `ASH_CLEANUP_UNACKNOWLEDGED` · medium · potential |
| W-N11 | Observer restart | Old handles are inert; the new observer starts clean; a stale handle cannot adopt a new operation of the same generated ref |
| W-N12 | Cross-tenant reference | Invisible to `scan`, `list` and `history`; `cancel` refused; parenting across tenants refused |
| W-N12b | Same ref in another tenant | **H04B-01** (todo) |
| W-N13 | Deadline exceeded | None at the deadline; `ASH_DEADLINE_EXCEEDED` · high · confirmed · `overdueMs` 250 |

## 4. False-positive results (Ashwatthama)

W-P1–P8 run 50 simulated minutes and scan every minute. All of these produce **zero warnings** throughout:
- a two-hour job with its own approval reference, under a host-configured one-hour cap;
- frequent heartbeats;
- valid lease renewals;
- cooperative cancellation with graceful cleanup;
- a paused workflow whose heartbeats are suppressed while paused;
- a completion whose cleanup or audit arrives a minute later, inside a configured 2-minute window;
- 20 authorized concurrent operations.

An unapproved overlong deadline is refused when the operation begins, rather than tracked and later reported. Long runtime alone is never a warning: W-N4 shows a quiet job without declared heartbeats is reported only at its deadline.

## 5. Race-condition findings

| Race | Result |
| --- | --- |
| Completion vs cancellation (cancel first) | Correct: no warnings; final status `cancelled` |
| Cancellation requested **after** completion | **H04B-04**: reported as high-severity `ASH_CANCEL_STUCK` instead of `ASH_CLEANUP_UNACKNOWLEDGED` |
| Lease expiry vs renewal at the exact instant | Renewal at expiry is valid; 1 ms later it is refused and warned. Deterministic. |
| Observer disposed inside its own `onWarning` | No throw; later calls are inert; status reads zero |
| Duplicate terminal events, late progress, double cleanup | First terminal status, first acknowledgement time and the last real progress time all win; later events are ignored |
| Engine timeout vs tool cleanup | Run `failed`; once the cooperative tool settles, both records are acknowledged with no warnings |
| Resume after permission revocation | `denied` with zero tool calls; the observer record is `denied` and released |
| Host shutdown (`engine.dispose`) | `cancelled`; observer tracking drops to 0 |
| Observer disposed mid-run | The engine run still completes |

## 6. Security findings

- **No bypass.** In the non-interference test (engine plus firewall), the preflight relaxes two default rules (`relaxRules`) and the observer runs in enforce mode. Even so:
  - The tool still needed Vijay approval.
  - A context without the tool grant was `denied`.
  - Firewall lockdown still stopped the run.
  - The tool ran exactly once, for the one authorized run.
- **No state change.** A fingerprint of principal permissions, tenant scope, context grants, policies, registered tools and firewall state was identical before and after. The only exception was the lockdown the test itself performed.
- **Bounded data handling.**
  - Oversized (101 actions or above the byte cap), 40-level nested and cyclic plans fail closed as `ABH_INVALID_PLAN`.
  - 5,000 operations against a 4,096 cap give 4,096 tracked and 904 untracked; a scan returns at most 256 unique warnings; caps above the hard limits are rejected.
- **Malicious or model-generated metadata is rejected without being invoked.** This covers:
  - `__proto__`, `constructor` and `toJSON` keys;
  - function values and accessors;
  - shell-like or overlong identifiers;
  - non-finite numbers and over-limit profile counts.
- **Malformed warnings are rejected.** Unknown or prototype rule IDs (`constructor`, `__proto__`, `toString`), executable or non-finite evidence, bearer-like strings and nested evidence all fail validation.
- **Scope spoofing is refused.** Accessor scopes, extra scope fields, string scopes, non-tenant kinds, bearer- or password-like refs, payload fields and non-function `cancel` values are all rejected.
- **A broken clock fails loudly** (`invalid-input`) instead of producing false timestamps. A rejected lease renewal changes nothing.
- **Static guard.** The safety sources contain no `child_process`, `process.kill`/`exit`, network modules, `fetch`, timers, firewall runtime or admin access, SARASWATI `learning/` imports, or `PermissionPolicyRegistry`. The `process.kill` spy recorded 0 calls.

## 7. Exact tests executed

All runs were offline with the H03 pnpm settings. Logs are in `node_modules/h04b-*.log`.

```powershell
node --test tests/workflow-safety-adversarial.test.mjs        # 3 runs
node --test tests/workflow-safety-adversarial.test.mjs tests/workflow-safety.test.mjs tests/workflows.test.mjs tests/rudra.test.mjs tests/agents.test.mjs tests/security.test.mjs tests/firewall.test.mjs tests/firewall-integration.test.mjs tests/firewall-management.test.mjs tests/firewall-model-integration.test.mjs tests/hanuman-fetch.test.mjs tests/hanuman-bot.test.mjs tests/hanuman-integration.test.mjs tests/learning.test.mjs tests/learning-routing.test.mjs tests/learning-registry.test.mjs tests/learning-governance.test.mjs tests/learning-worker.test.mjs tests/intelligence.test.mjs tests/model-cost.test.mjs
pnpm lint
pnpm test
pnpm build
pnpm verify:package
```

What the regression set covers:
- the existing workflow, RUDRA, timeout, cancellation and pause tests;
- `ToolLease` (`security.test`);
- the NARASIMHA firewall suites;
- Hanuman H01, H02 and H03;
- SARASWATI learning, routing, registry and governance;
- the model router and cost suites.

## 8. Pass/fail counts

| Command | Result |
| --- | --- |
| Adversarial suite (3 runs) | 104 tests: **92 pass, 0 fail, 12 todo**, the same each run |
| Regression set (20 files) | 1,054 tests: **1,042 pass, 0 fail, 12 todo**, 0 cancelled or skipped |
| `pnpm lint` | PASS |
| `pnpm test` | 1,429 tests (1,325 before plus 104): **1,417 pass, 0 fail, 12 todo** |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS (544 files) |

Development found two mistakes in my own fixture expectations, and I corrected both:
- A-N9 omitted the retry of the read-only join step.
- W-P1 used an unapproved one-hour deadline, which the observer correctly refuses.

Neither needed a production change, and no production assertion was relaxed.

## 9. Remaining defects

Each defect has a preserved `todo` fixture that will start passing when the fix lands. Remove `todo` at that point.

| ID | Severity | Source | Reproduction | Expected / actual | Recommended correction |
| --- | --- | --- | --- | --- | --- |
| **H04B-01** | P2 | `src/workflows/safety/ashwatthama.ts` (`begin`: `active` keyed by `ref` alone; `if (active.has(ref)) fail(...)`) | Tenant A begins `ref: 'job-42'`; tenant B's `begin` with the same ref throws `invalid-input` | Tenants should be independent. Instead, tenant B learns that tenant A's ref exists, and can block A by claiming refs first. The global `op-<n>` sequence also reveals other tenants' activity (related to M7). | Key active records by `scopeKey + ref`, look up `cancel` and parents within the scope, and use unguessable generated refs |
| **H04B-02** | P2 | `src/workflows/safety/abhimanyu.ts` (`effectOf`: the profile `effect` overrides the bound tool's effect) | A profile declares `read-only` for a capability bound `state-changing`, with retries and later actions | Expected `ABH_INVALID_DECLARATION` (blocked). Actually `allow` with no warning, which hides the compensation and retry-side-effect checks. | When a live binding exists and differs, report `ABH_INVALID_DECLARATION` (confirmed) and analyze with the stricter effect |
| **H04B-03** | P3 | `abhimanyu.ts` (`ABH_UNREACHABLE_COMPLETION` evidence `capability`) | A plan with capability `sk-live-0123456789abcdef` (not allowlisted) | Expected no untrusted plan text in warnings. Actually the string is echoed into evidence (bounded to 128 characters of `[A-Za-z0-9._:-]`). | Emit `capability: null` for capabilities that are not allowlisted, or a fixed marker |
| **H04B-04** | P3 | `ashwatthama.ts` (`requestCancellation` accepted after `complete`) | `complete('completed')` then `requestCancellation()`, then 2 s pass | Expected `ASH_CLEANUP_UNACKNOWLEDGED` (medium, potential). Actually `ASH_CANCEL_STUCK` (high, confirmed). | Ignore cancellation requests after completion, or only count `CANCEL_STUCK` when cancellation came before completion |
| **H04B-05** | P3 | `ashwatthama.ts` (`scan`: `ASH_TRACKING_LIMIT` appended only while under `maxWarnings`) | 12 operations against a cap of 10, all expired, with `maxWarnings` 10 | Expected the scan to show that tracking or warnings were cut off. Actually the warnings are silently truncated and the limit signal is withheld. | Reserve a slot for `ASH_TRACKING_LIMIT` and a truncation indicator, as Abhimanyu's `ABH_ANALYSIS_TRUNCATED` does |
| **M5** | Known | `ashwatthama.ts` (`scan` ignores `mode: 'disabled'`) | A disabled observer is scanned after a deadline passes | Expected nothing; actually `ASH_DEADLINE_EXCEEDED` | Return no warnings in disabled mode |

Still open from the DX research matrix and not exercised as failures here: M4 (`blockUncertain` is silently accepted in warn mode), M6 (an overlong engine deadline leaves the run unobserved), M7 (guessable refs; see H04B-01) and M9 (verification is an attestation only).

## 10. Test gate

- **H04-B adversarial test gate: PASS.** All 92 executable assertions pass and nothing fails. Every defect found is preserved as a `todo` fixture with its correct assertion and a finding ID, without weakening the check.
- **H04 remediation needed:** H04B-01 and H04B-02 (P2) before any multi-tenant or enforce-mode deployment of the safety checks; H04B-03, -04, -05 and M5 (P3) can be scheduled.
- **H03 NO-GO is unchanged.**

**Changed paths:** `tests/workflow-safety-adversarial.test.mjs` (new) and this report. No production code changed. Nothing was committed, pushed, tagged or published. Work stops after H04-B.
