import { MemoryEngine, NodeFileMemoryAdapter } from 'shivax/memory';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Exclusive temporary directory owned by this example; never writes application files.
const directory = await fs.mkdtemp(join(tmpdir(), 'shivax-sdk-memory-'));
const path = join(directory, 'memory.json');
const namespace = { principalId: 'demo', issuer: 'local-demo', sessionId: 'demo', scopeKind: 'personal', scopeId: 'demo' };
const signal = new AbortController().signal;
try {
    await new MemoryEngine({ persistence: new NodeFileMemoryAdapter({ fs, path }) }).save(namespace, { id: 'example', category: 'working', value: 'persisted' }, signal);
    const reopened = new MemoryEngine({ persistence: new NodeFileMemoryAdapter({ fs, path }) });
    console.log((await reopened.retrieve(namespace, 'example', signal)).value);
} finally { await fs.unlink(path).catch(() => {}); await fs.rmdir(directory); }
