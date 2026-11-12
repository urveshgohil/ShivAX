// SARASWATI S06: memory retrieval relevance and knowledge quality. M1-M12 follow the S06 phase prompt (step 7);
// M13-M16 cover the remaining gates. Offline and deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MemoryEngine, MemoryRanker, MemoryError, createHashingEmbeddings, evaluateMemoryRetrieval, PermissionPolicyRegistry, SecurityError,
    MEMORY_RANKING_LIMITS, InMemoryMemoryAdapter,
} from 'shivax';
import * as memoryEntry from 'shivax/memory';
import { NOW, signal, ns, ACME, OTHER_SESSION, GLOBEX, sourceQuality, corpus, QUERIES, identityContext } from './fixtures/retrieval.mjs';

const ids = (search) => search.results.map((r) => r.record.id);
const code = (expected) => (error) => error instanceof MemoryError && error.code === expected;

test('M1 existing memory API behaviour is unchanged; the ranker never writes', async () => {
    const { engine } = await corpus();
    // The default search: term coverage, then newest first, then id.
    const baseline = await engine.search(ACME, { text: 'refund policy' }, signal());
    assert.deepEqual(baseline.map((m) => [m.record.id, m.score]), [['chat-refund', 1], ['kb-refund', 1]]);
    assert.deepEqual((await engine.list(ACME, { categories: ['knowledge'] }, signal())).map((r) => r.id), ['dup-c', 'dup-b', 'dup-a', 'kb-vpn', 'kb-refund']);
    const before = await engine.export(ACME, signal());
    const ranker = new MemoryRanker(engine, { sourceQuality });
    for (let i = 0; i < 5; i++) await ranker.search(ACME, { text: 'refund policy' }, signal());
    const after = await engine.export(ACME, signal());
    assert.deepEqual(after.records, before.records, 'records, revisions and timestamps are untouched');
    assert.deepEqual(await engine.search(ACME, { text: 'refund policy' }, signal()), baseline);
    for (const name of ['MemoryEngine', 'MemoryRanker', 'createHashingEmbeddings', 'MemoryError']) assert.equal(typeof memoryEntry[name], 'function', name);
});

test('M2 default ranking: exact match, keyword coverage and trusted quality, with structured provenance', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality, now: () => NOW + 60_000 });
    const vpn = await ranker.search(ACME, { text: 'VPN setup' }, signal());
    assert.deepEqual(ids(vpn), ['kb-vpn', 'note-vpn']);
    assert.deepEqual({ ...vpn.results[0].components }, { exact: 1, keyword: 1, quality: 1, recency: 0, semantic: 0 });
    assert.equal(vpn.results[0].score, (2 * 1 + 1 * 1 + 0.5 * 1) / 3.5);
    assert.equal(vpn.mode, 'lexical');
    assert.equal(vpn.fallback, null);
    const refund = (await ranker.search(ACME, { text: 'refund policy' }, signal())).results[0];
    assert.equal(refund.record.id, 'kb-refund');
    const p = refund.provenance;
    assert.deepEqual({ ...p.record }, { id: 'kb-refund', revision: 1, generation: refund.record.generation, category: 'knowledge' });
    assert.deepEqual({ ...p.source }, { ref: 'handbook', origin: 'record-metadata' });
    assert.deepEqual({ ...p.scope }, { scopeKind: 'company', scopeId: 'acme', sessionBound: true });
    assert.deepEqual({ ...p.evidence, refs: [...p.evidence.refs] }, { available: true, verified: false, refs: ['policy-doc-7'] });
    assert.equal(p.freshness.createdAt, refund.record.createdAt);
    assert.equal(p.freshness.ageMs, NOW + 60_000 - refund.record.updatedAt);
    assert.equal(p.trust, 'untrusted');
    // Without a host quality callback, only engine-enforced categories carry quality.
    const plain = new MemoryRanker(engine);
    const escalate = await plain.search(ACME, { text: 'escalate billing disputes' }, signal());
    assert.equal(ids(escalate)[0], 'outcome-escalation');
    assert.equal(escalate.results.find((r) => r.record.id === 'self-claimed').components.quality, 0, 'self-declared quality and "verified" metadata are ignored');
});

