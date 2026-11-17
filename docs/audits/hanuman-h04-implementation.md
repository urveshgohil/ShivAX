# SHIVAX 0.4.0 HANUMAN · H04-A Abhimanyu and Ashwatthama workflow safety checks

Date: 17 November 2026. Baseline: `43bb3a4`. Node `v22.23.2`, Windows.

**Result: H04-A implementation PASS. The release remains NO-GO.**

The phase prerequisite was not met: it requires H00–H03 to be complete, and the [H03-C review](hanuman-h03-review.md) is **NO-GO**. The project owner explicitly waived that gate for this phase. These H03 findings remain open and were not touched:

| Finding | Severity |
| --- | --- |
| H03C-01: implicit Hanuman eligibility | P1 |
| H01D-02: Node transport not reviewed | P1 |
| H03C-03: in-flight retrieval continues after session revocation | P2 |
| H03C-04: deadline reported as `security-denied` | P2 |

H04-A is additive and opt-in, and it does not depend on those fixes.

## 1. Existing checks reused, not duplicated

| Check | Existing implementation | H04 use |
| --- | --- | --- |
| DAG acyclicity and references | `workflows/validation.ts plan()` and `agents/rudra/validation.ts plan()` only accept references to earlier actions or steps, so cycles cannot be built. Duplicates and forward references are rejected. | Abhimanyu calls these validators unchanged; a rejection becomes `ABH_INVALID_PLAN`. Depth is computed over the validated order. |
| Maximum workflow steps | `settings()` (1–100, default 32) and RUDRA `options()` (1–100, default 16) | Reused to resolve options. Plan size is capped through the same validators. |
| Maximum retry count | Both engines cap retries at 3, and only read-only retries happen | Reused. Values above 3 still throw `invalid-input`. Engine retries count toward deadline feasibility. |
| Timeouts and deadlines | Mandatory `TaskContext.limits.timeoutMs`, engine timers, firewall lease deadlines | The engine passes the task deadline to both checks. No new timer was added. |
| AbortSignal handling | Engine `controller`, Vijay leases, `checkExecution` | The observer records cancellation requests from the existing abort. Its only action is the run's own `cancel`. |
| Tool lease lifecycle | `ToolLease`, `trackTool`, the engine's `pending` set, firewall draining | Action cleanup is acknowledged only when the tracked tool promise settles. Workflow cleanup is acknowledged when the existing `release()` finishes. |
| Pause and resume | `WorkflowRun.pause/resume`, revalidation on resume | Paused state is mirrored to the observer, so heartbeat checks are suppressed while paused. |
| Cleanup and cancellation | Bounded awaits, pending ownership, lease close | Observed only, never re-implemented. |

## 2. New APIs

All new APIs are additive exports from `shivax` and `shivax/rudra`, via `src/workflows/index.ts`.

| Export | Kind | Purpose |
| --- | --- | --- |
| `runAbhimanyuPreflight(input)` | function | Opt-in static preflight that returns an `AbhimanyuReport` |
| `validateSafetyProfiles(profiles)` | function | Validates host safety declarations |
| `createAshwatthamaObserver(options)` | function | Optional lifecycle observer |
| `validateSafetyWarning(raw)` | function | Validates warnings against the schema |
| `SAFETY_WARNING_RULES`, `ABHIMANYU_RULE_IDS`, `ASHWATTHAMA_RULE_IDS`, `SAFETY_LIMITS`, `ABHIMANYU_DEFAULT_ENFORCED`, `ASHWATTHAMA_DEFAULT_ENFORCED` | frozen constants | Rule catalog and limits |
| `WorkflowSafetyError` (`invalid-input`, `invalid-declaration`, `invalid-policy`, `invalid-warning`) | class | Errors |
| `WorkflowSafetyOptions`, `WorkflowSafetyProfile`, `SafetyWarning`, `SafetyPolicy`, `AbhimanyuReport`, `LifecycleRecord`, `AshwatthamaObserver` and related types | types | Declarations |

**Engine integration** is optional. Without the third argument the engine behaves as before.

```ts
new RudraWorkflowEngine(tools, security, {
    preflight?: AbhimanyuOptions,      // profiles, policy, pausable, approvedLongRunning, maxDeadlineMs, maxWarnings
    lifecycle?: AshwatthamaObserver,   // must come from createAshwatthamaObserver (brand-checked)
});
```

