// Reports progress for a different job id.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', (job) => {
    parentPort.postMessage({ type: 'progress', jobId: job.jobId + 1, epoch: 1, totalEpochs: job.options.epochs, loss: 0.5, validation: null });
});
parentPort.postMessage({ type: 'ready', protocol: 1 });
