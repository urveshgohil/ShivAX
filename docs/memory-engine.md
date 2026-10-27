# Phase 06 — Chitragupt memory engine

Implemented 2026-10-26 (Asia/Calcutta). `src/memory/` adds a portable record
service, persistence adapters, protected Chitragupt actions and optional RUDRA
lifecycle integration. Existing session key/value and feedback services remain
available. Neural weights, MNIST data and digit browser persistence stay separate.

## Record API

`MemoryStore` defines asynchronous `save`, `retrieve`, `update`, `delete`,
`search`, `list`, `export`, and `purgeExpired`. `MemoryEngine` implements that
contract. Every operation takes an explicit namespace and abort signal.
Missing retrieval returns `null`; duplicate save, missing update, stale revision,
invalid input, privacy rejection and corrupted storage use fixed `MemoryError`
codes. Errors never contain stored values or raw backend exception messages.

Records contain version, ID, namespace, category, finite JSON value, metadata,
tags, creation/update/expiry timestamps, revision, generation and `trust: 'untrusted'`.
Optional embeddings include provider ID and finite vector. Returned records and
exports are immutable snapshots. Drafts cannot set namespace, timestamps,
revision, generation, trust or embeddings. Updates preserve category and creation time;
`expectedRevision` rejects stale writes. Metadata/tags are replaced explicitly,
not merged with executable objects. Empty patches fail.

Each new record receives an engine-generated 128-bit random `generation` stored
as 32 hexadecimal characters. Updates preserve it and atomically compare both
generation and revision against the record read before embedding. Deleting or
expiring a record and recreating the same ID produces a new generation, even if
the clock and revision are identical. A stale update fails with `conflict` and
cannot overwrite the replacement's content, category, approval or retention.
Generation identifies a record lifetime; it does not grant permissions.

Version-1 records without generation remain readable/exportable without a storage
write. Their first successful update adds a persistent generation; replacement
records always receive a new one. The public field is optional for legacy records
and custom stores. Malformed persisted generations fail closed. New writes and
legacy updates require the platform's `crypto.getRandomValues`, accessed lazily;
there is no Node-only import or random/time fallback. Missing platform entropy
returns `unavailable`. Upgrade all writers sharing a store; older strict readers
may reject the additive field. Existing adapter locking requirements still apply.

| Category | Default TTL / default maximum | Admission |
| --- | --- | --- |
| `working` | 1 hour | Explicit save |
| `session-history` | 24 hours | Explicit save or opt-in status capture |
| `knowledge` | 30 days | Explicit save; content is still untrusted |
| `verified-outcome` | 7 days | Trusted host `outcomeVerified: true` assertion |
| `user-preference` | 30 days | Trusted host `userApproved: true` assertion |

Host retention rules can change category defaults/maxima, up to 90 days. No
indefinite retention exists. Updating a value does not refresh expiry unless
`ttlMs` is supplied. Reads/search/list/export exclude expired records. Save/update
prune expired records in that namespace; `purgeExpired` physically removes them.
Passive expiry does not rewrite a durable file in the background. The host must
schedule authorized cleanup if disk deletion must happen at the expiry instant.
Deleting the last record removes its namespace envelope as well.

Default limits: 128 records per namespace, 65,536 bytes per record, 1,048,576 bytes
per namespace, queries up to 1,024 characters/32 terms, at most 50 search/list
results (20 by default), 32 tags and embedding dimension at most 4,096. Existing
finite JSON traversal/depth limits also apply. Export includes all live records
in the requested namespace, rather than silently applying the search limit.
Large tool exports must fit the caller's output budget; hosts can use the direct
export API or configure smaller namespace limits.

## Persistence adapters

`MemoryPersistence.transact(namespace, change, signal)` applies a synchronous
read/change callback once, then commits its replacement/removal atomically for
that namespace. Reads omit the mutation. Engines share an adapter instance to
share its serialization boundary; there is no global singleton or transcript.

| Adapter | Implementation and boundary |
| --- | --- |
| `InMemoryMemoryAdapter` | Default test/offline adapter. Explicitly shared instances persist across engine instances. Defaults to 128 namespaces/8 MiB total; limits are configurable. No process persistence. |
| `NodeFileMemoryAdapter` | Host injects `node:fs/promises` and one absolute file path. Reads a versioned JSON envelope, commits through an exclusively created `.pending` sibling and rename, and preserves other namespaces. A failed/pre-cancelled commit leaves the prior file intact and cleans only its own temporary file. Default file bound is 4 MiB and 256 namespace entries. |
| `IndexedDBMemoryAdapter` | Opens the explicitly named database on first use, with a `records` object store and namespace keys. Native readwrite transactions commit or abort atomically and serialize writers. Handles version changes and exposes `close()`. No DOM types appear in public contracts. |

Node example, configured by the trusted application:

