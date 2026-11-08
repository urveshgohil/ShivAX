import type { BotSignal, BotValue, TaskContext } from '../agents/types.js';
import type { Jay } from '../security/jay.js';
import type { AuthenticatedIdentity } from '../security/types.js';
import { array, record, snapshotValue } from '../agents/validation.js';
import { privacy } from '../memory/validation.js';
import type { BotToolClient } from '../security/types.js';
import { validateFeedback, type FeedbackRecord } from './index.js';

/** SARASWATI S01. Provenance is a set of untrusted claims; verification exists only as a separate host attestation. */
export const FEEDBACK_SOURCE_KINDS = Object.freeze([
    'human-review',
    'host-outcome',
    'model-output',
    'inspection-finding',
    'import',
] as const);
export type FeedbackSourceKind = (typeof FEEDBACK_SOURCE_KINDS)[number];
export const CONSENT_PURPOSES = Object.freeze(['evaluation', 'training', 'routing-analysis'] as const);
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const EVIDENCE_KINDS = Object.freeze([
    'measurement',
    'report',
    'trace',
    'document',
    'screenshot-reference',
] as const);
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** Measured-versus-inferred provenance, matching Inspectra's computed/design/inferred vocabulary. */
export const EVIDENCE_ORIGINS = Object.freeze(['computed', 'design', 'inferred', 'host'] as const);
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];
export const REVIEW_STATUSES = Object.freeze(['verified', 'rejected'] as const);
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
/** `jay-identity`: reviewer derived from a Jay-verified session. `host-asserted`: host code supplied the reviewer reference. */
export const REVIEW_METHODS = Object.freeze(['jay-identity', 'host-asserted'] as const);
export type ReviewMethod = (typeof REVIEW_METHODS)[number];
export const REDACTION_METHODS = Object.freeze(['removed', 'masked', 'hashed'] as const);
export type RedactionMethod = (typeof REDACTION_METHODS)[number];

const DAY = 86_400_000;
export const GOVERNANCE_LIMITS = Object.freeze({
    /** Whole governed record; leaves room for the memory record wrapper (64 KiB default). */
    maxGovernedBytes: 49_152,
    maxProvenanceBytes: 8_192,
    maxEvidence: 16,
    maxRedactedFields: 32,
    maxLabelRevision: 1_000,
    maxRetentionMs: 366 * DAY,
    maxAttestationBytes: 4_096,
});

export interface FeedbackOwner {
    readonly scopeKind: 'personal' | 'company';
    readonly scopeId: string;
}
export interface FeedbackProvenance {
    readonly version: 1;
    /** Host clock, epoch milliseconds. */
    readonly createdAt: number;
    /** `group` links records that must stay in the same split. It defaults to `id`. */
    readonly source: { readonly kind: FeedbackSourceKind; readonly id: string; readonly group?: string };
    /** Tenant that owns the label. Curation never crosses owners. */
    readonly owner: FeedbackOwner;
    /** Optional session correlation reference (never a credential). */
    readonly session?: string;
    /** Versions of the agent or model that produced `feedback.output`. The task and bot ids live in the v1 record. */
    readonly subject: {
        readonly agentVersion?: string;
        readonly modelId?: string;
        readonly modelVersion?: string;
        readonly configurationVersion?: string;
    };
    /** Opaque references only. Content, screenshots and tokens never go here. */
    readonly evidence: readonly {
        readonly kind: EvidenceKind;
        readonly ref: string;
        readonly origin: EvidenceOrigin;
    }[];
    readonly consent: { readonly ref: string; readonly purposes: readonly ConsentPurpose[] };
    /** Revision 1 has no `supersedes`; later revisions name the feedback id they replace. */
    readonly label: { readonly revision: number; readonly supersedes?: string };
    readonly redaction: {
        readonly applied: boolean;
        readonly fields: readonly string[];
        readonly method?: RedactionMethod;
    };
    readonly retention: { readonly expiresAt: number };
}
export interface GovernedFeedback {
    readonly format: 'shivax-governed-feedback';
    readonly version: 1;
    /** Unchanged FeedbackRecord v1. */
    readonly feedback: FeedbackRecord;
    readonly provenance: FeedbackProvenance;
}
/** Created only by trusted host code after its own review. Integrity binding, not cryptographic authenticity. */
export interface ReviewAttestation {
    readonly format: 'shivax-review-attestation';
    readonly version: 1;
    readonly feedbackId: string;
    readonly labelRevision: number;
    readonly contentDigest: string;
    readonly status: ReviewStatus;
    readonly method: ReviewMethod;
    /** Opaque reviewer reference. For `jay-identity` it is derived from issuer and principal; never an email or name. */
    readonly reviewerRef: string;
    readonly reviewedAt: number;
}

