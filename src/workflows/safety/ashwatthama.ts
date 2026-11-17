/**
 * Ashwatthama: optional lifecycle observer for authorized operations that may never terminate.
 *
 * Records hold only bounded, nonsecret metadata (generated or host identifiers, tenant scope, timestamps,
 * status). No timers run: the host calls `scan()` with an injectable clock. The observer never kills
 * processes, aborts requests itself, changes firewall rules or authority, or reads another tenant's records.
 * In enforce mode it can only invoke the cooperative `cancel` callback the host registered for that
 * operation (for example `WorkflowRun.cancel`), at most once.
 */
import {
    SAFETY_LIMITS,
    count,
    fail,
    isRef,
    plain,
    resolvePolicy,
    warning,
    type AshwatthamaRuleId,
    type SafetyCertainty,
    type SafetyPolicy,
    type SafetyWarning,
} from './schema.js';

export interface LifecycleScope {
    readonly kind: 'company' | 'personal';
    readonly id: string;
}
export type LifecycleCompletion = 'completed' | 'failed' | 'cancelled' | 'denied';
export interface LifecycleOperationStart {
    readonly kind: 'workflow' | 'action' | 'tool' | 'host';
    readonly scope: LifecycleScope;
    /** Relative deadline. Above `maxDeadlineMs` it requires `approvedLongRunning`. */
    readonly timeoutMs: number;
    /** Optional renewable lease, never extended past the deadline. */
    readonly leaseMs?: number;
    /** Declares heartbeats: silence longer than twice this interval is reported. */
    readonly heartbeatMs?: number;
    /** Cooperative cancellation window for this operation (default from the observer). */
    readonly cancellationWindowMs?: number;
    /** `required` (default): a cleanup acknowledgement is expected after completion. */
    readonly cleanup?: 'required' | 'none';
    readonly approvedLongRunning?: { readonly maxDurationMs: number; readonly approvalRef: string };
    readonly parent?: LifecycleOperationHandle;
    /** Host identifier (nonsecret). Default: generated `op-<n>`. */
    readonly ref?: string;
    /** Existing authorized cooperative cancellation, e.g. `WorkflowRun.cancel`. */
    readonly cancel?: () => void;
}
export interface LifecycleOperationHandle {
    readonly ref: string;
    progress(): void;
    /** Returns false when the lease already expired, was released, or the operation ended. */
    renewLease(leaseMs: number): boolean;
    pause(): void;
    resume(): void;
    requestCancellation(): void;
    complete(status: LifecycleCompletion): void;
    cleanup(ok: boolean): void;
}
export interface LifecycleRecord {
    readonly ref: string;
    readonly kind: LifecycleOperationStart['kind'];
    readonly scope: LifecycleScope;
    readonly parentRef: string | null;
    readonly leaseStatus: 'none' | 'active' | 'expired' | 'released';
    readonly startedAt: number;
    readonly deadlineAt: number;
    readonly leaseExpiresAt: number | null;
    readonly lastProgressAt: number;
    readonly paused: boolean;
    readonly cancellationRequestedAt: number | null;
    readonly completedAt: number | null;
    readonly completionStatus: LifecycleCompletion | null;
    readonly cleanupAcknowledgedAt: number | null;
    readonly cleanupFailures: number;
}
export interface AshwatthamaOptions {
    readonly now?: () => number;
    readonly policy?: SafetyPolicy;
    readonly maxOperations?: number;
    readonly maxHistory?: number;
    readonly maxWarnings?: number;
    readonly cancellationWindowMs?: number;
    readonly acknowledgementWindowMs?: number;
    readonly orphanWindowMs?: number;
    readonly maxCleanupFailures?: number;
    readonly maxDeadlineMs?: number;
    /** Isolated observer: notified once per operation and rule. Cannot affect execution. */
    readonly onWarning?: (warning: SafetyWarning) => void;
}
export interface AshwatthamaStatus {
    readonly tracked: number;
    readonly history: number;
    readonly untracked: number;
    readonly droppedHistory: number;
}
export interface AshwatthamaObserver {
    begin(start: LifecycleOperationStart): LifecycleOperationHandle;
    /** Evaluates one tenant's operations at the injected clock. Enforce mode may request cooperative cancellation. */
    scan(scope: LifecycleScope): readonly SafetyWarning[];
    list(scope: LifecycleScope): readonly LifecycleRecord[];
    history(scope: LifecycleScope): readonly LifecycleRecord[];
    /** Requests the operation's registered cooperative cancellation. Same tenant only. */
    cancel(ref: string, scope: LifecycleScope): boolean;
    status(): AshwatthamaStatus;
    /** Drops all records and callbacks; later handle calls are ignored. */
    dispose(): void;
}

