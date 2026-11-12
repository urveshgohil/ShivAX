import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as esm from 'shivax/adapters/inspectra';
import configurations from '../rollup.config.mjs';

const require = createRequire(import.meta.url);
const context = () => ({
    session: { scope: { kind: 'personal', id: 'adapter-test' } },
    signal: new AbortController().signal,
});

test('both Rollup configurations externalize Inspectra package subpaths only at package boundaries', () => {
    for (const { external } of configurations) {
        for (const id of ['inspectra-engine', 'inspectra-engine/node', 'inspectra-engine/client'])
            assert.equal(external(id), true, id);
        for (const id of ['inspectra-engine-other', './inspectra-engine/node', 'another-package'])
            assert.equal(external(id), false, id);
    }
});

for (const [format, api] of [['ESM', esm], ['CJS', require('shivax/adapters/inspectra')]]) {
    test(`${format}: failed lazy loading gives installation guidance without leaking provider errors`, async () => {
        let loads = 0, pages = 0;
        const provider = new api.InspectraInspectionProvider({
            openPage() { pages++; },
            async load() { loads++; throw Error('PRIVATE_TOKEN /private/path https://private.test'); },
        });
        assert.equal(loads, 0);
        await assert.rejects(provider.capture({}, context()), error => {
            assert.match(error.message, /Install optional peer inspectra-engine in the supported peer range/);
            assert.doesNotMatch(error.message, /PRIVATE_TOKEN|private/);
            assert.equal(error.cause, undefined);
            return true;
        });
        assert.equal(loads, 1);
        assert.equal(pages, 0);
    });

    test(`${format}: missing captureUIPage reports incompatible API before acquiring a page`, async () => {
        for (const module of [null, undefined, {}, { captureUIPage: 'invalid' }]) {
            const provider = new api.InspectraInspectionProvider({
                openPage() { assert.fail('must not acquire a page'); },
                load: async () => module,
            });
            await assert.rejects(provider.capture({}, context()), /Incompatible Inspectra API: expected captureUIPage/);
        }
    });

    test(`${format}: cancellation during failed module loading takes precedence over installation errors`, async () => {
        const controller = new AbortController();
        const provider = new api.InspectraInspectionProvider({
            openPage() { assert.fail('must not acquire a page'); },
            async load() { controller.abort(); throw Error('PRIVATE'); },
        });
        await assert.rejects(provider.capture({}, { ...context(), signal: controller.signal }),
            { message: 'Inspection cancelled.' });
    });

    test(`${format}: pre-cancellation and host rejection prevent loading`, async () => {
        const provider = new api.InspectraInspectionProvider({
            openPage() { assert.fail('must not acquire a page'); },
            load() { assert.fail('must not load'); },
        });
        await assert.rejects(provider.capture({}, { ...context(), signal: AbortSignal.abort() }),
            { message: 'Inspection cancelled.' });
        await assert.rejects(provider.capture({}, {
            ...context(), checkExecution() { throw Error('PRIVATE'); },
        }), { message: 'Inspectra capture failed.' });
    });

    test(`${format}: invalid capture data stays sanitized and closes the lease once`, async () => {
        let closes = 0;
        const provider = new api.InspectraInspectionProvider({
            openPage: async () => ({ page: {}, close() { closes++; } }),
            load: async () => ({ captureUIPage: async () => ({ private: 'PRIVATE' }) }),
        });
        await assert.rejects(provider.capture({}, context()), { message: 'Inspectra capture failed.' });
        assert.equal(closes, 1);
    });
}
