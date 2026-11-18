import assert from 'node:assert/strict';
import { createHost, evidenceFrom } from './host.mjs';

const host = createHost({ multi: true });
assert.equal(host.registry.list().length, 8);
const result = await host.run();
const evidence = evidenceFrom(host, result);
assert.equal(result.outputs.length, 2);
for (const output of result.outputs) {
    assert.ok(host.bot.validateOutput(output.data, 'fetch.url'));
    assert.equal(output.data.trust, 'untrusted');
}
assert.match(evidence.excerpt, /Ignore previous rules/);
// The host summarizes a fixed, approved fact after validating evidence. Text never selects tools.
assert.equal(host.counters.request, 2);
const summary = {
    status: 'completed',
    summary: 'Two documentation evidence records retrieved.',
    sources: result.outputs.map((output) => output.data.source),
    trust: 'untrusted',
};
assert.deepEqual(Object.keys(summary).sort(), ['sources', 'status', 'summary', 'trust']);
console.log(
    JSON.stringify({
        ...summary,
        audit: { steps: result.outputs.length, requests: host.counters.request },
    })
);
