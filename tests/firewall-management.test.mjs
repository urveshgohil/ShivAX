import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import * as esm from 'shivax/security';
import { filePolicyStore } from './fixtures/firewall-management-host.mjs';
const require = createRequire(import.meta.url);
const signal = () => new AbortController().signal;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const plain = value => JSON.parse(JSON.stringify(value));
async function setup(t, api, settings = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'shivax-r07-'));
    const state = { allowed: true, valid: true, changes: 0, ...settings.state };
    const hooks = {};
    const store = filePolicyStore(directory, hooks);
    const identities = new WeakMap();
    const identity = admin => ({ principal: { id: admin ? 'host-admin' : 'host-reader', issuer: 'host', permissions: admin ? ['work', 'admin'] : ['work'] },
        session: { id: 'session', principalId: admin ? 'host-admin' : 'host-reader', issuedAt: 1000, expiresAt: 10000,
            scope: { kind: 'company', id: 'tenant' } } });
    const jay = new api.Jay({ authenticate: s => identities.get(s), isSessionValid: () => state.valid }, { now: () => 2000 });
    const policies = new api.PermissionPolicyRegistry()
        .register({ kind: 'capability', id: 'work', effect: 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing', permissions: ['admin'], validateInput: () => true });
    const security = new api.Vijay(jay, policies, { approve: () => state.approval !== false });
    const realm = { issuer: 'host', scope: { kind: 'company', id: 'tenant' } };
    const operations = ['cpu', 'network'].map(kind => ({ id: kind, kind, capability: 'work', effect: 'read-only',
        files: { read: [], write: [] }, networkOrigins: [], check: () => true, execute: input => input }));
    const policy = { mode: 'enforce', rules: [{ id: 'allow', operationIds: ['cpu', 'network'], decision: 'allow' }],
        providers: { ids: [], localities: [] }, capabilities: ['work'], bots: [], files: { read: [], write: [] }, network: { origins: [] },
        limits: { maxConcurrent: 8, maxOperations: 100, maxTokens: 0, maxCostUSD: 0, maxInputBytes: 4096, maxOutputBytes: 4096, timeoutMs: 2000 },
        audit: { required: false } };
    const profiles = [{ id: 'standard', policy }, { id: 'monitor', policy: { ...policy, mode: 'monitor' } },
        { id: 'restricted', policy: { ...policy, rules: [...policy.rules, { id: 'deny.network', operationIds: ['network'], decision: 'deny' }] } }];
    const record = { format: 'shivax-firewall-policy', schemaVersion: 1, realm, version: 1, profileId: 'standard', policy,
        history: [{ version: 1, action: 'bootstrap', actorRef: 'host_bootstrap_00000001' }] };
    if (!settings.missing) await store.provision(settings.saved ? settings.saved(plain(record)) : record);
    const role = root => {
        try { return state.allowed && state.valid && jay.assertActive(root, root.signal).principal.permissions.includes('admin'); }
        catch { return false; }
    };
    const options = { firewall: { jay, security, realm, operations, adminCapability: 'firewall.admin', authorizeAdmin: role },
        profiles, store, timeoutMs: settings.timeoutMs ?? 2000,
        async authenticate(request, s) {
            if (!['administrator', 'ordinary'].includes(request)) throw Error('PRIVATE transport credential');
            identities.set(s, identity(request === 'administrator'));
            return jay.createContext({ id: 'management', input: { capability: 'work', data: null } }, { signal: s });
        },
        async authorize(root, action) { state.changes += action === 'change' ? 1 : 0; return role(root) ? 'opaque_admin_00000000001' : null; },
        checkAuthorization: root => role(root) };
    const opened = [];
    const start = async (overrides = {}) => {
        const managed = await api.openShivaxFirewallManagement({ ...options, ...overrides }, signal());
        opened.push(managed); return managed;
    };
    t.after(async () => {
        for (const managed of opened) await managed.close();
        const base = resolve(tmpdir()), target = resolve(directory), suffix = relative(base, target);
        assert.ok(suffix.startsWith('shivax-r07-') && !suffix.includes('..'));
        await rm(target, { recursive: true, force: true });
    });
    return { state, hooks, store, options, policy, record, directory, start,
        root: () => options.authenticate('administrator', signal()) };
}
for (const [format, api] of [['ESM', esm], ['CJS', require('shivax/security')]]) {
    const check = (name, fn) => test(format + ': R07 ' + name, fn);
    check('authorized reads and version-checked changes use host profiles', async t => {
        const f = await setup(t, api), host = await f.start(), m = host.management;
        assert.equal((await m.readPolicy('administrator', signal())).version, 1);
        assert.deepEqual((await m.readConfiguration('administrator', signal())).map(p => p.id), ['standard', 'monitor', 'restricted']);
        const next = await m.requestChange('administrator', { expectedVersion: 1, profileId: 'restricted' }, signal());
        assert.equal(next.version, 2); assert.equal((await f.store.inspect()).current.version, 2);
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'denied' });
        assert.equal(await host.runtime.execute(await f.root(), 'cpu', 2), 2);
        assert.equal('admin' in host, false);
    });
    check('ordinary users and bot payloads cannot read or mutate management', async t => {
        const f = await setup(t, api), host = await f.start(), m = host.management;
        for (const request of ['ordinary', { role: 'admin', policy: f.policy }, { source: 'llm', approved: true }]) {
            await assert.rejects(m.readPolicy(request, signal()), { code: 'unauthorized' });
            await assert.rejects(m.readConfiguration(request, signal()), { code: 'unauthorized' });
            await assert.rejects(m.readAudit(request, signal()), { code: 'unauthorized' });
            await assert.rejects(m.requestChange(request, { expectedVersion: 1, profileId: 'monitor' }, signal()), { code: 'unauthorized' });
            await assert.rejects(m.lockdown(request, { expectedVersion: 1 }, signal()), { code: 'unauthorized' });
        }
        assert.equal(host.runtime.snapshot().version, 1);
        assert.equal((await f.store.inspect()).journal.length, 1);
    });
    check('copied identity contexts cannot authorize management operations', async t => {
        const f = await setup(t, api), minted = await f.root();
        const host = await f.start({ authenticate: async () => ({ ...minted }) });
        await assert.rejects(host.management.readPolicy('administrator', signal()), { code: 'unauthorized' });
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()), { code: 'unauthorized' });
        assert.equal((await f.store.inspect()).current.version, 1);
    });
    check('management preserves the R05 protected Vijay binding', async t => {
        const f = await setup(t, api), host = await f.start({ firewall: { ...f.options.firewall, protectExecution: true } });
        assert.equal(await host.runtime.execute(await f.root(), 'cpu', 1), 1);
        assert.equal((await host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'restricted' }, signal())).version, 2);
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'denied' });
        assert.equal('createManagedFirewall' in api, false);
    });
    check('client policy overrides and invalid commands never reach publication', async t => {
        const f = await setup(t, api), host = await f.start();
        for (const command of [{ expectedVersion: 1, profileId: 'standard', policy: f.policy },
            { expectedVersion: 1, profileId: 'unknown' }, { expectedVersion: -1, profileId: 'standard' }, null]) {
            await assert.rejects(host.management.requestChange('administrator', command, signal()), { code: 'invalid-policy' });
        }
        assert.equal(host.runtime.snapshot().version, 1);
        assert.equal(await host.runtime.execute(await f.root(), 'network', 4), 4);
    });
    check('stale versions and simultaneous requests cannot lose updates', async t => {
        const f = await setup(t, api), host = await f.start(), entered = deferred(), release = deferred();
        f.hooks.beforeCommit = async () => { entered.resolve(); await release.promise; };
        const first = host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal());
        await entered.promise;
        assert.equal(host.runtime.status().admission, 'closed');
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'policy-unavailable' });
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'restricted' }, signal()), { code: 'version-conflict' });
        release.resolve(); assert.equal((await first).version, 2);
        await assert.rejects(host.management.lockdown('administrator', { expectedVersion: 1 }, signal()), { code: 'version-conflict' });
        assert.equal((await f.store.inspect()).journal.length, 2);
    });
    check('restart restores monitor policy and monotonic version from durable storage', async t => {
        const f = await setup(t, api), host = await f.start();
        await host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal());
        await host.close();
        const restarted = await f.start();
        assert.equal(restarted.runtime.snapshot().version, 2); assert.equal(restarted.runtime.snapshot().policy.mode, 'monitor');
        const next = await restarted.management.requestChange('administrator', { expectedVersion: 2, profileId: 'standard' }, signal());
        assert.equal(next.version, 3); assert.equal((await f.store.inspect()).journal.length, 3);
    });
    check('lockdown is persisted, enforced and survives restart while CPU work remains safe', async t => {
        const f = await setup(t, api), host = await f.start();
        await host.management.lockdown('administrator', { expectedVersion: 1 }, signal());
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'lockdown' });
        assert.equal(await host.runtime.execute(await f.root(), 'cpu', 9), 9);
        await host.close();
        const restarted = await f.start();
        assert.equal(restarted.runtime.snapshot().policy.mode, 'lockdown');
        await assert.rejects(restarted.runtime.execute(await f.root(), 'network', 1), { code: 'lockdown' });
    });
    check('missing, malformed, cross-realm and unapproved saved policies fail startup closed', async t => {
        for (const setting of [{ missing: true },
            { saved: r => ({ ...r, policy: { ...r.policy, mode: 'off' } }) },
            { saved: r => ({ ...r, realm: { issuer: 'host', scope: { kind: 'company', id: 'other' } } }) },
            { saved: r => ({ ...r, version: 0 }) },
            { saved: r => ({ ...r, policy: { ...r.policy, capabilities: ['extra'] } }) },
            { saved: r => ({ ...r, credential: 'PRIVATE' }) }]) {
            const f = await setup(t, api, setting);
            await assert.rejects(f.start(), { code: 'policy-unavailable' });
            assert.ok(!(await readdir(f.directory)).includes('owner.lock'));
        }
    });
    check('revocation while preparing persistence blocks durable commit and closes admission', async t => {
        const f = await setup(t, api), host = await f.start();
        f.hooks.beforeCommit = () => { f.state.allowed = false; };
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()));
        assert.equal((await f.store.inspect()).current.version, 1);
        assert.equal(host.runtime.status().admission, 'closed');
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1));
    });
    check('storage failure is sanitized and cannot reopen a permissive runtime', async t => {
        const f = await setup(t, api), host = await f.start();
        f.hooks.beforeCommit = () => { throw Error('PRIVATE /host/secrets token'); };
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()), e => {
            assert.doesNotMatch(e.message, /PRIVATE|secrets|token/); return true;
        });
        assert.equal(host.runtime.status().admission, 'closed');
        assert.equal((await f.store.inspect()).current.version, 1);
        assert.deepEqual((await readdir(f.directory)).sort(), ['owner.lock', 'policy.json']);
    });
    check('store CAS conflict fails closed and preserves the newer durable policy', async t => {
        const f = await setup(t, api), host = await f.start();
        const envelope = await f.store.inspect(); envelope.current.version = 2;
        await f.store.replaceForTest(envelope);
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()));
        assert.equal((await f.store.inspect()).current.version, 2);
        assert.equal(host.runtime.status().admission, 'closed');
    });
    check('exclusive store ownership prevents two active managers for the same realm', async t => {
        const f = await setup(t, api), host = await f.start();
        await assert.rejects(f.start(), { code: 'policy-unavailable' });
        assert.equal(await host.runtime.execute(await f.root(), 'network', 1), 1);
        f.hooks.lost = true;
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'policy-unavailable' });
        assert.equal(host.runtime.status().admission, 'closed');
    });
    check('required human approval remains mandatory for policy changes', async t => {
        const f = await setup(t, api), host = await f.start();
        f.state.approval = false;
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()));
        assert.equal((await f.store.inspect()).current.version, 1);
        assert.equal(host.runtime.snapshot().version, 1);
    });
    check('mutating a command during authentication cannot switch the approved profile', async t => {
        const f = await setup(t, api), entered = deferred(), release = deferred();
        const host = await f.start({ authenticate: async (...args) => { entered.resolve(); await release.promise; return f.options.authenticate(...args); } });
        const command = { expectedVersion: 1, profileId: 'restricted' };
        const change = host.management.requestChange('administrator', command, signal());
        await entered.promise; command.profileId = 'monitor'; release.resolve();
        assert.equal((await change).policy.mode, 'enforce');
        await assert.rejects(host.runtime.execute(await f.root(), 'network', 1), { code: 'denied' });
    });
    check('timeout retains storage ownership until a delayed writer settles', async t => {
        const f = await setup(t, api, { timeoutMs: 100 }), host = await f.start(), entered = deferred(), release = deferred();
        f.hooks.beforeCommit = async () => { entered.resolve(); await release.promise; };
        const failed = assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()));
        await entered.promise; await failed;
        const closing = host.close();
        await assert.rejects(f.start(), { code: 'policy-unavailable' });
        release.resolve(); await closing;
        assert.equal((await f.store.inspect()).current.version, 1);
        const reopened = await f.start(); assert.equal(reopened.runtime.snapshot().version, 1);
    });
    check('ambiguous acknowledgement never reopens the old runtime and restart reads the committed version', async t => {
        const f = await setup(t, api), host = await f.start();
        f.hooks.afterCommit = () => { throw Error('PRIVATE storage acknowledgement'); };
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'restricted' }, signal()));
        assert.equal(host.runtime.status().admission, 'closed');
        assert.equal((await f.store.inspect()).current.version, 2);
        await host.close(); f.hooks.afterCommit = undefined;
        const restarted = await f.start();
        assert.equal(restarted.runtime.snapshot().version, 2);
        await assert.rejects(restarted.runtime.execute(await f.root(), 'network', 1), { code: 'denied' });
    });
    check('authorization is rechecked after storage and immediately before publication', async t => {
        const f = await setup(t, api);
        let committed = false;
        f.hooks.afterCommit = () => { committed = true; };
        const host = await f.start({ firewall: { ...f.options.firewall,
            authorizeAdmin: root => !committed && f.options.firewall.authorizeAdmin(root) } });
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal()));
        assert.equal(host.runtime.snapshot().version, 1);
        assert.equal(host.runtime.status().admission, 'closed');
        assert.equal((await f.store.inspect()).current.version, 2);
        await assert.rejects(host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'restricted' }, signal()));
    });
    check('startup cancellation never returns a runtime or retains the store lock', async t => {
        const f = await setup(t, api), entered = deferred(), release = deferred(), controller = new AbortController();
        f.hooks.beforeLoad = async () => { entered.resolve(); await release.promise; };
        const failed = assert.rejects(api.openShivaxFirewallManagement(f.options, controller.signal), { code: 'policy-unavailable' });
        await entered.promise; controller.abort(); release.resolve(); await failed;
        assert.ok(!(await readdir(f.directory)).includes('owner.lock'));
    });
    check('protected authorization references persist but never appear in public audit or bot events', async t => {
        const f = await setup(t, api), host = await f.start();
        await host.management.requestChange('administrator', { expectedVersion: 1, profileId: 'monitor' }, signal());
        assert.equal((await f.store.inspect()).journal.at(-1).actorRef, 'opaque_admin_00000000001');
        const audit = await host.management.readAudit('administrator', signal());
        assert.equal(audit.changes.at(-1).version, 2);
        assert.doesNotMatch(JSON.stringify(audit), /actorRef|opaque_admin|host-admin|session|PRIVATE/);
        assert.doesNotMatch(JSON.stringify(host.runtime.audit()), /opaque_admin|actorRef|host-admin/);
        f.state.valid = false;
        await assert.rejects(host.management.readAudit('administrator', signal()), { code: 'unauthorized' });
    });
}
