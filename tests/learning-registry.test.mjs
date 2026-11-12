// SARASWATI S04: durable model lifecycle, approval and rollback.
// R1-R13 follow the S04 phase prompt (step 9); R14-R18 cover the remaining gates. Offline and deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    NeuralNet, EvaluatedModelUpdates, InMemoryModelRegistryStore, ModelRegistryError, MODEL_STATES, MODEL_TRANSITIONS,
    canonicalLearningJSON, sha256Text, createBenchmarkSuite, createSpecialistSystem, curateDataset,
} from 'shivax';
import * as learning from 'shivax/learning';
import {
    OWNER, OTHER, NOW, DAY, signal, actorRef, makeHost, newRegistry, baseModel, trained, rev, register, evidence, evaluate, promote,
    faultyStore, TempFileRegistryStore, realFirewall, createModelRegistry, openModelRegistry, mockFirewall,
} from './fixtures/model-registry.mjs';
import { suiteInput, benchmarkCases } from './fixtures/benchmark-suite.mjs';
import { governed, attest, policy as curationPolicy, hooks as curationHooks } from './fixtures/governed-feedback.mjs';

const code = (expected) => (error) => {
    assert.ok(error instanceof ModelRegistryError, `expected ModelRegistryError, got ${error?.stack ?? error}`);
    assert.equal(error.code, expected, error.message);
    return true;
};
/** Rewrites the stored head through the raw store, recomputing its checksum (what an attacker with store access can do). */
async function tamperHead(store, edit) {
    const head = JSON.parse(await store.readHead(signal()));
    const expected = head.revision;
    edit(head);
    head.revision = expected + 1;
    head.lastOperation.revision = expected + 1;
    const { checksum: _c, signature: _s, ...body } = head;
    head.checksum = await sha256Text(canonicalLearningJSON(body));
    if (!(await store.compareAndSwapHead(expected, canonicalLearningJSON(head), expected + 1, () => {}, signal()))) throw new Error('tamper failed');
    return head;
}
async function rawHead(store) { return JSON.parse(await store.readHead(signal())); }

test('R1 candidate creation: verified manifest, unchanged weights, dataset and lineage references', async () => {
    const { host, registry, alice } = await newRegistry();
    assert.equal(rev(registry), 1);
    const model = trained(3);
    const result = await register(registry, alice, 'v1', { model, configuration: { threshold: 0.7 } });
    assert.deepEqual({ ...result }, { revision: 2, versionId: 'v1', state: 'candidate', previous: null });
    const loaded = await registry.loadVersion('v1', signal());
    assert.deepEqual(loaded.artifact.model, NeuralNet.fromJSON(model).toJSON(), 'weights are stored exactly');
    assert.deepEqual(loaded.artifact.model.parameters, model.parameters);
    assert.deepEqual(NeuralNet.fromJSON(loaded.artifact.model).predict([1, 0]), NeuralNet.fromJSON(model).predict([1, 0]));
    const m = loaded.manifest;
    assert.equal(m.modelId, 'digits');
    assert.equal(m.sequence, 1);
    assert.deepEqual(m.owner, OWNER);
    assert.equal(m.artifact.modelFormat, 'shivax-neural-net@1');
    assert.deepEqual(m.artifact.architecture, { layers: [2, 4, 1], task: 'binary', activation: 'tanh' });
    assert.equal(m.artifact.digest, await sha256Text(canonicalLearningJSON(loaded.artifact)));
    assert.equal(m.createdBy, actorRef('alice'));
    assert.equal(m.createdAt, NOW);
    assert.deepEqual(m.training, { method: 'offline', options: { epochs: 20 }, seed: 1, parent: null });
    // Configuration-only version and lineage to a parent version.
    await registry.register(alice, { expectedRevision: rev(registry), modelId: 'digits', versionId: 'cfg', artifact: { model: null, configuration: { routing: 'strict' } }, training: { method: 'external', parentVersionId: 'v1' } }, signal());
    const cfg = await registry.loadVersion('cfg', signal());
    assert.equal(cfg.manifest.artifact.modelFormat, 'none');
    assert.deepEqual(cfg.manifest.training.parent, { versionId: 'v1', manifest: registry.version('v1').manifest });
    // S01 dataset manifest: verified and referenced by digest.
    const records = ['a', 'b', 'c', 'd'].map((id) => governed(id));
    const curated = await curateDataset(records, await Promise.all(records.map((r) => attest(r))), curationPolicy({ ratios: { train: 1, validation: 0, heldOut: 1 } }), curationHooks(), signal());
    await register(registry, alice, 'with-data', { dataset: curated.manifest });
    const withData = await registry.loadVersion('with-data', signal());
    assert.deepEqual({ id: withData.manifest.dataset.id, version: withData.manifest.dataset.version, digest: withData.manifest.dataset.digest },
        { id: curated.manifest.id, version: curated.manifest.datasetVersion, digest: curated.manifest.digest });
    // Invalid registrations change nothing.
    const before = rev(registry);
    const bad = [
        [{ model: { format: 'not-a-model' } }, 'invalid-input'],
        [{ dataset: { ...curated.manifest, digest: 'sha256:' + '0'.repeat(64) } }, 'invalid-input'],
        [{ dataset: { ...curated.manifest, owner: OTHER } }, 'invalid-input'],
        [{ training: { method: 'magic' } }, 'invalid-input'],
        [{ training: { method: 'offline', parentVersionId: 'missing' } }, 'invalid-input'],
        [{ configuration: { blob: 'x'.repeat(70_000) } }, 'invalid-input'],
    ];
    for (const [extra, expected] of bad) await assert.rejects(register(registry, alice, `bad-${expected}-${bad.indexOf(bad.find((b) => b[0] === extra))}`, extra), code(expected));
    await assert.rejects(register(registry, alice, 'v1'), code('invalid-input'), 'duplicate version id');
    await assert.rejects(registry.register(alice, { expectedRevision: 1, modelId: 'digits', versionId: 'stale', artifact: { model: null }, training: { method: 'offline' } }, signal()), code('conflict'));
    assert.equal(rev(registry), before);
    assert.equal(host.approvals.size, 0);
});

