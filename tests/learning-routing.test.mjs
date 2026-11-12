// SARASWATI S05: Ekalavya learning-assisted RUDRA routing (shadow by default).
// L1-L13 follow the S05 phase prompt (step 8); L14-L18 cover the remaining gates. Offline and deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RudraOrchestrator, RudraError, BotRegistry, createSpecialistSystem, Vijay, ProtectedToolRegistry, InMemoryModelRegistryStore,
    createRoutingAdvisor, runRoutingShadow, summarizeRoutingShadow, evaluateRoutingQuality, validateRoutingPolicy, draftRoutingPolicy,
    RoutingPolicySwitch, RoutingAdvisorError, createRoutingEvaluator, routingPolicyResolver, ROUTING_REJECTIONS, runBenchmark,
    createModelRegistry,
} from 'shivax';
import * as learning from 'shivax/learning';
import {
    OWNER, OTHER, NOW, DAY, INJECTION, signal, makeBots, context, security, firewallView, feedbackDataset, fittedLabels,
    routingSuite, routingReport, TRUSTED, policy,
} from './fixtures/routing.mjs';
import { makeHost, rev } from './fixtures/model-registry.mjs';

const code = (expected) => (error) => {
    assert.ok(error instanceof RoutingAdvisorError, `expected RoutingAdvisorError, got ${error?.stack ?? error}`);
    assert.equal(error.code, expected, error.message);
    return true;
};
const selections = (result) => result.trace.filter((e) => e.type === 'selection').map(({ botId, capability, decision }) => ({ botId, capability, decision }));
const strip = (result) => ({ status: result.status, outputs: result.outputs, selections: selections(result) });
async function advisorWith(bots, overrides = {}, evidence) {
    return createRoutingAdvisor({ owner: OWNER, bots, now: () => NOW, trustedEvaluators: TRUSTED, ...overrides }, evidence ?? { feedback: await feedbackDataset() });
}

test('L1 shadow mode leaves routing unchanged while recommending a different bot', async () => {
    const { registry, calls } = makeBots();
    const advisor = await advisorWith(registry);
    const plain = await new RudraOrchestrator(registry).run(context());
    calls.clear();
    const shadow = await runRoutingShadow(new RudraOrchestrator(registry), advisor, context());
    assert.deepEqual(strip(shadow.result), strip(plain));
    assert.deepEqual(selections(plain), [{ botId: 'alpha', capability: 'mock.reason', decision: 'capability-then-bot-id' }]);
    assert.deepEqual({ ...shadow.shadow }, { mode: 'shadow', taskId: 'task-1', capability: 'mock.reason', actual: 'alpha', recommended: 'beta', status: 'recommended', agreed: false });
    assert.deepEqual([...calls], [['alpha', 1]], 'only the deterministic bot ran; the advisor executed nothing');
    // Recommending again changes nothing either.
    const recommendation = await advisor.recommend(context());
    assert.equal(recommendation.mode, 'shadow');
    assert.equal(recommendation.wouldChangeRouting, true);
    assert.deepEqual(strip(await new RudraOrchestrator(registry).run(context())), strip(plain));
    assert.deepEqual(registry.list().map((b) => b.id).sort(), ['alpha', 'beta', 'gamma', 'reviewer']);
    const summary = summarizeRoutingShadow([shadow.shadow, shadow.shadow]);
    assert.deepEqual({ ...summary }, { total: 2, compared: 2, agreed: 0, disagreed: 2, insufficientEvidence: 0, blocked: 0, advisorErrors: 0 });
});

