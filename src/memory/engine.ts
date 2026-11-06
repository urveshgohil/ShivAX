import { resources } from '../security/firewall/resources.js';
import type { BotSignal, BotValue } from '../agents/types.js';
import type { MemoryNamespace } from '../bots/storage.js';
import { InMemoryMemoryAdapter } from './adapters.js';
import { MemoryError, memoryError } from './errors.js';
import {
    approval,
    category,
    check,
    expectedGeneration as validateExpectedGeneration,
    id,
    integer,
    json,
    MEMORY_CATEGORIES,
    namespace,
    namespaceKey,
    object,
    privacy,
    storedRecord,
    tags,
    vector,
} from './validation.js';
import type {
    MemoryCategory,
    MemoryDraft,
    MemoryEngineOptions,
    MemoryExport,
    MemoryMatch,
    MemoryPatch,
    MemoryPersistence,
    MemoryQuery,
    MemoryRecord,
    MemoryRetention,
    MemoryStore,
    MemoryTransaction,
    MemoryWriteApproval,
} from './types.js';

const DAY = 86_400_000;
const MAX_TTL = 90 * DAY;
const DEFAULT_TTL: Record<MemoryCategory, number> = {
    working: 3_600_000,
    'session-history': DAY,
    knowledge: 30 * DAY,
    'verified-outcome': 7 * DAY,
    'user-preference': 30 * DAY,
};
const order = (a: MemoryRecord, b: MemoryRecord) =>
    b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Lazy platform entropy; never derive record identity from time, revision or content. */
