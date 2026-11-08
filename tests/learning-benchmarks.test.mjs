// SARASWATI S02: reproducible evaluation and benchmark engine.
// B1-B9 follow the S02 phase prompt (step 7); B10-B18 cover the remaining gates. Offline and deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    EVALUATION_DOMAINS, evaluateDataset, validateEvaluationDataset, validateEvaluationRecord, EvaluatedModelUpdates,
    createBenchmarkSuite, validateBenchmarkSuite, benchmarkSuiteFromEvaluationDataset, selectBenchmarkCases,
    checkBenchmarkLeakage, runBenchmark, validateBenchmarkReport, checkBenchmarkReproducibility,
    compareBenchmarkReports, assessBenchmarkCandidate, validateBenchmarkPolicy, STRICT_BENCHMARK_POLICY,
    BENCHMARK_ERROR_CATEGORIES, BENCHMARK_GATE_REASONS, exportTrainingData, digestLearningValue,
    createSpecialistSystem, BotExecutor, createTaskContext, VishwakarmaBot, MemoryEngine, analyzeUI,
} from 'shivax';
import * as learningEntry from 'shivax/learning';
import { learningCases } from './fixtures/learning-cases.mjs';
import { paired, measurement } from './fixtures/ui-analysis.mjs';
import { OWNER, OTHER, NOW, USAGE, benchmarkCases, suiteInput, mockEvaluator, runOptions, TRUSTED } from './fixtures/benchmark-suite.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const suite = () => createBenchmarkSuite(suiteInput());
const run = async (variant = {}, role = 'baseline', options = {}, evaluator = {}) =>
    runBenchmark(options.suite ?? (await suite()), mockEvaluator({ variant, ...evaluator }), runOptions(role, options.run));
const reasonCodes = (assessment) => assessment.reasons.map((r) => r.code);
/** Re-digests a tampered report exactly as the runner does, so only the content checks can catch it. */
async function resign(report) {
    const { logicalDigest: _l, digest: _d, ...body } = report;
    const { ranAt: _r, cases, summary, ...rest } = body;
    const { latency: _lat, ...measured } = summary;
    const logicalDigest = await digestLearningValue({ ...rest, cases: cases.map(({ latencyMs: _ms, ...c }) => c), summary: measured });
    return { ...body, logicalDigest, digest: await digestLearningValue({ ...body, logicalDigest }) };
}
async function assess(baseline, candidate, extra = {}) {
    return assessBenchmarkCandidate({ suite: await suite(), baseline, candidate, trustedEvaluators: TRUSTED, ...extra });
}

test('B1 same dataset and seed produce identical logical output across runs', async () => {
    const s = await suite();
    const a = await runBenchmark(s, mockEvaluator(), runOptions());
    const b = await runBenchmark(clone(s), mockEvaluator(), runOptions('baseline', { now: () => NOW + 60_000 }));
    assert.equal(a.logicalDigest, b.logicalDigest);
    assert.deepEqual(a.cases.map(({ latencyMs: _m, ...c }) => c), b.cases.map(({ latencyMs: _m, ...c }) => c));
    const { latency: _x, ...sa } = a.summary, { latency: _y, ...sb } = b.summary;
    assert.deepEqual(sa, sb);
    const check = await checkBenchmarkReproducibility([a, b]);
    assert.equal(check.reproducible, true);
    assert.deepEqual(check.differingCases, []);
    assert.equal(a.summary.total, 13);
    assert.equal(a.summary.passRate, 1);
    assert.equal(a.seed, 'seed-1');
    assert.equal(a.dataset.digest, s.dataset.digest);
    assert.equal(a.dataset.digest, await digestLearningValue(s.cases));
    // Every request carried the fixed seed and the configuration identity, never the label.
    const calls = [];
    await runBenchmark(s, mockEvaluator({ variant: { calls } }), runOptions());
    assert.equal(calls.length, 13);
    for (const c of calls) {
        assert.equal(c.seed, 'seed-1');
        assert.deepEqual(Object.keys(c).sort(), ['caseId', 'configuration', 'domain', 'input', 'seed', 'signal']);
        assert.deepEqual({ ...c.configuration }, { role: 'baseline', id: 'model-a', version: '1' });
    }
});

