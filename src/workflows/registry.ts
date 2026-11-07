import { identifier, record } from '../agents/validation.js';
import type { BotValue } from '../agents/types.js';
import { ProtectedToolRegistry } from '../security/registry.js';
import { SecurityError } from '../security/errors.js';
import type { ProtectedTool } from '../security/types.js';
import { ModelProviderRegistry } from '../intelligence/registry.js';
import { ModelError } from '../intelligence/errors.js';
import { costUnits as exactUnits, reservationUSD } from '../intelligence/cost.js';
import { response, schema, usageReport } from '../intelligence/validation.js';
import { integer } from './validation.js';
import { WorkflowError } from './errors.js';

// R01 exact cost units are 10^-324 USD; workflow budgets count 10^-9 USD.
const NANODOLLAR_UNITS = 10n ** 315n;
import type { WorkflowModelTool, WorkflowTool, WorkflowToolBinding } from './types.js';

export interface RegisteredWorkflowTool {
    readonly id: string;
    readonly capability: string;
    readonly effect: WorkflowTool['effect'];
    readonly parallelSafe: boolean;
    readonly tool: ProtectedTool;
    readonly model?: { readonly tokens: number; readonly costUnits: number };
}

/** Host-owned capability bindings over the existing protected tools. No default handlers. */
export class ToolRegistry {
    readonly protectedTools: ProtectedToolRegistry;
    readonly #entries = new Map<string, RegisteredWorkflowTool>();
    readonly #owned = new Set<string>();
    constructor(tools = new ProtectedToolRegistry()) {
        this.protectedTools = tools;
    }
    register(tool: WorkflowTool): this {
        return this.#register(tool);
    }
    #register(tool: WorkflowTool, model?: RegisteredWorkflowTool['model']): this {
        try {
            record(
                tool,
                [
                    'id',
                    'capability',
                    'effect',
                    'parallelSafe',
                    'validateInput',
                    'validateOutput',
                    'execute',
                ],
                'invalid-input'
            );
            identifier(tool.id, 'invalid-input');
            identifier(tool.capability, 'invalid-input');
            if (
                !['read-only', 'state-changing'].includes(tool.effect) ||
                (tool.parallelSafe !== undefined && typeof tool.parallelSafe !== 'boolean') ||
                (tool.parallelSafe && tool.effect !== 'read-only')
            )
                throw new SecurityError('invalid-tool');
            if (this.#entries.has(tool.id)) throw new SecurityError('duplicate-tool');
            this.protectedTools.register({
                id: tool.id,
                validateInput: tool.validateInput.bind(tool),
                validateOutput: tool.validateOutput.bind(tool),
                execute: tool.execute.bind(tool),
            });
            this.#entries.set(
                tool.id,
                Object.freeze({
                    id: tool.id,
                    capability: tool.capability,
                    effect: tool.effect,
                    parallelSafe: tool.parallelSafe === true,
                    tool: this.protectedTools.get(tool.id)!,
                    ...(model ? { model } : {}),
                })
            );
            this.#owned.add(tool.id);
            return this;
        } catch (error) {
            if (error instanceof SecurityError) throw error;
            throw new SecurityError('invalid-tool');
        }
    }
    /** Bind an existing protected service without replacing its handler or taking ownership. */
    bind(binding: WorkflowToolBinding): this {
        try {
            record(binding, ['id', 'capability', 'effect', 'parallelSafe'], 'invalid-input');
            identifier(binding.id, 'invalid-input');
            identifier(binding.capability, 'invalid-input');
            const tool = this.protectedTools.get(binding.id);
            if (
                !tool ||
                !['read-only', 'state-changing'].includes(binding.effect) ||
                (binding.parallelSafe !== undefined && typeof binding.parallelSafe !== 'boolean') ||
                (binding.parallelSafe && binding.effect !== 'read-only')
            )
                throw new SecurityError('invalid-tool');
            if (this.#entries.has(binding.id)) throw new SecurityError('duplicate-tool');
            this.#entries.set(
                binding.id,
                Object.freeze({
                    id: binding.id,
                    capability: binding.capability,
                    effect: binding.effect,
                    parallelSafe: binding.parallelSafe === true,
                    tool,
                })
            );
            return this;
        } catch (error) {
            if (error instanceof SecurityError) throw error;
            throw new SecurityError('invalid-tool');
        }
    }
    /** One bounded provider call per invocation; no hidden fallback or model-selected permissions. */
    registerModel(config: WorkflowModelTool): this {
        record(
            config,
            [
                'id',
                'capability',
                'provider',
                'modelCapability',
                'output',
                'maxInputTokens',
                'maxOutputTokens',
                'allowRemote',
                'validateInput',
            ],
            'invalid-input'
        );
        const provider = new ModelProviderRegistry()
            .register(config.provider)
            .get(config.provider.id)!;
        if (
            !provider.capabilities.includes(config.modelCapability) ||
            (config.allowRemote !== undefined && typeof config.allowRemote !== 'boolean') ||
            (provider.locality === 'remote' && config.allowRemote !== true)
        )
            throw new SecurityError('invalid-tool');
        integer(config.maxInputTokens, 0, 100_000_000);
        integer(config.maxOutputTokens, 0, 100_000_000);
        const inputTokens = provider.tokenBased ? config.maxInputTokens : 0;
        const outputTokens = provider.tokenBased ? config.maxOutputTokens : 0;
        // Exact R01 arithmetic: no floating-point sum decides the reservation.
        const exactCost =
            exactUnits(provider.pricing.callUSD) +
            exactUnits(provider.pricing.inputTokenUSD) * BigInt(inputTokens) +
            exactUnits(provider.pricing.outputTokenUSD) * BigInt(outputTokens);
        if (exactCost > exactUnits(1_000_000)) throw new WorkflowError('invalid-options');
        // The Number cap given to the provider is funded in full, as in ModelRouter.
        const providerCapUSD = reservationUSD(exactCost);
        const fundedCost = exactUnits(providerCapUSD);
        // Workflow budgets use whole nanodollars; round the funded amount up.
        const costUnits = Number(
            (fundedCost + NANODOLLAR_UNITS - 1n) / NANODOLLAR_UNITS
        );
        const outputSchema = schema(config.output.schema),
            validate = config.output.validate?.bind(config.output);
        const validateInput = config.validateInput.bind(config),
            modelCapability = config.modelCapability;
        return this.#register(
            {
                id: config.id,
                capability: config.capability,
                effect: 'read-only',
                validateInput: (value): value is BotValue => validateInput(value) === true,
                validateOutput: (value): value is BotValue => value !== undefined,
                async execute(input, context) {
                    const checkExecution = () => {
                        context.checkExecution?.();
                        context.signal.throwIfAborted();
                    };
                    checkExecution();
                    let raw: unknown;
                    try {
                        raw = await provider.infer(
                            Object.freeze({
                                capability: modelCapability,
                                input,
                                schema: outputSchema,
                                context: Object.freeze({
                                    taskId: context.taskId!,
                                    sessionId: context.session.id,
                                    scope: context.session.scope,
                                    signal: context.signal,
                                }),
                                maxInputTokens: inputTokens,
                                maxOutputTokens: outputTokens,
                                maxCostUSD: providerCapUSD,
                                checkExecution,
                            })
                        );
                    } catch (error) {
                        checkExecution();
                        // Match ModelRouter: only ordinary provider/transport failures stay
                        // retryable. Hard limits, unverifiable usage, timeouts and declared
                        // output failures are terminal (invalid-output is never retried).
                        if (
                            error instanceof ModelError &&
                            !['provider-error', 'unavailable'].includes(error.code)
                        )
                            throw new SecurityError('invalid-output');
                        throw error;
                    }
                    checkExecution();
                    // Inspect usage before output validation, without invoking accessors.
                    // Invalid output never masks an overrun; unverifiable usage fails closed (R02).
                    const report = usageReport(raw);
                    const usage = report.usage;
                    if (
                        !report.valid ||
                        (provider.tokenBased &&
                            (usage.inputTokens === null || usage.outputTokens === null)) ||
                        (usage.inputTokens !== null && usage.inputTokens > inputTokens) ||
                        (usage.outputTokens !== null && usage.outputTokens > outputTokens) ||
                        (usage.costUSD !== null && exactUnits(usage.costUSD) > fundedCost)
                    )
                        throw new SecurityError('invalid-output');
                    try {
                        const result = response(raw, outputSchema, validate, 1_048_576, usage);
                        checkExecution();
                        return result.data;
                    } catch {
                        throw new SecurityError('invalid-output');
                    }
                },
            },
            Object.freeze({ tokens: inputTokens + outputTokens, costUnits })
        );
    }
    get(id: string): RegisteredWorkflowTool | undefined {
        return this.#entries.get(id);
    }
    list(): readonly RegisteredWorkflowTool[] {
        return Object.freeze([...this.#entries.values()]);
    }
    findByCapability(capability: string): readonly RegisteredWorkflowTool[] {
        return Object.freeze(
            this.list()
                .filter((tool) => tool.capability === capability)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        );
    }
    unregister(id: string): boolean {
        const entry = this.#entries.get(id);
        if (!entry) return false;
        if (this.#owned.has(id) && this.protectedTools.get(id) === entry.tool)
            this.protectedTools.unregister(id);
        this.#owned.delete(id);
        return this.#entries.delete(id);
    }
}
