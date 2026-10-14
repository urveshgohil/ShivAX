import { finite } from '../core/Tensor.js';
import { sigmoid } from '../core/math.js';

export type Activation = 'tanh' | 'relu' | 'leakyRelu' | 'sigmoid';

export function activate(value: number, activation: Activation, negativeSlope = 0.01): number {
    finite(value, 'activation input');
    switch (activation) {
        case 'tanh': return Math.tanh(value);
        case 'relu': return Math.max(0, value);
        case 'leakyRelu': return value >= 0 ? value : value * negativeSlope;
        case 'sigmoid': return sigmoid(value);
        default: throw new TypeError('Unknown activation');
    }
}

/** Derivative from the layer output; ReLU uses derivative zero at the kink. */
export function activationDerivative(output: number, activation: Activation, negativeSlope = 0.01): number {
    finite(output, 'activation output');
    switch (activation) {
        case 'tanh': return 1 - output * output;
        case 'relu': return output > 0 ? 1 : 0;
        case 'leakyRelu': return output >= 0 ? 1 : negativeSlope;
        case 'sigmoid': return output * (1 - output);
        default: throw new TypeError('Unknown activation');
    }
}
