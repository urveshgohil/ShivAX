import type { BotValue } from '../agents/types.js';
import { checkPredicate } from '../agents/validation.js';
import type { ModelProvider, ModelRequest, ModelResponse } from './types.js';
import { ModelError } from './errors.js';
import { name } from './validation.js';

export interface ModelRule {
    readonly id: string;
    validate(input: BotValue): boolean;
    run(input: BotValue, request: ModelRequest): BotValue | Promise<BotValue>;
}
/** Runs a named host rule. No implicit model claims, eval, tool execution or untrusted code. */
export class RulesModelProvider implements ModelProvider {
    readonly locality = 'in-process' as const;
    readonly tokenBased = false;
    readonly capabilities = Object.freeze(['deterministic-validation'] as const);
    readonly pricing = Object.freeze({ inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 0 });
    readonly #rules = new Map<string, ModelRule>();
    constructor(
        readonly id: string,
        rules: readonly ModelRule[]
    ) {
        name(id);
        if (!Array.isArray(rules) || !rules.length || rules.length > 128)
            throw new ModelError('invalid-provider');
        for (const rule of rules) {
            name(rule.id);
            if (
                this.#rules.has(rule.id) ||
                typeof rule.validate !== 'function' ||
                typeof rule.run !== 'function'
            )
                throw new ModelError('invalid-provider');
            this.#rules.set(
                rule.id,
                Object.freeze({
                    id: rule.id,
                    validate: rule.validate.bind(rule),
                    run: rule.run.bind(rule),
                })
            );
        }
    }
    async infer(request: ModelRequest): Promise<ModelResponse> {
        request.checkExecution();
        request.context.signal.throwIfAborted();
        if (request.capability !== 'deterministic-validation')
            throw new ModelError('missing-provider');
        const input = request.input as Readonly<Record<string, BotValue>>;
        if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            Object.keys(input).sort().join(',') !== 'data,rule' ||
            typeof input.rule !== 'string'
        )
            throw new ModelError('invalid-input');
        const rule = this.#rules.get(input.rule);
        if (!rule) throw new ModelError('unavailable');
        if (!checkPredicate(() => rule.validate(input.data))) throw new ModelError('invalid-input');
        request.checkExecution();
        request.context.signal.throwIfAborted();
        const data = await rule.run(input.data, request);
        request.context.signal.throwIfAborted();
        return { data, usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 } };
    }
}
