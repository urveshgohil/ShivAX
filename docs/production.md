# ShivAX in production

This guide covers what ShivAX does, what your host must supply, and what has been
tested. Read it with the [SDK guide](sdk.md) and [SECURITY.md](../SECURITY.md).

## Status and version

- This guide covers the package in this repository, version **0.4.0**. It builds on
  the **0.3.x SARASWATI** line, whose learning additions are marked *SARASWATI* below.
- **v0.4.0 HANUMAN - The Action & Automation Release** is in preparation and is not
  published. Its additions are marked *HANUMAN* below. They are opt-in.
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

Large training runs block the thread they run on, so run them in a worker
(SARASWATI: `shivax/learning/node` provides one on Node.js). A
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

*HANUMAN:* an eighth bot, `hanuman` (approved external evidence retrieval,
capability `fetch.url`), exists but is **not** one of the seven and is not
returned by `createSpecialistBots()`. A host registers it with
`registerHanumanBot` only after it has registered the protected fetch tool. See
"Protected external retrieval (HANUMAN)" below.

These names are **not** bots and are never registered in `BotRegistry`:
Abhimanyu (workflow preflight warning checks) and Ashwatthama (runtime lifecycle
warning checks) are implemented utilities in `shivax/rudra`. Shabari is a
pre-release test harness in the source repository and is not in the npm package.
Jambavan (authorized capability discovery) and Kubera (read-only budget
reporting) are designed but **not implemented**, so no API for them exists.

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

## Protected external retrieval (HANUMAN)

