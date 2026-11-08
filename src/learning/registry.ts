import type { BotSignal, BotValue, TaskContext } from '../agents/types.js';
import { array, record, snapshotValue } from '../agents/validation.js';
import { NeuralNet, type SerializedNeuralNet } from '../nn/NeuralNet.js';
import type { Jay } from '../security/jay.js';
import type { FirewallStatus } from '../security/firewall/types.js';
import { canonicalLearningJSON, digestLearningValue, type FeedbackOwner } from './provenance.js';
import { validateDatasetManifest } from './datasets.js';
import {
    STRICT_BENCHMARK_POLICY,
    assessBenchmarkCandidate,
    validateBenchmarkPolicy,
    validateBenchmarkReport,
    validateBenchmarkSuite,
    type BenchmarkPolicy,
    type BenchmarkReport,
    type BenchmarkSuite,
} from './benchmarks.js';
import { ModelRegistryError, sha256Text, type ModelRegistryErrorCode, type ModelRegistryStore } from './registry-store.js';

/*
 * SARASWATI S04: durable model lifecycle, approval and rollback.
 *
 *   candidate ─evaluate─▶ evaluated ─approve─▶ approved ─activate─▶ active
 *       │                    │  ▲                 │  ▲                │
 *       └──────reject────────┴──┼─────────────────┘  └───superseded───┤
 *                               └──re-evaluate── rolled_back ◀rollback┘
 *
 * Every change is one compare-and-swap of the registry head, after its immutable objects are written.
 * Evidence (S01 dataset manifests, S02 benchmark reports) is verified by the registry, never accepted as a claim.
 * Nothing here trains, changes weights or deploys: the host loads the active version and builds its runtime.
 */

export const MODEL_STATES = Object.freeze(['candidate', 'evaluated', 'approved', 'active', 'rejected', 'rolled_back'] as const);
export type ModelState = (typeof MODEL_STATES)[number];
/** Allowed transitions. There is no path from `candidate` or `evaluated` straight to `active`. */
export const MODEL_TRANSITIONS: Readonly<Record<ModelState, readonly ModelState[]>> = Object.freeze({
    candidate: Object.freeze(['evaluated', 'rejected'] as ModelState[]),
    evaluated: Object.freeze(['evaluated', 'approved', 'rejected'] as ModelState[]),
    approved: Object.freeze(['evaluated', 'active', 'rejected'] as ModelState[]),
    active: Object.freeze(['approved', 'rolled_back'] as ModelState[]),
    rejected: Object.freeze([] as ModelState[]),
    rolled_back: Object.freeze(['evaluated', 'rejected'] as ModelState[]),
});
export const MODEL_REGISTRY_ACTIONS = Object.freeze(['create', 'register', 'evaluate', 'approve', 'reject', 'activate', 'rollback'] as const);
export type ModelRegistryAction = (typeof MODEL_REGISTRY_ACTIONS)[number];
/** `none`: a configuration-only version (no neural network). */
export const MODEL_FORMATS = Object.freeze(['shivax-neural-net@1', 'none'] as const);
export type ModelFormat = (typeof MODEL_FORMATS)[number];
export const MODEL_TRAINING_METHODS = Object.freeze(['offline', 'curated', 'worker', 'external'] as const);
export type ModelTrainingMethod = (typeof MODEL_TRAINING_METHODS)[number];
const DAY = 86_400_000;
export const MODEL_REGISTRY_LIMITS = Object.freeze({
    /** 1,024 worst-case entries (256-character ids) plus the rollback stack stay under the 1 MiB head limit. */
    maxVersions: 1_024,
    defaultMaxVersions: 512,
    /** Characters of canonical artifact JSON. */
    maxArtifactBytes: 67_108_864,
    defaultMaxArtifactBytes: 33_554_432,
    maxRecordBytes: 1_048_576,
    maxConfigurationBytes: 65_536,
    maxTrainingOptionsBytes: 8_192,
    maxActivationHistory: 64,
    defaultApprovalTtlMs: DAY,
    maxApprovalTtlMs: 30 * DAY,
    defaultEvidenceTtlMs: 7 * DAY,
    maxEvidenceTtlMs: 90 * DAY,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 600_000,
    maxAuditEntries: 1_000,
    maxTrainingExports: 4,
    maxSignatureLength: 2_048,
    maxWaiters: 32,
});
/** Benchmark gate reasons that mean the evidence itself is unusable (not that the model is bad). */
const EVIDENCE_REASONS: readonly string[] = Object.freeze(['untrusted-evaluator', 'not-ground-truth', 'dataset-leakage', 'unevaluated-cases', 'domain-not-evaluated']);

/* ------------------------------------------------------------------ records */

export interface ModelArtifact {
    readonly format: 'shivax-model-artifact';
    readonly version: 1;
    /** `shivax-neural-net` v1, stored exactly as `NeuralNet.fromJSON(model).toJSON()` returns it; null for configuration-only versions. */
    readonly model: SerializedNeuralNet | null;
    readonly configuration: BotValue;
}
export interface ModelVersionManifest {
    readonly format: 'shivax-model-manifest';
    readonly version: 1;
    readonly registryId: string;
    readonly modelId: string;
    readonly versionId: string;
    /** Monotonic registration number assigned by the registry. */
    readonly sequence: number;
    readonly owner: FeedbackOwner;
    readonly artifact: {
        /** SHA-256 of the canonical artifact text (the object key). */
        readonly digest: string;
        readonly bytes: number;
        readonly modelFormat: ModelFormat;
        readonly architecture: { readonly layers: readonly number[]; readonly task: string; readonly activation: string } | null;
    };
    /** S01 dataset manifest the version was trained on, verified at registration. */
    readonly dataset: { readonly id: string; readonly version: number; readonly digest: string; readonly manifest: string } | null;
    readonly training: {
        readonly method: ModelTrainingMethod;
        readonly options: BotValue;
        readonly seed: number | null;
        readonly parent: { readonly versionId: string; readonly manifest: string } | null;
    };
    readonly createdAt: number;
    /** Opaque host actor reference. */
    readonly createdBy: string;
}
export interface ModelEvaluationRecord {
    readonly format: 'shivax-model-evaluation';
    readonly version: 1;
    readonly registryId: string;
    readonly versionId: string;
    readonly manifest: string;
    readonly suite: { readonly id: string; readonly suiteVersion: string; readonly datasetDigest: string; readonly object: string };
    /** `versionId` null: there was no active version, so any baseline configuration was accepted. */
    readonly baseline: { readonly versionId: string | null; readonly report: string; readonly reportDigest: string; readonly logicalDigest: string; readonly configurationDigest: string | null };
    readonly candidate: { readonly report: string; readonly reportDigest: string; readonly logicalDigest: string; readonly configurationDigest: string };
    readonly evaluator: { readonly id: string; readonly version: string; readonly kind: string };
    /** `profile`: digest of the registry's security settings when the evaluation was made. */
    readonly policy: { readonly id: string; readonly profile: string };
    readonly eligible: boolean;
    readonly reasons: readonly string[];
    readonly security: { readonly mandatoryTotal: number; readonly mandatoryPassed: number; readonly securityViolations: number };
    readonly leakage: { readonly checked: boolean; readonly trainingDigests: readonly string[] };
    readonly evaluatedAt: number;
    readonly actorRef: string;
}
export interface ModelApprovalRecord {
    readonly format: 'shivax-model-approval';
    readonly version: 1;
    readonly registryId: string;
    readonly versionId: string;
    readonly manifest: string;
    readonly evaluation: string;
    readonly actorRef: string;
    readonly approvedAt: number;
    readonly expiresAt: number;
    /** Manifest of the version that was active at approval. A different active version makes the approval stale. */
    readonly activeAtApproval: string | null;
    /** Firewall policy at approval. Any later policy change makes the approval stale. */
    readonly firewall: { readonly version: number; readonly mode: string };
    readonly securityProfile: string;
    readonly nonce: string;
}
export interface ModelJournalEntry {
    readonly format: 'shivax-model-journal';
    readonly version: 1;
    readonly registryId: string;
    readonly sequence: number;
    readonly revision: number;
    readonly at: number;
    readonly operation: string;
    readonly action: ModelRegistryAction;
    readonly versionId: string | null;
    readonly from: ModelState | null;
    readonly to: ModelState | null;
    /** The version that changed state as a side effect (superseded or rolled back). */
    readonly displaced: { readonly versionId: string; readonly from: ModelState; readonly to: ModelState } | null;
    readonly active: string | null;
    readonly actorRef: string;
    readonly reasons: readonly string[];
    /** Previous journal entry (object key). The chain is tamper-evident, not signed. */
    readonly prev: string | null;
}

interface HeadVersion {
    readonly versionId: string;
    readonly modelId: string;
    readonly sequence: number;
    readonly state: ModelState;
    readonly manifest: string;
    readonly evaluation: string | null;
    readonly approval: string | null;
    readonly updatedAt: number;
}
interface Head {
    readonly format: 'shivax-model-registry';
    readonly version: 1;
    readonly registryId: string;
    readonly owner: FeedbackOwner;
    readonly issuer: string;
    readonly revision: number;
    readonly createdAt: number;
    readonly nextSequence: number;
    readonly securityProfile: string;
    readonly versions: readonly HeadVersion[];
    readonly active: string | null;
    readonly activations: readonly string[];
    readonly journal: { readonly tip: string; readonly length: number };
    readonly lastOperation: { readonly id: string; readonly action: ModelRegistryAction; readonly revision: number };
    readonly checksum: string;
    readonly signature: string | null;
}

/* ------------------------------------------------------------------ options */

