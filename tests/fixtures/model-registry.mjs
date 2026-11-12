// SARASWATI S04 fixtures: an isolated host for the durable model registry. Offline and deterministic.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    Jay, Vijay, PermissionPolicyRegistry, ProtectedToolRegistry, createShivaxFirewall, NeuralNet, trainOfflineCandidate,
    InMemoryModelRegistryStore, createModelRegistry, openModelRegistry, createBenchmarkSuite, runBenchmark,
} from 'shivax';
import { OWNER, NOW, suiteInput, mockEvaluator } from './benchmark-suite.mjs';

export { OWNER, NOW };
export const OTHER = Object.freeze({ scopeKind: 'company', scopeId: 'globex' });
export const DAY = 86_400_000;
export const signal = () => new AbortController().signal;
const ALL = ['create', 'register', 'evaluate', 'approve', 'reject', 'activate', 'rollback'];
export const actorRef = (id) => `actor_${id}`.padEnd(16, '_');

/** A controllable stand-in for ShivaxFirewallRuntime.status(). */
export function mockFirewall() {
    return { mode: 'enforce', version: 1, admission: 'open', status() { return { mode: this.mode, version: this.version, admission: this.admission }; } };
}

/** Everything a trusted host provides: identity (Jay), roles, an approval journal, a clock and a store. */
export function makeHost({ store = new InMemoryModelRegistryStore(), firewall = mockFirewall(), owner = OWNER, options = {}, roles = {} } = {}) {
    const clock = { t: NOW, now: () => clock.t, advance(ms) { clock.t += ms; } };
    const valid = new Map();
    let next = null;
    const jay = new Jay({ authenticate: () => next, isSessionValid: (identity) => valid.get(identity.principal.id) !== false }, { now: () => clock.t });
    const grants = { alice: ALL, bob: ALL, carol: ALL, mallory: [], ...roles };
    const revokedActors = new Set();
    const approvals = new Map();
    const revokedApprovals = new Set();
    const host = {
        clock, jay, store, firewall, approvals, revokedApprovals, revokedActors, grants,
        async login(id, { scope = owner, issuer = 'host', permissions = [] } = {}) {
            next = {
                principal: { id, issuer, permissions },
                session: { id: `s-${id}`, principalId: id, issuedAt: NOW - 1000, expiresAt: NOW + 400 * DAY, scope: { kind: scope.scopeKind, id: scope.scopeId } },
            };
            return jay.createContext({ id: `admin-${id}`, input: { capability: 'model.admin', data: null } }, { signal: signal() });
        },
        revokeSession(id) { valid.set(id, false); },
        options: {
            registryId: 'digits-prod',
            owner,
            issuer: 'host',
            store,
            jay,
            firewall,
            now: () => clock.t,
            trustedEvaluators: [{ id: 'fixture-evaluator', version: '1' }],
            authorize(root, action) {
                const id = jay.assertActive(root, signal()).principal.id;
                return (grants[id] ?? []).includes(action) ? actorRef(id) : null;
            },
            checkAuthorization(_root, _action, actor) { return !revokedActors.has(actor); },
            approvals: {
                record(approval, digest) { approvals.set(digest, approval); return true; },
                confirm(_approval, digest) { return approvals.has(digest) && !revokedApprovals.has(digest); },
            },
            ...options,
        },
    };
    return host;
}

export async function newRegistry(hostOptions = {}) {
    const host = makeHost(hostOptions);
    const alice = await host.login('alice');
    const registry = await createModelRegistry(host.options, alice, signal());
    return { host, registry, alice };
}

