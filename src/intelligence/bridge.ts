import type { BotValue } from '../agents/types.js';
import type { SpecialistProviderContext } from '../bots/types.js';
import type { ModelCapability, ModelOutputContract, ModelRoutingOptions } from './types.js';
import { snapshotValue, record, array } from '../agents/validation.js';
import type { ShivaxFirewallRuntime } from '../security/firewall/types.js';
import { guardedModelRoutes, ModelRouter, type GuardedModelRoute, type GuardedModelOperation } from './router.js';
import { ModelError } from './errors.js';
import { schema, capability } from './validation.js';

/** Trusted composition API. Bind an ordered list of registered model operations once.
 * Calls require the original Jay root; input and provider output cannot select new routes. */
export function createGuardedModelGateway(runtime: ShivaxFirewallRuntime, route: GuardedModelRoute): GuardedModelOperation {
    const issue = guardedModelRoutes.get(runtime);
    if (!issue) throw new ModelError('invalid-provider');
    const safe = snapshotValue(route, 16384, 'invalid-input') as unknown as GuardedModelRoute;
    record(safe, ['capability', 'operationIds', 'timeoutMs', 'allowRemote'], 'invalid-input');
    capability(safe.capability);
    const ids = array(safe.operationIds, 16, 'invalid-input');
    if (!ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length ||
        !Number.isSafeInteger(safe.timeoutMs) || safe.timeoutMs < 1 || safe.timeoutMs > 300000 ||
        (safe.allowRemote !== undefined && typeof safe.allowRemote !== 'boolean')) throw new ModelError('invalid-input');
    return issue(safe);
}

/** A DI function compatible with specialist provider methods. The host owns the output contract and routing policy. */
export function createModelOperation(
    router: ModelRouter,
    modelCapability: ModelCapability,
    contract: ModelOutputContract,
    options: ModelRoutingOptions = {}
): (input: unknown, context: SpecialistProviderContext) => Promise<BotValue> {
    capability(modelCapability);
    const output = Object.freeze({
        schema: schema(contract.schema),
        validate: contract.validate?.bind(contract),
    });
    const routing = Object.freeze({ ...options });
    return async (input, context) => {
        const result = await router.infer(
            { capability: modelCapability, input: input as BotValue, output, context },
            routing
        );
        if (result.status !== 'completed')
            throw new ModelError(result.error.code, result.error.reason);
        return result.data;
    };
}
