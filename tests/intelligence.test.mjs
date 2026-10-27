import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ModelProviderRegistry,
    ModelRouter,
    NeuralModelProvider,
    RulesModelProvider,
    OllamaModelAdapter,
    RemoteModelAdapter,
    ModelError,
    MODEL_CAPABILITIES,
    createModelOperation,
    NeuralNet,
    createSpecialistSystem,
    createTaskContext,
} from 'shivax';

const scope = { kind: 'personal', id: 'hybrid-tests' };
const zero = { inputTokens: 0, outputTokens: 0, costUSD: 0 };
const output = {
    schema: {
        type: 'object',
        properties: { answer: { type: 'number' } },
        required: ['answer'],
        additionalProperties: false,
    },
};
const context = (signal = new AbortController().signal) => ({
    taskId: 'task',
    sessionId: 'session',
    scope,
    signal,
});
const request = (changes = {}) => ({
    capability: 'text-reasoning',
    input: { question: 'fixture' },
    output,
    context: context(),
    ...changes,
});
function provider(id = 'fixture', changes = {}) {
    return {
        id,
        locality: 'local',
        tokenBased: true,
        capabilities: ['text-reasoning'],
        pricing: { inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 0 },
        infer: () => ({ data: { answer: 42 }, usage: zero }),
        ...changes,
    };
}
function router(providers = [provider()], limits = {}) {
    const registry = new ModelProviderRegistry();
    providers.forEach((p) => registry.register(p));
    return new ModelRouter(registry, { scope, limits });
}
function fail(result, code) {
    assert.notEqual(result.status, 'completed');
    assert.equal(result.error.code, code);
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const response = (value) =>
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function transport(chat = {}, show = {}) {
    const calls = [];
    return {
        calls,
        fetch: async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body), init });
            return url.endsWith('/show')
                ? response({ model_info: { 'fixture.context_length': 8192 }, ...show })
                : response({
                      done: true,
                      done_reason: 'stop',
                      prompt_eval_count: 50,
                      eval_count: 8,
                      message: { content: '{"answer":42}' },
                      ...chat,
                  });
        },
    };
}

test('model registry validates unique providers, discovers capabilities, snapshots methods and removes IDs', () => {
    const p = provider(),
        registry = new ModelProviderRegistry().register(p);
    p.capabilities.push('code-generation');
    p.pricing.callUSD = 99;
    p.infer = () => {
        throw Error('mutated');
    };
    assert.deepEqual(
        registry.findByCapability('text-reasoning').map((p) => p.id),
        ['fixture']
    );
    assert.deepEqual(registry.findByCapability('code-generation'), []);
    assert.equal(registry.get('fixture').pricing.callUSD, 0);
    assert.equal(registry.get('fixture').infer().data.answer, 42);
    assert.equal(Object.isFrozen(registry.list()[0].capabilities), true);
    assert.throws(
        () => registry.register(provider()),
        (error) => error.code === 'duplicate-provider'
    );
    for (const changes of [
        { capabilities: [] },
        { capabilities: ['unknown'] },
        { capabilities: ['text-reasoning', 'text-reasoning'] },
        { infer: null },
        { locality: 'internet' },
        { pricing: { callUSD: -1 } },
        { tokenBased: 'yes' },
    ])
        assert.throws(
            () => registry.register(provider('bad', changes)),
            (error) => error.code === 'invalid-provider'
        );
    assert.equal(registry.unregister('fixture'), true);
    assert.equal(registry.unregister('fixture'), false);
});

test('router selects every declared capability deterministically and fails missing capabilities safely', async () => {
    const providers = MODEL_CAPABILITIES.map((capability, i) =>
        provider(`p${i}`, { capabilities: [capability] })
    );
    const r = router(providers);
    for (const [i, capability] of MODEL_CAPABILITIES.entries()) {
        const result = await r.infer(request({ capability }));
        assert.equal(result.providerId, `p${i}`);
    }
    assert.equal((await router([provider('z'), provider('a')]).infer(request())).providerId, 'a');
    fail(await router().infer(request({ capability: 'code-generation' })), 'missing-provider');
    fail(
        await router().infer(request(), { providerId: 'absent', allowFallback: true }),
        'missing-provider'
    );
    fail(await router().infer(request({ capability: 'shell' })), 'invalid-input');
});

