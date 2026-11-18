# H06-C independent review: portable non-Inspectra use cases

18 November 2026, Asia/Calcutta. Reviewed HEAD `e08feab` (H06-B) on branch `feat/hanuman-v0.4.0`, package `0.3.3`, Node v22.23.2, pnpm 12.8.1, TypeScript 7.0.2. Reviewer roles: SDK architecture, application security and technical documentation.

**Decision: H06 CONDITIONAL GO for the offline portable-example scope. No P0 or P1.** Two P2 and three P3 findings are open. This is not a release decision. Live Hanuman deployment and the 0.4.0 release stay **NO-GO** because H01, H03, H04 and H05 remain open (see §9).

## Scope and method

The H06-A and H06-B reports were treated as claims, not evidence. The review covered:

- the H06 commits `d996dba` and `e08feab`;
- every file in `examples/sdk/hanuman/`, and `tests/hanuman-examples.test.mjs`;
- the `package.json` `files` allowlist and the H06 additions to `scripts/check-sdk-package.mjs`;
- the production path the examples actually run.

That path is `src/integrations/hanuman/{service,target,address,types}.ts`, `src/bots/hanuman.ts`, `src/bots/base.ts` (`toolCall`), `src/agents/rudra/orchestrator.ts` (plan validation, routing, retry gate), `src/security/firewall/policy.ts` (`evaluate`) and `src/security/firewall/runtime.ts` (admin `update`, `protectExecution` binding).

`git diff 0e9de85 HEAD -- src` is empty, so H06 changed no production source.

The independent work was:

1. A diagnostic harness (outside the repository) recorded the gateway error behind each denial case. It did this by wrapping `ProtectedToolRegistry.register`, not by editing examples.
2. A temporary probe ran RUDRA against the reserved `research.search` and `fetch.api` IDs.
3. A separate packed-tarball install into a scratch consumer outside the source tree, with TypeScript declaration checks and negative controls.
4. All required gates were run.

## 1. API compatibility

