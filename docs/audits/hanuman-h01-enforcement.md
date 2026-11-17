# SHIVAX 0.4.0 HANUMAN — H01-B enforcement

17 November 2026 (Asia/Calcutta). Implementation against checkout `df6298e`,
whose manifest and runtime version are 0.3.3. Historical 0.3.2 public APIs remain
preserved. Version, package description and dependency manifests were not changed.
The existing H00 audit and H01-A threat model were read and left untouched.

**Result: PASS for H01-B.** This phase implements the protected service
and mandatory checks only. It does not implement or register a Hanuman bot,
a host HTTP transport, future specialists, or an unrestricted network client.

## Initial change plan and regression risks

The implementation followed the H01-A two-phase transport contract: freeze a
host target directory, register one protected tool, use existing Jay/Vijay and
NARASIMHA checks, validate reported addresses and bounded responses, then prove
failure behavior using offline mock transports. Public additions belong only
in the existing `shivax/integrations` entry point. Host setup and obligations
are documented in the SDK guide and security policy.

Inspection found a concrete revocation gap: Vijay's callback checkpoint checked
the firewall lease but not the admitted tool policy itself, and ToolLease's
checkpoint did not revalidate the captured registration on the bot path.
H01-B therefore makes two small additive enforcement changes in security code.
This is a deliberate deviation from H01-A's proposed no-security-edit map,
required by the explicit H01-B instruction to enforce current policy after
awaits. Existing mechanisms and firewall modes are retained.

The primary regression risks were callback recursion, more frequent host
validation predicates, rejection after policy replacement, additional retained
cleanup time, unchanged shared budget limits rejecting large envelopes, and
ESM/CJS module identity. Initial focused tests caught a recursive checkpoint
implementation; it was corrected before the passing full-suite run. Mode and
terminal-status assumptions in the new fixture were also corrected to use the
existing firewall admin transitions and existing denied/failed semantics.
Host predicates should remain synchronous and side-effect-free.

## Changed paths

| Path | Change |
| --- | --- |
| `src/integrations/hanuman/types.ts` | Additive target, limits, two-phase transport, response, event and error-code contracts; reserved IDs |
| `src/integrations/hanuman/target.ts` | Frozen host catalog; strict input configuration, tenant/issuer, canonical HTTPS target checks |
| `src/integrations/hanuman/address.ts` | Internal canonical IPv4/IPv6 classifier for the H01-A deny ranges; mapped/transition forms denied |
| `src/integrations/hanuman/error.ts` | Fixed service error message with finite error codes |
| `src/integrations/hanuman/service.ts` | Explicit protected tool registration; policy checkpoints, bounded response validation and cleanup |
| `src/integrations/hanuman/index.ts` | Public integration exports; internal classifier stays private |
| `src/sdk/integrations.ts` | Add new integration exports without removing existing exports |
| `src/security/vijay.ts` | Callback checkpoints reassert admitted policy identity, permissions, input predicate, identity and expiry |
| `src/security/tools.ts` | Live checkpoints revalidate captured tool registration and input schema |
| `tests/hanuman-fetch.test.mjs` | Offline ESM/CJS service and enforcement tests, using mock transports and a global-fetch tripwire |
| `scripts/check-sdk-package.mjs` | Run fetch tests against the installed tarball; positive/negative declaration checks in five modes |
| `docs/sdk.md` | Host registration recipe, required grants/operations, transport contract and limitations |
| `SECURITY.md` | Fetch runtime trust boundary and residual host obligations |
| `docs/audits/hanuman-h01-enforcement.md` | This report |

Pre-existing staged changes to `docs/audits/hanuman-h00.md` and
`docs/audits/hanuman-h01-threat-model.md` were preserved. Generated `dist/` and
local validation logs are ignored build artifacts. No Inspectra/Visynq files,
default bot factories, learning/model approval code, or dependency files changed.

## Implemented APIs and execution

`registerHanumanFetchService(tools, options)` registers only
`shivax.hanuman.fetch` in the supplied `ProtectedToolRegistry`. No policies,
permissions, default transports or bots are installed. A host can explicitly
bind it into `ToolRegistry`/`RudraWorkflowEngine` using `hanuman.fetch`.
`HANUMAN_BOT_ID` reserves the string `hanuman` only.

