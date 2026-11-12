import type { BotSignal, BotValue, TaskContext } from '../agents/types.js';
import type { MemoryNamespace } from '../bots/storage.js';
import type { Jay } from '../security/jay.js';
import type { PermissionPolicy } from '../security/types.js';
import { SecurityError } from '../security/errors.js';
import type { FirewallStatus } from '../security/firewall/types.js';
import { MemoryError } from './errors.js';
import { memoryNamespace } from './services.js';
import type { MemoryCategory, MemoryEmbeddingsAdapter, MemoryRecord, MemoryStore } from './types.js';

/*
 * SARASWATI S06: opt-in retrieval ranking over any MemoryStore.
 *
 * - The default `MemoryStore.search` is unchanged. The ranker only re-orders what `search` returns, so the
 *   store's namespace (tenant + session), expiry, category and tag filters always apply first.
 * - Quality comes from trusted signals only: categories the engine admits with host approval
 *   (`verified-outcome`, `user-preference`) or a trusted host `sourceQuality` callback. Self-declared record
 *   metadata (for example `quality: 1`) is never trusted.
 * - The ranker never writes. Retrieval counts, clicks or repetition never raise a record's rank or trust,
 *   and every result stays `trust: 'untrusted'`.
 */

export const MEMORY_RANKING_LIMITS = Object.freeze({ maxLimit: 50, defaultLimit: 10, maxQueryLength: 1024, maxEvidenceRefs: 16, maxHalfLifeMs: 365 * 86_400_000 });
export interface MemoryRankingWeights {
    readonly exact?: number;
    readonly keyword?: number;
    readonly quality?: number;
    /** Requires `recency`. */
    readonly recency?: number;
    /** Used only in `hybrid` mode when embeddings are available. */
    readonly semantic?: number;
}
export interface MemoryRankingOptions {
    /** Non-negative weights; the total score is their weighted mean. Defaults: exact 2, keyword 1, quality 0.5, recency 0, semantic 1. */
    readonly weights?: MemoryRankingWeights;
    /** Recency is used only when configured explicitly: weight `2^(-age / halfLifeMs)`. */
    readonly recency?: { readonly halfLifeMs: number };
    /** Trusted host quality in [0, 1] (for example from a source allowlist). Errors or invalid values count as 0. */
    readonly sourceQuality?: (record: MemoryRecord) => number;
    /** Default true: records with identical canonical values keep only the best-ranked copy. */
    readonly suppressDuplicates?: boolean;
    /** `hybrid` adds the store's semantic search when embeddings work; otherwise it falls back to lexical. */
    readonly mode?: 'lexical' | 'hybrid';
    readonly now?: () => number;
    /** Ranked searches through `searchFor` require a Jay-verified context and, with `policies`, the capability permissions. */
    readonly security?: {
        readonly jay: Jay;
        readonly policies?: { get(kind: 'capability', id: string): PermissionPolicy | undefined };
        /** Capability whose permissions are required. Default `memory.search`. */
        readonly capability?: string;
    };
    /** Read-only firewall status (`ShivaxFirewallRuntime` satisfies it). Lockdown refuses ranked searches. */
    readonly firewall?: { status(): Pick<FirewallStatus, 'mode' | 'admission'> };
}
export interface RankedMemoryQuery {
    readonly text: string;
    readonly categories?: readonly MemoryCategory[];
    readonly tags?: readonly string[];
    /** 1..50, default 10. */
    readonly limit?: number;
}
export interface RankedMemoryResult {
    readonly record: MemoryRecord;
    /** Weighted mean of the components, in [0, 1]. */
    readonly score: number;
    readonly components: { readonly exact: number; readonly keyword: number; readonly quality: number; readonly recency: number; readonly semantic: number };
    /** Only facts present on the stored record. Nothing is inferred or fabricated. */
    readonly provenance: {
        readonly record: { readonly id: string; readonly revision: number; readonly generation: string | null; readonly category: MemoryCategory };
        /** `record-metadata` and `governed-feedback` sources are claims made by the writer, not verified citations. */
        readonly source: { readonly ref: string; readonly origin: 'record-metadata' | 'governed-feedback' } | null;
        readonly scope: { readonly scopeKind: 'personal' | 'company'; readonly scopeId: string; readonly sessionBound: true };
        readonly evidence: { readonly available: boolean; readonly verified: false; readonly refs: readonly string[] };
        readonly freshness: { readonly createdAt: number; readonly updatedAt: number; readonly expiresAt: number; readonly ageMs: number };
        readonly trust: 'untrusted';
    };
}
export interface RankedMemorySearch {
    readonly format: 'shivax-ranked-memory';
    readonly version: 1;
    readonly mode: 'lexical' | 'hybrid';
    /** Why hybrid ranking fell back to lexical, if it did. */
    readonly fallback: null | 'embeddings-unavailable' | 'embedding-error';
    /** Records the store returned before ranking (after its own filters). */
    readonly candidates: number;
    readonly suppressedDuplicates: number;
    readonly results: readonly RankedMemoryResult[];
}

