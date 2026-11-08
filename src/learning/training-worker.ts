import { parentPort } from 'node:worker_threads';
import { WorkerTrainingError, executeWorkerJob } from './worker-protocol.js';

// SARASWATI S03 worker script, bundled on its own as dist/sdk/learning-worker.mjs.
// One worker runs exactly one job, then closes its port; the host terminates it.
const port = parentPort;
if (!port) throw new Error('shivax learning worker must run in a worker thread.');
port.once('message', (raw) => {
    const jobId = raw && typeof raw === 'object' && Number.isSafeInteger((raw as { jobId?: unknown }).jobId) ? (raw as { jobId: number }).jobId : 0;
    try {
        executeWorkerJob(raw, (message) => port.postMessage(message));
    } catch (error) {
        port.postMessage({
            type: 'error',
            jobId,
            code: error instanceof WorkerTrainingError && error.code === 'invalid-input' ? 'invalid-input' : 'training-failed',
            message: error instanceof Error ? error.message.slice(0, 200) : 'Training failed.',
        });
    } finally {
        port.close();
    }
});
port.postMessage({ type: 'ready', protocol: 1 });
