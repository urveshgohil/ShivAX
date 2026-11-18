# SHIVAX 0.4.0 HANUMAN · H07-D final Shabari canary and adversarial security review

19 November 2026, Asia/Calcutta. Windows 11, Node v22.23.2, pnpm 12.8.1, npm 10.9.8.

**Scope.** Reviewed HEAD `92b67ea` (H07-B), plus the uncommitted H07-C working tree:
- `tests/hanuman-fetch.test.mjs`
- `tests/fixtures/shabari-runner.mjs`
- `tests/shabari-runner.test.mjs`
- `docs/audits/hanuman-h07-remediation.md`

**Baselines.** The H06 baseline is `ce947c1`. The frozen 0.3.2 baseline is commit `37845c7f880d14a78fae0378a7c0b45fa1116005`; it has no tag.

**Package.** The package is still `shivax@0.3.3`.

**Decision.** **H07: NO-GO.** No P0 was found, and no unauthorized network effect or tenant-isolation break was reproduced. Two P1 findings are still unresolved: H03C-01 and H01D-02. Most of the canary fixtures H07 requires are not implemented: 2 of the 338 numbered H07-A variants exist as `SHB-*` fixtures. Under Step 11, a complete security pass therefore cannot be claimed. Section 11 gives the full gate.

H07-D is a read-only review. It adds only this file and the [phase summary](hanuman-h07.md). It changes no source, test, script, manifest or example. All reproducers ran offline against the current `dist/` with in-memory transports, and they are saved under the ignored `node_modules/h07d-probes/` folder.

## How this review was performed

- **Documents read:** the [H07-A attack plan](hanuman-h07-attack-plan.md), [H07-B canary results](hanuman-h07-canary-results.md) and [H07-C remediation](hanuman-h07-remediation.md), plus the H01–H06 reviews.
- **Source drift checked with git:**
  - `git diff ce947c1 -- src package.json pnpm-lock.yaml scripts rollup.config.mjs tsconfig.json examples` is **empty**, so H07-B and H07-C changed no production code.
  - `git diff --shortstat 37845c7 -- src` gives 21 files, +2,152/−14, the same figure measured in H07-A.
- **Source read directly:**
  - Gateway: `src/integrations/hanuman/service.ts`, `address.ts`, `target.ts`, `error.ts`, `types.ts`.
  - Bot: `src/bots/hanuman.ts`.
  - RUDRA: `src/agents/rudra/orchestrator.ts` (routing and retry) and `src/agents/rudra/validation.ts`.
  - Firewall: `src/security/firewall/policy.ts` (`evaluate`) and `runtime.ts` (realm check, admission, resources, model-route fallback).
  - Model router: `src/intelligence/router.ts` (token and cost reservation).
  - Shabari: the runner and its self-test.
- **Tests inspected:**
  - The gateway, integration, cost and SARASWATI routing suites.
  - The H04 adversarial regressions.
  - The packaged-consumer verifier.
- **Independent reproducers:**
  - 53 recorded cases through the full path (RUDRA → Jay → Vijay → NARASIMHA → gateway → mock transport): `probes.mjs`.
  - Lease-drain follow-ups: `drain.mjs` and `m07drain.mjs`.
  - Invisible-character evidence: `invisible.mjs`.
- **Mutation checks:** two mutants of the gateway byte cap, run on a scratch copy of `dist`. The repository's `dist` was not modified.
- **Gates:** all re-run (§7.3).

Evidence tags used below:
- **[R]** an H07-D reproducer;
- **[T]** an existing automated test;
- **[C]** a code reading;
- **[M]** a mutation check;
- **[D]** deployment-dependent and not verifiable offline.

## 1. Threat coverage matrix

"SHB" means the case exists as a named, individually selectable H07 fixture. Existing tests cover many cases under other names.

