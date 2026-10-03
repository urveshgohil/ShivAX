import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import test from 'node:test';

function waitFor(worker, type) {
    return new Promise((resolve, reject) => {
        const receive = message => {
            if (message.type === type) { cleanup(); resolve(message); }
            else if (message.type === 'error') { cleanup(); reject(new Error(message.message)); }
        };
        const fail = error => { cleanup(); reject(error); };
        const cleanup = () => { worker.off('message', receive); worker.off('error', fail); };
        worker.on('message', receive);
        worker.on('error', fail);
    });
}

test('digit worker rejects invalid datasets', { timeout: 5000 }, async () => {
    const worker = new Worker(new URL('./fixtures/digit-worker.mjs', import.meta.url));
    try {
        const result = waitFor(worker, 'error');
        worker.postMessage({ type: 'train', json: '{"images":[],"labels":[]}' });
        assert.match((await result).message, /50–500/);
    } finally { await worker.terminate(); }
});

test('digit worker trains and predicts on synthetic 784-feature data (not MNIST)', { timeout: 30000 }, async () => {
    const worker = new Worker(new URL('./fixtures/digit-worker.mjs', import.meta.url));
    try {
        const images = Array.from({ length: 100 }, (_, i) => Array.from({ length: 784 }, (_, p) => Number(p === i % 10)));
        const labels = images.map((_, i) => i % 10);
        const result = waitFor(worker, 'ready');
        worker.postMessage({ type: 'train', json: JSON.stringify({ images, labels }) });
        assert.equal((await result).accuracy, 1);
        const prediction = waitFor(worker, 'prediction');
        worker.postMessage({ type: 'predict', pixels: images[3] });
        assert.equal((await prediction).digit, 3);
    } finally { await worker.terminate(); }
});
