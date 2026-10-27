import {
    createSpecialistSystem,
    Jaya,
    PermissionPolicyRegistry,
    InspectionPlanner,
    INSPECTION_WORKFLOW_CAPABILITIES,
} from 'shivax';
import { createMockIdentityProvider } from './mock-identity.mjs';
export const inspectionScope = { kind: 'personal', id: 'inspection-test' };
export const inspectionRequest = () => ({
    reference: { kind: 'url', url: 'https://fixture.test/reference' },
    target: 'https://fixture.test/target',
    viewport: { width: 800, height: 600 },
});
export function inspectionSystem(provider, options = {}) {
    const identity = {
        principal: { id: 'tester', issuer: 'test-host', permissions: ['inspect'] },
        session: {
            id: 'inspection-session',
            principalId: 'tester',
            issuedAt: 1,
            expiresAt: 10000,
            scope: inspectionScope,
        },
    };
    const jaya = new Jaya(createMockIdentityProvider(identity), { now: () => 1000 }),
        policies = new PermissionPolicyRegistry();
    for (const id of INSPECTION_WORKFLOW_CAPABILITIES)
        policies.register({
            kind: 'capability',
            id,
            permissions: ['inspect'],
            effect: id === 'inspection.scan' ? 'state-changing' : 'read-only',
            validateInput: () => true,
        });
    policies.register({
        kind: 'tool',
        id: 'shivax.inspection.capture',
        permissions: ['inspect'],
        effect: 'state-changing',
        validateInput: () => true,
    });
    const system = createSpecialistSystem({
        vision: options.vision,
        inspection: {
            provider,
            options: {
                authorizeURL:
                    options.authorizeURL ??
                    ((url) => new URL(url).origin === 'https://fixture.test'),
                authorizeReference: options.authorizeReference,
            },
        },
        hooks: { planner: new InspectionPlanner() },
        security: { jaya, policies, options: { approve: options.approve ?? (() => true) } },
    });
    return {
        ...system,
        async run(input = inspectionRequest(), host = {}) {
            const capability = input.image ? 'vision.inspection-reference' : 'inspection.scan';
            const context = await jaya.createContext(
                { id: 'inspection-task', input: { capability, data: input } },
                {
                    signal: host.signal ?? new AbortController().signal,
                    toolPermissions: host.toolPermissions ?? ['shivax.inspection.capture'],
                    limits: {
                        maxInputBytes: 1_048_576,
                        maxOutputBytes: 1_048_576,
                        timeoutMs: host.timeoutMs ?? 10000,
                    },
                }
            );
            return system.rudra.run(context, {
                allowedCapabilities: INSPECTION_WORKFLOW_CAPABILITIES,
                maxSteps: host.maxSteps ?? 4,
            });
        },
    };
}
