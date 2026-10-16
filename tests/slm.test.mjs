import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeUI, analyzeUIWithSLM, OllamaProvider, SLMClient, SLMError } from 'shivax';
import { paired, measurement, unknown, documentPair } from './fixtures/ui-analysis.mjs';
import { scene } from './fixtures/visual-matching.mjs';

const empty = () => ({ semanticMatches: [], relationships: [], issues: [] });
const scope = { kind: 'personal', id: 'phase4-fixtures' };
const input = { system: 'Select evidence.', prompt: '{}', schema: { type: 'object' } };
function provider(generate = () => JSON.stringify(empty()), overrides = {}) {
    const calls = { initialize: 0, generate: 0, dispose: 0 };
    return { id: 'test-local', locality: 'local', limits: { contextTokens: 32768, maxOutputTokens: 2048 }, calls,
        async initialize() { calls.initialize++; },
        async generate(request) { calls.generate++; return generate(request); },
        async dispose() { calls.dispose++; }, ...overrides };
}
function client(p, options = {}) { return new SLMClient(p, { scope, enabled: true, ...options }); }
function changed() {
    const data = paired(); data.node('title').typography.fontSize = measurement(27);
    return data;
}
const issueSelection = request => {
    const data = JSON.parse(request.prompt);
    return JSON.stringify({ ...empty(), issues: [{ issueId: data.issues[0].issueId, focus: 'correction', suggestCSS: true }] });
};
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function ollamaTransport(chat = {}, show = {}) {
    const calls = [];
    return { calls, fetch: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return url.endsWith('/show') ? response({ model_info: { 'test.context_length': 32768 }, ...show }) :
            response({ done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20,
                message: { content: JSON.stringify(empty()) }, ...chat });
    } };
}

test('same-title color evidence survives disabled, abstaining, invalid and successful SLM output', async () => {
    const { baseline, target } = documentPair();
    const exact = analyzeUI(baseline, target);
    assert.ok(exact.issues.some(issue => issue.property === 'typography.color'));
    const selectColor = request => {
        const issue = JSON.parse(request.prompt).issues.find(issue => issue.property === 'typography.color');
        return JSON.stringify({ ...empty(), issues: [{ issueId: issue.issueId, focus: 'difference', suggestCSS: true }] });
    };
    for (const p of [null, provider(), provider(() => 'invalid'), provider(selectColor)]) {
        const result = await analyzeUIWithSLM(baseline, target, p ? { slm: client(p) } : {});
        assert.deepEqual(result.analysis, exact);
        const advice = result.reasoning.issues.find(item => item.issueId === exact.issues.find(issue => issue.property === 'typography.color').id);
        assert.ok(advice);
        assert.deepEqual(advice.css.value, { r: 25, g: 133, b: 104, a: 1 });
    }
});

test('valid structured response renders exact CSS evidence and preserves existing analysis', async () => {
    const { baseline, target } = changed(), before = structuredClone([baseline, target]);
    const p = provider(request => {
        const context = JSON.parse(request.prompt);
        assert.equal(context.baseline.nodes.find(n => n.id === 'title').typography, undefined);
        assert.equal(context.issues[0].expected, undefined); // model never supplies or compares measurement values
        assert.equal(request.schema.additionalProperties, false);
        return issueSelection(request);
    });
    const slm = client(p);
    assert.equal(slm.state, 'idle');
    const result = await analyzeUIWithSLM(baseline, target, { slm });
    assert.equal(result.reasoning.source, 'slm');
    assert.deepEqual(result.analysis, analyzeUI(baseline, target));
    assert.deepEqual([baseline, target], before);
    const advice = result.reasoning.issues[0];
    assert.match(advice.description, /Baseline evidence: 20/);
    assert.equal(advice.css.value, 20); assert.equal(advice.css.unit, 'px');
    assert.equal(advice.css.property, 'font-size'); assert.equal(advice.css.automatic, false);
    assert.deepEqual(advice.css.evidence, result.analysis.issues[0].supportingMeasurements[0]);
    assert.equal(advice.confidence.score, null); assert.equal(advice.provenance.kind, 'inferred');
    assert.equal(advice.reviewRequired, true); assert.equal(slm.state, 'ready');
    await analyzeUIWithSLM(baseline, target, { slm });
    assert.equal(p.calls.initialize, 1);
    await slm.dispose(); await slm.dispose();
    assert.equal(p.calls.dispose, 1); assert.equal(slm.state, 'disposed');
    assert.equal((await slm.generateJSON(scope, input, v => v)).error.code, 'disposed');
});

