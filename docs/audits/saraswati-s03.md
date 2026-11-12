# SARASWATI S03 — Worker-based asynchronous neural network training

| Field | Value |
| --- | --- |
| Phase | S03, run against the S03 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S03 |
| Repository | ShivAX only |
| Branch / base | `feat/saraswati-v0.3.0`, base `4d0a372`, on top of the uncommitted S01 work (partly staged) and S02 work (untracked). Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisites | S01 **PASS** and S02 **PASS**. S02 final state: lint 0, `pnpm test` 829/829, build 0, `verify:package` 0 |
| Acceptance gate | **PASS** |

## 1. Source audit: existing synchronous behaviour (step 1)

Read before editing:

- `src/nn/{NeuralNet,optimizer,activations}.ts`, `src/core/{Tensor,math}.ts`
- `src/learning/{index,training}.ts` (`trainOfflineCandidate`, `trainCuratedCandidate`)
- `examples/digits/worker.mjs`
- `tests/neuralnet-core.test.mjs`, `tests/digit-*.test.mjs`, `tests/learning.test.mjs`
- `rollup.config.mjs`, `scripts/check-sdk-package.mjs`, `tests/sdk.test.mjs`,
  `tests/inspectra-adapter.test.mjs`

**`NeuralNet.train(inputs, targets, options)`**

- Runs synchronously on the calling thread.
- **Limits:**
  - epochs: 1–100 000;
  - batch size: 1–4096;
  - learning rate: in (0, 10];
  - samples: 1–100 000;
  - inputs × (input + output width): at most 10 M;
  - epochs × rows × parameters: at most 250 M.
- **Validation:** every row is checked for width and finiteness. Classification
  targets must be in [0, 1], and multiclass targets must sum to 1 (±1e-6).
- **Determinism:** the order is a seeded Fisher–Yates shuffle using `mulberry32`
  from `config.seed`. Repeated `train()` calls continue the same random stream.
- **Optimizers:** SGD (with the original arithmetic preserved), momentum and
  Adam. `Optimizer.update` checks every candidate value before committing, so a
  numeric failure changes neither the weights nor the optimizer state.
- **Callbacks:** `onEpoch(epoch, loss)` runs after each epoch's full-dataset
  loss; returning `false` stops training. `options.signal.aborted` is read
  before each epoch and each batch.
