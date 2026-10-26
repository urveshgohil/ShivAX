# SHIVAX architecture

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**  
**One Intelligence. Many Specialized Minds.**

Phase 00 audit baseline, 2026-10-25 (Asia/Calcutta), checkout `e47f462`,
with the additive [Phase 01 bot foundation](bot-foundation.md) and
[Phase 02 RUDRA orchestrator](rudra-orchestrator.md), followed by
[Phase 03 Jaya/Vijaya security](jaya-vijaya-security.md) and the
[Phase 04 specialist system](specialist-bots.md) (2026-10-26).
Sections describing the current implementation are source-backed observations.
The logical structure clarified on 2026-10-26 describes responsibility boundaries,
not a required repository reorganization. Its mapping to current files is in section 6.
The registry, contracts, events and one-bot executor are implemented in Phase 01;
bounded RUDRA workflows are implemented in Phase 02. Phase 03 adds trusted host
identity validation and policy-enforced tool boundaries. Phase 04 adds all seven
specialists, optional provider interfaces, deterministic adapters and protected
session memory/feedback. Real model/provider configuration and external resource
integrations remain host-configured or future work.
See [implementation phases](SHIVAX_PHASES.md) and the
[initial audit evidence](shivax-phase00-audit.md).

## 1. Findings first

1. SHIVAX already has a real CPU ML engine: bounded tensors, dense-network
   backpropagation, three optimizers, evaluation and inference serialization.
   The digit pipeline and browser playground build on that engine.
2. SHIVAX also has deterministic visual scene validation, matching/comparison
   and an optional injectable SLM integration. These are useful specialist
   capabilities, but do not constitute RUDRA or a multi-bot runtime.
3. Phase 01 adds a bot registry, shared contracts, task context, typed events and
   explicit one-bot execution. Phase 02 adds provider-independent RUDRA routing,
   validated ordered plans, approval hooks, bounded retries and execution traces.
   Phase 03 adds Jaya context provenance/session verification and Vijaya policy
   checks, explicit approval and protected tool leases. Phase 04 adds the seven
   specialist adapters, discoverable input schemas and bounded in-memory session
   stores. General tools and durable agent memory remain unimplemented.
4. The safest extension is additive: small bot adapters call existing APIs;
   RUDRA routes bounded tasks to explicitly registered implementations.
5. Release hygiene and documentation need attention: environment-file ignore
   exceptions, an ignored/untracked lockfile, stale security/persistence claims,
   omitted package guides and unverified CI claims are recorded below.

No working code is refactored or replaced in Phase 00.

## 2. Repository coverage and current ownership

The audit covers the repository's source, public entry points, configurations,
tests/fixtures, examples, local scripts, documentation, package file selection
and the local dataset. Generated output and installed tooling were inspected
where relevant to exports, build and packaging. Third-party dependency source
and Git history were not audited line by line.

