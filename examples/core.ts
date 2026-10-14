import {
    NeuralNet, evaluateClassification, evaluateRegression,
    type NeuralNetOptions, type SerializedNeuralNet, type TrainingResult,
} from 'shivax';

const options: NeuralNetOptions = {
    layers: [2, 8, 1], task: 'binary', seed: 42,
    activation: 'leakyRelu', negativeSlope: 0.01, initialization: 'auto',
    optimizer: { type: 'adam', beta1: 0.9, beta2: 0.999, epsilon: 1e-8 },
};
const model = new NeuralNet(options);
const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]];
const labels = [0, 1, 1, 0];
const training: TrainingResult = model.train(inputs, labels.map(label => [label]), {
    epochs: 1200, learningRate: 0.02, batchSize: 4,
});
console.log('XOR final loss:', training.losses.at(-1));
console.log(evaluateClassification(inputs.map(row => model.predict(row)), labels));

// JSON can be stored/transferred by your application; the core has no filesystem dependency.
const exported: SerializedNeuralNet = model.toJSON();
const restored = NeuralNet.fromJSON(JSON.stringify(exported));
console.log('Restored XOR(0, 1):', restored.predict([0, 1]));

const regression = new NeuralNet({ layers: [1, 1], task: 'regression', optimizer: { type: 'momentum', momentum: 0.9 } });
regression.train([[-1], [0], [1]], [[-1], [1], [3]], { epochs: 250, learningRate: 0.05, batchSize: 3 });
console.log(evaluateRegression([[regression.predict([0.25])[0]]], [[1.5]]));
