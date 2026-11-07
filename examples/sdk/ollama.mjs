import { ModelProviderRegistry, ModelRouter, OllamaModelAdapter } from 'shivax/models';
const model = process.env.SHIVAX_OLLAMA_MODEL;
if (!model) throw new Error('Set SHIVAX_OLLAMA_MODEL to a model installed on your approved local Ollama server.');
const scope = { kind: 'personal', id: 'ollama-demo' };
const router = new ModelRouter(new ModelProviderRegistry().register(new OllamaModelAdapter({ model })), {
    scope, limits: { maxCalls: 1, maxTokens: 2560, maxInputTokens: 2048, maxOutputTokens: 512, maxCostUSD: 0 },
});
const result = await router.infer({ capability: 'text-reasoning', input: { question: 'What is 2 + 2?' }, output: { schema: { type: 'object' } },
    context: { taskId: 'local-demo', sessionId: 'local-demo', scope, signal: new AbortController().signal } });
if (result.status !== 'completed') { console.error(result.error.message); process.exitCode = 1; }
else console.log(result.data);
router.dispose();
