# Security policy

ShivAX implements local CPU tensors, dense-network training/inference, and text
features. It does not load executable models, make network requests, or host an
API. There are no production dependencies or consumer installation scripts. Dependency audits
cover known published advisories; they are not a security certification.

## Reporting a vulnerability

Use a confidential issue at
https://gitlab.com/urveshgohil.developer/shivax/-/issues/new and mark the issue
confidential before submitting. If confidential reporting is unavailable, ask
the maintainer for a private channel without including exploit details or secrets.
Include the affected version, reproduction steps, and impact.
No response-time guarantee is currently established.

## Development and releases

- Commit pnpm-lock.yaml and install with `pnpm install --frozen-lockfile`.
- Run `pnpm lint`, `pnpm test`, and `pnpm audit` before release. Audit includes
  development dependencies because they execute during the build.
- Review dependency upgrades and installation scripts before allowing them.
  Do not enable build scripts globally to suppress an installation warning.
- Run `npm pack --dry-run --ignore-scripts` after building and inspect the file
  list. The publish allowlist excludes source, tests, credentials, and tool caches.
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
- Any future URL loader needs an explicit destination policy, redirect checks,
  response-size limits, and timeouts to prevent SSRF and resource exhaustion.
- Applications hosting the library must provide authentication, authorization,
  rate limits, TLS, and safe error handling. These are not implemented by this
  library. Keep AI service keys on the server and minimize sensitive prompt logs.
- Deploy application production dependencies only. ShivAX's compiler, bundler,
  and other development tools are not required by consumers at runtime.
