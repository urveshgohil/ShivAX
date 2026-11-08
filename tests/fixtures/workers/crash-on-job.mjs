// Becomes ready, then exits abruptly when it receives a job (simulated native crash / process.exit).
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => process.exit(3));
parentPort.postMessage({ type: 'ready', protocol: 1 });
