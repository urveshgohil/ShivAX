import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const formats = [
    ['ESM', await import('shivax/models')],
    ['CommonJS', require('shivax/models')],
];
const scope = { kind: 'personal', id: 'model-cost-tests' };
const request = (signal = new AbortController().signal) => ({
    capability: 'text-reasoning',
    input: null,
    output: { schema: { type: 'number' } },
    context: { taskId: 'cost-task', sessionId: 'cost-session', scope, signal },
});
const response = (costUSD, data = 42) => ({
    data,
    usage: { inputTokens: 0, outputTokens: 0, costUSD },
});
const provider = (id, infer, pricing = {}) => ({
    id,
    infer,
    locality: 'in-process',
    tokenBased: false,
    capabilities: ['text-reasoning'],
    pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0, ...pricing },
});
const failure = (result, code) => {
    assert.equal(result.status, code === 'cancelled' ? 'cancelled' : 'failed');
    assert.equal(result.error.code, code);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

for (const [format, { ModelRouter, ModelProviderRegistry }] of formats) {
    const router = (providers, limits = {}) => {
        const registry = new ModelProviderRegistry();
        providers.forEach((item) => registry.register(item));
        return new ModelRouter(registry, { scope, limits: { maxCostUSD: 1, ...limits } });
    };

    for (const [budget, count] of [
        [0.3, 3],
        [1, 10],
    ]) {
        test(`${format}: exact $${budget} budget permits ${count} ten-cent calls and rejects the next`, async () => {
            let calls = 0;
            const r = router(
                [
                    provider('paid', (req) => {
                        calls++;
                        assert.equal(req.maxCostUSD, 0.1);
                        return response(0.1);
                    }),
                ],
                { maxCostUSD: budget }
            );
            for (let i = 0; i < count; i++)
                assert.equal((await r.infer(request())).status, 'completed');
            failure(await r.infer(request()), 'cost-limit');
            assert.equal(calls, count);
            assert.equal(r.budgetUsage.reservedCostUSD, budget);
            assert.equal(r.budgetUsage.calls, count);
            assert.doesNotThrow(() => JSON.stringify(r.budgetUsage));
        });
    }

    test(`${format}: concurrent and reentrant calls cannot reserve the same budget`, async () => {
        const pending = deferred();
        let calls = 0,
            reentrant;
        const r = router(
            [
                provider('paid', () => {
                    calls++;
                    reentrant = r.infer(request());
                    return pending.promise;
                }),
            ],
            { maxCostUSD: 0.1 }
        );
        const first = r.infer(request());
        const contenders = await Promise.all(Array.from({ length: 12 }, () => r.infer(request())));
        contenders.forEach((result) => failure(result, 'busy'));
        failure(await reentrant, 'busy');
        assert.equal(calls, 1);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.1);
        pending.resolve(response(0.1));
        assert.equal((await first).status, 'completed');
        failure(await r.infer(request()), 'cost-limit');
    });

    test(`${format}: invalid budget and every invalid price fail validation`, () => {
        const invalid = [-1, NaN, Infinity, -Infinity, 1_000_001, '0.1', null, undefined, {}, 1n];
        for (const value of invalid) {
            if (value !== undefined)
                assert.throws(() => router([], { maxCostUSD: value }), { code: 'invalid-input' });
            for (const key of ['callUSD', 'inputTokenUSD', 'outputTokenUSD']) {
                assert.throws(
                    () => router([provider('bad', () => response(0), { [key]: value })]),
                    { code: 'invalid-provider' }
                );
            }
        }
    });

    test(`${format}: invalid reported charges retain the full reservation`, async () => {
        for (const cost of [-1, NaN, Infinity, 1_000_001, '0', undefined, {}, 0n]) {
            const r = router([provider('bad', () => response(cost))], { maxCostUSD: 0.1 });
            failure(await r.infer(request()), 'usage-unverifiable');
            assert.equal(r.budgetUsage.reservedCostUSD, 0.1);
            failure(await r.infer(request()), 'usage-unverifiable');
        }
        let reads = 0;
        const raw = response(0);
        Object.defineProperty(raw.usage, 'costUSD', {
            enumerable: true,
            get() {
                reads++;
                return 0;
            },
        });
        const r = router([provider('getter', () => raw)]);
        failure(await r.infer(request()), 'usage-unverifiable');
        assert.equal(reads, 0);
    });

    test(`${format}: fractional token prices are multiplied and summed exactly`, async () => {
        const seen = [];
        const p = provider(
            'tokens',
            (req) => {
                seen.push(req.maxCostUSD);
                return {
                    data: 42,
                    usage: { inputTokens: 3, outputTokens: 7, costUSD: 0.00000000515 },
                };
            },
            { callUSD: 0.000000002, inputTokenUSD: 0.00000000035, outputTokenUSD: 0.0000000003 }
        );
        p.tokenBased = true;
        const r = router([p], { maxInputTokens: 3, maxOutputTokens: 7, maxCostUSD: 0.00000001545 });
        for (let i = 0; i < 3; i++) assert.equal((await r.infer(request())).status, 'completed');
        failure(await r.infer(request()), 'cost-limit');
        assert.deepEqual(seen, [0.00000000515, 0.00000000515, 0.00000000515]);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.00000001545);
    });

    test(`${format}: smallest positive prices are never rounded into free calls`, async () => {
        const r = router(
            [provider('tiny', () => response(Number.MIN_VALUE), { callUSD: Number.MIN_VALUE })],
            { maxCostUSD: 1e-323 }
        );
        assert.equal((await r.infer(request())).status, 'completed');
        assert.equal((await r.infer(request())).status, 'completed');
        failure(await r.infer(request()), 'cost-limit');
        assert.equal(r.budgetUsage.reservedCostUSD, 1e-323);
        const zero = router(
            [
                provider('tiny', () => assert.fail('must not dispatch'), {
                    callUSD: Number.MIN_VALUE,
                }),
            ],
            { maxCostUSD: 0 }
        );
        failure(await zero.infer(request()), 'cost-limit');
    });

    test(`${format}: a nonrepresentable attempt cap is rounded upward and fully funded`, async () => {
        let cap;
        const p = provider(
            'rounding',
            (req) => {
                cap = req.maxCostUSD;
                return response(cap);
            },
            { callUSD: 0.1, inputTokenUSD: 1e-17 }
        );
        p.tokenBased = true;
        const r = router([p], {
            maxInputTokens: 1,
            maxOutputTokens: 1,
            maxCostUSD: 0.10000000000000002,
        });
        assert.equal((await r.infer(request())).status, 'completed');
        assert.equal(cap, 0.10000000000000002);
        assert.equal(r.budgetUsage.reservedCostUSD, cap);
        const below = router([p], { maxInputTokens: 1, maxOutputTokens: 1, maxCostUSD: 0.1 });
        failure(await below.infer(request()), 'cost-limit');
    });

    test(`${format}: large token products fail before dispatch without overflow`, async () => {
        const p = provider('large', () => assert.fail('must not dispatch'), {
            callUSD: 1_000_000,
            inputTokenUSD: 1_000_000,
        });
        p.tokenBased = true;
        const r = router([p], {
            maxCostUSD: 1_000_000,
            maxInputTokens: 1_048_576,
            maxTokens: 100_000_000,
        });
        failure(await r.infer(request()), 'cost-limit');
        assert.equal(r.budgetUsage.calls, 0);
        assert.equal(r.budgetUsage.reservedCostUSD, 0);
    });

    test(`${format}: explicit retries retain failed-attempt billing`, async () => {
        let calls = 0;
        const r = router(
            [
                provider('retry', () => {
                    if (++calls < 3) throw Error('ambiguous remote failure');
                    return response(0.1);
                }),
            ],
            { maxCostUSD: 0.3 }
        );
        failure(await r.infer(request()), 'provider-error');
        failure(await r.infer(request()), 'provider-error');
        assert.equal((await r.infer(request())).status, 'completed');
        failure(await r.infer(request()), 'cost-limit');
        assert.equal(calls, 3);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.3);
    });

    test(`${format}: fallback reserves separately and cannot cross the remaining budget`, async () => {
        const calls = [];
        const r = router(
            [
                provider('a', () => {
                    calls.push('a');
                    throw Error('possibly billed');
                }),
                provider('b', () => {
                    calls.push('b');
                    return response(0.1);
                }),
            ],
            { maxCostUSD: 0.3 }
        );
        const first = await r.infer(request(), { allowFallback: true });
        assert.equal(first.status, 'completed');
        assert.deepEqual(
            first.attempts.map((a) => a.reservedCostUSD),
            [0.1, 0.1]
        );
        failure(await r.infer(request(), { allowFallback: true }), 'cost-limit');
        assert.deepEqual(calls, ['a', 'b', 'a']);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.3);
    });

    test(`${format}: lower, zero and unknown charges do not refund a non-final reservation`, async () => {
        for (const reported of [0.05, 0, null]) {
            const r = router([provider('paid', () => response(reported))], { maxCostUSD: 0.1 });
            const result = await r.infer(request());
            assert.equal(result.status, 'completed');
            assert.equal(result.usage.costUSD, reported);
            assert.equal(r.budgetUsage.reservedCostUSD, 0.1);
            failure(await r.infer(request()), 'cost-limit');
        }
    });

    test(`${format}: reported excess is charged and blocks fallback even with malformed data`, async () => {
        for (const data of [42, 'bad-schema']) {
            let fallback = 0;
            const r = router([
                provider('a', () => response(0.2, data)),
                provider('b', () => {
                    fallback++;
                    return response(0.1);
                }),
            ]);
            failure(await r.infer(request(), { allowFallback: true }), 'usage-limit');
            assert.equal(r.budgetUsage.reservedCostUSD, 0.2);
            failure(await r.infer(request()), 'usage-limit');
            assert.equal(fallback, 0);
        }
    });

    test(`${format}: cost changes during semantic validation cannot bypass reconciliation`, async () => {
        const raw = response(0.1);
        const r = router([provider('paid', () => raw)]);
        const input = request();
        input.output.validate = () => {
            raw.usage.costUSD = 0.2;
            return true;
        };
        failure(await r.infer(input), 'usage-limit');
        assert.equal(r.budgetUsage.reservedCostUSD, 0.2);
    });

    test(`${format}: precomputed floating-point surplus is not forgiven by an epsilon`, async () => {
        const r = router(
            [provider('paid', () => assert.fail('must not dispatch'), { callUSD: 0.1 + 0.2 })],
            { maxCostUSD: 0.3 }
        );
        failure(await r.infer(request()), 'cost-limit');
        assert.equal(r.budgetUsage.calls, 0);
    });

    test(`${format}: reported overrun is recorded even above the lifetime budget`, async () => {
        const r = router([provider('paid', () => response(0.2))], { maxCostUSD: 0.1 });
        failure(await r.infer(request()), 'usage-limit');
        assert.equal(r.budgetUsage.reservedCostUSD, 0.2);
        assert.equal(r.budgetUsage.calls, 1);
    });

    test(`${format}: pre-cancellation reserves nothing`, async () => {
        const controller = new AbortController();
        controller.abort();
        const r = router([provider('paid', () => assert.fail('must not dispatch'))]);
        failure(await r.infer(request(controller.signal)), 'cancelled');
        assert.equal(r.budgetUsage.reservedCostUSD, 0);
        assert.equal(r.budgetUsage.calls, 0);
    });

    for (const mode of ['cancelled', 'timeout']) {
        test(`${format}: ${mode} work retains reservations and reconciles late excess once`, async () => {
            for (const charge of [0.05, 0.2]) {
                const pending = deferred();
                const controller = new AbortController();
                const r = router([provider('paid', () => pending.promise)], {
                    maxCostUSD: 0.1,
                    timeoutMs: mode === 'timeout' ? 10 : 1000,
                });
                const first = r.infer(request(controller.signal));
                if (mode === 'cancelled') controller.abort();
                const result = await first;
                failure(result, mode);
                assert.equal(r.budgetUsage.reservedCostUSD, 0.1);
                failure(await r.infer(request()), 'busy');
                pending.resolve(response(charge));
                await tick();
                assert.equal(r.budgetUsage.reservedCostUSD, Math.max(0.1, charge));
                failure(await r.infer(request()), charge > 0.1 ? 'usage-limit' : 'cost-limit');
                assert.equal(result.error.code, mode);
                assert.equal(r.budgetUsage.calls, 1);
            }
        });
    }
}
