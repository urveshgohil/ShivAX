# ShivAX in production

This guide covers what ShivAX does, what your host must supply, and what has been
tested. Read it with the [SDK guide](sdk.md) and [SECURITY.md](../SECURITY.md).

## Status and version

- This guide covers version **0.2.0 NARASIMHA**.
- New in 0.2.0, and not in 0.1.3 or earlier: exact model cost math, strict token
  usage checks, and the managed firewall. The usage checks are a breaking change
  for providers that report `null` token counts. Sections below mark these
  *new in 0.2.0*. See [CHANGELOG.md](../CHANGELOG.md).
- ShivAX is pre-1.0 and has one maintainer. No benchmarks compare it with other
  ML or agent frameworks, and this guide makes no such claim. Test it on your own
  workloads.

## What the ML core does

Import from `shivax/core` or the `shivax` root. All of it runs on the CPU in plain
JavaScript. There is no GPU, WebAssembly or native code.

| Area | What you get |
| --- | --- |
| Tensors | `Tensor` over float data, rank 1 to 8: `zeros`, `get`, `reshape`, element-wise `add`/`subtract`/`multiply`, `transpose`, `matmul`, `sum`, `mean`. Up to 1,048,576 elements per tensor and 50 million multiply steps per `matmul`. |
| Dense networks | `NeuralNet`: fully connected layers only. No convolution, recurrence or attention. Up to 8 layers, 4,096 units per layer and one million parameters. |
| Tasks | `binary` (sigmoid output, binary cross-entropy), `multiclass` (softmax, cross-entropy), `regression` (linear output, mean squared error). |
| Training | Mini-batch training on the calling thread. Hidden layers use `tanh`, `relu`, `leakyRelu` or `sigmoid`. Optimizers: `sgd`, `momentum`, `adam`. Weights start with `xavier`, `he` or `auto`. You can set a seed, watch each epoch and stop with an `AbortSignal`. |
| Saving | `toJSON` and `NeuralNet.fromJSON` for trained models. ShivAX never loads model files that contain code. |
| Metrics | `classificationAccuracy`, `evaluateClassification` (accuracy, cross-entropy, confusion matrix, per-class scores), `crossEntropy`, `evaluateRegression` (MSE, RMSE, MAE, R²). |
| Text features | `BagOfWords`: a capped Unicode vocabulary and normalized word counts. No tokenizer models or embeddings. |

Large training runs block the thread they run on, so run them in a worker. A
failed run can keep the batch updates it made before the failure. The handwritten
digit playground lives in the source repository. It is not in the npm package.

## The seven specialist bots

`createSpecialistBots()` from `shivax/bots` creates all seven. Each task checks
its input and output against a fixed schema. No bot trains model weights.

| Bot | Tasks | Works without a model? |
| --- | --- | --- |
| Sanjay | `vision.observe` (checks supplied observations), `vision.inspection-reference`, `vision.analyze` (reads an encoded image) | `vision.analyze` needs a host vision adapter. The others are fixed logic. |
| Brihaspati | `reasoning.plan` (checks a plan you give it, or asks a provider for a short plan; it never runs the plan), `reasoning.decide` (picks from the options and evidence you supply) | Plans you supply need no model. Provider plans and `reasoning.decide` need a host reasoning provider. |
| Vishwakarma | `code.summarize` (paths, languages, line and character counts), `code.patch` (proposes exact-match replacements; it never applies them), `code.suggest` | `code.suggest` needs a host code provider. The others are fixed logic. |
| Chitragupt | `memory.read`, `memory.write` in the signed-in session's space | No model. It needs a memory service and protected tool permissions. |
| Narad | `inspection.normalize`, `inspection.compare` (fixed UI analysis of two supplied snapshots) | No model. It does not open browsers. Live capture is a separate host feature. |
| Yudhishthir | `review.findings`, `review.check`, `review.inspection` (fixed checks), `review.model` (advice only) | `review.model` needs a host review provider. It never overrides the fixed checks. |
| Ekalavy | `learning.feedback` (stores checked feedback through Chitragupt), `learning.record`, `learning.summarize` | No model. Storing feedback never changes weights. |

RUDRA (`shivax/rudra`) sends tasks to these bots by what they can do. It handles
task order, approvals, retries, cancellation, step limits and traces.

## What needs Ollama or a remote model

The ML core, the fixed bot tasks, RUDRA, memory and the firewall need no language
model. You need a model only for:

- `vision.analyze`, `reasoning.decide`, provider plans in `reasoning.plan`,
  `code.suggest` and `review.model`;
- the `ModelRouter` tasks `text-reasoning`, `code-generation` and
  `visual-interpretation` (`numeric-inference` can use the CPU
  `NeuralModelProvider` or host rules);
- optional embeddings for memory search.

`OllamaModelAdapter` talks only to an Ollama server on your own machine
(loopback). It refuses redirects and cloud aliases. You install Ollama and the
model yourself. `RemoteModelAdapter` loads a client that your host supplies, only
when first used. ShivAX ships no cloud SDK, keys or API endpoints. Remote routing
and fallback stay off unless your host turns them on. Your host states provider
prices, locations and usage. ShivAX enforces budgets against those numbers, but it
cannot check them against a real invoice.

## Trusted host versus browser

ShivAX runs in Node.js 22+ and in modern browsers (ES2022). Code running in a
browser is not a safe place to hold authority.