const REF = /^[A-Za-z0-9._:-]{1,256}$/;
const isRef = (v: unknown): v is string => typeof v === 'string' && REF.test(v);
const terms = (text: string) => [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
/** Sorted-key JSON, used only for duplicate detection. */
function canonical(value: BotValue): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object')
        return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, BotValue>)[k])).join(',') + '}';
    return JSON.stringify(value);
}
/** Quality from engine-enforced admission: verified outcomes need host verification, preferences need user approval. */
const CATEGORY_QUALITY: Readonly<Record<MemoryCategory, number>> = Object.freeze({ 'verified-outcome': 1, 'user-preference': 0.5, knowledge: 0, 'session-history': 0, working: 0 });

function provenanceOf(record: MemoryRecord, now: number): RankedMemoryResult['provenance'] {
    let source: RankedMemoryResult['provenance']['source'] = null;
    const refs: string[] = [];
    const meta = record.metadata as Record<string, BotValue>;
    if (isRef(meta.source)) source = { ref: meta.source, origin: 'record-metadata' };
    if (Array.isArray(meta.evidence)) for (const r of meta.evidence) if (isRef(r)) refs.push(r);
    // S01 governed feedback stored by Ekalavy/Chitragupt carries its own (claimed) source and evidence references.
    const v = record.value as Record<string, BotValue> | null;
    if (v && typeof v === 'object' && !Array.isArray(v) && v.format === 'shivax-governed-feedback') {
        const p = v.provenance as Record<string, BotValue> | undefined;
        const s = p && typeof p === 'object' ? (p.source as Record<string, BotValue> | undefined) : undefined;
        if (!source && s && isRef(s.id)) source = { ref: s.id, origin: 'governed-feedback' };
        if (p && Array.isArray(p.evidence)) for (const e of p.evidence) if (e && typeof e === 'object' && !Array.isArray(e) && isRef((e as Record<string, BotValue>).ref)) refs.push((e as Record<string, BotValue>).ref as string);
    }
    const unique = [...new Set(refs)].slice(0, MEMORY_RANKING_LIMITS.maxEvidenceRefs);
    return Object.freeze({
        record: Object.freeze({ id: record.id, revision: record.revision, generation: record.generation ?? null, category: record.category }),
        source: source && Object.freeze(source),
        scope: Object.freeze({ scopeKind: record.namespace.scopeKind, scopeId: record.namespace.scopeId, sessionBound: true as const }),
        evidence: Object.freeze({ available: unique.length > 0, verified: false as const, refs: Object.freeze(unique) }),
        freshness: Object.freeze({ createdAt: record.createdAt, updatedAt: record.updatedAt, expiresAt: record.expiresAt, ageMs: Math.max(0, now - record.updatedAt) }),
        trust: 'untrusted' as const,
    });
}

