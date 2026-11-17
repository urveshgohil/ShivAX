/**
 * H04 workflow safety warnings: one versioned, bounded, nonsecret format shared by the
 * Abhimanyu preflight validator and the Ashwatthama lifecycle observer.
 * Warnings are advisory data. They never grant or remove Jay, Vijay or firewall authority.
 */

export type SafetyValidator = 'abhimanyu' | 'ashwatthama';
export type SafetySeverity = 'low' | 'medium' | 'high';
/** `confirmed`: provably unsafe from the inputs. `potential`: may be unsafe. `insufficient-metadata`: cannot decide. */
export type SafetyCertainty = 'confirmed' | 'potential' | 'insufficient-metadata';
/** `reported`: advisory only. `blocked`: enforce-mode preflight refusal. `cancellation-requested`: cooperative cancel requested. */
export type SafetyDisposition = 'reported' | 'blocked' | 'cancellation-requested';
export type SafetyMode = 'disabled' | 'warn' | 'enforce';

export const ABHIMANYU_RULE_IDS = Object.freeze([
    'ABH_INVALID_PLAN',
    'ABH_UNREACHABLE_COMPLETION',
    'ABH_MISSING_PROFILE',
    'ABH_NO_EXIT_PATH',
    'ABH_UNBOUNDED_DEADLINE',
    'ABH_DEADLINE_INFEASIBLE',
    'ABH_UNBOUNDED_RETRY',
    'ABH_RETRY_SIDE_EFFECT',
    'ABH_MISSING_CLEANUP',
    'ABH_MISSING_COMPENSATION',
    'ABH_RESUME_UNSAFE',
    'ABH_INVALID_DECLARATION',
    'ABH_ANALYSIS_TRUNCATED',
] as const);
export const ASHWATTHAMA_RULE_IDS = Object.freeze([
    'ASH_LEASE_EXPIRED',
    'ASH_DEADLINE_EXCEEDED',
    'ASH_HEARTBEAT_MISSED',
    'ASH_CANCEL_STUCK',
    'ASH_OPERATION_ORPHANED',
    'ASH_COMPLETION_UNACKNOWLEDGED',
    'ASH_CLEANUP_UNACKNOWLEDGED',
    'ASH_CLEANUP_FAILED_REPEATEDLY',
    'ASH_TRACKING_LIMIT',
] as const);
export type AbhimanyuRuleId = (typeof ABHIMANYU_RULE_IDS)[number];
export type AshwatthamaRuleId = (typeof ASHWATTHAMA_RULE_IDS)[number];
export type SafetyRuleId = AbhimanyuRuleId | AshwatthamaRuleId;

export interface SafetyRule {
    readonly id: SafetyRuleId;
    readonly version: number;
    readonly validator: SafetyValidator;
    readonly severity: SafetySeverity;
    /** Static text from this catalog only; never built from task data. */
    readonly remediation: string;
}
const rule = (id: SafetyRuleId, validator: SafetyValidator, severity: SafetySeverity, remediation: string): SafetyRule =>
    Object.freeze({ id, version: 1, validator, severity, remediation });

