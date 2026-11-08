// Offline benchmark: a baseline and a candidate configuration of a toy system, scored on a versioned suite.
// Runs with no network, model or API key. The evaluator here is demo code; in production it is trusted host code
// that drives your real bots and models and returns only what it observed.
import {
    createBenchmarkSuite,
    runBenchmark,
    assessBenchmarkCandidate,
    checkBenchmarkReproducibility,
} from 'shivax/learning';

const owner = { scopeKind: 'company', scopeId: 'demo' };

// Labels are ground truth with a stated origin. Permission `deny` and code `reject` cases are mandatory.
const suite = await createBenchmarkSuite({
    id: 'demo-benchmark',
    suiteVersion: '1.0.0',
    owner,
    dataset: { id: 'demo-cases', version: 1 },
    seed: 'demo-seed',
    cases: [
        { id: 'route-code', domain: 'routing', input: { capability: 'code.patch' }, label: { botId: 'vishwakarma' }, provenance: { origin: 'host' } },
        { id: 'route-none', domain: 'routing', input: { capability: 'unknown' }, label: { botId: null }, provenance: { origin: 'host' } },
        { id: 'plan', domain: 'reasoning', input: { a: 2, b: 3 }, label: { method: 'fields', fields: [{ path: ['sum'], equals: 5 }] }, provenance: { origin: 'computed' } },
        { id: 'patch', domain: 'code', input: { from: '1', to: '2' }, label: { outcome: 'apply', expected: 'const n = 2;' }, provenance: { origin: 'computed' } },
        { id: 'patch-unsafe', domain: 'code', input: { from: '1', to: 'eval(x)' }, label: { outcome: 'reject' }, provenance: { origin: 'human-review' } },
        { id: 'ui-font', domain: 'visual', input: { fontDelta: 4 }, label: { issues: ['font-size'] }, provenance: { origin: 'design' } },
        { id: 'deny-admin', domain: 'permission', input: { permission: 'firewall.admin' }, label: { decision: 'deny' }, provenance: { origin: 'host' } },
        { id: 'allow-read', domain: 'permission', input: { permission: 'memory.read' }, label: { decision: 'allow' }, provenance: { origin: 'host' } },
        { id: 'recall', domain: 'memory', input: { query: 'invoice' }, label: { relevant: ['m1'], k: 3, scope: owner }, provenance: { origin: 'human-review' } },
    ],
});

// Toy system under test. `improved` fixes the reasoning bug; everything else is identical.
function evaluator(improved) {
    const usage = { inputTokens: 0, outputTokens: 0, costUSD: 0, verified: true };
    const ok = (actual) => ({ completed: true, valid: true, actual, usage });
    return {
        id: 'demo-evaluator',
        version: '1',
        kind: 'deterministic',
        evaluate({ domain, input }) {
            if (domain === 'routing') return ok({ botId: input.capability === 'code.patch' ? 'vishwakarma' : null });
            if (domain === 'reasoning') return ok({ sum: improved ? input.a + input.b : input.a * input.b });
            if (domain === 'code') return ok(input.to.includes('eval(') ? { outcome: 'rejected' } : { outcome: 'applied', output: `const n = ${input.to};` });
            if (domain === 'visual') return ok({ issues: input.fontDelta > 2 ? [{ id: 'font-size', evidence: 'computed' }] : [] });
            if (domain === 'permission') return ok({ decision: input.permission === 'firewall.admin' ? 'deny' : 'allow' });
            return ok({ results: input.query === 'invoice' ? [{ id: 'm1', ...owner }] : [] });
        },
    };
}

const options = (role, id) => ({ owner, configuration: { role, id, version: '1' }, signal: AbortSignal.timeout(60_000) });
const baseline = await runBenchmark(suite, evaluator(false), options('baseline', 'model-a'));
const candidate = await runBenchmark(suite, evaluator(true), options('candidate', 'model-b'));
const repeat = await runBenchmark(suite, evaluator(true), options('candidate', 'model-b'));

const assessment = await assessBenchmarkCandidate({
    suite,
    baseline,
    candidate,
    trustedEvaluators: [{ id: 'demo-evaluator', version: '1' }],
});
const reproducible = await checkBenchmarkReproducibility([candidate, repeat]);

const { latency: _timing, ...measured } = candidate.summary;
console.log(JSON.stringify({
    benchmark: candidate.benchmark,
    dataset: candidate.dataset,
    baselinePassRate: baseline.summary.passRate,
    candidate: measured,
    fixed: assessment.comparison.fixed,
    regressed: assessment.comparison.regressed,
    eligible: assessment.eligible,
    reasons: assessment.reasons,
    activation: assessment.activation,
    reproducible: reproducible.reproducible,
    logicalDigest: candidate.logicalDigest,
}, null, 2));
if (!assessment.eligible || !reproducible.reproducible) process.exitCode = 1;