| Area | Existing automated coverage (enforcement path) | H07-D independent result | SHB | Verdict |
| --- | --- | --- | --- | --- |
| SSRF / destination restriction | [T] gateway: `denies address …`, `rejects unsafe registered URL …`, `rechecks … after DNS await`. [T] integration S4.7, S5 ENFORCE. | [R] T03: a public answer mixed with `169.254.169.254` is denied with 0 requests. [R] T08: injected `url`/`headers` are denied with 0 resolves. [R] T09: an unknown target dispatches nothing. [R] T04: `3fff::1` **completes** (H01D-09). | none | Verified (simulated). One low-impact classifier gap. |
| DNS rebinding simulation | [T] gateway `rejects invalid response peer` (public peer outside the pin set). | [R] T01: private peer after a public answer gives `address-denied`, with 1 request and 1 close. [R] T02: public peer outside the pin set is likewise denied. | none | Simulated. The SDK checks the reported peer; real socket pinning is [D]. |
| Redirect security | [T] gateway: `redirect` (302) appears in both the invalid-response and no-retry lists. | [R] T06: 301, 302, 307 and 308 with a `Location` pointing at metadata all give `redirect-denied` with exactly 1 request. [R] T07: the frame carries `redirect: 'error'`. | none | Verified (simulated): redirects are never followed. Wire behavior is [D]. Only 302 is in the suite. |
| Header / credential leakage | [T] `transport exception secrets never reach the result or observer`; [T] `cleanup failure is sanitized`. | [R] T07: the frame is frozen; its headers are exactly `accept` and `accept-encoding`, with `credentials: 'omit'`. [R] T17 and T18: a synthetic `sk-live-…` thrown from `close()` or `request()` reaches neither the result nor the firewall audit. | none | Verified at the SDK boundary. Host cookie and proxy injection is [D]. |
| Decompression limits | [T] `gzip` → `encoding-denied`; [T] byte and chunk limits. | [R] T10: `gzip`, `br`, `deflate`, `GZIP` and `identity, gzip` are all denied before any byte is pulled (pulled = 0). `identity` completes. [R] T11: a stream of 1,000 × 1 KiB with no declared length stops after 1 KiB is pulled. | none | Verified for delivered bytes. Host-side decoder memory is [D]. |
| Response bounds | [T] length and byte/chunk limits; **[T] SHB-NET-12.6 and 12.7 (H07-C)**. | [R] T12: a declared 10 MiB fails before any read. [M] Both off-by-one mutants of the byte cap are killed, and only by SHB-NET-12.6 and 12.7 (§8). | **12.6, 12.7** | Verified at the exact boundary. |
| Slow response | [T] `deadline aborts DNS and blocks subsequent dispatch`; [T] S10 deadline. | [R] T13: a slow body that honors abort settles at the gateway deadline (208–211 ms across two runs, against 200 ms). [R] T14, T15 and `drain.mjs`: **a transport that ignores abort is not bounded by the gateway deadline and pins two leases forever (H07D-01).** | none | Cooperative transports verified. Non-cooperative transport: **gap, P2**. |
| Cancellation | [T] `late response after cancellation is closed once`, `retains cleanup ownership`, S10 abort. | [R] T16 with `drain.mjs`: a root abort mid-body gives `cancelled`; `close` runs exactly once after settlement and the leases drain to 0. | none | Verified for cooperative transports. |
| Prompt injection | [T] S6 ×3, `untrusted instructions remain inert`, SARASWATI L6. | [R] A02: imperative text containing a secret and a tool call stays `trust: 'untrusted'`. Two steps make exactly two requests to the registered URL, with no extra tool, target or approval. [R] `invisible.mjs`: 7 zero-width, bidi and tag code points pass through verbatim (H07D-03). | none | Verified: no escalation. Hidden characters are a P3 downstream risk. |
| Tenant isolation | [T] S4.7; S10 parallel tenants share a transport; L7; H04B-01 regression. | [R] A09: a tenant-B session against a tenant-A target gives `security-denied` with 0 resolves. [R] M05: a foreign-tenant admin `replace` is refused (`unauthorized`). [C] The firewall realm check (`runtime.ts:145-153`) and the gateway scope check (`service.ts:135-141`) do not depend on the mode. | none | Verified. |
| Unauthorized approvals | [T] S4.8, S4.9, S4.10; literal-`true` checks in `security.test.mjs`. | [R] A03–A06: `'true'`, `1`, `{approved:true}` and a throwing approver are all denied, each with 1 approval prompt and 0 resolves. [R] A17: a host policy with `requiresApproval: false` runs without approval (a host choice; see H01D-10). | none | Verified. Approval itself is host-configured. |
| Policy revocation | [T] `rechecks … after …`, `policy changes during approval prevent DNS`, S5 lockdown during retrieval, S10 resume-after-change. | [R] M07–M10: lockdown during approval, lockdown or policy fence mid-body, and lockdown before a run each give `security-denied` with no further request; `drain.mjs` shows the leases drain. [R] A14: **identity-provider revocation in flight still completes (H03C-03).** | none | Firewall revocation verified. Jay revocation in flight: open P2. |
| Concurrency and retry budgets | [T] S7 ×6, S8 ×3, `deterministic … denial is not retried`, `transient transport errors keep the bounded … retry` (workflow path). [T] cost suite: concurrent reservations. | [R] A16: `address-denied` makes 0 requests with `maxRetries: 3`. [R] A15: RUDRA does not retry a transient Hanuman failure (by design; test S7). [C] `maxRetries` is capped at 3 (`validation.ts`). [R] T15: one hung call exhausts `maxConcurrent: 3` (H07D-01). | none | Budgets are bounded. The availability gap is H07D-01. |

**Critical boundaries without an automated test:**
- a non-cooperative transport holding leases (H07D-01);
- in-flight Jay revocation (H03C-03; there is no inverted "fixed" test, only the H03-C probe);
- the `3fff::/20` boundary (H01D-09);
- Node `net`, `dns` and `tls` tripwires (only `globalThis.fetch` is trapped, and not in `hanuman-integration.test.mjs`);
- detector-sabotage controls: no mutation suite exists in the repository; the two mutants above were run by H07-D only;
- every wire-level property: TLS, socket pinning, real redirects and host credential stripping (H01D-02).

## 2. Verified transport protections

