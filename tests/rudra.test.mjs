import assert from 'node:assert/strict';
import test from 'node:test';
import { BotRegistry, RudraOrchestrator, RudraError, createTaskContext } from 'shivax';
import { createMockReasoningBot, createMockReviewBot } from '../examples/rudra-mocks.mjs';

const both = { allowedCapabilities: ['mock.reason', 'mock.review'] };
const step = (id = 'reason', capability = 'mock.reason', input = { source: 'task' }) => ({ id, capability, input });
const workflow = () => ({ steps: [step(), step('review', 'mock.review', { source: 'step', stepId: 'reason' })] });
const planner = plan => ({ plan: () => plan });
const registry = () => new BotRegistry().register(createMockReasoningBot()).register(createMockReviewBot());
function context({ data = [2, 3, 5], capability = 'mock.reason', signal = new AbortController().signal, limits = {}, permissions = [] } = {}) {
    return createTaskContext({ id: 'task-1', input: { capability, data } }, {
        sessionId: 'session-1', signal, limits,
        security: { caller: { id: 'user', issuer: 'trusted-test-host' }, scope: { kind: 'personal', id: 'space' }, toolPermissions: permissions },
    });
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const flush = () => new Promise(resolve => setImmediate(resolve));
function states(result) { return result.trace.filter(entry => entry.type === 'state').map(entry => entry.status); }
function failure(result, code) { assert.equal(result.status, code === 'cancelled' ? 'cancelled' : 'failed'); assert.equal(result.error.code, code); }

test('RUDRA routes a single capability, snapshots results and emits correlated traces', async () => {
    const observed = [];
    const result = await new RudraOrchestrator(registry(), { onTrace: entry => { observed.push(entry); } }).run(context());
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.outputs, [{ stepId: 'step-1', botId: 'mock-reasoning', data: { numbers: [2, 3, 5], total: 10 } }]);
    assert.deepEqual(states(result), ['queued', 'running', 'completed']);
    assert.deepEqual(observed, result.trace);
    result.trace.forEach((entry, i) => {
        assert.equal(entry.taskId, 'task-1'); assert.equal(entry.sessionId, 'session-1'); assert.equal(entry.sequence, i + 1);
        assert.ok(entry.elapsedMs >= 0); assert.ok(Object.isFrozen(entry));
        assert.equal(entry.input, undefined); assert.equal(entry.data, undefined);
    });
    assert.ok(Object.isFrozen(result.outputs[0].data.numbers)); assert.ok(Object.isFrozen(result.trace));
});

test('RUDRA selection is ordinal bot ID order, independent of registration order', async () => {
    const a = { ...createMockReasoningBot(), id: 'a' }, z = { ...createMockReasoningBot(), id: 'z' };
    for (const bots of [[z, a], [a, z]]) {
        const registry = new BotRegistry(); bots.forEach(bot => registry.register(bot));
        const result = await new RudraOrchestrator(registry).run(context());
        assert.equal(result.outputs[0].botId, 'a');
    }
});

test('dependent bots run in order and aggregate all outputs', async () => {
    const result = await new RudraOrchestrator(registry(), { planner: planner(workflow()) }).run(context(), both);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.outputs.map(output => output.stepId), ['reason', 'review']);
    assert.deepEqual(result.outputs[1].data, { verified: true, total: 10 });
});

test('literal inputs and earlier dependencies work without template execution', async () => {
    const plan = workflow(); plan.steps[0].input = { source: 'literal', data: [10, 20] };
    const result = await new RudraOrchestrator(registry(), { planner: planner(plan) }).run(context(), both);
    assert.equal(result.outputs[1].data.total, 30);
});

test('missing capability and an invalid later route fail before any bot executes', async () => {
    let calls = 0;
    const bot = createMockReasoningBot(); bot.execute = () => { calls++; throw Error('should not run'); };
    const reg = new BotRegistry().register(bot);
    failure(await new RudraOrchestrator(reg).run(context({ capability: 'missing' })), 'missing-capability');
    failure(await new RudraOrchestrator(reg, { planner: planner(workflow()) }).run(context(), both), 'missing-capability');
    assert.equal(calls, 0);
});