test('neural provider predictions equal the existing trained engine and never mutate serialized weights', async () => {
    const network = new NeuralNet({ layers: [2, 4, 1], task: 'binary', seed: 7 });
    network.train(
        [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
        ],
        [[0], [1], [1], [0]],
        { epochs: 10 }
    );
    const before = network.toJSON(),
        p = new NeuralModelProvider('existing-ml', network),
        r = router([p], { maxTokens: 0 });
    const input = [0, 1];
    const result = await r.infer(
        request({
            capability: 'numeric-inference',
            input,
            output: {
                schema: {
                    type: 'object',
                    properties: { predictions: { type: 'array', items: { type: 'number' } } },
                    required: ['predictions'],
                    additionalProperties: false,
                },
            },
        })
    );
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.data.predictions, network.predict(input));
    assert.deepEqual(network.toJSON(), before);
    assert.equal(result.attempts[0].reservedTokens, 0);
    fail(await r.infer(request({ capability: 'numeric-inference', input: [1] })), 'invalid-input');
});

test('deterministic rules perform real validation and reject unknown or invalid rule inputs', async () => {
    const r = router([
        new RulesModelProvider('rules', [
            {
                id: 'positive',
                validate: (input) => typeof input === 'number',
                run: (value) => ({ valid: value > 0 }),
            },
        ]),
    ]);
    const run = (data) =>
        r.infer(
            request({
                capability: 'deterministic-validation',
                input: data,
                output: {
                    schema: {
                        type: 'object',
                        properties: { valid: { type: 'boolean' } },
                        required: ['valid'],
                        additionalProperties: false,
                    },
                },
            })
        );
    assert.deepEqual((await run({ rule: 'positive', data: -2 })).data, { valid: false });
    assert.deepEqual((await run({ rule: 'positive', data: 2 })).data, { valid: true });
    fail(await run({ rule: 'missing', data: 2 }), 'unavailable');
    fail(await run({ rule: 'positive', data: '2' }), 'invalid-input');
    fail(await run({ rule: 'positive', data: 2, execute: 'shell' }), 'invalid-input');
});

test('Ollama adapter is idle until inference, reuses loopback structured-output transport and reports real usage', async () => {
    const mock = transport(),
        adapter = new OllamaModelAdapter({ model: 'fixture', fetch: mock.fetch });
    const r = router([adapter]);
    assert.equal(mock.calls.length, 0);
    const result = await r.infer(request());
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 8, costUSD: 0 });
    assert.deepEqual(
        mock.calls.map((call) => call.url),
        ['http://127.0.0.1:11434/api/show', 'http://127.0.0.1:11434/api/chat']
    );
    const chat = mock.calls[1];
    assert.deepEqual(chat.body.format, output.schema);
    assert.equal(chat.body.stream, false);
    assert.equal(chat.body.options.num_predict, 1024);
    assert.equal(chat.body.keep_alive, 0);
    assert.equal(chat.init.redirect, 'error');
    assert.equal(chat.init.credentials, 'omit');
    await r.infer(request());
    assert.equal(mock.calls.length, 4);
});

test('Ollama rejects remote endpoints, cloud aliases and remote metadata without sending prompts', async () => {
    for (const options of [{ baseURL: 'https://example.com' }, { model: 'fixture-cloud' }])
        assert.throws(() => new OllamaModelAdapter({ model: 'fixture', ...options }));
    const mock = transport({}, { remote_host: 'external.example' });
    fail(
        await router([new OllamaModelAdapter({ model: 'fixture', fetch: mock.fetch })]).infer(
            request()
        ),
        'remote-disabled'
    );
    assert.equal(mock.calls.length, 1);
    assert.throws(
        () => new OllamaModelAdapter({ model: 'fixture', capabilities: ['visual-interpretation'] })
    );
});