test('invalid JSON, invalid schema, invented values and hallucinated IDs fall back atomically', async () => {
    const { baseline, target } = changed();
    for (const [raw, code] of [
        ['```json\n{}\n```', 'invalid-json'], ['{broken', 'invalid-json'], ['null', 'invalid-output'],
        [JSON.stringify({ ...empty(), extra: 42 }), 'invalid-output'],
        [JSON.stringify({ ...empty(), semanticMatches: [{ referenceId: 'title', targetId: 'invented-node' }] }), 'invalid-output'],
        [JSON.stringify({ ...empty(), issues: [{ issueId: 'invented-issue', focus: 'difference', suggestCSS: false }] }), 'invalid-output'],
        [JSON.stringify({ ...empty(), relationships: [{ baselineIndex: 100, targetIndex: 0 }] }), 'invalid-output'],
    ]) {
        const result = await analyzeUIWithSLM(baseline, target, { slm: client(provider(() => raw)) });
        assert.equal(result.reasoning.source, 'deterministic');
        assert.equal(result.reasoning.diagnostic.code, code);
        assert.deepEqual(result.analysis, analyzeUI(baseline, target));
        assert.equal(result.reasoning.issues[0].css.value, 20);
    }
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(provider(request => {
        const value = JSON.parse(issueSelection(request)); value.issues[0].value = 999;
        return JSON.stringify(value);
    })) });
    assert.equal(result.reasoning.diagnostic.code, 'invalid-output');
});

test('ambiguous semantic proposals are existing candidates, one-to-one, advisory and inferred', async () => {
    const entries = [['root', 'main', 'Shop'], ['a', 'group', '', 'root', 0, 100],
        ['aa', 'heading', 'Same product', 'a'], ['b', 'group', '', 'root', 400, 100], ['ba', 'heading', 'Same product', 'b']];
    const baseline = scene('r', entries), target = scene('t', entries);
    const p = provider(request => {
        const data = JSON.parse(request.prompt);
        assert.ok(data.candidates.some(c => c.referenceId === 'ra' && c.targetId === 'ta'));
        return JSON.stringify({ ...empty(), semanticMatches: [{ referenceId: 'ra', targetId: 'ta' }] });
    });
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(p, { scope: baseline.scope }), tasks: ['semantic-matching'] });
    assert.equal(result.reasoning.source, 'slm');
    assert.equal(result.reasoning.semanticMatches[0].targetId, 'ta');
    assert.equal(result.reasoning.semanticMatches[0].confidence.score, null);
    assert.ok(!result.analysis.matching.matches.some(m => m.referenceId === 'ra'));
    for (const proposals of [
        [{ referenceId: 'ra', targetId: 'ta' }, { referenceId: 'rb', targetId: 'ta' }],
        [{ referenceId: 'ra', targetId: 'ta' }, { referenceId: 'ra', targetId: 'tb' }],
        [{ referenceId: 'ra', targetId: 'troot' }],
    ]) {
        const bad = await analyzeUIWithSLM(baseline, target, { tasks: ['semantic-matching'],
            slm: client(provider(() => JSON.stringify({ ...empty(), semanticMatches: proposals })), { scope: baseline.scope }) });
        assert.equal(bad.reasoning.diagnostic.code, 'invalid-output');
    }
});

