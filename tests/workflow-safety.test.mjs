// SHIVAX 0.4.0 HANUMAN · H04-A Abhimanyu preflight and Ashwatthama lifecycle observer. Offline, deterministic clocks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createMockIdentityProvider } from './fixtures/mock-identity.mjs';

const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const action = (id, capability = 'read', input = { source: 'task' }, dependsOn) => ({ id, capability, input, ...(dependsOn ? { dependsOn } : {}) });
const plan = (...actions) => ({ actions });
const verified = { verifiedBy: 'host-review-7', version: '1' };
const TENANT = { kind: 'company', id: 'tenant' };
const OTHER = { kind: 'company', id: 'other' };
const safeRead = { capability: 'read', sideEffect: 'protected', effect: 'read-only', maxDurationMs: 1000, cancellation: 'cooperative', cleanup: verified };
const ids = (report) => report.warnings.map((w) => w.ruleId);
const find = (report, id) => report.warnings.find((w) => w.ruleId === id);

for (const [format, api] of [['ESM', await import('shivax')], ['CJS', require('shivax')]]) {
    const check = (name, run) => test(`${format}: H04 ${name}`, run);
    const pre = (overrides = {}) =>
        api.runAbhimanyuPreflight({ plan: plan(action('a')), capability: 'workflow', options: { allowedCapabilities: ['read'] }, deadlineMs: 10_000, profiles: [safeRead], ...overrides });

    /* ------------------------------------------------------- warning schema */
    check('warning schema: stable catalog, strict validation, nonsecret evidence', () => {
        assert.deepEqual(Object.keys(api.SAFETY_WARNING_RULES).sort(), [...api.ABHIMANYU_RULE_IDS, ...api.ASHWATTHAMA_RULE_IDS].sort());
        for (const id of ['ABH_NO_EXIT_PATH', 'ABH_MISSING_CLEANUP', 'ABH_UNBOUNDED_RETRY', 'ASH_LEASE_EXPIRED', 'ASH_CANCEL_STUCK', 'ASH_OPERATION_ORPHANED'])
            assert.equal(api.SAFETY_WARNING_RULES[id].version, 1, id);
        assert.ok(Object.isFrozen(api.SAFETY_WARNING_RULES));
        const report = pre({ profiles: [{ ...safeRead, cancellation: 'ignored', cleanup: 'none' }], policy: { mode: 'warn' } });
        const w = find(report, 'ABH_NO_EXIT_PATH');
        assert.deepEqual(api.validateSafetyWarning(JSON.parse(JSON.stringify(w))), w);
        assert.ok(Object.isFrozen(w) && Object.isFrozen(w.evidence) && Object.isFrozen(w.subject));
        const bad = (patch) => assert.throws(() => api.validateSafetyWarning({ ...JSON.parse(JSON.stringify(w)), ...patch }), (e) => e instanceof api.WorkflowSafetyError && e.code === 'invalid-warning');
        bad({ ruleId: 'ABH_UNKNOWN' });
        bad({ remediation: 'run rm -rf /' });
        bad({ severity: 'low' });
        bad({ ruleVersion: 2 });
        bad({ extra: true });
        bad({ disposition: 'cancellation-requested' });
        bad({ evidence: { note: 'contains spaces and a password=hunter2' } });
        bad({ evidence: { nested: { a: 1 } } });
        bad({ evidence: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['k' + i, i])) });
        bad({ subject: { kind: 'action', ref: 'action 0', index: 0 } });
        bad({ timestamp: Infinity });
        const getter = JSON.parse(JSON.stringify(w));
        Object.defineProperty(getter, 'severity', { get() { throw new Error('accessor invoked'); }, enumerable: true });
        assert.throws(() => api.validateSafetyWarning(getter), (e) => e.code === 'invalid-warning');
    });

    /* ---------------------------------------------------------- abhimanyu */
    check('Abhimanyu: a safe workflow produces no warnings and allows', () => {
        const report = pre({ plan: plan(action('a'), action('b', 'read', { source: 'step', stepId: 'a' })), policy: { mode: 'enforce' }, now: () => 5 });
        assert.deepEqual(ids(report), []);
        assert.equal(report.decision, 'allow');
        assert.deepEqual([report.format, report.version, report.validator, report.actions, report.depth, report.evaluatedAt], ['shivax-abhimanyu-report', 1, 'abhimanyu', 2, 2, 5]);
        assert.ok(Object.isFrozen(report) && Object.isFrozen(report.warnings));
    });
    check('Abhimanyu: missing exit path is confirmed and blocks only in enforce mode', () => {
        const noExit = [{ ...safeRead, cancellation: 'ignored', cleanup: 'none' }];
        const warn = pre({ profiles: noExit, policy: { mode: 'warn' } });
        assert.equal(find(warn, 'ABH_NO_EXIT_PATH').certainty, 'confirmed');
        assert.equal(find(warn, 'ABH_NO_EXIT_PATH').disposition, 'reported');
        assert.equal(warn.decision, 'allow');
        const enforce = pre({ profiles: noExit, policy: { mode: 'enforce' } });
        assert.equal(enforce.decision, 'block');
        assert.equal(find(enforce, 'ABH_NO_EXIT_PATH').disposition, 'blocked');
        // Unknown cleanup is reported as potential: the host adapter may clean up where the validator cannot see.
        const unknownProfile = [{ ...safeRead, cancellation: 'ignored', cleanup: undefined }];
        assert.equal(find(pre({ profiles: unknownProfile, policy: { mode: 'warn' } }), 'ABH_NO_EXIT_PATH').certainty, 'potential');
        // ...but in enforce mode the omission is analyzed as the least-safe declaration (M1), so it blocks.
        const unknown = pre({ profiles: unknownProfile, policy: { mode: 'enforce' } });
        assert.equal(find(unknown, 'ABH_NO_EXIT_PATH').certainty, 'potential');
        assert.equal(find(unknown, 'ABH_NO_EXIT_PATH').evidence.assumedWorstCase, true);
        assert.equal(unknown.decision, 'block');
        // Lenient analysis is available only by saying so explicitly.
        assert.equal(pre({ profiles: unknownProfile, policy: { mode: 'enforce' }, requireDeclarations: false }).decision, 'allow');
        // High-impact hosts can make uncertain enforced rules mandatory even in lenient analysis.
        assert.equal(pre({ profiles: unknownProfile, policy: { mode: 'enforce', blockUncertain: true }, requireDeclarations: false }).decision, 'block');
        // Verified cleanup is a valid exit even when cancellation is ignored.
        assert.deepEqual(ids(pre({ profiles: [{ ...safeRead, cancellation: 'ignored' }] })), []);
    });
    check('M1 regression: omitting a declaration never passes a plan the honest least-safe declaration blocks', () => {
        const enforce = { mode: 'enforce' };
        const { cleanup, cancellation, ...bare } = safeRead;
        // Every combination of omitted and declared-unsafe exit fields gets the same decision.
        const cases = [
            [{ ...bare, cancellation: 'ignored', cleanup: 'none' }, 'block'],
            [{ ...bare, cancellation: 'ignored' }, 'block'],
            [{ ...bare, cleanup: 'none' }, 'block'],
            [bare, 'block'],
            [{ ...bare, cancellation: 'cooperative' }, 'allow'],
            [{ ...bare, cancellation: 'cooperative', cleanup: 'none' }, 'allow'],
            [{ ...bare, cleanup: verified }, 'allow'],
            [{ ...bare, cancellation: 'ignored', cleanup: verified }, 'allow'],
        ];
        for (const [profile, decision] of cases)
            assert.equal(pre({ profiles: [profile], policy: enforce }).decision, decision, JSON.stringify(profile));
        // The omission is labelled honestly: never reported as a confirmed finding.
        const omitted = find(pre({ profiles: [bare], policy: enforce }), 'ABH_NO_EXIT_PATH');
        assert.deepEqual([omitted.certainty, omitted.disposition, omitted.evidence.assumedWorstCase, omitted.evidence.cancellation, omitted.evidence.cleanup], ['insufficient-metadata', 'blocked', true, null, null]);
        // Omitted idempotency on a retried state change is treated as non-idempotent.
        const write = { capability: 'read', sideEffect: 'protected', effect: 'state-changing', cancellation: 'cooperative', cleanup: verified, retries: { max: 2 } };
        assert.equal(pre({ profiles: [{ ...write, idempotent: false }], policy: enforce }).decision, 'block');
        assert.equal(pre({ profiles: [write], policy: enforce }).decision, 'block');
        assert.equal(pre({ profiles: [{ ...write, idempotent: true }], policy: enforce }).decision, 'allow');
        // Warn mode is unchanged: findings are reported, never assumed, never blocked.
        const warn = pre({ profiles: [bare], policy: { mode: 'warn' } });
        assert.equal(warn.decision, 'allow');
        assert.ok(warn.warnings.every((w) => w.evidence.assumedWorstCase === undefined));
        assert.throws(() => pre({ requireDeclarations: 'yes' }), (e) => e.code === 'invalid-input');
    });
    check('M2 regression: missing or empty profiles cannot pass enforce mode', () => {
        const enforce = { mode: 'enforce' };
        for (const profiles of [[], [{ ...safeRead, capability: 'unrelated' }]]) {
            const report = pre({ profiles, policy: enforce });
            assert.equal(report.decision, 'block', JSON.stringify(profiles));
            assert.deepEqual(ids(report).slice(0, 2), ['ABH_MISSING_PROFILE', 'ABH_NO_EXIT_PATH']);
            assert.equal(find(report, 'ABH_MISSING_PROFILE').disposition, 'reported');
            assert.equal(find(report, 'ABH_NO_EXIT_PATH').disposition, 'blocked');
        }
        // A declared non-protected profile is enough; nothing protected is assumed for it.
        assert.equal(pre({ profiles: [{ capability: 'read', sideEffect: 'none', effect: 'read-only' }], policy: enforce }).decision, 'allow');
        // One unprofiled action blocks the whole plan, not only its own step.
        const mixed = pre({ plan: plan(action('a'), action('b', 'other')), options: { allowedCapabilities: ['read', 'other'] }, policy: enforce });
        assert.equal(mixed.decision, 'block');
        assert.deepEqual(mixed.warnings.filter((w) => w.disposition === 'blocked').map((w) => w.subject.index), [1]);
        // Explicitly lenient analysis keeps the old advisory behavior.
        assert.equal(pre({ profiles: [], policy: enforce, requireDeclarations: false }).decision, 'allow');
        assert.equal(pre({ profiles: [], policy: { mode: 'warn' } }).decision, 'allow');
    });
    check('M3 regression: enforceRules adds to defaults; relaxing defaults is explicit and reported', () => {
        const noExit = [{ ...safeRead, cancellation: 'ignored', cleanup: 'none' }];
        // An empty or narrower list no longer removes default enforcement.
        for (const enforceRules of [[], ['ABH_MISSING_CLEANUP'], ['ABH_DEADLINE_INFEASIBLE']]) {
            const report = pre({ profiles: noExit, policy: { mode: 'enforce', enforceRules } });
            assert.equal(report.decision, 'block', JSON.stringify(enforceRules));
            assert.equal(find(report, 'ABH_NO_EXIT_PATH').disposition, 'blocked');
            assert.deepEqual(report.relaxedRules, []);
        }
        // Added rules now enforce on top of the defaults.
        const { cleanup, ...noCleanup } = safeRead;
        const added = pre({ profiles: [{ ...noCleanup, cleanup: 'none' }], policy: { mode: 'enforce', enforceRules: ['ABH_MISSING_CLEANUP'] } });
        assert.equal(find(added, 'ABH_MISSING_CLEANUP').disposition, 'blocked');
        // Relaxing a default must be named and is always visible.
        const relaxed = pre({ profiles: noExit, policy: { mode: 'enforce', relaxRules: ['ABH_NO_EXIT_PATH'] } });
        assert.equal(relaxed.decision, 'allow');
        assert.deepEqual(relaxed.relaxedRules, ['ABH_NO_EXIT_PATH']);
        const notice = find(relaxed, 'ABH_ENFORCEMENT_RELAXED');
        assert.deepEqual([notice.certainty, notice.disposition, notice.subject.kind, notice.evidence.rule1, notice.evidence.relaxedCount], ['confirmed', 'reported', 'workflow', 'ABH_NO_EXIT_PATH', 1]);
        assert.equal(relaxed.warnings[0].ruleId, 'ABH_ENFORCEMENT_RELAXED', 'reported first');
        assert.equal(find(relaxed, 'ABH_NO_EXIT_PATH').disposition, 'reported');
        assert.ok(find(pre({ profiles: noExit, policy: { mode: 'warn', relaxRules: ['ABH_NO_EXIT_PATH'] } }), 'ABH_ENFORCEMENT_RELAXED'));
        // Misuse is rejected instead of silently ignored.
        for (const policy of [
            { mode: 'enforce', relaxRules: ['ABH_MISSING_CLEANUP'] },
            { mode: 'enforce', enforceRules: ['ABH_NO_EXIT_PATH'], relaxRules: ['ABH_NO_EXIT_PATH'] },
            { mode: 'enforce', relaxRules: ['ABH_NO_EXIT_PATH', 'ABH_NO_EXIT_PATH'] },
            { mode: 'enforce', enforceRules: ['ABH_MISSING_CLENUP'] },
            { mode: 'enforce', relaxRules: ['ASH_LEASE_EXPIRED'] },
        ])
            assert.throws(() => pre({ profiles: noExit, policy }), (e) => e.code === 'invalid-policy', JSON.stringify(policy));
        // The observer follows the same rule: its defaults survive a custom list.
        const clock = { t: 0 };
        let cancels = 0;
        const o = api.createAshwatthamaObserver({ now: () => clock.t, policy: { mode: 'enforce', enforceRules: ['ASH_CANCEL_STUCK'] } });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, cancel: () => cancels++ });
        clock.t = 2000;
        assert.equal(o.scan(TENANT)[0].disposition, 'cancellation-requested');
        assert.equal(cancels, 1);
    });
    check('Abhimanyu: missing cleanup declaration is insufficient metadata, explicit none is confirmed', () => {
        const { cleanup, ...noCleanup } = safeRead;
        const missing = find(pre({ profiles: [noCleanup], policy: { mode: 'enforce' } }), 'ABH_MISSING_CLEANUP');
        assert.equal(missing.certainty, 'insufficient-metadata');
        assert.equal(missing.disposition, 'reported', 'not every warning is fatal');
        assert.equal(find(pre({ profiles: [{ ...safeRead, cleanup: 'none' }] }), 'ABH_MISSING_CLEANUP').certainty, 'confirmed');
        // Non-protected actions need no cleanup declaration.
        assert.deepEqual(ids(pre({ profiles: [{ capability: 'read', sideEffect: 'none', effect: 'read-only' }] })), []);
        const missingProfile = pre({ profiles: [] });
        assert.deepEqual(ids(missingProfile), ['ABH_MISSING_PROFILE']);
        assert.equal(missingProfile.warnings[0].certainty, 'insufficient-metadata');
    });
    check('Abhimanyu: retry exhaustion, unbounded and side-effecting retries, deadline feasibility', () => {
        assert.equal(find(pre({ profiles: [{ ...safeRead, retries: 'unbounded' }], policy: { mode: 'enforce' } }), 'ABH_UNBOUNDED_RETRY').disposition, 'blocked');
        const write = { capability: 'read', sideEffect: 'protected', effect: 'state-changing', cancellation: 'cooperative', cleanup: verified, retries: { max: 2 } };
        assert.equal(find(pre({ profiles: [{ ...write, idempotent: false }] }), 'ABH_RETRY_SIDE_EFFECT').certainty, 'confirmed');
        assert.equal(find(pre({ profiles: [write] }), 'ABH_RETRY_SIDE_EFFECT').certainty, 'potential');
        assert.equal(find(pre({ profiles: [{ ...write, idempotent: true }] }), 'ABH_RETRY_SIDE_EFFECT'), undefined);
        // Engine retries (read-only only) count against the deadline: 1000 ms × (1 + 3) > 3000 ms.
        const infeasible = find(pre({ options: { allowedCapabilities: ['read'], maxRetries: 3 }, deadlineMs: 3000 }), 'ABH_DEADLINE_INFEASIBLE');
        assert.deepEqual([infeasible.certainty, infeasible.evidence.requiredMs, infeasible.evidence.deadlineMs], ['potential', 4000, 3000]);
        assert.equal(find(pre({ options: { allowedCapabilities: ['read'], maxRetries: 2 }, deadlineMs: 3000 }), 'ABH_DEADLINE_INFEASIBLE'), undefined);
        // Parallel plans use the critical path instead of the sequential sum.
        const parallel = plan(action('a'), action('b'), action('c'));
        assert.ok(find(pre({ plan: parallel, deadlineMs: 2500 }), 'ABH_DEADLINE_INFEASIBLE'));
        assert.equal(find(pre({ plan: parallel, deadlineMs: 2500, options: { allowedCapabilities: ['read'], maxParallel: 3 } }), 'ABH_DEADLINE_INFEASIBLE'), undefined);
        // The existing validators still reject retry overrides above the engine cap.
        assert.throws(() => pre({ options: { allowedCapabilities: ['read'], maxRetries: 4 } }), (e) => e.code === 'invalid-input');
    });
    check('Abhimanyu: unreachable completion, invalid plans and RUDRA step plans', () => {
        const denied = find(pre({ plan: plan(action('a'), action('b', 'admin')), policy: { mode: 'enforce' } }), 'ABH_UNREACHABLE_COMPLETION');
        assert.deepEqual([denied.certainty, denied.disposition, denied.subject.index, denied.evidence.reason], ['confirmed', 'blocked', 1, 'not-allowlisted']);
        const tools = { findByCapability: (capability) => (capability === 'read' ? [{ effect: 'read-only' }] : []) };
        assert.equal(find(pre({ plan: plan(action('a', 'other')), options: { allowedCapabilities: ['other'] }, tools, profiles: [{ ...safeRead, capability: 'other' }] }), 'ABH_UNREACHABLE_COMPLETION').evidence.reason, 'unbound');
        for (const bad of [plan(action('a', 'read', { source: 'step', stepId: 'a' })), plan(action('a'), action('a')), { actions: [action('a')], permissions: ['admin'] }, plan()]) {
            const r = pre({ plan: bad, policy: { mode: 'enforce' } });
            assert.deepEqual(ids(r), ['ABH_INVALID_PLAN']);
            assert.equal(r.decision, 'block');
        }
        const steps = { steps: [{ id: 'a', capability: 'read', input: { source: 'task' } }, { id: 'b', capability: 'read', input: { source: 'step', stepId: 'a' } }] };
        const rudra = pre({ plan: steps, options: { allowedCapabilities: ['read'], maxSteps: 4 } });
        assert.deepEqual([ids(rudra), rudra.actions, rudra.depth], [[], 2, 2]);
        assert.deepEqual(ids(pre({ plan: steps, options: { allowedCapabilities: ['read'], maxSteps: 1 } })), ['ABH_INVALID_PLAN']);
    });
    check('Abhimanyu: compensation, resume recovery, approved long-running deadlines', () => {
        const write = { capability: 'write', sideEffect: 'protected', effect: 'state-changing', cancellation: 'cooperative', cleanup: verified };
        const two = plan(action('w', 'write'), action('r'));
        const options = { allowedCapabilities: ['read', 'write', 'undo'] };
        assert.equal(find(pre({ plan: two, options, profiles: [safeRead, write] }), 'ABH_MISSING_COMPENSATION').certainty, 'insufficient-metadata');
        assert.equal(find(pre({ plan: two, options, profiles: [safeRead, { ...write, compensation: 'none' }] }), 'ABH_MISSING_COMPENSATION').certainty, 'potential');
        const undo = { capability: 'undo', sideEffect: 'protected', effect: 'state-changing', cancellation: 'cooperative', cleanup: verified };
        assert.deepEqual(ids(pre({ plan: two, options, profiles: [safeRead, { ...write, compensation: { ...verified, capability: 'undo' } }, undo] })), []);
        const invalid = pre({ plan: two, options: { allowedCapabilities: ['read', 'write'] }, profiles: [safeRead, { ...write, compensation: { ...verified, capability: 'undo' } }, undo], policy: { mode: 'enforce' } });
        assert.equal(find(invalid, 'ABH_INVALID_DECLARATION').disposition, 'blocked');
        // A final state-changing action has no later work to fail, so compensation is not required.
        assert.deepEqual(ids(pre({ plan: plan(action('w', 'write')), options, profiles: [write] })), []);
        assert.equal(find(pre({ plan: plan(action('w', 'write')), options, profiles: [write], pausable: true }), 'ABH_RESUME_UNSAFE').certainty, 'insufficient-metadata');
        assert.deepEqual(ids(pre({ plan: plan(action('w', 'write')), options, profiles: [{ ...write, resume: verified }], pausable: true })), []);
        const hour = 3_600_000;
        assert.equal(find(pre({ deadlineMs: hour }), 'ABH_UNBOUNDED_DEADLINE').certainty, 'potential');
        assert.deepEqual(ids(pre({ deadlineMs: hour, approvedLongRunning: { maxDurationMs: 2 * hour, approvalRef: 'change-42' } })), []);
        assert.equal(find(pre({ deadlineMs: undefined }), 'ABH_UNBOUNDED_DEADLINE').certainty, 'insufficient-metadata');
    });
    check('Abhimanyu: host declarations are validated, never trusted blindly', () => {
        const reject = (profiles) => assert.throws(() => pre({ profiles }), (e) => e instanceof api.WorkflowSafetyError && e.code === 'invalid-declaration');
        reject([safeRead, safeRead]);
        reject([{ ...safeRead, grant: ['admin'] }]);
        reject([{ ...safeRead, sideEffect: 'maybe' }]);
        reject([{ ...safeRead, cleanup: { verifiedBy: 'has spaces', version: '1' } }]);
        reject([{ ...safeRead, cleanup: 'verified' }]);
        reject([{ ...safeRead, compensation: { ...verified, capability: 'read' } }]);
        reject([{ ...safeRead, retries: { max: 11 } }]);
        reject([{ ...safeRead, maxDurationMs: 0 }]);
        reject([Object.defineProperty({ ...safeRead }, 'cleanup', { get: () => verified, enumerable: true })]);
        reject('not-an-array');
        assert.throws(() => pre({ policy: { mode: 'strict' } }), (e) => e.code === 'invalid-policy');
        assert.throws(() => pre({ policy: { mode: 'enforce', enforceRules: ['ASH_CANCEL_STUCK'] } }), (e) => e.code === 'invalid-policy');
        assert.throws(() => pre({ approvedLongRunning: { maxDurationMs: 1, approvalRef: 'x y' } }), (e) => e.code === 'invalid-declaration');
        assert.equal(api.validateSafetyProfiles([safeRead]).size, 1);
    });
    check('Abhimanyu: disabled mode, bounded warnings and nonsecret evidence', () => {
        assert.deepEqual(ids(pre({ profiles: [], policy: { mode: 'disabled' } })), []);
        const many = plan(...Array.from({ length: 20 }, (_, i) => action('a' + i)));
        const r = pre({ plan: many, profiles: [], maxWarnings: 5 });
        assert.equal(r.warnings.length, 5);
        assert.equal(r.truncated, true);
        assert.equal(r.warnings.at(-1).ruleId, 'ABH_ANALYSIS_TRUNCATED');
        const secret = pre({ plan: plan(action('secret-token-AKIA123', 'read', { source: 'literal', data: 'password=hunter2' })), profiles: [{ ...safeRead, cleanup: 'none' }] });
        const text = JSON.stringify(secret);
        assert.ok(!text.includes('AKIA123') && !text.includes('hunter2'));
        assert.equal(secret.warnings[0].subject.ref, 'action-0');
        assert.throws(() => pre({ plan: many, profiles: [], maxWarnings: 1000 }), (e) => e.code === 'invalid-input');
    });

    /* ----------------------------------------------------- engine wiring */
    async function engineFixture({ safety, execute = (input) => input, effect = 'read-only', limits } = {}) {
        let calls = 0, approvals = 0;
        const tools = new api.ToolRegistry().register({
            id: 'fixture.read', capability: 'read', effect, parallelSafe: false,
            validateInput: () => true, validateOutput: () => true,
            execute: (input, context) => { calls++; return execute(input, context); },
        });
        const provider = createMockIdentityProvider({ principal: { id: 'user', issuer: 'host', permissions: ['work'] },
            session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10_000_000, scope: TENANT } });
        const jay = new api.Jay(provider, { now: () => 2000 });
        const policies = new api.PermissionPolicyRegistry()
            .register({ kind: 'capability', id: 'workflow', effect: 'read-only', permissions: ['work'], validateInput: () => true })
            .register({ kind: 'capability', id: 'read', effect, permissions: ['work'], validateInput: () => true })
            .register({ kind: 'tool', id: 'fixture.read', effect, permissions: ['work'], requiresApproval: true, validateInput: () => true });
        const security = new api.Vijay(jay, policies, { tools: tools.protectedTools, approve: () => { approvals++; return true; } });
        const engine = new api.RudraWorkflowEngine(tools, security, safety);
        const context = await jay.createContext({ id: 'task', input: { capability: 'workflow', data: 2 } },
            { signal: new AbortController().signal, toolPermissions: ['fixture.read'], limits: { timeoutMs: 2000, ...limits } });
        return { engine, context, counts: () => ({ calls, approvals }), start: (p, o = {}) => engine.start(context, p, { allowedCapabilities: ['read'], ...o }) };
    }
    check('engine: no safety options keeps existing behavior', async () => {
        const f = await engineFixture();
        const run = f.start(plan(action('a')));
        assert.equal(run.preflight, undefined);
        assert.equal((await run.result).status, 'completed');
        assert.throws(() => new api.RudraWorkflowEngine(new api.ToolRegistry(), {}, { lifecycle: { begin() {} } }), (e) => e.code === 'invalid-options');
        assert.throws(() => new api.RudraWorkflowEngine(new api.ToolRegistry(), {}, { preflight: { profiles: [{}] } }), (e) => e.code === 'invalid-options');
        assert.throws(() => new api.RudraWorkflowEngine(new api.ToolRegistry(), {}, { other: true }), (e) => e.code === 'invalid-options');
    });
    check('engine: enforce preflight refuses before any approval or tool call; warn mode attaches the report', async () => {
        const unsafe = [{ ...safeRead, cancellation: 'ignored', cleanup: 'none' }];
        const f = await engineFixture({ safety: { preflight: { profiles: unsafe, policy: { mode: 'enforce' } } } });
        assert.throws(() => f.start(plan(action('a'))), (e) => e instanceof api.WorkflowError && e.code === 'preflight-blocked');
        assert.deepEqual(f.counts(), { calls: 0, approvals: 0 });
        // The engine was never occupied; a safe plan under a different profile still runs.
        const ok = await engineFixture({ safety: { preflight: { profiles: [safeRead], policy: { mode: 'enforce' } } } });
        const run = ok.start(plan(action('a')));
        assert.equal(run.preflight.decision, 'allow');
        assert.equal((await run.result).status, 'completed');
        const w = await engineFixture({ safety: { preflight: { profiles: unsafe, policy: { mode: 'warn' } } } });
        const warned = w.start(plan(action('a')));
        assert.equal(warned.preflight.decision, 'allow');
        assert.deepEqual(ids(warned.preflight), ['ABH_NO_EXIT_PATH']);
        assert.equal((await warned.result).status, 'completed', 'warnings never change authorization or execution');
        assert.deepEqual(w.counts(), { calls: 1, approvals: 1 });
        // Warnings are not authorization: in warn mode the existing allowlist enforcement still decides.
        const outsideHost = await engineFixture({ safety: { preflight: { profiles: [safeRead], policy: { mode: 'warn' } } } });
        const outside = outsideHost.start(plan(action('a')), { allowedCapabilities: ['other'] });
        assert.equal(find(outside.preflight, 'ABH_UNREACHABLE_COMPLETION').disposition, 'reported');
        assert.equal((await outside.result).error.code, 'capability-denied');
        assert.deepEqual(outsideHost.counts(), { calls: 0, approvals: 0 });
    });

    /* -------------------------------------------------------- ashwatthama */
    const observer = (options = {}) => {
        const clock = { t: 1_000_000 };
        const o = api.createAshwatthamaObserver({ now: () => clock.t, cancellationWindowMs: 1000, acknowledgementWindowMs: 1000, orphanWindowMs: 1000, ...options });
        return { o, clock, advance: (ms) => { clock.t += ms; } };
    };
    check('Ashwatthama: valid completion and valid cancellation produce no warnings and retire records', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 5000, leaseMs: 2000 });
        advance(500); h.progress(); h.complete('completed'); h.cleanup(true);
        advance(10_000);
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(o.status().tracked, 0);
        assert.equal(o.history(TENANT)[0].leaseStatus, 'released');
        let cancelled = 0;
        const c = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 5000, cancel: () => cancelled++ });
        c.requestCancellation(); advance(200); c.complete('cancelled'); c.cleanup(true);
        advance(10_000);
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(cancelled, 0, 'warn mode never invokes cancellation');
        const record = o.history(TENANT)[1];
        assert.deepEqual(Object.keys(record).sort(), ['cancellationRequestedAt', 'cleanupAcknowledgedAt', 'cleanupFailures', 'completedAt', 'completionStatus', 'deadlineAt', 'kind', 'lastProgressAt', 'leaseExpiresAt', 'leaseStatus', 'parentRef', 'paused', 'ref', 'scope', 'startedAt']);
    });
    check('Ashwatthama: expired lease and valid lease renewal', () => {
        const { o, advance } = observer();
        const renewed = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 10_000, leaseMs: 1000, ref: 'renewed' });
        const expired = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 10_000, leaseMs: 1000, ref: 'expired' });
        advance(800); assert.equal(renewed.renewLease(1000), true);
        advance(500);
        const warnings = o.scan(TENANT);
        assert.deepEqual(warnings.map((w) => [w.ruleId, w.subject.ref]), [['ASH_LEASE_EXPIRED', 'expired']]);
        assert.equal(warnings[0].evidence.overdueMs, 300);
        assert.equal(expired.renewLease(1000), false, 'an expired lease is not revived');
        assert.equal(o.list(TENANT).find((r) => r.ref === 'expired').leaseStatus, 'expired');
        // Renewal never extends a lease past the deadline.
        advance(8000); renewed.renewLease(5000);
        assert.ok(o.list(TENANT).find((r) => r.ref === 'renewed').leaseExpiresAt <= o.list(TENANT).find((r) => r.ref === 'renewed').deadlineAt);
    });
    check('Ashwatthama: deadline exceeded requests cooperative cancellation only in enforce mode, once', () => {
        for (const mode of ['warn', 'enforce']) {
            const { o, advance } = observer({ policy: { mode } });
            let cancels = 0;
            o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 1000, cancel: () => cancels++ });
            advance(1500);
            const [w] = o.scan(TENANT);
            assert.equal(w.ruleId, 'ASH_DEADLINE_EXCEEDED');
            assert.equal(w.disposition, mode === 'enforce' ? 'cancellation-requested' : 'reported');
            o.scan(TENANT); o.scan(TENANT);
            assert.equal(cancels, mode === 'enforce' ? 1 : 0);
        }
        const { o, advance } = observer({ policy: { mode: 'enforce' } });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, cancel: () => { throw new Error('host failure'); } });
        advance(1500);
        assert.equal(o.scan(TENANT)[0].disposition, 'cancellation-requested', 'host cancel faults are isolated');
    });
    check('Ashwatthama: stuck cancellation and orphaned children', () => {
        const { o, advance } = observer();
        const parent = o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 60_000, ref: 'wf' });
        const child = o.begin({ kind: 'action', scope: TENANT, timeoutMs: 60_000, parent, ref: 'act' });
        parent.requestCancellation();
        advance(500);
        assert.deepEqual(o.scan(TENANT), [], 'within the cooperative window');
        parent.complete('cancelled');
        advance(1500);
        const rules = o.scan(TENANT).map((w) => [w.ruleId, w.subject.ref]);
        assert.deepEqual(rules, [['ASH_CANCEL_STUCK', 'wf'], ['ASH_OPERATION_ORPHANED', 'act']]);
        assert.equal(o.scan(TENANT).find((w) => w.ruleId === 'ASH_OPERATION_ORPHANED').evidence.parentRef, 'wf');
        child.complete('cancelled'); child.cleanup(true); parent.cleanup(true);
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(o.status().tracked, 0);
    });
    check('Ashwatthama: legitimate long-running work, heartbeats and pause are not false positives', () => {
        const { o, advance } = observer();
        const hour = 3_600_000;
        assert.throws(() => o.begin({ kind: 'host', scope: TENANT, timeoutMs: hour }), (e) => e.code === 'invalid-input');
        assert.throws(() => o.begin({ kind: 'host', scope: TENANT, timeoutMs: 2 * hour, approvedLongRunning: { maxDurationMs: hour, approvalRef: 'job-1' } }), (e) => e.code === 'invalid-declaration');
        const job = o.begin({ kind: 'host', scope: TENANT, timeoutMs: hour, approvedLongRunning: { maxDurationMs: hour, approvalRef: 'job-1' }, heartbeatMs: 10_000, leaseMs: 120_000 });
        for (let i = 0; i < 180; i++) { advance(10_000); job.progress(); if (i % 5 === 0) job.renewLease(120_000); }
        assert.deepEqual(o.scan(TENANT), [], '30 minutes with heartbeats and renewals');
        advance(25_000);
        assert.deepEqual(o.scan(TENANT).map((w) => [w.ruleId, w.certainty]), [['ASH_HEARTBEAT_MISSED', 'potential']]);
        job.pause(); advance(40_000);
        assert.deepEqual(o.scan(TENANT).filter((w) => w.ruleId === 'ASH_HEARTBEAT_MISSED'), [], 'paused work is not silent');
        job.resume(); job.renewLease(120_000);
        assert.deepEqual(o.scan(TENANT), []);
        // No heartbeat declared: long silence alone is never a warning.
        const quiet = o.begin({ kind: 'host', scope: OTHER, timeoutMs: 600_000 });
        advance(500_000);
        assert.deepEqual(o.scan(OTHER), []);
        quiet.complete('completed'); quiet.cleanup(true);
    });
    check('Ashwatthama: completion and cleanup acknowledgements, repeated cleanup failure', () => {
        const { o, advance } = observer({ maxCleanupFailures: 2 });
        const released = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'released' });
        const done = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'done' });
        const failing = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'failing' });
        released.cleanup(true); done.complete('completed'); failing.complete('failed');
        failing.cleanup(false); failing.cleanup(false);
        advance(1500);
        assert.deepEqual(o.scan(TENANT).map((w) => [w.ruleId, w.subject.ref, w.certainty]), [
            ['ASH_COMPLETION_UNACKNOWLEDGED', 'released', 'confirmed'],
            ['ASH_CLEANUP_UNACKNOWLEDGED', 'done', 'potential'],
            ['ASH_CLEANUP_UNACKNOWLEDGED', 'failing', 'potential'],
            ['ASH_CLEANUP_FAILED_REPEATEDLY', 'failing', 'confirmed'],
        ]);
        const none = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, cleanup: 'none' });
        none.complete('completed');
        assert.equal(o.list(TENANT).some((r) => r.ref === none.ref), false, 'no cleanup expected');
    });
    check('Ashwatthama: tenant isolation and no authority beyond registered cooperative cancel', () => {
        const { o, advance } = observer();
        let cancels = 0;
        const a = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'shared-ref-a', cancel: () => cancels++ });
        o.begin({ kind: 'tool', scope: OTHER, timeoutMs: 1000, ref: 'shared-ref-b' });
        advance(2000);
        assert.deepEqual(o.scan(OTHER).map((w) => w.subject.ref), ['shared-ref-b']);
        assert.deepEqual(o.list(OTHER).map((r) => r.ref), ['shared-ref-b']);
        assert.equal(o.cancel('shared-ref-a', OTHER), false, 'cross-tenant cancel refused');
        assert.equal(cancels, 0);
        assert.equal(o.cancel('shared-ref-a', TENANT), true);
        assert.equal(o.cancel('shared-ref-a', TENANT), false, 'at most once');
        assert.equal(cancels, 1);
        assert.throws(() => o.begin({ kind: 'tool', scope: OTHER, timeoutMs: 1000, parent: a }), (e) => e.code === 'invalid-input');
        assert.throws(() => o.scan(undefined), (e) => e.code === 'invalid-input');
        for (const bad of [{ kind: 'tool', scope: TENANT, timeoutMs: 1000, payload: 'x' }, { kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'Bearer abc' }, { kind: 'shell', scope: TENANT, timeoutMs: 1000 }, { kind: 'tool', scope: { kind: 'company', id: 'a b' }, timeoutMs: 1000 }])
            assert.throws(() => o.begin(bad), (e) => e.code === 'invalid-input');
        assert.equal(typeof o.kill, 'undefined');
        assert.deepEqual(Object.keys(o).sort(), ['begin', 'cancel', 'dispose', 'history', 'list', 'scan', 'status']);
    });
    check('Ashwatthama: bounded tracking, history and warnings; dispose releases everything', () => {
        let notified = 0;
        const { o, advance } = observer({ maxOperations: 2, maxHistory: 1, maxWarnings: 2, onWarning: () => { notified++; throw new Error('observer fault'); } });
        const a = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, leaseMs: 500 });
        const c = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        assert.equal(c.ref, 'untracked');
        assert.equal(o.status().untracked, 1);
        advance(2000);
        const warnings = o.scan(TENANT);
        assert.equal(warnings.length, 2);
        o.scan(TENANT);
        assert.equal(notified, 2, 'notified once per operation and rule, faults isolated');
        a.complete('completed'); a.cleanup(true);
        const b = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        b.complete('completed'); b.cleanup(true);
        assert.deepEqual([o.status().history, o.status().droppedHistory], [1, 1]);
        const tracking = observer({ maxOperations: 1 });
        tracking.o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        tracking.o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        assert.ok(tracking.o.scan(TENANT).some((w) => w.ruleId === 'ASH_TRACKING_LIMIT'));
        o.dispose();
        assert.deepEqual(o.status(), { tracked: 0, history: 0, untracked: 1, droppedHistory: 1 });
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 }).ref, 'untracked');
        assert.throws(() => api.createAshwatthamaObserver({ maxOperations: 100_000 }), (e) => e.code === 'invalid-input');
    });

    /* -------------------------------------------- engine + observer wiring */
    check('engine + observer: normal runs leave no tracked operations or warnings', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t });
        const f = await engineFixture({ safety: { lifecycle: life } });
        assert.equal((await f.start(plan(action('a'), action('b'))).result).status, 'completed');
        await settle();
        clock.t += 60_000;
        assert.deepEqual(life.scan(TENANT), []);
        assert.equal(life.status().tracked, 0);
        assert.deepEqual(life.history(TENANT).map((r) => [r.kind, r.completionStatus, r.cleanupAcknowledgedAt !== null]).sort(), [
            ['action', 'completed', true], ['action', 'completed', true], ['workflow', 'completed', true],
        ]);
        const text = JSON.stringify(life.history(TENANT));
        assert.ok(!text.includes('session') && !text.includes('user'), 'no session or principal identifiers');
    });
    check('engine + observer: a tool that ignores cancellation is reported stuck and orphaned, then clears', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t, cancellationWindowMs: 1000, orphanWindowMs: 1000 });
        const entered = deferred(), release = deferred();
        const f = await engineFixture({ safety: { lifecycle: life }, execute: async () => { entered.resolve(); await release.promise; return 1; } });
        const run = f.start(plan(action('a')));
        await entered.promise;
        run.cancel();
        assert.equal((await run.result).status, 'cancelled');
        clock.t += 2000;
        const warnings = life.scan(TENANT).map((w) => [w.ruleId, w.evidence.kind]);
        // The workflow reached a terminal state but cannot release; its action never settled.
        assert.deepEqual(warnings.filter(([id]) => id !== 'ASH_DEADLINE_EXCEEDED'), [
            ['ASH_CANCEL_STUCK', 'workflow'],
            ['ASH_CANCEL_STUCK', 'action'],
            ['ASH_OPERATION_ORPHANED', 'action'],
        ]);
        assert.equal(f.counts().calls, 1, 'no extra dispatch');
        release.resolve();
        await settle();
        assert.deepEqual(life.scan(TENANT), []);
        assert.equal(life.status().tracked, 0);
    });
    check('engine + observer: enforce-mode deadline uses only the run\'s own cooperative cancel', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t, policy: { mode: 'enforce' } });
        const entered = deferred();
        const f = await engineFixture({ safety: { lifecycle: life }, execute: async (_input, context) => {
            entered.resolve();
            await new Promise((resolve) => context.signal.addEventListener('abort', resolve, { once: true }));
            return 1;
        } });
        const run = f.start(plan(action('a')));
        await entered.promise;
        clock.t += 5000; // past the 2000 ms task deadline on the observer clock
        const scan = life.scan(TENANT);
        assert.ok(scan.some((w) => w.ruleId === 'ASH_DEADLINE_EXCEEDED' && w.disposition === 'cancellation-requested'));
        assert.equal((await run.result).status, 'cancelled');
        await settle();
        assert.equal(life.status().tracked, 0);
    });
}
