import type { BotSignal, BotValue } from '../agents/types.js';
import { array, identifier, record, snapshotValue } from '../agents/validation.js';
import { costUSD, costUnits } from '../intelligence/cost.js';
import { EVALUATION_DOMAINS, validateEvaluationDataset, type EvaluationDomain } from './index.js';
import { canonicalLearningJSON, digestLearningValue, type FeedbackOwner } from './provenance.js';
import { validateTrainingExport } from './training.js';

/*
 * SARASWATI S02: reproducible, versioned benchmarks.
 *
 * - Suites are versioned, hashed and owned by one tenant. Every case carries a ground-truth label whose
 *   origin is a human review, the host, a computed measurement or a design source; inferred labels are refused.
 * - The host supplies the evaluator (trusted code). It never sees labels. A `model-judge` evaluator is recorded
 *   as not ground truth and can never make a candidate eligible.
 * - Reports keep per-case scores. Every summary number is recomputed from them on validation, and the report
 *   carries a logical digest (everything except timing) and an integrity digest.
 * - Model-estimated confidence is reported separately and never used for scoring.
 */

export const BENCHMARK_LIMITS = Object.freeze({
    maxCases: 512,
    maxCaseBytes: 65_536,
    maxBytes: 1_048_576,
    maxCriteria: 16,
    maxPathDepth: 16,
    maxIssues: 256,
    maxMemoryResults: 100,
    maxK: 100,
    maxChecks: 100_000,
    maxRunTimeoutMs: 3_600_000,
    maxCaseTimeoutMs: 300_000,
    maxTrustedEvaluators: 64,
    maxTrainingExports: 16,
});
/** Where a label came from. `inferred` (model or heuristic) labels are not ground truth and are rejected. */
export const BENCHMARK_LABEL_ORIGINS = Object.freeze(['human-review', 'host', 'computed', 'design'] as const);
export type BenchmarkLabelOrigin = (typeof BENCHMARK_LABEL_ORIGINS)[number];
/** `model-judge`: an LLM or other model grades outputs. Its results are recorded as not ground truth. */
export const BENCHMARK_EVALUATOR_KINDS = Object.freeze(['deterministic', 'fixture', 'model-judge'] as const);
export type BenchmarkEvaluatorKind = (typeof BENCHMARK_EVALUATOR_KINDS)[number];
export const BENCHMARK_ERROR_CATEGORIES = Object.freeze([
    'mismatch',
    'invalid-output',
    'incomplete',
    'invalid-observation',
    'evaluator-error',
    'timeout',
    'security-violation',
] as const);
export type BenchmarkErrorCategory = (typeof BENCHMARK_ERROR_CATEGORIES)[number];
/** Measured-versus-inferred origin of a detected visual issue (ShivAX visual analysis vocabulary). */
export const VISUAL_EVIDENCE_ORIGINS = Object.freeze(['computed', 'design', 'estimated', 'inferred'] as const);
export type VisualEvidenceOrigin = (typeof VISUAL_EVIDENCE_ORIGINS)[number];
export const BENCHMARK_GATE_REASONS = Object.freeze([
    'untrusted-evaluator',
    'not-ground-truth',
    'dataset-leakage',
    'unevaluated-cases',
    'mandatory-case-failed',
    'security-violation',
    'security-regression',
    'domain-not-evaluated',
    'below-minimum',
    'regression',
    'latency-limit',
    'usage-unverified',
    'cost-limit',
    'token-limit',
] as const);
export type BenchmarkGateReason = (typeof BENCHMARK_GATE_REASONS)[number];

/* ------------------------------------------------------------------ labels */

export type BenchmarkLabel =
    /** Any domain: exact canonical-JSON match (the v1 `evaluateDataset` semantics). */
    | { readonly method: 'exact'; readonly expected: BotValue }
    /** routing: the specialist bot that must be selected; `null` means no specialist (fallback) is expected. */
    | { readonly botId: string | null }
    /** reasoning: task-specific criteria; each path in the output must equal the verified value. */
    | { readonly method: 'fields'; readonly fields: readonly { readonly path: readonly (string | number)[]; readonly equals: BotValue }[] }
    /** code: a safe change that must apply (checked by expected output and/or host checks), or an unsafe change that must be rejected. */
    | { readonly outcome: 'apply'; readonly expected?: BotValue; readonly requireChecks?: boolean }
    | { readonly outcome: 'reject' }
    /** visual: ground-truth issue ids annotated for this input. An empty list means "no issues". */
    | { readonly issues: readonly string[] }
    /** permission: the authorization decision. `deny` cases are mandatory security cases. */
    | { readonly decision: 'allow' | 'deny' }
    /** memory: ids that must appear within the top `k` results, all inside `scope`. */
    | { readonly relevant: readonly string[]; readonly k: number; readonly scope: FeedbackOwner };

export interface BenchmarkCase {
    readonly id: string;
    readonly domain: EvaluationDomain;
    readonly input: BotValue;
    readonly label: BenchmarkLabel;
    /** Where the label came from and an optional opaque reference (for example the feedback id it was taken from). */
    readonly provenance: { readonly origin: BenchmarkLabelOrigin; readonly ref?: string };
    /** Mandatory cases must pass at 100%. Permission `deny` and code `reject` cases are always mandatory. */
    readonly mandatory?: boolean;
}
export interface BenchmarkSuite {
    readonly format: 'shivax-benchmark-suite';
    readonly version: 1;
    readonly id: string;
    readonly suiteVersion: string;
    readonly owner: FeedbackOwner;
    /** `digest` is SHA-256 over the canonical `cases`; it is recomputed on every validation. */
    readonly dataset: { readonly id: string; readonly version: number; readonly digest: string };
    /** Fixed seed handed to the evaluator and used for sampling. */
    readonly seed?: string;
    /** Fixed-seed sample of `size` cases. Mandatory cases are always included. */
    readonly sampling?: { readonly size: number };
    readonly cases: readonly BenchmarkCase[];
}

/* -------------------------------------------------------------- evaluator */

export interface BenchmarkUsage {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly costUSD: number | null;
    /** True only when the host took these numbers from verified provider accounting (for example ModelRouter results). */
    readonly verified: boolean;
}
export interface BenchmarkObservation {
    readonly completed: boolean;
    /** The host's structured-output validation result. */
    readonly valid: boolean;
    /** Domain shape for domain labels (see docs/learning-benchmarks.md); any value for `exact` labels. */
    readonly actual: BotValue;
    readonly usage?: BenchmarkUsage;
    /** Model self-estimate in [0, 1]. Reported separately; never scored. */
    readonly estimatedConfidence?: number;
}
export interface BenchmarkEvaluationRequest {
    readonly caseId: string;
    readonly domain: EvaluationDomain;
    readonly input: BotValue;
    readonly seed: string | null;
    readonly configuration: { readonly role: 'baseline' | 'candidate'; readonly id: string; readonly version: string };
    readonly signal: BotSignal;
}
/** Trusted host code. It receives inputs only, never labels. */
export interface BenchmarkEvaluator {
    readonly id: string;
    readonly version: string;
    readonly kind: BenchmarkEvaluatorKind;
    evaluate(request: BenchmarkEvaluationRequest): Promise<BenchmarkObservation> | BenchmarkObservation;
}
export interface BenchmarkRunOptions {
    /** Tenant the run belongs to. Must equal the suite owner. */
    readonly owner: FeedbackOwner;
    /** `value` (optional) is digested into the report so the exact configuration is identifiable. */
    readonly configuration: {
        readonly role: 'baseline' | 'candidate';
        readonly id: string;
        readonly version: string;
        readonly value?: BotValue;
    };
    readonly signal: BotSignal;
    /** Whole run. Default 300 000 ms, maximum 3 600 000 ms. Exceeding it rejects the run. */
    readonly timeoutMs?: number;
    /** Each case. Default 30 000 ms, maximum 300 000 ms. Exceeding it fails the case as `timeout`. */
    readonly caseTimeoutMs?: number;
    /** v1 training exports the configuration was trained on. Any overlap rejects the run. */
    readonly training?: readonly unknown[];
    /** Host clock for `ranAt`. */
    readonly now?: () => number;
}

/* ----------------------------------------------------------------- report */

export type BenchmarkCaseScore =
    | { readonly kind: 'exact'; readonly matched: boolean }
    | {
          readonly kind: 'routing';
          readonly expected: 'specialist' | 'fallback';
          readonly outcome: 'correct' | 'misrouted' | 'unrouted' | 'fallback-correct' | 'fallback-missed' | 'none';
      }
    | { readonly kind: 'reasoning'; readonly criteriaMet: number; readonly criteriaTotal: number }
    | {
          readonly kind: 'code';
          readonly unsafe: boolean;
          readonly outcome: 'applied' | 'rejected' | null;
          readonly matched: boolean;
          readonly checksPassed: number;
          readonly checksTotal: number;
      }
    | {
          readonly kind: 'visual';
          readonly labelled: number;
          readonly truePositives: number;
          readonly falsePositives: number;
          readonly falseNegatives: number;
          readonly truePositiveEvidence: Readonly<Record<VisualEvidenceOrigin, number>>;
          readonly falsePositiveEvidence: Readonly<Record<VisualEvidenceOrigin, number>>;
      }
    | { readonly kind: 'permission'; readonly expected: 'allow' | 'deny'; readonly actual: 'allow' | 'deny' | null }
    | {
          readonly kind: 'memory';
          readonly k: number;
          readonly relevant: number;
          readonly hits: number;
          readonly returned: number;
          readonly reciprocalRank: number;
          readonly scopeViolations: number;
      };
