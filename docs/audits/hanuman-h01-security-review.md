# SHIVAX 0.4.0 HANUMAN · H01-D security review

**17 November 2026 (Asia/Calcutta)** · Branch `feat/hanuman-v0.4.0` · Reviewed HEAD `bb81d38` (H01-B in `f9ffb85`, H01-C in `bb81d38`, baseline `df6298e`)

**Decision: H01 NO-GO.** There is no P0. The SDK gateway enforces Jay, Vijay, NARASIMHA, tenant, address, response and revocation checks at real enforcement points, and no review probe produced unauthorized SDK egress. However, two P1 issues block H01:

1. **H01D-01.** In `RudraWorkflowEngine`, fetch-service security denials become retryable `tool-error` failures. With host-enabled read retries, one redirect produced 4 approvals and 4 GET requests.
2. **H01D-02.** The trusted host transport, which is the only layer that pins sockets, verifies TLS and refuses redirects on the wire, does not exist and is untested. H01-C reported FAIL.

H01-D is a read-only review. The only file written is this document. No source or test was changed, and none of the findings below were fixed.

## Scope and method

| Inspected | Evidence |
| --- | --- |
| Reports | [`hanuman-h01-threat-model.md`](hanuman-h01-threat-model.md) (H01-A), [`hanuman-h01-enforcement.md`](hanuman-h01-enforcement.md) (H01-B), [`hanuman-h01-test-report.md`](hanuman-h01-test-report.md) (H01-C) |
| Git diff `df6298e..bb81d38` | 16 files. New: [`src/integrations/hanuman/`](../../src/integrations/hanuman/) (`types`, `target`, `address`, `error`, `service`, `index`). Changed: [`src/security/vijay.ts`](../../src/security/vijay.ts) (+4), [`src/security/tools.ts`](../../src/security/tools.ts) (1 line), [`src/sdk/integrations.ts`](../../src/sdk/integrations.ts) (+1 export), [`scripts/check-sdk-package.mjs`](../../scripts/check-sdk-package.mjs), [`tests/hanuman-fetch.test.mjs`](../../tests/hanuman-fetch.test.mjs), `SECURITY.md`, `docs/sdk.md` |
| Related source read for trust assumptions | `src/workflows/engine.ts` (retry predicate), `src/agents/validation.ts` (`record`, `array`, `snapshotValue`, `toolsForCapability`), `src/bots/base.ts` (`toolCall`), `src/security/firewall/runtime.ts` (`bindResources`, binding), `src/agents/rudra/orchestrator.ts` (retry gate) |
| Independent execution | Gates, focused suites, 13 offline reproductions, 11 mutation probes against built `dist/` bundles (restored and rebuilt afterward), and a RUDRA bot-path positive control. Scripts and logs are in the session scratchpad `h01d/` and are not committed. |

**Not present in the implementation:** `HanumanBot` (`src/bots/hanuman.ts`), any host transport, and any socket, TLS or DNS test. H01-B and H01-C both state this.

## Threat coverage matrix

Status: **Covered** = SDK enforcement plus a meaningful test. **Partial** = SDK enforcement present, but a host layer or test is missing. **Gap** = a defect was found.

