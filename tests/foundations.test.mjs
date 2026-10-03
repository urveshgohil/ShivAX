import assert from 'node:assert/strict';
import test from 'node:test';
import { Tensor, dot, sigmoid, softmax, NeuralNet, BagOfWords } from 'shivax';

test('tensor operations match hand-computed rectangular matrices', () => {
    const a = new Tensor([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = new Tensor([7, 8, 9, 10, 11, 12], [3, 2]);
    assert.deepEqual([...a.matmul(b).data], [58, 64, 139, 154]);
    assert.deepEqual([...a.transpose().data], [1, 4, 2, 5, 3, 6]);
    assert.equal(a.get(1, 2), 6);
    assert.equal(a.mean(), 3.5);
    assert.deepEqual([...a.add(2).subtract(1).multiply(2).data], [4, 6, 8, 10, 12, 14]);
    assert.deepEqual(a.reshape([3, 2]).shape, [3, 2]);
    assert.deepEqual([...Tensor.zeros([2, 2]).data], [0, 0, 0, 0]);
    const data = a.data;
    data[0] = 100;
    assert.equal(a.get(0, 0), 1);
});

test('tensors reject malformed shapes, overflow, and excessive work', () => {
    for (const shape of [[], [0], [-1], [1.5], [Infinity], [2048, 2048]]) {
        assert.throws(() => Tensor.zeros(shape));
    }
    assert.throws(() => new Tensor([NaN], [1]));
    assert.throws(() => new Tensor([1e100], [1]));
    assert.throws(() => new Tensor([1], [2]));
    assert.throws(() => Tensor.zeros([2, 2]).add(Tensor.zeros([4])));
    assert.throws(() => Tensor.zeros([2, 3]).matmul(Tensor.zeros([2, 3])));
    assert.throws(() => Tensor.zeros([400, 400]).matmul(Tensor.zeros([400, 400])));
    assert.throws(() => Tensor.zeros([2]).get(-1));
});

test('stable math handles large logits', () => {
    assert.equal(sigmoid(1000), 1);
    assert.equal(sigmoid(-1000), 0);
    assert.deepEqual(softmax([1000, 1000]), [0.5, 0.5]);
    assert.equal(dot([1, 2], [3, 4]), 11);
    assert.throws(() => softmax([Infinity]));
    assert.throws(() => dot([1], [2, 3]));
});

test('XOR learns through hidden layers with deterministic SGD', () => {
    const x = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const y = [[0], [1], [1], [0]];
    const train = () => {
        const net = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });
        const result = net.train(x, y, { epochs: 2000, learningRate: 0.5, batchSize: 4 });
        assert.ok(result.losses.at(-1) < 0.02);
        assert.ok(result.losses.at(-1) < result.losses[0]);
        assert.deepEqual(x.map(row => net.predictClass(row)), [0, 1, 1, 0]);
        return x.map(row => net.predict(row));
    };
    assert.deepEqual(train(), train());
});

test('backpropagation agrees with numerical gradients for every task', () => {
    for (const task of ['binary', 'multiclass', 'regression']) {
        const width = task === 'binary' ? 1 : 2;
        const net = new NeuralNet({ layers: [2, 3, width], task, seed: 7 });
        const input = [0.2, -0.4];
        const target = task === 'binary' ? [1] : task === 'multiclass' ? [0, 1] : [0.1, -0.3];
        const loss = () => net.predict(input).reduce((sum, p, i) => {
            if (task === 'regression') return sum + (p - target[i]) ** 2 / width;
            if (task === 'multiclass') return sum - target[i] * Math.log(p);
            return sum - target[i] * Math.log(p) - (1 - target[i]) * Math.log(1 - p);
        }, 0);
        // Inspect internal buffers only in this numerical-gradient test.
        const entries = [];
        for (const layer of net.parameters) for (const key of ['weights', 'biases']) {
            const buffer = layer[key];
            for (let i = 0; i < buffer.length; i++) {
                const original = buffer[i], epsilon = 1e-5;
                buffer[i] = original + epsilon;
                const plus = loss();
                buffer[i] = original - epsilon;
                const minus = loss();
                buffer[i] = original;
                entries.push({ buffer, i, original, gradient: (plus - minus) / (2 * epsilon) });
            }
        }
        net.train([input], [target], { epochs: 1, learningRate: 0.01, shuffle: false });
        for (const { buffer, i, original, gradient } of entries) {
            assert.ok(Math.abs((original - buffer[i]) / 0.01 - gradient) < 1e-7, `${task} gradient mismatch`);
        }
    }
});

test('linear regression learns a known relation on held-out inputs', () => {
    const net = new NeuralNet({ layers: [1, 1], task: 'regression' });
    net.train([[-1], [-0.5], [0], [0.5], [1]], [[-1], [0], [1], [2], [3]], { epochs: 300, learningRate: 0.1, batchSize: 5 });
    assert.ok(Math.abs(net.predict([0.25])[0] - 1.5) < 0.001);
    assert.throws(() => net.predictClass([0]));
});

test('softmax classifier learns three classes and returns probabilities', () => {
    const net = new NeuralNet({ layers: [2, 6, 3], task: 'multiclass' });
    const x = [[-1, -1], [1, -1], [0, 1]];
    net.train(x, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], { epochs: 300, learningRate: 0.2, batchSize: 3 });
    assert.deepEqual(x.map(row => net.predictClass(row)), [0, 1, 2]);
    assert.ok(Math.abs(net.predict([0.1, 0.9]).reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('network rejects unsafe inputs before training and supports cancellation', () => {
    assert.throws(() => new NeuralNet({ layers: [4096, 4096], task: 'regression' }));
    const net = new NeuralNet({ layers: [1, 1], task: 'binary' });
    const before = net.predict([1]);
    assert.throws(() => net.train([[1]], [[2]]));
    assert.throws(() => net.train([[NaN]], [[1]]));
    assert.throws(() => net.train([[1]], [[1]], { epochs: Infinity }));
    assert.throws(() => net.train([[1]], [[1]], { learningRate: -1 }));
    assert.throws(() => net.predict([1, 2]));
    assert.deepEqual(net.predict([1]), before);
    assert.equal(net.train([[1]], [[1]], { signal: { aborted: true } }).epochsCompleted, 0);
    const result = net.train([[1]], [[1]], { onEpoch: () => false });
    assert.equal(result.epochsCompleted, 1);
    assert.equal(result.stopped, true);
    assert.throws(() => net.train([[1]], [[1]], { onEpoch: () => net.train([[1]], [[1]]) }));
    assert.equal(net.train([[1]], [[1]], { epochs: 1 }).epochsCompleted, 1);
});

test('bag of words is bounded, normalized and handles prototype-like words safely', () => {
    const bow = new BagOfWords(3).fit(['FREE free offer', '__proto__ constructor']);
    assert.equal(bow.words.length, 3);
    assert.deepEqual(bow.transform('free free offer unknown'), [2 / 3, 1 / 3, 0]);
    assert.deepEqual(bow.transform('unseen'), [0, 0, 0]);
    assert.throws(() => new BagOfWords().transform('text'));
    assert.throws(() => new BagOfWords().fit(['!!!']));
    assert.throws(() => bow.transform('x'.repeat(100001)));
    assert.throws(() => new BagOfWords(0));
});
