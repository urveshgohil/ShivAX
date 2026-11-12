# ShivAX AI - JavaScript & TypeScript Multi-Agent AI Framework

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**

*One Intelligence. Many Specialized Minds.*

ShivAX (`shivax` on npm) is a multi-agent AI framework for Node.js and the
browser. It gives you small neural networks that run on the CPU, a team of task
bots, a task runner, memory, model routing, UI checks and a firewall. RUDRA hands
each task to the right bot. Jay checks who is calling, and Vijay checks what they
may do. The firewall decides which actions can run.

**Version:** 0.3.0 SARASWATI · **Runs on:** Node.js 22+ and modern browsers · **License:** Apache-2.0

The core has no runtime dependencies. You plug in your own browser automation,
storage, sign-in and model backends when you need them.

## Coming in 0.3.0 SARASWATI - The Intelligence & Learning Release (unreleased)

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
  SARASWATI (unreleased) adds provenance, benchmarks, worker training, a durable
  approval registry, shadow routing and memory ranking.

## Specialist bots

| Bot | What it does |
| --- | --- |
| Sanjay | Reads images through an optional model adapter |
| Brihaspati | Builds plans and makes choices |
| Vishwakarma | Sums up source code and proposes patches |
| Chitragupt | Saves and finds memory records |
| Narad | Inspects and compares UIs |
| Yudhishthir | Runs fixed checks and optional model reviews |
| Ekalavy | Collects feedback, runs evaluations and controls learning |

Jay signs callers in (authentication). Vijay decides what they may do
(authorization). Both run at the start of every protected action.

## Installation

```sh
npm install shivax
```

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
tenant checks and budgets still apply. `lockdown` blocks everything except CPU
work you have allowed. To change the policy, a user needs admin rights, must pass
your role check, and needs a person to approve.

A full example ships with the package:

```sh
node node_modules/shivax/examples/sdk/firewall.mjs
```

Setup steps are in [docs/production.md](docs/production.md#configuring-the-firewall-new-in-020).
Every option is in the [SDK guide](docs/sdk.md#managed-firewall-core).

## SDK entry points

| Import | Contents |
| --- | --- |
| `shivax` | Everything in one import |
| `shivax/core` | Tensor, NeuralNet, text features, metrics |
| `shivax/rudra` | Bot contracts, registry, RUDRA, workflows |
| `shivax/bots` | The seven specialist bots |
| `shivax/security` | Jay, Vijay, policies, tools, audit, firewall |
| `shivax/models` | Model router, providers, Ollama and remote adapters, guarded gateway |
| `shivax/memory` | Memory engine, storage adapters, opt-in ranked retrieval |
| `shivax/integrations` | UI inspection contracts and services |
| `shivax/learning` | Feedback, evaluation, training, durable model registry, rollback, shadow routing advice |
| `shivax/learning/node` | Node.js only: non-blocking neural training in worker threads |
| `shivax/diagnostics` | Error details that are safe to show users |
| `shivax/adapters/inspectra` | Optional Inspectra adapter (`inspectra-engine@1.0.4`) |
| `shivax/licensing/server` | Server-side license check |

Each entry point ships ESM, CommonJS and TypeScript types. More examples are in
[`examples/sdk/`](examples/sdk/README.md).

## Frequently asked questions

**Does ShivAX work in Node.js and the browser?** Yes. It runs on Node.js 22+ and
modern browsers (ES2022), with ESM, CommonJS and TypeScript types. Keep sign-in,
approvals, keys and firewall admin on a trusted server, not in the browser.

**Do I need an API key or a cloud model?** No. Neural networks, the fixed bot
tasks, RUDRA, memory and the firewall all run on your machine. Ollama and remote
providers are optional.

**Can it run agent workflows on its own?** Yes, within the limits you set. RUDRA
runs workflows with tool requests, approval steps, retries and cancellation.
Protected actions need Jay and Vijay policies from your host.

**Does user feedback train a model on its own?** No. ShivAX stores feedback so you
can review and test it. You start training yourself, and a model update needs approval.

## Production use

Read [docs/production.md](docs/production.md) before you deploy. It explains what
the ML core does, what each bot does, what needs a model, what must stay on a
trusted server, and what ShivAX cannot do yet. ShivAX is pre-1.0, and no
benchmarks against other ML or agent frameworks exist yet. Test results are in
[docs/release-readiness.md](docs/release-readiness.md).

## Support and security

Report bugs and ask questions at
[github.com/urveshgohil/ShivAX/issues](https://github.com/urveshgohil/ShivAX/issues).
Please do not post security issues in a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## License

Copyright 2025–2026 Urvesh Gohil. Licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution.
