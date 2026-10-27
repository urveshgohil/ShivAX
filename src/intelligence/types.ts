import type { BotValue } from '../agents/types.js';
import type { SpecialistProviderContext } from '../bots/types.js';
import type { SpecialistSchema } from '../bots/schema.js';

export type ModelCapability =
    | 'text-reasoning'
    | 'code-generation'
    | 'visual-interpretation'
    | 'numeric-inference'
    | 'deterministic-validation';
export interface ModelPricing {
    readonly inputTokenUSD: number;
    readonly outputTokenUSD: number;
    readonly callUSD: number;
}
export interface ModelProviderDescriptor {
    readonly id: string;
    readonly capabilities: readonly ModelCapability[];
    readonly locality: 'in-process' | 'local' | 'remote';
    /** Token-free providers reserve zero tokens; their byte and call limits still apply. */
    readonly tokenBased: boolean;
    readonly pricing: ModelPricing;
}
export interface ModelRequest {
    readonly capability: ModelCapability;
    readonly input: BotValue;
    readonly schema: SpecialistSchema;
    readonly context: SpecialistProviderContext;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxCostUSD: number;
    /** Check the absolute deadline immediately before an adapter starts another operation. */
    checkExecution(): void;
}
/** Null means unreported, never zero. The router retains the full reservation either way. */
export interface ModelUsage {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly costUSD: number | null;
}
export interface ModelResponse {
    readonly data: BotValue;
    readonly usage: ModelUsage;
}
/** Implementations and pricing are trusted host code. Model responses are untrusted data. */
export interface ModelProvider extends ModelProviderDescriptor {
    infer(request: ModelRequest): unknown | Promise<unknown>;
}
export interface ModelOutputContract {
    readonly schema: SpecialistSchema;
    /** Optional synchronous semantic check, in addition to the schema. Must return literal true. */
    validate?(value: BotValue): boolean;
}
export interface ModelInference {
    readonly capability: ModelCapability;
    readonly input: BotValue;
    readonly output: ModelOutputContract;
    readonly context: SpecialistProviderContext;
}
export interface ModelLimits {
    /** Lifetime limits per router instance. Failed attempts also consume reservations. */
    readonly maxCalls: number;
    readonly maxTokens: number;
    readonly maxCostUSD: number;
    /** Per inference, including all fallback attempts. */
    readonly timeoutMs: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
}
export interface ModelRoutingOptions {
    readonly providerId?: string;
    readonly allowFallback?: boolean;
    readonly allowRemote?: boolean;
}
export type ModelErrorCode =
    | 'invalid-provider'
    | 'duplicate-provider'
    | 'invalid-input'
    | 'invalid-output'
    | 'missing-provider'
    | 'provider-error'
    | 'unavailable'
    | 'remote-disabled'
    | 'call-limit'
    | 'token-limit'
    | 'cost-limit'
    | 'usage-limit'
    | 'timeout'
    | 'cancelled'
    | 'busy'
    | 'disposed'
    | 'disabled'
    | 'scope-mismatch';
export interface ModelErrorDetails {
    readonly code: ModelErrorCode;
    readonly message: string;
}
export interface ModelAttempt {
    readonly providerId: string;
    readonly outcome: 'completed' | 'failed';
    readonly reservedTokens: number;
    readonly reservedCostUSD: number;
    readonly usage?: ModelUsage;
    readonly error?: ModelErrorDetails;
}
export interface ModelBudgetUsage {
    readonly calls: number;
    readonly reservedTokens: number;
    readonly reservedCostUSD: number;
}
export type ModelResult =
    | {
          readonly status: 'completed';
          readonly providerId: string;
          readonly data: BotValue;
          readonly usage: ModelUsage;
          readonly attempts: readonly ModelAttempt[];
      }
    | {
          readonly status: 'failed' | 'cancelled';
          readonly error: ModelErrorDetails;
          readonly attempts: readonly ModelAttempt[];
      };
