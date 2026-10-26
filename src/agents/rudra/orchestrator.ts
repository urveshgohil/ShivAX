import { createTaskContext, snapshotContext } from '../context.js';
import { BotExecutor } from '../execute.js';
import { BotRegistry } from '../registry.js';
import { BotError, errorDetails } from '../errors.js';
import { SecurityError } from '../../security/errors.js';
import { snapshotValue } from '../validation.js';
import type { BotValue, Capability, TaskContext } from '../types.js';
import { details, RudraError } from './errors.js';
import { CapabilityPlanner } from './planner.js';
import { options as validateOptions, plan as validatePlan } from './validation.js';
import type {
    ExecutionTrace,
    Planner,
    RudraHooks,
    RudraOptions,
    RudraResult,
    RudraTaskStatus,
    StepOutput,
} from './types.js';

/** One workflow at a time per instance. Injected implementations are trusted code, not a sandbox. */
export class RudraOrchestrator {
    private readonly executor = new BotExecutor();
    private readonly planner: Planner;
    private readonly approve: RudraHooks['approve'];
    private readonly onTrace: RudraHooks['onTrace'];
    private readonly security: RudraHooks['security'];
    private occupied = false;
    private disposed = false;
    private controller?: AbortController;

    constructor(
        private readonly registry: BotRegistry,
        hooks: RudraHooks = {}
    ) {
        this.planner = hooks.planner ?? new CapabilityPlanner();
        this.approve = hooks.approve;
        this.onTrace = hooks.onTrace;
        this.security = hooks.security;
        if (
            typeof this.planner.plan !== 'function' ||
            (this.approve !== undefined && typeof this.approve !== 'function') ||
            (this.onTrace !== undefined && typeof this.onTrace !== 'function')
        )
            throw new RudraError('invalid-options');
    }

    /** Stop admission permanently and cancel active work. No services or global resources to close. */
    dispose(): void {
        this.disposed = true;
        this.controller?.abort(new RudraError('cancelled'));
    }