export interface ModelRegistryFirewall {
    /** `ShivaxFirewallRuntime` satisfies this. Read before and immediately before every promotion commit. */
    status(): Pick<FirewallStatus, 'mode' | 'version' | 'admission'>;
}
/** Trusted host approval journal. Only literal `true` passes. */
export interface ModelRegistryApprovals {
    /** Persist `approvalDigest` in the host's protected journal before the approval is committed. */
    record(approval: ModelApprovalRecord, approvalDigest: string, signal: BotSignal): boolean | Promise<boolean>;
    /** At activation and rollback: confirm this host issued the approval and the approver is still authorized. */
    confirm(approval: ModelApprovalRecord, approvalDigest: string, signal: BotSignal): boolean | Promise<boolean>;
}
/** Optional authenticity for the head (for example an HMAC or Ed25519 key held by the host). */
export interface ModelRegistrySigner {
    sign(checksum: string, signal: BotSignal): string | Promise<string>;
    verify(checksum: string, signature: string, signal: BotSignal): boolean | Promise<boolean>;
}
export interface ModelRegistrySubject {
    readonly registryId: string;
    readonly versionId: string | null;
    readonly modelId: string | null;
}
export interface ModelRegistryOptions {
    readonly registryId: string;
    /** Tenant scope. Administrators, datasets, suites and stored data must all belong to it. */
    readonly owner: FeedbackOwner;
    /** Jay principal issuer that administrators must have. */
    readonly issuer: string;
    readonly store: ModelRegistryStore;
    readonly jay: Jay;
    readonly firewall: ModelRegistryFirewall;
    /** Fresh, action-specific administrator role check. Return an opaque actor reference (16–128 of [A-Za-z0-9_-]) or null. */
    authorize(root: TaskContext, action: ModelRegistryAction, subject: ModelRegistrySubject, signal: BotSignal): string | null | Promise<string | null>;
    /** Synchronous revocation fence, called again immediately before the commit. Literal true required. */
    checkAuthorization(root: TaskContext, action: ModelRegistryAction, actorRef: string): boolean;
    readonly approvals: ModelRegistryApprovals;
    /** Evaluators whose benchmark results count as measured ground truth. */
    readonly trustedEvaluators: readonly { readonly id: string; readonly version: string }[];
    /** Benchmark gate policy. Default: STRICT_BENCHMARK_POLICY. */
    readonly policy?: BenchmarkPolicy;
    /** Require at least one mandatory security case in candidate evidence. Default true. */
    readonly requireSecurityCases?: boolean;
    /** Approver must differ from the registrant and evaluator; activator must differ from the approver. Default false. */
    readonly separationOfDuties?: boolean;
    /** Allow rollback while the firewall is in lockdown. Default false. */
    readonly allowRollbackDuringLockdown?: boolean;
    readonly approvalTtlMs?: number;
    readonly evidenceTtlMs?: number;
    readonly supportedFormats?: readonly ModelFormat[];
    /** Optional extra runtime compatibility check (literal true). */
    checkCompatibility?(manifest: ModelVersionManifest, artifact: ModelArtifact): boolean;
    readonly signer?: ModelRegistrySigner;
    readonly now?: () => number;
    readonly timeoutMs?: number;
    readonly maxVersions?: number;
    readonly maxArtifactBytes?: number;
}
interface Resolved {
    readonly registryId: string;
    readonly owner: FeedbackOwner;
    readonly issuer: string;
    readonly store: ModelRegistryStore;
    readonly jay: Jay;
    readonly status: () => unknown;
    readonly authorize: ModelRegistryOptions['authorize'];
    readonly checkAuthorization: ModelRegistryOptions['checkAuthorization'];
    readonly record: ModelRegistryApprovals['record'];
    readonly confirm: ModelRegistryApprovals['confirm'];
    readonly trustedEvaluators: readonly { id: string; version: string }[];
    readonly policy: BenchmarkPolicy;
    readonly requireSecurityCases: boolean;
    readonly separationOfDuties: boolean;
    readonly allowRollbackDuringLockdown: boolean;
    readonly approvalTtlMs: number;
    readonly evidenceTtlMs: number;
    readonly supportedFormats: readonly ModelFormat[];
    readonly checkCompatibility?: (manifest: ModelVersionManifest, artifact: ModelArtifact) => boolean;
    readonly sign?: ModelRegistrySigner['sign'];
    readonly verify?: ModelRegistrySigner['verify'];
    readonly now: () => number;
    readonly timeoutMs: number;
    readonly maxVersions: number;
    readonly maxArtifactBytes: number;
    readonly profile: string;
}

/* ------------------------------------------------------------------ results */

export interface ModelVersionSummary {
    readonly versionId: string;
    readonly modelId: string;
    readonly sequence: number;
    readonly state: ModelState;
    readonly manifest: string;
    readonly evaluation: string | null;
    readonly approval: string | null;
    readonly updatedAt: number;
}
export interface ModelRegistrySnapshot {
    readonly registryId: string;
    readonly owner: FeedbackOwner;
    readonly revision: number;
    readonly active: string | null;
    /** Previously active versions, oldest first: the rollback targets. */
    readonly activations: readonly string[];
    readonly versions: readonly ModelVersionSummary[];
    /** Digest of the security settings this registry instance runs with. */
    readonly securityProfile: string;
    /** `unavailable`: the object failed to load or verify at the last refresh. */
    readonly health: { readonly journal: 'ok' | 'unavailable'; readonly active: 'ok' | 'unavailable' | 'none' };
}
export interface ModelRegistryResult {
    readonly revision: number;
    readonly versionId: string;
    readonly state: ModelState;
    /** The previously active version for activate and rollback; otherwise null. */
    readonly previous: string | null;
}
export interface ModelEvaluationResult extends ModelRegistryResult {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
    readonly evaluation: string;
}
export interface LoadedModelVersion {
    readonly versionId: string;
    readonly modelId: string;
    readonly revision: number;
    readonly manifestDigest: string;
    readonly manifest: ModelVersionManifest;
    readonly artifact: ModelArtifact;
}
export interface ModelRegistryIntegrityReport {
    readonly ok: boolean;
    readonly revision: number;
    readonly checkedObjects: number;
    readonly issues: readonly {
        readonly versionId: string | null;
        readonly object: 'manifest' | 'artifact' | 'dataset' | 'evaluation' | 'suite' | 'report' | 'approval' | 'journal';
        readonly problem: 'missing' | 'checksum-mismatch' | 'invalid';
    }[];
}
export interface ModelRegistrationInput {
    readonly expectedRevision: number;
    readonly modelId: string;
    readonly versionId: string;
    readonly artifact: { readonly model: SerializedNeuralNet | string | null; readonly configuration?: BotValue };
    /** The S01 `DatasetManifest` (verified: schema, digest, owner, purpose `training`). */
    readonly dataset?: unknown;
    readonly training: { readonly method: ModelTrainingMethod; readonly options?: BotValue; readonly seed?: number; readonly parentVersionId?: string };
}
export interface ModelEvaluationInput {
    readonly expectedRevision: number;
    /** S02 benchmark suite, baseline report and candidate report. */
    readonly suite: unknown;
    readonly baseline: unknown;
    readonly candidate: unknown;
    /** v1 training exports. Required when the version names a dataset: they must be that dataset's splits. */
    readonly training?: readonly unknown[];
}
export interface ModelRegistry {
    readonly registryId: string;
    readonly owner: FeedbackOwner;
    snapshot(): ModelRegistrySnapshot;
    version(versionId: string): ModelVersionSummary | null;
    /** S02 `runBenchmark` configuration that binds a report to this exact version manifest. */
    benchmarkConfiguration(versionId: string, role: 'baseline' | 'candidate'): { readonly role: 'baseline' | 'candidate'; readonly id: string; readonly version: string; readonly value: BotValue };
    refresh(signal: BotSignal): Promise<ModelRegistrySnapshot>;
    register(root: TaskContext, input: ModelRegistrationInput, signal: BotSignal): Promise<ModelRegistryResult>;
    evaluate(root: TaskContext, versionId: string, input: ModelEvaluationInput, signal: BotSignal): Promise<ModelEvaluationResult>;
    approve(root: TaskContext, versionId: string, command: { readonly expectedRevision: number }, signal: BotSignal): Promise<ModelRegistryResult>;
    reject(root: TaskContext, versionId: string, command: { readonly expectedRevision: number; readonly reason?: string }, signal: BotSignal): Promise<ModelRegistryResult>;
    activate(root: TaskContext, versionId: string, command: { readonly expectedRevision: number }, signal: BotSignal): Promise<ModelRegistryResult>;
    rollback(root: TaskContext, command: { readonly expectedRevision: number; readonly targetVersionId?: string }, signal: BotSignal): Promise<ModelRegistryResult>;
    /** The verified active version (manifest and artifact checksums, owner and format), or null. */
    loadActive(signal: BotSignal): Promise<LoadedModelVersion | null>;
    loadVersion(versionId: string, signal: BotSignal): Promise<LoadedModelVersion>;
    /** Journal entries, newest last, verified along the hash chain. */
    audit(signal: BotSignal, options?: { readonly limit?: number }): Promise<readonly ModelJournalEntry[]>;
    verify(signal: BotSignal): Promise<ModelRegistryIntegrityReport>;
    close(): Promise<void>;
}

/* ---------------------------------------------------------------- utilities */

const REF = /^[A-Za-z0-9._:-]{1,256}$/;
const KEY = /^sha256:[0-9a-f]{64}$/;
const ACTOR = /^[A-Za-z0-9_-]{16,128}$/;
const OP = /^[0-9a-f]{32}$/;
const TIMEOUT = Symbol('shivax-registry-timeout');
const fail = (code: ModelRegistryErrorCode, message?: string, reasons?: readonly string[]): never => {
    throw new ModelRegistryError(code, message, reasons ? { reasons } : {});
};
const corrupt = (what: string): never => fail('corrupt-registry', `Stored registry data is invalid: ${what}.`);
function fields(value: unknown, keys: readonly string[], onError: () => never, exact = true): Record<string, unknown> {
    let v: Record<string, unknown>;
    try {
        v = record(value, keys, 'invalid-input');
    } catch {
        return onError();
    }
    if (exact && keys.some((k) => !(k in v))) onError();
    return v;
}
function list(value: unknown, max: number, onError: () => never): readonly unknown[] {
    try {
        return array(value, max, 'invalid-input');
    } catch {
        return onError();
    }
}
const isRef = (v: unknown): v is string => typeof v === 'string' && REF.test(v);
const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const sameOwner = (a: FeedbackOwner, b: FeedbackOwner) => a.scopeKind === b.scopeKind && a.scopeId === b.scopeId;
function ownerOf(value: unknown, onError: () => never): FeedbackOwner {
    const v = fields(value, ['scopeKind', 'scopeId'], onError);
    if ((v.scopeKind !== 'personal' && v.scopeKind !== 'company') || !isRef(v.scopeId)) onError();
    return v as unknown as FeedbackOwner;
}
const canonical = (value: unknown) => canonicalLearningJSON(value as BotValue);
function randomHex(bytes: number): string {
    const b = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function abortError(signal: BotSignal): ModelRegistryError {
    return new ModelRegistryError((signal as AbortSignal).reason === TIMEOUT ? 'timeout' : 'cancelled');
}
/** Resolves `work`, or rejects as soon as `signal` aborts (the work itself may keep running). */
function race<T>(work: T | Promise<T>, signal: BotSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(work).then(
            (v) => {
                signal.removeEventListener('abort', onAbort);
                resolve(v);
            },
            (e) => {
                signal.removeEventListener('abort', onAbort);
                reject(e);
            }
        );
    });
}
function normalize(error: unknown, signal: BotSignal): ModelRegistryError {
    if (error instanceof ModelRegistryError) return error;
    if (signal.aborted) return abortError(signal);
    return new ModelRegistryError('storage-unavailable', 'The registry store failed.');
}
function bounded(value: unknown, fallback: number, min: number, max: number, what: string): number {
    if (value === undefined) return fallback;
    if (!isInt(value, min, max)) fail('invalid-configuration', `${what} must be an integer from ${min} to ${max}.`);
    return value as number;
}

/* --------------------------------------------------------------- validators */