test('Ollama rejects missing models, malformed JSON, schema mismatch and token overrun', async () => {
    const missing = new OllamaModelAdapter({
        model: 'fixture',
        fetch: async () => new Response('', { status: 404 }),
    });
    fail(await router([missing]).infer(request()), 'unavailable');
    for (const [chat, code] of [
        [{ message: { content: 'bad-json' } }, 'invalid-output'],
        [{ message: { content: '{"answer":"wrong"}' } }, 'invalid-output'],
        [{ eval_count: 1025 }, 'token-limit'],
        [{ prompt_eval_count: 4097 }, 'usage-limit'],
    ]) {
        const mock = transport(chat);
        fail(
            await router([new OllamaModelAdapter({ model: 'fixture', fetch: mock.fetch })]).infer(
                request()
            ),
            code
        );
    }
    const mock = transport();
    fail(
        await router([new OllamaModelAdapter({ model: 'fixture', fetch: mock.fetch })], {
            maxInputTokens: 16,
        }).infer(request()),
        'token-limit'
    );
    assert.equal(mock.calls.length, 0);
});

test('remote SDK loading is lazy, opt-in and bounded by declared pricing', async () => {
    let loads = 0,
        calls = 0;
    const adapter = new RemoteModelAdapter({
        id: 'remote',
        capabilities: ['text-reasoning'],
        pricing: { inputTokenUSD: 0.001, outputTokenUSD: 0.002, callUSD: 0 },
        async load() {
            loads++;
            return {
                infer: (req) => {
                    calls++;
                    assert.equal(req.maxCostUSD, 6.144);
                    return {
                        data: { answer: 42 },
                        usage: { inputTokens: 10, outputTokens: 5, costUSD: 0.02 },
                    };
                },
            };
        },
    });
    const r = router([adapter], { maxCostUSD: 20 });
    assert.equal(loads, 0);
    fail(await r.infer(request()), 'remote-disabled');
    assert.equal(loads, 0);
    fail(await router([adapter]).infer(request(), { allowRemote: true }), 'cost-limit');
    assert.equal(loads, 0);
    assert.equal((await r.infer(request(), { allowRemote: true })).status, 'completed');
    assert.equal((await r.infer(request(), { allowRemote: true })).status, 'completed');
    assert.equal(loads, 1);
    assert.equal(calls, 2);
    assert.equal(r.budgetUsage.reservedCostUSD, 12.288);
});

test('remote loader failures can recover explicitly and never expose credentials in errors', async () => {
    let loads = 0;
    const adapter = new RemoteModelAdapter({
        id: 'remote',
        capabilities: ['text-reasoning'],
        pricing: provider().pricing,
        async load() {
            if (++loads === 1) throw Error('secret-key-test');
            return { infer: () => ({ data: { answer: 42 }, usage: zero }) };
        },
    });
    const r = router([adapter]);
    const failed = await r.infer(request(), { allowRemote: true });
    fail(failed, 'provider-error');
    assert.equal(JSON.stringify(failed).includes('secret-key-test'), false);
    assert.equal((await r.infer(request(), { allowRemote: true })).status, 'completed');
    assert.equal(loads, 2);
});

test('fallback is explicit, compatible, ordered and separately permissioned for remote providers', async () => {
    const seen = [],
        broken = provider('a', {
            infer: () => {
                seen.push('a');
                throw Error('private');
            },
        });
    const good = provider('b', {
        infer: () => {
            seen.push('b');
            return { data: { answer: 42 }, usage: zero };
        },
    });
    const wrong = provider('0', {
        capabilities: ['code-generation'],
        infer: () => {
            throw Error('wrong capability');
        },
    });
    const r = router([good, broken, wrong]);
    fail(await r.infer(request()), 'provider-error');
    assert.deepEqual(seen, ['a']);
    const result = await r.infer(request(), { allowFallback: true });
    assert.equal(result.providerId, 'b');
    assert.deepEqual(
        result.attempts.map((a) => a.outcome),
        ['failed', 'completed']
    );
    assert.deepEqual(seen, ['a', 'a', 'b']);
    assert.equal(r.budgetUsage.calls, 3);
    let remoteCalls = 0;
    const remote = provider('remote', {
        locality: 'remote',
        infer: () => {
            remoteCalls++;
            return { data: { answer: 42 }, usage: zero };
        },
    });
    fail(
        await router([broken, remote]).infer(request(), { allowFallback: true }),
        'provider-error'
    );
    assert.equal(remoteCalls, 0);
    assert.equal(
        (
            await router([broken, remote]).infer(request(), {
                allowFallback: true,
                allowRemote: true,
            })
        ).providerId,
        'remote'
    );
});

