# ShivAX AI - JavaScript & TypeScript Multi-Agent AI Framework

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**

*One Intelligence. Many Specialized Minds.*

ShivAX (`shivax` on npm) is a multi-agent AI framework for Node.js and the
browser. It combines small neural networks that run on the CPU with agent
orchestration: a team of task bots, a task runner (RUDRA), memory, model routing,
UI checks and a firewall. RUDRA hands each task to the right bot. Jay checks who
is calling, and Vijay checks what they may do. The NARASIMHA firewall decides
which registered actions can run.

**Package version in this checkout:** 0.4.0 · **Release in preparation:**
v0.4.0 HANUMAN, *The Action & Automation Release* (not published; see
[CHANGELOG.md](CHANGELOG.md)) · **Runs on:** Node.js 22+ and modern browsers ·
**License:** Apache-2.0

The core has no runtime dependencies. **ShivAX works without Inspectra and
Visynq.** Both are optional. You plug in your own browser automation, storage,
sign-in, network transport and model backends when you need them.

## What ShivAX is, and is not

- **CPU machine learning.** Tensors, dense neural networks, metrics and text
  features. No GPU, no pretrained models, no large language model.
- **Agent orchestration.** Seven specialist bots, RUDRA tasks and workflows,
  approvals, pause and resume, retries, cancellation, step limits and traces.
- **Authorization and a firewall.** Jay (identity), Vijay (permissions, tool
  grants, approvals) and NARASIMHA (a deny-by-default policy for the operations
  you register with it).
- **Controlled learning.** SARASWATI stores checked feedback, trains small CPU
  networks, evaluates them and promotes a model only after a person approves.
- **Not a service, a sandbox or a browser.** ShivAX is a library. It does not
  open network connections on its own, does not isolate your process, and does
  not replace your host's authentication, egress controls or monitoring. See
  [docs/production.md](docs/production.md) and [SECURITY.md](SECURITY.md).

## Architecture overview

```text
 Trusted host application
 (real sessions, approvals, keys, storage, network transport, egress controls)
        │
        ▼
   Jay ─────────► Vijay ─────────► NARASIMHA firewall
   who is         what they may    which registered operations
   calling        do, which tools  may run, with which files,
   (session)      they hold,       origins, budgets and limits
                  approvals        (enforce / monitor / lockdown)
        │
        ▼
   RUDRA tasks and workflows ──► registered bots ──► protected tools you register
        │                          sanjay … ekalavy      │
        │                          hanuman (opt-in)      ▼
        │                                         host transport / services
        ▼                                         (your code, not ShivAX)
   SARASWATI learning (shadow routing, evaluation, approved model registry)
```

Every arrow between boxes is a check or a hand-off that your host configures.
Nothing here is granted automatically. Optional pieces sit outside this
picture: the Inspectra adapter (`shivax/adapters/inspectra`), model providers
(Ollama or remote clients you supply), and storage adapters.

## 0.4.0 HANUMAN - The Action & Automation Release (in preparation)

HANUMAN adds one optional specialist and a protected gateway so that a trusted
host can let agents retrieve *approved* external evidence. Everything is opt-in,
additive and offline-testable. This section describes the source in this
repository. The package version is 0.4.0, but v0.4.0 is **not published**.

- **Protected retrieval gateway.** `registerHanumanFetchService` (from
  `shivax/integrations`) registers one protected tool. It reads only from a
  host-registered catalog of HTTPS targets, so callers pick a target ID and never
  supply a URL. Requests are GET only, with no credentials, no redirects and no
  compression, and they are bounded by size, chunk, address and time limits.
- **Optional Hanuman specialist.** `registerHanumanBot` (from `shivax/bots`)
  registers the `hanuman` bot with the capability `fetch.url`. It returns bounded
  text evidence that is always marked `trust: 'untrusted'`.
- **RUDRA integration.** Hanuman runs through the same RUDRA path and Jay, Vijay
  and firewall checks as every other bot. It is not in the default roster.
- **Workflow warning checks.** `runAbhimanyuPreflight` and
  `createAshwatthamaObserver` give advisory warnings about workflows and
  operation lifecycles. They are not bots and grant or remove no permission.
- **Offline examples.** Scripts under `examples/sdk/hanuman/` run the whole flow
  against an in-memory fake transport.