export const ASHWATTHAMA_DEFAULT_ENFORCED: readonly AshwatthamaRuleId[] = Object.freeze(['ASH_DEADLINE_EXCEEDED', 'ASH_LEASE_EXPIRED']);
const observers = new WeakSet<object>();
/** True only for observers created by `createAshwatthamaObserver` in this module instance. */
export const isAshwatthamaObserver = (value: unknown): value is AshwatthamaObserver =>
    !!value && typeof value === 'object' && observers.has(value);

interface State {
    ref: string;
    kind: LifecycleOperationStart['kind'];
    scope: LifecycleScope;
    scopeKey: string;
    parent: State | null;
    startedAt: number;
    deadlineAt: number;
    leaseMs: number | null;
    leaseExpiresAt: number | null;
    released: boolean;
    heartbeatMs: number | null;
    windowMs: number;
    cleanupRequired: boolean;
    lastProgressAt: number;
    paused: boolean;
    cancellationRequestedAt: number | null;
    completedAt: number | null;
    completionStatus: LifecycleCompletion | null;
    cleanupAcknowledgedAt: number | null;
    cleanupFailures: number;
    cancel?: () => void;
    notified: Set<AshwatthamaRuleId>;
}

function scopeOf(raw: unknown): LifecycleScope {
    const s = plain(raw, ['kind', 'id'], 'invalid-input');
    if ((s.kind !== 'company' && s.kind !== 'personal') || !isRef(s.id)) fail('invalid-input');
    return Object.freeze({ kind: s.kind as LifecycleScope['kind'], id: s.id as string });
}
const keyOf = (scope: LifecycleScope) => `${scope.kind}:${scope.id}`;

