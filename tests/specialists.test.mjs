import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createSpecialistSystem, createSpecialistBots, registerSpecialistBots, BotRegistry, BotExecutor, createTaskContext,
    SanjayaBot, BrihaspatiBot, VishwakarmaBot, ChitraguptaBot, HanumanBot, YudhishthiraBot, EkalavyaBot,
    SessionMemoryStore, SessionFeedbackStore, Jaya, PermissionPolicyRegistry, SecurityAuditLog, analyzeUI, normalizeUISnapshot,
} from 'shivax';
import { createMockIdentityProvider } from './fixtures/mock-identity.mjs';

function context(capability, data, options = {}) {
    return createTaskContext({ id: 'specialist-task', input: { capability, data }, metadata: { correlation: 'preserved' } }, {
        sessionId: 'session', signal: new AbortController().signal,
        security: { caller: { id: 'user', issuer: 'test-host' }, scope: { kind: 'personal', id: 'workspace' }, toolPermissions: [] }, ...options,
    });
}
const execute = (bot, capability, data, options) => new BotExecutor().execute(bot, context(capability, data, options));
function failed(result, code) { assert.equal(result.status, 'failed'); assert.equal(result.error.code, code); }
function scene(scale = 1) {
    return { version: 1, sourceType: 'figma', scope: { kind: 'personal', id: 'workspace' },
        viewport: { width: 100, height: 100, devicePixelRatio: 1 },
        coordinates: { unit: 'design-unit', unitsPerCssPixel: scale, origin: 'artboard' },
        nodes: [{ id: 'title', text: 'Title', bounds: { status: 'known', value: { x: 10, y: 20, width: 40, height: 10 },
            provenance: { sourceType: 'figma', kind: 'design', method: 'fixture' }, confidence: { score: 1 } } }], relationships: [] };
}
const file = () => ({ path: 'src/example.ts', content: 'export const value = 1;\n', language: 'typescript' });
const decision = () => ({ question: 'Which supplied option?', options: [{ id: 'one', label: 'first' }], evidence: [{ id: 'evidence-1', text: 'supplied evidence' }] });
const explicitPlan = () => ({ steps: [ { id: 'one', capability: 'vision.observe', input: { source: 'task' } },
    { id: 'two', capability: 'review.check', input: { source: 'step', stepId: 'one' } } ] });

test('all seven specialists register with unique IDs and discoverable per-capability schemas', () => {
    const system = createSpecialistSystem();
    assert.deepEqual(system.registry.list().map(bot => bot.id), ['sanjaya', 'brihaspati', 'vishwakarma', 'chitragupta', 'hanuman', 'yudhishthira', 'ekalavya']);
    assert.equal(system.registry.listCapabilities().length, 28);
    for (const bot of system.registry.list()) for (const capability of bot.capabilities) {
        assert.equal(typeof capability.inputSchema, 'object'); assert.ok(Object.isFrozen(capability.inputSchema));
        assert.equal(system.registry.findByCapability(capability.id)[0].id, bot.id);
        assert.equal(bot.validateInput({ capability: capability.id, data: null }), false);
    }
});

test('registration conflicts do not partially register the specialist suite', () => {
    const registry = new BotRegistry().register(new EkalavyaBot());
    assert.throws(() => registerSpecialistBots(registry), error => error.code === 'duplicate-bot');
    assert.deepEqual(registry.list().map(bot => bot.id), ['ekalavya']);
});

test('every specialist returns an explicit unsupported capability result', async () => {
    for (const bot of createSpecialistBots()) {
        const result = await bot.execute({ capability: 'unknown.operation', data: null }, { task: context('unknown.operation', null) });
        failed(result, 'unsupported-capability'); assert.equal(result.botId, bot.id); assert.equal(result.taskId, 'specialist-task');
    }
});

