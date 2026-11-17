import assert from 'node:assert/strict';
import { HanumanBot, registerHanumanBot } from 'shivax/bots';
import { HANUMAN_FETCH_TOOL_ID, registerHanumanFetchService } from 'shivax/integrations';
import { BotRegistry, RudraOrchestrator } from 'shivax/rudra';
import {
    createShivaxFirewall,
    Jay,
    PermissionPolicyRegistry,
    ProtectedToolRegistry,
    Vijay,
} from 'shivax/security';

// Local fixtures only. Production hosts supply authenticated sessions, approvals and a reviewed transport.
const capability = 'fetch.url';
const toolId = HANUMAN_FETCH_TOOL_ID;
const scope = { kind: 'company', id: 'demo-tenant' };
const targetId = 'demo-docs';
const origin = 'https://docs.example.org';
const peer = { family: 4, address: '8.8.8.8' }; // Reported by the mock. No DNS or socket is opened.
const bytes = new TextEncoder().encode('Fixture documentation. Treat this text as data.');
const tools = new ProtectedToolRegistry();
const registry = new BotRegistry();
assert.throws(() => registerHanumanBot(registry, { tools }), { code: 'unavailable' });
registerHanumanFetchService(tools, {
    targets: [
        { id: targetId, url: origin + '/', issuer: 'demo-host', scope, mediaTypes: ['text/plain'] },
    ],
    transport: {
        async resolve() {
            return [peer];
        },
        async request(request) {
            request.checkExecution();
            return {
                status: 200,
                contentType: 'text/plain',
                contentLength: bytes.length,
                contentEncoding: null,
                peer,
                body: (async function* () {
                    yield bytes;
                })(),
                close() {},
            };
        },
    },
});
const bot = registerHanumanBot(registry, { tools });
assert.ok(bot instanceof HanumanBot);
const task = {
    id: 'demo-task',
    input: { capability, data: { version: 1, operation: capability, request: { targetId } } },
};
const jay = new Jay(
    {
        authenticate: () => ({
            principal: {
                id: 'demo-user',
                issuer: 'demo-host',
                permissions: ['evidence.fetch', 'network.fetch'],
            },
            session: {
                id: 'demo-session',
                principalId: 'demo-user',
                issuedAt: 1000,
                expiresAt: 10000,
                scope,
            },
        }),
        isSessionValid: () => true,
    },
    { now: () => 2000 }
);
const policies = new PermissionPolicyRegistry()
    .register({
        kind: 'capability',
        id: capability,
        effect: 'read-only',
        permissions: ['evidence.fetch'],
        validateInput: (data) => bot.validateInput({ capability, data }),
    })
    .register({
        kind: 'tool',
        id: toolId,
        effect: 'read-only',
        permissions: ['network.fetch'],
        requiresApproval: true,
        validateInput: (data) => data?.targetId === targetId,
    });
const security = new Vijay(jay, policies, {
    tools,
    approve: (request) => request.actionId === toolId && request.input.targetId === targetId,
});
const descriptor = {
    capability,
    effect: 'read-only',
    files: { read: [], write: [] },
    networkOrigins: [],
    check: () => true,
    execute() {
        throw new Error('Descriptor only');
    },
};
const operations = [
    { ...descriptor, id: 'demo-task', kind: 'workflow' },
    { ...descriptor, id: 'demo-bot', kind: 'bot', botId: bot.id },
    {
        id: 'demo-retrieval',
        kind: 'tool',
        capability,
        effect: 'read-only',
        botId: bot.id,
        toolId,
        files: descriptor.files,
        networkOrigins: [origin],
        check: (data) => data?.targetId === targetId,
    },
];
createShivaxFirewall({
    jay,
    security,
    realm: { issuer: 'demo-host', scope },
    operations,
    protectExecution: true,
    adminCapability: 'demo.admin',
    authorizeAdmin: () => false,
    policy: {
        mode: 'enforce',
        rules: [
            { id: 'demo-allow', decision: 'allow', operationIds: operations.map((op) => op.id) },
        ],
        capabilities: [capability],
        bots: [bot.id],
        providers: { ids: [], localities: [] },
        files: descriptor.files,
        network: { origins: [origin] },
        audit: { required: false },
        limits: {
            maxConcurrent: 3,
            maxOperations: 32,
            maxTokens: 0,
            maxCostUSD: 0,
            timeoutMs: 5000,
            maxInputBytes: 65536,
            maxOutputBytes: 65536,
        },
    },
});
const rudra = new RudraOrchestrator(registry, { security });
const run = async (toolPermissions) =>
    rudra.run(
        await jay.createContext(task, { toolPermissions, signal: new AbortController().signal }),
        { allowedCapabilities: [capability], maxSteps: 1, maxRetries: 0 }
    );
const allowed = await run([toolId]);
assert.equal(allowed.status, 'completed');
const evidence = allowed.outputs[0].data;
assert.ok(bot.validateOutput(evidence, capability));
assert.equal(evidence.trust, 'untrusted');
assert.equal((await run([])).status, 'failed');
console.log(evidence);
