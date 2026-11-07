// Explicit optional integration test. No browser runtime is needed by the normal ShivAX test suite.
import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectionSystem } from '../../tests/fixtures/inspection-system.mjs';
register('../../tests/fixtures/inspectra-loader.mjs', import.meta.url);
const { InspectraInspectionProvider } = await import('./index.mjs');
const inspectraRoot = resolve(process.env.INSPECTRA_ROOT || '../inspectra');
const require = createRequire(pathToFileURL(join(inspectraRoot, 'package.json')));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(root, '.shivax-inspection-live-'));
const html = await readFile(
    new URL('../../tests/fixtures/inspection-page.html', import.meta.url),
    'utf8'
);
const browser = await chromium.launch({ headless: true });
let pages = 0,
    closes = 0;
try {
    const provider = new InspectraInspectionProvider({
        load: () => import(pathToFileURL(join(inspectraRoot, 'node/index.mjs')).href),
        async openPage(request, host) {
            const url = new URL(request.url);
            if (
                url.origin !== 'https://fixture.test' ||
                !['/reference', '/target'].includes(url.pathname)
            )
                throw new Error('Fixture URL denied.');
            host.signal.throwIfAborted();
            const context = await browser.newContext({
                viewport: request.viewport,
                deviceScaleFactor: 1,
            });
            let closed = false;
            const close = async () => {
                if (!closed) {
                    closed = true;
                    closes++;
                    await context.close();
                }
            };
            try {
                await context.route('**/*', (route) =>
                    route.request().url() === request.url
                        ? route.fulfill({ contentType: 'text/html', body: html })
                        : route.abort()
                );
                const page = await context.newPage();
                pages++;
                const abort = () => {
                    void close();
                };
                host.signal.addEventListener('abort', abort, { once: true });
                try {
                    host.signal.throwIfAborted();
                    await page.goto(request.url, { timeout: 5000 });
                } finally {
                    host.signal.removeEventListener('abort', abort);
                }
                if (url.pathname === '/target')
                    await page.locator('h1').evaluate((el) => {
                        el.style.fontSize = '24px';
                    });
                return {
                    page,
                    close,
                    screenshot: {
                        path: join(directory, `${url.pathname.slice(1)}.png`),
                        reference: `fixture:${url.pathname.slice(1)}`,
                    },
                };
            } catch (error) {
                await close();
                throw error;
            }
        },
    });
    const result = await inspectionSystem(provider).run();
    assert.equal(result.status, 'completed', JSON.stringify(result));
    const review = result.outputs.at(-1).data;
    assert.equal(review.validated, true);
    const issue = review.findings.find((i) => i.property === 'typography.fontSize');
    assert.equal(issue.expected, 30);
    assert.equal(issue.actual, 24);
    assert.equal(result.outputs[0].data.baseline.screenshot.status, 'available');
    assert.ok((await stat(join(directory, 'reference.png'))).size > 0);
    assert.equal(pages, 2);
    assert.equal(closes, 2);
    console.log(
        'PASS: actual Inspectra captureUIPage → Narad → Yudhishthir → RUDRA; 2 isolated pages, screenshots, typography 30 → 24, both leases closed.'
    );
} finally {
    await browser.close();
    const inside = relative(root, directory);
    if (inside.startsWith('..') || !inside.startsWith('.shivax-inspection-live-'))
        throw new Error('Unsafe fixture cleanup path.');
    await rm(directory, { recursive: true, force: true });
}
