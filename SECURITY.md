# Security policy

SHIVAX is a library. Its core implements CPU tensors, dense neural networks, text
features, bot contracts, RUDRA orchestration, Jay/Vijay authentication and
authorization checks, scoped memory and model routing. The core makes no network
requests on import or by default. Optional host-configured adapters can: the
loopback Ollama adapter, remote model clients, embedding and persistence adapters,
and Inspectra page capture. SHIVAX does not host an API or service. There are no
production dependencies or consumer installation scripts. Dependency audits cover
known published advisories; they are not a security certification.

See `docs/production.md` for trusted host versus browser boundaries.

## Supported versions

This document describes version 0.2.0 NARASIMHA. The managed firewall and the fail-closed
model usage checks are new in 0.2.0 and are not in 0.1.3 or earlier. No support
window or backport policy is currently established.

## Reporting a vulnerability

Do not put vulnerability details, exploit code or secrets in a public issue.
Open an issue at https://github.com/urveshgohil/ShivAX/issues titled
"Security contact request", with no technical details, and the maintainer will
arrange a private channel. Then send the affected version, reproduction steps and
impact through that channel. No response-time guarantee is currently established.

## Development and releases

- `pnpm-lock.yaml` is currently not committed (it is listed in `.gitignore`), and
  CI installs with `--no-frozen-lockfile`. Builds are therefore not pinned to a
  reviewed lockfile. Committing the lockfile and installing with
  `pnpm install --frozen-lockfile` is recommended before a stable release.
- Run `pnpm lint`, `pnpm test`, and `pnpm audit` before release. Audit includes
  development dependencies because they execute during the build.
- Review dependency upgrades and installation scripts before allowing them.
  Do not enable build scripts globally to suppress an installation warning.
- Run `npm pack --dry-run --ignore-scripts` after building and inspect the file
  list. The publish allowlist excludes source, tests, credentials, and tool caches.
  It includes `dist/`, the Inspectra adapter, selected documentation and the
  runnable examples under `examples/sdk/`.
- Keep registry tokens in CI secrets, use least privilege and registry MFA, and
  never log credentials. Only authorized maintainers should publish releases.

## Current limits

Tensors reject nonfinite and Float32-overflowing values and cap each allocation
at 1,048,576 elements. Matrix multiplication caps its scalar product work at
50 million terms. Networks cap widths at 4096, layers at 8, and parameters at
one million. Training validates shapes and classification targets before updates;
each call caps input/target elements at ten million and the product of epochs,
samples and parameter count at 250 million. These are work estimates, not time
or memory isolation guarantees. Large synchronous calls can still block the
caller: use a worker, as the digit example does. Failed training may retain
earlier completed batch updates; it is not transactional.

Text features limit per-document length, corpus size, and vocabulary. These
checks handle plain arrays and strings, not hostile JavaScript objects/getters
executing inside your own process. Do not execute untrusted code in-process.

## Requirements for further AI features and deployments

- Treat datasets, prompts, model files, and model output as untrusted input.
  Validate finite numeric values, array dimensions, and configuration ranges at
  runtime; TypeScript types do not validate incoming JavaScript or JSON.
- Bound input size, allocation, training iterations, execution time, and
  concurrency. Run expensive or untrusted workloads in isolated workers with
  resource limits and cancellation.
- Never evaluate user-provided JavaScript or deserialize executable models.
  Validate model formats and verify downloaded artifacts against trusted hashes.
- Every host URL transport needs an explicit destination policy, redirect checks,
  response-size limits, and timeouts to prevent SSRF and resource exhaustion.
- Applications hosting the library must provide authentication, authorization,
  rate limits, TLS, and safe error handling. Jay/Vijay and the optional managed firewall enforce SDK checks using trusted host identity and approval adapters; deployment security remains the responsibility of the host using this
  library. Keep AI service keys on the server and minimize sensitive prompt logs.
- Deploy application production dependencies only. ShivAX's compiler, bundler,
  and other development tools are not required by consumers at runtime.


## Managed firewall boundary (new in 0.2.0)

The additive firewall core starts in enforce mode and retains mandatory Jay/Vijay,
approval, tenant, sandbox and budget checks in monitor mode. Lockdown blocks new
managed external operations and requests cancellation; explicitly permitted pure
CPU operations remain available. Administrative mutation is a separate capability
requiring authenticated host authorization and Vijay approval. See docs/sdk.md for
configuration, rollback, audit and cancellation semantics.

Coverage is explicit: registered managed operations participate; raw SDK calls and
arbitrary host code do not become isolated automatically. File paths and network
origins are declared contracts that trusted adapters must honor. Actual egress,
symlink/redirect/DNS controls, durable policy storage, multi-process revocation and
termination of noncooperative I/O require the host, proxy, OS firewall or sandbox.
An npm JavaScript library cannot prevent a malicious host from bypassing its code.
Never pass administrator capabilities or authenticated root objects to bots.
