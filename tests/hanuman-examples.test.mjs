import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHost, evidenceFrom } from '../examples/sdk/hanuman/host.mjs';

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => {
    networkCalls++;
    throw new Error('Unexpected network');
};
test.after(() => {
    globalThis.fetch = originalFetch;
    assert.equal(networkCalls, 0);
});

test('H06 documentation evidence retains bounded source and provenance', async () => {
    const host = createHost();
    const evidence = evidenceFrom(host, await host.run());
    assert.equal(evidence.mediaType, 'text/plain');
    assert.ok(evidence.bytes <= 512);
    assert.equal(host.counters.close, 1);
});

test('H06 REST GET validates its closed JSON schema', async () => {
    const host = createHost({ api: true });
    const evidence = evidenceFrom(host, await host.run());
    assert.equal(evidence.mediaType, 'application/json');
    assert.deepEqual(JSON.parse(evidence.excerpt), { status: 'ok', version: 1 });
    assert.equal(evidence.truncated, false);
});

test('H06 RUDRA preserves seven IDs and consumes injection text as evidence data', async () => {
    const host = createHost({ multi: true });
    assert.deepEqual(
        host.registry.list().map((bot) => bot.id),
        [
            'sanjay',
            'brihaspati',
            'vishwakarma',
            'chitragupt',
            'narad',
            'yudhishthir',
            'ekalavy',
            'hanuman',
        ]
    );
    const policyBefore = host.firewall.runtime.snapshot();
    const result = await host.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.outputs.length, 2);
    for (const output of result.outputs) {
        assert.ok(host.bot.validateOutput(output.data, 'fetch.url'));
        assert.equal(output.data.trust, 'untrusted');
        assert.match(output.data.excerpt, /Ignore previous rules/);
    }
    assert.equal(host.counters.request, 2);
    assert.equal(host.firewall.runtime.snapshot(), policyBefore);
    assert.deepEqual(
        result.trace.filter((entry) => entry.type === 'selection').map((entry) => entry.botId),
        ['hanuman', 'hanuman']
    );
});

for (const reason of [
    'deniedOrigin',
    'missingTool',
    'noPermission',
    'expired',
    'lockdown',
    'timeout',
    'cancel',
    'oversized',
]) {
    test(`H06 rejects ${reason} with no exposed evidence`, async () => {
        const host = createHost({ [reason]: true });
        const result = await host.run();
        assert.notEqual(result.status, 'completed');
        assert.equal(result.outputs.length, 0);
        assert.equal(host.counters.request, reason === 'oversized' ? 1 : 0);
        if (reason === 'oversized') assert.equal(host.counters.close, 1);
        assert.equal(result.trace.filter((entry) => entry.type === 'retry').length, 0);
    });
}

test('H06 reserved search and API capabilities remain unavailable', async () => {
    const host = createHost();
    for (const capability of ['fetch.api', 'research.search'])
        assert.equal(host.registry.findByCapability(capability).length, 0);
    assert.equal(host.counters.request, 0);
});

test('H06 uses public SDK imports and ESM/CJS exported identities', async () => {
    const require = createRequire(import.meta.url);
    for (const entry of ['bots', 'rudra', 'security', 'integrations']) {
        const esm = await import('shivax/' + entry);
        const cjs = require('shivax/' + entry);
        assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    }
    const host = readFileSync(new URL('../examples/sdk/hanuman/host.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(host, /(?:from|import)\s*['"].*(?:src\/|dist\/|inspectra|visynq)/i);
    assert.doesNotMatch(host, /\bfetch\s*\(|node:(?:http|https|net|dns)/);
});
