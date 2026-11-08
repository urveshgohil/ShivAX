// SARASWATI S03: worker-based asynchronous neural network training.
// W1-W9 follow the S03 phase prompt (step 9); W10-W16 cover the remaining gates. Offline and deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NeuralNet, trainOfflineCandidate, trainCuratedCandidate, exportTrainingData } from 'shivax';
import * as learning from 'shivax/learning';
import {
    WorkerTrainingPool, WorkerTrainingError, trainOfflineCandidateInWorker, trainCuratedCandidateInWorker,
    WORKER_TRAINING_LIMITS, WORKER_TRAINING_ERROR_CODES, WORKER_TRAINING_PROTOCOL,
} from 'shivax/learning/node';

const require = createRequire(import.meta.url);
const fixture = (name) => new URL(`./fixtures/workers/${name}.mjs`, import.meta.url);
const clone = (v) => JSON.parse(JSON.stringify(v));
const XOR = { x: [[0, 0], [0, 1], [1, 0], [1, 1]], y: [[0], [1], [1], [0]] };
/** Documented equivalence tolerance (absolute, per parameter and per loss). Observed difference: exactly 0. */
const TOLERANCE = 1e-12;
const maxDiff = (a, b) => {
    const flat = (m) => m.parameters.flatMap((l) => [...l.weights, ...l.biases]);
    const x = flat(a), y = flat(b);
    assert.equal(x.length, y.length);
    return x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
};
const code = (expected, termination) => (error) => {
    assert.ok(error instanceof WorkerTrainingError, `expected WorkerTrainingError, got ${error}`);
    assert.equal(error.code, expected, error.message);
    if (termination !== undefined) assert.equal(error.termination, termination);
    return true;
};
/** A job long enough to observe progress and cancellation (several hundred ms on a desktop CPU). */
function longJob() {
    const rows = Array.from({ length: 256 }, (_, i) => Array.from({ length: 16 }, (_, j) => Math.sin(i * 7 + j)));
    const labels = rows.map((r) => [r.reduce((a, b) => a + b, 0) > 0 ? 1 : 0]);
    return { model: new NeuralNet({ layers: [16, 32, 1], task: 'binary', seed: 3 }).toJSON(), rows, labels };
}

test('W1 normal training matches synchronous training exactly for every task, optimizer and activation', async () => {
    const cases = [
        { net: { layers: [2, 8, 1], task: 'binary', seed: 42 }, x: XOR.x, y: XOR.y, options: { epochs: 200, learningRate: 0.5, batchSize: 4 } },
        { net: { layers: [2, 6, 3], task: 'multiclass', seed: 9, activation: 'relu', initialization: 'auto', optimizer: 'adam' }, x: [[0, 1], [1, 0], [1, 1], [0, 0], [0.5, 0.2]], y: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]], options: { epochs: 120, learningRate: 0.05, batchSize: 2 } },
        { net: { layers: [1, 4, 1], task: 'regression', seed: 5, activation: 'leakyRelu', optimizer: { type: 'momentum', momentum: 0.8 } }, x: [[0], [0.5], [1], [1.5]], y: [[0], [1], [2], [3]], options: { epochs: 150, learningRate: 0.02, batchSize: 3, shuffle: false } },
        { net: { layers: [2, 5, 1], task: 'binary', seed: 11, activation: 'sigmoid' }, x: XOR.x, y: XOR.y, options: { epochs: 50, optimizer: 'adam' } },
    ];
    for (const c of cases) {
        const model = new NeuralNet(c.net).toJSON(), before = clone(model);
        const sync = trainOfflineCandidate(model, c.x, c.y, c.options);
        const worker = await trainOfflineCandidateInWorker(model, c.x, c.y, c.options);
        assert.ok(maxDiff(sync.model, worker.model) <= TOLERANCE);
        assert.deepEqual(worker.model, sync.model, `${c.net.task}: expected bit-identical parameters`);
        assert.deepEqual(worker.training, sync.training);
        assert.equal(worker.weightsUpdated, sync.weightsUpdated);
        assert.equal(worker.weightsUpdated, true);
        assert.deepEqual(model, before, 'the supplied model is never mutated');
        const a = NeuralNet.fromJSON(worker.model), b = NeuralNet.fromJSON(sync.model);
        for (const row of c.x) assert.deepEqual(a.predict(row), b.predict(row));
        assert.ok(worker.metrics.startupMs >= 0 && worker.metrics.trainingMs >= 0 && worker.metrics.totalMs >= worker.metrics.startupMs);
    }
    // Prediction accuracy expectation preserved: the established XOR result trains to the same output.
    const xor = await trainOfflineCandidateInWorker(new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 }).toJSON(), XOR.x, XOR.y, { epochs: 2000, learningRate: 0.5, batchSize: 4 });
    assert.ok(Math.abs(NeuralNet.fromJSON(xor.model).predict([0, 0])[0] - 0.0005891139621383979) < 1e-15);
    assert.deepEqual(XOR.x.map((r) => NeuralNet.fromJSON(xor.model).predictClass(r)), [0, 1, 1, 0]);
});