| # | Threat | SDK control in code | Test evidence | Status |
| --- | --- | --- | --- | --- |
| T01 | SSRF via caller URL | `input()` admits exactly `{targetId}` through `record()`. URLs come only from the frozen catalog (`target.ts`). | `denies schema`, `denies unknown` → `resolve` count 0 | **Covered** |
| T02 | DNS rebinding | Every answer is classified. Mixed or empty answers and more than `maxAddresses` are denied. `peer` must be canonical, public and in the vetted set. One `resolve` per execution. | `denies address *` (19 cases), `peer` mismatch. Mutation M2 killed. | **Partial.** Host pinning is not implemented (H01D-02). Workflow retries re-resolve up to 4× (H01D-01). |
| T03 | Redirects | 3xx → `redirect-denied` before body. `redirect: 'error'` in the frozen request. | `redirect` (302 only). Mutation M7 killed. | **Gap / Partial.** Retried in workflows (H01D-01). Host non-following is unimplemented (H01D-02). |
| T04 | Private/internal IPs | IPv4/IPv6 deny ranges. Registration rejects IP literals, `localhost`, `.local`, `.internal`, `home.arpa`, single-label and trailing-dot hosts. | 19 address cases, 8 URL cases | **Covered** for addresses. Some hostname suffixes are accepted (H01D-08). |
| T05 | Loopback/link-local | `127/8`, `169.254/16`, `::1`, `fe80::/10` (outside `2000::/3`) | `127.0.0.1`, `::1`, `fe80::1` | **Covered** |
| T06 | Cloud metadata | `169.254.169.254`, `100.100.100.200`, `168.63.129.16`, `fd00:ec2::254` (ULA), `.internal` | Three in suite. `fd00:ec2::254` verified by probe R7. | **Covered** |
| T07 | URL parser ambiguity | `new URL(url).href === url`, `https:`, no userinfo, fragment or port, ASCII host regex. Firewall compares canonical `origin`. | 8 URL cases. Probe R8: backslash, `%6d`, `0x7f.1`, `[::1]` rejected. | **Covered** in the SDK. The transport parser is host-only. |
| T08 | IPv4/IPv6 variants | Strict dotted-quad without leading zeros. IPv6 must equal the WHATWG canonical form. Mapped, NAT64, 6to4 and Teredo forms are denied outright. Zone IDs and uppercase are rejected. | `01.2.3.4`, `::ffff:7f00:1`, `64:ff9b::…`, `2002:…`. Probe R7 boundaries are all correct except `3fff::/20` (H01D-09). | **Covered.** Mapped peers break interop (H01D-07). |
| T09 | Credential/header leakage | Frozen request with exactly `accept`, `accept-encoding: identity` and `credentials: 'omit'`. No response headers in the envelope. Fixed error message. | Request shape asserted inside the mock. Output validator rejects `headers`. Transport-exception secret test. | **Covered** in the SDK. Ambient host credentials depend on the missing transport (H01D-02). |
| T10 | Response-size exhaustion | `contentLength` precheck. Actual byte and chunk counting before copying. Identity-only encoding. Envelope budget through `snapshotValue`, `ToolLease` and Vijay. | `length`, `byte and chunk limits`, `gzip`, `output budgets`. Mutation M9 killed. | **Partial.** The byte-cap boundary is untested (M6 survived, H01D-04). |
| T11 | Binary/unexpected content | `text/plain` or `application/json` with an optional `utf-8` charset. Fatal UTF-8 decoding. C0, C1 and DEL rejected. JSON syntax checked. | `media`, `utf8`, `json`, `gzip` | **Covered** |
| T12 | Instructions in content | Envelope `trust: 'untrusted'`. The validator rejects `trust:'trusted'`. No planner, memory or learning call. Observers carry IDs and codes only. | `untrusted instructions remain inert`, `output validator rejects forged authority` | **Covered** |
| T13 | Timeout/cancellation races | Service deadline plus lease signal. `check()` after each await and per chunk. A late response is still closed. `close()` is awaited once. Ownership is retained while draining. | `late response … closed once`, `deadline aborts DNS`, `retains cleanup ownership`. Probe R11: slow body → failed, 0 outputs, close 1. | **Partial.** No abort-between-chunks test (M4 survived). `request.timeoutMs` ignores the lease deadline (H01D-06). |
| T14 | Cross-tenant | Target `issuer` and `scope` must equal the identity. Unknown and foreign targets look identical (`unknown-target`, `targetId: null`). Jay exact-context check. Firewall realm. | `tenant`, `issuer`, `forged context`. Mutation M3 killed. | **Covered** |
| T15 | Unauthorized retries | The service makes at most one `resolve` and one `request`. The RUDRA bot path is not retryable. | No retry test exists. | **Gap: H01D-01** |
| T16 | Revocation during async | `check()` re-runs the lease, firewall, Vijay policy identity, input predicate and expiry. Core tightening in `vijay.ts` and `tools.ts`. | 5 kinds after DNS, 9 phase×kind cases, approval-window change, 3 RUDRA bot cases. Probe confirmed the bot path completes in the positive control, so these tests are not vacuous. | **Covered** |

### Authorization (step 3)