test('Sanjaya preserves unknown confidence and supplied observations without claiming image inference', async () => {
    const data = { observations: [{ label: 'supplied title', confidence: null, bounds: { x: 1, y: 2, width: 3, height: 4 } }] };
    const result = await execute(new SanjayaBot(), 'vision.observe', data);
    assert.equal(result.status, 'completed'); assert.deepEqual(result.data, { ...data, count: 1, source: 'supplied-observations' });
    assert.ok(Object.isFrozen(result.data.observations[0])); assert.equal(data.observations[0].confidence, null);
});

test('vision image decoding requires a configured adapter and malformed encoding fails validation', async () => {
    const image = { mimeType: 'image/png', base64: 'aGVsbG8=' };
    failed(await execute(new SanjayaBot(), 'vision.analyze', { image }), 'unavailable');
    failed(await execute(new SanjayaBot(), 'vision.analyze', { image: { ...image, base64: 'https://example.com/image' } }), 'invalid-input');
    let received;
    const bot = new SanjayaBot({ id: 'test-adapter', analyze(input, ctx) { received = { input, ctx }; return { summary: 'Test adapter response', observations: [] }; } });
    const result = await execute(bot, 'vision.analyze', { image });
    assert.equal(result.status, 'completed'); assert.equal(result.data.providerId, 'test-adapter');
    assert.deepEqual(received.input.image, image); assert.equal(received.ctx.taskId, 'specialist-task'); assert.equal(received.ctx.tools, undefined);
});

test('Brihaspati validates explicit plans and rejects forward references', async () => {
    const bot = new BrihaspatiBot(), plan = explicitPlan();
    const result = await execute(bot, 'reasoning.plan', plan);
    assert.equal(result.status, 'completed'); assert.deepEqual(result.data.plan, plan); assert.equal(result.data.source, 'validated-explicit-plan');
    const bad = explicitPlan(); bad.steps[0].input = { source: 'step', stepId: 'two' };
    failed(await execute(bot, 'reasoning.plan', bad), 'invalid-input');
});

test('reasoning providers are replaceable and cannot invent option or evidence IDs', async () => {
    failed(await execute(new BrihaspatiBot(), 'reasoning.decide', decision()), 'unavailable');
    for (const output of [
        { selectedOptionId: 'invented', rationale: 'invalid', evidenceIds: [] },
        { selectedOptionId: 'one', rationale: 'invalid', evidenceIds: ['invented'] },
    ]) failed(await execute(new BrihaspatiBot({ id: 'bad', decide: () => output }), 'reasoning.decide', decision()), 'invalid-output');
    const result = await execute(new BrihaspatiBot({ id: 'replaceable', decide: () => ({ selectedOptionId: 'one', rationale: 'uses supplied evidence', evidenceIds: ['evidence-1'] }) }), 'reasoning.decide', decision());
    assert.equal(result.status, 'completed'); assert.equal(result.data.selectedOptionId, 'one');
});

test('Brihaspati validates provider-generated plans against dependencies, step budgets and requested capabilities', async () => {
    const request = { goal: 'Inspect supplied observations', allowedCapabilities: ['vision.observe'], maxSteps: 2 };
    failed(await execute(new BrihaspatiBot(), 'reasoning.plan', request), 'unavailable');
    const plan = { steps: [{ id: 'observe', capability: 'vision.observe', input: { source: 'task' } }] };
    const provider = { id: 'planner-fixture', decide: () => ({}), plan: () => plan };
    const result = await execute(new BrihaspatiBot(provider), 'reasoning.plan', request);
    assert.equal(result.status, 'completed'); assert.deepEqual(result.data.plan, plan); assert.equal(result.data.source, 'reasoning-provider');
    const bad = { steps: [{ id: 'shell', capability: 'shell.execute', input: { source: 'task' } }] };
    failed(await execute(new BrihaspatiBot({ ...provider, plan: () => bad }), 'reasoning.plan', request), 'invalid-output');
    failed(await execute(new BrihaspatiBot({ ...provider, plan: () => ({ ...plan, approved: true }) }), 'reasoning.plan', request), 'invalid-output');
    assert.equal(Object.isFrozen(result.data.plan.steps), true);
});