test('invalid model output can fall back but input errors and budget errors never trigger another provider', async () => {
    let calls = 0;
    const good = provider('b', {
        infer: () => {
            calls++;
            return { data: { answer: 42 }, usage: zero };
        },
    });
    const bad = provider('a', { infer: () => ({ data: { answer: 'bad' }, usage: zero }) });
    assert.equal(
        (await router([bad, good]).infer(request(), { allowFallback: true })).providerId,
        'b'
    );
    assert.equal(calls, 1);
    fail(
        await router([
            provider('a', {
                infer: () => {
                    throw new ModelError('invalid-input');
                },
            }),
            good,
        ]).infer(request(), { allowFallback: true }),
        'invalid-input'
    );
    fail(
        await router([bad, good], { maxCalls: 1 }).infer(request(), { allowFallback: true }),
        'call-limit'
    );
    assert.equal(calls, 1);
});

test('input and output validation rejects accessors, oversized data, unsupported schemas and async predicates', async () => {
    let accessed = 0,
        called = 0;
    const r = router([
        provider('p', {
            infer: () => {
                called++;
                return { data: { answer: 42 }, usage: zero };
            },
        }),
    ]);
    fail(
        await r.infer(
            request({
                input: {
                    get secret() {
                        accessed++;
                        return 1;
                    },
                },
            })
        ),
        'invalid-input'
    );
    fail(
        await r.infer(request({ output: { schema: { type: 'string', pattern: '.*' } } })),
        'invalid-input'
    );
    fail(await r.infer(request({ output: { schema: { minimum: 0 } } })), 'invalid-input');
    assert.equal(accessed, 0);
    assert.equal(called, 0);
    fail(
        await r.infer(request({ output: { ...output, validate: async () => true } })),
        'invalid-output'
    );
    fail(
        await r.infer(request({ output: { ...output, validate: () => false } })),
        'invalid-output'
    );
    fail(await router([], { maxInputBytes: 10 }).infer(request()), 'invalid-input');
    fail(await router([provider()], { maxOutputBytes: 5 }).infer(request()), 'invalid-output');
    const evil = provider('evil', {
        infer: () => ({
            get data() {
                accessed++;
                return {};
            },
            usage: zero,
        }),
    });
    fail(await router([evil]).infer(request()), 'invalid-output');
    assert.equal(accessed, 0);
});

test('scope isolation is checked before invoking providers and cannot be changed by the input payload', async () => {
    let calls = 0;
    const r = router([
        provider('p', {
            infer: (req) => {
                calls++;
                assert.equal(req.context.scope.id, scope.id);
                return { data: { answer: 42 }, usage: zero };
            },
        }),
    ]);
    fail(
        await r.infer(request({ context: { ...context(), scope: { ...scope, id: 'other' } } })),
        'scope-mismatch'
    );
    assert.equal(calls, 0);
    const result = await r.infer(request({ input: { scope: { id: 'other' }, allowRemote: true } }));
    assert.equal(result.status, 'completed');
    assert.equal(calls, 1);
});

test('lifetime call, token and cost reservations include failed attempts and are immutable snapshots', async () => {
    const bad = provider('bad', {
        infer: () => {
            throw Error('fail');
        },
    });
    const calls = router([bad], { maxCalls: 1 });
    fail(await calls.infer(request()), 'provider-error');
    fail(await calls.infer(request()), 'call-limit');
    const tokens = router([provider()], { maxTokens: 5120 });
    assert.equal((await tokens.infer(request())).status, 'completed');
    fail(await tokens.infer(request()), 'token-limit');
    assert.equal(tokens.budgetUsage.reservedTokens, 5120);
    assert.equal(Object.isFrozen(tokens.budgetUsage), true);
    const paid = provider('paid', { pricing: { inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 1 } });
    const cost = router([paid], { maxCostUSD: 1 });
    assert.equal((await cost.infer(request())).status, 'completed');
    fail(await cost.infer(request()), 'cost-limit');
});

