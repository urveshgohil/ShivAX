# Learning governance (SARASWATI S01)

ShivAX 0.3 adds optional, versioned provenance for learning feedback, and a
curation step that turns reviewed feedback into leakage-safe datasets. All of
it is additive. `FeedbackRecord` v1, `validateFeedback`, `storeLearningFeedback`,
`exportTrainingData`, `validateTrainingExport`, `trainOfflineCandidate`,
`trainCuratedCandidate`, `evaluateDataset` and `EvaluatedModelUpdates` are
unchanged.

Nothing in this module trains a model, activates a candidate, executes a tool
or changes a firewall policy.

## Trust model

| Data or code | Created by | Trusted? |
| --- | --- | --- |
| `GovernedFeedback` (v1 feedback plus provenance) | Anyone: a host, an LLM, a bot, an Inspectra scan, a browser, an import | **No.** Provenance is a set of claims. The schema has no `verified`, `approved`, `reviewer` or status field, and unknown keys are rejected |
| `ReviewAttestation`, method `jay-identity` | `createReviewAttestor(jay, …).attest(root, …)` on trusted server code | The reviewer is derived from a **Jay-minted, live** session context. Bound to the record's SHA-256 content digest. Integrity, not a signature |
| `ReviewAttestation`, method `host-asserted` | `attestGovernedFeedback` (host supplies `reviewerRef`) | Weaker. **Curation rejects these unless `allowHostAssertedReviews: true`** |
| Curation hooks (`confirmReview`, `consentActive`, `select`) | Trusted host code | Yes. Only a literal `true` passes; errors exclude the record |

### Reviewer attestation through Jay

`createReviewAttestor(jay, { permission, authorize, now? })` returns
`attest(root, record, status, signal)`. It checks the following:

1. `jay.verify(root)` succeeds. A copied, forged, expired or revoked context
   throws. The reviewer comes from this identity and **never** from the payload.
2. The principal holds `permission` (for example `learning.review`).
3. The session scope equals the record's `owner` (same tenant).
4. The principal is not the record's `source.id` (no self-attestation).
5. Host `authorize(identity, record)` returns literal `true`.

`reviewerRef` is `reviewer:` followed by 32 hex characters from
`SHA-256('shivax-reviewer-v1', issuer, principalId)`. It is opaque and contains
no name or email address. The attestation records `status` as `verified` or
`rejected`; only `verified` is admitted.

Because attestations are not signed, curation also requires host
`confirmReview(attestation, attestationDigest)` to return `true`. The host
should confirm that it issued that digest (from its own review journal) and
that the reviewer is still authorized. That is what makes an attestation
authentic.

## Curation rules (`curateDataset`)

A record enters a dataset only when all of the following hold. Checks run in
this order and the first failure is reported:

| # | Rule | Exclusion code |
| --- | --- | --- |
| 1 | Valid `GovernedFeedback`: closed schema, 48 KiB at most, depth 32 at most, restricted-content checks (tokens, keys, JWTs, emails, `password=`-style text, sensitive key names) | `invalid-record` (the feedback id is reported as `null`) |
| 2 | Decision is not `reject` | `rejected-decision` |
| 3 | Owner equals the curation owner | `cross-tenant` |
| 4 | Retention has not expired | `expired` |
| 5 | Consent purposes include the curation purpose | `consent-missing` |
| 6 | An attestation covers this exact content digest, id and revision | `unattested`, or `digest-mismatch` if the content was edited after review |
| 7 | Review status is `verified` | `review-rejected` |
| 8 | Review method is `jay-identity`, unless host-asserted reviews were opted into | `host-asserted-review` |
| 9 | The reviewer is not the source | `self-attested` |
| 10 | The review is no older than `maxAttestationAgeMs`, not in the future, and not before creation | `stale-attestation` |
| 11 | `confirmReview` returns `true` | `review-unconfirmed` (or `hook-error`) |
| 12 | `consentActive(consentRef, purpose, feedbackId)` returns `true` | `consent-withdrawn` (or `hook-error`) |
| 13 | `select(record)` returns `true`, when a `select` hook is supplied | `not-selected` (or `hook-error`) |

Then, deterministically:

- **Same feedback id:** identical copies collapse (`duplicate`); differing
  copies are all excluded (`conflicting-duplicate`).
- **Revisions:** a later `label.revision` that names another record in
  `supersedes` replaces it (`superseded`). A non-increasing revision excludes
  both (`conflicting-label`).
- **Same domain and canonical input** (key order ignored), including repeated
  imports with new ids: when the labels agree, the lowest id is kept and the
  others are `duplicate`; when they disagree, all are excluded
  (`conflicting-label`).
- **Partition:** rows sharing a canonical input or a source group
  (`source.group`, defaulting to `source.id`) form one component. Each
  component goes to exactly one split. Components are ordered by
  `SHA-256(seed, smallest id)` and filled toward the integer ratio weights,
  with every required split getting at least one component. The result does
  not depend on input order or key order. Tenants never mix, because the owner
  is checked in rule 3.

If there are zero eligible rows, curation returns empty splits plus the
exclusion report. If eligible rows exist but there are fewer independent
components than required splits, it throws.

## Schemas (v1)

`Ref` is an opaque reference matching `^[A-Za-z0-9._:-]{1,256}$`. That pattern
excludes URLs, `data:` URIs, whitespace and free text, so content and
screenshots cannot be embedded.