test('R2 evaluation transition: evidence is verified and bound to the exact version and the active baseline', async () => {
    const { registry, alice } = await newRegistry();
    await register(registry, alice, 'v1');
    await register(registry, alice, 'v2');
    // A report produced for v2 cannot evaluate v1.
    const wrong = await evidence(registry, 'v2');
    await assert.rejects(registry.evaluate(alice, 'v1', { expectedRevision: rev(registry), ...wrong }, signal()), (e) => code('evidence-rejected')(e) && e.reasons.includes('candidate-binding'));
    // Untrusted evaluators, model judges and suites without security cases are evidence problems, not verdicts.
    await assert.rejects(evaluate(registry, alice, 'v1', { evaluatorId: 'other-evaluator' }), (e) => code('evidence-rejected')(e) && e.reasons.includes('untrusted-evaluator'));
    const noSecurity = await createBenchmarkSuite(suiteInput({ cases: benchmarkCases().filter((c) => c.domain === 'routing') }));
    await assert.rejects(evaluate(registry, alice, 'v1', { suite: noSecurity }), (e) => code('evidence-rejected')(e) && e.reasons.includes('no-security-cases'));
    await assert.rejects(registry.evaluate(alice, 'v1', { expectedRevision: rev(registry), suite: { bad: true }, baseline: {}, candidate: {} }, signal()), code('evidence-rejected'));
    assert.equal(registry.version('v1').state, 'candidate');
    const result = await evaluate(registry, alice, 'v1');
    assert.equal(result.state, 'evaluated');
    assert.equal(result.eligible, true);
    assert.equal(registry.version('v1').evaluation, result.evaluation);
    // Once v1 is active, v2's baseline must be v1: an unbound baseline is stale.
    await registry.approve(alice, 'v1', { expectedRevision: rev(registry) }, signal());
    await registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal());
    await assert.rejects(evaluate(registry, alice, 'v2', { baselineConfig: { role: 'baseline', id: 'initial', version: '0' } }), (e) => code('evidence-rejected')(e) && e.reasons.includes('baseline-binding'));
    assert.equal((await evaluate(registry, alice, 'v2')).state, 'evaluated');
    const report = await registry.verify(signal());
    assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test('R3 approval transition: only evaluated versions, host journal recording, separation of duties', async () => {
    const { host, registry, alice } = await newRegistry({ options: { separationOfDuties: true } });
    const bob = await host.login('bob'), carol = await host.login('carol');
    await register(registry, alice, 'v1');
    await assert.rejects(registry.approve(bob, 'v1', { expectedRevision: rev(registry) }, signal()), code('invalid-transition'), 'candidate cannot be approved');
    await evaluate(registry, alice, 'v1');
    await assert.rejects(registry.approve(alice, 'v1', { expectedRevision: rev(registry) }, signal()), code('unauthorized'), 'registrant cannot approve');
    const approved = await registry.approve(bob, 'v1', { expectedRevision: rev(registry) }, signal());
    assert.equal(approved.state, 'approved');
    const digest = registry.version('v1').approval;
    const record = host.approvals.get(digest);
    assert.ok(record, 'the host journal recorded the approval before commit');
    assert.equal(record.actorRef, actorRef('bob'));
    assert.equal(record.expiresAt, NOW + DAY);
    assert.deepEqual(record.firewall, { version: 1, mode: 'enforce' });
    assert.equal(record.activeAtApproval, null);
    await assert.rejects(registry.activate(bob, 'v1', { expectedRevision: rev(registry) }, signal()), code('unauthorized'), 'approver cannot activate');
    assert.equal((await registry.activate(carol, 'v1', { expectedRevision: rev(registry) }, signal())).state, 'active');
    // A host that refuses to record an approval blocks it.
    const refusing = await newRegistry({ options: { approvals: { record: () => false, confirm: () => true } } });
    await register(refusing.registry, refusing.alice, 'v1');
    await evaluate(refusing.registry, refusing.alice, 'v1');
    await assert.rejects(refusing.registry.approve(refusing.alice, 'v1', { expectedRevision: rev(refusing.registry) }, signal()), code('invalid-approval'));
    assert.equal(refusing.registry.version('v1').state, 'evaluated');
});

test('R4 rejected candidates: failed security benchmarks reject; rejected is terminal', async () => {
    const { registry, alice } = await newRegistry();
    await register(registry, alice, 'unsafe');
    const result = await evaluate(registry, alice, 'unsafe', { behavior: { allowAdmin: true } });
    assert.equal(result.state, 'rejected');
    assert.equal(result.eligible, false);
    // It fails a mandatory denial case the baseline passed: a violation, a security regression and an overall drop.
    assert.deepEqual([...result.reasons], ['below-minimum', 'mandatory-case-failed', 'regression', 'security-regression', 'security-violation']);
    for (const op of [
        () => registry.approve(alice, 'unsafe', { expectedRevision: rev(registry) }, signal()),
        () => registry.activate(alice, 'unsafe', { expectedRevision: rev(registry) }, signal()),
        () => evaluate(registry, alice, 'unsafe'),
        () => registry.reject(alice, 'unsafe', { expectedRevision: rev(registry) }, signal()),
    ])
        await assert.rejects(op(), code('invalid-transition'));
    // Explicit rejection by an administrator, with an opaque reason code.
    await register(registry, alice, 'v2');
    await evaluate(registry, alice, 'v2');
    assert.equal((await registry.reject(alice, 'v2', { expectedRevision: rev(registry), reason: 'business-review' }, signal())).state, 'rejected');
    const audit = await registry.audit(signal());
    assert.deepEqual(audit.at(-1).reasons, ['business-review']);
    assert.deepEqual(audit.find((e) => e.versionId === 'unsafe' && e.action === 'evaluate').reasons, ['below-minimum', 'mandatory-case-failed', 'regression', 'security-regression', 'security-violation']);
    // An active version must be rolled back before it can be rejected.
    await promote(registry, alice, 'v3');
    await assert.rejects(registry.reject(alice, 'v3', { expectedRevision: rev(registry) }, signal()), code('invalid-transition'));
    assert.deepEqual(MODEL_TRANSITIONS.rejected, []);
    assert.ok(!MODEL_TRANSITIONS.candidate.includes('active') && !MODEL_TRANSITIONS.evaluated.includes('active'));
    assert.deepEqual([...MODEL_STATES], ['candidate', 'evaluated', 'approved', 'active', 'rejected', 'rolled_back']);
});

test('R5 activation: approved only, atomic swap, superseded version stays a rollback target, verified load', async () => {
    const { registry, alice } = await newRegistry();
    await register(registry, alice, 'v1');
    await assert.rejects(registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal()), code('invalid-transition'), 'candidate → active is impossible');
    await evaluate(registry, alice, 'v1');
    await assert.rejects(registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal()), code('invalid-transition'), 'evaluated → active is impossible');
    await registry.approve(alice, 'v1', { expectedRevision: rev(registry) }, signal());
    const first = await registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal());
    assert.deepEqual({ ...first }, { revision: rev(registry), versionId: 'v1', state: 'active', previous: null });
    const second = await promote(registry, alice, 'v2');
    assert.equal(second.previous, 'v1');
    const snap = registry.snapshot();
    assert.equal(snap.active, 'v2');
    assert.deepEqual([...snap.activations], ['v1']);
    assert.equal(registry.version('v1').state, 'approved');
    const active = await registry.loadActive(signal());
    assert.equal(active.versionId, 'v2');
    assert.equal(active.manifestDigest, registry.version('v2').manifest);
    assert.deepEqual(NeuralNet.fromJSON(active.artifact.model).toJSON(), active.artifact.model);
    const last = (await registry.audit(signal())).at(-1);
    assert.equal(last.action, 'activate');
    assert.deepEqual(last.displaced, { versionId: 'v1', from: 'active', to: 'approved' });
    assert.equal(last.active, 'v2');
});