Three additive public type changes come with it:
- `WorkflowErrorCode` gains `'preflight-blocked'`.
- `WorkflowRun` gains an optional `preflight` report.
- `WorkflowSafetyOptions` is new.

Invalid safety options make the constructor throw `invalid-options`, the same way invalid options are handled today.

## 3. Abhimanyu rules (preflight; validator `abhimanyu`, every rule at version 1)

Abhimanyu reads host-declared **profiles** per capability. Each profile is a closed schema:

| Field | Values |
| --- | --- |
| `sideEffect` | `none` / `protected` |
| `effect` | `read-only` / `state-changing`, defaulting to the bound tool's effect |
| `maxDurationMs` | duration |
| `cancellation` | `cooperative` / `ignored` |
| `cleanup` | `{verifiedBy, version}` or `'none'` |
| `compensation` | `{capability, verifiedBy, version}` or `'none'` |
| `resume` | `{verifiedBy, version}` or `'unsupported'` |
| `retries` | `{max}` (up to 10) or `'unbounded'` |
| `idempotent` | boolean |

A malformed declaration is rejected (`invalid-declaration`), never treated as safe. Rejected cases include accessors, extra keys, duplicates, free-text verifier references and a capability compensating itself.

| Rule | Certainty | Fires when | Enforced by default |
| --- | --- | --- | --- |
| `ABH_INVALID_PLAN` | confirmed | The existing validator rejects the plan | ✓ |
| `ABH_UNREACHABLE_COMPLETION` | confirmed | The capability is not allowlisted, or no workflow binding exists, so the workflow can never complete | ✓ |
| `ABH_MISSING_PROFILE` | insufficient-metadata | There is no profile, or the effect is unknown | |
| `ABH_NO_EXIT_PATH` | confirmed if cleanup is `'none'`; potential if cleanup is undeclared | Protected action with `cancellation: 'ignored'` and no verified cleanup | ✓ (confirmed only) |
| `ABH_UNBOUNDED_DEADLINE` | insufficient-metadata if there is no deadline; potential if the deadline is over the cap without approval | Default cap is 15 minutes; `approvedLongRunning` raises it up to 24 hours | |
| `ABH_DEADLINE_INFEASIBLE` | potential | Declared durations × (1 + engine retries + internal retries) exceed the deadline. Uses the sequential sum when `maxParallel` is 1, otherwise the critical path. | |
| `ABH_UNBOUNDED_RETRY` | confirmed | Tool-internal retries are declared `'unbounded'` | ✓ |
| `ABH_RETRY_SIDE_EFFECT` | confirmed if `idempotent: false`; potential if unknown | A state-changing action retries internally | ✓ (confirmed only) |
| `ABH_MISSING_CLEANUP` | insufficient-metadata if undeclared; confirmed if `'none'` | A protected action without verified cleanup | |
| `ABH_MISSING_COMPENSATION` | insufficient-metadata if undeclared; potential if `'none'` | A state-changing protected action followed by later actions that can still fail | |
| `ABH_RESUME_UNSAFE` | insufficient-metadata or potential | `pausable` is set and a protected state change has no verified resume recovery | |
| `ABH_INVALID_DECLARATION` | confirmed | The compensating capability is not allowlisted, has no profile, or is unbound | ✓ |
| `ABH_ANALYSIS_TRUNCATED` | insufficient-metadata | The warning limit was reached | |

The ten analysis areas map to rules as follows:

| Analysis area | Covered by |
| --- | --- |
| Terminal states | `UNREACHABLE_COMPLETION` |
| Failure and partial-commit paths | `MISSING_COMPENSATION` |
| Cancellation | `NO_EXIT_PATH` |
| Timeouts | `UNBOUNDED_DEADLINE`, `DEADLINE_INFEASIBLE` |
| Retry exhaustion | `UNBOUNDED_RETRY`, `RETRY_SIDE_EFFECT`, plus engine retries in feasibility |
| Protected side effects | `sideEffect` gating |
| Cleanup | `MISSING_CLEANUP` |
| Compensation | `MISSING_COMPENSATION`, `INVALID_DECLARATION` |
| Pause and resume | `RESUME_UNSAFE` |
| Unreachable completion | `UNREACHABLE_COMPLETION`, `INVALID_PLAN` |

