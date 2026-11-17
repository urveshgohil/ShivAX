import { NON_RETRYABLE } from '../../security/errors.js';
import type { HanumanFetchErrorCode } from './types.js';

/** Only these may succeed on a fresh, re-authorized attempt; every other code is deterministic. */
const transient: ReadonlySet<HanumanFetchErrorCode> = new Set(['timeout', 'transport-error']);

export class HanumanFetchError extends Error {
    constructor(readonly code: HanumanFetchErrorCode) {
        super('Protected retrieval failed.');
        this.name = 'HanumanFetchError';
        if (!transient.has(code)) Object.defineProperty(this, NON_RETRYABLE, { value: true });
    }
}
