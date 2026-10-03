import { parentPort } from 'node:worker_threads';

// Browser-worker shim to exercise the same demo training/validation code in Node.
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
await import('../../examples/digits/worker.mjs');
parentPort.on('message', data => self.onmessage({ data }));
