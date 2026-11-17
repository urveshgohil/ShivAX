import type { HanumanFetchErrorCode } from './types.js';

export class HanumanFetchError extends Error {
    constructor(readonly code: HanumanFetchErrorCode) {
        super('Protected retrieval failed.');
        this.name = 'HanumanFetchError';
    }
}
