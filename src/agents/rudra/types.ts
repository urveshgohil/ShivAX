import type { BotInput, BotSignal, BotValue, Capability, TaskContext } from '../types.js';
import type { Vijay } from '../../security/vijay.js';

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
    /** Recalled data is never an instruction, permission grant, or replacement task input. */
    readonly memory?: { readonly trust: 'untrusted'; readonly data: BotValue };
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
    | 'security-denied'
    | 'memory-error'
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
    readonly type: 'state' | 'plan' | 'selection' | 'outcome' | 'retry' | 'memory';
    readonly memoryAction?: 'recall' | 'record';
    readonly status?: RudraTaskStatus;
    readonly stepId?: string;
    readonly botId?: string;
    readonly capability?: string;
    readonly attempt?: number;
    /**
     * `capability-then-bot-id`: the deterministic rule (first registered bot by ID).
     * `routing-policy`: an approved routing hook chose among the eligible bots.
     * `routing-policy-rejected`: the hook's answer was invalid, so the deterministic choice was used.
     */
    readonly decision?: 'validated-plan' | 'capability-then-bot-id' | 'routing-policy' | 'routing-policy-rejected' | 'retry-bot-error';
    readonly outcome?: 'completed' | 'failed' | 'cancelled' | 'timed-out';
    readonly error?: { readonly code: string; readonly message: string };
}
/** What an optional routing hook sees: the step and the bots RUDRA already found for its capability. */
export interface RoutingSelectionRequest {
    readonly taskId: string;
    readonly stepId: string;
    readonly capability: string;
    /** Registered bots offering the capability, in bot-ID order. Only these can be chosen. */
    readonly candidates: readonly string[];
    /** The deterministic choice (`candidates[0]`), used whenever the hook returns null or an invalid answer. */
    readonly baseline: string;
}
/**
 * Optional, synchronous, trusted host routing (for example an approved SARASWATI routing policy).
 * It can only choose among `candidates`; it cannot add bots, capabilities, permissions or steps,
 * and Vijay, the firewall and approval still check the chosen bot. Return null to keep the baseline.
 */
export interface RudraRoutingHook {
    select(request: RoutingSelectionRequest): string | null;
}
export interface RudraHooks {
    /** Mandatory for protected tool-using bots. Pure legacy workflows may omit it. */
    readonly security?: Vijay;
    /** Optional opt-in routing among eligible bots. Absent: deterministic capability-then-bot-ID routing. */
    readonly routing?: RudraRoutingHook;
    readonly planner?: Planner;
    readonly approve?: ApprovalHandler;
    /** Observers cannot approve work or change its outcome; thrown/rejected errors are isolated. */
    readonly onTrace?: (entry: ExecutionTrace) => void | Promise<void>;
    readonly memory?: RudraMemoryHooks;
}
export interface RudraMemoryExecution {
    readonly signal: BotSignal;
    readonly timeoutMs: number;
    checkExecution(): void;
    consumeStep(): void;
    onApproval(waiting: boolean): void;
    trackTool(callback: () => Promise<BotValue>): Promise<BotValue>;
}
export interface RudraMemorySummary {
    readonly status: 'completed' | 'failed';
    readonly completedSteps: number;
    readonly errorCode?: RudraErrorCode;
}
/** Trusted optional integration; protected persistence still requires the configured security guard. */
export interface RudraMemoryHooks {
    recall?(context: TaskContext, execution: RudraMemoryExecution): Promise<BotValue>;
    record?(context: TaskContext, summary: RudraMemorySummary, execution: RudraMemoryExecution): Promise<void>;
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