| Check | Result |
| --- | --- |
| Vijay permissions and policies | Covered. Missing permission, capability policy or tool policy → `denied`, 0 DNS lookups. |
| Firewall checkpoints | Covered. `checkNetworkAccess(target.url)` and `checkExecution()` run before DNS, before the request, per chunk and after close. Monitor mode keeps mandatory denies (`mandatory destination rules also apply in monitor mode`). |
| Approval | Enforced by Vijay when the host policy sets `requiresApproval`. Not mandatory for the service (H01D-10). |
| Tenant isolation | Covered (T14). |
| No unguarded network execution | Covered. The service requires `checkExecution`, `checkNetworkAccess` **and** an SDK-issued `resources` boundary (`network-unprotected`). `denies unprotected` uses Vijay without a firewall. The `resources.has` layer itself is untested (M1 survived, H01D-04). |
| No privilege escalation | Covered. Read-only effect. Input cannot carry grants, URLs or headers. The output validator rejects authority fields. |
| No stale-policy bypass | Covered. The `vijay.ts` and `tools.ts` changes add re-assertion of the admitted policy and tool registration in retained checkpoints. `saved checkpoint expires` proves a retained `checkExecution` throws after completion. |
| No registration bypass | Covered. `ProtectedToolRegistry` rejects a duplicate `shivax.hanuman.fetch`. Unregistering mid-flight is denied (registration cases). Registration grants nothing. |

### Untrusted output (step 4)

Verified in code and tests: the result carries `trust: 'untrusted'` and is frozen by `snapshotValue`. `validateOutput` re-derives byte length, media type and text validity, and rejects `trust:'trusted'` and extra fields such as `headers`. Nothing in the service reaches planners, approvals, policies, the firewall admin, memory, SARASWATI feedback or training. Results are never cached, so content cannot cross tenants. Transport exception text and close failures are sanitized (`transport exception secrets never reach the result or observer`, `cleanup failure is sanitized`). **Residual:** fetched bodies can contain secret-like strings or Unicode bidi/confusable characters. Both are documented as host and consumer responsibilities.

## Findings by severity

No **P0** findings.

### P1: important protection missing

#### H01D-01 · Security denials become retryable workflow failures

- **Affected:** [`src/integrations/hanuman/service.ts`](../../src/integrations/hanuman/service.ts) (`check()` and all `HanumanFetchError` throws), interacting with [`src/security/tools.ts`](../../src/security/tools.ts) (`securityError(error, 'tool-error')`) and [`src/workflows/engine.ts`](../../src/workflows/engine.ts) (retries `SecurityError('tool-error')` for read-only routes while `attempt <= maxRetries`).
- **Root cause:** The service throws `HanumanFetchError` for every outcome, and its `check()` even catches the firewall's `SecurityError('permission-denied')` and rethrows it as `destination-denied`. `ToolLease` cannot recognize a non-`SecurityError`, so it maps all of them to `SecurityError('tool-error')`. That is exactly the code the workflow engine treats as a transient read failure. A deterministic security denial therefore loses its classification.
- **Reproduction (offline):** Use the `tests/hanuman-fetch.test.mjs` fixture composition (workflow engine, Vijay, firewall bound, tool policy `requiresApproval: true`). Call `engine.start(ctx, { actions: [{ id: 'fetch', capability: 'hanuman.fetch', input: { source: 'task' } }] }, { maxRetries: 3 })` with the mock transport returning `{ status: 302 }`. Then repeat with a peer outside the vetted set, a `resolve` returning `169.254.169.254`, and `authorizeTarget: () => false`.

  | Probe | Expected | Actual |
  | --- | --- | --- |
  | R1 redirect 302 | 1 approval, 1 GET | **4 approvals, 4 GET requests, 4 closes** |
  | R2 peer not in pin set (rebinding signal) | 1 resolve, 1 GET | **4 resolves, 4 GET requests** |
  | R3 metadata DNS answer | 1 resolve, 0 GET | **4 resolves**, 0 GET, 4 approvals |
  | R4 host `authorizeTarget` deny | 1 approval, 0 resolve | **4 approvals**, 0 resolve |
  | R5 control: default `maxRetries: 0` | 1 GET | 1 GET ✓ |
  | RUDRA bot path (probe) | 1 GET | 1 GET ✓. `toolCall` and `runBot` map failures to the non-retryable `tool-not-allowed`. |

- **Impact:** This is not an authorization bypass, because every attempt re-enters Jay, Vijay, the firewall and approval. But it violates threat-model T15 and I-7 and the existing SHIVAX invariant that security denials cannot trigger automatic retries. Each attempt re-runs host DNS and sends another request, which gives a rebinding or redirect attacker several timing attempts per approved action. It also sends a human approver repeated prompts for a request the policy already denied (approval fatigue). Hosts are most likely to enable read retries for network calls, which is exactly this tool.
- **Recommended fix (service only, no core change):** Throw a non-retryable `SecurityError` for deterministic denials. `securityError()` preserves known codes, and the engine retries only `tool-error`.
  - `destination-denied`, `network-unprotected`, `unknown-target` → `permission-denied`
  - `address-denied`, `redirect-denied`, `status-denied`, `media-type-denied`, `encoding-denied`, `invalid-encoding`, `response-too-large` → `invalid-output`
  - Keep `transport-error` and `timeout` as the only retryable outcomes, and `cancelled` as `cancelled`.

  Keep the fixed `HanumanFetchError` code for the host observer. Alternatively, document and test that Hanuman bindings must use `maxRetries: 0` and reject other bindings, but the classification fix is preferred.
