# SHIVAX 0.4.0 HANUMAN · H09-C final security audit of the frozen candidate

19 November 2026, Asia/Calcutta. **SECURITY: NO-GO.**

**Bottom line:**
- No P0 was found. No authorization, tenant-isolation or network-policy bypass of the SDK's own checks was reproduced.
- Two P1 findings remain unresolved. **H01D-02:** no transport exists to verify, so no production network enforcement can be confirmed. **H03C-01:** an implicit RUDRA capability allowlist.
- There is no CI execution evidence for this candidate.
- The required canary inventory is incomplete.

This review is read-only. It adds only this file. Nothing was fixed, no release metadata was changed, and nothing was published, pushed or tagged.

## 1. Audited artifact identity

| Field | Value | How verified |
| --- | --- | --- |
| Candidate source commit | `1f814226babdc55cad8f0cd58869664ddd5f6687` (branch `feat/hanuman-v0.4.0`) | `git rev-parse` |
| Repository HEAD at audit | `6aaed8b`. Adds only `docs/audits/hanuman-h09-package.md` and `hanuman-h09-validation.md` | `git diff --stat 1f81422 HEAD`. `src`, `package.json`, scripts, examples, tests and build configuration are unchanged |
| Frozen tarball | `node_modules/h09-candidate-1f814226/shivax-0.3.3.tgz`, 782,997 bytes, 551 files | Measured |
| SHA-256 | `e35aef8e0f810e60b2e57b466b2f11c30855f392f91b5f02e7e4518a9b6dbd12` | `sha256sum`. It matches `artifact.json` (H09-A), the H09-B record and both H08-C packs |
| Rebuild reproducibility | `pnpm build` + `npm pack --ignore-scripts` from the current tree produced the **same SHA-256** | H09-C gate run |
| Contents list | `contents.txt` equals the extracted tarball file list exactly | `diff` |
| Manifest | `version: 0.3.3`, target 0.4.0 HANUMAN, `engines.node >=22`, no `dependencies` or `optionalDependencies`, optional peer `inspectra-engine ^1.0.4`, no `bin` | Extracted `package.json` |
| Baseline | v0.3.2 = `37845c7`. v0.3.3 (`3f01ea1`) differs only in `VERSION` | `git diff` |

Every adversarial case in §9 ran against the **installed frozen tarball**, through `npm install --offline --ignore-scripts --package-lock=false` into a scratch consumer outside the repository, not against the repository `dist`.

## 2. Security architecture review

**Source drift since v0.3.2** (`git diff 37845c7 1f81422 -- src`, security-relevant subsystems only):

| Subsystem | Changed? |
| --- | --- |
| NARASIMHA firewall (`src/security/firewall/`) | **Unchanged** |
| RUDRA orchestrator and validation (`src/agents/`) | **Unchanged** |
| `ModelRouter` (`src/intelligence/`), `src/models/`, memory, SARASWATI (`src/learning/`) | **Unchanged** |
| `src/security/errors.ts` (+20) | Internal `NON_RETRYABLE` symbol and `isNonRetryable`. Sanitization keeps the flag. Tightening |
| `src/security/tools.ts` (+3) | Retained tool callbacks re-run `ensure()`, so they observe tool removal. Tightening |
| `src/security/vijay.ts` (+4) | Checkpoints re-assert the admitted policy and lease. Tightening |
| `src/workflows/engine.ts` (+130) | One frozen proposal snapshot used by both preflight and execution (H04C-01 fix), optional preflight and lifecycle, no retry of non-retryable failures |
| New | `src/integrations/hanuman/*` (gateway), `src/bots/hanuman.ts`, `src/workflows/safety/*` |

**Trust boundaries:**