test('content relationship reasoning references supplied relationships and corresponding endpoints', async () => {
    const { baseline, target } = paired();
    const link = { from: 'title', to: 'description', type: 'heading-description', provenance: measurement(1).provenance, confidence: { score: 1 } };
    baseline.relationships.push(link);
    target.relationships.push({ ...link, from: 'target-title', to: 'target-description' });
    const selection = { ...empty(), relationships: [{ baselineIndex: 5, targetIndex: 5 }] };
    const result = await analyzeUIWithSLM(baseline, target, { tasks: ['content-relationships'], slm: client(provider(() => JSON.stringify(selection))) });
    assert.equal(result.reasoning.source, 'slm');
    assert.deepEqual(result.reasoning.relationships[0].baseline, link);
    assert.equal(result.reasoning.relationships[0].confidence.score, null);
    target.relationships[5].to = 'target-save';
    const invalid = await analyzeUIWithSLM(baseline, target, { tasks: ['content-relationships'], slm: client(provider(() => JSON.stringify(selection))) });
    assert.equal(invalid.reasoning.diagnostic.code, 'invalid-output');
});

test('disabled or absent SLM has deterministic fallback and zero provider calls', async () => {
    const { baseline, target } = changed(), p = provider();
    const absent = await analyzeUIWithSLM(baseline, target);
    const disabled = await analyzeUIWithSLM(baseline, target, { slm: new SLMClient(p, { scope }) });
    assert.deepEqual(disabled, absent);
    assert.equal(disabled.reasoning.diagnostic.code, 'disabled');
    assert.deepEqual(p.calls, { initialize: 0, generate: 0, dispose: 0 });
});

test('numeric-only and no-work requests skip inference', async () => {
    const { baseline, target } = changed(), p = provider();
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(p), tasks: ['semantic-matching'] });
    assert.equal(result.analysis.issues[0].difference.delta, 7);
    assert.equal(result.reasoning.diagnostic.code, 'no-work');
    const same = await analyzeUIWithSLM(baseline, baseline, { slm: client(p) });
    assert.equal(same.reasoning.diagnostic.code, 'no-work');
    await analyzeUIWithSLM(baseline, target, { slm: client(p), tasks: [] });
    assert.equal(p.calls.generate, 0); assert.equal(p.calls.initialize, 0);
});

test('deadline covers initialization and inference, even a provider that ignores abort', async () => {
    for (const initializeOnly of [false, true]) {
        let observed;
        const hang = signal => { observed = signal; return new Promise(() => {}); };
        const p = provider(request => hang(request.signal), initializeOnly ? { initialize: hang } : {});
        const slm = client(p, { timeoutMs: 15 });
        const result = await slm.generateJSON(scope, input, v => v);
        assert.equal(result.error.code, 'timeout'); assert.equal(observed.aborted, true);
        if (initializeOnly) assert.equal(p.calls.generate, 0);
    }
});

test('cancellation works before initialization, during generation and on disposal', async () => {
    const cancelled = new AbortController(); cancelled.abort();
    const p = provider();
    assert.equal((await client(p).generateJSON(scope, input, v => v, cancelled.signal)).error.code, 'cancelled');
    assert.equal(p.calls.initialize, 0);
    for (const useDispose of [false, true]) {
        const controller = new AbortController(); let started;
        const ready = new Promise(resolve => { started = resolve; });
        let requestSignal;
        const slm = client(provider(request => { requestSignal = request.signal; started(); return new Promise(() => {}); }));
        const pending = slm.generateJSON(scope, input, v => v, controller.signal);
        await ready;
        if (useDispose) await slm.dispose(); else controller.abort();
        assert.equal((await pending).error.code, 'cancelled'); assert.equal(requestSignal.aborted, true);
    }
});

test('context and output limits fail closed without truncating evidence', async () => {
    const p = provider(), slm = client(p);
    const oversized = await slm.generateJSON(scope, { ...input, prompt: '界'.repeat(20_000) }, v => v);
    assert.equal(oversized.error.code, 'context-limit'); assert.equal(p.calls.initialize, 0);
    const tooLong = client(provider(() => ' '.repeat(2048 * 16 + 1)));
    assert.equal((await tooLong.generateJSON(scope, input, v => v)).error.code, 'output-limit');
    assert.throws(() => client(p, { maxOutputTokens: 2049 }), RangeError);
    assert.throws(() => client(p, { timeoutMs: 0 }), RangeError);
});

