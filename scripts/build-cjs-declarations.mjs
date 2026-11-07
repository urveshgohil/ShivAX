import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const output = join(dist, 'types-cjs');
// Copy the entire declaration graph so private class identities stay shared
// between root and SDK subpaths within the CommonJS branch.
const declarations = readdirSync(dist, { recursive: true })
    .filter(file => file.endsWith('.d.ts') && !file.startsWith('types-cjs'));
for (const file of declarations) {
    const destination = join(output, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(dist, file), destination);
}
writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}\n');
// The external ESM adapter declaration must also have a CommonJS counterpart.
const adapter = join(output, 'adapters/inspectra/index.d.ts');
mkdirSync(dirname(adapter), { recursive: true });
writeFileSync(adapter, readFileSync(join(root, 'adapters/inspectra/index.d.mts')));
writeFileSync(join(output, 'sdk/inspectra.d.ts'),
    "export * from '../adapters/inspectra/index.js';\n");