| Control | Enforced at | Evidence | Class |
| --- | --- | --- | --- |
| Restricted origin policy | Target directory (`target.ts`): HTTPS; canonical `href`; no user info, port, fragment, IP literal, trailing dot, `localhost`, `local`, `internal` or `home.arpa`. Firewall: the exact `url.origin` must appear in both the operation and policy origins (`runtime.ts:225-231`, `policy.ts:145`). | [T] unsafe-URL list; [R] M01 and M02 (the origin is missing in both enforce and monitor) give 0 resolves. | Verified |
| Resolved-destination enforcement | Every DNS answer goes through `publicAddress` (up to 16), and any non-public answer denies the whole request (`service.ts:166-174`). The reported peer must be in the vetted pin set (`service.ts:199-206`). | [R] T01–T03; [T] the address list; the 61-case table in H07-A §2.4.4. | Simulated. The real connect-to-pin is [D]. |
| Redirect-by-redirect validation | Not applicable by design: the frame says `redirect: 'error'` and any 3xx gives `redirect-denied` (`service.ts:207-208`). Hops are never followed, which is stricter than per-hop validation. | [R] T06 ×4 and T07. | Verified (simulated); wire behavior [D] |
| Trusted host/proxy enforcement | The SDK has no proxy concept. The transport is host-trusted, registered by the host and bound per service. | [C] | [D] |
| Network-zone restrictions | The IPv4 classifier denies 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/3 and `168.63.129.16`. IPv6 allows only 2000::/3, minus 2001::/23, 2001:db8::/32 and 2002::/16. | [R] T03 and T05; [R] T04 **accepts `3fff::/20`** (H01D-09, P3). | Verified with one P3 gap |
| TLS policy | The SDK enforces `https:` targets only. Certificates, SNI and TLS version are the transport's job. | [C] | [D] (H01D-02) |
| Bounded requests | The request is GET only, with no body; it is a frozen frame with a fixed header pair, sent only to a registered target ID. The input schema is closed (`targetId` only). | [R] T07–T09 | Verified |
| Bounded responses | The declared length is checked first. A per-chunk running byte cap and a chunk cap follow. Declared and actual lengths must match, the text must be fatal UTF-8, and the output validator rechecks bytes. | [R] T11 and T12; [T] SHB-NET-12.6/12.7; [M] §8 | Verified |
| Bounded decompression | `contentEncoding` must be `null` or `identity` before any body read, and delivered bytes are capped even if the host decodes transparently. | [R] T10 ×6 (pulled = 0) and T11 | Verified for the SDK; host decoder [D] |
| Credential redaction | The frame says `credentials: 'omit'` and has no auth headers. All errors become fixed `HanumanFetchError` codes with the constant message "Protected retrieval failed." Observer events carry only `type`, `targetId` and `code`. | [R] T17 and T18 (`leaks: false`); [T] the secrets test | Verified for the SDK; host cookie jars [D] |
| Transport cleanup | `close` is captured before the revocation check, called exactly once on success, failure and late response, and failures are sanitized. Leases drain once a cooperative transport settles. | [R] `drain.mjs` and `m07drain.mjs`; [T] cleanup tests | Verified for cooperative transports. **Not bounded for non-cooperative ones (H07D-01).** |

The simulations drive the real enforcement path: RUDRA, then Vijay grant and approval, then the firewall lease, then the gateway checkpoints, then the transport. None of them calls `publicAddress` or `targets` directly. Every reproducer records transport-side counters (resolve, request, close, bytes pulled) as well as the status code.

## 3. RUDRA and Hanuman security findings

- **Hanuman remains opt-in** ([R] A01, [T] S3): `createSpecialistBots()` returns exactly seven IDs, `sanjay, brihaspati, vishwakarma, chitragupt, narad, yudhishthir, ekalavy`, with no `hanuman`. `registerHanumanBot` throws `unavailable` without the protected tool. Direct `new HanumanBot()` still advertises `fetch.url` with no tool; that is H02D-04, and it fails closed.
- **No default unrestricted network tool:** the gateway is the only network path in the Hanuman code. The package verifier statically rejects `fetch(`, `http`, `https`, `net`, `dns`, `fs`, `child_process` and `playwright` imports in `src/bots/hanuman.ts`, and it passed.
- **RUDRA allowed capabilities:**
  - [R] A10: a capability outside the explicit allowlist gives `capability-denied` with 0 dispatch.
  - **However**, [R] A11: `rudra.run(ctx)` with no options completes a retrieval, because `allowedCapabilities` defaults to the root task's capability (`src/agents/rudra/validation.ts:25-26`). This is **H03C-01 (P1), still open.** Every other layer still applied: tool grant, Vijay policy and approval, and the firewall.
- **Vijay authorization** ([R] A07, A08, A03–A06): a missing permission or tool grant dispatches nothing, and only a literal `true` approves.
- **Firewall effectiveness:** see §4.
- **Fetched text stays data:** see §5.
- **No arbitrary fallback** ([T] S7 `unavailable provider/tool fails without fallback`, S7 `a denied Hanuman route never falls back`):
  - [C] Model-route fallback happens only across a firewall-registered `route.operationIds` list. It is limited to `unavailable`, `provider-error` and `invalid-output`, and remote providers need `allowRemote` (`runtime.ts:834-862`).
  - Bot selection is still first-by-ID when several bots offer `fetch.url`. That is **H03C-02 (P2), still open**; the test `S9 KNOWN GAP H03B-02` passes because it characterizes the gap.
- **No unauthorized tenant access:** see §1 (A09, M05, [T] S10 parallel tenants).
- **Identity-provider revocation in flight** ([R] A14): `isSessionValid → false` while the request is in flight, and the run still returns `completed` with the evidence. This is **H03C-03 (P2), still open.** Firewall-side revocation (lockdown or policy fence) does stop it.

## 4. Firewall mode assessment