test('Vishwakarma reports source metadata and produces unapplied exact replacement artifacts', async () => {
    const bot = new VishwakarmaBot(), source = file();
    const summary = await execute(bot, 'code.summarize', { files: [source] });
    assert.equal(summary.status, 'completed'); assert.equal(summary.data.files[0].lines, 2); assert.equal(summary.data.files[0].characters, source.content.length);
    const patch = await execute(bot, 'code.patch', { files: [source], edits: [{ path: source.path, oldText: '= 1', newText: '= 2' }] });
    assert.equal(patch.status, 'completed'); assert.equal(patch.data.applied, false); assert.equal(patch.data.patches[0].after, 'export const value = 2;\n');
    assert.equal(source.content, file().content);
    failed(await bot.execute({ capability: 'code.apply', data: null }, { task: context('code.apply', null) }), 'unsupported-capability');
});

test('code artifacts reject ambiguous replacements, traversal paths and unprovided target files', async () => {
    const bot = new VishwakarmaBot(), source = file();
    for (const path of ['../outside.ts', '/absolute.ts', 'C:/outside.ts', 'src\\outside.ts', 'src/./x.ts'])
        failed(await execute(bot, 'code.summarize', { files: [{ ...source, path }] }), 'invalid-input');
    failed(await execute(bot, 'code.patch', { files: [{ ...source, content: 'x x' }], edits: [{ path: source.path, oldText: 'x', newText: 'y' }] }), 'invalid-input');
    failed(await execute(new VishwakarmaBot({ id: 'bad-patch', suggest: () => ({ explanation: 'invalid target', patches: [{ path: 'other.ts', before: source.content, after: 'text' }] }) }), 'code.suggest', { files: [source], instruction: 'change value' }), 'invalid-output');
    failed(await execute(bot, 'code.suggest', { files: [source], instruction: 'change value' }), 'unavailable');
});

test('code providers return validated artifacts without applying changes or replacing their injected method', async () => {
    const source = file(), provider = { id: 'code-fixture', suggest: () => ({ explanation: 'Explicit fixture suggestion', patches: [
        { path: source.path, before: source.content, after: 'export const value = 2;\n' },
    ] }) };
    const bot = new VishwakarmaBot(provider); provider.suggest = () => { throw Error('replaced method'); };
    const result = await execute(bot, 'code.suggest', { files: [source], instruction: 'change the value' });
    assert.equal(result.status, 'completed'); assert.equal(result.data.applied, false); assert.equal(result.data.providerId, 'code-fixture');
    assert.equal(source.content, file().content);
});

test('provider cancellation prevents late output from completing the specialist', async () => {
    let finish, started;
    const entered = new Promise(resolve => { started = resolve; }), pending = new Promise(resolve => { finish = resolve; });
    const signal = new AbortController();
    const bot = new SanjayaBot({ id: 'deferred', analyze: async (_input, context) => { started(); await pending; assert.equal(context.signal.aborted, true); return { summary: 'late', observations: [] }; } });
    const running = execute(bot, 'vision.analyze', { image: { mimeType: 'image/png', base64: 'aGVsbG8=' } }, { signal: signal.signal });
    await entered; signal.abort(); const result = await running; assert.equal(result.status, 'cancelled'); finish();
});

test('capability-scoped tool declarations cannot widen access to another capability tool', async () => {
    const f = securedServices();
    const original = new ChitraguptaBot();
    f.system.registry.unregister('chitragupta');
    f.system.registry.register({ id: original.id, capabilities: original.capabilities, validateInput: () => true, validateOutput: () => true,
        async execute(_input, ctx) { await ctx.tools.execute('shivax.memory.write', { key: 'denied', value: 'not stored' }); return { taskId: ctx.task.taskId, botId: 'chitragupta', status: 'completed', data: { found: false } }; } });
    // Host IDs include both, and the principal has both permissions: the selected read capability must still deny the write tool.
    const read = await f.task('memory.read', { key: 'denied' }, { toolPermissions: ['shivax.memory.read', 'shivax.memory.write'] });
    const result = await f.system.rudra.run(read); assert.equal(result.status, 'failed');
    assert.ok(f.audit.list().some(entry => entry.reason === 'tool-denied'));
});

