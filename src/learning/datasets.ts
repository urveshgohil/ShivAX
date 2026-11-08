import type { BotSignal, BotValue } from '../agents/types.js';
import { record, snapshotValue } from '../agents/validation.js';
import { validateTrainingExport, type CuratedTrainingRow } from './training.js';
import {
    CONSENT_PURPOSES,
    FEEDBACK_SOURCE_KINDS,
    GOVERNANCE_LIMITS,
    canonicalLearningJSON,
    digestLearningValue,
    validateGovernedFeedback,
    validateReviewAttestation,
    type ConsentPurpose,
    type FeedbackOwner,
    type FeedbackSourceKind,
    type GovernedFeedback,
    type ReviewAttestation,
    type ReviewMethod,
} from './provenance.js';

export const DATASET_SPLITS = Object.freeze(['train', 'validation', 'heldOut'] as const);
export type DatasetSplit = (typeof DATASET_SPLITS)[number];
/** Reason codes only. Exclusion reports never carry record content. */
export const CURATION_EXCLUSIONS = Object.freeze([
    'invalid-record',
    'rejected-decision',
    'cross-tenant',
    'expired',
    'consent-missing',
    'unattested',
    'digest-mismatch',
    'self-attested',
    'stale-attestation',
    'review-rejected',
    'host-asserted-review',
    'review-unconfirmed',
    'consent-withdrawn',
    'not-selected',
    'hook-error',
    'duplicate',
    'conflicting-duplicate',
    'superseded',
    'conflicting-label',
] as const);
export type CurationExclusion = (typeof CURATION_EXCLUSIONS)[number];
export const CURATION_LIMITS = Object.freeze({ maxRecords: 1_024, maxAttestations: 2_048, maxSplitRows: 256 });

export interface CurationPolicy {
    readonly datasetId: string;
    /** Monotonic host-assigned dataset version (1..1,000,000). */
    readonly datasetVersion: number;
    /** Opaque host reference for the curator. */
    readonly curatorRef: string;
    /** Every record must belong to this owner. */
    readonly owner: FeedbackOwner;
    readonly purpose: ConsentPurpose;
    /** Trusted host clock, epoch milliseconds. */
    readonly now: number;
    readonly maxAttestationAgeMs: number;
    readonly seed: string;
    /** Integer weights. `train` and `heldOut` must be positive; `validation` may be 0. */
    readonly ratios: { readonly train: number; readonly validation: number; readonly heldOut: number };
    /** Default false: only reviews whose reviewer came from a Jay-verified session are admitted. */
    readonly allowHostAssertedReviews?: boolean;
}
/** Trusted host predicates. Only literal `true` passes; errors exclude the record. */
export interface CurationHooks {
    /**
     * Must confirm both that this host issued the attestation (for example, by looking up
     * `attestationDigest` in its own review journal) and that the reviewer is still authorized.
     * Attestations are integrity-bound but not signed, so this check is what makes them authentic.
     */
    confirmReview(attestation: ReviewAttestation, attestationDigest: string, signal: BotSignal): boolean | Promise<boolean>;
    consentActive(
        consentRef: string,
        purpose: ConsentPurpose,
        feedbackId: string,
        signal: BotSignal
    ): boolean | Promise<boolean>;
    /** Optional curator selection. Acceptance of feedback is not training consent. */
    select?(record: GovernedFeedback, signal: BotSignal): boolean | Promise<boolean>;
}
export interface TrainingExportV1 {
    readonly format: 'shivax-curated-training';
    readonly version: 1;
    readonly trust: 'untrusted';
    readonly rows: readonly CuratedTrainingRow[];
}
export interface DatasetManifest {
    readonly format: 'shivax-dataset-manifest';
    readonly version: 1;
    readonly id: string;
    readonly datasetVersion: number;
    readonly createdAt: number;
    readonly curatorRef: string;
    readonly owner: FeedbackOwner;
    readonly purpose: ConsentPurpose;
    readonly partition: {
        readonly method: 'component-sha256-v1';
        readonly seed: string;
        readonly ratios: CurationPolicy['ratios'];
    };
    readonly splits: Readonly<Record<DatasetSplit, { readonly rows: number; readonly digest: string }>>;
    readonly records: readonly {
        readonly feedbackId: string;
        readonly split: DatasetSplit;
        readonly contentDigest: string;
        readonly attestationDigest: string;
        readonly labelRevision: number;
        readonly reviewMethod: ReviewMethod;
        readonly sourceKind: FeedbackSourceKind;
    }[];
    /** Every listed record passed these rules at `checkedAt`. Later withdrawal does not alter this record. */
    readonly eligibility: {
        readonly rules: 'saraswati-s01-v1';
        readonly checkedAt: number;
        readonly reviewMethods: readonly ReviewMethod[];
    };
    readonly sources: Readonly<Record<FeedbackSourceKind, number>>;
    readonly excluded: Readonly<Record<CurationExclusion, number>>;
    readonly invalidAttestations: number;
    readonly trust: 'untrusted';
    /** SHA-256 of this manifest without `digest`. Integrity only; not authenticity. */
    readonly digest: string;
}
export interface CuratedDataset {
    readonly manifest: DatasetManifest;
    readonly splits: Readonly<Record<DatasetSplit, TrainingExportV1>>;
    /** `feedbackId` is null when a record failed validation (its id is untrusted). */
    readonly exclusions: readonly {
        readonly index: number;
        readonly feedbackId: string | null;
        readonly reason: CurationExclusion;
    }[];
}