### `GovernedFeedback`

```ts
{
  format: 'shivax-governed-feedback', version: 1,
  feedback: FeedbackRecord,      // unchanged v1: id, taskId, botId, domain, input, output, decision, correction?
  provenance: {
    version: 1,
    createdAt: number,                                   // host epoch ms
    source: { kind: 'human-review'|'host-outcome'|'model-output'|'inspection-finding'|'import', id: Ref, group?: Ref },
    owner: { scopeKind: 'personal'|'company', scopeId: Ref },     // tenant
    session?: Ref,                                       // correlation only, never a credential
    subject: { agentVersion?: Ref, modelId?: Ref, modelVersion?: Ref, configurationVersion?: Ref },
    evidence: { kind: 'measurement'|'report'|'trace'|'document'|'screenshot-reference', ref: Ref,
                origin: 'computed'|'design'|'inferred'|'host' }[],          // 16 at most, unique refs
    consent: { ref: Ref, purposes: ('evaluation'|'training'|'routing-analysis')[] },  // non-empty, unique
    label: { revision: 1..1000, supersedes?: FeedbackId },   // supersedes required exactly when revision > 1
    redaction: { applied: boolean, fields: FieldPath[], method?: 'removed'|'masked'|'hashed' },
    retention: { expiresAt: number }                     // more than createdAt, at most createdAt + 366 days
  }
}
```

### `ReviewAttestation`

```ts
{ format: 'shivax-review-attestation', version: 1, feedbackId, labelRevision,
  contentDigest: 'sha256:<64 hex>', status: 'verified'|'rejected',
  method: 'jay-identity'|'host-asserted', reviewerRef: Ref, reviewedAt: number }
```

### `DatasetManifest`

```ts
{
  format: 'shivax-dataset-manifest', version: 1,
  id: Ref, datasetVersion: 1..1_000_000, createdAt, curatorRef: Ref,
  owner: { scopeKind, scopeId }, purpose,
  partition: { method: 'component-sha256-v1', seed: Ref, ratios: { train, validation, heldOut } },
  splits: { train|validation|heldOut: { rows, digest } },
  records: { feedbackId, split, contentDigest, attestationDigest, labelRevision, reviewMethod, sourceKind }[],
  eligibility: { rules: 'saraswati-s01-v1', checkedAt, reviewMethods: ReviewMethod[] },
  sources: Record<SourceKind, number>, excluded: Record<ExclusionCode, number>,
  invalidAttestations: number, trust: 'untrusted', digest: 'sha256:…'   // digest of everything else
}
```

The `curateDataset` result is `{ manifest, splits, exclusions }`:

- `splits.train`, `splits.validation` and `splits.heldOut` are plain
  `shivax-curated-training` v1 exports, so
  `trainCuratedCandidate(model, splits.train, splits.heldOut)` accepts them
  unchanged.
- `exclusions` is a list of `{ index, feedbackId | null, reason }`.
- No record content, reviewer reference, consent reference, session or
  evidence reference appears in the manifest or the exclusions.

## Consent, retention and lineage

Consent and retention are checked again every time a dataset is curated.
Withdrawn or expired records therefore never enter a **new** dataset. A
manifest records eligibility as of `checkedAt` and is not rewritten later.

`traceDatasetLineage({ manifests, candidates, ineligibleFeedbackIds })`:

- verifies each manifest's digest;
- lists datasets that contain any newly ineligible feedback;
- lists candidates (`{ candidateId, datasetDigest }`) trained on them.

A candidate whose dataset manifest is not supplied is reported as well, since
it cannot be cleared. The report always contains `influenceRemoved: false`:
excluding a record from future datasets **does not** remove its influence from
weights that were already trained. Those candidates need host review, and
retraining or rollback is a separate, approved action (S04).

## Storage

`storeGovernedFeedback(tools, record, { now?, ttlMs? })`:

- writes through the same Vijay-protected Chitragupt tool as
  `storeLearningFeedback` (`shivax.memory.records.save`, category
  `verified-outcome`, tags `learning-feedback` and `governed-v1`);
- calls only that one fixed tool id, whatever the payload contains;
- still requires host `verifyOutcome`, the Vijay policy and approval;
- sets the memory TTL to at most the record's remaining retention (7 days by
  default). The memory category limit still applies.

Memory is session-scoped and expires. Curated splits and manifests are the
durable artifact; durable dataset storage arrives in S04.

## Migration

None is required. Existing v1 feedback and v1 training exports keep working.
To govern an existing v1 record, call
`createGovernedFeedback(v1Record, provenance)`: an explicit wrap that never
infers provenance. `checkPartitionLeakage` runs the id, input and (optional)
group checks on pre-0.3 exports.

## Limits

| Limit | Value |
| --- | --- |
| Governed record | 48 KiB |
| Provenance | 8 KiB |
| Attestation | 4 KiB |
| Evidence items | 16 |
| Redacted field paths | 32 |
| Label revision | 1000 |
| Retention | 366 days |
| Records per curation | 1024 |
| Attestations per curation | 2048 |
| Rows per split | 256 (the v1 export limit) |
| Lineage manifests | 1024 |
| Lineage candidates | 4096 |
| Ineligible ids | 100 000 |

Curation is cooperative: it checks the signal between records and around every
hook call.
