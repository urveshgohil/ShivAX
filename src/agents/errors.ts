import type { BotErrorCode, BotErrorDetails } from './types.js';

const messages: Record<BotErrorCode, string> = {
    'invalid-bot': 'Invalid bot descriptor.',
    'duplicate-bot': 'Bot ID is already registered.',
    'invalid-context': 'Invalid host task context.',
    'invalid-input': 'Invalid bot input.',
    'invalid-output': 'Invalid bot result.',
    'invalid-event': 'Invalid bot lifecycle event.',
    'unsupported-capability': 'Bot does not support this capability.',
    'tool-not-allowed': 'Required tool permission was not supplied by the host.',
    busy: 'Bot already has an active execution in this executor.',
    'bot-error': 'Bot execution failed.',
    unavailable: 'The required adapter or service is not configured.',
    'provider-error': 'The configured specialist provider failed.',
    cancelled: 'Bot execution cancelled.',
    timeout: 'Bot execution deadline exceeded.',
};
/** Fixed messages exclude payloads, abort reasons and backend exception details. */
export class BotError extends Error {
    constructor(public readonly code: BotErrorCode) {
        if (!isErrorCode(code)) throw new TypeError('Unknown bot error code');
        super(messages[code]);
        this.name = 'BotError';
    }
}
export function errorDetails(code: BotErrorCode): BotErrorDetails {
    return Object.freeze({ code, message: messages[code] });
}
export function isErrorCode(value: unknown): value is BotErrorCode {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(messages, value);
}