const REF = /^[A-Za-z0-9._:-]{1,256}$/;
function invalid(what: string): never {
    throw new Error(`Invalid ${what}.`);
}
function check(signal: BotSignal): void {
    signal.throwIfAborted();
}
async function predicate(callback: () => unknown): Promise<boolean | 'error'> {
    try {
        return (await callback()) === true;
    } catch {
        return 'error';
    }
}

function validatePolicy(raw: unknown): CurationPolicy {
    let v: Record<string, unknown>;
    try {
        v = record(snapshotValue(raw, 4_096, 'invalid-input'), [
            'datasetId', 'datasetVersion', 'curatorRef', 'owner', 'purpose', 'now', 'maxAttestationAgeMs', 'seed', 'ratios',
            'allowHostAssertedReviews',
        ], 'invalid-input');
    } catch {
        return invalid('curation policy');
    }
    for (const key of ['datasetId', 'curatorRef', 'seed'])
        if (typeof v[key] !== 'string' || !REF.test(v[key] as string)) invalid(`curation ${key}`);
    const owner = v.owner as Record<string, unknown> | undefined;
    if (
        !owner ||
        typeof owner !== 'object' ||
        Object.keys(owner).sort().join() !== 'scopeId,scopeKind' ||
        !['personal', 'company'].includes(owner.scopeKind as string) ||
        typeof owner.scopeId !== 'string' ||
        !REF.test(owner.scopeId)
    )
        invalid('curation owner');
    if (!(CONSENT_PURPOSES as readonly unknown[]).includes(v.purpose)) invalid('curation purpose');
    if (!Number.isSafeInteger(v.datasetVersion) || (v.datasetVersion as number) < 1 || (v.datasetVersion as number) > 1_000_000)
        invalid('dataset version');
    if (v.allowHostAssertedReviews !== undefined && typeof v.allowHostAssertedReviews !== 'boolean')
        invalid('host-asserted review option');
    if (!Number.isSafeInteger(v.now) || (v.now as number) < 0) invalid('curation time');
    if (
        !Number.isSafeInteger(v.maxAttestationAgeMs) ||
        (v.maxAttestationAgeMs as number) < 1 ||
        (v.maxAttestationAgeMs as number) > GOVERNANCE_LIMITS.maxRetentionMs
    )
        invalid('attestation age');
    const ratios = v.ratios as Record<string, unknown> | undefined;
    if (
        !ratios ||
        typeof ratios !== 'object' ||
        Object.keys(ratios).sort().join() !== 'heldOut,train,validation' ||
        Object.values(ratios).some((n) => !Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 100) ||
        (ratios.train as number) < 1 ||
        (ratios.heldOut as number) < 1
    )
        invalid('partition ratios');
    return v as unknown as CurationPolicy;
}

function expectedOf(record: GovernedFeedback): BotValue {
    return record.feedback.decision === 'correct' ? record.feedback.correction! : record.feedback.output;
}
function counts<K extends string>(keys: readonly K[]): Record<K, number> {
    return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}
