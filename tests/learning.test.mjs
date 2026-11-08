import test from 'node:test';
import assert from 'node:assert/strict';
import { EVALUATION_DOMAINS, validateFeedback, exportTrainingData, evaluateDataset, EvaluatedModelUpdates, trainOfflineCandidate, NeuralNet, validateEvaluationRecord, validateTrainingExport, trainCuratedCandidate, createSpecialistSystem, Jay, PermissionPolicyRegistry, MemoryEngine, memoryNamespace, BotExecutor, createTaskContext, BrihaspatiBot, VishwakarmaBot, analyzeUI } from 'shivax';
import { learningCases } from './fixtures/learning-cases.mjs';
import { paired, measurement } from './fixtures/ui-analysis.mjs';
const signal = () => new AbortController().signal;
const feedback = { version: 1, id: 'feedback', taskId: 'task', botId: 'ekalavy', domain: 'routing', input: 1, output: 2, decision: 'accept' };
const datasets = EVALUATION_DOMAINS.map(domain => ({ id: domain, domain, input: domain, expected: domain }));
const observation = actual => ({ completed: true, valid: true, actual, modelCalls: 0, modelTokens: 0 });
test('feedback validates corrections and curated exports', () => {
    assert.throws(() => validateFeedback({ ...feedback, decision: 'correct' }));
    assert.equal(exportTrainingData([feedback], () => false).rows.length, 0);
    assert.equal(exportTrainingData([{ ...feedback, decision: 'correct', correction: 3 }], () => true).rows[0].expected, 3);
});
test('six evaluation domains repeat outcomes', async () => {
    const a = await evaluateDataset(datasets, async input => observation(input), signal());
    const b = await evaluateDataset(datasets, async input => observation(input), signal());
    assert.equal(a.accuracy, 1); assert.equal(a.securityPassRate, 1);
    assert.deepEqual(a.outcomes.map(o => o.passed), b.outcomes.map(o => o.passed));
});
test('evaluated activation and rollback restore model and configuration', async () => {
    const initial = { model: 1, configuration: 'old' }, next = { model: 2, configuration: 'new' };
    const updates = new EvaluatedModelUpdates(initial), data = [{ id: 'case', domain: 'reasoning', input: 0, expected: 2 }];
    const evaluate = async version => observation(version.model);
    assert.equal((await updates.propose(next, data, evaluate, () => false, signal())).accepted, false);
    assert.deepEqual(updates.active, initial);
    assert.equal((await updates.propose(next, data, evaluate, () => true, signal())).accepted, true);
    assert.equal(await updates.rollback(() => true, signal()), true); assert.deepEqual(updates.active, initial);
    assert.equal((await updates.propose(initial, data, evaluate, () => true, signal())).accepted, false);
});
test('offline training changes only an isolated candidate and rejects invalid numeric data', () => {
    const net = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 1 }), before = net.toJSON();
    const candidate = trainOfflineCandidate(before, [[0], [1]], [[0], [2]], { epochs: 20 });
    assert.equal(candidate.weightsUpdated, true); assert.notDeepEqual(candidate.model.parameters, before.parameters);
    assert.deepEqual(net.toJSON(), before);
    assert.throws(() => trainOfflineCandidate(before, [[NaN]], [[1]]));
});

