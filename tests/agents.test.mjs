import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BotRegistry, BotExecutor, BotEventEmitter, BotError, createTaskContext,
    validateBotInput, validateBotResult, DEFAULT_EXECUTION_LIMITS,
} from 'shivax';
import { createEchoBot, createSumBot } from './fixtures/mock-bots.mjs';

const security = () => ({ caller: { id: 'user-7', issuer: 'trusted-test-host' },
    scope: { kind: 'personal', id: 'workspace-7' }, toolPermissions: [] });
function host(overrides = {}) {
    return { sessionId: 'session-7', security: security(), signal: new AbortController().signal, ...overrides };
}
function context(data = 'hello', options = {}, capability = 'mock.echo', id = 'task-7') {
    return createTaskContext({ id, input: { capability, data } }, host(options));
}
const hasCode = code => error => error instanceof BotError && error.code === code;
function failure(code) { return { code, message: new BotError(code).message }; }
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('registry registers/removes bots, rejects duplicates atomically and returns defensive lists', () => {
    const registry = new BotRegistry(), echo = createEchoBot(), events = [];
    registry.events.on('bot:registered', event => events.push(['add', event.botId]));
    registry.events.on('bot:unregistered', event => events.push(['remove', event.botId]));
    assert.equal(registry.register(echo), registry);
    const registered = registry.get(echo.id);
    assert.ok(Object.isFrozen(registered));
    assert.deepEqual(registry.list().map(bot => bot.id), ['mock.echo']);
    assert.throws(() => registry.list().pop(), TypeError);
    assert.throws(() => registry.register(createEchoBot()), hasCode('duplicate-bot'));
    assert.equal(registry.get(echo.id), registered);
    assert.equal(registry.unregister(echo.id), true);
    assert.equal(registry.unregister(echo.id), false);
    assert.equal(registry.get(echo.id), undefined);
    assert.deepEqual(registry.list(), []);
    assert.deepEqual(events, [['add', 'mock.echo'], ['remove', 'mock.echo']]);
});

test('capability discovery returns all matching bots without automatic selection or stale entries', () => {
    const registry = new BotRegistry();
    const echo = createEchoBot(), alternate = createEchoBot('mock.alternate');
    registry.register(echo).register(createSumBot()).register(alternate);
    echo.capabilities[0].id = 'mutated';
    echo.capabilities.push({ id: 'extra', description: 'Not registered.' });
    assert.deepEqual(registry.findByCapability('mock.echo').map(bot => bot.id), ['mock.echo', 'mock.alternate']);
    assert.deepEqual(registry.listCapabilities().map(capability => capability.id), ['mock.echo', 'mock.sum']);
    assert.deepEqual(registry.findByCapability('unknown'), []);
    registry.unregister('mock.echo'); registry.unregister('mock.alternate');
    assert.deepEqual(registry.findByCapability('mock.echo'), []);
    assert.deepEqual(registry.listCapabilities().map(capability => capability.id), ['mock.sum']);
    assert.deepEqual(new BotRegistry().listCapabilities(), []);
});

test('registry rejects missing implementations, malformed/duplicate descriptors and invalid IDs', () => {
    const registry = new BotRegistry();
    for (const bot of [null, {}, { ...createEchoBot(), id: '' }, { ...createEchoBot(), execute: undefined },
        { ...createEchoBot(), capabilities: [] }, { ...createEchoBot(), capabilities: [{ id: 'x', description: '' }, { id: 'x', description: '' }] },
        { ...createEchoBot(), requiredTools: null }]) {
        assert.throws(() => registry.register(bot), hasCode('invalid-bot'));
    }
    assert.deepEqual(registry.list(), []);
    assert.throws(() => registry.get(''), hasCode('invalid-bot'));
    assert.throws(() => registry.unregister(''), hasCode('invalid-bot'));
    assert.throws(() => registry.findByCapability(''), hasCode('invalid-input'));
});

test('two explicit mock bots execute real fixture computations after caller capability selection', async () => {
    const registry = new BotRegistry(), echo = createEchoBot(), sum = createSumBot();
    registry.register(echo).register(sum);
    const executor = new BotExecutor();
    const echoResult = await executor.execute(registry.findByCapability('mock.echo')[0], context('Shivax'));
    const sumResult = await executor.execute(registry.findByCapability('mock.sum')[0], context([2, -3, 7.5], {}, 'mock.sum'));
    assert.deepEqual(echoResult, { taskId: 'task-7', botId: 'mock.echo', status: 'completed', data: 'SHIVAX' });
    assert.equal(sumResult.data, 6.5);
    assert.equal(echo.calls, 1); assert.equal(sum.calls, 1); // Bound methods keep original owner.
    assert.ok(Object.isFrozen(echoResult));
});