function trainingExport(rows: CuratedTrainingRow[]): TrainingExportV1 {
    const value = { format: 'shivax-curated-training', version: 1, trust: 'untrusted', rows };
    // Reuse the existing v1 validator so every split stays consumable by trainCuratedCandidate.
    validateTrainingExport(value);
    return snapshotValue(value, 1_048_576, 'invalid-input') as unknown as TrainingExportV1;
}

interface Candidate {
    readonly index: number;
    readonly record: GovernedFeedback;
    readonly contentDigest: string;
    readonly attestationDigest: string;
    readonly reviewMethod: ReviewMethod;
    readonly inputKey: string;
    readonly expectedKey: string;
    readonly group: string;
}

/**
 * Turns governed, host-attested feedback into leakage-safe v1 training exports plus a manifest.
 * Never trains, stores or activates anything. Untrusted content cannot pass without a valid host attestation.
 */
export async function curateDataset(
    records: readonly unknown[],
    attestations: readonly unknown[],
    rawPolicy: CurationPolicy,
    hooks: CurationHooks,
    signal: BotSignal
): Promise<CuratedDataset> {
    const policy = validatePolicy(rawPolicy);
    if (
        !Array.isArray(records) ||
        records.length > CURATION_LIMITS.maxRecords ||
        !Array.isArray(attestations) ||
        attestations.length > CURATION_LIMITS.maxAttestations
    )
        invalid('curation input');
    if (
        !hooks ||
        typeof hooks.confirmReview !== 'function' ||
        typeof hooks.consentActive !== 'function' ||
        (hooks.select !== undefined && typeof hooks.select !== 'function')
    )
        invalid('curation hooks');
    const confirmReview = hooks.confirmReview.bind(hooks),
        consentActive = hooks.consentActive.bind(hooks),
        select = hooks.select?.bind(hooks);
    check(signal);

    // Index attestations by the exact content digest they cover; the latest review wins deterministically.
    let invalidAttestations = 0;
    const attested = new Map<string, { attestation: ReviewAttestation; digest: string }>();
    const attestedLabels = new Set<string>();
    for (const raw of attestations) {
        let attestation: ReviewAttestation;
        try {
            attestation = validateReviewAttestation(raw);
        } catch {
            invalidAttestations++;
            continue;
        }
        attestedLabels.add(attestation.feedbackId + '\u0000' + attestation.labelRevision);
        const key = attestation.contentDigest;
        const digest = await digestLearningValue(attestation);
        const previous = attested.get(key);
        if (
            !previous ||
            attestation.reviewedAt > previous.attestation.reviewedAt ||
            (attestation.reviewedAt === previous.attestation.reviewedAt && digest < previous.digest)
        )
            attested.set(key, { attestation, digest });
    }
    check(signal);

    const exclusions: { index: number; feedbackId: string | null; reason: CurationExclusion }[] = [];
    const exclude = (index: number, feedbackId: string | null, reason: CurationExclusion) =>
        exclusions.push({ index, feedbackId, reason });
    const eligible: Candidate[] = [];
    for (const [index, raw] of records.entries()) {
        check(signal);
        let governed: GovernedFeedback;
        try {
            governed = validateGovernedFeedback(raw);
        } catch {
            exclude(index, null, 'invalid-record');
            continue;
        }
        const { feedback, provenance } = governed;
        const id = feedback.id;
        if (feedback.decision === 'reject') { exclude(index, id, 'rejected-decision'); continue; }
        if (
            provenance.owner.scopeKind !== policy.owner.scopeKind ||
            provenance.owner.scopeId !== policy.owner.scopeId
        ) { exclude(index, id, 'cross-tenant'); continue; }
        if (provenance.retention.expiresAt <= policy.now) { exclude(index, id, 'expired'); continue; }
        if (!provenance.consent.purposes.includes(policy.purpose)) { exclude(index, id, 'consent-missing'); continue; }
        const contentDigest = await digestLearningValue(governed);
        const entry = attested.get(contentDigest);
        if (
            !entry ||
            entry.attestation.feedbackId !== id ||
            entry.attestation.labelRevision !== provenance.label.revision
        ) {
            // An attestation for this label exists but covers different content: edited after review.
            exclude(index, id, attestedLabels.has(id + '\u0000' + provenance.label.revision) ? 'digest-mismatch' : 'unattested');
            continue;
        }
        const { attestation } = entry;
        if (attestation.status !== 'verified') { exclude(index, id, 'review-rejected'); continue; }
        if (attestation.method === 'host-asserted' && policy.allowHostAssertedReviews !== true) {
            exclude(index, id, 'host-asserted-review');
            continue;
        }
        if (attestation.reviewerRef === provenance.source.id) { exclude(index, id, 'self-attested'); continue; }
        if (
            attestation.reviewedAt < provenance.createdAt ||
            attestation.reviewedAt > policy.now ||
            policy.now - attestation.reviewedAt > policy.maxAttestationAgeMs
        ) { exclude(index, id, 'stale-attestation'); continue; }
        check(signal);
        const reviewer = await predicate(() => confirmReview(attestation, entry.digest, signal));
        check(signal);
        if (reviewer !== true) { exclude(index, id, reviewer === 'error' ? 'hook-error' : 'review-unconfirmed'); continue; }
        const consent = await predicate(() => consentActive(provenance.consent.ref, policy.purpose, id, signal));
        check(signal);
        if (consent !== true) { exclude(index, id, consent === 'error' ? 'hook-error' : 'consent-withdrawn'); continue; }
        if (select) {
            const chosen = await predicate(() => select(governed, signal));
            check(signal);
            if (chosen !== true) { exclude(index, id, chosen === 'error' ? 'hook-error' : 'not-selected'); continue; }
        }
        eligible.push({
            index,
            record: governed,
            contentDigest,
            attestationDigest: entry.digest,
            reviewMethod: attestation.method,
            inputKey: canonicalLearningJSON(feedback.input),
            expectedKey: canonicalLearningJSON(expectedOf(governed)),
            group: provenance.source.group ?? provenance.source.id,
        });
    }

    // 1. Same feedback id: identical content collapses to one; differing content excludes all copies.
    const byId = new Map<string, Candidate[]>();
    for (const c of eligible) byId.set(c.record.feedback.id, [...(byId.get(c.record.feedback.id) ?? []), c]);
    let remaining: Candidate[] = [];
    for (const group of byId.values()) {
        if (group.length === 1) { remaining.push(group[0]); continue; }
        if (group.every((c) => c.contentDigest === group[0].contentDigest)) {
            remaining.push(group[0]);
            group.slice(1).forEach((c) => exclude(c.index, c.record.feedback.id, 'duplicate'));
        } else group.forEach((c) => exclude(c.index, c.record.feedback.id, 'conflicting-duplicate'));
    }

    // 2. Label revisions: a later revision replaces the record it supersedes.
    const ids = new Map(remaining.map((c) => [c.record.feedback.id, c]));
    const dropped = new Map<Candidate, CurationExclusion>();
    for (const c of remaining) {
        const target = c.record.provenance.label.supersedes;
        const older = target === undefined ? undefined : ids.get(target);
        if (!older) continue;
        if (older.record.provenance.label.revision >= c.record.provenance.label.revision) {
            dropped.set(older, 'conflicting-label');
            dropped.set(c, 'conflicting-label');
        } else if (!dropped.has(older)) dropped.set(older, 'superseded');
    }
    remaining = remaining.filter((c) => {
        const reason = dropped.get(c);
        if (reason) exclude(c.index, c.record.feedback.id, reason);
        return !reason;
    });

    // 3. Same domain and canonical input: one agreed label survives (lowest id); disagreement excludes all.
    const byInput = new Map<string, Candidate[]>();
    for (const c of remaining) {
        const key = c.record.feedback.domain + '\u0000' + c.inputKey;
        byInput.set(key, [...(byInput.get(key) ?? []), c]);
    }
    remaining = [];
    for (const group of byInput.values()) {
        group.sort((a, b) => (a.record.feedback.id < b.record.feedback.id ? -1 : 1));
        if (group.every((c) => c.expectedKey === group[0].expectedKey)) {
            remaining.push(group[0]);
            group.slice(1).forEach((c) => exclude(c.index, c.record.feedback.id, 'duplicate'));
        } else group.forEach((c) => exclude(c.index, c.record.feedback.id, 'conflicting-label'));
    }
    check(signal);

    // 4. Partition by connected components over shared canonical input or source group.
    const parent = remaining.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const link = (keyed: Map<string, number>, key: string, i: number) => {
        const j = keyed.get(key);
        if (j === undefined) keyed.set(key, i);
        else parent[find(i)] = find(j);
    };
    const inputs = new Map<string, number>(), groups = new Map<string, number>();
    remaining.forEach((c, i) => {
        link(inputs, c.inputKey, i);
        link(groups, c.group, i);
    });
    const components = new Map<number, Candidate[]>();
    remaining.forEach((c, i) => components.set(find(i), [...(components.get(find(i)) ?? []), c]));
    const ordered: { order: string; members: Candidate[] }[] = [];
    for (const members of components.values()) {
        members.sort((a, b) => (a.record.feedback.id < b.record.feedback.id ? -1 : 1));
        ordered.push({ order: await digestLearningValue([policy.seed, members[0].record.feedback.id]), members });
    }
    ordered.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const weights = policy.ratios, total = weights.train + weights.validation + weights.heldOut;
    const required = DATASET_SPLITS.filter((s) => weights[s] > 0);
    // Zero eligible rows is a valid outcome: empty splits plus the exclusion report explain why.
    if (ordered.length && ordered.length < required.length)
        throw new Error('Not enough independent source groups to partition.');
    const target = Object.fromEntries(
        DATASET_SPLITS.map((s) => [s, (remaining.length * weights[s]) / total])
    ) as Record<DatasetSplit, number>;
    const assigned: Record<DatasetSplit, Candidate[]> = { train: [], validation: [], heldOut: [] };
    const priority: DatasetSplit[] = ['heldOut', 'validation', 'train'];
    ordered.forEach(({ members }, position) => {
        // Reserve one component for each required split that is still empty.
        const empty = required.filter((s) => !assigned[s].length);
        const pool = ordered.length - position <= empty.length ? empty : required;
        const split = pool.reduce((best, s) => {
            const deficit = target[s] - assigned[s].length, bestDeficit = target[best] - assigned[best].length;
            return deficit > bestDeficit ||
                (deficit === bestDeficit && priority.indexOf(s) < priority.indexOf(best))
                ? s
                : best;
        }, pool[0]);
        assigned[split].push(...members);
    });
    for (const s of DATASET_SPLITS)
        if (assigned[s].length > CURATION_LIMITS.maxSplitRows) throw new Error('Split exceeds the v1 export limit.');

    const splits = Object.fromEntries(
        DATASET_SPLITS.map((s) => [
            s,
            trainingExport(
                assigned[s]
                    .slice()
                    .sort((a, b) => (a.record.feedback.id < b.record.feedback.id ? -1 : 1))
                    .map((c) => ({
                        feedbackId: c.record.feedback.id,
                        domain: c.record.feedback.domain,
                        input: c.record.feedback.input,
                        expected: expectedOf(c.record),
                    }))
            ),
        ])
    ) as Record<DatasetSplit, TrainingExportV1>;
    const leakage = checkPartitionLeakage(splits, Object.fromEntries(remaining.map((c) => [c.record.feedback.id, c.group])));
    if (!leakage.ok) throw new Error('Partition leakage detected.');

    const sources = counts(FEEDBACK_SOURCE_KINDS), excluded = counts(CURATION_EXCLUSIONS);
    exclusions.forEach((e) => excluded[e.reason]++);
    const manifestRecords = DATASET_SPLITS.flatMap((split) =>
        assigned[split].map((c) => {
            sources[c.record.provenance.source.kind]++;
            return {
                feedbackId: c.record.feedback.id,
                split,
                contentDigest: c.contentDigest,
                attestationDigest: c.attestationDigest,
                labelRevision: c.record.provenance.label.revision,
                reviewMethod: c.reviewMethod,
                sourceKind: c.record.provenance.source.kind,
            };
        })
    ).sort((a, b) => (a.feedbackId < b.feedbackId ? -1 : 1));
    const body = {
        format: 'shivax-dataset-manifest',
        version: 1,
        id: policy.datasetId,
        datasetVersion: policy.datasetVersion,
        createdAt: policy.now,
        curatorRef: policy.curatorRef,
        owner: { scopeKind: policy.owner.scopeKind, scopeId: policy.owner.scopeId },
        purpose: policy.purpose,
        partition: { method: 'component-sha256-v1', seed: policy.seed, ratios: { ...policy.ratios } },
        splits: Object.fromEntries(
            await Promise.all(
                DATASET_SPLITS.map(async (s) => [s, { rows: splits[s].rows.length, digest: await digestLearningValue(splits[s]) }])
            )
        ),
        records: manifestRecords,
        eligibility: {
            rules: 'saraswati-s01-v1',
            checkedAt: policy.now,
            reviewMethods: policy.allowHostAssertedReviews === true ? ['jay-identity', 'host-asserted'] : ['jay-identity'],
        },
        sources,
        excluded,
        invalidAttestations,
        trust: 'untrusted',
    };
    const manifest = snapshotValue(
        { ...body, digest: await digestLearningValue(body) },
        1_048_576,
        'invalid-input'
    ) as unknown as DatasetManifest;
    exclusions.sort((a, b) => a.index - b.index);
    return Object.freeze({
        manifest,
        splits: Object.freeze(splits),
        exclusions: Object.freeze(exclusions.map((e) => Object.freeze(e))),
    });
}

