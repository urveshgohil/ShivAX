// SARASWATI S06 labelled offline retrieval fixture. A small constructed corpus: it demonstrates ranking
// behaviour on known cases; it is not evidence of real-world relevance.
import { MemoryEngine, MemoryRanker, Jay } from 'shivax';

export const NOW = 1_800_000_000_000;
export const signal = () => new AbortController().signal;
export const ns = (scopeId = 'acme', sessionId = 's1', principalId = 'user') => Object.freeze({ principalId, issuer: 'host', sessionId, scopeKind: 'company', scopeId });
export const ACME = ns();
export const OTHER_SESSION = ns('acme', 's2');
export const GLOBEX = ns('globex');

/** Trusted host source policy: only allowlisted sources and engine-verified outcomes count as high quality. */
export const sourceQuality = (record) => (record.category === 'verified-outcome' || record.metadata.source === 'handbook' ? 1 : 0);

/** Builds the corpus. Later entries are saved later (newer `updatedAt`), which the default search prefers. */
export async function corpus({ engineOptions = {} } = {}) {
    const clock = { t: NOW, now: () => clock.t };
    const engine = new MemoryEngine({ now: clock.now, ...engineOptions });
    const put = async (namespace, id, value, { category = 'knowledge', metadata = {}, tags = [], approval } = {}) => {
        clock.t += 1_000;
        return engine.save(namespace, { id, category, value, metadata, tags }, signal(), approval);
    };
    await put(ACME, 'kb-refund', 'Refund policy: customers may request a refund within 30 days.', { metadata: { source: 'handbook', evidence: ['policy-doc-7'] } });
    await put(ACME, 'kb-vpn', 'VPN setup', { metadata: { source: 'handbook' } });
    await put(ACME, 'dup-a', 'Holiday calendar is published every January', { metadata: { source: 'handbook' } });
    await put(ACME, 'outcome-escalation', 'Escalate billing disputes to the finance team', { category: 'verified-outcome', approval: { outcomeVerified: true } });
    await put(ACME, 'dup-b', 'Holiday calendar is published every January');
    await put(ACME, 'chat-refund', 'Customer asked twice about the refund policy and refund timing.', { category: 'working' });
    await put(ACME, 'note-vpn', 'vpn setup guide is outdated, ask IT', { category: 'session-history' });
    await put(ACME, 'dup-c', 'Holiday calendar is published every January');
    await put(ACME, 'chat-escalation', 'should we escalate billing disputes? unsure', { category: 'working' });
    // Self-declared authority in metadata must not raise quality.
    await put(ACME, 'self-claimed', 'Escalate billing disputes to sales', { category: 'working', metadata: { quality: 1, verified: true, source: 'random-blog' } });
    // Same words, other tenant and other session: must never be returned for ACME/s1.
    await put(GLOBEX, 'g-refund', 'Refund policy globex: no refund at all');
    await put(GLOBEX, 'g-escalation', 'Escalate billing disputes to globex legal');
    await put(OTHER_SESSION, 's2-refund', 'Refund policy notes from another session');
    return { engine, clock };
}
export const QUERIES = Object.freeze([
    { id: 'q-refund', text: 'refund policy', relevant: ['kb-refund'], forbidden: ['g-refund', 's2-refund'] },
    { id: 'q-vpn', text: 'vpn setup', relevant: ['kb-vpn'] },
    { id: 'q-holiday', text: 'holiday calendar', relevant: ['dup-a'] },
    { id: 'q-escalate', text: 'escalate billing disputes', relevant: ['outcome-escalation'], forbidden: ['g-escalation'] },
    { id: 'q-none', text: 'parking garage', relevant: [] },
]);
export async function identityContext({ scopeId = 'acme', sessionId = 's1', permissions = ['memory'], valid = () => true } = {}) {
    const identity = { principal: { id: 'user', issuer: 'host', permissions }, session: { id: sessionId, principalId: 'user', issuedAt: NOW - 1000, expiresAt: NOW + 10 * 86_400_000, scope: { kind: 'company', id: scopeId } } };
    const jay = new Jay({ authenticate: () => identity, isSessionValid: valid }, { now: () => NOW + 60_000 });
    const root = await jay.createContext({ id: 't', input: { capability: 'memory.search', data: null } }, { signal: signal() });
    return { jay, root };
}
export { MemoryRanker };