test('R6 rollback restores a verified previous version and preserves tenant, audit, security and approval rules', async () => {
    const { host, registry, alice } = await newRegistry();
    await promote(registry, alice, 'v1');
    await promote(registry, alice, 'v2');
    await promote(registry, alice, 'v3');
    const before = await registry.audit(signal());
    const rolled = await registry.rollback(alice, { expectedRevision: rev(registry) }, signal());
    assert.deepEqual({ ...rolled }, { revision: rev(registry), versionId: 'v2', state: 'active', previous: 'v3' });
    assert.equal(registry.version('v3').state, 'rolled_back');
    assert.equal((await registry.loadActive(signal())).versionId, 'v2');
    assert.deepEqual([...registry.snapshot().activations], ['v1']);
    const after = await registry.audit(signal(), { limit: 1000 });
    assert.deepEqual(after.slice(0, before.length), before, 'audit history is preserved, only appended');
    assert.deepEqual(after.at(-1).displaced, { versionId: 'v3', from: 'active', to: 'rolled_back' });
    // A revoked approval cannot be restored by rollback.
    host.revokedApprovals.add(registry.version('v1').approval);
    await assert.rejects(registry.rollback(alice, { expectedRevision: rev(registry), targetVersionId: 'v1' }, signal()), code('invalid-approval'));
    host.revokedApprovals.clear();
    // Only previously active, approved versions are targets.
    await assert.rejects(registry.rollback(alice, { expectedRevision: rev(registry), targetVersionId: 'v3' }, signal()), code('invalid-transition'));
    // Lockdown blocks rollback unless the host explicitly allows it.
    host.firewall.mode = 'lockdown';
    await assert.rejects(registry.rollback(alice, { expectedRevision: rev(registry) }, signal()), code('lockdown'));
    host.firewall.mode = 'enforce';
    // A rolled-back version needs new evidence and a new approval before it can return.
    await assert.rejects(registry.approve(alice, 'v3', { expectedRevision: rev(registry) }, signal()), code('invalid-transition'));
    assert.equal((await evaluate(registry, alice, 'v3')).state, 'evaluated');
    // Unauthorized and cross-tenant administrators cannot roll back.
    const mallory = await host.login('mallory');
    await assert.rejects(registry.rollback(mallory, { expectedRevision: rev(registry) }, signal()), code('unauthorized'));
    const outsider = await host.login('alice', { scope: OTHER });
    await assert.rejects(registry.rollback(outsider, { expectedRevision: rev(registry) }, signal()), code('cross-tenant'));
    // Explicit target, and rollback with lockdown allowed by host policy.
    const allowed = await newRegistry({ options: { allowRollbackDuringLockdown: true } });
    await promote(allowed.registry, allowed.alice, 'a');
    await promote(allowed.registry, allowed.alice, 'b');
    allowed.host.firewall.mode = 'lockdown';
    assert.equal((await allowed.registry.rollback(allowed.alice, { expectedRevision: rev(allowed.registry), targetVersionId: 'a' }, signal())).versionId, 'a');
    await assert.rejects(allowed.registry.rollback(allowed.alice, { expectedRevision: rev(allowed.registry) }, signal()), code('invalid-transition'), 'nothing left to roll back to');
});