## 4. Ashwatthama rules (observer; validator `ashwatthama`, every rule at version 1)

**Records.** Each record holds only these fields:
- References: `ref` (a generated `op-<n>` or a host identifier), `kind`, tenant `scope {kind,id}`, `parentRef`.
- Lease: `leaseStatus` (`none`, `active`, `expired` or `released`).
- Timing: `startedAt`, `deadlineAt`, `leaseExpiresAt`, `lastProgressAt`, `paused`, `cancellationRequestedAt`.
- Outcome: `completedAt`, `completionStatus`, `cleanupAcknowledgedAt`, `cleanupFailures`.

Records contain no session ID, principal, credential, input or output. `begin()` rejects any unknown field, including payloads.

| Rule | Certainty | Fires when |
| --- | --- | --- |
| `ASH_LEASE_EXPIRED` | confirmed | An open operation is past `leaseExpiresAt`. Renewal is valid only while the lease is live, the operation is open and not cancelled, and never past the deadline. Expired leases are never revived. |
| `ASH_DEADLINE_EXCEEDED` | confirmed | An open operation is past `deadlineAt` |
| `ASH_HEARTBEAT_MISSED` | potential | Only if `heartbeatMs` was declared: no progress for more than 2× the interval. Not reported while paused or after cancellation is requested. |
| `ASH_CANCEL_STUCK` | confirmed | Cancellation was requested, the cooperative window has passed (default 5 s, configurable per operation), and the operation is still open or still holding resources |
| `ASH_OPERATION_ORPHANED` | confirmed | The parent completed more than the orphan window ago and the child is still open or unreleased |
| `ASH_COMPLETION_UNACKNOWLEDGED` | confirmed | Resources were released but no terminal status arrived within the acknowledgement window |
| `ASH_CLEANUP_UNACKNOWLEDGED` | potential | Completed, cleanup required, and no acknowledgement within the window (not reported when `CANCEL_STUCK` applies) |
| `ASH_CLEANUP_FAILED_REPEATEDLY` | confirmed | `cleanup(false)` has been reported at least `maxCleanupFailures` times (default 3) |
| `ASH_TRACKING_LIMIT` | confirmed | `begin()` exceeded `maxOperations`; the operation is untracked and no handle is retained |

**Engine wiring when `lifecycle` is configured:**

| Engine event | Observer call |
| --- | --- |
| Run starts | One `workflow` operation with the task deadline and the run's own `cancel` |
| Each attempt | One `action` child |
| Trace event | `progress` |
| `paused`/`running` state | `pause`/`resume` |
| Abort | `requestCancellation` on the workflow and its open children |
| Terminal result | `complete` |
| Engine `release()` finishes (all pending work settled) | `cleanup(true)` for the workflow |
| Tracked tool promise settles | `cleanup(true)` for the action |

Every observer call inside the engine is wrapped, so an observer fault cannot change execution.

**No process control.** The observer has exactly seven methods: `begin`, `scan`, `list`, `history`, `cancel`, `status`, `dispose`. It:
- runs no timers;
- cannot kill processes, abort requests itself, or change firewall rules or Jay/Vijay authority.

In **enforce** mode, `scan()` may invoke the operation's registered cooperative `cancel` at most once, and only for enforced rules (default: `ASH_DEADLINE_EXCEEDED` and `ASH_LEASE_EXPIRED`). For engine runs that callback is `WorkflowRun.cancel`, an existing authorized API. Host callback faults are isolated.

**Tenant isolation.** `scan`, `list`, `history` and `cancel` all require a scope and return or affect only that tenant. A cross-tenant `cancel` returns `false`, and a parent from a different scope is rejected.

## 5. Warning schema (`shivax-safety-warning`, version 1)

```ts
{ format: 'shivax-safety-warning', version: 1,
  ruleId, ruleVersion, validator: 'abhimanyu' | 'ashwatthama',
  severity: 'low' | 'medium' | 'high',                       // from the catalog
  certainty: 'confirmed' | 'potential' | 'insufficient-metadata',
  subject: { kind: 'workflow' | 'action' | 'operation', ref, index },
  evidence: { ≤8 fields: identifier | finite number | boolean | null },
  remediation,                                               // static catalog text only
  timestamp: number | null,
  disposition: 'reported' | 'blocked' | 'cancellation-requested' }
```