| Boundary | Enforced by | Verdict |
| --- | --- | --- |
| Trusted host to SDK | Host-supplied identity provider, approver, policies, transport, firewall admin | By design. Every authority comes from host-registered objects. Nothing is auto-granted |
| Bot execution context | Jay-minted `TaskContext`, Vijay `runBot`, firewall leases (`protectExecution`) | Verified. Forged contexts are rejected (S4.1). A direct `tool.execute()` call with a forged context gives **`network-unprotected`** with 0 resolves, because the gateway requires an SDK-issued lease signal (`resources.has(signal)`), which only the firewall creates |
| Registered tool permissions | Vijay tool grant (`toolPermissions`), tool policy, approval | Verified. A missing grant or permission dispatches nothing. Approval must be the literal `true` |
| Tenant and session | Jay session scope; firewall realm check (`runtime.ts` `checkRoot`, mode-independent); gateway target issuer and scope check; per-tenant router scope; tenant-keyed observer records | Verified (§9 cases 6 and 14) |
| Approval | Vijay per action, per attempt | Verified. Approvals are never reused across steps. A revocation or policy fence during approval blocks dispatch. A host may omit `requiresApproval` (H01D-10) |
| Network egress | SDK: registered catalog, exact origin, reported-address and peer checks. Host: actual sockets, DNS, TLS, proxy, OS egress | **SDK side verified. The production side cannot be verified because no transport exists (H01D-02)** |
| Retrieved evidence | `trust: 'untrusted'`, fixed provenance, never read by planner, approver or firewall | Verified (case 7) |

**Paths around existing security that were tried** (`node_modules/h09c-probes/bypass.mjs`, run on the candidate):

| Attempt | Result | Transport effect |
| --- | --- | --- |
| `RudraOrchestrator` with no `security` | `bot-failed` (RUDRA refuses tool-bearing bots without Vijay) | resolve 0, request 0 |
| Vijay with permissive policies and auto-approval, but **no firewall** | `bot-failed` (the gateway reports `network-unprotected`) | resolve 0, request 0 |
| Direct `ProtectedToolRegistry.get(TOOL).execute()` with a forged context | `network-unprotected` | resolve 0, request 0 |
| `registry.register(new HanumanBot())` without the tool | Advertises `fetch.url`, but execution fails closed (H02D-04) | 0, 0 |

## 3. Network control verification

**What exists:** the SDK gateway enforces, in order:
1. lease and protection check;
2. target issuer and scope check;
3. firewall `checkExecution` and `checkNetworkAccess(url)`, re-run at every checkpoint;
4. resolve, then classify every reported address;
5. a frozen GET frame;
6. peer must be in the pin set, 3xx is refused, status 200 only, identity encoding only, media-type allowlist, declared-length and streamed byte and chunk caps, fatal UTF-8 decoding, output revalidation;
7. close exactly once.

**What does not exist:** a host transport. The candidate contains **no** HTTP client, DNS, socket, TLS or proxy code. The only `fetch(` in the package is the opt-in loopback Ollama adapter, which is unchanged from v0.3.2. Therefore:

| Control | SDK-enforced and verified offline | Production host requirement (unverified) |
| --- | --- | --- |
| Allowed origins | Exact registered HTTPS targets only (no user info, port, fragment, IP literal or internal suffixes); firewall exact-origin check in enforce **and** monitor mode (case 1) | Egress allowlist at OS, proxy or sandbox |
| DNS resolution | Up to 16 reported answers, **all** must be public, or the request is not dispatched (case 4) | A real resolver; DNS pinning on connect |
| Resolved IP validation | Classifier for 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, 192.0.0/24, 192.0.2/24, 192.88.99/24, 198.18/15, 198.51.100/24, 203.0.113/24, 224/3, `168.63.129.16`, and IPv6 outside 2000::/3 (2001::/23, 2001:db8::/32, 2002::/16, mapped and NAT64 forms). **`3fff::/20` is accepted (H01D-09, P3)** | Connect only to the vetted pin set |
| Redirects | Never followed: `redirect: 'error'`, and 301/302/303/307/308 are all denied after exactly 1 request with 0 body bytes read (case 2) | Wire-level redirect refusal in the transport |
| Loopback, private and link-local | Denied before dispatch (case 4; 61-case table in H07-A §2.4.4) | Same, at socket level |
| Cloud metadata | `169.254.169.254`, `fd00:ec2::254`, `168.63.129.16`, `100.100.100.200` and mapped forms are denied before dispatch. `metadata.google.internal`, `localhost`, IP literals, user-info and `http:` targets are rejected at registration (case 4) | Block metadata at the network layer |
| TLS validation | `https:` targets only | **Entirely host**: certificates, SNI and versions |
| Credential forwarding | The frame has exactly `accept` and `accept-encoding`, plus `credentials: 'omit'`. Caller headers and URLs are rejected by the closed input schema (case 5) | The transport must not add cookies, authorization or proxy credentials |
| Response limits | Declared length checked before any read; per-chunk byte and chunk caps; exact 512/513 boundary covered by tests and mutation-validated in H07-D (case 11) | Wire buffering caps |
| Decompression | Any `contentEncoding` other than null or `identity` is denied before the first body read (pulled 0). Transparent host decoding is still capped on delivered bytes (case 11) | Decoder memory limits |
| Streaming timeouts | A gateway deadline and checkpoint on every chunk, effective for cooperative transports (208–211 ms against 200 ms in H07-D). **Not a wall-clock bound for a transport that ignores abort** (case 10, H07D-01) | Honor `AbortSignal` everywhere |
| Cancellation and cleanup | Root abort, lockdown and policy fence each stop further reads. `close()` is called once after settlement, and leases drain for cooperative transports (case 9; `drain.log`) | Release sockets on abort |

**Verdict:** the simulated controls drive the real enforcement path (RUDRA, Jay, Vijay, firewall lease, gateway). No production transport or proxy exists, so **the actual network enforcement of the claimed restrictions cannot be verified**. That is H01D-02 (P1), unchanged.

## 4. Hanuman execution security

| Requirement | Evidence | Verdict |
| --- | --- | --- |
| Opt-in only | `createSpecialistBots()` returns the seven default IDs (frozen-artifact consumer; H08-C) | Pass |
| No automatic network permission | Registration grants nothing; `registerHanumanBot` throws `unavailable` without the tool | Pass |
| No direct unrestricted fetch | No `fetch`, `http`, `https`, `net`, `dns` or `tls` in the bot or gateway graphs. The verifier statically rejects them in `src/bots/hanuman.ts` | Pass |
| Host tool registration required | `registerHanumanFetchService` must receive a transport and targets; missing transport gives `invalid-input` | Pass |
| Capability admission | An explicit allowlist without `fetch.url` gives `capability-denied`, 0 dispatch. **Without options, the task's own capability is admitted (H03C-01, P1; re-verified A11)** | **Open P1** |
| Vijay authorization | Permission, grant and literal-`true` approval (cases 5, 6, 8; H07-D A03–A08) | Pass |
| Firewall policy | Enforce, monitor and lockdown (§5) | Pass |
| Bounded output | Body cap at the gateway; excerpt cap (default 4,096 UTF-16 units); root and firewall output envelopes | Pass |
| Untrusted classification | Every output has `trust: 'untrusted'` and fixed provenance (case 7) | Pass. Hidden Unicode passes through verbatim (H07D-03, P3) |
| Search requires a separate approved provider | `research.search` and `fetch.api` are reserved, not registered, and RUDRA fails closed. No search contract exists | Pass (absent by design) |

## 5. Firewall coverage

| Mode | Result on the candidate | Transport effect |
| --- | --- | --- |
| ENFORCE: origin not allowed | Denied | resolve 0, request 0 (case 1) |
| MONITOR: origin not allowed | Denied; mode stays `monitor` | 0, 0 (case 1) |
| MONITOR: mandatory deny rule, tenant mismatch | Denied (H07-D M03, A09; `policy.ts` relaxes only `optional` deny rules; realm check is mode-independent) | 0, 0 |
| LOCKDOWN before run | `security-denied` | 0, 0 (H07-D M06/M10) |
| LOCKDOWN during retrieval | `security-denied`; no further reads; `close` called once after settlement; leases drain to 0; the next run is denied with **no new dispatch** | 1 request total (case 9) |
| Policy fence during approval | Step 2 does not dispatch | request 1 of 2 (case 8) |
| In-flight rechecks | At each gateway checkpoint: after resolve, after request, per chunk, before completion | Effective for cooperative transports |
| In-flight Jay revocation at the provider only | **Completes** (H03C-03, P2; re-verified A14). Revoking during approval does block (case 8a) | — |

