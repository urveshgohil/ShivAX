import { trainDigits, parseDataset, stratifiedSplit } from './training.mjs';
import { NeuralNet } from '../../dist/index.esm.js';

let model;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'validate') {
            const dataset = parseDataset(data.json), split = stratifiedSplit(dataset.labels);
            self.postMessage({ type: 'validated', requestId: data.requestId, count: dataset.images.length, duplicatesRemoved: dataset.duplicatesRemoved,
                counts: {train:split.train.length,validation:split.validation.length,test:split.test.length}, warning: split.warning });
        } else if (data.type === 'train') {
            model = undefined;
            const result = trainDigits(data.json, data.options, message => self.postMessage(message));
            model = result.model;
            self.postMessage({ type: 'ready', accuracy: result.report.test.accuracy, count: result.report.test.count, report: result.report });
        } else if (data.type === 'predict') {
            if (!model) throw new Error('Train a model first');
            if (!Array.isArray(data.pixels) || data.pixels.length !== 784 || data.pixels.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error('Prediction requires 784 pixels in [0, 1].');
            if (!data.pixels.some(p => p > 0)) throw new Error('Draw a digit first.');
            const probabilities = model.predict(data.pixels);
            const top3 = probabilities.map((probability, digit) => ({ digit, probability }))
                .sort((a, b) => b.probability - a.probability || a.digit - b.digit).slice(0, 3);
            const { digit, probability: score } = top3[0];
            // Heuristic feedback only, not a calibrated confidence threshold.
            const uncertain = score < 0.65 || score - top3[1].probability < 0.15;
            self.postMessage({ type: 'prediction', digit, score, top3, probabilities, uncertain, requestId: data.requestId });
        } else if (data.type === 'export') {
            if (!model) throw new Error('Train or import a model first');
            self.postMessage({type:'exported',json:JSON.stringify(model.toJSON()),requestId:data.requestId});
        } else if (data.type === 'import') {
            if (typeof data.json !== 'string' || data.json.length > 32_000_000) throw new Error('Model must be JSON text within the 32 MB limit');
            const imported = NeuralNet.fromJSON(data.json);
            if (imported.task !== 'multiclass' || imported.layers[0] !== 784 || imported.layers.at(-1) !== 10) throw new Error('Digit model must be multiclass with 784 inputs and 10 outputs');
            model = imported;
            self.postMessage({type:'imported',requestId:data.requestId,layers:[...model.layers]});
        } else if (data.type === 'discard') {
            model = undefined;
            self.postMessage({type:'discarded',requestId:data.requestId});
        }
    } catch (error) {
        self.postMessage({ type: 'error', operation: data.type, requestId: data.requestId, message: error instanceof Error ? error.message : 'Invalid request' });
    }
};
