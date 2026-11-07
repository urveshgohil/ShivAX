import { createSpecialistSystem, createTaskContext } from 'shivax';

// Supplied inspection data; no browser capture or model inference is performed.
const snapshot = { version: 1, sourceType: 'url', scope: { kind: 'personal', id: 'demo' },
    viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    coordinates: { unit: 'css-px', unitsPerCssPixel: 1, origin: 'viewport' }, nodes: [], relationships: [] };
const system = createSpecialistSystem({ hooks: { planner: { plan: () => ({ steps: [
    { id: 'inspection', capability: 'inspection.normalize', input: { source: 'task' } },
    { id: 'review', capability: 'review.inspection', input: { source: 'step', stepId: 'inspection' } },
] }) } } });
const task = createTaskContext({ id: 'specialist-demo', input: { capability: 'inspection.normalize', data: { snapshot } } }, {
    sessionId: 'demo-session', signal: new AbortController().signal,
    security: { caller: { id: 'demo-user', issuer: 'trusted-local-demo' }, scope: snapshot.scope, toolPermissions: [] },
});
const result = await system.rudra.run(task, { allowedCapabilities: ['inspection.normalize', 'review.inspection'] });
console.log(JSON.stringify({ registeredBots: system.registry.list().map(bot => bot.id), result }, null, 2));
if (result.status !== 'completed') process.exitCode = 1;