What HANUMAN does **not** include: no built-in HTTP client, global `fetch`,
crawler, browser, web search or DNS/TLS code. The host supplies a transport and
is responsible for real network controls. `fetch.api` and `research.search` are
reserved capability names with no implementation. Jambavan and Kubera (below)
are designed but not implemented in the current source. Several security review
findings remain open for live deployment; they are listed in the repository's
`docs/audits/` reports (not shipped in the npm package).

See [Protected external retrieval](docs/sdk.md#protected-external-retrieval-h01-b)
and [Portable Hanuman examples](docs/sdk.md#portable-hanuman-examples-h06).

## 0.3.0 SARASWATI - The Intelligence & Learning Release

SARASWATI adds controlled learning around the existing ML core. Nothing learns
on its own: every step needs verified data, evidence, a trusted administrator and
human approval.

- **Existing ML capability:** the CPU neural networks, metrics and model routing
  from 0.2.0 are unchanged.
- **Controlled feedback learning:** feedback carries provenance (source, tenant,
  consent, evidence, retention). Only records a Jay-verified reviewer attested,
  and that you confirm, enter a curated, leakage-free dataset with a manifest.
- **CPU neural network training:** train candidates synchronously or, on
  Node.js, in a worker thread (`shivax/learning/node`). Results are identical.
  There is no GPU or TensorFlow support.
- **Evaluation:** versioned, hashed benchmark suites, reports whose summaries are
  recomputed on validation, and a regression gate in which security cases must
  always pass.
- **Human-approved promotion:** a durable model registry
  (candidate, evaluated, approved, active, with rollback), backed by storage you
  supply. Approvals expire and go stale when the active version, firewall policy
  or security settings change.
- **Optional model providers:** Ollama, remote and other providers stay opt-in
  host adapters.
- **Firewall protections:** promotion is refused during firewall lockdown, and
  routing falls back to deterministic during lockdown.
- **Shadow routing and memory relevance:** Ekalavya recommends routes without
  changing them, and an opt-in ranker orders memory results with provenance.

It does **not** fine-tune large language models: SARASWATI trains only ShivAX's
own small CPU networks and routing policies, and makes no claim of autonomous
intelligence growth. See [docs/learning-evaluation.md](docs/learning-evaluation.md)
and the examples in [`examples/sdk/`](examples/sdk/README.md).

## What's new in 0.2.0 NARASIMHA

- **Firewall:** pick `enforce`, `monitor` or `lockdown` mode. It blocks any
  action you have not allowed. You list the exact files and web addresses each
  action may use. Actions share one budget, can be stopped, and leave audit
  records with secrets removed.
- **Guarded model calls:** `createGuardedModelGateway` sends model requests
  through the firewall. Each provider has a fixed route, and each address is
  checked before the call.
- **Policy changes:** `openShivaxFirewallManagement` lets a signed-in admin change
  the policy once a person approves. Each change gets a version number and is saved.
- **Exact budgets:** costs add up with exact decimal math, so three $0.10 calls
  fit in a $0.30 budget.
- **Usage checks:** if a model reports more tokens or cost than you allowed, the
  router stops. This holds even when the model sends back broken output.
- **Examples in the package:** run them from `examples/sdk/`.

### Upgrading from 0.1.x

Two changes may affect your code:

1. Providers that bill by token must report `inputTokens` and `outputTokens` as
   numbers. If a count is missing, `null` or not a valid number, the call fails
   with `usage-unverifiable` and that router takes no more calls. If your provider
   does not bill by token, set `tokenBased: false`.
2. Workflow model tools (`ToolRegistry.registerModel`) follow the same rule. They
   no longer retry hard failures such as limits, timeouts and missing usage.

Imports and entry points have not changed. See [CHANGELOG.md](CHANGELOG.md).


## Features

- **Machine learning:** tensors, dense neural networks, classification and
  regression, SGD, momentum and Adam, metrics, and saving models as JSON.
- **Bots and RUDRA:** RUDRA picks a bot by what it can do. It runs tasks in order,
  asks for approval, pauses and resumes, retries, cancels, sets limits and keeps a trace.
- **Hybrid models:** neural and rule-based providers, plus local Ollama and remote
  providers that you set up.
- **Memory:** records grouped by scope, with retention rules, search and optional
  embeddings. Keep them in memory, in Node files or in IndexedDB.
- **UI checks:** compare two screens by look and layout, and get a list of
  findings. An optional Inspectra adapter captures live pages.
- **Security:** identities from your host, sessions that expire, deny-by-default
  policies, protected tools, approvals and audit records.
- **Learning and evaluation:** store checked feedback, build curated datasets,
  run repeatable tests, and update or roll back a model only after it passes.
  SARASWATI (0.3.x) adds provenance, benchmarks, worker training, a durable
  approval registry, shadow routing and memory ranking.
- **Protected external retrieval (opt-in, HANUMAN):** approved, bounded GET
  retrieval from a host catalog through a host-supplied transport.
- **Workflow warning checks (opt-in, HANUMAN):** Abhimanyu preflight and
  Ashwatthama lifecycle warnings.

## Specialist bots

`createSpecialistBots()` returns exactly these seven bots. The ID is the value of
`bot.id` that RUDRA, Vijay and firewall policies use. Do not change it.

| Bot | ID | Role |
| --- | --- | --- |
| Sanjay | `sanjay` | Vision and observation. Reads images through an optional model adapter |
| Brihaspati | `brihaspati` | Reasoning and planning |
| Vishwakarma | `vishwakarma` | Code analysis and development help: summaries and proposed patches |
| Chitragupt | `chitragupt` | Scoped memory management |
| Narad | `narad` | Inspection and comparison of UI snapshots |
| Yudhishthir | `yudhishthir` | Review and evaluation: fixed checks and optional model advice |
| Ekalavy | `ekalavy` | Feedback and learning. Some documents spell the name "Ekalavya" |

The optional eighth bot is registered only when a host asks for it:

| Bot | ID | Role |
| --- | --- | --- |
| Hanuman | `hanuman` | Approved external evidence retrieval (`fetch.url`). Not in `createSpecialistBots()`. Needs the protected fetch tool, a host transport and host authorization |

**Aliases.** The only compatibility alias is the deprecated class name
`VishwakarmBot`, which is the same class as `VishwakarmaBot`. Its instances
report the ID `vishwakarma`. The ID `vishwakarm` from 0.2.x was replaced in 0.3.0; update any policy that still names it (see the migration notes in the SDK guide).

## Utilities and checks that are not bots

These names appear in the HANUMAN design. They are **not** specialist bots, are
not registered in `BotRegistry`, and are not counted among the seven.

| Name | What it is | Status in this source |
| --- | --- | --- |
| Jambavan | Authorized capability discovery (read-only) | **Not implemented.** No public API. |
| Kubera | Read-only budget reporting | **Not implemented.** No public API. Budgets are still enforced by `ModelRouter` and the firewall. |
| Abhimanyu | Workflow preflight warning checks (`runAbhimanyuPreflight`, or the engine option `preflight`) | Implemented. Advisory in `warn` mode. |
| Ashwatthama | Runtime lifecycle warning checks (`createAshwatthamaObserver`, or the engine option `lifecycle`) | Implemented. Advisory in `warn` mode. |
| Shabari | Pre-release canary test harness (`tests/fixtures/shabari-runner.mjs`) | Test tooling in the repository. Not shipped in the npm package. |

Jay signs callers in (authentication). Vijay decides what they may do
(authorization). Both run at the start of every protected action.

## Installation

```sh
npm install shivax
```

ShivAX needs Node.js 22 or later (`engines.node` is `>=22`).

## Quick start

```js
import { NeuralNet, BotRegistry, createSpecialistBots } from 'shivax';
// CommonJS: const { NeuralNet } = require('shivax');

const model = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });
model.train(
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0], [1], [1], [0]],
  { epochs: 2000, learningRate: 0.5, batchSize: 4 },
);
console.log(model.predictClass([0, 1])); // 1

const restored = NeuralNet.fromJSON(JSON.stringify(model.toJSON()));
console.log(restored.predictClass([0, 1])); // 1

const registry = new BotRegistry();
createSpecialistBots().forEach(bot => registry.register(bot));
console.log(registry.findByCapability('code.patch').map(bot => bot.id)); // ['vishwakarma']
```

Bot tasks that need a model work once you add a provider. Protected actions need
sign-in, permissions and approval from your host.

## Managed firewall

```js
import { createShivaxFirewall } from 'shivax/security';
```

The firewall starts in `enforce` mode and blocks anything you have not allowed.
`monitor` mode relaxes only the rules you mark optional. Sign-in, approvals,
tenant checks, network origin checks and budgets still apply. `lockdown` blocks
every new operation except CPU work you have allowed. To change the policy, a
user needs admin rights, must pass your role check, and needs a person to approve.

The firewall covers only the operations you register with it. It does not
isolate the operating system or the network. A full example ships with the
package:

```sh
node node_modules/shivax/examples/sdk/firewall.mjs
```

Setup steps are in [docs/production.md](docs/production.md#configuring-the-firewall-new-in-020).
Every option is in the [SDK guide](docs/sdk.md#managed-firewall-core).

## Optional Hanuman retrieval

Hanuman is off by default. A host turns it on in four explicit steps:
register a service with a transport and a target catalog, register the bot
against the same tool registry, grant the tool per task through Jay and Vijay,
and allow the origin in the firewall policy. The complete runnable recipe is
`examples/sdk/hanuman.mjs`, and the host obligations are in
[docs/sdk.md](docs/sdk.md#protected-external-retrieval-h01-b). In short:

- the SDK checks the registered target, reported addresses, GET-only frame,
  size and time limits, authorization and the firewall;
- your host transport must pin DNS to the permitted addresses, verify TLS, refuse
  redirects, send no credentials and honor cancellation, and your deployment
  must enforce network egress. URL validation alone does not prevent SSRF;
- retrieved text is untrusted data. Never use it as an instruction, permission,
  approval, code or training input.

## SDK entry points

| Import | Contents |
| --- | --- |
| `shivax` | Everything in one import |
| `shivax/core` | Tensor, NeuralNet, text features, metrics |
| `shivax/rudra` | Bot contracts, registry, RUDRA, workflows, Abhimanyu and Ashwatthama warning checks |
| `shivax/bots` | The seven specialist bots, and the opt-in `HanumanBot` and `registerHanumanBot` |
| `shivax/security` | Jay, Vijay, policies, tools, audit, firewall |
| `shivax/models` | Model router, providers, Ollama and remote adapters, guarded gateway |
| `shivax/memory` | Memory engine, storage adapters, opt-in ranked retrieval |
| `shivax/integrations` | UI inspection contracts and services; the Hanuman protected fetch service |
| `shivax/learning` | Feedback, evaluation, training, durable model registry, rollback, shadow routing advice |
| `shivax/learning/node` | Node.js only: non-blocking neural training in worker threads |
| `shivax/diagnostics` | Error details that are safe to show users |
| `shivax/adapters/inspectra` | Optional Inspectra adapter (`inspectra-engine@^1.0.4`) |
| `shivax/licensing/server` | Server-side license check |

Each entry point ships ESM, CommonJS and TypeScript types. More examples are in
[`examples/sdk/`](examples/sdk/README.md).

SHIVAX-C01 verified standalone installs and integration with published Inspectra
1.0.4, 1.1.0 and 1.2.0, plus the local 1.2.1 candidate. Inspectra remains optional;
live capture needs a trusted browser host and Node.js 22.15+. See the
[adapter guide](adapters/inspectra/README.md) for the contract and repeatable checks.

## Frequently asked questions

**Does ShivAX work in Node.js and the browser?** Yes. It runs on Node.js 22+ and
modern browsers (ES2022), with ESM, CommonJS and TypeScript types. Keep sign-in,
approvals, keys and firewall admin on a trusted server, not in the browser.

**Do I need Inspectra or Visynq?** No. Neither is a dependency. Inspectra is an
optional peer used only for live page capture. The package is tested without
either one installed.

**Do I need an API key or a cloud model?** No. Neural networks, the fixed bot
tasks, RUDRA, memory and the firewall all run on your machine. Ollama and remote
providers are optional.

**Can agents browse the web or search?** Not by default. ShivAX has no built-in
HTTP client, crawler, browser or web search. A host can opt in to the Hanuman
retrieval of pre-approved targets through its own reviewed transport.
`research.search` is reserved and not implemented.

**Can it run agent workflows on its own?** Yes, within the limits you set. RUDRA
runs workflows with tool requests, approval steps, retries and cancellation.
Protected actions need Jay and Vijay policies from your host.

**Does user feedback train a model on its own?** No. ShivAX stores feedback so you
can review and test it. You start training yourself, and a model update needs approval.

## Production use

Read [docs/production.md](docs/production.md) before you deploy. It explains what
the ML core does, what each bot does, what needs a model, what must stay on a
trusted server, which controls the SDK provides and which your host must supply,
and what ShivAX cannot do yet. ShivAX is pre-1.0, and no benchmarks against other
ML or agent frameworks exist yet. Test results are in
[docs/release-readiness.md](docs/release-readiness.md).

## Support and security

Report bugs and ask questions at
[github.com/urveshgohil/ShivAX/issues](https://github.com/urveshgohil/ShivAX/issues).
Please do not post security issues in a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## License

Copyright 2025–2026 Urvesh Gohil. Licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution.