test('M3 opt-in configuration: weights, explicit recency, host quality failures', async () => {
    const { engine } = await corpus();
    assert.throws(() => new MemoryRanker(engine, { weights: { recency: 1 } }), code('invalid-input'), 'recency needs explicit configuration');
    for (const bad of [{ weights: { exact: -1 } }, { weights: { popularity: 1 } }, { weights: { exact: 0, keyword: 0, quality: 0, semantic: 0 } }, { recency: { halfLifeMs: 0 } }, { mode: 'vector' }, { sourceQuality: 1 }, { suppressDuplicates: 'yes' }])
        assert.throws(() => new MemoryRanker(engine, bad), code('invalid-input'), JSON.stringify(bad));
    // Recency favours newer records only when configured.
    const recent = new MemoryRanker(engine, { weights: { exact: 0, keyword: 1, quality: 0, recency: 1 }, recency: { halfLifeMs: 1_000 }, now: () => NOW + 20_000 });
    assert.deepEqual(ids(await recent.search(ACME, { text: 'refund policy' }, signal())), ['chat-refund', 'kb-refund']);
    const timeless = new MemoryRanker(engine, { weights: { exact: 0, keyword: 1, quality: 0 } });
    assert.deepEqual(ids(await timeless.search(ACME, { text: 'refund policy' }, signal())), ['chat-refund', 'kb-refund'].sort(), 'equal scores fall back to record id, not time');
    // A failing or out-of-range host quality callback counts as zero quality.
    const broken = new MemoryRanker(engine, { sourceQuality: () => { throw new Error('directory down'); } });
    assert.ok((await broken.search(ACME, { text: 'refund policy' }, signal())).results.every((r) => r.components.quality === 0));
    const silly = new MemoryRanker(engine, { sourceQuality: () => 99 });
    assert.ok((await silly.search(ACME, { text: 'refund policy' }, signal())).results.every((r) => r.components.quality === 1));
});

test('M4 duplicate records keep only the best-ranked copy, unless suppression is turned off', async () => {
    const { engine } = await corpus();
    const ranked = await new MemoryRanker(engine, { sourceQuality }).search(ACME, { text: 'holiday calendar' }, signal());
    assert.deepEqual(ids(ranked), ['dup-a']);
    assert.equal(ranked.suppressedDuplicates, 2);
    assert.equal(ranked.candidates, 3);
    const all = await new MemoryRanker(engine, { sourceQuality, suppressDuplicates: false }).search(ACME, { text: 'holiday calendar' }, signal());
    assert.deepEqual(ids(all), ['dup-a', 'dup-b', 'dup-c']);
});

test('M5 missing evidence and sources are reported as missing, never fabricated', async () => {
    const { engine } = await corpus();
    const result = (await new MemoryRanker(engine).search(ACME, { text: 'vpn setup guide' }, signal())).results.find((r) => r.record.id === 'note-vpn');
    assert.equal(result.provenance.source, null);
    assert.deepEqual({ ...result.provenance.evidence, refs: [...result.provenance.evidence.refs] }, { available: false, verified: false, refs: [] });
    // Governed feedback: its own (claimed) source and evidence references are surfaced, labelled as such.
    const governed = { format: 'shivax-governed-feedback', version: 1, feedback: { id: 'f' }, provenance: { source: { kind: 'human-review', id: 'review-9' }, evidence: [{ kind: 'trace', ref: 'trace-1', origin: 'host' }, { kind: 'trace', ref: 'not a ref!', origin: 'host' }] } };
    await engine.save(ACME, { id: 'gov', category: 'knowledge', value: governed }, signal());
    const g = (await new MemoryRanker(engine).search(ACME, { text: 'review-9' }, signal())).results[0];
    assert.deepEqual({ ...g.provenance.source }, { ref: 'review-9', origin: 'governed-feedback' });
    assert.deepEqual([...g.provenance.evidence.refs], ['trace-1'], 'malformed references are dropped, not repaired');
});