    async run(context: TaskContext, options: RudraOptions = {}): Promise<RudraResult> {
        // Invalid trusted-host contracts reject before lifecycle events or any callback.
        let task: TaskContext;
        try {
            task = snapshotContext(context);
        } catch (error) {
            this.security?.rejectContext();
            throw error;
        }
        const settings = validateOptions(options, task.input.capability);
        const now =
            typeof globalThis.performance?.now === 'function'
                ? globalThis.performance.now.bind(globalThis.performance)
                : Date.now;
        const startedAt = now();
        const trace: ExecutionTrace[] = [];
        let outputs: readonly StepOutput[] = Object.freeze([]);
        let location: Pick<ExecutionTrace, 'stepId' | 'botId' | 'capability' | 'attempt'> = {};
        const emit = (
            entry: Omit<ExecutionTrace, 'sequence' | 'taskId' | 'sessionId' | 'elapsedMs'>
        ) => {
            const snapshot = Object.freeze({
                ...entry,
                sequence: trace.length + 1,
                taskId: task.taskId,
                sessionId: task.sessionId,
                elapsedMs: Math.max(0, now() - startedAt),
            });
            trace.push(snapshot);
            try {
                void Promise.resolve(this.onTrace?.(snapshot)).catch(() => {});
            } catch {
                /* Observation does not control workflow execution. */
            }
        };
        const state = (status: RudraTaskStatus) => emit({ type: 'state', status });
        const failed = (error: RudraError): RudraResult => {
            const status = error.code === 'cancelled' ? 'cancelled' : 'failed';
            const failure = details(error.code);
            emit({ ...location, type: 'state', status, error: failure });
            return Object.freeze({
                taskId: task.taskId,
                status,
                outputs,
                error: failure,
                trace: Object.freeze(trace.slice()),
            });
        };

        // Reserve before observers/planner/approval callbacks can re-enter.
        if (this.disposed || this.occupied) {
            const error = new RudraError(this.disposed ? 'disposed' : 'busy');
            state('queued');
            return failed(error);
        }
        this.occupied = true;
        const controller = new AbortController();
        this.controller = controller;
        let pending = 0,
            ended = false;
        const release = () => {
            if (ended && pending === 0 && this.controller === controller) {
                this.occupied = false;
                this.controller = undefined;
            }
        };
        // Retain ownership until the actual callback settles, even after the public run times out.
        const track = <T>(callback: () => T | Promise<T>): Promise<T> => {
            pending++;
            return Promise.resolve()
                .then(() => {
                    check();
                    return callback();
                })
                .finally(() => {
                    pending--;
                    release();
                });
        };
        const cancel = () => controller.abort(new RudraError('cancelled'));
        const check = () => {
            if (!controller.signal.aborted && now() - startedAt >= task.limits.timeoutMs)
                controller.abort(new RudraError('timeout'));
            if (controller.signal.aborted) throw controller.signal.reason;
        };
        let rejectAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        void aborted.catch(() => {});
        const bounded = async <T>(work: Promise<T>): Promise<T> => {
            const result = await Promise.race([work, aborted]);
            check();
            return result;
        };
        const timer = setTimeout(
            () => controller.abort(new RudraError('timeout')),
            task.limits.timeoutMs
        );
        let subscribed = false;
        try {
            state('queued');
            subscribed = true;
            task.signal.addEventListener('abort', cancel, { once: true });
            if (task.signal.aborted) cancel();
            check();
            state('running');
            check();
            if (this.security)
                await bounded(track(() => this.security!.validateTask(context, controller.signal)));
            check();
            // Capture descriptors once; registry changes during planning cannot redirect this run.
            const bots = this.registry
                .list()
                .slice()
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const capabilities = new Map<string, Capability>();
            for (const bot of bots)
                for (const capability of bot.capabilities) {
                    if (
                        settings.allowedCapabilities.includes(capability.id) &&
                        !capabilities.has(capability.id)
                    )
                        capabilities.set(capability.id, capability);
                }
            const proposal = await bounded(
                track(() =>
                    this.planner.plan(
                        Object.freeze({
                            taskId: task.taskId,
                            input: task.input,
                            capabilities: Object.freeze([...capabilities.values()]),
                            maxSteps: settings.maxSteps,
                            signal: controller.signal,
                        })
                    )
                ).catch(() => {
                    check();
                    throw new RudraError('planner-error');
                })
            );
            const plan = validatePlan(proposal, settings.maxSteps, task.limits.maxInputBytes);
            check();
            // Validate all routes before executing any step. Planner cannot specify a bot or permissions.
            const routes = plan.steps.map((step) => {
                location = { stepId: step.id, capability: step.capability };
                if (!settings.allowedCapabilities.includes(step.capability))
                    throw new RudraError('capability-denied');
                const bot = bots.find((candidate) =>
                    candidate.capabilities.some((cap) => cap.id === step.capability)
                );
                if (!bot) throw new RudraError('missing-capability');
                return bot;
            });
            location = {};
            emit({ type: 'plan', decision: 'validated-plan' });
            const values = new Map<string, BotValue>();
            let attempts = 0;
            for (const [index, step] of plan.steps.entries()) {
                const bot = routes[index];
                const data =
                    step.input.source === 'task'
                        ? task.input.data
                        : step.input.source === 'literal'
                          ? step.input.data
                          : values.get(step.input.stepId)!;
                for (let attempt = 1; ; attempt++) {
                    location = {
                        stepId: step.id,
                        botId: bot.id,
                        capability: step.capability,
                        attempt,
                    };
                    check();
                    if (attempts >= settings.maxSteps) throw new RudraError('max-steps');
                    const input = Object.freeze({ capability: step.capability, data });
                    // Validate the resolved input budget before exposing it to an approval callback.
                    let child: TaskContext;
                    try {
                        child = createTaskContext(
                            { id: task.taskId, input, metadata: task.metadata },
                            {
                                sessionId: task.sessionId,
                                security: task.security,
                                signal: controller.signal,
                                limits: {
                                    ...task.limits,
                                    timeoutMs: Math.max(
                                        1,
                                        Math.floor(task.limits.timeoutMs - (now() - startedAt))
                                    ),
                                },
                            }
                        );
                    } catch {
                        emit({
                            ...location,
                            type: 'outcome',
                            outcome: 'failed',
                            error: errorDetails('invalid-input'),
                        });
                        throw new RudraError('bot-failed');
                    }
                    emit({
                        type: 'selection',
                        stepId: step.id,
                        botId: bot.id,
                        capability: step.capability,
                        attempt,
                        decision: 'capability-then-bot-id',
                    });
                    if (this.approve) {
                        state('waiting_approval');
                        const approve = this.approve;
                        const approved = await bounded(
                            track(() =>
                                approve(
                                    Object.freeze({
                                        taskId: task.taskId,
                                        sessionId: task.sessionId,
                                        stepId: step.id,
                                        botId: bot.id,
                                        input: child.input,
                                        attempt,
                                        signal: controller.signal,
                                    })
                                )
                            ).catch(() => {
                                check();
                                throw new RudraError('approval-error');
                            })
                        );
                        if (approved !== true) throw new RudraError('approval-denied');
                        state('running');
                    }
                    check();
                    attempts++;
                    // Approval time is part of the workflow budget, not a fresh bot deadline.
                    child = Object.freeze({
                        ...child,
                        limits: Object.freeze({
                            ...child.limits,
                            timeoutMs: Math.max(
                                1,
                                Math.floor(task.limits.timeoutMs - (now() - startedAt))
                            ),
                        }),
                    });
                    const trackedBot: typeof bot = {
                        ...bot,
                        execute: (input, botContext) =>
                            track(() => {
                                // Legacy pure workflows remain usable; protected bots require the guard.
                                if (!this.security && bot.requiredTools?.length)
                                    throw new BotError('tool-not-allowed');
                                return bot.execute(input, botContext);
                            }),
                    };
                    let retryAllowed = !this.security;
                    const result = await bounded(
                        this.security
                            ? track(() =>
                                  this.security!.runBot(
                                      context,
                                      trackedBot,
                                      child,
                                      (secured) => this.executor.execute(secured, child),
                                      {
                                          onApproval: (waiting) => {
                                              if (!controller.signal.aborted)
                                                  state(waiting ? 'waiting_approval' : 'running');
                                          },
                                          trackTool: track,
                                          onEffect: (effect) => {
                                              retryAllowed = effect === 'read-only';
                                          },
                                      }
                                  )
                              )
                            : this.executor.execute(trackedBot, child)
                    );
                    emit({
                        type: 'outcome',
                        stepId: step.id,
                        botId: bot.id,
                        attempt,
                        outcome: result.status,
                        ...(result.status === 'completed' ? {} : { error: result.error }),
                    });
                    check();
                    if (result.status === 'completed') {
                        try {
                            outputs = snapshotValue(
                                [...outputs, { stepId: step.id, botId: bot.id, data: result.data }],
                                task.limits.maxOutputBytes,
                                'invalid-output'
                            ) as unknown as readonly StepOutput[];
                        } catch {
                            throw new RudraError('output-limit');
                        }
                        values.set(step.id, result.data);
                        break;
                    }
                    if (result.status === 'cancelled') throw new RudraError('cancelled');
                    if (result.status === 'timed-out') throw new RudraError('timeout');
                    if (
                        result.error.code === 'bot-error' &&
                        attempt <= settings.maxRetries &&
                        retryAllowed
                    ) {
                        emit({
                            type: 'retry',
                            stepId: step.id,
                            botId: bot.id,
                            attempt,
                            decision: 'retry-bot-error',
                        });
                        continue;
                    }
                    throw new RudraError('bot-failed');
                }
            }
            check();
            state('completed');
            return Object.freeze({
                taskId: task.taskId,
                status: 'completed',
                outputs,
                trace: Object.freeze(trace.slice()),
            });
        } catch (error) {
            const cause = controller.signal.aborted ? controller.signal.reason : error;
            return failed(
                cause instanceof RudraError
                    ? cause
                    : new RudraError(
                          cause instanceof SecurityError ? 'security-denied' : 'bot-failed'
                      )
            );
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', rejectAbort);
            try {
                if (subscribed) task.signal.removeEventListener('abort', cancel);
            } catch {
                /* Faulty host cleanup cannot expose raw exceptions. */
            }
            ended = true;
            release();
        }
    }
}
