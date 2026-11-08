// Sends a completion whose model is a string of code. It must be rejected as data, never executed.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', (job) => {
    parentPort.postMessage({ type: 'done', jobId: job.jobId, model: 'globalThis.shivaxPwned = true', training: { losses: [0], epochsCompleted: 1, stopped: false }, cancelled: false });
});
parentPort.postMessage({ type: 'ready', protocol: 1 });
