# Security policy

ShivAX is a library. Its core provides CPU tensors, dense neural networks, text
features, bot contracts, RUDRA task handling, Jay and Vijay sign-in and permission
checks, scoped memory and model routing. The core makes no network requests,
on import or by default. Some optional adapters that your host sets up can: the
loopback Ollama adapter, remote model clients, embedding and storage adapters,
Inspectra page capture, and the transport that a host supplies to the opt-in
Hanuman retrieval service. ShivAX itself contains no HTTP client and no
operating-system network isolation. ShivAX does not run an API or service. It has no
production dependencies and no install scripts for consumers. Dependency audits
cover known published advisories. They are not a security certification.

See `docs/production.md` for what belongs on a trusted host and what can run in a
browser.

## Supported versions

This policy covers the 0.3.x SARASWATI line and 0.2.0 NARASIMHA. The package in
this repository is versioned 0.4.0 but is unpublished; see below. The learning lifecycle controls described below are
new in 0.3.0. The managed firewall and the strict model usage checks are new in
0.2.0. They are not in 0.1.3 or earlier. There is no support window or backport
policy yet.

The 0.4.0 HANUMAN features (protected retrieval, the optional Hanuman bot,
Abhimanyu and Ashwatthama warning checks) exist in this source tree but are
**not a published release**. Treat them as pre-release. Their independent
security reviews still list open findings, so live deployment is not
recommended until those are closed. Those reports are in the repository's
`docs/audits/` folder, which is not part of the npm package.

## Reporting a vulnerability

Please do not put vulnerability details, exploit code or secrets in a public
issue. Instead, open an issue at https://github.com/urveshgohil/ShivAX/issues
titled "Security contact request", with no technical details. The maintainer will
set up a private channel. Then send the affected version, the steps to reproduce
it and its impact through that channel. There is no promised response time yet.
Never include real credentials, tokens, customer data or private URLs in a
report. Use synthetic values that show the problem.

## Development and releases

- `pnpm-lock.yaml` is not committed yet (it is listed in `.gitignore`), and CI
  installs with `--no-frozen-lockfile`. So builds are not pinned to a reviewed
  lockfile. Commit the lockfile and install with `pnpm install --frozen-lockfile`
  before a stable release.
- Run `pnpm lint`, `pnpm test` and `pnpm audit` before each release. The audit
  covers development dependencies too, because they run during the build.
- Review dependency upgrades and install scripts before you allow them. Do not
  turn on build scripts for every package to silence an install warning.
- After building, run `npm pack --dry-run --ignore-scripts` and read the file
  list. The publish allowlist leaves out source, tests, keys and tool caches. It
  includes `dist/`, the Inspectra adapter, selected docs and the examples under
  `examples/sdk/`.
- Keep registry tokens in CI secrets. Give them the least access they need, turn
  on registry MFA, and never log keys. Only approved maintainers should publish.

## Current limits

Tensors reject values that are not finite or that overflow Float32. Each tensor
holds at most 1,048,576 elements. Matrix multiplication stops at 50 million
multiply steps. Networks allow at most 4,096 units per layer, 8 layers and one
million parameters. Training checks shapes and class targets before it changes
any weights. Each call allows at most ten million input and target elements, and
at most 250 million for epochs times samples times parameters. These limits
estimate work. They do not cap time or memory. A large call on the main thread
can still block it, so use a worker, as the digit example does. A failed training
run can keep the batch updates it finished before the failure.

Text features cap document length, corpus size and vocabulary. These checks
handle plain arrays and strings. They do not protect against hostile JavaScript
objects or getters running in your own process. Do not run untrusted code in the
same process.

## Rules for new AI features and deployments

- Treat datasets, prompts, model files and model output as untrusted input. Check
  numbers, array sizes and config ranges at runtime. TypeScript types do not check
  incoming JavaScript or JSON.
- Limit input size, memory use, training steps, run time and concurrency. Run
  heavy or untrusted work in separate workers with resource limits and
  cancellation.
- Never run user-supplied JavaScript or load model files that contain code. Check
  model formats, and check downloaded files against trusted hashes.
- Every host URL transport needs a destination policy, redirect checks, response
  size limits and timeouts. These prevent SSRF and resource exhaustion.
- The host application must supply authentication, authorization, rate limits,
  TLS and safe error handling. Jay, Vijay and the optional firewall run SDK checks
  using trusted host identity and approval adapters. Deployment security stays
  with the host. Keep AI service keys on the server, and log as little of the
  prompt data as you can.
