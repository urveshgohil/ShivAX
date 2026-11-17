/**
 * Abhimanyu: opt-in static preflight for "can this workflow enter a protected operation without a safe way out?"
 *
 * It reuses the existing plan and option validators (acyclicity, step and retry caps are already enforced
 * there) and only adds exit, cleanup, compensation, deadline and retry analysis over host-declared metadata.
 * It never inspects host adapters: an absent declaration is `insufficient-metadata`, not a confirmed defect.
 */
import { plan as validateWorkflowPlan, settings as workflowSettings } from '../validation.js';
import { options as rudraOptions, plan as validateRudraPlan } from '../../agents/rudra/validation.js';
import {
    SAFETY_LIMITS,
    count,
    fail,
    isRef,
    plain,
    resolvePolicy,
    warning,
    type AbhimanyuRuleId,
    type ResolvedPolicy,
    type SafetyCertainty,
    type SafetyPolicy,
    type SafetyWarning,
} from './schema.js';

/** A host attestation that a capability's cleanup, compensation or resume path exists and was verified. */
export interface SafetyVerification {
    /** Host reference to who or what verified the mechanism (for example a review or test-suite id). */
    readonly verifiedBy: string;
    readonly version: string;
}
/** Host-declared safety metadata for one capability. Closed schema; never derived from task data. */
export interface WorkflowSafetyProfile {
    readonly capability: string;
    /** `protected`: external, network, lease-bearing or otherwise authorized side effects. */
    readonly sideEffect: 'none' | 'protected';
    /** Defaults to the bound workflow tool's effect when a ToolRegistry is supplied. */
    readonly effect?: 'read-only' | 'state-changing';
    /** Upper bound for one attempt, 1 ms to 24 h. */
    readonly maxDurationMs?: number;
    readonly cancellation?: 'cooperative' | 'ignored';
    readonly cleanup?: SafetyVerification | 'none';
    readonly compensation?: (SafetyVerification & { readonly capability: string }) | 'none';
    readonly resume?: SafetyVerification | 'unsupported';
    /** Retries performed inside the tool or host adapter, in addition to engine retries. */
    readonly retries?: { readonly max: number } | 'unbounded';
    readonly idempotent?: boolean;
}
export interface ApprovedLongRunning {
    readonly maxDurationMs: number;
    readonly approvalRef: string;
}
export interface AbhimanyuOptions {
    readonly profiles: readonly WorkflowSafetyProfile[];
    readonly policy?: SafetyPolicy;
    /** The host lets this workflow pause and resume. Enables resume-recovery checks. */
    readonly pausable?: boolean;
    readonly approvedLongRunning?: ApprovedLongRunning;
    /** Deadlines above this need `approvedLongRunning`. Default 15 min, cap 24 h. */
    readonly maxDeadlineMs?: number;
    readonly maxWarnings?: number;
    /**
     * Enforce mode only, default `true`: an omitted declaration is analyzed as its least-safe value
     * (no profile = a protected, state-changing action; `cancellation` = `'ignored'`; `cleanup`,
     * `compensation` = `'none'`; `resume` = `'unsupported'`; `idempotent` = `false`). Leaving a field out can
     * then never pass a plan that the honest least-safe declaration would block. `false` restores lenient
     * analysis explicitly.
     */
    readonly requireDeclarations?: boolean;
}
export interface AbhimanyuInput extends AbhimanyuOptions {
    /** An `AutonomousWorkflowPlan` (`actions`) or a RUDRA `WorkflowPlan` (`steps`). Copied, never mutated. */
    readonly plan: unknown;
    /** Root task capability: the existing default allowlist when none is given. */
    readonly capability: string;
    /** Workflow-engine options or RUDRA options, validated by the existing validators. */
    readonly options?: Record<string, unknown>;
    /** The task deadline (`TaskContext.limits.timeoutMs`). */
    readonly deadlineMs?: number;
    /** Optional live bindings; `ToolRegistry` satisfies this. */
    readonly tools?: { findByCapability(capability: string): readonly { readonly effect: 'read-only' | 'state-changing' }[] };
    readonly workflowRef?: string;
    readonly maxPlanBytes?: number;
    readonly now?: () => number;
}
export interface AbhimanyuReport {
    readonly format: 'shivax-abhimanyu-report';
    readonly version: 1;
    readonly validator: 'abhimanyu';
    readonly mode: 'disabled' | 'warn' | 'enforce';
    /** `block` only in enforce mode. Warnings never change Jay, Vijay or firewall decisions. */
    readonly decision: 'allow' | 'block';
    readonly actions: number;
    readonly depth: number;
    readonly warnings: readonly SafetyWarning[];
    readonly truncated: boolean;
    /** Default enforced rules the host policy relaxed (also reported as `ABH_ENFORCEMENT_RELAXED`). */
    readonly relaxedRules: readonly AbhimanyuRuleId[];
    readonly evaluatedAt: number | null;
}

