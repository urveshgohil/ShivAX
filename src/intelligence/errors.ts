import type { ModelErrorCode, ModelErrorDetails, ModelFailureReason, ModelUsage } from './types.js';
const messages: Record<ModelErrorCode, string> = {
    'token-limit-exceeded': 'Inference token budget exceeded.',
    'cost-limit-exceeded': 'Inference cost budget exceeded.',
    'invalid-provider-output': 'Model response failed validation.',
    'usage-unverifiable': 'Provider usage could not be verified.',
    'provider-timeout': 'Model inference deadline exceeded.',
    'invalid-provider': 'Invalid model provider configuration.',
    'duplicate-provider': 'Model provider ID is already registered.',
    'invalid-input': 'Invalid model inference input or limits.',
    'invalid-output': 'Model response failed validation.',
    'missing-provider': 'No compatible model provider is registered.',
    'provider-error': 'Model provider execution failed.',
    unavailable: 'Model provider is unavailable.',
    'provider-denied': 'Model transport is denied by policy.',
    'remote-disabled': 'Remote inference requires explicit host permission.',
    'call-limit': 'Inference call budget exhausted.',
    'token-limit': 'Inference token budget exceeded.',
    'cost-limit': 'Inference cost budget exceeded.',
    'usage-limit': 'Provider reported usage beyond its reservation.',
    timeout: 'Model inference deadline exceeded.',
    cancelled: 'Model inference cancelled.',
    busy: 'Model router still has active work.',
    disposed: 'Model router is disposed.',
    disabled: 'Model inference is disabled.',
    'scope-mismatch': 'Model inference scope does not match the router scope.',
};
const aliases: Partial<Record<ModelErrorCode, ModelErrorCode>> = {
    'token-limit-exceeded': 'token-limit',
    'cost-limit-exceeded': 'cost-limit',
    'invalid-provider-output': 'invalid-output',
    'provider-timeout': 'timeout',
};
const reasons: Partial<Record<ModelErrorCode, ModelFailureReason>> = {
    'token-limit': 'token-limit-exceeded',
    'cost-limit': 'cost-limit-exceeded',
    'invalid-output': 'invalid-provider-output',
    'usage-unverifiable': 'usage-unverifiable',
    timeout: 'provider-timeout',
};
export class ModelError extends Error {
    readonly code: ModelErrorCode;
    readonly reason?: ModelFailureReason;
    constructor(code: ModelErrorCode, reason?: ModelFailureReason) {
        const safe = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'provider-error';
        const canonical = Object.prototype.hasOwnProperty.call(aliases, safe)
            ? aliases[safe]!
            : safe;
        super(messages[canonical]);
        this.name = 'ModelError';
        this.code = canonical;
        this.reason =
            canonical === 'usage-limit' &&
            (reason === 'token-limit-exceeded' || reason === 'cost-limit-exceeded')
                ? reason
                : reasons[canonical];
    }
}
/** Internal adapter handoff: retain usage when generated JSON itself is malformed. */
export class ProviderOutputError extends ModelError {
    constructor(readonly usage: ModelUsage) {
        super('invalid-output');
    }
}
export function modelError(
    error: unknown,
    fallback: ModelErrorCode = 'provider-error'
): ModelError {
    const descriptor =
        error instanceof ModelError ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    const reason =
        error instanceof ModelError ? Object.getOwnPropertyDescriptor(error, 'reason') : undefined;
    return new ModelError(
        descriptor &&
            'value' in descriptor &&
            typeof descriptor.value === 'string' &&
            Object.prototype.hasOwnProperty.call(messages, descriptor.value)
            ? (descriptor.value as ModelErrorCode)
            : fallback,
        reason && 'value' in reason ? reason.value : undefined
    );
}
export function modelDetails(error: ModelError): ModelErrorDetails {
    const safe = modelError(error);
    return Object.freeze({
        code: safe.code,
        message: safe.message,
        ...(safe.reason ? { reason: safe.reason } : {}),
    });
}
