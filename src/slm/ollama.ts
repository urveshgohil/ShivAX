import { SLMError, byteLength, checkBudget, validateLimits } from './provider.js';
import type { SLMLimits, SLMProvider, SLMRequest, SLMSignal } from './provider.js';

/** Minimal response contract; native fetch responses satisfy this interface. */
export interface SLMFetchResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly body: {
        cancel(): Promise<void>;
        getReader(): {
            read(): Promise<{ done: boolean; value?: Uint8Array }>;
            cancel(): Promise<void>;
            releaseLock(): void;
        };
    } | null;
}
export interface SLMFetchOptions {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    redirect: 'error';
    credentials: 'omit';
    signal: SLMSignal;
}
export type SLMFetch = (url: string, options: SLMFetchOptions) => Promise<SLMFetchResponse>;

export interface OllamaProviderOptions {
    model: string;
    /** Loopback origin only. Defaults to http://127.0.0.1:11434. */
    baseURL?: string;
    limits?: SLMLimits;
    /** Injectable transport for tests or a trusted local runner. */
    fetch?: SLMFetch;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/** Local models only. Every inference is a fresh chat and unloads its model after the response. */
export class OllamaProvider implements SLMProvider {
    readonly id: string;
    readonly locality = 'local' as const;
    readonly limits: Readonly<SLMLimits>;
    private readonly origin: string;
    private readonly model: string;
    private readonly transport: SLMFetch;
    constructor(options: OllamaProviderOptions) {
        if (typeof options.model !== 'string' || !options.model.trim() || options.model.length > 256 || /cloud|\/\//i.test(options.model)) throw new TypeError('A local model name is required');
        const url = new URL(options.baseURL ?? 'http://127.0.0.1:11434');
        if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
            url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Ollama requires a loopback origin');
        this.origin = url.origin; this.model = options.model; this.id = `ollama:${this.model}`;
        this.limits = Object.freeze({ ...(options.limits ?? { contextTokens: 8192, maxOutputTokens: 1024 }) });
        validateLimits(this.limits);
        this.transport = options.fetch ?? ((url, init) => globalThis.fetch(url, { ...init, signal: init.signal as AbortSignal }));
    }
    private async post(path: string, body: Record<string, unknown>, signal: SLMSignal, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
        signal.throwIfAborted();
        const response = await this.transport(`${this.origin}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal });
        if (!response.ok) {
            await response.body?.cancel();
            throw new SLMError(response.status === 404 ? 'missing-model' : 'provider-error');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new SLMError('provider-error');
        const decoder = new TextDecoder(); let raw = '', bytes = 0;
        try {
            while (true) {
                signal.throwIfAborted();
                const chunk = await reader.read();
                if (chunk.done) break;
                if (!chunk.value) throw new SLMError('provider-error');
                bytes += chunk.value.byteLength;
                if (bytes > maxBytes) throw new SLMError('output-limit');
                raw += decoder.decode(chunk.value, { stream: true });
            }
            raw += decoder.decode();
        } finally { await reader.cancel(); reader.releaseLock(); }
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new SLMError('invalid-json'); }
        if (!record(value) || value.error) throw new SLMError('provider-error');
        return value;
    }
    async initialize(signal: SLMSignal): Promise<void> {
        const info = await this.post('show', { model: this.model }, signal);
        // A localhost Ollama server may proxy cloud aliases. Reject remote metadata before sending page data.
        if (info.remote_model || info.remote_host || !record(info.model_info) || Object.keys(info.model_info).length === 0) throw new SLMError('external-disabled');
        const contexts = Object.entries(info.model_info).filter(([key]) => key.endsWith('.context_length')).map(([, value]) => value);
        if (!contexts.length || contexts.some(value => typeof value !== 'number' || value < this.limits.contextTokens)) throw new SLMError('context-limit');
    }
    async generate(request: SLMRequest): Promise<string> {
        checkBudget(request, this.limits);
        // Recheck metadata on each call so a reused client cannot silently switch to a remote alias.
        await this.initialize(request.signal);
        const value = await this.post('chat', { model: this.model, stream: false, format: request.schema, keep_alive: 0,
            truncate: false, shift: false,
            messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
            options: { temperature: 0, seed: 0, num_ctx: this.limits.contextTokens, num_predict: request.maxOutputTokens } },
        request.signal, request.maxOutputTokens * 32 + 4096);
        if (value.remote_model || value.remote_host) throw new SLMError('external-disabled');
        if (value.done !== true || value.done_reason !== 'stop') throw new SLMError('output-limit');
        if (!Number.isSafeInteger(value.prompt_eval_count) || !Number.isSafeInteger(value.eval_count) ||
            (value.prompt_eval_count as number) < 0 || (value.eval_count as number) < 0) throw new SLMError('provider-error');
        if ((value.prompt_eval_count as number) + (value.eval_count as number) > this.limits.contextTokens) throw new SLMError('context-limit');
        if ((value.eval_count as number) > request.maxOutputTokens) throw new SLMError('output-limit');
        if (!record(value.message) || typeof value.message.content !== 'string') throw new SLMError('invalid-output');
        if (byteLength(value.message.content) > request.maxOutputTokens * 16) throw new SLMError('output-limit');
        return value.message.content;
    }
    async dispose(signal: SLMSignal): Promise<void> {
        signal.throwIfAborted();
        // No retained history or resources. keep_alive: 0 unloads each generation on the server.
    }
}