| Case | Result | Transport effect | Evidence |
| --- | --- | --- | --- |
| ENFORCE: origin not in policy (M01) | `bot-failed` (denied) | 0 resolves, 0 requests | [R] |
| MONITOR: origin not in policy (M02) | denied | 0 / 0 | [R]; [T] `mandatory destination rules also apply in monitor mode` |
| MONITOR: mandatory deny rule (M03) | denied | 0 / 0 | [R]; [C] `policy.ts:134-158`: only `optional` deny rules relax |
| MONITOR: optional deny (M04) | completes and is recorded | 1 / 1 | [R]. By design: monitor observes optional rules only. |
| MONITOR: tenant or realm mismatch | denied | 0 / 0 | [C] `checkRoot` is mode-independent; [R] M05 (foreign admin refused) |
| LOCKDOWN before run (M06, M10) | `security-denied` | 0 / 0 | [R]; [C] `evaluate` throws `lockdown` for every non-CPU operation |
| LOCKDOWN during the step-2 approval (M07) | `security-denied`; step 1's output retained | step 2: 0 requests | [R]; leases drain to 0 within 300 ms |
| LOCKDOWN or policy fence mid-body (M08, M09) | `security-denied` | no further read; `close` runs once after settlement | [R] `drain.mjs` |
| Firewall deadline, cooperative transport | `security-denied`; leases drain | — | [R]. The classification is H03C-04 (P2, open): a deadline surfaces as a denial. |
| Firewall deadline, transport ignores abort | `security-denied` at the firewall deadline | 2 leases draining forever; later runs `busy` | [R] H07D-01 |

**Assessment:**
- **ENFORCE** blocks prohibited operations before DNS.
- **MONITOR** keeps the mandatory allow/deny rules, capability, bot, file, origin, provider, realm and resource limits. Only optional deny rules are relaxed.
- **LOCKDOWN** denies every new protected effect and revokes active leases. The gateway checkpoints between every await, so nothing protected happens after revocation.
- RUDRA returns as soon as revocation is observed, while the revoked leases stay as `draining` until the transport settles. That is the correct conservative accounting. It is unbounded only when the transport never settles (H07D-01).

**Race coverage:** the existing tests cover revocation during DNS, approval, retry, pause/resume and abort at several points. H07-A's RACE-01..11 matrix is not implemented as named fixtures. In particular, duplicate terminal events, approval racing a policy update across two tasks, and fixtures where the adapter ignores cancellation have no automated test.

## 5. Prompt-injection assessment

**Verified** ([R] A02; [T] S6 ×3; [T] `untrusted instructions remain inert content with opaque provenance`; [T] SARASWATI L6):
- Fetched text is returned only as `excerpt`, with `trust: 'untrusted'`, fixed provenance (`botId`, `capability` and `toolId` enums) and a scope-bound `evidenceId`.
- Text containing "IGNORE ALL PREVIOUS INSTRUCTIONS", "approve=true", a tool call to another target and a synthetic secret produced:
  - no new capability or tool;
  - no change of target or approval;
  - no planner change;
  - exactly one request per planned step, to the registered URL.
- The planner, approver and firewall never read evidence content. SARASWATI recommendations execute nothing and cannot steer routing or authority (L6, L13, L17, L18).

**Residual risk (H07D-03, P3):** zero-width characters (U+200B), bidi overrides (U+202E/U+202C), the line separator U+2028 and Unicode tag characters (U+E0000–E007F) pass through verbatim. A host that forwards evidence to a model or a human reviewer can receive hidden instructions or spoofed text. The core never acts on evidence, so no privilege escalation is possible inside SHIVAX.

## 6. Baseline comparison

| Measurement | Value | Source |
| --- | --- | --- |
| Frozen baseline | 0.3.2 at `37845c7`, tree `b81e4783…`; no tag | `git rev-parse` (H07-A and H07-B) |
| Baseline suite on the archived 0.3.2 build | **897/897** | `node_modules/h07-baseline-test.log`, read in H07-D (`# tests 897`, `# pass 897`) |
| Historical tests against the current `dist`, archived 0.3.2 manifest (H07-B harness) | **896/897**. The one failure is the package-version assertion (`'0.3.3' !== '0.3.2'`). | `node_modules/h07-cross-test.log`, read in H07-D |
| The same with the current 0.3.3 manifest (H07-A harness) | **897/897** | H07-A scratch log, read in H07-D |
| Source drift from H06 (`ce947c1`) to the working tree | none in `src`, the manifest, the lockfile, scripts, build configuration or examples | `git diff` (H07-D) |
| Source drift since 0.3.2 | 21 files, +2,152/−14. Changed security files: `security/errors.ts`, `security/tools.ts`, `security/vijay.ts`, `workflows/engine.ts`. | `git diff --shortstat` (H07-D) |
| Public exports | 0 removed (H07-A export diff). The packed consumer passes ESM/CJS key parity for all 13 entry points (H07-D). | `pnpm verify:package` |
| Current suite | 1,452/1,452 in 47 top-level test files | §7 |

The two cross-run figures do not conflict: they used different manifests, and both logs agree on every other test. The baseline uses the current toolchain: H07-B could not install the historical dependency set offline. That limitation stands. Hanuman, H04 safety and Shabari have no 0.3.2 equivalent, so they have no differential comparison; the H07-A differential scenarios D-01..D-08 were not built.

## 7. Canary test results

### 7.1 Shabari runner (H07-B, extended in H07-C)

The command was `node tests/fixtures/shabari-runner.mjs examples gateway bot integration firewall cost routing SHB-NET-12.6 SHB-NET-12.7` (`node_modules/h07d-canary.log`). Status: **pass**. Counts:

