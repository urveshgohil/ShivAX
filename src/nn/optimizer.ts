import { finite, integer } from '../core/Tensor.js';

export type OptimizerName = 'sgd' | 'momentum' | 'adam';
export interface OptimizerOptions { type: OptimizerName; momentum?: number; beta1?: number; beta2?: number; epsilon?: number }
export type OptimizerConfig = OptimizerName | OptimizerOptions;
export type ResolvedOptimizer = Readonly<Required<OptimizerOptions>>;

export function resolveOptimizer(input: OptimizerConfig = 'sgd'): ResolvedOptimizer {
    const options = typeof input === 'string' ? { type: input } : input;
    if (!options || !['sgd','momentum','adam'].includes(options.type)) throw new TypeError('Unknown optimizer');
    const result = { type: options.type, momentum: options.momentum ?? 0.9, beta1: options.beta1 ?? 0.9, beta2: options.beta2 ?? 0.999, epsilon: options.epsilon ?? 1e-8 };
    for (const key of ['momentum','beta1','beta2'] as const) {
        finite(result[key], key);
        if (result[key] < 0 || result[key] >= 1) throw new RangeError(`${key} must be in [0, 1)`);
    }
    finite(result.epsilon, 'epsilon');
    if (result.epsilon <= 0 || result.epsilon > 1) throw new RangeError('epsilon must be in (0, 1]');
    return Object.freeze(result);
}

type Buffers = { first: Float64Array; second: Float64Array };

/** Internal reusable batch updater. Validate every candidate before committing any state. */
export class Optimizer {
    private step = 0;
    private readonly state: Buffers[];
    private readonly candidate: Float64Array[];
    private readonly pending: Buffers[];

    constructor(readonly config: ResolvedOptimizer, private readonly parameters: Float64Array[]) {
        this.candidate = parameters.map(p => new Float64Array(p.length));
        const buffers = () => parameters.map(p => ({ first: new Float64Array(config.type === 'sgd' ? 0 : p.length), second: new Float64Array(config.type === 'adam' ? p.length : 0) }));
        this.state = buffers(); this.pending = buffers();
    }

    update(gradients: Float64Array[], rate: number, samples: number): void {
        const nextStep = integer(this.step + 1, 1, Number.MAX_SAFE_INTEGER, 'optimizer step');
        const { type, momentum, beta1, beta2, epsilon } = this.config;
        const correction1 = 1 - beta1 ** nextStep, correction2 = 1 - beta2 ** nextStep;
        for (let b = 0; b < this.parameters.length; b++) {
            const values = this.parameters[b], gradient = gradients[b], previous = this.state[b], pending = this.pending[b];
            for (let i = 0; i < values.length; i++) {
                finite(gradient[i], 'gradient');
                let change: number;
                if (type === 'sgd') {
                    // Preserve the original default arithmetic exactly.
                    change = rate / samples * gradient[i];
                } else {
                    const g = finite(gradient[i] / samples, 'mean gradient');
                    if (type === 'momentum') {
                        pending.first[i] = finite(momentum * previous.first[i] + g, 'momentum state');
                        change = rate * pending.first[i];
                    } else {
                        pending.first[i] = finite(beta1 * previous.first[i] + (1-beta1) * g, 'Adam first moment');
                        pending.second[i] = finite(beta2 * previous.second[i] + (1-beta2) * g*g, 'Adam second moment');
                        change = rate * (pending.first[i] / correction1) / (Math.sqrt(pending.second[i] / correction2) + epsilon);
                    }
                }
                this.candidate[b][i] = finite(values[i] - change, 'parameter update');
            }
        }
        for (let b = 0; b < this.parameters.length; b++) {
            this.parameters[b].set(this.candidate[b]);
            this.state[b].first.set(this.pending[b].first); this.state[b].second.set(this.pending[b].second);
        }
        this.step = nextStep;
    }
}
