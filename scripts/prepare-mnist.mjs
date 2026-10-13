import { readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { seededRandom } from '../dist/index.esm.js';
import { parseDataset } from '../examples/digits/training.mjs';

/** Parse original IDX images/labels without altering grayscale, orientation or alignment. */
export function prepareSubset(images, labels, count = 500, seed = 42) {
    if (!Number.isInteger(count) || count < 50 || count > 500 || count % 10) throw new Error('Count must be a multiple of 10 from 50 to 500');
    if (images.length < 16 || labels.length < 8 || images.readUInt32BE(0) !== 2051 || labels.readUInt32BE(0) !== 2049) throw new Error('Invalid IDX magic/header');
    const total = images.readUInt32BE(4);
    if (total < count || total > 70000 || labels.readUInt32BE(4) !== total || images.readUInt32BE(8) !== 28 || images.readUInt32BE(12) !== 28) throw new Error('MNIST requires matching counts and 28x28 images');
    if (images.length !== 16 + total * 784 || labels.length !== 8 + total) throw new Error('Truncated or trailing IDX data');
    const groups = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < total; i++) {
        const digit = labels[8+i];
        if (digit > 9) throw new Error('IDX labels must be 0–9');
        groups[digit].push(i);
    }
    const random = seededRandom(seed), output = { images: [], labels: [] }, seen = new Set();
    for (let digit = 0; digit < 10; digit++) {
        const indices = groups[digit];
        for (let i = indices.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [indices[i],indices[j]] = [indices[j],indices[i]]; }
        let added = 0;
        for (const index of indices) {
            const bytes = images.subarray(16+index*784,16+(index+1)*784);
            if (!bytes.some(value => value > 0)) continue;
            const key = bytes.toString('hex');
            if (seen.has(key)) continue;
            seen.add(key);
            output.images.push(Array.from(bytes, value => value/255)); output.labels.push(digit); added++;
            if (added === count/10) break;
        }
        if (added !== count/10) throw new Error(`Not enough unique nonblank images for digit ${digit}`);
    }
    const json = JSON.stringify(output);
    parseDataset(json); // Same byte-size, sample-count, range and label checks as the demo.
    return json;
}

async function localIDX(path) {
    if ((await stat(path)).size > 60_000_000) throw new Error('Local IDX file exceeds 60 MB limit');
    const bytes = await readFile(path);
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 55_000_000 }) : bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [imagePath,labelPath,outputPath,count = '500',seed = '42'] = process.argv.slice(2);
        if (!imagePath || !labelPath || !outputPath) throw new Error('Usage: node scripts/prepare-mnist.mjs <local-images-idx[.gz]> <local-labels-idx[.gz]> <new-output.json> [count=500] [seed=42]');
        const images = await localIDX(imagePath), labels = await localIDX(labelPath);
        const json = prepareSubset(images,labels,Number(count),Number(seed));
        await writeFile(outputPath,json,{ flag: 'wx' });
        console.log(JSON.stringify({ outputPath, count: Number(count), seed: Number(seed), bytes: Buffer.byteLength(json),
            sourceImagesSHA256: createHash('sha256').update(images).digest('hex'), sourceLabelsSHA256: createHash('sha256').update(labels).digest('hex'),
            subsetSHA256: createHash('sha256').update(json).digest('hex') },null,2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
