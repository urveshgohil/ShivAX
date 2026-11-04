import type { BotValue, TaskContext } from '../../agents/types.js';
import { snapshotValue } from '../../agents/validation.js';
import { ModelRouter } from '../../intelligence/router.js';
import { ModelProviderRegistry } from '../../intelligence/registry.js';
import { ModelError } from '../../intelligence/errors.js';
import { usageReport } from '../../intelligence/validation.js';
import { costUnits, costUSD } from '../../intelligence/cost.js';
import type { ModelResult } from '../../intelligence/types.js';
import { Jay } from '../jay.js';
import { Vijay } from '../vijay.js';
import { FirewallError, failure } from './errors.js';
import { operations, modelReservation } from './operations.js';
import { count, evaluate, id, object, policy, realm } from './policy.js';
import type {
    FirewallAuditEvent,
    FirewallErrorCode,
    FirewallExecutionContext,
    FirewallOperation,
    FirewallPolicy,
    FirewallPolicySnapshot,
    ShivaxFirewall,
    ShivaxFirewallOptions,
} from './types.js';

interface Active {
    readonly operation: FirewallOperation;
    readonly root: TaskContext;
    readonly input: BotValue;
    readonly epoch: number;
    readonly controller: AbortController;
    readonly deadline: number;
    readonly pending: Set<Promise<unknown>>;
    readonly context: FirewallExecutionContext;
    readonly reservation: { input: number; output: number; cost: bigint };
    authorization?: () => void;
    revoked?: FirewallErrorCode;
    open: boolean;
    checking: boolean;
}