export const ABHIMANYU_DEFAULT_ENFORCED: readonly AbhimanyuRuleId[] = Object.freeze([
    'ABH_INVALID_PLAN',
    'ABH_UNREACHABLE_COMPLETION',
    'ABH_NO_EXIT_PATH',
    'ABH_UNBOUNDED_RETRY',
    'ABH_RETRY_SIDE_EFFECT',
    'ABH_INVALID_DECLARATION',
]);

interface Profile {
    readonly capability: string;
    readonly sideEffect: 'none' | 'protected';
    readonly effect?: 'read-only' | 'state-changing';
    readonly maxDurationMs?: number;
    readonly cancellation?: 'cooperative' | 'ignored';
    readonly cleanup?: 'verified' | 'none';
    readonly compensation?: { readonly capability: string } | 'none';
    readonly resume?: 'verified' | 'unsupported';
    readonly retries?: number | 'unbounded';
    readonly idempotent?: boolean;
}
function verification(raw: unknown, extra: readonly string[] = []): Record<string, unknown> {
    const v = plain(raw, ['verifiedBy', 'version', ...extra], 'invalid-declaration');
    if (!isRef(v.verifiedBy) || !isRef(v.version)) fail('invalid-declaration');
    return v;
}
/** Validates host declarations. Malformed declarations are rejected outright, never treated as safe. */
export function validateSafetyProfiles(raw: unknown): ReadonlyMap<string, Profile> {
    if (!Array.isArray(raw) || raw.length > SAFETY_LIMITS.maxProfiles) fail('invalid-declaration');
    const out = new Map<string, Profile>();
    for (const item of raw as unknown[]) {
        const p = plain(item, ['capability', 'sideEffect', 'effect', 'maxDurationMs', 'cancellation', 'cleanup', 'compensation', 'resume', 'retries', 'idempotent'], 'invalid-declaration');
        if (!isRef(p.capability) || out.has(p.capability)) fail('invalid-declaration');
        if (p.sideEffect !== 'none' && p.sideEffect !== 'protected') fail('invalid-declaration');
        if (p.effect !== undefined && p.effect !== 'read-only' && p.effect !== 'state-changing') fail('invalid-declaration');
        if (p.maxDurationMs !== undefined) count(p.maxDurationMs, 1, SAFETY_LIMITS.maxDeadlineMs, 'invalid-declaration');
        if (p.cancellation !== undefined && p.cancellation !== 'cooperative' && p.cancellation !== 'ignored') fail('invalid-declaration');
        if (p.idempotent !== undefined && typeof p.idempotent !== 'boolean') fail('invalid-declaration');
        if (p.cleanup !== undefined && p.cleanup !== 'none') verification(p.cleanup);
        let compensation: Profile['compensation'];
        if (p.compensation === 'none') compensation = 'none';
        else if (p.compensation !== undefined) {
            const c = verification(p.compensation, ['capability']);
            if (!isRef(c.capability) || c.capability === p.capability) fail('invalid-declaration');
            compensation = Object.freeze({ capability: c.capability as string });
        }
        if (p.resume !== undefined && p.resume !== 'unsupported') verification(p.resume);
        let retries: Profile['retries'];
        if (p.retries === 'unbounded') retries = 'unbounded';
        else if (p.retries !== undefined) retries = count(plain(p.retries, ['max'], 'invalid-declaration').max, 0, 10, 'invalid-declaration');
        out.set(p.capability as string, Object.freeze({
            capability: p.capability as string,
            sideEffect: p.sideEffect,
            ...(p.effect !== undefined ? { effect: p.effect as Profile['effect'] } : {}),
            ...(p.maxDurationMs !== undefined ? { maxDurationMs: p.maxDurationMs as number } : {}),
            ...(p.cancellation !== undefined ? { cancellation: p.cancellation as Profile['cancellation'] } : {}),
            ...(p.cleanup !== undefined ? { cleanup: p.cleanup === 'none' ? 'none' : 'verified' } : {}),
            ...(compensation !== undefined ? { compensation } : {}),
            ...(p.resume !== undefined ? { resume: p.resume === 'unsupported' ? 'unsupported' : 'verified' } : {}),
            ...(retries !== undefined ? { retries } : {}),
            ...(p.idempotent !== undefined ? { idempotent: p.idempotent as boolean } : {}),
        } as Profile));
    }
    return out;
}

