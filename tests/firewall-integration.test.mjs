import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as esm from 'shivax';
const require = createRequire(import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const action = (id = 'a') => ({ id, capability: 'work', input: { source: 'task' } });
const plan = (...actions) => ({ actions });
const metadata = (id, kind, capability, extra = {}) => ({ id, kind, capability, effect: 'read-only',
    files: { read: [], write: [] }, networkOrigins: [], check: () => true,
    ...(kind === 'tool' ? {} : { execute() { throw new Error('boundary registration'); } }), ...extra });

async function fixture(api, options = {}) {
    const identity = { principal: { id: 'user', issuer: 'host', permissions: ['work', 'admin'] },
        session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10000,
            scope: { kind: 'company', id: 'tenant' } } };
    let valid = true, calls = 0, botCalls = 0, time = 2000;
    const jay = new api.Jay({ authenticate: () => identity, isSessionValid: () => valid }, { now: () => time });
    const policies = new api.PermissionPolicyRegistry();
    const effect = options.effect ?? 'read-only';
    for (const [kind, id, value] of [['capability', 'workflow', 'read-only'], ['capability', 'work', effect],
        ['tool', 'read', effect], ['tool', 'other', 'read-only'], ['capability', 'firewall.admin', 'state-changing']])
        policies.register({ kind, id, effect: value, permissions: [id === 'firewall.admin' ? 'admin' : 'work'], validateInput: () => true });
    const tools = new api.ToolRegistry();
    tools.register({ id: 'read', capability: 'work', effect, parallelSafe: effect === 'read-only',
        validateInput: () => true, validateOutput: () => true,
        execute: async (input, context) => { calls++; return options.handler ? options.handler(input, context) : input; } });
    tools.protectedTools.register({ id: 'other', validateInput: () => true, validateOutput: () => true, execute: () => { throw new Error('must not execute'); } });
    const security = new api.Vijay(jay, policies, { tools: tools.protectedTools, approve: options.approve ?? (() => true) });
    const bot = options.bot ?? { id: 'worker', capabilities: [{ id: 'work', description: 'fixture' }],
        requiredTools: [{ id: 'read', description: 'scoped read' }], validateInput: () => true, validateOutput: () => true,
        execute: async (input, context) => { botCalls++;
            const data = options.botExecute ? await options.botExecute(input, context) : await context.tools.execute('read', input.data);
            return { taskId: context.task.taskId, botId: 'worker', status: 'completed', data };
        } };
    const capability = options.capability ?? bot.capabilities[0].id;
    if (capability !== 'work') policies.register({ kind: 'capability', id: capability, effect: 'read-only', permissions: ['work'], validateInput: () => true });
    const operations = [metadata('task', 'workflow', 'workflow'),
        metadata('bot', 'bot', capability, { botId: bot.id, effect }),
        metadata('tool', 'tool', 'work', { toolId: 'read', effect }), ...(options.extra ?? [])];
    const policy = { mode: 'enforce', rules: [{ id: 'allow', decision: 'allow', operationIds: operations.map(op => op.id) }],
        capabilities: ['workflow', 'work', ...(capability === 'work' ? [] : [capability])],
        bots: options.noBot ? [] : [bot.id], providers: { ids: [], localities: [] },
        files: { read: [], write: [] }, network: { origins: [] },
        limits: { maxConcurrent: 32, maxOperations: 1000, maxTokens: 0, maxCostUSD: 0,
            timeoutMs: 3000, maxInputBytes: 65536, maxOutputBytes: 65536 }, audit: { required: false } };
    const config = { jay, security, realm: { issuer: 'host', scope: identity.session.scope }, operations, policy,
        adminCapability: 'firewall.admin', authorizeAdmin: () => true, protectExecution: true };
    const firewall = api.createShivaxFirewall(config);
    const controller = new AbortController();
    const context = await jay.createContext({ id: 'task', input: { capability: 'workflow', data: options.data ?? 2 } },
        { signal: controller.signal, toolPermissions: ['read', 'other'] });
    const rudra = new api.RudraOrchestrator(new api.BotRegistry().register(bot), { security,
        planner: options.planner ?? { plan: () => ({ steps: [{ id: 'one', capability, input: { source: 'task' } }] }) } });
    const engine = new api.RudraWorkflowEngine(tools, security);
    return { ...firewall, config, jay, security, policies, tools, context, controller, rudra, engine, identity,
        calls: () => calls, botCalls: () => botCalls, setTime: value => { time = value; }, revoke: () => { valid = false; },
        run: (proposal = plan(action()), settings = {}) => engine.start(context, proposal, { allowedCapabilities: ['work'], ...settings }),
        botRun: (settings = {}) => rudra.run(context, { allowedCapabilities: [capability], ...settings }),
        update: next => firewall.admin.replace(context, firewall.runtime.snapshot().version, next) };
}
for (const [format, api] of [['ESM', esm], ['CommonJS', require('shivax')]]) {
    const check = (name, fn) => test(format + ': integrated firewall ' + name, fn);
    check('allowed RUDRA tools and read-only workflows execute with existing traces', async () => {
        const f = await fixture(api);
        const bot = await f.botRun();
        assert.equal(bot.status, 'completed'); assert.equal(f.calls(), 1);
        assert.ok(bot.trace.some(event => event.type === 'selection'));
        const result = await f.run().result;
        assert.equal(result.status, 'completed'); assert.equal(f.calls(), 2);
        assert.ok(result.trace.some(event => event.type === 'action' && event.outcome === 'completed'));
        await flush(); assert.equal(f.runtime.status().active, 0);
    });
    check('denied tools never execute even with human approval', async () => {
        const f = await fixture(api, { effect: 'state-changing' });
        await f.update({ ...f.config.policy, rules: [...f.config.policy.rules,
            { id: 'deny.tool', decision: 'deny', operationIds: ['tool'] }] });
        assert.equal((await f.run().result).status, 'denied');
        assert.notEqual((await f.botRun()).status, 'completed');
        assert.equal(f.calls(), 0);
    });
    check('monitor cannot bypass mandatory denies or Vijay permissions', async () => {
        const f = await fixture(api);
        await f.update({ ...f.config.policy, mode: 'monitor', rules: [...f.config.policy.rules,
            { id: 'optional', decision: 'deny', optional: true, operationIds: ['tool'] }] });
        assert.equal((await f.run().result).status, 'completed');
        await flush();
        f.policies.unregister('tool', 'read');
        assert.equal((await f.run().result).status, 'denied');
        assert.equal(f.calls(), 1);
    });
    check('lockdown rejects tasks before invoking the planner', async () => {
        let plans = 0;
        const f = await fixture(api, { planner: { plan() { plans++; return {}; } } });
        await f.admin.lockdown(f.context, 1);
        assert.equal((await f.botRun()).error.code, 'security-denied');
        assert.equal((await f.run().result).status, 'denied');
        assert.equal(plans, 0); assert.equal(f.calls(), 0);
    });
    check('in-flight RUDRA and workflow operations are cancelled before later effects', async () => {
        for (const mode of ['rudra', 'workflow']) {
            const entered = deferred(), release = deferred(); let effects = 0, saved;
            const f = await fixture(api, { handler: async (_input, context) => {
                saved = context; entered.resolve(); await release.promise; context.checkExecution(); effects++; return 1;
            } });
            const result = mode === 'rudra' ? f.botRun() : f.run().result;
            await entered.promise;
            await f.admin.lockdown(f.context, f.runtime.snapshot().version);
            assert.notEqual((await result).status, 'completed');
            assert.equal(saved.signal.aborted, true);
            assert.ok(f.runtime.status().draining > 0);
            release.resolve(); await flush(); await flush();
            assert.equal(effects, 0);
            assert.equal(f.runtime.status().draining, 0);
        }
    });
    check('policy replacement during approval cannot revive stale authorization', async () => {
        const entered = deferred(), release = deferred();
        const f = await fixture(api, { effect: 'state-changing', approve: request => {
            if (request.actionId === 'firewall.admin') return true;
            entered.resolve(); return release.promise;
        } });
        const result = f.run().result; await entered.promise;
        await f.update({ ...f.config.policy, mode: 'monitor' });
        release.resolve(true);
        assert.notEqual((await result).status, 'completed');
        await flush(); assert.equal(f.calls(), 0);
    });
    check('paused workflows observe lockdown without resuming', async () => {
        const f = await fixture(api);
        const run = f.run(plan(action(), action('b')));
        await run.pause();
        await f.admin.lockdown(f.context, 1);
        assert.notEqual((await run.result).status, 'completed');
        assert.equal(f.calls(), 0);
        assert.throws(() => run.resume());
    });
    check('resume rechecks authentication and revoked sessions cannot run', async () => {
        const f = await fixture(api);
        const run = f.run(); await run.pause(); f.revoke(); run.resume();
        assert.notEqual((await run.result).status, 'completed'); assert.equal(f.calls(), 0);
    });
    check('read-only retries remain bounded and each attempt is reauthorized', async () => {
        let attempt = 0;
        const f = await fixture(api, { handler: () => { if (++attempt === 1) throw new Error('retry'); return 3; } });
        const result = await f.run(plan(action()), { maxRetries: 1 }).result;
        assert.equal(result.status, 'completed'); assert.equal(f.calls(), 2);
        assert.equal(result.trace.filter(event => event.type === 'retry').length, 1);
    });
    check('state-changing failures never become retryable', async () => {
        const f = await fixture(api, { effect: 'state-changing', handler: () => { throw new Error('failure'); } });
        const result = await f.run(plan(action()), { maxRetries: 3 }).result;
        assert.notEqual(result.status, 'completed'); assert.equal(f.calls(), 1);
    });
    check('concurrent tools retain separate leases and reentrant engines stay busy', async () => {
        const entered = deferred(), release = deferred(); let entries = 0;
        const f = await fixture(api, { handler: async () => { if (++entries === 2) entered.resolve(); await release.promise; return 1; } });
        const run = f.run(plan(action(), action('b')), { maxParallel: 2 });
        await entered.promise;
        assert.throws(() => f.run(), error => error.code === 'busy');
        await f.admin.lockdown(f.context, 1);
        assert.notEqual((await run.result).status, 'completed');
        assert.throws(() => f.run(), error => error.code === 'busy');
        release.resolve(); await flush(); await flush();
        assert.equal(f.runtime.status().draining, 0);
    });
    check('delegation cannot expand tool grants or expose administrative authority', async () => {
        let keys;
        const f = await fixture(api, { botExecute: async (_input, context) => {
            keys = Object.keys(context.tools);
            return context.tools.execute('other', null);
        } });
        assert.notEqual((await f.botRun()).status, 'completed');
        assert.deepEqual(keys, ['execute']);
        assert.equal(f.calls(), 0);
        assert.equal(f.runtime.snapshot().version, 1);
    });
    check('untrusted plans cannot grant permissions, select tools or change identity', async () => {
        const f = await fixture(api);
        const result = await f.run({ ...plan(action()), permissions: ['admin'], approved: true, scope: { id: 'other' } }).result;
        assert.notEqual(result.status, 'completed'); assert.equal(f.calls(), 0);
        await assert.rejects(f.security.validateTask({ ...f.context }, new AbortController().signal));
        assert.equal(f.runtime.snapshot().version, 1);
    });
    check('session expiry and issuer or tenant mismatch stay mandatory', async () => {
        const f = await fixture(api); f.setTime(10000);
        assert.notEqual((await f.botRun()).status, 'completed'); assert.equal(f.calls(), 0);
        const g = await fixture(api);
        g.identity.session.scope.id = 'other';
        const root = await g.jay.createContext({ id: 'other', input: { capability: 'workflow', data: 2 } }, { signal: new AbortController().signal });
        await assert.rejects(g.security.validateTask(root, root.signal));
    });
    check('binding cannot be replaced or attached after execution has started', async () => {
        const f = await fixture(api);
        assert.throws(() => api.createShivaxFirewall(f.config));
        const jay = new api.Jay({ authenticate: () => f.identity, isSessionValid: () => true }, { now: () => 2000 });
        const security = new api.Vijay(jay, f.policies);
        const root = await jay.createContext({ id: 'task', input: { capability: 'workflow', data: 1 } }, { signal: new AbortController().signal });
        await security.validateTask(root, root.signal);
        assert.throws(() => api.createShivaxFirewall({ ...f.config, jay, security }));
    });
    check('saved tool checkpoints fail after successful completion', async () => {
        let saved;
        const f = await fixture(api, { handler: (_input, context) => { saved = context; return 1; } });
        assert.equal((await f.run().result).status, 'completed');
        await flush(); assert.throws(() => saved.checkExecution());
    });
    check('direct capability checkpoints observe revocation before a delayed effect', async () => {
        const f = await fixture(api), entered = deferred(), finish = deferred(); let effects = 0, signal;
        const work = f.security.runOperation(f.context, 'workflow', 1, f.context.signal, 'read-only',
            async (checkpoint, joined) => {
                signal = joined; entered.resolve(); await finish.promise; checkpoint(); effects++;
            }, () => {});
        await entered.promise; await f.admin.lockdown(f.context, 1);
        assert.equal(signal.aborted, true); finish.resolve();
        await assert.rejects(work); assert.equal(effects, 0);
    });
    check('withdrawn root capability blocks a delayed tool commit', async () => {
        const entered = deferred(), finish = deferred(); let effects = 0;
        const f = await fixture(api, { handler: async (_input, ctx) => {
            entered.resolve(); await finish.promise; ctx.checkExecution(); effects++; return 1;
        } });
        const result = f.run().result; await entered.promise;
        f.policies.unregister('capability', 'workflow'); finish.resolve();
        assert.notEqual((await result).status, 'completed'); assert.equal(effects, 0);
    });
    check('R04 explicit CPU execution uses its own single reservation in lockdown', async () => {
        let calls = 0;
        const cpu = metadata('cpu', 'cpu', 'work', { execute: () => ++calls });
        const f = await fixture(api, { extra: [cpu] });
        await f.admin.lockdown(f.context, 1);
        assert.equal(await f.runtime.execute(f.context, 'cpu', 2), 1);
        assert.equal(f.runtime.status().reservedOperations, 1);
    });
    check('a second controller cannot reuse the bound controller’s dispatch authority', async () => {
        const f = await fixture(api);
        const cpu = metadata('cpu', 'cpu', 'work', { execute: () => 2 });
        const other = api.createShivaxFirewall({ ...f.config, protectExecution: false, operations: [cpu],
            policy: { ...f.config.policy, rules: [{ id: 'allow', decision: 'allow', operationIds: ['cpu'] }] } });
        await f.admin.lockdown(f.context, 1);
        await assert.rejects(other.runtime.execute(f.context, 'cpu', 2));
    });
    check('monitor enforces the controller output ceiling on workflow results', async () => {
        const f = await fixture(api, { handler: () => 'x'.repeat(2000) });
        await f.update({ ...f.config.policy, mode: 'monitor', limits: { ...f.config.policy.limits, maxOutputBytes: 128 } });
        const result = await f.run().result;
        assert.notEqual(result.status, 'completed'); assert.deepEqual(result.outputs, []);
    });
    check('real Sanjay execution preserves its existing implementation', async () => {
        const f = await fixture(api, { bot: new api.SanjayBot(), capability: 'vision.observe', data: { observations: [{ label: 'given', confidence: null }] } });
        const result = await f.botRun();
        assert.equal(result.status, 'completed');
        assert.equal(result.outputs[0].botId, 'sanjay');
    });
    for (const bot of api.createSpecialistBots()) {
        check('least privilege denies ungranted specialist ' + bot.id, async () => {
            const f = await fixture(api, { bot, noBot: true });
            const result = await f.botRun();
            assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'security-denied');
            assert.ok(f.runtime.audit().some(event => event.operationId === 'bot' && event.decision === 'deny'));
            assert.equal(f.calls(), 0);
        });
    }
}