test('R7 restart recovery: state survives, ambiguous commits resolve deterministically, interrupted writes are safe', async () => {
    const store = new InMemoryModelRegistryStore();
    const { host, registry, alice } = await newRegistry({ store });
    await promote(registry, alice, 'v1');
    await promote(registry, alice, 'v2');
    const before = registry.snapshot();
    await registry.close();
    await assert.rejects(registry.refresh(signal()), code('closed'));
    // Host restart: a new process opens the same store.
    const reopened = await openModelRegistry(host.options, signal());
    assert.deepEqual(reopened.snapshot(), before);
    assert.equal((await reopened.loadActive(signal())).versionId, 'v2');
    // Ambiguous acknowledgement: the store commits, then reports a failure. The registry reads the head and finds its operation.
    let once = true;
    const ambiguous = faultyStore(store, { compareAndSwapHead: async (...args) => { const next = args.at(-1); const ok = await next(); if (once) { once = false; throw new Error('connection reset'); } return ok; } });
    const a = await openModelRegistry({ ...host.options, store: ambiguous }, signal());
    const committed = await register(a, alice, 'v3');
    assert.equal(committed.state, 'candidate');
    assert.equal((await openModelRegistry(host.options, signal())).version('v3').state, 'candidate');
    // A failure before commit is reported as such and changes nothing.
    const failing = faultyStore(store, { compareAndSwapHead: async () => { throw new Error('disk full'); } });
    const f = await openModelRegistry({ ...host.options, store: failing }, signal());
    const revision = rev(f);
    await assert.rejects(register(f, alice, 'v4'), (e) => code('storage-unavailable')(e) && !e.message.includes('disk full'));
    assert.equal(rev(await openModelRegistry(host.options, signal())), revision);
    // Interrupted object write: the first put is torn; the registry detects it by checksum and rewrites.
    const objects = new Map();
    let torn = true;
    const tearing = { ...faultyStore(store), putObject: async (key, text) => { objects.set(key, torn ? text.slice(0, 10) : text); torn = false; }, getObject: async (key, s) => objects.get(key) ?? store.getObject(key, s) };
    const t = await openModelRegistry({ ...host.options, store: { ...tearing, compareAndSwapHead: async (...x) => { for (const [k, v] of objects) await store.putObject(k, v, signal()); return store.compareAndSwapHead(...x); } } }, signal());
    assert.equal((await register(t, alice, 'v5')).state, 'candidate');
    // Orphaned objects from an aborted change are ignored; missing heads are never recreated silently.
    await assert.rejects(openModelRegistry({ ...host.options, store: new InMemoryModelRegistryStore() }, signal()), code('registry-missing'));
    await assert.rejects(createModelRegistry(host.options, alice, signal()), code('registry-exists'));
    // Partial activation: the head swap is the activation. After restart, the host builds its runtime from loadActive.
    const final = await openModelRegistry(host.options, signal());
    assert.equal((await final.loadActive(signal())).versionId, 'v2');
});

