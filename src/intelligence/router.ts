import type { BotValue } from '../agents/types.js';
import { record } from '../agents/validation.js';
import type { SpecialistProviderContext } from '../bots/types.js';
import type { SLMScope } from '../slm/provider.js';
import { ModelProviderRegistry } from './registry.js';
import { ModelError, modelDetails, modelError } from './errors.js';
import { capability, json, limits, name, response, schema } from './validation.js';
import type {
    ModelAttempt,
    ModelBudgetUsage,
    ModelInference,
    ModelLimits,
    ModelProvider,
    ModelResult,
    ModelRoutingOptions,
} from './types.js';

/** One scope and one active operation per instance. Cancellation retains ownership until work settles. */
export class ModelRouter {
    readonly #registry: ModelProviderRegistry;
    readonly #scope: Readonly<SLMScope>;
    readonly #limits: Readonly<ModelLimits>;
    readonly #enabled: boolean;
    #owner?: AbortController;
    #disposed = false;
    #overrun = false;
    #calls = 0;
    #tokens = 0;
    #cost = 0;
    constructor(
        registry: ModelProviderRegistry,
        options: { scope: SLMScope; limits?: Partial<ModelLimits>; enabled?: boolean }
    ) {
        this.#registry = registry;
        const scope = json(options.scope, 4096) as unknown as SLMScope;
        if (!scope || !['personal', 'company'].includes(scope.kind))
            throw new ModelError('invalid-input');
        name(scope.id);
        this.#scope = scope;
        this.#limits = limits(options.limits);
        if (options.enabled !== undefined && typeof options.enabled !== 'boolean')
            throw new ModelError('invalid-input');
        this.#enabled = options.enabled ?? true;
    }
    get budgetUsage(): ModelBudgetUsage {
        return Object.freeze({
            calls: this.#calls,
            reservedTokens: this.#tokens,
            reservedCostUSD: this.#cost,
        });
    }
    dispose(): void {
        this.#disposed = true;
        this.#owner?.abort(new ModelError('cancelled'));
    }

