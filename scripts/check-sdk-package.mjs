import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { packageManager, runCommand } from './package-process.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = resolve(tmpdir());
const directory = mkdtempSync(join(temporaryRoot, '.shivax-sdk-pack-'));
function command(file, args, cwd = directory) {
    return runCommand(file, args, cwd);
}
try {
    const cli = process.env.SHIVAX_NPM_CLI || process.env.npm_execpath;
    if (!cli) throw new Error('Run npm run verify:package or pnpm verify:package, or set SHIVAX_NPM_CLI.');
    const manager = packageManager(cli);
    console.log(`Verifying package with ${manager.name}; Node ${process.version}.`);
    const result = JSON.parse(manager.run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root));
    // npm returns an array; pnpm returns an object with an absolute filename.
    const packed = Array.isArray(result) ? result[0] : result;
    const tarball = resolve(directory, packed.filename);
    const tarballRelative = relative(directory, tarball);
    if (!tarballRelative || isAbsolute(tarballRelative) || tarballRelative.startsWith('..') || !tarball.endsWith('.tgz'))
        throw new Error('Package manager returned an unexpected tarball path.');
    const consumer = join(directory, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    manager.run(manager.installArgs(tarball), consumer);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    const entries = Object.keys(manifest.exports).map(name => name === '.' ? 'shivax' : name.replace('.', 'shivax'));
    writeFileSync(join(consumer, 'verify.mjs'), `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);
for (const name of ${JSON.stringify(entries)}) {const esm=await import(name); const cjs=require(name); assert.deepEqual(Object.keys(esm).sort(),Object.keys(cjs).sort());}
for (const api of [await import('shivax/security'), require('shivax/security')]) {
assert.equal(typeof api.createShivaxFirewall, 'function');
assert.throws(() => api.createShivaxFirewall(), error => error.code === 'invalid-configuration');
}
console.log('Packed ESM/CJS SDK imports passed.');`);
    process.stdout.write(command(process.execPath, ['verify.mjs'], consumer));
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const source = entries.map((entry, i) => `import * as entry${i} from '${entry}'; void entry${i};`).join('\n') + `
import { ModelError, type ModelFailureReason, type ModelErrorDetails } from 'shivax/models';
const reasons: readonly ModelFailureReason[] = ['token-limit-exceeded', 'cost-limit-exceeded', 'invalid-provider-output', 'usage-unverifiable', 'provider-timeout'];
for (const reason of reasons) { const error = new ModelError(reason); const details: ModelErrorDetails = error; void details.reason; }
// @ts-expect-error Only documented failure classifications are accepted.
new ModelError('unrecognized-provider-error');
import { createShivaxFirewall, FirewallError, type FirewallMode, type ShivaxFirewallOptions,
    type FirewallPolicySnapshot } from 'shivax/security';
import type { TaskContext } from 'shivax';
declare const firewallOptions: ShivaxFirewallOptions;
declare const authenticatedRoot: TaskContext;
const firewall = createShivaxFirewall({ ...firewallOptions, protectExecution: true });
const snapshot: FirewallPolicySnapshot = firewall.runtime.snapshot();
const mode: FirewallMode = snapshot.policy.mode;
void firewall.runtime.execute(authenticatedRoot, 'operation', null);
void firewall.admin.rollback(authenticatedRoot, snapshot.version, 1);
void mode; void new FirewallError('denied');
import { createGuardedModelGateway, type RemoteTransportPolicy } from 'shivax/models';
const guardedModel = createGuardedModelGateway(firewall.runtime, {
    capability: 'text-reasoning', operationIds: ['approved-model'], timeoutMs: 1000,
});
void guardedModel(authenticatedRoot, null);
declare const transportPolicy: RemoteTransportPolicy;
transportPolicy.checkDestination(transportPolicy.endpoint);
import type { InspectraPageSecurity } from 'shivax/adapters/inspectra';
declare const pageSecurity: InspectraPageSecurity;
pageSecurity.checkDestination('https://approved.example/');
// @ts-expect-error Guarded routes require an authenticated TaskContext, not a task payload.
void guardedModel({ permissions: ['*'] }, null);
import { openShivaxFirewallManagement, type FirewallManagementOptions, type FirewallPolicyStore } from 'shivax/security';
declare const managementOptions: FirewallManagementOptions<{ session: string }>;
declare const policyStore: FirewallPolicyStore;
declare const managementSignal: import('shivax').BotSignal;
void openShivaxFirewallManagement({ ...managementOptions, store: policyStore }, managementSignal).then(host => {
    void host.management.requestChange({ session: 'host-session' }, { expectedVersion: 1, profileId: 'approved' }, managementSignal);
    // @ts-expect-error Clients cannot submit arbitrary policies.
    void host.management.requestChange({ session: 'host-session' }, { expectedVersion: 1, policy: snapshot.policy }, managementSignal);
    // @ts-expect-error Management hosts do not expose the raw admin controller.
    host.admin.lockdown(authenticatedRoot, 1);
});
// @ts-expect-error Runtime consumers cannot mutate the mode directly.
firewall.runtime.setMode('monitor');
// @ts-expect-error Unsupported modes are not accepted.
const invalidMode: FirewallMode = 'disabled';
void invalidMode;
import { Tensor } from 'shivax/core';
import { Jay } from 'shivax/security';
import type { Tensor as RootTensor, Jay as RootJay, InspectionProvider } from 'shivax';
import { InspectraInspectionProvider } from 'shivax/adapters/inspectra';
import { ServerLicenseGate } from 'shivax/licensing/server';
const tensor: RootTensor = new Tensor([1], [1]);
declare const jay: Jay; const rootJay: RootJay = jay;
const provider: InspectionProvider = new InspectraInspectionProvider({openPage: async () => ({page: {}, close() {}})});
new ServerLicenseGate(rootJay, { verify: () => null }, 'typed-product');
void tensor; void rootJay; void provider;
// @ts-expect-error Tensor data must be array-like, not a number.
new Tensor(42, [1]);
`;
    for (const [extension, module, moduleResolution] of [
        ['ts', 'ESNext', 'bundler'], ['mts', 'Node16', 'Node16'],
        ['cts', 'Node16', 'Node16'], ['mts', 'NodeNext', 'NodeNext'],
        ['cts', 'NodeNext', 'NodeNext'],
    ]) {
        const file = `consumer.${extension}`;
        writeFileSync(join(consumer, file), source);
        writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module, moduleResolution,
        }, files: [file] }));
        command(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], consumer);
        console.log(`PASS declarations: ${extension}, ${moduleResolution}, ${entries.length} entries.`);
    }
    console.log(`Packed declarations passed for ${entries.length} entries; ${packed.entryCount ?? packed.files.length} packaged files.`);
} finally {
    const checked = resolve(directory), suffix = relative(temporaryRoot, checked);
    if (suffix && !suffix.startsWith('..') && suffix.startsWith('.shivax-sdk-pack-')) rmSync(checked, { recursive: true, force: true });
}