| Path | Current role and status |
| --- | --- |
| `package.json` | `shivax@0.1.0`, Apache-2.0, Node >=22, no production dependencies; scripts and root package contract |
| `src/index.ts`, `src/types/` | Public root entry and simple numeric/configuration types |
| `src/core/` | `Tensor`, numeric validation and stable math; no I/O |
| `src/nn/` | `NeuralNet`, activations and optimizer implementation |
| `src/metrics/`, `src/text/` | Evaluation and bounded bag-of-words features |
| `src/visual/` | Scene contracts, validation/normalization, geometry, hierarchical matching, measured comparison and SLM advice |
| `src/slm/` | Provider contract, scoped client, sanitized errors and loopback Ollama adapter |
| `src/agents/` | Phase 01 contracts, context/input/result validation, registry, events and explicit one-bot executor |
| `src/agents/rudra/` | Phase 02 deterministic routing, pluggable planner, sequential dependencies, host approval, budgets, cancellation and traces |
| `src/security/` | Phase 03 Jaya, Vijaya, permission/tool registries, bounded audit records and revocable tool clients; real identity/services remain host-configured |
| `src/bots/` | Phase 04 seven specialists, shared schema/result handling, injected provider contracts, bounded session stores and explicit RUDRA composition |
| `src/data/DataFrame.ts`, `src/models/LinearRegression.ts` | Empty placeholders, neither implemented nor root-exported |
| `examples/` | XOR, regression, text, typed core, scene and comparison examples; digit playground |
| `examples/digits/` | Drawing/preprocessing, training/inference worker, dashboard, live inference and explicit IndexedDB model storage |
| `scripts/clean.mjs` | Deletes only fixed generated `dist/` output |
| `scripts/serve-examples.mjs` | Loopback static demo server with explicit route allowlist and ports 4173–4182 |
| `scripts/prepare-mnist.mjs` | Local bounded IDX/gzip validation, balanced subset conversion and exclusive creation of new JSON output |
| `scripts/compare-digits.mjs` | Explicit local-file, reproducible 500-sample dataset comparison; distinct in-domain test sets |
| `tests/` | 17 Node test files plus fixtures, covering core, digits, package, visual, SLM, foundation, RUDRA, security and specialist contracts |
| `docs/`, `README.md`, `examples/README.md`, `SECURITY.md` | Feature guides, prior phase evidence and operating instructions; some historical claims are stale |
| `Shivax_Visual_Comparison_Phased_Prompts.md` | Historical visual/scanner plan; its claim that SLM/visual analysis is absent is superseded by current source |
| `custom-js-ai-plan.docx` | Historical aspirational feature plan, inspected as text; not proof that its proposed chat/camera/advanced models exist or current-phase authorization |
| `shivax_training_500_latest.json` | Existing user dataset; validated without rewriting it or asserting its origin |
| `tsconfig.json`, `rollup.config.mjs` | Strict TypeScript and dual ESM/CJS bundling |
| `eslint.config.mjs`, `.prettierrc` | Compiler checks plus limited `.mjs` lint rules and formatting conventions |
| `pnpm-workspace.yaml`, local `pnpm-lock.yaml` | Build-script restrictions and local dependency resolution; lockfile is currently ignored/untracked |
| `.gitignore`, `.npmignore`, package `files` | Repository and package inclusion policies; package dry run verifies actual included files |
| `LICENSE`, `NOTICE` | Apache-2.0 licensing and attribution |

No local CI manifest was found. The prior Visynq audit describes another
repository at an older date; current Inspectra/Visynq code was not re-audited.

Current data flow:

```text
Numeric data -> Tensor / NeuralNet -> predictions -> evaluation metrics
Local digit data -> training recipe -> worker-owned NeuralNet -> browser results
Canvas -> preprocessing -> 784 normalized values -> worker inference
Supplied UISnapshots -> validation/normalization -> matching -> analyzeUI
                                                       |
                              optional analyzeUIWithSLM -> SLMClient -> provider
```

Measurements, model output and deterministic computations remain distinct.
SHIVAX does not extract DOM data, capture browsers, fetch Figma designs or decode
PNG pixels through the visual API. Input source labels describe supplied data.

## 3. Existing public API inventory

Only `shivax` (`exports["."]`) is a supported package entry. ESM resolves to
`dist/index.esm.js`, CommonJS to `dist/index.cjs`, and declarations to
`dist/index.d.ts`. There are **68 runtime exports and 133 additional type-only
exports**. Classes below also have declaration types; the 133 count excludes
those runtime symbols. Internal `export` statements do not automatically make a
helper part of the root API.

### Runtime exports: complete inventory

| Area | Root-exported names |
| --- | --- |
| Package | `VERSION` |
| Tensor | `Tensor`, `MAX_TENSOR_ELEMENTS` |
| Math | `dot`, `sigmoid`, `softmax`, `seededRandom` |
| Network | `NeuralNet` |
| Metrics | `classificationAccuracy`, `crossEntropy`, `evaluateClassification`, `evaluateRegression` |
| Text | `BagOfWords` |
| Scene validation | `MAX_UI_NODES`, `validateUISnapshot`, `validateBoundingRectangle`, `validateComparisonOptions`, `normalizeUISnapshot`, `validateConfidence`, `validateSourceProvenance`, `validateUINode`, `validateTypographyProperties`, `validateLayoutProperties`, `validateElementRelationship` |
| Geometry | `distance`, `overlap`, `alignment`, `relativePosition`, `verticalGap`, `horizontalGap`, `contains` |
| Matching/comparison | `matchUISnapshots`, `analyzeUI`, `validateUIAnalysisOptions` |
| Model integration | `SLMClient`, `SLMError`, `OllamaProvider`, `analyzeUIWithSLM` |
| Bot foundation | `BotRegistry`, `BotExecutor`, `BotEventEmitter`, `BotError`, `createTaskContext`, `DEFAULT_EXECUTION_LIMITS`, `validateBotInput`, `validateBotResult` |
| RUDRA | `RudraOrchestrator`, `CapabilityPlanner`, `RudraError` |
| Security | `Jaya`, `Vijaya`, `PermissionPolicyRegistry`, `ProtectedToolRegistry`, `SecurityAuditLog`, `SecurityError` |
| Specialists | `SanjayaBot`, `BrihaspatiBot`, `VishwakarmaBot`, `ChitraguptaBot`, `HanumanBot`, `YudhishthiraBot`, `EkalavyaBot`, `createSpecialistBots`, `registerSpecialistBots`, `createSpecialistSystem`, `registerSpecialistServices`, `SessionMemoryStore`, `SessionFeedbackStore` |