    async infer(input: ModelInference, options: ModelRoutingOptions = {}): Promise<ModelResult> {
        const attempts: ModelAttempt[] = [];
        let pendingAttempt:
            Pick<ModelAttempt, 'providerId' | 'reservedTokens' | 'reservedCostUSD'> | undefined;
        const failure = (error: unknown): ModelResult => {
            const safe = modelError(error);
            return Object.freeze({
                status: safe.code === 'cancelled' ? 'cancelled' : 'failed',
                error: modelDetails(safe),
                attempts: Object.freeze([
                    ...attempts,
                    ...(pendingAttempt
                        ? [
                              Object.freeze({
                                  ...pendingAttempt,
                                  outcome: 'failed' as const,
                                  error: modelDetails(safe),
                              }),
                          ]
                        : []),
                ]),
            });
        };
        if (this.#disposed) return failure(new ModelError('disposed'));
        if (!this.#enabled) return failure(new ModelError('disabled'));
        if (this.#owner) return failure(new ModelError('busy'));
        if (this.#overrun) return failure(new ModelError('usage-limit'));
        const controller = new AbortController();
        this.#owner = controller;
        const now =
            typeof globalThis.performance?.now === 'function'
                ? globalThis.performance.now.bind(globalThis.performance)
                : Date.now;
        const start = now();
        const check = () => {
            if (!controller.signal.aborted && now() - start >= this.#limits.timeoutMs)
                controller.abort(new ModelError('timeout'));
            if (controller.signal.aborted) throw modelError(controller.signal.reason, 'cancelled');
        };
        let external: SpecialistProviderContext['signal'] | undefined;
        const cancel = () => controller.abort(new ModelError('cancelled'));
        let rejectAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        void aborted.catch(() => {});
        const timer = setTimeout(
            () => controller.abort(new ModelError('timeout')),
            this.#limits.timeoutMs
        );
        let work: Promise<ModelResult> | undefined;
        const release = () => {
            if (this.#owner === controller) this.#owner = undefined;
        };
        try {
            let context: SpecialistProviderContext, data: BotValue;
            let output: ReturnType<typeof schema>, validate: ModelInference['output']['validate'];
            let providers: ModelProvider[];
            try {
                record(input, ['capability', 'input', 'output', 'context'], 'invalid-input');
                capability(input.capability);
                const source = record(
                    input.context,
                    ['taskId', 'sessionId', 'scope', 'signal'],
                    'invalid-input'
                );
                name(source.taskId);
                name(source.sessionId);
                const scope = json(source.scope, 4096) as unknown as SLMScope;
                if (scope?.kind !== this.#scope.kind || scope.id !== this.#scope.id)
                    throw new ModelError('scope-mismatch');
                external = source.signal as SpecialistProviderContext['signal'];
                if (
                    !external ||
                    typeof external.aborted !== 'boolean' ||
                    typeof external.addEventListener !== 'function' ||
                    typeof external.removeEventListener !== 'function' ||
                    typeof external.throwIfAborted !== 'function'
                )
                    throw new ModelError('invalid-input');
                external.addEventListener('abort', cancel, { once: true });
                if (external.aborted) cancel();
                check();
                context = Object.freeze({
                    taskId: source.taskId,
                    sessionId: source.sessionId,
                    scope,
                    signal: controller.signal,
                });
                data = json(input.input, this.#limits.maxInputBytes);
                record(input.output, ['schema', 'validate'], 'invalid-input');
                output = schema(input.output.schema);
                if (
                    input.output.validate !== undefined &&
                    typeof input.output.validate !== 'function'
                )
                    throw new ModelError('invalid-input');
                validate = input.output.validate?.bind(input.output);
                const routing = record(
                    options,
                    ['providerId', 'allowFallback', 'allowRemote'],
                    'invalid-input'
                );
                for (const field of ['allowFallback', 'allowRemote'])
                    if (routing[field] !== undefined && typeof routing[field] !== 'boolean')
                        throw new ModelError('invalid-input');
                if (routing.providerId !== undefined) name(routing.providerId);
                const candidates = this.#registry
                    .findByCapability(input.capability)
                    .map((item) => this.#registry.get(item.id)!)
                    .sort((a, b) => {
                        const order = { 'in-process': 0, local: 1, remote: 2 };
                        return (
                            order[a.locality] - order[b.locality] ||
                            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
                        );
                    });
                const preferred =
                    routing.providerId === undefined
                        ? undefined
                        : candidates.find((p) => p.id === routing.providerId);
                if (routing.providerId !== undefined && !preferred)
                    throw new ModelError('missing-provider');
                if (preferred?.locality === 'remote' && routing.allowRemote !== true)
                    throw new ModelError('remote-disabled');
                providers = candidates.filter(
                    (p) => p.locality !== 'remote' || routing.allowRemote === true
                );
                if (preferred) providers = [preferred, ...providers.filter((p) => p !== preferred)];
                if (!providers.length)
                    throw new ModelError(
                        candidates.length ? 'remote-disabled' : 'missing-provider'
                    );
                if (routing.allowFallback !== true) providers = providers.slice(0, 1);
            } catch (error) {
                throw modelError(error, 'invalid-input');
            }
            check();
            const selectedCapability = input.capability;
            work = (async (): Promise<ModelResult> => {
                let last: ModelError = new ModelError('missing-provider');
                for (const provider of providers) {
                    check();
                    const inputTokens = provider.tokenBased ? this.#limits.maxInputTokens : 0;
                    const outputTokens = provider.tokenBased ? this.#limits.maxOutputTokens : 0;
                    const reservedTokens = inputTokens + outputTokens;
                    const reservedCostUSD =
                        provider.pricing.callUSD +
                        provider.pricing.inputTokenUSD * inputTokens +
                        provider.pricing.outputTokenUSD * outputTokens;
                    if (this.#calls >= this.#limits.maxCalls) throw new ModelError('call-limit');
                    if (this.#tokens + reservedTokens > this.#limits.maxTokens)
                        throw new ModelError('token-limit');
                    if (
                        !Number.isFinite(reservedCostUSD) ||
                        this.#cost + reservedCostUSD > this.#limits.maxCostUSD
                    )
                        throw new ModelError('cost-limit');
                    // Reserve before calling host code. Never refund uncertain, cancelled or failed work.
                    this.#calls++;
                    this.#tokens += reservedTokens;
                    this.#cost += reservedCostUSD;
                    pendingAttempt = { providerId: provider.id, reservedTokens, reservedCostUSD };
                    try {
                        const raw = await provider.infer(
                            Object.freeze({
                                capability: selectedCapability,
                                input: data,
                                schema: output,
                                context,
                                maxInputTokens: inputTokens,
                                maxOutputTokens: outputTokens,
                                maxCostUSD: reservedCostUSD,
                                checkExecution: check,
                            })
                        );
                        check();
                        const result = response(raw, output, validate, this.#limits.maxOutputBytes);
                        check();
                        if (
                            (result.usage.inputTokens ?? 0) > inputTokens ||
                            (result.usage.outputTokens ?? 0) > outputTokens ||
                            (result.usage.costUSD ?? 0) > reservedCostUSD
                        ) {
                            this.#overrun = true;
                            throw new ModelError('usage-limit');
                        }
                        attempts.push(
                            Object.freeze({
                                providerId: provider.id,
                                outcome: 'completed',
                                reservedTokens,
                                reservedCostUSD,
                                usage: result.usage,
                            })
                        );
                        pendingAttempt = undefined;
                        return Object.freeze({
                            status: 'completed',
                            providerId: provider.id,
                            data: result.data,
                            usage: result.usage,
                            attempts: Object.freeze(attempts.slice()),
                        });
                    } catch (error) {
                        check();
                        last = modelError(error);
                        attempts.push(
                            Object.freeze({
                                providerId: provider.id,
                                outcome: 'failed',
                                reservedTokens,
                                reservedCostUSD,
                                error: modelDetails(last),
                            })
                        );
                        pendingAttempt = undefined;
                        if (
                            !['provider-error', 'unavailable', 'invalid-output'].includes(last.code)
                        )
                            throw last;
                    }
                }
                throw last;
            })();
            // Public timeout/cancellation must not free a provider that ignored the signal.
            void work.then(release, release);
            return await Promise.race([work, aborted]);
        } catch (error) {
            return failure(controller.signal.aborted ? controller.signal.reason : error);
        } finally {
            clearTimeout(timer);
            try {
                external?.removeEventListener('abort', cancel);
            } catch {
                /* Host signal cleanup is not logged. */
            }
            controller.signal.removeEventListener('abort', rejectAbort);
            if (!work) release();
        }
    }
}
