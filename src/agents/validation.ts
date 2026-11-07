import { BotError, errorDetails, isErrorCode } from './errors.js';
import type {
    Bot,
    BotErrorCode,
    BotErrorDetails,
    BotInput,
    BotResult,
    BotValue,
    ExecutionLimits,
    Capability,
    ToolDescriptor,
} from './types.js';

export const DEFAULT_EXECUTION_LIMITS: Readonly<ExecutionLimits> = Object.freeze({
    timeoutMs: 30_000,
    maxInputBytes: 65_536,
    maxOutputBytes: 65_536,
});
export function fail(code: BotErrorCode): never {
    throw new BotError(code);
}
export function identifier(value: unknown, code: BotErrorCode): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 256) fail(code);
}
export function record(
    value: unknown,
    keys: readonly string[] | undefined,
    code: BotErrorCode
): Record<string, unknown> {
    if (
        !value ||
        typeof value !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (
            typeof key !== 'string' ||
            (keys && !keys.includes(key)) ||
            !('value' in descriptors[key]) ||
            !descriptors[key].enumerable
        )
            fail(code);
    }
    return value as Record<string, unknown>;
}
export function array(value: unknown, max: number, code: BotErrorCode): readonly unknown[] {
    if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > max
    )
        fail(code);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) fail(code);
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !('value' in descriptor)) fail(code);
    }
    return value;
}
export function limits(value: unknown): Readonly<ExecutionLimits> {
    const input = record(
        value === undefined ? {} : value,
        ['timeoutMs', 'maxInputBytes', 'maxOutputBytes'],
        'invalid-context'
    );
    const result = { ...DEFAULT_EXECUTION_LIMITS };
    for (const [key, max] of [
        ['timeoutMs', 300_000],
        ['maxInputBytes', 1_048_576],
        ['maxOutputBytes', 1_048_576],
    ] as const) {
        const value = input[key] === undefined ? result[key] : input[key];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
            fail('invalid-context');
        result[key] = value;
    }
    return Object.freeze(result);
}
/** Bound traversal before JSON encoding; reject accessors, cycles, sparse arrays and hooks. */
export function snapshotValue(value: unknown, maxBytes: number, code: BotErrorCode): BotValue {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) fail(code);
    const ancestors = new Set<object>();
    let nodes = 0,
        bytes = 0;
    const encoder = new TextEncoder();
    function textCost(text: string): void {
        if (text.length > maxBytes) fail(code);
        bytes += encoder.encode(JSON.stringify(text)).length;
        if (bytes > maxBytes) fail(code);
    }
    function copy(input: unknown, depth: number): BotValue {
        if (++nodes > 10_000 || depth > 32) fail(code);
        if (input === null || typeof input === 'boolean') return input;
        if (typeof input === 'number') {
            if (!Number.isFinite(input)) fail(code);
            return input;
        }
        if (typeof input === 'string') {
            textCost(input);
            return input;
        }
        if (typeof input !== 'object' || ancestors.has(input)) fail(code);
        ancestors.add(input);
        try {
            if (Array.isArray(input))
                return Object.freeze(
                    array(input, 10_000, code).map((item) => copy(item, depth + 1))
                );
            const source = record(input, undefined, code),
                output: Record<string, BotValue> = {};
            for (const key of Object.keys(source)) {
                textCost(key);
                Object.defineProperty(output, key, {
                    value: copy(source[key], depth + 1),
                    enumerable: true,
                });
            }
            return Object.freeze(output);
        } finally {
            ancestors.delete(input);
        }
    }
    const result = copy(value, 0);
    if (encoder.encode(JSON.stringify(result)).length > maxBytes) fail(code);
    return result;
}
export function snapshotInput(value: unknown, maxBytes: number): BotInput {
    const input = record(value, ['capability', 'data'], 'invalid-input');
    identifier(input.capability, 'invalid-input');
    if (!Object.prototype.hasOwnProperty.call(input, 'data')) fail('invalid-input');
    // Include the envelope in the input budget, not only its data field.
    return snapshotValue(input, maxBytes, 'invalid-input') as unknown as BotInput;
}
export function validateBotInput(
    value: unknown,
    maxBytes = DEFAULT_EXECUTION_LIMITS.maxInputBytes
): asserts value is BotInput {
    snapshotInput(value, maxBytes);
}
export function snapshotError(value: unknown, code: BotErrorCode): BotErrorDetails {
    const error = record(value, ['code', 'message'], code);
    if (!isErrorCode(error.code) || error.message !== errorDetails(error.code).message) fail(code);
    return errorDetails(error.code);
}
export function matchesFailureStatus(status: unknown, code: BotErrorCode): boolean {
    if (status === 'cancelled') return code === 'cancelled';
    if (status === 'timed-out') return code === 'timeout';
    return status === 'failed' && code !== 'cancelled' && code !== 'timeout';
}
export function snapshotResult(value: unknown, maxBytes: number): BotResult {
    const result = record(value, ['taskId', 'botId', 'status', 'data', 'error'], 'invalid-output');
    identifier(result.taskId, 'invalid-output');
    identifier(result.botId, 'invalid-output');
    if (result.status === 'completed') {
        if (
            !Object.prototype.hasOwnProperty.call(result, 'data') ||
            Object.prototype.hasOwnProperty.call(result, 'error')
        )
            fail('invalid-output');
    } else {
        if (
            !['failed', 'cancelled', 'timed-out'].includes(result.status as string) ||
            Object.prototype.hasOwnProperty.call(result, 'data')
        )
            fail('invalid-output');
        const error = snapshotError(result.error, 'invalid-output');
        if (!matchesFailureStatus(result.status, error.code)) fail('invalid-output');
    }
    return snapshotValue(result, maxBytes, 'invalid-output') as unknown as BotResult;
}
export function validateBotResult(
    value: unknown,
    maxBytes = DEFAULT_EXECUTION_LIMITS.maxOutputBytes
): asserts value is BotResult {
    snapshotResult(value, maxBytes);
}
export function checkPredicate(predicate: () => unknown): boolean {
    try {
        const value = predicate();
        if (value === true) return true;
        // Async validators are invalid, but their rejection must still be observed.
        void Promise.resolve(value).catch(() => {});
    } catch {
        /* Predicate errors are reported as invalid input/output. */
    }
    return false;
}
/** Snapshot descriptors and bind trusted implementation methods to their original owner. */
export function snapshotBot<I extends BotValue, O extends BotValue>(bot: Bot<I, O>): Bot<I, O> {
    if (!bot || typeof bot !== 'object') fail('invalid-bot');
    identifier(bot.id, 'invalid-bot');
    if (
        typeof bot.validateInput !== 'function' ||
        typeof bot.validateOutput !== 'function' ||
        typeof bot.execute !== 'function'
    )
        fail('invalid-bot');
    const descriptors = (
        value: unknown,
        allowEmpty: boolean,
        capabilities = false
    ): readonly Capability[] => {
        const seen = new Set<string>();
        const entries = array(value, 128, 'invalid-bot').map((item) => {
            const descriptor = record(
                item,
                capabilities
                    ? ['id', 'description', 'inputSchema', 'requiredTools']
                    : ['id', 'description'],
                'invalid-bot'
            );
            identifier(descriptor.id, 'invalid-bot');
            if (
                typeof descriptor.description !== 'string' ||
                descriptor.description.length > 2048 ||
                seen.has(descriptor.id)
            )
                fail('invalid-bot');
            seen.add(descriptor.id);
            return Object.freeze({
                id: descriptor.id,
                description: descriptor.description,
                ...(descriptor.inputSchema === undefined
                    ? {}
                    : {
                          inputSchema: snapshotValue(descriptor.inputSchema, 65_536, 'invalid-bot'),
                      }),
                ...(descriptor.requiredTools === undefined
                    ? {}
                    : { requiredTools: descriptors(descriptor.requiredTools, true) }),
            });
        });
        if (!allowEmpty && !entries.length) fail('invalid-bot');
        return Object.freeze(entries);
    };
    return Object.freeze({
        id: bot.id,
        capabilities: descriptors(bot.capabilities, false, true),
        requiredTools: descriptors(bot.requiredTools === undefined ? [] : bot.requiredTools, true),
        validateInput: bot.validateInput.bind(bot),
        validateOutput: bot.validateOutput.bind(bot),
        execute: bot.execute.bind(bot),
    });
}

/** Bot-wide requirements remain supported; capability tools add only the selected action's needs. */
export function toolsForCapability(
    bot: Pick<Bot, 'capabilities' | 'requiredTools'>,
    capability: string
): readonly ToolDescriptor[] {
    const tools = new Map<string, ToolDescriptor>();
    for (const tool of [
        ...(bot.requiredTools ?? []),
        ...(bot.capabilities.find((item) => item.id === capability)?.requiredTools ?? []),
    ])
        tools.set(tool.id, tool);
    return [...tools.values()];
}
