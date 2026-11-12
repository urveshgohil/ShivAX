import type { Bot, BotSignal, BotValue, TaskContext } from '../agents/types.js';
import { record, snapshotValue } from '../agents/validation.js';
import type { RudraOptions, RudraResult, RudraRoutingHook, RoutingSelectionRequest } from '../agents/rudra/types.js';
import type { Jay } from '../security/jay.js';
import type { PermissionPolicy } from '../security/types.js';
import type { FirewallPolicySnapshot, FirewallStatus } from '../security/firewall/types.js';
import { digestLearningValue, type FeedbackOwner } from './provenance.js';
import { verifyCuratedDataset } from './datasets.js';
import { validateBenchmarkReport, validateBenchmarkSuite, type BenchmarkEvaluator, type BenchmarkObservation } from './benchmarks.js';
import type { ModelRegistry } from './registry.js';

/*
 * SARASWATI S05: Ekalavya (bot id `ekalavy`) learning-assisted RUDRA routing.
 *
 * - The advisor is SHADOW-ONLY: it returns recommendations as data. It never calls bots, tools, models,
 *   firewall administration or the registry, and RUDRA never reads it.
 * - It learns only from verified evidence: S01 curated datasets consented for `routing-analysis` and S02
 *   routing cases backed by reports from trusted evaluators. Labels are counted, never interpreted.
 * - Routing changes only through an approved routing policy (an S04 configuration-only version) that the host
 *   applies to RUDRA's optional `routing` hook. Even then RUDRA lets it choose only among registered bots for
 *   the capability, and Vijay, the firewall and approval still check the chosen bot.
 */

export const ROUTING_LIMITS = Object.freeze({
    maxRules: 256,
    maxOrder: 16,
    maxExamples: 10_000,
    maxEvaluations: 16,
    maxEvidenceRefs: 32,
    defaultMinEvidence: 5,
    defaultMinConfidence: 0.5,
    defaultEvidenceTtlMs: 30 * 86_400_000,
    maxEvidenceTtlMs: 365 * 86_400_000,
    defaultMinLabelled: 20,
});
/** Why a candidate bot is not eligible for a recommendation or a policy route. */
export const ROUTING_REJECTIONS = Object.freeze([
    'capability-not-allowed',
    'permission-denied',
    'lockdown',
    'firewall-capability-denied',
    'firewall-bot-denied',
    'provider-not-allowed',
    'budget-exhausted',
] as const);
export type RoutingRejection = (typeof ROUTING_REJECTIONS)[number];
export const ROUTING_ERROR_CODES = Object.freeze(['invalid-configuration', 'invalid-input', 'invalid-evidence', 'invalid-policy', 'cross-tenant', 'unauthorized', 'leakage', 'cancelled'] as const);
export type RoutingErrorCode = (typeof ROUTING_ERROR_CODES)[number];
export class RoutingAdvisorError extends Error {
    readonly code: RoutingErrorCode;
    constructor(code: RoutingErrorCode, message?: string) {
        super(message ?? `Routing advisor error: ${code}.`);
        this.name = 'RoutingAdvisorError';
        this.code = code;
    }
}
const fail = (code: RoutingErrorCode, message?: string): never => {
    throw new RoutingAdvisorError(code, message);
};

/* --------------------------------------------------------------- policy */

/**
 * A routing policy: for each listed capability, the preferred order of bots. Closed schema: it cannot carry
 * permissions, tools, providers, prompts or code. Capabilities without a rule keep deterministic routing.
 */
