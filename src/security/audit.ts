import type { SecurityDecision } from './types.js';

/** Bounded in-memory audit ring. Host may persist snapshots through its own narrow service. */
export class SecurityAuditLog {
    #records: SecurityDecision[] = [];
    #sequence = 0;
    #operation = 0;
    readonly #capacity: number;
    constructor(capacity = 256) {
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096)
            throw new RangeError('Invalid audit capacity.');
        this.#capacity = capacity;
    }
    /** Host/internal writer. Never expose this object to bots. */
    record(operation: number, entry: Omit<SecurityDecision, 'sequence' | 'operation'>): void {
        this.#records.push(Object.freeze({ ...entry, operation, sequence: ++this.#sequence }));
        if (this.#records.length > this.#capacity) this.#records.shift();
    }
    begin(): number {
        return ++this.#operation;
    }
    list(): readonly SecurityDecision[] {
        return Object.freeze(this.#records.slice());
    }
}
