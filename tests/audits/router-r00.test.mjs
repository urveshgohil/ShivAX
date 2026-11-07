import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// R00 expected-behavior regressions: intentionally red until a later approved fix.
// Run explicitly with: node --test tests/audits/router-r00.test.mjs
// Uses only in-process mocks through the public SDK; no network or paid APIs.
const require = createRequire(import.meta.url);
const formats = [
    ['ESM', await import('shivax/models')],
    ['CommonJS', require('shivax/models')],
];
const scope = { kind: 'personal', id: 'r00-audit' };
const request = () => ({
    capability: 'text-reasoning',
    input: { question: 'mock-only' },
    output: { schema: { type: 'number' } },
    context: {
        taskId: 'r00-task',
        sessionId: 'r00-session',
        scope,
        signal: new AbortController().signal,
    },
});
const provider = (id, infer, overrides = {}) => ({
    id,
    locality: 'in-process',
    tokenBased: true,
    capabilities: ['text-reasoning'],
    pricing: { callUSD: 0, inputTokenUSD: 0, outputTokenUSD: 0 },
    infer,
    ...overrides,
});
const summarize = (result) => ({
    status: result.status,
    error: result.error?.code ?? null,
    providerId: result.providerId ?? null,
    attempts: result.attempts.map((attempt) => ({
        providerId: attempt.providerId,
        outcome: attempt.outcome,
        error: attempt.error?.code ?? null,
    })),
});

for (const [format, { ModelProviderRegistry, ModelRouter }] of formats) {
    test(`${format}: R00 $0.30 permits exactly three $0.10 calls`, async (t) => {
        let calls = 0;
        const registry = new ModelProviderRegistry().register(provider('cost-mock', () => {
            calls++;
            return { data: 42, usage: { inputTokens: 0, outputTokens: 0, costUSD: 0.1 } };
        }, {
            tokenBased: false,
            pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 },
        }));
        const router = new ModelRouter(registry, { scope, limits: { maxCostUSD: 0.3 } });
        try {
            const results = [];
            for (let index = 0; index < 4; index++) results.push(await router.infer(request()));
            const actual = {
                outcomes: results.map((result) => result.error?.code ?? result.status),
                providerCalls: calls,
                reservedCalls: router.budgetUsage.calls,
                reservedCostUSD: router.budgetUsage.reservedCostUSD,
            };
            t.diagnostic(JSON.stringify({ actual, results: results.map(summarize) }));
            assert.deepEqual(actual, {
                outcomes: ['completed', 'completed', 'completed', 'cost-limit'],
                providerCalls: 3,
                reservedCalls: 3,
                reservedCostUSD: 0.3,
            });
        } finally {
            router.dispose();
        }
    });

    test(`${format}: R00 malformed output cannot hide reported token overrun`, async (t) => {
        let aCalls = 0;
        let bCalls = 0;
        const registry = new ModelProviderRegistry()
            .register(provider('provider-a', () => {
                aCalls++;
                return { data: 'malformed-for-number-schema', usage: { inputTokens: 0, outputTokens: 2, costUSD: 0 } };
            }))
            .register(provider('provider-b', () => {
                bCalls++;
                return { data: 42, usage: { inputTokens: 0, outputTokens: 1, costUSD: 0 } };
            }));
        const router = new ModelRouter(registry, {
            scope,
            limits: { maxInputTokens: 1, maxOutputTokens: 1, maxTokens: 100 },
        });
        try {
            const first = await router.infer(request(), { providerId: 'provider-a', allowFallback: true });
            const followup = await router.infer(request(), { providerId: 'provider-b' });
            const actual = { first: summarize(first), followup: summarize(followup), aCalls, bCalls };
            t.diagnostic(JSON.stringify(actual));
            assert.deepEqual(actual, {
                first: {
                    status: 'failed', error: 'usage-limit', providerId: null,
                    attempts: [{ providerId: 'provider-a', outcome: 'failed', error: 'usage-limit' }],
                },
                followup: { status: 'failed', error: 'usage-limit', providerId: null, attempts: [] },
                aCalls: 1,
                bCalls: 0,
            });
        } finally {
            router.dispose();
        }
    });
}
