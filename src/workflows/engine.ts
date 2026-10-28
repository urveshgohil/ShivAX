import { snapshotContext } from '../agents/context.js';
import { snapshotValue } from '../agents/validation.js';
import type { BotValue, TaskContext } from '../agents/types.js';
import { SecurityError } from '../security/errors.js';
import type { Vijay } from '../security/vijay.js';
import { WorkflowError } from './errors.js';
import { ToolRegistry } from './registry.js';
import { plan, settings } from './validation.js';
import type {
    WorkflowOptions,
    WorkflowOutput,
    WorkflowRun,
    WorkflowSnapshot,
    WorkflowStatus,
    WorkflowTrace,
} from './types.js';

const terminal = (state: WorkflowStatus) =>
    ['completed', 'denied', 'failed', 'cancelled'].includes(state);

/** Bounded, validated action graph. No evaluation of instructions contained in tool outputs. */
export class RudraWorkflowEngine {
    readonly #tools: ToolRegistry;
    readonly #security: Vijay;
    #occupied = false;
    #disposed = false;
    #cancel?: () => void;
    constructor(tools: ToolRegistry, security: Vijay) {
        this.#tools = tools;
        this.#security = security;
    }
    dispose(): void {
        this.#disposed = true;
        this.#cancel?.();
    }