test('context snapshots request and host metadata separately and freezes caller, permissions and data', () => {
    const task = { id: 'task-7', input: { capability: 'mock.sum', data: [1, 2] }, metadata: { caller: 'untrusted text' } };
    const options = host(), created = createTaskContext(task, options);
    task.input.data[0] = 99; task.metadata.caller = 'changed'; options.security.caller.id = 'changed';
    options.security.toolPermissions.push('shell');
    assert.deepEqual(created.input.data, [1, 2]);
    assert.equal(created.metadata.caller, 'untrusted text');
    assert.equal(created.security.caller.id, 'user-7');
    assert.deepEqual(created.security.toolPermissions, []);
    assert.equal(created.signal, options.signal);
    assert.equal(created.version, 1);
    assert.deepEqual(created.limits, DEFAULT_EXECUTION_LIMITS);
    assert.throws(() => { created.security.scope.id = 'changed'; }, TypeError);
    assert.throws(() => created.input.data.push(3), TypeError);
    assert.throws(() => createTaskContext({ ...task, security: options.security }, options), hasCode('invalid-input'));
    assert.throws(() => createTaskContext({ ...task, version: 2 }, options), hasCode('invalid-input'));
});

test('task input rejects executable/malformed data without invoking getters or JSON hooks', () => {
    let invoked = 0;
    const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { invoked++; return 1; } });
    const cycle = {}; cycle.self = cycle;
    const sparse = Array(2); sparse[1] = 3;
    for (const data of [undefined, NaN, Infinity, 1n, () => 1, new Date(), cycle, sparse, getter,
        { toJSON() { invoked++; return 'fake'; } }, { [Symbol('hidden')]: 1 }]) {
        assert.throws(() => createTaskContext({ id: 't', input: { capability: 'mock.echo', data } }, host()), hasCode('invalid-input'));
    }
    assert.equal(invoked, 0);
    assert.throws(() => validateBotInput({ capability: 'mock.echo' }), hasCode('invalid-input'));
    assert.throws(() => validateBotInput({ capability: 'mock.echo', data: 'ok', security: {} }), hasCode('invalid-input'));
    assert.throws(() => context('x'.repeat(80), { limits: { maxInputBytes: 64 } }), hasCode('invalid-input'));
    assert.throws(() => createTaskContext({ id: 't', input: { capability: 'c', data: null }, metadata: { huge: 'x'.repeat(16_384) } }, host()), hasCode('invalid-input'));
    let deep = null;
    for (let i = 0; i < 34; i++) deep = [deep];
    assert.throws(() => context(deep), hasCode('invalid-input'));
});

test('context validates identity, session, scope, permissions, signal and finite execution limits', () => {
    for (const options of [host({ sessionId: '' }), host({ security: {} }), host({ signal: {} }),
        host({ security: { ...security(), scope: { kind: 'unknown', id: 'x' } } }),
        host({ security: { ...security(), toolPermissions: ['duplicate', 'duplicate'] } }),
        host({ limits: { timeoutMs: 0 } }), host({ limits: { timeoutMs: Infinity } }),
        host({ limits: { timeoutMs: 300_001 } }), host({ limits: { maxOutputBytes: 1_048_577 } }),
        host({ limits: { extra: 1 } }), host({ limits: null })]) {
        assert.throws(() => createTaskContext({ id: 't', input: { capability: 'mock.echo', data: 'ok' } }, options), hasCode('invalid-context'));
    }
});

test('undefined optional execution limits retain defaults while invalid values still fail', () => {
    const limits = { timeoutMs: undefined, maxInputBytes: undefined, maxOutputBytes: undefined };
    assert.deepEqual(context('x', { limits }).limits, DEFAULT_EXECUTION_LIMITS);
    assert.deepEqual(context('x', { limits: { ...limits, maxOutputBytes: 512 } }).limits,
        { ...DEFAULT_EXECUTION_LIMITS, maxOutputBytes: 512 });
    assert.throws(() => context('x', { limits: { timeoutMs: null } }), hasCode('invalid-context'));
    assert.throws(() => context('x', { limits: { extra: undefined } }), hasCode('invalid-context'));
});

