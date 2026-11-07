import { NeuralNet } from 'shivax/core';
import { ModelProviderRegistry, ModelRouter, NeuralModelProvider } from 'shivax/models';
const model = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 7 });
model.train([[0], [1], [2]], [[1], [3], [5]], { epochs: 500, learningRate: 0.02 });
const scope = { kind: 'personal', id: 'sdk-demo' };
const router = new ModelRouter(new ModelProviderRegistry().register(new NeuralModelProvider('cpu', model)), {
    scope, limits: { maxCalls: 1, maxTokens: 0, maxCostUSD: 0 },
});
console.log(await router.infer({ capability: 'numeric-inference', input: [3], output: { schema: { type: 'object' } },
    context: { taskId: 'demo', sessionId: 'demo', scope, signal: new AbortController().signal } }));
router.dispose();
