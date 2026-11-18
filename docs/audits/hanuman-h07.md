# SHIVAX 0.4.0 HANUMAN · H07 Shabari canary and adversarial security (phase summary)

Status as of 19 November 2026, Asia/Calcutta. This covers reviewed HEAD `92b67ea` plus the uncommitted H07-C test changes.

**H07: NO-GO.**
- No P0 was found, and no unauthorized network effect, tenant-isolation break or budget regression was reproduced.
- Two P1 findings remain unresolved: H03C-01 (implicit capability allowlist) and H01D-02 (no reviewed host transport).
- Most of the required canary inventory is not implemented: 2 of the 338 planned variants exist as fixtures.
- Live Hanuman deployment and the 0.4.0 release remain **NO-GO**.

Shabari is a test harness, not a bot. The default roster is unchanged: seven specialists, with no Hanuman.

| Phase | Document | Outcome |
| --- | --- | --- |
| H07-A attack and canary design | [hanuman-h07-attack-plan.md](hanuman-h07-attack-plan.md) | Design delivered: 80 fixture rows and 338 numbered variants; frozen 0.3.2 baseline measured. |
| H07-B canary harness and results | [hanuman-h07-canary-results.md](hanuman-h07-canary-results.md) | FAIL / INCOMPLETE. The opt-in runner `tests/fixtures/shabari-runner.mjs` runs 7 existing suites (505/505). Findings H07B-01 and H07B-02. |
| H07-C remediation | [hanuman-h07-remediation.md](hanuman-h07-remediation.md) | FAIL / NO-GO. Added SHB-NET-12.6 and 12.7 (512/513-byte boundary), each in ESM and CJS. H07B-02 is blocked on H05. |
| H07-D final security review | [hanuman-h07-security-review.md](hanuman-h07-security-review.md) | **NO-GO.** Independent reproducers, mutation checks and all gates. New findings H07D-01 to H07D-05. |

## What H07 delivers

**Planning documents:**
- The attack plan: threat model, fixture catalog, canaries, assertion specification, baseline plan and infrastructure.
- The canary results, remediation and final review documents.

**Tests:**
- `tests/fixtures/shabari-runner.mjs`, an opt-in runner with 9 selections. Each runs in its own child process with a deadline, and a selection fails closed on any skip, TODO, timeout or zero-test match.
- `tests/shabari-runner.test.mjs`, 4 tests.
- Two boundary fixtures in `tests/hanuman-fetch.test.mjs`. A mutation check showed they are the only tests that detect an off-by-one in the response byte cap, in either direction.

**No production source change.** The diff from `ce947c1` to the working tree is empty for `src`, the manifest, the lockfile, scripts, build configuration and examples.

## Key results (H07-D, run independently)

| Gate | Result |
| --- | --- |
| `pnpm lint` / `pnpm build` | PASS / PASS |
| `pnpm test` | 1,452/1,452; 0 failed, skipped, TODO or cancelled |
| Hanuman and Shabari focused suites | 399/399 |
| Security, firewall, RUDRA, workflow, safety, cost, routing and learning set | 644/644 |
| Shabari runner, 9 selections | pass: 13, 186, 88, 108, 58, 38, 18, 2 and 2 |
| `pnpm verify:package` | PASS: 186 packed gateway and 88 packed bot tests; 4 H06 examples and 13 H06 tests; 13 declaration entries × 5 modes; 550 files |
| `npm pack --dry-run` | PASS: `shivax@0.3.3`, 551 files |
| Frozen 0.3.2 baseline | 897/897 on the archived build. The historical tests against the current `dist` give 897/897 with the 0.3.3 manifest, and 896/897 with the 0.3.2 manifest, where the only failure is the version assertion. |
| Independent reproducers | 61 recorded offline cases: transport, agent, firewall mode, lease drain and hidden characters |
| Mutation check | 2 of 2 byte-cap mutants killed, each only by SHB-NET-12.6 or 12.7 |

## Findings

| ID | Sev | Summary | Status |
| --- | --- | --- | --- |
| H01D-02 | **P1** | No reviewed DNS-pinned TLS host transport. Every network property is verified only against a simulated transport. | Open (carried) |
| H03C-01 | **P1** | `rudra.run(ctx)` with no options admits the root network capability through the implicit allowlist. | Open (carried, re-verified) |
| H07D-01 | P2 | A transport that ignores abort is not bounded by the gateway `timeoutMs`. It keeps two firewall leases draining forever, and later runs fail `busy`. | New |
| H07D-02 | P2 | The required H07 canary inventory is largely unimplemented (2 of 338). There are no `net`/`dns`/`tls` tripwires and no mutation controls in the repository. Supersedes H07B-01. | New |
| H03C-02, H03C-03, H03C-04 | P2 | First-by-ID route capture; identity-provider revocation does not stop an in-flight retrieval; a deadline is reported as `security-denied`. | Open (carried, re-verified) |
| H05C-01 / H07B-02 | P2 | No Kubera budget reporter or Jambavan discovery. | Open (carried) |
| H06C-01, H06C-02 | P2 | The example host auto-approves firewall administration; H06 negative tests are missing. | Open (carried) |
| H07D-03 | P3 | Zero-width, bidi and Unicode tag characters pass verbatim into untrusted evidence. | New |
| H07D-04 | P3 | Test-depth gaps: only 302 among redirects and only `gzip` among encodings; no `3fff::/20` case; partial tripwires; `draining` unasserted; runner self-test duplication. | New |
| H07D-05 | P3 | The H07-A plan's file counts (42 and 48) should read 40 and 46. The test totals are correct. | New |
| H01D-07/08/09/10/11, H02D-04 and other earlier P3s | P3 | See the review, §10. | Open |

## What was verified

**Verified offline through the real RUDRA → Jay → Vijay → NARASIMHA → gateway path:**
- **Destination:** origin and target restrictions; the address classifier (except `3fff::/20`); simulated rebinding and peer-pin checks.
- **Response handling:** redirect and encoding refusal; byte and chunk caps; error sanitization; cleanup.
- **Authorization:** literal-`true` approval; tenant and realm isolation.
- **Firewall modes:** ENFORCE, MONITOR (mandatory rules kept) and LOCKDOWN, including mid-flight fences.
- **Retries and cost:** non-retryable deterministic denials; the $0.30 budget regression; terminal token limits.
- **Roster:** the seven-bot roster and Hanuman opt-in; SARASWATI shadow routing that never escalates.

**Deployment-dependent and not verified:**
- DNS pinning on connect;
- TLS policy;
- wire-level redirects;
- host cookie and proxy stripping;
- decoder memory;
- the host transport honoring cancellation.

## Before an H07 re-review

1. Close H03C-01: an explicit allowlist for side-effecting capabilities, with the KNOWN GAP test inverted.
2. Either deliver and independently test the H01 transport in an isolated network, or record a formal owner descope stating that 0.4.0 makes no wire-level SSRF or TLS guarantee.
3. Implement the H07-A P0/P1 fixtures with tripwires and mutation controls.
4. Fix or formally accept H07D-01, H03C-03 and H03C-04, with regression tests.

## Unchanged upstream state

- H01, H03 and H04 remain NO-GO as recorded in their reviews, although the H04 P1 and P2 fixes have passing regression tests.
- H05 remains NO-GO because Kubera and Jambavan are absent.
- H06 remains CONDITIONAL GO for offline examples only.

Nothing was committed, pushed, tagged or published. Inspectra and Visynq were not modified. H08 has not started.