async function securedFeedback({ approved = true, verified = true, permission = true } = {}) {
    const identity = { principal: { id: 'tester', issuer: 'test-host', permissions: permission ? ['feedback'] : [] },
        session: { id: 'session', principalId: 'tester', issuedAt: 1, expiresAt: 9999999999999, scope: { kind: 'personal', id: 'evaluation' } } };
    const jay = new Jay({ authenticate: () => identity, isSessionValid: () => true });
    const policies = new PermissionPolicyRegistry();
    for (const [kind, id] of [['capability', 'learning.feedback'], ['tool', 'shivax.memory.records.save']])
        policies.register({ kind, id, effect: 'state-changing', permissions: ['feedback'], validateInput: () => true });
    const memory = new MemoryEngine();
    const system = createSpecialistSystem({ memoryStore: memory, memoryServices: { verifyOutcome: () => verified }, security: { jay, policies, options: { approve: () => approved } } });
    const context = await jay.createContext({ id: 'feedback-task', input: { capability: 'learning.feedback', data: feedback } }, { signal: signal(), toolPermissions: ['shivax.memory.records.save'] });
    const result = await system.rudra.run(context);
    return { result, records: await memory.list(memoryNamespace(identity), {}, signal()) };
}
test('Ekalavy verified feedback requires host verification, permission and approval before Chitragupt persists it', async () => {
    for (const options of [{ approved: false }, { verified: false }, { permission: false }]) {
        const result = await securedFeedback(options); assert.notEqual(result.result.status, 'completed'); assert.equal(result.records.length, 0);
    }
    const allowed = await securedFeedback(); assert.equal(allowed.result.status, 'completed');
    assert.equal(allowed.records[0].category, 'verified-outcome'); assert.equal(allowed.records[0].trust, 'untrusted');
});
test('representative datasets exercise actual routing, explicit reasoning, code, visual, security and memory APIs', async () => {
    const registry = createSpecialistSystem().registry, executor = new BotExecutor(), store = new MemoryEngine();
    const ns = { principalId: 'tester', issuer: 'host', sessionId: 's', scopeKind: 'personal', scopeId: 'w' };
    await store.save(ns, { id: 'known', category: 'working', value: 'remembered' }, signal());
    const execute = (bot, capability, data) => executor.execute(bot, createTaskContext({ id: 'eval', input: { capability, data } }, {
        sessionId: 's', signal: signal(), security: { caller: { id: 'tester', issuer: 'host' }, scope: { kind: 'personal', id: 'w' }, toolPermissions: [] } }));
    const run = async (input, domain) => {
        let actual;
        if (domain === 'routing') actual = registry.findByCapability(input)[0]?.id ?? null;
        if (domain === 'reasoning') actual = (await execute(new BrihaspatiBot(), 'reasoning.plan', input)).status;
        if (domain === 'code') { const result = await execute(new VishwakarmaBot(), 'code.patch', input); actual = result.status === 'completed' ? result.data.patches[0].after : 'failed'; }
        if (domain === 'visual') { const p = paired(); if (input) p.node('title').typography.fontSize = measurement(30); actual = analyzeUI(p.baseline, p.target).issues.length > 0; }
        if (domain === 'permission') actual = (await securedFeedback({ approved: input })).result.status === 'completed';
        if (domain === 'memory') actual = (await store.retrieve(ns, input, signal()))?.value ?? null;
        return observation(actual);
    };
    const first = await evaluateDataset(learningCases, run, signal()), second = await evaluateDataset(learningCases, run, signal());
    assert.equal(first.accuracy, 1); assert.deepEqual(first.outcomes.map(o => o.passed), second.outcomes.map(o => o.passed));
    assert.equal(validateEvaluationRecord(first).securityPassRate, 1);
    assert.throws(() => validateEvaluationRecord({ ...first, accuracy: 0 }));
});
test('evaluator exceptions and malformed usage fail cases without leaking exceptions or claiming complete usage', async () => {
    const result = await evaluateDataset(datasets, async () => { throw new Error('private-secret'); }, signal());
    assert.equal(result.accuracy, 0); assert.equal(result.usageComplete, false); assert.equal(JSON.stringify(result).includes('private-secret'), false);
    const malformed = await evaluateDataset(datasets, async () => ({ ...observation('x'), modelTokens: Infinity }), signal());
    assert.equal(malformed.invalidOutputRate, 1);
});
test('evaluation stops on timeout or cancellation even when a callback ignores cancellation', async () => {
    await assert.rejects(evaluateDataset(datasets, () => new Promise(() => {}), signal(), 10));
    const controller = new AbortController(); controller.abort();
    let called = false; await assert.rejects(evaluateDataset(datasets, async () => { called = true; return observation(1); }, controller.signal)); assert.equal(called, false);
});
test('curated numeric training validates imports and disjoint held-out data', () => {
    const row = (id, input, output) => ({ ...feedback, id, input, output });
    const training = exportTrainingData([row('train', [0], [0])], () => true);
    const heldOut = exportTrainingData([row('test', [1], [2])], () => true);
    const model = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 1 }).toJSON();
    assert.equal(trainCuratedCandidate(model, training, heldOut, { epochs: 2 }).heldOut.length, 1);
    assert.throws(() => trainCuratedCandidate(model, training, training));
    assert.throws(() => trainCuratedCandidate(model, training, exportTrainingData([row('other', [0], [2])], () => true)));
    assert.throws(() => validateTrainingExport({ ...training, trust: 'trusted' }));
    assert.throws(() => trainCuratedCandidate(model, exportTrainingData([feedback], () => true), heldOut));
});
test('approval cancellation and concurrent rollback cannot replace an active model', async () => {
    const updates = new EvaluatedModelUpdates({ model: 1, configuration: {} });
    const controller = new AbortController(); let release, entered;
    const waiting = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
    const proposed = updates.propose({ model: 2, configuration: {} }, datasets, async (_version, input) => observation(input), async () => { entered(); return gate; }, controller.signal);
    await waiting; await assert.rejects(updates.rollback(() => true, signal()), /busy/);
    controller.abort(); release(true); await assert.rejects(proposed); assert.equal(updates.active.model, 1);
});

