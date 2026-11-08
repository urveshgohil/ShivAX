// Repeats an epoch: fabricated progress must be rejected.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', (job) => {
    const p = { type: 'progress', jobId: job.jobId, epoch: 1, totalEpochs: job.options.epochs, loss: 0.5, validation: null };
    parentPort.postMessage(p);
    parentPort.postMessage(p);
});
parentPort.postMessage({ type: 'ready', protocol: 1 });