/** Recomputes split and manifest digests. Integrity only: a store attacker can recompute digests too. */
export async function verifyCuratedDataset(dataset: unknown): Promise<CuratedDataset> {
    let v: Record<string, unknown>;
    try {
        v = record(dataset, ['manifest', 'splits', 'exclusions'], 'invalid-input');
    } catch {
        return invalid('curated dataset');
    }
    const manifest = validateDatasetManifest(v.manifest);
    const { digest, ...body } = manifest;
    if ((await digestLearningValue(body)) !== digest) throw new Error('Dataset manifest digest mismatch.');
    let splits: Record<string, unknown>;
    try {
        splits = record(v.splits, DATASET_SPLITS, 'invalid-input');
    } catch {
        return invalid('dataset splits');
    }
    for (const s of DATASET_SPLITS) {
        const rows = validateTrainingExport(splits[s]);
        if (
            rows.length !== manifest.splits[s].rows ||
            (await digestLearningValue(splits[s])) !== manifest.splits[s].digest
        )
            throw new Error('Dataset split digest mismatch.');
        const ids = manifest.records.filter((r) => r.split === s).map((r) => r.feedbackId).sort();
        if (rows.map((r) => r.feedbackId).sort().join('\u0000') !== ids.join('\u0000'))
            throw new Error('Dataset split does not match its manifest.');
    }
    if (!checkPartitionLeakage(splits as Record<DatasetSplit, unknown>).ok)
        throw new Error('Partition leakage detected.');
    return dataset as CuratedDataset;
}

