import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as root from 'shivax';
import { Jay, SecurityError } from 'shivax/security';
import { ServerLicenseGate, LicenseError } from 'shivax/licensing/server';
import { toSDKDiagnostic } from 'shivax/diagnostics';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
test('every SDK entry resolves in ESM and CJS and preserves shared runtime export identity', async () => {
    for (const entry of Object.keys(manifest.exports)) {
        const name = entry === '.' ? 'shivax' : entry.replace('.', 'shivax');
        const esm = await import(name), cjs = require(name);
        assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
        if (entry !== './adapters/inspectra' && entry !== './licensing/server') {
            for (const [key, value] of Object.entries(esm)) if (key in root) assert.equal(value, root[key], `${entry}: ${key}`);
            for (const [key, value] of Object.entries(cjs)) if (key in require('shivax')) assert.equal(value, require('shivax')[key], `${entry} CJS: ${key}`);
        }
    }
});
test('diagnostics scrub unknown messages and project known failures without exception contents', () => {
    assert.equal(toSDKDiagnostic(new SecurityError('approval-denied')).code, 'denied');
    const hostile = { get message() { throw new Error('secret'); }, get code() { throw new Error('secret'); } };
    assert.equal(toSDKDiagnostic(hostile).code, 'failed');
    assert.equal(JSON.stringify(toSDKDiagnostic(new Error('private-token'))).includes('private-token'), false);
});
async function licenseFixture() {
    const identity = { principal: { id: 'user', issuer: 'host', permissions: [] }, session: { id: 'session', principalId: 'user', issuedAt: 1, expiresAt: 10_000, scope: { kind: 'personal', id: 'workspace' } } };
    const provider = { authenticate: () => identity, valid: true, isSessionValid() { return this.valid; } };
    const jay = new Jay(provider, { now: () => 1000 }), controller = new AbortController();
    const context = await jay.createContext({ id: 'license-test', input: { capability: 'inspect', data: null } }, { signal: controller.signal });
    const grant = { version: 1, productId: 'workstation', subject: { id: 'user', issuer: 'host' }, scope: identity.session.scope, features: ['inspect'], expiresAt: 2000 };
    const gate = verify => new ServerLicenseGate(jay, { verify }, 'workstation', () => 1000);
    return { jay, provider, context, controller, grant, gate };
}
test('license gate accepts only server-verified subject, scope, product, feature and unexpired grants', async () => {
    const f = await licenseFixture();
    assert.equal((await f.gate(() => f.grant).require(f.context, 'inspect')).productId, 'workstation');
    for (const change of [{ productId: 'other' }, { subject: { id: 'attacker', issuer: 'host' } }, { scope: { kind: 'company', id: 'workspace' } }, { features: [] }, { expiresAt: 1000 }, { secret: 'never-log' }])
        await assert.rejects(f.gate(() => ({ ...f.grant, ...change })).require(f.context, 'inspect'), LicenseError);
    await assert.rejects(f.gate(() => f.grant).require({ ...f.context }, 'inspect'), LicenseError);
});
test('revocation, cancellation and provider failures deny licenses without disclosing secrets', async () => {
    for (const mode of ['revoke','cancel','error']) {
        const f = await licenseFixture();
        await assert.rejects(f.gate(() => { if (mode === 'revoke') f.provider.valid = false; if (mode === 'cancel') f.controller.abort(); if (mode === 'error') throw new Error('secret-key'); return f.grant; }).require(f.context, 'inspect'), e => e instanceof LicenseError && !e.message.includes('secret-key'));
    }
});
