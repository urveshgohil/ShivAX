// Memory relevance search (SARASWATI S06). Offline; CPU-only hashing embeddings, no vector database.
// Compares the default search with the opt-in ranker on a few labelled demo queries.
import { MemoryEngine, MemoryRanker, createHashingEmbeddings } from 'shivax/memory';
import { evaluateMemoryRetrieval } from 'shivax/learning';

const signal = () => AbortSignal.timeout(30_000);
// In production the namespace comes from a Jay-verified identity (`memoryNamespace` or `ranker.searchFor(root)`).
const namespace = { principalId: 'demo-user', issuer: 'example-host', sessionId: 's1', scopeKind: 'company', scopeId: 'example-tenant' };
const engine = new MemoryEngine({ embeddings: createHashingEmbeddings({ dimensions: 64 }) });
const save = (id, value, extra = {}) => engine.save(namespace, { id, category: 'knowledge', value, ...extra }, signal(), extra.approval);
await save('kb-refund', 'Refund policy: customers may request a refund within 30 days.', { metadata: { source: 'handbook', evidence: ['policy-doc-7'] } });
await save('kb-vpn', 'VPN setup', { metadata: { source: 'handbook' } });
await save('chat-refund', 'Customer asked twice about the refund policy.', { category: 'working' });
await save('note-vpn', 'vpn setup guide is outdated, ask IT', { category: 'session-history' });

// Quality comes from a trusted host allowlist, never from what a record says about itself.
const ranker = new MemoryRanker(engine, { mode: 'hybrid', sourceQuality: (record) => (record.metadata.source === 'handbook' ? 1 : 0) });
const top = (await ranker.search(namespace, { text: 'refund policy', limit: 3 }, signal())).results[0];
const queries = [
    { id: 'q1', text: 'refund policy', relevant: ['kb-refund'] },
    { id: 'q2', text: 'vpn setup', relevant: ['kb-vpn'] },
];
const evaluation = await evaluateMemoryRetrieval({
    k: 2, queries, minQueries: 2, signal: signal(),
    baseline: async (q, s) => (await engine.search(namespace, { text: q.text, limit: 2 }, s)).map((m) => m.record.id),
    candidate: async (q, s) => (await ranker.search(namespace, { text: q.text, limit: 2 }, s)).results.map((r) => r.record.id),
});
console.log(JSON.stringify({
    top: { id: top.record.id, score: Number(top.score.toFixed(3)), source: top.provenance.source, evidence: top.provenance.evidence, trust: top.provenance.trust },
    mrr: { baseline: evaluation.baseline.meanReciprocalRank, ranked: evaluation.candidate.meanReciprocalRank },
    verdict: evaluation.verdict,
    note: 'Demo data; not evidence of relevance on real memory.',
}, null, 2));
