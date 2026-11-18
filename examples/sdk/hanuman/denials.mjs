import assert from 'node:assert/strict';
import { createHost } from './host.mjs';

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
    const host = createHost({ [reason]: true });
    const result = await host.run();
    assert.notEqual(result.status, 'completed');
    assert.equal(result.outputs.length, 0);
    if (reason === 'oversized') {
        assert.equal(host.counters.request, 1);
        assert.equal(host.counters.close, 1);
    } else {
        assert.equal(host.counters.request, 0);
    }
    console.log(
        JSON.stringify({
            reason,
            status: result.status,
            code: result.error.code,
            requests: host.counters.request,
        })
    );
}