export interface BenchmarkCaseResult {
    readonly id: string;
    readonly domain: EvaluationDomain;
    /** `exact` = canonical JSON match; `domain` = domain-specific scoring. */
    readonly scoring: 'exact' | 'domain';
    readonly security: boolean;
    readonly mandatory: boolean;
    readonly passed: boolean;
    readonly category: BenchmarkErrorCategory | null;
    readonly completed: boolean;
    readonly valid: boolean;
    readonly score: BenchmarkCaseScore;
    /** Measured wall time. Excluded from the logical digest. */
    readonly latencyMs: number;
    readonly usage: BenchmarkUsage | null;
    readonly estimatedConfidence: number | null;
}
export interface BenchmarkLatency {
    readonly count: number;
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly p50: number;
    readonly p90: number;
    readonly p95: number;
    readonly p99: number;
}
interface DomainBase {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly passRate: number | null;
}
export interface BenchmarkDomainMetrics {
    readonly routing: DomainBase & {
        readonly correct: number;
        readonly misrouted: number;
        readonly unrouted: number;
        readonly fallbackExpected: number;
        readonly fallbackCorrect: number;
    };
    readonly reasoning: DomainBase & { readonly criteriaMet: number; readonly criteriaTotal: number };
    readonly code: DomainBase & {
        readonly validOutputs: number;
        readonly checksPassed: number;
        readonly checksTotal: number;
        readonly unsafeCases: number;
        readonly unsafeRejected: number;
        readonly unsafeApplied: number;
    };
    readonly visual: DomainBase & {
        readonly annotatedCases: number;
        readonly truePositives: number;
        readonly falsePositives: number;
        readonly falseNegatives: number;
        readonly precision: number | null;
        readonly recall: number | null;
        readonly truePositiveEvidence: Readonly<Record<VisualEvidenceOrigin, number>>;
        readonly falsePositiveEvidence: Readonly<Record<VisualEvidenceOrigin, number>>;
    };
    readonly permission: DomainBase & {
        readonly allowCases: number;
        readonly denyCases: number;
        readonly denialsHeld: number;
        readonly violations: number;
        readonly overDenials: number;
    };
    readonly memory: DomainBase & {
        readonly relevant: number;
        readonly hitsWithinK: number;
        readonly recallAtK: number | null;
        readonly precisionAtK: number | null;
        readonly meanReciprocalRank: number | null;
        readonly scopeViolations: number;
    };
}
export interface BenchmarkSummary {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly passRate: number;
    readonly mandatory: { readonly total: number; readonly passed: number; readonly failed: number };
    readonly securityViolations: number;
    readonly scoring: { readonly exact: number; readonly domain: number };
    readonly errors: Readonly<Record<BenchmarkErrorCategory, number>>;
    readonly domains: BenchmarkDomainMetrics;
    readonly latency: {
        readonly overall: BenchmarkLatency;
        readonly domains: Readonly<Record<EvaluationDomain, BenchmarkLatency | null>>;
    };
    /** Totals cover verified usage only. `complete` is true only when every case reported verified usage. */
    readonly usage: {
        readonly reportedCases: number;
        readonly verifiedCases: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly costUSD: number;
        readonly complete: boolean;
    };
    /** Model self-estimates, kept apart from measured results. */
    readonly estimatedConfidence: { readonly reportedCases: number; readonly mean: number | null };
}
export interface BenchmarkReport {
    readonly format: 'shivax-benchmark-report';
    readonly version: 1;
    readonly benchmark: { readonly id: string; readonly suiteVersion: string; readonly schemaVersion: 1 };
    readonly dataset: { readonly id: string; readonly version: number; readonly digest: string };
    readonly owner: FeedbackOwner;
    readonly evaluator: {
        readonly id: string;
        readonly version: string;
        readonly kind: BenchmarkEvaluatorKind;
        /** False for `model-judge`. Such reports never make a candidate eligible. */
        readonly groundTruth: boolean;
    };
    readonly configuration: {
        readonly role: 'baseline' | 'candidate';
        readonly id: string;
        readonly version: string;
        readonly digest: string | null;
    };
    readonly seed: string | null;
    readonly sampled: boolean;
    readonly ranAt: number;
    readonly cases: readonly BenchmarkCaseResult[];
    readonly summary: BenchmarkSummary;
    /** Imported reports are data. They never authorize activation. */
    readonly trust: 'untrusted';
    /** SHA-256 of the report without timing (`ranAt`, latencies) and digests. Equal across reproducible runs. */
    readonly logicalDigest: string;
    /** SHA-256 of the report without `digest`. Integrity only; not authenticity. */
    readonly digest: string;
}

/* ------------------------------------------------------------- utilities */

const REF = /^[A-Za-z0-9._:-]{1,256}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RUN_FAILURES: readonly BenchmarkErrorCategory[] = ['timeout', 'evaluator-error', 'invalid-observation'];

function invalid(what: string): never {
    throw new Error(`Invalid ${what}.`);
}
function ref(value: unknown, what: string): asserts value is string {
    if (typeof value !== 'string' || !REF.test(value)) invalid(what);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): asserts value is T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) invalid(what);
}
function fields(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
    try {
        return record(value, keys, 'invalid-input');
    } catch {
        return invalid(what);
    }
}
function list(value: unknown, max: number, what: string): readonly unknown[] {
    try {
        return array(value, max, 'invalid-input');
    } catch {
        return invalid(what);
    }
}
function snapshot(value: unknown, bytes: number, what: string): BotValue {
    try {
        return snapshotValue(value, bytes, 'invalid-input');
    } catch {
        return invalid(what);
    }
}
function count(value: unknown, max: number, what: string): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) invalid(what);
}
function rate(value: unknown, what: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid(what);
}
function owner(value: unknown, what: string): FeedbackOwner {
    const v = fields(value, ['scopeKind', 'scopeId'], what);
    oneOf(v.scopeKind, ['personal', 'company'] as const, what);
    ref(v.scopeId, what);
    return v as unknown as FeedbackOwner;
}
function sameOwner(a: FeedbackOwner, b: FeedbackOwner): boolean {
    return a.scopeKind === b.scopeKind && a.scopeId === b.scopeId;
}
function ids(value: unknown, max: number, what: string): readonly string[] {
    const items = list(value, max, what);
    items.forEach((i) => ref(i, what));
    if (new Set(items).size !== items.length) invalid(`${what} (duplicate)`);
    return items as readonly string[];
}
const same = (a: unknown, b: unknown) => canonicalLearningJSON(a as BotValue) === canonicalLearningJSON(b as BotValue);
const ratio = (n: number, d: number) => (d ? n / d : null);
const evidenceCounts = (): Record<VisualEvidenceOrigin, number> => ({ computed: 0, design: 0, estimated: 0, inferred: 0 });

/* ------------------------------------------------------------------ suite */

function parseLabel(domain: EvaluationDomain, raw: unknown): BenchmarkLabel {
    const v = fields(raw, ['method', 'expected', 'botId', 'fields', 'outcome', 'requireChecks', 'issues', 'decision', 'relevant', 'k', 'scope'], 'label');
    const only = (keys: string[]) => {
        if (Object.keys(v).some((k) => !keys.includes(k)) || keys.some((k) => !(k in v) && k !== 'expected' && k !== 'requireChecks'))
            invalid(`${domain} label`);
    };
    if (v.method === 'exact') {
        if (Object.keys(v).length !== 2 || !('expected' in v)) invalid('exact label');
        return v as unknown as BenchmarkLabel;
    }
    switch (domain) {
        case 'routing':
            only(['botId']);
            if (v.botId !== null) identifier(v.botId, 'invalid-input');
            break;
        case 'reasoning': {
            only(['method', 'fields']);
            if (v.method !== 'fields') invalid('reasoning label');
            const criteria = list(v.fields, BENCHMARK_LIMITS.maxCriteria, 'reasoning criteria');
            if (!criteria.length) invalid('reasoning criteria');
            for (const c of criteria) {
                const f = fields(c, ['path', 'equals'], 'reasoning criterion');
                const path = list(f.path, BENCHMARK_LIMITS.maxPathDepth, 'reasoning path');
                if (!path.length || !('equals' in f)) invalid('reasoning criterion');
                for (const p of path)
                    if (!(typeof p === 'string' && p.length <= 256) && !(Number.isSafeInteger(p) && (p as number) >= 0))
                        invalid('reasoning path');
            }
            break;
        }
        case 'code':
            if (v.outcome === 'reject') only(['outcome']);
            else if (v.outcome === 'apply') {
                only(['outcome', 'expected', 'requireChecks']);
                if ('requireChecks' in v && typeof v.requireChecks !== 'boolean') invalid('code label');
                // A correctness criterion is required: model fluency is never accepted as correctness.
                if (!('expected' in v) && v.requireChecks !== true) invalid('code label (no correctness criterion)');
            } else invalid('code label');
            break;
        case 'visual':
            only(['issues']);
            ids(v.issues, BENCHMARK_LIMITS.maxIssues, 'visual label issues');
            break;
        case 'permission':
            only(['decision']);
            oneOf(v.decision, ['allow', 'deny'] as const, 'permission label');
            break;
        case 'memory':
            only(['relevant', 'k', 'scope']);
            ids(v.relevant, BENCHMARK_LIMITS.maxK, 'memory label relevant ids');
            count(v.k, BENCHMARK_LIMITS.maxK, 'memory label k');
            if ((v.k as number) < 1 || (v.relevant as unknown[]).length > (v.k as number)) invalid('memory label k');
            owner(v.scope, 'memory label scope');
            break;
    }
    return v as unknown as BenchmarkLabel;
}
function isExact(label: BenchmarkLabel): label is { method: 'exact'; expected: BotValue } {
    return (label as { method?: string }).method === 'exact';
}
function isSecurity(c: Pick<BenchmarkCase, 'domain' | 'label'>): boolean {
    const l = c.label as { decision?: string; outcome?: string };
    return (c.domain === 'permission' && l.decision === 'deny') || (c.domain === 'code' && l.outcome === 'reject');
}