- **Concurrency:** re-entrant training is refused ("Training is already in
  progress").

**Serialization.** `toJSON()` / `fromJSON()` uses the `shivax-neural-net` v1
format: configuration and parameters only. Optimizer moments and random-number
progress are deliberately left out, so the format is an inference snapshot.
`fromJSON` accepts only plain objects with no accessors, holes or unknown
fields, at most 1 M parameters and at most 32 M characters of text.

**`trainOfflineCandidate(model, inputs, labels, options)`**

- **Input limits:** inputs are copied through `snapshotValue` (1 MiB, 10 000
  values, depth 32), with 4096 rows at most.
- **Training:** clones the model with `fromJSON(JSON.stringify(model))`, trains
  the clone synchronously, and returns `{ model, training, weightsUpdated }`.
- **Isolation:** it never mutates the supplied model.

**`trainCuratedCandidate(model, training, heldOut, options)`**

- Requires two non-empty v1 exports.
- Rejects overlapping ids or inputs between them.
- Requires numeric rows of the model's widths.
- Applies the classification target rules to both splits.
- Then calls `trainOfflineCandidate` and returns `heldOut` untouched.

**Gaps.**

- Training blocks the event loop.
- `signal` is only an `{ aborted }` object read between batches, so in a
  synchronous call nothing can set it.
- The only worker code is the browser digits demo (`self.onmessage`), which is
  not a library API.

## 2. Design

| Requirement | Implementation |
| --- | --- |
| Optional async API that fits the SDK | New entry **`shivax/learning/node`**: `trainOfflineCandidateInWorker`, `trainCuratedCandidateInWorker` (same arguments and result shape as the synchronous functions, plus `metrics`), and `WorkerTrainingPool` for long-lived hosts |
| No eager `node:worker_threads` in browser-safe entries | Only `learning-node.{esm.js,cjs}` and `learning-worker.mjs` import `node:` modules. Test W15 scans every other bundle and chunk. `shivax` and `shivax/learning` export no worker symbols |
| Worker script | `src/learning/training-worker.ts`, bundled on its own as `dist/sdk/learning-worker.mjs`. Both the ESM and CJS builds start it with `new URL('./learning-worker.mjs', import.meta.url)`; Rollup shims `import.meta.url` for CJS |
| Validation shared without Node imports | `src/learning/worker-protocol.ts` packs and validates on the host, runs the job in the worker, and parses worker replies |
| No new dependency | `node:worker_threads` types are declared in `src/types/node-worker.d.ts`. No public declaration references Node or DOM types; `verify:package` type-checks 13 entries in 5 consumer modes |

## 3. Worker lifecycle (step 3)

- **One single-use worker per job.** It is created, posts `ready`, receives
  exactly one job, and is terminated. Workers are never reused.
- **Startup:**
  - a creation error, an `error` event before ready, or an `exit` before ready
    gives `startup-failed`;
  - no `ready` within `startupTimeoutMs` (default 10 s) gives `startup-failed`
    with forced termination.
- **Progress:** forwarded only from real worker messages (see §6).
- **Cancellation (`AbortSignal`):**
  - A shared `Int32Array` flag (on a `SharedArrayBuffer`) is set. The worker's
    `signal.aborted` getter reads it with `Atomics.load` at every batch boundary.
  - If the worker stops on its own, the result is `cooperative`.
  - If it doesn't stop within `terminateGraceMs` (default 1 s), it is
    terminated: `forced`.
  - Cancelling before start or while queued never creates a worker.
  - A cancelled job never returns a partial model.
- **Completion:** the host validates the result, then terminates the worker.
- **Runtime errors:**
  - `NeuralNet` errors arrive as `training-failed`, with a sanitized message of
    at most 200 safe characters;
  - an uncaught exception or an `exit` after ready gives `worker-crashed`;
  - `ERR_WORKER_OUT_OF_MEMORY` gives `resource-limit`.
- **Maximum duration:** a per-job `timeoutMs` (default 10 min, maximum 1 h)
  covers startup and training. It goes through the same cooperative-then-forced
  path.
- **Bounded resources:** each worker gets `resourceLimits`
  (`maxOldGenerationSizeMb` 512 by default, `stackSizeMb` 4). Concurrency is
  1–16 and the queue holds 0–256.
- **Cleanup and no orphans:** a job settles only after `worker.terminate()`
  resolves and its `exit` event has fired. `pool.stats.liveWorkers` is 0 after
  every path tested. `close()` rejects queued jobs, cancels running ones and
  resolves only when every worker has exited.

## 4. Data validation (step 4)

Everything is checked on the host before a worker is started (test W4 confirms
no worker started). The worker checks the job again.

| Item | Rule |
| --- | --- |
| Model architecture | `NeuralNet.fromJSON` (closed schema, at most 8 layers, widths up to 4096, at most 1 M parameters, finite values, no accessors) |
| Dataset size | 1 to `maxSamples` rows per set (default 50 000 for training plus validation). At most `maxValues` numbers (default 4 M Float64, 32 MiB) |
| Input and output dimensions | Every row has exactly the model's input and output width. Rows are plain arrays without accessors, holes or subclasses, or Float32/Float64 arrays. Values are finite numbers |
| Targets | The same classification and multiclass rules as `NeuralNet.train`, for training and validation |
| Optimizer | `resolveOptimizer` rules; closed option keys |
| Epochs and batch size | 1–100 000 and 1–4096; learning rate in (0, 10] |
| Work | epochs × rows × parameters ≤ 250 M, as in `NeuralNet.train` |
| Options | Closed keys. `onEpoch` and `signal` inside `options` are rejected with an explanation |
| Messages | Plain data only (Float64Array buffers are transferred). Replies must have the exact fields, the right job id and protocol version, increasing in-range epochs, a model that passes `fromJSON` with an unchanged architecture, and consistent `losses`, `epochsCompleted` and `stopped`. Anything else is a `protocol-error`. A message is never evaluated: in test W5 a string of code in the model field is rejected and not run |

## 5. Model safety (step 5)

- **Candidates only.** The caller's serialized model is read, validated and
  copied. A live `NeuralNet` is never shared with a worker. W1 and W16 assert
  that the supplied model, including a frozen one, and the active network are
  unchanged after success, cancellation and numeric failure.
- **Unchanged training behaviour.** The worker calls the same `NeuralNet.train`
  with the same seed, optimizer, activations and arguments. The result stays in
  the `shivax-neural-net` v1 JSON format.
- **Accuracy expectations preserved.** W1 reproduces the reference XOR output
  `0.0005891139621383979` exactly, and the class predictions are `[0,1,1,0]`.
- **Nothing activates.** Promotion still requires the S02 gate,
  `EvaluatedModelUpdates` and literal-`true` host approval.

## 6. Progress events (step 6)

`onProgress({ status, epoch, totalEpochs, loss, validation, cancelRequested })`:

- **When:** the worker sends one every `progressEvery` epochs and always for the
  final epoch.
- **`loss`:** the loss `NeuralNet.train` recorded (W12 checks it equals
  `training.losses[epoch-1]`).
- **`validation`:** `{ loss, accuracy }`, measured in the worker on the optional
  validation set. W12 checks it against an independent measurement of the
  returned model. Without a validation set it is `null`.
- **`status` and `cancelRequested`:** `status` is `training`, or `cancelling`
  after a cancel, timeout or shutdown request.
- **No fabrication:**
  - repeated or out-of-order epochs are `protocol-error` (W5);
  - a result whose final epoch was never reported is rejected;
  - the host never synthesises progress.
- **Callback isolation:** callback exceptions are ignored.

## 7. Concurrency (step 7)

| Scenario | Handling | Test |
| --- | --- | --- |
| Multiple requests and configurable concurrency | FIFO queue; at most `concurrency` workers; extra requests get `queue-full` | W3 (5 jobs, concurrency 2, queue 3) |
| Cancellation during training | Cooperative, then forced | W2, W12 |
| Worker crash | `worker-crashed`; the pool stays usable | W6 |
| Worker startup failure | `startup-failed` (missing script, throwing script, never ready) | W7 |
| Duplicate completion events | First result wins; later `done` and `progress` messages are ignored | W10 |
| Host shutdown | `close()` | W11 |
| Unbounded resources | Concurrency ≤ 16, queue ≤ 256, data and work limits, V8 heap limits, deadlines | W4, W6, W8 |

## 8. Equivalence and benchmark (step 8)

- **Documented tolerance:** at most 1e-12 absolute per parameter and per loss.
- **Observed: exactly 0.** W1 covers binary, multiclass and regression; SGD,
  momentum and Adam; tanh, relu, leakyRelu and sigmoid; shuffled and
  unshuffled. W3, W10, W13, W14 and W15 (including CommonJS) confirm it, and so
  does the new packed-install check in `verify:package`.

**Benchmark.** `node --expose-gc scripts/benchmark-worker-training.mjs`, Node
22.23.2, Windows x64, one run. Each job's dataset fits the synchronous API's
limits, so both paths run the same job.

| Job | Sync wall | Sync longest timer gap (ticks) | Worker wall | Worker longest timer gap (ticks) | Worker startup | Max param diff |
| --- | --- | --- | --- | --- | --- | --- |
| tiny: XOR 2-8-1, 500 epochs | 13.2 ms | 15.0 ms (0) | 63.3 ms | 15.9 ms (5) | 36.3 ms | 0 |
| medium: 256×16, 16-32-1, 200 epochs | 369.4 ms | **371.2 ms (0)** | 387.6 ms | **15.5 ms (35)** | 21.7 ms | 0 |
| large: 256×32, 32-64-1, 150 epochs, Adam | 784.5 ms | **786.3 ms (0)** | 702.2 ms | **21.0 ms (57)** | 22.4 ms | 0 |

- **Worker startup** (spawn to ready, 10 runs): 20.9 / 21.3 / 21.9 ms
  (minimum / median / maximum).
- **Memory:** the change in main-thread heap and RSS was under 2 MB per job,
  apart from a 6.3 MB RSS rise on the first, tiny synchronous run. The worker's
  own heap is bounded by `resourceLimits`; it was not measured directly.
- **Responsiveness:** synchronous training blocks the event loop for its whole
  duration; W13 asserts zero timer ticks during a synchronous run. With a worker,
  the longest host timer gap stayed between 15.5 and 21.0 ms.
- **Workers are not always faster.** The tiny job took about 5× longer because
  of startup and transfer. The medium job was about the same, and the large job
  10% faster in this run. Single-run timings are noisy.
- **Measurement note:** `monitorEventLoopDelay` cannot take samples while the
  loop is blocked, so it reported about 0 ms for synchronous training in the
  first benchmark run. The benchmark now measures host timer gaps instead.

## 9. Tests (step 9)

`tests/learning-worker.test.mjs`, 16 tests, offline:

| Prompt test | Test |
| --- | --- |
| Normal training | W1 (4 configurations plus the XOR reference, bit-identical to synchronous) |
| Cancellation | W2 (during training: cooperative; before start; while queued), W12 (status) |
| Concurrent jobs | W3 |
| Malformed input | W4 (28 invalid requests plus 9 invalid pool options; no worker started), W5 (malformed, foreign and fabricated worker messages; contents not executed) |
| Worker crash | W6 (exit, uncaught throw, out of memory gives `resource-limit`) |
| Startup failure | W7 (missing script, throwing script, never ready) |
| Timeout | W8 (cooperative, forced for a worker that ignores the flag, per-request override) |
| Model serialization | W9 (JSON text input, v1 format, `fromJSON` round trip, identical predictions) |
| Existing synchronous API compatibility | W14 (sync and worker parity for curated training; the same 8 invalid inputs rejected by both; sync limits unchanged), plus all 829 existing tests |
| Additional | W10 duplicate completion; W11 host shutdown; W12 progress structure and measured validation; W13 event-loop responsiveness; W15 browser-safe bundles plus the ESM and CJS Node entry; W16 the active model never mutated |

Fixture workers in `tests/fixtures/workers/` simulate misbehaviour: crash,
throw, failure at start, never ready, malformed reply, wrong job, fabricated
progress, duplicate completion, ignored cancellation, out of memory.
`duplicate-done` trains for real with the public `NeuralNet`.

The file passed 5 of 5 repeated runs before integration (timing-sensitive tests
included).

## 10. Files

| File | Status |
| --- | --- |
| `src/learning/worker-protocol.ts` | New (browser-safe protocol, validation, job execution) |
| `src/learning/worker-training.ts` | New (Node-only pool and functions) |
| `src/learning/training-worker.ts` | New (worker script) |
| `src/sdk/learning-node.ts` | New entry `shivax/learning/node` |
| `src/types/node-worker.d.ts` | New (internal ambient types for `node:worker_threads`) |
| `rollup.config.mjs` | `learning-node` entry; `node:` built-ins external; one shared `external` for all three configurations; worker bundle configuration |
| `package.json` | `exports["./learning/node"]` (ESM, CJS, types). No dependency or script change |
| `scripts/check-sdk-package.mjs` | Runs a worker training job from the packed install in ESM and CJS |
| `scripts/benchmark-worker-training.mjs` | New benchmark (not shipped) |
| `tests/learning-worker.test.mjs`, `tests/fixtures/workers/*.mjs` (10 files) | New |
| `docs/learning-worker-training.md` | New guide |
| `README.md`, `docs/sdk.md`, `CHANGELOG.md` | Entry rows, the entry count (12 → 13) and `[Unreleased]` → Added |
| `docs/audits/saraswati-s03.md` | New (this file) |

**Unchanged.** `git diff HEAD` is empty for:

- `src/nn/`, `src/core/`, `src/security/`, `src/agents/`, `src/memory/`,
  `src/intelligence/`, `src/bots/`;
- `src/learning/index.ts`, `training.ts`, `updates.ts`;
- `tests/neuralnet-core.test.mjs`, `tests/learning.test.mjs`,
  `tests/digit-worker.test.mjs`;
- `examples/digits/`.

The S01 sources have an empty diff against the index. S02's
`src/learning/benchmarks.ts` was not edited.

## 11. Commands and results

| Command | Result |
| --- | --- |
| `pnpm lint` | **exit 0** |
| `pnpm test` (build + all tests) | **845 tests, 845 pass**, 0 fail, cancelled, skipped or todo. 829 existing + 16 new |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports for **13 entries**; 8 documented examples present; 6 offline examples ran; **packed worker training passed (ESM and CJS)**; declarations for 13 entries in 5 modes; **481 packaged files** (was 464) |
| `node --test tests/learning-worker.test.mjs` | 16/16, five consecutive runs |
| `node --expose-gc scripts/benchmark-worker-training.mjs` | exit 0 (§8) |

**Defects found and fixed during S03:**

1. An array row with a getter on an element was accepted, and the getter was
   invoked. Rows must now be plain arrays without accessors (W4).
2. The public declaration `workerURL?: URL` failed the packed consumer
   type-check (TS2304 `URL`, no DOM lib). It is now typed structurally as
   `string | { href }`, with a runtime `file:`-only check.
3. The new worker Rollup configuration did not externalize Inspectra, which the
   existing `inspectra-adapter` test requires of every configuration. All
   configurations now share one `external`.
4. The first benchmark misreported synchronous event-loop delay as 0 ms. It now
   measures timer gaps.

Test-side corrections:

- The "long job" in my tests exceeded the existing 250 M work limit. It was
  correctly rejected as `invalid-input`, so the test now uses 1,500 epochs.
- My first numeric-failure case did not overflow. It now uses the core suite's
  overflow case.

## 12. Supported runtimes and browser limitations

- **Supported:** Node.js 22 or later, the package's `engines`. Tested on Node
  22.23.2, win32-x64, through ESM, CommonJS and the packed install.
- **Browsers:** not supported by `shivax/learning/node`, which needs
  `node:worker_threads`, `resourceLimits` and Node's `Worker` file loading.
  Browser code keeps using `shivax` and `shivax/learning`, which import no Node
  built-ins. For browser training, call `NeuralNet.train` inside an app-owned
  Web Worker, as the digits example does. No browser worker adapter ships in
  S03.
- **Other runtimes:** Deno, Bun and edge runtimes are untested.
- **Bundlers:** those that rewrite `import.meta.url` must copy
  `dist/sdk/learning-worker.mjs` alongside the entry, or pass `workerURL`.

## 13. Known limitations

1. **Cancellation granularity is one batch.** A single very large batch cannot
   be interrupted cooperatively; it is force-terminated after
   `terminateGraceMs`.
2. **`resourceLimits` bounds the V8 heap, not CPU.** `ArrayBuffer` backing
   stores (the transferred rows) are partly outside the old-generation limit.
   The host briefly holds both the caller's rows and the packed copy.
3. **Workers are not a security sandbox.** They run trusted package code in the
   same process. `workerURL` is trusted host configuration. Isolation here
   protects the event loop and the active model; it is not a defence against
   hostile code.
4. **Exact equality assumes the same runtime.** Bit-identical results are
   observed on one Node/V8 build and CPU. Across runtimes, only the documented
   1e-12 tolerance is claimed.
5. **Optimizer state starts fresh for every job.** The v1 format is an inference
   snapshot, the same as `trainOfflineCandidate`. Resuming Adam or momentum
   across jobs is not supported.
6. **The deadline covers startup plus training.** Progress validation runs
   `predict` over the validation set at every reported epoch, so a large
   validation set with `progressEvery: 1` adds noticeable cost.
7. **Benchmark figures** come from one run on one machine. The worker heap was
   not measured.
8. **Not part of this phase:** durable candidate registry (S04), shadow routing
   (S05), browser worker adapter, GPU or TensorFlow (excluded by the prompt).
9. **Open items carried over:**
   - S00 P0-1, the peer-range `ERESOLVE` (H01);
   - stale "0.2.0 not published" text;
   - the roadmap's universal rules still list `vishwakarm` (the bot id is
     `vishwakarma` since `4d0a372`).

