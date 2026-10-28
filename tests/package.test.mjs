import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LEGACY_RUNTIME_EXPORTS, LEGACY_TYPE_EXPORTS } from './fixtures/legacy-api.mjs';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package exports load in both ESM and CommonJS', async () => {
    const esm = await import('shivax');
    const cjs = require('shivax');
    assert.equal(esm.VERSION, manifest.version);
    assert.equal(cjs.VERSION, manifest.version);
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    for (const name of LEGACY_RUNTIME_EXPORTS) {
        assert.ok(Object.hasOwn(esm, name), `Legacy ESM export missing: ${name}`);
        assert.ok(Object.hasOwn(cjs, name), `Legacy CommonJS export missing: ${name}`);
    }
    assert.equal(typeof esm.Tensor, 'function');
    assert.equal(typeof cjs.NeuralNet, 'function');
});

test('production package has no dependency or install-script overhead', () => {
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
    assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
        assert.equal(manifest.scripts[hook], undefined);
    }
    assert.equal(manifest.license, 'Apache-2.0');
});

test('public declarations and license are present', () => {
    assert.match(readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8'), /VERSION/);
    assert.match(readFileSync(new URL('../dist/types/index.d.ts', import.meta.url), 'utf8'), /ModelConfig/);
    assert.match(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), /Version 2.0, January 2004/);
});