function parseManifest(raw: unknown, r: Resolved): ModelVersionManifest {
    const bad = () => corrupt('version manifest');
    const v = fields(raw, ['format', 'version', 'registryId', 'modelId', 'versionId', 'sequence', 'owner', 'artifact', 'dataset', 'training', 'createdAt', 'createdBy'], bad);
    if (v.format !== 'shivax-model-manifest' || v.version !== 1 || !isRef(v.registryId) || !isRef(v.modelId) || !isRef(v.versionId) || !isInt(v.sequence, 1) || !isInt(v.createdAt, 0) || typeof v.createdBy !== 'string' || !ACTOR.test(v.createdBy))
        bad();
    if (v.registryId !== r.registryId || !sameOwner(ownerOf(v.owner, bad), r.owner)) fail('cross-tenant', 'A version manifest belongs to another registry or tenant.');
    const a = fields(v.artifact, ['digest', 'bytes', 'modelFormat', 'architecture'], bad);
    if (!isKey(a.digest) || !isInt(a.bytes, 1, MODEL_REGISTRY_LIMITS.maxArtifactBytes) || !(MODEL_FORMATS as readonly unknown[]).includes(a.modelFormat)) bad();
    if (a.architecture !== null) {
        const arch = fields(a.architecture, ['layers', 'task', 'activation'], bad);
        const layers = list(arch.layers, 8, bad);
        if (layers.length < 2 || layers.some((l) => !isInt(l, 1, 4096)) || typeof arch.task !== 'string' || typeof arch.activation !== 'string') bad();
    } else if (a.modelFormat !== 'none') bad();
    if (v.dataset !== null) {
        const d = fields(v.dataset, ['id', 'version', 'digest', 'manifest'], bad);
        if (!isRef(d.id) || !isInt(d.version, 1, 1_000_000) || !isKey(d.digest) || !isKey(d.manifest)) bad();
    }
    const t = fields(v.training, ['method', 'options', 'seed', 'parent'], bad);
    if (!(MODEL_TRAINING_METHODS as readonly unknown[]).includes(t.method) || !(t.seed === null || isInt(t.seed, 0, 0xffffffff))) bad();
    if (t.parent !== null) {
        const p = fields(t.parent, ['versionId', 'manifest'], bad);
        if (!isRef(p.versionId) || !isKey(p.manifest)) bad();
    }
    return v as unknown as ModelVersionManifest;
}
function parseArtifact(text: string, r: Resolved): ModelArtifact {
    const bad = () => corrupt('model artifact');
    let v: Record<string, unknown>;
    try {
        v = fields(JSON.parse(text), ['format', 'version', 'model', 'configuration'], bad);
    } catch {
        return bad();
    }
    if (v.format !== 'shivax-model-artifact' || v.version !== 1) bad();
    if (v.model !== null)
        try {
            NeuralNet.fromJSON(v.model);
        } catch {
            bad();
        }
    try {
        snapshotValue(v.configuration, MODEL_REGISTRY_LIMITS.maxConfigurationBytes, 'invalid-input');
    } catch {
        bad();
    }
    void r;
    return v as unknown as ModelArtifact;
}
function parseEvaluation(raw: unknown): ModelEvaluationRecord {
    const bad = () => corrupt('evaluation record');
    const v = fields(raw, ['format', 'version', 'registryId', 'versionId', 'manifest', 'suite', 'baseline', 'candidate', 'evaluator', 'policy', 'eligible', 'reasons', 'security', 'leakage', 'evaluatedAt', 'actorRef'], bad);
    if (v.format !== 'shivax-model-evaluation' || v.version !== 1 || !isRef(v.registryId) || !isRef(v.versionId) || !isKey(v.manifest) || typeof v.eligible !== 'boolean' || !isInt(v.evaluatedAt, 0) || typeof v.actorRef !== 'string' || !ACTOR.test(v.actorRef))
        bad();
    const s = fields(v.suite, ['id', 'suiteVersion', 'datasetDigest', 'object'], bad);
    if (!isRef(s.id) || !isRef(s.suiteVersion) || !isKey(s.datasetDigest) || !isKey(s.object)) bad();
    const b = fields(v.baseline, ['versionId', 'report', 'reportDigest', 'logicalDigest', 'configurationDigest'], bad);
    if (!(b.versionId === null || isRef(b.versionId)) || !isKey(b.report) || !isKey(b.reportDigest) || !isKey(b.logicalDigest) || !(b.configurationDigest === null || isKey(b.configurationDigest))) bad();
    const c = fields(v.candidate, ['report', 'reportDigest', 'logicalDigest', 'configurationDigest'], bad);
    if (!isKey(c.report) || !isKey(c.reportDigest) || !isKey(c.logicalDigest) || !isKey(c.configurationDigest)) bad();
    const e = fields(v.evaluator, ['id', 'version', 'kind'], bad);
    if (!isRef(e.id) || !isRef(e.version) || typeof e.kind !== 'string') bad();
    const p = fields(v.policy, ['id', 'profile'], bad);
    if (!isRef(p.id) || !isKey(p.profile)) bad();
    if (list(v.reasons, 64, bad).some((x) => !isRef(x))) bad();
    const sec = fields(v.security, ['mandatoryTotal', 'mandatoryPassed', 'securityViolations'], bad);
    if (!isInt(sec.mandatoryTotal, 0) || !isInt(sec.mandatoryPassed, 0, sec.mandatoryTotal as number) || !isInt(sec.securityViolations, 0)) bad();
    const l = fields(v.leakage, ['checked', 'trainingDigests'], bad);
    if (typeof l.checked !== 'boolean' || list(l.trainingDigests, MODEL_REGISTRY_LIMITS.maxTrainingExports, bad).some((x) => !isKey(x))) bad();
    return v as unknown as ModelEvaluationRecord;
}
function parseApproval(raw: unknown): ModelApprovalRecord {
    const bad = () => corrupt('approval record');
    const v = fields(raw, ['format', 'version', 'registryId', 'versionId', 'manifest', 'evaluation', 'actorRef', 'approvedAt', 'expiresAt', 'activeAtApproval', 'firewall', 'securityProfile', 'nonce'], bad);
    if (
        v.format !== 'shivax-model-approval' || v.version !== 1 || !isRef(v.registryId) || !isRef(v.versionId) || !isKey(v.manifest) || !isKey(v.evaluation) ||
        typeof v.actorRef !== 'string' || !ACTOR.test(v.actorRef) || !isInt(v.approvedAt, 0) || !isInt(v.expiresAt, (v.approvedAt as number) + 1) ||
        !(v.activeAtApproval === null || isKey(v.activeAtApproval)) || !isKey(v.securityProfile) || typeof v.nonce !== 'string' || !OP.test(v.nonce)
    )
        bad();
    const f = fields(v.firewall, ['version', 'mode'], bad);
    if (!isInt(f.version, 1) || typeof f.mode !== 'string') bad();
    return v as unknown as ModelApprovalRecord;
}
function parseJournal(raw: unknown, r: Resolved): ModelJournalEntry {
    const bad = () => corrupt('journal entry');
    const v = fields(raw, ['format', 'version', 'registryId', 'sequence', 'revision', 'at', 'operation', 'action', 'versionId', 'from', 'to', 'displaced', 'active', 'actorRef', 'reasons', 'prev'], bad);
    const state = (s: unknown) => s === null || (MODEL_STATES as readonly unknown[]).includes(s);
    if (
        v.format !== 'shivax-model-journal' || v.version !== 1 || v.registryId !== r.registryId || !isInt(v.sequence, 1) || !isInt(v.revision, 1) || !isInt(v.at, 0) ||
        typeof v.operation !== 'string' || !OP.test(v.operation) || !(MODEL_REGISTRY_ACTIONS as readonly unknown[]).includes(v.action) ||
        !(v.versionId === null || isRef(v.versionId)) || !state(v.from) || !state(v.to) || !(v.active === null || isRef(v.active)) ||
        typeof v.actorRef !== 'string' || !ACTOR.test(v.actorRef) || !(v.prev === null || isKey(v.prev)) || (v.sequence === 1) !== (v.prev === null)
    )
        bad();
    if (list(v.reasons, 64, bad).some((x) => !isRef(x))) bad();
    if (v.displaced !== null) {
        const d = fields(v.displaced, ['versionId', 'from', 'to'], bad);
        if (!isRef(d.versionId) || !state(d.from) || !state(d.to) || d.from === null || d.to === null) bad();
    }
    return v as unknown as ModelJournalEntry;
}
function headBody(head: Omit<Head, 'checksum' | 'signature'> & Partial<Pick<Head, 'checksum' | 'signature'>>) {
    const { checksum: _c, signature: _s, ...body } = head;
    return body;
}
async function parseHead(r: Resolved, text: unknown, signal: BotSignal): Promise<Head> {
    if (typeof text !== 'string' || text.length > MODEL_REGISTRY_LIMITS.maxRecordBytes) corrupt('head');
    let raw: BotValue;
    try {
        raw = snapshotValue(JSON.parse(text as string), MODEL_REGISTRY_LIMITS.maxRecordBytes, 'invalid-input');
    } catch {
        return corrupt('head');
    }
    const bad = () => corrupt('head');
    const v = fields(raw, ['format', 'version', 'registryId', 'owner', 'issuer', 'revision', 'createdAt', 'nextSequence', 'securityProfile', 'versions', 'active', 'activations', 'journal', 'lastOperation', 'checksum', 'signature'], bad);
    if (v.format !== 'shivax-model-registry' || v.version !== 1 || !isRef(v.registryId) || typeof v.issuer !== 'string' || !isInt(v.revision, 1) || !isInt(v.createdAt, 0) || !isInt(v.nextSequence, 1) || !isKey(v.securityProfile) || !isKey(v.checksum))
        bad();
    const owner = ownerOf(v.owner, bad);
    if (v.registryId !== r.registryId || v.issuer !== r.issuer || !sameOwner(owner, r.owner)) fail('cross-tenant', 'The store holds another registry or tenant.');
    const versions = list(v.versions, MODEL_REGISTRY_LIMITS.maxVersions, bad).map((raw) => {
        const x = fields(raw, ['versionId', 'modelId', 'sequence', 'state', 'manifest', 'evaluation', 'approval', 'updatedAt'], bad);
        if (!isRef(x.versionId) || !isRef(x.modelId) || !isInt(x.sequence, 1, (v.nextSequence as number) - 1) || !(MODEL_STATES as readonly unknown[]).includes(x.state) || !isKey(x.manifest) || !(x.evaluation === null || isKey(x.evaluation)) || !(x.approval === null || isKey(x.approval)) || !isInt(x.updatedAt, 0))
            bad();
        // State invariants: evidence and approval must exist for the states that require them.
        if ((x.state === 'candidate' && (x.evaluation !== null || x.approval !== null)) || (['evaluated', 'approved', 'active', 'rolled_back'].includes(x.state as string) && x.evaluation === null) || (['approved', 'active', 'rolled_back'].includes(x.state as string) && x.approval === null))
            bad();
        return x as unknown as HeadVersion;
    });
    if (new Set(versions.map((x) => x.versionId)).size !== versions.length || new Set(versions.map((x) => x.sequence)).size !== versions.length) bad();
    const active = versions.filter((x) => x.state === 'active');
    if (active.length > 1 || (v.active === null ? active.length !== 0 : active[0]?.versionId !== v.active)) bad();
    const activations = list(v.activations, MODEL_REGISTRY_LIMITS.maxActivationHistory, bad);
    if (new Set(activations).size !== activations.length || activations.some((a) => a === v.active || !versions.some((x) => x.versionId === a))) bad();
    const j = fields(v.journal, ['tip', 'length'], bad);
    if (!isKey(j.tip) || !isInt(j.length, 1)) bad();
    const op = fields(v.lastOperation, ['id', 'action', 'revision'], bad);
    if (typeof op.id !== 'string' || !OP.test(op.id) || !(MODEL_REGISTRY_ACTIONS as readonly unknown[]).includes(op.action) || op.revision !== v.revision) bad();
    if (!(v.signature === null || (typeof v.signature === 'string' && v.signature.length >= 1 && v.signature.length <= MODEL_REGISTRY_LIMITS.maxSignatureLength))) bad();
    const head = raw as unknown as Head;
    if ((await sha256Text(canonical(headBody(head)))) !== head.checksum) corrupt('head checksum');
    if (r.verify) {
        let ok: unknown = false;
        try {
            ok = head.signature !== null && (await race(r.verify(head.checksum, head.signature, signal), signal));
        } catch (error) {
            if (signal.aborted) throw abortError(signal);
            ok = false;
        }
        if (ok !== true) corrupt('head signature');
    }
    return head;
}