test('unreported usage stays null and usage overruns disable further inference without fallback', async () => {
    const unknown = provider('unknown', {
        infer: () => ({
            data: { answer: 42 },
            usage: { inputTokens: null, outputTokens: null, costUSD: null },
        }),
    });
    const r = router([unknown]);
    const result = await r.infer(request());
    assert.equal(result.usage.inputTokens, null);
    assert.equal(r.budgetUsage.reservedTokens, 5120);
    let fallback = 0;
    const over = router([
        provider('a', {
            infer: () => ({ data: { answer: 42 }, usage: { ...zero, outputTokens: 1025 } }),
        }),
        provider('b', {
            infer: () => {
                fallback++;
                return { data: { answer: 42 }, usage: zero };
            },
        }),
    ]);
    fail(await over.infer(request(), { allowFallback: true }), 'usage-limit');
    fail(await over.infer(request()), 'usage-limit');
    assert.equal(fallback, 0);
    for (const usage of [{}, { ...zero, inputTokens: -1 }, { ...zero, costUSD: 'free' }])
        fail(
            await router([
                provider('bad', { infer: () => ({ data: { answer: 42 }, usage }) }),
            ]).infer(request()),
            'invalid-output'
        );
});

test('pre-cancellation performs no provider calls and consumes no reservations', async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const r = router([
        provider('p', {
            infer: () => {
                calls++;
            },
        }),
    ]);
    fail(await r.infer(request({ context: context(controller.signal) })), 'cancelled');
    assert.equal(calls, 0);
    assert.equal(r.budgetUsage.calls, 0);
});

test('disabled routers and immediate cancellation never load optional remote clients', async () => {
    let loads = 0;
    const adapter = new RemoteModelAdapter({
        id: 'remote',
        capabilities: ['text-reasoning'],
        pricing: provider().pricing,
        async load() {
            loads++;
            return { infer: () => ({ data: { answer: 42 }, usage: zero }) };
        },
    });
    const registry = new ModelProviderRegistry().register(adapter);
    fail(
        await new ModelRouter(registry, { scope, enabled: false }).infer(request(), {
            allowRemote: true,
        }),
        'disabled'
    );
    const r = new ModelRouter(registry, { scope }),
        abort = new AbortController();
    const pending = r.infer(request({ context: context(abort.signal) }), { allowRemote: true });
    abort.abort();
    fail(await pending, 'cancelled');
    await tick();
    assert.equal(loads, 0);
});

test('configuration and routing policies fail closed and reject non-finite budgets', async () => {
    for (const limits of [
        { maxCalls: 0 },
        { maxTokens: -1 },
        { maxCostUSD: NaN },
        { timeoutMs: Infinity },
        { maxInputBytes: 0 },
        { maxOutputTokens: 1.5 },
        { maxInputTokens: 0 },
        { invented: true },
    ])
        assert.throws(
            () => router([], limits),
            (error) => error.code === 'invalid-input'
        );
    const r = router([provider()], { timeoutMs: undefined });
    fail(await r.infer(request(), { allowFallback: 'yes' }), 'invalid-input');
    fail(await r.infer(request(), { allowRemote: 1 }), 'invalid-input');
    assert.equal(r.budgetUsage.calls, 0);
});

test('cancellation propagates and retains busy ownership until ignored provider work settles', async () => {
    const entered = deferred(),
        pending = deferred(),
        controller = new AbortController();
    let seenSignal;
    const r = router([
        provider('p', {
            infer: async (req) => {
                seenSignal = req.context.signal;
                entered.resolve();
                await pending.promise;
                return { data: { answer: 42 }, usage: zero };
            },
        }),
    ]);
    const running = r.infer(request({ context: context(controller.signal) }));
    await entered.promise;
    controller.abort();
    const result = await running;
    fail(result, 'cancelled');
    assert.equal(seenSignal.aborted, true);
    assert.equal(result.attempts[0].error.code, 'cancelled');
    fail(await r.infer(request()), 'busy');
    pending.resolve();
    await tick();
    assert.equal(result.attempts.length, 1);
    assert.equal((await r.infer(request())).status, 'completed');
});