export interface PreparedAbhimanyu {
    readonly profiles: ReadonlyMap<string, Profile>;
    readonly policy: ResolvedPolicy;
    readonly pausable: boolean;
    readonly approvedLongRunning?: ApprovedLongRunning;
    readonly maxDeadlineMs: number;
    readonly maxWarnings: number;
    readonly requireDeclarations: boolean;
}
/** Validates the host configuration once (used by the engine at construction). */
export function prepareAbhimanyu(raw: unknown): PreparedAbhimanyu {
    const v = plain(raw, ['profiles', 'policy', 'pausable', 'approvedLongRunning', 'maxDeadlineMs', 'maxWarnings', 'requireDeclarations'], 'invalid-input');
    if (v.pausable !== undefined && typeof v.pausable !== 'boolean') fail('invalid-input');
    if (v.requireDeclarations !== undefined && typeof v.requireDeclarations !== 'boolean') fail('invalid-input');
    let approved: ApprovedLongRunning | undefined;
    if (v.approvedLongRunning !== undefined) {
        const a = plain(v.approvedLongRunning, ['maxDurationMs', 'approvalRef'], 'invalid-declaration');
        if (!isRef(a.approvalRef)) fail('invalid-declaration');
        approved = Object.freeze({ maxDurationMs: count(a.maxDurationMs, 1, SAFETY_LIMITS.maxDeadlineMs, 'invalid-declaration'), approvalRef: a.approvalRef as string });
    }
    return Object.freeze({
        profiles: validateSafetyProfiles(v.profiles),
        policy: resolvePolicy(v.policy, 'abhimanyu', ABHIMANYU_DEFAULT_ENFORCED),
        pausable: v.pausable === true,
        ...(approved ? { approvedLongRunning: approved } : {}),
        maxDeadlineMs: v.maxDeadlineMs === undefined ? SAFETY_LIMITS.defaultMaxDeadlineMs : count(v.maxDeadlineMs, 1, SAFETY_LIMITS.maxDeadlineMs, 'invalid-input'),
        maxWarnings: v.maxWarnings === undefined ? SAFETY_LIMITS.defaultMaxWarnings : count(v.maxWarnings, 1, SAFETY_LIMITS.maxWarnings, 'invalid-input'),
        requireDeclarations: v.requireDeclarations !== false,
    });
}

interface Node {
    readonly index: number;
    readonly capability: string;
    readonly deps: readonly number[];
}
export interface ResolvedRun {
    readonly allowed: readonly string[];
    readonly maxRetries: number;
    readonly maxParallel: number;
    readonly maxSteps: number;
}