test('W2 cancellation is cooperative at a batch boundary, works before start and while queued, and never yields a model', async () => {
    const job = longJob();
    const controller = new AbortController();
    const seen = [];
    await assert.rejects(
        trainOfflineCandidateInWorker(job.model, job.rows, job.labels, { epochs: 1_500, batchSize: 8, signal: controller.signal, onProgress: (p) => { seen.push(p); if (p.epoch === 2) controller.abort(); } }),
        code('cancelled', 'cooperative')
    );
    assert.ok(seen.length >= 2 && seen.length < 1_500);
    // Before start: rejected without starting a worker.
    const pool = new WorkerTrainingPool();
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(pool.train({ model: job.model, inputs: job.rows, labels: job.labels, signal: aborted.signal }), code('cancelled'));
    assert.equal(pool.stats.started, 0);
    // While queued: leaves the queue without ever starting.
    const busy = pool.train({ model: job.model, inputs: job.rows, labels: job.labels, options: { epochs: 1_500 } });
    const queued = new AbortController();
    const waiting = pool.train({ model: job.model, inputs: job.rows, labels: job.labels, signal: queued.signal });
    assert.equal(pool.stats.queued, 1);
    queued.abort();
    await assert.rejects(waiting, code('cancelled'));
    assert.equal(pool.stats.queued, 0);
    await pool.close();
    await assert.rejects(busy, code('pool-closed'));
    assert.equal(pool.stats.started, 1);
    assert.equal(pool.stats.liveWorkers, 0);
});

test('W3 concurrent jobs respect the concurrency bound, queue limit and produce independent exact results', async () => {
    const pool = new WorkerTrainingPool({ concurrency: 2, maxQueued: 3 });
    const model = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 }).toJSON();
    let maxRunning = 0;
    const jobs = [1, 2, 3, 4, 5].map((n) => pool.train({
        model, inputs: XOR.x, labels: XOR.y, options: { epochs: 100 * n, learningRate: 0.5, batchSize: 4 },
        onProgress: () => { maxRunning = Math.max(maxRunning, pool.stats.running); },
    }));
    await assert.rejects(pool.train({ model, inputs: XOR.x, labels: XOR.y }), code('queue-full'));
    const results = await Promise.all(jobs);
    assert.ok(maxRunning <= 2 && maxRunning >= 1, `max running ${maxRunning}`);
    results.forEach((r, i) => assert.deepEqual(r.model, trainOfflineCandidate(model, XOR.x, XOR.y, { epochs: 100 * (i + 1), learningRate: 0.5, batchSize: 4 }).model));
    assert.deepEqual(pool.stats, { running: 0, queued: 0, liveWorkers: 0, started: 5, closed: false });
    await pool.close();
});