/** Stable catalog. A behavior change to a rule must bump its `version`. */
export const SAFETY_WARNING_RULES: Readonly<Record<SafetyRuleId, SafetyRule>> = Object.freeze({
    ABH_INVALID_PLAN: rule('ABH_INVALID_PLAN', 'abhimanyu', 'high', 'Fix the plan: the existing workflow validator rejects it.'),
    ABH_UNREACHABLE_COMPLETION: rule('ABH_UNREACHABLE_COMPLETION', 'abhimanyu', 'high', 'Allowlist and bind every capability the plan uses, or remove the action.'),
    ABH_MISSING_PROFILE: rule('ABH_MISSING_PROFILE', 'abhimanyu', 'medium', 'Declare a safety profile for this capability.'),
    ABH_NO_EXIT_PATH: rule('ABH_NO_EXIT_PATH', 'abhimanyu', 'high', 'Provide cooperative cancellation or a verified cleanup path before admitting this protected action.'),
    ABH_UNBOUNDED_DEADLINE: rule('ABH_UNBOUNDED_DEADLINE', 'abhimanyu', 'medium', 'Set a finite task deadline, or declare an approved long-running deadline.'),
    ABH_DEADLINE_INFEASIBLE: rule('ABH_DEADLINE_INFEASIBLE', 'abhimanyu', 'medium', 'Raise the deadline, reduce retries, or shorten the critical path.'),
    ABH_UNBOUNDED_RETRY: rule('ABH_UNBOUNDED_RETRY', 'abhimanyu', 'high', 'Bound tool-internal retries.'),
    ABH_RETRY_SIDE_EFFECT: rule('ABH_RETRY_SIDE_EFFECT', 'abhimanyu', 'high', 'Do not retry a non-idempotent state-changing action, or declare it idempotent.'),
    ABH_MISSING_CLEANUP: rule('ABH_MISSING_CLEANUP', 'abhimanyu', 'medium', 'Declare the verified host cleanup that releases this protected action.'),
    ABH_MISSING_COMPENSATION: rule('ABH_MISSING_COMPENSATION', 'abhimanyu', 'medium', 'Declare a compensating capability for committed effects, or accept partial completion explicitly.'),
    ABH_RESUME_UNSAFE: rule('ABH_RESUME_UNSAFE', 'abhimanyu', 'medium', 'Declare verified resume recovery, or disable pausing for this workflow.'),
    ABH_INVALID_DECLARATION: rule('ABH_INVALID_DECLARATION', 'abhimanyu', 'high', 'Correct the host declaration: it references an unavailable or unallowlisted capability.'),
    ABH_ANALYSIS_TRUNCATED: rule('ABH_ANALYSIS_TRUNCATED', 'abhimanyu', 'medium', 'Reduce the plan or raise the warning limit; remaining checks were not reported.'),
    ASH_LEASE_EXPIRED: rule('ASH_LEASE_EXPIRED', 'ashwatthama', 'high', 'Renew the lease through the authorized path or cancel the operation.'),
    ASH_DEADLINE_EXCEEDED: rule('ASH_DEADLINE_EXCEEDED', 'ashwatthama', 'high', 'Cancel the operation cooperatively or record an approved deadline.'),
    ASH_HEARTBEAT_MISSED: rule('ASH_HEARTBEAT_MISSED', 'ashwatthama', 'medium', 'Check the worker; it declared heartbeats but stopped reporting progress.'),
    ASH_CANCEL_STUCK: rule('ASH_CANCEL_STUCK', 'ashwatthama', 'high', 'The work ignored cooperative cancellation; terminate the host-owned worker or connection.'),
    ASH_OPERATION_ORPHANED: rule('ASH_OPERATION_ORPHANED', 'ashwatthama', 'high', 'Its parent finished; release or terminate this host-owned work.'),
    ASH_COMPLETION_UNACKNOWLEDGED: rule('ASH_COMPLETION_UNACKNOWLEDGED', 'ashwatthama', 'medium', 'Report a terminal status for released work.'),
    ASH_CLEANUP_UNACKNOWLEDGED: rule('ASH_CLEANUP_UNACKNOWLEDGED', 'ashwatthama', 'medium', 'Acknowledge cleanup once the operation releases its resources.'),
    ASH_CLEANUP_FAILED_REPEATEDLY: rule('ASH_CLEANUP_FAILED_REPEATEDLY', 'ashwatthama', 'high', 'Cleanup keeps failing; investigate the host adapter.'),
    ASH_TRACKING_LIMIT: rule('ASH_TRACKING_LIMIT', 'ashwatthama', 'medium', 'Raise the observer limit or finish tracked work; new operations are untracked.'),
});

