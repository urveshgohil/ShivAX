# SHIVAX 0.4.0 HANUMAN · H02-C offline regression report

**PASS for the H02-C offline suite and package gates. H01 remains NO-GO for live deployment.**

Tested checkout baseline `72958ec` on Windows with Node `22.23.2` and pnpm
`12.8.1`. The H02-A schema and H02-B implementation report governed the
expected behavior. Tests exercise the current H02-B source through the built
SDK and use the real H01 protected service through Jay, Vijay, NARASIMHA and
RUDRA. The mock response, peer and async barriers are shared between the H01
and H02 suites. Both suites execute their test matrices in ESM and CommonJS.

## Test matrix

| Area | Actual assertions |
| --- | --- |
| Registration and availability (B1–B3) | Stable `hanuman` and `fetch.url` IDs, one declared tool, exact order of seven default IDs, 29 default capabilities, missing tool and duplicate errors, invalid host options. Missing task grant still denies after registration. |
| Authorized path and input (B4–B6) | Exact versioned evidence and independently computed SHA-256 with one approval, resolve, GET and close. The URL is host catalog data. Missing target, literal URL, unsupported method, timeout override, extra authority fields, functions, accessors, oversized JSON and invalid excerpt limits fail before a tool call. Invalid and reserved capabilities fail with `unsupported-capability`, including malformed search data. |
| Security denial (B7, B10) | Missing leased client, missing task security, forged context, missing Vijay or bound firewall, missing capability or tool policy, missing grant or principal permission, denied approval, expired session, lockdown and foreign tenant. Pre-dispatch failures have zero mock DNS and request calls. A missing transport rejects service registration. |
| Evidence and limits (B8–B10) | Denies wrong status, ID, trust, byte count, media, non-string body, missing envelope metadata and injected headers. Verifies required evidence provenance and receipt time. Oversize stream, invalid UTF-8 and binary MIME fail with no published evidence. Exact cap and surrogate pair truncation work, and digest IDs are stable within a scope and distinct across scopes. |
| Retry, cancellation and cleanup (B11–B12) | Early abort, H01 DNS deadline, repeated abort and tool-policy removal at approval, DNS, response acquisition and body streaming. After approval or DNS invalidation, no GET starts. If a response was acquired, its close runs exactly once and draining settles. Redirect, unmatched peer, provider exception and cleanup failure produce at most one request despite a retry budget of three. |
| Injection and credentials (B13–B14) | The requested injection string survives as literal untrusted excerpt. A registered privileged sentinel receives zero calls even with an extra task grant. Permissions stay identical, approval sees only the target ID, and traces and audits omit the body. Synthetic authorization exceptions, Set-Cookie and rejected header fields never reach evidence or telemetry. |
| Exports and browser boundary (B15–B16) | Source guard checks forbidden network/process/file references. Installed root, bots and integrations ESM graphs bundle without unresolved external imports. Packed ESM/CJS tests preserve runtime identities. Installed declarations compile in bundler mode and ESM/CJS Node16 and NodeNext modes. The installed offline example exercises allowed and denied access. |
| Mutation evidence (B17) | Four probes on an isolated copy of the ESM bundle each fail the intended assertion when target matching, trust, byte count or surrogate-boundary enforcement is disabled. Production and working build files were outside the mutation target. |

## Actual commands and results

| Command | Result |
| --- | --- |
| `node --test tests/hanuman-bot.test.mjs tests/hanuman-fetch.test.mjs` | PASS, 246/246 (76 specialist and 170 gateway). |
| `pnpm lint` | PASS, exit 0. |
| `pnpm test` | PASS, 1,143/1,143 (58 new cases over H02-B). Covers existing specialists, registry, RUDRA, Vijay, NARASIMHA, SARASWATI, model routing and budgets, and optional Inspectra. |
| `pnpm build` | PASS, exit 0. |
| `node examples/sdk/hanuman.mjs` | PASS, exit 0. |
| `pnpm verify:package` | PASS, 246 installed Hanuman tests, 13 entries, five declaration modes, 12 offline examples and 532 packed files. |
| `npm pack --dry-run` | PASS, exit 0. npm listed 533 files for `shivax@0.3.3`. |
| `node node_modules/h02c-mutation-probe.mjs` | PASS, 4/4 targeted checks detected the injected regression. |

Final suites reported zero failures, cancellations and skips. The first
focused run passed 242 of 246. Two expectations, reproduced in both module
formats, needed correction. A present `undefined` is rejected by the generic
JSON snapshot before Hanuman sees the result, so the missing-metadata test
now omits the property. RUDRA rejects a structurally missing security context
at entry with `invalid-context`, while a valid-shaped forged context fails
authentication through the result path. The final suite asserts both behaviors.

Logs and the diagnostic mutation script are in ignored `node_modules/h02c-*`
paths. npm/pnpm ran with offline settings. Package verification used hoisted
installation and copy import mode for Windows, and pnpm used the preinstalled
dependencies with dependency verification disabled.

## Remaining risks

The credential tests establish sanitization for response metadata and error
paths. Arbitrary text containing secrets remains untrusted text and follows
the existing excerpt contract. Live transports must keep credential-bearing
content out of the registered targets. Browser coverage is a static bundle
check, with no browser or real socket execution. Optional capabilities have
no approved tool contract in this checkout. Their tests verify denial.

No new H02-B implementation defect was required to make these tests pass.
The H02-B report already records that a faulty injected clock can return
`bot-error` after a fetch and trigger generic RUDRA retries if enabled.
The H01 review still records separate workflow denial retry behavior
(H01D-01) and the missing reviewed host transport (H01D-02).
The offline specialist gates leave both live deployment findings open.

## Changed paths

| Path | Change |
| --- | --- |
| `tests/hanuman-bot.test.mjs` | Extended ESM/CJS security and compatibility cases with the authorized gateway fixture. |
| `tests/hanuman-fetch.test.mjs` | Reused extracted H01 response and async test helpers. |
| `tests/fixtures/hanuman-transport.mjs` | Shared mock response, peer and async barrier. |
| `scripts/check-sdk-package.mjs` | Copies the helper into the packed consumer and checks source and browser-safe graphs. |
| `docs/audits/hanuman-h02-tests.md` | Records this matrix, results and limits. |

Production code and security rules were outside the change. Work stopped at H02-C.
