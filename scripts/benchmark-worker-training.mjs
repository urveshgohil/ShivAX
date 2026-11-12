// SARASWATI S03 benchmark: synchronous vs worker training on fixed datasets and seeds.
// Run after `pnpm build`: node scripts/benchmark-worker-training.mjs
// Datasets stay within the synchronous API's limits (1 MiB, 4096 rows, 10 000 values) so both paths run the same job.
// Prints JSON. Numbers depend on the machine and its load; they are observations, not guarantees.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { NeuralNet, trainOfflineCandidate } from 'shivax';
import { trainOfflineCandidateInWorker, WorkerTrainingPool } from 'shivax/learning/node';

const round = (v) => Math.round(v * 100) / 100;
function dataset(rows, width, seed) {
    const inputs = Array.from({ length: rows }, (_, i) => Array.from({ length: width }, (_, j) => Math.sin(seed + i * 7 + j * 3)));
    return { inputs, labels: inputs.map((r) => [r.reduce((a, b) => a + b, 0) > 0 ? 1 : 0]) };
}
const jobs = [
    { name: 'tiny (XOR 2-8-1, 500 epochs)', layers: [2, 8, 1], data: { inputs: [[0, 0], [0, 1], [1, 0], [1, 1]], labels: [[0], [1], [1], [0]] }, options: { epochs: 500, learningRate: 0.5, batchSize: 4 } },
    { name: 'medium (256×16, 16-32-1, 200 epochs)', layers: [16, 32, 1], data: dataset(256, 16, 1), options: { epochs: 200, batchSize: 8 } },
    { name: 'large (256×32, 32-64-1, 150 epochs, adam)', layers: [32, 64, 1], data: dataset(256, 32, 2), options: { epochs: 150, batchSize: 16, optimizer: 'adam', learningRate: 0.01 } },
];

/**
 * Responsiveness = the longest gap between ticks of a 10 ms host timer, including the gap that ends at the
 * first tick after the job. (monitorEventLoopDelay cannot sample while the loop is blocked, so on its own it
 * reports ~0 for synchronous training; its numbers are kept only for the worker path.)
 */
async function measure(run) {
    const histogram = monitorEventLoopDelay({ resolution: 5 });
    let ticks = 0, last = performance.now(), maxGap = 0, wake;
    const timer = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
        wake?.();
    }, 10);
    await new Promise((r) => (wake = r)); // start from a fresh tick
    wake = undefined;
    if (global.gc) global.gc();
    const before = process.memoryUsage();
    histogram.enable();
    const startTicks = ticks;
    maxGap = 0;
    const start = performance.now();
    const result = await run();
    const ms = performance.now() - start;
    const ticksDuring = ticks - startTicks;
    await new Promise((r) => (wake = r)); // close the final gap
    histogram.disable();
    clearInterval(timer);
    const after = process.memoryUsage();
    return {
        result,
        wallMs: round(ms),
        timerTicksDuringJob: ticksDuring,
        maxTimerGapMs: round(maxGap),
        workerLoopDelayP99Ms: round(histogram.percentile(99) / 1e6),
        mainRssDeltaMb: round((after.rss - before.rss) / 1048576),
        mainHeapDeltaMb: round((after.heapUsed - before.heapUsed) / 1048576),
    };
}
const flat = (m) => m.parameters.flatMap((l) => [...l.weights, ...l.biases]);

const report = { node: process.version, platform: `${process.platform}-${process.arch}`, jobs: [] };
for (const job of jobs) {
    const model = new NeuralNet({ layers: job.layers, task: 'binary', seed: 7 }).toJSON();
    const sync = await measure(async () => trainOfflineCandidate(model, job.data.inputs, job.data.labels, job.options));
    const worker = await measure(() => trainOfflineCandidateInWorker(model, job.data.inputs, job.data.labels, job.options));
    const a = flat(sync.result.model), b = flat(worker.result.model);
    const maxAbsDiff = a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
    const strip = ({ result: _r, ...rest }) => rest;
    report.jobs.push({
        name: job.name,
        maxAbsParameterDiff: maxAbsDiff,
        lossesIdentical: JSON.stringify(sync.result.training.losses) === JSON.stringify(worker.result.training.losses),
        sync: strip(sync),
        worker: { ...strip(worker), startupMs: round(worker.result.metrics.startupMs), trainingMs: round(worker.result.metrics.trainingMs) },
    });
}
// Worker startup overhead: spawn-to-ready for 10 one-epoch jobs.
const pool = new WorkerTrainingPool({ concurrency: 1 });
const tiny = new NeuralNet({ layers: [2, 1], task: 'binary' }).toJSON();
const startups = [];
for (let i = 0; i < 10; i++) startups.push((await pool.train({ model: tiny, inputs: [[0, 1]], labels: [[1]], options: { epochs: 1 } })).metrics.startupMs);
await pool.close();
startups.sort((x, y) => x - y);
report.workerStartupMs = { min: round(startups[0]), median: round(startups[5]), max: round(startups[9]) };
console.log(JSON.stringify(report, null, 2));