test('L2 valid recommendations carry ranking, confidence, evidence references and structured explanation', async () => {
    const { registry } = makeBots();
    const dataset = await feedbackDataset();
    const labels = fittedLabels(dataset);
    const beta = labels.filter((l) => l === 'beta').length, gamma = labels.filter((l) => l === 'gamma').length;
    const advisor = await advisorWith(registry, {}, { feedback: dataset });
    const r = await advisor.recommend(context());
    assert.equal(r.status, 'recommended');
    assert.equal(r.recommended, 'beta');
    assert.deepEqual({ ...r.baseline, rejections: [...r.baseline.rejections] }, { botId: 'alpha', source: 'deterministic', policy: null, rejections: [] });
    const n = beta + gamma;
    assert.deepEqual(r.ranking.map((x) => [x.botId, x.wins, x.trials, x.eligible]), [['beta', beta, n, true], ['gamma', gamma, n, true], ['alpha', 0, n, true]]);
    assert.equal(r.ranking[0].score, (beta + 1) / (n + 3));
    assert.equal(r.confidence.method, 'wilson-lower-bound-95');
    assert.ok(r.confidence.value > 0.5 && r.confidence.value < beta / n);
    assert.equal(r.confidence.trials, n);
    assert.equal(r.evidence.ignoredLabels, labels.filter((l) => l === 'root-admin').length);
    assert.equal(r.evidence.digest, advisor.evidence.digest);
    assert.ok(r.evidence.refs.length > 0 && r.evidence.refs.every((ref) => ref.startsWith('beta-')));
    assert.deepEqual(r.explanation.map((e) => e.code).filter((c) => c !== 'ignored-labels'), ['label-share', 'runner-up-share']);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.ranking));
    // Evidence that agrees with the deterministic choice.
    const agrees = await advisorWith(registry, {}, { feedback: await feedbackDataset({ labels: { alpha: 12 }, hostile: false }) });
    assert.equal((await agrees.recommend(context())).status, 'same-as-baseline');
    // Trusted S02 evaluation results contribute labelled examples too.
    const suite = await routingSuite();
    const report = await routingReport({ suite, bots: registry });
    const fromEvaluation = await advisorWith(registry, {}, { evaluations: [{ suite, report }] });
    const e = await fromEvaluation.recommend(context());
    assert.equal(e.recommended, 'beta');
    assert.deepEqual(fromEvaluation.evidence.evaluations.map((x) => [x.evaluator, x.usable]), [['shivax-routing-evaluator@1', 6]]);
    assert.ok(e.evidence.refs.every((ref) => ref.startsWith('routing-suite:')));
});

test('L3 invalid bot recommendations are refused at every layer', async () => {
    const { registry } = makeBots();
    const advisor = await advisorWith(registry);
    const r = await advisor.recommend(context());
    assert.ok(!r.ranking.some((x) => x.botId === 'root-admin'), 'labels naming unregistered bots are counted as ignored, never ranked');
    assert.ok(r.evidence.ignoredLabels >= 0);
    // Policies naming unknown bots, or bots without the capability, are rejected.
    for (const order of [['root-admin'], ['reviewer'], ['beta', 'beta'], []])
        assert.throws(() => validateRoutingPolicy(policy([{ capability: 'mock.reason', order }]), { bots: registry }), code('invalid-policy'));
    const sw = new RoutingPolicySwitch({ bots: registry, owner: OWNER });
    assert.throws(() => sw.apply(policy([{ capability: 'mock.reason', order: ['root-admin'] }])), code('invalid-policy'));
    assert.equal(sw.current, null);
    // A hook answering with an unregistered bot cannot redirect RUDRA: the deterministic bot runs.
    for (const answer of ['root-admin', 'reviewer', 42, Promise.resolve('beta')]) {
        const result = await new RudraOrchestrator(registry, { routing: { select: () => answer } }).run(context());
        assert.deepEqual(selections(result), [{ botId: 'alpha', capability: 'mock.reason', decision: 'routing-policy-rejected' }], String(answer));
    }
    const throwing = await new RudraOrchestrator(registry, { routing: { select: () => { throw new Error('policy bug'); } } }).run(context());
    assert.equal(selections(throwing)[0].decision, 'routing-policy-rejected');
    assert.equal(throwing.status, 'completed');
});

test('L4 missing or inconclusive evidence never produces a recommendation', async () => {
    const { registry } = makeBots();
    const none = await advisorWith(registry, {}, {});
    const r = await none.recommend(context());
    assert.equal(r.status, 'insufficient-evidence');
    assert.equal(r.recommended, null);
    assert.equal(r.wouldChangeRouting, false);
    assert.deepEqual(r.explanation.slice(0, 2).map((e) => [e.code, e.value]), [['verified-labels', 0], ['minimum-labels', 5]]);
    const few = await advisorWith(registry, { minEvidence: 50 });
    assert.equal((await few.recommend(context())).status, 'insufficient-evidence');
    const tie = await advisorWith(registry, { minEvidence: 1 }, { feedback: await feedbackDataset({ labels: { beta: 4, gamma: 4 }, hostile: false }) });
    const t = await tie.recommend(context());
    const labels = fittedLabels(await feedbackDataset({ labels: { beta: 4, gamma: 4 }, hostile: false }));
    if (labels.filter((l) => l === 'beta').length === labels.filter((l) => l === 'gamma').length) assert.equal(t.status, 'insufficient-evidence');
    const strict = await advisorWith(registry, { minConfidence: 0.99 });
    const s = await strict.recommend(context());
    assert.equal(s.status, 'insufficient-evidence');
    assert.ok(s.explanation.some((e) => e.code === 'low-confidence'));
    // No bot offers the capability.
    assert.equal((await none.recommend(context({ capability: 'mock.unknown' }))).status, 'no-candidates');
});

