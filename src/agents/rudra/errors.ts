import type { RudraErrorCode, RudraErrorDetails } from './types.js';

const messages: Record<RudraErrorCode, string> = {
    'invalid-options': 'Invalid RUDRA host options.',
    'invalid-plan': 'Workflow proposal failed validation.',
    'planner-error': 'Planner failed.',
    'missing-capability': 'No registered bot provides the capability.',
    'capability-denied': 'Capability is outside the host allowlist.',
    'approval-denied': 'Host approval was denied.',
    'approval-error': 'Host approval failed.',
    'max-steps': 'Workflow execution step limit exceeded.',
    'output-limit': 'Workflow output budget exceeded.',
    'bot-failed': 'Selected bot failed.',
    timeout: 'Workflow deadline exceeded.',
    cancelled: 'Workflow cancelled.',
    busy: 'RUDRA still owns an active operation.',
    disposed: 'RUDRA is disposed.',
};
export class RudraError extends Error {
    constructor(public readonly code: RudraErrorCode) {
        if (!Object.prototype.hasOwnProperty.call(messages, code))
            throw new TypeError('Invalid RUDRA error code.');
        super(messages[code]);
        this.name = 'RudraError';
    }
}
export function details(code: RudraErrorCode): RudraErrorDetails {
    return Object.freeze({ code, message: messages[code] });
}