/** Core analysis over an already-resolved configuration. Exported for the workflow engine. */
export function analyzeWorkflow(
    prepared: PreparedAbhimanyu,
    rawPlan: unknown,
    run: ResolvedRun,
    context: {
        readonly deadlineMs?: number;
        readonly tools?: AbhimanyuInput['tools'];
        readonly workflowRef?: string;
        readonly maxPlanBytes: number;
        readonly now?: () => number;
    }
): AbhimanyuReport {
    const at = context.now ? context.now() : null;
    const timestamp = typeof at === 'number' && Number.isFinite(at) ? at : null;
    const mode = prepared.policy.mode;
    const workflowRef = context.workflowRef ?? 'workflow';
    const report = (warnings: SafetyWarning[], actions: number, depth: number, truncated: boolean): AbhimanyuReport =>
        Object.freeze({
            format: 'shivax-abhimanyu-report',
            version: 1,
            validator: 'abhimanyu',
            mode,
            decision: warnings.some((w) => w.disposition === 'blocked') ? 'block' : 'allow',
            actions,
            depth,
            warnings: Object.freeze(warnings),
            truncated,
            relaxedRules: prepared.policy.relaxed as readonly AbhimanyuRuleId[],
            evaluatedAt: timestamp,
        });
    if (mode === 'disabled') return report([], 0, 0, false);

    type Evidence = Record<string, string | number | boolean | null>;
    // `worstConfirmed`: the finding rests on an omitted declaration whose least-safe value makes it confirmed.
    const found: { id: AbhimanyuRuleId; certainty: SafetyCertainty; index: number | null; evidence: Evidence; worstConfirmed: boolean }[] = [];
    const add = (id: AbhimanyuRuleId, certainty: SafetyCertainty, index: number | null, evidence: Evidence = {}, worstConfirmed = false) =>
        found.push({ id, certainty, index, evidence: worstConfirmed ? { ...evidence, assumedWorstCase: true } : evidence, worstConfirmed });
    // M1/M2: in enforce mode, omissions are analyzed as their least-safe declaration.
    const strict = mode === 'enforce' && prepared.requireDeclarations;

    // 1. Reuse the existing validators; Abhimanyu never re-implements plan structure checks.
    let nodes: Node[] = [];
    let steps = false;
    try {
        const shape = plain(rawPlan, ['actions', 'steps'], 'invalid-input');
        steps = shape.steps !== undefined;
        if (steps) {
            const p = validateRudraPlan(rawPlan, run.maxSteps, context.maxPlanBytes);
            const ids = new Map(p.steps.map((s, i) => [s.id, i]));
            nodes = p.steps.map((s, index) => ({ index, capability: s.capability, deps: s.input.source === 'step' ? [ids.get(s.input.stepId)!] : [] }));
        } else {
            const p = validateWorkflowPlan(rawPlan, run.maxSteps, context.maxPlanBytes);
            const ids = new Map(p.actions.map((a, i) => [a.id, i]));
            nodes = p.actions.map((a, index) => ({
                index,
                capability: a.capability,
                deps: [...new Set([...(a.dependsOn ?? []), ...(a.input.source === 'step' ? [a.input.stepId] : [])])].map((id) => ids.get(id)!),
            }));
        }
    } catch {
        add('ABH_INVALID_PLAN', 'confirmed', null, { kind: steps ? 'rudra-steps' : 'workflow-actions' });
        return finish();
    }

    // 2. Depth by dynamic programming over plan order (validators guarantee earlier-only references).
    const depthOf: number[] = [];
    for (const n of nodes) depthOf.push(1 + Math.max(0, ...n.deps.map((d) => depthOf[d])));
    const depth = Math.min(SAFETY_LIMITS.maxGraphDepth, Math.max(0, ...depthOf));

    // 3. Deadline boundary.
    const deadline = context.deadlineMs;
    if (deadline === undefined) add('ABH_UNBOUNDED_DEADLINE', 'insufficient-metadata', null, { deadlineMs: null });
    else if (deadline > prepared.maxDeadlineMs && !(prepared.approvedLongRunning && deadline <= prepared.approvedLongRunning.maxDurationMs))
        add('ABH_UNBOUNDED_DEADLINE', 'potential', null, { deadlineMs: deadline, maxDeadlineMs: prepared.maxDeadlineMs, approved: false });

    // 4. Per-action exit analysis.
    const effectOf = (capability: string, profile?: Profile) =>
        profile?.effect ?? context.tools?.findByCapability(capability)[0]?.effect;
    const duration: (number | undefined)[] = [];
    for (const n of nodes) {
        const cap = isRef(n.capability) ? n.capability : null;
        if (!run.allowed.includes(n.capability)) {
            add('ABH_UNREACHABLE_COMPLETION', 'confirmed', n.index, { capability: cap, reason: 'not-allowlisted' });
            continue;
        }
        if (context.tools && !steps && context.tools.findByCapability(n.capability).length === 0) {
            add('ABH_UNREACHABLE_COMPLETION', 'confirmed', n.index, { capability: cap, reason: 'unbound' });
            continue;
        }
        const declared = prepared.profiles.get(n.capability);
        if (!declared) {
            add('ABH_MISSING_PROFILE', 'insufficient-metadata', n.index, { capability: cap });
            // Lenient analysis stops here; strict analysis continues with the least-safe profile (M2).
            if (!strict) continue;
        }
        const profile: Profile = declared ?? { capability: n.capability, sideEffect: 'protected' };
        const declaredEffect = effectOf(n.capability, declared);
        const effect = declaredEffect ?? (strict ? 'state-changing' : undefined);
        const effectAssumed = declaredEffect === undefined && strict;
        const engineRetries = effect === 'read-only' ? run.maxRetries : 0;
        if (profile.retries === 'unbounded') add('ABH_UNBOUNDED_RETRY', 'confirmed', n.index, { capability: cap, engineRetries });
        const internal = typeof profile.retries === 'number' ? profile.retries : 0;
        if (effect === 'state-changing' && internal > 0 && profile.idempotent !== true) {
            const assumed = effectAssumed || (strict && profile.idempotent === undefined);
            add('ABH_RETRY_SIDE_EFFECT', profile.idempotent === false && !effectAssumed ? 'confirmed' : 'potential', n.index, { capability: cap, retries: internal }, assumed);
        }
        duration.push(profile.maxDurationMs === undefined || profile.retries === 'unbounded' ? undefined : profile.maxDurationMs * (1 + engineRetries + internal));
        if (profile.sideEffect !== 'protected') continue;

        // Exit: cooperative cancellation or verified cleanup must exist once a protected action starts.
        // Strict analysis fills omitted fields with their least-safe value (M1): omission never beats honesty.
        const cancellation = profile.cancellation ?? (strict ? 'ignored' : undefined);
        const cleanup = profile.cleanup ?? (strict ? 'none' : undefined);
        const exitAssumed = strict && (profile.cancellation === undefined || profile.cleanup === undefined);
        let exitReported = false;
        if (cancellation === 'ignored' && cleanup !== 'verified') {
            const declaredConfirmed = profile.cancellation === 'ignored' && profile.cleanup === 'none';
            add('ABH_NO_EXIT_PATH', declaredConfirmed ? 'confirmed' : profile.cancellation === 'ignored' ? 'potential' : 'insufficient-metadata', n.index,
                { capability: cap, cancellation: profile.cancellation ?? null, cleanup: profile.cleanup ?? null }, exitAssumed && cleanup === 'none');
            exitReported = true;
        }
        if (!exitReported && cleanup !== 'verified')
            add('ABH_MISSING_CLEANUP', profile.cleanup === 'none' ? 'confirmed' : 'insufficient-metadata', n.index,
                { capability: cap, cancellation: profile.cancellation ?? null }, strict && profile.cleanup === undefined);
        if (declared && declaredEffect === undefined && !exitReported)
            add('ABH_MISSING_PROFILE', 'insufficient-metadata', n.index, { capability: cap, field: 'effect' });

        // Compensation: a committed effect followed by work that can still fail leaves partial completion.
        const compensation = profile.compensation ?? (strict ? 'none' : undefined);
        if (effect === 'state-changing' && n.index < nodes.length - 1) {
            const later = nodes.length - 1 - n.index;
            const assumed = effectAssumed || (strict && profile.compensation === undefined);
            if (profile.compensation === undefined && !strict) add('ABH_MISSING_COMPENSATION', 'insufficient-metadata', n.index, { capability: cap, laterActions: later });
            else if (compensation === 'none')
                add('ABH_MISSING_COMPENSATION', profile.compensation === 'none' && !effectAssumed ? 'potential' : 'insufficient-metadata', n.index, { capability: cap, laterActions: later }, assumed);
            else if (compensation !== undefined) {
                const comp = compensation.capability;
                const usable = run.allowed.includes(comp) && prepared.profiles.has(comp) && (!context.tools || steps || context.tools.findByCapability(comp).length > 0);
                if (!usable) add('ABH_INVALID_DECLARATION', 'confirmed', n.index, { capability: cap, compensation: comp, field: 'compensation' });
            }
        }
        // Pause/resume recovery for protected state changes.
        if (prepared.pausable && effect === 'state-changing' && profile.resume !== 'verified') {
            const assumed = effectAssumed || (strict && profile.resume === undefined);
            add('ABH_RESUME_UNSAFE', profile.resume === 'unsupported' && !effectAssumed ? 'potential' : 'insufficient-metadata', n.index, { capability: cap }, assumed);
        }
    }

    // 5. Deadline feasibility: sequential sum (engine default) or critical path when actions may overlap.
    if (deadline !== undefined && duration.length === nodes.length && duration.every((d) => d !== undefined)) {
        let required: number;
        if (run.maxParallel === 1) required = (duration as number[]).reduce((a, b) => a + b, 0);
        else {
            const finish: number[] = [];
            for (const n of nodes) finish.push((duration[n.index] as number) + Math.max(0, ...n.deps.map((d) => finish[d])));
            required = Math.max(...finish);
        }
        if (required > deadline) add('ABH_DEADLINE_INFEASIBLE', 'potential', null, { requiredMs: required, deadlineMs: deadline, parallel: run.maxParallel > 1 });
    }
    return finish(depth);

    function finish(graphDepth = 0): AbhimanyuReport {
        // M3: relaxing a default enforced rule is never silent.
        if (prepared.policy.relaxed.length) {
            const evidence: Evidence = { relaxedCount: prepared.policy.relaxed.length, enforce: mode === 'enforce' };
            prepared.policy.relaxed.slice(0, 6).forEach((id, i) => {
                evidence[`rule${i + 1}`] = id;
            });
            found.unshift({ id: 'ABH_ENFORCEMENT_RELAXED', certainty: 'confirmed', index: null, evidence, worstConfirmed: false });
        }
        const limit = prepared.maxWarnings;
        const truncated = found.length > limit;
        const kept = truncated ? found.slice(0, limit - 1) : found;
        const policy = prepared.policy;
        const warnings = kept.map((f) => {
            const blocked =
                mode === 'enforce' &&
                policy.enforce.has(f.id) &&
                (f.certainty === 'confirmed' || f.worstConfirmed || policy.blockUncertain);
            const subject = f.index === null ? { kind: 'workflow' as const, ref: isRef(workflowRef) ? workflowRef : 'workflow', index: null } : { kind: 'action' as const, ref: `action-${f.index}`, index: f.index };
            return warning(f.id, f.certainty, subject, f.evidence, timestamp, blocked ? 'blocked' : 'reported');
        });
        if (truncated)
            warnings.push(warning('ABH_ANALYSIS_TRUNCATED', 'insufficient-metadata', { kind: 'workflow', ref: isRef(workflowRef) ? workflowRef : 'workflow', index: null }, { reported: limit - 1, found: found.length }, timestamp, 'reported'));
        return report(warnings, nodes.length, graphDepth, truncated);
    }
}

