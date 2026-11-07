import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as esm from 'shivax/security';
import { ModelError as ESMModelError } from 'shivax/models';
const require = createRequire(import.meta.url);
const formats = [['ESM', esm, ESMModelError], ['CommonJS', require('shivax/security'), require('shivax/models').ModelError]];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const emptyFiles = () => ({ read: [], write: [] });
function host(id = 'cpu', overrides = {}) {
    return { id, kind: 'cpu', capability: 'work', effect: 'read-only', files: emptyFiles(),
        networkOrigins: [], check: () => true, execute: input => input, ...overrides };
}
function model(overrides = {}) {
    return { id: 'model', kind: 'model', capability: 'work', effect: 'read-only',
        files: emptyFiles(), networkOrigins: [], check: () => true,
        provider: { id: 'mock', capabilities: ['text-reasoning'], locality: 'in-process', tokenBased: true,
            pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 },
            infer: () => ({ data: 1, usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } }) },
        modelCapability: 'text-reasoning', output: { schema: { type: 'number' } },
        limits: { maxCalls: 20, maxTokens: 40, maxCostUSD: 2, timeoutMs: 1000,
            maxInputTokens: 1, maxOutputTokens: 1, maxInputBytes: 4096, maxOutputBytes: 4096 }, ...overrides };
}
function policy(operations) {
    return { mode: 'enforce', rules: [{ id: 'allow', operationIds: operations.map(op => op.id), decision: 'allow' }],
        providers: { ids: ['mock'], localities: ['in-process'] }, capabilities: ['work'], bots: [],
        files: emptyFiles(), network: { origins: [] },
        limits: { maxConcurrent: 4, maxOperations: 100, maxTokens: 100, maxCostUSD: 10,
            maxInputBytes: 4096, maxOutputBytes: 4096, timeoutMs: 1000 }, audit: { required: false } };
}
async function fixture(api, options = {}) {
    let valid = true;
    const identity = { principal: { id: 'user', issuer: 'host', permissions: ['work', 'admin'] },
        session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10000,
            scope: { kind: 'company', id: 'tenant' } } };
    const jay = new api.Jay({ authenticate: () => identity, isSessionValid: async () => valid }, { now: () => 2000 });
    const operations = options.operations ?? [host()];
    const policies = new api.PermissionPolicyRegistry().register({ kind: 'capability', id: 'work',
        effect: options.effect ?? 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing',
            permissions: ['admin'], validateInput: () => true });
    const tools = new api.ProtectedToolRegistry();
    if (options.tool) {
        tools.register(options.tool);
        policies.register({ kind: 'tool', id: options.tool.id, effect: options.effect ?? 'read-only',
            permissions: ['work'], validateInput: () => true });
    }
    const security = new api.Vijay(jay, policies, { tools, approve: options.approve ?? (() => true) });
    const initial = options.policy ?? policy(operations);
    const config = { jay, security, realm: { issuer: 'host', scope: { kind: 'company', id: 'tenant' } },
        operations, policy: initial, adminCapability: 'firewall.admin',
        authorizeAdmin: options.authorizeAdmin ?? (() => true), auditSink: options.auditSink,
        auditCapacity: options.auditCapacity };
    const firewall = api.createShivaxFirewall(config);
    const controller = new AbortController();
    const root = await jay.createContext({ id: 'task', input: { capability: 'work', data: 1 } },
        { signal: controller.signal, toolPermissions: options.tool ? [options.tool.id] : [] });
    return { ...firewall, config, root, controller, jay, policies, identity,
        revokeSession() { valid = false; },
        replace(next) { return firewall.admin.replace(root, firewall.runtime.snapshot().version, next); } };
}
const rejects = (work, code) => assert.rejects(work, error => error.code === code);
for (const [format, api, ModelError] of formats) {
    const check = (name, run) => test(format + ': firewall ' + name, run);
    check('starts enforce, executes an explicit allow and freezes snapshots', async () => {
        const f = await fixture(api);
        assert.equal(f.runtime.snapshot().policy.mode, 'enforce');
        assert.deepEqual(await f.runtime.execute(f.root, 'cpu', { value: 1 }), { value: 1 });
    });
    check('default deny applies in enforce and monitor', async () => {
        const f = await fixture(api);
        await rejects(f.runtime.execute(f.root, 'unknown', 1), 'denied');
        await f.replace({ ...f.runtime.snapshot().policy, mode: 'monitor', rules: [] });
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
        assert.equal(f.runtime.status().reservedOperations, 0);
    });
    check('monitor bypasses only explicit optional deny rules', async () => {
        const f = await fixture(api);
        const next = { ...f.runtime.snapshot().policy, rules: [
            ...f.runtime.snapshot().policy.rules, { id: 'optional', operationIds: ['cpu'], decision: 'deny', optional: true }] };
        await f.replace(next);
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
        await f.replace({ ...next, mode: 'monitor' });
        assert.equal(await f.runtime.execute(f.root, 'cpu', 1), 1);
        assert.ok(f.runtime.audit().some(event => event.decision === 'would-deny'));
        await f.replace({ ...next, mode: 'monitor', rules: [...next.rules,
            { id: 'mandatory', operationIds: ['cpu'], decision: 'deny' }] });
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
    });
    check('missing configuration and malformed policies reject without invoking getters', async () => {
        assert.throws(() => api.createShivaxFirewall(), error => error.code === 'invalid-configuration');
        const f = await fixture(api);
        for (const bad of [undefined, {}, { ...f.config.policy, mode: 'monitor' }, { ...f.config.policy, mode: 'bad' },
            { ...f.config.policy, limits: { ...f.config.policy.limits, maxCostUSD: NaN } },
            { ...f.config.policy, rules: [{ id: 'x', operationIds: ['cpu'], decision: 'allow', optional: true }] }])
            assert.throws(() => api.createShivaxFirewall({ ...f.config, policy: bad }));
        let touched = 0;
        const bad = { ...f.config.policy, get rules() { touched++; return []; } };
        assert.throws(() => api.createShivaxFirewall({ ...f.config, policy: bad }));
        assert.equal(touched, 0);
    });
    check('snapshots and operation descriptors cannot be mutated after construction', async () => {
        const f = await fixture(api);
        assert.ok(Object.isFrozen(f.runtime.snapshot().policy.rules[0].operationIds));
        f.config.policy.rules.length = 0;
        f.config.operations[0].execute = () => 'replaced';
        assert.equal(await f.runtime.execute(f.root, 'cpu', 7), 7);
        assert.throws(() => { f.runtime.snapshot().policy.mode = 'monitor'; });
    });
    check('versions are monotonic and rollback republishes validated history', async () => {
        const f = await fixture(api);
        await f.replace({ ...f.runtime.snapshot().policy, mode: 'monitor' });
        assert.equal(f.runtime.snapshot().version, 2);
        await f.admin.rollback(f.root, 2, 1);
        assert.equal(f.runtime.snapshot().version, 3);
        assert.equal(f.runtime.snapshot().policy.mode, 'enforce');
        await rejects(f.admin.replace(f.root, 1, f.config.policy), 'version-conflict');
    });
    check('concurrent administrators cannot publish from the same version', async () => {
        const wait = deferred(), entered = deferred();
        const f = await fixture(api, { authorizeAdmin: async () => { entered.resolve(); return wait.promise; } });
        const first = f.replace({ ...f.config.policy, mode: 'monitor' });
        await entered.promise;
        await rejects(f.replace(f.config.policy), 'version-conflict');
        wait.resolve(true);
        assert.equal((await first).version, 2);
    });
    check('unauthorized or unapproved administration never changes policy', async () => {
        const f = await fixture(api, { authorizeAdmin: () => false });
        await rejects(f.replace({}), 'unauthorized');
        assert.equal(f.runtime.status().admission, 'open');
        assert.equal(f.runtime.snapshot().version, 1);
        assert.equal(await f.runtime.execute(f.root, 'cpu', 1), 1);
        const denied = await fixture(api, { approve: () => false });
        await rejects(denied.admin.lockdown(denied.root, 1), 'unauthorized');
        assert.equal(denied.runtime.snapshot().version, 1);
        assert.equal('admin' in f.runtime, false);
        assert.equal('setMode' in f.runtime, false);
    });
    check('authorized invalid update closes admission and valid recovery is explicit', async () => {
        const f = await fixture(api);
        await rejects(f.replace({ ...f.config.policy, mode: 'typo' }), 'invalid-policy');
        assert.equal(f.runtime.status().admission, 'closed');
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'policy-unavailable');
        await f.admin.rollback(f.root, 1, 1);
        assert.equal(f.runtime.snapshot().version, 2);
        assert.equal(await f.runtime.execute(f.root, 'cpu', 1), 1);
    });
    check('forged contexts, cross-tenant contexts and revoked sessions cannot execute', async () => {
        const f = await fixture(api);
        await rejects(f.runtime.execute({ ...f.root }, 'cpu', 1), 'denied');
        f.identity.session.scope.id = 'other';
        const other = await f.jay.createContext({ id: 'other-task', input: { capability: 'work', data: 1 } },
            { signal: new AbortController().signal });
        await rejects(f.runtime.execute(other, 'cpu', 1), 'unauthorized');
        f.revokeSession();
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
    });
    check('monitor preserves Vijay permission and sandbox checks', async () => {
        const f = await fixture(api, { operations: [host('cpu', { check: () => false })] });
        await f.replace({ ...f.config.policy, mode: 'monitor' });
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
        const g = await fixture(api);
        await g.replace({ ...g.config.policy, mode: 'monitor' });
        g.policies.unregister('capability', 'work');
        await rejects(g.runtime.execute(g.root, 'cpu', 1), 'denied');
    });
    check('required human approval cannot be bypassed by monitor', async () => {
        let calls = 0;
        const f = await fixture(api, { effect: 'state-changing', approve: request => request.actionId === 'firewall.admin',
            operations: [host('write', { kind: 'file', effect: 'state-changing', execute: () => ++calls })] });
        await f.replace({ ...f.config.policy, mode: 'monitor' });
        await rejects(f.runtime.execute(f.root, 'write', 1), 'denied');
        assert.equal(calls, 0);
    });
    check('file, network and bot restrictions are mandatory exact allowlists', async () => {
        const op = host('file', { kind: 'file', files: { read: ['/safe/data'], write: [] },
            networkOrigins: ['https://example.test'], botId: 'reader' });
        const f = await fixture(api, { operations: [op] });
        await rejects(f.runtime.execute(f.root, 'file', 1), 'denied');
        await f.replace({ ...f.config.policy, mode: 'monitor', files: { read: ['/safe/data'], write: [] },
            network: { origins: ['https://example.test'] }, bots: ['reader'] });
        assert.equal(await f.runtime.execute(f.root, 'file', 1), 1);
        await f.replace({ ...f.runtime.snapshot().policy, files: { read: ['/safe'], write: [] } });
        await rejects(f.runtime.execute(f.root, 'file', 1), 'denied');
        for (const path of ['/safe/../secret', 'relative', 'C:/safe/file:stream', '/safe//file'])
            assert.throws(() => api.createShivaxFirewall({ ...f.config,
                policy: { ...f.config.policy, files: { read: [path], write: [] } } }));
    });
    check('lockdown rejects side effects, models and workflows but permits allowed CPU work', async () => {
        const ops = [host(), host('workflow', { kind: 'workflow' }), host('network', { kind: 'network' }), model()];
        const f = await fixture(api, { operations: ops });
        await f.admin.lockdown(f.root, 1);
        for (const name of ['workflow', 'network', 'model'])
            await rejects(f.runtime.execute(f.root, name, 1), 'lockdown');
        assert.equal(await f.runtime.execute(f.root, 'cpu', 2), 2);
        assert.throws(() => api.createShivaxFirewall({ ...f.config,
            operations: [host('cpu', { networkOrigins: ['https://example.test'] })] }));
    });
    check('lockdown cancels cooperative work and revokes retained checkpoints', async () => {
        const entered = deferred(); let saved;
        const f = await fixture(api, { operations: [host('network', { kind: 'network', execute: (_input, ctx) => {
            saved = ctx; entered.resolve(); return new Promise(resolve => ctx.signal.addEventListener('abort', () => resolve(1), { once: true }));
        } })] });
        const running = f.runtime.execute(f.root, 'network', 1);
        const rejected = rejects(running, 'revoked');
        await entered.promise;
        await f.admin.lockdown(f.root, 1);
        await rejected; await flush();
        assert.equal(saved.signal.aborted, true);
        assert.throws(() => saved.checkExecution());
        assert.equal(f.runtime.status().draining, 0);
    });
    check('noncooperative work retains ownership until settlement', async () => {
        const entered = deferred(), finish = deferred();
        const f = await fixture(api, { operations: [host('network', { kind: 'network',
            execute: () => { entered.resolve(); return finish.promise; } })] });
        const rejected = rejects(f.runtime.execute(f.root, 'network', 1), 'cancelled');
        await entered.promise; f.controller.abort(); await rejected;
        assert.equal(f.runtime.status().draining, 1);
        finish.resolve(1); await flush();
        assert.equal(f.runtime.status().draining, 0);
        assert.equal(f.runtime.status().reservedOperations, 1);
    });
    check('policy changes during human approval prevent late dispatch', async () => {
        const entered = deferred(), approval = deferred(); let calls = 0;
        const f = await fixture(api, { effect: 'state-changing',
            approve: request => request.actionId === 'firewall.admin' ? true : (entered.resolve(), approval.promise),
            operations: [host('write', { kind: 'file', effect: 'state-changing', execute: () => ++calls })] });
        const rejected = rejects(f.runtime.execute(f.root, 'write', 1), 'revoked');
        await entered.promise; await f.admin.lockdown(f.root, 1); approval.resolve(true);
        await rejected; await flush(); assert.equal(calls, 0);
    });
    check('protected tool execution still uses Vijay and tool grants', async () => {
        let calls = 0;
        const tool = { id: 'read.tool', validateInput: () => true, validateOutput: () => true, execute: () => ++calls };
        const f = await fixture(api, { tool, operations: [{ id: 'tool', kind: 'tool', capability: 'work',
            effect: 'read-only', files: emptyFiles(), networkOrigins: [], check: () => true, toolId: tool.id }] });
        assert.equal(await f.runtime.execute(f.root, 'tool', 1), 1);
        await f.admin.lockdown(f.root, 1);
        await rejects(f.runtime.execute(f.root, 'tool', 1), 'lockdown');
        assert.equal(calls, 1);
    });
    check('resource reservations prevent concurrent overspend and survive rollback', async () => {
        const entered = deferred(), finish = deferred();
        const op = host('cpu', { execute: () => { entered.resolve(); return finish.promise; } });
        const initial = policy([op]); initial.limits.maxOperations = 1;
        const f = await fixture(api, { operations: [op], policy: initial });
        const work = f.runtime.execute(f.root, 'cpu', 1); await entered.promise;
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'resource-limit');
        finish.resolve(1); await work;
        await f.admin.rollback(f.root, 1, 1);
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'resource-limit');
    });
    check('required audit acknowledgement fails closed without leaking payloads', async () => {
        const f = await fixture(api, { auditCapacity: 4, auditSink: () => { throw new Error('credential-secret'); } });
        f.config.policy.audit.required = true;
        await rejects(f.replace(f.config.policy), 'audit-unavailable');
        assert.equal(f.runtime.status().admission, 'closed');
        const g = await fixture(api, { operations: [host('cpu', { execute: () => { throw new Error('credential-secret'); } })],
            auditCapacity: 2 });
        await rejects(g.runtime.execute(g.root, 'cpu', { token: 'payload-secret' }), 'denied');
        await rejects(g.runtime.execute(g.root, 'unknown-secret', 1), 'denied');
        assert.equal(JSON.stringify(g.runtime.audit()).includes('secret'), false);
        assert.ok(g.runtime.status().droppedAuditEvents > 0);
        assert.equal(g.runtime.audit().at(-1).operationId, null);
        assert.ok(Object.isFrozen(g.runtime.audit()[0]));
    });
    check('model provider IDs and locality remain restricted in monitor', async () => {
        let calls = 0;
        const op = model(); op.provider.locality = 'remote'; op.networkOrigins = ['https://model.test']; op.provider.infer = () => { calls++; return { data: 1,
            usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } }; };
        const f = await fixture(api, { operations: [op] });
        await f.replace({ ...f.config.policy, mode: 'monitor' });
        await rejects(f.runtime.execute(f.root, 'model', 1), 'denied');
        await f.replace({ ...f.config.policy, providers: { ids: ['mock'], localities: ['remote'] },
            network: { origins: ['https://model.test'] } });
        assert.equal(await f.runtime.execute(f.root, 'model', 1), 1);
        assert.equal(calls, 1);
    });
    check('exact global model cost budget admits three calls and rejects the fourth', async () => {
        const op = model(), initial = policy([op]); initial.limits.maxCostUSD = 0.3;
        const f = await fixture(api, { operations: [op], policy: initial });
        for (let i = 0; i < 3; i++) assert.equal(await f.runtime.execute(f.root, 'model', 1), 1);
        await rejects(f.runtime.execute(f.root, 'model', 1), 'resource-limit');
        assert.equal(f.runtime.status().reservedCostUSD, 0.3);
    });
    check('hard model token failures survive monitor and cannot be retried through the core', async () => {
        let calls = 0;
        const op = model();
        op.provider.infer = () => { calls++; return { data: 'malformed',
            usage: { inputTokens: 1, outputTokens: 2, costUSD: 0.1 } }; };
        const f = await fixture(api, { operations: [op] });
        await f.replace({ ...f.config.policy, mode: 'monitor' });
        await assert.rejects(f.runtime.execute(f.root, 'model', 1),
            error => error instanceof ModelError && error.reason === 'token-limit-exceeded');
        await rejects(f.runtime.execute(f.root, 'model', 1), 'resource-limit');
        assert.equal(calls, 1);
    });
    check('synchronous work and never-settling audit acknowledgements respect deadlines', async () => {
        const op = host('cpu', { execute: () => { const until = performance.now() + 30; while (performance.now() < until) {} return 1; } });
        const initial = policy([op]); initial.limits.timeoutMs = 10;
        const f = await fixture(api, { operations: [op], policy: initial });
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'timeout');
        const required = policy([host()]); required.audit.required = true; required.limits.timeoutMs = 20;
        const g = await fixture(api, { policy: required, auditSink: () => new Promise(() => {}) });
        await assert.rejects(g.runtime.execute(g.root, 'cpu', 1),
            error => ['timeout', 'audit-unavailable'].includes(error.code));
        await flush(); assert.equal(g.runtime.status().reservedOperations, 0);
    });
    check('optional observer failure or delay cannot disable permitted work', async () => {
        const f = await fixture(api, { auditSink: () => new Promise(() => {}), auditCapacity: 1 });
        assert.equal(await f.runtime.execute(f.root, 'cpu', 1), 1);
        assert.equal(await f.runtime.execute(f.root, 'cpu', 2), 2);
        assert.ok(f.runtime.status().droppedAuditEvents > 0);
    });
    check('late administrator authorization cannot commit after timeout', async () => {
        const wait = deferred(), entered = deferred();
        const initial = policy([host()]); initial.limits.timeoutMs = 20;
        const f = await fixture(api, { policy: initial, authorizeAdmin: () => { entered.resolve(); return wait.promise; } });
        const result = rejects(f.replace({ ...initial, mode: 'monitor' }), 'timeout');
        await entered.promise; await result; wait.resolve(true); await flush();
        assert.equal(f.runtime.snapshot().version, 1);
        assert.equal(f.runtime.snapshot().policy.mode, 'enforce');
    });
    check('policy candidate is snapshotted before asynchronous administrator approval', async () => {
        const wait = deferred(), entered = deferred();
        const f = await fixture(api, { approve: () => { entered.resolve(); return wait.promise; } });
        const next = structuredClone(f.config.policy); next.mode = 'monitor';
        const changing = f.replace(next); await entered.promise; next.rules.length = 0; next.mode = 'lockdown';
        wait.resolve(true); await changing;
        assert.equal(f.runtime.snapshot().policy.mode, 'monitor');
        assert.equal(await f.runtime.execute(f.root, 'cpu', 1), 1);
    });
    check('required audit wait fences operations and lockdown still works if the sink fails', async () => {
        const entered = deferred(), finish = deferred(), auditEntered = deferred(), auditFinish = deferred();
        let hold = false;
        const f = await fixture(api, { operations: [host('network', { kind: 'network',
            execute: () => { entered.resolve(); return finish.promise; } })],
            auditSink: () => hold ? (auditEntered.resolve(), auditFinish.promise) : true });
        const result = rejects(f.runtime.execute(f.root, 'network', 1), 'revoked');
        await entered.promise; hold = true;
        const change = f.replace({ ...f.config.policy, audit: { required: true } });
        await auditEntered.promise; await result;
        assert.equal(f.runtime.status().admission, 'closed');
        assert.equal(f.runtime.status().draining, 1);
        auditFinish.resolve(true); await change;
        finish.resolve(1); await flush();
        const g = await fixture(api, { auditSink: () => false });
        await g.admin.lockdown(g.root, 1);
        assert.equal(g.runtime.snapshot().policy.mode, 'lockdown');
    });
    check('mandatory authorization is rechecked after host predicates', async () => {
        let calls = 0, f;
        const op = host('cpu', { check: () => {
            if (f?.runtime.audit().some(e => e.decision === 'allow')) f.policies.unregister('capability', 'work');
            return true;
        }, execute: () => ++calls });
        f = await fixture(api, { operations: [op] });
        await rejects(f.runtime.execute(f.root, 'cpu', 1), 'denied');
        assert.equal(calls, 0);
    });
    check('hard provider errors do not retry or dispatch another registered provider', async () => {
        let calls = 0;
        const first = model(); first.provider.infer = () => { calls++; throw new ModelError('token-limit-exceeded'); };
        const second = model({ id: 'second' });
        const f = await fixture(api, { operations: [first, second] });
        await assert.rejects(f.runtime.execute(f.root, 'model', 1), error => error.reason === 'token-limit-exceeded');
        await rejects(f.runtime.execute(f.root, 'second', 1), 'resource-limit');
        assert.equal(calls, 1);
    });
    check('administrator role revoked during approval cannot publish a relaxation', async () => {
        const entered = deferred(), approval = deferred(); let isAdmin = true;
        const f = await fixture(api, { authorizeAdmin: () => isAdmin,
            approve: () => { entered.resolve(); return approval.promise; } });
        const changing = rejects(f.replace({ ...f.config.policy, mode: 'monitor' }), 'unauthorized');
        await entered.promise; isAdmin = false; approval.resolve(true); await changing;
        assert.equal(f.runtime.snapshot().version, 1);
        assert.equal(f.runtime.status().admission, 'closed');
    });
    check('concurrent model operations share exact reservations before provider dispatch', async () => {
        const entered = deferred(), finish = deferred(); let calls = 0;
        const first = model(); first.provider.infer = () => { calls++; entered.resolve(); return finish.promise; };
        const second = model({ id: 'second' });
        const initial = policy([first, second]); initial.limits.maxCostUSD = 0.1;
        const f = await fixture(api, { operations: [first, second], policy: initial });
        const work = f.runtime.execute(f.root, 'model', 1); await entered.promise;
        await rejects(f.runtime.execute(f.root, 'second', 1), 'resource-limit');
        finish.resolve({ data: 1, usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } });
        assert.equal(await work, 1); assert.equal(calls, 1);
        assert.equal(f.runtime.status().reservedCostUSD, 0.1);
    });
    check('null model usage is unverifiable and cancellation retains late billing ownership', async () => {
        const op = model(); op.provider.infer = () => ({ data: 1, usage: { inputTokens: null, outputTokens: null, costUSD: 0.1 } });
        const f = await fixture(api, { operations: [op] });
        await rejects(f.runtime.execute(f.root, 'model', 1), 'usage-unverifiable');
        const entered = deferred(), finish = deferred();
        const delayed = model(); delayed.provider.infer = () => { entered.resolve(); return finish.promise; };
        const g = await fixture(api, { operations: [delayed] });
        const rejected = rejects(g.runtime.execute(g.root, 'model', 1), 'cancelled');
        await entered.promise; g.controller.abort(); await rejected;
        assert.equal(g.runtime.status().draining, 1);
        finish.resolve({ data: 1, usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } });
        await flush(); await flush();
        assert.equal(g.runtime.status().reservedCostUSD, 0.2);
        assert.equal(g.runtime.status().draining, 0);
    });
}