### Type-only exports: complete inventory

| Area | Root-exported names |
| --- | --- |
| Base | `Vector`, `Matrix`, `Label`, `ModelConfig` |
| Network | `NeuralNetOptions`, `TrainOptions`, `TrainingResult`, `Task`, `Initialization`, `SerializedNeuralNet` |
| Activation/optimizer | `Activation`, `OptimizerName`, `OptimizerOptions`, `OptimizerConfig` |
| Metrics | `ClassMetrics`, `ClassificationMetrics`, `RegressionMetrics` |
| Scene | `UISnapshot`, `UINode`, `BoundingRectangle`, `TypographyProperties`, `LayoutProperties`, `ElementRelationship`, `SourceProvenance`, `Confidence`, `ComparisonOptions`, `Measurement`, `SourceType`, `RGBAColor` |
| Matching | `MatchingOptions`, `MatchingResult`, `MatchEvidence`, `MatchingSignal`, `MatchCandidate`, `ElementMatch`, `UncertainElement`, `UncertainTargetElement`, `RelationshipMatch` |
| Comparison | `ContentPolicy`, `UITolerances`, `UIAnalysisOptions`, `UIIssueCategory`, `UIIssueValue`, `UIIssueDifference`, `UISupportingMeasurement`, `UISuppressedIssue`, `UIIssue`, `UIAnalysisDiagnostic`, `UIAnalysisResult` |
| SLM provider/client | `SLMProvider`, `SLMLimits`, `SLMRequest`, `SLMClientOptions`, `SLMResult`, `SLMErrorCode`, `SLMScope`, `SLMSignal` |
| Ollama transport | `OllamaProviderOptions`, `SLMFetch`, `SLMFetchOptions`, `SLMFetchResponse` |
| Visual SLM advice | `SLMUITask`, `SLMUIOptions`, `SLMAdviceProvenance`, `SLMIssueAdvice`, `SLMUIResult` |
| Bot foundation | `Bot`, `BotContext`, `BotInput`, `BotResult`, `Capability`, `BotTask`, `TaskStatus`, `ToolDescriptor`, `SecurityContext`, `BotValue`, `BotSignal`, `CallerIdentity`, `ExecutionLimits`, `TaskContextOptions`, `TaskContext`, `BotErrorCode`, `BotErrorDetails`, `BotEventIdentity`, `BotEventMap`, `BotEventType`, `BotEventListener` |
| RUDRA | `RudraTaskStatus`, `WorkflowInput`, `WorkflowStep`, `WorkflowPlan`, `PlanningContext`, `Planner`, `RudraOptions`, `RudraErrorCode`, `RudraErrorDetails`, `StepOutput`, `ApprovalRequest`, `ApprovalHandler`, `ExecutionTrace`, `RudraHooks`, `RudraResult` |
| Security | `AuthenticatedPrincipal`, `AuthenticatedSession`, `AuthenticatedIdentity`, `IdentityProvider`, `AuthenticatedContextOptions`, `SecurityActionKind`, `ActionEffect`, `PermissionPolicy`, `ToolExecutionContext`, `ProtectedTool`, `BotToolClient`, `SecurityApprovalRequest`, `SecurityApprovalHandler`, `SecurityErrorCode`, `SecurityDecision`, `VijayaOptions`, `SecurityExecutionHooks` |
| Specialists | `SpecialistSystemOptions`, `SpecialistSchema`, `MemoryNamespace`, `MemoryRead`, `MemoryStorage`, `FeedbackStorage`, `SessionStorageOptions`, `SpecialistProviderContext`, `VisionImage`, `VisionModelAdapter`, `ReasoningProvider`, `CodeProvider`, `ReviewProvider`, `SpecialistProviders` |

### Class and function behavior

