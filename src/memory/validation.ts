import { snapshotValue, record, identifier, checkPredicate } from '../agents/validation.js';
import type { BotSignal, BotValue } from '../agents/types.js';
import type { MemoryNamespace } from '../bots/storage.js';
import type { MemoryCategory, MemoryRecord, MemoryWriteApproval } from './types.js';
import { MemoryError } from './errors.js';
export const MEMORY_CATEGORIES: readonly MemoryCategory[] = Object.freeze([
    'working',
    'session-history',
    'knowledge',
    'verified-outcome',
    'user-preference',
]);
export function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
    try {
        return record(value, keys, 'invalid-input');
    } catch {
        throw new MemoryError('invalid-input');
    }
}
export function json(value: unknown, maxBytes = 65_536): BotValue {
    try {
        return snapshotValue(value, maxBytes, 'invalid-input');
    } catch {
        throw new MemoryError('invalid-input');
    }
}
export function id(value: unknown): asserts value is string {
    try {
        identifier(value, 'invalid-input');
    } catch {
        throw new MemoryError('invalid-input');
    }
}
export function integer(
    value: unknown,
    max = Number.MAX_SAFE_INTEGER,
    min = 0
): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
        throw new MemoryError('invalid-input');
}
export function namespace(value: unknown): MemoryNamespace {
    const safe = json(value, 8192),
        fields = object(safe, ['principalId', 'issuer', 'sessionId', 'scopeKind', 'scopeId']);
    for (const field of ['principalId', 'issuer', 'sessionId', 'scopeId']) id(fields[field]);
    if (!['personal', 'company'].includes(fields.scopeKind as string))
        throw new MemoryError('invalid-input');
    return safe as unknown as MemoryNamespace;
}
export function namespaceKey(value: MemoryNamespace): string {
    return JSON.stringify([
        value.issuer,
        value.principalId,
        value.sessionId,
        value.scopeKind,
        value.scopeId,
    ]);
}
export function category(value: unknown): asserts value is MemoryCategory {
    if (!MEMORY_CATEGORIES.includes(value as MemoryCategory))
        throw new MemoryError('invalid-input');
}
export function tags(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.length > 32) throw new MemoryError('invalid-input');
    value.forEach(id);
    if (new Set(value).size !== value.length) throw new MemoryError('invalid-input');
    return Object.freeze([...value]);
}
export function approval(value: MemoryWriteApproval, kind: MemoryCategory): void {
    object(value, ['userApproved', 'outcomeVerified', 'expectedRevision', 'expectedGeneration']);
    for (const field of [value.userApproved, value.outcomeVerified])
        if (field !== undefined && typeof field !== 'boolean')
            throw new MemoryError('invalid-input');
    if (value.expectedRevision !== undefined)
        integer(value.expectedRevision, Number.MAX_SAFE_INTEGER, 1);
    expectedGeneration(value.expectedGeneration);
    if (kind === 'user-preference' && value.userApproved !== true)
        throw new MemoryError('approval-required');
    if (kind === 'verified-outcome' && value.outcomeVerified !== true)
        throw new MemoryError('verification-required');
}
export function expectedGeneration(value: unknown): void {
    if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value))
    )
        throw new MemoryError('invalid-input');
}
/** Conservative defaults, plus optional stricter host admission. Not a general DLP classifier. */
export function privacy(value: BotValue, validate?: (value: BotValue) => boolean): void {
    const visit = (item: BotValue): void => {
        if (
            typeof item === 'string' &&
            (/\bBearer\s+\S+|-----BEGIN[\w ]*PRIVATE KEY|\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:password|api[_ -]?key|access[_ -]?token|authorization)\s*(?:=|:|\bis\b)\s*\S+/i.test(
                item
            ) ||
                /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b/i.test(item))
        )
            throw new MemoryError('privacy-denied');
        if (item && typeof item === 'object')
            for (const [key, child] of Object.entries(item)) {
                const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
                if (
                    /^(?:password|passwd|secret|secrets|token|accesstoken|refreshtoken|apikey|authorization|credentials?|cookie|cookies|privatekey|email|phone|phonenumber|address|ssn|creditcard|cardnumber)$/.test(
                        normalized
                    )
                )
                    throw new MemoryError('privacy-denied');
                visit(child);
            }
    };
    visit(value);
    if (validate && !checkPredicate(() => validate(value))) throw new MemoryError('privacy-denied');
}
export function check(signal: BotSignal): void {
    if (signal.aborted) throw new MemoryError('cancelled');
    signal.throwIfAborted();
}
export function vector(value: unknown, dimensions?: number): readonly number[] {
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 4096 ||
        (dimensions !== undefined && value.length !== dimensions) ||
        value.some(
            (v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1_000_000
        ) ||
        !value.some((v) => v !== 0)
    )
        throw new MemoryError('embedding-error');
    return Object.freeze([...value]);
}
export function storedRecord(raw: unknown, ns: MemoryNamespace, bytes: number): MemoryRecord {
    const safe = json(raw, bytes),
        item = object(safe, [
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
            'generation',
            'trust',
            'embedding',
        ]);
    if (item.version !== 1 || item.trust !== 'untrusted') throw new MemoryError('corrupt-record');
    id(item.id);
    category(item.category);
    namespace(item.namespace);
    if (namespaceKey(item.namespace as MemoryNamespace) !== namespaceKey(ns))
        throw new MemoryError('corrupt-record');
    object(item.metadata);
    tags(item.tags);
    for (const key of ['createdAt', 'updatedAt', 'expiresAt']) integer(item[key]);
    integer(item.revision, Number.MAX_SAFE_INTEGER, 1);
    if (
        item.generation !== undefined &&
        (typeof item.generation !== 'string' || !/^[0-9a-f]{32}$/.test(item.generation))
    )
        throw new MemoryError('corrupt-record');
    if (
        (item.updatedAt as number) < (item.createdAt as number) ||
        (item.expiresAt as number) <= (item.updatedAt as number)
    )
        throw new MemoryError('corrupt-record');
    if (!Object.prototype.hasOwnProperty.call(item, 'value'))
        throw new MemoryError('corrupt-record');
    if (item.embedding !== undefined) {
        const e = object(item.embedding, ['providerId', 'vector']);
        id(e.providerId);
        vector(e.vector);
    }
    privacy(item.value as BotValue);
    privacy(item.metadata as BotValue);
    return safe as unknown as MemoryRecord;
}
