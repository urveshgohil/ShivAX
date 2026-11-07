# SHIVAX in production

This guide states what SHIVAX implements, what it depends on the host for, and
what has been tested. Use it together with the [SDK guide](sdk.md) and
[SECURITY.md](../SECURITY.md).

## Status and version

- This guide describes version **0.2.0 NARASIMHA**.
- New in 0.2.0, and not in 0.1.3 or earlier: exact model cost accounting,
  fail-closed token usage checks (a breaking change for providers that report
  `null` token counts), and the managed firewall. Sections below mark these
  *new in 0.2.0*. See [CHANGELOG.md](../CHANGELOG.md).
- SHIVAX is pre-1.0 software maintained by one author. There are no published
  benchmarks comparing it with established ML or agent frameworks, and this guide
  makes no such comparison. Evaluate it against your own workloads.

## What the ML core implements

Import from `shivax/core` (or the `shivax` root). Everything runs on the CPU in
plain JavaScript; there is no GPU, WebAssembly or native code.

| Area | Implemented |
| --- | --- |
| Tensors | `Tensor` over float data with rank 1–8: `zeros`, `get`, `reshape`, element-wise `add`/`subtract`/`multiply`, `transpose`, `matmul`, `sum`, `mean`. At most 1,048,576 elements per tensor and 50 million multiply terms per `matmul`. |
| Dense networks | `NeuralNet`: fully connected layers only (no convolution, recurrence or attention). Up to 8 layers, 4,096 units per layer, one million parameters. |
| Tasks | `binary` (sigmoid output, binary cross-entropy), `multiclass` (softmax, cross-entropy), `regression` (linear output, mean squared error). |
| Training | Synchronous mini-batch training. Hidden activations `tanh`, `relu`, `leakyRelu`, `sigmoid`; optimizers `sgd`, `momentum`, `adam`; `xavier`, `he` or `auto` initialization; seeded randomness; per-epoch callback and `AbortSignal` stop. |
| Serialization | `toJSON` / `NeuralNet.fromJSON` for inference models. No executable model formats are loaded. |
| Metrics | `classificationAccuracy`, `evaluateClassification` (accuracy, cross-entropy, confusion matrix, per-class metrics), `crossEntropy`, `evaluateRegression` (MSE, RMSE, MAE, R²). |
| Text features | `BagOfWords`: bounded Unicode vocabulary and normalized count vectors. No tokenizer models or embeddings. |

Large training calls block the calling thread. Run them in a worker. Training is
not transactional: a failure can leave earlier batch updates applied. The
handwritten-digit playground is in the source repository only; it is not part of
the npm package.

## The seven specialist bots

`createSpecialistBots()` from `shivax/bots` creates all seven. Each capability
validates its input and output against a fixed schema. No bot trains model weights.

| Bot | Capabilities | Works without a model? |
| --- | --- | --- |
| Sanjay | `vision.observe` (validate supplied observations), `vision.inspection-reference`, `vision.analyze` (interpret an encoded image) | `vision.analyze` needs a host vision adapter; the others are deterministic. |
| Brihaspati | `reasoning.plan` (validate an explicit plan, or ask a provider for a bounded plan; never executes it), `reasoning.decide` (choose among supplied options/evidence) | Explicit plans are validated without a model. Provider plans and `reasoning.decide` need a host reasoning provider. |
| Vishwakarm | `code.summarize` (paths, languages, line/character counts), `code.patch` (exact-match replacement proposals; never applies them), `code.suggest` | `code.suggest` needs a host code provider; the others are deterministic. |
| Chitragupt | `memory.read`, `memory.write` in the authenticated session namespace | No model. Needs a memory service and protected tool permissions. |
| Narad | `inspection.normalize`, `inspection.compare` (deterministic UI analysis on two supplied snapshots) | No model. It does not open browsers; live capture is a separate host integration. |
| Yudhishthir | `review.findings`, `review.check`, `review.inspection` (deterministic checks), `review.model` (advisory only) | `review.model` needs a host review provider and never overrides deterministic checks. |
| Ekalavy | `learning.feedback` (store verified feedback through Chitragupt), `learning.record`, `learning.summarize` | No model. Storing feedback never updates weights. |

RUDRA (`shivax/rudra`) routes tasks to these bots by capability and enforces
dependencies, approvals, retries, cancellation, step limits and traces.

## What needs Ollama or a remote model

Nothing in the ML core, the deterministic bot capabilities, RUDRA, memory or the
firewall needs a language model. A model is needed only for:

- `vision.analyze`, `reasoning.decide`, provider-backed `reasoning.plan`,
  `code.suggest` and `review.model`;
- `ModelRouter` capabilities `text-reasoning`, `code-generation` and
  `visual-interpretation` (the `numeric-inference` capability can use the CPU
  `NeuralModelProvider` or host rules);
- optional embeddings for memory retrieval.

`OllamaModelAdapter` talks only to a loopback Ollama server and refuses redirects
and cloud aliases. You install Ollama and the model yourself. `RemoteModelAdapter`
lazily loads a client your host supplies; SHIVAX ships no cloud SDK, credentials
or API endpoints. Remote routing and fallback are off unless the host enables them.
Provider prices, localities and usage reports are host claims: SHIVAX enforces
budgets against them but cannot verify an external invoice.

## Trusted host versus browser

SHIVAX runs in Node.js 22+ and in modern browsers (ES2022). Running in a browser
does not make the browser a trusted place for authority.