/** Opaque reference: excludes URLs, data URIs, whitespace and free text. */
const REF = /^[A-Za-z0-9._:-]{1,256}$/;
const FIELD = /^[A-Za-z0-9_.[\]-]{1,128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function invalid(what: string): never {
    throw new Error(`Invalid ${what}.`);
}
function ref(value: unknown, what: string): asserts value is string {
    if (typeof value !== 'string' || !REF.test(value)) invalid(what);
}
function time(value: unknown, what: string): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(what);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): asserts value is T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) invalid(what);
}
function fields<T>(value: unknown, keys: readonly string[], what: string): Record<string, T> {
    try {
        return record(value, keys, 'invalid-input') as Record<string, T>;
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

/** Sorted-key JSON. Values must already be snapshotted BotValues. */
export function canonicalLearningJSON(value: BotValue): string {
    if (Array.isArray(value)) return '[' + value.map(canonicalLearningJSON).join(',') + ']';
    if (value !== null && typeof value === 'object') {
        const entries = value as Readonly<Record<string, BotValue>>;
        return (
            '{' +
            Object.keys(entries)
                .sort()
                .map((key) => JSON.stringify(key) + ':' + canonicalLearningJSON(entries[key]))
                .join(',') +
            '}'
        );
    }
    return JSON.stringify(value);
}
/** SHA-256 over canonical JSON via Web Crypto (Node 22+ and browsers). */
export async function digestLearningValue(value: unknown): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (typeof subtle?.digest !== 'function') throw new Error('Web Crypto SHA-256 is unavailable.');
    const text = canonicalLearningJSON(snapshot(value, 1_048_576, 'digest input'));
    const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return 'sha256:' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateFeedbackProvenance(raw: unknown): FeedbackProvenance {
    const safe = snapshot(raw, GOVERNANCE_LIMITS.maxProvenanceBytes, 'provenance');
    const v = fields<unknown>(
        safe,
        ['version', 'createdAt', 'source', 'owner', 'session', 'subject', 'evidence', 'consent', 'label', 'redaction', 'retention'],
        'provenance'
    );
    for (const key of ['version', 'createdAt', 'source', 'owner', 'subject', 'evidence', 'consent', 'label', 'redaction', 'retention'])
        if (!(key in v)) invalid('provenance');
    if (v.version !== 1) invalid('provenance version');
    time(v.createdAt, 'provenance time');

    const source = fields<unknown>(v.source, ['kind', 'id', 'group'], 'source');
    oneOf(source.kind, FEEDBACK_SOURCE_KINDS, 'source kind');
    ref(source.id, 'source id');
    if ('group' in source) ref(source.group, 'source group');

    const owner = fields<unknown>(v.owner, ['scopeKind', 'scopeId'], 'owner');
    oneOf(owner.scopeKind, ['personal', 'company'] as const, 'owner scope');
    ref(owner.scopeId, 'owner scope id');
    if ('session' in v) ref(v.session, 'session reference');

    const subject = fields<unknown>(v.subject, ['agentVersion', 'modelId', 'modelVersion', 'configurationVersion'], 'subject');
    for (const key of Object.keys(subject)) ref(subject[key], 'subject');

    const evidence = list(v.evidence, GOVERNANCE_LIMITS.maxEvidence, 'evidence');
    const seen = new Set<string>();
    for (const item of evidence) {
        const e = fields<unknown>(item, ['kind', 'ref', 'origin'], 'evidence');
        oneOf(e.kind, EVIDENCE_KINDS, 'evidence kind');
        ref(e.ref, 'evidence ref');
        oneOf(e.origin, EVIDENCE_ORIGINS, 'evidence origin');
        if (seen.has(e.ref as string)) invalid('evidence (duplicate ref)');
        seen.add(e.ref as string);
    }

    const consent = fields<unknown>(v.consent, ['ref', 'purposes'], 'consent');
    ref(consent.ref, 'consent ref');
    const purposes = list(consent.purposes, CONSENT_PURPOSES.length, 'consent purposes');
    if (!purposes.length || new Set(purposes).size !== purposes.length) invalid('consent purposes');
    purposes.forEach((p) => oneOf(p, CONSENT_PURPOSES, 'consent purpose'));

    const label = fields<unknown>(v.label, ['revision', 'supersedes'], 'label');
    if (
        !Number.isSafeInteger(label.revision) ||
        (label.revision as number) < 1 ||
        (label.revision as number) > GOVERNANCE_LIMITS.maxLabelRevision
    )
        invalid('label revision');
    if ((label.revision === 1) === ('supersedes' in label)) invalid('label revision');
    if ('supersedes' in label) ref(label.supersedes, 'label supersedes');

    const redaction = fields<unknown>(v.redaction, ['applied', 'fields', 'method'], 'redaction');
    if (typeof redaction.applied !== 'boolean') invalid('redaction');
    const redacted = list(redaction.fields, GOVERNANCE_LIMITS.maxRedactedFields, 'redaction fields');
    redacted.forEach((f) => {
        if (typeof f !== 'string' || !FIELD.test(f)) invalid('redaction field');
    });
    if (redaction.applied) {
        if (!redacted.length) invalid('redaction');
        oneOf(redaction.method, REDACTION_METHODS, 'redaction method');
    } else if (redacted.length || 'method' in redaction) invalid('redaction');

    const retention = fields<unknown>(v.retention, ['expiresAt'], 'retention');
    time(retention.expiresAt, 'retention');
    const lifetime = (retention.expiresAt as number) - (v.createdAt as number);
    if (lifetime <= 0 || lifetime > GOVERNANCE_LIMITS.maxRetentionMs) invalid('retention');
    return safe as unknown as FeedbackProvenance;
}

/** Validates the governed envelope. Rejects any self-asserted verification and restricted content (tokens, keys, emails). */
export function validateGovernedFeedback(raw: unknown): GovernedFeedback {
    const safe = snapshot(raw, GOVERNANCE_LIMITS.maxGovernedBytes, 'governed feedback');
    const v = fields<unknown>(safe, ['format', 'version', 'feedback', 'provenance'], 'governed feedback');
    if (v.format !== 'shivax-governed-feedback' || v.version !== 1) invalid('governed feedback');
    let feedback: FeedbackRecord;
    try {
        feedback = validateFeedback(v.feedback);
    } catch {
        return invalid('feedback record');
    }
    const provenance = validateFeedbackProvenance(v.provenance);
    if (provenance.label.supersedes === feedback.id) invalid('label supersedes');
    try {
        privacy(safe);
    } catch {
        throw new Error('Governed feedback contains restricted content.');
    }
    return safe as unknown as GovernedFeedback;
}
/** Explicit wrapping of an existing v1 record. There is no implicit migration. */
export function createGovernedFeedback(feedback: unknown, provenance: unknown): GovernedFeedback {
    return validateGovernedFeedback({
        format: 'shivax-governed-feedback',
        version: 1,
        feedback,
        provenance,
    });
}
export function governedFeedbackDigest(raw: unknown): Promise<string> {
    return digestLearningValue(validateGovernedFeedback(raw));
}

export function validateReviewAttestation(raw: unknown): ReviewAttestation {
    const safe = snapshot(raw, GOVERNANCE_LIMITS.maxAttestationBytes, 'attestation');
    const v = fields<unknown>(
        safe,
        ['format', 'version', 'feedbackId', 'labelRevision', 'contentDigest', 'status', 'method', 'reviewerRef', 'reviewedAt'],
        'attestation'
    );
    if (v.format !== 'shivax-review-attestation' || v.version !== 1) invalid('attestation');
    if (typeof v.feedbackId !== 'string' || !v.feedbackId.trim() || v.feedbackId.length > 256)
        invalid('attestation feedback id');
    if (
        !Number.isSafeInteger(v.labelRevision) ||
        (v.labelRevision as number) < 1 ||
        (v.labelRevision as number) > GOVERNANCE_LIMITS.maxLabelRevision
    )
        invalid('attestation revision');
    if (typeof v.contentDigest !== 'string' || !DIGEST.test(v.contentDigest)) invalid('attestation digest');
    oneOf(v.status, REVIEW_STATUSES, 'attestation status');
    oneOf(v.method, REVIEW_METHODS, 'attestation method');
    ref(v.reviewerRef, 'attestation reviewer');
    time(v.reviewedAt, 'attestation time');
    return safe as unknown as ReviewAttestation;
}
async function buildAttestation(
    governed: GovernedFeedback,
    reviewerRef: string,
    reviewedAt: number,
    status: ReviewStatus,
    method: ReviewMethod
): Promise<ReviewAttestation> {
    return validateReviewAttestation({
        format: 'shivax-review-attestation',
        version: 1,
        feedbackId: governed.feedback.id,
        labelRevision: governed.provenance.label.revision,
        contentDigest: await digestLearningValue(governed),
        status,
        method,
        reviewerRef,
        reviewedAt,
    });
}
/**
 * Lower-level, host-asserted review (method `host-asserted`). Curation rejects these unless the
 * policy sets `allowHostAssertedReviews`. Prefer `createReviewAttestor`, which uses Jay.
 */
export async function attestGovernedFeedback(
    raw: unknown,
    reviewer: { readonly reviewerRef: string; readonly reviewedAt: number },
    status: ReviewStatus = 'verified'
): Promise<ReviewAttestation> {
    const governed = validateGovernedFeedback(raw);
    oneOf(status, REVIEW_STATUSES, 'review status');
    const r = fields<unknown>(reviewer, ['reviewerRef', 'reviewedAt'], 'reviewer');
    ref(r.reviewerRef, 'reviewer');
    time(r.reviewedAt, 'review time');
    if (r.reviewerRef === governed.provenance.source.id) throw new Error('A source cannot attest its own feedback.');
    if ((r.reviewedAt as number) < governed.provenance.createdAt) invalid('review time');
    return buildAttestation(governed, r.reviewerRef as string, r.reviewedAt as number, status, 'host-asserted');
}

export interface ReviewAttestorOptions {
    /** Permission the Jay principal must hold, for example `learning.review`. */
    readonly permission: string;
    /** Trusted host role check (literal `true` required). Reviewer data is never read from the payload. */
    authorize(identity: AuthenticatedIdentity, record: GovernedFeedback, signal: BotSignal): boolean | Promise<boolean>;
    /** Host clock for `reviewedAt`. Defaults to Date.now. */
    readonly now?: () => number;
}
export interface ReviewAttestor {
    attest(root: TaskContext, record: unknown, status: ReviewStatus, signal: BotSignal): Promise<ReviewAttestation>;
}
/** Opaque, non-reversible reviewer reference derived from a Jay identity (issuer and principal id). */
export async function reviewerRefFor(identity: AuthenticatedIdentity): Promise<string> {
    const digest = await digestLearningValue(['shivax-reviewer-v1', identity.principal.issuer, identity.principal.id]);
    return 'reviewer:' + digest.slice(7, 39);
}
/**
 * Reviewer identity comes only from a Jay-minted, live session context: never from the payload.
 * The principal must hold `permission`, belong to the record's tenant, not be the record's source,
 * and pass the host `authorize` check.
 */
export function createReviewAttestor(jay: Jay, options: ReviewAttestorOptions): ReviewAttestor {
    if (!jay || typeof jay.verify !== 'function') invalid('Jay instance');
    if (typeof options?.permission !== 'string' || !REF.test(options.permission)) invalid('review permission');
    if (typeof options.authorize !== 'function' || (options.now !== undefined && typeof options.now !== 'function'))
        invalid('review attestor options');
    const verify = jay.verify.bind(jay),
        authorize = options.authorize.bind(options),
        permission = options.permission,
        now = options.now ?? Date.now;
    return Object.freeze({
        async attest(root: TaskContext, raw: unknown, status: ReviewStatus, signal: BotSignal) {
            const governed = validateGovernedFeedback(raw);
            oneOf(status, REVIEW_STATUSES, 'review status');
            // Rejects copied, forged, expired or revoked contexts.
            const identity = await verify(root, signal);
            signal.throwIfAborted();
            const { owner, source } = governed.provenance;
            if (!identity.principal.permissions.includes(permission))
                throw new Error('Reviewer lacks the review permission.');
            if (identity.session.scope.kind !== owner.scopeKind || identity.session.scope.id !== owner.scopeId)
                throw new Error('Reviewer belongs to a different tenant.');
            const reviewerRef = await reviewerRefFor(identity);
            if (source.id === identity.principal.id || source.id === reviewerRef)
                throw new Error('A source cannot attest its own feedback.');
            let allowed: unknown;
            try {
                allowed = await authorize(identity, governed, signal);
            } catch {
                allowed = false;
            }
            signal.throwIfAborted();
            if (allowed !== true) throw new Error('Reviewer is not authorized.');
            const reviewedAt = now();
            time(reviewedAt, 'review time');
            if (reviewedAt < governed.provenance.createdAt) invalid('review time');
            return buildAttestation(governed, reviewerRef, reviewedAt, status, 'jay-identity');
        },
    });
}

/** Same Chitragupt protected service as `storeLearningFeedback`. Host verification, Vijay policy and approval stay mandatory. */
export async function storeGovernedFeedback(
    tools: BotToolClient,
    raw: unknown,
    options: { readonly now?: number; readonly ttlMs?: number } = {}
): Promise<BotValue> {
    const governed = validateGovernedFeedback(raw);
    const now = options.now ?? Date.now();
    time(now, 'store time');
    const remaining = governed.provenance.retention.expiresAt - now;
    if (remaining <= 0) throw new Error('Governed feedback retention has expired.');
    if (options.ttlMs !== undefined && (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1))
        invalid('ttl');
    // Memory never retains a label beyond its declared retention. The memory category limit still applies.
    const ttlMs = Math.min(remaining, options.ttlMs ?? 7 * DAY);
    return tools.execute('shivax.memory.records.save', {
        id: governed.feedback.id,
        category: 'verified-outcome',
        value: governed as unknown as BotValue,
        tags: ['learning-feedback', 'governed-v1'],
        ttlMs,
    });
}
