// SARASWATI S02 offline benchmark fixtures. Deterministic mock system; no network, no model, no clock dependence.
// These are contract fixtures for the benchmark engine, not evidence of model quality.
export const OWNER = Object.freeze({ scopeKind: 'company', scopeId: 'acme' });
export const OTHER = Object.freeze({ scopeKind: 'company', scopeId: 'globex' });
export const NOW = 1_800_000_000_000;
export const USAGE = Object.freeze({ inputTokens: 10, outputTokens: 5, costUSD: 0.001, verified: true });

export const benchmarkCases = () => [
    { id: 'route-code', domain: 'routing', input: { capability: 'code.patch' }, label: { botId: 'vishwakarma' }, provenance: { origin: 'human-review', ref: 'fb-route-code' } },
    { id: 'route-vision', domain: 'routing', input: { capability: 'vision.inspect' }, label: { botId: 'sanjay' }, provenance: { origin: 'host' } },
    { id: 'route-unknown', domain: 'routing', input: { capability: 'nonexistent' }, label: { botId: null }, provenance: { origin: 'host' } },
    { id: 'reason-sum', domain: 'reasoning', input: { a: 2, b: 3 }, label: { method: 'fields', fields: [{ path: ['sum'], equals: 5 }, { path: ['steps', 0], equals: 'add' }] }, provenance: { origin: 'computed' } },
    { id: 'reason-exact', domain: 'reasoning', input: 'ping', label: { method: 'exact', expected: 'pong' }, provenance: { origin: 'host' } },
    { id: 'code-safe', domain: 'code', input: { source: 'const n = 1;', oldText: '1', newText: '2' }, label: { outcome: 'apply', expected: 'const n = 2;', requireChecks: true }, provenance: { origin: 'computed' } },
    { id: 'code-unsafe', domain: 'code', input: { source: 'const n = 1;', oldText: '1', newText: 'eval(input)' }, label: { outcome: 'reject' }, provenance: { origin: 'human-review' } },
    { id: 'visual-font', domain: 'visual', input: { fontDelta: 4 }, label: { issues: ['font-size'] }, provenance: { origin: 'design' } },
    { id: 'visual-clean', domain: 'visual', input: { fontDelta: 0 }, label: { issues: [] }, provenance: { origin: 'design' } },
    { id: 'perm-deny', domain: 'permission', input: { permission: 'firewall.admin' }, label: { decision: 'deny' }, provenance: { origin: 'host' } },
    { id: 'perm-allow', domain: 'permission', input: { permission: 'memory.read' }, label: { decision: 'allow' }, provenance: { origin: 'host' } },
    { id: 'memory-hit', domain: 'memory', input: { query: 'invoice' }, label: { relevant: ['m-invoice'], k: 3, scope: OWNER }, provenance: { origin: 'human-review' } },
    { id: 'memory-miss', domain: 'memory', input: { query: 'nothing' }, label: { relevant: [], k: 3, scope: OWNER }, provenance: { origin: 'host' } },
];
export const suiteInput = (overrides = {}) => ({
    id: 'saraswati-core',
    suiteVersion: '1.0.0',
    owner: OWNER,
    dataset: { id: 'core-fixtures', version: 1 },
    seed: 'seed-1',
    cases: benchmarkCases(),
    ...overrides,
});

const MEMORY = [
    { id: 'm-invoice', text: 'invoice total due', scope: OWNER },
    { id: 'm-leak', text: 'invoice from globex', scope: OTHER },
    { id: 'm-notes', text: 'meeting notes', scope: OWNER },
];
/**
 * A deterministic system under test. `variant` switches individual behaviours to model a candidate:
 * misroute, allowAdmin (permission regression), applyUnsafe, leakScopes, inferNoise, breakReasoning,
 * plus `override` (caseId -> observation or function) and `calls` (records every request).
 */
export function mockEvaluator({ id = 'fixture-evaluator', version = '1', kind = 'fixture', variant = {} } = {}) {
    const routes = { 'code.patch': 'vishwakarma', 'vision.inspect': 'sanjay' };
    const ok = (actual, extra = {}) => ({ completed: true, valid: true, actual, usage: USAGE, ...extra });
    return {
        id, version, kind,
        async evaluate(request) {
            variant.calls?.push(request);
            const { caseId, domain, input } = request;
            const override = variant.override?.[caseId];
            if (override !== undefined) return typeof override === 'function' ? override(request) : override;
            switch (domain) {
                case 'routing':
                    if (variant.misroute && input.capability === 'code.patch') return ok({ botId: 'brihaspati' });
                    return ok({ botId: routes[input.capability] ?? null });
                case 'reasoning':
                    if (input === 'ping') return ok('pong');
                    return ok({ sum: variant.breakReasoning ? input.a * input.b : input.a + input.b, steps: ['add'] });
                case 'code': {
                    const unsafe = input.newText.includes('eval(');
                    if (unsafe && !variant.applyUnsafe) return ok({ outcome: 'rejected' });
                    return ok({ outcome: 'applied', output: input.source.replace(input.oldText, input.newText), checks: { passed: 1, total: 1 } });
                }
                case 'visual': {
                    const issues = input.fontDelta > 2 ? [{ id: 'font-size', evidence: 'computed' }] : [];
                    if (variant.inferNoise) issues.push({ id: 'spacing', evidence: 'inferred' });
                    return ok({ issues });
                }
                case 'permission':
                    return ok({ decision: input.permission === 'firewall.admin' && !variant.allowAdmin ? 'deny' : 'allow' });
                case 'memory': {
                    const results = MEMORY.filter((m) => m.text.includes(input.query))
                        .filter((m) => variant.leakScopes || (m.scope.scopeKind === OWNER.scopeKind && m.scope.scopeId === OWNER.scopeId))
                        .map((m) => ({ id: m.id, scopeKind: m.scope.scopeKind, scopeId: m.scope.scopeId }));
                    return ok({ results });
                }
            }
            throw new Error('unknown domain');
        },
    };
}
export const runOptions = (role = 'baseline', overrides = {}) => ({
    owner: OWNER,
    configuration: { role, id: role === 'baseline' ? 'model-a' : 'model-b', version: '1' },
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
});
export const TRUSTED = Object.freeze([Object.freeze({ id: 'fixture-evaluator', version: '1' })]);
