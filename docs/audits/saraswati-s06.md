# SARASWATI S06 — Memory retrieval relevance and knowledge quality

| Field | Value |
| --- | --- |
| Phase | S06, run against the S06 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S06 |
| Repository | ShivAX only |
| Branch / base | `feat/saraswati-v0.3.0` at `0f78d2d` (the user's commit of S05). Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisites | S01 and S02 **PASS** (and S03–S05). S05 final state: lint 0, `pnpm test` 881/881, build 0, `verify:package` 0 |
| Acceptance gate | **PASS** |

## 1. Source review (step 1)

Read before editing:

- `src/memory/{engine,types,adapters,services,validation,lifecycle,contracts,errors,index}.ts`
- `src/bots/{chitragupt,storage}.ts`
- `src/learning/{provenance,datasets,benchmarks}.ts`
- `tests/memory.test.mjs`

**Search and retrieval.** `MemoryEngine.search(namespace, { text, categories, tags, limit, mode })`:

- applies the namespace, then expiry (`expiresAt > now`), category and tag
  filters;
- lexical scoring is the share of query terms found in the JSON of value,
  metadata and tags; records with no matching term are dropped;
- semantic mode uses cosine similarity with stored embeddings from the same
  provider id;
- results are sorted by score, then newest `updatedAt`, then id;
- `limit` is at most 50; `list` is search without text.

**Namespaces and access.**

- A namespace is `{ principalId, issuer, sessionId, scopeKind, scopeId }`,
  derived from the Jay identity by `memoryNamespace` in the protected services.
  This gives tenant and session isolation.
- Chitragupt reaches memory only through Vijay-protected tools.

**Retention and deletion.**

- Each category has a TTL (`working` 1 h, `session-history` 1 day, `knowledge`
  30 days, `verified-outcome` 7 days, `user-preference` 30 days; 90 days at
  most).
- `delete` and `purgeExpired` remove records, and expired records are never
  returned.

**Write admission.**

- `verified-outcome` writes require host `outcomeVerified`, and
  `user-preference` writes require `userApproved`.
- All records are `trust: 'untrusted'`.
- Built-in privacy checks reject credentials and personal data.

**Embeddings.** `MemoryEmbeddingsAdapter` (`id`, `dimensions` up to 4096,
`networkOrigins`, `embed`) already exists. Vectors are validated and stored in
records.

**S01 and S02.**

- Governed feedback carries claimed `source` and `evidence` references.
- S02 already scores memory benchmark cases (hits within K, recall@K, MRR, scope
  violations).

## 2. What was added

| Area | Change |
| --- | --- |
| Ranking | `MemoryRanker` (`src/memory/ranking.ts`): opt-in re-ranking of `store.search` candidates; `search(namespace)` and `searchFor(root)` |
| Embeddings | `createHashingEmbeddings`: a deterministic CPU-only adapter implementing the existing interface |
| Evaluation | `evaluateMemoryRetrieval` (`src/learning/retrieval.ts`) |
| Constants and types | `MEMORY_RANKING_LIMITS`, `MemoryRankingOptions`, `RankedMemoryQuery`, `RankedMemoryResult`, `RankedMemorySearch`, `LabelledRetrievalQuery`, `RetrievalEvaluation` |

Exports are additive from `shivax/memory`, `shivax/learning` and `shivax`.
`MemoryEngine`, the adapters, the services, Chitragupt and the default search
are **unchanged**: `git diff HEAD` is empty for them.

## 3. Ranking configuration (step 2)

Ranking is optional; the store's own search stays the default. The full guide
is `docs/memory-ranking.md`.

| Requirement | Implementation |
| --- | --- |
| Exact matches | `exact` = 1 when the string value or id equals the query (trimmed, case-insensitive). Weight 2 by default |
| Keyword relevance | `keyword` = the share of query terms found (the baseline formula). Weight 1 |
| Source quality metadata | `quality` from trusted signals only: engine-admitted `verified-outcome` (1) or `user-preference` (0.5), or a host `sourceQuality` callback (clamped; errors count as 0). Self-declared metadata is ignored (M2, M15). Weight 0.5 |
| Recency, when explicitly configured | `recency` = `2^(-age/halfLifeMs)`. Giving it weight without `recency: { halfLifeMs }` is rejected (M3) |
| Deterministic tie-breaking | Score, then record id. Independent of insertion order and timestamps (M12) |
| Result limits | `limit` 1–50 (default 10); query at most 1,024 characters; at most 50 candidates (M11) |
| Duplicate suppression | Same category and canonical value: the best-ranked copy is kept, and the rest are counted (M4) |

## 4. Provenance (step 3)

Each result carries:

- the record reference (`id`, `revision`, `generation`, `category`);
- the source reference, with its origin (`record-metadata` or
  `governed-feedback`), or `null`;
- the scope (`scopeKind`, `scopeId`, `sessionBound`);
- the score and its components;
- evidence availability, with references and `verified: false`;
- freshness (`createdAt`, `updatedAt`, `expiresAt`, `ageMs`);
- `trust: 'untrusted'`.

**Never fabricated:** sources and references appear only when the stored record
carries them; malformed references are dropped, and claimed sources are labelled
as claims (M5).

## 5. Embedding adapter interface and fallback (step 4)

| Requirement | Status |
| --- | --- |
| No mandatory remote provider | Embeddings are optional, and `createHashingEmbeddings` runs locally on the CPU (`networkOrigins: []`) |
| No mandatory vector database | Vectors are stored inside the tenant's memory records |
| Validated dimensions; finite values; bounded size | Engine checks: exact `dimensions` (1–4096), finite non-zero vectors. Hashing adapter: 8–4096 dimensions (M6) |
| Explicit provider configuration | `MemoryEngineOptions.embeddings` with an `id`. Vectors from another id are never compared (M8) |
| Tenant-scoped storage | Vectors live in namespaced records and expire and delete with them (M16) |
| Fallback to deterministic retrieval | `hybrid` reports `fallback: 'embeddings-unavailable'` or `'embedding-error'` and returns exactly the lexical ranking (M7). Cancellation is never swallowed |

## 6. Memory safety (step 5)

- **Tenant and session isolation:** ranking never widens `store.search`.
  `searchFor(root)` derives the namespace from the Jay-verified identity.
  Another tenant or session sees nothing (M10, M13).
- **Access permissions (Jay and Vijay):** `searchFor` requires `jay.verify` and,
  with `policies`, the capability's permissions. Copied contexts and missing
  permissions are refused (M14).
- **Retention and deletion:** the ranker has no cache, so expired and deleted
  records are never returned (M8, M9).
- **NARASIMHA firewall:** lockdown or closed admission refuses ranked searches
  (M14). Protected bot access still runs through Chitragupt under Vijay and the
  firewall.
- **Untrusted feedback stays untrusted:**
  - the ranker never writes or caches, and keeps no counters;
  - 25 repeated retrievals leave ranks, scores, revisions, categories and trust
    unchanged;
  - self-declared "verified" metadata earns no quality (M15).

## 7. Evaluation results (step 6)

**Setup.** Measured with `evaluateMemoryRetrieval`, K = 3, on the constructed
labelled fixture `tests/fixtures/retrieval.mjs`:

- 10 records in tenant `acme`, session `s1`;
- 1 record in another session and 2 in another tenant;
- 5 queries, 4 of them with ground truth.

**Strategies compared:**

- **Baseline:** the default `MemoryEngine.search`.
- **Candidate:** `MemoryRanker` with a host source allowlist.

| Metric | Baseline | Candidate |
| --- | --- | --- |
| Precision@3 | 0.333 | 0.333 |
| Recall@3 | 1.000 | 1.000 |
| MRR | 0.417 | **1.000** |
| Missing-result rate | 0 | 0 |
| Cross-tenant and cross-session denial | 1.000 | 1.000 |
| Forbidden results returned | 0 | 0 |

Verdict: `improved` at `minQueries: 4`. With `minQueries: 10` the verdict is
`insufficient-evidence`.

**Why the candidate wins on this fixture.** The baseline prefers the newest
matching record, while the candidate ranks first:

- exact matches;
- allowlisted handbook entries;
- engine-verified outcomes.

It also suppresses two duplicates, which leaves precision unchanged here because
each query has one relevant record.

**This is not evidence of real-world relevance improvement.** The fixture was
constructed to exercise these behaviours. A strategy that drops its top result,
or one that leaks a forbidden record, is correctly reported as `regressed` (M13).

## 8. Tests (step 7)

`tests/memory-ranking.test.mjs`, 16 tests:

| Prompt test | Test |
| --- | --- |
| Existing memory API compatibility | M1 (default search and list order unchanged; ranker writes nothing), plus all existing memory tests |
| Default ranking | M2 |
| Opt-in ranking | M3 |
| Duplicate records | M4 |
| Missing evidence | M5 |
| Invalid embedding dimensions | M6 |
| Embedding provider failure | M7 |
| Stale cache records | M8 (no cache; expired records; a stale vector from another provider is ignored) |
| Deleted records | M9 |
| Cross-tenant queries | M10 (tenant, session, Jay-derived namespace) |
| Bounded result counts | M11 |
| Deterministic tie-breaking | M12 |
| Additional | M13 evaluation; M14 Jay, Vijay, firewall and cancellation; M15 no trust escalation; M16 tenant-scoped vectors |

## 9. Files

| File | Status |
| --- | --- |
| `src/memory/ranking.ts`, `src/learning/retrieval.ts` | New |
| `src/memory/index.ts`, `src/sdk/learning.ts`, `src/index.ts` | Additive exports |
| `tests/memory-ranking.test.mjs`, `tests/fixtures/retrieval.mjs` | New |
| `docs/memory-ranking.md`, `docs/audits/saraswati-s06.md` | New |
| `README.md`, `docs/sdk.md`, `CHANGELOG.md` | Entry descriptions and `[Unreleased]` → Added |

**Unchanged.** `git diff HEAD` is empty for:

- `src/memory/{engine,adapters,services,validation,types,lifecycle,contracts,errors}.ts`;
- `src/bots`, `src/security`, `src/agents`, `src/intelligence`, `src/nn`,
  `src/core`;
- every existing test.

## 10. Commands and results

| Command | Result |
| --- | --- |
| `pnpm lint` | **exit 0** (also re-run after the doc edits) |
| `pnpm test` | **897 tests, 897 pass**, 0 fail, cancelled, skipped or todo. 881 existing + 16 new |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0** (re-run after the doc edits). Packed imports for 13 entries; 7 offline examples; packed worker training passed; declarations for 13 entries in 5 modes; **497 packaged files** (was 491) |
| `node --test tests/memory-ranking.test.mjs` | 16/16, two consecutive runs |

**Corrections during development:**

- **Compile errors, fixed in code:**
  - a hashing-vector check whose arrow function TypeScript inferred as a type
    predicate, which narrowed the array to `0[]`;
  - `Array.isArray` widening readonly arrays to `any[]` in the evaluator's
    validation.
- **Test-side expectations, where the code was correct:**
  - M10: a globex identity correctly searches the globex namespace;
  - M13: reversing the baseline is not a worse strategy on this fixture, so a
    strategy that drops the top result is used instead.
- **Cleanup:** an unused stub left in M8 was removed.

## 11. Security and privacy limits

1. **`search(namespace)` trusts its caller.** Use `searchFor(root)` for anything
   driven by a user or bot, so the namespace comes from Jay.
2. **The ranker re-orders at most the store's top 50 candidates.** A relevant
   record outside the store's lexical top 50 cannot be surfaced.
3. **Hashing embeddings capture shared words, not meaning.** Real semantic
   quality needs a model adapter, which the host chooses and declares in
   `networkOrigins`. In `hybrid` mode the query text is sent to that adapter.
4. **`sourceQuality` is trusted host code.** If it trusts writer-controlled
   metadata (for example `metadata.source`), writers can influence quality. Map
   only sources the host controls.
5. **Claimed sources and evidence are claims.** They are labelled but not
   verified by the ranker.
6. **No real-world relevance improvement is claimed.** The evaluation used a
   constructed fixture.
7. **Open items carried over:**
   - S00 P0-1, the peer-range `ERESOLVE` (H01);
   - stale "0.2.0 not published" text;
   - the roadmap's universal rules still list `vishwakarm` (the bot id is
     `vishwakarma`).

## 12. Phase acceptance

| Gate | Status |
| --- | --- |
| Existing memory APIs and default search behaviour preserved; `MemoryEngine` not rewritten | **PASS** (M1, empty diff) |
| Opt-in ranking with exact, keyword, quality, explicit recency, deterministic ties, limits and duplicate suppression | **PASS** (M2–M4, M11, M12) |
| Structured provenance; no fabricated citations | **PASS** (M2, M5) |
| Optional embeddings: no mandatory provider or vector database; validated, bounded, explicit and tenant-scoped; deterministic fallback | **PASS** (M6–M8, M16) |
| Tenant, session, permission, retention, deletion, Jay/Vijay and firewall safety; untrusted data not promoted by retrieval | **PASS** (M8–M10, M14, M15) |
| Labelled evaluation (precision@K, recall@K, MRR, missing rate, cross-tenant denial) against the baseline; no invented improvements | **PASS** (M13, §7) |
| No new dependencies or bots; nothing published | **PASS** |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package` | **PASS** |

**S06: PASS.** S07 has not started.