test('W4 malformed input is rejected on the host before any worker starts', async () => {
    const pool = new WorkerTrainingPool({ maxSamples: 64, maxValues: 1_000 });
    const model = new NeuralNet({ layers: [2, 3, 1], task: 'binary', seed: 1 }).toJSON();
    const multi = new NeuralNet({ layers: [2, 2], task: 'multiclass', seed: 1 }).toJSON();
    const getterRow = [0, 0];
    Object.defineProperty(getterRow, 1, { get: () => 1, enumerable: true });
    const extraField = { ...model, extra: true };
    const bad = [
        { model, inputs: [[0, 0, 0]], labels: [[0]] },
        { model, inputs: [[0, NaN]], labels: [[0]] },
        { model, inputs: [[0, Infinity]], labels: [[0]] },
        { model, inputs: [[0, '1']], labels: [[0]] },
        { model, inputs: [getterRow], labels: [[0]] },
        { model, inputs: [[0, 0]], labels: [[2]] },
        { model, inputs: [[0, 0], [1, 1]], labels: [[0]] },
        { model, inputs: [], labels: [] },
        { model, inputs: 'rows', labels: [[0]] },
        { model: multi, inputs: [[0, 0]], labels: [[0.5, 0.6]] },
        { model, inputs: [[0, 0]], labels: [[0]], options: { epochs: 0 } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { epochs: 1.5 } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { batchSize: 5000 } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { learningRate: 11 } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { optimizer: 'rmsprop' } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { optimizer: { type: 'adam', beta1: 1 } } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { onEpoch: () => {} } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { unknown: 1 } },
        { model, inputs: [[0, 0]], labels: [[0]], options: { epochs: 100_000 }, progressEvery: 0 },
        { model, inputs: [[0, 0]], labels: [[0]], validation: { inputs: [[0, 0]], labels: [] } },
        { model, inputs: Array.from({ length: 65 }, () => [0, 0]), labels: Array.from({ length: 65 }, () => [0]) },
        { model, inputs: Array.from({ length: 60 }, () => [0, 0]), labels: Array.from({ length: 60 }, () => [0]), validation: { inputs: Array.from({ length: 10 }, () => [0, 0]), labels: Array.from({ length: 10 }, () => [0]) } },
        { model: extraField, inputs: [[0, 0]], labels: [[0]] },
        { model: '{"format":"shivax-neural-net"', inputs: [[0, 0]], labels: [[0]] },
        { model: { ...model, config: { ...model.config, layers: [2, 5000, 1] } }, inputs: [[0, 0]], labels: [[0]] },
        { model: new NeuralNet({ layers: [64, 64, 1], task: 'regression' }).toJSON(), inputs: [Array(64).fill(0)], labels: [[0]], options: { epochs: 100_000 } },
        { model, inputs: [[0, 0]], labels: [[0]], onProgress: 'not a function' },
        { model, inputs: [[0, 0]], labels: [[0]], timeoutMs: 0 },
    ];
    for (const [i, request] of bad.entries()) await assert.rejects(pool.train(request), code('invalid-input'), `case ${i}`);
    await assert.rejects(pool.train(null), code('invalid-input'));
    assert.equal(pool.stats.started, 0, 'no worker was started for invalid input');
    for (const options of [{ concurrency: 0 }, { concurrency: 17 }, { maxQueued: -1 }, { timeoutMs: 3_600_001 }, { resourceLimits: { maxOldGenerationSizeMb: 1 } }, { workerURL: new URL('https://example.com/w.mjs') }, { workerURL: 'https://example.com/w.mjs' }, { workerURL: 'not a url' }, { workerURL: { href: 'https://example.com/w.mjs' } }, { workerURL: 42 }])
        assert.throws(() => new WorkerTrainingPool(options), code('invalid-input'));
    await pool.close();
});

test('W5 malformed, fabricated or foreign worker messages are protocol errors and are never executed', async () => {
    const run = (name) => new WorkerTrainingPool({ workerURL: fixture(name) }).train({ model: new NeuralNet({ layers: [2, 1], task: 'binary' }).toJSON(), inputs: XOR.x, labels: XOR.y, options: { epochs: 5 } });
    await assert.rejects(run('malformed'), code('protocol-error'));
    assert.equal(globalThis.shivaxPwned, undefined, 'message contents were not executed');
    await assert.rejects(run('wrong-job'), code('protocol-error'));
    await assert.rejects(run('fabricated-progress'), code('protocol-error'));
});

test('W6 worker crashes, uncaught errors and memory exhaustion fail the job and leave no live worker', async () => {
    const make = (name, extra = {}) => new WorkerTrainingPool({ workerURL: fixture(name), ...extra });
    const request = { model: new NeuralNet({ layers: [2, 1], task: 'binary' }).toJSON(), inputs: XOR.x, labels: XOR.y };
    for (const [name, expected, extra] of [['crash-on-job', 'worker-crashed'], ['throw-on-job', 'worker-crashed'], ['out-of-memory', 'resource-limit', { resourceLimits: { maxOldGenerationSizeMb: 32 } }]]) {
        const pool = make(name, extra);
        await assert.rejects(pool.train(request), (error) => code(expected)(error) && !error.message.includes('private-crash-detail'));
        assert.equal(pool.stats.liveWorkers, 0, name);
        assert.equal(pool.stats.running, 0, name);
        // The pool stays usable after a crash.
        await pool.close();
    }
});