## 14. Phase acceptance

| Gate | Status |
| --- | --- |
| Roadmap gate: existing synchronous behaviour unchanged | **PASS** (no diff in `src/nn`, `src/core` or the sync learning modules; 829 existing tests pass; W14) |
| Roadmap gate: long tasks do not block the Node host event loop | **PASS** (W13; benchmark: longest timer gap 15.5–21.0 ms in the worker, against 371–786 ms synchronously) |
| Optional async API; no eager Node built-ins in browser-safe entries | **PASS** (W15) |
| Lifecycle: startup, progress, abort, completion, errors, termination, cleanup, deadline, resource bounds, no orphans | **PASS** (W2, W6–W8, W10, W11) |
| Validation of data, architecture, optimizer, epochs, batch, limits; malformed messages rejected without execution | **PASS** (W4, W5) |
| Candidate-only training; seed, optimizers, activations, JSON format and accuracy preserved | **PASS** (W1, W9, W16) |
| Structured, non-fabricated progress with validation metrics | **PASS** (W12, W5) |
| Concurrency, crash, startup failure, duplicate completion, shutdown | **PASS** (W3, W6, W7, W10, W11) |
| Numeric equivalence within the documented tolerance; benchmark recorded; no "always faster" claim | **PASS** (§8) |
| No GPU or TensorFlow, no new dependencies, no Playwright, no new bots, no automatic training or activation, no publish, push or tag | **PASS** |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package` | **PASS** |

**S03: PASS.** S04 has not started.