export function createAshwatthamaObserver(options: AshwatthamaOptions = {}): AshwatthamaObserver {
    const o = plain(options, ['now', 'policy', 'maxOperations', 'maxHistory', 'maxWarnings', 'cancellationWindowMs', 'acknowledgementWindowMs', 'orphanWindowMs', 'maxCleanupFailures', 'maxDeadlineMs', 'onWarning'], 'invalid-input');
    if (o.now !== undefined && typeof o.now !== 'function') fail('invalid-input');
    if (o.onWarning !== undefined && typeof o.onWarning !== 'function') fail('invalid-input');
    const opt = (value: unknown, fallback: number, min: number, max: number) => (value === undefined ? fallback : count(value, min, max, 'invalid-input'));
    const maxOperations = opt(o.maxOperations, SAFETY_LIMITS.defaultMaxOperations, 1, SAFETY_LIMITS.maxOperations);
    const maxHistory = opt(o.maxHistory, SAFETY_LIMITS.defaultMaxHistory, 0, SAFETY_LIMITS.maxHistory);
    const maxWarnings = opt(o.maxWarnings, SAFETY_LIMITS.defaultMaxWarnings, 1, SAFETY_LIMITS.maxWarnings);
    const cancelWindow = opt(o.cancellationWindowMs, 5_000, 1, 600_000);
    const ackWindow = opt(o.acknowledgementWindowMs, 5_000, 1, 600_000);
    const orphanWindow = opt(o.orphanWindowMs, 5_000, 1, 600_000);
    const maxCleanupFailures = opt(o.maxCleanupFailures, 3, 1, 100);
    const maxDeadline = opt(o.maxDeadlineMs, SAFETY_LIMITS.defaultMaxDeadlineMs, 1, SAFETY_LIMITS.maxDeadlineMs);
    const policy = resolvePolicy(o.policy, 'ashwatthama', ASHWATTHAMA_DEFAULT_ENFORCED);
    const clock = (o.now as (() => number) | undefined) ?? Date.now;
    const onWarning = o.onWarning as AshwatthamaOptions['onWarning'];
    const now = () => {
        const t = clock();
        if (typeof t !== 'number' || !Number.isFinite(t)) fail('invalid-input');
        return t;
    };

    const active = new Map<string, State>();
    const history: State[] = [];
    const untrackedByScope = new Map<string, number>();
    let sequence = 0,
        untracked = 0,
        droppedHistory = 0,
        disposed = false;

    const inert: LifecycleOperationHandle = Object.freeze({
        ref: 'untracked',
        progress() {},
        renewLease: () => false,
        pause() {},
        resume() {},
        requestCancellation() {},
        complete() {},
        cleanup() {},
    });
    const settled = (s: State) => s.completedAt !== null && (!s.cleanupRequired || s.cleanupAcknowledgedAt !== null);
    const retire = (s: State) => {
        if (!settled(s) || !active.has(s.ref)) return;
        // Keep a parent while any tracked child still depends on it for orphan detection.
        for (const other of active.values()) if (other.parent === s && !settled(other)) return;
        active.delete(s.ref);
        s.cancel = undefined;
        if (maxHistory > 0) {
            history.push(s);
            if (history.length > maxHistory) {
                history.shift();
                droppedHistory++;
            }
        }
        if (s.parent) retire(s.parent);
    };
    const record = (s: State, at: number): LifecycleRecord =>
        Object.freeze({
            ref: s.ref,
            kind: s.kind,
            scope: s.scope,
            parentRef: s.parent?.ref ?? null,
            leaseStatus: s.leaseMs === null ? 'none' : s.released ? 'released' : s.completedAt === null && s.leaseExpiresAt !== null && at > s.leaseExpiresAt ? 'expired' : 'active',
            startedAt: s.startedAt,
            deadlineAt: s.deadlineAt,
            leaseExpiresAt: s.leaseExpiresAt,
            lastProgressAt: s.lastProgressAt,
            paused: s.paused,
            cancellationRequestedAt: s.cancellationRequestedAt,
            completedAt: s.completedAt,
            completionStatus: s.completionStatus,
            cleanupAcknowledgedAt: s.cleanupAcknowledgedAt,
            cleanupFailures: s.cleanupFailures,
        });
    const requestCancel = (s: State, at: number): boolean => {
        if (s.cancellationRequestedAt === null) s.cancellationRequestedAt = at;
        const cancel = s.cancel;
        s.cancel = undefined; // at most once
        if (!cancel) return false;
        try {
            cancel();
        } catch {
            /* Host cancellation failures are isolated; stuck-cancel detection still applies. */
        }
        return true;
    };

    const observer: AshwatthamaObserver = {
        begin(start) {
            if (disposed) return inert;
            const v = plain(start, ['kind', 'scope', 'timeoutMs', 'leaseMs', 'heartbeatMs', 'cancellationWindowMs', 'cleanup', 'approvedLongRunning', 'parent', 'ref', 'cancel'], 'invalid-input');
            if (!['workflow', 'action', 'tool', 'host'].includes(v.kind as string)) fail('invalid-input');
            const scope = scopeOf(v.scope);
            let limit = maxDeadline;
            if (v.approvedLongRunning !== undefined) {
                const a = plain(v.approvedLongRunning, ['maxDurationMs', 'approvalRef'], 'invalid-declaration');
                if (!isRef(a.approvalRef)) fail('invalid-declaration');
                limit = count(a.maxDurationMs, 1, SAFETY_LIMITS.maxDeadlineMs, 'invalid-declaration');
            }
            const timeoutMs = count(v.timeoutMs, 1, limit, v.approvedLongRunning === undefined ? 'invalid-input' : 'invalid-declaration');
            const leaseMs = v.leaseMs === undefined ? null : count(v.leaseMs, 1, timeoutMs, 'invalid-input');
            const heartbeatMs = v.heartbeatMs === undefined ? null : count(v.heartbeatMs, 1, timeoutMs, 'invalid-input');
            const windowMs = v.cancellationWindowMs === undefined ? cancelWindow : count(v.cancellationWindowMs, 1, 600_000, 'invalid-input');
            if (v.cleanup !== undefined && v.cleanup !== 'required' && v.cleanup !== 'none') fail('invalid-input');
            if (v.cancel !== undefined && typeof v.cancel !== 'function') fail('invalid-input');
            if (v.ref !== undefined && !isRef(v.ref)) fail('invalid-input');
            let parent: State | null = null;
            if (v.parent !== undefined) {
                parent = active.get((v.parent as LifecycleOperationHandle)?.ref) ?? null;
                if (!parent || handles.get(v.parent as object) !== parent || parent.scopeKey !== keyOf(scope)) fail('invalid-input');
            }
            const scopeKey = keyOf(scope);
            if (active.size >= maxOperations) {
                untracked++;
                untrackedByScope.set(scopeKey, (untrackedByScope.get(scopeKey) ?? 0) + 1);
                return inert;
            }
            const ref = (v.ref as string | undefined) ?? `op-${++sequence}`;
            if (active.has(ref)) fail('invalid-input');
            const at = now();
            const s: State = {
                ref, kind: v.kind as State['kind'], scope, scopeKey, parent,
                startedAt: at, deadlineAt: at + timeoutMs,
                leaseMs, leaseExpiresAt: leaseMs === null ? null : at + leaseMs, released: false,
                heartbeatMs, windowMs, cleanupRequired: v.cleanup !== 'none',
                lastProgressAt: at, paused: false, cancellationRequestedAt: null,
                completedAt: null, completionStatus: null, cleanupAcknowledgedAt: null, cleanupFailures: 0,
                ...(v.cancel ? { cancel: v.cancel as () => void } : {}),
                notified: new Set(),
            };
            active.set(ref, s);
            const live = () => !disposed && (active.get(ref) === s);
            const handle: LifecycleOperationHandle = Object.freeze({
                ref,
                progress() {
                    if (live() && s.completedAt === null) s.lastProgressAt = now();
                },
                renewLease(ms: number) {
                    if (!live() || s.leaseMs === null || s.released || s.completedAt !== null || s.cancellationRequestedAt !== null) return false;
                    const at = now();
                    if (s.leaseExpiresAt !== null && at > s.leaseExpiresAt) return false; // expired leases are not revived
                    s.leaseExpiresAt = Math.min(at + count(ms, 1, SAFETY_LIMITS.maxDeadlineMs, 'invalid-input'), s.deadlineAt);
                    s.lastProgressAt = at;
                    return true;
                },
                pause() {
                    if (live()) s.paused = true;
                },
                resume() {
                    if (live() && s.paused) {
                        s.paused = false;
                        s.lastProgressAt = now();
                    }
                },
                requestCancellation() {
                    if (live() && s.cancellationRequestedAt === null) s.cancellationRequestedAt = now();
                },
                complete(status: LifecycleCompletion) {
                    if (!live() || s.completedAt !== null || !['completed', 'failed', 'cancelled', 'denied'].includes(status)) return;
                    s.completedAt = now();
                    s.completionStatus = status;
                    retire(s);
                },
                cleanup(ok: boolean) {
                    if (!live() || s.cleanupAcknowledgedAt !== null) return;
                    if (ok === true) {
                        s.cleanupAcknowledgedAt = now();
                        s.released = true;
                        retire(s);
                    } else s.cleanupFailures = Math.min(s.cleanupFailures + 1, 1_000);
                },
            });
            handles.set(handle, s);
            return handle;
        },
        scan(rawScope) {
            const scope = scopeOf(rawScope);
            const key = keyOf(scope);
            if (disposed) return Object.freeze([]);
            const at = now();
            const out: SafetyWarning[] = [];
            const emit = (s: State, id: AshwatthamaRuleId, certainty: SafetyCertainty, evidence: Record<string, string | number | boolean | null>) => {
                if (out.length >= maxWarnings) return;
                let disposition: SafetyWarning['disposition'] = 'reported';
                if (policy.mode === 'enforce' && policy.enforce.has(id) && s.completedAt === null && requestCancel(s, at)) disposition = 'cancellation-requested';
                const w = warning(id, certainty, { kind: 'operation', ref: s.ref, index: null }, { kind: s.kind, ...evidence }, at, disposition);
                out.push(w);
                if (onWarning && !s.notified.has(id)) {
                    s.notified.add(id);
                    try {
                        onWarning(w);
                    } catch {
                        /* Observation cannot affect execution. */
                    }
                }
            };
            for (const s of active.values()) {
                if (s.scopeKey !== key) continue;
                const open = s.completedAt === null;
                if (open && s.leaseExpiresAt !== null && !s.released && at > s.leaseExpiresAt)
                    emit(s, 'ASH_LEASE_EXPIRED', 'confirmed', { overdueMs: at - s.leaseExpiresAt });
                if (open && at > s.deadlineAt) emit(s, 'ASH_DEADLINE_EXCEEDED', 'confirmed', { overdueMs: at - s.deadlineAt });
                if (open && !s.paused && s.cancellationRequestedAt === null && s.heartbeatMs !== null && at - s.lastProgressAt > 2 * s.heartbeatMs)
                    emit(s, 'ASH_HEARTBEAT_MISSED', 'potential', { silentMs: at - s.lastProgressAt, heartbeatMs: s.heartbeatMs });
                const unreleased = s.cleanupRequired && s.cleanupAcknowledgedAt === null;
                let stuck = false;
                if (s.cancellationRequestedAt !== null && at - s.cancellationRequestedAt > s.windowMs && (open || unreleased)) {
                    emit(s, 'ASH_CANCEL_STUCK', 'confirmed', { waitedMs: at - s.cancellationRequestedAt, windowMs: s.windowMs, completed: !open });
                    stuck = true;
                }
                if (s.parent && s.parent.completedAt !== null && at - s.parent.completedAt > orphanWindow && (open || unreleased))
                    emit(s, 'ASH_OPERATION_ORPHANED', 'confirmed', { parentRef: s.parent.ref, sinceParentMs: at - s.parent.completedAt });
                if (open && s.cleanupAcknowledgedAt !== null && at - s.cleanupAcknowledgedAt > ackWindow)
                    emit(s, 'ASH_COMPLETION_UNACKNOWLEDGED', 'confirmed', { releasedMs: at - s.cleanupAcknowledgedAt });
                if (!open && unreleased && !stuck && at - (s.completedAt as number) > ackWindow)
                    emit(s, 'ASH_CLEANUP_UNACKNOWLEDGED', 'potential', { sinceCompletionMs: at - (s.completedAt as number) });
                if (s.cleanupFailures >= maxCleanupFailures)
                    emit(s, 'ASH_CLEANUP_FAILED_REPEATEDLY', 'confirmed', { failures: s.cleanupFailures });
            }
            const skipped = untrackedByScope.get(key);
            if (skipped && out.length < maxWarnings) {
                out.push(warning('ASH_TRACKING_LIMIT', 'confirmed', { kind: 'workflow', ref: 'observer', index: null }, { untracked: skipped, maxOperations }, at, 'reported'));
                untrackedByScope.delete(key);
            }
            return Object.freeze(out);
        },
        list(rawScope) {
            const key = keyOf(scopeOf(rawScope));
            const at = disposed ? 0 : now();
            return Object.freeze([...active.values()].filter((s) => s.scopeKey === key).map((s) => record(s, at)));
        },
        history(rawScope) {
            const key = keyOf(scopeOf(rawScope));
            const at = disposed ? 0 : now();
            return Object.freeze(history.filter((s) => s.scopeKey === key).map((s) => record(s, at)));
        },
        cancel(ref, rawScope) {
            const key = keyOf(scopeOf(rawScope));
            const s = typeof ref === 'string' ? active.get(ref) : undefined;
            if (disposed || !s || s.scopeKey !== key || s.completedAt !== null) return false;
            return requestCancel(s, now());
        },
        status() {
            return Object.freeze({ tracked: active.size, history: history.length, untracked, droppedHistory });
        },
        dispose() {
            disposed = true;
            for (const s of active.values()) s.cancel = undefined;
            active.clear();
            history.length = 0;
            untrackedByScope.clear();
        },
    };
    const handles = new WeakMap<object, State>();
    observers.add(observer);
    return Object.freeze(observer);
}
