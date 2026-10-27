import type { BotSignal, BotValue } from '../agents/types.js';
import type { MemoryNamespace } from '../bots/storage.js';
import type { MemoryPersistence, MemoryTransaction } from './types.js';
import { check, json, namespace, namespaceKey, object, integer } from './validation.js';
import { MemoryError, memoryError } from './errors.js';

/** Share this adapter instance between engines to serialize updates to its namespace snapshots. */
export class InMemoryMemoryAdapter implements MemoryPersistence {
    readonly #entries = new Map<string, BotValue>();
    readonly #maxNamespaces: number;
    readonly #maxTotalBytes: number;
    readonly #sizes = new Map<string, number>();
    #bytes = 0;
    #busy = false;
    constructor(options: { maxNamespaces?: number; maxTotalBytes?: number } = {}) {
        this.#maxNamespaces = options.maxNamespaces ?? 128;
        this.#maxTotalBytes = options.maxTotalBytes ?? 8_388_608;
        integer(this.#maxNamespaces, 4096, 1);
        integer(this.#maxTotalBytes, 67_108_864, 1);
    }
    async transact<T>(
        ns: MemoryNamespace,
        change: (stored: unknown) => MemoryTransaction<T>,
        signal: BotSignal
    ): Promise<T> {
        check(signal);
        if (this.#busy) throw new MemoryError('busy');
        this.#busy = true;
        try {
            const key = namespaceKey(namespace(ns)),
                result = change(this.#entries.get(key) ?? null);
            check(signal);
            if (result.remove) {
                this.#entries.delete(key);
                this.#bytes -= this.#sizes.get(key) ?? 0;
                this.#sizes.delete(key);
            } else if (result.write !== undefined) {
                const safe = json(result.write, 1_048_576),
                    size = new TextEncoder().encode(JSON.stringify(safe) + key).byteLength;
                if (
                    (!this.#entries.has(key) && this.#entries.size >= this.#maxNamespaces) ||
                    this.#bytes - (this.#sizes.get(key) ?? 0) + size > this.#maxTotalBytes
                )
                    throw new MemoryError('capacity');
                this.#bytes += size - (this.#sizes.get(key) ?? 0);
                this.#sizes.set(key, size);
                this.#entries.set(key, safe);
            }
            return result.result;
        } finally {
            this.#busy = false;
        }
    }
}

/** Native node:fs/promises satisfies this interface. The host imports it only when needed. */
export interface MemoryFileSystem {
    stat(path: string): Promise<{ readonly size: number }>;
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    open(
        path: string,
        flags: 'wx',
        mode: number
    ): Promise<{
        writeFile(data: string, encoding: 'utf8'): Promise<unknown>;
        close(): Promise<void>;
    }>;
    rename(from: string, to: string): Promise<unknown>;
    unlink(path: string): Promise<unknown>;
}
export interface NodeFileMemoryOptions {
    readonly path: string;
    readonly fs: MemoryFileSystem;
    readonly maxFileBytes?: number;
}
/** One explicit absolute file and exclusive temporary sibling; no path input is accepted from tasks. */
export class NodeFileMemoryAdapter implements MemoryPersistence {
    readonly #path: string;
    readonly #fs: MemoryFileSystem;
    readonly #maxBytes: number;
    #busy = false;
    constructor(options: NodeFileMemoryOptions) {
        if (
            typeof options.path !== 'string' ||
            !/^(?:[A-Za-z]:[\\/]|\/)/.test(options.path) ||
            /[\x00-\x1f]/.test(options.path)
        )
            throw new MemoryError('invalid-input');
        this.#path = options.path;
        this.#maxBytes = options.maxFileBytes ?? 4_194_304;
        integer(this.#maxBytes, 16_777_216, 1);
        this.#fs = Object.freeze({
            stat: options.fs.stat.bind(options.fs),
            readFile: options.fs.readFile.bind(options.fs),
            open: options.fs.open.bind(options.fs),
            rename: options.fs.rename.bind(options.fs),
            unlink: options.fs.unlink.bind(options.fs),
        });
    }
    async transact<T>(
        ns: MemoryNamespace,
        change: (stored: unknown) => MemoryTransaction<T>,
        signal: BotSignal
    ): Promise<T> {
        check(signal);
        if (this.#busy) throw new MemoryError('busy');
        this.#busy = true;
        const temporary = `${this.#path}.pending`;
        let created = false;
        try {
            const key = namespaceKey(namespace(ns));
            let text: string | null;
            try {
                if ((await this.#fs.stat(this.#path)).size > this.#maxBytes)
                    throw new MemoryError('capacity');
                check(signal);
                text = await this.#fs.readFile(this.#path, 'utf8');
            } catch (error) {
                if ((error as { code?: string })?.code === 'ENOENT') text = null;
                else throw error;
            }
            check(signal);
            let entries: Record<string, unknown> = Object.create(null);
            if (text !== null) {
                if (new TextEncoder().encode(text).byteLength > this.#maxBytes)
                    throw new MemoryError('capacity');
                let parsed: unknown;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    throw new MemoryError('corrupt-record');
                }
                try {
                    const envelope = object(parsed, ['version', 'entries']);
                    if (envelope.version !== 1) throw new MemoryError('corrupt-record');
                    entries = object(envelope.entries);
                } catch {
                    throw new MemoryError('corrupt-record');
                }
            }
            const result = change(
                Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null
            );
            check(signal);
            if (result.write !== undefined || result.remove) {
                const updated = Object.assign(Object.create(null), entries);
                if (result.remove) delete updated[key];
                else updated[key] = result.write;
                const next = JSON.stringify({ version: 1, entries: updated });
                if (
                    Object.keys(updated).length > 256 ||
                    new TextEncoder().encode(next).byteLength > this.#maxBytes
                )
                    throw new MemoryError('capacity');
                const file = await this.#fs.open(temporary, 'wx', 0o600);
                created = true;
                try {
                    await file.writeFile(next, 'utf8');
                } finally {
                    await file.close();
                }
                check(signal);
                await this.#fs.rename(temporary, this.#path);
                created = false;
            }
            return result.result;
        } catch (error) {
            throw signal.aborted ? new MemoryError('cancelled') : memoryError(error);
        } finally {
            if (created)
                try {
                    await this.#fs.unlink(temporary);
                } catch {
                    /* A failed cleanup contains no task data in its error. */
                }
            this.#busy = false;
        }
    }
}

export interface IndexedDBMemoryOptions {
    readonly database: string;
    /** Optional factory injection. Called at first operation; keeps DOM types out of public contracts. */
    readonly factory?: () => unknown;
}
/** One object store, one namespace envelope per key. Native readwrite transactions serialize writers. */
export class IndexedDBMemoryAdapter implements MemoryPersistence {
    readonly #name: string;
    readonly #factory: () => unknown;
    #database?: Promise<IDBDatabase>;
    constructor(options: IndexedDBMemoryOptions) {
        if (
            typeof options.database !== 'string' ||
            !options.database.trim() ||
            options.database.length > 128
        )
            throw new MemoryError('invalid-input');
        this.#name = options.database;
        this.#factory = options.factory ?? (() => globalThis.indexedDB);
    }
    private open(): Promise<IDBDatabase> {
        if (!this.#database) {
            const pending = new Promise<IDBDatabase>((resolve, reject) => {
                try {
                    const factory = this.#factory() as IDBFactory;
                    if (!factory || typeof factory.open !== 'function')
                        throw new MemoryError('unavailable');
                    const request = factory.open(this.#name, 1);
                    let abandoned = false;
                    request.onupgradeneeded = () => {
                        if (!request.result.objectStoreNames.contains('records'))
                            request.result.createObjectStore('records');
                    };
                    request.onerror = () => reject(new MemoryError('storage-error'));
                    request.onblocked = () => {
                        abandoned = true;
                        reject(new MemoryError('busy'));
                    };
                    request.onsuccess = () => {
                        if (abandoned) {
                            request.result.close();
                            return;
                        }
                        request.result.onversionchange = () => {
                            request.result.close();
                            this.#database = undefined;
                        };
                        resolve(request.result);
                    };
                } catch (error) {
                    reject(memoryError(error));
                }
            });
            this.#database = pending;
            void pending.catch(() => {
                if (this.#database === pending) this.#database = undefined;
            });
        }
        return this.#database;
    }
    async transact<T>(
        ns: MemoryNamespace,
        change: (stored: unknown) => MemoryTransaction<T>,
        signal: BotSignal
    ): Promise<T> {
        check(signal);
        const key = namespaceKey(namespace(ns)),
            database = await this.open();
        check(signal);
        return new Promise<T>((resolve, reject) => {
            const transaction = database.transaction('records', 'readwrite');
            let result: T, failure: unknown;
            const abort = () => {
                try {
                    transaction.abort();
                } catch {
                    /* Already committed. */
                }
            };
            signal.addEventListener('abort', abort, { once: true });
            const cleanup = () => signal.removeEventListener('abort', abort);
            transaction.oncomplete = () => {
                cleanup();
                resolve(result);
            };
            transaction.onabort = () => {
                cleanup();
                reject(signal.aborted ? new MemoryError('cancelled') : memoryError(failure));
            };
            transaction.onerror = () => {
                /* onabort supplies the final outcome. */
            };
            const store = transaction.objectStore('records'),
                read = store.get(key);
            read.onsuccess = () => {
                try {
                    check(signal);
                    const changed = change(read.result ?? null);
                    check(signal);
                    result = changed.result;
                    if (changed.remove) store.delete(key);
                    else if (changed.write !== undefined) store.put(changed.write, key);
                } catch (error) {
                    failure = error;
                    abort();
                }
            };
            if (signal.aborted) abort();
        });
    }
    async close(): Promise<void> {
        const db = this.#database;
        this.#database = undefined;
        if (db) (await db).close();
    }
}
