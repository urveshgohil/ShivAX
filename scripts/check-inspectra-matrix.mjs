// C01: clean, real npm consumers outside repositories; no peer-resolution bypasses.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packageManager } from './package-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const npm = packageManager(process.env.SHIVAX_NPM_CLI || process.env.npm_execpath || '');
assert.equal(npm.name, 'npm', 'This matrix specifically checks npm peer resolution.');
const directory = mkdtempSync(join(tmpdir(), 'shivax-c01-'));
console.log(`Evidence directory: ${directory}`);
const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
const staging = join(directory, 'package'); mkdirSync(staging);
for (const file of [...manifest.files, 'package.json', 'LICENSE'])
    cpSync(join(root, file), join(staging, file), { recursive: true });
// Before changing the repository peer, validate a proposed range in an isolated artifact.
if (process.env.SHIVAX_INSPECTRA_PEER) manifest.peerDependencies['inspectra-engine'] = process.env.SHIVAX_INSPECTRA_PEER;
writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
const pack = JSON.parse(npm.run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], staging))[0];
const tarball = join(directory, pack.filename);
const registryVersions = JSON.parse(npm.run(['view', 'inspectra-engine', 'versions', '--json'], directory));
writeFileSync(join(directory, 'registry-versions.json'), JSON.stringify(registryVersions, null, 2));
const stableVersions = registryVersions.filter(version => {
    const parts = /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
    return parts && (Number(parts[1]) > 0 || Number(parts[2]) >= 4);
});
assert.ok(stableVersions.includes('1.0.4') && stableVersions.includes('1.1.0'));
const cases = [['absent', null], ...stableVersions.map(version => [version, `inspectra-engine@${version}`])];
let candidateArtifact;
if (process.env.INSPECTRA_CANDIDATE) {
    const candidate = resolve(process.env.INSPECTRA_CANDIDATE);
    // Pack without running or changing the other project's build or manifest.
    const packed = JSON.parse(npm.run(['pack', candidate, '--ignore-scripts', '--json', '--pack-destination', directory], directory))[0];
    cases.push(['local-candidate', join(directory, packed.filename)]);
    candidateArtifact = { source: candidate, version: packed.version,
        sha256: createHash('sha256').update(readFileSync(join(directory, packed.filename))).digest('hex') };
}
const { spawnSync } = await import('node:child_process');
function node(args, cwd, log) {
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
    writeFileSync(join(cwd, log), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.status, 0, result.error?.message || `${log}: ${result.stdout}${result.stderr}`);
    return result.stdout;
}
const results = [];
for (const [name, provider] of cases) {
    const consumer = join(directory, name); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: `shivax-c01-${name.replaceAll('.', '-')}`, version: '1.0.0', private: true, type: 'module' }));
    try {
        // Normal install: scripts enabled, optional peers enabled, standard peer validation.
        writeFileSync(join(consumer, 'install.log'), npm.run(['install', '--no-audit', '--no-fund', tarball, ...(provider ? [provider] : [])], consumer));
        writeFileSync(join(consumer, 'npm-ls.json'), npm.run(['ls', '--all', '--json'], consumer));
        const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/shivax/package.json')));
        assert.equal(installed.version, manifest.version);
        let providerVersion;
        if (provider) {
            const providerManifest = JSON.parse(readFileSync(join(consumer, 'node_modules/inspectra-engine/package.json')));
            providerVersion = providerManifest.version;
            if (name !== 'local-candidate') assert.equal(providerVersion, name);
            console.log(`${name}: installed inspectra-engine ${providerManifest.version}`);
        }
        cpSync(join(root, 'scripts/inspectra-consumer-probe.mjs'), join(consumer, 'probe.mjs'));
        cpSync(join(root, 'tests/fixtures/inspection-page.html'), join(consumer, 'fixture.html'));
        node(['probe.mjs', provider ? 'installed' : 'absent'], consumer, 'probe.log');
        const entries = Object.keys(installed.exports).map(e => e === '.' ? 'shivax' : e.replace('.', 'shivax'));
        const source = entries.map((e, i) => `import * as api${i} from '${e}'; void api${i};`).join('\n') + `
import { InspectraInspectionProvider } from 'shivax/adapters/inspectra';
import type { InspectionProvider } from 'shivax';
const provider: InspectionProvider = new InspectraInspectionProvider({ openPage: async (_request, _context, security) => ({ page: {}, security, close() {} }) });
void provider;
`;
        const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
        for (const [ext, module, moduleResolution] of [['ts', 'ESNext', 'bundler'], ['mts', 'Node16', 'Node16'], ['cts', 'Node16', 'Node16'], ['mts', 'NodeNext', 'NodeNext'], ['cts', 'NodeNext', 'NodeNext']]) {
            writeFileSync(join(consumer, `consumer.${ext}`), source);
            writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module, moduleResolution }, files: [`consumer.${ext}`] }));
            node([compiler, '-p', 'tsconfig.json'], consumer, `types-${ext}-${moduleResolution}.log`);
        }
        mkdirSync(join(consumer, 'fixtures'));
        cpSync(join(root, 'tests/fixtures/inspectra-captures.json'), join(consumer, 'fixtures/inspectra-captures.json'));
        cpSync(join(root, 'tests/firewall-model-integration.test.mjs'), join(consumer, 'firewall-model-integration.test.mjs'));
        node(['--test', 'firewall-model-integration.test.mjs'], consumer, 'security.log');
        results.push({ name, providerVersion, result: 'PASS' }); console.log(`PASS ${name}: install, npm ls, ${entries.length} ESM/CJS exports, five declaration modes, ${provider ? 'real capture/security/cleanup' : 'optional absence/security (live capture not applicable)'}`);
    } catch (error) {
        writeFileSync(join(consumer, 'failure.log'), String(error.stack));
        results.push({ name, result: 'FAIL', error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
    }
}
writeFileSync(join(directory, 'results.json'), JSON.stringify({ node: process.version, shivaxVersion: manifest.version, peer: manifest.peerDependencies['inspectra-engine'], tarball,
    sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'), candidateArtifact, results }, null, 2));
if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
// Preserve evidence and lockfiles for review. Only this script's fresh temp directory is written.
