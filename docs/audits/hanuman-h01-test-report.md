# H01-C host transport test report

**FAIL — H01-C is incomplete.** No Node host transport was implemented, and no
host-adapter security tests or socket/TLS integration tests were run. This report
records the verified gateway coverage and the outstanding transport work; the
passing existing gates do not establish the requested H01-C security properties.

## Architecture and security boundaries

H01-B accepts a host-supplied two-phase resolver and transport. Vijay and the
firewall authorize the operation; the service checks reported DNS addresses,
requires a reported peer in the vetted set and returns a bounded untrusted
result. This cannot prove which address a host callback actually connected to.
The proposed Node adapter must bind actual connections to validated addresses,
verify TLS and hostname, isolate connection pools, enforce limits and cleanup,
and remain outside browser bundles. A host proxy or OS egress policy must also
enforce destination restrictions. The current reviewed H01-B contract accepts
HTTPS targets only, rejects redirects, and performs no retries; any extension
must preserve those constraints or obtain a newly reviewed authorization design.

## Test matrix

The existing mock gateway tests cover allowed requests, origin and tenant
rejection, redirect status rejection, reported peer mismatch, metadata/private
address denial, response size and media type, timeouts, cancellation, malformed
responses, policy revocation and firewall lockdown. This phase added explicit
missing-transport registration and transport-exception secret leakage tests in
both ESM and CJS. These tests do not exercise Node sockets, TLS, actual DNS
rebinding, transport-level concurrency, retry exhaustion, or stream and timer
cleanup in a Node adapter. No local fixture server or external network was used.

## Actual validation

| Command | Result |
| --- | --- |
| `node --test tests/hanuman-fetch.test.mjs` | PASS: 170 tests, 0 failed, 0 cancelled, 0 skipped |
| Host-adapter suite | NOT RUN: adapter and suite not implemented |
| `pnpm lint` | PASS, exit 0 |
| `pnpm test` | PASS: 1,067 tests, 0 failed, 0 cancelled, 0 skipped |
| `pnpm build` | PASS, exit 0 |
| `pnpm verify:package` | PASS, exit 0; 170 installed-package gateway tests, 13 entry points, five declaration modes, 11 offline examples |

Commands used preinstalled dependencies with pnpm offline, dependency verification
disabled, and hoisted/copy settings for the Windows symlink restriction. Logs
are in ignored `node_modules/h01c-*.log` files. These results validate the
current gateway and packaging, not the missing adapter.

## Remaining work and deployment risks

Implement and independently test the Node adapter with pinned DNS-to-socket
connections, approved origin and network-zone checks, TLS verification, strict
headers and content limits, cancellation, deadlines and bounded concurrency.
Prove rejection of redirects without following them, and keep retries at zero
under the current contract. Verify deterministic isolated fixtures, cleanup,
ESM/CJS consumption and exclusion from browser bundles. A redaction policy must
be explicitly defined: H01-B does not claim arbitrary fetched bodies are free
of secret-like strings. Do not deploy an arbitrary transport as SSRF-safe merely
because its preflight resolver returns a public address.

Changed in this phase: `tests/hanuman-fetch.test.mjs` and this report. No bot,
transport, dependency, Inspectra/Visynq modification or publication was added.
