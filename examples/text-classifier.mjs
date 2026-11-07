import { BagOfWords, NeuralNet } from '../dist/index.esm.js';

const texts = ['win free cash now', 'claim your free prize', 'win cash prize', 'free offer claim now',
    'meeting tomorrow morning', 'project meeting schedule', 'please review project', 'review tomorrow schedule'];
const vectorizer = new BagOfWords(128).fit(texts);
const model = new NeuralNet({ layers: [vectorizer.words.length, 8, 1], task: 'binary' });
model.train(texts.map(text => vectorizer.transform(text)), texts.map((_, i) => [Number(i < 4)]), {
    epochs: 500, learningRate: 0.5, batchSize: 8,
});
for (const text of ['claim free cash', 'project meeting tomorrow']) {
    console.log({ text, spamProbability: model.predict(vectorizer.transform(text))[0] });
}
console.log('Toy examples only; evaluate on independent labeled data before using a real spam filter.');
