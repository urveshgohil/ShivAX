import type { ModelCapability, ModelProvider, ModelProviderDescriptor } from './types.js';
import { capability, name, money } from './validation.js';
import { ModelError } from './errors.js';

export class ModelProviderRegistry {
    readonly #providers = new Map<string, ModelProvider>();
    register(provider: ModelProvider): this {
        let safe: ModelProvider;
        try {
            name(provider.id);
            if (
                !['in-process', 'local', 'remote'].includes(provider.locality) ||
                typeof provider.tokenBased !== 'boolean' ||
                typeof provider.infer !== 'function' ||
                !Array.isArray(provider.capabilities) ||
                !provider.capabilities.length ||
                provider.capabilities.length > 5 ||
                new Set(provider.capabilities).size !== provider.capabilities.length
            )
                throw new ModelError('invalid-provider');
            provider.capabilities.forEach(capability);
            const pricing = {
                inputTokenUSD: provider.pricing.inputTokenUSD,
                outputTokenUSD: provider.pricing.outputTokenUSD,
                callUSD: provider.pricing.callUSD,
            };
            Object.values(pricing).forEach(money);
            safe = Object.freeze({
                id: provider.id,
                locality: provider.locality,
                tokenBased: provider.tokenBased,
                capabilities: Object.freeze([...provider.capabilities]),
                pricing: Object.freeze(pricing),
                infer: provider.infer.bind(provider),
            });
        } catch {
            throw new ModelError('invalid-provider');
        }
        if (this.#providers.has(safe.id)) throw new ModelError('duplicate-provider');
        this.#providers.set(safe.id, safe);
        return this;
    }
    unregister(id: string): boolean {
        return this.#providers.delete(id);
    }
    get(id: string): ModelProvider | undefined {
        return this.#providers.get(id);
    }
    list(): readonly ModelProviderDescriptor[] {
        return Object.freeze(
            [...this.#providers.values()].map(({ infer: _infer, ...descriptor }) =>
                Object.freeze(descriptor)
            )
        );
    }
    findByCapability(capability: ModelCapability): readonly ModelProviderDescriptor[] {
        return Object.freeze(
            this.list().filter((provider) => provider.capabilities.includes(capability))
        );
    }
}
