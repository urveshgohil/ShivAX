import { finite, integer } from './Tensor.js';

export function sigmoid(value: number): number {
    finite(value);
    if (value >= 0) return 1 / (1 + Math.exp(-value));
    const exp = Math.exp(value);
    return exp / (1 + exp);
}

export function softmax(values: ArrayLike<number>): number[] {
    integer(values.length, 1, 4096, 'class count');
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) max = Math.max(max, finite(values[i]));
    const exps = Array.from(values, value => Math.exp(value - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(value => value / sum);
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    integer(a.length, 1, 1_048_576, 'vector length');
    if (a.length !== b.length) throw new RangeError('Vector lengths must match');
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += finite(a[i]) * finite(b[i]);
    return finite(sum, 'dot product');
}

/** Deterministic PRNG for repeatable experiments; not for cryptography. */
export function seededRandom(seed = 42): () => number {
    integer(seed, 0, 0xffffffff, 'seed');
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