test('active requests reject concurrent reuse and late initialization cannot revive a disposed client', async () => {
    let initialize;
    const pendingInitialization = new Promise(resolve => { initialize = resolve; });
    const p = provider(undefined, { initialize: () => pendingInitialization });
    const slm = client(p);
    const pending = slm.generateJSON(scope, input, v => v);
    assert.equal((await slm.generateJSON(scope, input, v => v)).error.code, 'busy');
    await slm.dispose();
    assert.equal((await pending).error.code, 'cancelled');
    initialize();
    await Promise.resolve();
    assert.equal(slm.state, 'disposed'); assert.equal(p.calls.generate, 0);
});

test('timeout and cancellation retain the busy guard until asynchronous provider cleanup settles', async () => {
    for (const cancellation of [false, true]) {
        let release, started;
        const cleanup = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { started = resolve; });
        let active = 0, peak = 0, first = true;
        const p = provider(async request => {
            active++; peak = Math.max(peak, active);
            try {
                if (first) {
                    first = false;
                    started();
                    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
                    await cleanup;
                    request.signal.throwIfAborted();
                }
                return JSON.stringify(empty());
            } finally { active--; }
        });
        const slm = client(p, { timeoutMs: cancellation ? 1000 : 15 });
        const controller = new AbortController();
        const pending = slm.generateJSON(scope, input, v => v, controller.signal);
        await ready;
        if (cancellation) controller.abort();
        assert.equal((await pending).error.code, cancellation ? 'cancelled' : 'timeout');
        assert.equal((await slm.generateJSON(scope, input, v => v)).error.code, 'busy');
        assert.equal(p.calls.generate, 1);
        release();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await slm.generateJSON(scope, input, v => v)).source, 'slm');
        assert.equal(peak, 1);
    }
});

test('timed-out initialization stays busy until it settles and pre-cancellation leaves the client reusable', async () => {
    let release;
    const initialization = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const p = provider(undefined, { async initialize() { if (++calls === 1) await initialization; } });
    const slm = client(p, { timeoutMs: 15 });
    const controller = new AbortController(); controller.abort();
    assert.equal((await slm.generateJSON(scope, input, v => v, controller.signal)).error.code, 'cancelled');
    assert.equal(calls, 0);
    assert.equal((await slm.generateJSON(scope, input, v => v)).error.code, 'timeout');
    assert.equal((await slm.generateJSON(scope, input, v => v)).error.code, 'busy');
    assert.equal(calls, 1);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(slm.state, 'idle');
    assert.equal((await slm.generateJSON(scope, input, v => v)).source, 'slm');
    assert.equal(calls, 2);
});

test('single-issue reasoning excludes long unrelated text while preserving connected evidence', async () => {
    const { baseline, target } = changed();
    baseline.nodes.find(n => n.id === 'description').text = 'a'.repeat(2000);
    target.nodes.find(n => n.id === 'target-description').text = 'a'.repeat(2000);
    const p = provider(request => {
        const data = JSON.parse(request.prompt);
        assert.deepEqual(data.baseline.nodes.map(n => n.id), ['panel', 'title']);
        assert.deepEqual(data.target.nodes.map(n => n.id), ['target-panel', 'target-title']);
        assert.deepEqual(data.baseline.relationships.map(r => r.index), [1]);
        assert.equal(data.baseline.nodes.find(n => n.id === 'title').text, 'Title');
        assert.equal(data.acceptedMatches.length, 2);
        return issueSelection(request);
    }, { limits: { contextTokens: 8192, maxOutputTokens: 1024 } });
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(p), tasks: ['issue-descriptions', 'css-suggestions'] });
    assert.equal(result.reasoning.source, 'slm'); assert.equal(p.calls.generate, 1);
    assert.equal(result.reasoning.issues[0].css.value, 20);
    assert.deepEqual(result.analysis, analyzeUI(baseline, target));
});

test('oversized relevant context falls back without truncation or partial inference', async () => {
    const { baseline, target } = changed();
    for (const snapshot of [baseline, target]) for (const node of snapshot.nodes) node.text = 'a'.repeat(2000);
    const p = provider(undefined, { limits: { contextTokens: 8192, maxOutputTokens: 1024 } });
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(p), tasks: ['issue-descriptions'] });
    assert.equal(result.reasoning.diagnostic.code, 'context-limit');
    assert.equal(p.calls.initialize, 0); assert.equal(p.calls.generate, 0);
    assert.deepEqual(result.analysis, analyzeUI(baseline, target));
});

