import type { BotValue, TaskContext } from '../agents/types.js';
import type { WorkflowInput } from '../agents/rudra/types.js';
import type { ActionEffect, ProtectedTool } from '../security/types.js';
import type { ModelCapability, ModelOutputContract, ModelProvider } from '../intelligence/types.js';

/** Data only. No handler, permission, approval, effect, retry or budget overrides. */
export interface ToolCallProposal {
    readonly id: string;
    readonly capability: string;
    readonly input: WorkflowInput;
    readonly dependsOn?: readonly string[];
}
export interface AutonomousWorkflowPlan {
    readonly actions: readonly ToolCallProposal[];
}
export interface WorkflowToolBinding {
    readonly capability: string;
    readonly effect: ActionEffect;
    /** Host attests that overlapping invocations do not share mutable resources. */
    readonly parallelSafe?: boolean;
    readonly id: string;
}
export interface WorkflowTool extends ProtectedTool, WorkflowToolBinding {}
export interface WorkflowModelTool {
    readonly id: string;
    readonly capability: string;
    readonly provider: ModelProvider;
    readonly modelCapability: ModelCapability;
    readonly output: ModelOutputContract;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly allowRemote?: boolean;
    validateInput(input: BotValue): boolean;
}
export interface WorkflowModelBudget {
    readonly maxCalls: number;
    readonly maxTokens: number;
    readonly maxCostUSD: number;
}
export interface WorkflowOptions {
    /** Default: only the root task capability. Always configured by the host. */
    readonly allowedCapabilities?: readonly string[];
    readonly maxSteps?: number;
    readonly maxToolCalls?: number;
    /** Default 1; maximum 8. Only attested, policy-checked read-only tools overlap. */
    readonly maxParallel?: number;
    /** Extra attempts, at most 3; only read-only tool-error failures. */
    readonly maxRetries?: number;
    /** Defaults to zero: model tools require an explicit per-task budget. */
    readonly modelBudget?: WorkflowModelBudget;
}
export type WorkflowStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'paused'
    | 'completed'
    | 'denied'
    | 'failed'
    | 'cancelled';
export type WorkflowErrorCode =
    | 'invalid-options'
    | 'invalid-plan'
    | 'missing-capability'
    | 'capability-denied'
    | 'registry-changed'
    | 'max-steps'
    | 'tool-limit'
    | 'model-budget'
    | 'output-limit'
    | 'timeout'
    | 'cancelled'
    | 'security-denied'
    | 'tool-failed'
    | 'busy'
    | 'disposed'
    | 'invalid-state';
export interface WorkflowTrace {
    readonly sequence: number;
    readonly taskId: string;
    readonly type: 'state' | 'action' | 'retry';
    readonly status?: WorkflowStatus;
    /** Only host-registered identifiers and plan indexes; no model/website payloads. */
    readonly actionIndex?: number;
    readonly toolId?: string;
    readonly capability?: string;
    readonly attempt?: number;
    readonly outcome?: 'approved' | 'completed' | 'failed';
    readonly errorCode?: string;
}
export interface WorkflowOutput {
    readonly actionId: string;
    readonly trust: 'untrusted';
    readonly data: BotValue;
}
export interface WorkflowSnapshot {
    readonly taskId: string;
    readonly status: WorkflowStatus;
    readonly outputs: readonly WorkflowOutput[];
    readonly trace: readonly WorkflowTrace[];
    readonly usage: {
        readonly steps: number;
        readonly toolCalls: number;
        readonly modelCalls: number;
        readonly modelTokens: number;
        readonly modelCostUSD: number;
    };
    readonly error?: { readonly code: WorkflowErrorCode; readonly message: string };
}
/** Host-only control handle. Not serializable and never provided to tools or model providers. */
export interface WorkflowRun {
    readonly context: TaskContext;
    readonly snapshot: WorkflowSnapshot;
    readonly result: Promise<WorkflowSnapshot>;
    /** Resolves at a quiescent action boundary or terminal result. Does not replay active work. */
    pause(): Promise<WorkflowSnapshot>;
    resume(): void;
    cancel(): void;
}