| Selection | examples | gateway | bot | integration | firewall | cost | routing | SHB-NET-12.6 | SHB-NET-12.7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| total | 13 | 186 | 88 | 108 | 58 | 38 | 18 | 2 | 2 |
| pass | 13 | 186 | 88 | 108 | 58 | 38 | 18 | 2 | 2 |

Every selection had zero failed, skipped, TODO or cancelled tests, and none timed out. This matches the H07-C report exactly.

### 7.2 Runner and fixture quality

- **Deterministic fixtures:**
  - SHB-NET-12.6 and 12.7 use fixed chunk sizes (256 + 256 and 256 + 257) and assert specific counters: resolve 1, request 1, close 1, iterator finalized 1, bytes pulled, `active` 0, the observed `response-too-large` code, and the exact evidence object.
  - They do not rely on message text.
  - They do not assert `draining === 0`; `active` excludes revoked leases.
- **Isolation:**
  - Each selection runs in its own child process.
  - `NODE_TEST_CONTEXT` is removed.
  - Concurrency is capped at 4 and the deadline at 120 s.
  - Raw child output is kept in a 16 KiB tail and never returned.
- **Hidden-skip safety:**
  - A selection passes only if `pass === total` and `total > 0`.
  - H07-D measured with Node 22 that skipped and TODO tests are excluded from `# pass`, so any skip or TODO fails the selection.
  - A name pattern that matches nothing gives `total 0`, which also fails.
  - The self-test pins each SHB selector to exactly 2 cases.
- **Cleanup:**
  - A timed-out child is killed and awaited.
  - Descendant processes are not tracked, as H07-B already disclosed.
- **Network:**
  - No test or fixture in the H07 scope imports `http`, `https`, `net`, `dns`, `tls` or `dgram`, or calls `fetch`.
  - `globalThis.fetch` is trapped in the gateway, bot and example suites, but not in `hanuman-integration.test.mjs`. That suite uses only the mock transport.
- **Duplication:** `tests/shabari-runner.test.mjs` re-runs the `examples`, `cost` and `integration` suites and the two SHB selections inside `pnpm test`. This is correct but duplicative (P3, H07D-04).
- **Production not weakened:** the diff from H06 to the working tree touches no production file (§6).

### 7.3 Independent verification (all commands run in H07-D)

The environment set `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`, matching H07-B and H07-C. The logs are `node_modules/h07d-*.log`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS (`tsc --noEmit` and `eslint`) |
| `pnpm test` | 0 | **1,452 tests, 1,452 pass**, 0 failed, 0 cancelled, 0 skipped, 0 TODO |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS in an isolated consumer. 186 packed gateway and 88 packed bot tests; ESM/CJS imports; browser-safe graphs; 14 documented example files with 12 offline examples run; 4 H06 examples and 13 H06 tests; Inspectra and Visynq absent; worker training under ESM/CJS; 13 declaration entries × 5 modes; 550 packaged files. |
| `npm pack --dry-run` | 0 | PASS. `shivax@0.3.3`, 551 files, 771.5 kB packed, 3.5 MB unpacked, shasum `2c97937cf739ac6c73bb22a63997d27bbf6fd7f5`. The prepack scripts ran. |
| `node --test` on `hanuman-fetch`, `hanuman-bot`, `hanuman-integration`, `hanuman-examples` and `shabari-runner` | 0 | **399/399** |
| `node --test` on `security`, `firewall` ×4, `rudra`, `workflows`, `workflow-safety` ×2, `model-cost`, `model-safety`, `learning-routing`, `learning` and `agents` | 0 | **644/644** |
| Shabari runner, 9 selections | 0 | pass (§7.1) |
| H07-D reproducers (`probes.mjs`, `drain.mjs`, `m07drain.mjs`, `invisible.mjs`) | 0 | 53 + 6 + 1 + 1 recorded cases. These are observations, not pass/fail tests. |
| Mutation check (§8) | n/a | 2 of 2 mutants killed |

The focused counts overlap the full suite. There were no failing tests and no skipped tests. No environment was unsupported for these commands; wire-level network testing was not attempted (H01D-02). H07-B and H07-C made no performance claims, and this review makes none.

## 8. Remediation verification (H07-C)

### H07B-01 · P2 · incomplete adversarial harness (partially remediated)

- **Root cause confirmed.** H07-B registered seven suite-level selections and no individual `SHB-*` fixtures. Before H07-C, the gateway suite had no exact 512/513 boundary pair, which H07-A NET-12 rows 6 and 7 call for (`[E partial … boundary N]`, closing mutation M6 from H01D-04).
- **Fix inspected.** H07-C added the two cases to `tests/hanuman-fetch.test.mjs`, running in both ESM and CJS through the existing protected workflow, Jay/Vijay, the firewall and the mock host. It also added fixed name-pattern selectors in the runner and a self-test that pins each selector to 2 cases. No production code changed.
- **Reproducer executed.**
  - Both selectors pass (4/4).
  - **Mutation [M]:** on a scratch copy of `dist`, H07-D changed the cap in `dist/sdk/integrations.{esm.js,cjs}`.
    - From `chunk.byteLength > maxBytes - bytes` to `… > maxBytes - bytes + 1`: only SHB-NET-12.7 failed (ESM and CJS); the other 184 of 186 gateway tests passed.
    - To `>=`: only SHB-NET-12.6 failed (ESM and CJS), again 184/186.
  - So these two fixtures are the only tests that detect an off-by-one in either direction. That is real, new detection power, not just a higher test count.
