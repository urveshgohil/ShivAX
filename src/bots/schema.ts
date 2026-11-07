import type { BotValue } from '../agents/types.js';

/** Small JSON Schema subset used by the built-in capabilities; no executable schema keywords. */
export interface SpecialistSchema {
    readonly type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
    readonly properties?: Readonly<Record<string, SpecialistSchema>>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
    readonly items?: SpecialistSchema;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly enum?: readonly BotValue[];
    readonly oneOf?: readonly SpecialistSchema[];
}
export const text: SpecialistSchema = { type: 'string', minLength: 1, maxLength: 8192 };
export const id: SpecialistSchema = { type: 'string', minLength: 1, maxLength: 256 };
export const value: SpecialistSchema = {};
export const list = (items: SpecialistSchema, maxItems = 128): SpecialistSchema => ({
    type: 'array',
    items,
    maxItems,
});
export const object = (
    properties: Record<string, SpecialistSchema>,
    required = Object.keys(properties)
): SpecialistSchema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
export function matches(schema: SpecialistSchema, data: BotValue): boolean {
    if (schema.oneOf && schema.oneOf.filter((item) => matches(item, data)).length !== 1)
        return false;
    if (schema.enum && !schema.enum.some((item) => item === data)) return false;
    if (schema.type === 'null') return data === null;
    if (schema.type === 'object') {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
        const source = data as Readonly<Record<string, BotValue>>;
        const props = schema.properties ?? {};
        if (schema.required?.some((key) => !Object.prototype.hasOwnProperty.call(source, key)))
            return false;
        return Object.keys(source).every((key) =>
            Object.prototype.hasOwnProperty.call(props, key)
                ? matches(props[key], source[key])
                : schema.additionalProperties !== false
        );
    }
    if (schema.type === 'array')
        return (
            Array.isArray(data) &&
            data.length >= (schema.minItems ?? 0) &&
            data.length <= (schema.maxItems ?? 128) &&
            data.every((item) => !schema.items || matches(schema.items, item))
        );
    if (schema.type === 'string')
        return (
            typeof data === 'string' &&
            data.length >= (schema.minLength ?? 0) &&
            data.length <= (schema.maxLength ?? 8192)
        );
    if (schema.type === 'number')
        return (
            typeof data === 'number' &&
            Number.isFinite(data) &&
            data >= (schema.minimum ?? -Infinity) &&
            data <= (schema.maximum ?? Infinity)
        );
    if (schema.type === 'boolean') return typeof data === 'boolean';
    return true;
}
