// Trains for real, then sends its completion twice and a late progress message.
import { parentPort } from 'node:worker_threads';
import { NeuralNet } from 'shivax';
parentPort.once('message', (job) => {
    const rows = (p) => Array.from({ length: p.count }, (_, r) => p.values.subarray(r * p.width, (r + 1) * p.width));
    const net = NeuralNet.fromJSON(job.model);
    const { optimizer, ...options } = job.options;
    const training = net.train(rows(job.inputs), rows(job.labels), { ...options, ...(optimizer ? { optimizer } : {}) });
    const last = { type: 'progress', jobId: job.jobId, epoch: job.options.epochs, totalEpochs: job.options.epochs, loss: training.losses.at(-1), validation: null };
    const done = { type: 'done', jobId: job.jobId, model: net.toJSON(), training, cancelled: false };
    parentPort.postMessage(last);
    parentPort.postMessage(done);
    parentPort.postMessage(done);
    parentPort.postMessage(last);
});
parentPort.postMessage({ type: 'ready', protocol: 1 });
