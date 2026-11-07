import type { ModelCapability, ModelPricing, ModelProvider, ModelRequest } from './types.js';
import { ModelProviderRegistry } from './registry.js';
import { ModelError } from './errors.js';

export interface RemoteTransportPolicy {
    readonly endpoint: string;
    readonly redirect: 'error';
    checkDestination(url: string): void;
}
interface RemoteClient {
    infer(request: ModelRequest): unknown | Promise<unknown>;
    /** Host transport disables redirects and applies its DNS/proxy rules before connecting. */
    inferGuarded?(request: ModelRequest, policy: RemoteTransportPolicy): unknown | Promise<unknown>;
}
export interface RemoteModelAdapterOptions {
    readonly id: string;
    readonly capabilities: readonly ModelCapability[];
    /** Conservative upper-bound rates, including any provider fees. No implicit free inference. */
    readonly pricing: ModelPricing;
    /** Fixed HTTPS endpoint required by the guarded path. Credentials belong to the host transport. */
    readonly endpoint?: string;
    /** Called only on the first permitted inference. Load optional SDKs and host credentials here. */
    load(): Promise<RemoteClient>;
}
/** SDK/endpoint/credentials remain host configured. There is no general URL-fetch tool. */
export class RemoteModelAdapter implements ModelProvider {
    readonly locality = 'remote' as const;
    readonly tokenBased = true;
    readonly id: string;
    readonly capabilities: readonly ModelCapability[];
    readonly pricing: ModelPricing;
    readonly #load: RemoteModelAdapterOptions['load'];
    readonly #endpoint?: string;
    #client?: Promise<RemoteClient>;
    constructor(options: RemoteModelAdapterOptions) {
        this.id = options.id;
        this.capabilities = Object.freeze([...options.capabilities]);
        this.pricing = Object.freeze({ ...options.pricing });
        if (typeof options.load !== 'function') throw new ModelError('invalid-provider');
        if (options.endpoint !== undefined) {
            try {
                const endpoint = new URL(options.endpoint);
                if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw 0;
                this.#endpoint = endpoint.href;
            } catch { throw new ModelError('invalid-provider'); }
        }
        this.#load = options.load.bind(options);
        new ModelProviderRegistry().register(this);
    }
    async infer(request: ModelRequest): Promise<unknown> {
        request.checkExecution();
        request.context.signal.throwIfAborted();
        if (!this.capabilities.includes(request.capability))
            throw new ModelError('missing-provider');
        const gate = request.checkNetworkAccess;
        const endpoint = this.#endpoint;
        const checkDestination = (url: string) => {
            request.checkExecution(); request.context.signal.throwIfAborted();
            if (!endpoint || url !== endpoint) throw new ModelError('provider-denied');
            gate?.(url);
        };
        if (gate) checkDestination(endpoint ?? '');
        if (!this.#client) {
            const loading = Promise.resolve()
                .then(() => {
                    request.checkExecution();
                    request.context.signal.throwIfAborted();
                    if (gate) checkDestination(endpoint ?? '');
                    return this.#load();
                })
                .then((client) => {
                    if (!client || typeof client.infer !== 'function')
                        throw new ModelError('invalid-provider');
                    return Object.freeze({ infer: client.infer.bind(client), inferGuarded: client.inferGuarded?.bind(client) });
                });
            this.#client = loading;
            void loading.catch(() => {
                if (this.#client === loading) this.#client = undefined;
            });
        }
        const client = await this.#client;
        request.checkExecution();
        request.context.signal.throwIfAborted();
        if (gate) {
            checkDestination(endpoint ?? '');
            if (!client.inferGuarded || !endpoint) throw new ModelError('provider-denied');
            return client.inferGuarded(request, Object.freeze({ endpoint, redirect: 'error', checkDestination }));
        }
        return client.infer(request);
    }
}
