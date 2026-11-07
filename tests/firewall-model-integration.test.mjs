import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as esm from 'shivax';
import * as esmAdapter from 'shivax/adapters/inspectra';
const require = createRequire(import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const emptyFiles = () => ({ read: [], write: [] });
const response = (data = 7, outputTokens = 1) => ({ data, usage: { inputTokens: 1, outputTokens, costUSD: 0.1 } });
const provider = (id = 'mock', extra = {}) => ({ id, locality: 'in-process', capabilities: ['text-reasoning'],
    tokenBased: true, pricing: { callUSD: 0.1, inputTokenUSD: 0, outputTokenUSD: 0 }, infer: () => response(), ...extra });
const model = (p = provider(), extra = {}) => ({ id: p.id, kind: 'model', capability: 'work',
    effect: 'read-only', files: emptyFiles(), networkOrigins: p.locality === 'in-process' ? [] : ['https://model.test'],
    check: () => true, provider: p, modelCapability: 'text-reasoning', output: { schema: { type: 'number' } },
    limits: { maxCalls: 20, maxTokens: 100, maxCostUSD: 10, timeoutMs: 1000,
        maxInputTokens: 1, maxOutputTokens: 1, maxInputBytes: 65536, maxOutputBytes: 65536 }, ...extra });
const tool = (id, extra = {}) => ({ id, toolId: id, kind: 'tool', capability: 'work', effect: 'state-changing',
    files: emptyFiles(), networkOrigins: [], check: () => true, ...extra });
async function fixture(api, operations, settings = {}) {
    const identity = { principal: { id: 'user', issuer: 'host', permissions: ['work', 'admin'] },
        session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10000,
            scope: { kind: 'company', id: 'tenant' } } };
    const jay = new api.Jay({ authenticate: () => identity, isSessionValid: () => true }, { now: () => 2000 });
    const policies = new api.PermissionPolicyRegistry()
        .register({ kind: 'capability', id: 'work', effect: operations.some(o => o.effect === 'state-changing') ? 'state-changing' : 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing', permissions: ['admin'], validateInput: () => true });
    for (const op of operations) if (op.capability !== 'work') policies.register({ kind: 'capability', id: op.capability,
        effect: op.effect, permissions: ['work'], validateInput: () => true });
    const tools = new api.ProtectedToolRegistry();
    settings.register?.(tools);
    for (const op of operations.filter(o => o.kind === 'tool'))
        policies.register({ kind: 'tool', id: op.toolId, effect: op.effect, permissions: ['work'], validateInput: () => true });
    const security = new api.Vijay(jay, policies, { tools, approve: () => true });
    const initial = { mode: 'enforce', rules: [{ id: 'allow', decision: 'allow', operationIds: operations.map(o => o.id) }],
        capabilities: [...new Set(['work', ...operations.map(o => o.capability)])], bots: [], providers: { ids: operations.filter(o => o.kind === 'model').map(o => o.provider.id),
            localities: settings.localities ?? ['in-process', 'local', 'remote'], ...(settings.capabilities ? { capabilities: settings.capabilities } : {}) },
        network: { origins: [...new Set(operations.flatMap(o => o.networkOrigins))] },
        files: { read: [...new Set(operations.flatMap(o => o.files.read))], write: [...new Set(operations.flatMap(o => o.files.write))] },
        limits: { maxConcurrent: 8, maxOperations: 100, maxTokens: 100000, maxCostUSD: settings.budget ?? 10,
            timeoutMs: 2000, maxInputBytes: 65536, maxOutputBytes: 65536 }, audit: { required: false } };
    const firewall = api.createShivaxFirewall({ jay, security, operations, policy: initial,
        realm: { issuer: 'host', scope: identity.session.scope }, protectExecution: settings.protectExecution ?? false, adminCapability: 'firewall.admin', authorizeAdmin: () => true });
    const root = await jay.createContext({ id: 'task', input: { capability: 'work', data: 1 } },
        { signal: new AbortController().signal, toolPermissions: operations.filter(o => o.kind === 'tool').map(o => o.toolId) });
    return { ...firewall, root, identity, jay, initial,
        gateway: (ids = operations.filter(o => o.kind === 'model').map(o => o.id), extra = {}) =>
            api.createGuardedModelGateway(firewall.runtime, { capability: 'text-reasoning', operationIds: ids, timeoutMs: 1000, ...extra }),
        run: (id, input) => firewall.runtime.execute(root, id, input),
        security,
        update: policy => firewall.admin.replace(root, firewall.runtime.snapshot().version, policy) };
}
for (const [format, api, adapter] of [['ESM', esm, esmAdapter], ['CJS', require('shivax'), require('shivax/adapters/inspectra')]]) {
    const check = (name, fn) => test(format + ': R06 ' + name, fn);
    for (const locality of ['local', 'remote']) for (const enabled of [false, true])
        check(locality + ' provider ' + (enabled ? 'enabled' : 'disabled'), async () => {
            let calls = 0;
            const f = await fixture(api, [model(provider('mock', { locality, infer() { calls++; return response(); } }))],
                { localities: enabled ? [locality] : [] });
            const invoke = f.gateway(undefined, { allowRemote: true });
            if (enabled) assert.equal(await invoke(f.root, 1), 7);
            else { await assert.rejects(invoke(f.root, 1), { code: 'denied' });
                assert.ok(f.runtime.audit().some(e => e.decision === 'deny')); }
            assert.equal(calls, enabled ? 1 : 0);
        });
    check('remote gateway defaults disabled and prompt data cannot grant permission', async () => {
        let calls = 0;
        const f = await fixture(api, [model(provider('mock', { locality: 'remote', infer() { calls++; return response(); } }))]);
        await assert.rejects(f.gateway()(f.root, { allowRemote: true, mode: 'monitor', permissions: ['*'] }), { code: 'denied' });
        assert.equal(calls, 0);
        await assert.rejects(f.gateway(undefined, { allowRemote: true })({ ...f.root }, 1));
        assert.throws(() => api.createGuardedModelGateway({ execute() {} }, { capability: 'text-reasoning', operationIds: ['mock'], timeoutMs: 10 }));
    });
    check('provider capability allowlist is mandatory in monitor', async () => {
        const f = await fixture(api, [model()], { capabilities: [{ providerId: 'mock', allow: ['code-generation'] }] });
        await f.update({ ...f.initial, mode: 'monitor' });
        await assert.rejects(f.gateway()(f.root, 1), { code: 'denied' });
    });
    check('three exact ten-cent charges fit and the fourth is blocked', async () => {
        let calls = 0;
        const f = await fixture(api, [model(provider('mock', { infer() { calls++; return response(); } }))], { budget: 0.3 });
        const invoke = f.gateway();
        for (let i = 0; i < 3; i++) assert.equal(await invoke(f.root, 1), 7);
        await assert.rejects(invoke(f.root, 1), { code: 'resource-limit' });
        assert.equal(calls, 3); assert.equal(f.runtime.status().reservedCostUSD, 0.3);
    });
    check('fallback cannot dispatch after the prior attempt exhausts the cost budget', async () => {
        let fallback = 0;
        const f = await fixture(api, [model(provider('a', { infer: () => response('malformed') })),
            model(provider('b', { infer() { fallback++; return response(); } }))], { budget: 0.1 });
        await assert.rejects(f.gateway()(f.root, 1), { code: 'resource-limit' });
        assert.equal(fallback, 0); assert.equal(f.runtime.status().reservedCostUSD, 0.1);
    });
    check('malformed token overrun is terminal and never falls back', async () => {
        let fallback = 0;
        const f = await fixture(api, [model(provider('a', { infer: () => response('malformed', 2) })),
            model(provider('b', { infer() { fallback++; return response(); } }))]);
        await assert.rejects(f.gateway()(f.root, 1), e => e.reason === 'token-limit-exceeded');
        assert.equal(fallback, 0);
    });
    check('verified malformed output permits fallback and charges both attempts', async () => {
        const f = await fixture(api, [model(provider('a', { infer: () => response('malformed') })), model(provider('b'))]);
        assert.equal(await f.gateway()(f.root, 1), 7);
        assert.equal(f.runtime.status().reservedCostUSD, 0.2);
    });
    check('lockdown during an active attempt cancels and blocks fallback and concurrent dispatch', async () => {
        const entered = deferred(), release = deferred(); let fallback = 0;
        const f = await fixture(api, [model(provider('a', { async infer() { entered.resolve(); await release.promise; return response('bad'); } })),
            model(provider('b', { infer() { fallback++; return response(); } }))]);
        const pending = f.gateway()(f.root, 1);
        const failed = assert.rejects(pending);
        await entered.promise; await f.admin.lockdown(f.root, 1);
        await assert.rejects(f.gateway(['b'])(f.root, 1), { code: 'lockdown' });
        release.resolve(); await failed;
        assert.equal(fallback, 0);
    });
    check('route deadline bounds non-cooperative providers without starting fallback', async () => {
        const release = deferred(); let fallback = 0;
        const f = await fixture(api, [model(provider('a', { async infer() { await release.promise; return response(); } })),
            model(provider('b', { infer() { fallback++; return response(); } }))]);
        await assert.rejects(f.gateway(undefined, { timeoutMs: 20 })(f.root, 1), e => ['timeout', 'cancelled'].includes(e.code));
        release.resolve(); assert.equal(fallback, 0);
    });
    check('remote trusted transport receives fixed endpoint and rejects alternate destinations', async () => {
        let loads = 0, guarded = 0;
        const remote = new api.RemoteModelAdapter({ id: 'remote', capabilities: ['text-reasoning'], pricing: provider().pricing,
            endpoint: 'https://model.test/infer', async load() { loads++; return {
                infer() { assert.fail('legacy transport'); },
                inferGuarded(request, policy) { guarded++; assert.equal(policy.redirect, 'error');
                    policy.checkDestination('https://model.test/infer');
                    assert.throws(() => policy.checkDestination('https://model.test/other'), { code: 'provider-denied' });
                    assert.throws(() => policy.checkDestination('https://attacker.test/'), { code: 'provider-denied' });
                    return response(); }
            }; } });
        const f = await fixture(api, [model(remote)]);
        assert.equal(loads, 0);
        assert.equal(await f.gateway(undefined, { allowRemote: true })(f.root, 1), 7);
        assert.equal(loads, 1); assert.equal(guarded, 1);
    });
    check('remote legacy-only transport is denied in protected mode', async () => {
        const remote = new api.RemoteModelAdapter({ id: 'remote', capabilities: ['text-reasoning'], pricing: provider().pricing,
            endpoint: 'https://model.test/infer', load: async () => ({ infer() { assert.fail('legacy transport'); } }) });
        const f = await fixture(api, [model(remote)]);
        await assert.rejects(f.gateway(undefined, { allowRemote: true })(f.root, 1), { code: 'provider-denied' });
    });
    check('local Ollama keeps loopback and redirect restrictions under firewall', async () => {
        const calls = [];
        assert.throws(() => new api.OllamaModelAdapter({ model: 'local', baseURL: 'https://attacker.test' }));
        const local = new api.OllamaModelAdapter({ id: 'local', model: 'local', fetch: async (url, init) => {
            calls.push(url); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
            return new Response(JSON.stringify(url.endsWith('/show') ? { model_info: { 'x.context_length': 8192 } } :
                { message: { content: '7' }, prompt_eval_count: 1, eval_count: 1, done: true, done_reason: 'stop' }));
        } });
        const op = model(local, { networkOrigins: ['http://127.0.0.1:11434'] });
        op.limits.maxInputTokens = 4096; op.limits.maxTokens = 10000;
        const f = await fixture(api, [op], { localities: ['local'] });
        assert.equal(await f.gateway()(f.root, 1), 7); assert.equal(calls.length, 2);
        await f.update({ ...f.initial, providers: { ids: ['local'], localities: [] } });
        await assert.rejects(f.gateway()(f.root, 1), { code: 'denied' }); assert.equal(calls.length, 2);
    });
    check('remote lazy loading rechecks lockdown before network dispatch', async () => {
        const entered = deferred(), release = deferred(); let dispatches = 0;
        const remote = new api.RemoteModelAdapter({ id: 'remote', capabilities: ['text-reasoning'], pricing: provider().pricing,
            endpoint: 'https://model.test/infer', async load() { entered.resolve(); await release.promise;
                return { infer() { assert.fail(); }, inferGuarded() { dispatches++; return response(); } }; } });
        const f = await fixture(api, [model(remote)]);
        const failed = assert.rejects(f.gateway(undefined, { allowRemote: true })(f.root, 1));
        await entered.promise; await f.admin.lockdown(f.root, 1); release.resolve(); await failed;
        await new Promise(r => setImmediate(r)); assert.equal(dispatches, 0);
    });
    check('concurrent gateway requests reserve the shared budget before dispatch', async () => {
        const entered = deferred(), release = deferred(); let second = 0;
        const f = await fixture(api, [model(provider('a', { async infer() { entered.resolve(); await release.promise; return response(); } })),
            model(provider('b', { infer() { second++; return response(); } }))], { budget: 0.1 });
        const first = f.gateway(['a'])(f.root, 1);
        await entered.promise;
        await assert.rejects(f.gateway(['b'])(f.root, 1), { code: 'resource-limit' });
        release.resolve(); assert.equal(await first, 7); assert.equal(second, 0);
    });
    check('Ollama cannot dispatch chat after lockdown during metadata lookup', async () => {
        const entered = deferred(), release = deferred(); let chats = 0;
        const local = new api.OllamaModelAdapter({ id: 'local', model: 'local', fetch: async url => {
            if (url.endsWith('/chat')) { chats++; assert.fail('chat after lockdown'); }
            entered.resolve(); await release.promise;
            return new Response(JSON.stringify({ model_info: { 'x.context_length': 8192 } }));
        } });
        const op = model(local, { networkOrigins: ['http://127.0.0.1:11434'] });
        op.limits.maxInputTokens = 4096; op.limits.maxTokens = 10000;
        const f = await fixture(api, [op]);
        const failed = assert.rejects(f.gateway()(f.root, 1));
        await entered.promise; await f.admin.lockdown(f.root, 1); release.resolve(); await failed;
        await new Promise(r => setImmediate(r)); assert.equal(chats, 0);
    });
    check('bound Vijay propagates resource policy to direct protected tool execution', async () => {
        let writes = 0;
        const f = await fixture(api, [tool('io', { networkOrigins: ['https://allowed.test'] })], {
            protectExecution: true,
            register: tools => tools.register({ id: 'io', validateInput: () => true, validateOutput: () => true,
                execute(_input, context) { context.checkNetworkAccess('https://denied.test/path'); writes++; return null; } }) });
        await assert.rejects(f.security.executeTool(f.root, 'work', 'io', null, f.root.signal,
            { onApproval() {}, trackTool: work => work() }));
        assert.equal(writes, 0);
    });
    check('direct memory calls inherit protected signal scope and destination checks', async () => {
        let commits = 0;
        const engine = new api.MemoryEngine({ persistence: { networkOrigins: [],
            async transact(_ns, change) { const result = change(null); commits++; return result.result; } } });
        const f = await fixture(api, [tool('direct')], { register: tools => tools.register({
            id: 'direct', validateInput: () => true, validateOutput: () => true,
            execute(input, context) {
                const ns = { principalId: context.principal.id, issuer: context.principal.issuer,
                    sessionId: context.session.id, scopeKind: context.session.scope.kind, scopeId: input };
                return engine.save(ns, { id: 'note', category: 'working', value: 'safe' }, context.signal);
            } }) });
        await assert.rejects(f.run('direct', 'another-tenant')); assert.equal(commits, 0);
        const record = await f.run('direct', 'tenant'); assert.equal(record.namespace.scopeId, 'tenant'); assert.equal(commits, 1);
    });
    check('external memory persistence requires declaration and live checks', async () => {
        const entered = deferred(), release = deferred(); let writes = 0;
        const engine = new api.MemoryEngine({ persistence: {
            networkOrigins: ['https://storage.test'],
            async transact(_ns, change, signal, boundary) {
                entered.resolve(); await release.promise; signal.throwIfAborted();
                boundary.checkNetworkAccess('https://storage.test/commit');
                const result = change(null); writes++; return result.result;
            } } });
        const f = await fixture(api, [tool('shivax.memory.records.save', { networkOrigins: ['https://storage.test'] })],
            { register: tools => api.registerMemoryServices(tools, engine) });
        const failed = assert.rejects(f.run('shivax.memory.records.save', { id: 'note', category: 'working', value: 'safe' }));
        await entered.promise; await f.admin.lockdown(f.root, 1); release.resolve(); await failed;
        await new Promise(r => setImmediate(r)); assert.equal(writes, 0);
    });
    check('inspection reauthorizes each page after awaiting the previous capture', async () => {
        let allowed = true, captures = 0;
        const raw = JSON.parse(readFileSync(new URL('./fixtures/inspectra-captures.json', import.meta.url))).cases.baseline;
        raw.snapshot.scope = { kind: 'company', id: 'tenant' };
        const observation = adapter.normalizeInspectraCapture(raw, { scope: raw.snapshot.scope });
        const f = await fixture(api, [tool('shivax.inspection.capture', { effect: 'read-only', networkOrigins: ['https://page.test'] })],
            { register: tools => api.registerInspectionService(tools, {
                id: 'fixture', capture(_request, context) {
                    assert.throws(() => context.checkNetworkAccess('https://page.test/private'));
                    captures++; allowed = false; return observation;
                } }, { authorizeURL: url => allowed && !url.endsWith('/private') }) });
        await assert.rejects(f.run('shivax.inspection.capture', {
            reference: { kind: 'url', url: 'https://page.test/base' }, target: 'https://page.test/target', viewport: { width: 800, height: 600 } }));
        assert.equal(captures, 1);
    });
    check('protected memory derives scope from identity and blocks injected namespace', async () => {
        const engine = new api.MemoryEngine();
        const f = await fixture(api, [tool('shivax.memory.records.save'), tool('shivax.memory.records.retrieve', { capability: 'read', effect: 'read-only' })],
            { register: tools => api.registerMemoryServices(tools, engine) });
        const saved = await f.run('shivax.memory.records.save', { id: 'note', category: 'working', value: 'safe' });
        assert.equal(saved.record.namespace.sessionId, 'session');
        await assert.rejects(f.run('shivax.memory.records.save', { id: 'other', category: 'working', value: 'safe', namespace: { scopeId: 'other' } }));
        f.identity.session.id = 'other-session';
        const other = await f.jay.createContext({ id: 'other', input: { capability: 'work', data: null } }, { signal: new AbortController().signal, toolPermissions: ['shivax.memory.records.retrieve'] });
        assert.equal((await f.runtime.execute(other, 'shivax.memory.records.retrieve', { id: 'note' })).record, null);
        f.identity.session.scope.id = 'another-tenant';
        const alien = await f.jay.createContext({ id: 'alien', input: { capability: 'read', data: null } },
            { signal: new AbortController().signal, toolPermissions: ['shivax.memory.records.retrieve'] });
        await assert.rejects(f.runtime.execute(alien, 'shivax.memory.records.retrieve', { id: 'note' }), { code: 'unauthorized' });
    });
    check('protected embeddings require explicit destinations and block unapproved network', async () => {
        for (const origins of [undefined, ['https://denied.test'], []]) {
            let embeds = 0;
            const engine = new api.MemoryEngine({ embeddings: { id: 'embed', dimensions: 2, networkOrigins: origins,
                embed() { embeds++; return [1, 0]; } } });
            const f = await fixture(api, [tool('shivax.memory.records.save')], { register: tools => api.registerMemoryServices(tools, engine) });
            const work = f.run('shivax.memory.records.save', { id: 'note', category: 'working', value: 'safe' });
            if (origins?.length === 0) await work; else await assert.rejects(work);
            assert.equal(embeds, origins?.length === 0 ? 1 : 0);
        }
    });
    check('lockdown during embeddings prevents persistence', async () => {
        const entered = deferred(), release = deferred(); let commits = 0;
        const engine = new api.MemoryEngine({ embeddings: { id: 'embed', dimensions: 2, networkOrigins: [],
            async embed() { entered.resolve(); await release.promise; return [1, 0]; } },
            persistence: { networkOrigins: [], async transact(_ns, change) { const result = change(null); if (result.write) commits++; return result.result; } } });
        const f = await fixture(api, [tool('shivax.memory.records.save')], { register: tools => api.registerMemoryServices(tools, engine) });
        const failed = assert.rejects(f.run('shivax.memory.records.save', { id: 'note', category: 'working', value: 'safe' }));
        await entered.promise; await f.admin.lockdown(f.root, 1); release.resolve(); await failed;
        await new Promise(r => setImmediate(r)); assert.equal(commits, 0);
    });
    check('file memory requires actual file and pending sibling permissions', async () => {
        let opens = 0, renames = 0;
        const fs = { async stat() { throw Object.assign(Error(), { code: 'ENOENT' }); }, async readFile() { assert.fail(); },
            async open() { opens++; return { async writeFile() {}, async close() {} }; }, async rename() { renames++; }, async unlink() {} };
        for (const includePending of [false, true]) {
            const engine = new api.MemoryEngine({ persistence: new api.NodeFileMemoryAdapter({ path: 'C:/memory.json', fs }) });
            const files = { read: ['C:/memory.json'], write: ['C:/memory.json', ...(includePending ? ['C:/memory.json.pending'] : [])] };
            const f = await fixture(api, [tool('shivax.memory.records.save', { files })], { register: tools => api.registerMemoryServices(tools, engine) });
            const work = f.run('shivax.memory.records.save', { id: 'note', category: 'working', value: 'safe' });
            if (includePending) await work; else await assert.rejects(work);
        }
        assert.equal(opens, 1); assert.equal(renames, 1);
    });
    check('Inspectra disabled never loads or acquires a page', async () => {
        let loads = 0, pages = 0;
        const inspectra = new adapter.InspectraInspectionProvider({ load() { loads++; }, openPage() { pages++; } });
        const f = await fixture(api, [tool('capture', { effect: 'read-only' })], { register: tools => tools.register({
            id: 'capture', validateInput: () => true, validateOutput: () => true,
            execute: (input, context) => inspectra.capture(input, context) }) });
        await assert.rejects(f.run('capture', { url: 'https://page.test', viewport: { width: 800, height: 600 } }));
        assert.equal(loads, 0); assert.equal(pages, 0);
        assert.doesNotMatch(JSON.stringify(f.runtime.audit()), /page\\.test|sessionId|principalId/);
    });
    check('protected Inspectra binds session, rejects unapproved subresources and closes once', async () => {
        let closes = 0, captures = 0;
        const raw = JSON.parse(readFileSync(new URL('./fixtures/inspectra-captures.json', import.meta.url))).cases.baseline;
        raw.snapshot.scope = { kind: 'company', id: 'tenant' };
        const inspectra = new adapter.InspectraInspectionProvider({
            load: async () => ({ captureUIPage: async () => { captures++; return raw; } }),
            async openPage(request, context, security) {
                assert.equal(security.owner.sessionId, context.session.id);
                security.checkDestination(request.url);
                assert.throws(() => security.checkDestination('https://attacker.test/secret'));
                return { page: {}, security, close() { closes++; } };
            } });
        const f = await fixture(api, [tool('capture', { effect: 'read-only', networkOrigins: ['https://page.test'] })],
            { register: tools => tools.register({ id: 'capture', validateInput: () => true, validateOutput: () => true,
                execute: (input, context) => inspectra.capture(input, context) }) });
        await f.run('capture', { url: 'https://page.test', viewport: raw.snapshot.viewport });
        assert.equal(closes, 1); assert.equal(captures, 1);
    });
    check('Inspectra enforces node limits and screenshot write authorization with cleanup', async () => {
        for (const screenshot of [false, true]) {
            let closes = 0, captures = 0;
            const raw = JSON.parse(readFileSync(new URL('./fixtures/inspectra-captures.json', import.meta.url))).cases.baseline;
            raw.snapshot.scope = { kind: 'company', id: 'tenant' };
            const inspectra = new adapter.InspectraInspectionProvider({ maxNodes: 1,
                load: async () => ({ captureUIPage() { captures++; return raw; } }),
                openPage: async (_r, _c, security) => ({ page: {}, security,
                    ...(screenshot ? { screenshot: { path: 'C:/secret.png', reference: 'artifact' } } : {}),
                    close() { closes++; } }) });
            const f = await fixture(api, [tool('capture', { effect: 'read-only', networkOrigins: ['https://page.test'] })],
                { register: tools => tools.register({ id: 'capture', validateInput: () => true, validateOutput: () => true,
                    execute: (input, context) => inspectra.capture(input, context) }) });
            await assert.rejects(f.run('capture', { url: 'https://page.test', viewport: { width: 800, height: 600 } }));
            assert.equal(closes, 1); assert.equal(captures, screenshot ? 0 : 1);
        }
    });
    check('Inspectra rejects unacknowledged leases and closes late acquisition after lockdown', async () => {
        for (const lockdown of [false, true]) {
            let closes = 0;
            const entered = deferred(), release = deferred();
            const inspectra = new adapter.InspectraInspectionProvider({
                load: async () => ({ captureUIPage() { assert.fail('must not capture'); } }),
                async openPage(_r, _c, security) { entered.resolve(); if (lockdown) await release.promise;
                    return { page: {}, ...(lockdown ? { security } : {}), close() { closes++; } }; } });
            const f = await fixture(api, [tool('capture', { effect: 'read-only', networkOrigins: ['https://page.test'] })],
                { register: tools => tools.register({ id: 'capture', validateInput: () => true, validateOutput: () => true,
                    execute: (input, context) => inspectra.capture(input, context) }) });
            const failed = assert.rejects(f.run('capture', { url: 'https://page.test', viewport: { width: 800, height: 600 } }));
            await entered.promise;
            if (lockdown) { await f.admin.lockdown(f.root, 1); release.resolve(); }
            await failed; await new Promise(r => setImmediate(r)); assert.equal(closes, 1);
        }
    });
}
