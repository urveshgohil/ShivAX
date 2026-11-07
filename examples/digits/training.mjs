import { NeuralNet, seededRandom } from '../../dist/index.esm.js';

export const DEFAULT_OPTIONS = Object.freeze({ epochs: 30, batchSize: 16, learningRate: 0.1, seed: 42, patience: 5, augmentation: true,
    rotation: 8, translation: 1.5, scale: 0.08, thickness: 0.15, intensity: 0.1 });

export function trainingOptions(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid training options');
    for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_OPTIONS, key)) throw new Error(`Unknown option: ${key}`);
    const options = { ...DEFAULT_OPTIONS, ...input };
    for (const [key, min, max, integral] of [
        ['epochs',1,100,true],['batchSize',1,128,true],['learningRate',0.0001,1,false],['seed',0,0xffffffff,true],['patience',0,20,true],
        ['rotation',0,10,false],['translation',0,2,false],['scale',0,0.1,false],['thickness',0,0.2,false],['intensity',0,0.15,false],
    ]) {
        const value = options[key];
        if (!Number.isFinite(value) || value < min || value > max || (integral && !Number.isInteger(value))) throw new Error(`${key} must be ${integral ? 'an integer ' : ''}in [${min}, ${max}]`);
    }
    if (typeof options.augmentation !== 'boolean') throw new Error('augmentation must be boolean');
    return options;
}

export function parseDataset(json) {
    if (typeof json !== 'string' || json.length > 5_000_000 || new TextEncoder().encode(json).length > 5_000_000) throw new Error('Invalid dataset size (maximum 5 MB)');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') throw new Error('Expected images/labels JSON');
    const { images, labels } = parsed;
    if (!Array.isArray(images) || !Array.isArray(labels) || images.length !== labels.length || images.length < 50 || images.length > 500) throw new Error('Provide 50–500 images and matching labels.');
    const seen = new Map(), uniqueImages = [], uniqueLabels = [], sourceIndices = [];
    for (let r = 0; r < images.length; r++) {
        if (!Array.isArray(images[r]) || images[r].length !== 784 || images[r].some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error('Each image must contain 784 finite pixel values in [0, 1].');
        if (!Number.isInteger(labels[r]) || labels[r] < 0 || labels[r] > 9) throw new Error('Labels must be integers from 0 to 9.');
        if (!images[r].some(p => p > 0)) throw new Error(`Image ${r} is blank`);
        const key = JSON.stringify(images[r]);
        if (seen.has(key)) {
            if (seen.get(key) !== labels[r]) throw new Error('Identical images have conflicting labels');
            continue;
        }
        seen.set(key, labels[r]); uniqueImages.push(images[r]); uniqueLabels.push(labels[r]); sourceIndices.push(r);
    }
    if (new Set(uniqueLabels).size !== 10) throw new Error('Include samples of all ten digits.');
    return { images: uniqueImages, labels: uniqueLabels, sourceIndices, originalCount: images.length, duplicatesRemoved: images.length - uniqueImages.length };
}

function shuffle(values, random) {
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

export function stratifiedSplit(labels, seed = 42) {
    const classes = Array.from({ length: 10 }, () => []);
    labels.forEach((label, i) => {
        if (!Number.isInteger(label) || label < 0 || label > 9) throw new Error('Invalid digit label');
        classes[label].push(i);
    });
    if (classes.some(group => group.length < 2)) throw new Error('Each digit needs at least two unique images for leakage-free train/test splits.');
    const hasValidation = classes.every(group => group.length >= 3);
    const random = seededRandom(seed), train = [], validation = [], test = [];
    for (const group of classes) {
        shuffle(group, random);
        const testCount = Math.max(1, Math.floor(group.length * (hasValidation ? 0.15 : 0.2)));
        const validationCount = hasValidation ? Math.max(1, Math.floor(group.length * 0.15)) : 0;
        test.push(...group.slice(0, testCount));
        validation.push(...group.slice(testCount, testCount + validationCount));
        train.push(...group.slice(testCount + validationCount));
    }
    return { train: shuffle(train, random), validation: shuffle(validation, random), test: shuffle(test, random),
        warning: hasValidation ? null : 'At least one digit has only two unique images: using train/test only; validation and early stopping are disabled.' };
}

/** Conservative affine + soft morphology; no flips, inversions, or hard thresholding. */
export function augmentImage(image, random, options) {
    if (!options.augmentation) return image.slice();
    const signed = max => (random() * 2 - 1) * max;
    const angle = signed(options.rotation) * Math.PI / 180, scale = 1 + signed(options.scale);
    const tx = signed(options.translation), ty = signed(options.translation);
    const morphology = signed(options.thickness), gain = 1 + signed(options.intensity);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const transformed = new Array(784).fill(0);
    const sample = (x,y) => x >= 0 && x < 28 && y >= 0 && y < 28 ? image[y * 28 + x] : 0;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
        const cx = (x - 13.5 - tx) / scale, cy = (y - 13.5 - ty) / scale;
        const sx = cos * cx + sin * cy + 13.5, sy = -sin * cx + cos * cy + 13.5;
        const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
        transformed[y*28+x] = sample(ix,iy)*(1-fx)*(1-fy) + sample(ix+1,iy)*fx*(1-fy) + sample(ix,iy+1)*(1-fx)*fy + sample(ix+1,iy+1)*fx*fy;
    }
    const result = transformed.map((value, i) => {
        const x = i % 28, y = Math.floor(i / 28);
        let extremum = value;
        for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const neighbor = x+dx >= 0 && x+dx < 28 && y+dy >= 0 && y+dy < 28 ? transformed[(y+dy)*28+x+dx] : 0;
            extremum = morphology > 0 ? Math.max(extremum, neighbor) : Math.min(extremum, neighbor);
        }
        return Math.max(0, Math.min(1, (value + Math.abs(morphology) * (extremum - value)) * gain));
    });
    // Reject severe cropping/disappearance. This is a guard, not an identity proof.
    const mass = values => values.reduce((sum,p) => sum+p,0);
    const ratio = mass(result) / mass(image);
    return ratio < 0.65 || ratio > 1.4 ? image.slice() : result;
}

