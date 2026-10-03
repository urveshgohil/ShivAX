import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package exports load in both ESM and CommonJS', async () => {
    const esm = await import('shivax');
    const cjs = require('shivax');
    assert.equal(esm.VERSION, manifest.version);
    assert.equal(cjs.VERSION, manifest.version);
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    assert.equal(typeof esm.Tensor, 'function');
    assert.equal(typeof cjs.NeuralNet, 'function');
});

test('production package has no dependency or install-script overhead', () => {
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
    assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
        assert.equal(manifest.scripts[hook], undefined);
    }
    assert.equal(manifest.license, 'Apache-2.0');
});

test('public declarations and license are present', () => {
    assert.match(readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8'), /VERSION/);
    assert.match(readFileSync(new URL('../dist/types/index.d.ts', import.meta.url), 'utf8'), /ModelConfig/);
    assert.match(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), /Version 2.0, January 2004/);
});
