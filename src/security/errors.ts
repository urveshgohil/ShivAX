import type { SecurityErrorCode } from './types.js';

const messages: Record<SecurityErrorCode, string> = {
    unauthenticated: 'An authenticated host context is required.',
    'invalid-identity': 'The host identity is invalid.',
    'expired-session': 'The authenticated session has expired.',
    'revoked-session': 'The authenticated session is no longer valid.',
    'invalid-policy': 'Invalid permission policy.',
    'duplicate-policy': 'Permission policy already registered.',
    'policy-missing': 'No permission policy permits this action.',
    'permission-denied': 'Required permissions are missing.',
    'invalid-tool': 'Invalid protected tool.',
    'duplicate-tool': 'Protected tool already registered.',
    'tool-denied': 'Tool access is denied.',
    'invalid-input': 'Security input validation failed.',
    'invalid-output': 'Protected tool output validation failed.',
    'approval-required': 'Explicit host approval is required.',
    'approval-denied': 'Host approval was denied.',
    'approval-error': 'Host approval failed.',
    'policy-changed': 'The authorization policy changed during the operation.',
    'effect-denied': 'A read-only capability cannot invoke a state-changing tool.',
    cancelled: 'Security operation cancelled.',
    'tool-error': 'Protected tool failed.',
    'tool-busy': 'A tool operation is already in progress.',
    'tool-limit': 'The tool call limit was exceeded.',
};
export function isSecurityErrorCode(value: unknown): value is SecurityErrorCode {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(messages, value);
}
export class SecurityError extends Error {
    constructor(public readonly code: SecurityErrorCode) {
        if (!Object.prototype.hasOwnProperty.call(messages, code))
            throw new TypeError('Invalid security error code.');
        super(messages[code]);
        this.name = 'SecurityError';
    }
}
export function securityError(error: unknown, fallback: SecurityErrorCode): SecurityError {
    const descriptor =
        error instanceof SecurityError ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    const code = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return new SecurityError(
        typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
            ? (code as SecurityErrorCode)
            : fallback
    );
}