- **Negative regression:** 513 bytes gives `response-too-large`, no outputs, 1 close and 1 iterator finalization.
- **Allowed behavior:** 512 bytes completes with the exact untrusted evidence object.
- **Remaining bypasses or gaps:** none at this boundary. The finding stays **open**: 2 of 338 numbered H07-A variants are implemented, and the RACE, MODE, AGT, CAN and mutation-control inventories are missing. H07-D carries it forward as H07D-02.

### H07B-02 · P2 · budget-reporting canary unavailable (not remediated, correctly)

- **Root cause confirmed.** `createKuberaReporter` and `src/security/kubera.ts` do not exist in the source tree (H05C-01).
- **Fix:** none. That is correct: a reporter needs H05-B implementation and review, not an H07 test change.
- **Allowed behavior:** the canonical router accounting regression still passes. With a $0.30 budget, three $0.10 calls complete and the fourth returns `cost-limit`, with the provider called exactly 3 times and reserved cost $0.30 (`tests/model-cost.test.mjs:49-73`, ESM and CJS).
- **Remaining:** no tenant-isolated budget report exists to compare. **Open.**

### Re-verification of earlier fixes still claimed closed

| Fix | Result |
| --- | --- |
| H01D-01 (deterministic denials were retryable) | [T] `deterministic … denial is not retried` (`hanuman-fetch.test.mjs:289`); [R] A16 makes 0 requests under `maxRetries: 3`. Holds. |
| H01D-03 (no HanumanBot) | Present; [T] 88 bot tests. Holds. |
| H02D-01 (an invalid clock made a completed fetch retryable) | [T] `hanuman-bot.test.mjs:712`. Holds. |
| H04C-01 (preflight not bound to the executed plan) | [T] `workflow-safety-adversarial.test.mjs:201` A-N13. Holds. |
| H04B-01..05 | [T] regression tests at `workflow-safety-adversarial.test.mjs:149, 155, 364, 525, 568`. Holds. |

The H04 suite has 0 TODOs; H05-C had recorded 12.

## 9. Known limitations

- **Simulated controls.** Every network property here was exercised through an in-memory transport that reports peers, statuses and bytes. The SDK enforces what the transport reports. Actual DNS pinning, TLS verification, wire-level redirect refusal, host cookie and proxy behavior, and decoder memory are **unverified** until a reviewed transport exists (H01D-02).
- **Fixture inventory.** The H07-A plan has 80 rows, 338 numbered variants, 379 base records and roughly 1,000–2,000 expanded executions; 2 variants are implemented as `SHB-*` fixtures. Existing suites cover much of the same ground under other names (§1), but they are not keyed to the plan's IDs, invariants or audit-evidence fields.
- **Differential.** No 0.3.2 goldens and no D-01..D-08 differential scenarios exist. The baseline was built with the shared current toolchain.
- **Kubera and Jambavan** are absent (H05). Budget reporting cannot be audited.
- **Reproducers are ad hoc.** The H07-D probes and mutants are not part of `pnpm test`. They are kept only in ignored `node_modules/h07d-probes/`.
- **Timing.** T13 and T14 use real timers (208–211 ms and about 1.51 s). They show ordering and that the work settles, not precise latency.

## 10. Findings (P0/P1/P2/P3)

**Summary:**
- **P0:** none.
- **P1:** 2 open, both carried from earlier phases.
- **P2:** 2 new and 7 carried open.
- **P3:** 3 new and several carried.

### New findings

#### H07D-01 · P2 · A transport that ignores abort pins firewall leases permanently; the gateway `timeoutMs` is not a wall-clock bound

- **Affected:**
  - `src/integrations/hanuman/service.ts:158-193` (`await resolve(…)` and `await request(…)` are not raced against the gateway controller) and `:229` (`for await` over the body);
  - `src/security/firewall/runtime.ts:367-372`, where `active.size` includes revoked "draining" leases at admission.
- **Minimal reproducer:** `node_modules/h07d-probes/drain.mjs`, case "transport ignores abort", or `probes.mjs` T14 and T15.
  1. Use the documented host shape with `maxConcurrent: 3`.
  2. Give the transport a `request()` that returns `new Promise(() => {})` and ignores `signal`.
  3. Run once, wait 2 s, then run three more tasks.
- **Expected:** the gateway settles at its own deadline (200 ms) with `timeout`, and the protected path stays usable, or degraded capacity is bounded and visible.
- **Actual:**
  - The run settles only at the firewall deadline: 1,509 ms with a 1,500 ms firewall timeout, as `security-denied`.
  - `status()` keeps `active: 0, draining: 2` indefinitely.
  - The next three runs fail `busy` with **0 transport calls**.
  - With a request that ignores abort but settles after 1 s, the gateway settled at about 1 s instead of 200 ms.
- **Security impact:** availability and execution integrity only. It fails closed: no unauthorized effect, no data exposure. A single non-compliant or buggy host transport call disables protected retrieval for that firewall instance until restart. The documentation recommends "at least three concurrent reservations", so one stuck call is enough. Honoring `signal` is a documented host obligation (`docs/sdk.md:477`), which keeps this at P2.
- **Recommended remediation:**
  - Race each transport await (`resolve`, `request` and each `body.next()`) against the gateway controller's abort, so `execute` settles at `timeoutMs` while the orphaned promise is ignored.
  - Keep the conservative "draining" accounting, but surface stuck leases distinctly in `status()`. Document a host recovery procedure, such as recreating the firewall or adapter.
  - Whether a lease may be released while the transport might still be performing I/O is a design decision for the owner. Do not silently change lease semantics.