- Deploy only your application's production dependencies. Consumers do not need
  ShivAX's compiler, bundler or other build tools at runtime.

## Managed firewall boundary (new in 0.2.0)

The firewall starts in enforce mode. In monitor mode, it still applies the
required Jay and Vijay checks, approvals, tenant checks, sandbox checks and
budgets. Lockdown blocks new managed external operations and asks running ones
to cancel. CPU operations you allowed keep working. Changing the firewall needs a
separate admin capability, a host role check and Vijay approval. See
`docs/sdk.md` for setup, rollback, audit and cancellation details.

The firewall covers only what you register with it. Raw SDK calls and other host
code are not isolated on their own. File paths and web origins are declared
contracts that trusted adapters must follow. The host, a proxy, an OS firewall
or a sandbox must handle real network traffic, symlinks, redirects, DNS, durable
policy storage, revocation across processes and stopping I/O that does not
cooperate. A JavaScript library on npm cannot stop a malicious host from going
around its code. Never pass admin capabilities or signed-in root objects to bots.

## Learning lifecycle boundary (new in 0.3.0 SARASWATI)

- **Untrusted inputs.** Feedback, provenance, benchmark reports, routing
  evidence and memory metadata are untrusted claims. Verification comes only from
  your host:
  - Jay-verified reviewers and administrators;
  - review, consent and approval journals;
  - trusted evaluator lists;
  - storage access control.
- **Checksums are integrity, not authenticity.** For authenticity, configure the
  registry `signer` with a key you protect.
- **Model storage.** The model registry store must provide an atomic
  compare-and-swap across all writers. Never expose the registry, the routing
  policy switch or approval hooks to bots, tools, browsers or model output.
- **No self-promotion.** Nothing in SARASWATI trains, activates or reroutes
  automatically, and repeated retrieval never raises a record's trust.
- **Firewall coupling.** Lockdown blocks approval, activation and (by default)
  rollback, and freezes routing to deterministic.

## HANUMAN threat boundaries (0.4.0, unreleased)

What the SDK checks, when a host registers and configures the protected
retrieval path:

- Jay identity, Vijay permissions, the per-task tool grant and approval;
- the registered target catalog, bound to issuer and tenant, so callers cannot
  supply a URL, method, header or credential;
- the exact request origin against the NARASIMHA policy (also in monitor mode);
- every address the host transport reports, against a built-in non-public
  address list, and that the reported peer is one of the permitted addresses;
- GET only, no redirects, no compression, response size, chunk, text and media
  type checks, and a deadline;
- cancellation, lockdown and policy changes between steps.

What the SDK **cannot** do, and the host or deployment must:

- **It provides no OS-level or network-level isolation.** It is a JavaScript
  library. It cannot stop other code in the same process from opening sockets.
- **It ships no transport.** DNS pinning, TLS and hostname verification,
  redirect refusal at the wire, credential and cookie removal, connection pool
  isolation and proxy behavior are all in code that your host writes. The SDK
  trusts what that code reports. No reviewed transport exists yet.
- **URL or address validation alone does not prevent SSRF.** Resolved addresses
  can change between checks. Use a transport that connects only to the vetted
  addresses, plus egress rules (firewall, proxy or sandbox) that allow only the
  approved destinations.
- **It cannot force a stuck transport to stop.** A transport that ignores the
  abort signal can keep its resources, and its firewall slots stay in use until
  your host cancels or restarts. Honor the `AbortSignal` everywhere.
- **Revocation outside the SDK needs your help.** The SDK re-checks policy and
  minted identity between steps. If the identity provider revokes a session,
  abort the task's root signal so that an in-flight retrieval stops.

### Trusted host responsibilities

- Authenticate users, mint contexts through Jay, and keep root contexts and
  firewall admin objects away from bots, tools, browsers and model output.
- Write the Vijay policies. Require approval for the fetch tool (`requiresApproval:
  true`). Approvers must return the literal `true`. Grant the tool per task.
- Keep the target catalog small, reviewed and free of secrets. Each target is an
  exact HTTPS URL with no user info, port or fragment.
- Allow the origin in both the operation declaration and the firewall policy.
- Allow RUDRA to run the capability explicitly with `allowedCapabilities`. The
  current default (no options) admits the task's own capability, so pass the
  option every time.
- Do not copy the firewall-admin shortcuts in the example scripts into a
  production host (see below).

### Untrusted external content

