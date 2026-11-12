# SARASWATI S04 — Durable model lifecycle, approval and rollback

| Field | Value |
| --- | --- |
| Phase | S04, run against the S04 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S04 |
| Repository | ShivAX only |
| Branch / base | `feat/saraswati-v0.3.0` at `aefad36` (the user's commit of S01 and S02), with the uncommitted S03 work in the tree. Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisites | S01, S02 and S03 **PASS**. S03 final state: lint 0, `pnpm test` 845/845, build 0, `verify:package` 0 |
| Acceptance gate | **PASS** |

## 1. Review of the existing lifecycle (step 1)

Read before editing:

- `src/learning/updates.ts` (`EvaluatedModelUpdates`), `src/learning/index.ts`
- `src/nn/NeuralNet.ts` (`toJSON` / `fromJSON`)
- `src/learning/benchmarks.ts` (S02 reports, gate and policy)
- `src/learning/datasets.ts` (S01 `DatasetManifest`, `validateDatasetManifest`)
- `src/security/firewall/{management,types,runtime}.ts`
- `src/security/{jay,vijay,types}.ts`
- `src/memory/adapters.ts` (the storage adapter pattern)
- the existing firewall, learning, benchmark and worker tests

**`EvaluatedModelUpdates`** (unchanged by S04):

- It holds `{ model, configuration }` snapshots in memory, 16 versions at most.
- `propose` evaluates baseline and candidate with `evaluateDataset`. It accepts
  only if candidate accuracy, completion and validity are all 1 and the approval
  is literal `true`.
- `rollback` is one step back and needs approval.
- It is busy-locked within one instance. State is lost on restart, and there is
  no tenant, audit trail or firewall link.

**Model serialization.** `shivax-neural-net` v1 is an inference snapshot.
`fromJSON` validates a closed schema, at most 1 M parameters and at most 32 M
characters.

**S02 and S01 artifacts.**

- S02 reports carry `digest` and `logicalDigest`, and `assessBenchmarkCandidate`
  is the gate.
- S01 manifests carry a SHA-256 `digest`, an owner, a purpose and split digests.

**Firewall management** already has the durable pattern S04 reuses:

- a host-supplied lease with compare-and-swap, calling `check()` immediately
  before the durable write;
- opaque actor references;
- an asynchronous `authorize` followed by a synchronous `checkAuthorization`
  fence;
- missing or corrupt storage never writing defaults.

**Jay and Vijay.**

- `jay.verify` accepts only Jay-minted contexts with a live, unrevoked session;
  `assertActive` is its synchronous counterpart.
- Vijay governs bot and tool execution. The registry, like firewall management,
  is a host controller, so it uses Jay plus host authorization directly.

## 2. Design

| Area | Choice |
| --- | --- |
| Modules | `src/learning/registry-store.ts` (contract, reference store, errors, `sha256Text`) and `src/learning/registry.ts` (lifecycle). Browser-safe: Web Crypto only, no Node built-ins (still checked by test W15) |
| Exports | Additive `export *` from `shivax` and `shivax/learning`. No new entry point |
| Storage | Host-supplied store (§3). ShivAX owns no database, directory, cloud provider or global mutable state. `InMemoryModelRegistryStore` keeps its maps per instance |
| Evidence | S01 dataset manifests are verified at registration. S02 suites and reports are verified, bound to the version and re-assessed by the registry; they are never accepted as claims |
| Activation | One compare-and-swap of the head (§5) |
| Authenticity | Checksums for integrity. An optional host `signer` covers the head, and through its digests every object. A host approval journal (`approvals.record` / `approvals.confirm`) is required |

## 3. Storage adapter contract (step 2)

```ts
interface ModelRegistryStore {
  putObject(key, text, signal): Promise<void>;        // immutable; key = sha256 of the exact text; idempotent; never partial
  getObject(key, signal): Promise<string | null>;
  readHead(signal): Promise<string | null>;
  compareAndSwapHead(expectedRevision, nextText, nextRevision, check, signal): Promise<boolean>;
  // atomic across every writer; call check() right before the durable write; false = conflict; throw = failure or unknown outcome
}
```

The full requirements are in `docs/learning-registry.md` § Storage adapter
contract.

Reference stores:

- `InMemoryModelRegistryStore`: refuses to overwrite a key with different
  content, and has capacity limits.
- `TempFileRegistryStore`: test fixture; a temporary-directory layout written
  through temporary files and rename. Safe for a single process only.

## 4. Immutable model snapshots (step 3)

The version manifest (`shivax-model-manifest` v1) contains:

- model id and version id;
- registration sequence;
- owner and tenant scope;
- artifact checksum, size, format (`shivax-neural-net@1` or `none`) and
  architecture;
- dataset id, version and S01 digest, plus the stored dataset manifest;
- training configuration (method, options, seed, parent version);
- creation time and creator (an opaque actor reference).

The other required metadata is kept in separate immutable records:

- **Baseline and candidate evaluation references:** the evaluation record.
- **Approval metadata:** the approval record.
- **Activation status:** the head, with the journal as its history.

Everything is canonical JSON, checked by its SHA-256 on every read. Checksums
give integrity only. Authenticity needs the optional `signer`; this is stated in
the code, the guide and the error messages.

## 5. States and transitions (step 4)

```text
candidate  → evaluated | rejected
evaluated  → evaluated | approved | rejected
approved   → evaluated | active   | rejected
active     → approved (superseded) | rolled_back
rolled_back→ evaluated | rejected
rejected   → (terminal)
```

- `MODEL_TRANSITIONS` is enforced by every operation, and head validation checks
  the matching invariants: evidence and approval must exist for the states that
  require them, and at most one version is active.
- There is **no transition from `candidate` or `evaluated` to `active`** (tests
  R4 and R5).
- The Mermaid diagram is in `docs/learning-registry.md` § Lifecycle.

## 6. Approval (step 5)

| Requirement | Control |
| --- | --- |
| Valid evaluation evidence | Suite and reports pass S02 validation. The candidate report is bound to the version's manifest digest and the baseline report to the current active version. Training splits match the S01 dataset. The gate is re-run from stored objects at approval. Evidence older than 7 days by default is stale |
| Passing security benchmarks | Strict gate: mandatory and security cases at 100% with no regression, under any policy. At least one mandatory security case is required (`requireSecurityCases`) |
| Trusted administrator authorization | `jay.verify` plus matching issuer and tenant, then `authorize` returning an opaque actor reference, then `assertActive` and the `checkAuthorization` fence, checked again at commit. Optional separation of duties |
| Approved model manifest | The approval record binds the manifest and evaluation digests. `approvals.record` must return literal `true` before the commit |
| Compatible runtime and model format | The artifact checksum, `NeuralNet.fromJSON`, the architecture against the manifest, `supportedFormats` and the optional `checkCompatibility` are checked at approval, activation and rollback |
| Current firewall policy checks | No lockdown and an open firewall at approval and activation, both before preparation and inside the commit guard. The approval records the firewall policy version, and any later change makes it stale |
| Forged or stale approvals rejected | Rejected when the approval is expired, the active version has changed, the firewall version or security profile has changed, or the binding does not match. A forged approval swapped into storage fails `approvals.confirm` (R9); with a signer, head tampering fails on read |

## 7. Atomic activation (step 6)

Each change works as follows:

1. Hold the per-instance lock.
2. Reload and validate the head.
3. Authorize the administrator, then check `expectedRevision`.
4. Write the immutable objects, verifying each by reading it back.
5. Write the journal entry.
6. Build, checksum and optionally sign the next head (revision + 1, with a
   random operation id).
7. Run the guard.
8. Call `compareAndSwapHead`.

How the requirements are met:

- **Monotonic versioning:** the head revision rises by 1 per change, and
  version sequences come from `nextSequence`.
- **Conflict detection:** `expectedRevision` and the store's compare-and-swap
  revision are both checked; a failed swap gives `conflict`.
- **Ambiguous acknowledgements:** resolved through `lastOperation.id`.
- **Interrupted swaps:** reported as `outcome: 'unknown'` and settled before the
  next operation.
- **Competing activations:** in R10, two activations race inside one instance
  and then across two instances on one store. Exactly one wins and the loser
  gets `conflict`. One version stays active, the revision rises by exactly one,
  and `verify()` passes.

## 8. Rollback (step 7)

- The target is a previously active version in the `approved` state, the most
  recent by default or one named explicitly.
- It must verify (manifest, artifact, format, owner), and `approvals.confirm`
  must still confirm its approval; a revoked approval blocks rollback (R6).
- A fresh administrator authorization is required, and the firewall is checked
  (lockdown blocks rollback unless `allowRollbackDuringLockdown`).

Rollback preserves:

- the tenant scope;
- the audit history (append-only hash chain; R6 asserts the earlier entries are
  unchanged);
- the security settings (firewall and registry profile untouched);
- the approval rules (a rolled-back version must be re-evaluated and re-approved).

## 9. Recovery (step 8)

These rules are deterministic, the same on every run (full table in
`docs/learning-registry.md` § Recovery policy):

| Condition | Outcome | Test |
| --- | --- | --- |
| Interrupted object write | Read-back checksum, then one rewrite | R7 |
| Missing files or objects | `object-missing`; never a silent fallback; `verify()` lists them | R8 (in memory and real files) |
| Corrupt head | `corrupt-registry`, failing closed with no writes | R8 (in memory, real file), R9 (signature) |
| Invalid checksums | `checksum-mismatch` | R8 |
| Host restart | `openModelRegistry` restores everything; `loadActive` verifies | R7, R8 (files) |
| Partial activation | The head swap is the activation; ambiguous commits are resolved by operation id; the host re-applies from `loadActive` | R7, R13 |
| Concurrent writers | Compare-and-swap conflict | R10 |
| Missing head | `registry-missing`; never recreated (`createModelRegistry` refuses an existing head) | R7 |
| Lost journal | Changes are blocked until it is restored | R8 |

## 10. Security controls

- **Identity:** administrators come only from Jay-minted live contexts. Copied
  contexts, revoked sessions and roles revoked before commit are refused (R14).
  Authorization runs before any state is revealed (R14).
- **Tenant isolation:** the tenant is checked for the administrator, the S01
  dataset, the S02 suite, the head and the manifests (R11).
- **Firewall:** NARASIMHA is checked before and inside the commit. Lockdown stops
  approval, activation and, by default, rollback (R12, using a real firewall and
  a lockdown during the commit).
- **No self-asserted state:** payloads cannot mark themselves evaluated or
  approved. Host hooks must return literal `true`.
- **No sensitive content in records:** the journal and records hold opaque actor
  references, ids, digests and reason codes only. Error messages never include
  storage errors, paths or model data.
- **Resource bounds:**
  - 512 versions by default, 1,024 at most;
  - artifacts up to 32 MiB by default, 64 MiB at most;
  - 1 MiB per record, and a commit whose head would exceed 1 MiB is refused;
  - 32 waiting operations per instance;
  - a 30 s timeout by default.
- **Weights and deployment:** model weights are stored exactly and never changed
  (R1). No automatic deployment (R18).

## 11. Migration behaviour

- Nothing migrates automatically, and `EvaluatedModelUpdates` is unchanged (R16).
- Existing `shivax-neural-net` v1 models register as they are, with weights
  unchanged.
- An existing production model is adopted only through the same register,
  evaluate, approve and activate path. There is deliberately no import that
  marks a model active without evidence.
- S01 manifests, S02 suites and reports, and S03 worker-trained models are used
  without change.

## 12. Tests (step 9)

`tests/learning-registry.test.mjs`, 18 tests. Fixtures are in
`tests/fixtures/model-registry.mjs`: an isolated host, a real NARASIMHA
firewall builder, a fault-injecting store wrapper and `TempFileRegistryStore`.

| Prompt test | Test |
| --- | --- |
| Candidate creation | R1: manifest fields, weights unchanged, S01 dataset reference, configuration-only versions, lineage, invalid inputs, stale revision |
| Evaluation transition | R2: binding to the version and the active baseline, untrusted evaluator, missing security cases, invalid evidence |
| Approval transition | R3: only from `evaluated`, host-journal record, separation of duties, refused record |
| Rejected candidate | R4: a security failure gives `rejected` with reasons; rejected is terminal; explicit rejection; an active version cannot be rejected |
| Activation | R5: only from `approved`; supersede; rollback stack; verified load; journal records the displaced version |
| Rollback | R6: verified target, audit preserved, revoked approval, lockdown rule, cross-tenant and unauthorized callers |
| Restart recovery | R7: reopen, ambiguous acknowledgement, failure before commit, torn write, missing head, partial activation |
| Corrupt storage | R8: edited or truncated head, corrupt artifact, missing active manifest followed by rollback repair, missing journal, other tenant or registry, real files deleted or truncated |
| Stale approval | R9: expired, old evidence, active version changed, firewall policy changed, security profile changed, forged approval, signed head tampering |
| Concurrent promotion | R10: one process and two instances |
| Cross-tenant access | R11: administrator, issuer, suite, store, dataset |
| Firewall lockdown during promotion | R12: real firewall lockdown, and lockdown inside the commit window |
| Cancellation | R13: before start, during object writes, timeout, during the swap (`outcome: 'unknown'`, settled by the next operation) |
| Additional | R14 fresh authorization; R15 configuration and store contract; R16 compatibility and additive exports; R17 hash-chained audit; R18 no automatic deployment |

## 13. Files

| File | Status |
| --- | --- |
| `src/learning/registry-store.ts`, `src/learning/registry.ts` | New |
| `src/sdk/learning.ts`, `src/index.ts` | Two additive `export *` lines each |
| `tests/learning-registry.test.mjs`, `tests/fixtures/model-registry.mjs` | New |
| `examples/sdk/model-registry.mjs` | New offline example using the isolated in-memory store |
| `examples/sdk/README.md`, `package.json` (`files`), `scripts/check-sdk-package.mjs` | Example listed, shipped and run from the packed install (7 offline examples) |
| `docs/learning-registry.md` | New guide: diagram, contract, transactions, recovery, controls, migration, limits |
| `README.md`, `docs/sdk.md`, `CHANGELOG.md` | Entry descriptions and `[Unreleased]` → Added |
| `docs/audits/saraswati-s04.md` | New (this file) |

**Unchanged.** `git diff HEAD` (`aefad36`) is empty for:

- `src/security`, `src/agents`, `src/memory`, `src/intelligence`, `src/nn`,
  `src/core`, `src/bots`;
- `src/learning/{index,training,updates,provenance,datasets,benchmarks}.ts`;
- the S00–S02 learning tests.

The S03 sources were not edited.

## 14. Commands and results

| Command | Result |
| --- | --- |
| `pnpm lint` | **exit 0** |
| `pnpm test` | **863 tests, 863 pass**, 0 fail, cancelled, skipped or todo. 845 existing (S03 baseline) + 18 new |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports for 13 entries; 9 documented example files present; **7 offline examples ran, including `model-registry.mjs`**; packed worker training passed; declarations for 13 entries in 5 modes; **488 packaged files** (was 481) |
| `node --test tests/learning-registry.test.mjs` | 18/18, three consecutive runs |
| `node examples/sdk/model-registry.mjs` | exit 0. v1 and v2 are promoted by three different people, untrained v3 is rejected, rollback restores v1, and a restarted instance verifies the artifact and predicts XOR `[0,1,1,0]` |

**Defects found and fixed during S04:**

1. `#mutate` checked `expectedRevision` before authorizing, so a caller without
   the role could probe the revision (`conflict` against `unauthorized`).
   Authorization now runs first; R14 asserts it.
2. `maxVersions` allowed 4,096 versions, whose head could exceed the 1 MiB read
   limit, so a commit could have written an unreadable head. The maximum is now
   1,024 (worst-case head computed at 914,866 characters), and
   `serializeHead` refuses any head over 1 MiB with `capacity` before the
   commit.

**Test-side corrections**, where the registry behaved correctly and my
expectation was wrong:

- R4: a failing candidate also regresses against the baseline.
- R10: competing approvals must be made against the current active version.
- R12: the expected revision was off by one.
- R13: the store's commit-time `check()` refuses an aborted write.
- R9: the signed-head tamper had to change content.
- R8: identical artifacts share one content-addressed object, so each test
  version now gets a distinct seed.
- R9: a stale instance revision correctly gives `conflict`.

## 15. Known limitations

1. **Store atomicity is the host's job.** The registry cannot detect a store
   whose compare-and-swap is not atomic across processes. `TempFileRegistryStore`
   is single-process test code; production needs a transaction, a conditional
   write or a fenced lock.
2. **Integrity is not authenticity.** Without a `signer`, anyone with store
   write access plus the ability to make `approvals.confirm` return true could
   forge state. The host journal and store access control are then the
   defences. The hooks are trusted host code, and in-process hostile code is out
   of scope.
3. **The firewall link is status-based.** It checks mode, admission and policy
   version. Activation is not itself executed as a firewall operation with its
   own allow rule.
4. **Applying the active version is host work.** The registry flips the durable
   pointer, and the host rebuilds its runtime (for example a
   `NeuralModelProvider`) from `loadActive`. Roadmap item G9, automatic provider
   wiring, is not done.
5. **No garbage collection.** Orphaned objects (from aborted changes) and
   rejected versions are kept. There is no pruning, so the version capacity
   limit applies.
6. **Approval stays strict.** Any firewall policy change invalidates pending
   approvals, by design; re-approval is required.
7. **`verify()` is linear.** It walks the whole journal, so very long histories
   take proportionally longer.
8. **Open items carried over:**
   - S00 P0-1, the peer-range `ERESOLVE` (H01);
   - stale "0.2.0 not published" text;
   - the roadmap's universal rules still list `vishwakarm` (the bot id is
     `vishwakarma`).