test('cleanup is bounded and provider cleanup errors remain sanitized', async () => {
    const timeout = client(provider(undefined, { dispose: () => new Promise(() => {}) }), { timeoutMs: 15 });
    await assert.rejects(timeout.dispose(), error => error instanceof SLMError && error.code === 'timeout');
    assert.equal(timeout.state, 'disposed');
    const failure = client(provider(undefined, { dispose: async () => { throw new Error('company secret'); } }));
    await assert.rejects(failure.dispose(), error => error.code === 'provider-error' && !error.message.includes('company secret'));
});

test('company/personal and company/company scopes cannot share snapshots or clients', async () => {
    const { baseline, target } = changed(), p = provider();
    target.scope = { kind: 'company', id: 'another' };
    await assert.rejects(analyzeUIWithSLM(baseline, target, { slm: client(p) }), /workspace scopes/);
    for (const other of [{ kind: 'company', id: scope.id }, { kind: 'personal', id: 'other' }]) {
        const result = await client(p).generateJSON(other, input, v => v);
        assert.equal(result.error.code, 'scope-mismatch');
    }
    assert.equal(p.calls.initialize, 0);
});

test('external providers require explicit enablement and external opt-in', async () => {
    const p = provider(undefined, { locality: 'external' });
    assert.equal((await client(p).generateJSON(scope, input, v => v)).error.code, 'external-disabled');
    assert.equal(p.calls.initialize, 0);
    assert.equal((await client(p, { allowExternal: true }).generateJSON(scope, input, v => v)).source, 'slm');
});

test('provider errors are sanitized; a failed initialization can be retried explicitly', async () => {
    let count = 0;
    const slm = client(provider(undefined, { initialize: async () => { if (!count++) throw new Error('secret company page content'); } }));
    const failed = await slm.generateJSON(scope, input, v => v);
    assert.equal(failed.error.code, 'provider-error'); assert.doesNotMatch(JSON.stringify(failed), /secret company/);
    assert.equal(slm.state, 'idle');
    assert.equal((await slm.generateJSON(scope, input, v => v)).source, 'slm');
    const invalid = await client(provider()).generateJSON(scope, input, () => { throw new Error('sensitive'); });
    assert.equal(invalid.error.code, 'invalid-output');
});

test('Ollama uses bounded structured JSON chat with a fresh conversation and no downloads', async () => {
    const transport = ollamaTransport();
    const p = new OllamaProvider({ model: 'my-installed-local-model', fetch: transport.fetch });
    const slm = client(p);
    assert.equal((await slm.generateJSON(scope, input, v => v)).source, 'slm');
    assert.equal((await slm.generateJSON(scope, input, v => v)).source, 'slm');
    const chats = transport.calls.filter(c => c.url.endsWith('/chat'));
    assert.equal(chats.length, 2);
    assert.deepEqual(chats[0].body.format, input.schema);
    assert.equal(chats[0].body.stream, false); assert.equal(chats[0].body.keep_alive, 0);
    assert.equal(chats[0].body.truncate, false); assert.equal(chats[0].body.shift, false);
    assert.deepEqual(chats[0].body.options, { temperature: 0, seed: 0, num_ctx: 8192, num_predict: 1024 });
    assert.equal(chats[0].body.messages.length, 2);
    assert.deepEqual(chats[1].body.messages, chats[0].body.messages);
    assert.equal(chats[0].init.redirect, 'error'); assert.equal(chats[0].init.credentials, 'omit');
    assert.ok(chats[0].init.signal instanceof AbortSignal);
    assert.ok(transport.calls.every(c => c.url.startsWith('http://127.0.0.1:11434/api/')));
    await slm.dispose();
});

test('missing Ollama model falls back without downloading or sending page data', async () => {
    const { baseline, target } = changed(), calls = [];
    const p = new OllamaProvider({ model: 'not-installed', fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) }); return new Response('not installed', { status: 404 });
    } });
    const result = await analyzeUIWithSLM(baseline, target, { slm: client(p) });
    assert.equal(result.reasoning.diagnostic.code, 'missing-model');
    assert.deepEqual(result.analysis, analyzeUI(baseline, target));
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { model: 'not-installed' });
});