| API | Current contract |
| --- | --- |
| `new Tensor(data, shape)` | Row-major Float32 storage; defensive inputs/data copies; readonly `shape`, `size`, copied `data` |
| Tensor methods | `Tensor.zeros(shape)`, `get(...indices)`, `reshape(shape)`, `add`, `subtract`, `multiply`, `transpose`, `matmul`, `sum`, `mean`; operations return new tensors, except numeric reductions/access |
| Tensor constraints | Rank 1–8; <=1,048,576 elements; equal elementwise shapes or scalar; rank-2 transpose/matmul; matmul work <=50 million terms |
| `new NeuralNet(options)` | Binary, multiclass or regression; defaults tanh/Xavier/SGD, learning rate 0.1, seed 42; readonly `layers` and `task` |
| `train(inputs, targets, options?)` | Synchronous mutation; returns `{ losses, epochsCompleted, stopped }`; batch/shuffle/optimizer/rate settings, `onEpoch` stop callback and cooperative signal checks |
| `predict(row)` / `predictClass(row)` | One feature vector per call; probabilities for classification, values for regression; class prediction rejects regression |
| `resetOptimizer()` | Resets optimizer state without changing weights; rejected during training |
| `toJSON()` / `NeuralNet.fromJSON(value)` | Independent versioned data / validated object-or-text import; restores inference without optimizer moments or PRNG progress |
| `new BagOfWords(maxFeatures?)` | Default 1024, maximum 4096 features; `fit(texts)` returns this; `transform(text)` returns normalized known-token counts; `words` returns a copy |
| Math | Stable sigmoid/softmax; finite bounded dot product; `seededRandom(seed?)` returns a deterministic, non-cryptographic generator |
| Metrics | Classification accuracy/loss/confusion matrix/per-class metrics; regression MSE/RMSE/MAE/pooled R²; dimensions, work and finite values validated |
| Scene validators | Runtime assertion functions throw on malformed data; property validators take source context where required |
| `normalizeUISnapshot(value)` | Validates/deep-copies into CSS-pixel lengths using explicit scale, preserving provenance and unknown values |
| Geometry functions | Validated normalized rectangles; center distance/displacement, intersection/IoU, alignment flags, signed gaps, inclusive containment |
| `matchUISnapshots(reference, target, options?)` | Hierarchical one-to-one inferred matches with evidence, unmatched/uncertain elements, relationships and work count; same scope required |
| `analyzeUI(baseline, target, options?, onPhase?)` | Synchronous deterministic matching/comparison; issues, diagnostics and work count; optional matching/comparing observer |
| `new SLMClient(provider, options)` | Scope-bound, disabled by default; getters `state`, `providerId`; `generateJSON(scope,input,validate,signal?)` and async `dispose()` |
| `new OllamaProvider(options)` | Explicit local model; injectable fetch; `id`, `locality`, `limits`, async `initialize`, `generate`, `dispose`; constrained loopback transport |
| `new SLMError(code)` | Sanitized fixed-message error with `code`; provider bodies/prompts excluded |
| `analyzeUIWithSLM(baseline,target,options?)` | Async wrapper; preserves deterministic analysis and adds validated advisory evidence or explicit deterministic fallback |
| `BotRegistry` | Explicit register/unregister/get/list/findByCapability/listCapabilities; snapshots descriptors and rejects duplicate IDs |
| `BotEventEmitter` | Typed on/off/emit/clear, frozen lifecycle metadata, isolated observer failures |
| `createTaskContext(task, options)` | Frozen request/host snapshots; host supplies identity, scope, tool permissions, signal and limits separately |
| `BotExecutor.execute(bot, context)` | Caller-selected bot only; input/output validation, fixed errors, cancellation/deadline and per-object busy guard; no routing or RUDRA |
| `BotError`, bot validators and defaults | Fixed error codes/messages, structural input/result assertions and bounded default execution settings |
| `RudraOrchestrator.run(context, options?)` | Deterministic capability/ID routing, validated sequential workflows, host approval, bounded retries/deadline, aggregated outputs and immutable traces; one active workflow per instance |
| `RudraOrchestrator.dispose()` | Stops admission and requests cancellation; unfinished callbacks retain capacity until settlement |
| `CapabilityPlanner.plan(context)` | Single step for the requested capability; no provider or inference |
| `RudraError` | Fixed orchestration errors, separate from existing bot/SLM contracts |
| `Jaya.createContext`, `verify`, `assertActive` | Host adapter authentication, exact-context provenance, identity/session validation, expiry and revocation checks; client IDs alone cannot grant authority |
| `Vijaya.validateTask`, `runBot` | Root admission and per-attempt capability authorization, approval and tool leases; integrated through `RudraHooks.security` |
| `PermissionPolicyRegistry` | Register/get/list/unregister frozen policy snapshots; default deny, exact permission strings, resource predicates and mandatory approval for state changes |
| `ProtectedToolRegistry` | Register/get/unregister narrow host tool implementations with input/output predicates; no built-in resource handlers |
| `SecurityAuditLog.list` | Frozen snapshots of a bounded allow/deny ring; excludes credentials, input/output and raw identity/session/task IDs |
| `BotContext.tools` | Optional secured invocation client exposing only `execute(id,input)`; invalidated at bot completion |
| Specialist classes | Shared `Bot` interface, fixed IDs and 16 schema-validated capabilities; see the complete capability table in `specialist-bots.md` |
| `createSpecialistBots` / `registerSpecialistBots` | Create or explicitly register all seven instances; duplicate preflight prevents partial registration |
| `createSpecialistSystem` | Compose the registry, bots, optional protected services/security and RUDRA instance without global state |
| `registerSpecialistServices` | Install explicitly supplied memory/feedback handlers; grants no policies or permissions |
| `SessionMemoryStore` / `SessionFeedbackStore` | Bounded in-memory services keyed by verified issuer/principal/scope/session; host-owned cleanup and no automatic training |