test('Hanuman normalization and comparison agree with the existing visual engine', async () => {
    const bot = new HanumanBot(), input = scene(2);
    const normalized = await execute(bot, 'inspection.normalize', { snapshot: input });
    assert.equal(normalized.status, 'completed'); assert.deepEqual(normalized.data.snapshot, normalizeUISnapshot(input));
    const other = scene(2); other.nodes[0].bounds.value.width = 60;
    const compared = await execute(bot, 'inspection.compare', { baseline: input, target: other });
    assert.equal(compared.status, 'completed'); assert.deepEqual(compared.data.analysis, analyzeUI(normalizeUISnapshot(input), normalizeUISnapshot(other)));
    assert.equal(input.coordinates.unit, 'design-unit');
    const outside = scene(); outside.scope.id = 'another-workspace';
    failed(await execute(bot, 'inspection.normalize', { snapshot: outside }), 'tool-not-allowed');
});

test('Yudhishthira evaluates checks honestly, including failures and own-property paths', async () => {
    const result = await execute(new YudhishthiraBot(), 'review.check', { result: { answer: 4, object: { b: 2, a: 1 } }, checks: [
        { id: 'correct', path: ['answer'], operation: 'equals', expected: 4 },
        { id: 'incorrect', path: ['answer'], operation: 'equals', expected: 5 },
        { id: 'prototype', path: ['toString'], operation: 'exists' },
        { id: 'object', path: ['object'], operation: 'equals', expected: { a: 1, b: 2 } },
    ] });
    assert.equal(result.status, 'completed'); assert.equal(result.data.passed, false);
    assert.deepEqual(result.data.checks.map(check => check.passed), [true, false, false, true]);
});

test('inspection review consumes a previous bot output and detects tampered counts', async () => {
    const normalized = await execute(new HanumanBot(), 'inspection.normalize', { snapshot: scene(2) });
    const result = await execute(new YudhishthiraBot(), 'review.inspection', normalized.data);
    assert.equal(result.status, 'completed'); assert.equal(result.data.passed, true);
    const tampered = structuredClone(normalized.data); tampered.summary.nodeCount = 999;
    const bad = await execute(new YudhishthiraBot(), 'review.inspection', tampered);
    assert.equal(bad.data.passed, false);
});

test('optional model review is explicitly advisory and preserves uncertain outcomes', async () => {
    failed(await execute(new YudhishthiraBot(), 'review.model', { result: {}, criteria: 'check evidence' }), 'unavailable');
    const bot = new YudhishthiraBot({ id: 'optional', review: () => ({ assessment: 'uncertain', findings: ['Missing evidence'] }) });
    const result = await execute(bot, 'review.model', { result: {}, criteria: 'check evidence' });
    assert.equal(result.status, 'completed'); assert.equal(result.data.advisory, true); assert.equal(result.data.assessment, 'uncertain');
});

test('Ekalavya summarizes supplied records without updating model weights', async () => {
    const result = await execute(new EkalavyaBot(), 'learning.summarize', { records: [
        { kind: 'feedback', data: 'good', score: 1 }, { kind: 'feedback', data: 'bad', score: 0 }, { kind: 'training', data: { features: [1], target: 2 } },
    ] });
    assert.equal(result.status, 'completed'); assert.deepEqual(result.data, { feedbackCount: 2, trainingCount: 1, scoredCount: 2, meanScore: 0.5, weightsUpdated: false });
    failed(await new EkalavyaBot().execute({ capability: 'learning.train', data: null }, { task: context('learning.train', null) }), 'unsupported-capability');
});

test('provider failure is sanitized, isolated, and does not corrupt another specialist', async () => {
    const system = createSpecialistSystem({ reasoning: { id: 'faulty', decide: () => { throw Error('private backend response'); } } });
    const failedRun = await system.rudra.run(context('reasoning.decide', decision()));
    assert.equal(failedRun.status, 'failed'); assert.equal(failedRun.trace.find(entry => entry.type === 'outcome').error.code, 'provider-error');
    assert.equal(JSON.stringify(failedRun).includes('private backend'), false);
    const healthy = await system.rudra.run(context('code.summarize', { files: [file()] }));
    assert.equal(healthy.status, 'completed'); assert.equal(system.registry.list().length, 7);
});

