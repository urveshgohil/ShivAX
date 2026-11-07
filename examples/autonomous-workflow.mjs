import { pathToFileURL } from 'node:url';
import { Jay, Vijay, PermissionPolicyRegistry, SecurityAuditLog, ToolRegistry, RudraWorkflowEngine } from 'shivax';

/** Offline website fixture. Production captures remain owned by the separate Inspectra adapter. */
export async function createAutonomousDemo(approve) {
    const page = { resource: 'fixture:heading', fontSize: 30 }, expected = 24;
    const tools = new ToolRegistry(), policies = new PermissionPolicyRegistry(), audit = new SecurityAuditLog();
    const register = (capability, validateInput, execute, effect = 'read-only') => {
        const id = `demo.${capability}`;
        tools.register({ id, capability, effect, parallelSafe: false,
            validateInput, validateOutput: value => value !== undefined, execute });
        for (const [kind, name] of [['capability', capability], ['tool', id]])
            policies.register({ kind, id: name, effect, permissions: ['demo-workflow'], validateInput });
    };
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const observation = value => object(value) && value.resource === page.resource && Number.isFinite(value.fontSize);
    register('inspect', value => object(value) && value.resource === page.resource,
        () => ({ ...page, source: 'in-memory-website-fixture' }));
    register('detect', observation, input => ({ resource: input.resource, expected, actual: input.fontSize,
        issues: input.fontSize === expected ? [] : [{ type: 'typography', property: 'fontSize', expected, actual: input.fontSize }] }));
    register('propose', value => object(value) && value.resource === page.resource && value.expected === expected && Array.isArray(value.issues),
        input => ({ resource: input.resource, property: 'fontSize', before: input.actual, after: input.expected }));
    const patch = value => object(value) && Object.keys(value).sort().join(',') === 'after,before,property,resource' &&
        value.resource === page.resource && value.property === 'fontSize' && value.before === 30 && value.after === expected;
    register('apply', patch, (input, context) => {
        context.checkExecution();
        if (!patch(input) || input.before !== page.fontSize) throw new Error('Fixture changed since approval.');
        page.fontSize = input.after;
        return { applied: true, resource: page.resource, fontSize: page.fontSize };
    }, 'state-changing');
    register('validate', observation, input => {
        if (input.fontSize !== expected) throw new Error('Typography correction failed validation.');
        return { valid: true, resource: input.resource, expected, actual: input.fontSize, evidence: input.source };
    });
    policies.register({ kind: 'capability', id: 'website.correct', effect: 'read-only', permissions: ['demo-workflow'], validateInput: () => true });
    // Explicit local mock identity; real host authentication must supply its own provider.
    const jay = new Jay({ authenticate: () => ({
        principal: { id: 'demo-user', issuer: 'local-demo', permissions: ['demo-workflow'] },
        session: { id: 'demo-session', principalId: 'demo-user', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
            scope: { kind: 'personal', id: 'offline-fixture' } },
    }), isSessionValid: () => true });
    const security = new Vijay(jay, policies, { tools: tools.protectedTools, audit, approve });
    const context = await jay.createContext({ id: 'website-demo', input: { capability: 'website.correct', data: { resource: page.resource } } }, {
        signal: new AbortController().signal, toolPermissions: tools.list().map(tool => tool.id),
    });
    const engine = new RudraWorkflowEngine(tools, security);
    const run = engine.start(context, { actions: [
        { id: 'scan', capability: 'inspect', input: { source: 'task' } },
        { id: 'issues', capability: 'detect', input: { source: 'step', stepId: 'scan' } },
        { id: 'fix', capability: 'propose', input: { source: 'step', stepId: 'issues' } },
        { id: 'apply', capability: 'apply', input: { source: 'step', stepId: 'fix' } },
        { id: 'rescan', capability: 'inspect', input: { source: 'task' }, dependsOn: ['apply'] },
        { id: 'validate', capability: 'validate', input: { source: 'step', stepId: 'rescan' } },
    ] }, { allowedCapabilities: tools.list().map(tool => tool.capability), maxSteps: 6, maxToolCalls: 6 });
    return { run, audit, readPage: () => ({ ...page }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const demo = await createAutonomousDemo(async request => {
        console.log(`Approval requested: ${request.kind} ${request.actionId}`, request.input);
        // Deliberate host consent restricted to this in-memory fixture and exact correction.
        return request.input.resource === 'fixture:heading' && request.input.property === 'fontSize' &&
            request.input.before === 30 && request.input.after === 24;
    });
    const result = await demo.run.result;
    console.log(JSON.stringify({ fixtureOnly: true, status: result.status, result: result.outputs.at(-1), usage: result.usage }, null, 2));
    if (result.status !== 'completed') process.exitCode = 1;
}
