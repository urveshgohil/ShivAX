import type { BotSignal, BotValue } from '../agents/types.js';
import { identifier, record, snapshotValue } from '../agents/validation.js';

export interface MemoryNamespace {
    readonly principalId: string;
    readonly issuer: string;
    readonly sessionId: string;
    readonly scopeKind: 'personal' | 'company';
    readonly scopeId: string;
}
export type MemoryRead =
    | { readonly found: false }
    | { readonly found: true; readonly value: BotValue; readonly revision: number };
export interface MemoryStorage {
    read(
        namespace: MemoryNamespace,
        key: string,
        signal: BotSignal
    ): MemoryRead | Promise<MemoryRead>;
    write(
        namespace: MemoryNamespace,
        key: string,
        value: BotValue,
        signal: BotSignal
    ):
        | { readonly key: string; readonly revision: number }
        | Promise<{ readonly key: string; readonly revision: number }>;
}
export interface FeedbackStorage {
    append(
        namespace: MemoryNamespace,
        record: BotValue,
        signal: BotSignal
    ): { readonly recordId: string } | Promise<{ readonly recordId: string }>;
}
export interface SessionStorageOptions {
    readonly maxEntries?: number;
    readonly maxValueBytes?: number;
    readonly maxTotalBytes?: number;
}
function namespaceId(namespace: MemoryNamespace): string {
    record(
        namespace,
        ['principalId', 'issuer', 'sessionId', 'scopeKind', 'scopeId'],
        'invalid-context'
    );
    for (const field of ['principalId', 'issuer', 'sessionId', 'scopeId'] as const)
        identifier(namespace[field], 'invalid-context');
    if (namespace.scopeKind !== 'personal' && namespace.scopeKind !== 'company')
        throw new TypeError('Invalid namespace.');
    return JSON.stringify([
        namespace.issuer,
        namespace.principalId,
        namespace.scopeKind,
        namespace.scopeId,
        namespace.sessionId,
    ]);
}
function options(input: SessionStorageOptions) {
    const result = {
        maxEntries: input.maxEntries ?? 256,
        maxValueBytes: input.maxValueBytes ?? 65_536,
        maxTotalBytes: input.maxTotalBytes ?? 1_048_576,
    };
    for (const [key, max] of [
        ['maxEntries', 4096],
        ['maxValueBytes', 1_048_576],
        ['maxTotalBytes', 16_777_216],
    ] as const)
        if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > max)
            throw new RangeError('Invalid storage limit.');
    return result;
}
/** Explicit bounded host service; no global state or persistence. */
export class SessionMemoryStore implements MemoryStorage {
    readonly #entries = new Map<
        string,
        { namespace: string; value: BotValue; revision: number; bytes: number }
    >();
    readonly #limits: ReturnType<typeof options>;
    #bytes = 0;
    #revision = 0;
    constructor(limits: SessionStorageOptions = {}) {
        this.#limits = options(limits);
    }
    read(namespace: MemoryNamespace, key: string, signal: BotSignal): MemoryRead {
        signal.throwIfAborted();
        identifier(key, 'invalid-input');
        const entry = this.#entries.get(JSON.stringify([namespaceId(namespace), key]));
        return entry
            ? Object.freeze({ found: true, value: entry.value, revision: entry.revision })
            : Object.freeze({ found: false });
    }
    write(namespace: MemoryNamespace, key: string, value: BotValue, signal: BotSignal) {
        signal.throwIfAborted();
        identifier(key, 'invalid-input');
        const space = namespaceId(namespace),
            fullKey = JSON.stringify([space, key]);
        const safe = snapshotValue(value, this.#limits.maxValueBytes, 'invalid-input');
        const bytes = new TextEncoder().encode(JSON.stringify(safe) + fullKey).length;
        const previous = this.#entries.get(fullKey);
        if (
            (!previous && this.#entries.size >= this.#limits.maxEntries) ||
            this.#bytes - (previous?.bytes ?? 0) + bytes > this.#limits.maxTotalBytes
        )
            throw new RangeError('Memory capacity exceeded.');
        signal.throwIfAborted();
        const revision = ++this.#revision;
        this.#entries.set(fullKey, { namespace: space, value: safe, revision, bytes });
        this.#bytes += bytes - (previous?.bytes ?? 0);
        return Object.freeze({ key, revision });
    }
    clearSession(namespace: MemoryNamespace): void {
        const space = namespaceId(namespace);
        for (const [key, entry] of this.#entries)
            if (entry.namespace === space) {
                this.#entries.delete(key);
                this.#bytes -= entry.bytes;
            }
    }
}
export class SessionFeedbackStore implements FeedbackStorage {
    readonly #entries: { namespace: string; id: string; data: BotValue; bytes: number }[] = [];
    readonly #limits: ReturnType<typeof options>;
    #bytes = 0;
    #nextId = 0;
    constructor(limits: SessionStorageOptions = {}) {
        this.#limits = options(limits);
    }
    append(namespace: MemoryNamespace, record: BotValue, signal: BotSignal) {
        signal.throwIfAborted();
        const space = namespaceId(namespace),
            safe = snapshotValue(record, this.#limits.maxValueBytes, 'invalid-input');
        const bytes = new TextEncoder().encode(space + JSON.stringify(safe)).length;
        if (
            this.#entries.length >= this.#limits.maxEntries ||
            this.#bytes + bytes > this.#limits.maxTotalBytes
        )
            throw new RangeError('Feedback capacity exceeded.');
        signal.throwIfAborted();
        const recordId = `feedback-${++this.#nextId}`;
        this.#entries.push({ namespace: space, id: recordId, data: safe, bytes });
        this.#bytes += bytes;
        return Object.freeze({ recordId });
    }
    list(
        namespace: MemoryNamespace,
        signal: BotSignal
    ): readonly { readonly recordId: string; readonly record: BotValue }[] {
        signal.throwIfAborted();
        const space = namespaceId(namespace);
        return Object.freeze(
            this.#entries
                .filter((entry) => entry.namespace === space)
                .map((entry) => Object.freeze({ recordId: entry.id, record: entry.data }))
        );
    }
    clearSession(namespace: MemoryNamespace): void {
        const space = namespaceId(namespace);
        for (let i = this.#entries.length - 1; i >= 0; i--)
            if (this.#entries[i].namespace === space) {
                this.#bytes -= this.#entries[i].bytes;
                this.#entries.splice(i, 1);
            }
    }
}