test('input predicates fail closed without starting or invoking a bot', async () => {
    const bot = createSumBot(), executor = new BotExecutor(), events = [];
    executor.events.on('bot:started', () => events.push('started'));
    executor.events.on('bot:failed', event => events.push(event.error.code));
    const result = await executor.execute(bot, context('not numbers', {}, 'mock.sum'));
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'invalid-input');
    assert.equal(bot.calls, 0); assert.deepEqual(events, ['invalid-input']);
    const retry = await executor.execute(bot, context([2, 3], {}, 'mock.sum'));
    assert.equal(retry.data, 5); assert.equal(bot.calls, 1);
    for (const validateInput of [() => { throw new Error('private input'); }, () => ({ truthy: true })]) {
        const invalid = await executor.execute({ ...createEchoBot(), validateInput }, context());
        assert.equal(invalid.error.code, 'invalid-input');
    }
});

test('unsupported capabilities and missing host tool grants fail before bot execution', async () => {
    const bot = createEchoBot(), executor = new BotExecutor();
    assert.equal((await executor.execute(bot, context('x', {}, 'unknown'))).error.code, 'unsupported-capability');
    bot.requiredTools = [{ id: 'demo.read', description: 'Descriptor only, no executable tool.' }];
    assert.equal((await executor.execute(bot, context())).error.code, 'tool-not-allowed');
    assert.equal(bot.calls, 0);
    const allowed = await executor.execute(bot, context('ok', { security: { ...security(), toolPermissions: ['demo.read'] } }));
    assert.equal(allowed.data, 'OK'); assert.equal(bot.calls, 1);
});

test('malformed host contexts reject the execution call before any lifecycle dispatch', async () => {
    const executor = new BotExecutor();
    executor.events.on('bot:started', () => assert.fail('Must not start'));
    await assert.rejects(executor.execute(createEchoBot(), {}), hasCode('invalid-context'));
    await assert.rejects(executor.execute({}, context()), hasCode('invalid-bot'));
});

test('bot exceptions propagate as structured sanitized errors, preserving recognized error codes', async () => {
    const executor = new BotExecutor();
    for (const thrown of [new Error('secret token/payload'), 'secret token/payload',
        Object.assign(new BotError('bot-error'), { code: 'secret token/payload' })]) {
        const result = await executor.execute({ ...createEchoBot(), execute() { throw thrown; } }, context());
        assert.deepEqual(result.error, failure('bot-error'));
        assert.ok(!JSON.stringify(result).includes('secret'));
    }
    const result = await executor.execute({ ...createEchoBot(), async execute() { throw new BotError('unsupported-capability'); } }, context());
    assert.equal(result.error.code, 'unsupported-capability');
    assert.throws(() => new BotError('unknown'), TypeError);
});

test('result validation rejects malformed envelopes and status/error inconsistencies', () => {
    const base = { taskId: 'task-7', botId: 'mock.echo', status: 'completed', data: null };
    validateBotResult(base);
    for (const result of [{ ...base, status: 'success' }, { ...base, data: NaN }, { ...base, error: failure('bot-error') },
        { ...base, extra: true }, { taskId: 'task-7', botId: 'mock.echo', status: 'completed' },
        { taskId: 'task-7', botId: 'mock.echo', status: 'cancelled', error: failure('bot-error') },
        { taskId: 'task-7', botId: 'mock.echo', status: 'failed', error: { code: 'bot-error', message: 'secret' } }]) {
        assert.throws(() => validateBotResult(result), hasCode('invalid-output'));
    }
});

test('executor checks output semantics, budgets and bot/task correlation before completion', async () => {
    const executor = new BotExecutor(), completed = [];
    executor.events.on('bot:completed', event => completed.push(event));
    for (const change of [{ data: 42 }, { taskId: 'other-task' }, { botId: 'other-bot' },
        { data: 'x'.repeat(300) }, { data: undefined }, { data: Infinity }]) {
        const bot = { ...createEchoBot(), execute() {
            return { taskId: 'task-7', botId: 'mock.echo', status: 'completed', data: 'OK', ...change };
        } };
        const result = await executor.execute(bot, context('ok', { limits: { maxOutputBytes: 256 } }));
        assert.equal(result.error.code, 'invalid-output');
    }
    const result = await executor.execute({ ...createEchoBot(), validateOutput() { throw new Error('secret'); } }, context());
    assert.equal(result.error.code, 'invalid-output'); assert.deepEqual(completed, []);
});

