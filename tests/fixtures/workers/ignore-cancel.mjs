// Becomes ready, then spins without ever reading the cancellation flag.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => { for (;;) { /* busy */ } });
parentPort.postMessage({ type: 'ready', protocol: 1 });