test('B2 baseline vs candidate comparison reports fixes, regressions, deltas and eligibility', async () => {
    const baseline = await run({ misroute: true, breakReasoning: true });
    const candidate = await run({}, 'candidate');
    const comparison = await compareBenchmarkReports(baseline, candidate, await suite());
    assert.deepEqual([...comparison.fixed].sort(), ['reason-sum', 'route-code']);
    assert.deepEqual(comparison.regressed, []);
    assert.equal(comparison.overall.candidate, 1);
    assert.equal(comparison.overall.delta, 2 / 13);
    assert.equal(comparison.domains.routing.delta, 1 - 2 / 3);
    assert.equal(comparison.domains.permission.delta, 0);
    assert.equal(comparison.usage.tokenDelta, 0);
    assert.equal(comparison.usage.costDeltaUSD, 0);
    const good = await assess(baseline, candidate);
    assert.equal(good.eligible, true, JSON.stringify(good.reasons));
    assert.equal(good.activation, 'requires-host-approval');
    assert.equal(good.policy.id, STRICT_BENCHMARK_POLICY.id);

    // Reversed: the worse configuration as candidate regresses and is below the strict minimum.
    const worse = await run({ misroute: true }, 'candidate');
    const bad = await assess(await run(), worse);
    assert.equal(bad.eligible, false);
    assert.deepEqual(reasonCodes(bad).sort(), ['below-minimum', 'regression', 'regression']);
    assert.deepEqual(bad.reasons.find((r) => r.code === 'below-minimum').scope, 'overall');
    assert.deepEqual(bad.reasons.filter((r) => r.code === 'regression').map((r) => r.scope).sort(), ['overall', 'routing']);
    // Roles are explicit: two baselines cannot be compared.
    await assert.rejects(compareBenchmarkReports(baseline, baseline), /roles/);
});

test('B3 invalid labels and label provenance are rejected', async () => {
    const withCase = (patch, index = 0) => {
        const cases = benchmarkCases();
        cases[index] = { ...cases[index], ...patch };
        return createBenchmarkSuite(suiteInput({ cases }));
    };
    const invalid = [
        [{ provenance: { origin: 'inferred' } }, 0],
        [{ provenance: { origin: 'model' } }, 0],
        [{ provenance: {} }, 0],
        [{ label: { botId: '' } }, 0],
        [{ label: { botId: 'x', extra: 1 } }, 0],
        [{ label: { method: 'fields', fields: [] } }, 3],
        [{ label: { method: 'fields', fields: [{ path: [], equals: 1 }] } }, 3],
        [{ label: { sum: 5 } }, 3],
        [{ label: { outcome: 'apply' } }, 5], // no correctness criterion: fluency is never correctness
        [{ label: { outcome: 'maybe' } }, 5],
        [{ label: { issues: ['a', 'a'] } }, 7],
        [{ label: { issues: ['has space'] } }, 7],
        [{ label: { decision: 'ask' } }, 9],
        [{ label: { relevant: ['a', 'b'], k: 1, scope: OWNER } }, 11],
        [{ label: { relevant: ['a'], k: 0, scope: OWNER } }, 11],
        [{ label: { relevant: ['a'], k: 2, scope: { scopeKind: 'team', scopeId: 'x' } } }, 11],
        [{ label: { method: 'exact' } }, 4],
        [{ domain: 'unknown' }, 0],
        [{ mandatory: 'yes' }, 0],
    ];
    for (const [patch, index] of invalid) await assert.rejects(withCase(patch, index), Error, JSON.stringify(patch));
    // Missing labels.
    const cases = benchmarkCases();
    delete cases[0].label;
    await assert.rejects(createBenchmarkSuite(suiteInput({ cases })), /label is missing/);
    // Duplicate test ids.
    await assert.rejects(createBenchmarkSuite(suiteInput({ cases: [...benchmarkCases(), benchmarkCases()[0]] })), /Duplicate benchmark case id/);
    // Edited cases no longer match the declared dataset digest.
    const s = await suite();
    const edited = clone(s);
    edited.cases[0].label.botId = 'sanjay';
    await assert.rejects(validateBenchmarkSuite(edited), /dataset digest mismatch/);
    await assert.rejects(runBenchmark(edited, mockEvaluator(), runOptions()), /dataset digest mismatch/);
    // Inferred evidence is fine in observations (it is measured separately); it just cannot be a label.
    await assert.rejects(validateBenchmarkSuite({ ...s, version: 2 }), /Invalid/);
});

test('B4 missing, extra or reordered cases fail validation against the suite and the gate', async () => {
    const s = await suite(), report = await run();
    const missing = clone(report);
    missing.cases.pop();
    await assert.rejects(validateBenchmarkReport(missing, s), /summary/);
    // A self-consistent forgery: a 12-case run relabelled as the full suite, with its summary and digests intact.
    // Only the suite check can catch it.
    const shorter = clone(await runBenchmark(await createBenchmarkSuite(suiteInput({ cases: benchmarkCases().slice(0, 12) })), mockEvaluator(), runOptions('candidate')));
    shorter.dataset = clone(s.dataset);
    const forged = await resign(shorter);
    assert.equal((await validateBenchmarkReport(forged)).summary.total, 12);
    await assert.rejects(validateBenchmarkReport(forged, s), /missing cases/);
    await assert.rejects(assess(report, forged), /missing cases/);
    const reordered = clone(report);
    reordered.cases.reverse();
    await assert.rejects(validateBenchmarkReport(await resign(reordered), s), /missing cases|summary/);
    // A report for an older suite version is not accepted as evidence for the current one.
    const older = await runBenchmark(await createBenchmarkSuite(suiteInput({ suiteVersion: '0.9.0' })), mockEvaluator(), runOptions('candidate'));
    await assert.rejects(assess(report, older), /suite version/);
    await assert.rejects(compareBenchmarkReports(report, older), /Inconsistent benchmark versions/);
});