test('M6 embedding dimensions and values are validated', async () => {
    for (const bad of [{ dimensions: 4 }, { dimensions: 5000 }, { dimensions: 1.5 }, { id: 'has space' }]) assert.throws(() => createHashingEmbeddings(bad), code('invalid-input'));
    const wrongLength = { id: 'bad', dimensions: 8, networkOrigins: [], embed: () => [1, 2, 3] };
    const engine = new MemoryEngine({ embeddings: wrongLength });
    await assert.rejects(engine.save(ACME, { id: 'x', category: 'knowledge', value: 'text' }, signal()), code('embedding-error'));
    const notFinite = new MemoryEngine({ embeddings: { id: 'nan', dimensions: 2, networkOrigins: [], embed: () => [NaN, 1] } });
    await assert.rejects(notFinite.save(ACME, { id: 'x', category: 'knowledge', value: 'text' }, signal()), code('embedding-error'));
    assert.throws(() => new MemoryEngine({ embeddings: { id: 'huge', dimensions: 5000, embed: () => [] } }), code('invalid-input'));
    const hashing = createHashingEmbeddings({ dimensions: 64 });
    const v = hashing.embed('refund policy refund');
    assert.equal(v.length, 64);
    assert.ok(v.every(Number.isFinite));
    assert.deepEqual(hashing.embed('refund policy refund'), v, 'deterministic');
    assert.deepEqual([...hashing.networkOrigins], [], 'CPU-only: no network destinations');
    // Hybrid ranking with the local adapter adds a semantic component; vectors stay in the tenant's records.
    const { engine: withEmbeddings } = await corpus({ engineOptions: { embeddings: hashing } });
    const hybrid = await new MemoryRanker(withEmbeddings, { sourceQuality, mode: 'hybrid' }).search(ACME, { text: 'refund policy' }, signal());
    assert.equal(hybrid.fallback, null);
    assert.equal(ids(hybrid)[0], 'kb-refund');
    assert.ok(hybrid.results[0].components.semantic > 0.5);
    assert.ok(!ids(hybrid).some((id) => id.startsWith('g-') || id.startsWith('s2-')));
});

test('M7 embedding provider failure falls back to deterministic lexical ranking', async () => {
    let fail = false;
    const flaky = { id: 'flaky', dimensions: 8, networkOrigins: [], embed: (text) => { if (fail) throw new Error('provider timeout'); return createHashingEmbeddings({ dimensions: 8 }).embed(text); } };
    const { engine } = await corpus({ engineOptions: { embeddings: flaky } });
    const ranker = new MemoryRanker(engine, { sourceQuality, mode: 'hybrid' });
    fail = true;
    const result = await ranker.search(ACME, { text: 'refund policy' }, signal());
    assert.equal(result.fallback, 'embedding-error');
    assert.deepEqual(ids(result), ids(await new MemoryRanker(engine, { sourceQuality }).search(ACME, { text: 'refund policy' }, signal())));
    assert.ok(result.results.every((r) => r.components.semantic === 0));
    const { engine: noEmbeddings } = await corpus();
    assert.equal((await new MemoryRanker(noEmbeddings, { mode: 'hybrid' }).search(ACME, { text: 'refund policy' }, signal())).fallback, 'embeddings-unavailable');
});

