import { snapshotContext } from './context.js';
import { BotError, errorDetails, isErrorCode } from './errors.js';
import { BotEventEmitter } from './events.js';
import { checkPredicate, snapshotBot, snapshotResult } from './validation.js';
import type { Bot, BotErrorCode, BotInput, BotResult, BotValue, TaskContext } from './types.js';

/** Executes one explicitly supplied bot. No registry selection, queue, workflow or retries. */
export class BotExecutor {
    private readonly active = new WeakSet<object>();
    constructor(public readonly events = new BotEventEmitter()) {}
    async execute<I extends BotValue, O extends BotValue>(
        bot: Bot<I, O>,
        context: TaskContext
    ): Promise<BotResult<O>> {
        // Invalid descriptors/host contexts reject before execution; task failures return structured results.
        const implementation = snapshotBot(bot),
            task = snapshotContext(context);
        const identity = {
            botId: implementation.id,
            taskId: task.taskId,
            sessionId: task.sessionId,
        };
        const controller = new AbortController();
        const cancel = () => controller.abort(new BotError('cancelled'));
        const now =
            typeof globalThis.performance?.now === 'function'
                ? globalThis.performance.now.bind(globalThis.performance)
                : Date.now;
        const startedAt = now();
        const deadline = () => {
            if (!controller.signal.aborted && now() - startedAt >= task.limits.timeoutMs)
                controller.abort(new BotError('timeout'));
        };
        const checkAbort = () => {
            deadline();
            if (controller.signal.aborted) throw controller.signal.reason;
        };
        let rejectAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        const timer = setTimeout(
            () => controller.abort(new BotError('timeout')),
            task.limits.timeoutMs
        );
        // Attach a handler even when input validation fails before the race is entered.
        void aborted.catch(() => {});
        let result: BotResult<O>;
        let reserved = false,
            workStarted = false,
            subscribed = false;
        try {
            if (task.signal.aborted) cancel();
            checkAbort();
            if (this.active.has(bot)) throw new BotError('busy');
            // Reserve before any host/bot callback can re-enter this executor.
            this.active.add(bot);
            reserved = true;
            subscribed = true;
            task.signal.addEventListener('abort', cancel, { once: true });
            if (task.signal.aborted) cancel();
            checkAbort();
            if (
                !implementation.capabilities.some(
                    (capability) => capability.id === task.input.capability
                )
            )
                throw new BotError('unsupported-capability');
            if (
                implementation.requiredTools?.some(
                    (tool) => !task.security.toolPermissions.includes(tool.id)
                )
            )
                throw new BotError('tool-not-allowed');
            const valid = checkPredicate(() => implementation.validateInput(task.input));
            checkAbort();
            if (!valid) throw new BotError('invalid-input');
            const input = task.input as BotInput<I>;
            const executionTask = Object.freeze({ ...task, signal: controller.signal });
            this.events.emit('bot:started', identity);
            workStarted = true;
            const work = (async (): Promise<BotResult<O>> => {
                try {
                    checkAbort();
                    const raw = await implementation.execute(
                        input,
                        Object.freeze({ task: executionTask })
                    );
                    checkAbort();
                    let output: BotResult;
                    try {
                        output = snapshotResult(raw, task.limits.maxOutputBytes);
                        if (output.botId !== identity.botId || output.taskId !== identity.taskId)
                            throw new BotError('invalid-output');
                        if (output.status === 'completed') {
                            const data = output.data;
                            if (
                                !checkPredicate(() =>
                                    implementation.validateOutput(data, input.capability)
                                )
                            )
                                throw new BotError('invalid-output');
                        }
                    } catch {
                        throw new BotError('invalid-output');
                    }
                    checkAbort();
                    return output as BotResult<O>;
                } finally {
                    this.active.delete(bot);
                }
            })();
            result = await Promise.race([work, aborted]);
        } catch (error) {
            const cause = controller.signal.aborted ? controller.signal.reason : error;
            const descriptor =
                cause instanceof BotError
                    ? Object.getOwnPropertyDescriptor(cause, 'code')
                    : undefined;
            const code: BotErrorCode =
                descriptor && 'value' in descriptor && isErrorCode(descriptor.value)
                    ? descriptor.value
                    : 'bot-error';
            result = Object.freeze({
                botId: identity.botId,
                taskId: identity.taskId,
                status:
                    code === 'cancelled'
                        ? 'cancelled'
                        : code === 'timeout'
                          ? 'timed-out'
                          : 'failed',
                error: errorDetails(code),
            });
        } finally {
            // Only the owning call may release a reservation; started work owns its cleanup.
            if (reserved && !workStarted) this.active.delete(bot);
            clearTimeout(timer);
            try {
                if (subscribed) task.signal.removeEventListener('abort', cancel);
            } catch {
                /* A faulty host adapter cannot expose its exception. */
            }
            controller.signal.removeEventListener('abort', rejectAbort);
        }
        if (result.status === 'completed') this.events.emit('bot:completed', identity);
        else this.events.emit(`bot:${result.status}`, { ...identity, error: result.error });
        return result;
    }
}