## 16. Phase acceptance

| Gate | Status |
| --- | --- |
| Host-supplied durable storage; no owned database, directory, cloud or global state | **PASS** (§3) |
| Immutable, checksummed version manifests with every required field; no authenticity claim for checksums | **PASS** (§4, R1, R17) |
| Six states with enforced transitions; no candidate → active | **PASS** (R4, R5) |
| Approval requires evidence, security benchmarks, trusted administrator, manifest, compatibility and firewall; forged and stale approvals rejected | **PASS** (R2, R3, R9, R12, R15) |
| Atomic activation through compare-and-swap with monotonic versions, conflict detection and immutable snapshots; competing activations cannot both win | **PASS** (R5, R10) |
| Authorized rollback to a verified version preserving tenant, audit, security and approval rules | **PASS** (R6) |
| Deterministic recovery for interrupted writes, missing files, corrupt data, checksums, restart, partial activation and concurrent writers | **PASS** (R7, R8, R10, R13) |
| Existing in-memory behaviour, v0.2.0 APIs, firewall, Jay and Vijay, RUDRA and bot ids preserved; no new bots, Playwright or dependencies; no automatic deployment; weights unchanged; nothing published | **PASS** (R16, R18, R1, empty protected diff) |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package` | **PASS** |

**S04: PASS.** S05 has not started.