/* ---------------------------------------------------------------- storage io */

async function putText(r: Resolved, text: string, signal: BotSignal): Promise<string> {
    const key = await sha256Text(text);
    // Verify after write: a torn or substituted write is detected and retried once.
    for (let attempt = 0; attempt < 2; attempt++) {
        await race(r.store.putObject(key, text, signal), signal);
        if ((await race(r.store.getObject(key, signal), signal)) === text) return key;
    }
    return fail('storage-unavailable', 'An object could not be stored intact.');
}
const putRecord = (r: Resolved, value: unknown, signal: BotSignal) => putText(r, canonical(value), signal);
async function getText(r: Resolved, key: string, max: number, signal: BotSignal): Promise<string> {
    const text = await race(r.store.getObject(key, signal), signal);
    if (text === null || text === undefined) fail('object-missing', 'A registry object is missing.');
    if (typeof text !== 'string' || text.length > max) fail('checksum-mismatch', 'A registry object is invalid.');
    if ((await sha256Text(text as string)) !== key) fail('checksum-mismatch', 'A registry object failed its checksum.');
    return text as string;
}
async function getRecord<T>(r: Resolved, key: string, parse: (raw: unknown) => T, signal: BotSignal): Promise<T> {
    const text = await getText(r, key, MODEL_REGISTRY_LIMITS.maxRecordBytes, signal);
    let raw: BotValue;
    try {
        raw = snapshotValue(JSON.parse(text), MODEL_REGISTRY_LIMITS.maxRecordBytes, 'invalid-input');
    } catch {
        return corrupt('record');
    }
    return parse(raw);
}
async function serializeHead(r: Resolved, body: Omit<Head, 'checksum' | 'signature'>, signal: BotSignal): Promise<{ head: Head; text: string }> {
    const checksum = await sha256Text(canonical(body));
    let signature: string | null = null;
    if (r.sign) {
        try {
            signature = await race(r.sign(checksum, signal), signal);
        } catch (error) {
            throw normalize(error, signal);
        }
        if (typeof signature !== 'string' || !signature.length || signature.length > MODEL_REGISTRY_LIMITS.maxSignatureLength)
            fail('invalid-configuration', 'The registry signer returned an invalid signature.');
    }
    const head = { ...body, checksum, signature } as Head;
    const text = canonical(head);
    // Never commit a head that could not be read back (parseHead's limit): refuse the change instead.
    if (text.length > MODEL_REGISTRY_LIMITS.maxRecordBytes) fail('capacity', 'The registry head would exceed 1 MiB; reduce versions or id lengths.');
    return { head, text };
}
async function authorizeRoot(r: Resolved, root: TaskContext, action: ModelRegistryAction, subject: ModelRegistrySubject, signal: BotSignal): Promise<string> {
    let identity;
    try {
        identity = await race(r.jay.verify(root, signal), signal);
    } catch (error) {
        if (signal.aborted) throw abortError(signal);
        return fail('unauthorized', 'The administrator session is not valid.');
    }
    if (identity.principal.issuer !== r.issuer) fail('unauthorized', 'The administrator belongs to another issuer.');
    if (identity.session.scope.kind !== r.owner.scopeKind || identity.session.scope.id !== r.owner.scopeId)
        fail('cross-tenant', 'The administrator belongs to another tenant.');
    let actor: unknown;
    try {
        actor = await race(r.authorize(root, action, Object.freeze({ ...subject }), signal), signal);
        r.jay.assertActive(root, signal);
    } catch (error) {
        if (signal.aborted) throw abortError(signal);
        return fail('unauthorized', 'The administrator is not authorized.');
    }
    let fenced = false;
    try {
        fenced = typeof actor === 'string' && ACTOR.test(actor) && r.checkAuthorization(root, action, actor) === true;
    } catch {
        fenced = false;
    }
    if (!fenced) fail('unauthorized', 'The administrator is not authorized.');
    return actor as string;
}
function firewallState(r: Resolved, rollback: boolean): { version: number; mode: string } {
    let raw: unknown;
    try {
        raw = r.status();
    } catch {
        return fail('firewall-unavailable', 'The firewall status could not be read.');
    }
    const s = raw as Record<string, unknown> | null;
    if (!s || !['enforce', 'monitor', 'lockdown'].includes(s.mode as string) || !isInt(s.version, 1) || (s.admission !== 'open' && s.admission !== 'closed'))
        fail('firewall-unavailable', 'The firewall status is invalid.');
    const exempt = rollback && r.allowRollbackDuringLockdown;
    if (s!.mode === 'lockdown' && !exempt) fail('lockdown', 'The firewall is in lockdown.');
    if (s!.admission !== 'open' && !exempt) fail('firewall-unavailable', 'The firewall is not admitting operations.');
    return { version: s!.version as number, mode: s!.mode as string };
}
function bindingFor(r: Resolved, v: HeadVersion): BotValue {
    return { format: 'shivax-model-binding', version: 1, registryId: r.registryId, modelId: v.modelId, versionId: v.versionId, manifest: v.manifest };
}
function compatible(r: Resolved, manifest: ModelVersionManifest, artifact: ModelArtifact): void {
    const format: ModelFormat = artifact.model === null ? 'none' : 'shivax-neural-net@1';
    if (manifest.artifact.modelFormat !== format || !r.supportedFormats.includes(format)) fail('incompatible-model', 'The model format is not supported by this runtime.');
    if (artifact.model !== null) {
        const c = artifact.model.config, a = manifest.artifact.architecture!;
        if (canonical([c.layers, c.task, c.activation]) !== canonical([a.layers, a.task, a.activation])) fail('incompatible-model', 'The artifact does not match its manifest.');
    }
    let ok = true;
    if (r.checkCompatibility)
        try {
            ok = r.checkCompatibility(manifest, artifact) === true;
        } catch {
            ok = false;
        }
    if (!ok) fail('incompatible-model', 'The host runtime rejected the model.');
}
async function loadVersionObjects(r: Resolved, v: HeadVersion, revision: number, signal: BotSignal): Promise<LoadedModelVersion> {
    const manifest = await getRecord(r, v.manifest, (raw) => parseManifest(raw, r), signal);
    if (manifest.versionId !== v.versionId || manifest.modelId !== v.modelId || manifest.sequence !== v.sequence) corrupt('version manifest binding');
    const text = await getText(r, manifest.artifact.digest, r.maxArtifactBytes, signal);
    if (text.length !== manifest.artifact.bytes) fail('checksum-mismatch', 'The model artifact size does not match its manifest.');
    const artifact = parseArtifact(text, r);
    compatible(r, manifest, artifact);
    return Object.freeze({ versionId: v.versionId, modelId: v.modelId, revision, manifestDigest: v.manifest, manifest, artifact });
}

/* ---------------------------------------------------------------- options */

async function resolveOptions(options: ModelRegistryOptions): Promise<Resolved> {
    const o = options as unknown as Record<string, unknown>;
    if (!o || typeof o !== 'object') fail('invalid-configuration', 'Registry options are required.');
    const cfg = (what: string) => (): never => fail('invalid-configuration', `Invalid ${what}.`);
    if (!isRef(o.registryId)) cfg('registryId')();
    const owner = ownerOf(o.owner, cfg('owner'));
    if (typeof o.issuer !== 'string' || !o.issuer.trim() || o.issuer.length > 256) cfg('issuer')();
    const store = o.store as ModelRegistryStore;
    if (!store || ['putObject', 'getObject', 'readHead', 'compareAndSwapHead'].some((m) => typeof (store as unknown as Record<string, unknown>)[m] !== 'function')) cfg('store')();
    const jay = o.jay as Jay;
    if (!jay || typeof jay.verify !== 'function' || typeof jay.assertActive !== 'function') cfg('jay')();
    const firewall = o.firewall as ModelRegistryFirewall;
    if (!firewall || typeof firewall.status !== 'function') cfg('firewall')();
    if (typeof o.authorize !== 'function' || typeof o.checkAuthorization !== 'function') cfg('authorization hooks')();
    const approvals = o.approvals as ModelRegistryApprovals;
    if (!approvals || typeof approvals.record !== 'function' || typeof approvals.confirm !== 'function') cfg('approvals')();
    const trusted = list(o.trustedEvaluators, 64, cfg('trustedEvaluators')).map((t) => {
        const x = fields(t, ['id', 'version'], cfg('trusted evaluator'));
        if (!isRef(x.id) || !isRef(x.version)) cfg('trusted evaluator')();
        return Object.freeze({ id: x.id as string, version: x.version as string });
    });
    if (!trusted.length) cfg('trustedEvaluators (at least one)')();
    let policy: BenchmarkPolicy;
    try {
        policy = validateBenchmarkPolicy(o.policy ?? STRICT_BENCHMARK_POLICY);
    } catch {
        return cfg('policy')();
    }
    for (const key of ['requireSecurityCases', 'separationOfDuties', 'allowRollbackDuringLockdown'])
        if (o[key] !== undefined && typeof o[key] !== 'boolean') cfg(key)();
    const supported = o.supportedFormats === undefined ? [...MODEL_FORMATS] : list(o.supportedFormats, MODEL_FORMATS.length, cfg('supportedFormats'));
    if (!supported.length || supported.some((f) => !(MODEL_FORMATS as readonly unknown[]).includes(f)) || new Set(supported).size !== supported.length) cfg('supportedFormats')();
    if (o.checkCompatibility !== undefined && typeof o.checkCompatibility !== 'function') cfg('checkCompatibility')();
    const signer = o.signer as ModelRegistrySigner | undefined;
    if (signer !== undefined && (!signer || typeof signer.sign !== 'function' || typeof signer.verify !== 'function')) cfg('signer')();
    if (o.now !== undefined && typeof o.now !== 'function') cfg('now')();
    const L = MODEL_REGISTRY_LIMITS;
    const base = {
        registryId: o.registryId as string,
        owner: Object.freeze({ ...owner }),
        issuer: o.issuer as string,
        store: Object.freeze({
            putObject: store.putObject.bind(store),
            getObject: store.getObject.bind(store),
            readHead: store.readHead.bind(store),
            compareAndSwapHead: store.compareAndSwapHead.bind(store),
        }),
        jay,
        status: firewall.status.bind(firewall),
        authorize: (o.authorize as ModelRegistryOptions['authorize']).bind(options),
        checkAuthorization: (o.checkAuthorization as ModelRegistryOptions['checkAuthorization']).bind(options),
        record: approvals.record.bind(approvals),
        confirm: approvals.confirm.bind(approvals),
        trustedEvaluators: Object.freeze(trusted),
        policy,
        requireSecurityCases: o.requireSecurityCases !== false,
        separationOfDuties: o.separationOfDuties === true,
        allowRollbackDuringLockdown: o.allowRollbackDuringLockdown === true,
        approvalTtlMs: bounded(o.approvalTtlMs, L.defaultApprovalTtlMs, 1_000, L.maxApprovalTtlMs, 'approvalTtlMs'),
        evidenceTtlMs: bounded(o.evidenceTtlMs, L.defaultEvidenceTtlMs, 1_000, L.maxEvidenceTtlMs, 'evidenceTtlMs'),
        supportedFormats: Object.freeze([...supported] as ModelFormat[]),
        ...(o.checkCompatibility ? { checkCompatibility: (o.checkCompatibility as NonNullable<ModelRegistryOptions['checkCompatibility']>).bind(options) } : {}),
        ...(signer ? { sign: signer.sign.bind(signer), verify: signer.verify.bind(signer) } : {}),
        now: (o.now as (() => number) | undefined) ?? Date.now,
        timeoutMs: bounded(o.timeoutMs, L.defaultTimeoutMs, 1, L.maxTimeoutMs, 'timeoutMs'),
        maxVersions: bounded(o.maxVersions, L.defaultMaxVersions, 1, L.maxVersions, 'maxVersions'),
        maxArtifactBytes: bounded(o.maxArtifactBytes, L.defaultMaxArtifactBytes, 1_024, L.maxArtifactBytes, 'maxArtifactBytes'),
    };
    // Every setting that decides whether a model may be promoted. Approvals and evaluations record it;
    // a later change makes them stale instead of silently applying old rules.
    const profile = await digestLearningValue({
        policy: base.policy as unknown as BotValue,
        trustedEvaluators: [...trusted].map((t) => `${t.id}@${t.version}`).sort(),
        requireSecurityCases: base.requireSecurityCases,
        separationOfDuties: base.separationOfDuties,
        allowRollbackDuringLockdown: base.allowRollbackDuringLockdown,
        approvalTtlMs: base.approvalTtlMs,
        evidenceTtlMs: base.evidenceTtlMs,
        supportedFormats: [...base.supportedFormats].sort(),
    });
    return Object.freeze({ ...base, profile });
}
function clock(r: Resolved): number {
    const now = r.now();
    if (!isInt(now, 0)) fail('invalid-configuration', 'The registry clock returned an invalid time.');
    return now;
}