function parseSuite(raw: unknown): BenchmarkSuite {
    const safe = snapshot(raw, BENCHMARK_LIMITS.maxBytes, 'benchmark suite');
    const v = fields(safe, ['format', 'version', 'id', 'suiteVersion', 'owner', 'dataset', 'seed', 'sampling', 'cases'], 'benchmark suite');
    if (v.format !== 'shivax-benchmark-suite' || v.version !== 1) invalid('benchmark suite version');
    ref(v.id, 'benchmark id');
    ref(v.suiteVersion, 'benchmark suite version');
    owner(v.owner, 'benchmark owner');
    const dataset = fields(v.dataset, ['id', 'version', 'digest'], 'benchmark dataset');
    ref(dataset.id, 'benchmark dataset id');
    count(dataset.version, 1_000_000, 'benchmark dataset version');
    if ((dataset.version as number) < 1) invalid('benchmark dataset version');
    if (typeof dataset.digest !== 'string' || !DIGEST.test(dataset.digest)) invalid('benchmark dataset digest');
    if ('seed' in v) ref(v.seed, 'benchmark seed');
    const cases = list(v.cases, BENCHMARK_LIMITS.maxCases, 'benchmark cases');
    if (!cases.length) invalid('benchmark cases');
    const seen = new Set<string>();
    for (const raw of cases) {
        snapshot(raw, BENCHMARK_LIMITS.maxCaseBytes, 'benchmark case');
        const c = fields(raw, ['id', 'domain', 'input', 'label', 'provenance', 'mandatory'], 'benchmark case');
        identifier(c.id, 'invalid-input');
        if (seen.has(c.id as string)) throw new Error('Duplicate benchmark case id.');
        seen.add(c.id as string);
        oneOf(c.domain, EVALUATION_DOMAINS, 'benchmark case domain');
        if (!('input' in c)) invalid('benchmark case input');
        if (!('label' in c)) throw new Error('Benchmark case label is missing.');
        parseLabel(c.domain as EvaluationDomain, c.label);
        const p = fields(c.provenance, ['origin', 'ref'], 'benchmark case provenance');
        oneOf(p.origin, BENCHMARK_LABEL_ORIGINS, 'benchmark label origin');
        if ('ref' in p) ref(p.ref, 'benchmark case provenance ref');
        if ('mandatory' in c && typeof c.mandatory !== 'boolean') invalid('benchmark case mandatory flag');
    }
    if ('sampling' in v) {
        const s = fields(v.sampling, ['size'], 'benchmark sampling');
        if (!('seed' in v)) invalid('benchmark sampling (seed required)');
        count(s.size, cases.length, 'benchmark sample size');
        const mandatory = (cases as BenchmarkCase[]).filter((c) => c.mandatory === true || isSecurity(c)).length;
        if ((s.size as number) < Math.max(1, mandatory)) invalid('benchmark sample size (below mandatory cases)');
    }
    return safe as unknown as BenchmarkSuite;
}
/** Validates the suite and recomputes its dataset digest. */
export async function validateBenchmarkSuite(raw: unknown): Promise<BenchmarkSuite> {
    const suite = parseSuite(raw);
    if ((await digestLearningValue(suite.cases)) !== suite.dataset.digest) throw new Error('Benchmark dataset digest mismatch.');
    return suite;
}
/** Builds a suite and computes its dataset digest. */
export async function createBenchmarkSuite(input: {
    readonly id: string;
    readonly suiteVersion: string;
    readonly owner: FeedbackOwner;
    readonly dataset: { readonly id: string; readonly version: number };
    readonly seed?: string;
    readonly sampling?: { readonly size: number };
    readonly cases: readonly unknown[];
}): Promise<BenchmarkSuite> {
    const v = fields(input, ['id', 'suiteVersion', 'owner', 'dataset', 'seed', 'sampling', 'cases'], 'benchmark suite input');
    const dataset = fields(v.dataset, ['id', 'version'], 'benchmark dataset');
    const cases = snapshot(v.cases, BENCHMARK_LIMITS.maxBytes, 'benchmark cases');
    return validateBenchmarkSuite({
        format: 'shivax-benchmark-suite',
        version: 1,
        id: v.id,
        suiteVersion: v.suiteVersion,
        owner: v.owner,
        dataset: { id: dataset.id, version: dataset.version, digest: await digestLearningValue(cases) },
        ...('seed' in v ? { seed: v.seed } : {}),
        ...('sampling' in v ? { sampling: v.sampling } : {}),
        cases,
    });
}
/**
 * Converts an existing v1 evaluation dataset (`validateEvaluationDataset`) into a suite of `exact` cases.
 * Exact cases are never security cases; add domain labels for denial and scope checks.
 */
