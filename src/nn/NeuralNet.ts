import { finite, integer } from '../core/Tensor.js';
import { seededRandom, sigmoid, softmax } from '../core/math.js';
import { activate, activationDerivative, type Activation } from './activations.js';
import { Optimizer, resolveOptimizer, type OptimizerConfig, type ResolvedOptimizer } from './optimizer.js';

export type Task = 'binary' | 'multiclass' | 'regression';
export type Initialization = 'xavier' | 'he' | 'auto';
export interface NeuralNetOptions {
    /** Includes input and output widths, e.g. [2, 8, 1]. */
    layers: readonly number[];
    task: Task;
    seed?: number;
    /** Hidden-layer activation only. Output activation is determined by task. */
    activation?: Activation;
    negativeSlope?: number;
    initialization?: Initialization;
    optimizer?: OptimizerConfig;
    learningRate?: number;
}
export interface TrainOptions {
    epochs?: number;
    learningRate?: number;
    /** Overrides the current optimizer. Changing its configuration resets state. */
    optimizer?: OptimizerConfig;
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
export interface SerializedNeuralNet {
    format: 'shivax-neural-net';
    version: 1;
    config: Required<NeuralNetOptions>;
    parameters: { weights: number[]; biases: number[] }[];
}

/** CPU dense network: tanh hidden layers, SGD, task-specific output/loss. */
export class NeuralNet {
    readonly layers: readonly number[];
    readonly task: Task;
    private readonly parameters: Layer[];
    private readonly random: () => number;
    private training = false;
    private readonly activation: Activation;
    private readonly negativeSlope: number;
    private readonly config: Required<NeuralNetOptions>;
    private optimizerConfig: ResolvedOptimizer;
    private optimizer: Optimizer | undefined;

