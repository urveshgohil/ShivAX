import { integer } from '../core/Tensor.js';

/** Lowercase Unicode word-count features with an explicitly bounded vocabulary. */
export class BagOfWords {
    private vocabulary = new Map<string, number>();
    constructor(readonly maxFeatures = 1024) { integer(maxFeatures, 1, 4096, 'maxFeatures'); }
    get words(): readonly string[] { return [...this.vocabulary.keys()]; }

    private tokens(text: string): string[] {
        if (typeof text !== 'string') throw new TypeError('Text must be a string');
        if (text.length > 100_000) throw new RangeError('Text length limit exceeded');
        return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    }

    fit(texts: readonly string[]): this {
        integer(texts.length, 1, 10_000, 'document count');
        let characters = 0;
        for (const text of texts) {
            if (typeof text !== 'string') throw new TypeError('Text must be a string');
            characters += text.length;
        }
        if (characters > 1_000_000) throw new RangeError('Corpus size limit exceeded');
        const vocabulary = new Map<string, number>();
        for (const text of texts) for (const token of this.tokens(text)) {
            if (!vocabulary.has(token) && vocabulary.size < this.maxFeatures) vocabulary.set(token, vocabulary.size);
        }
        if (vocabulary.size === 0) throw new RangeError('Corpus contains no words');
        this.vocabulary = vocabulary;
        return this;
    }

    transform(text: string): number[] {
        if (!this.vocabulary.size) throw new Error('Fit the vocabulary before transforming text');
        const values = new Array<number>(this.vocabulary.size).fill(0);
        for (const token of this.tokens(text)) {
            const index = this.vocabulary.get(token);
            if (index !== undefined) values[index]++;
        }
        // L1 normalization limits feature magnitude regardless of document length.
        const total = values.reduce((sum, n) => sum + n, 0);
        return total ? values.map(n => n / total) : values;
    }
}
