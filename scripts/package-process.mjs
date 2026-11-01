import { existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Never interpret a native executable or a Windows batch wrapper as JavaScript.
// Known wrappers are replaced by their adjacent CLI, so no shell is needed.
export function packageCommand(cli, args, node = process.execPath) {
    if (!isAbsolute(cli)) throw new Error('Package manager CLI must be an absolute path.');
    if (/\.(cmd|bat)$/i.test(cli)) {
        const name = basename(cli, extname(cli)).toLowerCase();
        const companions = name === 'npm'
            ? ['node_modules/npm/bin/npm-cli.js', 'npm/bin/npm-cli.js']
            : name === 'pnpm'
              ? ['node_modules/pnpm/pnpm.exe', 'node_modules/pnpm/bin/pnpm.cjs', 'node_modules/corepack/dist/pnpm.js']
              : [];
        const companion = companions.map(file => join(dirname(cli), file)).find(existsSync);
        if (!companion) throw new Error(`Cannot safely launch wrapper ${cli}. Set SHIVAX_NPM_CLI to an absolute npm/pnpm JavaScript CLI or native executable.`);
        return packageCommand(companion, args, node);
    }
    return /\.(?:[cm]?js)$/i.test(cli)
        ? { file: node, args: [cli, ...args] }
        : { file: cli, args: [...args] };
}

export function runCommand(file, args, cwd) {
    const result = spawnSync(file, args, {
        cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error([
            `Command failed: ${JSON.stringify([file, ...args])}`,
            `Working directory: ${cwd}`,
            `Exit status: ${result.status ?? 'unavailable'}; signal: ${result.signal ?? 'none'}`,
            `Spawn error: ${result.error ? `${result.error.code ?? ''} ${result.error.message}` : 'none'}`,
            `stdout:\n${result.stdout ?? ''}`,
            `stderr:\n${result.stderr ?? ''}`,
        ].join('\n'));
    }
    return result.stdout;
}

export function packageManager(cli) {
    const command = packageCommand(cli, []);
    const entry = command.file === process.execPath && command.args.length ? command.args[0] : command.file;
    const name = basename(entry).toLowerCase();
    if (!/^(?:pnpm|npm)(?:-cli)?(?:\.(?:exe|[cm]?js))?$/.test(name))
        throw new Error(`Unsupported package manager CLI: ${entry}. Set SHIVAX_NPM_CLI to npm or pnpm.`);
    const pnpm = name.startsWith('pnpm');
    return {
        name: pnpm ? 'pnpm' : 'npm',
        run(args, cwd) {
            return runCommand(command.file, [...command.args, ...args], cwd);
        },
        installArgs(tarball) {
            return pnpm
                ? ['add', '--offline', '--ignore-scripts', '--ignore-workspace', '--lockfile=false', '--config.auto-install-peers=false', tarball]
                : ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball];
        },
    };
}