- **Regression test:** For each denial code above, use the workflow engine with `maxRetries: 3` and assert `request ≤ 1`, `resolve ≤ 1` and `approvals === 1`. Also assert that a transient `transport-error` with `maxRetries: 1` makes exactly 2 attempts, each re-approved. Run in ESM and CJS, and in the packed-consumer run.

#### H01D-02 · No trusted host transport; TLS, pinning and wire-level redirect refusal are unimplemented and unverified

- **Affected:** Missing component. H01-C (`docs/audits/hanuman-h01-test-report.md`) records **FAIL: no Node host transport was implemented**.
- **Reproduction:** `git ls-files` contains no `HanumanFetchTransport` implementation. `tests/hanuman-fetch.test.mjs` uses only in-memory mocks whose `peer` and `status` are self-reported.
- **Expected vs actual:** Threat-model obligations R-H1 to R-H8 need a reviewed, tested transport: connect only to the vetted addresses, preserve SNI and Host, verify TLS, never follow redirects, add no ambient credentials, enforce a wire cap without decompression, honor abort, and isolate connection pools. Actual: only the contract and documentation exist. The SDK can validate only what a callback *reports* (threat model T02, T03 and T09 residuals).
- **Impact:** Any deployment today relies on host code nobody has reviewed. A naive transport that calls `fetch(url)` and reports the first resolved address as `peer` passes every SDK check while being fully exposed to DNS rebinding, redirect following and ambient credentials. The H01 security claim (SSRF resistance) cannot be made.
- **Recommended fix:** Complete H01-C. Build a Node-only transport outside core, either as an optional `adapters/`-style entry excluded from browser bundles or as a host example, with no new production dependency. Socket connections must use the pinned address and `servername`, `rejectUnauthorized` must stay on, and redirects must surface as status. Test it in an **explicit isolated network environment**: a loopback TLS fixture with a test CA, a rebinding resolver stub, redirect, oversized, slow-drip and reset servers, and an abort at each phase.
- **Regression test:** Adapter suite covering HF-08 to HF-15 against real sockets. Assert the connected `remoteAddress` equals the pin, TLS failures for a wrong hostname or untrusted CA, zero follow-up connections on 3xx, wire-cap abort, and close-on-abort within a bounded time.

### P2: reliability or compatibility defects

#### H01D-03 · The planned `HanumanBot` specialist is absent

- **Affected:** `src/bots/hanuman.ts` (missing). `HANUMAN_BOT_ID` is exported but only reserved.
- **Reproduction:** `import { HanumanBot } from 'shivax/bots'` → undefined. The RUDRA path is exercised only through an ad hoc `fetch-worker` test bot in `tests/hanuman-fetch.test.mjs`.
- **Expected vs actual:** H00 and H01-A specify an opt-in `SpecialistBot` with `toolCall` (which keeps the non-retryable mapping, see F6) and threat-model tests HF-01 and HF-02 for it. Actual: the bot was descoped in H01-B. Hosts must write their own bot, and nothing guarantees it keeps the `tool-not-allowed` mapping, makes no internal retries and declares a capability-scoped tool.
- **Impact:** The specialist contract is untested. A host-written bot that catches errors and returns `bot-error` would re-open the retry path through RUDRA (`maxRetries` ≤ 3).
- **Fix:** Implement `HanumanBot` as specified, or formally descope it in the H01 plan and document the bot obligations for hosts.
- **Regression test:** Default roster unchanged (seven bots, 29 capabilities). Explicit registration completes one fetch through RUDRA. RUDRA `maxRetries: 3` with a failing transport → exactly 1 request.

#### H01D-04 · Tests leave key controls unproven (surviving mutations and boundary gaps)

