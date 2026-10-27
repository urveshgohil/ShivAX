import type { ModelErrorCode, ModelErrorDetails } from './types.js';
const messages: Record<ModelErrorCode, string> = {
    'invalid-provider': 'Invalid model provider configuration.',
    'duplicate-provider': 'Model provider ID is already registered.',
    'invalid-input': 'Invalid model inference input or limits.',
    'invalid-output': 'Model response failed validation.',
    'missing-provider': 'No compatible model provider is registered.',
    'provider-error': 'Model provider execution failed.',
    unavailable: 'Model provider is unavailable.',
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
export class ModelError extends Error {
    constructor(readonly code: ModelErrorCode) {
        super(
            Object.prototype.hasOwnProperty.call(messages, code)
                ? messages[code]
                : messages['provider-error']
        );
        this.name = 'ModelError';
    }
}
export function modelError(
    error: unknown,
    fallback: ModelErrorCode = 'provider-error'
): ModelError {
    const descriptor =
        error instanceof ModelError ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return new ModelError(
        descriptor &&
            'value' in descriptor &&
            typeof descriptor.value === 'string' &&
            Object.prototype.hasOwnProperty.call(messages, descriptor.value)
            ? (descriptor.value as ModelErrorCode)
            : fallback
    );
}
export function modelDetails(error: ModelError): ModelErrorDetails {
    const safe = modelError(error);
    return Object.freeze({ code: safe.code, message: safe.message });
}