test('timeouts are absolute, cover all fallbacks and retain pending work ownership', async () => {
    const pending = deferred();
    let fallback = 0;
    const r = router(
        [
            provider('a', {
                infer: async () => {
                    await pending.promise;
                    return { data: { answer: 42 }, usage: zero };
                },
            }),
            provider('b', {
                infer: () => {
                    fallback++;
                },
            }),
        ],
        { timeoutMs: 15 }
    );
    const result = await r.infer(request(), { allowFallback: true });
    fail(result, 'timeout');
    fail(await r.infer(request()), 'busy');
    assert.equal(fallback, 0);
    pending.resolve();
    await tick();
    assert.equal(result.attempts[0].error.code, 'timeout');
});

test('synchronous remote loading past deadline cannot start remote inference', async () => {
    let calls = 0;
    const adapter = new RemoteModelAdapter({
        id: 'remote',
        capabilities: ['text-reasoning'],
        pricing: provider().pricing,
        async load() {
            const end = performance.now() + 30;
            while (performance.now() < end) {
                /* Block timers deliberately. */
            }
            return {
                infer: () => {
                    calls++;
                    return { data: { answer: 42 }, usage: zero };
                },
            };
        },
    });
    fail(
        await router([adapter], { timeoutMs: 10 }).infer(request(), { allowRemote: true }),
        'timeout'
    );
    assert.equal(calls, 0);
});

test('synchronous Ollama metadata delay cannot send a prompt after deadline', async () => {
    let chats = 0;
    const adapter = new OllamaModelAdapter({
        model: 'fixture',
        fetch: async (url) => {
            if (url.endsWith('/chat')) {
                chats++;
                return response({});
            }
            const end = performance.now() + 30;
            while (performance.now() < end) {
                /* Block timers deliberately. */
            }
            return response({ model_info: { 'fixture.context_length': 8192 } });
        },
    });
    fail(await router([adapter], { timeoutMs: 10 }).infer(request()), 'timeout');
    assert.equal(chats, 0);
});

test('reentrant semantic validators cannot start additional inference and disposal cancels work', async () => {
    const r = router();
    let nested;
    const result = await r.infer(
        request({
            output: {
                ...output,
                validate() {
                    nested = r.infer(request());
                    return true;
                },
            },
        })
    );
    assert.equal(result.status, 'completed');
    fail(await nested, 'busy');
    const pending = deferred();
    const other = router([provider('p', { infer: () => pending.promise })]);
    const running = other.infer(request());
    other.dispose();
    fail(await running, 'cancelled');
    fail(await other.infer(request()), 'disposed');
    pending.resolve({ data: { answer: 42 }, usage: zero });
    await tick();
});

test('specialist bridge routes reasoning through RUDRA while preserving task and scope context', async () => {
    let seen;
    const r = router([
        provider('reasoning-fixture', {
            infer: (req) => {
                seen = req.context;
                return {
                    data: {
                        selectedOptionId: 'one',
                        rationale: 'fixture evidence',
                        evidenceIds: ['e'],
                    },
                    usage: zero,
                };
            },
        }),
    ]);
    const decide = createModelOperation(r, 'text-reasoning', {
        schema: {
            type: 'object',
            properties: {
                selectedOptionId: { type: 'string' },
                rationale: { type: 'string' },
                evidenceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['selectedOptionId', 'rationale', 'evidenceIds'],
            additionalProperties: false,
        },
    });
    const system = createSpecialistSystem({ reasoning: { id: 'hybrid-router', decide } });
    const task = createTaskContext(
        {
            id: 'task',
            input: {
                capability: 'reasoning.decide',
                data: {
                    question: 'Choose',
                    options: [{ id: 'one', label: 'One' }],
                    evidence: [{ id: 'e', text: 'Explicit fixture' }],
                },
            },
        },
        {
            sessionId: 'session',
            signal: new AbortController().signal,
            security: { caller: { id: 'u', issuer: 'host' }, scope, toolPermissions: [] },
        }
    );
    const result = await system.rudra.run(task);
    assert.equal(result.status, 'completed');
    assert.equal(result.outputs[0].data.selectedOptionId, 'one');
    assert.equal(seen.taskId, 'task');
    assert.equal(seen.sessionId, 'session');
    assert.deepEqual(seen.scope, scope);
    assert.equal('tools' in seen, false);
});