/** Public opt-in preflight. Validates inputs with the existing validators, then analyzes. */
export function runAbhimanyuPreflight(input: AbhimanyuInput): AbhimanyuReport {
    const v = plain(input, ['plan', 'capability', 'options', 'deadlineMs', 'tools', 'workflowRef', 'maxPlanBytes', 'now', 'profiles', 'policy', 'pausable', 'approvedLongRunning', 'maxDeadlineMs', 'maxWarnings', 'requireDeclarations'], 'invalid-input');
    if (!isRef(v.capability)) fail('invalid-input');
    if (v.workflowRef !== undefined && !isRef(v.workflowRef)) fail('invalid-input');
    if (v.now !== undefined && typeof v.now !== 'function') fail('invalid-input');
    if (v.tools !== undefined && typeof (v.tools as AbhimanyuInput['tools'])?.findByCapability !== 'function') fail('invalid-input');
    const deadlineMs = v.deadlineMs === undefined ? undefined : count(v.deadlineMs, 1, SAFETY_LIMITS.maxDeadlineMs * 365, 'invalid-input');
    const maxPlanBytes = v.maxPlanBytes === undefined ? 262_144 : count(v.maxPlanBytes, 1, 1_048_576, 'invalid-input');
    const prepared = prepareAbhimanyu({
        profiles: v.profiles,
        ...(v.policy !== undefined ? { policy: v.policy } : {}),
        ...(v.pausable !== undefined ? { pausable: v.pausable } : {}),
        ...(v.approvedLongRunning !== undefined ? { approvedLongRunning: v.approvedLongRunning } : {}),
        ...(v.maxDeadlineMs !== undefined ? { maxDeadlineMs: v.maxDeadlineMs } : {}),
        ...(v.maxWarnings !== undefined ? { maxWarnings: v.maxWarnings } : {}),
        ...(v.requireDeclarations !== undefined ? { requireDeclarations: v.requireDeclarations } : {}),
    });
    // Options go through the same validator the target engine uses.
    let run: ResolvedRun;
    const isSteps = !!v.plan && typeof v.plan === 'object' && Object.prototype.hasOwnProperty.call(v.plan, 'steps');
    try {
        if (isSteps) {
            const o = rudraOptions((v.options ?? {}) as never, v.capability as string);
            run = { allowed: o.allowedCapabilities, maxRetries: o.maxRetries, maxParallel: 1, maxSteps: o.maxSteps };
        } else {
            const o = workflowSettings((v.options ?? {}) as never, v.capability as string);
            run = { allowed: o.allowed, maxRetries: o.maxRetries, maxParallel: o.maxParallel, maxSteps: o.maxSteps };
        }
    } catch {
        return fail('invalid-input');
    }
    return analyzeWorkflow(prepared, v.plan, run, {
        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
        ...(v.tools ? { tools: v.tools as AbhimanyuInput['tools'] } : {}),
        ...(v.workflowRef ? { workflowRef: v.workflowRef as string } : {}),
        maxPlanBytes,
        ...(v.now ? { now: v.now as () => number } : {}),
    });
}