export function validateDatasetManifest(raw: unknown): DatasetManifest {
    let v: Record<string, unknown>;
    try {
        v = record(snapshotValue(raw, 1_048_576, 'invalid-input'), [
            'format', 'version', 'id', 'datasetVersion', 'createdAt', 'curatorRef', 'owner', 'purpose', 'partition',
            'splits', 'records', 'eligibility', 'sources', 'excluded', 'invalidAttestations', 'trust', 'digest',
        ], 'invalid-input');
    } catch {
        return invalid('dataset manifest');
    }
    if (v.format !== 'shivax-dataset-manifest' || v.version !== 1 || v.trust !== 'untrusted')
        invalid('dataset manifest');
    if (typeof v.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(v.digest)) invalid('manifest digest');
    const partition = v.partition as Record<string, unknown>;
    validatePolicy({
        datasetId: v.id,
        datasetVersion: v.datasetVersion,
        curatorRef: v.curatorRef,
        owner: v.owner,
        purpose: v.purpose,
        now: v.createdAt,
        maxAttestationAgeMs: 1,
        seed: partition?.seed,
        ratios: partition?.ratios,
    });
    if (!partition || partition.method !== 'component-sha256-v1' || Object.keys(partition).length !== 3)
        invalid('manifest partition');
    const splits = v.splits as Record<string, Record<string, unknown>>;
    if (!splits || Object.keys(splits).sort().join() !== 'heldOut,train,validation') invalid('manifest splits');
    for (const s of DATASET_SPLITS) {
        const entry = splits[s];
        if (
            !entry ||
            Object.keys(entry).sort().join() !== 'digest,rows' ||
            !Number.isSafeInteger(entry.rows) ||
            (entry.rows as number) < 0 ||
            (entry.rows as number) > CURATION_LIMITS.maxSplitRows ||
            typeof entry.digest !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/.test(entry.digest)
        )
            invalid('manifest split');
    }
    if (!Array.isArray(v.records)) invalid('manifest records');
    const seen = new Set<string>();
    for (const r of v.records as Record<string, unknown>[]) {
        if (
            !r ||
            Object.keys(r).sort().join() !== 'attestationDigest,contentDigest,feedbackId,labelRevision,reviewMethod,sourceKind,split' ||
            !Number.isSafeInteger(r.labelRevision) || (r.labelRevision as number) < 1 ||
            !['jay-identity', 'host-asserted'].includes(r.reviewMethod as string) ||
            typeof r.feedbackId !== 'string' ||
            seen.has(r.feedbackId) ||
            !(DATASET_SPLITS as readonly unknown[]).includes(r.split) ||
            !(FEEDBACK_SOURCE_KINDS as readonly unknown[]).includes(r.sourceKind) ||
            [r.contentDigest, r.attestationDigest].some(
                (d) => typeof d !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(d)
            )
        )
            invalid('manifest record');
        seen.add(r.feedbackId);
    }
    for (const s of DATASET_SPLITS)
        if ((v.records as { split: string }[]).filter((r) => r.split === s).length !== splits[s].rows)
            invalid('manifest split count');
    for (const [key, names] of [['sources', FEEDBACK_SOURCE_KINDS], ['excluded', CURATION_EXCLUSIONS]] as const) {
        const tally = v[key] as Record<string, unknown>;
        if (
            !tally ||
            Object.keys(tally).sort().join() !== [...names].sort().join() ||
            Object.values(tally).some((n) => !Number.isSafeInteger(n) || (n as number) < 0)
        )
            invalid(`manifest ${key}`);
    }
    if (
        Object.values(v.sources as Record<string, number>).reduce((a, b) => a + b, 0) !==
        (v.records as unknown[]).length
    )
        invalid('manifest sources');
    if (!Number.isSafeInteger(v.invalidAttestations) || (v.invalidAttestations as number) < 0)
        invalid('manifest attestations');
    const eligibility = v.eligibility as Record<string, unknown> | undefined;
    const methods = eligibility?.reviewMethods as unknown[] | undefined;
    if (
        !eligibility ||
        Object.keys(eligibility).sort().join() !== 'checkedAt,reviewMethods,rules' ||
        eligibility.rules !== 'saraswati-s01-v1' ||
        eligibility.checkedAt !== v.createdAt ||
        !Array.isArray(methods) ||
        !methods.length ||
        methods.some((m) => !['jay-identity', 'host-asserted'].includes(m as string)) ||
        new Set(methods).size !== methods.length ||
        (v.records as { reviewMethod: string }[]).some((r) => !methods.includes(r.reviewMethod))
    )
        invalid('manifest eligibility');
    return v as unknown as DatasetManifest;
}

