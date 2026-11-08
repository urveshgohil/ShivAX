# Memory retrieval ranking (SARASWATI S06)

`MemoryStore.search` (and `list`) keeps its 0.2.0 behaviour by default. The
lexical score is the share of query terms found; ties go to the newest record,
then to the record id; semantic mode uses cosine similarity over stored
embeddings.

S06 adds an **opt-in** `MemoryRanker` that re-orders what the store's search
returns. It also adds `evaluateMemoryRetrieval` for offline relevance
measurement.

- Source: `src/memory/ranking.ts`, `src/learning/retrieval.ts`.
- Tests: `tests/memory-ranking.test.mjs`, with fixture
  `tests/fixtures/retrieval.mjs`.
- `MemoryEngine` was not changed.

## Ranking configuration

```js
import { MemoryRanker } from 'shivax/memory';

const ranker = new MemoryRanker(store, {
  weights: { exact: 2, keyword: 1, quality: 0.5, recency: 0, semantic: 1 },  // defaults
  recency: { halfLifeMs: 7 * 86_400_000 },       // required before recency can have weight
  sourceQuality: (record) => (trustedSources.has(record.metadata.source) ? 1 : 0),  // trusted host code
  suppressDuplicates: true,                      // default
  mode: 'lexical',                               // or 'hybrid'
  security: { jay, policies, capability: 'memory.search' },  // for searchFor(root, …)
  firewall: firewallRuntime,                     // lockdown refuses ranked searches
});
const { results, fallback, candidates, suppressedDuplicates } = await ranker.search(namespace, { text, categories, tags, limit: 10 }, signal);
```

### How the ranker selects and scores

**Candidates.** `store.search(namespace, { text, categories, tags, limit: 50 })`,
plus semantic search in `hybrid` mode. The store applies the namespace (tenant
and session), expiry, category and tag filters first. The ranker re-orders at
most 50 candidates.

**Components**, each in [0, 1]:

| Component | Value |
| --- | --- |
| `exact` | 1 when the record's string value or id equals the query (case-insensitive, trimmed) |
| `keyword` | Share of query terms found (the baseline formula) |
| `quality` | See below |
| `recency` | `2^(-age / halfLifeMs)`, only when `recency` is configured |
| `semantic` | `(cosine + 1) / 2`, only in `hybrid` mode with working embeddings |

`quality` comes from trusted signals only:

- the engine-admitted categories: `verified-outcome` 1 (host-verified at write),
  `user-preference` 0.5 (user-approved), others 0;
- or, if supplied, the host `sourceQuality` callback, clamped to [0, 1]. Errors
  count as 0.

Self-declared record metadata such as `quality` or `verified` is never used.

**Score:** the weighted mean of the components.

**Order:** score, then record id. The order is deterministic and independent of
insertion order and timestamps.

**Duplicates:** records with the same category and canonical value keep only the
best-ranked copy. `suppressedDuplicates` counts the rest.

**Limits:** `limit` is 1–50 (default 10), and the query is at most 1,024
characters.

## Provenance (per result)

| Field | Content |
| --- | --- |
| `record` | `id`, `revision`, `generation`, `category` |
| `source` | `{ ref, origin }` only when the record carries one: `metadata.source` (`record-metadata`) or an S01 governed feedback `provenance.source.id` (`governed-feedback`). Otherwise `null` |
| `scope` | `scopeKind`, `scopeId`, `sessionBound: true` |
| `evidence` | References from `metadata.evidence` or governed-feedback evidence. `available` says whether any exist; `verified: false` always, because the ranker does not verify them |
| `freshness` | `createdAt`, `updatedAt`, `expiresAt`, `ageMs` |
| `trust` | `untrusted` |

Malformed references are dropped, not repaired. Nothing is inferred, so a
citation never appears unless the stored record has it.

## Embedding adapter interface

The existing `MemoryEngineOptions.embeddings` (`MemoryEmbeddingsAdapter`) is
unchanged:

```ts
interface MemoryEmbeddingsAdapter {
  readonly id: string;                  // provider identity; vectors from another id are never compared
  readonly dimensions: number;          // 1..4096, validated at construction
  readonly networkOrigins?: string[];   // [] declares no network use (required for protected use)
  embed(text, { namespace, signal, checkNetworkAccess? }): number[] | Promise<number[]>;
}
```

The engine enforces:

- the exact dimension count;
- finite values;
- non-zero vectors;
- the same provider id when comparing.

Vectors are stored inside each record, so they stay in the tenant's own
namespace and expire and delete with it.

**No provider is required.** `createHashingEmbeddings({ id, dimensions })` is a
deterministic, CPU-only feature-hashing adapter: no network, no model, no vector
database. It captures shared vocabulary, not meaning. Remote or model-based
adapters stay host choices.

## Fallback behaviour

In `hybrid` mode:

| Situation | `fallback` value |
| --- | --- |
| No embeddings configured, or an empty query | `embeddings-unavailable` |
| The provider throws or returns invalid vectors | `embedding-error` |

In both cases ranking continues lexically, with `semantic: 0`, and returns
exactly the lexical result. Cancellation is never swallowed. Records whose stored
vector comes from another provider id are skipped by semantic search but still
ranked lexically.

## Evaluation

`evaluateMemoryRetrieval({ k, queries, baseline, candidate, minQueries, signal })`
takes labelled queries `{ id, text, relevant, forbidden? }`. For each strategy it
reports:

- precision@K, recall@K and MRR (over queries with relevant ids);
- the missing-result rate;
- cross-tenant denial correctness (queries whose forbidden ids never appear);
- the number of forbidden results returned;
- errors.

Its verdict:

- `improved` only with at least `minQueries` labelled queries, a higher MRR, no
  lower recall, no more errors and no forbidden results;
- `regressed` when any of those fail;
- otherwise `no-change` or `insufficient-evidence`.

## Security and privacy limits

- **Store boundaries apply first.** Ranking never widens what `store.search`
  returns, so the namespace (tenant and session), retention, expiry and deletion
  checks of the store always apply.
- **Use `searchFor(root)` for callers.** It derives the namespace from a
  Jay-verified identity and checks Vijay capability permissions. `search(namespace)`
  trusts its caller to have done that.
- **Firewall.** Lockdown or closed admission refuses ranked searches. Protected
  bot access still goes through Chitragupt's services under Vijay and the
  firewall.
- **No hidden state.** The ranker never writes or caches, and keeps no counters.
  Repeated retrieval cannot raise a record's rank, quality or trust, and every
  result stays `untrusted`.
- **Query privacy.** Queries go through the engine's privacy check. Query text is
  also sent to the embedding adapter in `hybrid` mode, so declare remote adapters
  in `networkOrigins`.
- **Candidate cap.** Re-ranking covers the store's top 50 candidates only.
