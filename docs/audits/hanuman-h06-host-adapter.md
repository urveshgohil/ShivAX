# H06-A host transport fixture prerequisite audit

18 November 2026, Asia/Calcutta. Audited HEAD `0e9de85`, package `0.3.3`. **H06-A acceptance gate: FAIL / BLOCKED.** The task explicitly requires H01–H05 to be complete and tested. H05-B is incomplete and H05-C records NO-GO. H03 remains NO-GO and H04 awaits independent re-review after fixes. H01's reviewed real host transport remains absent. This report records independent audit and baseline validation only. No new fixtures or fixture assertions were implemented.

## Prerequisite evidence

| Phase | Current evidence |
| --- | --- |
| H01 | `hanuman-h01-security-review.md` records NO-GO and missing reviewed socket-pinning/TLS host transport. `src/integrations/hanuman/types.ts` still declares a host interface and the existing example supplies an in-memory mock. H01D-01 retry classification was subsequently addressed; the older review predates that change. |
| H02 | `hanuman-h02-review.md` records conditional GO. Current `src/bots/hanuman.ts` validates its clock before retrieval and maps post-fetch failure to a non-retryable outcome, addressing the older clock finding. |
| H03 | `hanuman-h03-review.md` records NO-GO and missing explicit-eligibility integration. The existing generic orchestrator routes registered bots by capability, but this does not establish the requested H03 gate. |
| H04 | Current `hanuman-h04.md` says P1/P2 fixes were applied and independent H04-B/H04-C re-review remains required. Full current tests pass without TODOs, but that is not the requested independent review decision. |
| H05 | `hanuman-h05.md` and `hanuman-h05-review.md` report NO-GO. Current source and tests contain no `createJambavanDiscovery` or `createKuberaReporter`. |

The audit reports identify reviewed states at different commits; current source was checked separately for the two later fixes above. The task's explicit prerequisite prevents treating passing baseline tests as completion of the missing phases.

## Existing contracts and planned fixture design

- The host explicitly calls `registerHanumanFetchService` with a `ProtectedToolRegistry`, target catalog, limits and a `HanumanFetchTransport`. A catalog entry contains a canonical HTTPS URL, issuer, scope and allowed media types. Callers submit only `{ targetId }`.
- The transport provides asynchronous `resolve` and `request`. The request is GET-only, has vetted address pins, no credentials, `redirect: 'error'`, byte and timeout limits, an abort signal and `checkExecution`. The response supplies status, media metadata, actual peer, async byte stream and idempotent cleanup. The SDK gateway validates these values but a mock cannot prove actual socket binding or TLS behavior.
- Jay supplies an exact minted context with session and tenant scope. Vijay checks capability and tool policies, permissions, grants and required approvals. NARASIMHA binds operation descriptors, realm, origin and resource limits. The gateway requires both `checkExecution()` and `checkNetworkAccess()` and rechecks after asynchronous checkpoints.
- `registerHanumanBot` checks the registered tool and adds the optional bot without granting permission. `fetch.url` is implemented. `fetch.api` and `research.search` are reserved identifiers, not implemented Hanuman capabilities. A search fixture would need an independently registered host capability and policy.
- The gateway accepts `text/plain` and `application/json`. HTML is unsupported, so the requested documentation fixture would use `text/plain`. JSON must be UTF-8 and syntactically valid. Both outputs are bounded and carry `trust: 'untrusted'`; the bot supplies target reference and provenance.
- The existing mock helper is `tests/fixtures/hanuman-transport.mjs`, used by gateway and bot tests. The example `examples/sdk/hanuman.mjs` composes an explicitly registered offline transport. A future fixture should extend these conventions with exact `.test` targets, deny-by-default host policies, deterministic response streams, cancellation and cleanup counters. It should keep authorization, firewall and budget checks on the real execution path.
- RUDRA and the workflow engine are existing separate bot and tool orchestration paths. Fixture tests must cover each appropriate path without creating an alternate gateway or treating advisory capability selection as authorization.

## Regression risks and acceptance criteria

The fixture must not contact example domains. A denied pre-dispatch operation must leave request counters at zero. A redirect is observed only after the initial simulated response, so the assertion must prohibit a follow-up dispatch rather than claim the first request never happened. Oversize, malformed MIME and malformed result cases must fail closed. Cancellation, deadline, revoked permission and lockdown must prevent later dispatches, while acknowledging that already dispatched work cannot be undone. Wrong tenants must not receive evidence. Search must require its own host registration and policy. A fake callback does not establish production SSRF, DNS binding or TLS protection.

H06-A remains incomplete. Documentation, API and independently registered search fixtures, rejected-request assertions, and their dedicated tests have not been created. H06-B has not started.

## Actual baseline validation

Commands used locally installed dependencies with process-local `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`.

| Command | Result | Ignored local log |
| --- | --- | --- |
| `pnpm lint` | PASS, exit 0 | `node_modules/h06a-lint.log` |
| `pnpm test` | PASS, exit 0, **1,431 passed, 0 failed, 0 skipped, 0 TODO** | `node_modules/h06a-test.log` |
| `pnpm build` | PASS, exit 0 | `node_modules/h06a-build.log` |
| `pnpm verify:package` | PASS, exit 0. Packed ESM/CJS imports; 13 declaration entries across 5 modes; browser-safe graphs; 182 gateway and 88 bot tests; 12 offline examples; 544 package files | `node_modules/h06a-package.log` |
| `node --test tests/hanuman-fetch.test.mjs tests/hanuman-bot.test.mjs tests/hanuman-integration.test.mjs` | PASS, exit 0, **378 passed, 0 failed/skipped/TODO** | `node_modules/h06a-focused.log` |

Counts overlap and cover pre-existing behavior. They do not establish acceptance of new fixture requirements or live transport security.

## Changed paths and remaining work

Only `docs/audits/hanuman-h06-host-adapter.md` was added to the working tree. Validation regenerated build output and wrote ignored local logs. Complete and independently validate the stated prerequisites before resuming fixture implementation. This report does not grant a waiver or change the project release decision.
