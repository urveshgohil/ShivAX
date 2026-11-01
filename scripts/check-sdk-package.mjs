import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { packageManager, runCommand } from './package-process.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = resolve(tmpdir());
const directory = mkdtempSync(join(temporaryRoot, '.shivax-sdk-pack-'));
function command(file, args, cwd = directory) {
    return runCommand(file, args, cwd);
}
try {
    const cli = process.env.SHIVAX_NPM_CLI || process.env.npm_execpath;
    if (!cli) throw new Error('Run npm run verify:package or pnpm verify:package, or set SHIVAX_NPM_CLI.');
    const manager = packageManager(cli);
    console.log(`Verifying package with ${manager.name}; Node ${process.version}.`);
    const result = JSON.parse(manager.run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root));
    // npm returns an array; pnpm returns an object with an absolute filename.
    const packed = Array.isArray(result) ? result[0] : result;
    const tarball = resolve(directory, packed.filename);
    const tarballRelative = relative(directory, tarball);
    if (!tarballRelative || isAbsolute(tarballRelative) || tarballRelative.startsWith('..') || !tarball.endsWith('.tgz'))
        throw new Error('Package manager returned an unexpected tarball path.');
    const consumer = join(directory, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    manager.run(manager.installArgs(tarball), consumer);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    const entries = Object.keys(manifest.exports).map(name => name === '.' ? 'shivax' : name.replace('.', 'shivax'));
    writeFileSync(join(consumer, 'verify.mjs'), `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);
for (const name of ${JSON.stringify(entries)}) {const esm=await import(name); const cjs=require(name); assert.deepEqual(Object.keys(esm).sort(),Object.keys(cjs).sort());}
console.log('Packed ESM/CJS SDK imports passed.');`);
    process.stdout.write(command(process.execPath, ['verify.mjs'], consumer));
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const source = entries.map((entry, i) => `import * as entry${i} from '${entry}'; void entry${i};`).join('\n') + `
import { Tensor } from 'shivax/core';
import { Jay } from 'shivax/security';
import type { Tensor as RootTensor, Jay as RootJay, InspectionProvider } from 'shivax';
import { InspectraInspectionProvider } from 'shivax/adapters/inspectra';
import { ServerLicenseGate } from 'shivax/licensing/server';
const tensor: RootTensor = new Tensor([1], [1]);
declare const jay: Jay; const rootJay: RootJay = jay;
const provider: InspectionProvider = new InspectraInspectionProvider({openPage: async () => ({page: {}, close() {}})});
new ServerLicenseGate(rootJay, { verify: () => null }, 'typed-product');
void tensor; void rootJay; void provider;
// @ts-expect-error Tensor data must be array-like, not a number.
new Tensor(42, [1]);
`;
    for (const [extension, module, moduleResolution] of [
        ['ts', 'ESNext', 'bundler'], ['mts', 'Node16', 'Node16'],
        ['cts', 'Node16', 'Node16'], ['mts', 'NodeNext', 'NodeNext'],
        ['cts', 'NodeNext', 'NodeNext'],
    ]) {
        const file = `consumer.${extension}`;
        writeFileSync(join(consumer, file), source);
        writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module, moduleResolution,
        }, files: [file] }));
        command(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], consumer);
        console.log(`PASS declarations: ${extension}, ${moduleResolution}, ${entries.length} entries.`);
    }
    console.log(`Packed declarations passed for ${entries.length} entries; ${packed.entryCount ?? packed.files.length} packaged files.`);
} finally {
    const checked = resolve(directory), suffix = relative(temporaryRoot, checked);
    if (suffix && !suffix.startsWith('..') && suffix.startsWith('.shivax-sdk-pack-')) rmSync(checked, { recursive: true, force: true });
}
