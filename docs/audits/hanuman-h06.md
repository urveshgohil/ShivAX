# SHIVAX 0.4.0 HANUMAN · H06 portable non-Inspectra use cases (phase summary)

Status as of 18 November 2026, Asia/Calcutta, reviewed HEAD `e08feab`.

**H06: CONDITIONAL GO for the offline portable-example scope.** No P0 or P1 findings. Two P2 and three P3 findings are open, so two conditions apply (below). Live Hanuman deployment and the 0.4.0 release remain **NO-GO** because of upstream H01, H03, H04 and H05 gates.

| Phase | Document | Outcome |
| --- | --- | --- |
| H06-A host transport fixture prerequisite audit | [hanuman-h06-host-adapter.md](hanuman-h06-host-adapter.md) | FAIL / BLOCKED on the H01–H05 prerequisites. Audit only, no fixtures. |
| H06-B offline SDK examples | [hanuman-h06-examples.md](hanuman-h06-examples.md) | PASS within the offline-example scope. Four scripts, shared host, 13 tests, packed-consumer gate. |
| H06-C independent review and documentation | [hanuman-h06-review.md](hanuman-h06-review.md) | CONDITIONAL GO. Findings H06C-01 to H06C-05. |

## What H06 delivers

- `examples/sdk/hanuman/{host,documentation,rest,workflow,denials}.mjs` and a README. They ship in the npm package through the `package.json` `files` entry `examples/sdk/hanuman`. They use only public `shivax/*` entry points and a fake in-memory transport. They need no network, model provider, Inspectra or Visynq.
- `tests/hanuman-examples.test.mjs` (13 tests). These also run from an installed tarball inside `pnpm verify:package`.
- No production source change. `git diff 0e9de85 e08feab -- src` is empty.

## Use cases

| ID | Use case | Status |
| --- | --- | --- |
| A | Approved documentation retrieval | Working offline (`documentation.mjs`) |
| B | Approved REST GET request | Working offline through `fetch.url` (`rest.mjs`). `fetch.api` is reserved. |
| C | RUDRA evidence workflow | Working offline (`workflow.mjs`). Fixed host plan with deterministic summary and no model. |
| D | Denied requests and lockdown | Eight fail-closed cases (`denials.mjs`) |
| E | Optional injected search provider | **Not available.** `research.search` is reserved and RUDRA fails closed. Documented only. |

The full guide is "Portable Hanuman examples (H06)" in `docs/sdk.md`.

## Key results (H06-C, after documentation edits)

| Gate | Result |
| --- | --- |
| H06 example tests | 13/13 |
| Hanuman focused (examples, fetch, bot, integration) | 391/391 |
| Security regression (security, firewall ×4, rudra, workflows, workflow-safety ×2) | 498/498 |
| `pnpm lint` / `pnpm build` | PASS / PASS |
| `pnpm test` | 1,444/1,444, 0 skipped, 0 todo |
| `pnpm verify:package` | PASS: 4 H06 examples and 13 H06 tests from the installed tarball; Inspectra/Visynq absent; 13 declaration entries × 5 modes; 550 files |
| `npm pack --dry-run` | PASS: 551 files |
| Independent consumer install outside the repository | PASS: 4/4 examples; NodeNext, Node16 and Bundler declarations; private paths blocked |

## Open findings

| ID | Severity | Summary |
| --- | --- | --- |
| H06C-01 | P2 | `host.mjs` configures always-on, auto-approved firewall administration (`authorizeAdmin: () => true`, admin permission on the task principal) in every mode. Not exploitable from bots or evidence, but unsafe to copy. Docs corrected; example unchanged. |
| H06C-02 | P2 | Missing negative tests: off-schema API data, reserved search at run time, and per-case denial reason (`observe`). |
| H06C-03 | P3 | Pre-existing: gateway failures surface as `tool-not-allowed` ("Required tool permission…"). Fail-closed but misleading. Documented. |
| H06C-04 | P3 | Test-rigor gaps: zero-retry assertion under `maxRetries: 0`, no `resolve` counter for pre-dispatch denials, narrow static import scan, cancellation only during resolve. |
| H06C-05 | P3 | Discoverability. Docs fixed in H06-C. The verifier's documented-path regex still ignores nested example paths. The REST target ID is `demo-docs`. |

## Conditions for H06 GO

1. Fix H06C-01 (scope admin to the lockdown case with a separate principal, and `authorizeAdmin: () => false` otherwise) before `host.mjs` is offered as a host template.
2. Add the H06C-02 regression tests before citing H06 as negative-test evidence.

## Unchanged upstream state

- H01 is NO-GO. No reviewed real transport exists; H01D-02 is open.
- H03 is NO-GO (H03C-01/02).
- H04 stays NO-GO pending independent re-review of its applied fixes.
- H05 is NO-GO; its utilities are absent.

H06 does not waive or change any of these. A fake transport cannot show SSRF, DNS-pinning or TLS safety.

## Files changed in H06-C

- `docs/sdk.md`
- `examples/sdk/README.md`
- `examples/sdk/hanuman/README.md`
- `SECURITY.md`
- `docs/audits/hanuman-h06-review.md` (new)
- `docs/audits/hanuman-h06.md` (new)

Documentation only. H06-C stops here. Nothing was pushed, tagged or published, and the next phase has not started.