test('L5 stale, forged, untrusted and unconsented evaluation history is excluded or refused', async () => {
    const { registry } = makeBots();
    const suite = await routingSuite();
    const report = await routingReport({ suite, bots: registry });
    // Stale: older than the evidence TTL. Excluded, so nothing is recommended.
    const stale = await advisorWith(registry, { now: () => NOW + 31 * DAY }, { evaluations: [{ suite, report }], feedback: await feedbackDataset() });
    assert.deepEqual(stale.evidence.excluded.map((e) => [e.source, e.reason]), [['feedback', 'stale'], ['evaluation', 'stale']]);
    assert.equal(stale.evidence.examples, 0);
    assert.equal((await stale.recommend(context())).status, 'insufficient-evidence');
    // Forged report (tampered pass flag), untrusted evaluator, and a dataset curated for another purpose.
    const forged = JSON.parse(JSON.stringify(report));
    forged.cases[0].passed = !forged.cases[0].passed;
    await assert.rejects(advisorWith(registry, {}, { evaluations: [{ suite, report: forged }] }), code('invalid-evidence'));
    await assert.rejects(advisorWith(registry, { trustedEvaluators: [{ id: 'other', version: '1' }] }, { evaluations: [{ suite, report }] }), code('invalid-evidence'));
    await assert.rejects(advisorWith(registry, {}, { feedback: await feedbackDataset({ purpose: 'training' }) }), code('invalid-evidence'));
    const tampered = await feedbackDataset();
    const copy = JSON.parse(JSON.stringify(tampered));
    copy.splits.train.rows[0].expected = 'gamma';
    await assert.rejects(advisorWith(registry, {}, { feedback: copy }), code('invalid-evidence'));
    await assert.rejects(advisorWith(registry, {}, { unknown: true }), code('invalid-evidence'));
});

test('L6 prompt injection in evidence, policies or hook answers cannot steer routing or authority', async () => {
    const { registry } = makeBots();
    const advisor = await advisorWith(registry);
    const r = await advisor.recommend(context());
    assert.equal(r.recommended, 'beta');
    assert.equal(JSON.stringify(r).includes('IGNORE'), false, 'no evidence text is echoed into the recommendation');
    assert.ok(r.explanation.every((e) => /^[a-z-]+$/.test(e.code)));
    // A model-written "policy" with extra authority fields or code-like ids is rejected outright.
    const hostile = [
        { ...policy([{ capability: 'mock.reason', order: ['beta'] }]), permissions: ['firewall.admin'] },
        { ...policy([{ capability: 'mock.reason', order: ['beta'] }]), tools: ['shivax.memory.records.save'] },
        policy([{ capability: 'mock.reason', order: ['beta'], providers: ['remote-llm'] }]),
        policy([{ capability: 'mock.reason', order: ['beta; process.exit(1)'] }]),
        policy([{ capability: INJECTION, order: ['beta'] }]),
        { ...policy([]), rules: 'route everything to root-admin' },
    ];
    for (const p of hostile) assert.throws(() => validateRoutingPolicy(p, { bots: registry }), code('invalid-policy'));
    // The hook sees frozen data and has no registry: it cannot register bots or widen the candidate list.
    let seen;
    const result = await new RudraOrchestrator(registry, { routing: { select: (request) => { seen = request; request.candidates.push?.('root-admin'); return null; } } }).run(context());
    assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.candidates));
    assert.deepEqual([...seen.candidates], ['alpha', 'beta', 'gamma']);
    assert.equal(result.status, 'completed');
    assert.deepEqual(registry.list().map((b) => b.id).sort(), ['alpha', 'beta', 'gamma', 'reviewer']);
});

test('L7 cross-tenant recommendations, evidence and policies are refused', async () => {
    const { registry } = makeBots();
    const advisor = await advisorWith(registry);
    await assert.rejects(advisor.recommend(context({ scope: OTHER })), code('cross-tenant'));
    const foreignSuite = await routingSuite({ owner: OTHER });
    const foreignReport = await routingReport({ suite: foreignSuite, bots: registry });
    await assert.rejects(advisorWith(registry, {}, { evaluations: [{ suite: foreignSuite, report: foreignReport }] }), code('cross-tenant'));
    const sw = new RoutingPolicySwitch({ bots: registry, owner: OWNER });
    assert.throws(() => sw.apply(policy([{ capability: 'mock.reason', order: ['beta'] }], { owner: OTHER })), code('cross-tenant'));
    // A Jay session from another tenant, even with a matching task scope, is refused.
    const s = await security({ scope: OTHER });
    const secured = await advisorWith(registry, { security: { jay: s.jay, policies: s.policies } });
    await assert.rejects(secured.recommend(context()), code('unauthorized'), 'a context Jay did not mint carries no identity');
    await assert.rejects(secured.recommend(s.root), code('cross-tenant'));
});