```ts
import { MemoryEngine, NodeFileMemoryAdapter } from 'shivax';
const fs = await import('node:fs/promises'); // Optional host import, never a SHIVAX dependency.
const memory = new MemoryEngine({ persistence: new NodeFileMemoryAdapter({
    path: '/absolute/host-selected/memory.json', fs,
}) });
```

The host creates/protects the parent directory and owns file access. Task data
cannot choose paths. Share one file adapter per path and process; multi-process
locking, filesystem crash/fsync guarantees, encryption and symlink defense are
host/backend responsibilities. Never run independent writers against the same
file without host locking. An existing `.pending` file is not overwritten or
removed; recover it deliberately after checking for another writer. The Node
adapter does not expose filesystem methods as agent tools.

Browser example:

```ts
import { MemoryEngine, IndexedDBMemoryAdapter } from 'shivax';
const persistence = new IndexedDBMemoryAdapter({ database: 'my-app-scoped-memory' });
const memory = new MemoryEngine({ persistence });
// Use only in an application environment that permits IndexedDB.
```

An optional factory function can inject browser storage for embedding/tests.
Missing storage returns `unavailable`. No Node import, model runtime, storage
open, timer, filesystem operation or network request occurs at package import.
IndexedDB origin/database access is not authentication; the host still controls
which users may access that origin/device.

## Isolation, privacy and trust

The namespace consists of **issuer + principal ID + session ID + scope kind +
scope ID**. Every operation, including semantic search, deletion and export,
uses the complete key. Categories do not implicitly share across sessions.
Knowledge/preferences are session-isolated by default; explicit cross-session
sharing/import would require another authorized host policy and is not provided.
Persisted record namespaces must match their storage envelope. Malformed records,
duplicate IDs, invalid revisions/timestamps/vectors, unexpected fields and
recognizable stored credentials cause the namespace read to fail closed.

The public engine is a trusted host service, not an authentication API. Bots use
protected tool handlers that derive the namespace from Vijay's verified
`ToolExecutionContext`, ignoring payload IDs. Input schemas reject namespace,
consent and verification overrides. A client-provided user ID cannot establish
identity. No policies, permissions or approvals are automatically granted.

Default admission rejects common credential fields, bearer/JWT/private-key/API
key patterns, obvious password assignments, email addresses, SSNs and common
personal-data field names. It checks values, metadata, tags and record IDs before
storage/embedding. `validateContent` can apply stricter host rules. This is a
conservative admission filter, not comprehensive DLP: applications must project
only necessary non-sensitive facts, and protect durable data and backups.
There is no automatic capture of prompts, tool inputs, outputs, identities or
credentials. No sensitive-data override is built into the record engine.

Host approval for preference records and host verification for outcome records
are separate from content. Protected service callbacks `approvePreference` and
`verifyOutcome` default to deny those categories and must return literal true.
An agent cannot supply those assertions in a record. Labels from a durable file
are descriptive metadata, never proof of authorization or a cryptographic
attestation; the host must protect the storage backend against tampering.

All recalled content stays `untrusted`, including outcomes/preferences. It is
never evaluated, executed, merged into identity/policy, or installed as system
instructions. A stored instruction to grant permissions remains ordinary text.

## Retrieval and optional embeddings

Lexical search deterministically scores the fraction of distinct query terms
present in the record value, metadata or tags. Category/tag filters are applied
within the exact namespace. Results sort by score, newest update, then ordinal
ID. Empty text lists recent records; unmatched terms produce no results. Scores
describe this matching rule, not a model's factual confidence.

Optional `MemoryEmbeddingsAdapter` supplies an ID, dimensions and
`embed(text, { namespace, signal })`. It is called only after content admission,
on save/value update and explicit semantic search. Semantic ranking is actual
cosine similarity, with bounded finite nonzero vectors. Only records embedded
by the configured provider/dimension participate. A missing adapter, wrong
vector or provider failure fails explicitly; no fake semantic result is returned.
The host chooses whether this adapter is local/remote and controls egress,
model loading, cancellation and inference budgets. No embedding dependency or
automatic connection to the Phase 05 model router is added.

## Chitragupt and RUDRA

Chitragupt retains legacy `memory.read`/`memory.write` and adds:

| Capability | Protected tool | Effect |
| --- | --- | --- |
| `memory.save` | `shivax.memory.records.save` | State-changing |
| `memory.retrieve` | `shivax.memory.records.retrieve` | Read-only |
| `memory.update` | `shivax.memory.records.update` | State-changing |
| `memory.delete` | `shivax.memory.records.delete` | State-changing |
| `memory.search` | `shivax.memory.records.search` | Read-only |
| `memory.list` | `shivax.memory.records.list` | Read-only |
| `memory.export` | `shivax.memory.records.export` | Read-only |
| `memory.purge` | `shivax.memory.records.purge` | State-changing |

