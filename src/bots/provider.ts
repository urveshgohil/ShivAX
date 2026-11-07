import type { BotContext } from '../agents/types.js';
import { BotError } from '../agents/errors.js';
import type { SpecialistProviderContext } from './types.js';

export function providerContext(context: BotContext): SpecialistProviderContext {
    const task = context.task;
    return Object.freeze({
        taskId: task.taskId,
        sessionId: task.sessionId,
        scope: task.security.scope,
        signal: task.signal,
    });
}
export function adapter<T extends { readonly id: string }>(
    value: T | undefined,
    method: keyof T
): T | undefined {
    if (
        value !== undefined &&
        (!value ||
            typeof value.id !== 'string' ||
            !value.id.trim() ||
            value.id.length > 256 ||
            typeof value[method] !== 'function')
    )
        throw new BotError('invalid-bot');
    if (!value) return undefined;
    // Bind the implementation once; later mutation of an adapter descriptor cannot replace it.
    return Object.freeze({ id: value.id, [method]: (value[method] as Function).bind(value) }) as T;
}