    start(context: TaskContext, proposal: unknown, options: WorkflowOptions = {}): WorkflowRun {
        let task: TaskContext;
        try {
            task = snapshotContext(context);
        } catch (error) {
            this.#security.rejectContext();
            throw error;
        }
        const config = settings(options, task.input.capability);
        if (this.#disposed || this.#occupied)
            throw new WorkflowError(this.#disposed ? 'disposed' : 'busy');
        const now =
            typeof globalThis.performance?.now === 'function'
                ? globalThis.performance.now.bind(globalThis.performance)
                : Date.now;
        const started = now();
        this.#occupied = true;
        // Copy untrusted proposals synchronously; approval/authentication cannot race later mutation.
        let validated: ReturnType<typeof plan> | undefined, proposalError: unknown;
        try {
            validated = plan(proposal, config.maxSteps, task.limits.maxInputBytes);
        } catch (error) {
            proposalError = error;
        }
        const controller = new AbortController();
        let status: WorkflowStatus = 'queued',
            error: WorkflowSnapshot['error'];
        const outputs = new Map<number, WorkflowOutput>(),
            traces: WorkflowTrace[] = [];
        let sequence = 0,
            steps = 0,
            toolCalls = 0,
            modelCalls = 0,
            modelTokens = 0,
            modelCostUnits = 0;
        let pauseRequested = false,
            waiting = 0,
            ended = false;
        let wake: (() => void) | undefined;
        const pauseWaiters: ((value: WorkflowSnapshot) => void)[] = [];
        const pending = new Set<Promise<unknown>>();
        const emit = (entry: Omit<WorkflowTrace, 'sequence' | 'taskId'>) => {
            if (ended) return;
            traces.push(Object.freeze({ ...entry, sequence: ++sequence, taskId: task.taskId }));
            if (traces.length > 1024) traces.shift();
        };
        const state = (value: WorkflowStatus) => {
            if (status !== value && !ended) {
                status = value;
                emit({ type: 'state', status });
            }
        };
        const snapshot = (): WorkflowSnapshot =>
            Object.freeze({
                taskId: task.taskId,
                status,
                outputs: Object.freeze(
                    [...outputs.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)
                ),
                trace: Object.freeze(traces.slice()),
                usage: Object.freeze({
                    steps,
                    toolCalls,
                    modelCalls,
                    modelTokens,
                    modelCostUSD: modelCostUnits / 1e9,
                }),
                ...(error ? { error } : {}),
            });
        const check = () => {
            if (!controller.signal.aborted && now() - started >= task.limits.timeoutMs)
                controller.abort(new WorkflowError('timeout'));
            if (controller.signal.aborted) throw controller.signal.reason;
        };
        const cancel = () => controller.abort(new WorkflowError('cancelled'));
        this.#cancel = cancel;
        const aborted = new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
                'abort',
                () => {
                    wake?.();
                    reject(controller.signal.reason);
                },
                { once: true }
            );
        });
        void aborted.catch(() => {});
        const track = <T>(callback: () => T | Promise<T>): Promise<T> => {
            const promise = Promise.resolve().then(() => {
                check();
                return callback();
            });
            pending.add(promise);
            void promise.then(
                () => pending.delete(promise),
                () => pending.delete(promise)
            );
            return promise;
        };
        const onApproval = (active: boolean) => {
            waiting += active ? 1 : -1;
            if (!ended && !controller.signal.aborted)
                state(waiting > 0 ? 'waiting_approval' : 'running');
        };
        const boundary = async () => {
            check();
            while (pauseRequested) {
                state('paused');
                const paused = new Promise<void>((resolve) => {
                    wake = resolve;
                });
                for (const resolve of pauseWaiters.splice(0)) resolve(snapshot());
                await paused;
                wake = undefined;
                check();
                await track(() => this.#security.validateTask(context, controller.signal));
                check();
                // A host can request another pause while resume authentication is pending.
                // Keep that request at this quiescent boundary before admitting new work.
                state('running');
            }
        };
        const timer = setTimeout(
            () => controller.abort(new WorkflowError('timeout')),
            task.limits.timeoutMs
        );
        task.signal.addEventListener('abort', cancel, { once: true });
        if (task.signal.aborted) cancel();
        emit({ type: 'state', status });
        const work = track(async () => {
            await this.#security.validateTask(context, controller.signal);
            check();
            if (proposalError) throw proposalError;
            const workflow = validated!;
            const routes = workflow.actions.map((action) => {
                if (!config.allowed.includes(action.capability))
                    throw new WorkflowError('capability-denied');
                const route = this.#tools.findByCapability(action.capability)[0];
                if (!route) throw new WorkflowError('missing-capability');
                return route;
            });
            state('running');
            const values = new Map<string, BotValue>();
            const remaining = workflow.actions.map((_, i) => i);
            const execute = async (index: number) => {
                const action = workflow.actions[index],
                    route = routes[index];
                const input =
                    action.input.source === 'task'
                        ? task.input.data
                        : action.input.source === 'literal'
                          ? action.input.data
                          : values.get(action.input.stepId)!;
                for (let attempt = 1; ; attempt++) {
                    check();
                    if (
                        this.#tools.get(route.id) !== route ||
                        this.#tools.protectedTools.get(route.id) !== route.tool
                    )
                        throw new WorkflowError('registry-changed');
                    if (steps >= config.maxSteps) throw new WorkflowError('max-steps');
                    if (toolCalls >= config.maxToolCalls) throw new WorkflowError('tool-limit');
                    if (
                        route.model &&
                        (modelCalls >= config.modelCalls ||
                            modelTokens + route.model.tokens > config.modelTokens ||
                            modelCostUnits + route.model.costUnits > config.costUnits)
                    )
                        throw new WorkflowError('model-budget');
                    // Reserve before any asynchronous approval or invocation; failures are not refunded.
                    steps++;
                    toolCalls++;
                    if (route.model) {
                        modelCalls++;
                        modelTokens += route.model.tokens;
                        modelCostUnits += route.model.costUnits;
                    }
                    try {
                        const output = await this.#security.executeTool(
                            context,
                            action.capability,
                            route.id,
                            input,
                            controller.signal,
                            {
                                onApproval,
                                checkExecution: check,
                                trackTool: track,
                                onEffect: () =>
                                    emit({
                                        type: 'action',
                                        actionIndex: index,
                                        toolId: route.id,
                                        capability: route.capability,
                                        attempt,
                                        outcome: 'approved',
                                    }),
                            },
                            {
                                tool: route.tool,
                                effect: route.effect,
                                readOnly: route.effect === 'read-only',
                            }
                        );
                        check();
                        const entry: WorkflowOutput = Object.freeze({
                            actionId: action.id,
                            trust: 'untrusted',
                            data: output,
                        });
                        try {
                            snapshotValue(
                                [...outputs.values(), entry],
                                task.limits.maxOutputBytes,
                                'invalid-output'
                            );
                        } catch {
                            throw new WorkflowError('output-limit');
                        }
                        outputs.set(index, entry);
                        values.set(action.id, output);
                        emit({
                            type: 'action',
                            actionIndex: index,
                            toolId: route.id,
                            capability: route.capability,
                            attempt,
                            outcome: 'completed',
                        });
                        return;
                    } catch (failure) {
                        check();
                        emit({
                            type: 'action',
                            actionIndex: index,
                            toolId: route.id,
                            capability: route.capability,
                            attempt,
                            outcome: 'failed',
                            errorCode:
                                failure instanceof SecurityError || failure instanceof WorkflowError
                                    ? failure.code
                                    : 'tool-failed',
                        });
                        if (
                            failure instanceof SecurityError &&
                            failure.code === 'tool-error' &&
                            route.effect === 'read-only' &&
                            attempt <= config.maxRetries
                        ) {
                            emit({ type: 'retry', actionIndex: index, toolId: route.id, attempt });
                            // Every attempt enters Vijay again; approval is never cached.
                            continue;
                        }
                        throw failure;
                    }
                }
            };
            while (remaining.length) {
                await boundary();
                const first = remaining[0],
                    batch: number[] = [first];
                if (routes[first].parallelSafe && routes[first].effect === 'read-only') {
                    for (const index of remaining.slice(1)) {
                        if (
                            batch.length >= config.maxParallel ||
                            !routes[index].parallelSafe ||
                            routes[index].effect !== 'read-only'
                        )
                            break;
                        const action = workflow.actions[index];
                        if (
                            (action.dependsOn ?? []).every((id) => values.has(id)) &&
                            (action.input.source !== 'step' || values.has(action.input.stepId))
                        )
                            batch.push(index);
                    }
                }
                await Promise.all(
                    batch.map((index) =>
                        track(() => execute(index)).catch((failure) => {
                            if (!controller.signal.aborted) controller.abort(failure);
                            throw failure;
                        })
                    )
                );
                check();
                for (const index of batch) remaining.splice(remaining.indexOf(index), 1);
            }
            check();
            state('completed');
        });
        // Retain capacity while any actual handler/approval is unsettled, even after public cancellation.
        const release = async () => {
            await Promise.allSettled([...pending]);
            if (pending.size) return release();
            this.#occupied = false;
            this.#cancel = undefined;
        };
        const result = (async () => {
            try {
                await Promise.race([work, aborted]);
                check();
            } catch (failure) {
                const cause = controller.signal.aborted ? controller.signal.reason : failure;
                const denied =
                    cause instanceof SecurityError &&
                    !['tool-error', 'invalid-output', 'cancelled'].includes(cause.code);
                const safe =
                    cause instanceof WorkflowError
                        ? cause
                        : new WorkflowError(denied ? 'security-denied' : 'tool-failed');
                error = Object.freeze({ code: safe.code, message: safe.message });
                state(safe.code === 'cancelled' ? 'cancelled' : denied ? 'denied' : 'failed');
                // Stop siblings and saved service contexts; terminal results cannot revive late work.
                if (!controller.signal.aborted) controller.abort(safe);
            } finally {
                ended = true;
                clearTimeout(timer);
                try {
                    task.signal.removeEventListener('abort', cancel);
                } catch {
                    /* Host cleanup. */
                }
                for (const resolve of pauseWaiters.splice(0)) resolve(snapshot());
                void release();
            }
            return snapshot();
        })();
        return Object.freeze({
            context,
            get snapshot() {
                return snapshot();
            },
            result,
            pause: () => {
                if (terminal(status) || status === 'paused') return Promise.resolve(snapshot());
                pauseRequested = true;
                return new Promise<WorkflowSnapshot>((resolve) => pauseWaiters.push(resolve));
            },
            resume: () => {
                if (status !== 'paused' || ended) throw new WorkflowError('invalid-state');
                pauseRequested = false;
                state('running');
                wake?.();
            },
            cancel,
        });
    }
}