test('M8 stale records: no cache, expired records disappear, stale embeddings are not used', async () => {
    const { engine, clock } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality });
    assert.ok(ids(await ranker.search(ACME, { text: 'refund policy' }, signal())).includes('chat-refund'));
    // `working` memory expires after one hour by default.
    clock.t += 3_600_001;
    const later = await ranker.search(ACME, { text: 'refund policy' }, signal());
    assert.deepEqual(ids(later), ['kb-refund'], 'expired records are never served from an old result');
    // Records embedded by an older provider are skipped by semantic search but still ranked lexically.
    const old = createHashingEmbeddings({ id: 'hash-old', dimensions: 16 });
    const store = new MemoryEngine({ embeddings: old });
    await store.save(ACME, { id: 'legacy', category: 'knowledge', value: 'refund policy legacy' }, signal());
    const records = await store.export(ACME, signal());
    assert.equal(records.records[0].embedding.providerId, 'hash-old');
    // Same persisted data, opened with a new embedding provider: the old vector is not comparable and is skipped.
    const adapter = new InMemoryMemoryAdapter();
    const before = new MemoryEngine({ persistence: adapter, embeddings: old });
    await before.save(ACME, { id: 'legacy', category: 'knowledge', value: 'refund policy legacy' }, signal());
    const after = new MemoryEngine({ persistence: adapter, embeddings: createHashingEmbeddings({ id: 'hash-new', dimensions: 16 }) });
    const hybrid = await new MemoryRanker(after, { mode: 'hybrid' }).search(ACME, { text: 'refund policy' }, signal());
    assert.deepEqual(ids(hybrid), ['legacy'], 'still found lexically');
    assert.equal(hybrid.results[0].components.semantic, 0, 'the stale vector from another provider is not used');
    assert.equal(hybrid.fallback, null);
});

test('M9 deleted records are never returned', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality });
    assert.equal(ids(await ranker.search(ACME, { text: 'refund policy' }, signal()))[0], 'kb-refund');
    assert.equal(await engine.delete(ACME, 'kb-refund', signal()), true);
    assert.deepEqual(ids(await ranker.search(ACME, { text: 'refund policy' }, signal())), ['chat-refund']);
});

test('M10 cross-tenant and cross-session queries never see other records', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality, mode: 'lexical' });
    const acme = ids(await ranker.search(ACME, { text: 'refund policy', limit: 50 }, signal()));
    assert.ok(!acme.includes('g-refund') && !acme.includes('s2-refund'));
    assert.deepEqual(ids(await ranker.search(GLOBEX, { text: 'refund policy' }, signal())), ['g-refund']);
    assert.deepEqual(ids(await ranker.search(OTHER_SESSION, { text: 'refund policy' }, signal())), ['s2-refund']);
    assert.deepEqual(ids(await ranker.search(ns('initech'), { text: 'refund policy' }, signal())), []);
    // With Jay, the namespace comes from the verified identity, never from the caller.
    const { jay, root } = await identityContext({ scopeId: 'globex' });
    const secured = new MemoryRanker(engine, { security: { jay } });
    const fromRoot = ids(await secured.searchFor(root, { text: 'refund policy' }, signal()));
    assert.deepEqual(fromRoot, ['g-refund'], 'a globex identity searches the globex namespace only');
    const acmeOther = await identityContext({ sessionId: 's9' });
    assert.deepEqual(ids(await new MemoryRanker(engine, { security: { jay: acmeOther.jay } }).searchFor(acmeOther.root, { text: 'refund policy' }, signal())), [], 'another session of the same tenant sees nothing from s1');
});

test('M11 result counts and query sizes are bounded', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine);
    for (const limit of [0, 51, 1.5]) await assert.rejects(ranker.search(ACME, { text: 'refund', limit }, signal()), code('invalid-input'));
    await assert.rejects(ranker.search(ACME, { text: 'x'.repeat(1025) }, signal()), code('invalid-input'));
    await assert.rejects(ranker.search(ACME, { text: 'refund', mode: 'semantic' }, signal()), code('invalid-input'));
    for (let i = 0; i < 60; i++) await engine.save(ns('acme', 'bulk'), { id: `bulk-${String(i).padStart(2, '0')}`, category: 'knowledge', value: `bulk note ${i}` }, signal()).catch(() => undefined);
    const bulk = await ranker.search(ns('acme', 'bulk'), { text: 'bulk note', limit: 7 }, signal());
    assert.equal(bulk.results.length, 7);
    assert.ok(bulk.candidates <= MEMORY_RANKING_LIMITS.maxLimit);
});