export interface PartitionLeak {
    readonly kind: 'feedback-id' | 'input' | 'source-group';
    readonly splits: readonly [DatasetSplit, DatasetSplit];
    /** Feedback ids involved. Never the shared content. */
    readonly feedbackIds: readonly [string, string];
}
/**
 * Leakage check for any v1 training exports, including pre-SARASWATI ones.
 * Optional `groups` maps feedbackId to a source group (unknown for plain v1 exports).
 */
export function checkPartitionLeakage(
    splits: Partial<Record<DatasetSplit, unknown>>,
    groups: Readonly<Record<string, string>> = {}
): { readonly ok: boolean; readonly leaks: readonly PartitionLeak[] } {
    const present = DATASET_SPLITS.filter((s) => splits[s] !== undefined);
    if (!present.includes('train') || !present.includes('heldOut')) invalid('partition (train and heldOut required)');
    const seen = { 'feedback-id': new Map<string, [DatasetSplit, string]>(), input: new Map<string, [DatasetSplit, string]>(), 'source-group': new Map<string, [DatasetSplit, string]>() };
    const leaks: PartitionLeak[] = [];
    for (const split of present) {
        const rows = validateTrainingExport(splits[split]);
        for (const row of rows) {
            const keys: [keyof typeof seen, string | undefined][] = [
                ['feedback-id', row.feedbackId],
                ['input', canonicalLearningJSON(row.input)],
                ['source-group', Object.prototype.hasOwnProperty.call(groups, row.feedbackId) ? groups[row.feedbackId] : undefined],
            ];
            for (const [kind, key] of keys) {
                if (key === undefined) continue;
                const first = seen[kind].get(key);
                if (!first) seen[kind].set(key, [split, row.feedbackId]);
                else if (first[0] !== split)
                    leaks.push(Object.freeze({ kind, splits: Object.freeze([first[0], split]) as readonly [DatasetSplit, DatasetSplit], feedbackIds: Object.freeze([first[1], row.feedbackId]) as readonly [string, string] }));
            }
        }
    }
    return Object.freeze({ ok: leaks.length === 0, leaks: Object.freeze(leaks) });
}

