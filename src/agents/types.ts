import type { SLMSignal } from '../slm/provider.js';
import type { BotToolClient } from '../security/types.js';

/** Plain, finite JSON data. Executable objects and platform resources are not task data. */
export type BotValue =
    null | boolean | number | string | readonly BotValue[] | { readonly [key: string]: BotValue };
export type BotSignal = SLMSignal;
export interface Capability {
    readonly id: string;
    readonly description: string;
    readonly inputSchema?: BotValue;
    readonly requiredTools?: readonly ToolDescriptor[];
}
/** Informational only: this phase does not execute tools. */
export interface ToolDescriptor {
    readonly id: string;
    readonly description: string;
}
export interface CallerIdentity {
    readonly id: string;
    readonly issuer: string;
}
/** Supplied by a trusted host; the foundation does not authenticate these claims. */
export interface SecurityContext {
    readonly caller: CallerIdentity;
    readonly scope: { readonly kind: 'company' | 'personal'; readonly id: string };
    readonly toolPermissions: readonly string[];
}
export interface BotInput<T extends BotValue = BotValue> {
    readonly capability: string;
    readonly data: T;
}
/** Named BotTask at the package root to preserve the existing neural-network Task type. */
export interface BotTask {
    /** Omitted requests use version 1; unsupported versions fail validation. */
    readonly version?: 1;
    readonly id: string;
    readonly input: BotInput;
    readonly metadata?: Readonly<Record<string, BotValue>>;
}
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed-out';
export interface ExecutionLimits {
    readonly timeoutMs: number;
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
}
export interface TaskContextOptions {
    readonly sessionId: string;
    readonly security: SecurityContext;
    readonly signal: BotSignal;
    readonly limits?: Partial<ExecutionLimits>;
}
export interface TaskContext {
    readonly version: 1;
    readonly taskId: string;
    readonly sessionId: string;
    readonly input: BotInput;
    readonly metadata: Readonly<Record<string, BotValue>>;
    readonly security: SecurityContext;
    readonly signal: BotSignal;
    readonly limits: ExecutionLimits;
}
export interface BotContext {
    readonly task: TaskContext;
    /** Available only for a Vijay-secured invocation. It cannot alter identity or policy. */
    readonly tools?: BotToolClient;
}
export type BotErrorCode =
    | 'invalid-bot'
    | 'duplicate-bot'
    | 'invalid-context'
    | 'invalid-input'
    | 'invalid-output'
    | 'invalid-event'
    | 'unsupported-capability'
    | 'tool-not-allowed'
    | 'busy'
    | 'bot-error'
    | 'unavailable'
    | 'provider-error'
    | 'cancelled'
    | 'timeout';
export interface BotErrorDetails {
    readonly code: BotErrorCode;
    readonly message: string;
}
interface ResultIdentity {
    readonly taskId: string;
    readonly botId: string;
}
export type BotResult<T extends BotValue = BotValue> = ResultIdentity &
    (
        | { readonly status: 'completed'; readonly data: T }
        | { readonly status: 'failed' | 'cancelled' | 'timed-out'; readonly error: BotErrorDetails }
    );
/** Validators are synchronous predicates; execute is trusted application code, not sandboxed. */
export interface Bot<I extends BotValue = BotValue, O extends BotValue = BotValue> {
    readonly id: string;
    readonly capabilities: readonly Capability[];
    readonly requiredTools?: readonly ToolDescriptor[];
    validateInput(input: BotInput): input is BotInput<I>;
    validateOutput(data: BotValue, capability: string): data is O;
    execute(input: BotInput<I>, context: BotContext): BotResult<O> | Promise<BotResult<O>>;
}
export interface BotEventIdentity {
    readonly botId: string;
    readonly taskId: string;
    readonly sessionId: string;
}
export interface BotEventMap {
    'bot:registered': { readonly botId: string };
    'bot:unregistered': { readonly botId: string };
    'bot:started': BotEventIdentity;
    'bot:completed': BotEventIdentity;
    'bot:failed': BotEventIdentity & { readonly error: BotErrorDetails };
    'bot:cancelled': BotEventIdentity & { readonly error: BotErrorDetails };
    'bot:timed-out': BotEventIdentity & { readonly error: BotErrorDetails };
}
export type BotEventType = keyof BotEventMap;
export type BotEventListener<K extends BotEventType> = (
    event: BotEventMap[K]
) => void | Promise<void>;
