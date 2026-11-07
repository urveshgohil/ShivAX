# Security policy

ShivAX is a library. Its core provides CPU tensors, dense neural networks, text
features, bot contracts, RUDRA task handling, Jay and Vijay sign-in and permission
checks, scoped memory and model routing. The core makes no network requests,
on import or by default. Some optional adapters that your host sets up can: the
loopback Ollama adapter, remote model clients, embedding and storage adapters, and
Inspectra page capture. ShivAX does not run an API or service. It has no
production dependencies and no install scripts for consumers. Dependency audits
cover known published advisories. They are not a security certification.

See `docs/production.md` for what belongs on a trusted host and what can run in a
browser.

## Supported versions

This policy covers version 0.2.0 NARASIMHA. The managed firewall and the strict
model usage checks are new in 0.2.0. They are not in 0.1.3 or earlier. There is
no support window or backport policy yet.

## Reporting a vulnerability

Please do not put vulnerability details, exploit code or secrets in a public
issue. Instead, open an issue at https://github.com/urveshgohil/ShivAX/issues
titled "Security contact request", with no technical details. The maintainer will
set up a private channel. Then send the affected version, the steps to reproduce
it and its impact through that channel. There is no promised response time yet.

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