export interface RoutingPolicy {
    readonly format: 'shivax-routing-policy';
    readonly version: 1;
    readonly id: string;
    /** Host-assigned policy version, 1..1,000,000. */
    readonly policyVersion: number;
    readonly owner: FeedbackOwner;
    readonly rules: readonly { readonly capability: string; readonly order: readonly string[] }[];
}
/** Minimal read-only view of a BotRegistry. */
export interface RoutingBotDirectory {
    list(): readonly Pick<Bot, 'id' | 'capabilities'>[];
}
const REF = /^[A-Za-z0-9._:-]{1,256}$/;
const isRef = (v: unknown): v is string => typeof v === 'string' && REF.test(v);
const sameOwner = (a: FeedbackOwner, b: FeedbackOwner) => a.scopeKind === b.scopeKind && a.scopeId === b.scopeId;
function fields(value: unknown, keys: readonly string[], onError: () => never): Record<string, unknown> {
    try {
        return record(value, keys, 'invalid-input');
    } catch {
        return onError();
    }
}
function ownerOf(value: unknown, onError: () => never): FeedbackOwner {
    const v = fields(value, ['scopeKind', 'scopeId'], onError);
    if ((v.scopeKind !== 'personal' && v.scopeKind !== 'company') || !isRef(v.scopeId)) onError();
    return v as unknown as FeedbackOwner;
}
/** Registered bot IDs that offer `capability`, in bot-ID order (exactly RUDRA's candidate list). */
function candidatesFor(directory: RoutingBotDirectory, capability: string): string[] {
    return directory
        .list()
        .filter((bot) => bot.capabilities.some((c) => c.id === capability))
        .map((bot) => bot.id)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Validates a routing policy. With `bots`, every listed bot must be registered and offer the rule's capability:
 * unknown or mismatched bots are rejected, never skipped. With `owner`, the policy must belong to that tenant.
 */
export function validateRoutingPolicy(raw: unknown, options: { readonly bots?: RoutingBotDirectory; readonly owner?: FeedbackOwner } = {}): RoutingPolicy {
    const bad = (why: string) => (): never => fail('invalid-policy', `Invalid routing policy: ${why}.`);
    let safe: BotValue;
    try {
        safe = snapshotValue(raw, 262_144, 'invalid-input');
    } catch {
        return bad('not plain bounded data')();
    }
    const v = fields(safe, ['format', 'version', 'id', 'policyVersion', 'owner', 'rules'], bad('unknown or missing fields'));
    if (v.format !== 'shivax-routing-policy' || v.version !== 1 || !isRef(v.id) || !Number.isSafeInteger(v.policyVersion) || (v.policyVersion as number) < 1 || (v.policyVersion as number) > 1_000_000)
        bad('identity')();
    const owner = ownerOf(v.owner, bad('owner'));
    if (options.owner && !sameOwner(owner, options.owner)) fail('cross-tenant', 'The routing policy belongs to another tenant.');
    if (!Array.isArray(v.rules) || v.rules.length > ROUTING_LIMITS.maxRules) bad('rules')();
    const seen = new Set<string>();
    for (const rawRule of v.rules as unknown[]) {
        const rule = fields(rawRule, ['capability', 'order'], bad('rule fields'));
        if (!isRef(rule.capability) || seen.has(rule.capability as string)) bad('rule capability')();
        seen.add(rule.capability as string);
        const order = rule.order;
        if (!Array.isArray(order) || !order.length || order.length > ROUTING_LIMITS.maxOrder || order.some((b) => !isRef(b)) || new Set(order).size !== order.length) bad('rule order')();
        if (options.bots) {
            const candidates = candidatesFor(options.bots, rule.capability as string);
            for (const botId of order as string[])
                if (!candidates.includes(botId)) fail('invalid-policy', 'The routing policy names a bot that is not registered for its capability.');
        }
    }
    return safe as unknown as RoutingPolicy;
}

/* --------------------------------------------------------- eligibility */

/** Read-only firewall view; `ShivaxFirewallRuntime` satisfies it. */
export interface RoutingFirewallView {
    status(): Pick<FirewallStatus, 'mode' | 'version' | 'admission'>;
    snapshot(): FirewallPolicySnapshot;
}
/** Model provider used by a bot, checked against the firewall allowlist and the host's remaining budget. */
export interface RoutingProviderBinding {
    readonly providerId: string;
    readonly locality: 'in-process' | 'local' | 'remote';
    /** Trusted host accounting (for example ModelRouter limits minus `budgetUsage`). */
    budget?(): { readonly remainingCalls: number; readonly remainingCostUSD: number };
}
export interface RoutingEnvironment {
    readonly firewall?: RoutingFirewallView;
    readonly providers?: Readonly<Record<string, RoutingProviderBinding>>;
}
/** Host checks that apply to a bot for a capability right now. Empty means eligible. Fails closed on errors. */
function rejectionsFor(env: RoutingEnvironment, botId: string, capability: string): RoutingRejection[] {
    const out: RoutingRejection[] = [];
    if (env.firewall) {
        try {
            const status = env.firewall.status();
            const policy = env.firewall.snapshot().policy;
            if (status.mode === 'lockdown' || policy.mode === 'lockdown') out.push('lockdown');
            if (!policy.capabilities.includes(capability)) out.push('firewall-capability-denied');
            if (!policy.bots.includes(botId)) out.push('firewall-bot-denied');
            const provider = env.providers?.[botId];
            if (provider && (!policy.providers.ids.includes(provider.providerId) || !policy.providers.localities.includes(provider.locality))) out.push('provider-not-allowed');
        } catch {
            out.push('lockdown');
        }
    }
    const provider = env.providers?.[botId];
    if (provider?.budget) {
        try {
            const b = provider.budget();
            if (!(Number.isFinite(b?.remainingCalls) && b.remainingCalls >= 1 && Number.isFinite(b.remainingCostUSD) && b.remainingCostUSD > 0)) out.push('budget-exhausted');
        } catch {
            out.push('budget-exhausted');
        }
    }
    return out;
}
/** The bot RUDRA would run for `capability` under `policy`: first eligible bot in the rule order, else the deterministic choice. */
function routeFor(policy: RoutingPolicy | null, capability: string, candidates: readonly string[], env: RoutingEnvironment): { botId: string | null; source: 'deterministic' | 'routing-policy' } {
    if (!candidates.length) return { botId: null, source: 'deterministic' };
    const rule = policy?.rules.find((r) => r.capability === capability);
    if (rule)
        for (const botId of rule.order)
            if (candidates.includes(botId) && !rejectionsFor(env, botId, capability).length) return { botId, source: 'routing-policy' };
    return { botId: candidates[0], source: 'deterministic' };
}

/* ------------------------------------------------------------ evidence */

export interface RoutingEvidenceInput {
    /** S01 `CuratedDataset` curated with purpose `routing-analysis`. Train and validation splits are used; held-out is left for measurement. */
    readonly feedback?: unknown;
    /** S02 suites with a report from a trusted evaluator. Their routing cases count as labelled examples. */
    readonly evaluations?: readonly { readonly suite: unknown; readonly report: unknown }[];
}
interface Example {
    readonly capability: string;
    readonly botId: string;
    readonly source: 'feedback' | 'evaluation';
    readonly ref: string;
}
export interface RoutingEvidenceSummary {
    readonly feedback: { readonly datasetId: string; readonly datasetVersion: number; readonly digest: string; readonly rows: number; readonly usable: number } | null;
    readonly evaluations: readonly { readonly suiteId: string; readonly suiteVersion: string; readonly reportDigest: string; readonly evaluator: string; readonly cases: number; readonly usable: number }[];
    /** Sources left out, with the reason. Stale evidence is never used. */
    readonly excluded: readonly { readonly source: 'feedback' | 'evaluation'; readonly reason: 'stale' }[];
    readonly examples: number;
    /** SHA-256 of the examples actually used. */
    readonly digest: string;
}
function routingLabel(input: unknown, label: unknown): { capability: string; botId: string } | null {
    // Only the capability and the bot ID are read. Any other text in the row (notes, model output,
    // instructions) is ignored and never interpreted.
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const capability = (input as Record<string, unknown>).capability;
    if (!isRef(capability) || !isRef(label)) return null;
    return { capability, botId: label };
}
async function loadEvidence(
    input: RoutingEvidenceInput,
    ctx: { owner: FeedbackOwner; trusted: readonly string[]; now: number; ttl: number }
): Promise<{ examples: Example[]; summary: RoutingEvidenceSummary; refs: Set<string> }> {
    const v = fields(input ?? {}, ['feedback', 'evaluations'], () => fail('invalid-evidence', 'Unknown evidence fields.'));
    const examples: Example[] = [];
    const excluded: { source: 'feedback' | 'evaluation'; reason: 'stale' }[] = [];
    let feedback: RoutingEvidenceSummary['feedback'] = null;
    if (v.feedback !== undefined) {
        let dataset;
        try {
            dataset = await verifyCuratedDataset(v.feedback);
        } catch {
            return fail('invalid-evidence', 'The feedback dataset failed verification.');
        }
        const m = dataset.manifest;
        if (!sameOwner(m.owner, ctx.owner)) fail('cross-tenant', 'The feedback dataset belongs to another tenant.');
        if (m.purpose !== 'routing-analysis') fail('invalid-evidence', 'The feedback dataset was not curated with consent for routing analysis.');
        const rows = [...dataset.splits.train.rows, ...dataset.splits.validation.rows];
        let usable = 0;
        if (ctx.now - m.eligibility.checkedAt > ctx.ttl) excluded.push({ source: 'feedback', reason: 'stale' });
        else
            for (const row of rows) {
                const label = row.domain === 'routing' ? routingLabel(row.input, row.expected) : null;
                if (!label) continue;
                usable++;
                examples.push({ ...label, source: 'feedback', ref: row.feedbackId });
            }
        feedback = { datasetId: m.id, datasetVersion: m.datasetVersion, digest: m.digest, rows: rows.length, usable };
    }
    const evaluations: { suiteId: string; suiteVersion: string; reportDigest: string; evaluator: string; cases: number; usable: number }[] = [];
    if (v.evaluations !== undefined) {
        if (!Array.isArray(v.evaluations) || v.evaluations.length > ROUTING_LIMITS.maxEvaluations) fail('invalid-evidence', 'Too many evaluations.');
        for (const raw of v.evaluations as unknown[]) {
            const e = fields(raw, ['suite', 'report'], () => fail('invalid-evidence', 'Invalid evaluation entry.'));
            let suite, report;
            try {
                suite = await validateBenchmarkSuite(e.suite);
            } catch {
                return fail('invalid-evidence', 'An evaluation suite failed validation.');
            }
            if (!sameOwner(suite.owner, ctx.owner)) fail('cross-tenant', 'An evaluation suite belongs to another tenant.');
            try {
                report = await validateBenchmarkReport(e.report, suite);
            } catch {
                return fail('invalid-evidence', 'An evaluation report failed validation.');
            }
            const evaluator = `${report.evaluator.id}@${report.evaluator.version}`;
            if (!report.evaluator.groundTruth || !ctx.trusted.includes(evaluator)) fail('invalid-evidence', 'An evaluation report is not from a trusted evaluator.');
            let usable = 0;
            if (ctx.now - report.ranAt > ctx.ttl) excluded.push({ source: 'evaluation', reason: 'stale' });
            else
                for (const c of suite.cases) {
                    if (c.domain !== 'routing' || !c.label || typeof c.label !== 'object' || !('botId' in c.label) || c.label.botId === null) continue;
                    const label = routingLabel(c.input, c.label.botId);
                    if (!label) continue;
                    usable++;
                    examples.push({ ...label, source: 'evaluation', ref: `${suite.id}:${c.id}` });
                }
            evaluations.push({ suiteId: suite.id, suiteVersion: suite.suiteVersion, reportDigest: report.digest, evaluator, cases: suite.cases.length, usable });
        }
    }
    if (examples.length > ROUTING_LIMITS.maxExamples) fail('invalid-evidence', 'Too many routing examples.');
    examples.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    const digest = await digestLearningValue(examples as unknown as BotValue);
    return {
        examples,
        refs: new Set(examples.map((e) => e.ref)),
        summary: Object.freeze({ feedback, evaluations: Object.freeze(evaluations), excluded: Object.freeze(excluded), examples: examples.length, digest }),
    };
}

/* ------------------------------------------------------- recommendation */

export interface RoutingRecommendation {
    readonly format: 'shivax-routing-recommendation';
    readonly version: 1;
    /** Always `shadow`: a recommendation never changes routing by itself. */
    readonly mode: 'shadow';
    readonly advisor: 'ekalavy';
    readonly taskId: string;
    readonly capability: string;
    /** What RUDRA does now: the deterministic rule, or the applied routing policy. */
    readonly baseline: {
        readonly botId: string | null;
        readonly source: 'deterministic' | 'routing-policy';
        readonly policy: { readonly id: string; readonly policyVersion: number } | null;
        readonly rejections: readonly RoutingRejection[];
    };
    readonly status: 'recommended' | 'same-as-baseline' | 'insufficient-evidence' | 'no-candidates' | 'blocked';
    readonly recommended: string | null;
    /** Every registered candidate, best first. `score` is a smoothed share of verified labels, not a probability guarantee. */
    readonly ranking: readonly {
        readonly botId: string;
        readonly score: number;
        readonly wins: number;
        readonly trials: number;
        readonly eligible: boolean;
        readonly rejections: readonly RoutingRejection[];
    }[];
    /** Estimate only: Wilson 95% lower bound of the recommended bot's share of verified labels. */
    readonly confidence: { readonly method: 'wilson-lower-bound-95'; readonly value: number | null; readonly trials: number };
    readonly evidence: {
        readonly digest: string;
        /** Labels for this capability naming bots that are not registered for it (ignored). */
        readonly ignoredLabels: number;
        /** Feedback ids and suite case ids supporting the recommendation (at most 32). */
        readonly refs: readonly string[];
    };
    /** Structured reasons; no free text from evidence or models. */
    readonly explanation: readonly { readonly code: string; readonly botId: string | null; readonly value: number | null }[];
    readonly wouldChangeRouting: boolean;
}
export interface RoutingAdvisorOptions extends RoutingEnvironment {
    /** Tenant the advisor serves. Evidence, policies and task contexts must belong to it. */
    readonly owner: FeedbackOwner;
    /** The live BotRegistry (read only). */
    readonly bots: RoutingBotDirectory;
    /** The routing policy RUDRA currently applies (for example `RoutingPolicySwitch.current`), or null. */
    readonly currentPolicy?: () => RoutingPolicy | null;
    /** Effective-permission checks: the task context must be Jay-minted and hold the capability policy's permissions. */
    readonly security?: { readonly jay: Jay; readonly policies: { get(kind: 'capability', id: string): PermissionPolicy | undefined } };
    /** Evaluators whose S02 routing results count as verified evidence. */
    readonly trustedEvaluators?: readonly { readonly id: string; readonly version: string }[];
    readonly minEvidence?: number;
    readonly minConfidence?: number;
    readonly evidenceTtlMs?: number;
    readonly now?: () => number;
}
export interface RoutingAdvisor {
    readonly owner: FeedbackOwner;
    readonly evidence: RoutingEvidenceSummary;
    /** Shadow recommendation for the task's capability (or `request.capability`). Never executes anything. */
    recommend(context: TaskContext, request?: { readonly capability?: string; readonly allowedCapabilities?: readonly string[] }, signal?: BotSignal): Promise<RoutingRecommendation>;
    /** Whether an id (feedback id or `suite:case`) was used as fitting evidence; for leakage checks. */
    usedEvidence(ref: string): boolean;
}

function wilson(wins: number, n: number): number | null {
    if (!n) return null;
    const z = 1.96, p = wins / n;
    return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}
function checkSignal(signal: BotSignal | undefined): void {
    if (signal?.aborted) fail('cancelled', 'The recommendation was cancelled.');
}

/** Builds a shadow routing advisor from verified evidence. Invalid, forged or cross-tenant evidence is refused. */
export async function createRoutingAdvisor(options: RoutingAdvisorOptions, evidence: RoutingEvidenceInput, signal?: BotSignal): Promise<RoutingAdvisor> {
    const cfg = (what: string) => (): never => fail('invalid-configuration', `Invalid ${what}.`);
    if (!options || typeof options !== 'object') cfg('options')();
    const owner = Object.freeze({ ...ownerOf(options.owner, cfg('owner')) });
    if (!options.bots || typeof options.bots.list !== 'function') cfg('bots')();
    if (options.currentPolicy !== undefined && typeof options.currentPolicy !== 'function') cfg('currentPolicy')();
    if (options.security !== undefined && (typeof options.security?.jay?.verify !== 'function' || typeof options.security.policies?.get !== 'function')) cfg('security')();
    if (options.firewall !== undefined && (typeof options.firewall?.status !== 'function' || typeof options.firewall.snapshot !== 'function')) cfg('firewall')();
    const num = (value: unknown, fallback: number, min: number, max: number, what: string, integer = true) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) cfg(what)();
        return value as number;
    };
    const minEvidence = num(options.minEvidence, ROUTING_LIMITS.defaultMinEvidence, 1, ROUTING_LIMITS.maxExamples, 'minEvidence');
    const minConfidence = num(options.minConfidence, ROUTING_LIMITS.defaultMinConfidence, 0, 1, 'minConfidence', false);
    const ttl = num(options.evidenceTtlMs, ROUTING_LIMITS.defaultEvidenceTtlMs, 1, ROUTING_LIMITS.maxEvidenceTtlMs, 'evidenceTtlMs');
    const now = options.now ?? Date.now;
    const trusted = (options.trustedEvaluators ?? []).map((t) => {
        if (!isRef(t?.id) || !isRef(t?.version)) cfg('trustedEvaluators')();
        return `${t.id}@${t.version}`;
    });
    const env: RoutingEnvironment = Object.freeze({ firewall: options.firewall, providers: options.providers });
    checkSignal(signal);
    const loaded = await loadEvidence(evidence, { owner, trusted, now: now(), ttl });
    checkSignal(signal);
    const { examples, summary, refs } = loaded;
    return Object.freeze({
        owner,
        evidence: summary,
        usedEvidence: (ref: string) => refs.has(ref),
        async recommend(context: TaskContext, request: { capability?: string; allowedCapabilities?: readonly string[] } = {}, signal?: BotSignal): Promise<RoutingRecommendation> {
            checkSignal(signal);
            const scope = context?.security?.scope;
            if (!scope || scope.kind !== owner.scopeKind || scope.id !== owner.scopeId) fail('cross-tenant', 'The task belongs to another tenant.');
            const capability = request?.capability ?? context.input?.capability;
            if (!isRef(capability)) fail('invalid-input', 'Invalid capability.');
            const allowed = request?.allowedCapabilities ?? [capability];
            if (!Array.isArray(allowed) || allowed.some((c) => !isRef(c))) fail('invalid-input', 'Invalid allowed capabilities.');
            // Capability-wide checks: the RUDRA allowlist and effective permissions (Jay identity + Vijay policy).
            const shared: RoutingRejection[] = [];
            if (!allowed.includes(capability as string)) shared.push('capability-not-allowed');
            if (options.security) {
                let identity;
                try {
                    identity = await options.security.jay.verify(context, signal ?? context.signal);
                } catch {
                    checkSignal(signal);
                    return fail('unauthorized', 'The task context is not an active Jay session.');
                }
                checkSignal(signal);
                if (identity.session.scope.kind !== owner.scopeKind || identity.session.scope.id !== owner.scopeId) fail('cross-tenant', 'The session belongs to another tenant.');
                const policy = options.security.policies.get('capability', capability as string);
                if (!policy || !policy.permissions.every((p) => identity.principal.permissions.includes(p))) shared.push('permission-denied');
            }
            const candidates = candidatesFor(options.bots, capability as string);
            const current = options.currentPolicy?.() ?? null;
            const baselineRoute = routeFor(current, capability as string, candidates, env);
            const rejected = new Map(candidates.map((id) => [id, [...new Set([...shared, ...rejectionsFor(env, id, capability as string)])]]));
            // Count verified labels; labels naming bots not registered for the capability are ignored, never followed.
            const relevant = examples.filter((e) => e.capability === capability);
            const usable = relevant.filter((e) => candidates.includes(e.botId));
            const n = usable.length, k = Math.max(1, candidates.length);
            const ranking = candidates
                .map((botId) => {
                    const wins = usable.filter((e) => e.botId === botId).length;
                    const rejections = rejected.get(botId)!;
                    return { botId, score: (wins + 1) / (n + k), wins, trials: n, eligible: rejections.length === 0, rejections: Object.freeze(rejections) };
                })
                .sort((a, b) => b.score - a.score || (a.botId < b.botId ? -1 : 1));
            const explanation: { code: string; botId: string | null; value: number | null }[] = [];
            const eligible = ranking.filter((r) => r.eligible);
            let status: RoutingRecommendation['status'];
            let recommended: string | null = null;
            let confidence: number | null = null;
            if (!candidates.length) status = 'no-candidates';
            else if (!eligible.length) {
                status = 'blocked';
                for (const r of ranking) for (const code of r.rejections) explanation.push({ code, botId: r.botId, value: null });
            } else if (n < minEvidence) {
                status = 'insufficient-evidence';
                explanation.push({ code: 'verified-labels', botId: null, value: n }, { code: 'minimum-labels', botId: null, value: minEvidence });
            } else {
                const [top, second] = eligible;
                confidence = wilson(top.wins, n);
                if (second && second.wins === top.wins) {
                    status = 'insufficient-evidence';
                    explanation.push({ code: 'tie', botId: top.botId, value: top.wins });
                } else if ((confidence ?? 0) < minConfidence) {
                    status = 'insufficient-evidence';
                    explanation.push({ code: 'low-confidence', botId: top.botId, value: confidence });
                } else {
                    recommended = top.botId;
                    status = recommended === baselineRoute.botId ? 'same-as-baseline' : 'recommended';
                    explanation.push({ code: 'label-share', botId: top.botId, value: top.wins / n });
                    if (second) explanation.push({ code: 'runner-up-share', botId: second.botId, value: second.wins / n });
                }
                for (const r of ranking) if (!r.eligible) for (const code of r.rejections) explanation.push({ code, botId: r.botId, value: null });
            }
            if (relevant.length !== usable.length) explanation.push({ code: 'ignored-labels', botId: null, value: relevant.length - usable.length });
            const support = recommended ? usable.filter((e) => e.botId === recommended).map((e) => e.ref).slice(0, ROUTING_LIMITS.maxEvidenceRefs) : [];
            return snapshotValue(
                {
                    format: 'shivax-routing-recommendation',
                    version: 1,
                    mode: 'shadow',
                    advisor: 'ekalavy',
                    taskId: context.taskId,
                    capability,
                    baseline: {
                        botId: baselineRoute.botId,
                        source: baselineRoute.source,
                        policy: current ? { id: current.id, policyVersion: current.policyVersion } : null,
                        rejections: baselineRoute.botId ? rejected.get(baselineRoute.botId)! : [],
                    },
                    status,
                    recommended,
                    ranking,
                    confidence: { method: 'wilson-lower-bound-95', value: confidence, trials: n },
                    evidence: { digest: summary.digest, ignoredLabels: relevant.length - usable.length, refs: support },
                    explanation,
                    wouldChangeRouting: status === 'recommended',
                } as unknown as BotValue,
                262_144,
                'invalid-output'
            ) as unknown as RoutingRecommendation;
        },
    });
}

