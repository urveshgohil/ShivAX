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
        // Unique originals prevent duplicate images from leaking between splits.
        const images = Array.from({ length: 100 }, (_, i) => Array.from({ length: 784 }, (_, p) => p === i % 10 ? 1 : p === 100 + i ? 0.01 : 0));
        const labels = images.map((_, i) => i % 10);
        const result = waitFor(worker, 'ready');
        worker.postMessage({ type: 'train', json: JSON.stringify({ images, labels }), options: { augmentation: false } });
        const ready = await result;
        assert.equal(ready.accuracy, 1);
        assert.deepEqual(ready.report.splitCounts, { train: 80, validation: 10, test: 10 });
        assert.equal(ready.report.test.incorrect, 0);
        const prediction = waitFor(worker, 'prediction');
        // An independent inference vector; do not submit a training sample as a test.
        const pixels = Array.from({ length: 784 }, (_, p) => p === 3 ? 0.95 : p === 20 ? 0.05 : 0);
        worker.postMessage({ type: 'predict', pixels, requestId: 17 });
        const response = await prediction;
        assert.equal(response.digit, 3);
        assert.equal(response.requestId, 17);
        assert.equal(response.top3.length, 3);
        assert.equal(new Set(response.top3.map(p => p.digit)).size, 3);
        assert.equal(response.top3[0].probability, response.score);
        assert.ok(response.top3.every(p => p.probability >= 0 && p.probability <= 1));
        assert.ok(response.top3[0].probability >= response.top3[1].probability);
        assert.ok(response.top3[1].probability >= response.top3[2].probability);
        assert.equal(response.uncertain, response.score < 0.65 || response.score - response.top3[1].probability < 0.15);
        const blank = waitFor(worker, 'error');
        worker.postMessage({ type: 'predict', pixels: new Array(784).fill(0) });
        assert.match((await blank).message, /Draw a digit/);
    } finally { await worker.terminate(); }
});
