import {
    array,
    fail,
    identifier,
    limits,
    record,
    snapshotInput,
    snapshotValue,
} from './validation.js';
import { BotError } from './errors.js';
import type {
    BotTask,
    BotValue,
    SecurityContext,
    TaskContext,
    TaskContextOptions,
} from './types.js';

/** Host-only factory. Never populate options.security from an unverified task/request body. */
export function createTaskContext(task: BotTask, options: TaskContextOptions): TaskContext {
    const request = record(task, ['version', 'id', 'input', 'metadata'], 'invalid-input');
    if (request.version !== undefined && request.version !== 1) fail('invalid-input');
    identifier(request.id, 'invalid-input');
    const host = record(options, ['sessionId', 'security', 'signal', 'limits'], 'invalid-context');
    identifier(host.sessionId, 'invalid-context');
    const security = record(
        host.security,
        ['caller', 'scope', 'toolPermissions'],
        'invalid-context'
    );
    const caller = record(security.caller, ['id', 'issuer'], 'invalid-context');
    identifier(caller.id, 'invalid-context');
    identifier(caller.issuer, 'invalid-context');
    const scope = record(security.scope, ['kind', 'id'], 'invalid-context');
    if (!['company', 'personal'].includes(scope.kind as string)) fail('invalid-context');
    identifier(scope.id, 'invalid-context');
    const permissions = array(security.toolPermissions, 128, 'invalid-context').map((value) => {
        identifier(value, 'invalid-context');
        return value;
    });
    if (new Set(permissions).size !== permissions.length) fail('invalid-context');
    const signal = host.signal as TaskContextOptions['signal'];
    if (
        !signal ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.throwIfAborted !== 'function' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function'
    )
        fail('invalid-context');
    const executionLimits = limits(host.limits);
    const metadata = record(
        request.metadata === undefined ? {} : request.metadata,
        undefined,
        'invalid-input'
    );
    return Object.freeze({
        version: 1 as const,
        taskId: request.id,
        sessionId: host.sessionId,
        input: snapshotInput(request.input, executionLimits.maxInputBytes),
        metadata: snapshotValue(metadata, 16_384, 'invalid-input') as Readonly<
            Record<string, BotValue>
        >,
        security: snapshotValue(
            { caller, scope, toolPermissions: permissions },
            65_536,
            'invalid-context'
        ) as unknown as SecurityContext,
        signal,
        limits: executionLimits,
    });
}
export function snapshotContext(context: TaskContext): TaskContext {
    try {
        const value = record(
            context,
            ['version', 'taskId', 'sessionId', 'input', 'metadata', 'security', 'signal', 'limits'],
            'invalid-context'
        );
        if (value.version !== 1) fail('invalid-context');
        return createTaskContext(
            {
                version: 1,
                id: value.taskId,
                input: value.input,
                metadata: value.metadata,
            } as BotTask,
            {
                sessionId: value.sessionId,
                security: value.security,
                signal: value.signal,
                limits: value.limits,
            } as TaskContextOptions
        );
    } catch {
        throw new BotError('invalid-context');
    }
}
