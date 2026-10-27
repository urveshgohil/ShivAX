import {
    ModelProviderRegistry,
    ModelRouter,
    RulesModelProvider,
    NeuralModelProvider,
    NeuralNet,
} from 'shivax';

// No network or model download. A small regression model learns actual supplied data.
const network = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 7 });
network.train([[0], [1], [2]], [[1], [3], [5]], { epochs: 500, learningRate: 0.02 });
const registry = new ModelProviderRegistry()
    .register(new NeuralModelProvider('numeric', network))
    .register(
        new RulesModelProvider('validation', [
            {
                id: 'finite-positive',
                validate: (value) => typeof value === 'number',
                run: (value) => ({ valid: Number.isFinite(value) && value > 0 }),
            },
        ])
    );
const scope = { kind: 'personal', id: 'hybrid-demo' };
const router = new ModelRouter(registry, {
    scope,
    limits: { maxCalls: 2, maxTokens: 0, maxCostUSD: 0 },
});
const context = {
    taskId: 'hybrid-demo',
    sessionId: 'demo-session',
    scope,
    signal: new AbortController().signal,
};
const numeric = await router.infer({
    capability: 'numeric-inference',
    input: [3],
    context,
    output: {
        schema: {
            type: 'object',
            properties: { predictions: { type: 'array', items: { type: 'number' } } },
            required: ['predictions'],
            additionalProperties: false,
        },
    },
});
if (numeric.status !== 'completed') throw Error(numeric.error.message);
const validation = await router.infer({
    capability: 'deterministic-validation',
    input: { rule: 'finite-positive', data: numeric.data.predictions[0] },
    context,
    output: {
        schema: {
            type: 'object',
            properties: { valid: { type: 'boolean' } },
            required: ['valid'],
            additionalProperties: false,
        },
    },
});
if (validation.status !== 'completed') throw Error(validation.error.message);
console.log(JSON.stringify({ numeric, validation, budget: router.budgetUsage }, null, 2));
