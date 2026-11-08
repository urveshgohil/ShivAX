# SARASWATI S01 — Verified feedback provenance and dataset governance

| Field | Value |
| --- | --- |
| Phase | S01, run against the S01 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` |
| Repository | ShivAX only. Inspectra and Visynq not modified |
| Branch / base | `feat/saraswati-v0.3.0`; base `4d0a372` (the user's Vishwakarma rename commit). S01 files are in the working tree, and partly staged by the user. Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Acceptance gate | **PASS** |

## 1. Current API audit (step 1)

Read before editing:

- `src/learning/{index,training,updates}.ts`
- `src/bots/ekalavy.ts`
- `src/memory/*`
- `src/security/{jay,vijay,types}.ts` and `src/security/firewall/*`
- `src/agents/rudra/*`, `src/agents/validation.ts`
- `docs/learning-evaluation.md`, `tests/learning.test.mjs`
- the SDK entry points

| API | Actual behaviour in this repository | Difference from the prompt's assumptions |
| --- | --- | --- |
| `FeedbackRecord` v1 / `validateFeedback` | Closed v1 record (`version, id, taskId, botId, domain, input, output, decision, correction?`). `correction` is required exactly when the decision is `correct`. 64 KiB at most, depth 32, 10,000 nodes | There are **no** source, tenant, timestamp, reviewer, consent or evidence fields, so provenance is a separate envelope |
| `storeLearningFeedback` | Validates v1, then calls the protected tool `shivax.memory.records.save` with category `verified-outcome` and tag `learning-feedback`. Needs host `verifyOutcome`, Vijay policy and approval | Memory is session-namespaced. TTL defaults to 7 days and is configurable up to 90, so memory is **not** a durable dataset store |
| `exportTrainingData` | The host `approve` must return literal `true`. Excludes `reject`. 256 rows at most. Output `shivax-curated-training` v1 with `trust:'untrusted'` | No deduplication, partitioning or provenance |
| `trainOfflineCandidate` | Synchronous CPU training of a clone, 4096 rows at most; never mutates the active model | Blocks the event loop (S03) |
| `trainCuratedCandidate` | Training and held-out v1 exports must not overlap by id or by numeric input; labels must match the task | No source-group awareness. S01 adds that upstream |
| `evaluateDataset` | 1–256 cases, 6 domains, timeout and cancellation, exact canonical matching | No dataset hash or seed (S02) |
| `EvaluatedModelUpdates` | Strict gate (candidate accuracy, completion and validity must be 1, plus literal-`true` approval); 16 in-memory versions; rollback needs approval | Not durable (S04) |
| Ekalavy | `learning.feedback`, `learning.record` (legacy, unverified session store), `learning.summarize` | Unchanged in S01 |

All of these are unchanged; existing tests prove it (§8).

## 2. New and modified interfaces

**Modified:**

- `src/sdk/learning.ts` and `src/index.ts`: two additive `export *` lines each.
- No existing signature or behaviour changed.

**New exports from `shivax` and `shivax/learning`:**

| Area | Exports |
| --- | --- |
| Constants | `FEEDBACK_SOURCE_KINDS`, `CONSENT_PURPOSES`, `EVIDENCE_KINDS`, `EVIDENCE_ORIGINS`, `REVIEW_STATUSES`, `REVIEW_METHODS`, `REDACTION_METHODS`, `GOVERNANCE_LIMITS`, `DATASET_SPLITS`, `CURATION_EXCLUSIONS`, `CURATION_LIMITS` |
| Provenance | `validateFeedbackProvenance`, `validateGovernedFeedback`, `createGovernedFeedback` (explicit v1 wrap), `governedFeedbackDigest`, `canonicalLearningJSON`, `digestLearningValue` |
| Verification | `createReviewAttestor(jay, options)` (Jay-backed), `reviewerRefFor(identity)`, `attestGovernedFeedback` (host-asserted, off by default in curation), `validateReviewAttestation` |
| Storage | `storeGovernedFeedback(tools, record, options)` |
| Governance | `curateDataset`, `verifyCuratedDataset`, `validateDatasetManifest`, `checkPartitionLeakage`, `traceDatasetLineage` |
| Types | `GovernedFeedback`, `FeedbackProvenance`, `FeedbackOwner`, `ReviewAttestation`, `ReviewAttestor`, `ReviewAttestorOptions`, `CurationPolicy`, `CurationHooks`, `CuratedDataset`, `DatasetManifest`, `TrainingExportV1`, `PartitionLeak`, `CandidateLineage`, `LineageReport`, and the enum types |

## 3. Source files changed

| File | Status |
| --- | --- |
| `src/learning/provenance.ts` | New |
| `src/learning/datasets.ts` | New |
| `src/sdk/learning.ts`, `src/index.ts` | Additive exports |
| `tests/learning-governance.test.mjs`, `tests/fixtures/governed-feedback.mjs` | New (18 tests) |
| `docs/learning-governance.md` | New (full specification) |
| `docs/audits/saraswati-s01.md` | New (this file) |
| `CHANGELOG.md` | `[Unreleased]` → Added |
| `docs/audits/saraswati-s00.md` | D2 and P1-2 updated to the committed outcome |

`git diff HEAD` is **empty** for all of these:

- `src/security/`, `src/agents/`, `src/memory/`, `src/intelligence/`, `src/nn/`, `src/core/`
- `src/bots/`
- `src/learning/index.ts`, `training.ts`, `updates.ts`
- `package.json`

## 4. Data validation rules

- **Snapshots:** every input goes through `snapshotValue`, which rejects
  getters, accessors, non-plain prototypes, cycles, non-finite numbers, depth
  above 32 and more than 10,000 nodes. Byte limits: governed record 48 KiB,
  provenance 8 KiB, attestation 4 KiB.
- **Closed schemas** at every level. Unknown keys are rejected, including an
  own `__proto__`, `verified`, `approved`, `reviewer` and `reviewStatus`.
- **References** (`Ref`) must match `^[A-Za-z0-9._:-]{1,256}$`. That rules out
  URLs, data URIs, whitespace and free text, so no screenshots or content can
  hide in evidence.
- **Restricted content:** the memory module's `privacy()` runs over the whole
  governed record. It rejects bearer tokens, private keys, `sk-` and AKIA keys,
  JWTs, `password=`-style text, email addresses, SSN patterns, and sensitive
  key names.
- **Collection limits:**

  | Collection | Limit |
  | --- | --- |
  | Evidence items | 16 |
  | Redacted fields | 32 |
  | Consent purposes | 3, unique |
  | Records per curation | 1024 |
  | Attestations per curation | 2048 |
  | Rows per split | 256 |
  | Lineage manifests | 1024 |
  | Lineage candidates | 4096 |
  | Ineligible ids | 100 000 |

- **Ranges:** label revision 1–1000, and `supersedes` is required exactly when
  the revision is above 1. Retention must be more than `createdAt` and at most
  `createdAt` + 366 days. Dataset version 1–1,000,000. Ratio weights are
  integers from 0 to 100, with `train` and `heldOut` at least 1.
- **Curation rules** 1–13 are in `docs/learning-governance.md`: validity,
  decision, tenant, retention, consent purpose, attestation digest, review
  status, review method, independence, freshness, `confirmReview`,
  `consentActive`, `select`.

## 5. Provenance schema (v1)

```ts
GovernedFeedback = { format: 'shivax-governed-feedback', version: 1, feedback: FeedbackRecord /* v1 */, provenance }
provenance = {
  version: 1, createdAt,
  source: { kind: 'human-review'|'host-outcome'|'model-output'|'inspection-finding'|'import', id: Ref, group?: Ref },
  owner: { scopeKind: 'personal'|'company', scopeId: Ref },            // tenant scope
  session?: Ref,                                                      // session scope (correlation only)
  subject: { agentVersion?, modelId?, modelVersion?, configurationVersion? },   // model/configuration version
  evidence: { kind, ref: Ref, origin: 'computed'|'design'|'inferred'|'host' }[],
  consent: { ref: Ref, purposes: ('evaluation'|'training'|'routing-analysis')[] },
  label: { revision, supersedes? },
  redaction: { applied, fields, method? },
  retention: { expiresAt }
}
ReviewAttestation = { format: 'shivax-review-attestation', version: 1, feedbackId, labelRevision, contentDigest,
  status: 'verified'|'rejected', method: 'jay-identity'|'host-asserted', reviewerRef, reviewedAt }