test('W7 startup failures: missing script, failing script and a worker that never becomes ready', async () => {
    const request = { model: new NeuralNet({ layers: [2, 1], task: 'binary' }).toJSON(), inputs: XOR.x, labels: XOR.y };
    for (const [name, options] of [['does-not-exist', {}], ['throw-on-start', {}], ['never-ready', { startupTimeoutMs: 100 }]]) {
        // The string form of a file: URL is accepted too.
        const pool = new WorkerTrainingPool({ workerURL: fixture(name).href, ...options });
        await assert.rejects(pool.train(request), code('startup-failed'), name);
        assert.equal(pool.stats.liveWorkers, 0, name);
        await pool.close();
    }
});

test('W8 timeouts stop cooperatively, and a worker that ignores cancellation is terminated', async () => {
    const job = longJob();
    const pool = new WorkerTrainingPool({ timeoutMs: 150 });
    await assert.rejects(pool.train({ model: job.model, inputs: job.rows, labels: job.labels, options: { epochs: 1_500, batchSize: 8 } }), code('timeout', 'cooperative'));
    assert.equal(pool.stats.liveWorkers, 0);
    await pool.close();
    const stuck = new WorkerTrainingPool({ workerURL: fixture('ignore-cancel'), timeoutMs: 100, terminateGraceMs: 50 });
    const started = performance.now();
    await assert.rejects(stuck.train({ model: job.model, inputs: job.rows, labels: job.labels }), code('timeout', 'forced'));
    assert.ok(performance.now() - started < 5_000);
    assert.equal(stuck.stats.liveWorkers, 0);
    await stuck.close();
    // A per-request deadline overrides the pool default.
    const perRequest = new WorkerTrainingPool();
    await assert.rejects(perRequest.train({ model: job.model, inputs: job.rows, labels: job.labels, options: { epochs: 1_500 }, timeoutMs: 100 }), code('timeout'));
    await perRequest.close();
});

test('W9 serialized models round-trip: JSON format v1, fromJSON, and identical predictions', async () => {
    const model = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42, optimizer: 'adam' }).toJSON();
    const result = await trainOfflineCandidateInWorker(JSON.stringify(model), XOR.x, XOR.y, { epochs: 300, learningRate: 0.05 });
    assert.equal(result.model.format, 'shivax-neural-net');
    assert.equal(result.model.version, 1);
    const text = JSON.stringify(result.model);
    const restored = NeuralNet.fromJSON(text);
    assert.deepEqual(restored.toJSON(), result.model);
    const sync = NeuralNet.fromJSON(trainOfflineCandidate(model, XOR.x, XOR.y, { epochs: 300, learningRate: 0.05 }).model);
    for (const row of XOR.x) assert.deepEqual(restored.predict(row), sync.predict(row));
    assert.deepEqual(result.model.config, sync.toJSON().config);
});

test('W10 duplicate completion events settle the job once; late messages are ignored', async () => {
    const model = new NeuralNet({ layers: [2, 4, 1], task: 'binary', seed: 4 }).toJSON();
    const pool = new WorkerTrainingPool({ workerURL: fixture('duplicate-done') });
    const result = await pool.train({ model, inputs: XOR.x, labels: XOR.y, options: { epochs: 30 } });
    assert.deepEqual(result.model, trainOfflineCandidate(model, XOR.x, XOR.y, { epochs: 30 }).model);
    assert.equal(result.metrics.progressEvents, 1);
    assert.equal(pool.stats.liveWorkers, 0);
    await pool.close();
});

test('W11 host shutdown rejects queued and running jobs, terminates every worker and refuses new work', async () => {
    const job = longJob();
    const pool = new WorkerTrainingPool({ concurrency: 2, maxQueued: 4 });
    const jobs = Array.from({ length: 4 }, () => pool.train({ model: job.model, inputs: job.rows, labels: job.labels, options: { epochs: 1_500 } }));
    const settled = Promise.allSettled(jobs);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(pool.stats.running, 2);
    assert.equal(pool.stats.queued, 2);
    await pool.close();
    const outcomes = await settled;
    assert.ok(outcomes.every((o) => o.status === 'rejected' && o.reason.code === 'pool-closed'));
    assert.deepEqual({ ...pool.stats }, { running: 0, queued: 0, liveWorkers: 0, started: 2, closed: true });
    await assert.rejects(pool.train({ model: job.model, inputs: job.rows, labels: job.labels }), code('pool-closed'));
});