export function benchmarkSuiteFromEvaluationDataset(
    dataset: unknown,
    meta: {
        readonly id: string;
        readonly suiteVersion: string;
        readonly owner: FeedbackOwner;
        readonly dataset: { readonly id: string; readonly version: number };
        readonly origin: BenchmarkLabelOrigin;
        readonly seed?: string;
    }
): Promise<BenchmarkSuite> {
    const cases = validateEvaluationDataset(dataset);
    oneOf(meta?.origin, BENCHMARK_LABEL_ORIGINS, 'benchmark label origin');
    return createBenchmarkSuite({
        id: meta.id,
        suiteVersion: meta.suiteVersion,
        owner: meta.owner,
        dataset: meta.dataset,
        ...(meta.seed !== undefined ? { seed: meta.seed } : {}),
        cases: cases.map((c) => ({
            id: c.id,
            domain: c.domain,
            input: c.input,
            label: { method: 'exact', expected: c.expected },
            provenance: { origin: meta.origin },
        })),
    });
}
/** The cases a run evaluates, in suite order: all of them, or a fixed-seed sample that always keeps mandatory cases. */
export async function selectBenchmarkCases(raw: unknown): Promise<readonly BenchmarkCase[]> {
    const suite = await validateBenchmarkSuite(raw);
    if (!suite.sampling) return suite.cases;
    const mandatory = suite.cases.filter((c) => c.mandatory === true || isSecurity(c));
    const keyed: [string, string][] = [];
    for (const c of suite.cases)
        if (!mandatory.includes(c)) keyed.push([await digestLearningValue(['shivax-benchmark-sample-v1', suite.seed!, c.id]), c.id]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const chosen = new Set([...mandatory.map((c) => c.id), ...keyed.slice(0, suite.sampling.size - mandatory.length).map((k) => k[1])]);
    return Object.freeze(suite.cases.filter((c) => chosen.has(c.id)));
}

export interface BenchmarkLeak {
    readonly caseId: string;
    readonly feedbackId: string;
    readonly kind: 'input' | 'feedback-id';
}
/** Reports benchmark cases whose input or provenance reference also appears in v1 training exports. */
export async function checkBenchmarkLeakage(
    rawSuite: unknown,
    trainingExports: readonly unknown[]
): Promise<{ readonly ok: boolean; readonly leaks: readonly BenchmarkLeak[] }> {
    const suite = await validateBenchmarkSuite(rawSuite);
    const exports = list(trainingExports, BENCHMARK_LIMITS.maxTrainingExports, 'training exports');
    const byInput = new Map<string, string>(), byId = new Set<string>();
    for (const e of exports)
        for (const row of validateTrainingExport(e)) {
            byId.add(row.feedbackId);
            const key = canonicalLearningJSON(row.input);
            if (!byInput.has(key)) byInput.set(key, row.feedbackId);
        }
    const leaks: BenchmarkLeak[] = [];
    for (const c of suite.cases) {
        const hit = byInput.get(canonicalLearningJSON(c.input));
        if (hit !== undefined) leaks.push(Object.freeze({ caseId: c.id, feedbackId: hit, kind: 'input' as const }));
        if (c.provenance.ref !== undefined && byId.has(c.provenance.ref))
            leaks.push(Object.freeze({ caseId: c.id, feedbackId: c.provenance.ref, kind: 'feedback-id' as const }));
    }
    return Object.freeze({ ok: leaks.length === 0, leaks: Object.freeze(leaks) });
}

/* ---------------------------------------------------------------- scoring */

/** The score of a case with no usable observation. Only label-derived facts are filled in. */
function emptyScore(c: BenchmarkCase): BenchmarkCaseScore {
    const l = c.label as Record<string, unknown>;
    if (isExact(c.label)) return { kind: 'exact', matched: false };
    switch (c.domain) {
        case 'routing':
            return { kind: 'routing', expected: l.botId === null ? 'fallback' : 'specialist', outcome: 'none' };
        case 'reasoning':
            return { kind: 'reasoning', criteriaMet: 0, criteriaTotal: (l.fields as unknown[]).length };
        case 'code':
            return { kind: 'code', unsafe: l.outcome === 'reject', outcome: null, matched: false, checksPassed: 0, checksTotal: 0 };
        case 'visual': {
            const labelled = (l.issues as unknown[]).length;
            return { kind: 'visual', labelled, truePositives: 0, falsePositives: 0, falseNegatives: labelled, truePositiveEvidence: evidenceCounts(), falsePositiveEvidence: evidenceCounts() };
        }
        case 'permission':
            return { kind: 'permission', expected: l.decision as 'allow' | 'deny', actual: null };
        case 'memory':
            return { kind: 'memory', k: l.k as number, relevant: (l.relevant as unknown[]).length, hits: 0, returned: 0, reciprocalRank: 0, scopeViolations: 0 };
    }
}
function at(value: BotValue, path: readonly (string | number)[]): { found: boolean; value?: BotValue } {
    let current: BotValue = value;
    for (const key of path) {
        if (typeof key === 'number') {
            if (!Array.isArray(current) || key >= current.length) return { found: false };
            current = current[key];
        } else {
            if (current === null || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key))
                return { found: false };
            current = (current as Readonly<Record<string, BotValue>>)[key];
        }
    }
    return { found: true, value: current };
}
/** Scores a shape-valid `actual`. Throws when `actual` does not have the domain shape. */
function scoreActual(c: BenchmarkCase, actual: BotValue): BenchmarkCaseScore {
    const l = c.label as Record<string, unknown>;
    if (isExact(c.label)) return { kind: 'exact', matched: same(actual, c.label.expected) };
    switch (c.domain) {
        case 'routing': {
            const a = fields(actual, ['botId'], 'routing observation');
            if (a.botId !== null) identifier(a.botId, 'invalid-output');
            const expected = l.botId === null ? 'fallback' : 'specialist';
            const outcome =
                expected === 'fallback'
                    ? a.botId === null ? 'fallback-correct' : 'fallback-missed'
                    : a.botId === l.botId ? 'correct' : a.botId === null ? 'unrouted' : 'misrouted';
            return { kind: 'routing', expected, outcome };
        }
        case 'reasoning': {
            const criteria = l.fields as { path: (string | number)[]; equals: BotValue }[];
            const met = criteria.filter((f) => {
                const hit = at(actual, f.path);
                return hit.found && same(hit.value, f.equals);
            }).length;
            return { kind: 'reasoning', criteriaMet: met, criteriaTotal: criteria.length };
        }
        case 'code': {
            const a = fields(actual, ['outcome', 'output', 'checks'], 'code observation');
            oneOf(a.outcome, ['applied', 'rejected'] as const, 'code observation outcome');
            let checksPassed = 0, checksTotal = 0;
            if ('checks' in a) {
                const k = fields(a.checks, ['passed', 'total'], 'code observation checks');
                count(k.passed, BENCHMARK_LIMITS.maxChecks, 'code checks');
                count(k.total, BENCHMARK_LIMITS.maxChecks, 'code checks');
                if ((k.passed as number) > (k.total as number)) invalid('code checks');
                checksPassed = k.passed as number;
                checksTotal = k.total as number;
            }
            const matched = l.outcome === 'apply' && 'expected' in l ? 'output' in a && same(a.output, l.expected) : l.outcome === 'apply';
            return { kind: 'code', unsafe: l.outcome === 'reject', outcome: a.outcome, matched, checksPassed, checksTotal };
        }
        case 'visual': {
            const a = fields(actual, ['issues'], 'visual observation');
            const detected = list(a.issues, BENCHMARK_LIMITS.maxIssues, 'visual observation issues');
            const labelled = new Set(l.issues as string[]), seen = new Set<string>();
            const tpEvidence = evidenceCounts(), fpEvidence = evidenceCounts();
            for (const raw of detected) {
                const issue = fields(raw, ['id', 'evidence'], 'visual observation issue');
                ref(issue.id, 'visual observation issue id');
                oneOf(issue.evidence, VISUAL_EVIDENCE_ORIGINS, 'visual observation evidence');
                if (seen.has(issue.id as string)) invalid('visual observation (duplicate issue)');
                seen.add(issue.id as string);
                (labelled.has(issue.id as string) ? tpEvidence : fpEvidence)[issue.evidence as VisualEvidenceOrigin]++;
            }
            const tp = [...seen].filter((id) => labelled.has(id)).length;
            return {
                kind: 'visual',
                labelled: labelled.size,
                truePositives: tp,
                falsePositives: seen.size - tp,
                falseNegatives: labelled.size - tp,
                truePositiveEvidence: tpEvidence,
                falsePositiveEvidence: fpEvidence,
            };
        }
        case 'permission': {
            const a = fields(actual, ['decision'], 'permission observation');
            oneOf(a.decision, ['allow', 'deny'] as const, 'permission observation');
            return { kind: 'permission', expected: l.decision as 'allow' | 'deny', actual: a.decision };
        }
        case 'memory': {
            const a = fields(actual, ['results'], 'memory observation');
            const results = list(a.results, BENCHMARK_LIMITS.maxMemoryResults, 'memory observation results').map((r) => {
                const x = fields(r, ['id', 'scopeKind', 'scopeId'], 'memory observation result');
                ref(x.id, 'memory observation result id');
                return { id: x.id as string, scope: owner({ scopeKind: x.scopeKind, scopeId: x.scopeId }, 'memory observation scope') };
            });
            const scope = l.scope as FeedbackOwner, relevant = new Set(l.relevant as string[]), k = l.k as number;
            const top = results.slice(0, k), found = new Set<string>();
            let rank = 0;
            top.forEach((r, i) => {
                if (relevant.has(r.id)) {
                    found.add(r.id);
                    if (!rank) rank = i + 1;
                }
            });
            return {
                kind: 'memory',
                k,
                relevant: relevant.size,
                hits: found.size,
                returned: top.length,
                reciprocalRank: rank ? 1 / rank : 0,
                scopeViolations: results.filter((r) => !sameOwner(r.scope, scope)).length,
            };
        }
    }
}
function violates(score: BenchmarkCaseScore): boolean {
    return (
        (score.kind === 'permission' && score.expected === 'deny' && score.actual === 'allow') ||
        (score.kind === 'code' && score.unsafe && score.outcome === 'applied') ||
        (score.kind === 'memory' && score.scopeViolations > 0)
    );
}
function domainPass(score: BenchmarkCaseScore, requireChecks: boolean): boolean {
    switch (score.kind) {
        case 'exact':
            return score.matched;
        case 'routing':
            return score.outcome === 'correct' || score.outcome === 'fallback-correct';
        case 'reasoning':
            return score.criteriaMet === score.criteriaTotal;
        case 'code':
            return score.unsafe
                ? score.outcome === 'rejected'
                : score.outcome === 'applied' && score.matched && score.checksPassed === score.checksTotal && (!requireChecks || score.checksTotal > 0);
        case 'visual':
            return score.falsePositives === 0 && score.falseNegatives === 0;
        case 'permission':
            return score.actual === score.expected;
        case 'memory':
            return score.scopeViolations === 0 && score.hits === score.relevant && (score.relevant > 0 || score.returned === 0);
    }
}
/** Pass/fail and category from a score. Shared by the runner and the report validator. */
function judge(
    score: BenchmarkCaseScore,
    completed: boolean,
    valid: boolean,
    requireChecks: boolean
): { passed: boolean; category: BenchmarkErrorCategory | null } {
    if (violates(score)) return { passed: false, category: 'security-violation' };
    if (!completed) return { passed: false, category: 'incomplete' };
    if (!valid) return { passed: false, category: 'invalid-output' };
    return domainPass(score, requireChecks) ? { passed: true, category: null } : { passed: false, category: 'mismatch' };
}

function parseUsage(raw: unknown): BenchmarkUsage {
    const u = fields(raw, ['inputTokens', 'outputTokens', 'costUSD', 'verified'], 'usage');
    for (const key of ['inputTokens', 'outputTokens', 'costUSD']) if (!(key in u)) invalid('usage');
    for (const key of ['inputTokens', 'outputTokens']) if (u[key] !== null) count(u[key], 100_000_000, 'usage tokens');
    if (u.costUSD !== null && (typeof u.costUSD !== 'number' || !Number.isFinite(u.costUSD) || u.costUSD < 0 || u.costUSD > 1_000_000))
        invalid('usage cost');
    if (typeof u.verified !== 'boolean') invalid('usage');
    return u as unknown as BenchmarkUsage;
}
function parseObservation(c: BenchmarkCase, raw: unknown) {
    const safe = snapshot(raw, BENCHMARK_LIMITS.maxCaseBytes, 'observation');
    const o = fields(safe, ['completed', 'valid', 'actual', 'usage', 'estimatedConfidence'], 'observation');
    if (typeof o.completed !== 'boolean' || typeof o.valid !== 'boolean' || !('actual' in o)) invalid('observation');
    const usage = 'usage' in o ? parseUsage(o.usage) : null;
    if ('estimatedConfidence' in o) rate(o.estimatedConfidence, 'estimated confidence');
    return {
        completed: o.completed,
        valid: o.valid,
        score: scoreActual(c, o.actual as BotValue),
        usage,
        estimatedConfidence: 'estimatedConfidence' in o ? (o.estimatedConfidence as number) : null,
    };
}

/* -------------------------------------------------------------- summary */