test('M12 tie-breaking is deterministic and independent of insertion order and timestamps', async () => {
    const make = async (order) => {
        let t = NOW;
        const engine = new MemoryEngine({ now: () => (t += 1_000) });
        for (const id of order) await engine.save(ACME, { id, category: 'knowledge', value: `same words ${id.slice(-1)}` }, signal());
        return engine;
    };
    const a = await make(['r-c', 'r-a', 'r-b']), b = await make(['r-b', 'r-c', 'r-a']);
    const ranker = (engine) => new MemoryRanker(engine, { weights: { exact: 0, keyword: 1, quality: 0 } });
    const first = ids(await ranker(a).search(ACME, { text: 'same words' }, signal()));
    assert.deepEqual(first, ['r-a', 'r-b', 'r-c']);
    assert.deepEqual(ids(await ranker(b).search(ACME, { text: 'same words' }, signal())), first);
    assert.deepEqual(ids(await ranker(a).search(ACME, { text: 'same words' }, signal())), first);
});

test('M13 labelled evaluation: precision, recall, MRR, missing rate and cross-tenant denial against the baseline', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality });
    const baseline = async (q, s) => (await engine.search(ACME, { text: q.text, limit: 3 }, s)).map((m) => m.record.id);
    const candidate = async (q, s) => ids(await ranker.search(ACME, { text: q.text, limit: 3 }, s));
    const result = await evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline, candidate, minQueries: 4, signal: signal() });
    // Measured on the constructed fixture (4 labelled queries); see docs/audits/saraswati-s06.md.
    assert.deepEqual({ ...result.baseline }, { queries: 5, precisionAtK: 1 / 3, recallAtK: 1, meanReciprocalRank: (1 / 2 + 1 / 2 + 1 / 3 + 1 / 3) / 4, missingRate: 0, crossTenantDenial: 1, forbiddenReturned: 0, errors: 0 });
    assert.deepEqual({ ...result.candidate }, { queries: 5, precisionAtK: 1 / 3, recallAtK: 1, meanReciprocalRank: 1, missingRate: 0, crossTenantDenial: 1, forbiddenReturned: 0, errors: 0 });
    assert.equal(result.verdict, 'improved');
    assert.equal(result.delta.recallAtK, 0);
    // Not enough labelled queries: no claim.
    assert.equal((await evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline, candidate, minQueries: 10, signal: signal() })).verdict, 'insufficient-evidence');
    // A worse strategy, a leaking strategy and a failing strategy are reported as regressions.
    const dropsTop = async (q, s) => (await candidate(q, s)).slice(1);
    assert.equal((await evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline: candidate, candidate: dropsTop, minQueries: 4, signal: signal() })).verdict, 'regressed');
    const leaky = async (q, s) => [...(await candidate(q, s)), 'g-refund'];
    const leak = await evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline, candidate: leaky, minQueries: 4, signal: signal() });
    assert.equal(leak.candidate.forbiddenReturned, 1);
    assert.equal(leak.candidate.crossTenantDenial, 0.5);
    assert.equal(leak.verdict, 'regressed');
    const failing = await evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline, candidate: () => { throw new Error('down'); }, minQueries: 4, signal: signal() });
    assert.equal(failing.candidate.errors, 5);
    assert.equal(failing.candidate.missingRate, 1);
    for (const bad of [{ k: 0 }, { queries: [] }, { queries: [{ id: 'x', text: 'a', relevant: ['r'], forbidden: ['r'] }] }])
        await assert.rejects(evaluateMemoryRetrieval({ k: 3, queries: QUERIES, baseline, candidate, signal: signal(), ...bad }));
});

