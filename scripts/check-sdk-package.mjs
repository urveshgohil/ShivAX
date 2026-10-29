import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(root, '.shivax-sdk-pack-'));
function command(file, args, cwd = directory) {
    const result = spawnSync(file, args, { cwd, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.error?.message ?? result.stdout + result.stderr);
    return result.stdout;
}
try {
    // npm execpath is used directly to avoid cmd quoting and never runs lifecycle scripts.
    const npm = process.env.npm_execpath || process.env.SHIVAX_NPM_CLI;
    if (!npm) throw new Error('Run npm run verify:package (supplies npm_execpath).');
    const packed = JSON.parse(command(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], root))[0];
    const consumer = join(directory, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    command(process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(directory, packed.filename)], consumer);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    const entries = Object.keys(manifest.exports).map(name => name === '.' ? 'shivax' : name.replace('.', 'shivax'));
    writeFileSync(join(consumer, 'verify.mjs'), `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);
for (const name of ${JSON.stringify(entries)}) {const esm=await import(name); const cjs=require(name); assert.deepEqual(Object.keys(esm).sort(),Object.keys(cjs).sort());}
console.log('Packed ESM/CJS SDK imports passed.');`);
    process.stdout.write(command(process.execPath, ['verify.mjs'], consumer));
    writeFileSync(join(consumer, 'consumer.ts'), entries.map((entry, i) => `import * as entry${i} from '${entry}'; void entry${i};`).join('\n'));
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module: 'ESNext', moduleResolution: 'bundler' }, files: ['consumer.ts'] }));
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    command(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], consumer);
    console.log(`Packed declarations passed for ${entries.length} entries; ${packed.entryCount} packaged files.`);
} finally {
    const checked = resolve(directory), suffix = relative(root, checked);
    if (suffix && !suffix.startsWith('..') && suffix.startsWith('.shivax-sdk-pack-')) rmSync(checked, { recursive: true, force: true });
}
