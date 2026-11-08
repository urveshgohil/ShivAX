// RUDRA shadow routing with Ekalavya recommendations (SARASWATI S05). Offline; fake bots, no models.
// Two bots offer the same capability. RUDRA keeps its deterministic route; the advisor only reports what it
// would choose, from trusted labelled evaluation evidence.
import { BotRegistry, RudraOrchestrator, createTaskContext } from 'shivax/rudra';
import {
    createBenchmarkSuite, runBenchmark, createRoutingEvaluator, createRoutingAdvisor, runRoutingShadow, evaluateRoutingQuality,
} from 'shivax/learning';

const owner = { scopeKind: 'company', scopeId: 'example-tenant' };
// Fake specialists: both sum numbers; `summer-a` is chosen by default because RUDRA routes by bot ID.
const bot = (id) => ({
    id,
    capabilities: [{ id: 'math.sum', description: 'Sum finite numbers' }],
    validateInput: (input) => Array.isArray(input.data) && input.data.every(Number.isFinite),
    validateOutput: (data) => typeof data?.total === 'number',
    execute: (input, context) => ({ taskId: context.task.taskId, botId: id, status: 'completed', data: { total: input.data.reduce((a, b) => a + b, 0) } }),
});
const bots = new BotRegistry().register(bot('summer-a')).register(bot('summer-b'));

// Trusted labelled evidence: reviewers labelled `summer-b` correct for these tasks (an S02 suite and report).
const suite = await createBenchmarkSuite({
    id: 'routing-labels', suiteVersion: '1.0.0', owner, dataset: { id: 'math-routing', version: 1 },
    cases: Array.from({ length: 8 }, (_, i) => ({ id: `case-${i}`, domain: 'routing', input: { capability: 'math.sum', case: i }, label: { botId: 'summer-b' }, provenance: { origin: 'human-review' } })),
});
const evaluator = createRoutingEvaluator({ bots, resolvePolicy: () => null });
const report = await runBenchmark(suite, evaluator, { owner, configuration: { role: 'baseline', id: 'deterministic', version: '0' }, signal: AbortSignal.timeout(30_000) });
const advisor = await createRoutingAdvisor({ owner, bots, trustedEvaluators: [{ id: evaluator.id, version: evaluator.version }] }, { evaluations: [{ suite, report }] });

const context = createTaskContext({ id: 'task-1', input: { capability: 'math.sum', data: [2, 3] } }, {
    sessionId: 'session-1', signal: AbortSignal.timeout(30_000),
    security: { caller: { id: 'demo-user', issuer: 'example-host' }, scope: { kind: 'company', id: 'example-tenant' }, toolPermissions: [] },
});
const { result, shadow } = await runRoutingShadow(new RudraOrchestrator(bots), advisor, context);
const recommendation = await advisor.recommend(context);
// What a beta-first policy would do on held-out labels. Promotion still needs the S04 approval lifecycle.
const quality = evaluateRoutingQuality({
    bots, baseline: null,
    candidate: { format: 'shivax-routing-policy', version: 1, id: 'draft', policyVersion: 1, owner, rules: [{ capability: 'math.sum', order: ['summer-b'] }] },
    labelled: Array.from({ length: 20 }, () => ({ capability: 'math.sum', botId: 'summer-b' })),
});
console.log(JSON.stringify({
    ranBy: result.outputs[0].botId,
    shadow,
    recommendation: { status: recommendation.status, recommended: recommendation.recommended, confidence: Number(recommendation.confidence.value.toFixed(3)) },
    heldOutVerdict: quality.verdict,
}, null, 2));