/* ------------------------------------------------------------ shadow */

export interface ShadowRoutingRecord {
    readonly mode: 'shadow';
    readonly taskId: string;
    readonly capability: string;
    /** The bot RUDRA actually ran for the first step (unchanged by the advisor). */
    readonly actual: string | null;
    readonly recommended: string | null;
    readonly status: RoutingRecommendation['status'] | 'advisor-error';
    /** null when there was no recommendation to compare. */
    readonly agreed: boolean | null;
}
/**
 * Runs RUDRA exactly as it would run without the advisor, then asks the advisor what it would have chosen.
 * The returned `result` is RUDRA's own result; advisor failures are recorded, never thrown.
 */
export async function runRoutingShadow(
    rudra: { run(context: TaskContext, options?: RudraOptions): Promise<RudraResult> },
    advisor: RoutingAdvisor,
    context: TaskContext,
    options?: RudraOptions
): Promise<{ readonly result: RudraResult; readonly shadow: ShadowRoutingRecord }> {
    const result = await rudra.run(context, options);
    const actual = result.trace.find((e) => e.type === 'selection')?.botId ?? null;
    let recommendation: RoutingRecommendation | null = null;
    try {
        recommendation = await advisor.recommend(context, options?.allowedCapabilities ? { allowedCapabilities: options.allowedCapabilities } : {});
    } catch {
        recommendation = null;
    }
    const shadow: ShadowRoutingRecord = Object.freeze({
        mode: 'shadow',
        taskId: result.taskId,
        capability: context.input.capability,
        actual,
        recommended: recommendation?.recommended ?? null,
        status: recommendation?.status ?? 'advisor-error',
        agreed: recommendation?.recommended ? recommendation.recommended === actual : null,
    });
    return Object.freeze({ result, shadow });
}
export function summarizeRoutingShadow(records: readonly ShadowRoutingRecord[]) {
    if (!Array.isArray(records)) fail('invalid-input', 'Shadow records must be an array.');
    const count = (f: (r: ShadowRoutingRecord) => boolean) => records.filter(f).length;
    return Object.freeze({
        total: records.length,
        compared: count((r) => r.agreed !== null),
        agreed: count((r) => r.agreed === true),
        disagreed: count((r) => r.agreed === false),
        insufficientEvidence: count((r) => r.status === 'insufficient-evidence'),
        blocked: count((r) => r.status === 'blocked'),
        advisorErrors: count((r) => r.status === 'advisor-error'),
    });
}