export interface CandidateLineage {
    /** Host identifier of a trained candidate (S04 registry id or equivalent). */
    readonly candidateId: string;
    /** Manifest digest of the dataset the candidate was trained on. */
    readonly datasetDigest: string;
}
export interface LineageReport {
    readonly datasets: readonly {
        readonly datasetId: string;
        readonly datasetVersion: number;
        readonly digest: string;
        readonly feedbackIds: readonly string[];
    }[];
    readonly candidates: readonly {
        readonly candidateId: string;
        readonly datasetDigest: string;
        readonly feedbackIds: readonly string[];
    }[];
    /** Always false: excluding a record from new datasets does not remove its influence from trained weights. */
    readonly influenceRemoved: false;
}
/**
 * Lists datasets and previously trained candidates that used feedback which has since become ineligible
 * (consent withdrawn, retention expired, label revoked). It flags them for host review; it changes nothing.
 */
export async function traceDatasetLineage(input: {
    readonly manifests: readonly unknown[];
    readonly candidates: readonly CandidateLineage[];
    readonly ineligibleFeedbackIds: readonly string[];
}): Promise<LineageReport> {
    let v: Record<string, unknown>;
    try {
        v = record(input, ['manifests', 'candidates', 'ineligibleFeedbackIds'], 'invalid-input');
    } catch {
        return invalid('lineage input');
    }
    const manifests = v.manifests, candidates = v.candidates, ids = v.ineligibleFeedbackIds;
    if (
        !Array.isArray(manifests) || manifests.length > 1_024 ||
        !Array.isArray(candidates) || candidates.length > 4_096 ||
        !Array.isArray(ids) || ids.length > 100_000 ||
        ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256)
    )
        invalid('lineage input');
    const withdrawn = new Set(ids as string[]);
    const byDigest = new Map<string, string[]>();
    const datasets: { datasetId: string; datasetVersion: number; digest: string; feedbackIds: string[] }[] = [];
    for (const raw of manifests) {
        const manifest = validateDatasetManifest(raw);
        const { digest, ...body } = manifest;
        if ((await digestLearningValue(body)) !== digest) throw new Error('Dataset manifest digest mismatch.');
        const hits = manifest.records.map((r) => r.feedbackId).filter((id) => withdrawn.has(id)).sort();
        byDigest.set(digest, hits);
        if (hits.length)
            datasets.push({ datasetId: manifest.id, datasetVersion: manifest.datasetVersion, digest, feedbackIds: hits });
    }
    const affected: { candidateId: string; datasetDigest: string; feedbackIds: string[] }[] = [];
    for (const raw of candidates as unknown[]) {
        let c: Record<string, unknown>;
        try {
            c = record(raw, ['candidateId', 'datasetDigest'], 'invalid-input');
        } catch {
            return invalid('candidate lineage');
        }
        if (typeof c.candidateId !== 'string' || !REF.test(c.candidateId) || typeof c.datasetDigest !== 'string')
            invalid('candidate lineage');
        const hits = byDigest.get(c.datasetDigest as string);
        // A candidate whose dataset manifest is unknown cannot be cleared; report it for review.
        if (hits === undefined || hits.length)
            affected.push({ candidateId: c.candidateId as string, datasetDigest: c.datasetDigest as string, feedbackIds: hits ?? [] });
    }
    datasets.sort((a, b) => (a.digest < b.digest ? -1 : 1));
    affected.sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));
    return snapshotValue(
        { datasets, candidates: affected, influenceRemoved: false },
        1_048_576,
        'invalid-input'
    ) as unknown as LineageReport;
}