`validateSafetyWarning()` enforces the schema:
- The rule must be known, and `version`, `validator`, `severity` and `remediation` must match the catalog.
- `blocked` is allowed only on Abhimanyu warnings and `cancellation-requested` only on Ashwatthama warnings.
- Evidence values must be identifiers (`[A-Za-z0-9._:-]{1,128}`). Free text, nested objects, accessors and non-finite numbers are rejected.

Plan action IDs and literal data never appear in warnings: action subjects are `action-<index>`, and evidence carries only capability identifiers and numbers. A test confirms that injected secret-like IDs and data are absent from the report.

## 6. Policy configuration

`SafetyPolicy = { mode: 'disabled' | 'warn' | 'enforce', enforceRules?, relaxRules?, blockUncertain? }`. The default mode is `warn`. Abhimanyu also takes `requireDeclarations` (default `true`; see §12).

| Mode | Abhimanyu | Ashwatthama |
| --- | --- | --- |
| `disabled` | No analysis | No dispositions (records still kept for `list`/`status`) |
| `warn` | All findings reported; the decision is always `allow` | Reported only |
| `enforce` | `blocked` for enforced rules whose finding is `confirmed`, or rests on an omitted declaration whose least-safe value is confirmed. `blockUncertain: true` also blocks potential and insufficient-metadata findings for enforced rules. The engine throws `preflight-blocked` before occupying itself and before any Jay, Vijay, firewall, approval or tool call. | Cooperative cancel for enforced rules, once |

The enforced set is the validator's defaults, **plus** `enforceRules`, **minus** `relaxRules`:
- `enforceRules` only adds rules, so an empty or narrower list never removes a default.
- `relaxRules` may name only default rules, and a rule cannot appear in both lists.
- A relaxed rule is reported as `ABH_ENFORCEMENT_RELAXED` and listed in `report.relaxedRules`.
- Every listed rule must belong to that validator, and duplicates are rejected (`invalid-policy`).

Warnings never grant or revoke authority. A passing preflight still goes through every existing Jay, Vijay and firewall check, and a warn-mode report never stops the existing allowlist denial (both are tested).

## 7. Performance limits (`SAFETY_LIMITS`)

| Limit | Value |
| --- | --- |
| Plan actions | 100, via the existing validators. Plan bytes: the task's `maxInputBytes` in the engine, 256 KiB by default in the public API, capped at 1 MiB. |
| Graph depth | 100 |
| Profiles | 256 |
| Warnings per report or scan | Default 64, maximum 256. Overflow becomes `ABH_ANALYSIS_TRUNCATED`. |
| Tracked operations | Default 256, maximum 4,096. Overflow is untracked and reported with `ASH_TRACKING_LIMIT`. |
| Retained history | Default 256, maximum 4,096, as a ring buffer with a dropped count |
| Evidence | 8 fields; references up to 128 characters |
| Deadlines | Default cap 15 minutes; approved long-running maximum 24 hours |
| Windows | Cancellation, acknowledgement and orphan windows 1 ms–10 min (default 5 s); cleanup failures 1–100 |

Abhimanyu runs in time linear in actions plus edges. The observer runs no timers and keeps no references to payloads. It drops callbacks when an operation retires and on `dispose()`. All times come from an injectable `now()`.

## 8. Files changed

| Path | Change |
| --- | --- |
| `src/workflows/safety/schema.ts` | New: catalog, warning type and validator, policy resolution, limits, error |
| `src/workflows/safety/abhimanyu.ts` | New: profile validation and preflight analysis |
| `src/workflows/safety/ashwatthama.ts` | New: lifecycle observer |
| `src/workflows/safety/index.ts` | New: barrel |
| `src/workflows/engine.ts` | Optional third constructor argument; preflight before occupying; isolated observer hooks (+110/−3) |
| `src/workflows/types.ts` | `WorkflowSafetyOptions`, `WorkflowRun.preflight`, `'preflight-blocked'` |
| `src/workflows/errors.ts` | Message for `preflight-blocked` |
| `src/workflows/index.ts` | Safety exports |
| `tests/workflow-safety.test.mjs` | New: 22 cases × ESM and CJS |
| `docs/audits/hanuman-h04-implementation.md` | This report |