test('validated failed/cancelled/timed-out bot results retain structured status without fake success', async () => {
    for (const [status, code] of [['failed', 'bot-error'], ['cancelled', 'cancelled'], ['timed-out', 'timeout']]) {
        const result = await new BotExecutor().execute({ ...createEchoBot(), execute() {
            return { taskId: 'task-7', botId: 'mock.echo', status, error: failure(code) };
        } }, context());
        assert.equal(result.status, status); assert.deepEqual(result.error, failure(code));
    }
});

test('lifecycle events report registration, execution and removal in order without task payloads', async () => {
    const events = new BotEventEmitter(), recorded = [], registry = new BotRegistry(events), executor = new BotExecutor(events);
    for (const type of ['bot:registered', 'bot:started', 'bot:completed', 'bot:unregistered']) {
        events.on(type, value => { recorded.push([type, value]); });
    }
    registry.register(createEchoBot());
    await executor.execute(registry.get('mock.echo'), context('private-content'));
    registry.unregister('mock.echo');
    assert.deepEqual(recorded.map(([type]) => type), ['bot:registered', 'bot:started', 'bot:completed', 'bot:unregistered']);
    assert.deepEqual(recorded[1][1], { botId: 'mock.echo', taskId: 'task-7', sessionId: 'session-7' });
    assert.ok(recorded.every(([, event]) => Object.isFrozen(event)));
    assert.ok(!JSON.stringify(recorded).includes('private-content'));
});

test('event subscriptions support removal, clear, isolated instances and runtime shape validation', () => {
    const events = new BotEventEmitter(), other = new BotEventEmitter(), seen = [];
    const listener = value => { seen.push(value.botId); };
    const off = events.on('bot:registered', listener);
    events.emit('bot:registered', { botId: 'one' }); off(); off();
    events.emit('bot:registered', { botId: 'two' });
    events.on('bot:registered', listener); events.off('bot:registered', listener);
    events.emit('bot:registered', { botId: 'three' });
    events.on('bot:registered', listener); events.clear();
    other.emit('bot:registered', { botId: 'other' });
    events.emit('bot:registered', { botId: 'four' });
    assert.deepEqual(seen, ['one']);
    assert.throws(() => events.on('unknown', listener), hasCode('invalid-event'));
    assert.throws(() => events.emit('bot:started', { botId: 'one' }), hasCode('invalid-event'));
    assert.throws(() => events.emit('bot:registered', { botId: 'one', data: 'payload' }), hasCode('invalid-event'));
});

test('synchronous and async observer failures are reported without corrupting execution outcomes', async () => {
    const errors = [], events = new BotEventEmitter((error, type) => { errors.push([error.message, type]); });
    events.on('bot:started', () => { throw new Error('sync observer'); });
    events.on('bot:completed', async () => { throw new Error('async observer'); });
    assert.equal((await new BotExecutor(events).execute(createEchoBot(), context())).status, 'completed');
    await turn();
    assert.deepEqual(errors, [['sync observer', 'bot:started'], ['async observer', 'bot:completed']]);
    const brokenObserver = new BotEventEmitter(async () => { throw new Error('observer handler failed'); });
    brokenObserver.on('bot:registered', () => { throw new Error('listener failed'); });
    new BotRegistry(brokenObserver).register(createEchoBot());
    await turn();
});