test('B5 dataset leakage between training data and benchmark cases is detected and blocks runs and eligibility', async () => {
    const s = await suite();
    const feedback = (id, input) => ({ version: 1, id, taskId: 't', botId: 'ekalavy', domain: 'routing', input, output: null, decision: 'accept' });
    const clean = exportTrainingData([feedback('fb-unrelated', { capability: 'other' })], () => true);
    const byInput = exportTrainingData([feedback('fb-x', { capability: 'vision.inspect' })], () => true);
    const byId = exportTrainingData([feedback('fb-route-code', { capability: 'different' })], () => true);
    assert.equal((await checkBenchmarkLeakage(s, [clean])).ok, true);
    const leaks = await checkBenchmarkLeakage(s, [clean, byInput, byId]);
    assert.equal(leaks.ok, false);
    assert.deepEqual(leaks.leaks.map((l) => [l.caseId, l.kind, l.feedbackId]), [
        ['route-code', 'feedback-id', 'fb-route-code'],
        ['route-vision', 'input', 'fb-x'],
    ]);
    await assert.rejects(runBenchmark(s, mockEvaluator(), runOptions('candidate', { training: [byInput] })), /leakage/);
    const ok = await runBenchmark(s, mockEvaluator(), runOptions('candidate', { training: [clean] }));
    assert.equal(ok.summary.passRate, 1);
    const assessment = await assess(await run(), ok, { training: [byId] });
    assert.equal(assessment.eligible, false);
    assert.deepEqual(reasonCodes(assessment), ['dataset-leakage']);
    await assert.rejects(checkBenchmarkLeakage(s, [{ format: 'shivax-curated-training', version: 1, trust: 'trusted', rows: [] }]));
});

