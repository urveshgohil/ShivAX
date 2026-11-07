// Managed firewall with one CPU registration. Offline; no model, network or file access.
// The identity adapter below is a labelled local mock. Production hosts must verify a
// real session on a trusted server or desktop host and keep `admin` out of bot contexts.
import { Jay, Vijay, PermissionPolicyRegistry, ProtectedToolRegistry, createShivaxFirewall } from 'shivax/security';

const scope = { kind: 'company', id: 'example-tenant' };
const now = Date.now();
const identity = {
    principal: { id: 'example-user', issuer: 'example-host', permissions: ['numeric', 'firewall-admin'] },
    session: { id: 'example-session', principalId: 'example-user', issuedAt: now, expiresAt: now + 60_000, scope },
};
const jay = new Jay({ authenticate: () => identity, isSessionValid: () => true });
const policies = new PermissionPolicyRegistry()
    .register({ kind: 'capability', id: 'numeric.square', effect: 'read-only', permissions: ['numeric'], validateInput: () => true })
    .register({ kind: 'capability', id: 'firewall.admin', effect: 'state-changing', permissions: ['firewall-admin'], validateInput: () => true });
// Host approval callback. A real host asks a person; this example approves only the lockdown it performs.
const security = new Vijay(jay, policies, { tools: new ProtectedToolRegistry(), approve: request => request.actionId === 'firewall.admin' });

const firewall = createShivaxFirewall({
    jay, security,
    realm: { issuer: 'example-host', scope },
    adminCapability: 'firewall.admin',
    // Separate host role check. Identity comes from Jay, never from task or model data.
    authorizeAdmin: (root, signal) => jay.assertActive(root, signal).principal.permissions.includes('firewall-admin'),
    operations: [{
        id: 'square', kind: 'cpu', capability: 'numeric.square', effect: 'read-only',
        files: { read: [], write: [] }, networkOrigins: [],
        check: input => typeof input === 'number' && Number.isFinite(input),
        execute: input => input ** 2,
    }],
    policy: {
        mode: 'enforce',
        rules: [{ id: 'square.allow', decision: 'allow', operationIds: ['square'] }],
        capabilities: ['numeric.square'], bots: [],
        providers: { ids: [], localities: [] },
        files: { read: [], write: [] }, network: { origins: [] },
        limits: { maxConcurrent: 2, maxOperations: 10, maxTokens: 0, maxCostUSD: 0, timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 },
        audit: { required: false },
    },
});

const controller = new AbortController();
const root = await jay.createContext({ id: 'example-task', input: { capability: 'numeric.square', data: 3 } }, { signal: controller.signal });

console.log('square(3) =', await firewall.runtime.execute(root, 'square', 3));
try {
    await firewall.runtime.execute(root, 'unregistered', 3);
} catch (error) {
    console.log('unregistered operation:', error.code);
}
await firewall.admin.lockdown(root, firewall.runtime.snapshot().version);
console.log('mode after lockdown:', firewall.runtime.snapshot().policy.mode);
console.log('CPU registration in lockdown: square(4) =', await firewall.runtime.execute(root, 'square', 4));