export const baseModel = (seed = 1) => new NeuralNet({ layers: [2, 4, 1], task: 'binary', seed }).toJSON();
export const trained = (seed = 1, epochs = 20) => trainOfflineCandidate(baseModel(seed), [[0, 0], [0, 1], [1, 0], [1, 1]], [[0], [1], [1], [0]], { epochs }).model;
export const rev = (registry) => registry.snapshot().revision;
/** Distinct, deterministic seed per version id (identical artifacts would share one content-addressed object). */
const seedOf = (id) => [...id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function register(registry, root, versionId, extra = {}) {
    return registry.register(root, {
        expectedRevision: rev(registry),
        modelId: 'digits',
        versionId,
        artifact: { model: extra.model ?? trained(seedOf(versionId)), configuration: extra.configuration ?? { threshold: 0.5 } },
        training: extra.training ?? { method: 'offline', options: { epochs: 20 }, seed: 1 },
        ...(extra.dataset ? { dataset: extra.dataset } : {}),
    }, signal());
}

/**
 * S02 evidence bound to the registry: the candidate report is produced for `versionId`'s exact manifest, the
 * baseline for the active version (or an unbound baseline when nothing is active). `behavior` switches the
 * fixture system's behaviour (for example `{ allowAdmin: true }` breaks a mandatory denial case).
 */
export async function evidence(registry, versionId, { behavior = {}, baselineBehavior = {}, suite, evaluatorId, baselineConfig } = {}) {
    const s = suite ?? (await createBenchmarkSuite(suiteInput()));
    const active = registry.snapshot().active;
    const base = baselineConfig ?? (active ? registry.benchmarkConfiguration(active, 'baseline') : { role: 'baseline', id: 'initial', version: '0' });
    const run = (configuration, variant) => runBenchmark(s, mockEvaluator({ variant, ...(evaluatorId ? { id: evaluatorId } : {}) }), { owner: s.owner, configuration, signal: signal(), now: () => NOW });
    return { suite: s, baseline: await run(base, baselineBehavior), candidate: await run(registry.benchmarkConfiguration(versionId, 'candidate'), behavior) };
}
export async function evaluate(registry, root, versionId, options = {}) {
    const e = await evidence(registry, versionId, options);
    return registry.evaluate(root, versionId, { expectedRevision: rev(registry), ...e, ...(options.training ? { training: options.training } : {}) }, signal());
}
/** register → evaluate → approve → activate. */
export async function promote(registry, root, versionId, { approver = root, activator = root, ...options } = {}) {
    if (!registry.version(versionId)) await register(registry, root, versionId, options);
    await evaluate(registry, root, versionId, options);
    await registry.approve(approver, versionId, { expectedRevision: rev(registry) }, signal());
    return registry.activate(activator, versionId, { expectedRevision: rev(registry) }, signal());
}

/** Delegating store with fault-injection hooks: each hook receives the original call as `next`. */
export function faultyStore(inner, hooks = {}) {
    const call = (name, args) => (hooks[name] ? hooks[name](...args, () => inner[name](...args)) : inner[name](...args));
    return {
        putObject: (...a) => call('putObject', a),
        getObject: (...a) => call('getObject', a),
        readHead: (...a) => call('readHead', a),
        compareAndSwapHead: (...a) => call('compareAndSwapHead', a),
    };
}

/**
 * Test-only file store in a temporary directory: objects/<hex>.json plus head.json, written through a temporary
 * file and rename. The compare-and-swap is safe within one process only; production stores need a real lock
 * or transaction.
 */
export class TempFileRegistryStore {
    constructor(dir) { this.dir = dir; }
    file(key) { return join(this.dir, 'objects', `${key.slice(7)}.json`); }
    async #write(path, text) {
        await mkdir(join(this.dir, 'objects'), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, text, 'utf8');
        await rename(temporary, path);
    }
    async #read(path) {
        try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    async putObject(key, text) {
        const existing = await this.#read(this.file(key));
        if (existing === text) return;
        await this.#write(this.file(key), text);
    }
    getObject(key) { return this.#read(this.file(key)); }
    readHead() { return this.#read(join(this.dir, 'head.json')); }
    async compareAndSwapHead(expected, text, _next, check) {
        const current = await this.readHead();
        let revision = 0;
        if (current !== null) try { revision = JSON.parse(current).revision; } catch { return false; }
        if (revision !== expected) return false;
        check();
        await this.#write(join(this.dir, 'head.json'), text);
        return true;
    }
}

/** A real NARASIMHA firewall for the same tenant, so lockdown goes through the actual admin path. */
export async function realFirewall(host) {
    const policies = new PermissionPolicyRegistry()
        .register({ kind: 'capability', id: 'work', effect: 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing', permissions: ['admin'], validateInput: () => true });
    const security = new Vijay(host.jay, policies, { tools: new ProtectedToolRegistry(), approve: () => true });
    const op = { id: 'cpu', kind: 'cpu', capability: 'work', effect: 'read-only', files: { read: [], write: [] }, networkOrigins: [], check: () => true, execute: (x) => x };
    const firewall = createShivaxFirewall({
        jay: host.jay, security, realm: { issuer: 'host', scope: { kind: OWNER.scopeKind, id: OWNER.scopeId } }, operations: [op],
        policy: { mode: 'enforce', rules: [{ id: 'allow', operationIds: ['cpu'], decision: 'allow' }], providers: { ids: [], localities: [] }, capabilities: ['work'], bots: [],
            files: { read: [], write: [] }, network: { origins: [] },
            limits: { maxConcurrent: 4, maxOperations: 100, maxTokens: 100, maxCostUSD: 10, maxInputBytes: 4096, maxOutputBytes: 4096, timeoutMs: 1000 }, audit: { required: false } },
        adminCapability: 'firewall.admin', authorizeAdmin: () => true,
    });
    const root = await host.login('secops', { permissions: ['work', 'admin'] });
    return { firewall, lockdown: () => firewall.admin.lockdown(root, firewall.runtime.snapshot().version) };
}

export { createModelRegistry, openModelRegistry };