Hanuman lets agents retrieve evidence from targets that your host approved. It is
off by default. ShivAX contains **no** HTTP client, global `fetch` use, crawler,
browser or web search. The SDK enforces a fixed sequence of checks around a
transport that **your host writes**. The step-by-step recipe, the limits and the
transport obligations are in the [SDK guide](sdk.md#protected-external-retrieval-h01-b).

What a production deployment needs before turning it on:

1. A reviewed host transport that pins DNS to the addresses the SDK permits,
   verifies TLS and the hostname, refuses redirects, sends no credentials or
   cookies, enforces size limits without decompressing, and honors the abort
   signal. ShivAX ships none and cannot verify one.
2. Egress controls outside the process (a firewall, proxy or sandbox) that allow
   only the approved destinations. The SDK cannot isolate the network, and
   checking a URL or an address alone does not prevent SSRF.
3. A small, reviewed target catalog with no secrets. Each target is bound to an
   issuer and tenant.
4. Vijay policies with `requiresApproval: true` on the fetch tool, per-task tool
   grants, and an explicit `allowedCapabilities` option on every RUDRA run.
5. A firewall policy that lists the exact origin and enough concurrent slots.
6. A plan for evidence: treat it as untrusted text, neutralize invisible Unicode
   before display or model input, and keep it away from approvals, permissions
   and training.

Open pre-release findings (no reviewed transport, implicit RUDRA capability
allowlist, first-by-ID route choice, in-flight identity revocation, transports
that ignore cancellation) are listed in [SECURITY.md](../SECURITY.md).

## Who provides which control

This table separates what the SDK checks from what your host must supply. "SDK"
means the check runs when you route work through the relevant SDK path.

| Area | SDK provides | Host must provide |
| --- | --- | --- |
| Authentication | `Jay` mints task contexts from your identity provider and checks session expiry and revocation at admission | A real identity provider, session storage and sign-in. Abort the root signal on immediate revocation |
| Authorization | `Vijay` permission and tool-grant checks, literal-`true` approvals, effect classes | The policies, the approval handler (a person or reviewed service), and the permission names |
| Trusted host registration | Registration APIs (`registerHanumanFetchService`, `registerHanumanBot`, tool and bot registries). Nothing is registered or granted by default | Deciding what to register, in which tenant, and keeping registries out of bots and browsers |
| Approved network egress | The NARASIMHA exact-origin check for registered operations, in enforce and monitor mode | OS, proxy or sandbox rules that actually block other traffic. The SDK is not an isolation layer |
| Origin and DNS checks | Exact registered target, a non-public address block list applied to reported addresses, peer-in-pin-set check, GET only, redirect refusal | A transport that connects only to the vetted addresses, verifies TLS, and refuses redirects on the wire |
| Credential isolation | No credentials in the request frame, fixed error codes, no secrets in audit records | Secret storage, no credentials in catalogs or logs, no cookie jars or proxy credential injection in the transport |
| Monitoring | Fixed-code audit records, bounded in-memory log, a `droppedAuditEvents` counter, an `observe` callback on the fetch service (IDs and codes only) | Collecting and alerting on those events, health checks, and noticing stuck work |
| Cancellation and cleanup | `AbortSignal` propagation, checkpoints between steps, `close()` called once, lockdown revokes active leases | A transport that honors the signal and releases sockets. Forcible termination is not possible from the SDK |
| Tenant isolation | Realm, issuer and scope checks in Jay, the firewall and the target catalog; tenant-keyed lifecycle records | Separate registrations and connection pools per tenant, tenant-scoped storage, and no shared mutable state between tenants |
| Policy management | Versioned firewall policy, rollback, lockdown, admin approval | A durable policy store, administrator roles, change review, and a separate admin context that bots never see |
| Resource limits | Input, output, concurrency, operation, token, cost, time, byte and chunk limits | Choosing values for your workload, and process-level memory and CPU limits |
| Audit retention | A bounded in-memory log and an optional `auditSink` that can be required to acknowledge | Durable, access-controlled storage, retention periods and privacy review |

## Supported SDK imports

| Import | Contents |
| --- | --- |
| `shivax` | Everything below in one import, except the Inspectra adapter and licensing |
| `shivax/core` | Tensor, math, NeuralNet, BagOfWords, metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA, workflows; `runAbhimanyuPreflight`, `createAshwatthamaObserver` and the safety warning schema (*HANUMAN*) |
| `shivax/bots` | The seven specialist bots and helpers to combine them; the opt-in `HanumanBot` and `registerHanumanBot` (*HANUMAN*) |
| `shivax/security` | Jay, Vijay, policies, protected tools, audit; firewall and management (new in 0.2.0) |
| `shivax/models` | Model registry and router; neural, rules, Ollama and remote adapters; guarded gateway (new in 0.2.0) |
| `shivax/memory` | Memory engine, with in-memory, Node file and IndexedDB storage |
| `shivax/integrations` | UI inspection contracts, service and planner; `registerHanumanFetchService` and its types (*HANUMAN*) |
| `shivax/adapters/inspectra` | Optional adapter. Needs the optional peer `inspectra-engine@^1.0.4` and Node 22.15+ |
| `shivax/learning` | Feedback, evaluation, curated training, tested updates and rollback |
| `shivax/diagnostics` | `toSDKDiagnostic` |
| `shivax/licensing/server` | Server-side license check contracts |

Each entry point ships ESM, CommonJS and TypeScript types. Imports from deep
paths inside `dist/` are not supported.

C01 verified SHIVAX 0.3.1 with no Inspectra, published Inspectra 1.0.4, 1.1.0 and
1.2.0, and the local 1.2.1 candidate on Windows/Node 22.23.2. Every case used a
fresh npm consumer outside the repositories, without peer-resolution bypasses.
Integrated cases passed real Chromium captures against offline fixtures, with
Jay/Vijay authorization, firewall enforce/lockdown, network and tenant denials,
redirect restrictions, lease validation, cancellation and cleanup. Browser
isolation, DNS/proxy restrictions and interception remain the trusted host's job.
See the [adapter guide](../adapters/inspectra/README.md) for reproduction.

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
- **HANUMAN transport (pre-release).** ShivAX ships no transport and no network
  client. Wire-level SSRF and TLS properties are the host's job and have not been
  independently verified. Transports that ignore cancellation can pin firewall
  slots until the host restarts.
- **HANUMAN routing (pre-release).** Pass `allowedCapabilities` explicitly. With no
  options, RUDRA allows the task's own capability. If another bot offers
  `fetch.url`, the first by ID is chosen.
- **Unimplemented names.** Jambavan, Kubera, `fetch.api` and `research.search` do not
  exist in the SDK.
- **One maintainer, pre-1.0.** Public APIs can still change between minor
  versions. There is no promised response time for security reports.

## Security and release test results

See [release-readiness.md](release-readiness.md) for the latest test record,
with the exact commands and results.

## Learning and evaluation (SARASWATI, new in 0.3.0)

SARASWATI - The Intelligence & Learning Release adds controlled learning around
the ML core above. All of it is opt-in.

| Capability | What it does | What your host must supply |
| --- | --- | --- |
| Feedback provenance (S01) | Wraps v1 feedback with source, tenant, consent, evidence, retention and redaction claims. Curation admits only attested, consented, current records and writes a hashed dataset manifest | A Jay reviewer session, `confirmReview` against your review journal, `consentActive` against your consent store |
| Benchmarks (S02) | Versioned suites, trusted evaluators, recomputed summaries, a regression gate with mandatory security cases | Evaluators that drive your real bots and models; the list of trusted evaluator ids |
| Worker training (S03) | CPU training of a candidate in `worker_threads`, identical to synchronous training | Node.js 22+; resource limits that suit your host |
| Model registry (S04) | Candidate, evaluated, approved and active states with atomic activation, rollback and a hash-chained audit | A `ModelRegistryStore` with an atomic compare-and-swap; administrator roles; an approval journal; optionally a signing key |
| Shadow routing (S05) | Ekalavya recommends bots from verified evidence; RUDRA routing changes only through an approved policy | Labelled evidence; administrator approval to promote a policy |
| Memory ranking (S06) | Opt-in ranking with provenance; optional local hashing embeddings | A trusted `sourceQuality` mapping, if you want quality to count |

**Human approval.** Nothing trains, activates or reroutes by itself. Promotion
needs a trusted administrator verified by Jay, a host approval record and, for
activation, a confirmation of that record. Approvals expire, and go stale if the
active version, firewall policy or security settings change.

**Firewall.** Approval and activation are refused during NARASIMHA lockdown or
closed admission. Rollback is refused too, unless you allow it. Routing policies
fall back to deterministic routing during lockdown.

**Optional model providers.** Learning works without any remote model.
Ollama, remote and embedding providers are host adapters you configure and
declare in `networkOrigins`.

**Limits.**

- SARASWATI does not fine-tune large language models. It trains only ShivAX's
  small CPU networks (dense layers, up to one million parameters) and routing
  policies.
- It makes no claim of autonomous intelligence growth.
- Quality claims require your own labelled data. The figures in the audit
  reports come from small constructed fixtures.
