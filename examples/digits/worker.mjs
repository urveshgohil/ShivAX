import { NeuralNet, seededRandom } from '../../dist/index.esm.js';

let model;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'train') {
            if (typeof data.json !== 'string' || data.json.length > 5_000_000) throw new Error('Invalid dataset size');
            const { images, labels } = JSON.parse(data.json);
            if (!Array.isArray(images) || !Array.isArray(labels) || images.length !== labels.length || images.length < 50 || images.length > 500) {
                throw new Error('Provide 50–500 images and matching labels.');
            }
            for (let r = 0; r < images.length; r++) {
                if (!Array.isArray(images[r]) || images[r].length !== 784 || images[r].some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
                    throw new Error('Each image must contain 784 finite pixel values in [0, 1].');
                }
                if (!Number.isInteger(labels[r]) || labels[r] < 0 || labels[r] > 9) throw new Error('Labels must be integers from 0 to 9.');
            }
            if (new Set(labels).size !== 10) throw new Error('Include samples of all ten digits.');
            const order = images.map((_, i) => i);
            const random = seededRandom(42);
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            const split = Math.floor(order.length * 0.8);
            const train = order.slice(0, split), test = order.slice(split);
            if (new Set(train.map(i => labels[i])).size !== 10) throw new Error('Training split is missing a class. Supply more balanced data.');
            const x = train.map(i => images[i]);
            const y = train.map(i => Array.from({ length: 10 }, (_, digit) => Number(digit === labels[i])));
            model = new NeuralNet({ layers: [784, 32, 10], task: 'multiclass', seed: 42 });
            for (let epoch = 1; epoch <= 30; epoch++) {
                const result = model.train(x, y, { epochs: 1, learningRate: 0.1, batchSize: 16 });
                self.postMessage({ type: 'progress', epoch, loss: result.losses[0] });
            }
            const correct = test.filter(i => model.predictClass(images[i]) === labels[i]).length;
            self.postMessage({ type: 'ready', accuracy: correct / test.length, count: test.length });
        } else if (data.type === 'predict') {
            if (!model) throw new Error('Train a model first');
            const probabilities = model.predict(data.pixels);
            const score = Math.max(...probabilities);
            self.postMessage({ type: 'prediction', digit: probabilities.indexOf(score), score });
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Invalid request' });
    }
};
