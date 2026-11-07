import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const formats = [
    ['ESM', await import('shivax/models')],
    ['CommonJS', require('shivax/models')],
];
const scope = { kind: 'personal', id: 'token-safety' };
const request = (signal = new AbortController().signal) => ({
    capability: 'text-reasoning',
    input: null,
    output: { schema: { type: 'number' } },
    context: { taskId: 'task', sessionId: 'session', scope, signal },
});
const report = (usage = {}, data = 42) => ({
    data,
    usage: { inputTokens: 0, outputTokens: 1, costUSD: 0, ...usage },
});
const provider = (id, infer, extras = {}) => ({
    id,
    infer,
    locality: 'in-process',
    tokenBased: true,
    capabilities: ['text-reasoning'],
    pricing: { callUSD: 0, inputTokenUSD: 0, outputTokenUSD: 0 },
    ...extras,
});
function failure(result, code, reason) {
    assert.equal(result.status, code === 'cancelled' ? 'cancelled' : 'failed');
    assert.equal(result.error.code, code);
    if (reason !== undefined) assert.equal(result.error.reason, reason);
}
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const [
    format,
    { ModelRouter, ModelProviderRegistry, ModelError, OllamaModelAdapter, createModelOperation },
] of formats) {
    const router = (providers, limits = {}) => {
        const registry = new ModelProviderRegistry();
        providers.forEach((p) => registry.register(p));
        return new ModelRouter(registry, {
            scope,
            limits: { maxInputTokens: 1, maxOutputTokens: 1, maxTokens: 20, ...limits },
        });
    };

    test(`${format}: token overrun precedes malformed data and prevents all fallback and reuse`, async () => {
        let fallback = 0;
        const r = router([
            provider('a', () => report({ outputTokens: 2 }, 'not-a-number')),
            provider('b', () => {
                fallback++;
                return report();
            }),
        ]);
        const result = await r.infer(request(), { allowFallback: true });
        failure(result, 'usage-limit', 'token-limit-exceeded');
        assert.equal(result.attempts.length, 1);
        assert.equal(result.attempts[0].usage.outputTokens, 2);
        assert.equal(result.attempts[0].error.reason, 'token-limit-exceeded');
        assert.equal(r.budgetUsage.reservedTokens, 3);
        failure(await r.infer(request()), 'usage-limit', 'token-limit-exceeded');
        assert.equal(fallback, 0);
    });

    test(`${format}: input overruns win before cyclic, oversized or accessor model data`, async () => {
        let reads = 0;
        const cycle = {};
        cycle.self = cycle;
        const inputs = [
            report({ inputTokens: 2 }, cycle),
            report({ inputTokens: 2 }, 'x'.repeat(100)),
            {
                get data() {
                    reads++;
                    return 42;
                },
                usage: report({ inputTokens: 2 }).usage,
            },
        ];
        for (const raw of inputs) {
            const r = router([provider('a', () => raw)], { maxOutputBytes: 5 });
            failure(
                await r.infer(request(), { allowFallback: true }),
                'usage-limit',
                'token-limit-exceeded'
            );
            assert.equal(r.budgetUsage.reservedTokens, 3);
        }
        assert.equal(reads, 0);
    });

    test(`${format}: missing and null token metadata fail closed without another provider`, async () => {
        for (const raw of [
            undefined,
            null,
            {},
            { data: 42 },
            { data: 42, usage: null },
            { data: 42, usage: {} },
            report({ inputTokens: null }),
            report({ outputTokens: null }),
        ]) {
            let fallback = 0;
            const r = router([
                provider('a', () => raw),
                provider('b', () => {
                    fallback++;
                    return report();
                }),
            ]);
            failure(
                await r.infer(request(), { allowFallback: true }),
                'usage-unverifiable',
                'usage-unverifiable'
            );
            failure(await r.infer(request()), 'usage-unverifiable');
            assert.equal(fallback, 0);
            assert.equal(r.budgetUsage.calls, 1);
            assert.equal(r.budgetUsage.reservedTokens, 2);
        }
    });

    test(`${format}: invalid counts and structural usage fields are terminal and sanitized`, async () => {
        const invalid = [-1, 0.5, NaN, Infinity, 'secret-token', 1n, {}, 100_000_001];
        for (const field of ['inputTokens', 'outputTokens'])
            for (const value of invalid) {
                const r = router([provider('bad', () => report({ [field]: value }))]);
                const result = await r.infer(request(), { allowFallback: true });
                failure(result, 'usage-unverifiable');
                assert.equal(result.attempts[0].usage[field], null);
                assert.ok(!JSON.stringify(result).includes('secret-token'));
            }
        for (const usage of [
            { ...report().usage, extra: 'secret-token' },
            Object.assign(Object.create({ inputTokens: 0 }), { outputTokens: 1, costUSD: 0 }),
        ]) {
            failure(
                await router([provider('bad', () => ({ data: 42, usage }))]).infer(request()),
                'usage-unverifiable'
            );
        }
    });

    test(`${format}: usage getters never run and other valid fields still enforce hard limits`, async () => {
        let reads = 0;
        const badField = {
            get inputTokens() {
                reads++;
                return 0;
            },
            outputTokens: 2,
            costUSD: 0,
        };
        const a = router([provider('a', () => ({ data: 'bad', usage: badField }))]);
        failure(await a.infer(request()), 'usage-limit', 'token-limit-exceeded');
        const b = router([
            provider('b', () => ({
                data: 42,
                get usage() {
                    reads++;
                    return report().usage;
                },
            })),
        ]);
        failure(await b.infer(request()), 'usage-unverifiable');
        assert.equal(reads, 0);
    });

    test(`${format}: known token and cost excess both enter the aggregate ledger`, async () => {
        const p = provider(
            'paid',
            () => report({ inputTokens: 3, outputTokens: 2, costUSD: 0.2 }, 'bad'),
            { pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 } }
        );
        const r = router([p], { maxCostUSD: 0.1 });
        failure(await r.infer(request()), 'usage-limit', 'token-limit-exceeded');
        assert.equal(r.budgetUsage.reservedTokens, 5);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.2);
    });

    test(`${format}: valid cost excess is enforced even with invalid token metadata`, async () => {
        const p = provider('paid', () => report({ inputTokens: 'bad', costUSD: 0.2 }), {
            pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 },
        });
        const r = router([p], { maxCostUSD: 0.1 });
        failure(await r.infer(request()), 'usage-limit', 'cost-limit-exceeded');
        assert.equal(r.budgetUsage.reservedCostUSD, 0.2);
    });

    test(`${format}: unknown cost retains its ceiling with verifiable tokens`, async () => {
        const p = provider('paid', () => report({ costUSD: null }), {
            pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 },
        });
        const r = router([p], { maxCostUSD: 0.1 });
        const result = await r.infer(request());
        assert.equal(result.status, 'completed');
        assert.equal(result.usage.costUSD, null);
        assert.equal(r.budgetUsage.reservedCostUSD, 0.1);
        failure(await r.infer(request()), 'cost-limit', 'cost-limit-exceeded');
    });

    test(`${format}: genuinely token-free providers can report null counts but cannot report positive usage`, async () => {
        const free = router(
            [
                provider('free', () => report({ inputTokens: null, outputTokens: null }), {
                    tokenBased: false,
                }),
            ],
            { maxTokens: 0 }
        );
        assert.equal((await free.infer(request())).status, 'completed');
        assert.equal(free.budgetUsage.reservedTokens, 0);
        const bad = router([provider('bad', () => report(), { tokenBased: false })], {
            maxTokens: 0,
        });
        failure(await bad.infer(request()), 'usage-limit', 'token-limit-exceeded');
    });

    test(`${format}: safe output fallback retains verified usage and exact aggregate reservations`, async () => {
        let calls = 0;
        const r = router(
            [
                provider('a', () => {
                    calls++;
                    return report({}, 'bad');
                }),
                provider('b', () => {
                    calls++;
                    return report();
                }),
            ],
            { maxTokens: 4 }
        );
        const result = await r.infer(request(), { allowFallback: true });
        assert.equal(result.status, 'completed');
        assert.equal(result.attempts[0].error.reason, 'invalid-provider-output');
        assert.deepEqual(
            result.attempts.map((a) => a.usage.outputTokens),
            [1, 1]
        );
        assert.equal(r.budgetUsage.reservedTokens, 4);
        failure(await r.infer(request()), 'token-limit', 'token-limit-exceeded');
        assert.equal(calls, 2);
    });

    test(`${format}: aggregate token boundary rejects fallback before dispatch`, async () => {
        let fallback = 0;
        const r = router(
            [
                provider('a', () => report({}, 'bad')),
                provider('b', () => {
                    fallback++;
                    return report();
                }),
            ],
            { maxTokens: 3 }
        );
        failure(
            await r.infer(request(), { allowFallback: true }),
            'token-limit',
            'token-limit-exceeded'
        );
        assert.equal(fallback, 0);
        assert.equal(r.budgetUsage.reservedTokens, 2);
    });

    test(`${format}: explicit retries and retryable exceptions never refund reservations`, async () => {
        let calls = 0;
        const r = router(
            [
                provider('a', () => {
                    if (++calls === 1) throw Error('SECRET credential');
                    return report();
                }),
            ],
            { maxTokens: 4 }
        );
        const first = await r.infer(request());
        failure(first, 'provider-error');
        assert.ok(!JSON.stringify(first).includes('SECRET'));
        assert.equal((await r.infer(request())).status, 'completed');
        failure(await r.infer(request()), 'token-limit');
        assert.equal(r.budgetUsage.reservedTokens, 4);
        assert.equal(calls, 2);
        const fallback = router([
            provider('a', () => {
                throw new ModelError('unavailable');
            }),
            provider('b', () => report()),
        ]);
        assert.equal((await fallback.infer(request(), { allowFallback: true })).providerId, 'b');
    });

    test(`${format}: provider-declared invalid output without usage is not retryable`, async () => {
        let called = false;
        const r = router([
            provider('a', () => {
                throw new ModelError('invalid-provider-output');
            }),
            provider('b', () => {
                called = true;
                return report();
            }),
        ]);
        failure(await r.infer(request(), { allowFallback: true }), 'usage-unverifiable');
        assert.equal(called, false);
    });

    test(`${format}: semantic callbacks cannot conceal limits by failing or mutating usage`, async () => {
        const raw = report();
        const r = router([provider('a', () => raw)]);
        const input = request();
        input.output.validate = () => {
            raw.usage.outputTokens = 2;
            return false;
        };
        failure(
            await r.infer(input, { allowFallback: true }),
            'usage-limit',
            'token-limit-exceeded'
        );
        assert.equal(r.budgetUsage.reservedTokens, 3);
    });

    for (const mode of ['timeout', 'cancelled']) {
        test(`${format}: ${mode} retains ownership and accounts late token overruns once`, async () => {
            const pending = deferred();
            const controller = new AbortController();
            let fallback = 0;
            const r = router(
                [
                    provider('a', () => pending.promise),
                    provider('b', () => {
                        fallback++;
                        return report();
                    }),
                ],
                { timeoutMs: mode === 'timeout' ? 250 : 1000 }
            );
            const first = r.infer(request(controller.signal), { allowFallback: true });
            if (mode === 'cancelled') controller.abort();
            const result = await first;
            failure(result, mode, mode === 'timeout' ? 'provider-timeout' : undefined);
            failure(await r.infer(request()), 'busy');
            pending.resolve(report({ outputTokens: 2 }, 'bad'));
            await tick();
            failure(await r.infer(request()), 'usage-limit', 'token-limit-exceeded');
            assert.equal(result.error.code, mode);
            assert.equal(fallback, 0);
            assert.equal(r.budgetUsage.reservedTokens, 3);
        });
    }

    test(`${format}: late unverifiable provider failure blocks reuse after cancellation`, async () => {
        let reject;
        const pending = new Promise((_, fail) => {
            reject = fail;
        });
        const controller = new AbortController();
        const r = router([provider('a', () => pending)]);
        const first = r.infer(request(controller.signal));
        controller.abort();
        const result = await first;
        failure(result, 'cancelled');
        reject(new ModelError('usage-unverifiable'));
        await tick();
        failure(await r.infer(request()), 'usage-unverifiable');
        assert.equal(result.error.code, 'cancelled');
        assert.equal(r.budgetUsage.reservedTokens, 2);
    });

    test(`${format}: provider timeout aliases are terminal and sanitized`, async () => {
        let fallback = 0;
        const r = router([
            provider('a', () => {
                const error = new ModelError('provider-timeout');
                error.message = 'SECRET';
                throw error;
            }),
            provider('b', () => {
                fallback++;
                return report();
            }),
        ]);
        const result = await r.infer(request(), { allowFallback: true });
        failure(result, 'timeout', 'provider-timeout');
        assert.equal(fallback, 0);
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    });

    test(`${format}: concurrent requests cannot share a token reservation`, async () => {
        const pending = deferred();
        let calls = 0;
        const r = router(
            [
                provider('a', () => {
                    calls++;
                    return pending.promise;
                }),
            ],
            { maxTokens: 2 }
        );
        const first = r.infer(request());
        const rest = await Promise.all(Array.from({ length: 8 }, () => r.infer(request())));
        rest.forEach((result) => failure(result, 'busy'));
        pending.resolve(report());
        assert.equal((await first).status, 'completed');
        failure(await r.infer(request()), 'token-limit');
        assert.equal(calls, 1);
        assert.equal(r.budgetUsage.reservedTokens, 2);
    });

    test(`${format}: requested error aliases preserve legacy codes and bridge classifications`, async () => {
        for (const [reason, code] of [
            ['token-limit-exceeded', 'token-limit'],
            ['cost-limit-exceeded', 'cost-limit'],
            ['invalid-provider-output', 'invalid-output'],
            ['usage-unverifiable', 'usage-unverifiable'],
            ['provider-timeout', 'timeout'],
        ]) {
            const error = new ModelError(reason);
            assert.equal(error.code, code);
            assert.equal(error.reason, reason);
        }
        const r = router([provider('a', () => report({ outputTokens: 2 }))]);
        const input = request();
        const operation = createModelOperation(r, input.capability, input.output);
        await assert.rejects(operation(input.input, input.context), {
            code: 'usage-limit',
            reason: 'token-limit-exceeded',
        });
    });

    test(`${format}: Ollama preserves usage on malformed JSON and rejects unverifiable counts`, async () => {
        for (const [inputTokens, content, expected] of [
            [4097, 'bad-json', 'usage-limit'],
            [50, 'bad-json', 'completed'],
            [undefined, '42', 'usage-unverifiable'],
        ]) {
            let fallback = 0;
            const ollama = new OllamaModelAdapter({
                model: 'local-fixture',
                fetch: async (url) =>
                    new Response(
                        JSON.stringify(
                            url.endsWith('/show')
                                ? { model_info: { 'fixture.context_length': 8192 } }
                                : {
                                      done: true,
                                      done_reason: 'stop',
                                      prompt_eval_count: inputTokens,
                                      eval_count: 1,
                                      message: { content },
                                  }
                        )
                    ),
            });
            const r = router(
                [
                    ollama,
                    provider('fallback', () => {
                        fallback++;
                        return report();
                    }),
                ],
                { maxInputTokens: 4096, maxTokens: 20_000 }
            );
            const result = await r.infer(request(), { providerId: ollama.id, allowFallback: true });
            if (expected === 'completed') {
                assert.equal(result.status, 'completed');
                assert.equal(result.attempts[0].usage.inputTokens, 50);
                assert.equal(fallback, 1);
            } else {
                failure(result, expected);
                assert.equal(fallback, 0);
            }
        }
    });
}
