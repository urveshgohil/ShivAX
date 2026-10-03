import { finite, integer } from '../core/Tensor.js';
import { seededRandom, sigmoid, softmax } from '../core/math.js';

export type Task = 'binary' | 'multiclass' | 'regression';
export interface NeuralNetOptions {
    /** Includes input and output widths, e.g. [2, 8, 1]. */
    layers: readonly number[];
    task: Task;
    seed?: number;
}
export interface TrainOptions {
    epochs?: number;
    learningRate?: number;
    batchSize?: number;
    shuffle?: boolean;
    /** Called after each epoch; return false to stop. */
    onEpoch?: (epoch: number, loss: number) => void | boolean;
    /** For synchronous training, use onEpoch or a worker to arrange cancellation. */
    signal?: { readonly aborted: boolean };
}
export interface TrainingResult { losses: number[]; epochsCompleted: number; stopped: boolean }
type Rows = readonly ArrayLike<number>[];
type Layer = { input: number; output: number; weights: Float64Array; biases: Float64Array };

/** CPU dense network: tanh hidden layers, SGD, task-specific output/loss. */
export class NeuralNet {
    readonly layers: readonly number[];
    readonly task: Task;
    private readonly parameters: Layer[];
    private readonly random: () => number;
    private training = false;

    constructor(options: NeuralNetOptions) {
        integer(options.layers.length, 2, 8, 'layer count');
        this.layers = Object.freeze([...options.layers]);
        this.task = options.task;
        if (!['binary', 'multiclass', 'regression'].includes(this.task)) throw new TypeError('Unknown task');
        let count = 0;
        for (let i = 0; i < this.layers.length; i++) {
            integer(this.layers[i], 1, 4096, 'layer width');
            if (i) count += (this.layers[i - 1] + 1) * this.layers[i];
        }
        if (count > 1_000_000) throw new RangeError('Network parameter limit exceeded');
        const output = this.layers[this.layers.length - 1];
        if (this.task === 'binary' && output !== 1) throw new RangeError('Binary output width must be 1');
        if (this.task === 'multiclass' && output < 2) throw new RangeError('Multiclass requires at least 2 outputs');
        this.random = seededRandom(options.seed ?? 42);
        this.parameters = this.layers.slice(1).map((width, index) => {
            const input = this.layers[index];
            const scale = Math.sqrt(6 / (input + width));
            return { input, output: width,
                weights: Float64Array.from({ length: input * width }, () => (2 * this.random() - 1) * scale),
                biases: new Float64Array(width) };
        });
    }

    private validateRow(row: ArrayLike<number>, width: number): void {
        if (row.length !== width) throw new RangeError('Sample width does not match network');
        for (let i = 0; i < width; i++) finite(row[i], 'sample value');
    }

    private forward(row: ArrayLike<number>): number[][] {
        const activations = [Array.from(row)];
        for (let l = 0; l < this.parameters.length; l++) {
            const layer = this.parameters[l];
            const previous = activations[l];
            let next = Array.from(layer.biases);
            for (let o = 0; o < layer.output; o++) {
                for (let i = 0; i < layer.input; i++) next[o] += layer.weights[o * layer.input + i] * previous[i];
                finite(next[o], 'activation (normalize inputs or reduce learning rate)');
            }
            if (l < this.parameters.length - 1) next = next.map(Math.tanh);
            else if (this.task === 'binary') next = next.map(sigmoid);
            else if (this.task === 'multiclass') next = softmax(next);
            activations.push(next);
        }
        return activations;
    }

    predict(row: ArrayLike<number>): number[] {
        this.validateRow(row, this.layers[0]);
        const activations = this.forward(row);
        return activations[activations.length - 1];
    }

    predictClass(row: ArrayLike<number>): number {
        if (this.task === 'regression') throw new TypeError('Regression does not predict classes');
        const output = this.predict(row);
        return this.task === 'binary' ? Number(output[0] >= 0.5) : output.indexOf(Math.max(...output));
    }