test('rollback denial, cancellation and approval errors preserve both active state and history', async () => {
    const initial = { model: 1, configuration: { threshold: 0.5 } }, next = { model: 2, configuration: { threshold: 0.7 } };
    const updates = new EvaluatedModelUpdates(initial);
    await updates.propose(next, datasets, async (_v, input) => observation(input), () => true, signal());
    assert.equal(await updates.rollback(() => false, signal()), false);
    await assert.rejects(updates.rollback(() => { throw new Error('denied'); }, signal()));
    const controller = new AbortController();
    await assert.rejects(updates.rollback(() => { controller.abort(); return true; }, controller.signal));
    assert.deepEqual(updates.active, next); assert.equal(await updates.rollback(() => true, signal()), true);
    assert.deepEqual(updates.active, initial); assert.equal(await updates.rollback(() => true, signal()), false);
});
test('boolean outcomes measure false positives and negatives and reject corrupted reports', async () => {
    const cases = [true, false].map((expected, i) => ({ id: String(i), domain: 'permission', input: !expected, expected }));
    const result = await evaluateDataset(cases, async input => observation(input), signal());
    assert.equal(result.falsePositives, 1); assert.equal(result.falseNegatives, 1); assert.equal(result.securityPassRate, 0);
    for (const change of [{ accuracy: NaN }, { outcomes: [] }, { modelCalls: -1 }, { version: 2 }]) assert.throws(() => validateEvaluationRecord({ ...result, ...change }));
});
test('training does not claim changed weights for zero-gradient updates', () => {
    const net = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 1 });
    const input = [0], target = net.predict(input);
    assert.equal(trainOfflineCandidate(net.toJSON(), [input], [target], { epochs: 1 }).weightsUpdated, false);
});

test('imported reports cannot contradict permission and routing outcomes', async () => {
    const cases = [
        { id: 'permission', domain: 'permission', input: false, expected: true },
        { id: 'routing', domain: 'routing', input: 'actual', expected: 'expected' },
    ];
    const result = await evaluateDataset(cases, async input => observation(input), signal());
    for (const change of [{ securityPassRate: 1 }, { securityPassRate: null }, { routingAccuracy: 1 }, { falsePositives: 100 }])
        assert.throws(() => validateEvaluationRecord({ ...result, ...change }));
});

test('invalid held-out classification labels reject before any training epoch', () => {
    const rows = (id, input, output) => exportTrainingData([{ ...feedback, id, input, output }], () => true);
    for (const [task, layers, trainLabel, invalidLabels] of [
        ['binary', [1, 1], [0], [[-1], [2]]],
        ['multiclass', [1, 2], [1, 0], [[0, 0], [0.8, 0.8], [-1, 2]]],
    ]) {
        const model = new NeuralNet({ task, layers, seed: 1 }).toJSON();
        for (const invalid of invalidLabels) {
            let epochs = 0;
            assert.throws(() => trainCuratedCandidate(model, rows('train', [0], trainLabel), rows('held-out', [1], invalid), {
                epochs: 1, onEpoch: () => { epochs++; },
            }));
            assert.equal(epochs, 0);
        }
    }
});

test('valid soft classification labels and finite regression targets remain supported', () => {
    const rows = (id, input, output) => exportTrainingData([{ ...feedback, id, input, output }], () => true);
    for (const [task, layers, label] of [['binary', [1, 1], [0.3]], ['multiclass', [1, 2], [0.3, 0.7]], ['regression', [1, 1], [-2]]]) {
        const model = new NeuralNet({ task, layers, seed: 1 }).toJSON();
        assert.equal(trainCuratedCandidate(model, rows('train', [0], label), rows('held-out', [1], label), { epochs: 1 }).training.epochsCompleted, 1);
    }
});

test('reports use null only for absent domains and preserve valid false-positive counts', async () => {
    const cases = [{ id: 'case', domain: 'visual', input: true, expected: false }];
    const result = await evaluateDataset(cases, async input => observation(input), signal());
    assert.equal(validateEvaluationRecord(result).falsePositives, 1);
    assert.throws(() => validateEvaluationRecord({ ...result, securityPassRate: 0 }));
    assert.throws(() => validateEvaluationRecord({ ...result, routingAccuracy: 0 }));
});
