// Explicit integration check: uses an already installed provider; never installs dependencies.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.INSPECTRA_ROOT)
    throw Error('Set INSPECTRA_ROOT to an installed inspectra-engine package directory in the supported peer range.');
const providerRoot = resolve(process.env.INSPECTRA_ROOT);
const provider = JSON.parse(readFileSync(join(providerRoot, 'package.json'), 'utf8'));
assert.equal(provider.name, 'inspectra-engine');
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(provider.version)?.slice(1).map(Number);
assert.ok(version && version[0] === 1 && (version[1] > 0 || version[2] >= 4),
    'This check supports stable Inspectra versions >=1.0.4 <2.0.0; prereleases require a separate candidate matrix.');
const directory = mkdtempSync(join(tmpdir(), 'shivax-inspectra-check-'));
try {
    // Mirror the shipped adapter/declaration layout, omitting its private nested manifest.
    cpSync(join(root, 'dist'), join(directory, 'dist'), { recursive: true });
    cpSync(join(root, 'package.json'), join(directory, 'package.json'));
    mkdirSync(join(directory, 'adapters/inspectra'), { recursive: true });
    for (const file of ['index.mjs', 'index.d.mts'])
        cpSync(join(root, 'adapters/inspectra', file), join(directory, 'adapters/inspectra', file));
    writeFileSync(join(directory, 'fixture.html'), readFileSync(join(root, 'tests/fixtures/inspection-page.html')));
    writeFileSync(join(directory, 'probe.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const installed = process.argv[2] === 'installed';
const directory = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url)));
for (const entry of Object.keys(manifest.exports)) {
    const name = entry === '.' ? 'shivax' : entry.replace('.', 'shivax');
    assert.deepEqual(Object.keys(await import(name)).sort(), Object.keys(require(name)).sort());
}
const scope = { kind: 'personal', id: 'optional-integration' };
const html = readFileSync(new URL('fixture.html', import.meta.url), 'utf8');
let browser;
if (installed) {
    const providerRequire = createRequire(import.meta.resolve('inspectra-engine/node'));
    const { chromium } = providerRequire('playwright');
    browser = await chromium.launch({ headless: true });
} else await assert.rejects(import('inspectra-engine/node'), { code: 'ERR_MODULE_NOT_FOUND' });
try {
    for (const [format, api] of [['ESM', await import('shivax/adapters/inspectra')], ['CJS', require('shivax/adapters/inspectra')]]) {
        let opens = 0, closes = 0;
        const screenshotPath = join(directory, format + '.png');
        const provider = new api.InspectraInspectionProvider({
            async openPage(request, host) {
                assert.equal(request.url, 'https://fixture.test/reference');
                host.signal.throwIfAborted();
                opens++;
                const context = await browser.newContext({ viewport: request.viewport });
                try {
                    await context.route('**/*', route => route.request().url() === request.url
                        ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
                    const page = await context.newPage();
                    await page.goto(request.url);
                    return { page, screenshot: { path: screenshotPath, reference: 'fixture:' + format },
                        async close() { closes++; await context.close(); } };
                } catch (error) { await context.close(); throw error; }
            },
        });
        assert.equal(opens, 0);
        const work = provider.capture({ url: 'https://fixture.test/reference', viewport: { width: 800, height: 600 } },
            { session: { scope }, signal: new AbortController().signal });
        if (!installed) {
            await assert.rejects(work, /Install optional peer inspectra-engine in the supported peer range/);
            assert.equal(opens, 0);
            assert.equal(closes, 0);
        } else {
            const observation = await work;
            assert.equal(opens, 1);
            assert.equal(closes, 1);
            assert.equal(observation.trust, 'untrusted');
            assert.equal(observation.snapshot.sourceType, 'url');
            assert.deepEqual(observation.snapshot.scope, scope);
            const heading = observation.elements.find(element => element.tag === 'h1');
            assert.ok(heading.selector.startsWith('body > :nth-child('));
            assert.equal(observation.snapshot.nodes.find(node => node.id === heading.nodeId).typography.fontSize.value, 30);
            const section = observation.elements.find(element => element.tag === 'section');
            assert.equal(observation.snapshot.nodes.find(node => node.id === section.nodeId).layout.flexDirection.value, 'column');
            assert.equal(observation.screenshot.reference, 'fixture:' + format);
            assert.equal(observation.screenshot.status, 'available');
            assert.equal(JSON.stringify(observation).includes(screenshotPath), false);
            assert.ok(statSync(screenshotPath).size > 0);
        }
        console.log('PASS: ' + format + ' default lazy loader, Inspectra ' + (installed ? '${provider.version} live capture/normalization/screenshot/cleanup' : 'absent; all public imports work'));
    }
} finally { await browser?.close(); }
`);
    function probe(mode) {
        const result = spawnSync(process.execPath, ['probe.mjs', mode], {
            cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 120_000,
        });
        assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
        process.stdout.write(result.stdout);
    }
    probe('absent');
    mkdirSync(join(directory, 'node_modules'));
    symlinkSync(providerRoot, join(directory, 'node_modules/inspectra-engine'), process.platform === 'win32' ? 'junction' : 'dir');
    probe('installed');
} finally {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !target.startsWith(join(resolve(tmpdir()), 'shivax-inspectra-check-')))
        throw Error('Unsafe integration cleanup path.');
    rmSync(target, { recursive: true, force: true });
}
