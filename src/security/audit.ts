import type { SecurityDecision } from './types.js';
import { record } from '../agents/validation.js';
import { isSecurityErrorCode } from './errors.js';

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
        try {
            const value = record(entry, undefined, 'invalid-input');
            if (
                !Number.isSafeInteger(operation) ||
                operation < 1 ||
                !['authentication', 'capability', 'tool'].includes(value.kind as string) ||
                (value.actionId !== null &&
                    (typeof value.actionId !== 'string' ||
                        !value.actionId.trim() ||
                        value.actionId.length > 256)) ||
                !['allow', 'deny'].includes(value.decision as string) ||
                (value.decision === 'allow'
                    ? value.reason !== 'authorized'
                    : !isSecurityErrorCode(value.reason))
            )
                throw new TypeError();
            this.#records.push(
                Object.freeze({
                    operation,
                    sequence: ++this.#sequence,
                    kind: value.kind as SecurityDecision['kind'],
                    actionId: value.actionId as string | null,
                    decision: value.decision as SecurityDecision['decision'],
                    reason: value.reason as SecurityDecision['reason'],
                })
            );
        } catch {
            throw new TypeError('Invalid audit entry.');
        }
        if (this.#records.length > this.#capacity) this.#records.shift();
    }
    begin(): number {
        return ++this.#operation;
    }
    list(): readonly SecurityDecision[] {
        return Object.freeze(this.#records.slice());
    }
}
