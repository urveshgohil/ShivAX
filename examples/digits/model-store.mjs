/** Explicit local persistence; no automatic load. Each operation closes its DB. */
export class ModelStore {
    constructor(factory = globalThis.indexedDB) { this.factory = factory; this.queue = Promise.resolve(); }
    operation(mode, action) {
        const run = async () => {
            if (!this.factory) throw new Error('Browser storage is unavailable. Use JSON export/import instead.');
            const db = await new Promise((resolve,reject) => {
                const request = this.factory.open('shivax-digit-lab',1);
                let rejected = false;
                request.onupgradeneeded = () => request.result.createObjectStore('models');
                request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
                request.onerror = () => reject(new Error('Could not open browser storage.'));
                request.onblocked = () => { rejected = true; reject(new Error('Browser storage is blocked by another tab.')); };
            });
            try {
                return await new Promise((resolve,reject) => {
                    const transaction = db.transaction('models',mode);
                    let result;
                    const request = action(transaction.objectStore('models'));
                    request.onsuccess = () => { result = request.result; };
                    transaction.oncomplete = () => resolve(result);
                    transaction.onerror = transaction.onabort = () => reject(new Error('Browser storage operation failed; check available space and permissions.'));
                });
            } finally { db.close(); }
        };
        const result = this.queue.then(run);
        this.queue = result.catch(() => {});
        return result;
    }
    save(json) { return this.operation('readwrite',store => store.put(json,'saved-model')); }
    load() { return this.operation('readonly',store => store.get('saved-model')); }
    remove() { return this.operation('readwrite',store => store.delete('saved-model')); }
}
