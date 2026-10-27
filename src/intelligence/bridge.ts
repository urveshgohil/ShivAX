import type { BotValue } from '../agents/types.js';
import type { SpecialistProviderContext } from '../bots/types.js';
import type { ModelCapability, ModelOutputContract, ModelRoutingOptions } from './types.js';
import { ModelRouter } from './router.js';
import { ModelError } from './errors.js';
import { schema, capability } from './validation.js';

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
        if (result.status !== 'completed') throw new ModelError(result.error.code);
        return result.data;
    };
}