## 6. RUDRA and workflow integrity

| Area | Evidence | Verdict |
| --- | --- | --- |
| Deterministic routing | `src/agents` unchanged since v0.3.2. S3 routes all 29 default capabilities unchanged. First-by-ID capture when another bot offers `fetch.url` (H03C-02, P2; characterization test S9 passes) | Pass with an open P2 |
| Approval integrity | Per-step prompts (2 for 2 steps); stale or fenced approval cannot dispatch (case 8; S4.8) | Pass |
| Retry authorization | Workflow-path retries re-authorize with fresh approval up to the limit (`S7` subset 20/20). Deterministic denials are never retried (case 12: 0 requests). RUDRA does not retry Hanuman failures. `maxRetries > 3` gives `invalid-options` | Pass |
| Tool argument validation | Closed `{ targetId }` schema at both the Vijay policy and the gateway; injected URL or headers give `security-denied` with 0 resolves (case 5). Approver and host argument mutation cannot redirect (S4.10) | Pass |
| Plan mutation boundaries | Injected text cannot extend the plan (S6). A proposal that changes between reads cannot pass preflight with one plan and run another (H04C-01 regression A-N13) | Pass |
| Pause and resume | Resume after a revocation or policy change while paused is denied without dispatch (S10 cases in the Hanuman suite) | Pass |
| Cancellation | Root abort gives `cancelled` (cooperative); see case 10 for non-cooperative transports | Pass, with H07D-01 open |
| Resource limits and budgets | Firewall operation, concurrency, input, output and time limits. The exact $0.30 regression passes: 3 × $0.10 succeed, the 4th is `cost-limit` with the provider called 3 times (case 14; `model-cost`) | Pass |
| Provider fallback | Only through firewall-registered model routes; remote providers need `allowRemote`. A Hanuman denial never falls back to another tool, origin or bot (S7) | Pass |
| Fetched instructions as authority | Injected policy, approval and tool-call text left the policy version (1), targets, approvals and plan unchanged (case 7) | Pass |

## 7. Utility and check safety

| Utility | Finding |
| --- | --- |
| Abhimanyu (`runAbhimanyuPreflight`) | A static analysis over a frozen plan copy, with no side effects. It imports only the existing plan validators, holds no Jay, Vijay, registry or permission handles, and has no process access. Only `enforce` mode can refuse a start. Warning evidence contains no plan text (H04B-03 regression) |
| Ashwatthama (`createAshwatthamaObserver`) | In-memory, timer-free, bounded records of non-secret metadata. Its only effect is calling the operation's **own registered `cancel` callback, at most once**. It has no `process`, `kill`, `exit` or child-process access. Tenant probe (`ash.log`): tenant B's `cancel`, `scan` and same-name ref do not affect tenant A. The `scope` argument of `list`, `history`, `cancel` and `scan` is **caller-asserted**, so the observer must stay a trusted host object (H09C-02, P3) |
| Jambavan | **Absent** (no factory in any entry, runtime or declarations). No discovery surface exists. An unpermitted principal gets the identical `security-denied` with 0 resolves for a registered and an unknown capability, so there is no existence oracle (case 13) |
| Kubera | **Absent.** No second ledger exists: budgets live only in `ModelRouter` and the firewall reservations. Router scope isolation: a tenant-B request to a tenant-A router gives `scope-mismatch` with 0 provider calls and the ledger unchanged (case 14) |
| Shabari | Repository-only test harness (`tests/fixtures/`), not in the tarball. It spawns `node --test` child processes only for allow-listed suite names. It is not a bot and not exported |
| Hidden specialist bots | None. The roster and capabilities are identical to v0.3.2. `hanuman` is the only addition and is opt-in |