/** Opt-in ranking layer. Construct once per store; it holds no records and no cache. */
export class MemoryRanker {
    readonly #store: MemoryStore;
    readonly #weights: Required<MemoryRankingWeights>;
    readonly #halfLife: number | null;
    readonly #quality?: (record: MemoryRecord) => number;
    readonly #dedupe: boolean;
    readonly #mode: 'lexical' | 'hybrid';
    readonly #now: () => number;
    readonly #security?: MemoryRankingOptions['security'];
    readonly #firewall?: MemoryRankingOptions['firewall'];
    constructor(store: MemoryStore, options: MemoryRankingOptions = {}) {
        if (!store || typeof store.search !== 'function') throw new MemoryError('invalid-input');
        const o = options ?? {};
        const w = o.weights ?? {};
        for (const key of Object.keys(w)) if (!['exact', 'keyword', 'quality', 'recency', 'semantic'].includes(key)) throw new MemoryError('invalid-input');
        const weight = (v: unknown, fallback: number) => {
            if (v === undefined) return fallback;
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw new MemoryError('invalid-input');
            return v;
        };
        this.#weights = Object.freeze({ exact: weight(w.exact, 2), keyword: weight(w.keyword, 1), quality: weight(w.quality, 0.5), recency: weight(w.recency, 0), semantic: weight(w.semantic, 1) });
        if (o.recency !== undefined) {
            const h = o.recency?.halfLifeMs;
            if (!Number.isSafeInteger(h) || (h as number) < 1 || (h as number) > MEMORY_RANKING_LIMITS.maxHalfLifeMs) throw new MemoryError('invalid-input');
            this.#halfLife = h as number;
        } else this.#halfLife = null;
        // Recency must be configured explicitly before it can influence ranking.
        if (this.#weights.recency > 0 && this.#halfLife === null) throw new MemoryError('invalid-input');
        if (o.sourceQuality !== undefined && typeof o.sourceQuality !== 'function') throw new MemoryError('invalid-input');
        if (o.suppressDuplicates !== undefined && typeof o.suppressDuplicates !== 'boolean') throw new MemoryError('invalid-input');
        if (o.mode !== undefined && o.mode !== 'lexical' && o.mode !== 'hybrid') throw new MemoryError('invalid-input');
        if (o.now !== undefined && typeof o.now !== 'function') throw new MemoryError('invalid-input');
        if (o.security !== undefined && (typeof o.security?.jay?.verify !== 'function' || (o.security.policies !== undefined && typeof o.security.policies?.get !== 'function') || (o.security.capability !== undefined && !isRef(o.security.capability))))
            throw new MemoryError('invalid-input');
        if (o.firewall !== undefined && typeof o.firewall?.status !== 'function') throw new MemoryError('invalid-input');
        if (Object.values(this.#weights).every((v) => v === 0)) throw new MemoryError('invalid-input');
        this.#store = store;
        this.#quality = o.sourceQuality;
        this.#dedupe = o.suppressDuplicates !== false;
        this.#mode = o.mode ?? 'lexical';
        this.#now = o.now ?? Date.now;
        this.#security = o.security;
        this.#firewall = o.firewall;
    }

    /**
     * Ranked search in the namespace of a Jay-verified context (tenant + session from the trusted identity).
     * With `security.policies`, the identity must hold the capability policy's permissions.
     */
    async searchFor(root: TaskContext, query: RankedMemoryQuery, signal: BotSignal): Promise<RankedMemorySearch> {
        const security = this.#security;
        if (!security) throw new MemoryError('unavailable');
        const identity = await security.jay.verify(root, signal);
        if (security.policies) {
            const policy = security.policies.get('capability', security.capability ?? 'memory.search');
            if (!policy || !policy.permissions.every((p) => identity.principal.permissions.includes(p))) throw new SecurityError('permission-denied');
        }
        return this.search(memoryNamespace(identity), query, signal);
    }

    /** Ranked search in `namespace`. Host code must derive the namespace from a verified identity. */
    async search(namespace: MemoryNamespace, query: RankedMemoryQuery, signal: BotSignal): Promise<RankedMemorySearch> {
        if (signal?.aborted) throw new MemoryError('cancelled');
        if (this.#firewall) {
            let status;
            try {
                status = this.#firewall.status();
            } catch {
                throw new MemoryError('unavailable');
            }
            if (status.mode === 'lockdown' || status.admission !== 'open') throw new MemoryError('unavailable');
        }
        if (!query || typeof query !== 'object' || typeof query.text !== 'string' || query.text.length > MEMORY_RANKING_LIMITS.maxQueryLength) throw new MemoryError('invalid-input');
        for (const key of Object.keys(query)) if (!['text', 'categories', 'tags', 'limit'].includes(key)) throw new MemoryError('invalid-input');
        const limit = query.limit ?? MEMORY_RANKING_LIMITS.defaultLimit;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MEMORY_RANKING_LIMITS.maxLimit) throw new MemoryError('invalid-input');
        const filters = { ...(query.categories ? { categories: query.categories } : {}), ...(query.tags ? { tags: query.tags } : {}) };
        // The store applies namespace, expiry, category and tag filters; the ranker re-orders its candidates.
        const lexical = await this.#store.search(namespace, { text: query.text, ...filters, limit: MEMORY_RANKING_LIMITS.maxLimit, mode: 'lexical' }, signal);
        let fallback: RankedMemorySearch['fallback'] = null;
        const semantic = new Map<string, number>();
        const pool = new Map<string, MemoryRecord>(lexical.map((m) => [m.record.id, m.record]));
        if (this.#mode === 'hybrid') {
            if (!query.text.trim()) fallback = 'embeddings-unavailable';
            else
                try {
                    for (const m of await this.#store.search(namespace, { text: query.text, ...filters, limit: MEMORY_RANKING_LIMITS.maxLimit, mode: 'semantic' }, signal)) {
                        semantic.set(m.record.id, Math.max(0, Math.min(1, (m.score + 1) / 2)));
                        if (!pool.has(m.record.id)) pool.set(m.record.id, m.record);
                    }
                } catch (error) {
                    if (signal?.aborted || (error instanceof MemoryError && error.code === 'cancelled')) throw error;
                    // Deterministic lexical ranking whenever embeddings are missing or fail.
                    fallback = error instanceof MemoryError && error.code === 'unavailable' ? 'embeddings-unavailable' : 'embedding-error';
                    semantic.clear();
                }
        }
        if (signal?.aborted) throw new MemoryError('cancelled');
        const now = this.#now();
        if (!Number.isFinite(now)) throw new MemoryError('invalid-input');
        const wanted = terms(query.text), exactText = query.text.trim().toLowerCase();
        const w = this.#weights;
        const useSemantic = this.#mode === 'hybrid' && fallback === null;
        const totalWeight = w.exact + w.keyword + w.quality + (this.#halfLife ? w.recency : 0) + (useSemantic ? w.semantic : 0);
        const scored = [...pool.values()].map((record) => {
            const haystack = JSON.stringify([record.value, record.metadata, record.tags]).toLowerCase();
            const keyword = wanted.length ? wanted.filter((t) => haystack.includes(t)).length / wanted.length : 0;
            const exact = exactText && ((typeof record.value === 'string' && record.value.trim().toLowerCase() === exactText) || record.id.toLowerCase() === exactText) ? 1 : 0;
            let quality = CATEGORY_QUALITY[record.category] ?? 0;
            if (this.#quality) {
                let q: unknown = 0;
                try {
                    q = this.#quality(record);
                } catch {
                    q = 0;
                }
                quality = typeof q === 'number' && Number.isFinite(q) ? Math.max(0, Math.min(1, q)) : 0;
            }
            const recency = this.#halfLife ? Math.pow(2, -Math.max(0, now - record.updatedAt) / this.#halfLife) : 0;
            const sem = useSemantic ? semantic.get(record.id) ?? 0 : 0;
            const raw = w.exact * exact + w.keyword * keyword + w.quality * quality + (this.#halfLife ? w.recency * recency : 0) + (useSemantic ? w.semantic * sem : 0);
            return { record, score: totalWeight ? raw / totalWeight : 0, components: Object.freeze({ exact, keyword, quality, recency, semantic: sem }) };
        });
        // Deterministic order: score, then record id. Timestamps never break ties.
        scored.sort((a, b) => b.score - a.score || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
        const seen = new Set<string>();
        let suppressed = 0;
        const results: RankedMemoryResult[] = [];
        for (const s of scored) {
            if (this.#dedupe) {
                const key = s.record.category + '\u0000' + canonical(s.record.value);
                if (seen.has(key)) {
                    suppressed++;
                    continue;
                }
                seen.add(key);
            }
            if (results.length < limit) results.push(Object.freeze({ ...s, provenance: provenanceOf(s.record, now) }));
        }
        return Object.freeze({
            format: 'shivax-ranked-memory' as const,
            version: 1 as const,
            mode: this.#mode,
            fallback,
            candidates: pool.size,
            suppressedDuplicates: suppressed,
            results: Object.freeze(results),
        });
    }
}

/**
 * Deterministic, CPU-only embeddings by feature hashing (FNV-1a over terms, signed buckets). No network, no
 * model download, no vector database: vectors live inside the tenant's own memory records. It captures shared
 * vocabulary, not meaning; use a real model adapter when semantic similarity matters.
 */
export function createHashingEmbeddings(options: { readonly id?: string; readonly dimensions?: number } = {}): MemoryEmbeddingsAdapter {
    const id = options.id ?? 'shivax-hashing-v1', dimensions = options.dimensions ?? 256;
    if (!isRef(id) || !Number.isSafeInteger(dimensions) || dimensions < 8 || dimensions > 4096) throw new MemoryError('invalid-input');
    return Object.freeze({
        id,
        dimensions,
        networkOrigins: Object.freeze([]),
        embed(text: string) {
            if (typeof text !== 'string' || text.length > 1_048_576) throw new MemoryError('invalid-input');
            const v: number[] = Array.from({ length: dimensions }, () => 0);
            for (const term of text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
                let h = 0x811c9dc5;
                for (let i = 0; i < term.length; i++) h = Math.imul(h ^ term.charCodeAt(i), 0x01000193) >>> 0;
                v[h % dimensions] += h & 0x80000000 ? -1 : 1;
            }
            // A text without terms still yields a valid nonzero vector (the engine rejects zero vectors).
            if (!v.some((x) => x !== 0)) v[0] = 1;
            return v;
        },
    });
}
