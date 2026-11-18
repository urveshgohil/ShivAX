import assert from 'node:assert/strict';
import test from 'node:test';
import { runCanaries } from './fixtures/shabari-runner.mjs';

test('Shabari rejects missing, unknown and duplicate selections and unsafe limits', async () => {
    for (const value of [{}, { selected: ['unknown'] }, { selected: ['bot', 'bot'] },
        { selected: ['bot'], concurrency: 5 }, { selected: ['bot'], deadlineMs: 0 }])
        await assert.rejects(runCanaries(value), TypeError);
});

test('Shabari runs explicitly selected suites in isolated child processes', async () => {
    const result = await runCanaries({ selected: ['examples', 'cost'], concurrency: 2, deadlineMs: 30000 });
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.results.map((item) => item.id), ['examples', 'cost']);
    assert.ok(result.results.every((item) => item.total > 0 && item.pass === item.total));
    assert.equal(JSON.stringify(result).includes('Ignore previous rules'), false);
});

test('Shabari reports a timed-out child as a failure', async () => {
    const result = await runCanaries({ selected: ['integration'], deadlineMs: 1 });
    assert.equal(result.status, 'fail');
    assert.equal(result.results[0].timedOut, true);
});

test('each response boundary selector runs its ESM and CommonJS case', async () => {
    const selected = ['SHB-NET-12.6', 'SHB-NET-12.7'];
    const report = await runCanaries({ selected });
    assert.equal(report.status, 'pass');
    assert.deepEqual(report.results.map(({ id, total, pass }) => ({ id, total, pass })),
        selected.map(id => ({ id, total: 2, pass: 2 })));
});