`Optimizer`, `ResolvedOptimizer`, `activate`, `activationDerivative`, `finite`,
`integer`, provider budget helpers and tolerance resolution are internal to the
root contract. Example functions such as `trainDigits`, `parseDataset`,
`stratifiedSplit` and preprocessing are reusable source, not npm root APIs.
`ModelConfig` is a legacy generic type, not `NeuralNetOptions`.

## 4. ML, MNIST and browser behavior to preserve

The dense engine uses explicit backpropagation and Float64 parameters. Binary
output/loss is sigmoid/binary cross-entropy, multiclass is softmax/cross-entropy,
and regression is linear/MSE. Hidden activations include tanh, ReLU, Leaky ReLU
and sigmoid. SGD, momentum and Adam persist their state across training calls
until reset/reconfigured. Invalid batch updates do not partially commit that
batch; previously completed batches remain committed.

Network bounds are 2–8 widths, each <=4096, with <=1 million parameters.
Training caps sample counts, input/target elements and estimated work. These
are resource checks, not process isolation. Ordinary event-loop cancellation
cannot interrupt a blocking synchronous call; the demo terminates its worker.

Serialization format `shivax-neural-net`, version 1, stores configuration and
parameters. It validates plain structures, finite values, dimensions and format
fields; text imports are limited to 32 million UTF-16 code units. It is not an
exact training-resumption format. No executable model deserialization is used.

The digit example retains its 784 -> 32 -> 10 architecture, bounded settings,
training-only seeded augmentation, original-sample stratification and validation
selection before held-out testing. Canvas preprocessing composites alpha,
detects ink, area-resizes an aspect-preserving crop into 20x20, then centers it
by intensity mass on 28x28. Preview values match inference input; blanks are
rejected. Input data is not silently reprocessed to match drawings.

`shivax_training_500_latest.json` was accepted by the existing parser: 500 unique
samples, 50 per digit, default split 360/70/70. Its SHA-256 is
`d76f8820eaca279a14be7ff62af07bd4fb8dddfdd4ccba9855e6e620bfe200d9`.
Origin as original MNIST and recognition accuracy were not established.
The IDX tool converts local user inputs; it performs no downloads.

The framework-free browser demo has mouse/touch/pen drawing, worker-based
training/inference, debounced single-flight live predictions, stale-response
rejection, training charts, confusion matrices and explicit model save/load/
import/export/discard. IndexedDB model data is origin-local; reload does not
automatically restore it. This storage is not a scoped agent-memory backend.

Existing tests exercise behavior with synthetic fixtures. No trained general
vision, code-generation, conversational, OCR or camera model is established by
this repository. Softmax and evidence scores must not be advertised as calibrated
confidence or general intelligence.

## 5. Reuse inventory and specialist boundaries

