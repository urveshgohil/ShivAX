// SHIVAX 0.4.0 HANUMAN · H04-B adversarial, negative and false-positive fixtures for Abhimanyu and Ashwatthama.
// Offline and deterministic: injected clocks, fake hosts, mock identity. No network, no real timers beyond setImmediate.
// Fixtures that expose a production defect keep their correct assertion and run as `todo` with the finding ID.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createMockIdentityProvider } from './fixtures/mock-identity.mjs';

const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const action = (id, capability = 'read', input = { source: 'task' }, dependsOn) => ({ id, capability, input, ...(dependsOn ? { dependsOn } : {}) });
const plan = (...actions) => ({ actions });
const verified = { verifiedBy: 'review-h04b', version: '1' };
const TENANT = Object.freeze({ kind: 'company', id: 'tenant' });
const OTHER = Object.freeze({ kind: 'company', id: 'other' });
// Fully declared profiles: a safe protected read, a safe protected write, a pure computation.
const READ = { capability: 'read', sideEffect: 'protected', effect: 'read-only', maxDurationMs: 1000, cancellation: 'cooperative', cleanup: verified };
const WRITE = { capability: 'write', sideEffect: 'protected', effect: 'state-changing', maxDurationMs: 1000, cancellation: 'cooperative', cleanup: verified };
const PURE = { capability: 'pure', sideEffect: 'none', effect: 'read-only', maxDurationMs: 100 };
const ids = (report) => report.warnings.map((w) => w.ruleId);
const one = (report, ruleId) => {
    const found = report.warnings.filter((w) => w.ruleId === ruleId);
    assert.equal(found.length, 1, `${ruleId} expected exactly once, got ${found.length}`);
    return found[0];
};
/** Exact assertion: rule, severity, certainty, disposition, subject and the evidence fields named. */
function expectWarning(w, { ruleId, severity, certainty, disposition = 'reported', index, evidence = {} }) {
    assert.equal(w.ruleId, ruleId);
    assert.equal(w.severity, severity, `${ruleId} severity`);
    assert.equal(w.certainty, certainty, `${ruleId} certainty`);
    assert.equal(w.disposition, disposition, `${ruleId} disposition`);
    if (index !== undefined) assert.equal(w.subject.index, index, `${ruleId} subject`);
    for (const [key, value] of Object.entries(evidence)) assert.deepEqual(w.evidence[key], value, `${ruleId} evidence.${key}`);
}
/** Stable deduplication: one warning per rule and subject in any single report or scan. */
function unique(warnings) {
    const keys = warnings.map((w) => `${w.ruleId}|${w.subject.kind}|${w.subject.ref}`);
    assert.equal(new Set(keys).size, keys.length, 'duplicate warning for the same rule and subject');
}
// No process control: any call to process.kill during this suite is a defect.
const originalKill = process.kill;
let killCalls = 0;
process.kill = (...args) => { killCalls++; return originalKill.apply(process, args); };
test.after(() => { process.kill = originalKill; assert.equal(killCalls, 0, 'no process termination'); });

