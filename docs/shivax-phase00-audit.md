# ShivAX AI — Phase 00: audit existing ShivAX

Date: 2026-10-25 (Asia/Calcutta). Audited checkout: `e47f462`
(`feat: enhance UI analysis with document pair handling and SLM integration`).

Project identity supplied for the planned evolution:
**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**.
Tagline: **One Intelligence. Many Specialized Minds.**

## Outcome and scope

The existing project is a working, dependency-free TypeScript ML and UI-analysis
library with optional model-provider integration. It is not yet a multi-agent
framework. RUDRA and all nine named specialist bots are absent from source and
public exports. Existing implementations provide reusable capabilities without
requiring a rewrite of the neural-network or MNIST work.

Phase 00 adds this audit only. No runtime API, package metadata, source, dataset,
test, dependency, or build configuration is changed. Generated `dist/` output was
rebuilt using the existing build. Nothing was published or deployed.

Scope: this ShivAX checkout, its source, tests, examples, scripts, documentation,
and local package dry run. Related Inspectra and Visynq repositories were not
audited. The older [Visynq audit](visynq-phase0-audit.md) is historical context,
not current verification of those repositories. No applicable `AGENTS.md` was
found in the checkout or checked ancestor directories.

## Existing architecture

| Area | Source | Observed responsibility |
| --- | --- | --- |
| Public entry | `src/index.ts`, `src/types/index.ts` | Version, core ML exports, visual and SLM re-exports, configuration types |
| Numeric foundations | `src/core/Tensor.ts`, `src/core/math.ts` | CPU Float32 tensors, matrix operations, stable sigmoid/softmax, seeded randomness |
| Neural networks | `src/nn/NeuralNet.ts`, `activations.ts`, `optimizer.ts` | Dense Float64 parameter training; binary, multiclass and regression tasks; SGD/momentum/Adam; versioned inference serialization |
| Evaluation | `src/metrics/evaluation.ts` | Accuracy, cross-entropy, classification and regression metrics |
| Text baseline | `src/text/BagOfWords.ts` | Bounded fitted vocabulary and normalized token counts; not a language model |
| Scene contracts | `src/visual/types.ts`, `validation.ts`, `geometry.ts` | Validated snapshots, known/unknown measurements, provenance, confidence, normalization and geometric operations |
| Matching | `src/visual/matching/` | Deterministic hierarchical correspondence, evidence scores, ambiguity and work limits |
| Comparison | `src/visual/analysis/` | Deterministic measured differences, content policies, tolerances and structured issues |
| Optional reasoning | `src/slm/`, `src/visual/slm.ts` | Injectable provider/client, loopback Ollama transport, validated evidence selection and deterministic fallback |
| Digit example | `examples/digits/` | Browser drawing, preprocessing, worker training/inference, metrics, explicit IndexedDB model storage and JSON import/export |
| Local tooling | `scripts/` | Fixed-output cleanup, allowlisted demo server, local IDX subset preparation and dataset comparison |
| Empty placeholders | `src/data/DataFrame.ts`, `src/models/LinearRegression.ts` | Both are zero-byte files, not implemented or exported features; regression is supported through `NeuralNet` |

Core execution does not depend on the browser example or a model service.
The visual pipeline consumes measurements supplied by adapters; it does not
capture URLs, query Figma, or decode PNGs. Model advice augments the deterministic
result and does not replace its measured findings.

## Language, build and compatibility contracts

- Package: `shivax@0.1.0`, Apache-2.0, `type: module`, `sideEffects: false`.
- Runtime requirement: Node.js >=22. Audit host: Node.js v24.19.0 on Windows.
- Manifest package manager: `pnpm@12.8.1`. Compiler target: strict TypeScript,
  ES2020, ESNext modules, bundler resolution, ES2020 and DOM build libraries.
- Build: `node scripts/clean.mjs && tsc && rollup -c rollup.config.mjs`.
  TypeScript emits declarations/intermediate modules; Rollup emits ESM and CJS.
- Only the root `.` is a declared package export. Import resolves to
  `dist/index.esm.js`, require to `dist/index.cjs`, types to `dist/index.d.ts`.
  Internal source paths are not declared public subpaths.
- No runtime or optional dependencies and no consumer install hooks are declared.
  Heavy models and runtimes are not bundled, downloaded or initialized on import.
- Tests use Node's built-in test runner and `.test.mjs` files against built code.
  Existing tests compare ESM/CJS exports and type-check a core consumer with
  ES2020 alone and no DOM/Node ambient types.
- TypeScript files are checked with `tsc`; ESLint currently targets `.mjs`
  tooling with a small rule set. A passing lint does not imply a broad TS style
  or security analysis.

Preserve existing root exports, synchronous core APIs, default neural-network
behavior and serialized format. Browser support is an existing design target;
this phase did not execute a fresh browser compatibility matrix.

