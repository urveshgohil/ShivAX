import type { BotSignal } from '../agents/types.js';

/*
 * SARASWATI S04: storage contract for the durable model registry.
 *
 * ShivAX owns no database, directory or cloud bucket. The host supplies a store for one registry
 * (one tenant, one deployment slot), chosen by trusted host configuration, never by a request body.
 *
 * The store holds two kinds of data:
 *  - immutable objects, addressed by the SHA-256 of their exact text (`sha256:<hex>`);
 *  - one small mutable head record, replaced only by compare-and-swap on its revision number.
 * Every model, manifest, evaluation, approval and journal entry is an immutable object; the head
 * names the ones that are current. A crash between object writes and the head swap leaves only
 * unreferenced objects, which the registry ignores.
 */

export const MODEL_REGISTRY_ERROR_CODES = Object.freeze([
    'invalid-input',
    'invalid-configuration',
    'unauthorized',
    'cross-tenant',
    'conflict',
    'busy',
    'invalid-transition',
    'evidence-rejected',
    'stale-evidence',
    'stale-approval',
    'invalid-approval',
    'incompatible-model',
    'lockdown',
    'firewall-unavailable',
    'registry-missing',
    'registry-exists',
    'corrupt-registry',
    'object-missing',
    'checksum-mismatch',
    'storage-unavailable',
    'capacity',
    'cancelled',
    'timeout',
    'closed',
] as const);
export type ModelRegistryErrorCode = (typeof MODEL_REGISTRY_ERROR_CODES)[number];

/**
 * `outcome` is `unknown` only when the head swap was still in flight at cancellation or timeout;
 * the registry resolves it on its next operation by reading the head and its operation id.
 * Messages never contain storage errors, paths, actor references or model data.
 */
export class ModelRegistryError extends Error {
    readonly code: ModelRegistryErrorCode;
    readonly outcome: 'not-committed' | 'unknown';
    /** Reason codes for `evidence-rejected` (benchmark gate reasons or evidence binding problems). */
    readonly reasons: readonly string[];
    constructor(code: ModelRegistryErrorCode, message?: string, options: { outcome?: 'not-committed' | 'unknown'; reasons?: readonly string[] } = {}) {
        super(message ?? `Model registry error: ${code}.`);
        this.name = 'ModelRegistryError';
        this.code = code;
        this.outcome = options.outcome ?? 'not-committed';
        this.reasons = Object.freeze([...(options.reasons ?? [])]);
    }
}

/**
 * Host-supplied durable storage for one registry. Implementations must:
 *  - store and return object text byte-for-byte; `putObject` must be idempotent and must never leave a
 *    partially written object under a key (write to a temporary name, then rename or commit);
 *  - implement `compareAndSwapHead` atomically across every process that can write this registry
 *    (database transaction, conditional write, fenced lock), comparing against the revision of the
 *    head currently stored (0 when there is none);
 *  - call `check()` immediately before the durable write, after all of their own asynchronous
 *    preparation, and abort the write if it throws;
 *  - return `false` for a revision conflict, and throw for failures or unknown outcomes;
 *  - honour `signal` for reads and object writes;
 *  - never log object or head text (it can contain model weights and approval metadata).
 */
export interface ModelRegistryStore {
    putObject(key: string, text: string, signal: BotSignal): Promise<void>;
    /** The exact stored text, or null when absent. */
    getObject(key: string, signal: BotSignal): Promise<string | null>;
    /** The exact stored head text, or null when the registry has not been created. */
    readHead(signal: BotSignal): Promise<string | null>;
    compareAndSwapHead(
        expectedRevision: number,
        nextText: string,
        nextRevision: number,
        check: () => void,
        signal: BotSignal
    ): Promise<boolean>;
}

/** SHA-256 over UTF-8 text through Web Crypto (Node 22+ and browsers). Integrity only, not authenticity. */
export async function sha256Text(text: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (typeof subtle?.digest !== 'function')
        throw new ModelRegistryError('invalid-configuration', 'Web Crypto SHA-256 is unavailable.');
    const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return 'sha256:' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const KEY = /^sha256:[0-9a-f]{64}$/;

/**
 * Isolated in-memory reference store for tests, examples and single-process hosts that accept losing
 * state on exit. Each instance has its own maps; there is no global state. It does not survive restarts.
 */
export class InMemoryModelRegistryStore implements ModelRegistryStore {
    readonly #objects = new Map<string, string>();
    #head: { revision: number; text: string } | null = null;
    #bytes = 0;
    readonly #maxObjects: number;
    readonly #maxBytes: number;
    constructor(options: { readonly maxObjects?: number; readonly maxBytes?: number } = {}) {
        this.#maxObjects = options.maxObjects ?? 100_000;
        this.#maxBytes = options.maxBytes ?? 1_073_741_824;
        for (const [value, max] of [[this.#maxObjects, 10_000_000], [this.#maxBytes, 8_589_934_592]] as const)
            if (!Number.isSafeInteger(value) || value < 1 || value > max)
                throw new ModelRegistryError('invalid-configuration', 'Invalid in-memory store limits.');
    }
    async putObject(key: string, text: string, signal: BotSignal): Promise<void> {
        signal.throwIfAborted();
        if (typeof key !== 'string' || !KEY.test(key) || typeof text !== 'string') throw new ModelRegistryError('invalid-input');
        const existing = this.#objects.get(key);
        if (existing !== undefined) {
            // Content-addressed: the same key always means the same text. Never overwrite with something else.
            if (existing !== text) throw new ModelRegistryError('checksum-mismatch');
            return;
        }
        if (this.#objects.size >= this.#maxObjects || this.#bytes + text.length > this.#maxBytes)
            throw new ModelRegistryError('capacity');
        this.#objects.set(key, text);
        this.#bytes += text.length;
    }
    async getObject(key: string, signal: BotSignal): Promise<string | null> {
        signal.throwIfAborted();
        return this.#objects.get(key) ?? null;
    }
    async readHead(signal: BotSignal): Promise<string | null> {
        signal.throwIfAborted();
        return this.#head?.text ?? null;
    }
    async compareAndSwapHead(expectedRevision: number, nextText: string, nextRevision: number, check: () => void, signal: BotSignal): Promise<boolean> {
        signal.throwIfAborted();
        if (!Number.isSafeInteger(nextRevision) || nextRevision <= expectedRevision || typeof nextText !== 'string')
            throw new ModelRegistryError('invalid-input');
        if ((this.#head?.revision ?? 0) !== expectedRevision) return false;
        check(); // Last check, synchronously before the atomic replacement.
        this.#head = { revision: nextRevision, text: nextText };
        return true;
    }
}