test('B6 timeout and cancellation: case timeouts fail closed, run deadline and abort reject the run', async () => {
    const s = await suite();
    // A case that never settles times out; the run continues and the case counts as unevaluated.
    const hang = await runBenchmark(s, mockEvaluator({ variant: { override: { 'perm-deny': () => new Promise(() => {}) } } }), runOptions('candidate', { caseTimeoutMs: 20 }));
    const hung = hang.cases.find((c) => c.id === 'perm-deny');
    assert.equal(hung.category, 'timeout');
    assert.equal(hung.passed, false);
    assert.equal(hang.summary.errors.timeout, 1);
    assert.equal(hang.summary.passed, 12);
    const gate = await assess(await run(), hang);
    assert.equal(gate.eligible, false);
    assert.ok(reasonCodes(gate).includes('unevaluated-cases'));
    assert.ok(reasonCodes(gate).includes('mandatory-case-failed'));
    assert.ok(!reasonCodes(gate).includes('security-violation'), 'a timeout is a failure, not an allow');
    // The evaluator receives a signal that aborts on its own case timeout.
    let observedAbort = false;
    await runBenchmark(s, mockEvaluator({ variant: { override: { 'route-code': ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', () => { observedAbort = true; resolve(null); })) } } }), runOptions('baseline', { caseTimeoutMs: 20 }));
    assert.equal(observedAbort, true);
    // Run deadline: the whole run rejects, so no partial report exists.
    await assert.rejects(runBenchmark(s, mockEvaluator({ variant: { override: { 'route-vision': () => new Promise(() => {}) } } }), runOptions('baseline', { timeoutMs: 30, caseTimeoutMs: 1_000 })), /timeout/);
    // Cancellation before start calls nothing.
    const calls = [];
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(runBenchmark(s, mockEvaluator({ variant: { calls } }), runOptions('baseline', { signal: aborted.signal })), /cancelled/);
    assert.equal(calls.length, 0);
    // Cancellation mid-run stops at once, even if the evaluator ignores its signal.
    const controller = new AbortController();
    const midCalls = [];
    await assert.rejects(runBenchmark(s, mockEvaluator({ variant: { calls: midCalls, override: { 'reason-sum': () => { controller.abort(); return new Promise(() => {}); } } } }), runOptions('baseline', { signal: controller.signal })), /cancelled/);
    assert.equal(midCalls.length, 4);
    for (const bad of [{ timeoutMs: 0 }, { caseTimeoutMs: 300_001 }, { timeoutMs: 1.5 }])
        await assert.rejects(runBenchmark(s, mockEvaluator(), runOptions('baseline', bad)), /Invalid/);
});

test('B7 permission regressions are detected and can never be waived by policy', async () => {
    const baseline = await run();
    const candidate = await run({ allowAdmin: true }, 'candidate');
    const denied = candidate.cases.find((c) => c.id === 'perm-deny');
    assert.equal(denied.category, 'security-violation');
    assert.equal(denied.mandatory, true);
    assert.equal(denied.security, true);
    assert.equal(candidate.summary.domains.permission.violations, 1);
    assert.equal(candidate.summary.securityViolations, 1);
    const comparison = await compareBenchmarkReports(baseline, candidate);
    assert.deepEqual(comparison.securityRegressions, ['perm-deny']);
    // The most permissive policy still cannot make a security regression eligible.
    const permissive = { format: 'shivax-benchmark-policy', version: 1, id: 'permissive-v1', minimumPassRate: { overall: 0 }, maxRegression: { overall: 1, permission: 1 } };
    const assessment = await assess(baseline, candidate, { policy: permissive });
    assert.equal(assessment.eligible, false);
    assert.deepEqual(reasonCodes(assessment).sort(), ['mandatory-case-failed', 'security-regression', 'security-violation']);
    assert.deepEqual(assessment.reasons.find((r) => r.code === 'security-violation').caseIds, ['perm-deny']);
    // Unsafe code applied and memory scope leaks are security violations too.
    const unsafe = await run({ applyUnsafe: true, leakScopes: true }, 'candidate');
    assert.deepEqual(unsafe.cases.filter((c) => c.category === 'security-violation').map((c) => c.id), ['code-unsafe', 'memory-hit']);
    assert.equal(unsafe.summary.domains.code.unsafeApplied, 1);
    assert.equal(unsafe.summary.domains.memory.scopeViolations, 1);
    assert.equal((await assess(baseline, unsafe, { policy: permissive })).eligible, false);
    // Over-denial is a correctness failure, not a security violation.
    const strict = await run({ override: { 'perm-allow': { completed: true, valid: true, actual: { decision: 'deny' }, usage: USAGE } } }, 'candidate');
    assert.equal(strict.summary.domains.permission.overDenials, 1);
    assert.equal(strict.cases.find((c) => c.id === 'perm-allow').category, 'mismatch');
    assert.equal(strict.summary.securityViolations, 0);
});

test('B8 corrupt and forged benchmark reports fail validation', async () => {
    const s = await suite(), report = await run();
    assert.equal((await validateBenchmarkReport(report, s)).digest, report.digest);
    const tamper = async (edit, resignIt = true) => {
        const copy = clone(report);
        edit(copy);
        return resignIt ? resign(copy) : copy;
    };
    // Forged summary totals and rates, even when the digests are recomputed.
    for (const edit of [
        (r) => { r.summary.passRate = 1.5; },
        (r) => { r.summary.passed = 12; },
        (r) => { r.summary.total = 14; },
        (r) => { r.summary.domains.permission.violations = 0; r.summary.domains.permission.denyCases = 0; },
        (r) => { r.summary.domains.visual.precision = 0.99; },
        (r) => { r.summary.usage.costUSD = 0; },
        (r) => { r.summary.latency.overall.p95 = 0.0001; },
        (r) => { r.summary.extra = 1; },
    ])
        await assert.rejects(validateBenchmarkReport(await tamper(edit)), /summary|Invalid/);
    // Case-level forgery: a failed case flipped to passed with a recomputed summary.
    const failing = await run({ allowAdmin: true }, 'candidate');
    const forged = clone(failing);
    const target = forged.cases.find((c) => c.id === 'perm-deny');
    Object.assign(target, { passed: true, category: null });
    await assert.rejects(validateBenchmarkReport(await resign(forged)), /Inconsistent benchmark case outcome/);
    // Invalid counts and shapes.
    for (const edit of [
        (r) => { r.cases[7].score.truePositives = 5; },
        (r) => { r.cases[11].score.reciprocalRank = 0.7; },
        (r) => { r.cases[0].latencyMs = -1; },
        (r) => { r.cases[9].security = false; },
        (r) => { r.cases[9].mandatory = false; },
        (r) => { r.cases[1] = r.cases[0]; },
        (r) => { r.cases = []; },
        (r) => { r.cases[0].score.kind = 'exact'; },
    ])
        await assert.rejects(validateBenchmarkReport(await tamper(edit)), Error);
    // Untrusted evaluator results presented as ground truth.
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.evaluator.kind = 'model-judge'; })), /trust/);
    // Digest tampering without re-signing.
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.cases[0].latencyMs += 1; }, false)), /summary|digest/);
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.ranAt += 1; }, false)), /report digest mismatch/);
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.cases[0].estimatedConfidence = null; r.configuration.version = '2'; }, false)), /logical digest mismatch/);
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.digest = 'sha256:' + '0'.repeat(64); }, false)), /digest/);
    await assert.rejects(validateBenchmarkReport(await tamper((r) => { r.trust = 'trusted'; }, false)), /Invalid/);
    await assert.rejects(validateBenchmarkReport({ ...report, version: 2 }), /Invalid/);
    // Cross-suite: a report for one suite is not valid against another suite's labels.
    const relabelled = await createBenchmarkSuite(suiteInput({ cases: benchmarkCases().map((c) => (c.id === 'perm-allow' ? { ...c, label: { decision: 'deny' } } : c)) }));
    await assert.rejects(validateBenchmarkReport(report, relabelled), /suite/);
});