## 8. SARASWATI compatibility

- `src/learning`, `src/intelligence`, `src/memory` and the firewall are unchanged since v0.3.2.
- The SARASWATI and cost suites pass **252/252**. They cover:
  - curation authorization and dataset scope (`learning-governance`);
  - evaluation integrity (`learning-benchmarks`);
  - worker training (`learning-worker`);
  - activation approval and rollback (`learning-registry`);
  - shadow-routing non-interference, invalid and cross-tenant recommendations, lockdown freeze and approved policy rollback (`learning-routing` L1–L18);
  - exact cost and token accounting (`model-cost`, `model-safety`);
  - memory and ranking.
- NARASIMHA mandatory controls were not weakened: the firewall source is unchanged, and the four modified security files only add rechecks or keep retry suppression.

## 9. Independent test results

**Adversarial cases on the installed frozen candidate** (`node_modules/h09c-probes/adversarial.mjs`, log `adversarial.log`): **14/14 pass**. Every assertion checks side effects.

| # | Case | Side-effect evidence |
| --- | --- | --- |
| 1 | Unauthorized origin | Enforce and monitor: resolve 0, request 0, approvals 0 |
| 2 | Redirect into a denied destination | 301/302/303/307/308: request 1, close 1, body bytes 0, `redirect: 'error'` in the frame |
| 3 | DNS/IP change | Private peer after a public answer: denied, close 1. Answer turns private between steps: resolve 2, **request 1**. Peer outside the pin set: denied |
| 4 | Cloud metadata | 6 metadata and loopback addresses give request 0. 5 unsafe target URLs rejected at registration |
| 5 | Credential leakage | Smuggled `authorization`/`url` input gives resolve 0. Frame headers exactly `accept`, `accept-encoding`. A synthetic `sk-live-…` in transport exceptions is absent from the result, audit and observer events (observer fields are only `type`, `targetId`, `code`) |
| 6 | Cross-tenant tool invocation | Tenant B gives resolve 0. A forged direct tool call gives `network-unprotected`, resolve 0 |
| 7 | Prompt injection | 2 steps, 2 requests, both to the registered URL; `trust: 'untrusted'`; policy version unchanged |
| 8 | Stale approval | Revoked inside approval: request 0. Fence during step-2 approval: request 1 of 2. Two steps, two approvals |
| 9 | Lockdown during retrieval | No further reads; close 1 after settlement; draining 0; next run denied with no new request |
| 10 | Cancellation-ignoring adapter | Settles only at the 400 ms firewall deadline; **2 leases still draining after root abort; next admission `busy`** (H07D-01 reproduced) |
| 11 | Oversized or compressed response | 5 encodings give 0 bytes pulled. 40 MiB undeclared stream: 4,096 bytes pulled. Declared 50 MiB: 0 pulled. Close 1 |
| 12 | Retry budget | Transient: 1 request (RUDRA does not retry). Deterministic: 0 requests. `maxRetries: 4` gives `invalid-options`. The workflow path retries with fresh authorization (`S7` subset 20/20) |
| 13 | Unauthorized capability discovery | Jambavan absent; identical `security-denied` for registered and unknown capabilities; resolve 0 |
| 14 | Cost reporting isolation | Kubera absent. Cross-tenant router call gives `scope-mismatch`, 0 provider calls. $0.30: completed, completed, completed, failed; 3 provider calls; reserved $0.30 |

**H07-D reproducer replay on the candidate:** all 53 recorded outcomes are **identical** to H07-D, compared by diff with timings masked. The open findings H01D-09 (T04), H03C-01 (A11), H03C-03 (A14), H03C-04 and H07D-01 (T14/T15) are reproduced unchanged. Lease drain (`drain.log`) and hidden-Unicode (`invisible.log`) results also match.

