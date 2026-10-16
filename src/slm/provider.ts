export interface SLMLimits { contextTokens: number; maxOutputTokens: number }
export interface SLMScope { kind: 'company' | 'personal'; id: string }
/** Structural subset supported by native AbortSignal, without requiring DOM typings. */
export interface SLMSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    throwIfAborted(): void;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
}
export interface SLMRequest {
    system: string;
    prompt: string;
    schema: Readonly<Record<string, unknown>>;
    maxOutputTokens: number;
    signal: SLMSignal;
}
/** Providers must honor cancellation and must not retain page data or chat history. */
export interface SLMProvider {
    readonly id: string;
    readonly locality: 'local' | 'external';
    readonly limits: Readonly<SLMLimits>;
    initialize(signal: SLMSignal): Promise<void>;
    generate(request: SLMRequest): Promise<string>;
    dispose(signal: SLMSignal): Promise<void>;
}
export type SLMErrorCode = 'disabled' | 'external-disabled' | 'scope-mismatch' | 'disposed' | 'busy' |
    'timeout' | 'cancelled' | 'missing-model' | 'context-limit' | 'output-limit' | 'invalid-json' | 'invalid-output' | 'provider-error';
const messages: Record<SLMErrorCode, string> = {
    disabled: 'SLM is disabled.', 'external-disabled': 'External inference requires explicit opt-in.',
    'scope-mismatch': 'SLM client cannot be shared across workspace scopes.', disposed: 'SLM client is disposed.',
    busy: 'SLM client already has an active request.', timeout: 'SLM deadline exceeded.', cancelled: 'SLM request cancelled.',
    'missing-model': 'Configured local model is not installed.', 'context-limit': 'SLM context budget exceeded.',
    'output-limit': 'SLM output budget exceeded or response truncated.', 'invalid-json': 'SLM returned invalid JSON.',
    'invalid-output': 'SLM response failed schema or evidence validation.', 'provider-error': 'SLM provider failed.',
};
/** Fixed messages deliberately exclude prompts, provider bodies and company data. */
export class SLMError extends Error {
    constructor(public readonly code: SLMErrorCode) { super(messages[code]); this.name = 'SLMError'; }
}
export type SLMResult<T> = { source: 'slm'; value: T } | { source: 'fallback'; error: { code: SLMErrorCode; message: string } };
export interface SLMClientOptions {
    scope: SLMScope;
    /** False by default, even when a provider is supplied. */
    enabled?: boolean;
    allowExternal?: boolean;
    timeoutMs?: number;
    maxOutputTokens?: number;
}
export function positiveInteger(value: number, max: number): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError('Invalid SLM limit');
}
export function validateLimits(limits: SLMLimits): void {
    positiveInteger(limits.contextTokens, 1_048_576);
    positiveInteger(limits.maxOutputTokens, limits.contextTokens - 1);
}
export function byteLength(text: string): number { return new TextEncoder().encode(text).length; }
export function checkBudget(request: Pick<SLMRequest, 'system' | 'prompt' | 'schema' | 'maxOutputTokens'>, limits: SLMLimits): void {
    positiveInteger(request.maxOutputTokens, limits.maxOutputTokens);
    // Conservative UTF-8 byte estimate, including schema and template reserve; not an exact tokenizer count.
    const estimate = byteLength(request.system) + byteLength(request.prompt) + byteLength(JSON.stringify(request.schema)) + 512;
    if (estimate + request.maxOutputTokens > limits.contextTokens) throw new SLMError('context-limit');
}
async function bounded<T>(work: () => Promise<T>, controller: AbortController, timeout: number, signal?: SLMSignal): Promise<T> {
    const cancel = () => controller.abort(new SLMError('cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason instanceof SLMError ? controller.signal.reason : new SLMError('cancelled'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
    });
    const timer = setTimeout(() => controller.abort(new SLMError('timeout')), timeout);
    try {
        return await Promise.race([controller.signal.aborted ? aborted : work(), aborted]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', rejectAbort);
    }
}
/** Own one provider/client per scope. No history, persistence, automatic retries or downloads. */
export class SLMClient {
    private readonly scope: SLMScope;
    private readonly settings: Required<Omit<SLMClientOptions, 'scope'>>;
    private active?: AbortController;
    private initialized = false;
    private disposed = false;
    constructor(private readonly provider: SLMProvider, options: SLMClientOptions) {
        validateLimits(provider.limits);
        if (!options.scope || !['company', 'personal'].includes(options.scope.kind) || !options.scope.id) throw new TypeError('Invalid SLM scope');
        if (!['local', 'external'].includes(provider.locality)) throw new TypeError('Invalid SLM locality');
        for (const value of [options.enabled, options.allowExternal]) if (value !== undefined && typeof value !== 'boolean') throw new TypeError('Invalid SLM option');
        this.scope = { ...options.scope };
        this.settings = { enabled: options.enabled ?? false, allowExternal: options.allowExternal ?? false,
            timeoutMs: options.timeoutMs ?? 30_000, maxOutputTokens: options.maxOutputTokens ?? provider.limits.maxOutputTokens };
        positiveInteger(this.settings.timeoutMs, 300_000);
        positiveInteger(this.settings.maxOutputTokens, provider.limits.maxOutputTokens);
    }
    get state(): 'idle' | 'ready' | 'disposed' { return this.disposed ? 'disposed' : this.initialized ? 'ready' : 'idle'; }
    get providerId(): string { return this.provider.id; }
    async generateJSON<T>(scope: SLMScope, input: Pick<SLMRequest, 'system' | 'prompt' | 'schema'>,
        validate: (value: unknown) => T, signal?: SLMSignal): Promise<SLMResult<T>> {
        try {
            if (scope.kind !== this.scope.kind || scope.id !== this.scope.id) throw new SLMError('scope-mismatch');
            if (this.disposed) throw new SLMError('disposed');
            if (!this.settings.enabled) throw new SLMError('disabled');
            if (this.provider.locality !== 'local' && !this.settings.allowExternal) throw new SLMError('external-disabled');
            if (this.active) throw new SLMError('busy');
            const controller = new AbortController();
            const request = { ...input, maxOutputTokens: this.settings.maxOutputTokens, signal: controller.signal };
            checkBudget(request, this.provider.limits);
            this.active = controller;
            let started = false;
            try {
                return await bounded(async () => {
                    started = true;
                    try {
                        if (!this.initialized) {
                            await this.provider.initialize(controller.signal);
                            controller.signal.throwIfAborted();
                            this.initialized = true;
                        }
                        const raw = await this.provider.generate(request);
                        controller.signal.throwIfAborted();
                        if (typeof raw !== 'string') throw new SLMError('invalid-output');
                        if (byteLength(raw) > request.maxOutputTokens * 16) throw new SLMError('output-limit');
                        let parsed: unknown;
                        try { parsed = JSON.parse(raw); } catch { throw new SLMError('invalid-json'); }
                        let value: T;
                        try { value = validate(parsed); } catch { throw new SLMError('invalid-output'); }
                        return { source: 'slm' as const, value };
                    } finally {
                        // A deadline ends the caller's wait, not the provider operation.
                        if (this.active === controller) this.active = undefined;
                    }
                }, controller, this.settings.timeoutMs, signal);
            } finally {
                // Pre-aborted calls never entered the operation above.
                if (!started && this.active === controller) this.active = undefined;
            }
        } catch (error) {
            const safe = error instanceof SLMError ? error : new SLMError('provider-error');
            return { source: 'fallback', error: { code: safe.code, message: safe.message } };
        }
    }
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.active?.abort(new SLMError('cancelled'));
        const controller = new AbortController();
        try { await bounded(() => this.provider.dispose(controller.signal), controller, this.settings.timeoutMs); }
        catch (error) { throw error instanceof SLMError ? error : new SLMError('provider-error'); }
        finally { this.initialized = false; }
    }
}