test('planner capabilities are constrained by a host allowlist', async () => {
    let request;
    const rudra = new RudraOrchestrator(registry(), { planner: { plan(value) { request = value; return workflow(); } } });
    failure(await rudra.run(context()), 'capability-denied');
    assert.deepEqual(request.capabilities.map(capability => capability.id), ['mock.reason']);
    assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.capabilities));
    assert.equal(request.security, undefined);
});

test('malformed, cyclic, executable and privilege-changing model proposals are rejected', async () => {
    const cyclic = {}; cyclic.steps = cyclic;
    const badPlans = [null, {}, { steps: [] }, { steps: [step(), step()] },
        { steps: [step('first', 'mock.reason', { source: 'step', stepId: 'later' }), step('later')] },
        { steps: [step('self', 'mock.reason', { source: 'step', stepId: 'self' })] },
        { steps: [{ ...step(), botId: 'mock-reasoning' }] }, { steps: [step()], maxSteps: 999 },
        { steps: [step()], security: { toolPermissions: ['shell'] } },
        { steps: [step('literal', 'mock.reason', { source: 'literal' })] },
        { steps: [step('bad', 'mock.reason', { source: 'task', stepId: 'x' })] }, cyclic,
        { get steps() { throw Error('accessor executed'); } },
        { steps: [step('bad', 'mock.reason', { source: 'literal', data: () => true })] },
    ];
    for (const plan of badPlans) {
        failure(await new RudraOrchestrator(registry(), { planner: planner(plan) }).run(context(), both), 'invalid-plan');
    }
});

test('plan snapshots resist later mutation and registry changes cannot redirect a run', async () => {
    const reg = registry(); const proposed = workflow();
    const rudra = new RudraOrchestrator(reg, { planner: { plan() {
        reg.unregister('mock-reasoning'); reg.unregister('mock-review'); return proposed;
    } }, onTrace(entry) { if (entry.type === 'plan') proposed.steps.length = 0; } });
    const result = await rudra.run(context(), both);
    assert.equal(result.status, 'completed'); assert.equal(result.outputs.length, 2);
});