**Gates and suites:** all run in H09-C on Windows 11, Node v22.23.2, pnpm 12.8.1. Logs are `node_modules/h09c-*.log`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | **1,452/1,452**; 0 failed, skipped, TODO or cancelled |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS: 186 + 88 + 13 packed tests, 12 + 4 examples, 10 browser graphs, 13 × 5 declaration modes, 550 files |
| `npm pack --dry-run` | 0 | PASS, 551 files |
| Repack SHA-256 | 0 | Identical to the frozen artifact |
| Hanuman suites | 0 | 395/395 |
| RUDRA, workflows, agents | 0 | 111/111 |
| Security and firewall ×4 | 0 | 262/262 |
| SARASWATI, cost, memory | 0 | 252/252 |
| H04 warning checks | 0 | 156/156 |
| Integration `S7` (retry and fallback) | 0 | 20/20 |
| Shabari self-test and canary runner (9 selections) | 0 | 4/4 and pass |

**CI evidence (Step 10):**
- `.github/workflows/package-verification.yml` defines Ubuntu and Windows × Node 22/24/26. That is GitHub Actions configuration only.
- The candidate commit `1f81422` is on the **GitLab** remote (`origin/feat/hanuman-v0.4.0`), and the repository has **no `.gitlab-ci.yml`**.
- The GitHub remote has only `main` at `3f01ea1`.
- No job IDs, run URLs or CI logs exist in the repository or the workspace. H09-B reports all six matrix jobs as NOT RUN.
- **No CI execution evidence exists for this candidate** (H09C-01). Linux was never exercised for it. H08-C's local Node 24 and 26 runs used the same artifact bytes but are local Windows runs, not CI.

**Supply chain (Step 9):** this is an artifact-level inspection, **not** a dependency supply-chain audit.

| Check | Result |
| --- | --- |
| Lifecycle scripts reaching consumers | None (`preinstall`, `install` and `postinstall` are absent). `prepack` runs only in the publisher's checkout |
| Runtime dependencies | None. The optional peer `inspectra-engine ^1.0.4` is not auto-installed |
| Packed files | 551; `contents.txt` matches |
| Source maps | No `.map` files or `sourceMappingURL` |
| Credential and environment files | No `.env*`, `.pem`, `.key` or `.p12` |
| Secret-shaped strings | No live-key, token, private-key or bearer-token patterns |
| Private paths | No drive or user paths |
| Native or executable files | No `.node`, `.exe`, `.dll`, shell scripts or shebangs |
| `child_process`, `eval`, `new Function`, `vm` | None executed. `eval(` appears only as a string in benchmark data |
| Network APIs | Only the pre-existing Ollama adapter (`dist/slm/ollama.js`, `dist/sdk/models.*`) |

The development toolchain is not lockfile-pinned: `pnpm-lock.yaml` is git-ignored and the CI command uses `--no-frozen-lockfile` (H09C-03).

## 10. Findings by severity

**Summary:**
- **P0:** 0.
- **P1:** 2 open, carried and re-verified.
- **P2:** 1 new and 9 carried.
- **P3:** 2 new and several carried.

### P1 (open, carried)

#### H01D-02 · No reviewed production transport; network enforcement is unverifiable

- **Location:** the absence of any transport in `src/`. The contract is in `src/integrations/hanuman/types.ts` (`HanumanFetchTransport`).
- **Reproducer:** inspect the tarball: no socket, DNS or TLS code. Every case in §3 runs against an in-memory transport.
- **Expected:** a reviewed transport that pins DNS to the vetted addresses, verifies TLS, refuses redirects at the wire, omits credentials and honors abort, tested in an isolated network.
- **Actual:** none. The SDK trusts whatever the host transport reports.
- **Impact:** SSRF, TLS and egress protection in production depend entirely on unreviewed host code.
- **Fix:** deliver and independently test a transport, or have the owner formally descope it and state that 0.4.0 makes no wire-level guarantee.
- **Regression:** an isolated-network suite (rebinding, redirect, TLS failure, credential stripping, decompression, abort).

#### H03C-01 · An implicit RUDRA capability allowlist admits Hanuman without an explicit host opt-in