| Keep on a trusted server or desktop host process | Safe to run in a browser |
| --- | --- |
| The Jay identity adapter that verifies real sessions | Tensor and `NeuralNet` training/inference |
| Vijay policies, approval handlers and protected tool handlers | Deterministic bot capabilities on data the page already has |
| Firewall `admin` and the R07 `management` controller | Displaying results, traces and approval prompts sent from the host |
| Model provider credentials, remote transports and spend limits | IndexedDB memory for non-sensitive, per-user data |
| License verification (`shivax/licensing/server`) | |
| Policy storage, audit persistence and administrator identity | |

A browser-side mock identity (as in the examples) is for demos only. Never treat
task text, page content or model output as identity, approval or administrator
intent. A browser user interface for administration must call a trusted host
endpoint; the browser must never hold the `admin` or `management` objects.

## Configuring the firewall (new in 0.2.0)

The managed firewall is in `shivax/security`. It is opt-in: existing raw APIs keep
working and are *not* covered unless you route them through it.

1. **Set up Jay and Vijay.** Create a `Jay` with a host identity provider and a
   `Vijay` with a `PermissionPolicyRegistry`, a `ProtectedToolRegistry` and a
   human approval handler. Register a read-only or state-changing policy for each
   capability you will expose, plus a *state-changing* policy for an
   administrator capability such as `firewall.admin`.
2. **Register operations.** Each registration has an `id`, a `kind` (`cpu`,
   `tool`, `model`, `workflow`, `bot`, `file` or `network`), a capability, an
   effect, the exact file paths and network origins it may touch, and a
   synchronous `check` predicate. Models also declare a provider, output schema
   and limits.
3. **Write the initial policy.** It must start in `enforce` mode. Add an explicit
   `allow` rule for each operation and list the allowed capabilities, bots,
   provider IDs/localities, files, network origins and resource limits. Anything
   not listed is denied.
4. **Create it.** `createShivaxFirewall({ jay, security, realm, adminCapability,
   authorizeAdmin, operations, policy })` returns `runtime` and `admin`. Set
   `protectExecution: true` to also bind RUDRA, workflows and tools that use the
   same Vijay. Use `createGuardedModelGateway` from `shivax/models` for model calls.
5. **Keep administration at the host.** `admin.replace`, `admin.rollback` and
   `admin.lockdown` need the admin permission, your `authorizeAdmin` check and
   human approval. For persistent policies and an authenticated management API,
   use `openShivaxFirewallManagement` with a durable store and approved profiles.

Modes: `enforce` applies every rule. `monitor` only relaxes rules you mark
`optional: true`; authentication, approvals, tenant checks and budgets still apply.
`lockdown` blocks every operation except explicitly allowed CPU registrations.

`examples/sdk/firewall.mjs` is a runnable version of steps 1–5. The
[SDK guide](sdk.md#managed-firewall-core) documents every field, the model
gateway, protected-execution binding, the management API and audit behaviour.

## Supported SDK imports

| Import | Contents |
| --- | --- |
| `shivax` | Aggregate API (all of the below except the Inspectra adapter and licensing) |
| `shivax/core` | Tensor, math, NeuralNet, BagOfWords, metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA, workflows |
| `shivax/bots` | Seven specialists and composition helpers |
| `shivax/security` | Jay, Vijay, policies, protected tools, audit; firewall and management (new in 0.2.0) |
| `shivax/models` | Model registry/router, neural, rules, Ollama and remote adapters; guarded gateway (new in 0.2.0) |
| `shivax/memory` | Memory engine and in-memory, Node file and IndexedDB persistence |
| `shivax/integrations` | Inspection contracts, service and planner |
| `shivax/adapters/inspectra` | Optional adapter; needs the optional peer `inspectra-engine@1.0.4` and Node 22.15+ |
| `shivax/learning` | Feedback, evaluation, curated training, evaluated updates and rollback |
| `shivax/diagnostics` | `toSDKDiagnostic` |
| `shivax/licensing/server` | Server-side license gate contracts |

Every entry point ships ESM, CommonJS and TypeScript declarations. Deep imports
into `dist/` are not supported.

## Known limitations

- **No sandbox.** SHIVAX checks cooperating SDK paths. It cannot stop host
  JavaScript from bypassing it, isolate untrusted code, or block network or file
  I/O that does not go through a managed path. Use OS, proxy, container or browser
  isolation for that.
- **Cooperative cancellation.** Cancellation cannot interrupt synchronous
  JavaScript, stop a remote request already sent, undo a committed write or
  prove billing stopped.
- **In-process state.** Budgets, workflow pause/resume, model rollback history and
  the in-memory audit ring are per process and lost on restart. Persistent firewall
  policies need a host store.
- **Workflow model tools are a separate ledger.** `ToolRegistry.registerModel`
  enforces the same fail-closed usage rules as `ModelRouter` (0.2.0 fix for
  R03 G02), but its budget is the workflow's own `modelBudget`, not the firewall's
  shared model budget. Use the guarded gateway where one shared budget matters.
- **Permission refresh (R03 G04, open).** Jay snapshots permissions at
  authentication. Revoking a session works; changing a live session's grants
  does not.
- **Provider trust.** Model prices and usage reports are not verified against
  real invoices.
- **ML scope.** Dense networks only, CPU only, synchronous training, no pretrained
  models or datasets shipped.
- **Single maintainer, pre-1.0.** Public APIs can still change between minor
  versions. No response-time guarantee is offered for security reports.

## Security and release test evidence

See [release-readiness.md](release-readiness.md) for the current verification
record, including exact commands and results.