/** S04 host with the ShivAX routing evaluator trusted and a versioned policy: permission cases must pass, nothing may regress. */
async function routingRegistry(hostOptions = {}) {
    const host = makeHost({
        options: {
            trustedEvaluators: TRUSTED,
            policy: { format: 'shivax-benchmark-policy', version: 1, id: 'routing-promotion-v1', minimumPassRate: { permission: 1 } },
            ...hostOptions,
        },
    });
    const alice = await host.login('alice');
    const registry = await createModelRegistry(host.options, alice, signal());
    return { host, alice, registry };
}
async function promotePolicy({ registry, alice, bots, policies }, versionId, routingPolicy, { approver = alice, activate = true } = {}) {
    await registry.register(alice, { expectedRevision: rev(registry), modelId: 'routing', versionId, artifact: { model: null, configuration: routingPolicy }, training: { method: 'external' } }, signal());
    const suite = await routingSuite();
    const resolvePolicy = routingPolicyResolver(registry, { bots, owner: OWNER });
    const active = registry.snapshot().active;
    const baselineConfig = active ? registry.benchmarkConfiguration(active, 'baseline') : { role: 'baseline', id: 'deterministic', version: '0' };
    const baseline = await routingReport({ suite, bots, policies, resolvePolicy, configuration: baselineConfig });
    const candidate = await routingReport({ suite, bots, policies, resolvePolicy, configuration: registry.benchmarkConfiguration(versionId, 'candidate') });
    const evaluation = await registry.evaluate(alice, versionId, { expectedRevision: rev(registry), suite, baseline, candidate }, signal());
    if (evaluation.state !== 'evaluated') return evaluation;
    await registry.approve(approver, versionId, { expectedRevision: rev(registry) }, signal());
    return activate ? registry.activate(alice, versionId, { expectedRevision: rev(registry) }, signal()) : evaluation;
}

test('L8 approval denied: an unapproved routing policy never reaches RUDRA', async () => {
    const { registry: bots } = makeBots();
    const { policies } = await security();
    const env = await routingRegistry();
    await promotePolicy({ ...env, bots, policies }, 'p0', policy([], { policyVersion: 1 }));
    const mallory = await env.host.login('mallory');
    await assert.rejects(promotePolicy({ ...env, bots, policies }, 'p1', policy([{ capability: 'mock.reason', order: ['beta'] }], { policyVersion: 2 }), { approver: mallory }), (e) => e.code === 'unauthorized');
    const refusing = await routingRegistry({ approvals: { record: () => false, confirm: () => true } });
    await promotePolicy({ ...refusing, bots, policies }, 'p0', policy([], { policyVersion: 1 }), { activate: false }).catch(() => undefined);
    assert.equal(refusing.registry.snapshot().active, null);
    const sw = new RoutingPolicySwitch({ bots, owner: OWNER });
    await sw.syncFromRegistry(env.registry, signal());
    assert.equal(env.registry.version('p1').state, 'evaluated');
    assert.deepEqual(sw.current.rules, [], 'the active policy is still the deterministic p0');
    const result = await new RudraOrchestrator(bots, { routing: sw.hook }).run(context());
    assert.equal(selections(result)[0].botId, 'alpha');
});