export function evaluate(model, images, labels, indices) {
    if (!indices.length) return null;
    const confusionMatrix = Array.from({ length: 10 }, () => new Array(10).fill(0));
    let loss = 0, correct = 0;
    for (const i of indices) {
        const probabilities = model.predict(images[i]);
        const predicted = probabilities.indexOf(Math.max(...probabilities));
        confusionMatrix[labels[i]][predicted]++;
        correct += Number(predicted === labels[i]);
        loss -= Math.log(Math.max(1e-15, probabilities[labels[i]]));
    }
    const perDigit = confusionMatrix.map((row,digit) => {
        const count = row.reduce((a,b) => a+b,0), correct = row[digit];
        return { digit, count, correct, incorrect: count-correct, accuracy: count ? correct/count : null };
    });
    return { count: indices.length, correct, incorrect: indices.length-correct, accuracy: correct/indices.length, loss: loss/indices.length, perDigit, confusionMatrix };
}

/** Pure orchestration shared by the browser worker and local comparison CLI. */
export function trainDigits(json, inputOptions = {}, progress = () => {}) {
    const options = trainingOptions(inputOptions), dataset = parseDataset(json);
    const { images, labels } = dataset, split = stratifiedSplit(labels, options.seed);
    const targets = split.train.map(i => Array.from({ length: 10 }, (_,d) => Number(d === labels[i])));
    const create = () => new NeuralNet({ layers: [784,32,10], task: 'multiclass', seed: options.seed });
    let model = create();
    const epochInputs = random => split.train.map(i => options.augmentation && random() < 0.5 ? augmentImage(images[i],random,options) : images[i]);
    const step = (network,random) => network.train(epochInputs(random),targets,{ epochs: 1, learningRate: options.learningRate, batchSize: options.batchSize });
    const random = seededRandom((options.seed ^ 0x9e3779b9) >>> 0);
    const earlyStopping = split.validation.length > 0 && options.patience > 0;
    let bestLoss = Infinity, bestEpoch = 0, stale = 0;
    const history = [];
    for (let epoch = 1; epoch <= options.epochs; epoch++) {
        step(model,random);
        const training = evaluate(model,images,labels,split.train), validation = evaluate(model,images,labels,split.validation);
        const metrics = { epoch, epochs: options.epochs, loss: training.loss, trainingLoss: training.loss, trainingAccuracy: training.accuracy,
            validationLoss: validation?.loss ?? null, validationAccuracy: validation?.accuracy ?? null };
        history.push(metrics); progress({ type: 'progress', ...metrics });
        if (earlyStopping) {
            if (validation.loss < bestLoss - 0.0001) { bestLoss = validation.loss; bestEpoch = epoch; stale = 0; }
            else stale++;
            if (stale >= options.patience) break;
        }
    }
    const selectedEpoch = earlyStopping ? bestEpoch : history.length;
    if (selectedEpoch < history.length) {
        model = create();
        const replay = seededRandom((options.seed ^ 0x9e3779b9) >>> 0);
        for (let epoch = 1; epoch <= selectedEpoch; epoch++) { step(model,replay); progress({ type: 'restoring', epoch, epochs: selectedEpoch }); }
    }
    // The test set is evaluated exactly once, after selecting the model by validation only.
    const training = evaluate(model,images,labels,split.train), validation = evaluate(model,images,labels,split.validation), test = evaluate(model,images,labels,split.test);
    return { model, report: { options, architecture: [784,32,10], optimizer: 'SGD', history, selectedEpoch, epochsCompleted: history.length,
        earlyStopped: history.length < options.epochs, warning: split.warning, duplicatesRemoved: dataset.duplicatesRemoved,
        originalCount: dataset.originalCount, splitCounts: { train: split.train.length, validation: split.validation.length, test: split.test.length },
        sourceIndices: Object.fromEntries(['train','validation','test'].map(key => [key, split[key].map(i => dataset.sourceIndices[i])])),
        training, validation, test } };
}