export type SafetyEvidence = Readonly<Record<string, string | number | boolean | null>>;
export interface SafetyWarning {
    readonly format: 'shivax-safety-warning';
    readonly version: 1;
    readonly ruleId: SafetyRuleId;
    readonly ruleVersion: number;
    readonly validator: SafetyValidator;
    readonly severity: SafetySeverity;
    readonly certainty: SafetyCertainty;
    /** Workflow, action (plan index) or tracked operation. References are host identifiers, never payloads. */
    readonly subject: {
        readonly kind: 'workflow' | 'action' | 'operation';
        readonly ref: string;
        readonly index: number | null;
    };
    /** At most 8 fields: identifiers, finite numbers, booleans or null. */
    readonly evidence: SafetyEvidence;
    readonly remediation: string;
    readonly timestamp: number | null;
    readonly disposition: SafetyDisposition;
}

export const SAFETY_LIMITS = Object.freeze({
    maxPlanActions: 100,
    maxGraphDepth: 100,
    maxProfiles: 256,
    defaultMaxWarnings: 64,
    maxWarnings: 256,
    defaultMaxOperations: 256,
    maxOperations: 4096,
    defaultMaxHistory: 256,
    maxHistory: 4096,
    maxEvidenceFields: 8,
    maxRefLength: 128,
    maxDeadlineMs: 86_400_000,
    defaultMaxDeadlineMs: 900_000,
});

export type SafetyErrorCode = 'invalid-input' | 'invalid-declaration' | 'invalid-policy' | 'invalid-warning';
const messages: Record<SafetyErrorCode, string> = {
    'invalid-input': 'Invalid workflow safety input.',
    'invalid-declaration': 'Invalid host safety declaration.',
    'invalid-policy': 'Invalid workflow safety policy.',
    'invalid-warning': 'Invalid workflow safety warning.',
};
export class WorkflowSafetyError extends Error {
    constructor(readonly code: SafetyErrorCode) {
        if (!Object.prototype.hasOwnProperty.call(messages, code)) throw new TypeError('Invalid safety error code.');
        super(messages[code]);
        this.name = 'WorkflowSafetyError';
    }
}
export const fail = (code: SafetyErrorCode): never => {
    throw new WorkflowSafetyError(code);
};

const REF = /^[A-Za-z0-9._:-]{1,128}$/;
export const isRef = (value: unknown): value is string => typeof value === 'string' && REF.test(value);
export function plain(value: unknown, keys: readonly string[], code: SafetyErrorCode): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
    const out: Record<string, unknown> = {};
    for (const raw of Reflect.ownKeys(value as object)) {
        if (typeof raw !== 'string' || !keys.includes(raw)) fail(code);
        const key = raw as string;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) fail(code); // never invoke host accessors
        out[key] = descriptor.value;
    }
    return out;
}
export function count(value: unknown, min: number, max: number, code: SafetyErrorCode): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(code);
    return value as number;
}

export interface SafetyPolicy {
    readonly mode: SafetyMode;
    /** Rules that may block (preflight) or request cooperative cancellation (runtime) in `enforce` mode. */
    readonly enforceRules?: readonly SafetyRuleId[];
    /** High-impact hosts: also block enforced rules whose certainty is not `confirmed`. Preflight only. */
    readonly blockUncertain?: boolean;
}
export interface ResolvedPolicy {
    readonly mode: SafetyMode;
    readonly enforce: ReadonlySet<SafetyRuleId>;
    readonly blockUncertain: boolean;
}
export function resolvePolicy(raw: unknown, validator: SafetyValidator, defaults: readonly SafetyRuleId[]): ResolvedPolicy {
    const value = plain(raw ?? { mode: 'warn' }, ['mode', 'enforceRules', 'blockUncertain'], 'invalid-policy');
    if (!['disabled', 'warn', 'enforce'].includes(value.mode as string)) fail('invalid-policy');
    if (value.blockUncertain !== undefined && typeof value.blockUncertain !== 'boolean') fail('invalid-policy');
    let rules = defaults;
    if (value.enforceRules !== undefined) {
        if (!Array.isArray(value.enforceRules) || value.enforceRules.length > 64) fail('invalid-policy');
        rules = (value.enforceRules as unknown[]).map((id) => {
            const known = SAFETY_WARNING_RULES[id as SafetyRuleId];
            if (typeof id !== 'string' || !known || known.validator !== validator) fail('invalid-policy');
            return id as SafetyRuleId;
        });
    }
    return Object.freeze({ mode: value.mode as SafetyMode, enforce: new Set(rules), blockUncertain: value.blockUncertain === true });
}