test('W12 progress is structured, real and never fabricated; validation metrics are measured', async () => {
    const model = new NeuralNet({ layers: [2, 6, 1], task: 'binary', seed: 2 }).toJSON();
    const validation = { inputs: [[0.1, 0.9], [0.9, 0.1]], labels: [[1], [1]] };
    const events = [];
    const result = await trainOfflineCandidateInWorker(model, XOR.x, XOR.y, { epochs: 20, learningRate: 0.3, progressEvery: 7, validation, onProgress: (p) => events.push(p) });
    assert.deepEqual(events.map((e) => e.epoch), [7, 14, 20]);
    for (const e of events) {
        assert.deepEqual(Object.keys(e).sort(), ['cancelRequested', 'epoch', 'loss', 'status', 'totalEpochs', 'validation']);
        assert.equal(e.status, 'training');
        assert.equal(e.cancelRequested, false);
        assert.equal(e.totalEpochs, 20);
        assert.equal(e.loss, result.training.losses[e.epoch - 1], 'progress loss is the loss the trainer recorded');
        assert.ok(Object.isFrozen(e));
    }
    // The final validation metrics equal an independent measurement of the returned model.
    const net = NeuralNet.fromJSON(result.model);
    let loss = 0, correct = 0;
    validation.inputs.forEach((row, i) => {
        const p = net.predict(row)[0], y = validation.labels[i][0];
        loss -= y * Math.log(Math.max(1e-15, p)) + (1 - y) * Math.log(Math.max(1e-15, 1 - p));
        correct += Number((p >= 0.5) === (y >= 0.5));
    });
    assert.ok(Math.abs(events.at(-1).validation.loss - loss / 2) < 1e-12);
    assert.equal(events.at(-1).validation.accuracy, correct / 2);
    // Without a validation set, no validation metrics are invented.
    const plain = [];
    await trainOfflineCandidateInWorker(model, XOR.x, XOR.y, { epochs: 3, onProgress: (p) => plain.push(p) });
    assert.ok(plain.every((p) => p.validation === null));
    // A throwing progress callback cannot break the job.
    const ok = await trainOfflineCandidateInWorker(model, XOR.x, XOR.y, { epochs: 3, onProgress: () => { throw new Error('host bug'); } });
    assert.equal(ok.training.epochsCompleted, 3);
    // Cancellation state is reported on progress delivered after a cancel request.
    const job = longJob(), controller = new AbortController(), states = [];
    await assert.rejects(trainOfflineCandidateInWorker(job.model, job.rows, job.labels, { epochs: 1_500, batchSize: 512, signal: controller.signal, onProgress: (p) => { states.push(p.status); controller.abort(); } }), code('cancelled'));
    assert.equal(states[0], 'training');
});

test('W13 the event loop stays responsive during worker training; synchronous training blocks it', async () => {
    const job = longJob();
    const options = { epochs: 200, batchSize: 8 };
    // Synchronous: no timer can fire while train() runs.
    let syncTicks = 0;
    const syncTimer = setInterval(() => syncTicks++, 5);
    const syncStart = performance.now();
    trainOfflineCandidate(job.model, job.rows, job.labels, options);
    const syncMs = performance.now() - syncStart;
    const ticksDuringSync = syncTicks;
    clearInterval(syncTimer);
    assert.equal(ticksDuringSync, 0, 'synchronous training blocks the event loop');
    // Worker: timers keep firing.
    let ticks = 0, last = performance.now(), maxGap = 0;
    const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 5);
    const result = await trainOfflineCandidateInWorker(job.model, job.rows, job.labels, options);
    clearInterval(timer);
    assert.deepEqual(result.model, trainOfflineCandidate(job.model, job.rows, job.labels, options).model);
    if (syncMs > 50) {
        assert.ok(ticks >= 5, `expected the host timer to keep firing (ticks ${ticks}, sync ${syncMs.toFixed(0)} ms)`);
        assert.ok(maxGap < Math.max(250, syncMs / 2), `max event-loop gap ${maxGap.toFixed(1)} ms vs sync ${syncMs.toFixed(0)} ms`);
    }
});

