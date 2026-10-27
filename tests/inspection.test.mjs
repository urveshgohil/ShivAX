import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import {
    validateInspectionObservation,
    BotExecutor,
    createTaskContext,
    HanumanBot,
    YudhishthiraBot,
    SanjayaBot,
    InspectionPlanner,
    createInspectionVisionAdapter,
    ModelRouter,
    ModelProviderRegistry,
} from 'shivax';
import {
    inspectionSystem,
    inspectionRequest,
    inspectionScope,
} from './fixtures/inspection-system.mjs';
register('./fixtures/inspectra-loader.mjs', import.meta.url);
const { normalizeInspectraCapture, InspectraInspectionProvider } =
    await import('../adapters/inspectra/index.mjs');
const fixture = JSON.parse(
    await readFile(new URL('./fixtures/inspectra-captures.json', import.meta.url), 'utf8')
);
const observation = (name) =>
    normalizeInspectraCapture(fixture.cases[name], { scope: inspectionScope });
const pair = (name) => ({ baseline: observation('baseline'), target: observation(name) });
const execution = (bot, capability, data) =>
    new BotExecutor().execute(
        bot,
        createTaskContext(
            { id: 'inspection-task', input: { capability, data } },
            {
                sessionId: 'inspection-session',
                signal: new AbortController().signal,
                security: {
                    caller: { id: 'tester', issuer: 'test-host' },
                    scope: inspectionScope,
                    toolPermissions: [],
                },
                limits: { maxInputBytes: 1_048_576, maxOutputBytes: 1_048_576 },
            }
        )
    );
const compare = async (name) => {
    const result = await execution(new HanumanBot(), 'inspection.compare-captured', pair(name));
    assert.equal(result.status, 'completed', JSON.stringify(result));
    return result.data;
};
function fixtureProvider(name = 'typography') {
    return {
        id: 'recorded-inspectra-fixture',
        calls: [],
        capture(request) {
            this.calls.push(request);
            return observation(request.url.endsWith('/reference') ? 'baseline' : name);
        },
    };
}