- **Location:** `src/agents/rudra/validation.ts:25-26`, where `allowedCapabilities` defaults to `[capability]`.
- **Reproducer:** H07-D A11 on the candidate: `rudra.run(ctx)` with no options gives `completed`, 1 request.
- **Expected:** an explicit allowlist for side-effecting capabilities.
- **Actual:** admitted by default. The tool grant, Vijay, approval and firewall still apply.
- **Impact:** one defense-in-depth layer is missing at the routing boundary.
- **Fix:** require an explicit allowlist for protected and side-effecting capabilities, while keeping the legacy default for the seven built-ins.
- **Regression:** invert the `S9 KNOWN GAP H03B-01` test (expect `capability-denied`, 0 transport calls) in ESM and CJS.

### P2

#### H09C-01 (new) · No CI execution evidence for the frozen candidate

- **Location:** `.github/workflows/package-verification.yml`; remotes. The candidate is only on GitLab, with no GitLab CI configuration.
- **Reproducer:**
  - `git for-each-ref refs/remotes` shows `origin/feat/hanuman-v0.4.0 1f81422` and `github/main 3f01ea1`;
  - there is no `.gitlab-ci.yml`;
  - no run IDs or logs exist.
- **Expected:** recorded runs of the Ubuntu and Windows × Node 22/24/26 matrix on `1f81422`, with job IDs and logs.
- **Actual:** none. Only local Windows runs exist (Node 22 here; Node 24 and 26 in H08-C).
- **Impact:** Linux behavior and the full matrix are untested for this artifact. The release has no independent execution evidence.
- **Fix:** run the matrix on a CI system that actually executes for this branch (GitHub Actions on a pushed copy, or an equivalent `.gitlab-ci.yml`) and archive job IDs, logs and the tarball SHA-256. Pushing and CI changes are owner actions; this review did neither.
- **Regression:** CI must report the SHA-256 of the tarball it packed, matching `e35aef8e…`.

#### H07D-01 (carried, re-verified) · A cancellation-ignoring transport pins firewall leases

- **Location:** `src/integrations/hanuman/service.ts:158-229` (transport awaits not raced) and `src/security/firewall/runtime.ts:367-372` (draining leases count toward `maxConcurrent`).
- **Reproducer:** case 10.
- **Expected:** the operation settles at the gateway deadline and capacity recovers.
- **Actual:** it settles at the firewall deadline. 2 leases stay draining even after a root abort, and the next admission is `busy`.
- **Impact:** availability only. Fails closed.
- **Fix and regression:** as recorded in H07-D.

#### Other carried P2 findings (unchanged, see the H07-D and H08-C reviews)

- **H03C-02:** first-by-ID route capture.
- **H03C-03:** in-flight identity-provider revocation (A14).
- **H03C-04:** deadline reported as `security-denied`.
- **H07D-02:** canary inventory 2 of 338.
- **H05C-01:** Jambavan and Kubera absent.
- **H06C-01:** example host auto-approves admin.
- **H08C-01:** root-import documentation.
- **H08C-02:** SECURITY.md overstates recovery from stuck transports, still present at `SECURITY.md:159-161`.
- **H08C-03:** description says "(unreleased)".
- **H08C-04:** Inspectra 1.2.1 `shivax ^0.3` range.

### P3

#### H09C-02 (new) · Ashwatthama tenant scope is caller-asserted

- **Location:** `src/workflows/safety/ashwatthama.ts` (`scan`, `list`, `history`, `cancel` take a `scope` argument).
- **Reproducer:** `node_modules/h09c-probes/ash.mjs`. A holder passing tenant A's scope can list and cancel A's operations. Tenant B's calls do not affect A.
- **Expected:** the documentation states that the observer is a trusted host object and that scope is not authenticated.
- **Actual:** `docs/sdk.md` describes "per-tenant records" without this caveat.
- **Impact:** low. The records are non-secret metadata, and cancellation is the operation's own cooperative callback. It matters only if a host shares one observer with untrusted code.
- **Fix:** document the constraint, or bind the observer to a Jay context.
- **Regression:** a documentation check, or a test that a scope-bound observer refuses a foreign scope.