/* ------------------------------------------------------------ quality */

export interface LabelledRoute {
    readonly capability: string;
    /** Ground-truth bot (null: no specialist should handle it). */
    readonly botId: string | null;
    readonly ref?: string;
}
export interface RoutingObservation {
    readonly botId: string;
    readonly capability: string;
    readonly latencyMs: number;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly costUSD: number | null;
    /** Only verified usage counts toward token and cost estimates. */
    readonly verified: boolean;
}
export interface RoutingStrategyQuality {
    readonly decisions: number;
    readonly correct: number;
    /** No eligible bot, or the chosen bot is blocked. */
    readonly failed: number;
    readonly accuracy: number | null;
    /** Avoidable error: labels that were eligible but not chosen, per decision. Requires ground truth. */
    readonly estimatedRegret: number | null;
    readonly coverage: number | null;
    /** Decisions whose chosen bot fails permission, firewall, provider or budget checks. */
    readonly securityDenials: number;
    /** From measured observations of the chosen bots only; null where none exist. */
    readonly latencyMs: number | null;
    readonly costUSD: number | null;
    readonly tokens: number | null;
    readonly estimatedDecisions: number;
}
export interface RoutingQualityReport {
    readonly labelled: number;
    readonly baseline: RoutingStrategyQuality;
    readonly candidate: RoutingStrategyQuality;
    readonly delta: { readonly accuracy: number | null; readonly regret: number | null; readonly securityDenials: number; readonly coverage: number | null };
    /** `improved` only with at least `minLabelled` labelled routes and no loss in security or coverage. */
    readonly verdict: 'improved' | 'no-change' | 'regressed' | 'insufficient-evidence';
}
/**
 * Compares a baseline and a candidate routing policy on held-out labelled routes. Latency and cost come only
 * from measured observations. Labelled routes that were used to fit the advisor are refused (leakage).
 */
