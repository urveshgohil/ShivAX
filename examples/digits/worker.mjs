import { trainDigits } from './training.mjs';

let model;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'train') {
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
            self.postMessage({ type: 'prediction', digit, score, top3, uncertain, requestId: data.requestId });
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Invalid request' });
    }
};