Fetched text is always `trust: 'untrusted'`. It carries a digest identifier, not
a signature. Do not use it as an instruction, grant, approval, administrator
request, verified feedback, executable code, model approval or automatic
training input. Excerpts can contain invisible or bidirectional Unicode
characters. Neutralize them before showing the text to a person or passing it to
a model. SHIVAX never acts on retrieved content itself, and a regression suite
checks that injected instructions do not change tools, targets or approvals.

### Credential handling

- Do not register targets that need credentials. Credentialed retrieval is
  outside the current contract.
- The request frame has `credentials: 'omit'` and only `accept` and
  `accept-encoding` headers. The host transport must not add cookies,
  authorization, client certificates or forwarded headers.
- Keep keys, tokens and secrets in your host's secret store. Do not place them
  in target URLs, catalogs, task input, logs or error messages. The SDK returns
  fixed error codes and never copies transport exception text into results or
  audit records, but it cannot know what your own code logs.
- Scrub secrets before retrieved text is stored or shown. The SDK does no
  secret detection on the body.

### Known security limitations (pre-release)

These are tracked in the repository's audit reports. They are listed here so
that nobody relies on a property that is not provided:

- No reviewed host transport (wire-level SSRF and TLS properties are unverified).
- With no `allowedCapabilities` option, RUDRA allows the task's own capability.
- If two bots offer `fetch.url`, RUDRA picks the first by ID, which might not be
  Hanuman.
- Revoking a session only at the identity provider does not stop a retrieval that
  is already in flight.
- A transport that ignores cancellation can leave leases in use.
- `3fff::/20` (documentation addresses) is not on the address block list.
- Jambavan and Kubera are not implemented. Abhimanyu and Ashwatthama give
  warnings, and only `enforce` mode can refuse a workflow start or request
  cooperative cancellation. They never grant or remove permissions.

## Opt-in protected retrieval (H01-B)

The `shivax/integrations` fetch service requires explicit host registration,
Jay/Vijay authorization and a bound NARASIMHA resource boundary. It contains no
HTTP client or global fetch fallback and does not add a default bot. Mandatory
scope, URL, reported-address, size, cancellation and policy checks apply in
monitor mode as well as enforce mode. Lockdown prevents new retrieval.

The two-phase host transport is trusted security code. It must bind DNS results
to permitted sockets, verify TLS and hostname/SNI, reject every redirect, omit
credentials and cookies, enforce wire/buffering limits without decompression,
honor checkpoints and cancellation, and close streams on all exits. Proxies
must apply the destination policy themselves. Connection pools must be scoped
to tenants and pin sets. OS/proxy/sandbox egress restrictions remain necessary;
validating a reported address does not attest an arbitrary callback's behavior.
See [the SDK contract](docs/sdk.md#protected-external-retrieval-h01-b) for
R-H1 through R-H8 and host composition requirements.

Results carry opaque registered-target provenance and `trust: 'untrusted'`.
Response headers, URLs, transport exceptions and host credentials are not
projected into the result. The body remains untrusted external text, not a
secret-scanning guarantee or authenticated evidence. Do not turn it into grants,
admin instructions, executable code, verified feedback, model approval or
implicit training input. Non-cooperative host work can retain draining leases;
the host owns forcible cancellation. Immediate identity-provider revocation
must abort the root signal. No transport or live-network verification is
provided by H01-B.

## Hanuman specialist (H02-B)

Explicit Hanuman registration checks tool availability and confers no
permissions. Only the leased H01 protected tool can retrieve an approved target
on the supported runtime path. Jay, Vijay and NARASIMHA still control identity,
approval, scope, resource budgets and revocation. The specialist checks the
tool envelope and emits bounded text with explicit untrusted provenance.
Treat the excerpt as external data and the evidence digest as an unsigned
identifier. The H01 security review remains NO-GO for live deployment.

## Hanuman offline examples (H06)

The scripts in `examples/sdk/hanuman/` use only public SDK entry points and a
fake in-memory transport. They do not show that a host transport is SSRF-safe,
pins DNS or validates TLS. Their identity, approval and firewall-admin
callbacks are fixtures: `authorizeAdmin` always returns `true`, and the demo
user holds the admin permission. Do not copy these into a host. Keep firewall
admin on a separate administrator role, with human approval, and out of every
bot and tool context. SHIVAX has no native web search. `research.search` and
`fetch.api` remain reserved and fail closed in RUDRA. Public RUDRA errors for
gateway failures are generic by design. Use the gateway `observe` callback
for host diagnostics.