test('B9 nondeterministic results are detected and reported per case', async () => {
    let flip = 0;
    const flaky = { override: { 'reason-sum': () => ({ completed: true, valid: true, actual: { sum: flip++ % 2 ? 5 : 6, steps: ['add'] }, usage: USAGE }) } };
    const evaluator = mockEvaluator({ variant: flaky }), s = await suite();
    const a = await runBenchmark(s, evaluator, runOptions()), b = await runBenchmark(s, evaluator, runOptions());
    const check = await checkBenchmarkReproducibility([a, b, a]);
    assert.equal(check.reproducible, false);
    assert.deepEqual(check.differingCases, ['reason-sum']);
    assert.notEqual(a.logicalDigest, b.logicalDigest);
    await assert.rejects(checkBenchmarkReproducibility([a]), /two or more/);
    await assert.rejects(checkBenchmarkReproducibility([a, await run({}, 'candidate')]), /Inconsistent benchmark versions/);
});

test('B10 domain metrics: routing, reasoning, code, visual precision/recall with evidence origins, permission and memory top-K', async () => {
    const r = await run({ misroute: true, inferNoise: true, override: {
        'route-unknown': { completed: true, valid: true, actual: { botId: 'narad' }, usage: USAGE },
        'route-vision': { completed: true, valid: true, actual: { botId: null }, usage: USAGE },
        'code-safe': { completed: true, valid: true, actual: { outcome: 'applied', output: 'const n = 2;', checks: { passed: 2, total: 3 } }, usage: USAGE },
        'memory-hit': { completed: true, valid: true, actual: { results: [{ id: 'm-notes', ...OWNER }, { id: 'm-invoice', ...OWNER }] }, usage: USAGE },
    } }, 'candidate');
    const d = r.summary.domains;
    assert.deepEqual({ correct: d.routing.correct, misrouted: d.routing.misrouted, unrouted: d.routing.unrouted, fallbackExpected: d.routing.fallbackExpected, fallbackCorrect: d.routing.fallbackCorrect },
        { correct: 0, misrouted: 2, unrouted: 1, fallbackExpected: 1, fallbackCorrect: 0 });
    assert.equal(d.routing.passRate, 0);
    assert.deepEqual([d.reasoning.criteriaMet, d.reasoning.criteriaTotal, d.reasoning.passed], [2, 2, 2]);
    assert.deepEqual([d.code.checksPassed, d.code.checksTotal, d.code.unsafeRejected, d.code.passed], [2, 3, 1, 1]);
    assert.equal(r.cases.find((c) => c.id === 'code-safe').category, 'mismatch');
    // Visual: 1 TP (computed), 2 FP (inferred noise on both inputs), 0 FN.
    assert.deepEqual([d.visual.truePositives, d.visual.falsePositives, d.visual.falseNegatives], [1, 2, 0]);
    assert.equal(d.visual.precision, 1 / 3);
    assert.equal(d.visual.recall, 1);
    assert.deepEqual(d.visual.truePositiveEvidence, { computed: 1, design: 0, estimated: 0, inferred: 0 });
    assert.deepEqual(d.visual.falsePositiveEvidence, { computed: 0, design: 0, estimated: 0, inferred: 2 });
    // Memory: relevant hit at rank 2 within k=3.
    assert.deepEqual([d.memory.hitsWithinK, d.memory.relevant, d.memory.recallAtK, d.memory.meanReciprocalRank, d.memory.precisionAtK], [1, 1, 1, 0.5, 0.5]);
    assert.equal(r.cases.find((c) => c.id === 'memory-hit').passed, true);
    // Relevant results outside top K do not count.
    const deep = await run({ override: { 'memory-hit': { completed: true, valid: true, actual: { results: [{ id: 'a', ...OWNER }, { id: 'b', ...OWNER }, { id: 'c', ...OWNER }, { id: 'm-invoice', ...OWNER }] }, usage: USAGE } } });
    assert.equal(deep.summary.domains.memory.hitsWithinK, 0);
    assert.equal(deep.cases.find((c) => c.id === 'memory-hit').category, 'mismatch');
    // Scoring kind is reported: exact JSON match is distinct from domain scoring.
    assert.deepEqual(r.summary.scoring, { exact: 1, domain: 12 });
    await validateBenchmarkReport(r, await suite());
    await validateBenchmarkReport(deep, await suite());
});

test('B11 cross-tenant suites and mismatched owners are rejected', async () => {
    const s = await suite();
    await assert.rejects(runBenchmark(s, mockEvaluator(), runOptions('baseline', { owner: OTHER })), /Cross-tenant/);
    const foreign = await runBenchmark(await createBenchmarkSuite(suiteInput({ owner: OTHER })), mockEvaluator(), runOptions('candidate', { owner: OTHER }));
    await assert.rejects(compareBenchmarkReports(await run(), foreign), /Inconsistent/);
    await assert.rejects(assess(await run(), foreign), /suite/);
});

