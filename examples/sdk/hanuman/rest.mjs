import assert from 'node:assert/strict';
import { createHost, evidenceFrom } from './host.mjs';

const host = createHost({ api: true });
const evidence = evidenceFrom(host, await host.run());
assert.equal(evidence.mediaType, 'application/json');
assert.equal(evidence.truncated, false);
const payload = JSON.parse(evidence.excerpt);
// Closed fixture schema. Extract only these approved fields.
assert.deepEqual(Object.keys(payload).sort(), ['status', 'version']);
assert.equal(payload.status, 'ok');
assert.equal(payload.version, 1);
console.log(
    JSON.stringify({
        status: payload.status,
        version: payload.version,
        source: evidence.source,
        trust: evidence.trust,
    })
);