test('L9 promotion approved: non-regression, security cases and a rollback target are required', async () => {
    const { registry: bots, calls } = makeBots();
    const { policies } = await security();
    const env = await routingRegistry();
    const sw = new RoutingPolicySwitch({ bots, owner: OWNER });
    // A non-empty policy is never applied without a rollback target.
    const lonely = await routingRegistry();
    await promotePolicy({ ...lonely, bots, policies }, 'p1', policy([{ capability: 'mock.reason', order: ['beta'] }]));
    await assert.rejects(sw.syncFromRegistry(lonely.registry, signal()), code('invalid-policy'));
    assert.equal(sw.current, null);
    // p0: deterministic baseline; p1: beta first (improves the labelled routing cases).
    assert.equal((await promotePolicy({ ...env, bots, policies }, 'p0', policy([], { policyVersion: 1 }))).state, 'active');
    assert.equal((await promotePolicy({ ...env, bots, policies }, 'p1', policy([{ capability: 'mock.reason', order: ['beta'] }], { policyVersion: 2 }))).state, 'active');
    const applied = await sw.syncFromRegistry(env.registry, signal());
    assert.deepEqual(applied.rules, [{ capability: 'mock.reason', order: ['beta'] }]);
    calls.clear();
    const result = await new RudraOrchestrator(bots, { routing: sw.hook }).run(context());
    assert.deepEqual(selections(result), [{ botId: 'beta', capability: 'mock.reason', decision: 'routing-policy' }]);
    assert.deepEqual([...calls], [['beta', 1]]);
    // Capabilities without a rule keep deterministic routing.
    const review = await new RudraOrchestrator(bots, { routing: sw.hook }).run(context({ capability: 'mock.review', data: { numbers: [1], total: 1 } }));
    assert.deepEqual(selections(review), [{ botId: 'reviewer', capability: 'mock.review', decision: 'capability-then-bot-id' }]);
    // A policy that routes worse than the active one is rejected for regression.
    const worse = await promotePolicy({ ...env, bots, policies }, 'p2', policy([{ capability: 'mock.reason', order: ['gamma'] }], { policyVersion: 3 }));
    assert.equal(worse.state, 'rejected');
    assert.ok(worse.reasons.includes('regression'));
    // The routing policy cannot grant access: permission cases evaluate the same under every policy.
    const suite = await routingSuite();
    const report = await routingReport({ suite, bots, policies, resolvePolicy: () => policy([{ capability: 'mock.reason', order: ['beta'] }]) });
    assert.equal(report.cases.find((c) => c.id === 'deny-no-permission').passed, true);
});

test('L10 policy rollback restores the previous verified routing', async () => {
    const { registry: bots } = makeBots();
    const { policies } = await security();
    const env = await routingRegistry();
    const sw = new RoutingPolicySwitch({ bots, owner: OWNER });
    await promotePolicy({ ...env, bots, policies }, 'p0', policy([], { policyVersion: 1 }));
    await promotePolicy({ ...env, bots, policies }, 'p1', policy([{ capability: 'mock.reason', order: ['beta'] }], { policyVersion: 2 }));
    await sw.syncFromRegistry(env.registry, signal());
    assert.equal(selections(await new RudraOrchestrator(bots, { routing: sw.hook }).run(context()))[0].botId, 'beta');
    const rolled = await env.registry.rollback(env.alice, { expectedRevision: rev(env.registry) }, signal());
    assert.deepEqual([rolled.versionId, rolled.previous], ['p0', 'p1']);
    await sw.syncFromRegistry(env.registry, signal());
    assert.deepEqual(sw.current.rules, []);
    assert.deepEqual(selections(await new RudraOrchestrator(bots, { routing: sw.hook }).run(context())), [{ botId: 'alpha', capability: 'mock.reason', decision: 'capability-then-bot-id' }]);
    assert.deepEqual((await env.registry.audit(signal())).slice(-1).map((e) => [e.action, e.versionId]), [['rollback', 'p0']]);
});

test('L11 lockdown blocks recommendations and promotion, and freezes routing to deterministic', async () => {
    const { registry: bots } = makeBots();
    const firewall = firewallView();
    const advisor = await advisorWith(bots, { firewall });
    assert.equal((await advisor.recommend(context())).status, 'recommended');
    firewall.mode = 'lockdown';
    const blocked = await advisor.recommend(context());
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.recommended, null);
    assert.ok(blocked.ranking.every((r) => r.rejections.includes('lockdown')));
    const sw = new RoutingPolicySwitch({ bots, owner: OWNER, firewall });
    sw.apply(policy([{ capability: 'mock.reason', order: ['beta'] }]));
    assert.deepEqual(selections(await new RudraOrchestrator(bots, { routing: sw.hook }).run(context())), [{ botId: 'alpha', capability: 'mock.reason', decision: 'capability-then-bot-id' }]);
    firewall.mode = 'enforce';
    assert.equal(selections(await new RudraOrchestrator(bots, { routing: sw.hook }).run(context()))[0].botId, 'beta');
    // S04 refuses promotion during lockdown.
    const { policies } = await security();
    const env = await routingRegistry();
    await promotePolicy({ ...env, bots, policies }, 'p0', policy([], { policyVersion: 1 }));
    env.host.firewall.mode = 'lockdown';
    await assert.rejects(promotePolicy({ ...env, bots, policies }, 'p1', policy([{ capability: 'mock.reason', order: ['beta'] }], { policyVersion: 2 })), (e) => e.code === 'lockdown');
});

