# Security policy

ShivAX is currently a types-and-version scaffold. It does not yet implement
training, inference, model loading, network requests, or a hosted API. There are
no production dependencies or consumer installation scripts. Dependency audits
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

## Requirements for future AI features and deployments

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
