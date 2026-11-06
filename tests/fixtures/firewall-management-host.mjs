// Test host only. No HTTP routes, credentials or production storage implementation.
import { open, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function filePolicyStore(directory, hooks = {}) {
    const file = join(directory, 'policy.json'), lock = join(directory, 'owner.lock');
    return {
        async provision(current) {
            await writeFile(file, JSON.stringify({ current, journal: current.history }), { flag: 'wx', mode: 0o600 });
        },
        async inspect() { return JSON.parse(await readFile(file, 'utf8')); },
        async replaceForTest(envelope) { await writeFile(file, JSON.stringify(envelope)); },
        async acquire(signal) {
            signal.throwIfAborted();
            const owner = await open(lock, 'wx', 0o600);
            let released = false;
            const assertOwnership = () => { if (released || hooks.lost) throw Error('test store ownership lost'); };
            return {
                assertOwnership,
                async load(signal) {
                    assertOwnership(); signal.throwIfAborted();
                    await hooks.beforeLoad?.();
                    return JSON.parse(await readFile(file, 'utf8')).current;
                },
                async commit(expected, next, check, signal) {
                    assertOwnership(); signal.throwIfAborted();
                    const current = JSON.parse(await readFile(file, 'utf8'));
                    if (current.current.version !== expected) return false;
                    const temporary = join(directory, 'pending-' + randomUUID() + '.json');
                    try {
                        const data = JSON.stringify({ current: next, journal: [...current.journal, next.history.at(-1)] });
                        const handle = await open(temporary, 'wx', 0o600);
                        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
                        await hooks.beforeCommit?.();
                        assertOwnership(); signal.throwIfAborted(); check();
                        await rename(temporary, file);
                        await hooks.afterCommit?.();
                        return true;
                    } finally {
                        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
                    }
                },
                async close() {
                    if (released) return;
                    released = true;
                    await owner.close(); await unlink(lock);
                },
            };
        },
    };
}