| Planned component | Reuse now | Additive integration proposal / limits |
| --- | --- | --- |
| RUDRA — orchestrator | Phase 01 registry, executor, context and validation | Implemented Phase 02: deterministic routing and bounded ordered workflows; optional model planner adapters remain future work |
| Sanjaya — Vision | Foundation JSON validation | Implemented Phase 04: supplied observations and optional vision adapter; actual image understanding requires configured backend/evaluation |
| Brihaspati — Reasoning | RUDRA workflow validation; existing SLM interfaces remain usable by host adapters | Implemented Phase 04: explicit/provider-generated plans and replaceable decisions with capability, dependency and evidence-reference checks; missing provider returns unavailable |
| Vishwakarma — Code | Foundation validation; no built-in code model | Implemented Phase 04: source metadata, explicit replacement artifacts and optional code-provider proposals; never applies or executes patches |
| Chitragupta — Memory | Jaya/Vijaya and protected tool boundary | Implemented Phase 04: session read/write interface and bounded in-memory store; durable storage/TTL remain future host policy |
| Hanuman — Inspection | Existing `UISnapshot`, normalization and `analyzeUI` | Implemented Phase 04: supplied snapshot normalization/comparison; browser capture and Inspectra runtime remain external |
| Yudhishthira — Review | Foundation and existing scene validation | Implemented Phase 04: deterministic checks, inspection consistency and optional advisory provider review |
| Ekalavya — Learning | Jaya/Vijaya; ML engine stays untouched | Implemented Phase 04: real feedback/training record storage and deterministic summaries; no automatic training or weight updates |
| Jaya — Authentication | Existing bounded context/JSON validation | Implemented Phase 03: trusted host identity adapter, immutable principal/session contracts and context provenance; real provider remains host-configured |
| Vijaya — Authorization | Existing bot execution and RUDRA lifecycle | Implemented Phase 03: deny-by-default policies, approval, resource predicates and tool-time rechecks; narrow host services remain injected |

Do not copy example code into a second ML engine. Where an example helper needs
to become a public library capability, define that extraction as a separate
requested change, add regression tests, and preserve the existing demo caller.
Do not register empty specialist implementations as working bots.

## 6. Proposed target architecture and execution flow

```text
Visynq Workstation React UI (requests; cannot grant host permissions)
  -> authenticated RPC/IPC boundary in trusted Node/server or desktop host
  -> host task validation and verified identity (Jaya)
  -> RUDRA: explicit registered capability routing and execution budget
  -> authorization (Vijaya) before protected resource/service access
  -> selected specialist(s), each with narrow injected services
       -> existing SHIVAX ML / visual / optional SLM APIs
       -> bounded memory / inspection / model / execution host adapters
  -> validated result + provenance + actual lifecycle events -> Workstation
```

Authentication may be satisfied by a trusted caller session adapter; it never
trusts identity claims in task content. Pure local calculations can use an
explicit local policy. Scope equality remains an additional check and cannot
replace authorization. The trusted host decides what access a bot receives.
Phase 01 only snapshots host assertions and checks required tool-ID metadata;
it implements no authenticated transport, resource policy or executable tools.
Phase 03 adds authenticated context provenance through Jaya and application-level
policy enforcement through Vijaya. Configure the guard at every protected RUDRA
entry; legacy pure workflows remain available without an identity adapter but
receive no tool client. Resource-specific services and real authentication
transports are host-owned, not inferred from request or model data.

Proposed contracts should distinguish `BotTask` from the existing exported ML
`Task` type. Define a schema version, bounded task ID/kind/input, scope, trusted
execution context, cancellation/deadline and maximum steps. Bot descriptors
declare identity, supported task kinds, required capabilities and input/output
validators. Registration is explicit and rejects duplicate IDs. Each task
validates both input and returned data at runtime.

Results should distinguish completed, failed, denied, unavailable, cancelled
and timed-out execution. Successful results contain real data and evidence,
with deterministic/trained-model/provider provenance where applicable. Never
convert a missing backend, timeout, denied access or invalid output to success.
Reuse existing error codes where meaningful; new orchestration errors must
sanitize backend details without changing current `SLMResult` semantics.

Start with caller-selected tasks and sequential dispatch. Any later model-based
planner proposes only structured steps from registered capabilities; RUDRA
validates and authorizes every step. Bound depth, steps, concurrency, input/
output size and elapsed work. No automatic escalation, hidden retry loop or
model-authorized delegation. Events describe real transitions, not invented
progress percentages; payload logging is off by default.

Lifecycle ownership must be explicit: the creator owns injected services unless
it transfers ownership. RUDRA stops admitting tasks on disposal, cancels active
work, and prevents late results from reviving disposed state. A Promise timeout
only stops waiting; workers/processes or the host service must stop CPU/I/O work.
Unsettled work must retain its concurrency slot until stopped or isolated.

### Intended logical structure

The following is the project's logical organization supplied by the user. It
does not require these physical directories, moving working code, introducing
empty modules, or restarting completed phases. Phase 00's integration decision
is to preserve the current source layout and connect these responsibilities
through the existing contracts and additive adapters.