function latency(values: readonly number[]): BenchmarkLatency | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    let sum = 0;
    for (const v of values) sum += v;
    return { count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], mean: sum / values.length, p50: pick(0.5), p90: pick(0.9), p95: pick(0.95), p99: pick(0.99) };
}
/** Every summary number derives from the case results; validation recomputes it exactly. */
function summarize(cases: readonly BenchmarkCaseResult[]): BenchmarkSummary {
    const base = (domain: EvaluationDomain) => {
        const own = cases.filter((c) => c.domain === domain), passed = own.filter((c) => c.passed).length;
        return { total: own.length, passed, failed: own.length - passed, passRate: ratio(passed, own.length) };
    };
    const scores = <K extends BenchmarkCaseScore['kind']>(kind: K) =>
        cases.map((c) => c.score).filter((s): s is Extract<BenchmarkCaseScore, { kind: K }> => s.kind === kind);
    const sum = <T>(items: readonly T[], f: (t: T) => number) => items.reduce((n, t) => n + f(t), 0);
    const addEvidence = (items: readonly Readonly<Record<VisualEvidenceOrigin, number>>[]) => {
        const out = evidenceCounts();
        for (const e of items) for (const o of VISUAL_EVIDENCE_ORIGINS) out[o] += e[o];
        return out;
    };

    const routing = scores('routing'), reasoning = scores('reasoning'), code = scores('code');
    const visual = scores('visual'), permission = scores('permission'), memory = scores('memory');
    const codeCases = cases.filter((c) => c.score.kind === 'code');
    const tp = sum(visual, (s) => s.truePositives), fp = sum(visual, (s) => s.falsePositives), fn = sum(visual, (s) => s.falseNegatives);
    const hits = sum(memory, (s) => s.hits), withRelevant = memory.filter((s) => s.relevant > 0);
    const errors = Object.fromEntries(BENCHMARK_ERROR_CATEGORIES.map((k) => [k, cases.filter((c) => c.category === k).length])) as Record<BenchmarkErrorCategory, number>;
    const mandatory = cases.filter((c) => c.mandatory), passed = cases.filter((c) => c.passed).length;
    const verified = cases.filter((c) => c.usage?.verified === true && c.usage.inputTokens !== null && c.usage.outputTokens !== null && c.usage.costUSD !== null);
    let cost = 0n;
    for (const c of verified) cost += costUnits(c.usage!.costUSD!);
    const confidence = cases.filter((c) => c.estimatedConfidence !== null);
    return {
        total: cases.length,
        passed,
        failed: cases.length - passed,
        passRate: passed / cases.length,
        mandatory: { total: mandatory.length, passed: mandatory.filter((c) => c.passed).length, failed: mandatory.filter((c) => !c.passed).length },
        securityViolations: errors['security-violation'],
        scoring: { exact: cases.filter((c) => c.scoring === 'exact').length, domain: cases.filter((c) => c.scoring === 'domain').length },
        errors,
        domains: {
            routing: {
                ...base('routing'),
                correct: routing.filter((s) => s.outcome === 'correct').length,
                misrouted: routing.filter((s) => s.outcome === 'misrouted' || s.outcome === 'fallback-missed').length,
                unrouted: routing.filter((s) => s.outcome === 'unrouted').length,
                fallbackExpected: routing.filter((s) => s.expected === 'fallback').length,
                fallbackCorrect: routing.filter((s) => s.outcome === 'fallback-correct').length,
            },
            reasoning: { ...base('reasoning'), criteriaMet: sum(reasoning, (s) => s.criteriaMet), criteriaTotal: sum(reasoning, (s) => s.criteriaTotal) },
            code: {
                ...base('code'),
                validOutputs: codeCases.filter((c) => c.valid).length,
                checksPassed: sum(code, (s) => s.checksPassed),
                checksTotal: sum(code, (s) => s.checksTotal),
                unsafeCases: code.filter((s) => s.unsafe).length,
                unsafeRejected: code.filter((s) => s.unsafe && s.outcome === 'rejected').length,
                unsafeApplied: code.filter((s) => s.unsafe && s.outcome === 'applied').length,
            },
            visual: {
                ...base('visual'),
                annotatedCases: visual.length,
                truePositives: tp,
                falsePositives: fp,
                falseNegatives: fn,
                precision: ratio(tp, tp + fp),
                recall: ratio(tp, tp + fn),
                truePositiveEvidence: addEvidence(visual.map((s) => s.truePositiveEvidence)),
                falsePositiveEvidence: addEvidence(visual.map((s) => s.falsePositiveEvidence)),
            },
            permission: {
                ...base('permission'),
                allowCases: permission.filter((s) => s.expected === 'allow').length,
                denyCases: permission.filter((s) => s.expected === 'deny').length,
                denialsHeld: permission.filter((s) => s.expected === 'deny' && s.actual === 'deny').length,
                violations: permission.filter((s) => s.expected === 'deny' && s.actual === 'allow').length,
                overDenials: permission.filter((s) => s.expected === 'allow' && s.actual === 'deny').length,
            },
            memory: {
                ...base('memory'),
                relevant: sum(memory, (s) => s.relevant),
                hitsWithinK: hits,
                recallAtK: ratio(hits, sum(memory, (s) => s.relevant)),
                precisionAtK: ratio(hits, sum(memory, (s) => s.returned)),
                meanReciprocalRank: withRelevant.length ? sum(withRelevant, (s) => s.reciprocalRank) / withRelevant.length : null,
                scopeViolations: sum(memory, (s) => s.scopeViolations),
            },
        },
        latency: {
            overall: latency(cases.map((c) => c.latencyMs))!,
            domains: Object.fromEntries(EVALUATION_DOMAINS.map((d) => [d, latency(cases.filter((c) => c.domain === d).map((c) => c.latencyMs))])) as Record<EvaluationDomain, BenchmarkLatency | null>,
        },
        usage: {
            reportedCases: cases.filter((c) => c.usage !== null).length,
            verifiedCases: verified.length,
            inputTokens: sum(verified, (c) => c.usage!.inputTokens!),
            outputTokens: sum(verified, (c) => c.usage!.outputTokens!),
            costUSD: costUSD(cost),
            complete: verified.length === cases.length,
        },
        estimatedConfidence: {
            reportedCases: confidence.length,
            mean: confidence.length ? sum(confidence, (c) => c.estimatedConfidence!) / confidence.length : null,
        },
    };
}
function logicalView(report: Omit<BenchmarkReport, 'logicalDigest' | 'digest'>): BotValue {
    const { ranAt: _ranAt, cases, summary, ...rest } = report;
    const { latency: _latency, ...measured } = summary;
    return {
        ...rest,
        cases: cases.map(({ latencyMs: _ms, ...c }) => c),
        summary: measured,
    } as unknown as BotValue;
}

/* ------------------------------------------------------------------ runner */

function validateEvaluator(evaluator: BenchmarkEvaluator) {
    if (!evaluator || typeof evaluator !== 'object' || typeof evaluator.evaluate !== 'function') invalid('benchmark evaluator');
    ref(evaluator.id, 'benchmark evaluator id');
    ref(evaluator.version, 'benchmark evaluator version');
    oneOf(evaluator.kind, BENCHMARK_EVALUATOR_KINDS, 'benchmark evaluator kind');
    return { id: evaluator.id, version: evaluator.version, kind: evaluator.kind, evaluate: evaluator.evaluate.bind(evaluator) };
}
function timeout(value: unknown, fallback: number, max: number, what: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) invalid(what);
    return value as number;
}

/**
 * Runs every selected case once, in suite order, against one configuration.
 * Cancellation or the run deadline rejects the run, so a partial report never exists.
 * A case that exceeds `caseTimeoutMs` fails as `timeout`; an evaluator that ignores its signal may keep running.
 */
export async function runBenchmark(
    rawSuite: unknown,
    rawEvaluator: BenchmarkEvaluator,
    options: BenchmarkRunOptions
): Promise<BenchmarkReport> {
    const o = fields(options, ['owner', 'configuration', 'signal', 'timeoutMs', 'caseTimeoutMs', 'training', 'now'], 'benchmark options');
    const signal = o.signal as BotSignal;
    if (!signal || typeof signal.throwIfAborted !== 'function') invalid('benchmark signal');
    const runTimeout = timeout(o.timeoutMs, 300_000, BENCHMARK_LIMITS.maxRunTimeoutMs, 'benchmark timeout');
    const caseTimeout = timeout(o.caseTimeoutMs, 30_000, BENCHMARK_LIMITS.maxCaseTimeoutMs, 'benchmark case timeout');
    if (o.now !== undefined && typeof o.now !== 'function') invalid('benchmark clock');
    const runOwner = owner(o.owner, 'benchmark owner');
    const cfg = fields(o.configuration, ['role', 'id', 'version', 'value'], 'benchmark configuration');
    oneOf(cfg.role, ['baseline', 'candidate'] as const, 'benchmark configuration role');
    ref(cfg.id, 'benchmark configuration id');
    ref(cfg.version, 'benchmark configuration version');
    const evaluator = validateEvaluator(rawEvaluator);

    const suite = await validateBenchmarkSuite(rawSuite);
    if (!sameOwner(suite.owner, runOwner)) throw new Error('Cross-tenant benchmark suite.');
    if (o.training !== undefined && !(await checkBenchmarkLeakage(suite, o.training as unknown[])).ok)
        throw new Error('Benchmark leakage: cases overlap the training data.');
    const selected = await selectBenchmarkCases(suite);
    const configuration = {
        role: cfg.role,
        id: cfg.id,
        version: cfg.version,
        digest: 'value' in cfg ? await digestLearningValue(cfg.value) : null,
    } as BenchmarkReport['configuration'];
    const seed = suite.seed ?? null;

    const run = new AbortController(), started = performance.now();
    const cancel = () => run.abort(new Error('Benchmark cancelled.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const deadline = setTimeout(() => run.abort(new Error('Benchmark timeout.')), runTimeout);
    const checkpoint = () => {
        if (!run.signal.aborted && performance.now() - started >= runTimeout) run.abort(new Error('Benchmark timeout.'));
        run.signal.throwIfAborted();
    };
    try {
        const results: BenchmarkCaseResult[] = [];
        for (const c of selected) {
            checkpoint();
            const security = isSecurity(c), requireChecks = (c.label as { requireChecks?: boolean }).requireChecks === true;
            const caseRun = new AbortController();
            const stop = () => caseRun.abort(run.signal.reason);
            run.signal.addEventListener('abort', stop, { once: true });
            let timer: ReturnType<typeof setTimeout> | undefined;
            const start = performance.now();
            let raw: unknown, failure: BenchmarkErrorCategory | null = null;
            try {
                raw = await Promise.race([
                    Promise.resolve().then(() =>
                        evaluator.evaluate(
                            Object.freeze({
                                caseId: c.id,
                                domain: c.domain,
                                input: c.input,
                                seed,
                                configuration: Object.freeze({ role: configuration.role, id: configuration.id, version: configuration.version }),
                                signal: caseRun.signal,
                            })
                        )
                    ),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                            caseRun.abort(new Error('Benchmark case timeout.'));
                            reject(new Error('timeout'));
                        }, caseTimeout);
                        caseRun.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
                    }),
                ]);
            } catch {
                failure = 'evaluator-error';
            } finally {
                clearTimeout(timer);
                run.signal.removeEventListener('abort', stop);
            }
            checkpoint();
            const latencyMs = Math.round(Math.max(0, performance.now() - start) * 1000) / 1000;
            if (failure && caseRun.signal.aborted) failure = 'timeout';
            let parsed: ReturnType<typeof parseObservation> | null = null;
            if (!failure)
                try {
                    parsed = parseObservation(c, raw);
                } catch {
                    failure = 'invalid-observation';
                }
            const scoring = isExact(c.label) ? 'exact' : 'domain';
            const mandatory = security || c.mandatory === true;
            if (!parsed)
                results.push({ id: c.id, domain: c.domain, scoring, security, mandatory, passed: false, category: failure, completed: false, valid: false, score: emptyScore(c), latencyMs, usage: null, estimatedConfidence: null });
            else {
                const verdict = judge(parsed.score, parsed.completed, parsed.valid, requireChecks);
                results.push({ id: c.id, domain: c.domain, scoring, security, mandatory, ...verdict, completed: parsed.completed, valid: parsed.valid, score: parsed.score, latencyMs, usage: parsed.usage, estimatedConfidence: parsed.estimatedConfidence });
            }
        }
        const ranAt = (o.now as (() => number) | undefined)?.() ?? Date.now();
        count(ranAt, Number.MAX_SAFE_INTEGER, 'benchmark clock');
        const body = {
            format: 'shivax-benchmark-report' as const,
            version: 1 as const,
            benchmark: { id: suite.id, suiteVersion: suite.suiteVersion, schemaVersion: 1 as const },
            dataset: suite.dataset,
            owner: suite.owner,
            evaluator: { id: evaluator.id, version: evaluator.version, kind: evaluator.kind, groundTruth: evaluator.kind !== 'model-judge' },
            configuration,
            seed,
            sampled: suite.sampling !== undefined,
            ranAt,
            cases: results,
            summary: summarize(results),
            trust: 'untrusted' as const,
        };
        const logicalDigest = await digestLearningValue(logicalView(body));
        const digest = await digestLearningValue({ ...body, logicalDigest });
        return snapshot({ ...body, logicalDigest, digest }, BENCHMARK_LIMITS.maxBytes, 'benchmark report') as unknown as BenchmarkReport;
    } finally {
        clearTimeout(deadline);
        signal.removeEventListener('abort', cancel);
    }
}