test('core and bot consumers type-check public exports with ES2020 alone and no ambient platform types', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shivax-types-'));
    try {
        const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
        writeFileSync(join(directory, 'consumer.ts'), `
import {
    validateFeedback, validateEvaluationRecord, validateTrainingExport, trainCuratedCandidate, evaluateDataset, EvaluatedModelUpdates,
    type FeedbackRecord, type EvaluationRecord, type CuratedTrainingRow,
    NeuralNet, SLMClient, BotRegistry, BotExecutor, BotEventEmitter, createTaskContext,
    type Task, type BotTask, type Bot, type BotInput, type BotSignal, type BotResult,
    type ToolDescriptor, type BotErrorCode, RudraOrchestrator, CapabilityPlanner,
    type Planner, type WorkflowPlan, type RudraResult, type RudraTaskStatus,
    Jay, Vijay, PermissionPolicyRegistry, ProtectedToolRegistry, SecurityAuditLog,
    type IdentityProvider, type AuthenticatedIdentity, type ProtectedTool, type SecurityDecision,
    createSpecialistBots, createSpecialistSystem, SessionMemoryStore, SessionFeedbackStore,
    SanjayBot, BrihaspatiBot, VishwakarmBot, ChitraguptBot, NaradBot, YudhishthirBot, EkalavyBot,
    type MemoryStorage, type FeedbackStorage, type VisionModelAdapter, type ReasoningProvider, type CodeProvider, type ReviewProvider,
    ModelProviderRegistry, ModelRouter, NeuralModelProvider, RulesModelProvider, RemoteModelAdapter, OllamaModelAdapter, createModelOperation,
    type ModelProvider, type ModelRequest, type ModelResponse, type ModelResult,
    MemoryEngine, MemoryTaskLifecycle, InMemoryMemoryAdapter, NodeFileMemoryAdapter, IndexedDBMemoryAdapter,
    type MemoryStore, type MemoryRecord, type MemoryPersistence, type MemoryFileSystem,
    InspectionPlanner, registerInspectionService, validateInspectionObservation, createInspectionVisionAdapter,
    type InspectionProvider, type InspectionObservation, type InspectionRequest,
    RudraWorkflowEngine, ToolRegistry, WorkflowError, type WorkflowTool, type WorkflowRun,
    type AutonomousWorkflowPlan, type ToolCallProposal, type WorkflowSnapshot, type WorkflowOptions,
} from ${JSON.stringify(entry)};
import type { ${LEGACY_TYPE_EXPORTS.map(name => `${name} as Legacy_${name}`).join(', ')} } from ${JSON.stringify(entry)};
import { InspectraInspectionProvider } from ${JSON.stringify(fileURLToPath(new URL('../adapters/inspectra/index.mjs', import.meta.url)))};
const adapterProvider: InspectionProvider = new InspectraInspectionProvider({ openPage: async (request, context) => ({ page: {}, close() {} }) });
const legacyTask: Task = 'binary';
const learningUpdates = new EvaluatedModelUpdates({ model: null, configuration: {} });
const learningFeedback: FeedbackRecord = validateFeedback({ version: 1, id: 'f', taskId: 't', botId: 'b', domain: 'routing', input: null, output: null, decision: 'accept' });
const net = new NeuralNet({ layers: [2, 1], task: legacyTask });
const models = new ModelProviderRegistry().register(new NeuralModelProvider('numeric', net));
const modelsRouter = new ModelRouter(models, { scope: { kind: 'personal', id: 'typed' } });
const hybridReasoning: ReasoningProvider = { id: 'hybrid', decide: createModelOperation(modelsRouter, 'text-reasoning', { schema: { type: 'object' } }) };
const hybridVision: VisionModelAdapter = { id: 'vision', analyze: createModelOperation(modelsRouter, 'visual-interpretation', { schema: { type: 'object' } }) };
const rules: ModelProvider = new RulesModelProvider('rules', [{ id: 'number', validate: value => typeof value === 'number', run: value => ({ valid: value !== null }) }]);
const remote: ModelProvider = new RemoteModelAdapter({ id: 'remote', capabilities: ['text-reasoning'], pricing: { inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 0 },
    load: async () => ({ infer: (request: ModelRequest): ModelResponse => ({ data: request.input, usage: { inputTokens: null, outputTokens: null, costUSD: null } }) }) });
const local: ModelProvider = new OllamaModelAdapter({ model: 'host-configured-model' });
const recordMemory: MemoryStore = new MemoryEngine({ persistence: new InMemoryMemoryAdapter() });
const browserMemory: MemoryStore = new MemoryEngine({ persistence: new IndexedDBMemoryAdapter({ database: 'typed-memory' }) });
declare const injectedFs: MemoryFileSystem;
const fileMemory: MemoryStore = new MemoryEngine({ persistence: new NodeFileMemoryAdapter({ path: '/host/memory.json', fs: injectedFs }) });
let optionalClient: SLMClient | undefined;
declare const signal: BotSignal;
declare const memoryRecord: MemoryRecord;
recordMemory.update(memoryRecord.namespace, memoryRecord.id, { value: 'edit' }, signal, {
    expectedRevision: memoryRecord.revision, expectedGeneration: memoryRecord.generation ?? null,
});
recordMemory.delete(memoryRecord.namespace, memoryRecord.id, signal, memoryRecord.revision, memoryRecord.generation ?? null);
// Existing callers can continue to omit the generation precondition.
recordMemory.delete(memoryRecord.namespace, memoryRecord.id, signal, memoryRecord.revision);
const task: BotTask = { id: 'typed-task', input: { capability: 'echo', data: 'text' } };
const tool: ToolDescriptor = { id: 'demo.read', description: 'Metadata only' };
const context = createTaskContext(task, { sessionId: 'typed-session', signal, security: {
    caller: { id: 'trusted-user', issuer: 'trusted-host' },
    scope: { kind: 'personal', id: 'typed-scope' }, toolPermissions: [tool.id],
} });
const bot: Bot<string, string> = {
    id: 'typed', capabilities: [{ id: 'echo', description: 'Echo input' }],
    validateInput(input): input is BotInput<string> { return typeof input.data === 'string'; },
    validateOutput(data): data is string { return typeof data === 'string'; },
    execute(input, context) { return { botId: 'typed', taskId: context.task.taskId, status: 'completed', data: input.data }; },
};
const events = new BotEventEmitter();
events.on('bot:failed', event => { const code: BotErrorCode = event.error.code; });
// @ts-expect-error Completed events do not expose an error or task payload.
events.on('bot:completed', event => { event.error; });
// @ts-expect-error Event names are checked.
events.on('invented-event', () => {});
// @ts-expect-error The existing ML Task contract is not replaced by BotTask.
const incompatibleTask: Task = task;
// @ts-expect-error Host identity is readonly in the execution snapshot.
context.security.caller.id = 'other';
new BotRegistry(events).register(bot);
const result: Promise<BotResult<string>> = new BotExecutor(events).execute(bot, context);
const workflow: WorkflowPlan = { steps: [{ id: 'echo', capability: 'echo', input: { source: 'task' } }] };
const planner: Planner = { plan: request => { const signal: BotSignal = request.signal; return workflow; } };
const rudra = new RudraOrchestrator(new BotRegistry().register(bot), {
    planner, approve: async request => request.input.capability === 'echo',
    onTrace: entry => { const status: RudraTaskStatus | undefined = entry.status; },
});
const workflowResult: Promise<RudraResult> = rudra.run(context, { maxSteps: 2, maxRetries: 0 });
const defaultPlanner: Planner = new CapabilityPlanner();
// @ts-expect-error Workflow input references are explicitly discriminated.
const badWorkflow: WorkflowPlan = { steps: [{ id: 'bad', capability: 'echo', input: { source: 'step' } }] };
// @ts-expect-error A model plan cannot change host permissions.
const escalated: WorkflowPlan = { steps: [], security: context.security };
declare const verifiedIdentity: AuthenticatedIdentity;
const identityProvider: IdentityProvider = {
    authenticate: async signal => verifiedIdentity,
    isSessionValid: async (identity, signal) => identity.session.principalId === identity.principal.id,
};
const audit = new SecurityAuditLog();
const jay = new Jay(identityProvider, { audit });
const policies = new PermissionPolicyRegistry().register({
    kind: 'capability', id: 'echo', permissions: ['echo'], effect: 'read-only', validateInput: () => true,
});
const protectedTool: ProtectedTool<string, string> = {
    id: 'read', validateInput: (input): input is string => typeof input === 'string',
    validateOutput: (output): output is string => typeof output === 'string',
    execute: async (input, context) => input,
};
const tools = new ProtectedToolRegistry().register(protectedTool);
declare const captured: InspectionObservation;
const inspection: InspectionProvider = { id: 'typed-capture', capture: async (request, context) => captured };
registerInspectionService(tools, inspection, { authorizeURL: (url, identity) => identity.principal.id === 'tester' });
const inspectionPlanner: Planner = new InspectionPlanner();
const inspectionVision: VisionModelAdapter = createInspectionVisionAdapter('typed-vision', modelsRouter);
const inspectionRequest: InspectionRequest = { reference: { kind: 'url', url: 'https://fixture.test/reference' }, target: 'https://fixture.test/target', viewport: { width: 800, height: 600 } };
validateInspectionObservation(captured, context.security.scope);
const security = new Vijay(jay, policies, { tools, audit, approve: async request => request.effect === 'read-only' });
const workflowTool: WorkflowTool = { id: 'typed.read', capability: 'read', effect: 'read-only', parallelSafe: true,
    validateInput: (input): input is number => typeof input === 'number',
    validateOutput: (output): output is number => typeof output === 'number', execute: input => input };
const workflowTools = new ToolRegistry().register(workflowTool);
const workflowSecurity = new Vijay(jay, policies, { tools: workflowTools.protectedTools });
const workflows = new RudraWorkflowEngine(workflowTools, workflowSecurity);
const proposedAction: ToolCallProposal = { id: 'read', capability: 'read', input: { source: 'task' } };
const proposedWorkflow: AutonomousWorkflowPlan = { actions: [proposedAction] };
const workflowOptions: WorkflowOptions = { allowedCapabilities: ['read'], maxParallel: 2, maxToolCalls: 4,
    modelBudget: { maxCalls: 1, maxTokens: 0, maxCostUSD: 0 } };
const workflowRun: WorkflowRun = workflows.start(context, proposedWorkflow, workflowOptions);
const autonomousResult: Promise<WorkflowSnapshot> = workflowRun.result;
workflowRun.pause().then(() => workflowRun.resume());
workflowTools.registerModel({ id: 'typed.model', capability: 'validate', provider: rules, modelCapability: 'deterministic-validation',
    output: { schema: { type: 'object' } }, maxInputTokens: 0, maxOutputTokens: 0, validateInput: () => true });
// @ts-expect-error Model proposals cannot grant permission.
const forbiddenProposal: ToolCallProposal = { ...proposedAction, permissions: ['admin'] };
const secured = new RudraOrchestrator(new BotRegistry().register(bot), { security });
const authenticatedRun = jay.createContext(task, { signal }).then(context => secured.run(context));
const decisions: readonly SecurityDecision[] = audit.list();
// @ts-expect-error Authentication identity is immutable and separate from task data.
verifiedIdentity.principal.permissions.push('admin');
// @ts-expect-error Security policy classifications are explicit.
policies.register({ kind: 'tool', id: 'read', permissions: ['read'], effect: 'trusted', validateInput: () => true });
const vision: VisionModelAdapter = { id: 'typed-vision', analyze: async (input, context) => ({ summary: 'adapter result', observations: [] }) };
const reasoning: ReasoningProvider = { id: 'typed-reasoning', decide: async (input, context) => ({ selectedOptionId: 'one', rationale: 'fixture', evidenceIds: [] }) };
const codeProvider: CodeProvider = { id: 'typed-code', suggest: async (input, context) => ({ explanation: 'fixture', patches: [] }) };
const review: ReviewProvider = { id: 'typed-review', review: async (input, context) => ({ assessment: 'uncertain', findings: [] }) };
const memory: MemoryStorage = new SessionMemoryStore();
const feedback: FeedbackStorage = new SessionFeedbackStore();
const specialists: readonly Bot[] = createSpecialistBots({ vision, reasoning, code: codeProvider, review });
const specialistSystem = createSpecialistSystem({ memory, feedback, vision, security: { jay, policies } });
const allSpecialists: Bot[] = [new SanjayBot(), new BrihaspatiBot(), new VishwakarmBot(), new ChitraguptBot(), new NaradBot(), new YudhishthirBot(), new EkalavyBot()];
const scopedCapability = { id: 'read', description: 'read only', inputSchema: { type: 'object' }, requiredTools: [tool] };
`);
        writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            noEmit: true, strict: true, skipLibCheck: false, lib: ['ES2020'], types: [], module: 'ESNext', moduleResolution: 'bundler', paths: { shivax: [entry.replace(/\.js$/, '.d.ts')] },
        }, files: ['consumer.ts'] }));
        const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
        const result = spawnSync(process.execPath, [compiler, '-p', join(directory, 'tsconfig.json')], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('legacy ML works in ESM and CommonJS without optional browser/provider globals', () => {
    const esmEntry = new URL('../dist/index.esm.js', import.meta.url).href;
    const cjsEntry = fileURLToPath(new URL('../dist/index.cjs', import.meta.url));
    const consumer = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'fetch', 'URL', 'performance']) {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
}
const esm = await import(${JSON.stringify(esmEntry)});
const cjs = require(${JSON.stringify(cjsEntry)});
for (const api of [esm, cjs]) {
    const tensor = new api.Tensor([1, 2, 3, 4], [2, 2]);
    assert.deepEqual(Array.from(tensor.matmul(tensor).data), [7, 10, 15, 22]);
    const net = new api.NeuralNet({ layers: [2, 8, 1], task: 'binary', seed: 42 });
    const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]], labels = [[0], [1], [1], [0]];
    net.train(inputs, labels, { epochs: 2000, learningRate: 0.5, batchSize: 4 });
    assert.ok(Math.abs(net.predict([0, 0])[0] - 0.0005891139621383979) < 1e-15);
    const restored = api.NeuralNet.fromJSON(JSON.stringify(net.toJSON()));
    assert.deepEqual(restored.predict([0, 1]), net.predict([0, 1]));
    assert.equal(restored.predictClass([0, 1]), 1);
    assert.deepEqual(new api.BagOfWords().fit(['one two']).transform('one'), [1, 0]);
}
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', consumer], {
        encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});