/** Explicit managed boundary. Raw SDK instances and arbitrary host I/O remain host-owned. */
export function createShivaxFirewall(options: ShivaxFirewallOptions): ShivaxFirewall {
    let config: ShivaxFirewallOptions, registered: ReadonlyMap<string, FirewallOperation>;
    try {
        object(options, [
            'jay',
            'security',
            'realm',
            'policy',
            'operations',
            'adminCapability',
            'authorizeAdmin',
            'auditSink',
            'auditCapacity',
        ]);
        if (
            !(options.jay instanceof Jay) ||
            !(options.security instanceof Vijay) ||
            typeof options.authorizeAdmin !== 'function' ||
            (options.auditSink !== undefined && typeof options.auditSink !== 'function')
        )
            throw 0;
        id(options.adminCapability);
        count(options.auditCapacity ?? 256, 1, 4096);
        registered = operations(options.operations);
        config = Object.freeze({
            ...options,
            realm: realm(options.realm),
            authorizeAdmin: options.authorizeAdmin.bind(options),
            auditSink: options.auditSink?.bind(options),
        });
    } catch {
        throw new FirewallError('invalid-configuration');
    }
    const initial = policy(config.policy, registered);
    if (initial.mode !== 'enforce') throw new FirewallError('invalid-policy');
    let current: FirewallPolicySnapshot = Object.freeze({ version: 1, policy: initial });
    let epoch = 1,
        closed = false,
        updating = false,
        billingBlocked = false;
    let reservedOperations = 0,
        reservedTokens = 0,
        reservedCost = 0n;
    let sequence = 0,
        dropped = 0,
        observers = 0;
    const active = new Set<Active>();
    const history = new Map<number, FirewallPolicy>([[1, initial]]);
    const events: FirewallAuditEvent[] = [];
    const modelSlots = new Map<string, Active>();
    const routers = new Map<string, ModelRouter>();
    const clock =
        typeof globalThis.performance?.now === 'function'
            ? globalThis.performance.now.bind(globalThis.performance)
            : Date.now;

    const record = (
        kind: FirewallAuditEvent['kind'],
        operationId: string | null,
        decision: FirewallAuditEvent['decision'],
        reason: FirewallAuditEvent['reason']
    ): FirewallAuditEvent => {
        const event = Object.freeze({
            sequence: ++sequence,
            version: current.version,
            kind,
            operationId,
            decision,
            reason,
            mode: current.policy.mode,
        });
        events.push(event);
        if (events.length > (config.auditCapacity ?? 256)) {
            events.shift();
            dropped++;
        }
        return event;
    };
    const checkRoot = (root: TaskContext, signal: Active['controller']['signal']) => {
        const identity = config.jay.assertActive(root, signal);
        if (
            identity.principal.issuer !== config.realm.issuer ||
            identity.session.scope.kind !== config.realm.scope.kind ||
            identity.session.scope.id !== config.realm.scope.id
        )
            throw new FirewallError('unauthorized');
    };
    const revoke = (state: Active, reason: FirewallErrorCode) => {
        if (!state.revoked) {
            state.revoked = reason;
            record('cancellation', state.operation.id, 'deny', reason);
        }
        state.controller.abort(new FirewallError(state.revoked));
    };
    const fence = () => {
        epoch++;
        // Mark every lease before calling synchronous abort listeners.
        const affected = [...active];
        for (const state of affected) state.revoked ??= 'revoked';
        for (const state of affected) {
            record('cancellation', state.operation.id, 'deny', state.revoked!);
            state.controller.abort(new FirewallError(state.revoked!));
        }
    };
    const baseCheck = (state: Active) => {
        if (!state.open || state.epoch !== epoch || state.revoked)
            throw new FirewallError(state.revoked ?? 'revoked');
        if (closed) throw new FirewallError('policy-unavailable');
        if (state.controller.signal.aborted || state.root.signal.aborted)
            throw new FirewallError('cancelled');
        if (clock() >= state.deadline) {
            revoke(state, 'timeout');
            throw new FirewallError('timeout');
        }
        checkRoot(state.root, state.controller.signal);
        evaluate(current.policy, state.operation);
        if (
            reservedOperations > current.policy.limits.maxOperations ||
            reservedTokens > current.policy.limits.maxTokens ||
            reservedCost > costUnits(current.policy.limits.maxCostUSD) ||
            (state.operation.kind === 'model' && billingBlocked)
        )
            throw new FirewallError('resource-limit');
    };
    const checkpoint = (state: Active) => {
        baseCheck(state);
        state.authorization?.();
        if (state.checking) throw new FirewallError('denied');
        state.checking = true;
        try {
            if (state.operation.check(state.input, state.context) !== true)
                throw new FirewallError('denied');
        } catch {
            throw new FirewallError('denied');
        } finally {
            state.checking = false;
        }
        state.authorization?.();
        baseCheck(state);
    };
    const acknowledge = async (
        event: FirewallAuditEvent,
        signal: Active['controller']['signal'],
        required: boolean,
        timeoutMs: number
    ) => {
        if (!config.auditSink) {
            if (required) throw new FirewallError('audit-unavailable');
            return;
        }
        if (!required) {
            if (observers >= (config.auditCapacity ?? 256)) {
                dropped++;
                return;
            }
            observers++;
            void Promise.resolve()
                .then(() => config.auditSink!(event, signal))
                .catch(() => {})
                .finally(() => {
                    observers--;
                });
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort = () => {};
        const stopped = new Promise<never>((_, reject) => {
            onAbort = () => reject(new FirewallError('cancelled'));
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
            timer = setTimeout(() => reject(new FirewallError('audit-unavailable')), timeoutMs);
        });
        try {
            const ok = await Promise.race([
                Promise.resolve().then(() => config.auditSink!(event, signal)),
                stopped,
            ]);
            if (required && ok !== true) throw new FirewallError('audit-unavailable');
        } catch {
            if (required) throw new FirewallError('audit-unavailable');
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        }
    };
    const reconcile = (state: Active, raw: unknown) => {
        const report = usageReport(raw),
            prior = state.reservation;
        const nextInput = Math.max(prior.input, report.usage.inputTokens ?? 0);
        const nextOutput = Math.max(prior.output, report.usage.outputTokens ?? 0);
        const reportedCost =
            report.usage.costUSD === null ? prior.cost : costUnits(report.usage.costUSD);
        const nextCost = reportedCost > prior.cost ? reportedCost : prior.cost;
        reservedTokens += nextInput - prior.input + nextOutput - prior.output;
        reservedCost += nextCost - prior.cost;
        if (
            nextInput > prior.input ||
            nextOutput > prior.output ||
            nextCost > prior.cost ||
            !report.valid ||
            (state.operation.kind === 'model' &&
                state.operation.provider.tokenBased &&
                (report.usage.inputTokens === null || report.usage.outputTokens === null))
        )
            billingBlocked = true;
        prior.input = nextInput;
        prior.output = nextOutput;
        prior.cost = nextCost;
    };
    for (const operation of registered.values()) {
        if (operation.kind !== 'model') continue;
        const provider = operation.provider;
        const registry = new ModelProviderRegistry().register({
            ...provider,
            infer(request) {
                const state = modelSlots.get(operation.id);
                if (!state) throw new ModelError('cancelled');
                checkpoint(state);
                const pending = Promise.resolve()
                    .then(() => {
                        checkpoint(state);
                        return provider.infer(
                            Object.freeze({
                                ...request,
                                checkExecution: () => {
                                    request.checkExecution();
                                    checkpoint(state);
                                },
                            })
                        );
                    })
                    .then((raw) => {
                        reconcile(state, raw);
                        return raw;
                    });
                state.pending.add(pending);
                // Keep real provider work owned even after router timeout/cancellation returns.
                void pending.finally(() => state.pending.delete(pending)).catch(() => {});
                return pending;
            },
        });
        routers.set(
            operation.id,
            new ModelRouter(registry, { scope: config.realm.scope, limits: operation.limits })
        );
    }

    async function execute(
        root: TaskContext,
        operationId: string,
        raw: BotValue
    ): Promise<BotValue> {
        let state: Active | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel = () => {};
        const operation = registered.get(operationId);
        try {
            if (closed) throw new FirewallError('policy-unavailable');
            if (!operation) throw new FirewallError('denied');
            const controller = new AbortController();
            checkRoot(root, controller.signal);
            evaluate(current.policy, operation);
            const cap = current.policy.limits;
            if (
                active.size >= cap.maxConcurrent ||
                reservedOperations >= cap.maxOperations ||
                (operation.kind === 'model' && (billingBlocked || modelSlots.has(operation.id)))
            )
                throw new FirewallError('resource-limit');
            const input = snapshotValue(
                raw,
                Math.min(cap.maxInputBytes, root.limits.maxInputBytes),
                'invalid-input'
            );
            const reservation = modelReservation(operation);
            if (
                reservedTokens + reservation.input + reservation.output > cap.maxTokens ||
                reservedCost + reservation.cost > costUnits(cap.maxCostUSD)
            )
                throw new FirewallError('resource-limit');
            const time = Math.min(cap.timeoutMs, root.limits.timeoutMs);
            const context: FirewallExecutionContext = Object.freeze({
                signal: controller.signal,
                policyVersion: current.version,
                root,
                checkExecution: () => checkpoint(state!),
            });
            state = {
                operation,
                root,
                input,
                epoch,
                controller,
                deadline: clock() + time,
                pending: new Set(),
                context,
                reservation,
                open: true,
                checking: false,
            };
            const run = state;
            active.add(run);
            if (operation.kind === 'model') modelSlots.set(operation.id, run);
            cancel = () => revoke(run, 'cancelled');
            root.signal.addEventListener('abort', cancel, { once: true });
            if (root.signal.aborted) cancel();
            timer = setTimeout(() => revoke(run, 'timeout'), time);
            let rejectAbort = () => {};
            const aborted = new Promise<never>((_, reject) => {
                rejectAbort = () => reject(new FirewallError(run.revoked ?? 'cancelled'));
                controller.signal.addEventListener('abort', rejectAbort, { once: true });
                if (controller.signal.aborted) rejectAbort();
            });
            void aborted.catch(() => {});
            const work = (async () => {
                try {
                    checkpoint(run);
                    await config.security.validateTask(root, controller.signal);
                    checkpoint(run);
                    const dispatch = async () => {
                        checkpoint(run);
                        const optionalDenied = evaluate(current.policy, operation);
                        if (optionalDenied)
                            record('decision', operation.id, 'would-deny', 'optional-rule');
                        const event = record('decision', operation.id, 'allow', 'authorized');
                        await acknowledge(
                            event,
                            controller.signal,
                            current.policy.audit.required,
                            time
                        );
                        await config.jay.verify(root, controller.signal);
                        checkpoint(run);
                        // No await between final checks, shared budget reservation and handler call.
                        if (
                            reservedOperations >= cap.maxOperations ||
                            reservedTokens + reservation.input + reservation.output >
                                cap.maxTokens ||
                            reservedCost + reservation.cost > costUnits(cap.maxCostUSD)
                        )
                            throw new FirewallError('resource-limit');
                        reservedOperations++;
                        reservedTokens += reservation.input + reservation.output;
                        reservedCost += reservation.cost;
                        if (operation.kind === 'model') {
                            const result: ModelResult = await routers.get(operation.id)!.infer(
                                {
                                    capability: operation.modelCapability,
                                    input,
                                    output: operation.output,
                                    context: {
                                        taskId: root.taskId,
                                        sessionId: root.sessionId,
                                        scope: config.realm.scope,
                                        signal: controller.signal,
                                    },
                                },
                                {
                                    providerId: operation.provider.id,
                                    allowRemote: operation.provider.locality === 'remote',
                                    allowFallback: false,
                                }
                            );
                            // Router revalidation may observe mutations made by a semantic validator.
                            for (const attempt of result.attempts)
                                if (attempt.usage) reconcile(run, { usage: attempt.usage });
                            if (result.status !== 'completed') {
                                if (
                                    [
                                        'usage-limit',
                                        'usage-unverifiable',
                                        'token-limit',
                                        'cost-limit',
                                    ].includes(result.error.code) ||
                                    [
                                        'token-limit-exceeded',
                                        'cost-limit-exceeded',
                                        'usage-unverifiable',
                                    ].includes(result.error.reason ?? '')
                                )
                                    billingBlocked = true;
                                throw new ModelError(result.error.reason ?? result.error.code);
                            }
                            reconcile(run, { usage: result.usage });
                            return result.data;
                        }
                        if (operation.kind === 'tool')
                            return await config.security.executeTool(
                                root,
                                operation.capability,
                                operation.toolId,
                                input,
                                controller.signal,
                                {
                                    onApproval() {},
                                    trackTool: (work) => work(),
                                    checkExecution: () => checkpoint(run),
                                },
                                {
                                    effect: operation.effect,
                                    readOnly: operation.effect === 'read-only',
                                }
                            );
                        return await operation.execute(input, context);
                    };
                    // Capture handler errors inside the authorized callback so mandatory ModelError
                    // classifications are not converted into retryable generic tool failures.
                    let result: unknown,
                        failed = false,
                        error: unknown;
                    if (operation.kind === 'tool') result = await dispatch();
                    else
                        await config.security.runOperation(
                            root,
                            operation.capability,
                            input,
                            controller.signal,
                            operation.effect,
                            async (authorization) => {
                                run.authorization = authorization;
                                try {
                                    result = await dispatch();
                                } catch (caught) {
                                    failed = true;
                                    error = caught;
                                }
                            },
                            () => baseCheck(run)
                        );
                    if (failed) throw error;
                    checkpoint(run);
                    return snapshotValue(
                        result,
                        Math.min(cap.maxOutputBytes, root.limits.maxOutputBytes),
                        'invalid-output'
                    );
                } finally {
                    // Public cancellation can finish early; concurrency ownership cannot.
                    await Promise.allSettled([...run.pending]);
                    run.open = false;
                    active.delete(run);
                    if (modelSlots.get(operation.id) === run) modelSlots.delete(operation.id);
                    clearTimeout(timer);
                    root.signal.removeEventListener('abort', cancel);
                    controller.signal.removeEventListener('abort', rejectAbort);
                    record('settled', operation.id, 'observe', 'completed');
                }
            })();
            return await Promise.race([work, aborted]);
        } catch (error) {
            const safe = error instanceof ModelError ? error : failure(error, 'denied');
            record(
                'decision',
                operation?.id ?? null,
                'deny',
                safe instanceof FirewallError ? safe.code : 'resource-limit'
            );
            throw safe;
        }
    }

    async function update(
        root: TaskContext,
        expected: number,
        action: 'replace' | 'rollback' | 'lockdown',
        value?: FirewallPolicy | number
    ): Promise<FirewallPolicySnapshot> {
        if (updating) throw new FirewallError('version-conflict');
        if (!Number.isSafeInteger(expected) || expected !== current.version)
            throw new FirewallError('version-conflict');
        updating = true;
        let updateEpoch = epoch;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancel = () => controller.abort();
        try {
            checkRoot(root, controller.signal);
            const time = Math.min(root.limits.timeoutMs, current.policy.limits.timeoutMs);
            const deadline = clock() + time;
            timer = setTimeout(cancel, time);
            root.signal.addEventListener('abort', cancel, { once: true });
            const ensure = () => {
                checkRoot(root, controller.signal);
                if (clock() >= deadline || controller.signal.aborted)
                    throw new FirewallError('timeout');
                if (epoch !== updateEpoch || expected !== current.version)
                    throw new FirewallError('version-conflict');
            };
            // Snapshot before any await, but reject invalid updates only after admin authorization.
            let candidate: FirewallPolicy | undefined;
            try {
                const source =
                    action === 'rollback'
                        ? history.get(value as number)
                        : action === 'lockdown'
                          ? { ...current.policy, mode: 'lockdown' }
                          : value;
                candidate = policy(source, registered);
            } catch {
                /* Authorized invalid updates close admission below. */
            }
            const work = (async () => {
                await config.jay.verify(root, controller.signal);
                ensure();
                if ((await config.authorizeAdmin(root, controller.signal)) !== true)
                    throw new FirewallError('unauthorized');
                ensure();
                await config.security.runOperation(
                    root,
                    config.adminCapability,
                    {
                        action,
                        expectedVersion: expected,
                        policy: (candidate ?? null) as unknown as BotValue,
                    },
                    controller.signal,
                    'state-changing',
                    async (authorization) => {
                        ensure();
                        authorization();
                        if (!candidate) {
                            closed = true;
                            fence();
                            throw new FirewallError('invalid-policy');
                        }
                        // Admission is fenced during the audit acknowledgement. Invalid/failed
                        // authorized updates never reopen the previous permissive policy.
                        closed = true;
                        fence();
                        updateEpoch = epoch;
                        const event = record('policy', null, 'observe', 'updated');
                        if (action !== 'lockdown')
                            await acknowledge(
                                event,
                                controller.signal,
                                current.policy.audit.required || candidate.audit.required,
                                time
                            );
                        if ((await config.authorizeAdmin(root, controller.signal)) !== true)
                            throw new FirewallError('unauthorized');
                        await config.jay.verify(root, controller.signal);
                        ensure();
                        authorization();
                        if (current.version >= Number.MAX_SAFE_INTEGER)
                            throw new FirewallError('policy-unavailable');
                        current = Object.freeze({
                            version: current.version + 1,
                            policy: candidate,
                        });
                        history.set(current.version, candidate);
                        if (history.size > 32) history.delete(history.keys().next().value!);
                        closed = false;
                        fence();
                        record('policy', null, 'allow', 'updated');
                    },
                    ensure
                );
                return current;
            })();
            const stopped = new Promise<never>((_, reject) => {
                controller.signal.addEventListener(
                    'abort',
                    () => reject(new FirewallError('timeout')),
                    { once: true }
                );
                if (controller.signal.aborted) reject(new FirewallError('cancelled'));
            });
            return await Promise.race([work, stopped]);
        } catch (error) {
            const safe = failure(error, 'unauthorized');
            record('policy', null, 'deny', safe.code);
            throw safe;
        } finally {
            // Invalidate late administrator approvals before another update starts.
            controller.abort();
            clearTimeout(timer);
            try {
                root.signal.removeEventListener('abort', cancel);
            } catch {
                /* Invalid root. */
            }
            updating = false;
        }
    }
    return Object.freeze({
        runtime: Object.freeze({
            execute,
            snapshot: () => current,
            status: () =>
                Object.freeze({
                    mode: current.policy.mode,
                    version: current.version,
                    admission: closed ? ('closed' as const) : ('open' as const),
                    active: [...active].filter((state) => !state.revoked).length,
                    draining: [...active].filter((state) => !!state.revoked).length,
                    reservedOperations,
                    reservedTokens,
                    reservedCostUSD: costUSD(reservedCost),
                    droppedAuditEvents: dropped,
                }),
            audit: () => Object.freeze([...events]),
        }),
        admin: Object.freeze({
            replace: (root: TaskContext, expected: number, next: FirewallPolicy) =>
                update(root, expected, 'replace', next),
            rollback: (root: TaskContext, expected: number, target: number) =>
                update(root, expected, 'rollback', target),
            lockdown: (root: TaskContext, expected: number) => update(root, expected, 'lockdown'),
        }),
    });
}