/* ------------------------------------------------------------------ registry */

interface Plan<T> {
    versions: readonly HeadVersion[];
    active: string | null;
    activations: readonly string[];
    nextSequence?: number;
    journal: Pick<ModelJournalEntry, 'versionId' | 'from' | 'to' | 'displaced' | 'reasons'>;
    result: (revision: number) => T;
    guard?: () => void;
}
interface Context {
    readonly head: Head;
    readonly actor: string;
    readonly now: number;
    readonly signal: BotSignal;
}
const summary = (v: HeadVersion): ModelVersionSummary => Object.freeze({ ...v });

class Registry implements ModelRegistry {
    readonly #r: Resolved;
    #head: Head;
    #health: ModelRegistrySnapshot['health'] = Object.freeze({ journal: 'ok', active: 'none' });
    #closed = false;
    #lock: Promise<void> = Promise.resolve();
    #waiters = 0;
    #inflight: Promise<unknown> = Promise.resolve();

    constructor(r: Resolved, head: Head) {
        this.#r = r;
        this.#head = head;
    }
    get registryId(): string {
        return this.#r.registryId;
    }
    get owner(): FeedbackOwner {
        return this.#r.owner;
    }

    snapshot(): ModelRegistrySnapshot {
        const h = this.#head;
        return Object.freeze({
            registryId: h.registryId,
            owner: this.#r.owner,
            revision: h.revision,
            active: h.active,
            activations: Object.freeze([...h.activations]),
            versions: Object.freeze(h.versions.map(summary)),
            securityProfile: this.#r.profile,
            health: this.#health,
        });
    }
    version(versionId: string): ModelVersionSummary | null {
        const v = this.#head.versions.find((x) => x.versionId === versionId);
        return v ? summary(v) : null;
    }
    benchmarkConfiguration(versionId: string, role: 'baseline' | 'candidate') {
        const v = this.#head.versions.find((x) => x.versionId === versionId);
        if (!v) fail('invalid-input', 'Unknown version.');
        if (role !== 'baseline' && role !== 'candidate') fail('invalid-input', 'Invalid role.');
        return Object.freeze({ role, id: v!.modelId, version: v!.versionId, value: bindingFor(this.#r, v!) });
    }

    /** Reads, validates and caches the head; also checks the journal tip and the active manifest. */
    async #reload(signal: BotSignal): Promise<Head> {
        const text = await race(this.#r.store.readHead(signal), signal);
        if (text === null || text === undefined) fail('registry-missing', 'The registry head is missing.');
        const head = await parseHead(this.#r, text, signal);
        let journal: 'ok' | 'unavailable' = 'ok', active: 'ok' | 'unavailable' | 'none' = 'none';
        try {
            const tip = await getRecord(this.#r, head.journal.tip, (raw) => parseJournal(raw, this.#r), signal);
            if (tip.sequence !== head.journal.length || tip.revision > head.revision) journal = 'unavailable';
        } catch (error) {
            if (signal.aborted) throw abortError(signal);
            journal = 'unavailable';
        }
        const current = head.versions.find((v) => v.versionId === head.active);
        if (current)
            try {
                await getRecord(this.#r, current.manifest, (raw) => parseManifest(raw, this.#r), signal);
                active = 'ok';
            } catch (error) {
                if (signal.aborted) throw abortError(signal);
                active = 'unavailable';
            }
        // Never move the cache backwards (a slower read can finish after a newer commit).
        if (head.revision >= this.#head.revision) {
            this.#head = head;
            this.#health = Object.freeze({ journal, active });
        }
        return head;
    }

    /** Timeout, cancellation, closed check and error normalization for every public operation. */
    async #operation<T>(signal: BotSignal, exclusive: boolean, work: (s: BotSignal) => Promise<T>): Promise<T> {
        if (this.#closed) fail('closed', 'The registry is closed.');
        if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean') fail('invalid-input', 'A signal is required.');
        if (signal.aborted) throw new ModelRegistryError('cancelled');
        if (exclusive && this.#waiters >= MODEL_REGISTRY_LIMITS.maxWaiters) fail('busy', 'Too many registry operations are waiting.');
        const controller = new AbortController();
        const onAbort = () => controller.abort('cancelled');
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(TIMEOUT), this.#r.timeoutMs);
        const s = controller.signal;
        let release: (() => void) | undefined, previous: Promise<void> | undefined, started = false;
        try {
            if (exclusive) {
                this.#waiters++;
                previous = this.#lock;
                this.#lock = new Promise<void>((resolve) => (release = resolve));
                try {
                    await race(previous, s);
                } finally {
                    this.#waiters--;
                }
                started = true;
                // An earlier swap whose outcome was unknown must settle before anything reads the head again.
                await race(this.#inflight, s);
            }
            return await work(s);
        } catch (error) {
            throw normalize(error, s);
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            if (release) {
                if (started) release();
                else void previous!.then(release); // Keep the queue order if we gave up while waiting.
            }
        }
    }

    /** One state change: reload, check revision, authorize, plan, write objects, swap the head. */
    #mutate<T>(action: ModelRegistryAction, root: TaskContext, expectedRevision: number, subject: ModelRegistrySubject, signal: BotSignal, plan: (ctx: Context) => Promise<Plan<T>>): Promise<T> {
        return this.#operation(signal, true, async (s) => {
            const r = this.#r;
            const head = await this.#reload(s);
            // Authorize first, so callers without the role learn nothing about the registry's state.
            const actor = await authorizeRoot(r, root, action, subject, s);
            if (this.#health.journal !== 'ok') fail('corrupt-registry', 'The audit journal is unavailable; changes are blocked until it is restored.');
            if (expectedRevision !== head.revision) fail('conflict', 'The registry changed; refresh and retry.');
            const now = clock(r);
            const p = await plan({ head, actor, now, signal: s });
            const operation = randomHex(16);
            const entry: ModelJournalEntry = {
                format: 'shivax-model-journal',
                version: 1,
                registryId: r.registryId,
                sequence: head.journal.length + 1,
                revision: head.revision + 1,
                at: now,
                operation,
                action,
                ...p.journal,
                active: p.active,
                actorRef: actor,
                prev: head.journal.tip,
            };
            const tip = await putRecord(r, entry, s);
            const { head: next, text } = await serializeHead(r, {
                format: 'shivax-model-registry',
                version: 1,
                registryId: r.registryId,
                owner: r.owner,
                issuer: r.issuer,
                revision: head.revision + 1,
                createdAt: head.createdAt,
                nextSequence: p.nextSequence ?? head.nextSequence,
                securityProfile: r.profile,
                versions: p.versions,
                active: p.active,
                activations: p.activations,
                journal: { tip, length: head.journal.length + 1 },
                lastOperation: { id: operation, action, revision: head.revision + 1 },
            }, s);
            let guardError: unknown;
            const guard = () => {
                try {
                    if (this.#closed) fail('closed', 'The registry is closed.');
                    if (s.aborted) throw abortError(s);
                    try {
                        r.jay.assertActive(root, s);
                    } catch {
                        fail('unauthorized', 'The administrator session ended.');
                    }
                    let fenced = false;
                    try {
                        fenced = r.checkAuthorization(root, action, actor) === true;
                    } catch {
                        fenced = false;
                    }
                    if (!fenced) fail('unauthorized', 'The administrator authorization was revoked.');
                    p.guard?.();
                } catch (error) {
                    guardError = error;
                    throw error;
                }
            };
            guard();
            const cas = Promise.resolve().then(() => r.store.compareAndSwapHead(head.revision, text, next.revision, guard, s));
            let committed: boolean;
            try {
                committed = await race(cas, s);
            } catch (error) {
                if (s.aborted && !guardError) {
                    // The swap may still complete: hold every later operation until it settles.
                    this.#inflight = cas.then(() => undefined, () => undefined);
                    throw new ModelRegistryError(abortError(s).code, 'The registry change was interrupted; its outcome is unknown until the next refresh.', { outcome: 'unknown' });
                }
                // Failure or ambiguous acknowledgement: decide deterministically from the stored head.
                let stored: Head;
                try {
                    stored = await this.#reload(new AbortController().signal);
                } catch {
                    throw new ModelRegistryError('storage-unavailable', 'The registry change outcome is unknown.', { outcome: 'unknown' });
                }
                if (stored.lastOperation.id === operation) committed = true;
                else throw guardError instanceof ModelRegistryError ? guardError : new ModelRegistryError('storage-unavailable', 'The registry store rejected the change.');
            }
            if (!committed) {
                await this.#reload(s).catch(() => undefined);
                fail('conflict', 'Another writer changed the registry; refresh and retry.');
            }
            if (next.revision >= this.#head.revision) this.#head = next;
            if (next.active !== head.active) this.#health = Object.freeze({ ...this.#health, active: next.active === null ? 'none' : 'ok' });
            return p.result(next.revision);
        });
    }

    #find(head: Head, versionId: unknown): HeadVersion {
        if (!isRef(versionId)) fail('invalid-input', 'Invalid version id.');
        const v = head.versions.find((x) => x.versionId === versionId);
        if (!v) fail('invalid-input', 'Unknown version.');
        return v!;
    }
    #transition(from: HeadVersion, to: ModelState): void {
        if (!MODEL_TRANSITIONS[from.state].includes(to)) fail('invalid-transition', `A ${from.state} version cannot become ${to}.`);
    }
    static #replace(versions: readonly HeadVersion[], changes: Record<string, Partial<HeadVersion>>, now: number): HeadVersion[] {
        return versions.map((v) => (changes[v.versionId] ? Object.freeze({ ...v, ...changes[v.versionId], updatedAt: now }) : v));
    }
    #result(versionId: string, state: ModelState, previous: string | null = null) {
        return (revision: number): ModelRegistryResult => Object.freeze({ revision, versionId, state, previous });
    }

    refresh(signal: BotSignal): Promise<ModelRegistrySnapshot> {
        return this.#operation(signal, false, async (s) => {
            await this.#reload(s);
            return this.snapshot();
        });
    }

    register(root: TaskContext, input: ModelRegistrationInput, signal: BotSignal): Promise<ModelRegistryResult> {
        // Capture and validate everything synchronously, before any await, so the caller cannot change it mid-flight.
        let captured: { expectedRevision: number; modelId: string; versionId: string; artifactText: string; manifestArtifact: Omit<ModelVersionManifest['artifact'], 'digest'>; dataset: BotValue | null; method: ModelTrainingMethod; options: BotValue; seed: number | null; parentVersionId: string | null };
        try {
            const v = fields(input, ['expectedRevision', 'modelId', 'versionId', 'artifact', 'dataset', 'training'], () => fail('invalid-input', 'Invalid registration.'), false);
            if (!isInt(v.expectedRevision, 1) || !isRef(v.modelId) || !isRef(v.versionId)) fail('invalid-input', 'Invalid registration identifiers.');
            const a = fields(v.artifact, ['model', 'configuration'], () => fail('invalid-input', 'Invalid artifact.'), false);
            if (!('model' in a)) fail('invalid-input', 'artifact.model is required (null for configuration-only versions).');
            let model: SerializedNeuralNet | null = null;
            if (a.model !== null)
                try {
                    // Normalized through the existing loader; weights are copied exactly, never changed.
                    model = NeuralNet.fromJSON(a.model).toJSON();
                } catch {
                    fail('invalid-input', 'artifact.model is not a valid shivax-neural-net v1 model.');
                }
            let configuration: BotValue;
            try {
                configuration = snapshotValue(a.configuration ?? null, MODEL_REGISTRY_LIMITS.maxConfigurationBytes, 'invalid-input');
            } catch {
                return Promise.reject(new ModelRegistryError('invalid-input', 'artifact.configuration is invalid or too large.'));
            }
            const artifact: ModelArtifact = { format: 'shivax-model-artifact', version: 1, model, configuration };
            const artifactText = canonical(artifact);
            if (artifactText.length > this.#r.maxArtifactBytes) fail('capacity', 'The model artifact is too large.');
            const t = fields(v.training, ['method', 'options', 'seed', 'parentVersionId'], () => fail('invalid-input', 'Invalid training metadata.'), false);
            if (!(MODEL_TRAINING_METHODS as readonly unknown[]).includes(t.method)) fail('invalid-input', 'Invalid training method.');
            if (t.seed !== undefined && !isInt(t.seed, 0, 0xffffffff)) fail('invalid-input', 'Invalid training seed.');
            if (t.parentVersionId !== undefined && !isRef(t.parentVersionId)) fail('invalid-input', 'Invalid parent version.');
            let options: BotValue, dataset: BotValue | null = null;
            try {
                options = snapshotValue(t.options ?? {}, MODEL_REGISTRY_LIMITS.maxTrainingOptionsBytes, 'invalid-input');
                if (v.dataset !== undefined) dataset = snapshotValue(v.dataset, MODEL_REGISTRY_LIMITS.maxRecordBytes, 'invalid-input');
            } catch {
                return Promise.reject(new ModelRegistryError('invalid-input', 'Training options or dataset manifest are invalid.'));
            }
            captured = {
                expectedRevision: v.expectedRevision as number,
                modelId: v.modelId as string,
                versionId: v.versionId as string,
                artifactText,
                manifestArtifact: {
                    bytes: artifactText.length,
                    modelFormat: model ? 'shivax-neural-net@1' : 'none',
                    architecture: model ? { layers: [...model.config.layers], task: model.config.task, activation: model.config.activation } : null,
                },
                dataset,
                method: t.method as ModelTrainingMethod,
                options,
                seed: t.seed === undefined ? null : (t.seed as number),
                parentVersionId: (t.parentVersionId as string | undefined) ?? null,
            };
        } catch (error) {
            return Promise.reject(error);
        }
        const c = captured;
        if (!this.#r.supportedFormats.includes(c.manifestArtifact.modelFormat))
            return Promise.reject(new ModelRegistryError('incompatible-model', 'The model format is not supported by this runtime.'));
        return this.#mutate('register', root, c.expectedRevision, { registryId: this.#r.registryId, versionId: c.versionId, modelId: c.modelId }, signal, async ({ head, actor, now, signal: s }) => {
            const r = this.#r;
            if (head.versions.some((x) => x.versionId === c.versionId)) fail('invalid-input', 'The version id already exists.');
            if (head.versions.length >= r.maxVersions) fail('capacity', 'The registry holds the maximum number of versions.');
            let dataset: ModelVersionManifest['dataset'] = null;
            if (c.dataset !== null) {
                let manifest;
                try {
                    manifest = validateDatasetManifest(c.dataset);
                } catch {
                    return fail('invalid-input', 'The dataset manifest is invalid.');
                }
                const { digest, ...body } = manifest;
                if ((await digestLearningValue(body)) !== digest) fail('invalid-input', 'The dataset manifest digest does not match.');
                if (!sameOwner(manifest.owner, r.owner)) fail('cross-tenant', 'The dataset belongs to another tenant.');
                if (manifest.purpose !== 'training') fail('invalid-input', 'The dataset was not curated for training.');
                dataset = { id: manifest.id, version: manifest.datasetVersion, digest, manifest: await putRecord(r, manifest, s) };
            }
            let parent: ModelVersionManifest['training']['parent'] = null;
            if (c.parentVersionId !== null) {
                const p = head.versions.find((x) => x.versionId === c.parentVersionId);
                if (!p) fail('invalid-input', 'The parent version is not in this registry.');
                parent = { versionId: p!.versionId, manifest: p!.manifest };
            }
            const digest = await putText(r, c.artifactText, s);
            const manifest: ModelVersionManifest = {
                format: 'shivax-model-manifest',
                version: 1,
                registryId: r.registryId,
                modelId: c.modelId,
                versionId: c.versionId,
                sequence: head.nextSequence,
                owner: r.owner,
                artifact: { digest, ...c.manifestArtifact },
                dataset,
                training: { method: c.method, options: c.options, seed: c.seed, parent },
                createdAt: now,
                createdBy: actor,
            };
            const key = await putRecord(r, manifest, s);
            const entry: HeadVersion = Object.freeze({ versionId: c.versionId, modelId: c.modelId, sequence: head.nextSequence, state: 'candidate', manifest: key, evaluation: null, approval: null, updatedAt: now });
            return {
                versions: [...head.versions, entry],
                active: head.active,
                activations: head.activations,
                nextSequence: head.nextSequence + 1,
                journal: { versionId: c.versionId, from: null, to: 'candidate', displaced: null, reasons: [] },
                result: this.#result(c.versionId, 'candidate'),
            };
        });
    }

    evaluate(root: TaskContext, versionId: string, input: ModelEvaluationInput, signal: BotSignal): Promise<ModelEvaluationResult> {
        let c: { expectedRevision: number; suite: BotValue; baseline: BotValue; candidate: BotValue; training: BotValue[] | null };
        try {
            const v = fields(input, ['expectedRevision', 'suite', 'baseline', 'candidate', 'training'], () => fail('invalid-input', 'Invalid evaluation input.'), false);
            if (!isInt(v.expectedRevision, 1)) fail('invalid-input', 'Invalid expected revision.');
            const snap = (x: unknown) => snapshotValue(x, MODEL_REGISTRY_LIMITS.maxRecordBytes, 'invalid-input');
            let training: BotValue[] | null = null;
            if (v.training !== undefined) training = list(v.training, MODEL_REGISTRY_LIMITS.maxTrainingExports, () => fail('invalid-input', 'Invalid training exports.')).map(snap);
            c = { expectedRevision: v.expectedRevision as number, suite: snap(v.suite), baseline: snap(v.baseline), candidate: snap(v.candidate), training };
        } catch (error) {
            return Promise.reject(error instanceof ModelRegistryError ? error : new ModelRegistryError('invalid-input', 'Evaluation evidence is invalid or too large.'));
        }
        const known = this.#head.versions.find((x) => x.versionId === versionId);
        return this.#mutate('evaluate', root, c.expectedRevision, { registryId: this.#r.registryId, versionId: isRef(versionId) ? versionId : null, modelId: known?.modelId ?? null }, signal, async ({ head, actor, now, signal: s }) => {
            const r = this.#r;
            const version = this.#find(head, versionId);
            if (!['candidate', 'evaluated', 'approved', 'rolled_back'].includes(version.state)) fail('invalid-transition', `A ${version.state} version cannot be evaluated.`);
            const manifest = await getRecord(r, version.manifest, (raw) => parseManifest(raw, r), s);
            const reject = (reason: string): never => fail('evidence-rejected', `Evaluation evidence rejected: ${reason}.`, [reason]);
            let suite: BenchmarkSuite, baseline: BenchmarkReport, candidate: BenchmarkReport;
            try {
                suite = await validateBenchmarkSuite(c.suite);
            } catch {
                return reject('invalid-suite');
            }
            if (!sameOwner(suite.owner, r.owner)) fail('cross-tenant', 'The benchmark suite belongs to another tenant.');
            try {
                candidate = await validateBenchmarkReport(c.candidate, suite);
                baseline = await validateBenchmarkReport(c.baseline, suite);
            } catch {
                return reject('invalid-report');
            }
            // The candidate report must have been produced for this exact version manifest.
            const expected = await digestLearningValue(bindingFor(r, version));
            const cc = candidate.configuration;
            if (cc.role !== 'candidate' || cc.id !== version.modelId || cc.version !== version.versionId || cc.digest !== expected) reject('candidate-binding');
            // The baseline must be the version that is active now; otherwise the comparison is stale.
            const active = head.versions.find((x) => x.versionId === head.active) ?? null;
            const bc = baseline.configuration;
            if (bc.role !== 'baseline') reject('baseline-binding');
            if (active && (bc.id !== active.modelId || bc.version !== active.versionId || bc.digest !== (await digestLearningValue(bindingFor(r, active))))) reject('baseline-binding');
            // Training exports must be the splits of the dataset this version names (S01), so leakage is checked on the real data.
            const trainingDigests: string[] = [];
            if (manifest.dataset) {
                if (!c.training?.length) reject('training-required');
                const dm = await getRecord(r, manifest.dataset.manifest, (raw) => validateDatasetManifest(raw), s);
                const allowed = [dm.splits.train.digest, dm.splits.validation.digest];
                for (const t of c.training!) trainingDigests.push(await digestLearningValue(t));
                if (trainingDigests.some((d) => !allowed.includes(d)) || !trainingDigests.includes(dm.splits.train.digest)) reject('training-mismatch');
            } else for (const t of c.training ?? []) trainingDigests.push(await digestLearningValue(t));
            let assessment;
            try {
                assessment = await assessBenchmarkCandidate({ suite, baseline, candidate, trustedEvaluators: r.trustedEvaluators, policy: r.policy, ...(c.training ? { training: c.training } : {}) });
            } catch {
                return reject('invalid-evidence');
            }
            const codes = [...new Set(assessment.reasons.map((x) => x.code))].sort();
            const evidenceProblems = codes.filter((x) => EVIDENCE_REASONS.includes(x));
            if (evidenceProblems.length) fail('evidence-rejected', 'The benchmark evidence cannot be used.', evidenceProblems);
            if (r.requireSecurityCases && candidate.summary.mandatory.total === 0) reject('no-security-cases');
            const eligible = assessment.eligible;
            const to: ModelState = eligible ? 'evaluated' : 'rejected';
            this.#transition(version, to);
            const record: ModelEvaluationRecord = {
                format: 'shivax-model-evaluation',
                version: 1,
                registryId: r.registryId,
                versionId: version.versionId,
                manifest: version.manifest,
                suite: { id: suite.id, suiteVersion: suite.suiteVersion, datasetDigest: suite.dataset.digest, object: await putRecord(r, suite, s) },
                baseline: { versionId: active?.versionId ?? null, report: await putRecord(r, baseline, s), reportDigest: baseline.digest, logicalDigest: baseline.logicalDigest, configurationDigest: bc.digest },
                candidate: { report: await putRecord(r, candidate, s), reportDigest: candidate.digest, logicalDigest: candidate.logicalDigest, configurationDigest: cc.digest! },
                evaluator: { id: candidate.evaluator.id, version: candidate.evaluator.version, kind: candidate.evaluator.kind },
                policy: { id: r.policy.id, profile: r.profile },
                eligible,
                reasons: codes,
                security: { mandatoryTotal: candidate.summary.mandatory.total, mandatoryPassed: candidate.summary.mandatory.passed, securityViolations: candidate.summary.securityViolations },
                leakage: { checked: !!c.training, trainingDigests },
                evaluatedAt: now,
                actorRef: actor,
            };
            const key = await putRecord(r, record, s);
            return {
                versions: Registry.#replace(head.versions, { [version.versionId]: { state: to, evaluation: key, approval: to === 'rejected' ? version.approval : null } }, now),
                active: head.active,
                activations: head.activations.filter((a) => a !== version.versionId || to !== 'rejected'),
                journal: { versionId: version.versionId, from: version.state, to, displaced: null, reasons: codes },
                result: (revision) => Object.freeze({ revision, versionId: version.versionId, state: to, previous: null, eligible, reasons: Object.freeze(codes), evaluation: key }),
            };
        });
    }