- **Regression requirement:**
  - A hung `resolve`, a hung `request` and a hung body each settle at the gateway deadline with a non-retryable outcome, through both RUDRA and the workflow path, in ESM and CJS.
  - `draining` is reported.
  - A later run's admission behavior is asserted explicitly.
  - Add a cooperative control where draining returns to 0.

#### H07D-02 · P2 · The required H07 canary inventory is still largely unimplemented (confirms and supersedes H07B-01)

- **Affected:**
  - `tests/fixtures/shabari-runner.mjs` (9 selections);
  - the missing `SHB-*` fixtures for H07-A §3–§5 (NET, AGT, RACE, MODE, CAN-P, CAN-N);
  - §7 invariants U1–U10;
  - §9 tripwire and mutations M1–M16.
- **Minimal reproducer:** `node tests/fixtures/shabari-runner.mjs SHB-NET-01.1` exits 2 (unknown selection). Only `SHB-NET-12.6` and `SHB-NET-12.7` resolve.
- **Expected:** Appendix A's P0/P1 rows exist as individual fixtures with the §7 assertion fields, plus `net`/`dns`/`tls` tripwires and detector-sabotage controls.
- **Actual:** 2 of 338 variants. The rest is either covered by un-keyed existing tests or not at all (§1, "critical boundaries without an automated test").
- **Security impact:** incomplete evidence; no bypass demonstrated. Under Step 11, a complete security pass cannot be claimed.
- **Recommended remediation:** implement in the plan's Appendix B order: P0 network and authority rows first, then the RACE and MODE matrices, then the mutation controls.
- **Regression requirement:** each implemented fixture records the §7.1 fields, and each security check has a mutant that fails at least one fixture.

#### H07D-03 · P3 · Invisible, bidi and tag characters pass verbatim into untrusted evidence

- **Affected:** `src/integrations/hanuman/service.ts:28-32` (`validText` rejects C0, C1 and DEL only) and `src/bots/hanuman.ts` (the excerpt is copied as-is).
- **Reproducer:** `node_modules/h07d-probes/invisible.mjs` sends a body containing U+200B, U+202E, U+202C, U+E0049, U+E0047, U+E004E and U+2028.
- **Expected:** these characters are neutralized, or flagged in the evidence, or the consumer obligation is documented.
- **Actual:** `completed`, with all 7 code points kept verbatim.
- **Security impact:** hidden instructions ("ASCII smuggling") or display spoofing aimed at a downstream model or human reviewer. There is no authority change inside SHIVAX.
- **Remediation:** document that excerpts can contain invisible or bidi characters and must be neutralized before display or model input. Optionally add a host-selectable policy to reject or flag Unicode tags and bidi overrides.
- **Regression requirement:** a fixture asserting the chosen behavior for each character class, in ESM and CJS.

#### H07D-04 · P3 · Test-depth gaps in the existing suites

- **Affected:** `tests/hanuman-fetch.test.mjs`, `tests/hanuman-integration.test.mjs` and `tests/shabari-runner.test.mjs`.
- **Gaps:**
  - Only 302 is tested among redirects (301, 307 and 308 are untested).
  - Only `gzip` is tested among encodings.
  - There is no `3fff::/20` boundary case.
  - There is no `fetch` tripwire in the integration suite, and no `net`/`dns`/`tls` tripwire anywhere.
  - SHB-NET-12.x asserts `active` but not `draining`.
  - The runner self-test re-runs whole suites inside `pnpm test`.
- **Impact:** a regression in these branches could go undetected. H07-D's reproducers show the current behavior is correct, except for H01D-09.
- **Remediation:** extend the parameterized lists, add the tripwires, assert `draining === 0`, and run the runner self-test against a lightweight stub suite.
- **Regression requirement:** the new cases fail against a mutant that removes each branch.

#### H07D-05 · P3 · File counts in the H07-A plan are inaccurate

- **Affected:** `docs/audits/hanuman-h07-attack-plan.md:475-476`.
- **Problem:** the plan says "42 files" for the baseline and "48 files" for the current suite. Both per-file count files list 40 and 46. The current repository has 47 top-level test files, the 46 plus `shabari-runner.test.mjs`. `pnpm test` runs `tests/*.test.mjs`, and `tests/audits/router-r00.test.mjs` is not in that glob.
- **Not affected:** the test totals (897, 1,444, 1,452) are correct.
- **Remediation:** correct the plan's counts when it is next revised.
- **Regression requirement:** none.

### Carried findings re-verified by H07-D (still open)