test('Ollama rejects remote origins, redirects and localhost cloud aliases', async () => {
    for (const baseURL of ['https://ollama.com', 'http://192.168.1.1:11434', 'http://localhost.evil.test',
        'http://user:password@localhost:11434', 'http://localhost:11434/path', 'http://localhost:11434/?proxy=remote']) {
        assert.throws(() => new OllamaProvider({ model: 'local', baseURL }), /loopback origin/);
    }
    assert.throws(() => new OllamaProvider({ model: 'model:cloud' }), /local model/);
    for (const metadata of [{ remote_model: 'remote' }, { remote_host: 'https://ollama.com' }, { model_info: {} }]) {
        const transport = ollamaTransport({}, metadata);
        const result = await client(new OllamaProvider({ model: 'innocent-alias', fetch: transport.fetch })).generateJSON(scope, input, v => v);
        assert.equal(result.error.code, 'external-disabled'); assert.equal(transport.calls.length, 1);
    }
    const redirected = client(new OllamaProvider({ model: 'local', fetch: async () => new Response('', { status: 302 }) }));
    assert.equal((await redirected.generateJSON(scope, input, v => v)).error.code, 'provider-error');
});

test('Ollama handles malformed envelopes, service errors, model context and truncation', async () => {
    for (const [chat, code] of [
        [{ done_reason: 'length' }, 'output-limit'], [{ done: false }, 'output-limit'],
        [{ eval_count: 2000 }, 'output-limit'], [{ prompt_eval_count: 8190 }, 'context-limit'],
        [{ eval_count: -1 }, 'provider-error'], [{ message: { content: 42 } }, 'invalid-output'],
        [{ message: { content: 'broken JSON' } }, 'invalid-json'], [{ error: 'secret' }, 'provider-error'],
        [{ remote_host: 'https://ollama.com' }, 'external-disabled'],
    ]) {
        const transport = ollamaTransport(chat);
        const result = await client(new OllamaProvider({ model: 'local', fetch: transport.fetch })).generateJSON(scope, input, v => v);
        assert.equal(result.error.code, code);
    }
    const transport = ollamaTransport({}, { model_info: { 'test.context_length': 4096 } });
    assert.equal((await client(new OllamaProvider({ model: 'local', fetch: transport.fetch })).generateJSON(scope, input, v => v)).error.code, 'context-limit');
    for (const status of [401, 500, 503]) {
        const p = new OllamaProvider({ model: 'local', fetch: async () => new Response('sensitive error body', { status }) });
        assert.equal((await client(p).generateJSON(scope, input, v => v)).error.code, 'provider-error');
    }
});

test('oversized Ollama bodies cancel the response stream and fall back', async () => {
    let cancelled = false;
    const p = new OllamaProvider({ model: 'local', fetch: async url => {
        if (url.endsWith('/show')) return response({ model_info: { 'test.context_length': 8192 } });
        return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(40_000))); },
            cancel() { cancelled = true; },
        }));
    } });
    const result = await client(p).generateJSON(scope, input, v => v);
    assert.equal(result.error.code, 'output-limit'); assert.equal(cancelled, true);
});

test('CSS retains estimated provenance and never manufactures CSS from unknowns or rendered bounds', async () => {
    const { baseline, target, node } = changed();
    baseline.nodes.find(n => n.id === 'title').typography.fontSize.provenance.kind = 'estimated';
    baseline.nodes.find(n => n.id === 'title').typography.fontSize.confidence.score = 0.6;
    const estimated = await analyzeUIWithSLM(baseline, target);
    assert.equal(estimated.reasoning.issues[0].css.evidence.measurement.confidence.score, 0.6);
    assert.equal(estimated.reasoning.issues[0].css.evidence.measurement.provenance.kind, 'estimated');
    baseline.nodes.find(n => n.id === 'title').typography.fontSize = unknown();
    node('image').bounds.value.width = 150;
    const result = await analyzeUIWithSLM(baseline, target);
    assert.ok(!result.analysis.issues.some(issue => issue.property === 'typography.fontSize'));
    assert.ok(result.reasoning.issues.every(issue => issue.css === undefined));
});