    approve(root: TaskContext, versionId: string, command: { readonly expectedRevision: number }, signal: BotSignal): Promise<ModelRegistryResult> {
        const expected = (command as { expectedRevision?: unknown })?.expectedRevision;
        const known = this.#head.versions.find((x) => x.versionId === versionId);
        return this.#mutate('approve', root, isInt(expected, 1) ? expected : -1, { registryId: this.#r.registryId, versionId: isRef(versionId) ? versionId : null, modelId: known?.modelId ?? null }, signal, async ({ head, actor, now, signal: s }) => {
            const r = this.#r;
            const version = this.#find(head, versionId);
            this.#transition(version, 'approved');
            if (version.state !== 'evaluated') fail('invalid-transition', 'Only an evaluated version can be approved.');
            const fw = firewallState(r, false);
            const evaluation = await getRecord(r, version.evaluation!, parseEvaluation, s);
            if (evaluation.versionId !== version.versionId || evaluation.manifest !== version.manifest || evaluation.registryId !== r.registryId) corrupt('evaluation binding');
            if (!evaluation.eligible) fail('invalid-transition', 'The evaluation did not pass.');
            if (now - evaluation.evaluatedAt > r.evidenceTtlMs) fail('stale-evidence', 'The evaluation is too old; evaluate again.');
            if (evaluation.policy.profile !== r.profile) fail('stale-evidence', 'The security settings changed after the evaluation; evaluate again.');
            const active = head.versions.find((x) => x.versionId === head.active) ?? null;
            if ((active?.versionId ?? null) !== evaluation.baseline.versionId) fail('stale-evidence', 'The active version changed after the evaluation; evaluate again.');
            if (active && evaluation.baseline.configurationDigest !== (await digestLearningValue(bindingFor(r, active)))) fail('stale-evidence', 'The baseline no longer matches the active version.');
            // Re-verify the stored evidence and re-run the gate under the current rules.
            try {
                const suite = await validateBenchmarkSuite(JSON.parse(await getText(r, evaluation.suite.object, MODEL_REGISTRY_LIMITS.maxRecordBytes, s)));
                const baseline = JSON.parse(await getText(r, evaluation.baseline.report, MODEL_REGISTRY_LIMITS.maxRecordBytes, s));
                const candidate = JSON.parse(await getText(r, evaluation.candidate.report, MODEL_REGISTRY_LIMITS.maxRecordBytes, s));
                const again = await assessBenchmarkCandidate({ suite, baseline, candidate, trustedEvaluators: r.trustedEvaluators, policy: r.policy });
                if (!again.eligible) fail('stale-evidence', 'The stored evidence no longer passes the gate.');
            } catch (error) {
                if (error instanceof ModelRegistryError && error.code !== 'corrupt-registry') throw error;
                fail('stale-evidence', 'The stored evidence could not be re-verified.');
            }
            const loaded = await loadVersionObjects(r, version, head.revision, s);
            if (r.separationOfDuties && (actor === loaded.manifest.createdBy || actor === evaluation.actorRef))
                fail('unauthorized', 'Separation of duties: the approver registered or evaluated this version.');
            const approval: ModelApprovalRecord = {
                format: 'shivax-model-approval',
                version: 1,
                registryId: r.registryId,
                versionId: version.versionId,
                manifest: version.manifest,
                evaluation: version.evaluation!,
                actorRef: actor,
                approvedAt: now,
                expiresAt: now + r.approvalTtlMs,
                activeAtApproval: active?.manifest ?? null,
                firewall: fw,
                securityProfile: r.profile,
                nonce: randomHex(16),
            };
            const key = await putRecord(r, approval, s);
            let recorded: unknown = false;
            try {
                recorded = await race(r.record(Object.freeze({ ...approval, firewall: Object.freeze({ ...approval.firewall }) }), key, s), s);
            } catch (error) {
                if (s.aborted) throw abortError(s);
                recorded = false;
            }
            if (recorded !== true) fail('invalid-approval', 'The host did not record the approval.');
            return {
                versions: Registry.#replace(head.versions, { [version.versionId]: { state: 'approved', approval: key } }, now),
                active: head.active,
                activations: head.activations,
                journal: { versionId: version.versionId, from: 'evaluated', to: 'approved', displaced: null, reasons: [] },
                result: this.#result(version.versionId, 'approved'),
                guard: () => {
                    if (firewallState(r, false).version !== fw.version) fail('stale-approval', 'The firewall policy changed during approval.');
                },
            };
        });
    }

    reject(root: TaskContext, versionId: string, command: { readonly expectedRevision: number; readonly reason?: string }, signal: BotSignal): Promise<ModelRegistryResult> {
        const c = command as { expectedRevision?: unknown; reason?: unknown };
        const reason = c?.reason;
        if (reason !== undefined && !isRef(reason)) return Promise.reject(new ModelRegistryError('invalid-input', 'Invalid rejection reason.'));
        const known = this.#head.versions.find((x) => x.versionId === versionId);
        return this.#mutate('reject', root, isInt(c?.expectedRevision, 1) ? (c.expectedRevision as number) : -1, { registryId: this.#r.registryId, versionId: isRef(versionId) ? versionId : null, modelId: known?.modelId ?? null }, signal, async ({ head, now }) => {
            const version = this.#find(head, versionId);
            if (version.state === 'active') fail('invalid-transition', 'Roll back an active version before rejecting it.');
            this.#transition(version, 'rejected');
            return {
                versions: Registry.#replace(head.versions, { [version.versionId]: { state: 'rejected' } }, now),
                active: head.active,
                activations: head.activations.filter((a) => a !== version.versionId),
                journal: { versionId: version.versionId, from: version.state, to: 'rejected', displaced: null, reasons: reason ? [reason as string] : [] },
                result: this.#result(version.versionId, 'rejected'),
            };
        });
    }

    activate(root: TaskContext, versionId: string, command: { readonly expectedRevision: number }, signal: BotSignal): Promise<ModelRegistryResult> {
        const expected = (command as { expectedRevision?: unknown })?.expectedRevision;
        const known = this.#head.versions.find((x) => x.versionId === versionId);
        return this.#mutate('activate', root, isInt(expected, 1) ? expected : -1, { registryId: this.#r.registryId, versionId: isRef(versionId) ? versionId : null, modelId: known?.modelId ?? null }, signal, async ({ head, actor, now, signal: s }) => {
            const r = this.#r;
            const version = this.#find(head, versionId);
            // Only `approved` may become active: candidates and evaluated versions have no path here.
            if (version.state !== 'approved') fail('invalid-transition', `A ${version.state} version cannot be activated.`);
            const fw = firewallState(r, false);
            const approval = await getRecord(r, version.approval!, parseApproval, s);
            if (approval.registryId !== r.registryId || approval.versionId !== version.versionId || approval.manifest !== version.manifest || approval.evaluation !== version.evaluation)
                fail('invalid-approval', 'The approval does not belong to this version and evaluation.');
            const active = head.versions.find((x) => x.versionId === head.active) ?? null;
            if (now >= approval.expiresAt) fail('stale-approval', 'The approval expired.');
            if ((active?.manifest ?? null) !== approval.activeAtApproval) fail('stale-approval', 'The active version changed after approval.');
            if (approval.firewall.version !== fw.version) fail('stale-approval', 'The firewall policy changed after approval.');
            if (approval.securityProfile !== r.profile) fail('stale-approval', 'The security settings changed after approval.');
            if (r.separationOfDuties && actor === approval.actorRef) fail('unauthorized', 'Separation of duties: the approver cannot activate.');
            let confirmed: unknown = false;
            try {
                confirmed = await race(r.confirm(Object.freeze({ ...approval }), version.approval!, s), s);
            } catch (error) {
                if (s.aborted) throw abortError(s);
                confirmed = false;
            }
            if (confirmed !== true) fail('invalid-approval', 'The host did not confirm the approval.');
            await loadVersionObjects(r, version, head.revision, s);
            const changes: Record<string, Partial<HeadVersion>> = { [version.versionId]: { state: 'active' } };
            if (active) changes[active.versionId] = { state: 'approved' };
            const activations = [...head.activations.filter((a) => a !== version.versionId), ...(active ? [active.versionId] : [])].slice(-MODEL_REGISTRY_LIMITS.maxActivationHistory);
            return {
                versions: Registry.#replace(head.versions, changes, now),
                active: version.versionId,
                activations,
                journal: { versionId: version.versionId, from: 'approved', to: 'active', displaced: active ? { versionId: active.versionId, from: 'active', to: 'approved' } : null, reasons: [] },
                result: this.#result(version.versionId, 'active', active?.versionId ?? null),
                guard: () => {
                    // Lockdown or a policy change between preparation and commit stops the promotion.
                    if (firewallState(r, false).version !== fw.version) fail('stale-approval', 'The firewall policy changed during activation.');
                },
            };
        });
    }

    rollback(root: TaskContext, command: { readonly expectedRevision: number; readonly targetVersionId?: string }, signal: BotSignal): Promise<ModelRegistryResult> {
        const c = command as { expectedRevision?: unknown; targetVersionId?: unknown };
        if (c?.targetVersionId !== undefined && !isRef(c.targetVersionId)) return Promise.reject(new ModelRegistryError('invalid-input', 'Invalid rollback target.'));
        const target0 = c?.targetVersionId as string | undefined;
        return this.#mutate('rollback', root, isInt(c?.expectedRevision, 1) ? (c.expectedRevision as number) : -1, { registryId: this.#r.registryId, versionId: target0 ?? null, modelId: null }, signal, async ({ head, now, signal: s }) => {
            const r = this.#r;
            const current = head.versions.find((x) => x.versionId === head.active);
            if (!current) fail('invalid-transition', 'There is no active version to roll back.');
            const fw = firewallState(r, true);
            const eligible = (id: string) => head.versions.find((x) => x.versionId === id && x.state === 'approved');
            const targetId = target0 ?? [...head.activations].reverse().find((id) => eligible(id));
            if (!targetId || !head.activations.includes(targetId) || !eligible(targetId)) fail('invalid-transition', 'The target is not a previously active, approved version.');
            const target = eligible(targetId!)!;
            // Restore only a verified version: checksums, owner, format, and an approval the host still confirms.
            await loadVersionObjects(r, target, head.revision, s);
            const approval = await getRecord(r, target.approval!, parseApproval, s);
            if (approval.versionId !== target.versionId || approval.manifest !== target.manifest) fail('invalid-approval', 'The target approval does not match.');
            let confirmed: unknown = false;
            try {
                confirmed = await race(r.confirm(Object.freeze({ ...approval }), target.approval!, s), s);
            } catch (error) {
                if (s.aborted) throw abortError(s);
                confirmed = false;
            }
            if (confirmed !== true) fail('invalid-approval', 'The host did not confirm the target approval.');
            return {
                versions: Registry.#replace(head.versions, { [target.versionId]: { state: 'active' }, [current!.versionId]: { state: 'rolled_back' } }, now),
                active: target.versionId,
                activations: head.activations.slice(0, head.activations.indexOf(target.versionId)),
                journal: { versionId: target.versionId, from: 'approved', to: 'active', displaced: { versionId: current!.versionId, from: 'active', to: 'rolled_back' }, reasons: [] },
                result: this.#result(target.versionId, 'active', current!.versionId),
                guard: () => {
                    if (firewallState(r, true).version !== fw.version) fail('stale-approval', 'The firewall policy changed during rollback.');
                },
            };
        });
    }

    loadActive(signal: BotSignal): Promise<LoadedModelVersion | null> {
        return this.#operation(signal, false, async (s) => {
            const head = await this.#reload(s);
            const v = head.versions.find((x) => x.versionId === head.active);
            return v ? loadVersionObjects(this.#r, v, head.revision, s) : null;
        });
    }
    loadVersion(versionId: string, signal: BotSignal): Promise<LoadedModelVersion> {
        return this.#operation(signal, false, async (s) => {
            const head = await this.#reload(s);
            return loadVersionObjects(this.#r, this.#find(head, versionId), head.revision, s);
        });
    }
    audit(signal: BotSignal, options: { readonly limit?: number } = {}): Promise<readonly ModelJournalEntry[]> {
        return this.#operation(signal, false, async (s) => {
            const limit = options?.limit ?? 100;
            if (!isInt(limit, 1, MODEL_REGISTRY_LIMITS.maxAuditEntries)) fail('invalid-input', 'Invalid audit limit.');
            const head = await this.#reload(s);
            const entries: ModelJournalEntry[] = [];
            let key: string | null = head.journal.tip, expected = head.journal.length;
            while (key && entries.length < limit) {
                const entry: ModelJournalEntry = await getRecord(this.#r, key, (raw) => parseJournal(raw, this.#r), s);
                if (entry.sequence !== expected) corrupt('journal sequence');
                entries.push(Object.freeze(entry));
                key = entry.prev;
                expected--;
            }
            return Object.freeze(entries.reverse());
        });
    }
    verify(signal: BotSignal): Promise<ModelRegistryIntegrityReport> {
        return this.#operation(signal, false, async (s) => {
            const r = this.#r;
            const head = await this.#reload(s);
            const issues: { versionId: string | null; object: ModelRegistryIntegrityReport['issues'][number]['object']; problem: 'missing' | 'checksum-mismatch' | 'invalid' }[] = [];
            let checked = 0;
            const probe = async <T>(versionId: string | null, object: ModelRegistryIntegrityReport['issues'][number]['object'], load: () => Promise<T>): Promise<T | null> => {
                checked++;
                try {
                    return await load();
                } catch (error) {
                    if (s.aborted) throw abortError(s);
                    const code = error instanceof ModelRegistryError ? error.code : '';
                    issues.push({ versionId, object, problem: code === 'object-missing' ? 'missing' : code === 'checksum-mismatch' ? 'checksum-mismatch' : 'invalid' });
                    return null;
                }
            };
            for (const v of head.versions) {
                const manifest = await probe(v.versionId, 'manifest', () => getRecord(r, v.manifest, (raw) => parseManifest(raw, r), s));
                if (manifest) {
                    await probe(v.versionId, 'artifact', async () => {
                        const text = await getText(r, manifest.artifact.digest, r.maxArtifactBytes, s);
                        if (text.length !== manifest.artifact.bytes) fail('checksum-mismatch');
                        return parseArtifact(text, r);
                    });
                    if (manifest.dataset) await probe(v.versionId, 'dataset', () => getRecord(r, manifest.dataset!.manifest, (raw) => validateDatasetManifest(raw), s));
                }
                if (v.evaluation) {
                    const evaluation = await probe(v.versionId, 'evaluation', () => getRecord(r, v.evaluation!, parseEvaluation, s));
                    if (evaluation) {
                        await probe(v.versionId, 'suite', () => getText(r, evaluation.suite.object, MODEL_REGISTRY_LIMITS.maxRecordBytes, s));
                        for (const report of [evaluation.baseline.report, evaluation.candidate.report])
                            await probe(v.versionId, 'report', () => getText(r, report, MODEL_REGISTRY_LIMITS.maxRecordBytes, s));
                    }
                }
                if (v.approval) await probe(v.versionId, 'approval', () => getRecord(r, v.approval!, parseApproval, s));
            }
            // Walk the whole journal chain.
            let key: string | null = head.journal.tip, expected = head.journal.length;
            while (key) {
                const entry: ModelJournalEntry | null = await probe(null, 'journal', () => getRecord(r, key!, (raw) => parseJournal(raw, r), s));
                if (!entry) break;
                if (entry.sequence !== expected) {
                    issues.push({ versionId: null, object: 'journal', problem: 'invalid' });
                    break;
                }
                key = entry.prev;
                expected--;
            }
            return Object.freeze({ ok: issues.length === 0, revision: head.revision, checkedObjects: checked, issues: Object.freeze(issues.map((i) => Object.freeze(i))) });
        });
    }
    async close(): Promise<void> {
        this.#closed = true;
        // Wait for queued work and any swap whose outcome is still unknown.
        await this.#lock.catch(() => undefined);
        await this.#inflight.catch(() => undefined);
    }
}