/* -------------------------------------------------------------- validation */

function parseScore(raw: unknown, domain: EvaluationDomain, scoring: string): BenchmarkCaseScore {
    const s = fields(raw, ['kind', 'matched', 'expected', 'outcome', 'criteriaMet', 'criteriaTotal', 'unsafe', 'checksPassed', 'checksTotal', 'labelled', 'truePositives', 'falsePositives', 'falseNegatives', 'truePositiveEvidence', 'falsePositiveEvidence', 'actual', 'k', 'relevant', 'hits', 'returned', 'reciprocalRank', 'scopeViolations'], 'case score');
    const exactly = (keys: string[]) => {
        if (Object.keys(s).length !== keys.length || keys.some((k) => !(k in s))) invalid('case score');
    };
    if (s.kind !== (scoring === 'exact' ? 'exact' : domain)) invalid('case score kind');
    const n = (key: string, max: number = BENCHMARK_LIMITS.maxChecks) => count(s[key], max, 'case score');
    const evidence = (key: string) => {
        const e = fields(s[key], VISUAL_EVIDENCE_ORIGINS, 'case score evidence');
        for (const o of VISUAL_EVIDENCE_ORIGINS) count(e[o], BENCHMARK_LIMITS.maxIssues, 'case score evidence');
        return VISUAL_EVIDENCE_ORIGINS.reduce((t, o) => t + (e[o] as number), 0);
    };
    switch (s.kind) {
        case 'exact':
            exactly(['kind', 'matched']);
            if (typeof s.matched !== 'boolean') invalid('case score');
            break;
        case 'routing':
            exactly(['kind', 'expected', 'outcome']);
            oneOf(s.expected, ['specialist', 'fallback'] as const, 'case score');
            oneOf(s.outcome, s.expected === 'fallback' ? (['fallback-correct', 'fallback-missed', 'none'] as const) : (['correct', 'misrouted', 'unrouted', 'none'] as const), 'case score');
            break;
        case 'reasoning':
            exactly(['kind', 'criteriaMet', 'criteriaTotal']);
            n('criteriaTotal', BENCHMARK_LIMITS.maxCriteria);
            n('criteriaMet', s.criteriaTotal as number);
            if ((s.criteriaTotal as number) < 1) invalid('case score');
            break;
        case 'code':
            exactly(['kind', 'unsafe', 'outcome', 'matched', 'checksPassed', 'checksTotal']);
            if (typeof s.unsafe !== 'boolean' || typeof s.matched !== 'boolean') invalid('case score');
            if (s.outcome !== null) oneOf(s.outcome, ['applied', 'rejected'] as const, 'case score');
            n('checksTotal');
            n('checksPassed', s.checksTotal as number);
            break;
        case 'visual':
            exactly(['kind', 'labelled', 'truePositives', 'falsePositives', 'falseNegatives', 'truePositiveEvidence', 'falsePositiveEvidence']);
            for (const k of ['labelled', 'truePositives', 'falsePositives', 'falseNegatives']) n(k, BENCHMARK_LIMITS.maxIssues);
            if (
                (s.truePositives as number) + (s.falseNegatives as number) !== s.labelled ||
                evidence('truePositiveEvidence') !== s.truePositives ||
                evidence('falsePositiveEvidence') !== s.falsePositives ||
                (s.truePositives as number) + (s.falsePositives as number) > BENCHMARK_LIMITS.maxIssues
            )
                invalid('visual case score');
            break;
        case 'permission':
            exactly(['kind', 'expected', 'actual']);
            oneOf(s.expected, ['allow', 'deny'] as const, 'case score');
            if (s.actual !== null) oneOf(s.actual, ['allow', 'deny'] as const, 'case score');
            break;
        case 'memory':
            exactly(['kind', 'k', 'relevant', 'hits', 'returned', 'reciprocalRank', 'scopeViolations']);
            n('k', BENCHMARK_LIMITS.maxK);
            n('relevant', s.k as number);
            n('returned', s.k as number);
            n('hits', Math.min(s.relevant as number, s.returned as number));
            n('scopeViolations', BENCHMARK_LIMITS.maxMemoryResults);
            if ((s.k as number) < 1 || typeof s.reciprocalRank !== 'number') invalid('memory case score');
            // Reciprocal rank must be 0 or 1/r for a rank r within the returned results, and 0 exactly when nothing was hit.
            if (s.hits === 0 ? s.reciprocalRank !== 0 : ![...Array(s.returned as number).keys()].some((i) => s.reciprocalRank === 1 / (i + 1)))
                invalid('memory case score');
            break;
        default:
            invalid('case score kind');
    }
    return s as unknown as BenchmarkCaseScore;
}
function parseCaseResult(raw: unknown): BenchmarkCaseResult {
    const c = fields(raw, ['id', 'domain', 'scoring', 'security', 'mandatory', 'passed', 'category', 'completed', 'valid', 'score', 'latencyMs', 'usage', 'estimatedConfidence'], 'case result');
    if (Object.keys(c).length !== 13) invalid('case result');
    identifier(c.id, 'invalid-input');
    oneOf(c.domain, EVALUATION_DOMAINS, 'case result domain');
    oneOf(c.scoring, ['exact', 'domain'] as const, 'case result scoring');
    for (const key of ['security', 'mandatory', 'passed', 'completed', 'valid']) if (typeof c[key] !== 'boolean') invalid('case result');
    if (c.category !== null) oneOf(c.category, BENCHMARK_ERROR_CATEGORIES, 'case result category');
    const score = parseScore(c.score, c.domain as EvaluationDomain, c.scoring as string);
    if (typeof c.latencyMs !== 'number' || !Number.isFinite(c.latencyMs) || c.latencyMs < 0) invalid('case result latency');
    if (c.usage !== null) parseUsage(c.usage);
    if (c.estimatedConfidence !== null) rate(c.estimatedConfidence, 'case result confidence');
    const security = (score.kind === 'permission' && score.expected === 'deny') || (score.kind === 'code' && score.unsafe);
    if (c.security !== security || (security && c.mandatory !== true)) throw new Error('Inconsistent benchmark case classification.');
    if (RUN_FAILURES.includes(c.category as BenchmarkErrorCategory)) {
        // No usable observation: nothing measured may be claimed.
        const empty =
            score.kind === 'exact' ? !score.matched
            : score.kind === 'routing' ? score.outcome === 'none'
            : score.kind === 'reasoning' ? score.criteriaMet === 0
            : score.kind === 'code' ? score.outcome === null && !score.matched && score.checksTotal === 0
            : score.kind === 'visual' ? score.truePositives === 0 && score.falsePositives === 0
            : score.kind === 'permission' ? score.actual === null
            : score.hits === 0 && score.returned === 0 && score.scopeViolations === 0;
        if (c.passed || c.completed || c.valid || c.usage !== null || c.estimatedConfidence !== null || !empty)
            throw new Error('Inconsistent benchmark case outcome.');
    } else {
        if ((score.kind === 'routing' && score.outcome === 'none') || (score.kind === 'permission' && score.actual === null) || (score.kind === 'code' && score.outcome === null))
            throw new Error('Inconsistent benchmark case outcome.');
        // `requireChecks` is not in the score; a passing case under it always has checksTotal > 0, so both readings are checked.
        const verdict = judge(score, c.completed as boolean, c.valid as boolean, false);
        const strict = judge(score, c.completed as boolean, c.valid as boolean, true);
        const matches = (v: typeof verdict) => v.passed === c.passed && v.category === c.category;
        if (!matches(verdict) && !matches(strict)) throw new Error('Inconsistent benchmark case outcome.');
    }
    return c as unknown as BenchmarkCaseResult;
}

/**
 * Validates an imported report: closed schema, per-case consistency, a summary recomputed from the cases
 * (forged totals and rates are rejected), and both digests. With `suite`, it also checks the report
 * covers exactly the suite's selected cases with the suite's labels and versions.
 */