test('RUDRA routes a dependent inspection/review workflow while preserving host context', async () => {
    const seen = [];
    const system = createSpecialistSystem({ hooks: { planner: { plan: () => ({ steps: [
        { id: 'inspect', capability: 'inspection.normalize', input: { source: 'task' } },
        { id: 'review', capability: 'review.inspection', input: { source: 'step', stepId: 'inspect' } },
    ] }) } } });
    // Record the actual task contexts while retaining the real specialist implementation.
    for (const original of system.bots.filter(bot => ['hanuman', 'yudhishthira'].includes(bot.id))) {
        system.registry.unregister(original.id);
        system.registry.register({ id: original.id, capabilities: original.capabilities,
            validateInput: original.validateInput.bind(original), validateOutput: original.validateOutput.bind(original),
            execute(input, ctx) { seen.push(ctx.task); return original.execute(input, ctx); } });
    }
    const root = context('inspection.normalize', { snapshot: scene(2) });
    const result = await system.rudra.run(root, { allowedCapabilities: ['inspection.normalize', 'review.inspection'], maxSteps: 2 });
    assert.equal(result.status, 'completed'); assert.equal(result.outputs.length, 2); assert.equal(result.outputs[1].data.passed, true);
    assert.deepEqual(result.outputs.map(output => output.botId), ['hanuman', 'yudhishthira']);
    for (const task of seen) { assert.equal(task.taskId, root.taskId); assert.equal(task.sessionId, root.sessionId); assert.deepEqual(task.security, root.security); assert.deepEqual(task.metadata, root.metadata); }
});

function securedServices({ approve = () => true, memory = new SessionMemoryStore(), feedback = new SessionFeedbackStore(), permissions } = {}) {
    const identity = { principal: { id: 'user', issuer: 'test-host', permissions: permissions ?? ['memory.read', 'memory.write', 'learning.record'] },
        session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10000, scope: { kind: 'personal', id: 'workspace' } } };
    const provider = createMockIdentityProvider(identity), audit = new SecurityAuditLog();
    const jaya = new Jaya(provider, { now: () => 2000, audit });
    const policies = new PermissionPolicyRegistry();
    for (const [capability, tool, effect] of [['memory.read', 'shivax.memory.read', 'read-only'], ['memory.write', 'shivax.memory.write', 'state-changing'], ['learning.record', 'shivax.feedback.append', 'state-changing']]) {
        policies.register({ kind: 'capability', id: capability, permissions: [capability], effect, validateInput: () => true });
        policies.register({ kind: 'tool', id: tool, permissions: [capability], effect, validateInput: () => true });
    }
    const system = createSpecialistSystem({ memory, feedback, security: { jaya, policies, options: { approve, audit } } });
    const task = (capability, data, host = {}) => jaya.createContext({ id: 'secure-specialist', input: { capability, data } }, {
        signal: new AbortController().signal, toolPermissions: [policies.get('capability', capability).effect === 'read-only' ? 'shivax.memory.read' : capability === 'memory.write' ? 'shivax.memory.write' : 'shivax.feedback.append'],
        ...host,
    });
    return { system, task, identity, memory, feedback, audit, provider };
}

test('Chitragupta reads and writes actual session storage through separately authorized tools', async () => {
    const f = securedServices();
    const missing = await f.system.rudra.run(await f.task('memory.read', { key: 'note' })); assert.deepEqual(missing.outputs[0].data, { found: false });
    const written = await f.system.rudra.run(await f.task('memory.write', { key: 'note', value: { text: 'stored' } }));
    assert.equal(written.status, 'completed'); assert.equal(written.outputs[0].data.revision, 1);
    const read = await f.system.rudra.run(await f.task('memory.read', { key: 'note' }));
    assert.deepEqual(read.outputs[0].data, { found: true, value: { text: 'stored' }, revision: 1 });
    // Only the selected read tool ID is present in the host context.
    const readContext = await f.task('memory.read', { key: 'note' }); assert.deepEqual(readContext.security.toolPermissions, ['shivax.memory.read']);
});