export function evaluateRoutingQuality(input: {
    readonly bots: RoutingBotDirectory;
    readonly baseline: RoutingPolicy | null;
    readonly candidate: RoutingPolicy | null;
    readonly labelled: readonly LabelledRoute[];
    readonly observations?: readonly RoutingObservation[];
    readonly environment?: RoutingEnvironment;
    /** Caller permissions to check against capability policies (security denials). */
    readonly permissions?: { readonly granted: readonly string[]; readonly policies: { get(kind: 'capability', id: string): PermissionPolicy | undefined } };
    readonly advisor?: Pick<RoutingAdvisor, 'usedEvidence'>;
    readonly minLabelled?: number;
}): RoutingQualityReport {
    if (!input || typeof input.bots?.list !== 'function' || !Array.isArray(input.labelled)) fail('invalid-input', 'Invalid routing quality input.');
    const minLabelled = input.minLabelled ?? ROUTING_LIMITS.defaultMinLabelled;
    if (!Number.isSafeInteger(minLabelled) || minLabelled < 1) fail('invalid-input', 'Invalid minLabelled.');
    const env = input.environment ?? {};
    const labelled = input.labelled.map((l) => {
        if (!isRef(l?.capability) || !(l.botId === null || isRef(l.botId)) || !(l.ref === undefined || isRef(l.ref))) fail('invalid-input', 'Invalid labelled route.');
        if (l.ref !== undefined && input.advisor?.usedEvidence(l.ref)) fail('leakage', 'A labelled route was also used as advisor evidence.');
        return l;
    });
    const observations = (input.observations ?? []).filter((o) => isRef(o?.botId) && isRef(o.capability) && Number.isFinite(o.latencyMs) && o.latencyMs >= 0);
    const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    const measure = (policy: RoutingPolicy | null): RoutingStrategyQuality => {
        let correct = 0, failed = 0, avoidable = 0, routed = 0, denials = 0, estimated = 0;
        const lat: number[] = [], cost: number[] = [], tokens: number[] = [];
        for (const l of labelled) {
            const candidates = candidatesFor(input.bots, l.capability);
            const chosen = routeFor(policy, l.capability, candidates, env).botId;
            const rejections = chosen ? rejectionsFor(env, chosen, l.capability) : [];
            const permissionDenied = !!input.permissions && (() => {
                const p = input.permissions!.policies.get('capability', l.capability);
                return !p || !p.permissions.every((x) => input.permissions!.granted.includes(x));
            })();
            const noRoute = !chosen;
            const denied = !noRoute && (rejections.length > 0 || permissionDenied);
            if (denied) denials++;
            // A null label means no specialist should handle the task: no route is then the correct outcome.
            const ok = l.botId === null ? noRoute : !denied && chosen === l.botId;
            if (ok) correct++;
            else if (l.botId !== null && candidates.includes(l.botId) && !rejectionsFor(env, l.botId, l.capability).length && !permissionDenied) avoidable++;
            if (denied || (noRoute && l.botId !== null)) failed++;
            else if (!noRoute) routed++;
            if (chosen && !denied) {
                const seen = observations.filter((o) => o.botId === chosen && o.capability === l.capability);
                if (seen.length) {
                    estimated++;
                    lat.push(mean(seen.map((o) => o.latencyMs))!);
                    const verified = seen.filter((o) => o.verified && o.costUSD !== null && o.inputTokens !== null && o.outputTokens !== null);
                    if (verified.length) {
                        cost.push(mean(verified.map((o) => o.costUSD!))!);
                        tokens.push(mean(verified.map((o) => o.inputTokens! + o.outputTokens!))!);
                    }
                }
            }
        }
        const n = labelled.length;
        return Object.freeze({
            decisions: n,
            correct,
            failed,
            accuracy: n ? correct / n : null,
            estimatedRegret: n ? avoidable / n : null,
            coverage: n ? routed / n : null,
            securityDenials: denials,
            latencyMs: mean(lat),
            costUSD: mean(cost),
            tokens: mean(tokens),
            estimatedDecisions: estimated,
        });
    };
    if (input.baseline) validateRoutingPolicy(input.baseline, { bots: input.bots });
    if (input.candidate) validateRoutingPolicy(input.candidate, { bots: input.bots });
    const baseline = measure(input.baseline), candidate = measure(input.candidate);
    const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);
    let verdict: RoutingQualityReport['verdict'];
    if (labelled.length < minLabelled) verdict = 'insufficient-evidence';
    else if (candidate.correct < baseline.correct || candidate.securityDenials > baseline.securityDenials || (candidate.coverage ?? 0) < (baseline.coverage ?? 0)) verdict = 'regressed';
    else if (candidate.correct > baseline.correct) verdict = 'improved';
    else verdict = 'no-change';
    return Object.freeze({
        labelled: labelled.length,
        baseline,
        candidate,
        delta: Object.freeze({ accuracy: diff(baseline.accuracy, candidate.accuracy), regret: diff(baseline.estimatedRegret, candidate.estimatedRegret), securityDenials: candidate.securityDenials - baseline.securityDenials, coverage: diff(baseline.coverage, candidate.coverage) }),
        verdict,
    });
}

