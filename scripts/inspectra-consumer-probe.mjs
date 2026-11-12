// Copied into a clean installed consumer by check-inspectra-matrix.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const installed = process.argv[2] === 'installed';
const manifest = JSON.parse(readFileSync(new URL('node_modules/shivax/package.json', import.meta.url)));
for (const entry of Object.keys(manifest.exports)) {
    const name = entry === '.' ? 'shivax' : entry.replace('.', 'shivax');
    assert.deepEqual(Object.keys(await import(name)).sort(), Object.keys(require(name)).sort());
}
const html = readFileSync(new URL('fixture.html', import.meta.url), 'utf8');
const request = { url: 'https://fixture.test/reference', viewport: { width: 800, height: 600 } };
let browser;
if (installed) {
    const providerRequire = createRequire(import.meta.resolve('inspectra-engine/node'));
    const { chromium } = providerRequire('playwright');
    browser = await chromium.launch({ headless: true });
} else await assert.rejects(import('inspectra-engine/node'), { code: 'ERR_MODULE_NOT_FOUND' });

try {
    for (const [format, api, adapter] of [
        ['ESM', await import('shivax'), await import('shivax/adapters/inspectra')],
        ['CJS', require('shivax'), require('shivax/adapters/inspectra')],
    ]) {
        let opens = 0, closes = 0, blocked = 0;
        const scope = { kind: 'company', id: 'c01-tenant' };
        const identity = { principal: { id: 'user', issuer: 'host', permissions: ['inspect', 'admin'] },
            session: { id: 'session', principalId: 'user', issuedAt: 1, expiresAt: 10000, scope } };
        const jay = new api.Jay({ authenticate: () => identity, isSessionValid: () => true }, { now: () => 2000 });
        const policies = new api.PermissionPolicyRegistry();
        for (const [kind, id, effect, permission] of [['capability', 'inspect', 'state-changing', 'inspect'], ['tool', 'capture', 'state-changing', 'inspect'], ['capability', 'firewall.admin', 'state-changing', 'admin']])
            policies.register({ kind, id, effect, permissions: [permission], validateInput: () => true });
        const screenshotPath = join(process.cwd(), `${format}.png`).replaceAll('\\', '/');
        let scenario = 'success', abortCapture;
        const provider = new adapter.InspectraInspectionProvider({
            async openPage(req, context, security) {
                opens++;
                assert.deepEqual(security.owner.scope, scope);
                assert.equal(security.owner.sessionId, identity.session.id);
                const pageContext = await browser.newContext({ viewport: req.viewport, serviceWorkers: 'block' });
                const close = async () => { closes++; await pageContext.close(); };
                try {
                    await pageContext.route('**/*', async route => {
                        const url = route.request().url();
                        try { security.checkDestination(url); }
                        catch { blocked++; await route.abort(); return; }
                        if (url === 'https://fixture.test/redirect') {
                            // Follow-up navigation is checked independently by the trusted host.
                            const destination = 'https://denied.test/secret';
                            try { security.checkDestination(destination); }
                            catch { blocked++; await route.abort(); return; }
                            await route.fulfill({ status: 302, headers: { location: destination } });
                        } else if (url === request.url) {
                            await route.fulfill({ contentType: 'text/html', body: html + '<script>fetch("https://denied.test/pixel").catch(() => {});</script>' });
                        } else await route.abort();
                    });
                    const page = await pageContext.newPage();
                    await page.goto(req.url);
                    if (scenario === 'failure') await page.close();
                    if (scenario === 'cancel') {
                        // Abort during the real extractor's first evaluate, not a mock extractor.
                        const evaluate = page.evaluate.bind(page);
                        page.evaluate = (...args) => { abortCapture.abort(); return evaluate(...args); };
                    }
                    return { page, security: scenario === 'lease' ? { ...security } : security,
                        screenshot: { path: screenshotPath, reference: `fixture:${format}` }, close };
                } catch (error) { await close(); throw error; }
            },
        });
        assert.equal(opens, 0);
        const tools = new api.ProtectedToolRegistry().register({ id: 'capture', validateInput: () => true,
            validateOutput: () => true, execute: (input, context) => provider.capture(input, context) });
        const security = new api.Vijay(jay, policies, { tools, approve: () => true });
        const operation = { id: 'capture', toolId: 'capture', kind: 'tool', capability: 'inspect', effect: 'state-changing',
            files: { read: [], write: [screenshotPath] }, networkOrigins: ['https://fixture.test'], check: () => true };
        const policy = { mode: 'enforce', rules: [{ id: 'allow', decision: 'allow', operationIds: ['capture'] }],
            capabilities: ['inspect'], bots: [], providers: { ids: [], localities: [] },
            network: { origins: ['https://fixture.test'] }, files: operation.files,
            limits: { maxConcurrent: 2, maxOperations: 50, maxTokens: 100, maxCostUSD: 1, timeoutMs: 30000, maxInputBytes: 65536, maxOutputBytes: 262144 }, audit: { required: false } };
        const firewall = api.createShivaxFirewall({ jay, security, operations: [operation], policy,
            realm: { issuer: 'host', scope }, protectExecution: true, adminCapability: 'firewall.admin', authorizeAdmin: () => true });
        async function context(controller = new AbortController(), toolPermissions = ['capture']) {
            return jay.createContext({ id: 'c01', input: { capability: 'inspect', data: request } }, { signal: controller.signal, toolPermissions });
        }
        const root = await context();
        await assert.rejects(firewall.runtime.execute(await context(undefined, []), 'capture', request));
        await assert.rejects(firewall.runtime.execute({ ...root, session: { ...root.session, scope: { kind: 'company', id: 'other' } } }, 'capture', request));
        identity.session = { ...identity.session, id: 'other-session', scope: { kind: 'company', id: 'other' } };
        const otherTenant = await context();
        await assert.rejects(firewall.runtime.execute(otherTenant, 'capture', request));
        identity.session = { ...identity.session, id: 'session', scope };
        await assert.rejects(firewall.runtime.execute(root, 'capture', { ...request, url: 'https://denied.test/' }));
        assert.equal(opens, 0, 'authorization, tenant and network denies precede page acquisition');
        if (!installed) {
            await assert.rejects(firewall.runtime.execute(root, 'capture', request));
            await assert.rejects(provider.capture(request, { session: { scope }, signal: new AbortController().signal }), /Install optional peer inspectra-engine/);
            assert.equal(opens, 0);
        } else {
            const observation = await firewall.runtime.execute(root, 'capture', request);
            assert.equal(observation.trust, 'untrusted');
            assert.deepEqual(observation.snapshot.scope, scope);
            const heading = observation.elements.find(e => e.tag === 'h1');
            assert.ok(heading.selector.startsWith('body > :nth-child('));
            assert.equal(observation.snapshot.nodes.find(n => n.id === heading.nodeId).typography.fontSize.value, 30);
            const section = observation.elements.find(e => e.tag === 'section');
            assert.equal(observation.snapshot.nodes.find(n => n.id === section.nodeId).layout.flexDirection.value, 'column');
            assert.equal(observation.screenshot.reference, `fixture:${format}`);
            assert.ok(statSync(screenshotPath).size > 0);
            assert.equal(JSON.stringify(observation).includes(screenshotPath), false);
            assert.ok(blocked > 0, 'unapproved subresource blocked');
            assert.equal(closes, opens);
            for (scenario of ['failure', 'lease', 'cancel', 'redirect']) {
                abortCapture = new AbortController();
                const before = opens;
                await assert.rejects(firewall.runtime.execute(await context(abortCapture), 'capture',
                    scenario === 'redirect' ? { ...request, url: 'https://fixture.test/redirect' } : request));
                assert.equal(opens, before + 1);
                // The firewall may settle cancellation before the provider; wait for real cleanup.
                for (let i = 0; i < 100 && browser.contexts().length; i++) await new Promise(r => setTimeout(r, 10));
                assert.equal(closes, opens, scenario);
                assert.equal(browser.contexts().length, 0, scenario);
            }
        }
        const beforeLockdown = opens;
        await firewall.admin.lockdown(root, 1);
        await assert.rejects(firewall.runtime.execute(root, 'capture', request));
        assert.equal(opens, beforeLockdown);
        console.log(`PASS ${format}: imports, lazy adapter, ${installed ? 'real offline capture/screenshot/normalization, cancellation, failure/lease/redirect cleanup' : 'optional peer absent'}, unauthorized/tenant/network denies, enforce and lockdown`);
    }
} finally { await browser?.close(); }
