import type { BotSignal, BotValue } from '../agents/types.js';
import type { MemoryNamespace } from '../bots/storage.js';

export type MemoryCategory =
    'working' | 'session-history' | 'knowledge' | 'verified-outcome' | 'user-preference';
export interface MemoryRecord {
    readonly version: 1;
    readonly id: string;
    readonly namespace: MemoryNamespace;
    readonly category: MemoryCategory;
    readonly value: BotValue;
    readonly metadata: Readonly<Record<string, BotValue>>;
    readonly tags: readonly string[];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly expiresAt: number;
    readonly revision: number;
    /** Engine-owned lifetime identity, retained across updates. Absent only on legacy records. */
    readonly generation?: string;
    readonly trust: 'untrusted';
    readonly embedding?: { readonly providerId: string; readonly vector: readonly number[] };
}
export interface MemoryDraft {
    readonly id: string;
    readonly category: MemoryCategory;
    readonly value: BotValue;
    readonly metadata?: Readonly<Record<string, BotValue>>;
    readonly tags?: readonly string[];
    readonly ttlMs?: number;
}
export interface MemoryPatch {
    readonly value?: BotValue;
    readonly metadata?: Readonly<Record<string, BotValue>>;
    readonly tags?: readonly string[];
    /** Refresh expiry from now, within the configured category retention limit. */
    readonly ttlMs?: number;
}
/** Approval flags are trusted host assertions; concurrency preconditions grant no authority. */
export interface MemoryWriteApproval {
    readonly userApproved?: boolean;
    readonly outcomeVerified?: boolean;
    readonly expectedRevision?: number;
    /** Update only: require this lifetime identity; null explicitly requires a legacy record without one. */
    readonly expectedGeneration?: string | null;
}
export interface MemoryQuery {
    readonly text?: string;
    readonly categories?: readonly MemoryCategory[];
    readonly tags?: readonly string[];
    readonly limit?: number;
    readonly mode?: 'lexical' | 'semantic';
}
export interface MemoryMatch {
    readonly record: MemoryRecord;
    readonly score: number;
}
export interface MemoryExport {
    readonly version: 1;
    readonly namespace: MemoryNamespace;
    readonly exportedAt: number;
    readonly trust: 'untrusted';
    readonly records: readonly MemoryRecord[];
}
export interface MemoryStore {
    save(
        namespace: MemoryNamespace,
        draft: MemoryDraft,
        signal: BotSignal,
        approval?: MemoryWriteApproval
    ): Promise<MemoryRecord>;
    retrieve(
        namespace: MemoryNamespace,
        id: string,
        signal: BotSignal
    ): Promise<MemoryRecord | null>;
    update(
        namespace: MemoryNamespace,
        id: string,
        patch: MemoryPatch,
        signal: BotSignal,
        approval?: MemoryWriteApproval
    ): Promise<MemoryRecord>;
    delete(
        namespace: MemoryNamespace,
        id: string,
        signal: BotSignal,
        expectedRevision?: number,
        expectedGeneration?: string | null
    ): Promise<boolean>;
    search(
        namespace: MemoryNamespace,
        query: MemoryQuery,
        signal: BotSignal
    ): Promise<readonly MemoryMatch[]>;
    list(
        namespace: MemoryNamespace,
        query: Omit<MemoryQuery, 'text' | 'mode'>,
        signal: BotSignal
    ): Promise<readonly MemoryRecord[]>;
    export(namespace: MemoryNamespace, signal: BotSignal): Promise<MemoryExport>;
    purgeExpired(namespace: MemoryNamespace, signal: BotSignal): Promise<number>;
}
export interface MemoryTransaction<T> {
    readonly result: T;
    /** Omitted for a read. The adapter must atomically replace this namespace only. */
    readonly write?: BotValue;
    readonly remove?: true;
}
export interface MemoryPersistence {
    /** Host-declared destinations. Required for protected use; [] asserts no network I/O. */
    readonly networkOrigins?: readonly string[];
    /** Callback is synchronous; adapters serialize transactions and never invoke it twice.
     * Call signal.throwIfAborted() before side effects/commit; it may also enforce a host deadline.
     */
    transact<T>(
        namespace: MemoryNamespace,
        change: (stored: unknown) => MemoryTransaction<T>,
        signal: BotSignal,
        boundary?: { readonly checkNetworkAccess: (url: string) => void }
    ): Promise<T>;
}
export interface MemoryRetention {
    readonly defaultTtlMs: number;
    readonly maxTtlMs: number;
}
export interface MemoryEmbeddingsAdapter {
    /** Host-declared destinations. Required for protected use; [] asserts CPU-only embeddings. */
    readonly networkOrigins?: readonly string[];
    readonly id: string;
    readonly dimensions: number;
    embed(
        text: string,
        context: { readonly namespace: MemoryNamespace; readonly signal: BotSignal; readonly checkNetworkAccess?: (url: string) => void }
    ): readonly number[] | Promise<readonly number[]>;
}
export interface MemoryEngineOptions {
    readonly persistence?: MemoryPersistence;
    readonly now?: () => number;
    readonly maxRecords?: number;
    readonly maxRecordBytes?: number;
    readonly maxNamespaceBytes?: number;
    readonly retention?: Partial<Record<MemoryCategory, MemoryRetention>>;
    readonly embeddings?: MemoryEmbeddingsAdapter;
    /** Additional host admission restriction; cannot disable the built-in credential/PII checks. */
    readonly validateContent?: (value: BotValue) => boolean;
}
export type MemoryErrorCode =
    | 'invalid-input'
    | 'corrupt-record'
    | 'duplicate-record'
    | 'not-found'
    | 'conflict'
    | 'capacity'
    | 'privacy-denied'
    | 'approval-required'
    | 'verification-required'
    | 'unavailable'
    | 'storage-error'
    | 'embedding-error'
    | 'cancelled'
    | 'busy';