Every example imports only `shivax/bots`, `shivax/integrations`, `shivax/rudra`, `shivax/security`, the sibling `./host.mjs` and `node:assert/strict`. No example imports `src/`, `dist/`, a relative package path, Inspectra or Visynq. In the installed consumer, `import('shivax/src/bots/hanuman.js')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Every example therefore runs on public exports.

| Area | Public API used | Verified behavior |
| --- | --- | --- |
| Construction | `createSpecialistBots`, `BotRegistry`, `ProtectedToolRegistry`, `PermissionPolicyRegistry` | Seven default bots, then opt-in Hanuman. `registerHanumanBot` throws `unavailable` before the service exists. |
| Registration | `registerHanumanFetchService`, `registerHanumanBot`, `HANUMAN_FETCH_TOOL_ID` | One explicit service and one explicit bot. Registration grants nothing. |
| Permissions | `Jay`, `Vijay`, `createShivaxFirewall({ protectExecution: true })` | Capability and tool policies, task tool grant, approval callback, firewall operations and origins. |
| Bot execution | `RudraOrchestrator.run(context, { allowedCapabilities, maxSteps, maxRetries })` | Single step by default, host planner for the workflow. |
| Workflow | Host `planner.plan()` returning `fetch.url` steps | RUDRA validates against `allowedCapabilities` and `maxSteps` before any step runs. |
| Result handling | `bot.validateOutput(evidence, 'fetch.url')` | Evidence schema, `trust: 'untrusted'`, provenance and source reference all checked. |
| Error handling | `result.status`, `result.error.code`, `result.trace` | Sanitized codes. See H06C-03. |
| Cancellation | Root `AbortController` signal passed to `jay.createContext` | Status `cancelled`, gateway `cancelled`, zero requests. |

A consumer `.mts` and `.cts` file using the same APIs and types type-checked under NodeNext, Node16 and Bundler. The types used were `HanumanFetchTransport`, `HanumanFetchServiceOptions`, `HanumanTransportResponse`, `HanumanFetchEvent`, `HanumanEvidence` and `HanumanFetchUrlInput`. It included an `@ts-expect-error` proving `HanumanEvidence['trust']` is the closed literal `'untrusted'`. A negative control (a non-existent export plus a private `shivax/src/...` path) failed as expected with TS2305 and TS2307. ESM/CJS key parity for the four entries is asserted by the H06 suite and passes.

**Result: PASS.** No example works only because of a private import.

## 2. Portable examples verified

| Example | Run (installed consumer) | Observed output |
| --- | --- | --- |
| `documentation.mjs` | exit 0 | Evidence: `bytes: 86`, `truncated: false`, `retrievedAt: 2026-11-18T00:00:00.000Z`, `evidenceId: hanuman:a160c43c…a94f`, `trust: untrusted`, Hanuman provenance, and the injection sentence kept as excerpt data |
| `rest.mjs` | exit 0 | `{"status":"ok","version":1,"source":{"kind":"registered-target","targetId":"demo-docs"},"trust":"untrusted"}` |
| `workflow.mjs` | exit 0 | `status: completed`, the fixed summary, two source refs, `audit: {steps: 2, requests: 2}` |
| `denials.mjs` | exit 0 | Eight sanitized lines, matching §5 |

## 3. Host transport review

| Requirement | Evidence | Result |
| --- | --- | --- |
| Transport is explicitly registered | `host.mjs` calls `registerHanumanFetchService` on its own `ProtectedToolRegistry`. Nothing is global or automatic. | PASS |
| Network simulated offline | `resolve()`/`request()` return in-memory data. The suite stubs `globalThis.fetch` and asserts zero calls. A static check rejects `fetch(` and `node:http/https/net/dns` in `host.mjs`. | PASS |
| Request and response bounded | Gateway sends a frozen `GET` with `credentials: 'omit'`, `redirect: 'error'`, `maxBytes: 512`. The mock asserts all three. The oversized case is rejected as `response-too-large` from the declared length. Streaming and chunk limits are covered by `tests/hanuman-fetch.test.mjs`. | PASS |
| Cancellation honored | `cancel`: root abort during resolve gives gateway `cancelled`, RUDRA `cancelled`, request 0. `timeout`: the mock waits on the gateway's own signal, which fires at about 205 ms, giving gateway `timeout` and request 0. | PASS |
| Provenance preserved | `source.kind: registered-target`, `targetId`, `provenance.{botId,capability,toolId}`, and a scope-bound digest. | PASS |
| Returned evidence untrusted | `trust: 'untrusted'` at both the tool and bot layers. The workflow never passes evidence into planning or tool arguments. | PASS |
| No real network | Confirmed in the repository and in the external consumer. | PASS |
| No secret-bearing output | No credentials exist in the host. Outputs exclude URL, headers, peer and exceptions. Denials print only reason, status, code and request count. | PASS |
| Fake transport not presented as production SSRF-safe | Code comments and the H06-B README say so. H06-C adds explicit statements to `docs/sdk.md`, `SECURITY.md` and the example README. | PASS (documentation strengthened) |

The mock reports peer `8.8.8.8`. This is needed because the gateway rejects private and documentation ranges. Nothing connects to it. This is now documented.

## 4. RUDRA workflow review

| Check | Evidence | Result |
| --- | --- | --- |
| Hanuman opt-in | `createSpecialistBots()` returns seven bots (`src/bots/system.ts:43-52`). Hanuman is added only by `registerHanumanBot`. | PASS |
| Seven default IDs unchanged | The test asserts the exact order `sanjay, brihaspati, vishwakarma, chitragupt, narad, yudhishthir, ekalavy, hanuman`. | PASS |
| Valid capabilities required | `orchestrator.ts:228,255` gives `capability-denied` outside the allowlist and `missing-capability` with no bot. The probe confirmed both for `research.search` and `fetch.api`, with no fallback to `fetch.url`. | PASS |
| Workflow bounds active | `maxSteps` is validated by `validatePlan`. Output is snapshotted against the firewall lease and task output budget. Firewall concurrency and lifetime limits apply. | PASS |
| Evidence cannot change permissions | The test asserts `firewall.runtime.snapshot()` is the same object before and after the workflow. Steps use `source: 'task'` only. | PASS |
| Prompt injection untrusted | The injection sentence appears in both excerpts. Selections are exactly `['hanuman','hanuman']` and requests exactly 2. | PASS |
| Outputs follow schemas | `validateOutput` runs for each step. The summary keys are a closed set. | PASS |
| No forbidden fallback | The reserved-capability probe gives a failed status. Denials never complete. | PASS |
| Retries require authorization | `orchestrator.ts:388-439` retries only on `bot-error` with a read-only effect, within `maxRetries`. Every gateway failure becomes `tool-not-allowed` (`src/bots/base.ts:114-120`), which is not retryable. The H06 assertion of zero retries is weak because `maxRetries: 0` (H06C-04). Retry classification with `maxRetries: 3` is covered in `tests/hanuman-integration.test.mjs`. | PASS |

The custom planner in `workflow.mjs` is host authority, not caller or evidence authority. It cannot name bots or permissions. H03C-01/H03C-02 (implicit eligibility) remain open and unaffected.

## 5. Security and denial evidence

The diagnostic harness recorded the actual layer for each case. Each case changes one option against the passing default control.

| Case | Public status/code | RUDRA outcome entry | Internal cause | resolve / request / close |
| --- | --- | --- | --- | --- |
| deniedOrigin | failed / bot-failed | `tool-not-allowed` | NARASIMHA `evaluate`: tool `networkOrigins` not in policy (`policy.ts:145`). The gateway is never entered. | 0 / 0 / 0 |
| missingTool | failed / bot-failed | `tool-not-allowed` | No protected tool | 0 / 0 / 0 |
| noPermission | failed / security-denied | none (before plan) | Vijay permission | 0 / 0 / 0 |
| expired | failed / security-denied | none (before plan) | Jay session expiry | 0 / 0 / 0 |
| lockdown | failed / security-denied | none (before plan) | NARASIMHA lockdown | 0 / 0 / 0 |
| timeout | failed / bot-failed | `tool-not-allowed` | Gateway `timeout` | 1 / 0 / 0 |
| cancel | cancelled / cancelled | state `cancelled` | Gateway `cancelled` | 1 / 0 / 0 |
| oversized | failed / bot-failed | `tool-not-allowed` | Gateway `response-too-large` | 1 / 1 / 1 |
| (control) | completed | completed | none | 1 / 1 / 1 |

Step 2 security matrix:

| Threat | Verdict and evidence |
| --- | --- |
| Bypass Vijay | No. `noPermission` is denied before planning. The tool policy needs `network.fetch`, a grant and literal `true` approval. The gateway also rejects contexts without SDK-issued resources (`network-unprotected`, gateway suite "forged context"). |
| Bypass firewall | No. `protectExecution: true` binds every bot and tool operation. The origin and lockdown cases are denied. |
| Implicit network permission | No. The policy origin list must contain the exact origin, and the origin is fixed by the catalog. |
| Bypass origin checks | No. The caller supplies only `targetId`. A URL in the input is rejected by the bot schema and the gateway (gateway suite `schema` case). |
| Execute remote instructions | No. Evidence is never routed into planning, tool arguments, approvals or policy. |
| Change RUDRA planning authority | No. Only host code supplies the planner. RUDRA re-validates the plan. |
| Reveal host credentials | No credentials exist. Requests omit credentials, and results exclude headers, URLs and peers. |
| Cross tenant | Not exercised by H06 scripts. Covered by the gateway suite: `tenant` and `issuer` cases are denied before resolve. The digest is scope-bound. |
| Register tools secretly | No. Only `shivax.hanuman.fetch` is registered, explicitly. |
| Disable mandatory security | Not disabled. `audit.required: false` and the always-true `authorizeAdmin` are fixture choices with no bypass path from bots or evidence. Both are copy hazards (H06C-01). |

## 6. Packaging verification

- The `package.json` `files` entry `examples/sdk/hanuman` ships `README.md`, `host.mjs`, `documentation.mjs`, `rest.mjs`, `workflow.mjs` and `denials.mjs`. The tarball has 551 files, with no `src/` or `tests/` entries.
- Independent consumer: `npm pack --ignore-scripts` went to a scratch directory, then `npm install <tgz> --offline --ignore-scripts` into an empty `type: module` project outside the repository. It added exactly one package (`shivax`). There was no sibling checkout or workspace link.
- All four examples passed from `node_modules/shivax/examples/sdk/hanuman/`.
- `require.resolve('inspectra-engine')` and `require.resolve('visynq')` give `MODULE_NOT_FOUND`.
- Declarations resolve as described in §1.
- Browser/Node split:
  - In the packed ESM graphs of `sdk/bots`, `sdk/integrations`, `sdk/rudra` and `sdk/security`, a scan found no `node:` or bare external imports.
  - The example scripts are Node-only because they use `node:assert/strict` and top-level await. This is now stated in the docs.
  - `verify:package` bundles only the root, bots and integrations graphs for browser safety. The rudra and security results come from the H06-C scan only.
- `pnpm verify:package` also ran the four examples and the 13 copied tests from its own external consumer, both passing.

## 7. Documentation changes

| Path | Change |
| --- | --- |
| `docs/sdk.md` (ships) | New "Portable Hanuman examples (H06)" section, plus a pointer in "Examples". It covers: run commands; the shared trusted host configuration and its production replacement; a limits table; **A** documentation retrieval, **B** REST GET, **C** RUDRA workflow, **D** denials and lockdown (per-case table with stop layer and counters), **E** optional search provider (states it is unavailable, that RUDRA fails closed, and the requirements for any future contract). Each example gives purpose, prerequisites, trusted host configuration, permissions, origins, limits, run command, expected result, security behavior and limitations. It explicitly says SHIVAX has no native web search, crawler or general HTTP client. |
| `examples/sdk/README.md` (ships) | Four table rows for the `hanuman/` scripts. Existing rows are unchanged. |
| `examples/sdk/hanuman/README.md` (ships) | Corrects the inaccurate claim that the admin policy "authorizes only the example's lockdown setup". Adds a fixture-only admin warning, the public-error and `observe` note, a link to the guide and installed-package run paths. |
| `SECURITY.md` (ships) | New "Hanuman offline examples (H06)" section: fake transport is not SSRF proof, fixture admin warning, no native search, reserved IDs fail closed, sanitized errors. |
| `docs/audits/hanuman-h06-review.md`, `docs/audits/hanuman-h06.md` | This report and the phase summary. |

No existing demo, example, test, script or production source was modified.

## 8. Exact test counts

Process-local environment, as in H06-A/B: `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted`, `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`. Final runs were taken after the documentation edits. Logs are ignored under `node_modules/h06c-*.log`.

| Command | Result |
| --- | --- |
| `node --test tests/hanuman-examples.test.mjs` | PASS, **13/13**, 0 fail/skip/todo/cancelled |
| `node --test tests/hanuman-examples.test.mjs tests/hanuman-fetch.test.mjs tests/hanuman-bot.test.mjs tests/hanuman-integration.test.mjs` | PASS, **391/391**, 0 fail/skip/todo/cancelled |
| Security regression: `security`, `firewall`, `firewall-integration`, `firewall-management`, `firewall-model-integration`, `rudra`, `workflows`, `workflow-safety`, `workflow-safety-adversarial` | PASS, **498/498**, 0 fail/skip/todo/cancelled |
| `pnpm lint` | PASS, exit 0 |
| `pnpm test` | PASS, exit 0, **1,444/1,444**, 0 fail/skip/todo/cancelled |
| `pnpm build` | PASS, exit 0 |
| `pnpm verify:package` | PASS, exit 0. 182 gateway and 88 bot packed tests; 12 earlier offline examples; 4 H06 examples; 13 installed H06 tests; Inspectra/Visynq absent; 13 declaration entries in 5 modes; 550 packaged files |
| `npm pack --dry-run` | PASS, exit 0. Prepack lint and test ran 1,444/1,444; 551 files, 771.5 kB packed (766.6 kB before the H06-C documentation edits) |
| Independent packed consumer (§6) | PASS: 4/4 examples, 5/5 declaration checks, negative controls fail as intended. Run on the tarball packed before the H06-C edits, which changed documentation only. |

Counts overlap. Nothing was skipped. The suites include no live-network test, and none is expected.

## 9. Findings

### H06C-01 (P2): the shipped example host configures always-on, auto-approved firewall administration

- **Source:** `examples/sdk/hanuman/host.mjs:99,129-141,173-174`.
- **Reproduction:**
  - Every `createHost()` mode grants the task principal `fixture.admin`.
  - It registers the state-changing `demo.admin` policy, which the approver auto-approves.
  - It sets `authorizeAdmin: () => true`.
  - `denials.mjs` (`lockdown`) proves the ordinary task context is accepted for `firewall.admin.lockdown(context, 1)`. The configuration is identical in the other modes.
- **Expected vs actual:**
  - `ShivaxFirewallOptions.authorizeAdmin` is documented as a "separate host role check" (`src/security/firewall/types.ts:158-159`), and the admin capability as needing human approval.
  - The H06-B README said the admin policy "authorizes only the example's lockdown setup".
  - In fact the same principal is administrator in every example, and no person approves.
- **Security impact:** No bypass in the examples. `firewall.admin` stays with host code. Bots get only a leased bot context. `demo.admin` is not a registered firewall operation, so a bot-issued request matches no operation and is denied. The risk is a copy hazard: this is the shared "host" template that users are told to adapt.
- **Correction (not applied; example behavior unchanged in H06-C):**
  - Configure admin only for the `lockdown` option.
  - Use a separate admin principal and context.
  - Use `authorizeAdmin: () => false` otherwise, as `examples/sdk/hanuman.mjs` already does.
  - Label the approver as fixture-only.
  - H06-C corrected the README claim and added warnings to `docs/sdk.md` and `SECURITY.md`.
- **Required regression test:** for a non-lockdown host, `firewall.admin.lockdown(taskContext, v)` rejects with `unauthorized` and the policy version is unchanged. For the lockdown host, the bot task principal lacks the admin permission.

### H06C-02 (P2): negative coverage is incomplete for invalid API data, search-provider unavailability and reason attribution

- **Source:** `tests/hanuman-examples.test.mjs:26-32,66-92`, `examples/sdk/hanuman/rest.mjs:9-12`.
- **Reproduction:**
  - (a) No H06 test feeds well-formed JSON that breaks the closed schema (for example `{"status":"ok","version":1,"admin":true}`). `rest.mjs` validates with `assert`, so off-schema data ends the script with an `AssertionError` instead of a handled rejection. The test re-implements the check rather than exercising the example's validator.
  - (b) "Search provider unavailable" is checked only as `registry.findByCapability(...).length === 0`. The run-time fail-closed result was verified only by the H06-C probe.
  - (c) Denial tests assert `status !== 'completed'`, zero outputs and request counters, but not the cause. `deniedOrigin` and `missingTool` produce identical public results.
- **Expected vs actual:** Step 5 of the task requires invalid-API-data and search-unavailable cases that check actual behavior. Counters plus the single-variable control do make the existing cases discriminating: removing the origin, size or cancel check would make a request or complete. However, the cause is not attributable from the suite.
- **Security impact:** None directly. A regression that denies for the wrong reason would go unnoticed.
- **Correction:**
  - Give `rest.mjs` a non-throwing schema validator that returns a typed rejection.
  - Add an optional `observe` hook to `createHost` and assert the gateway code per case.
  - Add a RUDRA run for `research.search`/`fetch.api` asserting `missing-capability` or `capability-denied` with zero requests.
- **Required regression tests:**
  - off-schema JSON rejected with zero projected fields;
  - malformed JSON giving `invalid-encoding`;
  - reserved-capability run failing closed;
  - per-case `observe` codes: no gateway event for origin and missing tool, `timeout`, `cancelled`, `response-too-large`.

### H06C-03 (P3): sanitized public errors report gateway failures as a missing permission

- **Source:** `src/bots/base.ts:114-120` (pre-existing, commit `862b4e1`).
- **Reproduction:** Run `denials.mjs` with the H06-C harness. `timeout` and `oversized` show the RUDRA outcome `tool-not-allowed`, with the message "Required tool permission was not supplied by the host."
- **Expected vs actual:** The message misstates the cause. It is fail-closed and non-retryable, which is correct.
- **Impact:** Operator diagnostics only. The documented remedy is the gateway `observe` callback.
- **Correction:** Documented in H06-C. A future change could add a distinct non-retryable code (for example `tool-failed`) under a separate security review. Production code was not changed here, per the phase constraints.
- **Required regression test (if changed):** gateway timeout, oversize and cancel map to the new code, stay non-retryable with `maxRetries: 3`, and leak no gateway detail.

### H06C-04 (P3): test-rigor gaps in the H06 suite

- **Source:** `tests/hanuman-examples.test.mjs:81-83,94-104`.
- **Gaps:**
  - The zero-retry assertion is satisfied by `maxRetries: 0` and does not test the classification. Classification is covered elsewhere with `maxRetries: 3`.
  - `resolve` counters are not asserted for the pre-dispatch denials.
  - Cancellation is shown only during resolve.
  - The static import and network check reads only `host.mjs`, not the four scripts.
- **Correction:** Assert `resolve === 0` for the five pre-dispatch cases. Add `maxRetries: 3` variants. Extend the static scan to all files in `examples/sdk/hanuman/`. Add pre-admission and mid-stream cancel cases.
- **Required regression test:** the same additions.

### H06C-05 (P3): documentation and discoverability gaps (fixed in H06-C except the verifier)

- **Source:**
  - `examples/sdk/README.md` and `docs/sdk.md` did not list the H06 scripts.
  - `scripts/check-sdk-package.mjs:79-80`: the documented-file regex `[\w.-]+` ignores nested `examples/sdk/hanuman/*.mjs` paths.
  - The REST target keeps ID `demo-docs`.
  - The README's admin statement was inaccurate.
- **Status:** Documentation fixed (§7). The verifier was left unchanged. H06-B's explicit four-file run covers the current files, but a future documented nested example would not be existence-checked.
- **Correction:** Allow `/` in the documented-path pattern for `examples/sdk/` and rename the REST target ID to `demo-api` in a future example change.
- **Required regression test:** a documented nested path that is missing from the tarball must fail `verify:package`.

## 10. Remaining limitations

- The fake transport cannot show socket pinning, DNS-rebinding resistance, TLS validation, proxy behavior or SSRF safety. H01's real-transport finding (H01D-02) remains open.
- No live-network or isolated-network test was run, and none exists.
- `fetch.api` and `research.search` are reserved with no contract, so no search provider is demonstrated. Use case E is documented as unavailable.
- H05 utilities (`createJambavanDiscovery`, `createKuberaReporter`) are absent and were not exercised.
- Upstream gates: H01 NO-GO, H03 NO-GO (H03C-01/02, H01D-02), H04 NO-GO pending independent re-review of applied fixes, H05 NO-GO. The H06-A prerequisite gate is FAIL/BLOCKED. H06-B and H06-C proceeded within the offline-example scope only.
- The browser-safety bundling check in `verify:package` covers only root, bots and integrations. The rudra and security entries were checked by the H06-C import scan only.
- The CJS form of the H06 examples was not executed. Only ESM/CJS export parity and the packed CJS gateway and bot suites were run.

## 11. H06 GO / NO-GO

**CONDITIONAL GO** for H06 as an offline, portable, public-API example set.

- No P0 or P1 was found.
- No authorization, firewall, origin, tenant or permission bypass is reachable through the examples.
- All gates pass.
- The packed package works outside the source tree without Inspectra or Visynq.

**Conditions:**

1. Fix H06C-01 before `host.mjs` is promoted as a host template.
2. Add the H06C-02 regression tests before H06 is cited as Step 5 negative-test evidence.

**NO-GO** for live Hanuman deployment and for the 0.4.0 release, unchanged from upstream.

H06-C stops here. Nothing was pushed, tagged or published. Inspectra and Visynq were not modified. The next phase has not started.
