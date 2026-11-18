import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = Object.freeze({
    examples: 'tests/hanuman-examples.test.mjs',
    gateway: 'tests/hanuman-fetch.test.mjs',
    bot: 'tests/hanuman-bot.test.mjs',
    integration: 'tests/hanuman-integration.test.mjs',
    firewall: 'tests/firewall-integration.test.mjs',
    cost: 'tests/model-cost.test.mjs',
    routing: 'tests/learning-routing.test.mjs',
});

/** Opt-in offline test harness. Each named suite owns a child process and deadline. */
export async function runCanaries({ selected, concurrency = 1, deadlineMs = 30000 } = {}) {
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length ||
        selected.some((name) => typeof name !== 'string' || !Object.hasOwn(fixtures, name)) ||
        !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
        !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120000)
        throw new TypeError('Invalid canary selection or limits');
    const results = new Array(selected.length);
    let next = 0;
    async function worker() {
        while (next < selected.length) {
            const index = next++;
            const id = selected[index];
            results[index] = await new Promise((resolve) => {
                const env = { ...process.env };
                delete env.NODE_TEST_CONTEXT;
                const child = spawn(process.execPath, [
                    '--test', '--experimental-test-isolation=none', fixtures[id],
                ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
                let tail = '', expired = false, failed = false;
                const append = (chunk) => { tail = (tail + chunk.toString()).slice(-16384); };
                child.stdout.on('data', append);
                child.stderr.on('data', append);
                child.on('error', () => { failed = true; });
                const timer = setTimeout(() => { expired = true; child.kill(); }, deadlineMs);
                child.on('close', (code) => {
                    clearTimeout(timer);
                    const count = (name) => Number(tail.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
                    const total = count('tests'), pass = count('pass'), fail = count('fail');
                    resolve(Object.freeze({ id, status: !expired && !failed && code === 0 && total > 0 && pass === total ? 'pass' : 'fail',
                        total, pass, fail, skipped: count('skipped'), todo: count('todo'), cancelled: count('cancelled'), timedOut: expired }));
                });
            });
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
    return Object.freeze({ version: 1, results: Object.freeze(results),
        status: results.every((result) => result.status === 'pass') ? 'pass' : 'fail' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const selected = process.argv.slice(2);
    try {
        const result = await runCanaries({ selected });
        console.log(JSON.stringify(result));
        if (result.status !== 'pass') process.exitCode = 1;
    } catch {
        console.error('Invalid canary selection or limits');
        process.exitCode = 2;
    }
}