test('pre-cancellation invokes no validators/implementation and produces one sanitized terminal event', async () => {
    const controller = new AbortController(); controller.abort(new Error('private abort reason'));
    const events = new BotEventEmitter(), terminal = [], bot = createEchoBot();
    bot.validateInput = () => assert.fail('Must not validate after pre-cancellation');
    events.on('bot:started', () => assert.fail('Must not start'));
    events.on('bot:cancelled', event => terminal.push(event));
    const result = await new BotExecutor(events).execute(bot, context('x', { signal: controller.signal }));
    assert.equal(result.status, 'cancelled'); assert.equal(bot.calls, 0);
    assert.deepEqual(result.error, failure('cancelled')); assert.equal(terminal.length, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
});

test('cancellation reaches the bot signal and keeps it busy until asynchronous cleanup settles', async () => {
    const controller = new AbortController(), entered = deferred(), cleanup = deferred();
    let aborted = false, calls = 0;
    const bot = { ...createEchoBot(), async execute(input, ctx) {
        calls++; entered.resolve();
        await new Promise(resolve => ctx.task.signal.addEventListener('abort', resolve, { once: true }));
        aborted = ctx.task.signal.aborted;
        await cleanup.promise;
        throw new Error('late failure');
    } };
    const executor = new BotExecutor(), events = [];
    executor.events.on('bot:completed', () => events.push('completed'));
    executor.events.on('bot:cancelled', () => events.push('cancelled'));
    const running = executor.execute(bot, context('x', { signal: controller.signal }));
    await entered.promise; controller.abort('private abort');
    assert.equal((await running).status, 'cancelled'); assert.equal(aborted, true);
    assert.equal((await executor.execute(bot, context())).error.code, 'busy');
    cleanup.resolve(); await turn();
    assert.equal(calls, 1); assert.deepEqual(events, ['cancelled']);
});

test('deadline bounds the caller wait; late results cannot complete or free a busy bot prematurely', async () => {
    const late = deferred(), entered = deferred();
    let calls = 0, outputChecks = 0;
    const bot = { ...createEchoBot(), async execute(input, ctx) {
        calls++; entered.resolve();
        if (calls === 1) await late.promise; // Deliberately ignores cancellation.
        return { taskId: ctx.task.taskId, botId: 'mock.echo', status: 'completed', data: input.data };
    }, validateOutput(data) { outputChecks++; return typeof data === 'string'; } };
    const executor = new BotExecutor(), completed = [];
    executor.events.on('bot:completed', event => completed.push(event));
    const pending = executor.execute(bot, context('x', { limits: { timeoutMs: 15 } }));
    await entered.promise;
    assert.equal((await pending).status, 'timed-out');
    assert.equal((await executor.execute(bot, context())).error.code, 'busy');
    late.resolve(); await turn();
    assert.equal(outputChecks, 0); assert.deepEqual(completed, []);
    assert.equal((await executor.execute(bot, context('second'))).data, 'second');
    assert.equal(outputChecks, 1); assert.equal(completed.length, 1);
});

test('cancellation from a start observer prevents the implementation from running and releases its slot', async () => {
    const controller = new AbortController(), bot = createEchoBot(), executor = new BotExecutor();
    const off = executor.events.on('bot:started', () => controller.abort());
    const result = await executor.execute(bot, context('x', { signal: controller.signal }));
    assert.equal(result.status, 'cancelled'); assert.equal(bot.calls, 0);
    off();
    assert.equal((await executor.execute(bot, context())).status, 'completed');
});

test('bot cancellation during validation wins over subsequent validator errors', async () => {
    const controller = new AbortController(), bot = createEchoBot();
    bot.validateInput = () => { controller.abort(); throw new Error('private validator'); };
    const result = await new BotExecutor().execute(bot, context('x', { signal: controller.signal }));
    assert.equal(result.status, 'cancelled'); assert.equal(bot.calls, 0);
});

test('settled execution removes its external abort listener and execution stays instance-local', async () => {
    const controller = new AbortController();
    let added = 0, removed = 0;
    const signal = {
        get aborted() { return controller.signal.aborted; },
        get reason() { return controller.signal.reason; },
        throwIfAborted() { controller.signal.throwIfAborted(); },
        addEventListener(...args) { added++; controller.signal.addEventListener(...args); },
        removeEventListener(...args) { removed++; controller.signal.removeEventListener(...args); },
    };
    const bot = createEchoBot();
    assert.equal((await new BotExecutor().execute(bot, context('ok', { signal }))).data, 'OK');
    assert.equal(added, 1); assert.equal(removed, 1);
    controller.abort();
    assert.equal((await new BotExecutor().execute(bot, context())).status, 'completed');
});

test('accidental async validators fail closed and their rejected promises are observed', async () => {
    const executor = new BotExecutor();
    for (const validateInput of [async () => true, async () => { throw new Error('private async validator'); }]) {
        const result = await executor.execute({ ...createEchoBot(), validateInput }, context());
        assert.equal(result.error.code, 'invalid-input');
    }
    const result = await executor.execute({ ...createEchoBot(), async validateOutput() { throw new Error('private output validator'); } }, context());
    assert.equal(result.error.code, 'invalid-output');
    await turn();
});

test('JSON snapshots preserve prototype-like keys as data without pollution or executable accessors', () => {
    const data = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data","toString":"data"}');
    const task = context(data);
    assert.equal(Object.getPrototypeOf(task.input.data), Object.prototype);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(task.input.data.__proto__.polluted, true);
    const result = { taskId: 'task-7', botId: 'mock.echo', status: 'completed', data };
    validateBotResult(result);
    let invoked = false;
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
    assert.throws(() => validateBotResult({ ...result, data: accessor }), hasCode('invalid-output'));
    assert.equal(invoked, false);
});

test('a faulty host signal adapter fails safely before invoking the bot', async () => {
    let cleaned = false;
    const signal = { aborted: false, reason: undefined, throwIfAborted() {},
        addEventListener() { throw new Error('private host error'); },
        removeEventListener() { cleaned = true; },
    };
    const bot = createEchoBot();
    const result = await new BotExecutor().execute(bot, context('x', { signal }));
    assert.equal(result.status, 'failed'); assert.deepEqual(result.error, failure('bot-error'));
    assert.equal(bot.calls, 0); assert.equal(cleaned, true);
});

test('snapshots reject non-enumerable fields instead of dropping validated data or identity', () => {
    const hide = (value, key) => Object.defineProperty(value, key, { enumerable: false });
    for (const key of ['capability', 'data']) {
        assert.throws(() => validateBotInput(hide({ capability: 'mock.echo', data: 'text' }, key)), hasCode('invalid-input'));
    }
    for (const key of ['botId', 'taskId', 'status', 'data']) {
        assert.throws(() => validateBotResult(hide({ botId: 'b', taskId: 't', status: 'completed', data: null }, key)), hasCode('invalid-output'));
    }
    const options = host(); options.security.caller = hide(options.security.caller, 'id');
    assert.throws(() => createTaskContext({ id: 't', input: { capability: 'mock.echo', data: 'x' } }, options), hasCode('invalid-context'));
    assert.throws(() => createTaskContext({ id: 't', input: { capability: 'mock.echo', data: 'x' }, metadata: hide({ note: 'lost' }, 'note') }, host()), hasCode('invalid-input'));
});

test('input-validator reentry cannot start a second execution or release another operation slot', async () => {
    const executor = new BotExecutor(), release = deferred(), entered = deferred();
    let nested, reentered = false, calls = 0;
    const bot = { ...createEchoBot(), validateInput(input) {
        if (!reentered) { reentered = true; nested = executor.execute(bot, context('nested')); }
        return typeof input.data === 'string';
    }, async execute(input, ctx) {
        calls++;
        if (input.data === 'outer') { entered.resolve(); await release.promise; }
        return { taskId: ctx.task.taskId, botId: 'mock.echo', status: 'completed', data: input.data };
    } };
    const outer = executor.execute(bot, context('outer'));
    let nestedResult, thirdResult;
    try {
        await entered.promise;
        nestedResult = await nested;
        thirdResult = await executor.execute(bot, context('third'));
    } finally { release.resolve(); await outer; }
    assert.equal(nestedResult.error?.code, 'busy');
    assert.equal(thirdResult.error?.code, 'busy');
    assert.equal(calls, 1);
    assert.equal((await executor.execute(bot, context('reusable'))).status, 'completed');
});

test('execution deadlines survive a stopped or adjusted wall clock', async () => {
    const wallClock = Date.now;
    const fixedTime = wallClock();
    let outputChecks = 0, result;
    const bot = { ...createEchoBot(), execute(input, ctx) {
        const stop = performance.now() + 15;
        while (performance.now() < stop) { /* Deliberately synchronous work; timer cannot run yet. */ }
        return { taskId: ctx.task.taskId, botId: 'mock.echo', status: 'completed', data: input.data };
    }, validateOutput() { outputChecks++; return true; } };
    try {
        Date.now = () => fixedTime;
        result = await new BotExecutor().execute(bot, context('text', { limits: { timeoutMs: 3 } }));
    } finally { Date.now = wallClock; }
    assert.equal(result.status, 'timed-out');
    assert.equal(outputChecks, 0);
});

test('lifecycle error events reject codes inconsistent with their terminal status', () => {
    const events = new BotEventEmitter();
    const identity = { botId: 'b', taskId: 't', sessionId: 's' };
    for (const [type, code] of [['bot:failed', 'cancelled'], ['bot:failed', 'timeout'],
        ['bot:cancelled', 'bot-error'], ['bot:cancelled', 'timeout'], ['bot:timed-out', 'cancelled']]) {
        assert.throws(() => events.emit(type, { ...identity, error: failure(code) }), hasCode('invalid-event'));
    }
    events.emit('bot:failed', { ...identity, error: failure('bot-error') });
    events.emit('bot:cancelled', { ...identity, error: failure('cancelled') });
    events.emit('bot:timed-out', { ...identity, error: failure('timeout') });
});