```text
SHIVAX/
  src/
    core/
      rudra/
      registry/
      orchestration/
      events/
      contracts/
    bots/
      sanjaya/
      brihaspati/
      vishwakarma/
      chitragupta/
      hanuman/
      yudhishthira/
      ekalavya/
    security/
      jaya/
      vijaya/
    intelligence/
      neural/
      models/
      providers/
      routing/
    memory/
    tools/
    integrations/
    index.ts
  examples/
  tests/
  docs/
  package.json
```

### Mapping onto the existing repository

| Logical responsibility | Current implementation / additive integration |
| --- | --- |
| `core/contracts` | `src/agents/types.ts`, `context.ts`, `validation.ts`, `errors.ts`; keep legacy numeric types in `src/types/`. The existing ML `Task` stays distinct from `BotTask`. |
| `core/registry` | Existing `src/agents/registry.ts`; reuse `BotRegistry` rather than create another registry under `src/core/`. |
| `core/events` | Existing `src/agents/events.ts`; reuse the typed event emitter. |
| `core/orchestration` | `src/agents/execute.ts` remains the one-bot executor. `src/agents/rudra/` adds bounded sequential workflows using that executor. |
| `core/rudra` | Implemented additively in `src/agents/rudra/`; no `src/core/` migration. See the Phase 02 guide for planner validation, host limits and lifecycle. |
| Seven `bots/*` roles | Implemented as seven small files in `src/bots/`, with shared schema/provider/storage modules; all register through `createSpecialistSystem`. No empty role folders or ML relocation. |
| `security/jaya`, `security/vijaya` | Implemented in `src/security/jaya.ts` and `vijaya.ts`, with shared registry/audit/tool modules. Logical guards remain separate from capability bots. Legacy `SecurityContext` is still an assertion structure; only Jaya-minted root contexts carry provenance recognized by the guard. |
| `intelligence/neural` | Existing `src/nn/`, backed by `src/core/Tensor.ts`, `src/core/math.ts` and `src/metrics/`. Keep the working engine and imports in place. |
| `intelligence/models` | Existing `NeuralNet` configuration/parameters/serialization in `src/nn/`. `src/models/LinearRegression.ts` is still an empty placeholder, not an implemented standalone model. |
| `intelligence/providers` | Existing `src/slm/` provider/client and optional Ollama adapter. Preserve this integration seam and optional runtime behavior. |
| `intelligence/routing` | Future explicit selection of an appropriate intelligence backend. Distinct from RUDRA selecting specialist tasks; no general backend router exists today. |
| `memory` | `src/bots/storage.ts` defines session store contracts and bounded in-memory implementations; protected adapters are in `services.ts`. Digit model persistence stays separate in `examples/digits/`. |
| `tools` | Host-owned protected registry/leases in `src/security/`, selected-capability tool metadata in the foundation and explicit storage adapters in `src/bots/services.ts`; no unrestricted I/O handlers. |
| `integrations` | Future portable contracts/composition for `inspectra-automation` and Visynq. Actual browser automation remains in Inspectra and React in Visynq; no mandatory platform runtime enters SHIVAX. |
| Root entry / examples / tests / docs | Retain `src/index.ts`, dual ESM/CJS/declarations, existing examples/digit assets and current test discovery. New test entry files must still match `tests/*.test.mjs`. |

The current physical `src/core/` contains numeric utilities. The logical name
`core` above means the bot framework's responsibilities; it does not replace or
rename that existing directory. Similarly, `intelligence/*` groups existing
capabilities conceptually without moving `src/nn/`, `src/visual/`, `src/slm/`,
`src/metrics/` or `src/text/`.

Jaya and Vijaya represent mandatory trusted security checks at protected host
boundaries. A future planner must not be able to omit those checks by skipping
a registered bot. Specialist adapters depend on portable contracts and existing
intelligence services; the ML engine remains independently usable. Distinguish
the memory service from its Chitragupta adapter and inspection integration from
its Hanuman adapter, avoiding duplicate implementations for the same role.

No move is a prerequisite for a later phase. If a future task explicitly calls
for physical relocation, treat it as a separate compatibility migration with
tests, not as implicit authorization from this diagram. Prefer additive
implementation near existing code and retain root exports. Secondary
subpaths require coordinated exports, build, declaration and package-allowlist
changes with consumer tests. Avoid adding platform ambient types to portable
root declarations. Default imports must not construct services or download models.