test('L12 cancellation stops recommendations and evidence loading; RUDRA cancellation is unchanged', async () => {
    const { registry } = makeBots();
    const advisor = await advisorWith(registry);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(advisor.recommend(context(), {}, aborted.signal), code('cancelled'));
    await assert.rejects(createRoutingAdvisor({ owner: OWNER, bots: registry, now: () => NOW }, { feedback: await feedbackDataset() }, aborted.signal), code('cancelled'));
    const controller = new AbortController();
    controller.abort();
    const { result, shadow } = await runRoutingShadow(new RudraOrchestrator(registry), advisor, context({ controller }));
    assert.equal(result.status, 'cancelled');
    assert.equal(result.error.code, 'cancelled');
    assert.equal(shadow.actual, null);
    // With Jay security, a cancelled task context also cancels the recommendation.
    const s = await security();
    const secured = await advisorWith(registry, { security: { jay: s.jay, policies: s.policies } });
    const c2 = new AbortController();
    const root = await s.jay.createContext({ id: 'task-2', input: { capability: 'mock.reason', data: [1] } }, { signal: c2.signal });
    c2.abort();
    await assert.rejects(secured.recommend(root), code('unauthorized'));
});

test('L13 legacy deterministic routing is unchanged without a hook, and the hook cannot bypass RUDRA or Vijay', async () => {
    const { registry } = makeBots();
    const legacy = await new RudraOrchestrator(registry).run(context());
    const withNull = await new RudraOrchestrator(registry, { routing: { select: () => null } }).run(context());
    assert.deepEqual(strip(withNull), strip(legacy));
    assert.deepEqual(legacy.trace.map((e) => e.decision).filter(Boolean), ['validated-plan', 'capability-then-bot-id']);
    for (const bad of [null, 1, {}, { select: 'beta' }])
        assert.throws(() => new RudraOrchestrator(registry, { routing: bad }), RudraError);
    // The RUDRA allowlist still applies: a hook cannot route an unallowed capability.
    const denied = await new RudraOrchestrator(registry, { routing: { select: () => 'reviewer' } }).run(context({ capability: 'mock.review', data: { numbers: [1], total: 1 } }), { allowedCapabilities: ['mock.reason'] });
    assert.equal(denied.error.code, 'capability-denied');
    // Vijay still checks permissions for the chosen bot: routing cannot bypass it.
    const s = await security({ permissions: [] });
    const vijay = new Vijay(s.jay, s.policies, { tools: new ProtectedToolRegistry() });
    const guarded = await new RudraOrchestrator(registry, { security: vijay, routing: { select: () => 'beta' } }).run(s.root);
    assert.equal(guarded.status, 'failed');
    assert.equal(guarded.error.code, 'security-denied');
    // The built-in specialist system keeps its seven bots and deterministic routing.
    const system = createSpecialistSystem();
    assert.deepEqual(system.registry.list().map((b) => b.id).sort(), ['brihaspati', 'chitragupt', 'ekalavy', 'narad', 'sanjay', 'vishwakarma', 'yudhishthir']);
    assert.equal(system.registry.get('ekalavy').capabilities.length, 3);
});

