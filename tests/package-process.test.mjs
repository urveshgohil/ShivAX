import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { packageCommand, packageManager, runCommand } from '../scripts/package-process.mjs';

function fixture(work) {
    const directory = mkdtempSync(join(tmpdir(), 'shivax-process space & '));
    try { return work(directory); }
    finally { rmSync(directory, { recursive: true, force: true }); }
}

test('JavaScript CLIs use Node and preserve spaces and shell metacharacters literally', () => fixture(directory => {
    const cli = join(directory, 'npm-cli.js');
    writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const args = ['space value', 'a&b', '$(echo unsafe)', '%PATH%', 'quote"value', 'pipe|value'];
    const command = packageCommand(cli, args);
    assert.equal(command.file, process.execPath);
    assert.deepEqual(JSON.parse(runCommand(command.file, command.args, directory)), args);
}));

test('native executable paths are launched directly, never as Node entrypoints', () => fixture(directory => {
    const command = packageCommand(process.execPath, ['-e', 'console.log("native-ok")']);
    assert.equal(command.file, process.execPath);
    assert.equal(command.args[0], '-e');
    assert.equal(runCommand(command.file, command.args, directory).trim(), 'native-ok');
    const exe = join(directory, 'pnpm.exe');
    assert.deepEqual(packageCommand(exe, ['pack']), { file: exe, args: ['pack'] });
}));

for (const extension of ['cmd', 'bat']) {
    test(`${extension} wrappers resolve known adjacent CLIs without a command shell`, () => fixture(directory => {
        for (const [name, companion] of [['npm', 'node_modules/npm/bin/npm-cli.js'], ['pnpm', 'node_modules/pnpm/bin/pnpm.cjs']]) {
            const wrapper = join(directory, `${name}.${extension}`);
            writeFileSync(wrapper, 'this wrapper must never execute');
            const cli = join(directory, companion);
            mkdirSync(dirname(cli), { recursive: true });
            writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)))');
            const command = packageCommand(wrapper, ['literal&argument']);
            assert.equal(command.file, process.execPath);
            assert.deepEqual(JSON.parse(runCommand(command.file, command.args, directory)), ['literal&argument']);
            assert.equal(packageManager(wrapper).name, name);
        }
        assert.throws(() => packageCommand(join(directory, `unknown.${extension}`), []), /Cannot safely launch wrapper/);
    }));
}

test('unsafe or unsupported manager selection fails with setup guidance', () => fixture(directory => {
    assert.throws(() => packageCommand('pnpm', []), /absolute path/);
    assert.throws(() => packageManager(join(directory, 'other.exe')), /Unsupported package manager/);
    assert.throws(() => packageCommand(join(directory, 'npm.cmd'), []), /SHIVAX_NPM_CLI/);
}));

test('process errors include command, status, stdout, stderr and spawn failure', () => fixture(directory => {
    assert.throws(() => runCommand(process.execPath, ['-e', 'console.log("OUT");console.error("ERR");process.exit(7)'], directory), error => {
        for (const text of ['Command failed:', 'Exit status: 7', 'stdout:\nOUT', 'stderr:\nERR', 'Spawn error: none'])
            assert.ok(error.message.includes(text), error.message);
        return true;
    });
    assert.throws(() => runCommand(join(directory, 'missing-executable'), [], directory), /Spawn error: ENOENT/);
}));

test('both managers retain offline, script-free isolated installation', () => fixture(directory => {
    const tarball = join(directory, 'package.tgz');
    for (const name of ['npm', 'pnpm']) {
        const manager = packageManager(join(directory, `${name}.exe`));
        const args = manager.installArgs(tarball);
        assert.ok(args.includes('--offline'));
        assert.ok(args.includes('--ignore-scripts'));
        assert.equal(args.at(-1), tarball);
        if (name === 'pnpm') assert.ok(args.includes('--ignore-workspace'));
    }
}));

test('failed package command preserves diagnostics and cleans the temporary consumer', () => fixture(directory => {
    const cli = join(directory, 'npm-cli.js');
    writeFileSync(cli, 'console.log("PACK_OUT");console.error("PACK_ERR");process.exit(9)');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const temporary = () => readdirSync(tmpdir()).filter(name => name.startsWith('.shivax-sdk-pack-')).sort();
    const before = temporary();
    const result = spawnSync(process.execPath, ['scripts/check-sdk-package.mjs'], {
        cwd: root, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, SHIVAX_NPM_CLI: cli },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Exit status: 9/);
    assert.match(result.stderr, /PACK_OUT/);
    assert.match(result.stderr, /PACK_ERR/);
    assert.deepEqual(temporary(), before);
}));
