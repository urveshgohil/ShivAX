import { NeuralNet } from '../dist/index.esm.js';

// Synthetic prices only: price = 50,000 + 200 * area. Normalize before training.
const areas = [500, 750, 1000, 1250, 1500, 1750, 2000];
const model = new NeuralNet({ layers: [1, 1], task: 'regression' });
model.train(areas.map(area => [area / 2000]), areas.map(area => [(50000 + 200 * area) / 500000]), {
    epochs: 2000, learningRate: 0.2, batchSize: 7,
});
console.log('Predicted price for 1100 square feet:', Math.round(model.predict([1100 / 2000])[0] * 500000));
console.log('Synthetic expected price:', 270000);