Unchanged: RUDRA, Hanuman, the seven specialists (including `vishwakarma`), Jay, Vijay, the firewall, SARASWATI, dependencies, Inspectra and Visynq.

## 9. Test results

All commands ran offline with the H03 pnpm settings. Logs are in `node_modules/h04a-*.log`.

| Command | Result |
| --- | --- |
| `node --test tests/workflow-safety.test.mjs` (3 runs) | **44 / 44** each run |
| Focused: `workflow-safety`, `workflows`, `rudra`, `hanuman-integration`, `hanuman-fetch`, `hanuman-bot`, `security`, `firewall`, `firewall-integration`, `learning-routing`, `package`, `sdk` | **691 / 691** |
| `pnpm lint` | PASS |
| `pnpm test` | **1,319 / 1,319** (1,275 before plus 44); 0 failed, cancelled, skipped or todo |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS: ESM/CJS export parity, browser-safe graphs, 13 declaration entries × 5 modes, 12 offline examples, **544** packaged files (532 before) |

The 22 cases cover:
- warning schema validation;
- a safe workflow;
- missing exit path in warn and enforce modes;
- missing cleanup declaration;
- retry exhaustion and deadline feasibility;
- unreachable completion, invalid plans and RUDRA step plans;
- compensation, resume and approved long-running deadlines;
- declaration validation;
- disabled mode, bounds and nonsecret evidence;
- the engine without safety options;
- enforce and warn preflight inside the engine;
- valid completion and valid cancellation;
- expired lease and lease renewal;
- enforce-mode cooperative cancellation;
- stuck cancellation and orphaned children;
- legitimate long-running work, heartbeats and pause;
- acknowledgement and repeated cleanup failure;
- tenant isolation and absence of process control;
- bounds, `dispose` and observer cleanup;
- the engine with the observer: a clean run, a tool that ignores cancellation, and an enforce-mode deadline.

A non-cooperative tool produces exactly `ASH_CANCEL_STUCK` (workflow and action) and `ASH_OPERATION_ORPHANED` (action), and these clear once the tool settles.

Development found one implementation gap: cancellation was not propagated to observed child actions. It was fixed and is covered by a test. It also corrected one test's own setup: a lease expired inside the heartbeat window. No existing test was changed.

## 10. Known limitations

- **Declarations are attestations, not proof.** Abhimanyu checks their shape and references, not the host adapter's real behavior. "Verified" means a host reference was supplied.
- **Static analysis cannot see host code.** An absent declaration is `insufficient-metadata`, never `confirmed`.
- **Observer coverage.** The observer is wired into `RudraWorkflowEngine` only. RUDRA bot runs and host transports must call the observer API themselves; RUDRA has no ownership-release signal to wire. Abhimanyu does analyze RUDRA step plans.
- **Clocks.** The observer uses its own clock, while engine deadlines use `performance.now()`. With an injected clock, `ASH_DEADLINE_EXCEEDED` can differ by a few milliseconds from the engine's own timeout.
- **Overlong engine deadlines.** If an engine task's deadline exceeds the observer's `maxDeadlineMs`, `begin()` fails and that run is not observed (the failure is isolated). Hosts with long tasks should raise `maxDeadlineMs` on the observer.
- **Detection, not termination.** A stuck tool is detected, not stopped. Terminating isolated workers or sockets remains a host responsibility (H01-A T13).
- **No persistence.** Observer state is in memory and per process.
- **H03 findings unchanged.** In particular, H03C-03 (in-flight retrieval after revocation) is not fixed by the observer: it can report the operation but cannot withhold its output.

## 11. PASS / FAIL

- **H04-A implementation and validation: PASS.**
- **Prerequisite gate: waived by the owner.** H03 remains NO-GO.
- **Live deployment: NO-GO** until H03C-01, H01D-02, H03C-03 and H03C-04 are resolved.

Nothing was committed, pushed, tagged or published. Work stops after H04-A.

## 12. Follow-up: misconfiguration fixes M1–M3

The H04 Safety Warnings DX research plan reproduced three ways an ordinary configuration silently weakened enforce mode. All three are fixed on top of `200148a`. Warn-mode output is unchanged.

