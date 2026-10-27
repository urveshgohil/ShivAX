import { snapshotValue, record, identifier, checkPredicate } from '../agents/validation.js';
import { matches, type SpecialistSchema } from '../bots/schema.js';
import type { BotValue } from '../agents/types.js';
import type { ModelCapability, ModelLimits, ModelResponse } from './types.js';
import { ModelError } from './errors.js';

export const MODEL_CAPABILITIES: readonly ModelCapability[] = Object.freeze([
    'text-reasoning',
    'code-generation',
    'visual-interpretation',
    'numeric-inference',
    'deterministic-validation',
]);
export function capability(value: unknown): asserts value is ModelCapability {
    if (!MODEL_CAPABILITIES.includes(value as ModelCapability))
        throw new ModelError('invalid-input');
}
export function json(
    value: unknown,
    bytes: number,
    code: 'invalid-input' | 'invalid-output' = 'invalid-input'
): BotValue {
    try {
        return snapshotValue(value, bytes, code);
    } catch {
        throw new ModelError(code);
    }
}
export function name(value: unknown): asserts value is string {
    try {
        identifier(value, 'invalid-input');
    } catch {
        throw new ModelError('invalid-input');
    }
}
export function integer(value: unknown, maximum: number, minimum = 1): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
        throw new ModelError('invalid-input');
}
export function money(value: unknown): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)
        throw new ModelError('invalid-input');
}
export function limits(input: Partial<ModelLimits> = {}): Readonly<ModelLimits> {
    try {
        record(
            input,
            [
                'maxCalls',
                'maxTokens',
                'maxCostUSD',
                'timeoutMs',
                'maxInputTokens',
                'maxOutputTokens',
                'maxInputBytes',
                'maxOutputBytes',
            ],
            'invalid-input'
        );
    } catch {
        throw new ModelError('invalid-input');
    }
    const value = {
        maxCalls: 100,
        maxTokens: 65_536,
        maxCostUSD: 0,
        timeoutMs: 30_000,
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        maxInputBytes: 65_536,
        maxOutputBytes: 65_536,
        ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    };
    integer(value.maxCalls, 10_000);
    integer(value.maxTokens, 100_000_000, 0);
    integer(value.timeoutMs, 300_000);
    integer(value.maxInputTokens, 1_048_576);
    integer(value.maxOutputTokens, 1_048_576);
    integer(value.maxInputBytes, 1_048_576);
    integer(value.maxOutputBytes, 1_048_576);
    money(value.maxCostUSD);
    return Object.freeze(value);
}
/** Reject unsupported schema keywords instead of silently ignoring model constraints. */
export function schema(input: unknown): SpecialistSchema {
    const safe = json(input, 65_536);
    const visit = (value: BotValue): void => {
        const item = record(
            value,
            [
                'type',
                'properties',
                'required',
                'additionalProperties',
                'items',
                'minItems',
                'maxItems',
                'minLength',
                'maxLength',
                'minimum',
                'maximum',
                'enum',
                'oneOf',
            ],
            'invalid-input'
        );
        if (
            item.type !== undefined &&
            !['object', 'array', 'string', 'number', 'boolean', 'null'].includes(
                item.type as string
            )
        )
            throw new ModelError('invalid-input');
        for (const [type, keys] of [
            ['object', ['properties', 'required', 'additionalProperties']],
            ['array', ['items', 'minItems', 'maxItems']],
            ['string', ['minLength', 'maxLength']],
            ['number', ['minimum', 'maximum']],
        ] as const)
            if (keys.some((key) => item[key] !== undefined) && item.type !== type)
                throw new ModelError('invalid-input');
        if (item.properties !== undefined) {
            const properties = record(item.properties, undefined, 'invalid-input');
            Object.values(properties).forEach((v) => visit(v as BotValue));
        }
        if (
            item.required !== undefined &&
            (!Array.isArray(item.required) || item.required.some((k) => typeof k !== 'string'))
        )
            throw new ModelError('invalid-input');
        if (
            item.additionalProperties !== undefined &&
            typeof item.additionalProperties !== 'boolean'
        )
            throw new ModelError('invalid-input');
        if (item.items !== undefined) visit(item.items as BotValue);
        for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength'])
            if (item[key] !== undefined) integer(item[key], 1_048_576, 0);
        for (const key of ['minimum', 'maximum'])
            if (
                item[key] !== undefined &&
                (typeof item[key] !== 'number' || !Number.isFinite(item[key]))
            )
                throw new ModelError('invalid-input');
        if (
            item.enum !== undefined &&
            (!Array.isArray(item.enum) ||
                !item.enum.length ||
                item.enum.some((v) => v !== null && typeof v === 'object'))
        )
            throw new ModelError('invalid-input');
        if (item.oneOf !== undefined) {
            if (!Array.isArray(item.oneOf) || !item.oneOf.length)
                throw new ModelError('invalid-input');
            item.oneOf.forEach((v) => visit(v as BotValue));
        }
    };
    try {
        visit(safe);
    } catch {
        throw new ModelError('invalid-input');
    }
    return safe as SpecialistSchema;
}
export function response(
    raw: unknown,
    output: SpecialistSchema,
    validate: ((data: BotValue) => boolean) | undefined,
    maxBytes: number
): ModelResponse {
    try {
        const value = record(raw, ['data', 'usage'], 'invalid-output');
        const data = json(value.data, maxBytes, 'invalid-output');
        const usage = record(
            value.usage,
            ['inputTokens', 'outputTokens', 'costUSD'],
            'invalid-output'
        );
        for (const field of ['inputTokens', 'outputTokens'])
            if (usage[field] !== null) integer(usage[field], 100_000_000, 0);
        if (usage.costUSD !== null) money(usage.costUSD);
        if (!matches(output, data) || (validate && !checkPredicate(() => validate(data))))
            throw new ModelError('invalid-output');
        return Object.freeze({
            data,
            usage: Object.freeze({
                inputTokens: usage.inputTokens as number | null,
                outputTokens: usage.outputTokens as number | null,
                costUSD: usage.costUSD as number | null,
            }),
        });
    } catch {
        throw new ModelError('invalid-output');
    }
}
