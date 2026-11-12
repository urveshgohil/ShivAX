import type { BotSignal } from '../agents/types.js';

/*
 * SARASWATI S06: offline retrieval evaluation. Compares a baseline and a candidate retrieval strategy on
 * labelled queries. Metrics are computed only where ground truth exists; nothing is estimated or invented.
 */

export interface LabelledRetrievalQuery {
    readonly id: string;
    readonly text: string;
    /** Ground-truth relevant record ids. Empty: no record should be returned as relevant (precision is still measured). */
    readonly relevant: readonly string[];
    /** Record ids that must never appear (for example another tenant's or another session's records). */
    readonly forbidden?: readonly string[];
}
export interface RetrievalStrategyMetrics {
    readonly queries: number;
    /** Means over queries with at least one relevant id; null when there are none. */
    readonly precisionAtK: number | null;
    readonly recallAtK: number | null;
    readonly meanReciprocalRank: number | null;
    /** Share of queries with relevant ids where none appeared in the top K. */
    readonly missingRate: number | null;
    /** Queries with forbidden ids where none appeared (1 = always denied correctly); null without forbidden ids. */
    readonly crossTenantDenial: number | null;
    /** Forbidden ids returned, summed over queries. Must be 0. */
    readonly forbiddenReturned: number;
    /** Queries whose retrieval failed (thrown error). Counted as returning nothing. */
    readonly errors: number;
}
export interface RetrievalEvaluation {
    readonly k: number;
    readonly baseline: RetrievalStrategyMetrics;
    readonly candidate: RetrievalStrategyMetrics;
    readonly delta: { readonly precisionAtK: number | null; readonly recallAtK: number | null; readonly meanReciprocalRank: number | null; readonly missingRate: number | null };
    /** `improved` only with at least `minQueries` labelled queries, a higher MRR, no lower recall and no forbidden results. */
    readonly verdict: 'improved' | 'no-change' | 'regressed' | 'insufficient-evidence';
}
type Retrieve = (query: LabelledRetrievalQuery, signal: BotSignal) => Promise<readonly string[]> | readonly string[];

const REF = /^[A-Za-z0-9._:-]{1,256}$/;
function invalid(what: string): never {
    throw new Error(`Invalid retrieval evaluation: ${what}.`);
}

export async function evaluateMemoryRetrieval(input: {
    readonly k: number;
    readonly queries: readonly LabelledRetrievalQuery[];
    readonly baseline: Retrieve;
    readonly candidate: Retrieve;
    readonly minQueries?: number;
    readonly signal: BotSignal;
}): Promise<RetrievalEvaluation> {
    if (!input || typeof input !== 'object') invalid('input');
    const { k, queries, signal } = input;
    if (!Number.isSafeInteger(k) || k < 1 || k > 50) invalid('k');
    if (!Array.isArray(queries) || !queries.length || queries.length > 1_000) invalid('queries');
    if (typeof input.baseline !== 'function' || typeof input.candidate !== 'function') invalid('strategies');
    const minQueries = input.minQueries ?? 10;
    if (!Number.isSafeInteger(minQueries) || minQueries < 1) invalid('minQueries');
    const ids = new Set<string>();
    for (const q of queries) {
        if (!q || !REF.test(q.id) || ids.has(q.id) || typeof q.text !== 'string' || !Array.isArray(q.relevant) || q.relevant.some((r: string) => !REF.test(r)) || (q.forbidden !== undefined && (!Array.isArray(q.forbidden) || q.forbidden.some((r: string) => !REF.test(r)))))
            invalid('query');
        if (q.forbidden?.some((f: string) => q.relevant.includes(f))) invalid('query (relevant and forbidden overlap)');
        ids.add(q.id);
    }
    const measure = async (retrieve: Retrieve): Promise<RetrievalStrategyMetrics> => {
        let p = 0, r = 0, rr = 0, missing = 0, labelled = 0, denialQueries = 0, denied = 0, forbiddenReturned = 0, errors = 0;
        for (const q of queries) {
            signal?.throwIfAborted();
            let returned: readonly string[];
            try {
                const raw = await retrieve(q, signal);
                if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw 0;
                returned = raw;
            } catch {
                if (signal?.aborted) throw new Error('Retrieval evaluation cancelled.');
                errors++;
                returned = [];
            }
            const top = [...new Set(returned)].slice(0, k);
            if (q.relevant.length) {
                labelled++;
                const hits = top.filter((id) => q.relevant.includes(id)).length;
                p += hits / k;
                r += hits / q.relevant.length;
                const first = top.findIndex((id) => q.relevant.includes(id));
                rr += first >= 0 ? 1 / (first + 1) : 0;
                if (!hits) missing++;
            }
            if (q.forbidden?.length) {
                denialQueries++;
                const leaked = returned.filter((id) => q.forbidden!.includes(id)).length;
                forbiddenReturned += leaked;
                if (!leaked) denied++;
            }
        }
        const mean = (x: number) => (labelled ? x / labelled : null);
        return Object.freeze({
            queries: queries.length,
            precisionAtK: mean(p),
            recallAtK: mean(r),
            meanReciprocalRank: mean(rr),
            missingRate: mean(missing),
            crossTenantDenial: denialQueries ? denied / denialQueries : null,
            forbiddenReturned,
            errors,
        });
    };
    const baseline = await measure(input.baseline);
    const candidate = await measure(input.candidate);
    const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);
    const labelled = queries.filter((q) => q.relevant.length).length;
    let verdict: RetrievalEvaluation['verdict'];
    if (labelled < minQueries) verdict = 'insufficient-evidence';
    else if (
        candidate.forbiddenReturned > 0 ||
        (candidate.meanReciprocalRank ?? 0) < (baseline.meanReciprocalRank ?? 0) ||
        (candidate.recallAtK ?? 0) < (baseline.recallAtK ?? 0) ||
        candidate.errors > baseline.errors
    )
        verdict = 'regressed';
    else if ((candidate.meanReciprocalRank ?? 0) > (baseline.meanReciprocalRank ?? 0)) verdict = 'improved';
    else verdict = 'no-change';
    return Object.freeze({
        k,
        baseline,
        candidate,
        delta: Object.freeze({
            precisionAtK: diff(baseline.precisionAtK, candidate.precisionAtK),
            recallAtK: diff(baseline.recallAtK, candidate.recallAtK),
            meanReciprocalRank: diff(baseline.meanReciprocalRank, candidate.meanReciprocalRank),
            missingRate: diff(baseline.missingRate, candidate.missingRate),
        }),
        verdict,
    });
}