/**
 * Opens an existing registry. Never creates or repairs data: a missing head is `registry-missing`,
 * an invalid head (schema, checksum, signature) is `corrupt-registry`, another tenant's data is `cross-tenant`.
 */
export async function openModelRegistry(options: ModelRegistryOptions, signal: BotSignal): Promise<ModelRegistry> {
    const r = await resolveOptions(options);
    const placeholder = { revision: 0 } as Head;
    const registry = new Registry(r, placeholder);
    await registry.refresh(signal);
    return registry;
}

/** Creates an empty registry in an empty store. Requires an authorized administrator (`create`). */
export async function createModelRegistry(options: ModelRegistryOptions, root: TaskContext, signal: BotSignal): Promise<ModelRegistry> {
    const r = await resolveOptions(options);
    if (!signal || typeof signal.addEventListener !== 'function') fail('invalid-input', 'A signal is required.');
    const controller = new AbortController();
    const onAbort = () => controller.abort('cancelled');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort('cancelled');
    const timer = setTimeout(() => controller.abort(TIMEOUT), r.timeoutMs);
    const s = controller.signal;
    try {
        if ((await race(r.store.readHead(s), s)) !== null) fail('registry-exists', 'The store already holds a registry.');
        const actor = await authorizeRoot(r, root, 'create', { registryId: r.registryId, versionId: null, modelId: null }, s);
        const now = clock(r);
        const operation = randomHex(16);
        const tip = await putRecord(r, {
            format: 'shivax-model-journal', version: 1, registryId: r.registryId, sequence: 1, revision: 1, at: now, operation, action: 'create',
            versionId: null, from: null, to: null, displaced: null, active: null, actorRef: actor, reasons: [], prev: null,
        } satisfies ModelJournalEntry, s);
        const { head, text } = await serializeHead(r, {
            format: 'shivax-model-registry', version: 1, registryId: r.registryId, owner: r.owner, issuer: r.issuer, revision: 1, createdAt: now,
            nextSequence: 1, securityProfile: r.profile, versions: [], active: null, activations: [], journal: { tip, length: 1 },
            lastOperation: { id: operation, action: 'create', revision: 1 },
        }, s);
        const guard = () => {
            if (s.aborted) throw abortError(s);
            if (r.checkAuthorization(root, 'create', actor) !== true) fail('unauthorized', 'The administrator authorization was revoked.');
        };
        guard();
        if (!(await race(r.store.compareAndSwapHead(0, text, 1, guard, s), s))) fail('registry-exists', 'Another writer created the registry first.');
        return new Registry(r, head);
    } catch (error) {
        throw normalize(error, s);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