test('R8 corrupt storage: head, manifests, artifacts, journal and files on disk fail closed', async () => {
    const store = new InMemoryModelRegistryStore();
    const { host, registry, alice } = await newRegistry({ store });
    await promote(registry, alice, 'v1');
    await promote(registry, alice, 'v2');
    // Head edited without fixing its checksum.
    const broken = faultyStore(store, { readHead: async (s, next) => (await next()).replace('"approved"', '"active"') });
    await assert.rejects(openModelRegistry({ ...host.options, store: broken }, signal()), code('corrupt-registry'));
    await assert.rejects(openModelRegistry({ ...host.options, store: faultyStore(store, { readHead: async () => '{"format":' }) }, signal()), code('corrupt-registry'));
    // A corrupted manifest or artifact object is detected by checksum.
    const v2 = registry.version('v2');
    const manifestKey = v2.manifest;
    const artifactKey = (await registry.loadVersion('v2', signal())).manifest.artifact.digest;
    const corrupted = faultyStore(store, { getObject: async (key, s, next) => (key === artifactKey ? (await next()).replace('0', '1') : next()) });
    const c = await openModelRegistry({ ...host.options, store: corrupted }, signal());
    await assert.rejects(c.loadActive(signal()), code('checksum-mismatch'));
    const report = await c.verify(signal());
    assert.equal(report.ok, false);
    assert.deepEqual(report.issues.map((i) => [i.versionId, i.object, i.problem]), [['v2', 'artifact', 'checksum-mismatch']]);
    // Missing objects: the active manifest is gone. Reads fail closed; health says so; rollback to a verified version repairs.
    const missing = faultyStore(store, { getObject: async (key, s, next) => (key === manifestKey ? null : next()) });
    const m = await openModelRegistry({ ...host.options, store: missing }, signal());
    assert.equal(m.snapshot().health.active, 'unavailable');
    await assert.rejects(m.loadActive(signal()), code('object-missing'));
    await m.rollback(alice, { expectedRevision: rev(m) }, signal());
    assert.equal((await m.loadActive(signal())).versionId, 'v1');
    // A missing journal tip blocks every change until the journal is restored.
    const tip = (await rawHead(store)).journal.tip;
    const noJournal = await openModelRegistry({ ...host.options, store: faultyStore(store, { getObject: async (key, s, next) => (key === tip ? null : next()) }) }, signal());
    assert.equal(noJournal.snapshot().health.journal, 'unavailable');
    await assert.rejects(register(noJournal, alice, 'v9'), code('corrupt-registry'));
    // Another tenant's registry in this store is refused.
    await assert.rejects(openModelRegistry({ ...host.options, owner: OTHER }, signal()), code('cross-tenant'));
    await assert.rejects(openModelRegistry({ ...host.options, registryId: 'other-slot' }, signal()), code('cross-tenant'));
    // Real files: delete and truncate on disk.
    const dir = await mkdtemp(join(tmpdir(), 'shivax-registry-'));
    try {
        const fileStore = new TempFileRegistryStore(dir);
        const disk = await newRegistry({ store: fileStore });
        await promote(disk.registry, disk.alice, 'd1');
        const reopened = await openModelRegistry(disk.host.options, signal());
        assert.equal((await reopened.loadActive(signal())).versionId, 'd1');
        const artifact = (await reopened.loadActive(signal())).manifest.artifact.digest;
        await unlink(fileStore.file(artifact));
        await assert.rejects(reopened.loadActive(signal()), code('object-missing'));
        assert.deepEqual((await reopened.verify(signal())).issues.map((i) => i.problem), ['missing']);
        await writeFile(join(dir, 'head.json'), '{"format":"shivax-model-registry"', 'utf8');
        await assert.rejects(openModelRegistry(disk.host.options, signal()), code('corrupt-registry'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('R9 stale and forged approvals are rejected', async () => {
    const { host, registry, alice } = await newRegistry();
    const approveOnly = async (id) => {
        await register(registry, alice, id);
        await evaluate(registry, alice, id);
        await registry.approve(alice, id, { expectedRevision: rev(registry) }, signal());
    };
    // Expired.
    await approveOnly('v1');
    host.clock.advance(DAY);
    await assert.rejects(registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal()), code('stale-approval'));
    // Old evidence cannot be approved.
    await register(registry, alice, 'old');
    await evaluate(registry, alice, 'old');
    host.clock.advance(8 * DAY);
    await assert.rejects(registry.approve(alice, 'old', { expectedRevision: rev(registry) }, signal()), code('stale-evidence'));
    // The active version changed after approval.
    await promote(registry, alice, 'base');
    await approveOnly('v2');
    await approveOnly('v3');
    await registry.activate(alice, 'v2', { expectedRevision: rev(registry) }, signal());
    await assert.rejects(registry.activate(alice, 'v3', { expectedRevision: rev(registry) }, signal()), code('stale-approval'));
    // The firewall policy changed after approval.
    await approveOnly('v4');
    host.firewall.version = 2;
    await assert.rejects(registry.activate(alice, 'v4', { expectedRevision: rev(registry) }, signal()), code('stale-approval'));
    // The registry's security settings changed after approval (a host restart with a weaker policy).
    const weaker = await openModelRegistry({ ...host.options, policy: { format: 'shivax-benchmark-policy', version: 1, id: 'relaxed', minimumPassRate: { overall: 0.5 } } }, signal());
    await approveOnly('v5');
    await assert.rejects(weaker.activate(alice, 'v5', { expectedRevision: (await weaker.refresh(signal())).revision }, signal()), code('stale-approval'));
    // Forged approval: a well-formed approval object swapped into the head by someone with store access.
    const real = host.approvals.get(registry.version('v5').approval);
    const forged = canonicalLearningJSON({ ...real, nonce: 'f'.repeat(32), expiresAt: real.expiresAt + 30 * DAY });
    const forgedKey = await sha256Text(forged);
    await host.store.putObject(forgedKey, forged, signal());
    await tamperHead(host.store, (head) => { head.versions.find((v) => v.versionId === 'v5').approval = forgedKey; });
    await assert.rejects(registry.activate(alice, 'v5', { expectedRevision: rev(await openModelRegistry(host.options, signal())) }, signal()), code('invalid-approval'));
    // With a host signer, the same head tampering is refused outright.
    const keyring = { sign: (c) => `sig:${c}`, verify: (c, s) => s === `sig:${c}` };
    const signed = await newRegistry({ options: { signer: keyring } });
    await register(signed.registry, signed.alice, 's1');
    // The attacker can recompute the checksum but not the signature, which still covers the old content.
    await tamperHead(signed.host.store, (head) => { head.versions[0].modelId = 'other-model'; });
    await assert.rejects(openModelRegistry(signed.host.options, signal()), code('corrupt-registry'));
});

test('R10 concurrent promotion: exactly one activation wins, in one process and across processes', async () => {
    const { host, registry, alice } = await newRegistry();
    await promote(registry, alice, 'base');
    for (const id of ['a', 'b', 'c', 'd']) {
        await register(registry, alice, id);
        await evaluate(registry, alice, id);
        await registry.approve(alice, id, { expectedRevision: rev(registry) }, signal());
    }
    const r0 = rev(registry);
    const same = await Promise.allSettled([registry.activate(alice, 'a', { expectedRevision: r0 }, signal()), registry.activate(alice, 'b', { expectedRevision: r0 }, signal())]);
    assert.deepEqual(same.map((s) => s.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(same.find((s) => s.status === 'rejected').reason.code, 'conflict');
    assert.equal(rev(registry), r0 + 1);
    // Two processes (two registry instances) on the same store. c and d are re-approved against the new active version.
    for (const id of ['c', 'd']) {
        await evaluate(registry, alice, id);
        await registry.approve(alice, id, { expectedRevision: rev(registry) }, signal());
    }
    const other = await openModelRegistry(host.options, signal());
    const r1 = rev(registry);
    const winner = registry.snapshot().active;
    const racing = await Promise.allSettled([registry.activate(alice, 'c', { expectedRevision: r1 }, signal()), other.activate(alice, 'd', { expectedRevision: r1 }, signal())]);
    assert.equal(racing.filter((s) => s.status === 'fulfilled').length, 1);
    assert.ok(racing.some((s) => s.status === 'rejected' && ['conflict', 'stale-approval'].includes(s.reason.code)));
    const final = await openModelRegistry(host.options, signal());
    assert.equal(final.snapshot().versions.filter((v) => v.state === 'active').length, 1);
    assert.notEqual(final.snapshot().active, winner);
    assert.equal(rev(final), r1 + 1);
    assert.equal((await final.verify(signal())).ok, true);
});

test('R11 cross-tenant access is refused at every boundary', async () => {
    const { host, registry, alice } = await newRegistry();
    const outsider = await host.login('alice', { scope: OTHER });
    await assert.rejects(register(registry, outsider, 'x'), code('cross-tenant'));
    const otherIssuer = await host.login('alice', { issuer: 'other-idp' });
    await assert.rejects(register(registry, otherIssuer, 'x'), code('unauthorized'));
    await register(registry, alice, 'v1');
    const foreignSuite = await createBenchmarkSuite(suiteInput({ owner: OTHER }));
    await assert.rejects(evaluate(registry, alice, 'v1', { suite: foreignSuite }), code('cross-tenant'));
    // The other tenant's registry, with the same store wiring mistake, is refused on open.
    const otherHost = makeHost({ store: host.store, owner: OTHER });
    await assert.rejects(openModelRegistry(otherHost.options, signal()), code('cross-tenant'));
    // An S01 dataset curated for another tenant cannot be referenced.
    const records = ['a', 'b'].map((id) => governed(id));
    const curated = await curateDataset(records, await Promise.all(records.map((r) => attest(r))), curationPolicy({ ratios: { train: 1, validation: 0, heldOut: 1 } }), curationHooks(), signal());
    const foreign = await newRegistry({ owner: OTHER });
    const otherAdmin = await foreign.host.login('alice', { scope: OTHER });
    await assert.rejects(register(foreign.registry, otherAdmin, 'v1', { dataset: curated.manifest }), code('cross-tenant'));
    assert.equal(registry.version('x'), null);
});

test('R12 firewall lockdown during promotion stops approval and activation, including mid-commit', async () => {
    const host = makeHost();
    const fw = await realFirewall(host);
    host.options.firewall = fw.firewall.runtime;
    const alice = await host.login('alice');
    const registry = await createModelRegistry(host.options, alice, signal());
    await register(registry, alice, 'v1');
    await evaluate(registry, alice, 'v1');
    await registry.approve(alice, 'v1', { expectedRevision: rev(registry) }, signal());
    await fw.lockdown();
    assert.equal(fw.firewall.runtime.status().mode, 'lockdown');
    await assert.rejects(registry.activate(alice, 'v1', { expectedRevision: rev(registry) }, signal()), code('lockdown'));
    await register(registry, alice, 'v2');
    await evaluate(registry, alice, 'v2');
    await assert.rejects(registry.approve(alice, 'v2', { expectedRevision: rev(registry) }, signal()), code('lockdown'));
    assert.equal(registry.snapshot().active, null);
    // Lockdown that lands inside the store's commit window: the last check before the durable write stops it.
    const mock = mockFirewall();
    const store = new InMemoryModelRegistryStore();
    const late = await newRegistry({ firewall: mock, store: faultyStore(store, { compareAndSwapHead: async (e, t, n, check, s, next) => { if (e === 4) mock.mode = 'lockdown'; return next(); } }) });
    await register(late.registry, late.alice, 'v1');
    await evaluate(late.registry, late.alice, 'v1');
    await late.registry.approve(late.alice, 'v1', { expectedRevision: rev(late.registry) }, signal());
    const before = rev(late.registry);
    await assert.rejects(late.registry.activate(late.alice, 'v1', { expectedRevision: before }, signal()), code('lockdown'));
    assert.equal(JSON.parse(await store.readHead(signal())).revision, before);
    assert.equal(JSON.parse(await store.readHead(signal())).active, null);
});

test('R13 cancellation and timeouts leave no partial change; an interrupted swap is resolved on the next operation', async () => {
    const store = new InMemoryModelRegistryStore();
    let slowPut = false, gate = null;
    const slow = faultyStore(store, {
        putObject: async (k, t, s, next) => {
            if (slowPut) await new Promise((resolve, reject) => s.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
            return next();
        },
        compareAndSwapHead: async (...args) => {
            const next = args.at(-1);
            if (gate) {
                gate.entered();
                await gate.promise;
            }
            return next();
        },
    });
    const { host, registry, alice } = await newRegistry({ store: slow });
    const input = (versionId) => ({ expectedRevision: rev(registry), modelId: 'm', versionId, artifact: { model: null }, training: { method: 'offline' } });
    // Cancelled before it starts.
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(registry.register(alice, input('v0'), aborted.signal), code('cancelled'));
    // Cancelled while writing objects: no head change.
    slowPut = true;
    const controller = new AbortController();
    const pending = registry.register(alice, input('v1'), controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, code('cancelled'));
    slowPut = false;
    assert.equal(rev(await openModelRegistry(host.options, signal())), 1);
    // Timeout while writing objects.
    const timed = await openModelRegistry({ ...host.options, timeoutMs: 30 }, signal());
    slowPut = true;
    await assert.rejects(register(timed, alice, 'v2'), code('timeout'));
    slowPut = false;
    // Cancelled while the head swap is in flight: the caller learns the outcome is unknown. The store's
    // commit-time check() then refuses the write, and the next operation sees the settled state.
    let entered, release;
    const enteredSwap = new Promise((r) => (entered = r));
    gate = { entered, promise: new Promise((r) => (release = r)) };
    const c3 = new AbortController();
    const swap = registry.register(alice, input('v3'), c3.signal).catch((e) => e);
    await enteredSwap;
    c3.abort();
    const error = await swap;
    assert.ok(error instanceof ModelRegistryError);
    assert.equal(error.code, 'cancelled');
    assert.equal(error.outcome, 'unknown');
    gate = null;
    release();
    assert.equal((await register(registry, alice, 'v4')).state, 'candidate', 'the next change waits for the swap, then proceeds');
    const snap = registry.snapshot();
    assert.equal(registry.version('v3'), null, 'the aborted change was refused at commit');
    assert.equal(snap.revision, 2);
    assert.equal((await registry.verify(signal())).ok, true);
});

test('R14 authorization is fresh: revoked sessions, revoked roles at commit and copied contexts are refused', async () => {
    const { host, registry, alice } = await newRegistry();
    const mallory = await host.login('mallory');
    await assert.rejects(register(registry, mallory, 'v1'), code('unauthorized'));
    // Authorization comes before the revision check: a stale revision still reports unauthorized, not conflict.
    await assert.rejects(registry.register(mallory, { expectedRevision: 999, modelId: 'm', versionId: 'v1', artifact: { model: null }, training: { method: 'offline' } }, signal()), code('unauthorized'));
    await assert.rejects(register(registry, { ...alice }, 'v1'), code('unauthorized'), 'a copied context carries no authority');
    const bob = await host.login('bob');
    host.revokeSession('bob');
    await assert.rejects(register(registry, bob, 'v1'), code('unauthorized'));
    // Role revoked between authorization and commit: the commit fence refuses it.
    const carol = await host.login('carol');
    let calls = 0;
    const fenced = await openModelRegistry({ ...host.options, checkAuthorization: () => ++calls === 1 }, signal());
    await assert.rejects(register(fenced, carol, 'v1'), code('unauthorized'));
    assert.equal(rev(await openModelRegistry(host.options, signal())), 1);
    // Non-opaque actor references are refused (they could carry identity data into storage).
    const leaky = await openModelRegistry({ ...host.options, authorize: () => 'alice@example.com' }, signal());
    await assert.rejects(register(leaky, alice, 'v1'), code('unauthorized'));
});

test('R15 configuration is validated; the store contract is enforced by the reference store', async () => {
    const host = makeHost();
    const alice = await host.login('alice');
    const bad = [
        { registryId: 'has space' }, { owner: { scopeKind: 'team', scopeId: 'x' } }, { store: {} }, { firewall: {} }, { approvals: { record() {} } },
        { trustedEvaluators: [] }, { policy: { format: 'x' } }, { approvalTtlMs: 0 }, { supportedFormats: ['onnx'] }, { signer: { sign() {} } }, { timeoutMs: 0 },
        { maxVersions: 1_025 },
    ];
    for (const change of bad) await assert.rejects(createModelRegistry({ ...host.options, ...change }, alice, signal()), code('invalid-configuration'), JSON.stringify(Object.keys(change)));
    const store = new InMemoryModelRegistryStore();
    const key = await sha256Text('a');
    await store.putObject(key, 'a', signal());
    await assert.rejects(store.putObject(key, 'b', signal()), code('checksum-mismatch'), 'content-addressed objects are never overwritten');
    await assert.rejects(store.putObject('not-a-key', 'a', signal()), code('invalid-input'));
    assert.equal(await store.compareAndSwapHead(5, '{}', 6, () => {}, signal()), false);
    // A runtime that does not support neural networks refuses to register one.
    const configOnly = await newRegistry({ options: { supportedFormats: ['none'] } });
    await assert.rejects(register(configOnly.registry, configOnly.alice, 'v1'), code('incompatible-model'));
    // A host compatibility check runs at approval.
    const picky = await newRegistry({ options: { checkCompatibility: () => false } });
    await register(picky.registry, picky.alice, 'v1');
    await evaluate(picky.registry, picky.alice, 'v1');
    await assert.rejects(picky.registry.approve(picky.alice, 'v1', { expectedRevision: rev(picky.registry) }, signal()), code('incompatible-model'));
});

test('R16 existing in-memory lifecycle, public APIs and bot ids are unchanged; registry exports are additive', async () => {
    const updates = new EvaluatedModelUpdates({ model: 1, configuration: 'old' });
    const data = [{ id: 'case', domain: 'reasoning', input: 0, expected: 2 }];
    const evaluateVersion = async (version) => ({ completed: true, valid: true, actual: version.model, modelCalls: 0, modelTokens: 0 });
    assert.equal((await updates.propose({ model: 2, configuration: 'new' }, data, evaluateVersion, () => true, signal())).accepted, true);
    assert.equal(await updates.rollback(() => true, signal()), true);
    assert.deepEqual(updates.active, { model: 1, configuration: 'old' });
    for (const name of ['createModelRegistry', 'openModelRegistry', 'InMemoryModelRegistryStore', 'ModelRegistryError', 'sha256Text'])
        assert.equal(typeof learning[name], 'function', name);
    for (const name of ['MODEL_STATES', 'MODEL_TRANSITIONS', 'MODEL_REGISTRY_ACTIONS', 'MODEL_REGISTRY_LIMITS', 'MODEL_REGISTRY_ERROR_CODES', 'MODEL_FORMATS'])
        assert.ok(learning[name], name);
    assert.deepEqual(createSpecialistSystem().registry.list().map((b) => b.id).sort(), ['brihaspati', 'chitragupt', 'ekalavy', 'narad', 'sanjay', 'vishwakarma', 'yudhishthir']);
});

test('R17 audit history is a verified hash chain covering every change', async () => {
    const { registry, alice } = await newRegistry();
    await promote(registry, alice, 'v1');
    await promote(registry, alice, 'v2');
    await registry.rollback(alice, { expectedRevision: rev(registry) }, signal());
    const entries = await registry.audit(signal(), { limit: 1000 });
    assert.deepEqual(entries.map((e) => e.action), ['create', 'register', 'evaluate', 'approve', 'activate', 'register', 'evaluate', 'approve', 'activate', 'rollback']);
    entries.forEach((e, i) => {
        assert.equal(e.sequence, i + 1);
        assert.equal(e.revision, i + 1);
        assert.equal(e.actorRef, actorRef('alice'));
    });
    assert.equal(entries[0].prev, null);
    for (let i = 1; i < entries.length; i++) assert.equal(entries[i].prev, await sha256Text(canonicalLearningJSON(entries[i - 1])));
    assert.deepEqual((await registry.audit(signal(), { limit: 2 })).map((e) => e.action), ['activate', 'rollback']);
    const integrity = await registry.verify(signal());
    assert.equal(integrity.ok, true);
    assert.ok(integrity.checkedObjects >= 20);
    // Nothing identifying is stored: actor references are opaque host tokens.
    assert.equal(JSON.stringify(entries).includes('alice@'), false);
});

test('R18 nothing deploys automatically: registration, evaluation and approval never change the active version', async () => {
    const { registry, alice } = await newRegistry();
    await promote(registry, alice, 'v1');
    await register(registry, alice, 'v2');
    await evaluate(registry, alice, 'v2');
    await registry.approve(alice, 'v2', { expectedRevision: rev(registry) }, signal());
    assert.equal(registry.snapshot().active, 'v1');
    assert.equal((await registry.loadActive(signal())).versionId, 'v1');
});