test('B12 untrusted and model-judge evaluators cannot make a candidate eligible; confidence is never scored', async () => {
    const baseline = await run();
    const unknown = await run({}, 'candidate', {}, { id: 'other-evaluator' });
    await assert.rejects(assess(baseline, unknown), /Inconsistent benchmark versions/);
    const unlisted = await assess(baseline, await run({}, 'candidate'), { trustedEvaluators: [{ id: 'fixture-evaluator', version: '2' }] });
    assert.deepEqual(reasonCodes(unlisted), ['untrusted-evaluator']);
    const judgeBase = await run({}, 'baseline', {}, { kind: 'model-judge' });
    const judgeCand = await run({}, 'candidate', {}, { kind: 'model-judge' });
    assert.equal(judgeCand.evaluator.groundTruth, false);
    assert.deepEqual(reasonCodes(await assess(judgeBase, judgeCand)), ['not-ground-truth']);
    // Confidence: a confident wrong answer still fails; it is summarised separately.
    const confident = await run({ override: { 'reason-sum': { completed: true, valid: true, actual: { sum: 99 }, estimatedConfidence: 0.99, usage: USAGE } } }, 'candidate');
    assert.equal(confident.cases.find((c) => c.id === 'reason-sum').passed, false);
    assert.deepEqual(confident.summary.estimatedConfidence, { reportedCases: 1, mean: 0.99 });
    // Fluent text is not correctness: structured criteria decide.
    const prose = await run({ override: { 'reason-sum': { completed: true, valid: true, actual: 'The sum of 2 and 3 is clearly 5.', usage: USAGE } } });
    assert.equal(prose.cases.find((c) => c.id === 'reason-sum').category, 'mismatch');
});

test('B13 invalid observations, evaluator errors and invalid outputs fail closed without leaking details', async () => {
    const r = await run({ override: {
        'route-code': () => { throw new Error('private-secret'); },
        'route-vision': { completed: true, valid: true, actual: { botId: 'sanjay' }, usage: { ...USAGE, inputTokens: -1 } },
        'reason-sum': { completed: true, valid: true },
        'code-safe': { completed: true, valid: false, actual: { outcome: 'applied', output: 'const n = 2;', checks: { passed: 1, total: 1 } } },
        'visual-font': { completed: false, valid: true, actual: { issues: [{ id: 'font-size', evidence: 'computed' }] } },
        'memory-hit': { completed: true, valid: true, actual: { results: 'm-invoice' } },
        'perm-allow': { completed: true, valid: true, actual: { decision: 'allow' }, estimatedConfidence: 2 },
    } }, 'candidate');
    const category = (id) => r.cases.find((c) => c.id === id).category;
    assert.equal(category('route-code'), 'evaluator-error');
    assert.equal(category('route-vision'), 'invalid-observation');
    assert.equal(category('reason-sum'), 'invalid-observation');
    assert.equal(category('code-safe'), 'invalid-output');
    assert.equal(category('visual-font'), 'incomplete');
    assert.equal(category('memory-hit'), 'invalid-observation');
    assert.equal(category('perm-allow'), 'invalid-observation');
    assert.equal(JSON.stringify(r).includes('private-secret'), false);
    assert.equal(r.summary.failed, 7);
    assert.equal(Object.values(r.summary.errors).reduce((a, b) => a + b, 0), 7);
    assert.deepEqual(BENCHMARK_ERROR_CATEGORIES.filter((k) => r.summary.errors[k]).sort(), ['evaluator-error', 'incomplete', 'invalid-observation', 'invalid-output']);
    await validateBenchmarkReport(r, await suite());
});

test('B14 verified usage and cost are totalled exactly; unverified usage is excluded and blocks cost limits', async () => {
    const r = await run();
    assert.deepEqual(r.summary.usage, { reportedCases: 13, verifiedCases: 13, inputTokens: 130, outputTokens: 65, costUSD: 0.013, complete: true });
    const partial = await run({ override: { 'route-code': { completed: true, valid: true, actual: { botId: 'vishwakarma' }, usage: { ...USAGE, verified: false } }, 'route-vision': { completed: true, valid: true, actual: { botId: 'sanjay' } } } }, 'candidate');
    assert.deepEqual(partial.summary.usage, { reportedCases: 12, verifiedCases: 11, inputTokens: 110, outputTokens: 55, costUSD: 0.011, complete: false });
    const policy = (extra) => ({ format: 'shivax-benchmark-policy', version: 1, id: 'budget-v1', minimumPassRate: { overall: 1 }, ...extra });
    assert.deepEqual(reasonCodes(await assess(r, partial, { policy: policy({ maxCostUSD: 1 }) })), ['usage-unverified']);
    const complete = await run({}, 'candidate');
    assert.deepEqual(reasonCodes(await assess(r, complete, { policy: policy({ maxCostUSD: 0.012 }) })), ['cost-limit']);
    assert.deepEqual(reasonCodes(await assess(r, complete, { policy: policy({ maxTotalTokens: 194 }) })), ['token-limit']);
    assert.equal((await assess(r, complete, { policy: policy({ maxCostUSD: 0.013, maxTotalTokens: 195, requireVerifiedUsage: true }) })).eligible, true);
    assert.deepEqual(reasonCodes(await assess(r, complete, { policy: policy({ maxLatencyP95Ms: 0 }) })).filter((c) => c === 'latency-limit').length, complete.summary.latency.overall.p95 > 0 ? 1 : 0);
});