| Keep on a trusted server or desktop process | Safe to run in a browser |
| --- | --- |
| The Jay identity adapter that checks real sessions | Tensor and `NeuralNet` training and inference |
| Vijay policies, approval handlers and protected tool handlers | Fixed bot tasks on data the page already has |
| Firewall `admin` and the R07 `management` controller | Showing results, traces and approval prompts sent from the host |
| Model provider keys, remote transports and spend limits | IndexedDB memory for per-user data that is not sensitive |
| License checks (`shivax/licensing/server`) | |
| Policy storage, audit storage and admin identity | |

The mock browser identity in the examples is for demos only. Never treat task
text, page content or model output as identity, approval or admin intent. An
admin page in the browser must call a trusted host endpoint. The browser must
never hold the `admin` or `management` objects.

## Configuring the firewall (new in 0.2.0)

The managed firewall is in `shivax/security`. You opt in to it. Existing raw APIs
keep working, and the firewall does *not* cover them unless you route them
through it.

1. **Set up Jay and Vijay.** Create a `Jay` with a host identity provider. Create
   a `Vijay` with a `PermissionPolicyRegistry`, a `ProtectedToolRegistry` and a
   human approval handler. Register a read-only or state-changing policy for each
   capability you expose. Also register a *state-changing* policy for an admin
   capability such as `firewall.admin`.
2. **Register operations.** Each one has an `id`, a `kind` (`cpu`, `tool`,
   `model`, `workflow`, `bot`, `file` or `network`), a capability, an effect, the
   exact file paths and web origins it may touch, and a `check` function that
   returns right away. Models also name a provider, an output schema and limits.
3. **Write the first policy.** It must start in `enforce` mode. Add an `allow`
   rule for each operation. List the capabilities, bots, provider IDs and
   locations, files, web origins and resource limits you allow. The firewall
   denies anything you leave out.
4. **Create it.** `createShivaxFirewall({ jay, security, realm, adminCapability,
   authorizeAdmin, operations, policy })` returns `runtime` and `admin`. Set
   `protectExecution: true` to also cover RUDRA, workflows and tools that use the
   same Vijay. Use `createGuardedModelGateway` from `shivax/models` for model calls.
5. **Keep admin on the host.** `admin.replace`, `admin.rollback` and
   `admin.lockdown` need the admin permission, your `authorizeAdmin` check and a
   person's approval. To save policies and serve a signed-in admin API, use
   `openShivaxFirewallManagement` with a durable store and approved profiles.

Modes: `enforce` applies every rule. `monitor` relaxes only rules you mark
`optional: true`. Sign-in, approvals, tenant checks and budgets still apply.
`lockdown` blocks everything except the CPU operations you allowed.

`examples/sdk/firewall.mjs` runs steps 1 to 5. The
[SDK guide](sdk.md#managed-firewall-core) covers every field, the model gateway,
protected execution, the management API and audit records.

## Supported SDK imports

| Import | Contents |
| --- | --- |
| `shivax` | Everything below in one import, except the Inspectra adapter and licensing |
| `shivax/core` | Tensor, math, NeuralNet, BagOfWords, metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA, workflows |
| `shivax/bots` | The seven specialist bots and helpers to combine them |
| `shivax/security` | Jay, Vijay, policies, protected tools, audit; firewall and management (new in 0.2.0) |
| `shivax/models` | Model registry and router; neural, rules, Ollama and remote adapters; guarded gateway (new in 0.2.0) |
| `shivax/memory` | Memory engine, with in-memory, Node file and IndexedDB storage |
| `shivax/integrations` | UI inspection contracts, service and planner |
| `shivax/adapters/inspectra` | Optional adapter. Needs the optional peer `inspectra-engine@1.0.4` and Node 22.15+ |
| `shivax/learning` | Feedback, evaluation, curated training, tested updates and rollback |
| `shivax/diagnostics` | `toSDKDiagnostic` |
| `shivax/licensing/server` | Server-side license check contracts |

Each entry point ships ESM, CommonJS and TypeScript types. Imports from deep
paths inside `dist/` are not supported.

## Known limitations

- **No sandbox.** ShivAX checks the SDK paths that go through it. It cannot stop
  host JavaScript from going around it, isolate untrusted code, or block file and
  network access outside a managed path. Use the OS, a proxy, a container or
  browser isolation for that.
- **Cancellation needs cooperation.** It cannot interrupt synchronous JavaScript,
  stop a remote request already sent, undo a saved write or prove that billing
  stopped.
- **State lives in one process.** Budgets, workflow pause and resume, model
  rollback history and the in-memory audit log belong to one process and are lost
  on restart. Saved firewall policies need a host store.
- **Workflow model tools keep their own budget.** `ToolRegistry.registerModel`
  applies the same strict usage rules as `ModelRouter` (the 0.2.0 fix for R03 G02).
  Its budget is the workflow's own `modelBudget`, not the firewall's shared model
  budget. Use the guarded gateway when one shared budget matters.
- **Permission refresh (R03 G04, open).** Jay copies permissions at sign-in. You
  can revoke a session, but changes to a live session's grants do not take effect.
- **Provider trust.** ShivAX does not check model prices or usage reports against
  real invoices.
- **ML scope.** Dense networks only, CPU only, training on the calling thread, and
  no pretrained models or datasets.
- **One maintainer, pre-1.0.** Public APIs can still change between minor
  versions. There is no promised response time for security reports.

## Security and release test results

See [release-readiness.md](release-readiness.md) for the latest test record,
with the exact commands and results.
