import { MemoryEngine } from 'shivax';

// Explicit host-owned namespace; applications derive it from verified identities.
const namespace = {
    principalId: 'demo-user',
    issuer: 'local-demo',
    sessionId: 'demo-session',
    scopeKind: 'personal',
    scopeId: 'demo-workspace',
};
const signal = new AbortController().signal;
const memory = new MemoryEngine();
await memory.save(
    namespace,
    {
        id: 'ui-color',
        category: 'working',
        value: { color: 'blue' },
        metadata: { source: 'explicit-demo-input' },
        tags: ['ui'],
        ttlMs: 60_000,
    },
    signal
);
const updated = await memory.update(namespace, 'ui-color', { value: { color: 'green' } }, signal, {
    expectedRevision: 1,
});
const matches = await memory.search(namespace, { text: 'green', tags: ['ui'] }, signal);
const exported = await memory.export(namespace, signal);
const deleted = await memory.delete(namespace, 'ui-color', signal, 2);
console.log(
    JSON.stringify(
        {
            revision: updated.revision,
            matches: matches.map((match) => ({
                id: match.record.id,
                score: match.score,
                trust: match.record.trust,
            })),
            exportedRecords: exported.records.length,
            deleted,
            remaining: (await memory.list(namespace, {}, signal)).length,
        },
        null,
        2
    )
);
