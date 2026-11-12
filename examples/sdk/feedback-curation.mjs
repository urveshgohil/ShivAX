// Verified feedback curation and dataset manifest (SARASWATI S01). Offline; no model, network or files.
// The reviewer identity, consent journal and review journal are labelled demo stand-ins. In production they
// come from your trusted host: real sessions, a consent store and the journal of reviews you issued.
import { Jay } from 'shivax/security';
import {
    createGovernedFeedback, createReviewAttestor, curateDataset, verifyCuratedDataset, digestLearningValue,
} from 'shivax/learning';

const owner = { scopeKind: 'company', scopeId: 'example-tenant' };
const now = Date.now();
const signal = () => AbortSignal.timeout(30_000);

// 1. Feedback arrives as v1 records wrapped with provenance claims. Provenance can never mark itself verified.
const feedback = Array.from({ length: 8 }, (_, i) => createGovernedFeedback(
    { version: 1, id: `fb-${i}`, taskId: `task-${i}`, botId: 'brihaspati', domain: 'reasoning', input: [i, i + 1], output: [i % 2], decision: 'accept' },
    {
        version: 1, createdAt: now - 3_600_000,
        source: { kind: 'human-review', id: `ticket-${i}` },
        owner,
        subject: { modelId: 'parity', modelVersion: '1' },
        evidence: [{ kind: 'trace', ref: `trace-${i}`, origin: 'host' }],
        consent: { ref: `consent-${i}`, purposes: ['training', 'evaluation'] },
        label: { revision: 1 },
        redaction: { applied: false, fields: [] },
        retention: { expiresAt: now + 30 * 86_400_000 },
    },
));

// 2. A reviewer, verified by Jay, attests each record. The reviewer comes from the session, never the payload.
const reviewer = {
    principal: { id: 'reviewer-1', issuer: 'example-host', permissions: ['learning.review'] },
    session: { id: 'review-session', principalId: 'reviewer-1', issuedAt: now - 1000, expiresAt: now + 600_000, scope: { kind: 'company', id: 'example-tenant' } },
};
const jay = new Jay({ authenticate: () => reviewer, isSessionValid: () => true });
const root = await jay.createContext({ id: 'review', input: { capability: 'learning.review', data: null } }, { signal: signal() });
const attestor = createReviewAttestor(jay, { permission: 'learning.review', authorize: () => true });
const attestations = [];
for (const record of feedback) attestations.push(await attestor.attest(root, record, 'verified', signal()));
const issued = new Set(await Promise.all(attestations.map((a) => digestLearningValue(a)))); // demo review journal

// 3. Curation admits only attested, consented, current records of one tenant and partitions without leakage.
const dataset = await curateDataset(feedback, attestations, {
    datasetId: 'parity-training', datasetVersion: 1, curatorRef: 'curator-1', owner, purpose: 'training',
    now: Date.now(), maxAttestationAgeMs: 7 * 86_400_000, seed: 'example-seed', ratios: { train: 3, validation: 0, heldOut: 1 },
}, {
    confirmReview: (_attestation, digest) => issued.has(digest),
    consentActive: () => true,
}, signal());

// 4. The manifest holds ids, digests and counts only. Anyone holding it can re-verify the splits.
await verifyCuratedDataset(dataset);
const { manifest } = dataset;
console.log(JSON.stringify({
    dataset: { id: manifest.id, version: manifest.datasetVersion, digest: manifest.digest },
    splits: Object.fromEntries(Object.entries(manifest.splits).map(([name, s]) => [name, s.rows])),
    excluded: Object.entries(manifest.excluded).filter(([, n]) => n > 0),
    trust: manifest.trust,
}, null, 2));
