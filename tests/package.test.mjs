import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

test('core consumers type-check public exports with ES2020 alone and no ambient platform types', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shivax-types-'));
    try {
        const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
        writeFileSync(join(directory, 'consumer.ts'), `import { NeuralNet, SLMClient } from ${JSON.stringify(entry)};\nconst net = new NeuralNet({ layers: [2, 1], task: 'binary' });\nlet optionalClient: SLMClient | undefined;\n`);
        writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module: 'ESNext', moduleResolution: 'bundler',
        }, files: ['consumer.ts'] }));
        const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
        const result = spawnSync(process.execPath, [compiler, '-p', join(directory, 'tsconfig.json')], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
