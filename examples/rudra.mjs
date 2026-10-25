import { BotRegistry, RudraOrchestrator, createTaskContext } from 'shivax';
import { createMockReasoningBot, createMockReviewBot } from './rudra-mocks.mjs';

const registry = new BotRegistry().register(createMockReasoningBot()).register(createMockReviewBot());
const context = createTaskContext({ id: 'arithmetic-demo', input: { capability: 'mock.reason', data: [2, 3, 5] } }, {
    sessionId: 'local-demo', signal: new AbortController().signal,
    security: { caller: { id: 'demo-user', issuer: 'trusted-demo-host' },
        scope: { kind: 'personal', id: 'demo' }, toolPermissions: [] },
});
console.log('Single capability:', await new RudraOrchestrator(registry).run(context));
const planner = { plan: () => ({ steps: [
    { id: 'reason', capability: 'mock.reason', input: { source: 'task' } },
    { id: 'review', capability: 'mock.review', input: { source: 'step', stepId: 'reason' } },
] }) };
console.log('Dependent workflow:', await new RudraOrchestrator(registry, { planner }).run(context, {
    allowedCapabilities: ['mock.reason', 'mock.review'], maxSteps: 2,
}));