test('W14 existing synchronous APIs are unchanged; the curated worker variant matches and rejects the same inputs', async () => {
    const feedback = (id, input, output) => ({ version: 1, id, taskId: 't', botId: 'ekalavy', domain: 'routing', input, output, decision: 'accept' });
    const exp = (...rows) => exportTrainingData(rows, () => true);
    const model = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 1 }).toJSON();
    const training = exp(feedback('a', [0], [0]), feedback('b', [1], [2])), heldOut = exp(feedback('c', [2], [4]));
    const sync = trainCuratedCandidate(model, training, heldOut, { epochs: 50 });
    const worker = await trainCuratedCandidateInWorker(model, training, heldOut, { epochs: 50 });
    assert.deepEqual(worker.model, sync.model);
    assert.deepEqual(worker.training, sync.training);
    assert.deepEqual(worker.heldOut, sync.heldOut);
    const binary = new NeuralNet({ layers: [1, 1], task: 'binary', seed: 1 }).toJSON();
    const invalid = [
        [model, training, training],
        [model, training, exp(feedback('d', [0], [1]))],
        [model, exp(), heldOut],
        [model, { ...training, trust: 'trusted' }, heldOut],
        [model, exp(feedback('e', ['x'], [1])), heldOut],
        [model, exp(feedback('f', [0, 1], [1])), heldOut],
        [binary, exp(feedback('g', [0], [2])), exp(feedback('h', [1], [1]))],
        [binary, exp(feedback('i', [0], [1])), exp(feedback('j', [1], [-1]))],
    ];
    for (const [i, [m, t, h]] of invalid.entries()) {
        assert.throws(() => trainCuratedCandidate(m, t, h, { epochs: 1 }), Error, `sync case ${i}`);
        await assert.rejects(trainCuratedCandidateInWorker(m, t, h, { epochs: 1 }), code('invalid-input'), `worker case ${i}`);
    }
    // The synchronous API keeps its own limits and behaviour.
    assert.equal(trainOfflineCandidate(model, [[0], [1]], [[0], [2]], { epochs: 20 }).weightsUpdated, true);
    assert.throws(() => trainOfflineCandidate(model, Array(4097).fill([0]), Array(4097).fill([0])));
});

test('W15 browser-safe entries never import Node built-ins; the Node entry works from ESM and CommonJS', async () => {
    const dist = new URL('../dist/', import.meta.url);
    const nodeOnly = new Set(['sdk/learning-node.esm.js', 'sdk/learning-node.cjs', 'sdk/learning-worker.mjs']);
    const files = readdirSync(dist, { recursive: true }).map((f) => f.replaceAll('\\', '/'))
        .filter((f) => /^(index\.(esm\.js|cjs)|sdk\/[\w-]+\.(esm\.js|cjs)|chunks\/(esm|cjs)\/.+\.(js|cjs))$/.test(f) && !nodeOnly.has(f));
    assert.ok(files.length > 20);
    for (const file of files) assert.equal(/['"]node:/.test(readFileSync(new URL(file, dist), 'utf8')), false, `${file} must not import Node built-ins`);
    for (const name of ['WorkerTrainingPool', 'trainOfflineCandidateInWorker', 'trainCuratedCandidateInWorker', 'WorkerTrainingError'])
        assert.equal(name in learning, false, `${name} stays out of shivax/learning`);
    const cjs = require('shivax/learning/node');
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(await import('shivax/learning/node')).sort());
    const model = new NeuralNet({ layers: [2, 3, 1], task: 'binary', seed: 8 }).toJSON();
    const viaCjs = await cjs.trainOfflineCandidateInWorker(model, XOR.x, XOR.y, { epochs: 40 });
    assert.deepEqual(viaCjs.model, trainOfflineCandidate(model, XOR.x, XOR.y, { epochs: 40 }).model);
    assert.equal(WORKER_TRAINING_PROTOCOL, 1);
    assert.ok(WORKER_TRAINING_ERROR_CODES.includes('resource-limit'));
    assert.equal(WORKER_TRAINING_LIMITS.maxConcurrency, 16);
});

test('W16 the active model is never shared or mutated, even when training fails or is cancelled', async () => {
    const active = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });
    const snapshot = active.toJSON();
    const frozen = Object.freeze(clone(snapshot));
    const result = await trainOfflineCandidateInWorker(frozen, XOR.x, XOR.y, { epochs: 100, learningRate: 0.5 });
    assert.notDeepEqual(result.model.parameters, snapshot.parameters);
    assert.deepEqual(active.toJSON(), snapshot);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(trainOfflineCandidateInWorker(snapshot, XOR.x, XOR.y, { signal: controller.signal }), code('cancelled'));
    // A numerically failing run (the core suite's overflow case) reports training-failed and changes nothing.
    const linear = new NeuralNet({ layers: [1, 1], task: 'regression', seed: 1 }).toJSON();
    await assert.rejects(trainOfflineCandidateInWorker(linear, [[1e154]], [[1e308]], { epochs: 1, shuffle: false }), (e) => code('training-failed')(e) && /gradient|moment|update|finite/.test(e.message));
    assert.deepEqual(active.toJSON(), snapshot);
});
