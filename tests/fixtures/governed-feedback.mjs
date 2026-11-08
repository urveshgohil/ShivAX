// SARASWATI S01 fixtures: deterministic, offline, no real users or secrets.
import { Jay, createReviewAttestor } from 'shivax';

export const DAY = 86_400_000;
export const NOW = 1_800_000_000_000;
export const owner = Object.freeze({ scopeKind: 'company', scopeId: 'acme' });

export function governed(id, { feedback = {}, provenance = {} } = {}) {
    return {
        format: 'shivax-governed-feedback',
        version: 1,
        feedback: {
            version: 1, id, taskId: `task-${id}`, botId: 'ekalavy', domain: 'routing',
            input: { capability: 'code.patch', case: id }, output: 'vishwakarma', decision: 'accept',
            ...feedback,
        },
        provenance: {
            version: 1,
            createdAt: NOW - 3_600_000,
            source: { kind: 'human-review', id: `src-${id}` },
            owner,
            session: 'session-1',
            subject: { modelId: 'local-model', modelVersion: '1', configurationVersion: 'cfg-1' },
            evidence: [{ kind: 'measurement', ref: `evidence-${id}`, origin: 'computed' }],
            consent: { ref: 'consent-1', purposes: ['training', 'evaluation'] },
            label: { revision: 1 },
            redaction: { applied: false, fields: [] },
            retention: { expiresAt: NOW + 30 * DAY },
            ...provenance,
        },
    };
}

/** A Jay session for a reviewer; `principalId` and scope come from the trusted host, never the payload. */
export async function reviewerSession({ principalId = 'reviewer-1', permissions = ['learning.review'], scope = owner,
    valid = () => true } = {}) {
    const identity = {
        principal: { id: principalId, issuer: 'test-host', permissions },
        session: { id: `session-${principalId}`, principalId, issuedAt: 1, expiresAt: 9_999_999_999_999,
            scope: { kind: scope.scopeKind, id: scope.scopeId } },
    };
    const jay = new Jay({ authenticate: () => identity, isSessionValid: valid });
    const root = await jay.createContext({ id: 'review-task', input: { capability: 'learning.review', data: null } },
        { signal: new AbortController().signal });
    return { jay, root, identity };
}

/** Jay-backed attestation (method `jay-identity`), the default curation requirement. */
export async function attest(record, { principalId = 'reviewer-1', reviewedAt = NOW - 60_000, status = 'verified', authorize = () => true } = {}) {
    const { jay, root } = await reviewerSession({ principalId });
    const attestor = createReviewAttestor(jay, { permission: 'learning.review', authorize, now: () => reviewedAt });
    return attestor.attest(root, record, status, new AbortController().signal);
}
export const policy = (overrides = {}) => ({
    datasetId: 'dataset-1', datasetVersion: 1, curatorRef: 'curator-1', owner, purpose: 'training', now: NOW,
    maxAttestationAgeMs: 7 * DAY, seed: 'seed-a', ratios: { train: 3, validation: 1, heldOut: 1 },
    ...overrides,
});
export const hooks = (overrides = {}) => ({ confirmReview: () => true, consentActive: () => true, ...overrides });