```

How each prompt field is covered:

| Prompt field | Where |
| --- | --- |
| Feedback id, task id, bot id | v1 `feedback` |
| Source identifier and type | `source` |
| Tenant scope | `owner` |
| Session scope | `session` |
| Model or configuration version | `subject` |
| Evidence reference | `evidence` |
| Label revision | `label` |
| Reviewer identity (trusted host) and review status | The **attestation**, never the payload |
| Consent purpose | `consent` |
| Retention | `retention` |
| Redaction | `redaction` |

## 6. Dataset manifest schema (v1)

```ts
{ format: 'shivax-dataset-manifest', version: 1, id, datasetVersion, createdAt, curatorRef,
  owner, purpose,                                             // scope, owner, permitted purpose
  partition: { method: 'component-sha256-v1', seed, ratios }, // split assignment rules
  splits: { train|validation|heldOut: { rows, digest } },     // dataset hashes
  records: { feedbackId, split, contentDigest, attestationDigest, labelRevision, reviewMethod, sourceKind }[],
  eligibility: { rules: 'saraswati-s01-v1', checkedAt, reviewMethods },   // training eligibility
  sources, excluded, invalidAttestations, trust: 'untrusted', digest }
```

The manifest holds ids, digests, counts and codes only. It never contains
record content, reviewer references, consent references, session references
or evidence references (asserted in test G2).

## 7. Security boundaries (step 8)

- **Untrusted sources:** LLM output, bot suggestions, Inspectra results,
  browser submissions and imports are all `GovernedFeedback` claims. None of
  them can carry verification: there is no field for it, and unknown keys
  are rejected.
- **Verification is host-only.** `createReviewAttestor` takes the reviewer from
  `jay.verify(root)`, which accepts only Jay-minted contexts with a live
  session. It also requires the review permission, the same tenant, a reviewer
  who is not the source, and host `authorize === true`. Curation additionally
  requires host `confirmReview === true`, the defence against forged
  attestation JSON, because attestations are not signatures. Host-asserted
  reviews need an explicit `allowHostAssertedReviews`.
- **No authority from data.** `curateDataset`, `validate*`, `checkPartitionLeakage`
  and `traceDatasetLineage` take no tool client, firewall, router or model.
  They cannot execute tools, change firewall rules, escalate permissions or
  modify models. `storeGovernedFeedback` calls exactly one fixed tool id,
  whatever the payload contains (test T13), and stays behind Vijay, the
  firewall's protected execution, Chitragupt's namespace and host verification.
- **Preserved unchanged:** the NARASIMHA firewall, Jay and Vijay, RUDRA
  permissions, Chitragupt memory boundaries, and the cost and token limits
  (none of their files changed).
- **No automatic training or activation.** Curation never trains. Test G1
  checks the model is unchanged. No candidate is activated.
- **No secrets or personal content in outputs.** Reports and manifests hold
  only ids, digests and codes. Invalid records are reported with
  `feedbackId: null`, because their ids are untrusted. Nothing is logged.

## 8. Tests and results (steps 9 and 10)

| Command | Result |
| --- | --- |
| `pnpm lint` (`tsc --noEmit && eslint .`) | **exit 0** |
| `pnpm test` (build plus `node --test tests/*.test.mjs`) | **811 tests, 811 pass**, 0 fail, cancelled, skipped or todo. 793 existing (including the 17 learning and 45 memory tests) + 18 new |
| `pnpm build` | **exit 0**, 0 warnings |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports and examples pass; declarations for 12 entries in 5 modes; 460 packaged files |
| `node --test tests/learning-governance.test.mjs` | 18/18 |

| Prompt test | Test name(s) |
| --- | --- |
| 1 Existing v1 compatibility | T1, plus the unchanged `tests/learning.test.mjs` |
| 2 Valid versioned provenance | T2 |
| 3 Invalid provenance | T3 (17 invalid shapes) |
| 4 Spoofed reviewer identity | T4: payload claims, copied context, another Jay's context, no permission, wrong tenant, non-literal `authorize`, revoked session, host-asserted default refusal, forged attestation |
| 5 Unverified feedback rejected | T5: unattested, rejected review, edited after review, `reject` decision |
| 6 Cross-tenant | T6 (even when attested by the other tenant) |
| 7 Duplicate feedback ids | T7 |
| 8 Canonicalized duplicate inputs | T8: key order, repeated imports, conflicting labels, revisions |
| 9 Source-group leakage | T9, including v1 export checks |
| 10 Consent withdrawal | T10: missing purpose, withdrawn, non-literal, hook error, expired retention, re-curation and lineage |
| 11 Stale reviewer authorization | T11: old, future-dated, unconfirmed, hook error, review before creation |
| 12 Oversized or deep input | T12 |
| 13 Malicious model-generated feedback | T13: self-attestation through Jay and host paths, secrets, URI evidence, `__proto__`, inert tool and firewall instructions |
| 14 Deterministic partitioning | T14: order, key order, repeated runs, SHA-256 cross-check with `node:crypto` |
| 15 Existing memory and learning behaviour | T15 (Vijay, approval and verification gates; seven bot ids), plus all existing suites |
| Additional | G1 (splits work with `trainCuratedCandidate`; no mutation), G2 (no content in outputs; tamper detection), G3 (host-asserted opt-in, cancellation, no input mutation) |

Real defects found and fixed during S01:

- Attestations indexed by `(id, revision)` hid conflicting copies. They are now
  indexed by content digest.
- An all-excluded curation threw instead of returning its exclusion report.

The other failures during development were test-side mistakes, each corrected
in the test (`JSON.stringify` key filtering; the Jay error text; Jay checking
session validity when the context is created).

## 9. Migration notes

- **No migration is required.** v1 feedback, v1 training exports and every
  0.2.0 learning API behave as before.
- Governing an existing record is an explicit call:
  `createGovernedFeedback(v1Record, provenance)`. Provenance is never inferred.
- Pre-0.3 v1 exports can be checked with `checkPartitionLeakage`.
- To store governed feedback, a host routes `storeGovernedFeedback` through a
  Vijay-secured bot (see the host bot in T15). Ekalavy gained no capability.
- **Bot id note (from the user's commit `4d0a372`, not from S01):** the code
  bot's id is now `vishwakarma`. Policies and firewall `bots` lists that name
  `vishwakarm` must be updated. S01 changes no bot id. The roadmap's
  universal-instructions list still says `vishwakarm`; the user should update
  that file.

## 10. Known limitations

1. **Integrity is not authenticity.** Attestations and manifests are
   SHA-256-bound, not signed. Anyone who can write the host's attestation or
   manifest storage can produce matching digests. `confirmReview` against the
   host's own journal is the authenticity control. An optional signing hook is
   planned for S04.
2. `attestGovernedFeedback` and `createReviewAttestor` are exported functions.
   The library stops untrusted *data* from verifying itself; it cannot stop
   untrusted *code* in the host process. They must be called only from trusted
   server code.
3. `privacy()` is a conservative pattern filter, not DLP. Hosts can add
   stricter admission rules.
4. Verified-outcome memory is session-scoped and expires (7–90 days). Curated
   splits and manifests are the durable artifact; durable dataset storage is
   S04.
5. Lineage tracing reports affected datasets and candidates. **Removing or
   excluding a record does not remove its influence from already-trained
   weights**; those candidates need review, retraining or rollback (S04).
6. The v1 export limit is 256 rows per split.
7. Partition ratios are approximate, because whole source groups are kept
   together.
8. Open items from S00 that S01 does not address:
   - P0-1: the published `shivax@0.2.0` and `inspectra-engine@1.1.0` fail to
     install together (`ERESOLVE`). Needs the H01 decision.
   - Stale "0.2.0 not published" statements in the docs.
   - The roadmap bot-id text.

## 11. Phase acceptance

| Gate | Status |
| --- | --- |
| Unauthorized or unverified content never becomes training data | **PASS** (T4, T5, T13) |
| Existing v1 learning tests pass | **PASS** (811/811) |
| Cross-tenant, consent, stale-review, duplicate and leakage controls | **PASS** (T6–T11, T14) |
| No changes to firewall, Jay/Vijay, RUDRA, memory, bots or existing learning modules | **PASS** (empty `git diff HEAD`) |
| No new bots, no automatic training, no activation, no publish, push or tag | **PASS** |
| Lint, test, build and verify:package | **PASS** |

**S01: PASS.** S02 has not started.