- **Affected:** `tests/hanuman-fetch.test.mjs`
- **Reproduction:** Apply each mutation to `dist/sdk/integrations.{esm.js,cjs}` and run `node --test tests/hanuman-fetch.test.mjs`. Results:

  | Mutation | Result | Meaning |
  | --- | --- | --- |
  | M1 drop `resources.has(context.signal)` | **Survived** | The forged-callback layer is untested. Only Vijay-without-firewall is covered, and that fails earlier. |
  | M4 drop per-chunk `check()` | **Survived** | The post-loop check still blocks publication, but early stop on revocation or abort between chunks is untested. |
  | M6 byte cap off by one (`cap + 1` accepted) | **Survived** | No exact-cap or cap+1 boundary test. |
  | M5 drop check after `close()` / M8 drop check before `request()` | Survived | Acceptable. These are redundant with `ToolLease`'s post-execute checkpoint and the check after `resolve`. Documented as layering, not as test failures. |
  | M2 peer membership, M3 tenant, M7 redirect, M9 length precheck, M10 status | Killed | Meaningful assertions. |

  Also missing: retry tests (H01D-01), classifier boundary tests (first and last address in each range; probe R7 shows the implementation is correct except H01D-09), `fc00::/7`, `ff00::/8`, Teredo, `240/4`, `255.255.255.255`, non-canonical IPv6, redirects other than 302, an abort between chunks, and a private `peer` with a public `resolve`.
- **Impact:** A future regression in these controls would pass CI (false confidence).
- **Fix:** Add the tests listed. Do not change the service.
- **Regression test:** Every mutation above (except the documented redundant layers) must fail at least one test. Keep a mutation checklist in the test report.

#### H01D-05 · Security-core edits lack dedicated regression coverage and accurate provenance

- **Affected:** [`src/security/vijay.ts`](../../src/security/vijay.ts) (the `#authorized` work checkpoint now re-runs `#assert`), [`src/security/tools.ts`](../../src/security/tools.ts) (the checkpoint calls `ensure()`). Commit `f9ffb85` is titled *"Refactor code structure for improved readability and maintainability"*.
- **Reproduction:** `git show f9ffb85 -- src/security`. `tests/security.test.mjs` has no new case. The new semantics are exercised only by the Hanuman suite.
- **Expected vs actual:** H01-A listed `src/security/**` as unchanged. H01-B justifies and documents the deviation. The change is a sound tightening: all 897 pre-existing tests and 170 fetch tests pass. However, it changes behavior for every protected service (memory, inspection, model tools). Host `validateInput` and tool predicates now run on every checkpoint, including per chunk, and the commit message hides a security change.
- **Impact:** Reviewers and bisecting may miss a security-relevant change. Hosts with expensive or side-effecting predicates see more calls.
- **Fix:** Add security-suite tests independent of Hanuman (policy replaced or tool unregistered while a retained checkpoint is used, for the RUDRA, workflow and `runOperation` paths). Document "predicates may run at every checkpoint" in `docs/jay-vijay-security.md`. Record the deviation in the release notes. Do not rewrite history. Use an accurate message for future commits.
- **Regression test:** The cases above in `tests/security.test.mjs`, ESM and CJS.

### P3: documentation or minor improvements

| ID | Affected | Reproduction and observation | Recommended fix and test |
| --- | --- | --- | --- |
| H01D-06 | `service.ts` (`timeoutMs` passed to `resolve` and `request`) | Probe R9/R12: firewall lease 200 ms → `request.timeoutMs = 9999`. Enforcement still happens through the lease abort, but the field contradicts the H01-A contract ("min with lease deadline"). | Document the field as the service deadline only, or compute the minimum with the remaining root and lease time where known. Test: lease shorter than the service limit. |
| H01D-07 | `address.ts`; `docs/sdk.md` | Probe R6: a dual-stack socket reporting `::ffff:8.8.8.8` as `peer` → `address-denied`. Fails closed, but real Node adapters often report this form. | Document that hosts must report the unmapped IPv4 form, or accept mapped peers only when the embedded IPv4 is in the vetted IPv4 set. Test both. |
| H01D-08 | `target.ts` | Probe R8: `https://intranet.corp/`, `router.lan`, `printer.localdomain` and `1.0.0.127.in-addr.arpa` are accepted at registration. The address classifier backstops this. | Add `lan`, `localdomain`, `corp`, `intranet`, `in-addr.arpa`, `ip6.arpa` (and an optional host deny list) to the suffix rules. Test each. |
| H01D-09 | `address.ts` | Probe R7: `3fff::1` (documentation prefix `3fff::/20`, RFC 9637) is accepted. It is not globally routed, so the impact is low. | Deny `3fff::/20`. Test the boundaries. |
| H01D-10 | `docs/sdk.md` | The recipe says "Set `requiresApproval: true` … when approval is required". H01-A (F5 and the recipe) specifies approval as required for the tool policy. The service cannot detect its absence. | Make approval the documented default for `shivax.hanuman.fetch` and state the risk of omitting it. Optionally ship a policy helper. Test: helper policy requires approval. |
| H01D-11 | `scripts/check-sdk-package.mjs` | The packed-consumer step prints `Packed protected fetch passed: ${count}` but never asserts `count > 0`, so `undefined` would still pass. | Assert that the parsed count is a positive number. |

