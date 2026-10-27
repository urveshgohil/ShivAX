import { id, list, object, value } from '../bots/schema.js';
import type { SpecialistSchema } from '../bots/schema.js';
import { MEMORY_CATEGORIES } from './validation.js';
const count = { type: 'number', minimum: 0 } as const;
const labels = list(id, 32);
const metadata = { type: 'object', additionalProperties: true } as const;
const ttl = { type: 'number', minimum: 1, maximum: 7_776_000_000 } as const;
const namespace = object({
    principalId: id,
    issuer: id,
    sessionId: id,
    scopeKind: { enum: ['personal', 'company'] },
    scopeId: id,
});
export const memoryRecordSchema = object(
    {
        version: { enum: [1] },
        id,
        namespace,
        category: { enum: MEMORY_CATEGORIES },
        value,
        metadata,
        tags: labels,
        createdAt: count,
        updatedAt: count,
        expiresAt: count,
        revision: { type: 'number', minimum: 1 },
        trust: { enum: ['untrusted'] },
        embedding: object({ providerId: id, vector: list({ type: 'number' }, 4096) }),
    },
    [
        'version',
        'id',
        'namespace',
        'category',
        'value',
        'metadata',
        'tags',
        'createdAt',
        'updatedAt',
        'expiresAt',
        'revision',
        'trust',
    ]
);
export const memoryDraftSchema = object(
    { id, category: { enum: MEMORY_CATEGORIES }, value, metadata, tags: labels, ttlMs: ttl },
    ['id', 'category', 'value']
);
const patch = object({ value, metadata, tags: labels, ttlMs: ttl }, []);
const queryFields = {
    categories: list({ enum: MEMORY_CATEGORIES }, 5),
    tags: labels,
    limit: { type: 'number', minimum: 1, maximum: 50 },
} as const;
export const memoryQuerySchema = object(
    {
        ...queryFields,
        text: { type: 'string', maxLength: 1024 },
        mode: { enum: ['lexical', 'semantic'] },
    },
    []
);
export interface MemoryActionDescriptor {
    readonly action:
        'save' | 'retrieve' | 'update' | 'delete' | 'search' | 'list' | 'export' | 'purge';
    readonly capability: string;
    readonly toolId: string;
    readonly effect: 'read-only' | 'state-changing';
    readonly input: SpecialistSchema;
    readonly output: SpecialistSchema;
}
const definitions: Omit<MemoryActionDescriptor, 'capability' | 'toolId'>[] = [
    {
        action: 'save',
        effect: 'state-changing',
        input: memoryDraftSchema,
        output: object({ record: memoryRecordSchema }),
    },
    {
        action: 'retrieve',
        effect: 'read-only',
        input: object({ id }),
        output: object({ record: { oneOf: [memoryRecordSchema, { type: 'null' }] } }),
    },
    {
        action: 'update',
        effect: 'state-changing',
        input: object({ id, patch, expectedRevision: { type: 'number', minimum: 1 } }, [
            'id',
            'patch',
        ]),
        output: object({ record: memoryRecordSchema }),
    },
    {
        action: 'delete',
        effect: 'state-changing',
        input: object({ id, expectedRevision: { type: 'number', minimum: 1 } }, ['id']),
        output: object({ deleted: { type: 'boolean' } }),
    },
    {
        action: 'search',
        effect: 'read-only',
        input: memoryQuerySchema,
        output: object({
            matches: list(
                object({
                    record: memoryRecordSchema,
                    score: { type: 'number', minimum: -1, maximum: 1 },
                }),
                50
            ),
        }),
    },
    {
        action: 'list',
        effect: 'read-only',
        input: object(queryFields, []),
        output: object({ records: list(memoryRecordSchema, 50) }),
    },
    {
        action: 'export',
        effect: 'read-only',
        input: object({}),
        output: object({
            version: { enum: [1] },
            namespace,
            exportedAt: count,
            trust: { enum: ['untrusted'] },
            records: list(memoryRecordSchema, 512),
        }),
    },
    {
        action: 'purge',
        effect: 'state-changing',
        input: object({}),
        output: object({ removed: count }),
    },
];
// These schemas are authored constants; freeze without requiring platform APIs at package import.
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
export const MEMORY_ACTIONS: readonly MemoryActionDescriptor[] = freeze(
    definitions.map((definition) => ({
        ...definition,
        capability: `memory.${definition.action}`,
        toolId: `shivax.memory.records.${definition.action}`,
    }))
);
