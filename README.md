# SHIVAX AI — JavaScript & TypeScript Multi-Agent AI Framework

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**

*One Intelligence. Many Specialized Minds.*

SHIVAX (`shivax` on npm) is a JavaScript and TypeScript multi-agent AI framework
for Node.js and browser applications. It combines CPU neural networks, agent
orchestration, model-provider integration, scoped memory, UI inspection and AI
evaluation. RUDRA coordinates tasks; Jay and Vijay enforce host-configured
security; the managed firewall governs what registered operations may do.

**Version:** 0.2.0 NARASIMHA · **Runtime:** Node.js 22+ and browser bundles · **License:** Apache-2.0

The core has zero runtime dependencies. Browser automation, storage, authentication
and model backends use optional host-configured adapters.

## What's new in 0.2.0 NARASIMHA

- **Managed firewall:** opt-in `enforce`, `monitor` and `lockdown` modes over
  registered operations, with default deny, exact file and network allowlists,
  shared budgets, cancellation and redacted audit events.
- **Guarded model calls:** `createGuardedModelGateway` routes model requests
  through the firewall, with fixed provider routes and destination checks.
- **Policy management:** `openShivaxFirewallManagement` for authenticated,
  approval-gated policy changes with versioned persistent storage.
- **Exact model budgets:** cost limits use exact decimal arithmetic, so three
  $0.10 calls fit a $0.30 budget.
- **Stricter usage checks:** a reported token or cost overrun stops the router,
  even when the model output is malformed.
- **Runnable examples in the package** under `examples/sdk/`.

### Upgrading from 0.1.x

Two behaviour changes can affect existing integrations:

1. Token-based model providers must report numeric `inputTokens` and
   `outputTokens`. Missing, `null` or malformed usage now fails with
   `usage-unverifiable` and blocks further calls on that router. Providers that do
   not bill by token should declare `tokenBased: false`.
2. Workflow model tools (`ToolRegistry.registerModel`) follow the same rule, and
   hard model failures (limits, timeouts, unverifiable usage) are no longer retried.

Existing imports and entry points are unchanged. See [CHANGELOG.md](CHANGELOG.md).

## Features

- **Machine learning:** tensors, dense neural networks, classification and regression, SGD/momentum/Adam, evaluation metrics and JSON model serialization.
- **Specialist bots and RUDRA:** capability routing, dependent tasks, approvals, pause/resume, retries, cancellation, execution limits and traces.
- **Hybrid models:** neural and rules providers, optional local Ollama and host-configured remote providers.
- **Memory:** scoped records, retention, retrieval, optional embeddings, and in-memory, Node file or IndexedDB storage.
- **UI inspection:** measured visual and layout comparison with structured findings, plus an optional Inspectra browser adapter.
- **Security:** trusted host identities, expiring sessions, deny-by-default policies, protected tools, approvals and audit records.
- **Learning and evaluation:** verified feedback, curated datasets, repeatable evaluations, evaluation-gated model updates and rollback.

## Specialist bots

| Bot | Role |
| --- | --- |
| Sanjay | Vision through an optional model adapter |
| Brihaspati | Structured plans and reasoning decisions |
| Vishwakarm | Source summaries and code patch proposals |
| Chitragupt | Scoped memory and retrieval |
| Narad | UI inspection and comparison |
| Yudhishthir | Deterministic checks and optional model review |
| Ekalavy | Feedback, evaluation and controlled learning |

Jay handles authentication and Vijay handles authorization at protected execution boundaries.

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
console.log(registry.findByCapability('code.patch').map(bot => bot.id)); // ['vishwakarm']
```

Model-backed capabilities need a configured provider. Protected operations need
host authentication, permissions and approval.

## Managed firewall

```js
import { createShivaxFirewall } from 'shivax/security';
```

The firewall starts in `enforce` mode and denies anything not explicitly allowed.
`monitor` relaxes only rules marked optional; authentication, approvals, tenant
checks and budgets still apply. `lockdown` blocks every operation except
explicitly allowed CPU work. Policy changes need an administrator, a host role
check and human approval.

A complete runnable example ships with the package:

```sh
node node_modules/shivax/examples/sdk/firewall.mjs
```

Setup steps are in [docs/production.md](docs/production.md#configuring-the-firewall-new-in-020);
every option is in the [SDK guide](docs/sdk.md#managed-firewall-core).

## SDK entry points

| Import | Contents |
| --- | --- |
| `shivax` | Aggregate API |
| `shivax/core` | Tensor, NeuralNet, text features, metrics |
| `shivax/rudra` | Bot contracts, registry, RUDRA, workflows |
| `shivax/bots` | Seven specialists |
| `shivax/security` | Jay, Vijay, policies, tools, audit, firewall |
| `shivax/models` | Model router, providers, Ollama/remote adapters, guarded gateway |
| `shivax/memory` | Memory engine and storage adapters |
| `shivax/integrations` | Inspection contracts and services |
| `shivax/learning` | Feedback, evaluation, training, rollback |
| `shivax/diagnostics` | Safe error diagnostics |
| `shivax/adapters/inspectra` | Optional Inspectra adapter (`inspectra-engine@1.0.4`) |
| `shivax/licensing/server` | Server-side license gate |

Every entry point ships ESM, CommonJS and TypeScript declarations. More examples
are in [`examples/sdk/`](examples/sdk/README.md).

## Frequently asked questions

**Does SHIVAX work with Node.js and browsers?** Yes: Node.js 22+ and modern
browsers (ES2022), with ESM, CommonJS and TypeScript declarations. Keep identity,
approvals, credentials and firewall administration on a trusted host, not in the browser.

**Does it need an API key or a cloud LLM?** No. Neural networks, deterministic bot
capabilities, RUDRA, memory and the firewall run locally. Ollama and remote
providers are optional.

**Can it run autonomous agent workflows?** RUDRA runs bounded workflows with tool
proposals, approval gates, retries and cancellation. Protected actions require
host-supplied Jay/Vijay policies.

**Does user feedback train a model automatically?** No. Feedback is stored for
review and evaluation; training is explicit and model updates require approval.

## Production use

Read [docs/production.md](docs/production.md) before deploying. It covers what the
ML core implements, what each bot does, what needs a model, trusted host versus
browser boundaries and known limitations. SHIVAX is pre-1.0 and has no published
benchmarks against other ML or agent frameworks. Verification results are in
[docs/release-readiness.md](docs/release-readiness.md).

## Support and security

Report bugs and ask questions at
[github.com/urveshgohil/ShivAX/issues](https://github.com/urveshgohil/ShivAX/issues).
Do not post vulnerability details in a public issue; follow [SECURITY.md](SECURITY.md).

## License

Copyright 2025–2026 Urvesh Gohil. Licensed under [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution.