## Verified tests (independent runs)

Windows x64, Node `22.23.2`, pnpm `12.8.1`, offline, mocks only, with a `globalThis.fetch` tripwire. Logs are in the session scratchpad `h01d/`.

| Run | Result |
| --- | --- |
| `node --test tests/hanuman-fetch.test.mjs` | PASS: **170/170** (ESM and CJS) |
| Focused: `hanuman-fetch`, `security`, `firewall-integration`, `workflows`, `rudra`, `specialists`, `sdk` | PASS: **377/377** |
| `pnpm lint` | PASS (exit 0) |
| `pnpm test` | PASS: **1067/1067**, 0 failed, cancelled or skipped |
| `pnpm build` | PASS (exit 0) |
| `pnpm verify:package` | PASS: 170 packed fetch tests, 13 entries ESM and CJS, five declaration modes, 11 offline examples, 528 files |
| Reproductions R1–R12 (scratch script, built SDK) | R1–R4 confirm H01D-01, R6 confirms H01D-07, R7 confirms H01D-09, R8 confirms H01D-08, R9/R12 confirm H01D-06. R10: `authorizeTarget` receives a deeply frozen target ✓. R11: slow body past the deadline → failed, 0 outputs, 1 close ✓. |
| Mutation probes M1–M10 (dist only; restored and rebuilt, then re-verified at 170/170) | Killed: M2, M3, M7, M9, M10. Survived: M1, M4, M6 (gaps, H01D-04) and M5, M8 (redundant layers). |
| RUDRA bot-path positive control (scratch copy of the fixture) | 4/4: the bot fixture completes with exactly 1 request, and a redirect is not retried. This confirms the existing bot-path revocation tests are not vacuous. |

## Remaining risks (after required fixes)

- SHIVAX validates **reported** DNS, peer and status values. Real isolation depends on the host transport and OS/proxy egress controls (R-H1 to R-H8). This holds even after H01D-02 is fixed.
- An already-sent GET cannot be undone by revocation. Blind SSRF side effects are prevented only by host pinning and network policy.
- Non-cooperative transport, iterator or `close()` code can hold a draining lease indefinitely. The SDK can report it but cannot terminate it.
- Identity-provider revocation is immediate only when the host aborts the root signal. Checkpoints check expiry and policy synchronously.
- Fetched text may contain secret-like strings, prompt-injection text or bidi/confusable characters. Downstream consumers must preserve `trust: 'untrusted'`.
- Hosts that bind the tool into other workflows or write their own bots must keep zero retries and the existing governance paths.

## Required fixes before H01 GO

1. **H01D-01:** classify deterministic denials as non-retryable, and add the retry regression tests (workflow and RUDRA, ESM and CJS, packed consumer).
2. **H01D-02:** deliver and independently test the host transport in an isolated network environment, or have the project owner formally descope it from H01 and state in the release documentation that no SSRF guarantee exists without a reviewed host transport.
3. **H01D-03:** implement and test `HanumanBot`, or formally descope it with documented host-bot obligations.
4. **H01D-04 and H01D-05:** close the surviving-mutation and boundary gaps, and add Hanuman-independent security-suite tests for the `vijay.ts` and `tools.ts` changes.
5. Recommended (non-blocking): H01D-06 to H01D-11.

## H01 GO / NO-GO

**NO-GO.** P0: 0 · P1: 2 · P2: 3 · P3: 6.

The H01-B SDK gateway is sound in its authorization, tenant, address, content, cancellation and revocation controls, and it can continue as the base for remediation. H01 cannot be accepted while security denials are retryable (H01D-01) and while the trusted transport layer that the threat model depends on is unbuilt and unverified (H01D-02). Re-review after the required fixes, focused on the retry tests, the transport's isolated-network suite and the mutation checklist.

H01-D wrote only this document. No push, tag, publish or fix was made, and no next phase was started. **H01-D stopped here.**