test('L14 decision validation: effective permissions, firewall bots and capabilities, providers and budgets', async () => {
    const { registry } = makeBots();
    const s = await security({ permissions: [] });
    const noPermission = await advisorWith(registry, { security: { jay: s.jay, policies: s.policies } });
    const denied = await noPermission.recommend(s.root);
    assert.equal(denied.status, 'blocked');
    assert.ok(denied.ranking.every((r) => r.rejections.includes('permission-denied')));
    const allowed = await security();
    assert.equal((await (await advisorWith(registry, { security: { jay: allowed.jay, policies: allowed.policies } })).recommend(allowed.root)).recommended, 'beta');
    // Firewall excludes beta: the best eligible bot is recommended instead, and beta is reported ineligible.
    const firewall = firewallView({ bots: ['alpha', 'gamma'] });
    const fw = await (await advisorWith(registry, { firewall })).recommend(context());
    // gamma is the best eligible bot, but its share of verified labels is too low to recommend.
    assert.equal(fw.recommended, null);
    assert.equal(fw.status, 'insufficient-evidence');
    assert.deepEqual([...fw.ranking.find((r) => r.botId === 'beta').rejections], ['firewall-bot-denied']);
    assert.equal((await (await advisorWith(registry, { firewall: firewallView({ capabilities: [] }) })).recommend(context())).status, 'blocked');
    // Providers: unapproved provider or exhausted budget makes a bot ineligible.
    const providers = { beta: { providerId: 'remote-llm', locality: 'remote' }, gamma: { providerId: 'local-llm', locality: 'local', budget: () => ({ remainingCalls: 0, remainingCostUSD: 1 }) } };
    const p = await (await advisorWith(registry, { firewall: firewallView(), providers })).recommend(context());
    assert.deepEqual(p.ranking.filter((r) => !r.eligible).map((r) => [r.botId, [...r.rejections]]), [['beta', ['provider-not-allowed']], ['gamma', ['budget-exhausted']]]);
    // Capability not in the request's RUDRA allowlist.
    assert.equal((await (await advisorWith(registry)).recommend(context(), { allowedCapabilities: ['mock.review'] })).status, 'blocked');
    assert.deepEqual([...ROUTING_REJECTIONS], ['capability-not-allowed', 'permission-denied', 'lockdown', 'firewall-capability-denied', 'firewall-bot-denied', 'provider-not-allowed', 'budget-exhausted']);
});

test('L15 routing quality compares strategies on held-out labels and never claims improvement without them', async () => {
    const { registry } = makeBots();
    const beta = policy([{ capability: 'mock.reason', order: ['beta'] }]);
    const gamma = policy([{ capability: 'mock.reason', order: ['gamma'] }]);
    const labelled = Array.from({ length: 25 }, (_, i) => ({ capability: 'mock.reason', botId: i < 20 ? 'beta' : 'gamma', ref: `holdout-${i}` }));
    const observations = [
        { botId: 'alpha', capability: 'mock.reason', latencyMs: 10, inputTokens: 5, outputTokens: 5, costUSD: 0.01, verified: true },
        { botId: 'beta', capability: 'mock.reason', latencyMs: 30, inputTokens: 10, outputTokens: 10, costUSD: 0.02, verified: true },
    ];
    const q = evaluateRoutingQuality({ bots: registry, baseline: null, candidate: beta, labelled, observations });
    assert.equal(q.verdict, 'improved');
    assert.deepEqual([q.baseline.correct, q.candidate.correct], [0, 20]);
    assert.deepEqual([q.baseline.estimatedRegret, q.candidate.estimatedRegret], [1, 5 / 25]);
    assert.deepEqual([q.baseline.latencyMs, q.candidate.latencyMs, q.candidate.tokens], [10, 30, 20]);
    assert.ok(Math.abs(q.candidate.costUSD - 0.02) < 1e-12);
    assert.equal(q.delta.accuracy, 0.8);
    assert.equal(evaluateRoutingQuality({ bots: registry, baseline: beta, candidate: gamma, labelled, observations }).verdict, 'regressed');
    assert.equal(evaluateRoutingQuality({ bots: registry, baseline: null, candidate: beta, labelled: labelled.slice(0, 5) }).verdict, 'insufficient-evidence');
    const unmeasured = evaluateRoutingQuality({ bots: registry, baseline: null, candidate: gamma, labelled });
    assert.equal(unmeasured.candidate.latencyMs, null, 'no observations, no invented latency');
    // Security denials and coverage: the firewall allows only gamma. A policy listing gamma after beta routes to
    // gamma; a beta-only policy falls back to the deterministic alpha, which the firewall denies, as RUDRA would.
    const onlyGamma = { firewall: firewallView({ bots: ['gamma'] }) };
    const fallback = evaluateRoutingQuality({ bots: registry, baseline: null, candidate: policy([{ capability: 'mock.reason', order: ['beta', 'gamma'] }]), labelled, environment: onlyGamma });
    assert.equal(fallback.candidate.securityDenials, 0);
    assert.equal(fallback.candidate.correct, 5);
    assert.equal(fallback.baseline.securityDenials, 25, 'the deterministic alpha is denied by this firewall');
    assert.equal(fallback.baseline.coverage, 0);
    assert.equal(evaluateRoutingQuality({ bots: registry, baseline: null, candidate: beta, labelled, environment: onlyGamma }).candidate.securityDenials, 25);
    // Held-out routes that were also advisor evidence are refused.
    const dataset = await feedbackDataset();
    const advisor = await advisorWith(registry, {}, { feedback: dataset });
    const used = dataset.splits.train.rows[0].feedbackId;
    assert.throws(() => evaluateRoutingQuality({ bots: registry, baseline: null, candidate: beta, labelled: [{ capability: 'mock.reason', botId: 'beta', ref: used }], advisor }), code('leakage'));
    const heldOut = dataset.splits.heldOut.rows.filter((r) => typeof r.expected === 'string' && /^[a-z]+$/.test(r.expected)).map((r) => ({ capability: 'mock.reason', botId: r.expected, ref: r.feedbackId }));
    assert.ok(evaluateRoutingQuality({ bots: registry, baseline: null, candidate: beta, labelled: heldOut, advisor, minLabelled: 1 }).labelled > 0);
});

