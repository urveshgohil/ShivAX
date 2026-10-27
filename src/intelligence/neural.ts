import type { NeuralNet } from '../nn/NeuralNet.js';
import type { ModelProvider, ModelRequest, ModelResponse } from './types.js';
import { ModelError } from './errors.js';
import { json, name } from './validation.js';

/** Read-only adapter: uses the existing trained network; never initializes or trains weights. */
export class NeuralModelProvider implements ModelProvider {
    readonly locality = 'in-process' as const;
    readonly tokenBased = false;
    readonly capabilities = Object.freeze(['numeric-inference'] as const);
    readonly pricing = Object.freeze({ inputTokenUSD: 0, outputTokenUSD: 0, callUSD: 0 });
    readonly #predict: NeuralNet['predict'];
    constructor(
        readonly id: string,
        network: NeuralNet
    ) {
        name(id);
        if (!network || typeof network.predict !== 'function')
            throw new ModelError('invalid-provider');
        this.#predict = network.predict.bind(network);
    }
    infer(request: ModelRequest): ModelResponse {
        request.checkExecution();
        request.context.signal.throwIfAborted();
        if (request.capability !== 'numeric-inference') throw new ModelError('missing-provider');
        const input = json(request.input, 1_048_576);
        if (
            !Array.isArray(input) ||
            !input.length ||
            input.some((value) => typeof value !== 'number')
        )
            throw new ModelError('invalid-input');
        let predictions: number[];
        try {
            predictions = this.#predict(input as number[]);
        } catch {
            throw new ModelError('invalid-input');
        }
        request.context.signal.throwIfAborted();
        return { data: { predictions }, usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 } };
    }
}