for (const [format, api] of [['ESM', await import('shivax')], ['CJS', require('shivax')]]) {
    const check = (name, run) => test(`${format}: H04-B ${name}`, run);
    const todo = (finding, name, run) => test(`${format}: H04-B ${name} [${finding}]`, { todo: finding }, run);
    const pre = (overrides = {}) =>
        api.runAbhimanyuPreflight({
            plan: plan(action('a')), capability: 'workflow', options: { allowedCapabilities: ['read', 'write', 'pure', 'undo'] },
            deadlineMs: 60_000, profiles: [READ, WRITE, PURE], policy: { mode: 'warn' }, ...overrides,
        });
    const observer = (options = {}) => {
        const clock = { t: 10_000 };
        const o = api.createAshwatthamaObserver({ now: () => clock.t, cancellationWindowMs: 1000, acknowledgementWindowMs: 1000, orphanWindowMs: 1000, ...options });
        return { o, clock, advance: (ms) => { clock.t += ms; } };
    };

    /* ================================================== Abhimanyu negative fixtures */
    check('A-N1 no reachable terminal path: unallowlisted or unbound capability, and an infeasible deadline', () => {
        const unallowed = pre({ plan: plan(action('a'), action('b', 'admin.reset')), options: { allowedCapabilities: ['read'] }, policy: { mode: 'enforce' } });
        assert.deepEqual(ids(unallowed), ['ABH_UNREACHABLE_COMPLETION']);
        expectWarning(unallowed.warnings[0], { ruleId: 'ABH_UNREACHABLE_COMPLETION', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 1, evidence: { reason: 'not-allowlisted' } });
        assert.equal(unallowed.decision, 'block');
        const tools = { findByCapability: (c) => (c === 'read' ? [{ effect: 'read-only' }] : []) };
        const unbound = pre({ plan: plan(action('a'), action('b', 'write')), tools, policy: { mode: 'enforce' } });
        assert.deepEqual(ids(unbound), ['ABH_UNREACHABLE_COMPLETION']);
        expectWarning(unbound.warnings[0], { ruleId: 'ABH_UNREACHABLE_COMPLETION', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 1, evidence: { capability: 'write', reason: 'unbound' } });
        // Completion cannot fit the deadline: 3 sequential reads × 1000 ms with 1 retry each = 6000 ms > 5000 ms.
        const late = pre({ plan: plan(action('a'), action('b'), action('c')), options: { allowedCapabilities: ['read'], maxRetries: 1 }, deadlineMs: 5000, policy: { mode: 'enforce' } });
        assert.deepEqual(ids(late), ['ABH_DEADLINE_INFEASIBLE']);
        expectWarning(late.warnings[0], { ruleId: 'ABH_DEADLINE_INFEASIBLE', severity: 'medium', certainty: 'potential', disposition: 'reported', evidence: { requiredMs: 6000, deadlineMs: 5000, parallel: false } });
        // Every plan above passes the existing structural validators: acyclicity alone is not safety.
        for (const r of [unallowed, unbound, late]) assert.ok(!ids(r).includes('ABH_INVALID_PLAN') && r.actions > 0);
    });
    check('A-N2 protected effect without a cleanup contract', () => {
        const none = pre({ profiles: [{ ...READ, cleanup: 'none' }], policy: { mode: 'enforce' } });
        assert.deepEqual(ids(none), ['ABH_MISSING_CLEANUP']);
        expectWarning(none.warnings[0], { ruleId: 'ABH_MISSING_CLEANUP', severity: 'medium', certainty: 'confirmed', disposition: 'reported', index: 0, evidence: { capability: 'read', cancellation: 'cooperative' } });
        assert.equal(none.decision, 'allow', 'not a default-enforced rule');
        // A high-impact host makes it mandatory.
        const strict = pre({ profiles: [{ ...READ, cleanup: 'none' }], policy: { mode: 'enforce', enforceRules: ['ABH_MISSING_CLEANUP'] } });
        expectWarning(one(strict, 'ABH_MISSING_CLEANUP'), { ruleId: 'ABH_MISSING_CLEANUP', severity: 'medium', certainty: 'confirmed', disposition: 'blocked', index: 0 });
    });
    check('A-N3 missing compensation for a committed effect followed by fallible work', () => {
        const { compensation, ...write } = WRITE;
        const r = pre({ plan: plan(action('pay', 'write'), action('notify')), profiles: [READ, write] });
        assert.deepEqual(ids(r), ['ABH_MISSING_COMPENSATION']);
        expectWarning(r.warnings[0], { ruleId: 'ABH_MISSING_COMPENSATION', severity: 'medium', certainty: 'insufficient-metadata', index: 0, evidence: { capability: 'write', laterActions: 1 } });
        const declaredNone = pre({ plan: plan(action('pay', 'write'), action('notify')), profiles: [READ, { ...write, compensation: 'none' }] });
        expectWarning(one(declaredNone, 'ABH_MISSING_COMPENSATION'), { ruleId: 'ABH_MISSING_COMPENSATION', severity: 'medium', certainty: 'potential', index: 0 });
    });
    check('A-N4 retries with no safe exhaustion', () => {
        const unbounded = pre({ profiles: [{ ...READ, retries: 'unbounded' }], options: { allowedCapabilities: ['read'], maxRetries: 2 }, policy: { mode: 'enforce' } });
        assert.deepEqual(ids(unbounded), ['ABH_UNBOUNDED_RETRY'], 'no deadline estimate is invented for an unbounded retry');
        expectWarning(unbounded.warnings[0], { ruleId: 'ABH_UNBOUNDED_RETRY', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 0, evidence: { capability: 'read', engineRetries: 2 } });
        const repeat = pre({ plan: plan(action('pay', 'write')), profiles: [{ ...WRITE, retries: { max: 3 }, idempotent: false }], policy: { mode: 'enforce' } });
        assert.deepEqual(ids(repeat), ['ABH_RETRY_SIDE_EFFECT']);
        expectWarning(repeat.warnings[0], { ruleId: 'ABH_RETRY_SIDE_EFFECT', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 0, evidence: { retries: 3 } });
    });
    check('A-N5 failure branch without recovery: two commits before a fallible step', () => {
        const r = pre({ plan: plan(action('reserve', 'write'), action('charge', 'write'), action('notify')), profiles: [READ, { ...WRITE, compensation: 'none' }] });
        assert.deepEqual(r.warnings.map((w) => [w.ruleId, w.subject.index, w.evidence.laterActions]), [
            ['ABH_MISSING_COMPENSATION', 0, 2],
            ['ABH_MISSING_COMPENSATION', 1, 1],
        ]);
        r.warnings.forEach((w) => expectWarning(w, { ruleId: 'ABH_MISSING_COMPENSATION', severity: 'medium', certainty: 'potential' }));
        unique(r.warnings);
    });
    check('A-N6 irrecoverable paused workflow', () => {
        const r = pre({ plan: plan(action('pay', 'write')), profiles: [{ ...WRITE, resume: 'unsupported' }], pausable: true });
        assert.deepEqual(ids(r), ['ABH_RESUME_UNSAFE']);
        expectWarning(r.warnings[0], { ruleId: 'ABH_RESUME_UNSAFE', severity: 'medium', certainty: 'potential', index: 0, evidence: { capability: 'write' } });
        assert.deepEqual(ids(pre({ plan: plan(action('pay', 'write')), profiles: [{ ...WRITE, resume: 'unsupported' }], pausable: false })), [], 'only when the host allows pausing');
    });
    check('A-N7 cancellation path that loses cleanup', () => {
        const r = pre({ profiles: [{ ...READ, cancellation: 'ignored', cleanup: 'none' }], policy: { mode: 'enforce' } });
        assert.deepEqual(ids(r), ['ABH_NO_EXIT_PATH'], 'reported once, not again as missing cleanup');
        expectWarning(r.warnings[0], { ruleId: 'ABH_NO_EXIT_PATH', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 0, evidence: { cancellation: 'ignored', cleanup: 'none' } });
    });
    check('A-N8 a sibling that keeps running past the terminal state (schema has no conditional branches)', () => {
        const scan = { capability: 'scan', sideEffect: 'protected', effect: 'read-only', maxDurationMs: 500, cancellation: 'ignored', cleanup: 'none' };
        const r = pre({ plan: plan(action('a'), action('b', 'scan')), options: { allowedCapabilities: ['read', 'scan'], maxParallel: 2 }, profiles: [READ, scan], policy: { mode: 'enforce' } });
        assert.deepEqual(r.warnings.map((w) => [w.ruleId, w.subject.index, w.disposition]), [['ABH_NO_EXIT_PATH', 1, 'blocked']]);
    });
    check('A-N9 parallel operations with partial failure exceed the deadline on the critical path', () => {
        const three = plan(action('a'), action('b'), action('c'), action('join', 'pure', { source: 'task' }, ['a', 'b', 'c']));
        const parallel = pre({ plan: three, options: { allowedCapabilities: ['read', 'pure'], maxParallel: 3, maxRetries: 1 }, deadlineMs: 2000 });
        assert.deepEqual(ids(parallel), ['ABH_DEADLINE_INFEASIBLE']);
        expectWarning(parallel.warnings[0], { ruleId: 'ABH_DEADLINE_INFEASIBLE', severity: 'medium', certainty: 'potential', evidence: { requiredMs: 2200, deadlineMs: 2000, parallel: true } });
        // Engine retries apply to every read-only action, the join included: 2 × 1000 + 2 × 100.
        assert.equal(parallel.depth, 2);
        const sequential = pre({ plan: three, options: { allowedCapabilities: ['read', 'pure'], maxRetries: 1 }, deadlineMs: 2000 });
        assert.equal(one(sequential, 'ABH_DEADLINE_INFEASIBLE').evidence.requiredMs, 6200);
    });
    check('A-N10 missing required exit metadata', () => {
        const bare = { capability: 'read', sideEffect: 'protected', effect: 'read-only' };
        const enforce = pre({ profiles: [bare], policy: { mode: 'enforce' } });
        assert.deepEqual(ids(enforce), ['ABH_NO_EXIT_PATH']);
        expectWarning(enforce.warnings[0], { ruleId: 'ABH_NO_EXIT_PATH', severity: 'high', certainty: 'insufficient-metadata', disposition: 'blocked', index: 0, evidence: { cancellation: null, cleanup: null, assumedWorstCase: true } });
        const warn = pre({ profiles: [bare] });
        assert.deepEqual(ids(warn), ['ABH_MISSING_CLEANUP']);
        expectWarning(warn.warnings[0], { ruleId: 'ABH_MISSING_CLEANUP', severity: 'medium', certainty: 'insufficient-metadata', disposition: 'reported', index: 0 });
        assert.equal(warn.warnings[0].evidence.assumedWorstCase, undefined, 'warn mode never assumes');
    });
    todo('H04B-02', 'A-N11 a profile effect that contradicts the live binding is rejected', () => {
        const tools = { findByCapability: (c) => (c === 'write' ? [{ effect: 'state-changing' }] : [{ effect: 'read-only' }]) };
        const lie = { ...WRITE, effect: 'read-only', retries: { max: 3 } };
        const r = pre({ plan: plan(action('pay', 'write'), action('notify')), tools, profiles: [READ, lie], policy: { mode: 'enforce' } });
        expectWarning(one(r, 'ABH_INVALID_DECLARATION'), { ruleId: 'ABH_INVALID_DECLARATION', severity: 'high', certainty: 'confirmed', disposition: 'blocked', index: 0 });
    });
    todo('H04B-03', 'A-N12 untrusted plan text is not echoed into warning evidence', () => {
        const r = pre({ plan: plan(action('a', 'sk-live-0123456789abcdef')), options: { allowedCapabilities: ['read'] } });
        assert.ok(!JSON.stringify(r).includes('sk-live-0123456789abcdef'));
    });

    /* ================================================== Abhimanyu positive fixtures */
    check('A-P1..P8 fully declared safe workflows produce no warnings, in warn and enforce mode', () => {
        const undo = { capability: 'undo', sideEffect: 'protected', effect: 'state-changing', maxDurationMs: 1000, cancellation: 'cooperative', cleanup: verified };
        const fixtures = {
            'successful exit': { plan: plan(action('a')) },
            'bounded failure exit': { plan: plan(action('a'), action('b')), options: { allowedCapabilities: ['read'], maxRetries: 2 }, deadlineMs: 6000 },
            'explicit cancellation': { plan: plan(action('a')), profiles: [{ ...READ, cleanup: 'none', cancellation: 'cooperative' }], expect: ['ABH_MISSING_CLEANUP'] },
            'host-supported cleanup with ignored cancellation': { profiles: [{ ...READ, cancellation: 'ignored' }] },
            'compensating action': { plan: plan(action('pay', 'write'), action('notify')), profiles: [READ, { ...WRITE, compensation: { ...verified, capability: 'undo' } }, undo] },
            'valid pause/resume': { plan: plan(action('pay', 'write')), profiles: [{ ...WRITE, resume: verified }], pausable: true },
            'bounded idempotent retries': { plan: plan(action('pay', 'write')), profiles: [{ ...WRITE, retries: { max: 2 }, idempotent: true }] },
            'parallel join': { plan: plan(action('a'), action('b'), action('join', 'pure', { source: 'task' }, ['a', 'b'])), options: { allowedCapabilities: ['read', 'pure'], maxParallel: 2 } },
        };
        for (const [name, fixture] of Object.entries(fixtures)) {
            const { expect = [], ...input } = fixture;
            for (const mode of ['warn', 'enforce']) {
                const r = pre({ ...input, policy: { mode } });
                assert.deepEqual(ids(r), expect, `${name} (${mode})`);
                assert.equal(r.decision, 'allow', `${name} (${mode})`);
                assert.ok(r.warnings.every((w) => w.severity !== 'high'), `${name}: no high-severity warning`);
            }
        }
    });
    check('A-P9 insufficient static metadata is classified as unknown, never as a guarantee or a confirmed defect', () => {
        const minimal = { capability: 'read', sideEffect: 'protected' };
        const r = pre({ plan: plan(action('a'), action('b', 'other')), options: { allowedCapabilities: ['read', 'other'] }, profiles: [minimal] });
        assert.deepEqual(r.warnings.map((w) => [w.ruleId, w.certainty, w.subject.index]), [
            ['ABH_MISSING_CLEANUP', 'insufficient-metadata', 0],
            ['ABH_MISSING_PROFILE', 'insufficient-metadata', 0],
            ['ABH_MISSING_PROFILE', 'insufficient-metadata', 1],
        ]);
        assert.equal(r.decision, 'allow');
        assert.ok(r.warnings.every((w) => w.disposition === 'reported'));
    });
    check('A-P10 a valid parallel join also runs in the engine under enforce-mode preflight', async () => {
        const host = await engineHost(api, { parallelSafe: true, safety: { preflight: { profiles: [READ, PURE], policy: { mode: 'enforce' } } }, extraPure: true });
        const run = host.start(plan(action('a'), action('b'), action('join', 'pure', { source: 'task' }, ['a', 'b'])), { allowedCapabilities: ['read', 'pure'], maxParallel: 2 });
        assert.equal(run.preflight.decision, 'allow');
        assert.deepEqual(ids(run.preflight), []);
        assert.equal((await run.result).status, 'completed');
    });

    /* ================================================== Ashwatthama negative fixtures */
    check('W-N1 expired lease', () => {
        const { o, advance } = observer();
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, leaseMs: 1000, ref: 'lease' });
        advance(1001);
        const [w, ...rest] = o.scan(TENANT);
        assert.equal(rest.length, 0);
        expectWarning(w, { ruleId: 'ASH_LEASE_EXPIRED', severity: 'high', certainty: 'confirmed', evidence: { overdueMs: 1, kind: 'tool' } });
        assert.equal(w.subject.ref, 'lease');
        assert.equal(o.list(TENANT)[0].leaseStatus, 'expired');
    });
    check('W-N2 cancellation ignored beyond the grace period', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'stuck' });
        h.requestCancellation();
        advance(1000);
        assert.deepEqual(o.scan(TENANT), [], 'at the edge of the window');
        advance(1);
        expectWarning(o.scan(TENANT)[0], { ruleId: 'ASH_CANCEL_STUCK', severity: 'high', certainty: 'confirmed', evidence: { waitedMs: 1001, windowMs: 1000, completed: false } });
    });
    check('W-N3 missing completion acknowledgment', () => {
        const { o, advance } = observer();
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'released' }).cleanup(true);
        advance(1001);
        const scan = o.scan(TENANT);
        assert.equal(scan.length, 1);
        expectWarning(scan[0], { ruleId: 'ASH_COMPLETION_UNACKNOWLEDGED', severity: 'medium', certainty: 'confirmed', evidence: { releasedMs: 1001 } });
    });
    check('W-N4 abandoned job without progress: detected only by evidence (heartbeat or deadline), not by duration', () => {
        const { o, advance } = observer();
        o.begin({ kind: 'host', scope: TENANT, timeoutMs: 600_000, ref: 'quiet' });
        o.begin({ kind: 'host', scope: TENANT, timeoutMs: 600_000, heartbeatMs: 10_000, ref: 'beating' });
        advance(20_001);
        assert.deepEqual(o.scan(TENANT).map((w) => [w.subject.ref, w.ruleId]), [['beating', 'ASH_HEARTBEAT_MISSED']]);
        advance(600_000);
        assert.deepEqual(o.scan(TENANT).map((w) => [w.subject.ref, w.ruleId]), [
            ['quiet', 'ASH_DEADLINE_EXCEEDED'], ['beating', 'ASH_DEADLINE_EXCEEDED'], ['beating', 'ASH_HEARTBEAT_MISSED'],
        ]);
    });
    check('W-N5 orphaned operation reference', () => {
        const { o, advance } = observer();
        const parent = o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 60_000, ref: 'wf' });
        o.begin({ kind: 'action', scope: TENANT, timeoutMs: 60_000, parent, ref: 'child' });
        parent.complete('failed');
        parent.cleanup(true);
        advance(1001);
        const scan = o.scan(TENANT);
        assert.deepEqual(scan.map((w) => [w.subject.ref, w.ruleId]), [['child', 'ASH_OPERATION_ORPHANED']]);
        expectWarning(scan[0], { ruleId: 'ASH_OPERATION_ORPHANED', severity: 'high', certainty: 'confirmed', evidence: { parentRef: 'wf', sinceParentMs: 1001 } });
        assert.ok(o.list(TENANT).some((r) => r.ref === 'wf'), 'parent retained while its child is unsettled');
    });
    check('W-N6 lease renewal after expiration is refused and the expiry stands', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, leaseMs: 1000 });
        advance(1500);
        assert.equal(h.renewLease(5000), false);
        assert.equal(o.list(TENANT)[0].leaseStatus, 'expired');
        assert.deepEqual(o.scan(TENANT).map((w) => w.ruleId), ['ASH_LEASE_EXPIRED']);
    });
    check('W-N7 heartbeat lost', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'host', scope: TENANT, timeoutMs: 600_000, heartbeatMs: 5000 });
        advance(10_000); h.progress(); advance(10_000);
        assert.deepEqual(o.scan(TENANT), [], 'exactly 2× the interval is tolerated');
        advance(1);
        expectWarning(o.scan(TENANT)[0], { ruleId: 'ASH_HEARTBEAT_MISSED', severity: 'medium', certainty: 'potential', evidence: { silentMs: 10_001, heartbeatMs: 5000 } });
    });
    check('W-N8 duplicate cancellation requests invoke the host callback at most once', () => {
        const { o, advance } = observer({ policy: { mode: 'enforce' } });
        let cancels = 0;
        const h = o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 1000, ref: 'dup', cancel: () => cancels++ });
        h.requestCancellation(); h.requestCancellation();
        const first = o.list(TENANT)[0].cancellationRequestedAt;
        advance(500); h.requestCancellation();
        assert.equal(o.list(TENANT)[0].cancellationRequestedAt, first, 'first request time kept');
        assert.equal(o.cancel('dup', TENANT), true);
        assert.equal(o.cancel('dup', TENANT), false);
        advance(2000); o.scan(TENANT); o.scan(TENANT);
        assert.equal(cancels, 1);
    });
    check('W-N9 late completion after timeout clears the deadline warning but keeps the record honest', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'late' });
        advance(1500);
        assert.deepEqual(o.scan(TENANT).map((w) => w.ruleId), ['ASH_DEADLINE_EXCEEDED']);
        h.complete('completed'); h.cleanup(true);
        assert.deepEqual(o.scan(TENANT), []);
        const record = o.history(TENANT)[0];
        assert.ok(record.completedAt > record.deadlineAt, 'completion after the deadline stays visible in history');
    });
    check('W-N10 cleanup acknowledgment never received', () => {
        const { o, advance } = observer();
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, ref: 'leaky' }).complete('completed');
        advance(1001);
        const scan = o.scan(TENANT);
        assert.equal(scan.length, 1);
        expectWarning(scan[0], { ruleId: 'ASH_CLEANUP_UNACKNOWLEDGED', severity: 'medium', certainty: 'potential', evidence: { sinceCompletionMs: 1001 } });
    });
    check('W-N11 observer restart with stale state: old handles are inert, new observer starts clean', () => {
        const first = observer();
        const stale = first.o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 1000 });
        first.o.dispose();
        stale.progress(); stale.complete('completed'); stale.cleanup(true);
        assert.equal(stale.renewLease(1000), false);
        assert.deepEqual(first.o.status(), { tracked: 0, history: 0, untracked: 0, droppedHistory: 0 });
        const second = observer();
        second.o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: 1000 });
        // A handle from the old observer cannot adopt the new observer's operation of the same generated ref.
        assert.throws(() => second.o.begin({ kind: 'action', scope: TENANT, timeoutMs: 100, parent: stale }), (e) => e.code === 'invalid-input');
        second.advance(5000);
        assert.deepEqual(second.o.scan(TENANT).map((w) => w.ruleId), ['ASH_DEADLINE_EXCEEDED']);
    });
    check('W-N12 cross-tenant operation references are invisible and inoperable', () => {
        const { o, advance } = observer();
        let cancels = 0;
        const a = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'tenant-job', cancel: () => cancels++ });
        advance(2000);
        assert.deepEqual(o.scan(OTHER), []);
        assert.deepEqual(o.list(OTHER), []);
        assert.deepEqual(o.history(OTHER), []);
        assert.equal(o.cancel('tenant-job', OTHER), false);
        assert.throws(() => o.begin({ kind: 'action', scope: OTHER, timeoutMs: 100, parent: a }), (e) => e.code === 'invalid-input');
        assert.equal(cancels, 0);
        assert.equal(o.scan(TENANT).length, 1);
    });
    todo('H04B-01', 'W-N12b a ref used by one tenant does not fail or reveal anything to another tenant', () => {
        const { o } = observer();
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'job-42' });
        assert.doesNotThrow(() => o.begin({ kind: 'tool', scope: OTHER, timeoutMs: 1000, ref: 'job-42' }));
    });
    check('W-N13 operation that exceeds its configured deadline', () => {
        const { o, advance } = observer();
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, ref: 'slow' });
        advance(1000);
        assert.deepEqual(o.scan(TENANT), [], 'at the deadline');
        advance(250);
        const [w] = o.scan(TENANT);
        expectWarning(w, { ruleId: 'ASH_DEADLINE_EXCEEDED', severity: 'high', certainty: 'confirmed', disposition: 'reported', evidence: { overdueMs: 250 } });
    });

    /* ================================================== Ashwatthama positive fixtures */
    check('W-P1..P8 legitimate long-running work is never classified as a zombie', () => {
        const hour = 3_600_000;
        // Host-approved deadline cap of one hour; the two-hour job carries its own approval reference.
        const { o, advance } = observer({ acknowledgementWindowMs: 120_000, maxDeadlineMs: hour });
        assert.throws(() => o.begin({ kind: 'host', scope: TENANT, timeoutMs: 2 * hour }), (e) => e.code === 'invalid-input', 'unapproved overlong deadline');
        const approved = o.begin({ kind: 'host', scope: TENANT, timeoutMs: 2 * hour, approvedLongRunning: { maxDurationMs: 2 * hour, approvalRef: 'chg-1' }, ref: 'approved' });
        const beating = o.begin({ kind: 'host', scope: TENANT, timeoutMs: hour, heartbeatMs: 30_000, ref: 'beating' });
        const leased = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: hour, leaseMs: 60_000, ref: 'leased' });
        const cooperative = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: hour, ref: 'cooperative' });
        const paused = o.begin({ kind: 'workflow', scope: TENANT, timeoutMs: hour, heartbeatMs: 10_000, ref: 'paused' });
        const audited = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: hour, ref: 'audited' });
        const concurrent = Array.from({ length: 20 }, (_, i) => o.begin({ kind: 'action', scope: TENANT, timeoutMs: hour, ref: `parallel-${i}` }));
        paused.pause();
        for (let minute = 1; minute <= 50; minute++) {
            advance(30_000); beating.progress(); leased.renewLease(60_000);
            advance(30_000); beating.progress(); leased.renewLease(60_000);
            concurrent.forEach((c) => c.progress());
            if (minute === 10) { cooperative.requestCancellation(); advance(500); cooperative.complete('cancelled'); cooperative.cleanup(true); }
            if (minute === 20) audited.complete('completed'); // audit/cleanup delivered later, inside its window
            if (minute === 21) audited.cleanup(true);
            assert.deepEqual(o.scan(TENANT), [], `minute ${minute}`);
        }
        paused.resume();
        for (const h of [approved, beating, leased, paused, ...concurrent]) { h.complete('completed'); h.cleanup(true); }
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(o.status().tracked, 0);
    });

    /* ================================================== policy behavior */
    check('Policy: disabled, warn and enforce for the preflight; repeated evaluation is deterministic', () => {
        const unsafe = [{ ...READ, cancellation: 'ignored', cleanup: 'none' }];
        assert.deepEqual(ids(pre({ profiles: unsafe, policy: { mode: 'disabled' } })), []);
        const input = { profiles: unsafe, policy: { mode: 'enforce' }, plan: plan(action('a'), action('b')) };
        const first = pre(input), second = pre(input);
        assert.deepEqual(first, second, 'same plan, same report');
        assert.deepEqual(first.warnings.map((w) => [w.ruleId, w.subject.index, w.disposition]), [['ABH_NO_EXIT_PATH', 0, 'blocked'], ['ABH_NO_EXIT_PATH', 1, 'blocked']]);
        unique(first.warnings);
        assert.equal(pre({ ...input, policy: { mode: 'warn' } }).decision, 'allow');
        // High-impact host rules extend the defaults; uncertain findings block only on request.
        const { cleanup, ...noCleanup } = READ;
        assert.equal(pre({ profiles: [noCleanup], policy: { mode: 'enforce', enforceRules: ['ABH_MISSING_CLEANUP'] }, requireDeclarations: false }).decision, 'allow');
        assert.equal(pre({ profiles: [noCleanup], policy: { mode: 'enforce', enforceRules: ['ABH_MISSING_CLEANUP'], blockUncertain: true }, requireDeclarations: false }).decision, 'block');
    });
    check('Policy: invalid and conflicting configuration is rejected', () => {
        for (const policy of [
            { mode: 'strict' }, { mode: 'enforce', enforceRules: 'ABH_NO_EXIT_PATH' }, { mode: 'enforce', enforceRules: ['constructor'] },
            { mode: 'enforce', enforceRules: ['__proto__'] }, { mode: 'enforce', enforceRules: ['ASH_CANCEL_STUCK'] },
            { mode: 'enforce', enforceRules: [() => 'ABH_NO_EXIT_PATH'] }, { mode: 'enforce', relaxRules: ['ABH_MISSING_CLEANUP'] },
            { mode: 'enforce', enforceRules: ['ABH_NO_EXIT_PATH'], relaxRules: ['ABH_NO_EXIT_PATH'] }, { mode: 'enforce', blockUncertain: 'yes' },
            { mode: 'enforce', extra: true },
        ])
            assert.throws(() => pre({ policy }), (e) => e instanceof api.WorkflowSafetyError && e.code === 'invalid-policy', JSON.stringify(policy));
        assert.throws(() => api.createAshwatthamaObserver({ policy: { mode: 'enforce', enforceRules: ['ABH_NO_EXIT_PATH'] } }), (e) => e.code === 'invalid-policy');
    });
    check('Policy: warning callbacks are deduplicated per operation and rule; scans stay unique', () => {
        const seen = [];
        const { o, advance } = observer({ onWarning: (w) => seen.push(`${w.subject.ref}:${w.ruleId}`) });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, leaseMs: 500, ref: 'x' });
        advance(2000);
        for (let i = 0; i < 5; i++) unique(o.scan(TENANT));
        assert.deepEqual(seen, ['x:ASH_LEASE_EXPIRED', 'x:ASH_DEADLINE_EXCEEDED']);
    });
    check('Policy: enforce-mode observer cancels only for enforced rules and never for other tenants', () => {
        const { o, advance } = observer({ policy: { mode: 'enforce' } });
        let mine = 0, theirs = 0, heartbeat = 0;
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, cancel: () => mine++ });
        o.begin({ kind: 'tool', scope: OTHER, timeoutMs: 1000, cancel: () => theirs++ });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 600_000, heartbeatMs: 100, cancel: () => heartbeat++ });
        advance(2000);
        const scan = o.scan(TENANT);
        assert.deepEqual(scan.map((w) => [w.ruleId, w.disposition]), [['ASH_DEADLINE_EXCEEDED', 'cancellation-requested'], ['ASH_HEARTBEAT_MISSED', 'reported']]);
        assert.deepEqual([mine, theirs, heartbeat], [1, 0, 0]);
    });
    todo('M5', 'Policy: a disabled observer reports nothing', () => {
        const { o, advance } = observer({ policy: { mode: 'disabled' } });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        advance(5000);
        assert.deepEqual(o.scan(TENANT), []);
    });

    /* ================================================== data and resource security */
    check('Data: oversized and deeply nested plans fail closed as invalid plans', () => {
        const big = plan(...Array.from({ length: 101 }, (_, i) => action(`a${i}`)));
        assert.deepEqual(ids(pre({ plan: big, options: { allowedCapabilities: ['read'], maxSteps: 100 } })), ['ABH_INVALID_PLAN']);
        const bytes = plan(action('a', 'read', { source: 'literal', data: 'x'.repeat(5000) }));
        assert.deepEqual(ids(pre({ plan: bytes, maxPlanBytes: 1024 })), ['ABH_INVALID_PLAN']);
        let nested = 'leaf';
        for (let i = 0; i < 40; i++) nested = { n: nested };
        assert.deepEqual(ids(pre({ plan: plan(action('a', 'read', { source: 'literal', data: nested })) })), ['ABH_INVALID_PLAN']);
        const cyclic = { actions: [] };
        cyclic.actions.push({ id: 'a', capability: 'read', input: { source: 'literal', data: cyclic } });
        assert.deepEqual(ids(pre({ plan: cyclic })), ['ABH_INVALID_PLAN']);
    });
    check('Data: malicious or model-generated metadata is rejected, never executed', () => {
        let invoked = 0;
        const callback = () => { invoked++; return 'x'; };
        const reject = (profiles, code = 'invalid-declaration') => assert.throws(() => pre({ profiles }), (e) => e instanceof api.WorkflowSafetyError && e.code === code);
        reject([JSON.parse('{"capability":"read","sideEffect":"protected","__proto__":{"cleanup":"verified"}}')]);
        reject([{ ...READ, constructor: 'x' }]);
        reject([{ ...READ, cleanup: { ...verified, toJSON: callback } }]);
        reject([{ ...READ, cleanup: callback }]);
        reject([{ ...READ, capability: 'read; rm -rf /' }]);
        reject([{ ...READ, capability: 'x'.repeat(129) }]);
        reject([{ ...READ, maxDurationMs: Infinity }]);
        reject([{ ...READ, maxDurationMs: NaN }]);
        reject([{ ...READ, retries: { max: -1 } }]);
        reject([Object.defineProperty({ ...READ }, 'effect', { get: callback, enumerable: true })]);
        reject(Array.from({ length: 257 }, (_, i) => ({ ...READ, capability: `c${i}` })));
        assert.throws(() => pre({ deadlineMs: NaN }), (e) => e.code === 'invalid-input');
        assert.throws(() => pre({ deadlineMs: -1 }), (e) => e.code === 'invalid-input');
        assert.throws(() => pre({ now: 'Date.now' }), (e) => e.code === 'invalid-input');
        assert.equal(invoked, 0, 'no metadata callback was invoked');
        // A clock that returns garbage yields no timestamp rather than a fabricated one.
        assert.equal(pre({ now: () => NaN }).evaluatedAt, null);
    });
    check('Data: malformed warnings, unknown rules and executable evidence are rejected', () => {
        const valid = pre({ profiles: [{ ...READ, cleanup: 'none' }] }).warnings[0];
        const copy = () => JSON.parse(JSON.stringify(valid));
        const bad = (patch) => assert.throws(() => api.validateSafetyWarning({ ...copy(), ...patch }), (e) => e.code === 'invalid-warning');
        for (const ruleId of ['ABH_NOPE', 'constructor', '__proto__', 'toString', '']) bad({ ruleId });
        bad({ evidence: { run: () => 1 } });
        bad({ evidence: { n: NaN } });
        bad({ evidence: { n: Infinity } });
        bad({ evidence: { secret: 'Bearer abc.def' } });
        bad({ evidence: { deep: { a: { b: 1 } } } });
        bad({ timestamp: 'now' });
        bad({ timestamp: NaN });
        bad({ certainty: 'definitely' });
        bad({ subject: { kind: 'process', ref: 'pid-1', index: null } });
        assert.throws(() => api.validateSafetyWarning(null), (e) => e.code === 'invalid-warning');
        assert.throws(() => api.validateSafetyWarning([valid]), (e) => e.code === 'invalid-warning');
    });
    check('Data: very large operation collections stay bounded', () => {
        const { o, advance } = observer({ maxOperations: 4096, maxHistory: 16, maxWarnings: 256 });
        for (let i = 0; i < 5000; i++) o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        assert.deepEqual([o.status().tracked, o.status().untracked], [4096, 904]);
        advance(2000);
        const scan = o.scan(TENANT);
        assert.equal(scan.length, 256);
        unique(scan);
        assert.throws(() => api.createAshwatthamaObserver({ maxOperations: 4097 }), (e) => e.code === 'invalid-input');
        assert.throws(() => api.createAshwatthamaObserver({ maxWarnings: 257 }), (e) => e.code === 'invalid-input');
        o.dispose();
        assert.equal(o.status().tracked, 0);
    });
    todo('H04B-05', 'Data: a truncated scan still surfaces the tracking-limit signal', () => {
        const { o, advance } = observer({ maxOperations: 10, maxWarnings: 10 });
        for (let i = 0; i < 12; i++) o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000 });
        advance(2000);
        assert.ok(o.scan(TENANT).some((w) => w.ruleId === 'ASH_TRACKING_LIMIT'));
    });
    check('Data: invalid timestamps and non-finite values in the observer', () => {
        let value = 0;
        const o = api.createAshwatthamaObserver({ now: () => value });
        for (const timeoutMs of [Infinity, NaN, -1, 0, 1.5, '1000'])
            assert.throws(() => o.begin({ kind: 'tool', scope: TENANT, timeoutMs }), (e) => e.code === 'invalid-input', String(timeoutMs));
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 1000, leaseMs: 100 });
        value = NaN;
        assert.throws(() => o.scan(TENANT), (e) => e.code === 'invalid-input', 'a broken clock fails loudly, not silently');
        assert.throws(() => h.progress(), (e) => e.code === 'invalid-input');
        value = 50;
        assert.throws(() => h.renewLease(Infinity), (e) => e.code === 'invalid-input');
        assert.equal(o.list(TENANT)[0].leaseExpiresAt, 100, 'a rejected renewal changes nothing');
    });
    check('Data: scope spoofing and secret-like metadata are refused', () => {
        const { o } = observer();
        const getter = { kind: 'company', get id() { throw new Error('accessor invoked'); } };
        for (const scope of [getter, { kind: 'admin', id: 'root' }, { kind: 'company', id: 'a b' }, { kind: 'company', id: 'tenant', role: 'owner' }, 'company:tenant', null])
            assert.throws(() => o.begin({ kind: 'tool', scope, timeoutMs: 100 }), (e) => e.code === 'invalid-input');
        for (const ref of ['Bearer abc', 'password=hunter2', 'a/b', ''])
            assert.throws(() => o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100, ref }), (e) => e.code === 'invalid-input');
        assert.throws(() => o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100, payload: { token: 'x' } }), (e) => e.code === 'invalid-input');
        assert.throws(() => o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100, cancel: 'kill -9 1' }), (e) => e.code === 'invalid-input');
        assert.equal(o.status().tracked, 0);
        // Records hold only the documented nonsecret fields.
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100 });
        assert.deepEqual(Object.keys(o.list(TENANT)[0]).sort(), ['cancellationRequestedAt', 'cleanupAcknowledgedAt', 'cleanupFailures', 'completedAt', 'completionStatus', 'deadlineAt', 'kind', 'lastProgressAt', 'leaseExpiresAt', 'leaseStatus', 'parentRef', 'paused', 'ref', 'scope', 'startedAt']);
    });

    /* ================================================== race conditions */
    check('Race: completion vs cancellation (cancellation first, cooperative)', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000 });
        h.requestCancellation(); advance(200); h.complete('cancelled'); h.cleanup(true);
        advance(5000);
        assert.deepEqual(o.scan(TENANT), []);
        assert.equal(o.history(TENANT)[0].completionStatus, 'cancelled');
    });
    todo('H04B-04', 'Race: a cancellation requested after completion is not reported as stuck cancellation', () => {
        const { o, advance } = observer();
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000 });
        h.complete('completed'); h.requestCancellation();
        advance(2000);
        assert.deepEqual(o.scan(TENANT).map((w) => w.ruleId), ['ASH_CLEANUP_UNACKNOWLEDGED']);
    });
    check('Race: lease expiration vs renewal at the exact boundary', () => {
        const { o, advance } = observer();
        const onTime = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, leaseMs: 1000, ref: 'on-time' });
        const late = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, leaseMs: 1000, ref: 'late' });
        advance(1000);
        assert.equal(onTime.renewLease(1000), true, 'renewal at the expiry instant is valid');
        advance(1);
        assert.equal(late.renewLease(1000), false);
        assert.deepEqual(o.scan(TENANT).map((w) => [w.subject.ref, w.ruleId]), [['late', 'ASH_LEASE_EXPIRED']]);
    });
    check('Race: observer disposed from inside its own warning callback', () => {
        let o;
        const local = observer({ onWarning: () => o.dispose() });
        o = local.o;
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100 });
        o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 100 });
        local.advance(500);
        assert.doesNotThrow(() => o.scan(TENANT));
        assert.deepEqual(o.scan(TENANT), []);
        h.complete('completed'); h.cleanup(true);
        assert.deepEqual(o.status(), { tracked: 0, history: 0, untracked: 0, droppedHistory: 0 });
    });
    check('Race: duplicate terminal events and late progress after completion are ignored', () => {
        const { o, advance } = observer({ acknowledgementWindowMs: 10_000 });
        const h = o.begin({ kind: 'tool', scope: TENANT, timeoutMs: 60_000, leaseMs: 5000, ref: 'once' });
        advance(100); h.complete('completed');
        const after = o.list(TENANT)[0];
        advance(100); h.complete('failed'); h.progress();
        assert.equal(h.renewLease(5000), false);
        const record = o.list(TENANT)[0];
        assert.deepEqual([record.completionStatus, record.completedAt, record.lastProgressAt, record.leaseExpiresAt], [after.completionStatus, after.completedAt, after.lastProgressAt, after.leaseExpiresAt]);
        h.cleanup(true); advance(100); h.cleanup(true); h.cleanup(false);
        const final = o.history(TENANT)[0];
        assert.equal(final.cleanupAcknowledgedAt, 10_200);
        assert.equal(final.cleanupFailures, 0);
    });

    /* ================================================== engine-level races and non-interference */
    check('Race (engine): timeout and cleanup racing leaves no stuck warnings once the tool settles', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t, cancellationWindowMs: 1000 });
        const host = await engineHost(api, { safety: { lifecycle: life }, limits: { timeoutMs: 40 },
            execute: (_i, ctx) => new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve(1), { once: true })) });
        const result = await host.start(plan(action('a'))).result;
        assert.equal(result.status, 'failed');
        await settle();
        clock.t += 5000;
        assert.deepEqual(life.scan(TENANT), []);
        assert.deepEqual(life.history(TENANT).map((r) => [r.kind, r.cleanupAcknowledgedAt !== null]).sort(), [['action', true], ['workflow', true]]);
    });
    check('Race (engine): resume after permission revocation is denied and fully released', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t });
        const host = await engineHost(api, { safety: { lifecycle: life } });
        const run = host.start(plan(action('a')));
        assert.equal((await run.pause()).status, 'paused');
        assert.equal(life.list(TENANT)[0].paused, true);
        host.provider.valid = false;
        run.resume();
        const result = await run.result;
        assert.equal(result.status, 'denied');
        assert.equal(host.calls.tool, 0);
        await settle(); clock.t += 60_000;
        assert.deepEqual(life.scan(TENANT), []);
        assert.equal(life.history(TENANT)[0].completionStatus, 'denied');
    });
    check('Race (engine): host shutdown during observation', async () => {
        const clock = { t: 0 };
        const life = api.createAshwatthamaObserver({ now: () => clock.t });
        const entered = deferred();
        const host = await engineHost(api, { safety: { lifecycle: life }, execute: (_i, ctx) => { entered.resolve(); return new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve(1), { once: true })); } });
        const run = host.start(plan(action('a')));
        await entered.promise;
        host.engine.dispose();
        assert.equal((await run.result).status, 'cancelled');
        await settle();
        assert.equal(life.status().tracked, 0);
        // Disposing the observer mid-run never affects the engine.
        const other = api.createAshwatthamaObserver({ now: () => clock.t });
        const second = await engineHost(api, { safety: { lifecycle: other } });
        const running = second.start(plan(action('a'), action('b')));
        other.dispose();
        assert.equal((await running.result).status, 'completed');
    });
    check('Non-interference: safety checks cannot grant, escalate, relabel tenants or bypass protected execution', async () => {
        const life = api.createAshwatthamaObserver({ now: () => 0, policy: { mode: 'enforce' } });
        const safety = { preflight: { profiles: [READ], policy: { mode: 'enforce', relaxRules: ['ABH_NO_EXIT_PATH', 'ABH_UNREACHABLE_COMPLETION'] } }, lifecycle: life };
        const host = await engineHost(api, { safety, firewall: true });
        const before = host.fingerprint();
        // 1. A passing (even relaxed) preflight still needs Vijay approval and the tool grant.
        const ok = host.start(plan(action('a')));
        assert.equal((await ok.result).status, 'completed');
        assert.equal(host.calls.approvals, 1);
        await settle();
        const ungranted = await host.start(plan(action('a')), {}, { grants: [] }).result;
        assert.equal(ungranted.status, 'denied');
        await settle();
        // 2. Firewall lockdown still wins over an allowing preflight and an enforcing observer.
        await host.lockdown();
        const locked = await host.start(plan(action('a'))).result;
        assert.notEqual(locked.status, 'completed');
        assert.equal(host.calls.tool, 1, 'only the first, authorized run executed the tool');
        // 3. Nothing the checks did changed authority, tenant, registrations or firewall state.
        assert.deepEqual(host.fingerprint(), { ...before, firewall: { ...before.firewall, mode: 'lockdown', version: before.firewall.version + 1 } });
        assert.deepEqual(life.list(OTHER), []);
        // 4. The observer and preflight expose no process, permission or model-registry operations.
        assert.deepEqual(Object.keys(life).sort(), ['begin', 'cancel', 'dispose', 'history', 'list', 'scan', 'status']);
        assert.ok(!('grant' in ok.preflight) && !('permissions' in ok.preflight));
    });
    check('Non-interference: safety sources import no process control, network, firewall admin or SARASWATI registry', () => {
        for (const file of ['schema.ts', 'abhimanyu.ts', 'ashwatthama.ts', 'index.ts']) {
            const source = readFileSync(new URL(`../src/workflows/safety/${file}`, import.meta.url), 'utf8');
            for (const forbidden of [/child_process/, /process\.(kill|exit)/, /\bfetch\(/, /node:net|node:http|node:tls/, /learning\//, /firewall\/(management|runtime)/, /createShivaxFirewall/, /\.admin\./, /PermissionPolicyRegistry/, /setInterval|setTimeout/])
                assert.ok(!forbidden.test(source), `${file} must not match ${forbidden}`);
        }
    });
}

/** Fake host: Jay with a revocable mock provider, Vijay with approval, optional NARASIMHA firewall, one workflow tool. */
async function engineHost(api, { safety, execute = (input) => input, parallelSafe = false, firewall = false, limits, extraPure = false } = {}) {
    const calls = { tool: 0, approvals: 0 };
    const tools = new api.ToolRegistry().register({
        id: 'fixture.read', capability: 'read', effect: 'read-only', parallelSafe,
        validateInput: () => true, validateOutput: () => true,
        execute: (input, context) => { calls.tool++; return execute(input, context); },
    });
    if (extraPure)
        tools.register({ id: 'fixture.pure', capability: 'pure', effect: 'read-only', parallelSafe, validateInput: () => true, validateOutput: () => true, execute: (input) => input });
    const provider = createMockIdentityProvider({ principal: { id: 'user', issuer: 'host', permissions: ['work', 'admin'] },
        session: { id: 'session', principalId: 'user', issuedAt: 1000, expiresAt: 10_000_000, scope: TENANT } });
    const jay = new api.Jay(provider, { now: () => 2000 });
    const policies = new api.PermissionPolicyRegistry()
        .register({ kind: 'capability', id: 'workflow', effect: 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'capability', id: 'read', effect: 'read-only', permissions: ['work'], validateInput: () => true })
        .register({ kind: 'tool', id: 'fixture.read', effect: 'read-only', permissions: ['work'], requiresApproval: true, validateInput: () => true })
        .register({ kind: 'capability', id: 'admin', effect: 'state-changing', permissions: ['admin'], validateInput: () => true });
    if (extraPure)
        policies
            .register({ kind: 'capability', id: 'pure', effect: 'read-only', permissions: ['work'], validateInput: () => true })
            .register({ kind: 'tool', id: 'fixture.pure', effect: 'read-only', permissions: ['work'], validateInput: () => true });
    const security = new api.Vijay(jay, policies, { tools: tools.protectedTools,
        approve: (request) => { if (request.actionId === 'admin') return true; calls.approvals++; return true; } });
    let fw;
    if (firewall) {
        const files = { read: [], write: [] };
        const operations = [
            { id: 'task', kind: 'workflow', capability: 'workflow', effect: 'read-only', files, networkOrigins: [], check: () => true, execute() { throw new Error('descriptor only'); } },
            { id: 'tool', kind: 'tool', capability: 'read', toolId: 'fixture.read', effect: 'read-only', files, networkOrigins: [], check: () => true },
        ];
        fw = api.createShivaxFirewall({ jay, security, realm: { issuer: 'host', scope: TENANT }, operations, adminCapability: 'admin', authorizeAdmin: () => true, protectExecution: true,
            policy: { mode: 'enforce', rules: [{ id: 'allow', decision: 'allow', operationIds: ['task', 'tool'] }], capabilities: ['workflow', 'read'], bots: [], providers: { ids: [], localities: [] }, files, network: { origins: [] }, audit: { required: false },
                limits: { maxConcurrent: 4, maxOperations: 500, maxTokens: 0, maxCostUSD: 0, timeoutMs: 5000, maxInputBytes: 65536, maxOutputBytes: 65536 } } });
    }
    const engine = new api.RudraWorkflowEngine(tools, security, safety);
    const context = (overrides = {}) => jay.createContext({ id: overrides.id ?? 'task', input: { capability: 'workflow', data: 2 } },
        { signal: new AbortController().signal, toolPermissions: overrides.grants ?? ['fixture.read', ...(extraPure ? ['fixture.pure'] : [])], limits: { timeoutMs: 2000, ...limits } });
    const ctx = await context();
    const contexts = new Map();
    return {
        engine, provider, calls,
        start(p, options = {}, overrides) {
            if (overrides) {
                // Synchronous start contract: resolve the alternate context first.
                const pending = context(overrides).then((c) => engine.start(c, p, { allowedCapabilities: ['read'], ...options }));
                return { result: pending.then((run) => run.result), preflight: undefined };
            }
            return engine.start(ctx, p, { allowedCapabilities: ['read'], ...options });
        },
        lockdown: async () => fw.admin.lockdown(await context({ id: 'admin-op' }), fw.runtime.snapshot().version),
        fingerprint: () => JSON.parse(JSON.stringify({
            permissions: provider.identity.principal.permissions,
            scope: provider.identity.session.scope,
            grants: ctx.security.toolPermissions,
            policies: policies.list().map((p) => [p.kind, p.id, p.effect, p.permissions, p.requiresApproval ?? false]),
            tools: tools.list().map((t) => [t.id, t.capability, t.effect]),
            firewall: fw ? { mode: fw.runtime.status().mode, version: fw.runtime.snapshot().version } : null,
        })),
        contexts,
    };
}
