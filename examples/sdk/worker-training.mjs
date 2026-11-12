// Worker-based asynchronous training (SARASWATI S03). Node.js 22+ only; offline, CPU only.
// Trains the same candidate synchronously and in a worker thread and checks they are identical.
import { NeuralNet } from 'shivax/core';
import { trainOfflineCandidate } from 'shivax/learning';
import { trainOfflineCandidateInWorker } from 'shivax/learning/node';

const x = [[0, 0], [0, 1], [1, 0], [1, 1]], y = [[0], [1], [1], [0]];
const active = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 }).toJSON(); // the model in use; never mutated
const options = { epochs: 1500, learningRate: 0.5, batchSize: 4 };

let ticks = 0;
const timer = setInterval(() => ticks++, 5); // the host stays responsive while the worker trains
const epochs = [];
const worker = await trainOfflineCandidateInWorker(active, x, y, {
    ...options,
    progressEvery: 500,
    onProgress: (p) => epochs.push({ epoch: p.epoch, loss: Number(p.loss.toFixed(5)) }),
    signal: AbortSignal.timeout(60_000),
});
clearInterval(timer);
const sync = trainOfflineCandidate(active, x, y, options);
const candidate = NeuralNet.fromJSON(worker.model);
console.log(JSON.stringify({
    progress: epochs,
    identicalToSynchronous: JSON.stringify(worker.model) === JSON.stringify(sync.model),
    predictions: x.map((row) => candidate.predictClass(row)),
    hostTimerTicksDuringTraining: ticks,
    startupMs: Math.round(worker.metrics.startupMs),
}, null, 2));
