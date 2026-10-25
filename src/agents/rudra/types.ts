import type { BotInput, BotSignal, BotValue, Capability } from '../types.js';

/** Separate from the Phase 01 TaskStatus and the legacy neural-network Task. */
export type RudraTaskStatus =
    'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type WorkflowInput =
    | { readonly source: 'task' }
    | { readonly source: 'literal'; readonly data: BotValue }
    | { readonly source: 'step'; readonly stepId: string };
export interface WorkflowStep {
    readonly id: string;
    readonly capability: string;
    readonly input: WorkflowInput;
}
/** Ordered, acyclic workflow. Dependencies must refer to earlier steps. */
export interface WorkflowPlan {
    readonly steps: readonly WorkflowStep[];
}
export interface PlanningContext {
    readonly taskId: string;
    readonly input: BotInput;
    readonly capabilities: readonly Capability[];
    readonly maxSteps: number;
    readonly signal: BotSignal;
}
/** Return unknown deliberately: even typed/model-produced plans cross runtime validation. */
export interface Planner {
    plan(context: PlanningContext): unknown | Promise<unknown>;
}
export interface RudraOptions {
    /** Includes every execution attempt, including retries. Default 16; hard cap 100. */
    readonly maxSteps?: number;
    /** Extra attempts per step, for bot-error only. Default 0; hard cap 3. */
    readonly maxRetries?: number;
    /** Host allowlist. Defaults to the request's single capability. */
    readonly allowedCapabilities?: readonly string[];
}
export type RudraErrorCode =
    | 'invalid-options'
    | 'invalid-plan'
    | 'planner-error'
    | 'missing-capability'
    | 'capability-denied'
    | 'approval-denied'
    | 'approval-error'
    | 'max-steps'
    | 'output-limit'
    | 'bot-failed'
    | 'timeout'
    | 'cancelled'
    | 'busy'
    | 'disposed';
export interface RudraErrorDetails {
    readonly code: RudraErrorCode;
    readonly message: string;
}
export interface StepOutput {
    readonly stepId: string;
    readonly botId: string;
    readonly data: BotValue;
}
export interface ApprovalRequest {
    readonly taskId: string;
    readonly sessionId: string;
    readonly stepId: string;
    readonly botId: string;
    readonly input: BotInput;
    readonly attempt: number;
    readonly signal: BotSignal;
}
/** Trusted host gate, called before every attempt; only literal true grants approval. */
export type ApprovalHandler = (request: ApprovalRequest) => boolean | Promise<boolean>;
export interface ExecutionTrace {
    readonly sequence: number;
    readonly taskId: string;
    readonly sessionId: string;
    readonly elapsedMs: number;
    readonly type: 'state' | 'plan' | 'selection' | 'outcome' | 'retry';
    readonly status?: RudraTaskStatus;
    readonly stepId?: string;
    readonly botId?: string;
    readonly capability?: string;
    readonly attempt?: number;
    readonly decision?: 'validated-plan' | 'capability-then-bot-id' | 'retry-bot-error';
    readonly outcome?: 'completed' | 'failed' | 'cancelled' | 'timed-out';
    readonly error?: { readonly code: string; readonly message: string };
}
export interface RudraHooks {
    readonly planner?: Planner;
    readonly approve?: ApprovalHandler;
    /** Observers cannot approve work or change its outcome; thrown/rejected errors are isolated. */
    readonly onTrace?: (entry: ExecutionTrace) => void | Promise<void>;
}
export type RudraResult = {
    readonly taskId: string;
    /** Successful steps in plan order, including partial results after a failure. */
    readonly outputs: readonly StepOutput[];
    readonly trace: readonly ExecutionTrace[];
} & (
    | { readonly status: 'completed' }
    | { readonly status: 'failed' | 'cancelled'; readonly error: RudraErrorDetails }
);
