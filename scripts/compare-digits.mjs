import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseDataset, trainDigits, DEFAULT_OPTIONS } from '../examples/digits/training.mjs';

// Explicit local file arguments only: never downloads data or writes over datasets.
try {
    const [existingPath,mnistPath] = process.argv.slice(2);
    if (!existingPath || !mnistPath) throw new Error('Usage: node scripts/compare-digits.mjs <existing-500.json> <balanced-mnist-500.json>');
    const inputs = [];
    for (const path of [existingPath,mnistPath]) {
        if ((await stat(path)).size > 5_000_000) throw new Error('Dataset exceeds 5 MB');
        const json = await readFile(path,'utf8'), dataset = parseDataset(json);
        if (dataset.images.length !== 500) throw new Error('Fair comparison requires 500 unique images in each input');
        inputs.push({ path, json, dataset });
    }
    const counts = new Array(10).fill(0);
    inputs[1].dataset.labels.forEach(label => counts[label]++);
    if (counts.some(count => count !== 50)) throw new Error('MNIST comparison subset must contain 50 samples per digit');
    const results = inputs.map(({path,json}) => {
        console.error(`Training ${path}`);
        const { report } = trainDigits(json,DEFAULT_OPTIONS);
        return { path, sha256: createHash('sha256').update(json).digest('hex'), report };
    });
    console.log(JSON.stringify({ protocol: 'Same 784-32-10 SGD architecture, options and seeded stratified split policy. Separate in-domain test sets; not a common handwriting benchmark.', results },null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