function newGeneration(): string {
    if (typeof globalThis.crypto?.getRandomValues !== 'function')
        throw new MemoryError('unavailable');
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Scale before taking the norm, including for subnormal nonzero components. */
function unitVector(values: readonly number[]): readonly number[] {
    const scale = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const scaled = values.map((value) => value / scale);
    const norm = Math.hypot(...scaled);
    if (!Number.isFinite(norm) || norm === 0) throw new MemoryError('embedding-error');
    return scaled.map((value) => value / norm);
}

/** Portable scoped record service. All remembered content remains untrusted, including verified outcomes. */
export class MemoryEngine implements MemoryStore {
    readonly #persistence: MemoryPersistence;
    readonly #now: () => number;
    readonly #maxRecords: number;
    readonly #maxRecordBytes: number;
    readonly #maxNamespaceBytes: number;
    readonly #retention: Readonly<Record<MemoryCategory, MemoryRetention>>;
    readonly #embeddings?: {
        id: string;
        networkOrigins?: readonly string[];
        dimensions: number;
        embed: NonNullable<MemoryEngineOptions['embeddings']>['embed'];
    };
    readonly #validate?: MemoryEngineOptions['validateContent'];
    constructor(options: MemoryEngineOptions = {}) {
        const persistence = options.persistence ?? new InMemoryMemoryAdapter();
        if (typeof persistence.transact !== 'function') throw new MemoryError('invalid-input');
        this.#persistence = Object.freeze({
            networkOrigins: persistence.networkOrigins && Object.freeze([...persistence.networkOrigins]),
            transact: persistence.transact.bind(persistence),
        });
        this.#now = options.now ?? Date.now;
        this.#maxRecords = options.maxRecords ?? 128;
        this.#maxRecordBytes = options.maxRecordBytes ?? 65_536;
        this.#maxNamespaceBytes = options.maxNamespaceBytes ?? 1_048_576;
        integer(this.#maxRecords, 512, 1);
        integer(this.#maxRecordBytes, 1_048_576, 1);
        integer(this.#maxNamespaceBytes, 1_048_576, 1);
        if (
            typeof this.#now !== 'function' ||
            (options.validateContent !== undefined && typeof options.validateContent !== 'function')
        )
            throw new MemoryError('invalid-input');
        this.#validate = options.validateContent;
        const rules = {} as Record<MemoryCategory, MemoryRetention>;
        object(options.retention ?? {}, MEMORY_CATEGORIES);
        for (const kind of MEMORY_CATEGORIES) {
            const rule = options.retention?.[kind] ?? {
                defaultTtlMs: DEFAULT_TTL[kind],
                maxTtlMs: DEFAULT_TTL[kind],
            };
            object(rule, ['defaultTtlMs', 'maxTtlMs']);
            integer(rule.defaultTtlMs, MAX_TTL, 1);
            integer(rule.maxTtlMs, MAX_TTL, rule.defaultTtlMs);
            rules[kind] = Object.freeze({ ...rule });
        }
        this.#retention = Object.freeze(rules);
        if (options.embeddings) {
            const adapter = options.embeddings;
            id(adapter.id);
            integer(adapter.dimensions, 4096, 1);
            if (typeof adapter.embed !== 'function') throw new MemoryError('invalid-input');
            this.#embeddings = Object.freeze({
                id: adapter.id,
                networkOrigins: adapter.networkOrigins && Object.freeze([...adapter.networkOrigins]),
                dimensions: adapter.dimensions,
                embed: adapter.embed.bind(adapter),
            });
        }
    }
    private time(): number {
        const now = this.#now();
        integer(now);
        return now;
    }
    private ttl(kind: MemoryCategory, input?: number): number {
        const ttl = input ?? this.#retention[kind].defaultTtlMs;
        integer(ttl, this.#retention[kind].maxTtlMs, 1);
        return ttl;
    }
    private async transaction<T>(
        ns: MemoryNamespace,
        signal: BotSignal,
        change: (
            records: readonly MemoryRecord[],
            now: number
        ) => { result: T; records?: readonly MemoryRecord[] }
    ): Promise<T> {
        const safe = namespace(ns);
        check(signal);
        try {
            resources.get(signal)?.namespace(safe);
            this.checkResources(this.#persistence.networkOrigins, signal);
            return await this.#persistence.transact(
                safe,
                (raw) => {
                    check(signal);
                    let records: readonly MemoryRecord[] = [];
                    if (raw !== null && raw !== undefined) {
                        try {
                            const state = object(json(raw, this.#maxNamespaceBytes), [
                                'version',
                                'namespace',
                                'records',
                            ]);
                            if (
                                state.version !== 1 ||
                                namespaceKey(namespace(state.namespace)) !== namespaceKey(safe) ||
                                !Array.isArray(state.records) ||
                                state.records.length > this.#maxRecords
                            )
                                throw new MemoryError('corrupt-record');
                            records = state.records.map((item) =>
                                storedRecord(item, safe, this.#maxRecordBytes)
                            );
                            if (
                                new Set(records.map((record) => record.id)).size !==
                                    records.length ||
                                records.some(
                                    (record) => record.expiresAt - record.updatedAt > MAX_TTL
                                )
                            )
                                throw new MemoryError('corrupt-record');
                            for (const entry of records)
                                privacy(
                                    json(
                                        {
                                            id: entry.id,
                                            category: entry.category,
                                            value: entry.value,
                                            metadata: entry.metadata,
                                            tags: entry.tags,
                                        },
                                        this.#maxRecordBytes
                                    ),
                                    this.#validate
                                );
                        } catch {
                            throw new MemoryError('corrupt-record');
                        }
                    }
                    const changed = change(records, this.time());
                    check(signal);
                    const result: MemoryTransaction<T> =
                        changed.records === undefined
                            ? { result: changed.result }
                            : changed.records.length === 0
                              ? { result: changed.result, remove: true }
                              : {
                                    result: changed.result,
                                    write: this.state(safe, changed.records),
                                };
                    return result;
                },
                signal,
                resources.has(signal) ? { checkNetworkAccess: (url: string) => resources.get(signal)!.network(url) } : undefined
            );
        } catch (error) {
            throw signal.aborted ? new MemoryError('cancelled') : memoryError(error);
        }
    }
    private state(ns: MemoryNamespace, records: readonly MemoryRecord[]): BotValue {
        if (records.length > this.#maxRecords) throw new MemoryError('capacity');
        try {
            return json({ version: 1, namespace: ns, records }, this.#maxNamespaceBytes);
        } catch {
            throw new MemoryError('capacity');
        }
    }
    private draft(raw: MemoryDraft): MemoryDraft {
        const input = object(json(raw, this.#maxRecordBytes), [
            'id',
            'category',
            'value',
            'metadata',
            'tags',
            'ttlMs',
        ]);
        id(input.id);
        category(input.category);
        if (!Object.prototype.hasOwnProperty.call(input, 'value'))
            throw new MemoryError('invalid-input');
        object(input.metadata ?? {});
        tags(input.tags ?? []);
        this.ttl(input.category, input.ttlMs as number | undefined);
        privacy(
            json(
                {
                    id: input.id,
                    category: input.category,
                    value: input.value,
                    metadata: input.metadata ?? {},
                    tags: input.tags ?? [],
                },
                this.#maxRecordBytes
            ),
            this.#validate
        );
        return input as unknown as MemoryDraft;
    }
    private checkResources(origins: readonly string[] | undefined, signal: BotSignal): void {
        const boundary = resources.get(signal);
        if (!boundary) return;
        if (!origins) throw new MemoryError('unavailable');
        for (const origin of origins) boundary.network(origin);
        check(signal);
    }
    private embeddingContext(ns: MemoryNamespace, signal: BotSignal) {
        resources.get(signal)?.namespace(ns);
        this.checkResources(this.#embeddings?.networkOrigins, signal);
        const boundary = resources.get(signal);
        return Object.freeze({ namespace: ns, signal,
            ...(boundary ? { checkNetworkAccess: (url: string) => boundary.network(url) } : {}) });
    }
    private async embedding(
        value: BotValue,
        ns: MemoryNamespace,
        signal: BotSignal
    ): Promise<MemoryRecord['embedding']> {
        if (!this.#embeddings) return undefined;
        check(signal);
        try {
            const result = vector(
                await this.#embeddings.embed(JSON.stringify(value), this.embeddingContext(ns, signal)),
                this.#embeddings.dimensions
            );
            check(signal);
            return Object.freeze({ providerId: this.#embeddings.id, vector: result });
        } catch {
            throw signal.aborted
                ? new MemoryError('cancelled')
                : new MemoryError('embedding-error');
        }
    }
    private make(
        ns: MemoryNamespace,
        input: MemoryDraft,
        now: number,
        embedding: MemoryRecord['embedding'],
        previous?: MemoryRecord
    ): MemoryRecord {
        const expiresAt = now + this.ttl(input.category, input.ttlMs);
        integer(expiresAt);
        const raw = {
            version: 1,
            namespace: ns,
            id: input.id,
            category: input.category,
            value: input.value,
            metadata: input.metadata ?? {},
            tags: input.tags ?? [],
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
            expiresAt,
            revision: (previous?.revision ?? 0) + 1,
            generation: previous?.generation ?? newGeneration(),
            trust: 'untrusted',
            ...(embedding ? { embedding } : {}),
        };
        try {
            return storedRecord(raw, ns, this.#maxRecordBytes);
        } catch {
            throw new MemoryError('capacity');
        }
    }
    async save(
        ns: MemoryNamespace,
        draft: MemoryDraft,
        signal: BotSignal,
        consent: MemoryWriteApproval = {}
    ): Promise<MemoryRecord> {
        const safe = namespace(ns),
            input = this.draft(draft);
        approval(consent, input.category);
        check(signal);
        const embedded = await this.embedding(input.value, safe, signal);
        return this.transaction(safe, signal, (all, now) => {
            const records = all.filter((record) => record.expiresAt > now);
            if (records.some((record) => record.id === input.id))
                throw new MemoryError('duplicate-record');
            const entry = this.make(safe, input, now, embedded);
            return { result: entry, records: [...records, entry] };
        });
    }
    retrieve(ns: MemoryNamespace, key: string, signal: BotSignal): Promise<MemoryRecord | null> {
        id(key);
        return this.transaction(ns, signal, (records, now) => ({
            result: records.find((record) => record.id === key && record.expiresAt > now) ?? null,
        }));
    }
    async update(
        ns: MemoryNamespace,
        key: string,
        patch: MemoryPatch,
        signal: BotSignal,
        consent: MemoryWriteApproval = {}
    ): Promise<MemoryRecord> {
        const safe = namespace(ns);
        id(key);
        const changes = object(json(patch, this.#maxRecordBytes), [
            'value',
            'metadata',
            'tags',
            'ttlMs',
        ]);
        if (!Object.keys(changes).length) throw new MemoryError('invalid-input');
        const previous = await this.retrieve(safe, key, signal);
        if (!previous) throw new MemoryError('not-found');
        approval(consent, previous.category);
        if (
            (consent.expectedRevision !== undefined &&
                consent.expectedRevision !== previous.revision) ||
            (consent.expectedGeneration !== undefined &&
                consent.expectedGeneration !== (previous.generation ?? null))
        )
            throw new MemoryError('conflict');
        const input = this.draft({
            id: key,
            category: previous.category,
            value: previous.value,
            metadata: previous.metadata,
            tags: previous.tags,
            ...changes,
        });
        const embedded = Object.prototype.hasOwnProperty.call(changes, 'value')
            ? await this.embedding(input.value, safe, signal)
            : previous.embedding;
        return this.transaction(safe, signal, (records, now) => {
            const current = records.find((record) => record.id === key && record.expiresAt > now);
            if (!current) throw new MemoryError('not-found');
            if (
                current.revision !== previous.revision ||
                current.generation !== previous.generation
            )
                throw new MemoryError('conflict');
            // Updating content must not silently extend retention unless ttlMs was explicitly supplied.
            const entry = this.make(
                safe,
                {
                    ...input,
                    ttlMs: changes.ttlMs === undefined ? current.expiresAt - now : input.ttlMs,
                },
                now,
                embedded,
                current
            );
            return {
                result: entry,
                records: records
                    .filter((record) => record.id !== key && record.expiresAt > now)
                    .concat(entry),
            };
        });
    }
    delete(
        ns: MemoryNamespace,
        key: string,
        signal: BotSignal,
        expectedRevision?: number,
        expectedGeneration?: string | null
    ): Promise<boolean> {
        id(key);
        if (expectedRevision !== undefined) integer(expectedRevision, Number.MAX_SAFE_INTEGER, 1);
        validateExpectedGeneration(expectedGeneration);
        return this.transaction(ns, signal, (records) => {
            const previous = records.find((record) => record.id === key);
            if (
                previous &&
                ((expectedRevision !== undefined && previous.revision !== expectedRevision) ||
                    (expectedGeneration !== undefined &&
                        (previous.generation ?? null) !== expectedGeneration))
            )
                throw new MemoryError('conflict');
            return {
                result: !!previous,
                ...(previous ? { records: records.filter((record) => record.id !== key) } : {}),
            };
        });
    }
    private query(raw: MemoryQuery): Required<MemoryQuery> {
        const input = object(json(raw), ['text', 'categories', 'tags', 'limit', 'mode']);
        const text = input.text ?? '',
            kinds = input.categories ?? [...MEMORY_CATEGORIES],
            labels = tags(input.tags ?? []),
            limit = input.limit ?? 20,
            mode = input.mode ?? 'lexical';
        if (
            typeof text !== 'string' ||
            text.length > 1024 ||
            !Array.isArray(kinds) ||
            !kinds.length ||
            kinds.length > 5 ||
            new Set(kinds).size !== kinds.length ||
            !['lexical', 'semantic'].includes(mode as string)
        )
            throw new MemoryError('invalid-input');
        kinds.forEach(category);
        integer(limit, 50, 1);
        privacy(text);
        return {
            text,
            categories: kinds as MemoryCategory[],
            tags: labels,
            limit,
            mode: mode as 'lexical' | 'semantic',
        };
    }
    async search(
        ns: MemoryNamespace,
        query: MemoryQuery,
        signal: BotSignal
    ): Promise<readonly MemoryMatch[]> {
        const safe = namespace(ns),
            input = this.query(query);
        check(signal);
        let queryVector: readonly number[] | undefined;
        if (input.mode === 'semantic') {
            if (!input.text.trim() || !this.#embeddings) throw new MemoryError('unavailable');
            try {
                queryVector = unitVector(
                    vector(
                        await this.#embeddings.embed(input.text, this.embeddingContext(safe, signal)),
                        this.#embeddings.dimensions
                    )
                );
            } catch {
                throw signal.aborted
                    ? new MemoryError('cancelled')
                    : new MemoryError('embedding-error');
            }
            check(signal);
        }
        const terms = [...new Set(input.text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
        if (terms.length > 32) throw new MemoryError('invalid-input');
        return this.transaction(safe, signal, (records, now) => {
            const matches: MemoryMatch[] = [];
            for (const entry of records.filter(
                (record) =>
                    record.expiresAt > now &&
                    input.categories.includes(record.category) &&
                    input.tags.every((tag) => record.tags.includes(tag))
            )) {
                let score = 1;
                if (queryVector) {
                    if (
                        !entry.embedding ||
                        entry.embedding.providerId !== this.#embeddings!.id ||
                        entry.embedding.vector.length !== queryVector.length
                    )
                        continue;
                    const target = unitVector(entry.embedding.vector);
                    score = target.reduce((sum, value, i) => sum + value * queryVector![i], 0);
                    if (!Number.isFinite(score)) throw new MemoryError('embedding-error');
                    // Only floating-point rounding can escape the cosine interval.
                    score = Math.max(-1, Math.min(1, score));
                } else if (terms.length) {
                    const text = JSON.stringify([
                        entry.value,
                        entry.metadata,
                        entry.tags,
                    ]).toLowerCase();
                    score = terms.filter((term) => text.includes(term)).length / terms.length;
                    if (!score) continue;
                }
                matches.push(Object.freeze({ record: entry, score }));
            }
            matches.sort((a, b) => b.score - a.score || order(a.record, b.record));
            return { result: Object.freeze(matches.slice(0, input.limit)) };
        });
    }
    async list(
        ns: MemoryNamespace,
        query: Omit<MemoryQuery, 'text' | 'mode'>,
        signal: BotSignal
    ): Promise<readonly MemoryRecord[]> {
        object(query, ['categories', 'tags', 'limit']);
        return Object.freeze((await this.search(ns, query, signal)).map((match) => match.record));
    }
    export(ns: MemoryNamespace, signal: BotSignal): Promise<MemoryExport> {
        const safe = namespace(ns);
        return this.transaction(safe, signal, (records, now) => ({
            result: Object.freeze({
                version: 1 as const,
                namespace: safe,
                exportedAt: now,
                trust: 'untrusted' as const,
                records: Object.freeze(
                    records.filter((record) => record.expiresAt > now).sort(order)
                ),
            }),
        }));
    }
    purgeExpired(ns: MemoryNamespace, signal: BotSignal): Promise<number> {
        return this.transaction(ns, signal, (records, now) => {
            const live = records.filter((record) => record.expiresAt > now);
            return { result: records.length - live.length, records: live };
        });
    }
}
