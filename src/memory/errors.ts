import type { MemoryErrorCode } from './types.js';
const messages: Record<MemoryErrorCode, string> = {
    'invalid-input': 'Invalid memory request.',
    'corrupt-record': 'Stored memory failed validation.',
    'duplicate-record': 'Memory record already exists.',
    'not-found': 'Memory record was not found.',
    conflict: 'Memory revision changed.',
    capacity: 'Memory capacity exceeded.',
    'privacy-denied': 'Memory content was rejected by the privacy policy.',
    'approval-required': 'Preference memory requires explicit host approval.',
    'verification-required': 'Outcome memory requires explicit host verification.',
    unavailable: 'Optional memory service is unavailable.',
    'storage-error': 'Memory storage failed.',
    'embedding-error': 'Memory embeddings failed validation.',
    cancelled: 'Memory operation cancelled.',
    busy: 'Memory adapter has an active transaction.',
};
export class MemoryError extends Error {
    constructor(readonly code: MemoryErrorCode) {
        super(
            typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
                ? messages[code]
                : messages['storage-error']
        );
        this.name = 'MemoryError';
    }
}
export function memoryError(
    error: unknown,
    fallback: MemoryErrorCode = 'storage-error'
): MemoryError {
    const field =
        error instanceof MemoryError ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return new MemoryError(
        field &&
            'value' in field &&
            typeof field.value === 'string' &&
            Object.prototype.hasOwnProperty.call(messages, field.value)
            ? (field.value as MemoryErrorCode)
            : fallback
    );
}
