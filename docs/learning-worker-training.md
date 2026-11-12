# Worker-based neural training (SARASWATI S03)

`shivax/learning/node` trains `NeuralNet` candidates in Node.js `worker_threads`,
so a long training run does not block the host's event loop.

Source:

- `src/learning/worker-training.ts` (pool, Node only)
- `src/learning/worker-protocol.ts` (validation and messages, no Node imports)
- `src/learning/training-worker.ts` (worker script, bundled as `dist/sdk/learning-worker.mjs`)

Tests: `tests/learning-worker.test.mjs`. Benchmark:
`scripts/benchmark-worker-training.mjs`.

The synchronous APIs (`NeuralNet.train`, `trainOfflineCandidate`,
`trainCuratedCandidate`) are unchanged.

## Runtimes

| Runtime | Support |
| --- | --- |
| Node.js 22 or later (the package's `engines`) | Supported. Tested on Node 22.23.2, Windows x64. ESM and CommonJS builds both start the same ES-module worker |
| Browsers | **Not supported** by this entry. It imports `node:worker_threads`. Browser bundles must import `shivax` or `shivax/learning`, which contain no Node built-ins (checked by test W15). For browser training, run `NeuralNet.train` inside your own Web Worker, as `examples/digits/worker.mjs` does |
| Deno, Bun, edge runtimes | Not tested. They may lack `worker_threads`, `resourceLimits` or `SharedArrayBuffer` |

Bundlers that rewrite `import.meta.url` must copy
`dist/sdk/learning-worker.mjs` next to `learning-node`. They can also pass
`workerURL` (a trusted `file:` URL) to the pool.

## API

```js
import { WorkerTrainingPool, trainOfflineCandidateInWorker, trainCuratedCandidateInWorker } from 'shivax/learning/node';

// One-off job (a private pool of one worker):
const { model, training, weightsUpdated, metrics } = await trainOfflineCandidateInWorker(serialized, inputs, labels, {
  epochs: 200, learningRate: 0.1, batchSize: 16, optimizer: 'adam',      // the same options as TrainOptions
  signal, onProgress, validation: { inputs, labels }, progressEvery: 10, timeoutMs: 60_000,
});

// A long-lived host:
const pool = new WorkerTrainingPool({ concurrency: 2, maxQueued: 16, timeoutMs: 600_000 });
const result = await pool.train({ model: serialized, inputs, labels, options: { epochs: 200 }, signal, onProgress });
await pool.close();   // on shutdown
```

- **Input:** a serialized model (`net.toJSON()` or its JSON text). It is validated
  with `NeuralNet.fromJSON` and copied. The caller's model and any live
  `NeuralNet` are never shared with the worker.
- **Result:** a new candidate in the same `shivax-neural-net` v1 format.
  `weightsUpdated` has the same meaning as in the synchronous API.
- **Not available here:** `onEpoch` and `signal` inside `options`, because
  functions cannot cross a worker boundary. Use `onProgress` and the request's
  `signal`.
- **Activation:** nothing is activated. Promotion still goes through the S02
  gate and `EvaluatedModelUpdates` with host approval.

### Progress

`onProgress({ status, epoch, totalEpochs, loss, validation, cancelRequested })`
is called for each progress message the worker actually sent.

- The worker sends one every `progressEvery` epochs, plus the final epoch.
- `loss` is the value `NeuralNet.train` recorded for that epoch.
- `validation` is `{ loss, accuracy }`, measured in the worker on the optional
  validation set; `accuracy` is `null` for regression. Without a validation set
  it is `null`.
- `status` is `training`, or `cancelling` after a cancel, timeout or shutdown
  request.
- The host rejects repeated or out-of-order epochs. It also rejects a result
  whose final epoch was never reported.
- Exceptions thrown by the callback are ignored.

### Errors

Every failure rejects with `WorkerTrainingError` and a `code`:

| Code | When |
| --- | --- |
| `invalid-input` | Rejected on the host before any worker starts: model, row widths, non-finite values, accessors, targets, options, row and value limits, work limit |
| `cancelled` | The signal aborted |
| `timeout` | The job deadline passed (it covers startup and training) |
| `pool-closed` | `close()` was called |
| `startup-failed` | The script is missing or fails to load, or it is not ready within `startupTimeoutMs` |
| `worker-crashed` | The worker exited or threw after it became ready |
| `resource-limit` | The worker exceeded its V8 heap limit |
| `protocol-error` | The worker sent a malformed, foreign, repeated or inconsistent message |
| `training-failed` | `NeuralNet.train` threw (for example, numeric overflow) |
| `queue-full` | Every slot and queue position is taken |

For `cancelled`, `timeout` and `pool-closed`, `termination` says how the worker
stopped:

- `cooperative`: it stopped at a batch boundary by reading a shared cancel flag.
- `forced`: it did not stop within `terminateGraceMs` and was terminated.

A cancelled job never returns a partial model.

## Limits and defaults

| Setting | Default | Bound |
| --- | --- | --- |
| `concurrency` | 1 | 1–16 (keep it at or below the CPU count) |
| `maxQueued` | 16 | 0–256 |
| `timeoutMs` (per job) | 600 000 | 3 600 000 |
| `startupTimeoutMs` | 10 000 | 60 000 |
| `terminateGraceMs` | 1 000 | 30 000 |
| `resourceLimits.maxOldGenerationSizeMb` | 512 | 16–16 384 |
| `resourceLimits.stackSizeMb` | 4 | 1–64 |
| Rows sent (training + validation) | — | 50 000 (`maxSamples` can lower it) |
| Values sent | — | 4 000 000 Float64, 32 MiB (`maxValues` can lower it) |
| Epochs | 100 | 100 000 |
| Work (epochs × rows × parameters) | — | 250 000 000, the same as `NeuralNet.train` |

The synchronous `trainOfflineCandidate` keeps its own, smaller limits:

- 4 096 rows;
- input that fits its 1 MiB snapshot, which allows 10 000 values in total.

The worker path is meant for larger jobs, up to the limits above.

## Lifecycle and isolation

- **One worker per job.** It is created, reports `ready`, receives exactly one
  job, and is terminated. Workers are never reused, so no state carries over
  between jobs.
- **Data transfer.** Rows are packed into `Float64Array`s and transferred, not
  copied. Messages are plain structured-clone data. The worker re-validates the
  job, and the host re-validates every reply, including running the model
  through `NeuralNet.fromJSON` with a fixed architecture. Nothing is evaluated.
- **No orphaned workers.** A job settles only after its worker's `exit` event.
  `pool.stats.liveWorkers` is 0 after every completion, failure, timeout and
  `close()` (tests W2–W11).

## Equivalence with synchronous training

The worker builds the candidate with `NeuralNet.fromJSON` and calls the same
`NeuralNet.train` with the same options and seed. Rows are `Float64Array`
views holding the same doubles. Validation metrics use `predict`, which does not
advance the random generator.

- **Documented tolerance:** at most 1e-12 absolute per parameter and per loss.
- **Observed:** 0. Parameters and losses are bit-identical for binary,
  multiclass and regression, for SGD, momentum and Adam, and for tanh, relu,
  leakyRelu and sigmoid (W1). The XOR reference output is reproduced exactly.
- The tolerance allows for a future change in JavaScript engine or CPU;
  identical code on one runtime gives identical results.

## Benchmark

From `node --expose-gc scripts/benchmark-worker-training.mjs`, Node 22.23.2,
Windows x64, one run. These are observations on one machine, not guarantees.

| Job | Sync wall | Sync longest timer gap | Worker wall | Worker longest timer gap | Worker startup |
| --- | --- | --- | --- | --- | --- |
| tiny: XOR 2-8-1, 500 epochs | 13 ms | 15 ms | 63 ms | 16 ms | 36 ms |
| medium: 256×16, 16-32-1, 200 epochs | 369 ms | **371 ms** (0 ticks) | 388 ms | **16 ms** (35 ticks) | 22 ms |
| large: 256×32, 32-64-1, 150 epochs, Adam | 785 ms | **786 ms** (0 ticks) | 702 ms | **21 ms** (57 ticks) | 22 ms |

- **Startup:** 10 one-epoch jobs measured spawn to ready at 20.9–21.9 ms
  (median 21.3 ms).
- **Results:** parameters and losses were identical in every job (maximum
  absolute difference 0).
- **Memory:** the change in main-thread heap and RSS was under 2 MB per job,
  apart from a 6 MB RSS rise on the first, tiny synchronous run. Most of the
  memory is in the worker's own heap, which `resourceLimits` bounds.
- **Workers are not always faster.** Small jobs are slower because of startup
  and data transfer. The benefit is responsiveness: the host keeps serving
  timers, I/O and requests while a worker trains.
- **Why timer gaps, not `monitorEventLoopDelay`:** the delay monitor cannot take
  samples while synchronous code blocks the loop, so it reports about 0 for
  synchronous training. The benchmark therefore measures the longest gap between
  ticks of a 10 ms host timer.