    constructor(options: NeuralNetOptions) {
        if (!options || !Array.isArray(options.layers)) throw new TypeError('layers must be an array');
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
        this.activation = options.activation ?? 'tanh';
        if (!['tanh','relu','leakyRelu','sigmoid'].includes(this.activation)) throw new TypeError('Unknown activation');
        this.negativeSlope = finite(options.negativeSlope ?? 0.01, 'negativeSlope');
        if (this.negativeSlope <= 0 || this.negativeSlope > 1) throw new RangeError('negativeSlope must be in (0, 1]');
        const initialization = options.initialization ?? 'xavier';
        if (!['xavier','he','auto'].includes(initialization)) throw new TypeError('Unknown initialization');
        const learningRate = finite(options.learningRate ?? 0.1, 'learningRate');
        if (learningRate <= 0 || learningRate > 10) throw new RangeError('learningRate must be in (0, 10]');
        this.optimizerConfig = resolveOptimizer(options.optimizer);
        this.config = { layers: this.layers, task: this.task, seed: options.seed ?? 42, activation: this.activation, negativeSlope: this.negativeSlope,
            initialization, optimizer: this.optimizerConfig, learningRate };
        this.random = seededRandom(options.seed ?? 42);
        this.parameters = this.layers.slice(1).map((width, index) => {
            const input = this.layers[index];
            const hidden = index < this.layers.length - 2;
            const he = hidden && (initialization === 'he' || (initialization === 'auto' && ['relu','leakyRelu'].includes(this.activation)));
            const scale = he ? Math.sqrt(6 / (input * (this.activation === 'leakyRelu' ? 1 + this.negativeSlope ** 2 : 1))) : Math.sqrt(6 / (input + width));
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
            if (l < this.parameters.length - 1) next = next.map(value => activate(value, this.activation, this.negativeSlope));
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
        const rate = finite(options.learningRate ?? this.config.learningRate, 'learningRate');
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
        const optimizerConfig = options.optimizer === undefined ? this.optimizerConfig : resolveOptimizer(options.optimizer);
        if (!this.optimizer || JSON.stringify(optimizerConfig) !== JSON.stringify(this.optimizerConfig)) {
            this.optimizer = new Optimizer(optimizerConfig, this.parameters.flatMap(layer => [layer.weights, layer.biases]));
            this.optimizerConfig = optimizerConfig;
        }
        const gradients = this.parameters.map(layer => ({ weights: new Float64Array(layer.weights.length), biases: new Float64Array(layer.output) }));
        const gradientBuffers = gradients.flatMap(layer => [layer.weights, layer.biases]);
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
                    for (const buffer of gradientBuffers) buffer.fill(0);
                    for (let r = start; r < end; r++) {
                        const index = order[r];
                        const activations = this.forward(inputs[index]);
                        let delta = activations[activations.length - 1].map((p, i) =>
                            (p - targets[index][i]) * (this.task === 'regression' ? 2 / outputWidth : 1));
                        for (let l = this.parameters.length - 1; l >= 0; l--) {
                            const layer = this.parameters[l];
                            const previous = activations[l];
                            const nextDelta = new Array<number>(l > 0 ? layer.input : 0).fill(0);
                            for (let o = 0; o < layer.output; o++) {
                                gradients[l].biases[o] += delta[o];
                                for (let i = 0; i < layer.input; i++) {
                                    gradients[l].weights[o * layer.input + i] += delta[o] * previous[i];
                                    if (l > 0) nextDelta[i] += layer.weights[o * layer.input + i] * delta[o];
                                }
                            }
                            if (l > 0) delta = nextDelta.map((value, i) => value * activationDerivative(previous[i], this.activation, this.negativeSlope));
                        }
                    }
                    this.optimizer.update(gradientBuffers, rate, end - start);
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

    /** Discard momentum/Adam moments. The model weights are preserved. */
    resetOptimizer(): void {
        if (this.training) throw new Error('Cannot reset optimizer during training');
        this.optimizer = undefined;
    }

    /** Inference format: optimizer moments and PRNG progress are intentionally omitted. */
    toJSON(): SerializedNeuralNet {
        return { format: 'shivax-neural-net', version: 1,
            config: { ...this.config, layers: [...this.layers], optimizer: { ...this.optimizerConfig } },
            parameters: this.parameters.map(layer => ({ weights: Array.from(layer.weights,value => finite(value,'parameter')), biases: Array.from(layer.biases,value => finite(value,'parameter')) })) };
    }

    static fromJSON(input: unknown): NeuralNet {
        if (typeof input === 'string') {
            if (input.length > 32_000_000) throw new RangeError('Serialized model text limit exceeded');
            input = JSON.parse(input);
        }
        const record = (value: unknown): Record<string, unknown> => {
            if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected a plain model object');
            if (Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set)) throw new TypeError('Model accessors are not allowed');
            return value as Record<string, unknown>;
        };
        const plainArray = (value: unknown, max: number): unknown[] => {
            if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) throw new TypeError('Invalid model array');
            const keys = Reflect.ownKeys(value);
            if (keys.length !== value.length + 1) throw new TypeError('Sparse model arrays are not allowed');
            for (const key of keys) {
                if (key === 'length') continue;
                if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new TypeError('Unknown model array field');
                const descriptor = Object.getOwnPropertyDescriptor(value,key);
                if (!descriptor || descriptor.get || descriptor.set) throw new TypeError('Model array accessors are not allowed');
            }
            return value;
        };
        const data = record(input);
        if (data.format !== 'shivax-neural-net' || data.version !== 1) throw new TypeError('Unsupported model format/version');
        if (Object.keys(data).some(key => !['format','version','config','parameters'].includes(key))) throw new TypeError('Unknown model field');
        const config = record(data.config);
        if (Object.keys(config).some(key => !['layers','task','seed','activation','negativeSlope','initialization','optimizer','learningRate'].includes(key))) throw new TypeError('Unknown model configuration');
        const layers = plainArray(config.layers,8) as number[];
        const parameterLayers = plainArray(data.parameters,7);
        if (parameterLayers.length !== layers.length - 1) throw new RangeError('Invalid model layers');
        if (typeof config.optimizer === 'object') record(config.optimizer);
        // Validate widths and parameter limit before any parameter allocation.
        integer(layers.length,2,8,'layer count');
        let total = 0;
        for (let i = 0; i < layers.length; i++) {
            const width = integer(layers[i],1,4096,'layer width');
            if (i) total += (layers[i-1]+1)*width;
        }
        if (total > 1_000_000) throw new RangeError('Network parameter limit exceeded');
        const arrays = parameterLayers.map((value,index) => {
            const layer = record(value);
            if (Object.keys(layer).some(key => !['weights','biases'].includes(key))) throw new TypeError('Unknown parameter field');
            const check = (array: unknown, count: number): number[] => {
                const values = plainArray(array,1_000_000);
                if (values.length !== count) throw new RangeError('Parameter dimensions do not match model');
                for (let i = 0; i < values.length; i++) {
                    const descriptor = Object.getOwnPropertyDescriptor(values,String(i));
                    if (!descriptor || descriptor.get || descriptor.set) throw new TypeError('Invalid parameter array');
                    finite(descriptor.value,'serialized parameter');
                }
                return values as number[];
            };
            return { weights: check(layer.weights,layers[index]*layers[index+1]), biases: check(layer.biases,layers[index+1]) };
        });
        const model = new NeuralNet(config as unknown as NeuralNetOptions);
        arrays.forEach((layer,index) => { model.parameters[index].weights.set(layer.weights); model.parameters[index].biases.set(layer.biases); });
        return model;
    }
}
