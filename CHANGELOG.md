# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

Changes in the source after the published 0.1.3 package. Not yet released to npm.

### Added

- Managed firewall in `shivax/security` (R04): `createShivaxFirewall` with `enforce`, `monitor` and `lockdown` modes, default-deny registered operations, exact shared model budgets, versioned policy replacement and rollback, cancellation leases and sanitized bounded audit events.
- Protected execution binding (R05): `protectExecution: true` binds the firewall to one Vijay instance, so RUDRA, workflows and protected tools using it pass firewall admission. Vijay gains an additive `runOperation` method.
- Guarded model and integration calls (R06): `createGuardedModelGateway` in `shivax/models`; live `checkNetworkAccess` and `checkFileAccess` callbacks for protected tools; destination checks for remote models, Ollama, memory embeddings and persistence, and Inspectra page acquisition.
- Firewall management (R07): `openShivaxFirewallManagement` with authenticated, approval-gated changes to host-approved policy profiles, compare-and-swap persistence, lockdown and audit reads.
- `ModelFailureReason` type, additive `error.reason` classification on model errors, and `ModelError` constructor aliases (R02).
- Runnable SDK examples now ship in the package under `examples/sdk/`, including a new `firewall.mjs`. Package verification checks every documented example is packed and runs the offline ones from an installed copy.
- `docs/production.md`: scope, bot capabilities, model requirements, firewall setup, trust boundaries and known limitations.
- `repository`, `bugs` and `homepage` package metadata pointing to the public GitHub repository.

### Changed

- **Breaking:** token-based model providers must report verifiable token counts. Missing, `null`, fractional, negative or oversized counts, and missing or malformed cost, now fail with the new terminal code `usage-unverifiable`, with no fallback and no further use of that router (R02). Providers that do not bill by token must declare `tokenBased: false`. An explicit `null` cost is still accepted.
- Reported model cost is reconciled as the larger of the reservation and the reported charge. A verified token or cost overrun latches `usage-limit`, stops fallback and blocks later calls on that router, including overruns reported late after cancellation or timeout (R01, R02).
- The Ollama adapter keeps reported token usage when generated JSON fails to parse, so an overrun is still enforced (R02).
- In protected use, `RemoteModelAdapter` loaders must provide `inferGuarded`; legacy-only transports are denied there. Unprotected use is unchanged (R06).
- SECURITY.md now describes the actual network scope, supported versions and a publicly reachable reporting route. Shipped documentation no longer refers to private sibling applications as package content.

### Fixed

- Exact model cost accounting: three $0.10 calls now fit a $0.30 budget; previously floating-point addition rejected the third (R00-01, fixed in R01).
- Malformed model output no longer hides a reported token overrun and lets a fallback provider run (R00-02, fixed in R02).

### Known issues

- The workflow `ToolRegistry.registerModel` path still accepts `null` token counts from token-based providers and can retry a thrown hard budget error (R03 finding G02).

## [0.1.3] - 2026-11-01

### Added

- Conditional ESM and CommonJS declaration graphs for every public SDK entrypoint, including the optional Inspectra adapter.
- Packed-consumer verification for strict bundler, Node16 and NodeNext TypeScript consumers, with ESM/CommonJS type compatibility checks.
- Cross-platform package verification CI for Linux and Windows on Node.js 22, 24 and 26.

### Changed

- Target ES2022 JavaScript while preserving the previous public class-field assignment semantics. Older browser targets require application-side dependency transpilation.
- Declare inspectra-engine 1.0.4 as an optional peer, verified separately from SHIVAX core.
- Install verification tarballs into isolated temporary projects outside the repository and retain cleanup on failures.

### Fixed

- Rollup private-field helper warnings and unresolved optional Inspectra subpath imports.
- Windows pnpm.exe execution in package verification, with safe native/JavaScript CLI dispatch, wrapper handling and actionable child-process diagnostics.
- TS1479 errors for CommonJS SDK consumers using TypeScript Node16 resolution.
- Missing or incompatible Inspectra modules now produce sanitized setup guidance while preserving lazy loading, cancellation and page cleanup.

## [0.1.2] - 2026-10-29

### Added

- Supported SDK entry points for core intelligence, RUDRA, specialists, security, models, memory, learning and integrations, with ESM/CommonJS declarations and shared runtime classes.
- UI-safe structured diagnostics and a server-verified licensing interface for a future Lemon Squeezy adapter.
- Registry, local inference, workflow, durable memory, Inspectra and React examples, plus an approval-gated SHIVAX demo in Visynq Workstation.
- Packed-consumer export/type verification and release-readiness reporting.

### Changed

- Build shared SDK chunks while preserving the existing package name and root exports.

## [0.1.1] - 2026-10-28

### Changed

- Expand npm discovery keywords and describe SHIVAX as a JavaScript/TypeScript multi-agent AI framework.
- Add feature-based use cases and concise README answers about platforms, model providers, controlled workflows, UI inspection, and learning.

## [0.1.0] - 2026-10-03

This entry records the current development baseline. The date is the documentation
baseline date and does not assert that a package release was published or tagged.

### Added

- CPU tensors, matrix operations, dense neural networks, classification/regression metrics, and bag-of-words text features.
- Configurable activations, SGD/momentum/Adam optimizers, initialization options, and JSON inference-model serialization.
- Handwritten digit training and inference playground with local model storage.
- Shared bot contracts, registry, capability discovery, lifecycle events, input/output validation, and execution contexts.
- RUDRA task coordination, deterministic routing, dependent workflows, approval handling, cancellation, retries, limits, and execution traces.
- Jay authentication and Vijay authorization with trusted host identities, session checks, protected tools, deny-by-default policies, and audit records.
- Sanjay, Brihaspati, Vishwakarm, Chitragupt, Narad, Yudhishthir, and Ekalavy specialist bots.
- Model-provider interfaces, neural/rules adapters, optional Ollama-compatible inference, configurable remote adapters, and capability-aware routing.
- Scoped memory with retention, search, export/deletion, optional embeddings, and in-memory, Node file, and IndexedDB adapters.
- UI observation contracts, semantic/structural matching, visual comparison, validated findings, and a separately maintained Inspectra adapter.
- Controlled autonomous workflows with structured tool proposals, pause/resume, safe parallel reads, approval checks, and per-task model/tool budgets.
- Verified feedback storage, evaluation datasets and metrics, curated training exports, isolated offline neural training, evaluated model/configuration updates, and approved rollback.
- ESM/CommonJS entry points and portable TypeScript declarations.

### Changed

- Adopt SHIVAX AI branding: Synthetic Hybrid Intelligence with Versatile Autonomous eXperts.
- Standardize bot names to Sanjay, Vishwakarm, Chitragupt, Narad, Yudhishthir, Ekalavy, Jay, and Vijay.

### Fixed

- Screenshot-to-UI correspondence and Inspectra cancellation cleanup.
- Memory delete/recreate concurrency checks, semantic score stability, and deadline enforcement before storage commits.
- Pause requests during workflow resume authentication and fractional cost-budget rounding.
- Evaluation report consistency and held-out classification-target validation.
- Training weight-change reporting for zero-gradient updates.

[0.1.3]: https://www.npmjs.com/package/shivax/v/0.1.3
[0.1.2]: https://www.npmjs.com/package/shivax/v/0.1.2
