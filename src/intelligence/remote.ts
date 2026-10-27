import type { ModelCapability, ModelPricing, ModelProvider, ModelRequest } from './types.js';
import { ModelProviderRegistry } from './registry.js';
import { ModelError } from './errors.js';

export interface RemoteModelAdapterOptions {
    readonly id: string;
    readonly capabilities: readonly ModelCapability[];
    /** Conservative upper-bound rates, including any provider fees. No implicit free inference. */
    readonly pricing: ModelPricing;
    /** Called only on the first permitted inference. Load optional SDKs and host credentials here. */
    load(): Promise<{ infer(request: ModelRequest): unknown | Promise<unknown> }>;
}
/** SDK/endpoint/credentials remain host configured. There is no general URL-fetch tool. */
export class RemoteModelAdapter implements ModelProvider {
    readonly locality = 'remote' as const;
    readonly tokenBased = true;
    readonly id: string;
    readonly capabilities: readonly ModelCapability[];
    readonly pricing: ModelPricing;
    readonly #load: RemoteModelAdapterOptions['load'];
    #client?: Promise<{ infer(request: ModelRequest): unknown | Promise<unknown> }>;
    constructor(options: RemoteModelAdapterOptions) {
        this.id = options.id;
        this.capabilities = Object.freeze([...options.capabilities]);
        this.pricing = Object.freeze({ ...options.pricing });
        if (typeof options.load !== 'function') throw new ModelError('invalid-provider');
        this.#load = options.load.bind(options);
        new ModelProviderRegistry().register(this);
    }
    async infer(request: ModelRequest): Promise<unknown> {
        request.checkExecution();
        request.context.signal.throwIfAborted();
        if (!this.capabilities.includes(request.capability))
            throw new ModelError('missing-provider');
        if (!this.#client) {
            const loading = Promise.resolve()
                .then(() => {
                    request.checkExecution();
                    request.context.signal.throwIfAborted();
                    return this.#load();
                })
                .then((client) => {
                    if (!client || typeof client.infer !== 'function')
                        throw new ModelError('invalid-provider');
                    return Object.freeze({ infer: client.infer.bind(client) });
                });
            this.#client = loading;
            void loading.catch(() => {
                if (this.#client === loading) this.#client = undefined;
            });
        }
        const client = await this.#client;
        request.checkExecution();
        request.context.signal.throwIfAborted();
        return client.infer(request);
    }
}
