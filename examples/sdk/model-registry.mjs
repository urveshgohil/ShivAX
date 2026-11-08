// Durable model lifecycle with an isolated in-memory store (SARASWATI S04). Offline; no network or files.
// The identities, roles and approval journal below are labelled demo stand-ins. Production hosts verify real
// sessions on a trusted server, keep the registry out of bot and tool contexts, and use a durable store with
// an atomic compare-and-swap (a database transaction, a conditional write or a fenced lock).
import { NeuralNet } from 'shivax/core';
import { Jay, Vijay, PermissionPolicyRegistry, ProtectedToolRegistry, createShivaxFirewall } from 'shivax/security';
import {
    trainOfflineCandidate, createBenchmarkSuite, runBenchmark,
    InMemoryModelRegistryStore, createModelRegistry, openModelRegistry,
} from 'shivax/learning';

const owner = { scopeKind: 'company', scopeId: 'example-tenant' };
const scope = { kind: 'company', id: 'example-tenant' };
const signal = () => AbortSignal.timeout(30_000);

// --- Demo identity (Jay), roles and firewall -------------------------------------------------------------
let current = null;
const jay = new Jay({ authenticate: () => current, isSessionValid: () => true });
const login = (id, permissions = []) => {
    const now = Date.now();
    current = { principal: { id, issuer: 'example-host', permissions }, session: { id: `s-${id}`, principalId: id, issuedAt: now, expiresAt: now + 600_000, scope } };
    return jay.createContext({ id: `admin-${id}`, input: { capability: 'model.admin', data: null } }, { signal: signal() });
};
// Opaque actor references and role grants. A real host maps them from its directory.
const roles = { alice: ['create', 'register', 'evaluate', 'reject'], bob: ['approve'], carol: ['activate', 'rollback'] };
const actor = (id) => `actor_${id}`.padEnd(16, '_');
const approvalJournal = new Map(); // Demo stand-in for the host's protected approval journal.

const policies = new PermissionPolicyRegistry()
    .register({ kind: 'capability', id: 'work', effect: 'read-only', permissions: ['work'], validateInput: () => true })
    .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing', permissions: ['firewall-admin'], validateInput: () => true });
const firewall = createShivaxFirewall({
    jay, security: new Vijay(jay, policies, { tools: new ProtectedToolRegistry(), approve: () => true }),
    realm: { issuer: 'example-host', scope }, adminCapability: 'firewall.admin', authorizeAdmin: () => true,
    operations: [{ id: 'noop', kind: 'cpu', capability: 'work', effect: 'read-only', files: { read: [], write: [] }, networkOrigins: [], check: () => true, execute: (x) => x }],
    policy: {
        mode: 'enforce', rules: [{ id: 'allow', decision: 'allow', operationIds: ['noop'] }], capabilities: ['work'], bots: [],
        providers: { ids: [], localities: [] }, files: { read: [], write: [] }, network: { origins: [] },
        limits: { maxConcurrent: 1, maxOperations: 10, maxTokens: 0, maxCostUSD: 0, timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 }, audit: { required: false },
    },
});

// --- The registry -------------------------------------------------------------------------------------
const store = new InMemoryModelRegistryStore(); // Isolated: this instance's maps only; gone when the process exits.
const options = {
    registryId: 'xor-classifier', owner, issuer: 'example-host', store, jay, firewall: firewall.runtime,
    trustedEvaluators: [{ id: 'xor-evaluator', version: '1' }],
    separationOfDuties: true,
    authorize: (root, action) => ((roles[jay.assertActive(root, signal()).principal.id] ?? []).includes(action) ? actor(jay.assertActive(root, signal()).principal.id) : null),
    checkAuthorization: () => true,
    approvals: { record: (approval, digest) => (approvalJournal.set(digest, approval), true), confirm: (_approval, digest) => approvalJournal.has(digest) },
};
const alice = await login('alice'), bob = await login('bob'), carol = await login('carol');
const registry = await createModelRegistry(options, alice, signal());
const revision = () => registry.snapshot().revision;