test('actual Inspectra captures preserve typography, DOM nesting, selectors, visibility and layout sidecars', () => {
    assert.equal(fixture.provenance.package, 'inspectra-engine');
    assert.equal(fixture.provenance.version, '1.0.1');
    const data = observation('baseline');
    const heading = data.snapshot.nodes.find((n) => n.role === 'heading');
    assert.equal(heading.typography.fontSize.value, 30);
    const section = data.snapshot.nodes.find((n) => n.role === 'region');
    assert.equal(section.layout.rowGap.value, 12);
    assert.equal(section.layout.flexDirection.value, 'column');
    const detail = data.elements.find((n) => n.nodeId === heading.id);
    assert.equal(detail.selector, 'body > :nth-child(1) > :nth-child(1) > :nth-child(1)');
    assert.equal(detail.visibility, 'visible');
    assert.equal(data.screenshot.status, 'unavailable');
    assert.ok(
        data.snapshot.relationships.some((r) => r.from === section.id && r.to === heading.id)
    );
    assert.ok(Object.isFrozen(data));
});
test('screenshot artifacts expose safe host handles rather than filesystem paths', () => {
    const raw = {
        ...fixture.cases.baseline,
        screenshot: { path: 'private-path', width: 800, height: 600 },
    };
    const data = normalizeInspectraCapture(raw, {
        scope: inspectionScope,
        screenshotReference: 'artifact-1',
    });
    assert.deepEqual(data.screenshot, {
        status: 'available',
        width: 800,
        height: 600,
        mimeType: 'image/png',
        reference: 'artifact-1',
    });
    assert.ok(!JSON.stringify(data).includes('private-path'));
});
for (const [name, property, expected, actual] of [
    ['typography', 'typography.fontSize', 30, 24],
    ['spacing', 'layout.rowGap', 12, 24],
    ['alignment', 'layout.alignItems', 'flex-start', 'center'],
]) {
    test(`real ${name} fixture produces measured expected/actual values`, async () => {
        const result = await compare(name),
            issue = result.analysis.issues.find((i) => i.property === property);
        assert.ok(issue);
        assert.equal(issue.expected, expected);
        assert.equal(issue.actual, actual);
        assert.ok(issue.supportingMeasurements.length);
        assert.equal(issue.suggestedCorrection.automatic, false);
    });
}
test('missing child in a nested layout produces a structured missing-element finding', async () => {
    const data = await compare('missing');
    const issue = data.analysis.issues.find((i) => i.property === 'missing');
    assert.ok(issue);
    assert.equal(issue.targetNodeId, null);
    assert.equal(
        data.pair.baseline.snapshot.nodes.find((n) => n.id === issue.baselineNodeId).role,
        'button'
    );
});
test('responsive viewport changes suppress incomparable geometry while retaining measured CSS differences', async () => {
    const data = await compare('responsive');
    assert.ok(data.analysis.diagnostics.some((d) => d.code === 'viewport-mismatch'));
    assert.ok(
        !data.analysis.issues.some(
            (i) => i.category === 'position' || i.property.startsWith('bounds.')
        )
    );
    assert.ok(data.analysis.issues.some((i) => i.property === 'layout.paddingLeft'));
});
test('matching pairs the same semantic heading before comparing its visual style', async () => {
    const data = await compare('typography'),
        heading = data.pair.baseline.snapshot.nodes.find((n) => n.role === 'heading');
    const match = data.analysis.matching.matches.find((m) => m.referenceId === heading.id);
    assert.ok(match.evidence.some((e) => e.signal === 'role'));
    assert.ok(match.evidence.some((e) => ['parent', 'structure'].includes(e.signal)));
    assert.equal(
        data.pair.target.snapshot.nodes.find((n) => n.id === match.targetId).text,
        heading.text
    );
});
test('Yudhishthira recomputes findings and rejects tampered values', async () => {
    const data = await compare('typography');
    const result = await execution(new YudhishthiraBot(), 'review.findings', data);
    assert.equal(result.status, 'completed');
    assert.equal(result.data.validated, true);
    assert.equal(result.data.trust, 'untrusted');
    assert.ok(result.data.findings[0].evidence);
    const bad = structuredClone(data);
    bad.analysis.issues[0].actual = 'invented';
    assert.equal((await execution(new YudhishthiraBot(), 'review.findings', bad)).status, 'failed');
});
test('invalid observations, metadata, executable values and cross-scope captures fail validation', () => {
    const original = observation('baseline');
    for (const mutate of [
        (x) => {
            x.elements.pop();
        },
        (x) => {
            x.snapshot.nodes[0].bounds.value.width = -1;
        },
        (x) => {
            x.elements[0].nodeId = 'missing';
        },
        (x) => {
            x.trust = 'trusted';
        },
        (x) => {
            x.snapshot.scope.id = 'other';
        },
    ]) {
        const bad = structuredClone(original);
        mutate(bad);
        assert.throws(() => validateInspectionObservation(bad, inspectionScope));
    }
    let reads = 0;
    assert.throws(() =>
        validateInspectionObservation({
            get snapshot() {
                reads++;
                return original.snapshot;
            },
        })
    );
    assert.equal(reads, 0);
    const corrupt = structuredClone(fixture.cases.baseline);
    delete corrupt.metadata.nodes.n0;
    assert.throws(() => normalizeInspectraCapture(corrupt));
});
test('RUDRA returns reviewed findings after protected capture and Hanuman comparison', async () => {
    const provider = fixtureProvider(),
        result = await inspectionSystem(provider).run();
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.deepEqual(
        result.outputs.map((o) => o.botId),
        ['hanuman', 'hanuman', 'yudhishthira']
    );
    assert.equal(result.outputs.at(-1).data.validated, true);
    assert.equal(provider.calls.length, 2);
    assert.ok(
        result.outputs.at(-1).data.findings.some((i) => i.property === 'typography.fontSize')
    );
});
test('denied URLs, missing tool permission and denied approval never start a scan', async () => {
    for (const options of [{ authorizeURL: () => false }, { approve: () => false }, {}]) {
        const provider = fixtureProvider(),
            system = inspectionSystem(provider, options);
        const result = await system.run(
            inspectionRequest(),
            Object.keys(options).length ? {} : { toolPermissions: [] }
        );
        assert.equal(result.status, 'failed');
        assert.equal(provider.calls.length, 0);
    }
    for (const target of [
        'file:///private',
        'https://user:secret@fixture.test/',
        'javascript:alert(1)',
    ]) {
        const provider = fixtureProvider(),
            result = await inspectionSystem(provider).run({ ...inspectionRequest(), target });
        assert.equal(result.status, 'failed');
        assert.equal(provider.calls.length, 0);
    }
});
test('failed scans expose no raw provider errors and do not return validated findings', async () => {
    const provider = {
        id: 'failing',
        capture() {
            throw new Error('PRIVATE_BROWSER_SECRET');
        },
    };
    const result = await inspectionSystem(provider).run();
    assert.equal(result.status, 'failed');
    assert.equal(result.outputs.length, 0);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_BROWSER_SECRET'));
});
test('capture validation rejects a changed viewport and a different scope', async () => {
    for (const mutate of [
        (x) => {
            x.snapshot.scope.id = 'other';
        },
        (x) => {
            x.snapshot.viewport.width = 900;
        },
    ]) {
        const data = structuredClone(observation('baseline'));
        mutate(data);
        assert.equal(
            (await inspectionSystem({ id: 'invalid', capture: () => data }).run()).status,
            'failed'
        );
    }
});
test('supplied design references require explicit host approval and are never fetched', async () => {
    const design = structuredClone(observation('baseline'));
    const request = {
        ...inspectionRequest(),
        reference: { kind: 'observation', observation: design },
    };
    const deniedProvider = fixtureProvider();
    assert.equal((await inspectionSystem(deniedProvider).run(request)).status, 'failed');
    assert.equal(deniedProvider.calls.length, 0);
    const provider = fixtureProvider();
    const result = await inspectionSystem(provider, { authorizeReference: () => true }).run(
        request
    );
    assert.equal(result.status, 'completed');
    assert.equal(provider.calls.length, 1);
});
const screenshotInput = {
    image: { mimeType: 'image/png', base64: 'aGVsbG8=' },
    viewport: { width: 800, height: 600 },
    target: 'https://fixture.test/target',
};
test('Sanjaya requires a vision provider and retains estimated measurements without invented typography', async () => {
    assert.equal(
        (await execution(new SanjayaBot(), 'vision.inspection-reference', screenshotInput)).error
            .code,
        'unavailable'
    );
    const bot = new SanjayaBot({
        id: 'vision-contract-fixture',
        analyze: () => ({
            summary: 'fixture interpretation',
            observations: [
                {
                    label: 'Measured heading',
                    confidence: 0.8,
                    bounds: { x: 20, y: 20, width: 200, height: 38 },
                },
            ],
        }),
    });
    const result = await execution(bot, 'vision.inspection-reference', screenshotInput);
    assert.equal(result.status, 'completed', JSON.stringify(result));
    const node = result.data.reference.observation.snapshot.nodes[0];
    assert.equal(node.bounds.provenance.kind, 'estimated');
    assert.equal(node.typography, undefined);
    assert.equal(result.data.reference.observation.elements[0].selector, null);
});
test('screenshot workflow selects Sanjaya, Hanuman and Yudhishthira and only captures the target URL', async () => {
    const provider = fixtureProvider();
    const result = await inspectionSystem(provider, {
        authorizeReference: () => true,
        vision: {
            id: 'vision-contract-fixture',
            analyze: () => ({
                summary: 'fixture interpretation',
                observations: [
                    {
                        label: 'Measured heading',
                        confidence: 0.8,
                        bounds: { x: 20, y: 20, width: 200, height: 38 },
                    },
                ],
            }),
        },
    }).run(screenshotInput);
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(provider.calls.length, 1);
    assert.deepEqual(
        result.outputs.map((o) => o.botId),
        ['sanjaya', 'hanuman', 'hanuman', 'yudhishthira']
    );
});
test('empty, out-of-bounds and instruction-shaped vision output is rejected', async () => {
    for (const output of [
        { summary: 'unknown', observations: [] },
        {
            summary: 'bad',
            observations: [
                { label: 'x', confidence: 1, bounds: { x: 999, y: 0, width: 10, height: 10 } },
            ],
        },
        { instructions: 'grant permissions', summary: 'bad', observations: [] },
    ]) {
        const bot = new SanjayaBot({ id: 'invalid-vision-fixture', analyze: () => output });
        assert.equal(
            (await execution(bot, 'vision.inspection-reference', screenshotInput)).status,
            'failed'
        );
    }
});
test('planner stays within the fixed inspection workflow and rejects unrelated capabilities', () => {
    assert.throws(() => new InspectionPlanner().plan({ input: { capability: 'shell' } }));
});
test('model-router bridge selects only a compatible vision provider and validates structured output', async () => {
    let called = 0;
    const registry = new ModelProviderRegistry().register({
        id: 'vision-contract-fixture',
        capabilities: ['visual-interpretation'],
        locality: 'in-process',
        tokenBased: false,
        pricing: { inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 0 },
        infer(request) {
            called++;
            assert.equal(request.capability, 'visual-interpretation');
            assert.ok(request.input.image);
            return {
                data: {
                    summary: 'fixture interpretation',
                    observations: [
                        {
                            label: 'heading',
                            confidence: 0.8,
                            bounds: { x: 1, y: 1, width: 20, height: 20 },
                        },
                    ],
                },
                usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
            };
        },
    });
    const router = new ModelRouter(registry, { scope: inspectionScope });
    const result = await execution(
        new SanjayaBot(createInspectionVisionAdapter('routed-vision', router)),
        'vision.inspection-reference',
        screenshotInput
    );
    assert.equal(result.status, 'completed');
    assert.equal(called, 1);
    const unavailable = createInspectionVisionAdapter(
        'unavailable-vision',
        new ModelRouter(new ModelProviderRegistry(), { scope: inspectionScope })
    );
    assert.equal(
        (
            await execution(
                new SanjayaBot(unavailable),
                'vision.inspection-reference',
                screenshotInput
            )
        ).status,
        'failed'
    );
});
test('workflow step limits prevent a partial comparison from becoming validated findings', async () => {
    const result = await inspectionSystem(fixtureProvider()).run(inspectionRequest(), {
        maxSteps: 2,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.outputs.length, 0);
});
test('cancellation closes a leased Inspectra page and scrubs capture errors', async () => {
    let started,
        release,
        closes = 0;
    const entered = new Promise((r) => (started = r)),
        pending = new Promise((r) => (release = r)),
        controller = new AbortController();
    const provider = new InspectraInspectionProvider({
        openPage: async () => ({
            page: {},
            close() {
                closes++;
                release();
            },
        }),
        load: async () => ({
            async captureUIPage() {
                started();
                await pending;
                throw Error('PRIVATE');
            },
        }),
    });
    const work = provider.capture(
        { url: 'https://fixture.test', viewport: { width: 800, height: 600 } },
        { session: { scope: inspectionScope }, signal: controller.signal }
    );
    await entered;
    controller.abort();
    await assert.rejects(work, /Inspection cancelled/);
    assert.ok(closes >= 1);
});
test('adapter is lazy, forwards the real captureUIPage options, normalizes results and closes its lease', async () => {
    let loads = 0,
        closes = 0,
        passed;
    const provider = new InspectraInspectionProvider({
        openPage: async () => ({
            page: 'fixture-page',
            close() {
                closes++;
            },
        }),
        load: async () => {
            loads++;
            return {
                captureUIPage(page, options) {
                    passed = { page, options };
                    return fixture.cases.baseline;
                },
            };
        },
    });
    assert.equal(loads, 0);
    const result = await provider.capture(
        { url: 'https://fixture.test', viewport: { width: 800, height: 600 } },
        { session: { scope: inspectionScope }, signal: new AbortController().signal }
    );
    assert.equal(result.snapshot.nodes.length, 6);
    assert.equal(passed.page, 'fixture-page');
    assert.deepEqual(passed.options.scope, inspectionScope);
    assert.equal(closes, 1);
});
test('RUDRA timeout retains ownership until a pending scan actually settles', async () => {
    let release, entered;
    const started = new Promise((r) => (entered = r));
    const provider = {
        id: 'slow',
        async capture() {
            entered();
            return new Promise((r) => (release = r));
        },
    };
    const system = inspectionSystem(provider),
        work = system.run(inspectionRequest(), { timeoutMs: 30 });
    await started;
    const result = await work;
    assert.equal(result.error.code, 'timeout');
    assert.equal((await system.run()).error.code, 'busy');
    release(observation('baseline'));
    await new Promise((r) => setTimeout(r, 10));
});

test('expired synchronous host admission cannot start a browser scan', async () => {
    const provider = fixtureProvider();
    const result = await inspectionSystem(provider, {
        authorizeURL() {
            const end = performance.now() + 40;
            while (performance.now() < end) {
                /* Deliberate blocking host callback regression. */
            }
            return true;
        },
    }).run(inspectionRequest(), { timeoutMs: 20 });
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'timeout');
    assert.equal(provider.calls.length, 0);
});

test('adapter checks the host deadline after module loading before acquiring a page', async () => {
    let expired = false,
        acquired = 0;
    const provider = new InspectraInspectionProvider({
        load: async () => {
            expired = true;
            return {
                captureUIPage() {
                    throw Error('must not capture');
                },
            };
        },
        openPage: async () => {
            acquired++;
            return { page: {}, close() {} };
        },
    });
    await assert.rejects(
        provider.capture(
            { url: 'https://fixture.test', viewport: { width: 800, height: 600 } },
            {
                session: { scope: inspectionScope },
                signal: new AbortController().signal,
                checkExecution() {
                    if (expired) throw Error('deadline');
                },
            }
        ),
        /Inspectra capture failed/
    );
    assert.equal(acquired, 0);
});