| ID | Defect before the fix | Fix | Regression test |
| --- | --- | --- | --- |
| M1 | Omission beat honesty. `cancellation: 'ignored'` + `cleanup: 'none'` blocked, but the same profile with `cleanup` omitted was allowed. | In enforce mode, `requireDeclarations` (default `true`) analyzes each omitted field as its least-safe value: `cancellation: 'ignored'`, `cleanup`/`compensation: 'none'`, `resume: 'unsupported'`, `idempotent: false`, and `effect: 'state-changing'` when no binding states it. A finding that rests on an omission blocks when that least-safe value would be confirmed. The finding stays labelled honestly: its certainty is never raised to `confirmed`, and its evidence carries `assumedWorstCase: true`. | `M1 regression`: eight declared and omitted combinations, each giving the same decision as the honest least-safe declaration. Also covers omitted idempotency on a retried state change, unchanged warn mode, and validation of the option. |
| M2 | An empty or missing profile passed enforce mode with only `ABH_MISSING_PROFILE`. | In enforce mode, an action without a profile is analyzed as a protected, state-changing action with every field at its least-safe value. `ABH_MISSING_PROFILE` is still reported, and `ABH_NO_EXIT_PATH` (assumed) blocks. | `M2 regression`: empty profiles, a profile for the wrong capability, one unprofiled action in a two-action plan (only that action blocks), a declared non-protected profile passes, and explicit `requireDeclarations: false` keeps the old advisory behavior. |
| M3 | `enforceRules` replaced the defaults, so `[]` or a narrower list silently dropped `ABH_NO_EXIT_PATH` blocking. | `enforceRules` now adds to the defaults. The new `relaxRules` removes named defaults explicitly, and each removal emits the new `ABH_ENFORCEMENT_RELAXED` warning (catalog rule, version 1) and appears in `AbhimanyuReport.relaxedRules`. Unknown, duplicated, non-default or conflicting entries throw `invalid-policy`. The observer follows the same additive rule. | `M3 regression`: an empty, narrower or unrelated list still blocks; added rules enforce; a relaxed rule allows the plan but is reported first; five misuse cases are rejected; observer defaults survive a custom list. |

**Changed files:**

| Path | Change |
| --- | --- |
| `src/workflows/safety/schema.ts` | Additive `relaxRules`, the new rule, `ResolvedPolicy.relaxed` |
| `src/workflows/safety/abhimanyu.ts` | `requireDeclarations`; least-safe analysis of omissions; `relaxedRules` in the report; the relaxed-enforcement warning |
| `tests/workflow-safety.test.mjs` | Three new regression cases × ESM and CJS. One existing H04 assertion was updated: it asserted the old M1 behavior, where an omitted cleanup was allowed in enforce mode, and now asserts blocking plus the explicit lenient opt-out. |
| This report | Updated |

**Behavior changes for H04 adopters:**
- **Enforce mode is stricter.** Hosts relying on omitted fields to pass must now declare them, or set `requireDeclarations: false` explicitly.
- **`enforceRules` now adds rules.** It no longer narrows the defaults; use `relaxRules` for that.
- **The catalog gained one rule.** `ABH_ENFORCEMENT_RELAXED` makes 23 rules in total.

**Validation.** All commands ran offline; logs are in `node_modules/h04m-*.log`.

| Command | Result |
| --- | --- |
| `node --test tests/workflow-safety.test.mjs` | **50 / 50** |
| Mutation: omissions analyzed leniently (undoes M1/M2) | 6 targeted failures (the M1 and M2 regressions plus the updated assertion, ESM and CJS); all others pass |
| Mutation: `enforceRules` replaces defaults (undoes M3) | 2 targeted failures (M3 regression, ESM and CJS) |
| Focused: safety, workflows, RUDRA, Hanuman integration, package, SDK | 247 / 247 |
| `pnpm lint` | PASS |
| `pnpm test` | **1,325 / 1,325** (1,319 + 6) |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS (544 files) |

The source was confirmed identical after the mutation runs, and `dist/` was rebuilt from clean source before the final gates.

**Still open from the research matrix:** M4 (`blockUncertain` is ignored outside enforce mode), M5 (a disabled observer still warns), M6 (an overlong engine deadline leaves the run silently unobserved), M7 (guessable operation refs), M8 (warn-mode reports have no hook) and M9 (verification is an attestation only). The H03 NO-GO findings are unchanged.
