/** IndexedDB protocol fixture, not a browser implementation or live browser test. */
export function memoryIDBFixture() {
    const databases = new Map();
    let opens = 0,
        closes = 0;
    const factory = {
        open(name) {
            opens++;
            const request = {};
            setImmediate(() => {
                const fresh = !databases.has(name);
                if (fresh) databases.set(name, new Map());
                const records = databases.get(name);
                const db = {
                    objectStoreNames: { contains: () => !fresh },
                    createObjectStore() {},
                    close() {
                        closes++;
                    },
                    transaction() {
                        let aborted = false;
                        const writes = [];
                        const transaction = {
                            abort() {
                                if (aborted) return;
                                aborted = true;
                                setImmediate(() => transaction.onabort?.());
                            },
                            objectStore() {
                                return {
                                    get(key) {
                                        const read = {};
                                        setImmediate(() => {
                                            if (aborted) return;
                                            read.result = structuredClone(records.get(key));
                                            read.onsuccess?.();
                                            setImmediate(() => {
                                                if (aborted) return;
                                                for (const [id, value, remove] of writes) {
                                                    if (remove) records.delete(id);
                                                    else records.set(id, value);
                                                }
                                                transaction.oncomplete?.();
                                            });
                                        });
                                        return read;
                                    },
                                    put(value, key) {
                                        writes.push([key, structuredClone(value)]);
                                    },
                                    delete(key) {
                                        writes.push([key, undefined, true]);
                                    },
                                };
                            },
                        };
                        return transaction;
                    },
                };
                request.result = db;
                if (fresh) request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request;
        },
    };
    return {
        factory,
        databases,
        get opens() {
            return opens;
        },
        get closes() {
            return closes;
        },
    };
}