test('M14 Jay/Vijay authorization and firewall lockdown gate ranked searches', async () => {
    const { engine } = await corpus();
    await assert.rejects(new MemoryRanker(engine).searchFor({}, { text: 'refund' }, signal()), code('unavailable'), 'searchFor requires configured security');
    const policies = new PermissionPolicyRegistry().register({ kind: 'capability', id: 'memory.search', effect: 'read-only', permissions: ['memory'], validateInput: () => true });
    const allowed = await identityContext();
    const ranker = new MemoryRanker(engine, { sourceQuality, security: { jay: allowed.jay, policies } });
    assert.equal(ids(await ranker.searchFor(allowed.root, { text: 'refund policy' }, signal()))[0], 'kb-refund');
    const denied = await identityContext({ permissions: [] });
    await assert.rejects(new MemoryRanker(engine, { security: { jay: denied.jay, policies } }).searchFor(denied.root, { text: 'refund' }, signal()), (e) => e instanceof SecurityError && e.code === 'permission-denied');
    const revoked = await identityContext({ valid: () => false }).catch((e) => e);
    assert.ok(revoked instanceof SecurityError, 'a revoked session cannot even obtain a context');
    await assert.rejects(ranker.searchFor({ ...allowed.root }, { text: 'refund' }, signal()), SecurityError, 'copied contexts carry no identity');
    const firewall = { mode: 'enforce', status() { return { mode: this.mode, admission: this.mode === 'lockdown' ? 'closed' : 'open' }; } };
    const guarded = new MemoryRanker(engine, { firewall });
    assert.equal((await guarded.search(ACME, { text: 'refund' }, signal())).results.length > 0, true);
    firewall.mode = 'lockdown';
    await assert.rejects(guarded.search(ACME, { text: 'refund' }, signal()), code('unavailable'));
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(new MemoryRanker(engine).search(ACME, { text: 'refund' }, aborted.signal), code('cancelled'));
});

test('M15 repeated retrieval never turns untrusted feedback into trusted knowledge', async () => {
    const { engine } = await corpus();
    const ranker = new MemoryRanker(engine, { sourceQuality });
    const first = await ranker.search(ACME, { text: 'escalate billing disputes' }, signal());
    for (let i = 0; i < 25; i++) await ranker.search(ACME, { text: 'escalate billing disputes' }, signal());
    const last = await ranker.search(ACME, { text: 'escalate billing disputes' }, signal());
    assert.deepEqual(last.results.map((r) => [r.record.id, r.score]), first.results.map((r) => [r.record.id, r.score]), 'no popularity effect');
    const claimed = last.results.find((r) => r.record.id === 'self-claimed');
    assert.equal(claimed.components.quality, 0);
    assert.equal(claimed.record.revision, 1);
    assert.equal(claimed.record.category, 'working');
    assert.ok(last.results.every((r) => r.provenance.trust === 'untrusted' && r.record.trust === 'untrusted'));
});

test('M16 the hashing adapter keeps vectors inside tenant-scoped records', async () => {
    const hashing = createHashingEmbeddings({ dimensions: 32 });
    const engine = new MemoryEngine({ embeddings: hashing });
    await engine.save(ACME, { id: 'a', category: 'knowledge', value: 'refund policy' }, signal());
    await engine.save(GLOBEX, { id: 'b', category: 'knowledge', value: 'refund policy' }, signal());
    const acme = await engine.export(ACME, signal());
    assert.deepEqual(acme.records.map((r) => r.id), ['a']);
    assert.equal(acme.records[0].embedding.vector.length, 32);
    const semantic = await engine.search(ACME, { text: 'refund policy', mode: 'semantic' }, signal());
    assert.deepEqual(semantic.map((m) => m.record.id), ['a']);
});