test('retries recover a bot error only with host opt-in and are visible in traces', async () => {
    const bot = createMockReasoningBot(); const execute = bot.execute; let calls = 0;
    bot.execute = function(...args) { if (++calls === 1) throw Error('secret'); return execute.apply(this, args); };
    const result = await new RudraOrchestrator(new BotRegistry().register(bot)).run(context(), { maxRetries: 1 });
    assert.equal(result.status, 'completed'); assert.equal(calls, 2);
    assert.equal(result.trace.filter(entry => entry.type === 'retry').length, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('default failures are not retried and retry exhaustion is bounded', async () => {
    let calls = 0; const bot = createMockReasoningBot(); bot.execute = () => { calls++; throw Error('private'); };
    const rudra = new RudraOrchestrator(new BotRegistry().register(bot));
    failure(await rudra.run(context()), 'bot-failed'); assert.equal(calls, 1);
    failure(await rudra.run(context(), { maxRetries: 2 }), 'bot-failed'); assert.equal(calls, 4);
});

test('input/output validation and tool denials are never retried', async () => {
    const invalid = createMockReasoningBot(); let calls = 0;
    invalid.execute = () => { calls++; return { taskId: 'wrong', botId: invalid.id, status: 'completed', data: {} }; };
    const rudra = new RudraOrchestrator(new BotRegistry().register(invalid));
    const input = await rudra.run(context({ data: 'bad' }), { maxRetries: 3 });
    failure(input, 'bot-failed'); assert.equal(calls, 0);
    assert.equal(input.trace.find(entry => entry.type === 'outcome').error.code, 'invalid-input');
    failure(await rudra.run(context(), { maxRetries: 3 }), 'bot-failed'); assert.equal(calls, 1);
    invalid.requiredTools = [{ id: 'shell', description: 'Denied fixture' }];
    const denied = await new RudraOrchestrator(new BotRegistry().register(invalid)).run(context(), { maxRetries: 3 });
    assert.equal(denied.trace.find(entry => entry.type === 'outcome').error.code, 'tool-not-allowed'); assert.equal(calls, 1);
});

test('max steps rejects oversized plans before dispatch and counts retries', async () => {
    failure(await new RudraOrchestrator(registry(), { planner: planner(workflow()) }).run(context(), { ...both, maxSteps: 1 }), 'max-steps');
    const bot = createMockReasoningBot(); let calls = 0; bot.execute = () => { calls++; throw Error(); };
    failure(await new RudraOrchestrator(new BotRegistry().register(bot)).run(context(), { maxSteps: 2, maxRetries: 3 }), 'max-steps');
    assert.equal(calls, 2);
});

test('successful partial outputs survive failure of a dependent step', async () => {
    const review = createMockReviewBot(); review.execute = () => { throw Error('private'); };
    const result = await new RudraOrchestrator(new BotRegistry().register(createMockReasoningBot()).register(review), {
        planner: planner(workflow()),
    }).run(context(), both);
    failure(result, 'bot-failed'); assert.deepEqual(result.outputs.map(output => output.stepId), ['reason']);
});

test('approval lifecycle is real, denied approvals prevent execution and cannot be truthy substitutes', async () => {
    for (const answer of [true, false, 'yes']) {
        const requests = [];
        const result = await new RudraOrchestrator(registry(), { approve(request) { requests.push(request); return answer; } }).run(context());
        assert.equal(requests.length, 1); assert.ok(Object.isFrozen(requests[0].input));
        if (answer === true) assert.deepEqual(states(result), ['queued', 'running', 'waiting_approval', 'running', 'completed']);
        else { failure(result, 'approval-denied'); assert.equal(result.trace.some(entry => entry.type === 'outcome'), false); }
    }
});

test('approval is repeated for retry attempts', async () => {
    const bot = createMockReasoningBot(); bot.execute = () => { throw Error(); };
    const attempts = [];
    failure(await new RudraOrchestrator(new BotRegistry().register(bot), { approve(request) {
        attempts.push(request.attempt); return request.attempt === 1;
    } }).run(context(), { maxRetries: 1 }), 'approval-denied');
    assert.deepEqual(attempts, [1, 2]);
});

test('child contexts preserve host identity and permissions and subtract approval time', async () => {
    const bot = createMockReasoningBot(), execute = bot.execute; let child;
    bot.execute = function(input, context) { child = context.task; return execute.call(this, input, context); };
    const original = context({ limits: { timeoutMs: 1000 }, permissions: ['bounded.read'] });
    const result = await new RudraOrchestrator(new BotRegistry().register(bot), {
        async approve() { await new Promise(resolve => setTimeout(resolve, 30)); return true; },
    }).run(original);
    assert.equal(result.status, 'completed'); assert.deepEqual(child.security, original.security);
    assert.equal(child.taskId, original.taskId); assert.equal(child.sessionId, original.sessionId);
    assert.ok(child.limits.timeoutMs <= 980); assert.ok(Object.isFrozen(child.security));
});

test('planner and approval errors are sanitized without executing bots', async () => {
    for (const [hooks, code] of [[{ planner: { plan() { throw Error('private planner'); } } }, 'planner-error'],
        [{ approve() { throw Error('private host'); } }, 'approval-error']]) {
        const result = await new RudraOrchestrator(registry(), hooks).run(context());
        failure(result, code); assert.equal(JSON.stringify(result).includes('private'), false);
    }
});

test('pre-cancelled tasks do not invoke the planner', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    failure(await new RudraOrchestrator(registry(), { planner: { plan() { calls++; return workflow(); } } })
        .run(context({ signal: controller.signal })), 'cancelled'); assert.equal(calls, 0);
});

for (const phase of ['planner', 'approval', 'bot']) {
    test(`cancellation during ${phase} retains ownership until actual settlement and ignores late output`, async () => {
        const gate = deferred(), entered = deferred(), controller = new AbortController();
        const bot = createMockReasoningBot(), execute = bot.execute;
        let hooks = {};
        if (phase === 'planner') hooks = { planner: { async plan() { entered.resolve(); await gate.promise; return { steps: [step()] }; } } };
        if (phase === 'approval') hooks = { async approve() { entered.resolve(); await gate.promise; return true; } };
        if (phase === 'bot') bot.execute = async function(...args) { entered.resolve(); await gate.promise; return execute.apply(this, args); };
        const rudra = new RudraOrchestrator(new BotRegistry().register(bot), hooks);
        const running = rudra.run(context({ signal: controller.signal }));
        await entered.promise; controller.abort();
        const result = await running; failure(result, 'cancelled');
        const snapshot = JSON.stringify(result);
        failure(await rudra.run(context()), 'busy');
        gate.resolve(); await flush(); await flush();
        assert.equal(JSON.stringify(result), snapshot);
        assert.equal((await rudra.run(context())).status, 'completed');
    });
}

test('deadline covers a hanging planner and prevents releasing its capacity early', async () => {
    const gate = deferred();
    const rudra = new RudraOrchestrator(registry(), { planner: { plan: () => gate.promise } });
    failure(await rudra.run(context({ limits: { timeoutMs: 20 } })), 'timeout');
    failure(await rudra.run(context()), 'busy'); gate.resolve({ steps: [step()] }); await flush();
    assert.equal((await rudra.run(context())).status, 'completed');
});

test('deadline covers approval waiting and execution without resetting the workflow budget', async () => {
    const gate = deferred();
    const rudra = new RudraOrchestrator(registry(), { approve: () => gate.promise });
    failure(await rudra.run(context({ limits: { timeoutMs: 20 } })), 'timeout');
    gate.resolve(true); await flush();
    const bot = createMockReasoningBot(), execute = bot.execute;
    bot.execute = async function(...args) { await new Promise(resolve => setTimeout(resolve, 30)); return execute.apply(this, args); };
    const result = await new RudraOrchestrator(new BotRegistry().register(bot)).run(context({ limits: { timeoutMs: 10 } }));
    failure(result, 'timeout'); assert.equal(result.outputs.length, 0);
});

test('monotonic deadline rejects synchronous work finishing after the limit', async () => {
    const bot = createMockReasoningBot(), execute = bot.execute;
    bot.execute = function(...args) { const until = performance.now() + 25; while (performance.now() < until) {} return execute.apply(this, args); };
    const original = Date.now; Date.now = () => 1;
    try { failure(await new RudraOrchestrator(new BotRegistry().register(bot)).run(context({ limits: { timeoutMs: 10 } })), 'timeout'); }
    finally { Date.now = original; }
});

test('dispose cancels active work and stops future admission', async () => {
    const gate = deferred(), entered = deferred();
    const rudra = new RudraOrchestrator(registry(), { async approve() { entered.resolve(); return gate.promise; } });
    const running = rudra.run(context()); await entered.promise; rudra.dispose(); rudra.dispose();
    failure(await running, 'cancelled'); failure(await rudra.run(context()), 'disposed'); gate.resolve(true);
});

test('observer reentry cannot bypass capacity and observer failures do not change results', async () => {
    let nested, once = false, rudra;
    rudra = new RudraOrchestrator(registry(), { onTrace(entry) {
        if (!once) { once = true; nested = rudra.run(context()); }
        if (entry.type === 'outcome') throw Error('observer');
        return Promise.reject(Error('observer rejection'));
    } });
    assert.equal((await rudra.run(context())).status, 'completed'); failure(await nested, 'busy');
});

test('aggregate output budget includes all successful steps and preserves bounded partial outputs', async () => {
    const plan = { steps: [step('one'), step('two')] };
    const result = await new RudraOrchestrator(registry(), { planner: planner(plan) })
        .run(context({ limits: { maxOutputBytes: 125 } }));
    failure(result, 'output-limit'); assert.equal(result.outputs.length, 1);
    assert.ok(new TextEncoder().encode(JSON.stringify(result.outputs)).length <= 125);
});

test('oversized proposals and resolved dependent inputs fail safely', async () => {
    const plan = { steps: [step('literal', 'mock.reason', { source: 'literal', data: 'x'.repeat(1000) })] };
    failure(await new RudraOrchestrator(registry(), { planner: planner(plan) }).run(context({ limits: { maxInputBytes: 256 } })), 'invalid-plan');
    const bot = createMockReasoningBot(); bot.validateOutput = () => true;
    bot.execute = function(input, ctx) { return { taskId: ctx.task.taskId, botId: this.id, status: 'completed', data: 'x'.repeat(500) }; };
    const result = await new RudraOrchestrator(new BotRegistry().register(bot).register(createMockReviewBot()), { planner: planner(workflow()) })
        .run(context({ limits: { maxInputBytes: 256 } }), both);
    failure(result, 'bot-failed'); assert.equal(result.outputs.length, 1);
    assert.equal(result.trace.filter(entry => entry.type === 'outcome').length, 2);
    assert.equal(result.trace.find(entry => entry.outcome === 'failed').error.code, 'invalid-input');
    assert.equal(result.trace.at(-1).stepId, 'review');
});

test('total deadline includes planning time before bot execution', async () => {
    const bot = createMockReasoningBot(), execute = bot.execute;
    const burn = ms => { const until = performance.now() + ms; while (performance.now() < until) {} };
    bot.execute = function(...args) { burn(30); return execute.apply(this, args); };
    const result = await new RudraOrchestrator(new BotRegistry().register(bot), {
        planner: { plan() { burn(30); return { steps: [step()] }; } },
    }).run(context({ limits: { timeoutMs: 50 } }));
    failure(result, 'timeout'); assert.equal(result.outputs.length, 0);
});

test('cancellation between dependent steps prevents subsequent dispatch', async () => {
    const controller = new AbortController(); let calls = 0;
    const review = createMockReviewBot(); review.execute = () => { calls++; throw Error(); };
    const result = await new RudraOrchestrator(new BotRegistry().register(createMockReasoningBot()).register(review), {
        planner: planner(workflow()), onTrace(entry) { if (entry.type === 'selection' && entry.stepId === 'review') controller.abort(); },
    }).run(context({ signal: controller.signal }), both);
    failure(result, 'cancelled'); assert.equal(calls, 0); assert.equal(result.outputs.length, 1);
});

test('invalid host limits and context reject before callbacks', async () => {
    let calls = 0; const rudra = new RudraOrchestrator(registry(), { onTrace() { calls++; } });
    for (const options of [{ maxSteps: 0 }, { maxSteps: 101 }, { maxRetries: 4 }, { maxRetries: -1 },
        { allowedCapabilities: ['mock.reason', 'mock.reason'] }, { timeoutMs: Infinity }]) {
        await assert.rejects(rudra.run(context(), options), error => error instanceof RudraError && error.code === 'invalid-options');
    }
    await assert.rejects(rudra.run({}), error => error.code === 'invalid-context'); assert.equal(calls, 0);
});

test('mock review checks evidence and reports a wrong sum honestly', async () => {
    const result = await new RudraOrchestrator(registry()).run(context({ capability: 'mock.review', data: { numbers: [2, 3], total: 999 } }));
    assert.equal(result.status, 'completed'); assert.deepEqual(result.outputs[0].data, { verified: false, total: 999 });
});