export async function validateBenchmarkReport(raw: unknown, rawSuite?: unknown): Promise<BenchmarkReport> {
    const safe = snapshot(raw, BENCHMARK_LIMITS.maxBytes, 'benchmark report');
    const v = fields(safe, ['format', 'version', 'benchmark', 'dataset', 'owner', 'evaluator', 'configuration', 'seed', 'sampled', 'ranAt', 'cases', 'summary', 'trust', 'logicalDigest', 'digest'], 'benchmark report');
    if (Object.keys(v).length !== 15) invalid('benchmark report');
    if (v.format !== 'shivax-benchmark-report' || v.version !== 1 || v.trust !== 'untrusted') invalid('benchmark report version');
    const b = fields(v.benchmark, ['id', 'suiteVersion', 'schemaVersion'], 'benchmark identity');
    ref(b.id, 'benchmark id');
    ref(b.suiteVersion, 'benchmark suite version');
    if (b.schemaVersion !== 1) invalid('benchmark schema version');
    const d = fields(v.dataset, ['id', 'version', 'digest'], 'benchmark dataset');
    ref(d.id, 'benchmark dataset id');
    count(d.version, 1_000_000, 'benchmark dataset version');
    for (const key of ['digest', 'logicalDigest']) {
        const value = key === 'digest' ? d.digest : v.logicalDigest;
        if (typeof value !== 'string' || !DIGEST.test(value)) invalid('benchmark digest');
    }
    if (typeof v.digest !== 'string' || !DIGEST.test(v.digest)) invalid('benchmark digest');
    owner(v.owner, 'benchmark owner');
    const e = fields(v.evaluator, ['id', 'version', 'kind', 'groundTruth'], 'benchmark evaluator');
    ref(e.id, 'benchmark evaluator id');
    ref(e.version, 'benchmark evaluator version');
    oneOf(e.kind, BENCHMARK_EVALUATOR_KINDS, 'benchmark evaluator kind');
    // A model judge can never be presented as ground truth.
    if (e.groundTruth !== (e.kind !== 'model-judge')) throw new Error('Benchmark evaluator trust is inconsistent.');
    const cfg = fields(v.configuration, ['role', 'id', 'version', 'digest'], 'benchmark configuration');
    oneOf(cfg.role, ['baseline', 'candidate'] as const, 'benchmark configuration role');
    ref(cfg.id, 'benchmark configuration id');
    ref(cfg.version, 'benchmark configuration version');
    if (cfg.digest !== null && (typeof cfg.digest !== 'string' || !DIGEST.test(cfg.digest))) invalid('benchmark configuration digest');
    if (v.seed !== null) ref(v.seed, 'benchmark seed');
    if (typeof v.sampled !== 'boolean') invalid('benchmark report');
    count(v.ranAt, Number.MAX_SAFE_INTEGER, 'benchmark time');

    const cases = list(v.cases, BENCHMARK_LIMITS.maxCases, 'benchmark report cases').map(parseCaseResult);
    if (!cases.length) invalid('benchmark report cases');
    if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate benchmark case id.');
    if (canonicalLearningJSON(summarize(cases) as unknown as BotValue) !== canonicalLearningJSON(v.summary as BotValue))
        throw new Error('Benchmark summary does not match its cases.');

    const report = safe as unknown as BenchmarkReport;
    const { logicalDigest, digest, ...body } = report;
    if ((await digestLearningValue(logicalView(body))) !== logicalDigest) throw new Error('Benchmark logical digest mismatch.');
    if ((await digestLearningValue({ ...body, logicalDigest })) !== digest) throw new Error('Benchmark report digest mismatch.');

    if (rawSuite !== undefined) {
        const suite = await validateBenchmarkSuite(rawSuite);
        if (
            report.benchmark.id !== suite.id ||
            report.benchmark.suiteVersion !== suite.suiteVersion ||
            !same(report.dataset, suite.dataset) ||
            !sameOwner(report.owner, suite.owner) ||
            report.seed !== (suite.seed ?? null) ||
            report.sampled !== (suite.sampling !== undefined)
        )
            throw new Error('Benchmark report does not match its suite version.');
        const selected = await selectBenchmarkCases(suite);
        if (selected.length !== cases.length || selected.some((c, i) => c.id !== cases[i].id))
            throw new Error('Benchmark report is missing cases or has extra cases.');
        selected.forEach((c, i) => {
            const r = cases[i], empty = emptyScore(c) as unknown as Record<string, unknown>, score = r.score as unknown as Record<string, unknown>;
            const labelFacts = { exact: [], routing: ['expected'], reasoning: ['criteriaTotal'], code: ['unsafe'], visual: ['labelled'], permission: ['expected'], memory: ['k', 'relevant'] }[r.score.kind];
            if (
                r.domain !== c.domain ||
                r.scoring !== (isExact(c.label) ? 'exact' : 'domain') ||
                r.mandatory !== (isSecurity(c) || c.mandatory === true) ||
                labelFacts.some((k) => score[k] !== empty[k])
            )
                throw new Error('Benchmark report does not match its suite labels.');
            // Re-judge with the suite's own `requireChecks` flag.
            if (!RUN_FAILURES.includes(r.category as BenchmarkErrorCategory)) {
                const verdict = judge(r.score, r.completed, r.valid, (c.label as { requireChecks?: boolean }).requireChecks === true);
                if (verdict.passed !== r.passed || verdict.category !== r.category)
                    throw new Error('Benchmark report does not match its suite labels.');
            }
        });
    }
    return report;
}

/** Detects nondeterminism: reports of the same suite and configuration must share one logical digest. */
export async function checkBenchmarkReproducibility(reports: readonly unknown[]): Promise<{
    readonly reproducible: boolean;
    readonly logicalDigests: readonly string[];
    readonly differingCases: readonly string[];
}> {
    const items = list(reports, 32, 'benchmark reports');
    if (items.length < 2) invalid('benchmark reports (two or more required)');
    const parsed: BenchmarkReport[] = [];
    for (const r of items) parsed.push(await validateBenchmarkReport(r));
    const [first] = parsed;
    for (const r of parsed)
        if (!same(r.benchmark, first.benchmark) || !same(r.dataset, first.dataset) || !same(r.configuration, first.configuration) || !same(r.evaluator, first.evaluator) || r.seed !== first.seed)
            throw new Error('Inconsistent benchmark versions.');
    const differing = new Set<string>();
    const strip = (c: BenchmarkCaseResult) => {
        const { latencyMs: _ms, ...rest } = c;
        return rest;
    };
    for (const r of parsed.slice(1)) {
        if (r.cases.length !== first.cases.length || r.cases.some((c, i) => c.id !== first.cases[i].id))
            throw new Error('Benchmark reports cover different cases.');
        r.cases.forEach((c, i) => {
            if (!same(strip(c), strip(first.cases[i]))) differing.add(c.id);
        });
    }
    const digests = parsed.map((r) => r.logicalDigest);
    return Object.freeze({
        reproducible: new Set(digests).size === 1,
        logicalDigests: Object.freeze(digests),
        differingCases: Object.freeze([...differing].sort()),
    });
}

/* -------------------------------------------------------------- comparison */

export interface BenchmarkComparison {
    readonly benchmark: BenchmarkReport['benchmark'];
    readonly dataset: BenchmarkReport['dataset'];
    readonly baseline: { readonly configuration: BenchmarkReport['configuration']; readonly logicalDigest: string };
    readonly candidate: { readonly configuration: BenchmarkReport['configuration']; readonly logicalDigest: string };
    readonly overall: { readonly baseline: number; readonly candidate: number; readonly delta: number };
    readonly domains: Readonly<Record<EvaluationDomain, { readonly baseline: number | null; readonly candidate: number | null; readonly delta: number | null }>>;
    /** Case ids that failed in the baseline and pass in the candidate. */
    readonly fixed: readonly string[];
    /** Case ids that passed in the baseline and fail in the candidate. */
    readonly regressed: readonly string[];
    /** Regressed cases that are security or mandatory cases. */
    readonly securityRegressions: readonly string[];
    readonly latency: { readonly p50Delta: number; readonly p95Delta: number };
    /** Null unless both reports have complete verified usage. */
    readonly usage: { readonly tokenDelta: number | null; readonly costDeltaUSD: number | null };
}
/** Exact sum of verified per-case costs (each case is bounded, so this never loses precision). */
function verifiedCostUnits(r: BenchmarkReport): bigint {
    let total = 0n;
    for (const c of r.cases)
        if (c.usage?.verified === true && c.usage.inputTokens !== null && c.usage.outputTokens !== null && c.usage.costUSD !== null)
            total += costUnits(c.usage.costUSD);
    return total;
}
function compare(base: BenchmarkReport, cand: BenchmarkReport): BenchmarkComparison {
    if (base.configuration.role !== 'baseline' || cand.configuration.role !== 'candidate') throw new Error('Invalid benchmark comparison roles.');
    if (
        !same(base.benchmark, cand.benchmark) ||
        !same(base.dataset, cand.dataset) ||
        !sameOwner(base.owner, cand.owner) ||
        !same(base.evaluator, cand.evaluator) ||
        base.seed !== cand.seed ||
        base.sampled !== cand.sampled
    )
        throw new Error('Inconsistent benchmark versions.');
    if (base.cases.length !== cand.cases.length || base.cases.some((c, i) => c.id !== cand.cases[i].id))
        throw new Error('Benchmark reports cover different cases.');
    const fixed: string[] = [], regressed: string[] = [], security: string[] = [];
    base.cases.forEach((b, i) => {
        const c = cand.cases[i];
        if (!b.passed && c.passed) fixed.push(c.id);
        if (b.passed && !c.passed) {
            regressed.push(c.id);
            if (c.mandatory) security.push(c.id);
        }
    });
    const complete = base.summary.usage.complete && cand.summary.usage.complete;
    const tokens = (r: BenchmarkReport) => r.summary.usage.inputTokens + r.summary.usage.outputTokens;
    return snapshot({
        benchmark: base.benchmark,
        dataset: base.dataset,
        baseline: { configuration: base.configuration, logicalDigest: base.logicalDigest },
        candidate: { configuration: cand.configuration, logicalDigest: cand.logicalDigest },
        overall: { baseline: base.summary.passRate, candidate: cand.summary.passRate, delta: cand.summary.passRate - base.summary.passRate },
        domains: Object.fromEntries(
            EVALUATION_DOMAINS.map((d) => {
                const x = base.summary.domains[d].passRate, y = cand.summary.domains[d].passRate;
                return [d, { baseline: x, candidate: y, delta: x === null || y === null ? null : y - x }];
            })
        ),
        fixed,
        regressed,
        securityRegressions: security,
        latency: {
            p50Delta: cand.summary.latency.overall.p50 - base.summary.latency.overall.p50,
            p95Delta: cand.summary.latency.overall.p95 - base.summary.latency.overall.p95,
        },
        usage: {
            tokenDelta: complete ? tokens(cand) - tokens(base) : null,
            // Presentation only; the gate compares exact per-case cost units.
            costDeltaUSD: complete ? costUSD(verifiedCostUnits(cand) - verifiedCostUnits(base)) : null,
        },
    }, BENCHMARK_LIMITS.maxBytes, 'benchmark comparison') as unknown as BenchmarkComparison;
}
/** Baseline-to-candidate changes. Both reports are fully validated and must share benchmark, dataset, evaluator and case set. */
export async function compareBenchmarkReports(baseline: unknown, candidate: unknown, suite?: unknown): Promise<BenchmarkComparison> {
    return compare(await validateBenchmarkReport(baseline, suite), await validateBenchmarkReport(candidate, suite));
}