// --- Candidates: trained offline; the registry stores them byte-for-byte ------------------------------
const x = [[0, 0], [0, 1], [1, 0], [1, 1]], y = [[0], [1], [1], [0]];
const untrained = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 }).toJSON();
const good = trainOfflineCandidate(untrained, x, y, { epochs: 2000, learningRate: 0.5, batchSize: 4 }).model;
const register = (versionId, model, configuration) => registry.register(alice, {
    expectedRevision: revision(), modelId: 'xor', versionId, artifact: { model, configuration },
    training: { method: 'offline', options: { epochs: 2000, learningRate: 0.5 }, seed: 42 },
}, signal());

// --- Evidence: an S02 suite, scored by a host evaluator that runs the stored model --------------------
const suite = await createBenchmarkSuite({
    id: 'xor-suite', suiteVersion: '1.0.0', owner, dataset: { id: 'xor-cases', version: 1 },
    cases: [
        ...x.map((input, i) => ({ id: `xor-${i}`, domain: 'reasoning', input, label: { method: 'fields', fields: [{ path: ['class'], equals: y[i][0] }] }, provenance: { origin: 'computed' } })),
        { id: 'deny-admin', domain: 'permission', input: { permission: 'firewall.admin' }, label: { decision: 'deny' }, provenance: { origin: 'host' } },
    ],
});
const evaluator = {
    id: 'xor-evaluator', version: '1', kind: 'deterministic',
    async evaluate({ domain, input, configuration }) {
        const usage = { inputTokens: 0, outputTokens: 0, costUSD: 0, verified: true };
        if (domain === 'permission') return { completed: true, valid: true, actual: { decision: input.permission === 'firewall.admin' ? 'deny' : 'allow' }, usage };
        // The baseline before any activation has no model; candidates load their exact stored artifact.
        if (configuration.id === 'none') return { completed: true, valid: true, actual: { class: -1 }, usage };
        const { artifact } = await registry.loadVersion(configuration.version, signal());
        const net = NeuralNet.fromJSON(artifact.model);
        const threshold = artifact.configuration.threshold;
        return { completed: true, valid: true, actual: { class: Number(net.predict(input)[0] >= threshold) }, usage };
    },
};
async function evaluate(versionId) {
    const active = registry.snapshot().active;
    const baseline = active ? registry.benchmarkConfiguration(active, 'baseline') : { role: 'baseline', id: 'none', version: '0' };
    const run = (configuration) => runBenchmark(suite, evaluator, { owner, configuration, signal: signal() });
    return registry.evaluate(alice, versionId, { expectedRevision: revision(), suite, baseline: await run(baseline), candidate: await run(registry.benchmarkConfiguration(versionId, 'candidate')) }, signal());
}
async function promote(versionId) {
    await registry.approve(bob, versionId, { expectedRevision: revision() }, signal()); // a different person approves
    return registry.activate(carol, versionId, { expectedRevision: revision() }, signal()); // and a third activates
}

await register('v1', good, { threshold: 0.5 });
console.log('v1 evaluated:', (await evaluate('v1')).state);
console.log('v1 activated:', (await promote('v1')).state);

await register('v2', good, { threshold: 0.4 });
await evaluate('v2');
console.log('v2 activated, previous:', (await promote('v2')).previous);

// An untrained network fails the suite and is rejected; it can never be approved or activated.
await register('v3', untrained, { threshold: 0.5 });
const failed = await evaluate('v3');
console.log('v3:', failed.state, failed.reasons.join(', '));

// Rollback restores the previous verified version.
const rolled = await registry.rollback(carol, { expectedRevision: revision() }, signal());
console.log('rolled back to:', rolled.versionId, '| v2 is now', registry.version('v2').state);

// Host restart: a new registry instance on the same store sees the same state and verifies the artifact.
const restarted = await openModelRegistry(options, signal());
const active = await restarted.loadActive(signal());
const net = NeuralNet.fromJSON(active.artifact.model);
console.log(JSON.stringify({
    active: active.versionId,
    predictions: x.map((row) => Number(net.predict(row)[0] >= active.artifact.configuration.threshold)),
    states: Object.fromEntries(restarted.snapshot().versions.map((v) => [v.versionId, v.state])),
    audit: (await restarted.audit(signal())).map((e) => e.action),
    integrity: (await restarted.verify(signal())).ok,
}, null, 2));
await restarted.close();
await registry.close();
