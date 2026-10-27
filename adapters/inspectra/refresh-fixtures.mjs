// Explicit development command only. Uses the actual installed Inspectra extractor and Chromium.
// No external requests: this fixture uses setContent and blocks all network requests.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const inspectraRoot = resolve(process.env.INSPECTRA_ROOT || '../inspectra');
const require = createRequire(pathToFileURL(resolve(inspectraRoot, 'package.json')));
const { chromium } = require('playwright');
const { captureUIPage } = await import(
    pathToFileURL(resolve(inspectraRoot, 'node/index.mjs')).href
);
const pkg = JSON.parse(await readFile(resolve(inspectraRoot, 'package.json'), 'utf8'));
const html = await readFile(
    new URL('../../tests/fixtures/inspection-page.html', import.meta.url),
    'utf8'
);
const browser = await chromium.launch({ headless: true });
const cases = {};
try {
    for (const name of [
        'baseline',
        'typography',
        'missing',
        'spacing',
        'alignment',
        'responsive',
    ]) {
        const context = await browser.newContext({
            viewport: { width: name === 'responsive' ? 400 : 800, height: 600 },
            deviceScaleFactor: 1,
        });
        try {
            await context.route('**/*', (route) => route.abort());
            const page = await context.newPage();
            await page.setContent(html);
            if (name === 'typography')
                await page.locator('h1').evaluate((el) => {
                    el.style.fontSize = '24px';
                });
            if (name === 'missing') await page.locator('button').evaluate((el) => el.remove());
            if (name === 'spacing')
                await page.locator('section').evaluate((el) => {
                    el.style.gap = '24px';
                });
            if (name === 'alignment')
                await page.locator('section').evaluate((el) => {
                    el.style.alignItems = 'center';
                });
            cases[name] = await captureUIPage(page, {
                scope: { kind: 'personal', id: 'inspection-test' },
                maxNodes: 16,
                timeout: 5000,
            });
        } finally {
            await context.close();
        }
    }
    await writeFile(
        new URL('../../tests/fixtures/inspectra-captures.json', import.meta.url),
        JSON.stringify(
            {
                provenance: {
                    package: pkg.name,
                    version: pkg.version,
                    api: 'captureUIPage',
                    browser: browser.version(),
                    fixture: 'inspection-page.html',
                    network: 'blocked',
                },
                cases,
            },
            null,
            2
        ) + '\n'
    );
    console.log(
        `Captured ${Object.keys(cases).length} real Inspectra fixtures using ${pkg.name}@${pkg.version}.`
    );
} finally {
    await browser.close();
}