/** Turns shadow recommendations into a draft policy. It is only a candidate: promotion needs the S04 lifecycle. */
export function draftRoutingPolicy(input: { readonly id: string; readonly policyVersion: number; readonly owner: FeedbackOwner; readonly recommendations: readonly RoutingRecommendation[] }): RoutingPolicy {
    const rules = new Map<string, string[]>();
    for (const r of input.recommendations ?? []) {
        if (r?.status !== 'recommended' || !r.recommended || rules.has(r.capability)) continue;
        rules.set(r.capability, [r.recommended, ...r.ranking.filter((x) => x.eligible && x.botId !== r.recommended).map((x) => x.botId)].slice(0, ROUTING_LIMITS.maxOrder));
    }
    return validateRoutingPolicy({
        format: 'shivax-routing-policy',
        version: 1,
        id: input.id,
        policyVersion: input.policyVersion,
        owner: input.owner,
        rules: [...rules].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([capability, order]) => ({ capability, order })),
    });
}

/* --------------------------------------------- trusted routing evaluator */

/**
 * A deterministic S02 evaluator (id `shivax-routing-evaluator`, version `1`) that applies a routing policy the
 * way RUDRA does. `routing` cases (`{ capability }`) return the bot that would run. `permission` cases
 * (`{ capability, permissions }`) return `allow` only when a route exists, the chosen bot passes the host
 * checks and the caller holds the capability policy's permissions: routing can never grant access.
 */
