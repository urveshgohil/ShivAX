import { identifier, record } from '../agents/validation.js';
import type { BotValue } from '../agents/types.js';
import { ProtectedToolRegistry } from '../security/registry.js';
import { SecurityError } from '../security/errors.js';
import type { ProtectedTool } from '../security/types.js';
import { ModelProviderRegistry } from '../intelligence/registry.js';
import { response, schema } from '../intelligence/validation.js';
import { integer, moneyUnits } from './validation.js';
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
        const costUnits = moneyUnits(
            provider.pricing.callUSD +
                provider.pricing.inputTokenUSD * inputTokens +
                provider.pricing.outputTokenUSD * outputTokens
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
                    const raw = await provider.infer(
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
                            maxCostUSD: costUnits / 1e9,
                            checkExecution,
                        })
                    );
                    checkExecution();
                    try {
                        // Inspect usage before output validation. Invalid output never masks an overrun.
                        const envelope = record(raw, ['data', 'usage'], 'invalid-output');
                        const usage = record(
                            envelope.usage,
                            ['inputTokens', 'outputTokens', 'costUSD'],
                            'invalid-output'
                        );
                        for (const [field, max] of [
                            ['inputTokens', inputTokens],
                            ['outputTokens', outputTokens],
                        ] as const)
                            if (usage[field] !== null) integer(usage[field], 0, max);
                        if (usage.costUSD !== null && moneyUnits(usage.costUSD) > costUnits)
                            throw new SecurityError('invalid-output');
                        const result = response(raw, outputSchema, validate, 1_048_576);
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