Input is exactly `{ targetId }`. Targets come only from a bounded, frozen
registration catalog, scoped to exact principal issuer and session tenant.
The tool does not accept caller URLs, methods, headers, bodies or credentials.
The tool requires both live execution/resource callbacks and the existing
internal SDK-issued resource boundary. A forged context or unprotected Vijay
cannot turn it into an unrestricted callback.

The execution sequence is:

1. Jay mints/authenticates the root. Vijay checks grants, capability and tool
   policy, permissions and approval where required. NARASIMHA checks realm,
   declared operations/origins and shared budgets.
2. The service verifies catalog scope and the live execution/network checks,
   resolves the host hostname, and checks again after the await.
3. Every returned address must pass canonical validation and the H01-A deny
   policy. Empty, oversized and mixed public/private sets fail closed. IPv4
   mapped IPv6, NAT64 and 6to4 forms are conservatively denied outright.
4. The host receives a frozen GET request, exact URL, permitted address set,
   only `accept` and `accept-encoding: identity`, `redirect: error`,
   `credentials: omit`, byte limit, abort signal, remaining deadline and a live
   checkpoint. No retries or redirects are initiated by the service.
5. After headers, validate connected peer membership, HTTP 200, allowed text
   media type, identity encoding and declared length. Check execution after
   each streamed chunk, count bytes/chunks before copying, decode strict UTF-8,
   reject control bytes and validate JSON syntax where applicable.
6. Await cleanup, recheck policy and return only the bounded untrusted
   envelope. Late responses are closed even after cancellation. Acquired
   response cleanup is invoked once; no retry is attempted when close rejects.

Default limits are 32,768 bytes, 4,096 chunks, 16 DNS addresses and 10 seconds.
Host configuration may raise these only to 1,048,576 bytes, 65,536 chunks,
64 addresses and 60 seconds. Per-target bytes may only narrow the service cap.
Root/firewall time and output limits remain additional constraints. The full
JSON envelope must fit existing output budgets; no truncation bypass is used.
The service uses a monotonic clock when available and an abort timer.

The result is `{ version: 1, targetId, status: 200, mediaType, bytes, body,
trust: 'untrusted' }`. The target ID is opaque provenance into the host catalog.
No URL, peer address, headers, credentials or transport exception details are
projected into the envelope. Service errors have fixed codes and messages;
Vijay/RUDRA preserve their existing sanitized failure contracts. Observer events
contain only registered IDs, lifecycle states and fixed codes. Observer errors
and rejected promises are isolated.

## Runtime trust boundaries

ENFORCE checks policy before retrieval. MONITOR retains mandatory identity,
permissions, target, origin, address and limit restrictions; only optional
firewall rules can log without denying. LOCKDOWN blocks new external retrieval
and revokes in-flight leases. Live checks after awaits prevent subsequent
transport dispatch or output publication when policies, registrations, session
expiry or lease state change. Already-sent requests cannot be undone.

Fetched text and model output never become instructions, admin authority,
permissions, executable code, verified feedback, training data or model
approval. The service does not invoke a planner, memory or SARASWATI operation.
Hosts that subsequently route this text elsewhere must preserve its provenance
and use those consumers' existing authorization and admission paths.

### Trusted host transport contract (Terra boundary)

The SDK validates reported facts; an arbitrary callback cannot guarantee SSRF
protection. The future host transport must enforce all H01-A responsibilities:

- **R-H1:** parse the exact canonical URL using WHATWG semantics.
- **R-H2:** bind actual connections to permitted resolved addresses, preserve
  hostname/SNI, verify TLS and report the actual connected peer.
- **R-H3:** refuse every redirect, with no credential/header forwarding,
  cookies, authorization, client certificates or retries. No redirect hop is
  authorized in H01-B; any future hop requires separate policy admission.
- **R-H4:** enforce wire and memory buffering limits before SDK iteration and
  disable transparent decompression.
- **R-H5:** honor cancellation/deadlines across DNS, connect, TLS, headers and
  streaming; checkpoint immediately before dispatch and after awaits; make
  close/cleanup settle after abort.