## Neural-network and MNIST preservation baseline

`NeuralNet` exposes `train`, `predict`, `predictClass`, `resetOptimizer`,
`toJSON` and `fromJSON`. Defaults remain tanh + Xavier + SGD with seed 42.
Opt-in hidden activations are ReLU, Leaky ReLU and sigmoid; initialization also
supports He/auto. Classification uses task-specific sigmoid/softmax outputs;
regression has linear outputs. Training mutates the model synchronously.

Serialization is `shivax-neural-net`, version 1, containing configuration and
weights/biases. It validates dimensions, finite values, format and executable
object hazards. It restores inference, not an exact training checkpoint:
optimizer moments and random-generator progress are not serialized.

The digit pipeline preserves aspect ratio and grayscale, centers input by mass,
rejects blanks, deduplicates exact samples and rejects conflicting labels.
Stratified splits separate original train/validation/test examples; augmentation
uses training data only. Validation chooses the model before held-out test
evaluation. Worker termination provides immediate UI cancellation of synchronous
training. Live inference gates concurrent requests and rejects stale responses.
Model persistence in the demo is explicit and distinct from agent memory.

Local dataset validation used the existing `parseDataset` and `stratifiedSplit`
functions, without training or rewriting the file:

| Item | Verified value |
| --- | --- |
| File | `shivax_training_500_latest.json` |
| Size | 2,069,201 bytes |
| SHA-256 | `d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9` |
| Original / unique samples | 500 / 500, zero duplicates removed |
| Labels | 50 samples for each digit 0–9 |
| Default split | 360 train / 70 validation / 70 test |
| Current parser | Accepted; no split warning |

The filename and class balance do not establish MNIST provenance. Original IDX
inputs and independent accuracy were not verified. The existing IDX preparation
script reads user-supplied local files, validates headers and sizes, bounds gzip
output, and creates a new output with exclusive-write semantics. No dataset or
model was downloaded. Passing synthetic tests is not handwriting accuracy.

## Model integration and security boundaries

The existing `SLMProvider` interface injects initialization, generation and
disposal. `SLMClient` is disabled by default, owns one company/personal scope,
requires explicit external-provider opt-in, bounds context/output and deadlines,
sanitizes failures, and prevents concurrent reuse. `OllamaProvider` accepts an
injectable transport; its default uses native `fetch` for fixed API paths on a
validated loopback origin, rejects redirects and remote model metadata, and
sends fresh conversations. Actual model reasoning was not exercised in this
audit: provider tests use explicit fixtures.

`analyzeUIWithSLM` validates output shape and evidence references. Invented IDs,
values and unsupported relationships fall back atomically. CSS values come from
measurements. Deterministic descriptions and fallback are labeled as such; they
are not evidence that a model ran. Matching confidence is an evidence score,
and digit softmax outputs are not calibrated probabilities of correctness.

Existing resource bounds include:

- Tensors: 1,048,576 elements per allocation; matrix work up to 50 million terms.
- Networks: 2–8 layer widths, width <=4096, <=1 million parameters; dataset work
  and per-call training work limits. Completed batch updates may remain after
  cancellation or failure.
- Scenes: <=10,000 nodes; matching and comparison each default to 250,000 work
  units with configurable limits up to 1 million.
- Digit demo: 5 MB dataset text, 50–500 samples, 784 finite pixels per sample;
  bounded training options and model JSON imports.

No filesystem, shell execution or unrestricted network tool registry was found
in library source. Filesystem operations and the loopback HTTP demo server live
in development scripts; IndexedDB is confined to the browser example. Importing
the library does not start the server or read a dataset.

These are API constraints, not a security sandbox. Injected providers execute
trusted application code; they can ignore cancellation or misdeclare locality.
The SLM caller's deadline cannot kill provider work. A provider that never
settles can retain the busy guard. Scope IDs are caller-supplied namespace
checks, not authenticated identities or authorization decisions. No Jay/Vijay
implementation, per-tool permission policy, or process isolation exists.

## Readiness for RUDRA and the specialists

The following mapping identifies reuse opportunities, not implemented bots or
an approved scope for the next phase.

