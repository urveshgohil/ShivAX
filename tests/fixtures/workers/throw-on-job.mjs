// Becomes ready, then throws an uncaught exception during the job.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => { setTimeout(() => { throw new Error('private-crash-detail'); }, 0); });
parentPort.postMessage({ type: 'ready', protocol: 1 });