export function createRoutingEvaluator(options: {
    readonly bots: RoutingBotDirectory;
    /** Maps an S02 configuration to its policy; null for deterministic routing. */
    resolvePolicy(configuration: { readonly role: string; readonly id: string; readonly version: string }, signal: BotSignal): RoutingPolicy | null | Promise<RoutingPolicy | null>;
    readonly policies?: { get(kind: 'capability', id: string): PermissionPolicy | undefined };
    readonly environment?: RoutingEnvironment;
}): BenchmarkEvaluator {
    if (!options || typeof options.bots?.list !== 'function' || typeof options.resolvePolicy !== 'function') fail('invalid-configuration', 'Invalid routing evaluator options.');
    const env = options.environment ?? {};
    const usage = Object.freeze({ inputTokens: 0, outputTokens: 0, costUSD: 0, verified: true });
    return Object.freeze({
        id: 'shivax-routing-evaluator',
        version: '1',
        kind: 'deterministic' as const,
        async evaluate(request: { domain: string; input: BotValue; configuration: { role: string; id: string; version: string }; signal: BotSignal }): Promise<BenchmarkObservation> {
            const policy = await options.resolvePolicy(request.configuration, request.signal);
            const checked = policy ? validateRoutingPolicy(policy, { bots: options.bots }) : null;
            const input = request.input as Record<string, unknown> | null;
            const capability = input && typeof input === 'object' ? input.capability : undefined;
            if (!isRef(capability)) return { completed: true, valid: false, actual: null, usage };
            const candidates = candidatesFor(options.bots, capability);
            const chosen = routeFor(checked, capability, candidates, env).botId;
            if (request.domain === 'routing') return { completed: true, valid: true, actual: { botId: chosen }, usage };
            if (request.domain === 'permission') {
                const granted = Array.isArray(input!.permissions) ? (input!.permissions as unknown[]).filter((p): p is string => typeof p === 'string') : [];
                const p = options.policies?.get('capability', capability);
                const allowed = !!chosen && !rejectionsFor(env, chosen, capability).length && !!p && p.permissions.every((x) => granted.includes(x));
                return { completed: true, valid: true, actual: { decision: allowed ? 'allow' : 'deny' }, usage };
            }
            return { completed: false, valid: false, actual: null, usage };
        },
    });
}
/** `resolvePolicy` for routing policies stored as S04 configuration-only versions; `deterministic` resolves to null. */
export function routingPolicyResolver(registry: Pick<ModelRegistry, 'loadVersion'>, options: { readonly bots: RoutingBotDirectory; readonly owner: FeedbackOwner }) {
    return async (configuration: { id: string; version: string }, signal: BotSignal): Promise<RoutingPolicy | null> => {
        if (configuration.id === 'deterministic') return null;
        const loaded = await registry.loadVersion(configuration.version, signal);
        if (loaded.artifact.model !== null) fail('invalid-policy', 'The version is not a routing policy.');
        return validateRoutingPolicy(loaded.artifact.configuration, options);
    };
}