| Planned component | Existing reusable capability | Missing framework responsibility |
| --- | --- | --- |
| RUDRA — orchestration | Structured inputs/results and provider injection patterns | Task contracts, bot registry, routing, lifecycle, cancellation/budget propagation and execution trace |
| Sanjay — Vision | Scene validation, geometry, matching and UI analysis | Specialist adapter; general image understanding or a configured vision backend |
| Brihaspati — Reasoning | Optional SLM provider/client and evidence validation | Specialist task/schema contracts and reasoning backend selection |
| Vishwakarma — Code | TypeScript library/tooling only | Code generation backend, artifact contracts and permission-limited actions |
| Chitragupt — Memory | Demo-only explicit model persistence | Scoped memory interface, retention, retrieval and storage adapters |
| Narad — Inspection | Structured visual measurements and differences | Injection of a constrained Inspectra adapter and inspection task contract |
| Yudhishthir — Review | Evidence-backed issues and review-required SLM advice | Specialist review rules and review result/lifecycle contracts |
| Ekalavy — Learning | Real dense-network training and evaluation | Learning task adapter, dataset policy and controlled model updates |
| Jay — Authentication | No authentication implementation | Trusted identity/session verification adapter |
| Vijay — Authorization | Scope equality checks only | Explicit capability/resource decisions and enforcement at action boundaries |

Planned ownership should follow the supplied project brief: `shivax` owns
intelligence and bot contracts; `inspectra-automation` owns browser automation;
Visynq Workstation owns the React application and composes them. The old audit
uses the name Inspectra; current related-package names/exports were not verified.
Do not add Playwright, React or a mandatory model runtime to this library merely
to create the future specialist names.

## Findings to address in separately requested work

| Priority | Evidence | Consequence / follow-up |
| --- | --- | --- |
| High before credentials are introduced | `.gitignore` explicitly negates `.env` and `.env.*`; `git check-ignore -v` confirms those rules | Environment files can be added to Git. Review ignore policy before provider credentials or application integration; no secret contents were scanned or exposed in this audit. |
| Medium | `.gitignore` ignores `pnpm-lock.yaml`; `git ls-files pnpm-lock.yaml` returns no tracked file, although a local lockfile exists | README and SECURITY require committing the lockfile and frozen installs. Repository state does not meet that documented reproducibility policy. |
| Medium | `SECURITY.md` says the library makes no network requests; `src/slm/ollama.ts` supplies opt-in loopback fetch and custom providers may be external | Security documentation needs an accurate description of optional inference and its trust boundary. |
| Medium | README says no model persistence exists despite `NeuralNet.toJSON/fromJSON` and demo storage; it also claims GitLab CI release checks, but no local `.gitlab-ci.yml` was found | Documentation is stale. Remote CI configuration was not inspected, so CI execution cannot be certified. README also retains a GitLab starter template. |
| Low | Package `files` excludes `docs/`; local dry run includes README with relative links to those omitted guides | Installed-package documentation links can point to missing files. Decide whether to include guides or use repository URLs. |
| Low | Two zero-byte source placeholders produce empty declaration files in the package | Do not present `DataFrame` or a standalone `LinearRegression` class as working capabilities. Defer removal/implementation to an explicit scope. |
| Environment | `pnpm lint` and `pnpm --version` encounter EPERM creating the global pnpm store | Direct local compiler/ESLint checks pass. Successful script execution earlier in the session does not resolve the package-manager environment inconsistency. |

RUDRA, bot/tool schemas, auth adapters, isolation and durable agent memory are
architecture gaps relative to the new objective, not regressions of the current
ML library. None were implemented during this audit.

## Verification evidence

Checks below were run locally during this Phase 00 session; existing documentation
test counts were not reused as current evidence.

| Check | Result |
| --- | --- |
| `pnpm test` | Passed: 140 tests, 0 failures, 0 skipped; includes the existing build |
| Existing build within `pnpm test` | Passed: TypeScript declarations and Rollup ESM/CJS bundles |
| `pnpm lint` | Wrapper failed with EPERM on global pnpm store; not reported as passing |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed; equivalent compiler portion of lint |
| `node node_modules/eslint/bin/eslint.js .` | Passed; equivalent ESLint portion of lint |
| `npm pack --dry-run --ignore-scripts --json --cache <temporary-cache>` | Passed: 31 entries; no source/tests/dataset included; no package published |
| Local dataset parser/split check | Passed, as recorded above |

The suite covers hand-computed math, convergence, finite-difference gradients,
optimizers, serialization safety, digit normalization/splitting/workers/storage,
ESM/CJS parity, portable declarations, scene validation, matching ambiguity,
comparison and SLM failure/cancellation/security contracts. These are automated
regressions and synthetic fixtures, not a measured general AI capability.

No new functionality was introduced, so no new executable tests were added.
No live Ollama request, network vulnerability-advisory audit, fresh dependency
installation, real browser session, cross-browser matrix, MNIST benchmark, or
related-project integration was run. A dry run checks packaging without running
prepack hooks; lint and tests were checked separately as described above.

## Change manifest and completion

Changed file: `docs/shivax-phase00-audit.md` (new audit report only).

Architecture changes: none. Existing neural networks, MNIST assets/tooling,
runtime exports, defaults, optional inference and Node/browser boundaries are
preserved. Findings remain open for a separately requested phase.

**Phase 00 is complete. Stop here; no subsequent phase has started.**