`MEMORY_ACTIONS` exports immutable input/output schemas and effect metadata.
`registerMemoryServices(tools, store, options?)` registers implementations;
`createSpecialistSystem({ memoryStore, memoryServices, ... })` composes them.
The host must separately register capability/tool policies with those effects,
principal permissions, context tool IDs and explicit approval for writes.
Exports may also be marked approval-required by host policy.

`MemoryTaskLifecycle` uses the actual Chitragupt bot, BotExecutor and Vijay for
each read/write. Configure it through `memoryLifecycle` in
`createSpecialistSystem`, or inject it as RUDRA's `memory` hook alongside security:

```ts
const system = createSpecialistSystem({
    memoryStore: memory,
    security: { jay, policies, options: { approve } },
    memoryLifecycle: {
        recall: task => ({ text: 'host-selected query', categories: ['knowledge'], limit: 3 }),
        record: { id: (task, summary) => `history-${task.taskId}` },
    },
});
```

The example assumes the required memory policies/permissions/tool IDs are
already configured. A unique record ID must be chosen by the host for each
captured task; repeated IDs fail rather than overwrite history silently.

After root admission, recall happens before planning. The planner receives
`memory: { trust: 'untrusted', data }`, separately from unchanged task input.
Combined task/memory bytes are checked against the input budget. Normal routing
and policy validation still apply to every proposed step. Memory cannot grant
new capabilities or skip security. The default capability planner ignores the
optional memory field; model planners must preserve this trust boundary.

Opt-in terminal capture saves only `status`, `completedSteps`, and fixed error
code when failed, under `session-history`. It does not claim successful work is
independently verified. No capture occurs before admission or after cancellation.
Configured recall/capture failures fail the task with `memory-error`; a capture
failure during an already failed task preserves its original error. Completed
step outputs remain visible. Workflow work and memory commits are not one
distributed transaction, so callers must not blindly replay completed effects.

Lifecycle bot calls consume `maxSteps`, share the total deadline and abort
signal, require approval, and keep pending tool work tracked. Budget at least
three attempts for one recall + one main bot + one capture. Traces add payload-free
`memory` events. Cancellation before durable commit avoids publication; once a
backend commit has completed, cancellation cannot undo it. Host adapters must
honor signals; synchronous code cannot be preempted mid-call.

## Files and verification

New source files: `src/memory/types.ts`, `errors.ts`, `validation.ts`,
`adapters.ts`, `engine.ts`, `contracts.ts`, `services.ts`, `lifecycle.ts`, `index.ts`.
Modified source: `src/index.ts`, `src/bots/chitragupt.ts`, `src/bots/system.ts`,
and `src/agents/rudra/{types,index,errors,orchestrator}.ts`.
Tests: new `tests/memory.test.mjs`, `tests/fixtures/memory-idb.mjs`; updated
`tests/package.test.mjs` and the additive capability count in
`tests/specialists.test.mjs`. Added `examples/memory-engine.mjs` and this guide;
architecture and phase documents record the new API and status.

Validation: **323 tests pass**, including 292 existing tests and 31 new memory
tests. Real Node file reopen/update/delete, failed commit cleanup, isolation,
expiry, revision conflicts/concurrency, export, credentials/corruption, actual
cosine ranking, protected operations and lifecycle/step-budget tests pass.
IndexedDB transaction/reopen/abort behavior is tested with a protocol fixture;
no live browser persistence matrix is claimed. Portable ES2020 declaration
consumers and ESM/CJS ML imports without optional globals pass. TypeScript build,
Rollup, type check, existing lint, offline demo and package dry run pass.

The legacy ML engine, dataset hash, serialization, digit demo and package/build
configuration are unchanged. No dependencies, package publication or production
operation. Existing nonfatal Rollup private-field helper warnings remain.
The two previously reported Phase 05 budget-review defects are outside this
phase and remain unresolved; memory does not rely on that router by default.

**Phase 06 complete. Stop before Phase 07.**

## Review fixes — 2026-10-27

Resolved both reproduced defects: delete/recreate races now compare persistent
generation plus revision, and cosine search scales vectors by their maximum
absolute component before unit normalization. The final dot product must be
finite before rounding is clamped to [-1, 1]. Stored embeddings are unchanged;
zero, malformed and non-finite vectors remain rejected.

Changed `src/memory/{engine,types,validation,contracts,errors}.ts` and
`tests/memory.test.mjs`; updated this guide, the phase plan and inspection guide's
cross-phase status. No adapter implementation or ML code was rewritten.

Verification: **371 tests pass**, including **42 memory tests** and all existing
security, ML and Phase 07 regressions. Eleven added tests cover races across
in-memory, file and IndexedDB adapters, legacy records, expiry/recreation, tiny
and subnormal vectors, mixed scales and protected tool output. Build, type checks,
lint and the offline memory demo pass. IndexedDB uses a transaction protocol
fixture, not a live browser. These two Phase 06 review fixes are complete;
Phase 05 budget-review findings remain outside this change.
