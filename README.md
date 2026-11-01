# SHIVAX AI — JavaScript & TypeScript Multi-Agent AI Framework

**Synthetic Hybrid Intelligence with Versatile Autonomous eXperts**

*One Intelligence. Many Specialized Minds.*

SHIVAX (`shivax` on npm) is a JavaScript and TypeScript multi-agent AI framework
for Node.js and browser applications. It combines CPU neural networks, agent
orchestration, model-provider integration, scoped memory, UI inspection, and AI
evaluation. RUDRA coordinates tasks; Jay and Vijay enforce host-configured security.

**Version:** 0.1.3 · **Runtime:** Node.js 22+ and browser bundles · **License:** Apache-2.0

The core has zero runtime dependencies. Browser automation, storage, authentication,
and model backends use optional host-configured adapters.

## What can you build with SHIVAX?

- **AI agent workflows:** coordinate specialist bots with capability routing, tool calls, human approval, and execution limits.
- **JavaScript machine learning:** train dense neural networks for classification, regression, and handwritten digit recognition.
- **Hybrid AI applications:** combine deterministic rules and numeric inference with optional local Ollama models or remote LLM providers.
- **UI quality checks:** compare measured typography, spacing, layouts, and element structure using normalized observations and the Inspectra adapter.
- **Session-aware assistants:** retrieve scoped memory and collect verified feedback for repeatable evaluation and curated offline training.

## Features

- **Machine learning:** tensors, matrix operations, dense neural networks, binary and multiclass classification, regression, SGD/momentum/Adam, evaluation metrics, and JSON model serialization.
- **Text features:** bounded Unicode bag-of-words vocabulary and normalized vectors.
- **Specialist bots:** capability discovery, validated inputs/results, lifecycle events, and dependency injection.
- **RUDRA orchestration:** capability routing, dependent tasks, approvals, pause/resume, safe parallel reads, retries, cancellation, execution limits, and traces.
- **Hybrid models:** existing neural engine, deterministic rules, optional Ollama-compatible models, and host-configured remote providers.
- **Memory:** scoped records, retention, lexical retrieval, optional embeddings, explicit export/deletion, and in-memory, Node file, or IndexedDB adapters.
- **UI inspection:** semantic matching, measured visual/layout comparison, structured findings, and a separate Inspectra browser adapter.
- **Security:** trusted host identities, expiring sessions, deny-by-default policies, protected tools, explicit approvals, and audit records.
- **Learning and evaluation:** accept/reject/correct feedback, curated datasets, repeatable evaluations, isolated numeric training, evaluation-gated model updates, and rollback.
- **Digit playground:** browser-based handwritten digit training and inference using the existing neural engine.

## Specialist bots

| Bot | Role |
| --- | --- |
| Sanjay | Vision through an optional model adapter |
| Brihaspati | Structured plans and reasoning decisions |
| Vishwakarm | Source summaries and code patch proposals |
| Chitragupt | Scoped memory and retrieval |
| Narad | UI inspection and comparison |
| Yudhishthir | Deterministic checks and optional model review |
| Ekalavy | Feedback, evaluation, and controlled learning |

Jay handles authentication and Vijay handles authorization at protected execution boundaries.

## Installation

```sh
npm install shivax
```

## Basic usage

### Imports

```js
import { Tensor, NeuralNet, BagOfWords, createSpecialistBots, BotRegistry } from 'shivax';

// CommonJS is also supported:
// const { Tensor, NeuralNet } = require('shivax');
```

### Tensor operations

```js
const matrix = new Tensor([1, 2, 3, 4], [2, 2]);
console.log(Array.from(matrix.matmul(matrix).data)); // [7, 10, 15, 22]
```

### Train and predict

```js
const model = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });

model.train(
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0], [1], [1], [0]],
  { epochs: 2000, learningRate: 0.5, batchSize: 4 },
);

console.log(model.predictClass([0, 1])); // 1

const restored = NeuralNet.fromJSON(JSON.stringify(model.toJSON()));
console.log(restored.predictClass([0, 1])); // 1
```

### Text features

```js
const text = new BagOfWords().fit(['hello world', 'hello shivax']);
console.log(text.transform('hello shivax')); // [0.5, 0, 0.5]
```

### Register specialist bots

```js
const registry = new BotRegistry();
createSpecialistBots().forEach(bot => registry.register(bot));

console.log(registry.findByCapability('code.patch').map(bot => bot.id));
// ['vishwakarm']
```

Model-backed capabilities require a configured provider. Protected operations require
host authentication, permissions, and approval. Feedback storage alone does not change
model weights. Neural training is synchronous; workflow resume and model rollback retain
state in memory.

## Frequently asked questions

### What is SHIVAX AI?

SHIVAX AI is an Apache-2.0 JavaScript and TypeScript library for multi-agent
workflows and CPU machine learning. Its npm package name is `shivax`.

### Does SHIVAX work with Node.js and browsers?

Yes. SHIVAX supports Node.js 22+, browser bundles, ESM, CommonJS, and TypeScript
declarations. Platform-specific storage and browser automation use separate adapters.
Distributed JavaScript targets ES2022 and retains native private class fields and
methods. Browser hosts need support for those features; applications targeting
older browsers must transpile SHIVAX as part of their bundle. Public declarations
remain usable with an ES2020 TypeScript library configuration.

### Does SHIVAX require an API key or a cloud LLM?

Core neural-network training, tensor operations, deterministic checks, and bot
registration run without a cloud API. Local Ollama integration is optional;
remote model providers require host configuration and any provider credentials.

### Can SHIVAX run autonomous AI agent workflows?

RUDRA supports bounded workflows with tool proposals, approval gates, retries,
cancellation, and in-process pause/resume. Protected actions require Jay/Vijay
authentication and authorization policies supplied by the application host.

### Can SHIVAX compare websites or inspect a browser UI?

SHIVAX compares normalized UI observations and produces structured findings.
Live browser capture uses the separately maintained Inspectra adapter. Screenshot
interpretation requires a configured vision provider.

### Does user feedback automatically train a model?

Feedback is stored for review and evaluation. Supported numeric datasets can be
used for explicit offline neural-network training. Model updates require evaluation
and host approval; rollback retains model and configuration snapshots in memory.

## SDK entry points

Use `shivax/core`, `shivax/rudra`, `shivax/bots`, `shivax/security`, `shivax/models`,
`shivax/memory`, `shivax/integrations`, or `shivax/learning` for focused imports.
Optional adapters are available at `shivax/adapters/inspectra`; server entitlement
contracts at `shivax/licensing/server`. Existing root imports remain supported.
See the [SDK guide](docs/sdk.md) for examples and the Visynq `/shivax` demo.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for versioned changes.

## License

Copyright 2025–2026 Urvesh Gohil. Licensed under [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution.