test('memory isolation includes principal, issuer, scope, and session IDs', async () => {
    const f = securedServices(); await f.system.rudra.run(await f.task('memory.write', { key: 'note', value: 'private' }));
    for (const field of ['session', 'principal', 'issuer', 'scope']) {
        const other = structuredClone(f.identity);
        if (field === 'session') other.session.id = 'other-session';
        if (field === 'principal') { other.principal.id = 'other-user'; other.session.principalId = 'other-user'; }
        if (field === 'issuer') other.principal.issuer = 'other-host';
        if (field === 'scope') other.session.scope.id = 'other-workspace';
        f.provider.identity = other;
        const result = await f.system.rudra.run(await f.task('memory.read', { key: 'note' }));
        assert.equal(result.status, 'completed'); assert.deepEqual(result.outputs[0].data, { found: false });
    }
});

test('memory writes require permissions and explicit approval and cannot be reached in a pure workflow', async () => {
    for (const options of [{ approve: () => false }, { permissions: ['memory.read'] }]) {
        const f = securedServices(options); const result = await f.system.rudra.run(await f.task('memory.write', { key: 'note', value: 'not stored' }));
        assert.equal(result.status, 'failed'); const read = await f.system.rudra.run(await f.task('memory.read', { key: 'note' }));
        assert.deepEqual(read.outputs[0].data, { found: false });
    }
    const result = await createSpecialistSystem({ memory: new SessionMemoryStore() }).rudra.run(context('memory.write', { key: 'note', value: 'not stored' }));
    assert.equal(result.status, 'failed');
});

test('Ekalavya stores real feedback records in its session namespace without training', async () => {
    const f = securedServices(); const record = { kind: 'training', data: { input: [1, 2], target: 3 } };
    const result = await f.system.rudra.run(await f.task('learning.record', record));
    assert.equal(result.status, 'completed'); assert.equal(result.outputs[0].data.recordId, 'feedback-1');
    const records = f.feedback.list({ principalId: 'user', issuer: 'test-host', sessionId: 'session', scopeKind: 'personal', scopeId: 'workspace' }, new AbortController().signal);
    assert.deepEqual(records[0].record, record);
});

test('storage capacity and cancellation reject writes without corrupting existing entries', () => {
    const store = new SessionMemoryStore({ maxEntries: 1 }), signal = new AbortController().signal;
    const namespace = { principalId: 'u', issuer: 'h', sessionId: 's', scopeKind: 'personal', scopeId: 'w' };
    store.write(namespace, 'one', { retained: true }, signal);
    assert.throws(() => store.write(namespace, 'two', 'overflow', signal), /capacity/);
    assert.deepEqual(store.read(namespace, 'one', signal).value, { retained: true });
    const abort = new AbortController(); abort.abort();
    assert.throws(() => store.write(namespace, 'one', 'cancelled', abort.signal));
    assert.deepEqual(store.read(namespace, 'one', signal).value, { retained: true });
    store.clearSession(namespace); assert.deepEqual(store.read(namespace, 'one', signal), { found: false });
});

test('specialist inputs and provider outputs reject executable or oversized data', async () => {
    failed(await execute(new SanjayaBot(), 'vision.observe', { observations: [{ label: 'x', confidence: 2 }] }), 'invalid-input');
    failed(await execute(new SanjayaBot({ id: 'bad', analyze: () => ({ summary: 'x', observations: [], execute: () => true }) }), 'vision.analyze', { image: { mimeType: 'image/png', base64: 'aGVsbG8=' } }), 'invalid-output');
    const data = { files: [file()] };
    failed(await execute(new VishwakarmaBot(), 'code.summarize', data, { limits: { maxOutputBytes: 10 } }), 'invalid-output');
});