/* --------------------------------------------------- applying a policy */

/**
 * Holds the routing policy RUDRA applies through its optional `routing` hook. Starts deterministic (null).
 * Only `apply` (trusted host code) or `syncFromRegistry` change it; every policy is validated against the live
 * bot registry and tenant. During firewall lockdown the hook returns null, so RUDRA routes deterministically.
 */
export class RoutingPolicySwitch {
    readonly #bots: RoutingBotDirectory;
    readonly #owner: FeedbackOwner;
    readonly #env: RoutingEnvironment;
    #policy: RoutingPolicy | null = null;
    readonly hook: RudraRoutingHook;
    constructor(options: { readonly bots: RoutingBotDirectory; readonly owner: FeedbackOwner } & RoutingEnvironment) {
        if (!options || typeof options.bots?.list !== 'function') fail('invalid-configuration', 'A bot registry is required.');
        this.#bots = options.bots;
        this.#owner = Object.freeze({ ...ownerOf(options.owner, () => fail('invalid-configuration', 'Invalid owner.')) });
        this.#env = Object.freeze({ firewall: options.firewall, providers: options.providers });
        const select = (request: RoutingSelectionRequest): string | null => {
            const policy = this.#policy;
            if (!policy) return null;
            const route = routeFor(policy, request.capability, request.candidates, this.#env);
            return route.source === 'routing-policy' ? route.botId : null;
        };
        this.hook = Object.freeze({ select });
    }
    get current(): RoutingPolicy | null {
        return this.#policy;
    }
    /** Trusted host only. Never expose this method to bots, tools or model output. */
    apply(policy: unknown | null): RoutingPolicy | null {
        this.#policy = policy === null ? null : validateRoutingPolicy(policy, { bots: this.#bots, owner: this.#owner });
        return this.#policy;
    }
    /**
     * Applies the registry's active version (S04). A non-empty policy is applied only when the registry holds a
     * rollback target; otherwise this throws and routing stays as it was.
     */
    async syncFromRegistry(registry: Pick<ModelRegistry, 'loadActive' | 'snapshot' | 'owner'>, signal: BotSignal): Promise<RoutingPolicy | null> {
        if (!sameOwner(registry.owner, this.#owner)) fail('cross-tenant', 'The registry belongs to another tenant.');
        const active = await registry.loadActive(signal);
        if (!active) return this.apply(null);
        if (active.artifact.model !== null) fail('invalid-policy', 'The active version is not a routing policy.');
        const policy = validateRoutingPolicy(active.artifact.configuration, { bots: this.#bots, owner: this.#owner });
        if (policy.rules.length && registry.snapshot().activations.length === 0)
            fail('invalid-policy', 'A routing policy needs a rollback target; activate a deterministic (empty) policy first.');
        return this.apply(policy);
    }
}