| ID | Sev | H07-D evidence | Status |
| --- | --- | --- | --- |
| H01D-02 | **P1** | No transport adapter exists in `src`. Every network property is mock-only. | Open. [D] |
| H03C-01 | **P1** | [R] A11: `run(ctx)` with no options completes with 1 request. [T] `S9 KNOWN GAP H03B-01` passes as a characterization. | Open |
| H03C-02 | P2 | [T] `S9 KNOWN GAP H03B-02` passes: the decoy `atlas` takes the route and Hanuman makes 0 requests. | Open |
| H03C-03 | P2 | [R] A14: session revoked in flight, result `completed` with evidence | Open |
| H03C-04 | P2 | [R] T14 and `drain.mjs`: the firewall deadline surfaces as `security-denied` | Open |
| H05C-01 / H07B-02 | P2 | `createKuberaReporter` and `createJambavanDiscovery` absent | Open |
| H06C-01 | P2 | [C] `examples/sdk/hanuman/host.mjs:174` `authorizeAdmin: () => true` | Open |
| H06C-02 | P2 | Not re-run; no new tests added | Open (not re-verified) |
| H01D-09 | P3 | [R] T04: `3fff::1` completes | Open |
| H01D-07 | P3 | [R] T05: `::ffff:808:808` gives `address-denied` (fails closed) | Open |
| H01D-08 | P3 | [C] `target.ts` hostname suffix list unchanged (no `lan`, `corp`, `intranet`, `in-addr.arpa`). The classifier backstops it. | Open |
| H01D-10 / H02D-05 | P3 | [C] `docs/sdk.md:654, 728` still say "when approval is required"; [R] A17 runs without approval when the host omits it | Open |
| H01D-11 | P3 | [C] `scripts/check-sdk-package.mjs:46` prints the gateway count without asserting it is above 0 | Open |
| H02D-04 | P3 | [R] A13: `new HanumanBot()` advertises `fetch.url` without a tool (fails closed) | Open |
| H03C-05/06/08/09, H04C-02/04/05, H06C-03/04/05 | P3 | Code unchanged since recorded; not individually re-probed | Open (not re-verified) |

## 11. Final GO / NO-GO

| H07 GO criterion | Status |
| --- | --- |
| No unresolved P0 | **Met.** None found or carried. |
| No unresolved P1 | **Not met.** H03C-01 (implicit capability allowlist) and H01D-02 (no reviewed transport). |
| Required canary tests passing | **Not met.** All implemented canaries pass, but 2 of 338 planned variants exist as fixtures (H07D-02). |
| Existing security regressions passing | **Met.** 1,452/1,452; focused 399/399; security 644/644; packed consumer PASS. |
| No known unauthorized network effect | **Met within the simulation.** No reproducer produced a transport call outside the registered target, origin, tenant or approval. The wire level is unverified (H01D-02). |
| No tenant-isolation regression | **Met.** A09, M05; [T] S4.7, S10 and L7; the H04B-01 regression passes. |
| No budget or accounting regression | **Met for router accounting.** $0.30 → 3 × $0.10 then `cost-limit` with 3 provider calls; token limits stay terminal (`model-safety.test.mjs`: `token-limit-exceeded`). Budget reporting is unavailable (H05). |
| No breaking SDK compatibility | **Met.** 0 exports removed; ESM/CJS parity; 13 declaration entries × 5 modes; seven default bots unchanged; Hanuman optional; SARASWATI shadow routing advisory only (L1, L13–L18). |

### **H07 decision: NO-GO**

The decision blocks:
- live Hanuman deployment;
- the 0.4.0 release;
- any claim of a complete H07 security pass.

**Verified security controls** (offline, through the real enforcement path):
- Jay context minting and the tenant/realm binding;
- Vijay permissions, tool grants and literal-`true` approval;
- NARASIMHA ENFORCE, MONITOR (mandatory rules kept) and LOCKDOWN, including mid-flight fences;
- the gateway checkpoint order, target directory and address classifier (except `3fff::/20`);
- redirect refusal, encoding refusal, byte and chunk caps at the exact boundary, and error sanitization;
- cleanup with cooperative transports;
- non-retryable deterministic denials;
- exact router cost and token accounting;
- the seven-bot roster and Hanuman opt-in;
- SARASWATI non-escalation.

**Simulated controls** (depend on the transport reporting truthfully):
- the peer pin check;
- rebinding detection;
- status, encoding and length metadata.

**Deployment-dependent controls:**
- DNS pinning on connect;
- TLS certificate and version policy;
- wire redirect handling;
- cookie and proxy stripping;
- decoder memory;
- honoring `signal` (H07D-01);
- approver correctness;
- the `requiresApproval` choice.

**Remaining operational risks:**
- a stuck transport exhausting firewall capacity (H07D-01);
- in-flight identity revocation not stopping a retrieval (H03C-03);
- implicit routing opt-in (H03C-01);
- first-by-ID route capture (H03C-02);
- hidden characters reaching downstream models (H07D-03);
- example-host admin configuration copied into production (H06C-01).

### Minimum work before an H07 re-review

1. Close H03C-01: an explicit allowlist for side-effecting capabilities, with the KNOWN GAP test inverted.
2. Either deliver and independently test the H01 transport in an isolated network environment, or have the owner formally descope it and record that 0.4.0 makes no wire-level SSRF or TLS guarantee.
3. Implement the H07-A P0/P1 fixture rows with tripwires and mutation controls (H07D-02).
4. Fix or formally accept H07D-01, H03C-03 and H03C-04, with regression tests.

## Changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h07-security-review.md` | New (this review) |
| `docs/audits/hanuman-h07.md` | New (H07 phase summary) |

The H07-C working-tree changes listed under Scope were preserved untouched. Logs and reproducers are in the ignored `node_modules/h07d-*.log` files and `node_modules/h07d-probes/`. Nothing was committed, pushed, tagged or published, Inspectra and Visynq were not touched, and H08 was not started. **H07-D stops here.**