test('B15 thresholds are configurable through versioned policies; the default stays strict', async () => {
    assert.deepEqual(validateBenchmarkPolicy(STRICT_BENCHMARK_POLICY), STRICT_BENCHMARK_POLICY);
    for (const bad of [{ ...STRICT_BENCHMARK_POLICY, version: 2 }, { ...STRICT_BENCHMARK_POLICY, minimumPassRate: { overall: 1.1 } }, { ...STRICT_BENCHMARK_POLICY, maxRegression: { vision: 0 } }, { ...STRICT_BENCHMARK_POLICY, maxCostUSD: -1 }, { ...STRICT_BENCHMARK_POLICY, unknown: true }])
        assert.throws(() => validateBenchmarkPolicy(bad), /Invalid/);
    const baseline = await run({ breakReasoning: true });
    const candidate = await run({ breakReasoning: true }, 'candidate');
    assert.deepEqual(reasonCodes(await assess(baseline, candidate)), ['below-minimum']);
    const relaxed = { format: 'shivax-benchmark-policy', version: 1, id: 'relaxed-v1', minimumPassRate: { overall: 0.9, permission: 1, reasoning: 0.5 } };
    assert.equal((await assess(baseline, candidate, { policy: relaxed })).eligible, true);
    const tooStrict = { ...relaxed, minimumPassRate: { reasoning: 0.6 } };
    assert.deepEqual((await assess(baseline, candidate, { policy: tooStrict })).reasons, [{ code: 'below-minimum', scope: 'reasoning' }]);
    // A threshold on a domain the suite never evaluates is reported, not silently passed.
    const routingOnly = await createBenchmarkSuite(suiteInput({ cases: benchmarkCases().filter((c) => c.domain === 'routing') }));
    const b = await runBenchmark(routingOnly, mockEvaluator(), runOptions()), c = await runBenchmark(routingOnly, mockEvaluator(), runOptions('candidate'));
    const missing = await assessBenchmarkCandidate({ suite: routingOnly, baseline: b, candidate: c, trustedEvaluators: TRUSTED, policy: { ...relaxed, minimumPassRate: { memory: 1 } } });
    assert.deepEqual(missing.reasons, [{ code: 'domain-not-evaluated', scope: 'memory' }]);
    assert.ok(BENCHMARK_GATE_REASONS.includes('domain-not-evaluated'));
});

test('B16 fixed-seed sampling is deterministic, always keeps mandatory cases, and is validated against the suite', async () => {
    const sampled = (seed, size = 6) => createBenchmarkSuite(suiteInput({ seed, sampling: { size } }));
    const a = await selectBenchmarkCases(await sampled('seed-1')), b = await selectBenchmarkCases(await sampled('seed-1'));
    assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
    assert.equal(a.length, 6);
    for (const id of ['code-unsafe', 'perm-deny']) assert.ok(a.some((c) => c.id === id), id);
    const others = await Promise.all(['seed-2', 'seed-3', 'seed-4'].map(async (seed) => (await selectBenchmarkCases(await sampled(seed))).map((c) => c.id).join()));
    assert.ok(others.some((ids) => ids !== a.map((c) => c.id).join()), 'different seeds should select different samples');
    const s = await sampled('seed-1');
    const report = await runBenchmark(s, mockEvaluator(), runOptions());
    assert.equal(report.sampled, true);
    assert.deepEqual(report.cases.map((c) => c.id), a.map((c) => c.id));
    await validateBenchmarkReport(report, s);
    await assert.rejects(validateBenchmarkReport(report, await suite()), /suite/);
    await assert.rejects(createBenchmarkSuite(suiteInput({ sampling: { size: 1 } })), /mandatory/);
    const { seed: _seed, ...noSeed } = suiteInput({ sampling: { size: 6 } });
    await assert.rejects(createBenchmarkSuite(noSeed), /seed required/);
});