/** Builds a warning from the catalog; evidence is bounded and must already be nonsecret. */
export function warning(
    ruleId: SafetyRuleId,
    certainty: SafetyCertainty,
    subject: SafetyWarning['subject'],
    evidence: Record<string, string | number | boolean | null>,
    timestamp: number | null,
    disposition: SafetyDisposition
): SafetyWarning {
    const r = SAFETY_WARNING_RULES[ruleId];
    return validateSafetyWarning({
        format: 'shivax-safety-warning',
        version: 1,
        ruleId,
        ruleVersion: r.version,
        validator: r.validator,
        severity: r.severity,
        certainty,
        subject: { ...subject },
        evidence: { ...evidence },
        remediation: r.remediation,
        timestamp,
        disposition,
    });
}

/** Validates (and freezes a copy of) a warning. Rejects unknown rules, free text, payload-shaped evidence. */
export function validateSafetyWarning(raw: unknown): SafetyWarning {
    const w = plain(raw, ['format', 'version', 'ruleId', 'ruleVersion', 'validator', 'severity', 'certainty', 'subject', 'evidence', 'remediation', 'timestamp', 'disposition'], 'invalid-warning');
    const r = SAFETY_WARNING_RULES[w.ruleId as SafetyRuleId];
    if (
        w.format !== 'shivax-safety-warning' ||
        w.version !== 1 ||
        typeof w.ruleId !== 'string' ||
        !r ||
        !Object.prototype.hasOwnProperty.call(SAFETY_WARNING_RULES, w.ruleId) ||
        w.ruleVersion !== r.version ||
        w.validator !== r.validator ||
        w.severity !== r.severity ||
        w.remediation !== r.remediation ||
        !['confirmed', 'potential', 'insufficient-metadata'].includes(w.certainty as string) ||
        !['reported', 'blocked', 'cancellation-requested'].includes(w.disposition as string) ||
        (w.disposition === 'blocked' && r.validator !== 'abhimanyu') ||
        (w.disposition === 'cancellation-requested' && r.validator !== 'ashwatthama') ||
        (w.timestamp !== null && (typeof w.timestamp !== 'number' || !Number.isFinite(w.timestamp)))
    )
        fail('invalid-warning');
    const s = plain(w.subject, ['kind', 'ref', 'index'], 'invalid-warning');
    if (!['workflow', 'action', 'operation'].includes(s.kind as string) || !isRef(s.ref) || (s.index !== null && !(Number.isSafeInteger(s.index) && (s.index as number) >= 0)))
        fail('invalid-warning');
    const e = plain(w.evidence, Object.keys((w.evidence ?? {}) as object), 'invalid-warning');
    const keys = Object.keys(e);
    if (keys.length > SAFETY_LIMITS.maxEvidenceFields) fail('invalid-warning');
    for (const key of keys) {
        const v = e[key];
        if (!isRef(key) || !(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isRef(v))) fail('invalid-warning');
    }
    return Object.freeze({
        format: 'shivax-safety-warning',
        version: 1,
        ruleId: w.ruleId as SafetyRuleId,
        ruleVersion: r.version,
        validator: r.validator,
        severity: r.severity,
        certainty: w.certainty as SafetyCertainty,
        subject: Object.freeze({ kind: s.kind as SafetyWarning['subject']['kind'], ref: s.ref as string, index: s.index as number | null }),
        evidence: Object.freeze({ ...e }) as SafetyEvidence,
        remediation: r.remediation,
        timestamp: w.timestamp as number | null,
        disposition: w.disposition as SafetyDisposition,
    });
}