## 7. Risks and dependency analysis

| Risk / evidence | Impact | Proposed mitigation in a requested phase |
| --- | --- | --- |
| `.gitignore` explicitly unignores `.env` and `.env.*` | Credentials could be committed later; no claim that a secret currently exists | Correct policy before provider credentials; preserve intentional example templates |
| Lockfile exists locally but is ignored/untracked | Contradicts documented frozen/committed install policy | Deliberately track a reviewed lockfile and verify installs; no dependency changes in Phase 00 |
| `SECURITY.md` denies network I/O; optional Ollama uses fetch | Misstates current trust boundary | Document opt-in transport, trusted local server and custom external provider behavior |
| README/examples contain outdated persistence claims and starter text | Consumers may infer missing/present features incorrectly | Align docs with serialization and explicit demo persistence; historical plans remain historical |
| No local CI manifest despite README CI claims | Remote quality gates are unverified | Verify actual CI separately; don't claim execution without evidence |
| Package `files` omits `docs/`; dry run confirms missing guides | Installed README relative guide links may be broken | Include chosen guides or link to repository URLs |
| Empty placeholder modules ship empty declarations | False capability expectations | Keep out of advertised API; remove/implement only under separate scope |
| Synchronous training; partial updates on failure/cancellation | UI stalls and mutable shared-model races | Host workers, one owner per mutable model, isolated candidate training |
| Inference serialization omits optimizer/PRNG state | Imported model cannot resume exact training | Keep version 1 meaning; future checkpoint format needs explicit versioning |
| Caller-owned scope IDs and trusted injected providers | Neither provides hostile-code isolation or verified tenancy | Jaya/Vijaya plus host-enforced resource adapters and isolated execution |
| Native fetch/AbortController/TextEncoder used by optional SLM | Availability/CORS/local-service policy differs by environment | Portable interfaces, explicit host transport and compatibility tests; Node >=22 unchanged |
| New root wildcard exports or DOM/Node-specific declarations | Name collisions or broken ES2020-only consumers | Explicit naming, export inventory, ESM/CJS parity and portable declaration regression tests |
| Single bundled root includes visual/SLM code | CJS consumers load the bundle; future heavy static imports would increase overhead | No heavy runtime imports; measure before considering opt-in subpaths |
| Test command matches `tests/*.test.mjs` | Nested test files could silently stop running | Keep top-level test entries or explicitly change discovery with verification |
| Synthetic fixtures and unverified dataset origin | Passing tests do not measure real model capability | Separate regression, provenance and independent evaluation evidence |
| Global pnpm store creation produced EPERM | Wrapper-based checks may fail in this environment | Use installed local binaries for audit checks and report the failure honestly |

Current production dependency count is zero. Development dependencies are
TypeScript, Rollup, ESLint, Prettier and Changesets, with transitive packages in
the local lockfile. `pnpm-workspace.yaml` disables build scripts for
`@parcel/watcher` and `unrs-resolver`. No install hooks run for consumers.

The proposed framework should retain zero mandatory model/browser/UI runtimes.
Existing `SLMProvider` remains the model integration seam; introduce a new
backend interface only for a demonstrably different task contract. Storage,
browser automation, filesystem access and model execution belong to explicit
host adapters. No Redis, queue service, vector database, React, Playwright,
TensorFlow, ONNX or mandatory Ollama installation is required for the framework.
Any later adapter dependency needs license, size, platform and security review
within its requested phase. No vulnerability-advisory result is claimed here.

## 8. Validation and Phase 00 status

The initial audit session passed the existing build and **140 tests**, compiler
and ESLint checks using installed binaries, and a package dry run (31 entries).
The pnpm lint wrapper failed on global-store permissions. Expanded Phase 00
verification and exact commands are recorded in [SHIVAX_PHASES.md](SHIVAX_PHASES.md).
The inventory was traced through root re-exports and checked against the built
ESM runtime; no runtime export was omitted.

No fresh browser matrix, live model inference, external repository integration,
MNIST accuracy benchmark or full third-party security audit was performed.
The proposal preserves the ML engine and existing Node/browser boundary.
Phase 00 changed documentation only. Phases 01–04 add the portable foundation,
RUDRA, security guards and seven specialists without relocating or replacing ML code.
See the [foundation guide](bot-foundation.md), [RUDRA guide](rudra-orchestrator.md)
the [security guide](jaya-vijaya-security.md) and [specialist guide](specialist-bots.md)
for acceptance evidence. Later phases remain unimplemented.