test('B17 existing v1 evaluation APIs are unchanged and v1 datasets extend into benchmarks with real ShivAX components', async () => {
    // Unchanged v1 behaviour.
    const v1 = EVALUATION_DOMAINS.map((domain) => ({ id: domain, domain, input: domain, expected: domain }));
    const record = await evaluateDataset(v1, async (input) => ({ completed: true, valid: true, actual: input, modelCalls: 0, modelTokens: 0 }), new AbortController().signal);
    assert.equal(validateEvaluationRecord(record).accuracy, 1);
    assert.equal(validateEvaluationDataset(v1).length, 6);
    assert.equal(typeof EvaluatedModelUpdates, 'function');
    for (const name of ['runBenchmark', 'createBenchmarkSuite', 'validateBenchmarkReport', 'compareBenchmarkReports', 'assessBenchmarkCandidate', 'checkBenchmarkLeakage', 'checkBenchmarkReproducibility', 'benchmarkSuiteFromEvaluationDataset', 'selectBenchmarkCases', 'validateBenchmarkPolicy', 'validateBenchmarkSuite'])
        assert.equal(typeof learningEntry[name], 'function', name);
    assert.equal(learningEntry.STRICT_BENCHMARK_POLICY.id, 'shivax-strict-v1');
    // The 0.2.0 learning fixture becomes an exact-scored benchmark suite (permission cases excluded: they need a Jay host).
    const usable = learningCases.filter((c) => c.domain !== 'permission');
    const suiteV1 = await benchmarkSuiteFromEvaluationDataset(usable, { id: 'v1-fixture', suiteVersion: '0.2.0', owner: OWNER, dataset: { id: 'learning-cases', version: 1 }, origin: 'host' });
    assert.equal(suiteV1.cases.every((c) => c.label.method === 'exact'), true);
    const registry = createSpecialistSystem().registry, executor = new BotExecutor(), store = new MemoryEngine();
    const signal = new AbortController().signal;
    const ns = { principalId: 'tester', issuer: 'host', sessionId: 's', scopeKind: 'personal', scopeId: 'w' };
    await store.save(ns, { id: 'known', category: 'working', value: 'remembered' }, signal);
    const execute = (bot, capability, data) => executor.execute(bot, createTaskContext({ id: 'eval', input: { capability, data } }, {
        sessionId: 's', signal, security: { caller: { id: 'tester', issuer: 'host' }, scope: { kind: 'personal', id: 'w' }, toolPermissions: [] } }));
    const real = {
        id: 'shivax-components', version: '0.3.0-s02', kind: 'deterministic',
        async evaluate({ domain, input }) {
            let actual;
            if (domain === 'routing') actual = registry.findByCapability(input)[0]?.id ?? null;
            if (domain === 'reasoning') actual = (await execute(createSpecialistSystem().registry.get('brihaspati'), 'reasoning.plan', input)).status;
            if (domain === 'code') { const result = await execute(new VishwakarmaBot(), 'code.patch', input); actual = result.status === 'completed' ? result.data.patches[0].after : 'failed'; }
            if (domain === 'visual') { const p = paired(); if (input) p.node('title').typography.fontSize = measurement(30); actual = analyzeUI(p.baseline, p.target).issues.length > 0; }
            if (domain === 'memory') actual = (await store.retrieve(ns, input, signal))?.value ?? null;
            return { completed: true, valid: true, actual, usage: { inputTokens: 0, outputTokens: 0, costUSD: 0, verified: true } };
        },
    };
    const first = await runBenchmark(suiteV1, real, runOptions());
    const second = await runBenchmark(suiteV1, real, runOptions());
    assert.equal(first.summary.passRate, 1, JSON.stringify(first.cases.filter((c) => !c.passed)));
    assert.equal(first.logicalDigest, second.logicalDigest);
    assert.equal(first.summary.scoring.exact, usable.length);
    // Bot ids preserved.
    assert.deepEqual(registry.list().map((b) => b.id).sort(), ['brihaspati', 'chitragupt', 'ekalavy', 'narad', 'sanjay', 'vishwakarma', 'yudhishthir']);
});

test('B18 inputs are not mutated, reports are frozen data and the runner never trains or activates', async () => {
    const input = suiteInput(), before = clone(input);
    const s = await createBenchmarkSuite(input);
    assert.deepEqual(input, before);
    const sBefore = clone(s);
    const report = await runBenchmark(s, mockEvaluator(), runOptions());
    assert.deepEqual(clone(s), sBefore);
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.cases[0]), true);
    assert.equal(report.trust, 'untrusted');
    const updates = new EvaluatedModelUpdates({ model: 1, configuration: {} });
    await assessBenchmarkCandidate({ suite: s, baseline: report, candidate: await run({}, 'candidate'), trustedEvaluators: TRUSTED });
    assert.deepEqual(updates.active, { model: 1, configuration: {} });
    await assert.rejects(runBenchmark(s, { id: 'x', version: '1', kind: 'oracle', evaluate: async () => ({}) }, runOptions()), /evaluator kind/);
    await assert.rejects(runBenchmark(s, mockEvaluator(), { ...runOptions(), extra: true }), /Invalid/);
});
