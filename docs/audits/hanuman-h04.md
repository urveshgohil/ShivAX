# SHIVAX 0.4.0 HANUMAN · H04 workflow safety warning checks (phase summary)

Status as of 18 November 2026, HEAD `71954fc`: **implemented, tested and reviewed. H04B-01/02/03/04/05 and M5 are fixed; H04 remains NO-GO until H04C-01 is fixed and H04-B/H04-C are re-run.** Warn-mode pilots are acceptable, with the constraints in the [H04-C review](hanuman-h04-review.md) §11.

| Phase | Document | Outcome |
| --- | --- | --- |
| H04-A implementation (+ M1–M3 fixes) | [hanuman-h04-implementation.md](hanuman-h04-implementation.md) | Implemented. The H03 prerequisite gate was waived by the owner. |
| H04-B adversarial tests | [hanuman-h04-adversarial-tests.md](hanuman-h04-adversarial-tests.md) | 92 pass, 0 fail, 12 todo (6 preserved defects) |
| H04-C independent review | [hanuman-h04-review.md](hanuman-h04-review.md) | NO-GO: one new P1 (H04C-01) |

## What H04 adds

Two opt-in checks in `src/workflows/safety/`, exported additively from `shivax` and `shivax/rudra`. Neither is a bot, a process manager or an authority.

- **Abhimanyu** (`runAbhimanyuPreflight`, or `RudraWorkflowEngine` option `preflight`). A static check, run before execution, for workflows that can enter a protected operation without a safe exit.
  - It reuses the existing workflow and RUDRA plan validators, then analyzes host-declared capability profiles: exits, cleanup, compensation, deadlines, retries and resume.
  - In enforce mode, omitted declarations are analyzed as their least-safe value (`requireDeclarations`, on by default).
- **Ashwatthama** (`createAshwatthamaObserver`, or engine option `lifecycle`). A bounded, in-memory lifecycle observer for authorized operations.
  - It stores nonsecret metadata only and evaluates on host `scan()` calls, with no timers.
  - It detects expired leases, missed deadlines and heartbeats, stuck cancellation, orphans, missing acknowledgements and repeated cleanup failure.
  - In enforce mode its only action is calling the operation's own cooperative `cancel` once.
- **Shared** pieces:
  - The `shivax-safety-warning` v1 schema and its validator.
  - A frozen 23-rule catalog (14 `ABH_*`, 9 `ASH_*`).
  - The policy `{ mode: disabled | warn | enforce, enforceRules (adds), relaxRules (explicit, reported), blockUncertain }`.

Neither check grants or removes permissions. Jay, Vijay and the NARASIMHA firewall stay authoritative (H04-B non-interference test). Existing behavior is unchanged when the checks are not configured (740 compatibility tests).

## Open findings

| ID | Severity | Summary |
| --- | --- | --- |
| H04C-01 | **P1** | Engine preflight and execution snapshot the proposal separately; an inconsistent (Proxy) proposal executes a plan the preflight never saw |
| H04C-02 | P3 | Observer `relaxRules` silently disables enforcement; observer `blockUncertain` is silently ignored |
| H04C-04 | P3 | The per-scope untracked counter map is unbounded across many tenants |
| H04C-05, M4, M9 | P3 | Report accuracy, warn-mode `blockUncertain`, attestation-only verification |

Fixed in H04: M1 (omission beat honesty), M2 (empty profiles passed enforce mode) and M3 (`enforceRules` replaced the defaults).

Fixed after H04-C (18 November 2026). The H04-B fixtures now run as ordinary regression tests with their original assertions.

| ID | Fix |
| --- | --- |
| H04B-02 | A profile `effect` that contradicts the live binding raises `ABH_INVALID_DECLARATION` (blocked in enforce mode), and the least-safe effect is analyzed |
| H04B-01 | Observer records are keyed by tenant scope and ref, so the same host ref in two tenants no longer collides |
| H04B-03 | Warning evidence echoes only host-known capability IDs, never plan-supplied text |
| H04B-04 | A cancellation requested after completion is ignored; cleanup tracking still applies |
| H04B-05 | A full scan reserves its last slot for `ASH_TRACKING_LIMIT` |
| M5 | A disabled observer's `scan` returns no warnings and requests no cancellation |

## Measured footprint (H04-C probe, indicative)

| Workload | Result |
| --- | --- |
| Preflight of a 100-action, ≈4,950-edge plan | 3.5 ms |
| Observer, 4,096 operations | `begin` 7.2 ms · `scan` 2.0 ms · retire 17.5 ms · ≈5.8 MB heap |

## Validation at `71954fc`

| Gate | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm test` | 1,417 pass, 0 fail, 12 todo (after the H04B fixes: 1,429 pass, 0 fail, 0 todo) |
| `pnpm build` | PASS |
| `pnpm verify:package` | PASS (544 files) |

## Release position

H04 is NO-GO until H04C-01 is fixed. Separately, the H03 findings (H03C-01, H01D-02, H03C-03, H03C-04) keep SHIVAX 0.4.0 at NO-GO for live deployment.
