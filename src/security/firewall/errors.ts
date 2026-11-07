import type { FirewallErrorCode } from './types.js';

const codes: readonly FirewallErrorCode[] = [
    'invalid-configuration',
    'invalid-policy',
    'unauthorized',
    'version-conflict',
    'policy-unavailable',
    'denied',
    'lockdown',
    'revoked',
    'cancelled',
    'timeout',
    'resource-limit',
    'audit-unavailable',
    'operation-failed',
];
/** Fixed diagnostics. Never copies an adapter exception, input or credential. */
export class FirewallError extends Error {
    constructor(public readonly code: FirewallErrorCode) {
        if (!codes.includes(code)) throw new TypeError('Invalid firewall error code.');
        super('ShivAX firewall: ' + code + '.');
        this.name = 'FirewallError';
        Object.freeze(this);
    }
}
export function failure(error: unknown, fallback: FirewallErrorCode): FirewallError {
    return error instanceof FirewallError
        ? new FirewallError(error.code)
        : new FirewallError(fallback);
}