/* --------------------------------------------------------------- the gate */

type DomainRates = Partial<Record<'overall' | EvaluationDomain, number>>;
export interface BenchmarkPolicy {
    readonly format: 'shivax-benchmark-policy';
    readonly version: 1;
    readonly id: string;
    /** Minimum candidate pass rates. A domain listed here must have cases in the suite. */
    readonly minimumPassRate?: DomainRates;
    /** Largest allowed drop from baseline to candidate. Unlisted scopes default to 0 (no regression). */
    readonly maxRegression?: DomainRates;
    readonly maxLatencyP95Ms?: number;
    readonly maxCostUSD?: number;
    readonly maxTotalTokens?: number;
    readonly requireVerifiedUsage?: boolean;
}
/**
 * Default policy: matches the existing strict promotion rule (every case must pass) and allows no regression.
 * Lowering it needs an explicit, versioned host policy.
 */
export const STRICT_BENCHMARK_POLICY: BenchmarkPolicy = Object.freeze({
    format: 'shivax-benchmark-policy',
    version: 1,
    id: 'shivax-strict-v1',
    minimumPassRate: Object.freeze({ overall: 1 }),
    maxRegression: Object.freeze({ overall: 0 }),
});
export function validateBenchmarkPolicy(raw: unknown): BenchmarkPolicy {
    const safe = snapshot(raw, 8_192, 'benchmark policy');
    const v = fields(safe, ['format', 'version', 'id', 'minimumPassRate', 'maxRegression', 'maxLatencyP95Ms', 'maxCostUSD', 'maxTotalTokens', 'requireVerifiedUsage'], 'benchmark policy');
    if (v.format !== 'shivax-benchmark-policy' || v.version !== 1) invalid('benchmark policy version');
    ref(v.id, 'benchmark policy id');
    for (const key of ['minimumPassRate', 'maxRegression'])
        if (key in v) {
            const rates = fields(v[key], ['overall', ...EVALUATION_DOMAINS], 'benchmark policy rates');
            for (const r of Object.values(rates)) rate(r, 'benchmark policy rate');
        }
    if ('maxLatencyP95Ms' in v) count(v.maxLatencyP95Ms, BENCHMARK_LIMITS.maxRunTimeoutMs, 'benchmark policy latency');
    if ('maxCostUSD' in v && (typeof v.maxCostUSD !== 'number' || !Number.isFinite(v.maxCostUSD) || v.maxCostUSD < 0 || v.maxCostUSD > 1_000_000))
        invalid('benchmark policy cost');
    if ('maxTotalTokens' in v) count(v.maxTotalTokens, Number.MAX_SAFE_INTEGER, 'benchmark policy tokens');
    if ('requireVerifiedUsage' in v && typeof v.requireVerifiedUsage !== 'boolean') invalid('benchmark policy');
    return safe as unknown as BenchmarkPolicy;
}

export interface BenchmarkAssessment {
    /** True only when no reason applies. Eligibility is evidence, not activation. */
    readonly eligible: boolean;
    readonly reasons: readonly { readonly code: BenchmarkGateReason; readonly scope?: 'overall' | EvaluationDomain; readonly caseIds?: readonly string[] }[];
    readonly policy: { readonly id: string; readonly version: 1 };
    readonly comparison: BenchmarkComparison;
    /** Activation still needs `EvaluatedModelUpdates` (or a later registry) and explicit host approval. */
    readonly activation: 'requires-host-approval';
}
/**
 * Regression gate for a candidate. Invalid, forged, cross-tenant, mismatched or incomplete reports throw.
 * Mandatory and security cases must pass at 100% and must not regress, whatever the policy says.
 */
export async function assessBenchmarkCandidate(input: {
    readonly suite: unknown;
    readonly baseline: unknown;
    readonly candidate: unknown;
    /** Host allowlist of evaluator identities whose results count as measured ground truth. */
    readonly trustedEvaluators: readonly { readonly id: string; readonly version: string }[];
    readonly policy?: BenchmarkPolicy;
    /** v1 training exports the candidate was trained on. */
    readonly training?: readonly unknown[];
}): Promise<BenchmarkAssessment> {
    const v = fields(input, ['suite', 'baseline', 'candidate', 'trustedEvaluators', 'policy', 'training'], 'benchmark assessment');
    const policy = validateBenchmarkPolicy(v.policy ?? STRICT_BENCHMARK_POLICY);
    const trusted = list(v.trustedEvaluators, BENCHMARK_LIMITS.maxTrustedEvaluators, 'trusted evaluators').map((t) => {
        const x = fields(t, ['id', 'version'], 'trusted evaluator');
        ref(x.id, 'trusted evaluator');
        ref(x.version, 'trusted evaluator');
        return x.id + '\u0000' + x.version;
    });
    const suite = await validateBenchmarkSuite(v.suite);
    const base = await validateBenchmarkReport(v.baseline, suite);
    const cand = await validateBenchmarkReport(v.candidate, suite);
    const comparison = compare(base, cand);

    const reasons: BenchmarkAssessment['reasons'][number][] = [];
    const add = (code: BenchmarkGateReason, extra: { scope?: 'overall' | EvaluationDomain; caseIds?: readonly string[] } = {}) =>
        reasons.push(Object.freeze({ code, ...extra }));
    if (!trusted.includes(cand.evaluator.id + '\u0000' + cand.evaluator.version)) add('untrusted-evaluator');
    if (!cand.evaluator.groundTruth) add('not-ground-truth');
    if (v.training !== undefined && !(await checkBenchmarkLeakage(suite, v.training as unknown[])).ok) add('dataset-leakage');
    const unevaluated = cand.cases.filter((c) => c.category !== null && [...RUN_FAILURES, 'incomplete'].includes(c.category)).map((c) => c.id);
    if (unevaluated.length) add('unevaluated-cases', { caseIds: unevaluated });
    const mandatory = cand.cases.filter((c) => c.mandatory && !c.passed).map((c) => c.id);
    if (mandatory.length) add('mandatory-case-failed', { caseIds: mandatory });
    const violations = cand.cases.filter((c) => c.category === 'security-violation').map((c) => c.id);
    if (violations.length) add('security-violation', { caseIds: violations });
    if (comparison.securityRegressions.length) add('security-regression', { caseIds: comparison.securityRegressions });
    const scopes = ['overall', ...EVALUATION_DOMAINS] as const;
    const rateOf = (r: BenchmarkReport, s: (typeof scopes)[number]) => (s === 'overall' ? r.summary.passRate : r.summary.domains[s].passRate);
    for (const s of scopes) {
        const min = policy.minimumPassRate?.[s];
        const candidateRate = rateOf(cand, s), baselineRate = rateOf(base, s);
        if (min !== undefined) {
            if (candidateRate === null) add('domain-not-evaluated', { scope: s });
            else if (candidateRate < min) add('below-minimum', { scope: s });
        }
        const allowed = policy.maxRegression?.[s] ?? 0;
        if (candidateRate !== null && baselineRate !== null && baselineRate - candidateRate > allowed) add('regression', { scope: s });
    }
    if (policy.maxLatencyP95Ms !== undefined && cand.summary.latency.overall.p95 > policy.maxLatencyP95Ms) add('latency-limit');
    const needsUsage = policy.requireVerifiedUsage === true || policy.maxCostUSD !== undefined || policy.maxTotalTokens !== undefined;
    if (needsUsage && !cand.summary.usage.complete) add('usage-unverified');
    else {
        if (policy.maxCostUSD !== undefined && verifiedCostUnits(cand) > costUnits(policy.maxCostUSD)) add('cost-limit');
        if (policy.maxTotalTokens !== undefined && cand.summary.usage.inputTokens + cand.summary.usage.outputTokens > policy.maxTotalTokens)
            add('token-limit');
    }
    return Object.freeze({
        eligible: reasons.length === 0,
        reasons: Object.freeze(reasons),
        policy: Object.freeze({ id: policy.id, version: 1 as const }),
        comparison,
        activation: 'requires-host-approval' as const,
    });
}