    train(inputs: Rows, targets: Rows, options: TrainOptions = {}): TrainingResult {
        if (this.training) throw new Error('Training is already in progress');
        const epochs = integer(options.epochs ?? 100, 1, 100_000, 'epochs');
        const batchSize = integer(options.batchSize ?? 16, 1, 4096, 'batchSize');
        const rate = finite(options.learningRate ?? 0.1, 'learningRate');
        if (rate <= 0 || rate > 10) throw new RangeError('learningRate must be in (0, 10]');
        integer(inputs.length, 1, 100_000, 'sample count');
        if (targets.length !== inputs.length) throw new RangeError('Input/target counts must match');
        const outputWidth = this.layers[this.layers.length - 1];
        if (inputs.length * (this.layers[0] + outputWidth) > 10_000_000) throw new RangeError('Dataset size limit exceeded');
        const parameterCount = this.parameters.reduce((n, l) => n + l.weights.length + l.biases.length, 0);
        if (epochs * inputs.length * parameterCount > 250_000_000) throw new RangeError('Training work limit exceeded; split training into smaller calls');
        for (let r = 0; r < inputs.length; r++) {
            this.validateRow(inputs[r], this.layers[0]);
            this.validateRow(targets[r], outputWidth);
            if (this.task !== 'regression') {
                let sum = 0;
                for (let i = 0; i < outputWidth; i++) {
                    const value = targets[r][i];
                    if (value < 0 || value > 1) throw new RangeError('Classification targets must be in [0, 1]');
                    sum += value;
                }
                if (this.task === 'multiclass' && Math.abs(sum - 1) > 1e-6) throw new RangeError('Multiclass targets must sum to 1');
            }
        }
        const losses: number[] = [];
        const order = Array.from({ length: inputs.length }, (_, i) => i);
        this.training = true;
        try {
            for (let epoch = 0; epoch < epochs; epoch++) {
                if (options.signal?.aborted) break;
                if (options.shuffle !== false) for (let i = order.length - 1; i > 0; i--) {
                    const j = Math.floor(this.random() * (i + 1));
                    [order[i], order[j]] = [order[j], order[i]];
                }
                for (let start = 0; start < order.length; start += batchSize) {
                    if (options.signal?.aborted) return { losses, epochsCompleted: losses.length, stopped: true };
                    const end = Math.min(start + batchSize, order.length);
                    const gradients = this.parameters.map(layer => ({ weights: new Float64Array(layer.weights.length), biases: new Float64Array(layer.output) }));
                    for (let r = start; r < end; r++) {
                        const index = order[r];
                        const activations = this.forward(inputs[index]);
                        let delta = activations[activations.length - 1].map((p, i) =>
                            (p - targets[index][i]) * (this.task === 'regression' ? 2 / outputWidth : 1));
                        for (let l = this.parameters.length - 1; l >= 0; l--) {
                            const layer = this.parameters[l];
                            const previous = activations[l];
                            const nextDelta = new Array<number>(layer.input).fill(0);
                            for (let o = 0; o < layer.output; o++) {
                                gradients[l].biases[o] += delta[o];
                                for (let i = 0; i < layer.input; i++) {
                                    gradients[l].weights[o * layer.input + i] += delta[o] * previous[i];
                                    nextDelta[i] += layer.weights[o * layer.input + i] * delta[o];
                                }
                            }
                            delta = nextDelta.map((value, i) => value * (1 - previous[i] ** 2));
                        }
                    }
                    // Validate every candidate before changing any parameter in this batch.
                    const step = rate / (end - start);
                    for (let l = 0; l < this.parameters.length; l++) {
                        for (const key of ['weights', 'biases'] as const) {
                            const values = this.parameters[l][key];
                            for (let i = 0; i < values.length; i++) finite(values[i] - step * gradients[l][key][i], 'parameter update');
                        }
                    }
                    for (let l = 0; l < this.parameters.length; l++) for (const key of ['weights', 'biases'] as const) {
                        const values = this.parameters[l][key];
                        for (let i = 0; i < values.length; i++) values[i] -= step * gradients[l][key][i];
                    }
                }
                let loss = 0;
                for (let r = 0; r < inputs.length; r++) {
                    const prediction = this.predict(inputs[r]);
                    for (let i = 0; i < outputWidth; i++) {
                        const y = targets[r][i];
                        const p = prediction[i];
                        if (this.task === 'regression') loss += (p - y) ** 2 / outputWidth;
                        else {
                            loss -= y * Math.log(Math.max(1e-15, p));
                            if (this.task === 'binary') loss -= (1 - y) * Math.log(Math.max(1e-15, 1 - p));
                        }
                    }
                }
                loss = finite(loss / inputs.length, 'loss');
                losses.push(loss);
                if (options.onEpoch?.(epoch + 1, loss) === false) break;
            }
        } finally { this.training = false; }
        return { losses, epochsCompleted: losses.length, stopped: losses.length < epochs };
    }
}
