import { NeuralNet } from '../dist/index.esm.js';

const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]];
const model = new NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });
const result = model.train(inputs, [[0], [1], [1], [0]], { epochs: 2000, learningRate: 0.5, batchSize: 4 });
console.log('Final binary cross-entropy:', result.losses.at(-1));
console.table(inputs.map(input => ({ input: input.join(' XOR '), probability: model.predict(input)[0], prediction: model.predictClass(input) })));