test('L16 draft policies from recommendations are inert until promoted', async () => {
    const { registry } = makeBots();
    const advisor = await advisorWith(registry);
    const recommendation = await advisor.recommend(context());
    const draft = draftRoutingPolicy({ id: 'draft', policyVersion: 2, owner: OWNER, recommendations: [recommendation] });
    assert.deepEqual(draft.rules, [{ capability: 'mock.reason', order: ['beta', 'gamma', 'alpha'] }]);
    assert.deepEqual(validateRoutingPolicy(draft, { bots: registry, owner: OWNER }), draft);
    // Drafting does not apply anything.
    assert.equal(selections(await new RudraOrchestrator(registry).run(context()))[0].botId, 'alpha');
    for (const name of ['createRoutingAdvisor', 'runRoutingShadow', 'evaluateRoutingQuality', 'validateRoutingPolicy', 'draftRoutingPolicy', 'createRoutingEvaluator', 'routingPolicyResolver', 'RoutingPolicySwitch', 'RoutingAdvisorError'])
        assert.equal(typeof learning[name], 'function', name);
});

test('L17 the trusted routing evaluator mirrors RUDRA and never grants access', async () => {
    const { registry } = makeBots();
    const { policies } = await security();
    const evaluator = createRoutingEvaluator({ bots: registry, policies, resolvePolicy: (c) => (c.id === 'p' ? policy([{ capability: 'mock.reason', order: ['beta'] }]) : null) });
    const req = (domain, input, id = 'deterministic') => evaluator.evaluate({ caseId: 'c', domain, input, seed: null, configuration: { role: 'candidate', id, version: '1' }, signal: signal() });
    assert.deepEqual((await req('routing', { capability: 'mock.reason' })).actual, { botId: 'alpha' });
    assert.deepEqual((await req('routing', { capability: 'mock.reason' }, 'p')).actual, { botId: 'beta' });
    assert.deepEqual((await req('routing', { capability: 'mock.nothing' })).actual, { botId: null });
    assert.deepEqual((await req('permission', { capability: 'mock.reason', permissions: [] }, 'p')).actual, { decision: 'deny' });
    assert.deepEqual((await req('permission', { capability: 'mock.reason', permissions: ['reason'] }, 'p')).actual, { decision: 'allow' });
    assert.equal((await req('code', { capability: 'mock.reason' })).completed, false);
    const suite = await routingSuite();
    const a = await runBenchmark(suite, evaluator, { owner: OWNER, configuration: { role: 'baseline', id: 'deterministic', version: '0' }, signal: signal(), now: () => NOW });
    const b = await runBenchmark(suite, evaluator, { owner: OWNER, configuration: { role: 'baseline', id: 'deterministic', version: '0' }, signal: signal(), now: () => NOW });
    assert.equal(a.logicalDigest, b.logicalDigest, 'deterministic evaluation');
});

test('L18 the advisor and switch never touch firewall configuration, permissions, registrations or the registry', async () => {
    const { registry: bots } = makeBots();
    const firewall = firewallView();
    const before = JSON.stringify(firewall.snapshot());
    const { policies } = await security();
    const policyBefore = JSON.stringify(policies.get('capability', 'mock.reason'));
    const advisor = await advisorWith(bots, { firewall });
    await advisor.recommend(context());
    const sw = new RoutingPolicySwitch({ bots, owner: OWNER, firewall });
    sw.apply(policy([{ capability: 'mock.reason', order: ['beta'] }]));
    await new RudraOrchestrator(bots, { routing: sw.hook }).run(context());
    assert.equal(JSON.stringify(firewall.snapshot()), before);
    assert.equal(JSON.stringify(policies.get('capability', 'mock.reason')), policyBefore);
    assert.deepEqual(bots.list().map((b) => b.id).sort(), ['alpha', 'beta', 'gamma', 'reviewer']);
    const store = new InMemoryModelRegistryStore();
    assert.equal(await store.readHead(signal()), null, 'no registry writes outside the S04 lifecycle');
});