#### H09C-03 (new) · The development toolchain is not lockfile-pinned

- **Location:** `.gitignore` (`pnpm-lock.yaml`), and the workflow's `pnpm install --no-frozen-lockfile`.
- **Reproducer:** `git ls-files pnpm-lock.yaml` prints nothing.
- **Expected:** reproducible builds from a fresh checkout.
- **Actual:** the local rebuild reproduces the artifact byte for byte, but only with this machine's installed toolchain. A fresh CI install may resolve different compiler or bundler versions. `SECURITY.md` already acknowledges this.
- **Impact:** build provenance and supply-chain integrity for the release.
- **Fix:** commit the lockfile and use `--frozen-lockfile` before a stable release.
- **Regression:** CI reproduces the artifact SHA-256 from a clean checkout.

#### Carried P3 findings

- H01D-07, H01D-08 and H01D-09 (`3fff::/20` accepted; T04);
- H01D-10 and H02D-05 (approval optional; A17);
- H01D-11;
- H02D-04;
- H07D-03 (hidden Unicode);
- H07D-04 and H07D-05;
- H08C-05 to H08C-07;
- the remaining H03C, H04C and H06C P3 items.

## 11. Residual risks

1. **Production network safety rests on unreviewed host code.** DNS pinning, TLS, redirects, credentials, proxies and egress are all outside the SDK, and no reviewed transport exists.
2. **Defense in depth at routing:** an implicit capability allowlist and first-by-ID capture.
3. **Availability:** one non-compliant transport call can exhaust firewall concurrency until restart.
4. **Revocation latency:** identity-provider revocation affects in-flight retrieval only if the host aborts the root signal.
5. **Downstream content risk:** untrusted evidence can carry hidden Unicode and instruction-like text. Consumers must neutralize it before showing it or sending it to a model.
6. **Evidence gaps:**
   - no CI runs;
   - no Linux execution;
   - canary inventory 2 of 338 planned variants;
   - no dependency supply-chain audit;
   - no lockfile pin;
   - Inspectra was checked only at 1.2.1.
7. **Host misconfiguration:** approval can be omitted, and the example host's always-on admin could be copied into production.

## 12. SECURITY GO / NO-GO

| Criterion | Status |
| --- | --- |
| No P0 | **Met** |
| No unresolved P1 | **Not met:** H01D-02, H03C-01 |
| Actual transport or proxy enforces the claimed restrictions | **Not verifiable:** no transport exists |
| SDK-side controls effective on the frozen artifact | **Met:** 14/14 adversarial cases; 53/53 H07-D outcomes unchanged; all suites pass |
| Mandatory NARASIMHA, Jay/Vijay and SARASWATI controls not weakened | **Met:** unchanged or tightened source; suites pass |
| No unauthorized disclosure, authority, termination capability, second ledger or hidden bots | **Met** |
| Artifact identity consistent | **Met:** SHA-256 matches all records and a rebuild |
| CI execution evidence | **Not met:** none (H09C-01) |
| Required canary coverage | **Not met:** H07D-02 |

### **SECURITY: NO-GO** for the frozen candidate `1f814226` / `shivax-0.3.3.tgz` (`e35aef8e…bd12`) as v0.4.0 HANUMAN

The SDK-side security of the implemented features is sound within its offline scope. The release cannot be approved while:
- production network enforcement is unverifiable (H01D-02);
- the routing opt-in gap stands (H03C-01);
- no CI execution evidence exists (H09C-01);
- the canary inventory is incomplete (H07D-02).

## Changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h09-security.md` | New (this report) |

Reproducers and logs are in the ignored `node_modules/h09c-probes/` folder and `node_modules/h09c-*.log`. They were executed from a scratch consumer that installed the frozen tarball. Nothing was committed, pushed, tagged or published. No release metadata, source, tests or Inspectra/Visynq files were modified. **H09-C stops here.**