- **R-H6:** isolate connection pools across tenants, service instances and pin
  sets; never re-resolve or reuse a connection to an unapproved address.
- **R-H7:** apply equivalent destination restrictions at resolving proxies.
- **R-H8:** enforce OS/proxy/sandbox egress restrictions for untrusted workloads.

The host must not put secrets in targets, transport-added headers or content.
The result envelope does not expose transport credentials, but arbitrary
external text cannot be certified free of credential-like values. Provider-side
identity revocation must abort the root signal for immediate enforcement;
synchronous checkpoints do not await the identity provider. Uncooperative
transport/iterator/cleanup code can retain a draining lease indefinitely. SDK
code cannot forcibly terminate such work or undo its effects. A malformed host
response without a callable close method is rejected, but only the host can
clean up resources it failed to expose.

## Compatibility and validation

The seven default IDs remain `sanjay`, `brihaspati`, `vishwakarma`, `chitragupt`,
`narad`, `yudhishthir`, `ekalavy`, in that order, with 29 capabilities. Existing
root and SDK exports, RUDRA behavior, Jay/Vijay approval, NARASIMHA modes,
SARASWATI training/model approval and optional Inspectra integration remain.
No new dependency, network client, shell or filesystem tool, global service
singleton, version bump or automatic registration was added.

The new tests cover explicit/missing registration; forged contexts; missing
permissions, policies, grants and approval; wrong scope/issuer; lockdown;
monitor optional versus mandatory denial; invalid request/result schemas;
address and peer rejection; redirects; media/encoding/length validation;
byte/chunk/envelope budgets; cleanup failure sanitization; cancellation,
deadline, policy/registration/expiry changes during asynchronous checkpoints;
RUDRA and workflow revocation; draining ownership; inert injected instructions;
immutable registration and public IPv6. All transport responses are mocks.
The H01-A full matrix includes future bot and real-host transport cases; those
are not claimed as implemented or live-network validated by this phase.

| Validation | Actual result |
| --- | --- |
| Focused fetch suite | PASS — 166/166, ESM and CJS, no skips/cancellations |
| `pnpm lint` | PASS — TypeScript and ESLint, exit 0 |
| `pnpm test` | PASS — 1,063/1,063 (897 existing + 166 new), no skips/cancellations, exit 0 |
| `pnpm build` | PASS — standalone TypeScript, ESM/CJS bundles and declarations, exit 0 |
| `pnpm verify:package` | PASS — 166 packed offline fetch tests, 13 entry points, five declaration modes, 11 offline examples, worker training in ESM/CJS; 528 packaged files, exit 0 |

Complete local command outputs are retained as ignored files
`node_modules/h01-{focused,lint,test,build,package}.log`. pnpm dependency
verification was disabled for the preinstalled environment and offline mode
was enabled. The first package verification attempt failed because Windows
denied creation of a dependency symlink. Re-running with
`PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`
passed without escalation or repository configuration changes. No project
dependency or network transport was added.
The package gate packs into a temporary directory and installs that local
archive offline, as the existing verification script already does.

No push, tag, publish or next-phase work was performed. H01-B ends here.

### Actual command output excerpts

Final lint (exit 0):

```text
$ tsc --noEmit && eslint .
```

Final full test run (exit 0; `pnpm test` also rebuilds):

```text
  ...
1..1063
# tests 1063
# suites 0
# pass 1063
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4090.3238
```

Installed-package verification with the environment settings above (exit 0):

```text
$ node scripts/check-sdk-package.mjs
Verifying package with pnpm; Node v22.23.2.
Packed ESM/CJS SDK imports passed.
Packed protected fetch passed: 166 offline ESM/CJS tests.
Packed examples passed: 13 documented files present; 11 offline examples ran.
Packed worker training passed (ESM and CJS).
PASS declarations: ts, bundler, 13 entries.
PASS declarations: mts, Node16, 13 entries.
PASS declarations: cts, Node16, 13 entries.
PASS declarations: mts, NodeNext, 13 entries.
PASS declarations: cts, NodeNext, 13 entries.
Packed declarations passed for 13 entries; 528 packaged files.
```
