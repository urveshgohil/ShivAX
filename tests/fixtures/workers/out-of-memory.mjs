// Becomes ready, then allocates until the worker's heap limit is reached.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => { const hold = []; for (;;) hold.push(new Array(1_000_000).fill(Math.random())); });
parentPort.postMessage({ type: 'ready', protocol: 1 });
