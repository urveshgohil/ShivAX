import type { BotValue } from '../agents/types.js';
import { record, snapshotValue, identifier } from '../agents/validation.js';
import type { SerializedNeuralNet, TrainOptions } from '../nn/NeuralNet.js';
import { EVALUATION_DOMAINS, trainOfflineCandidate } from './index.js';

export interface CuratedTrainingRow {
    readonly feedbackId: string;
    readonly domain: string;
    readonly input: BotValue;
    readonly expected: BotValue;
}
export function validateTrainingExport(raw: unknown): readonly CuratedTrainingRow[] {
    const value = record(
        snapshotValue(raw, 1_048_576, 'invalid-input'),
        ['format', 'version', 'trust', 'rows'],
        'invalid-input'
    );
    if (
        value.format !== 'shivax-curated-training' ||
        value.version !== 1 ||
        value.trust !== 'untrusted' ||
        !Array.isArray(value.rows) ||
        value.rows.length > 256
    )
        throw new Error('Invalid training export.');
    const ids = new Set();
    for (const rawRow of value.rows) {
        const row = record(rawRow, ['feedbackId', 'domain', 'input', 'expected'], 'invalid-input');
        identifier(row.feedbackId, 'invalid-input');
        if (
            ids.has(row.feedbackId) ||
            !(EVALUATION_DOMAINS as readonly unknown[]).includes(row.domain) ||
            !('input' in row) ||
            !('expected' in row)
        )
            throw new Error('Invalid training row.');
        ids.add(row.feedbackId);
    }
    return value.rows as unknown as readonly CuratedTrainingRow[];
}
/** Caller supplies explicit disjoint exports. Only numeric rows can enter the CPU neural trainer. */
export function trainCuratedCandidate(
    model: SerializedNeuralNet,
    training: unknown,
    heldOut: unknown,
    options: TrainOptions = {}
) {
    const train = validateTrainingExport(training),
        test = validateTrainingExport(heldOut);
    if (!train.length || !test.length) throw new Error('Training and held-out data are required.');
    const inputKey = (value: BotValue) => JSON.stringify(value);
    const ids = new Set(train.map((r) => r.feedbackId)),
        inputs = new Set(train.map((r) => inputKey(r.input)));
    if (test.some((r) => ids.has(r.feedbackId) || inputs.has(inputKey(r.input))))
        throw new Error('Held-out overlap.');
    for (const row of [...train, ...test]) {
        if (
            !Array.isArray(row.input) ||
            !Array.isArray(row.expected) ||
            row.input.length !== model.config.layers[0] ||
            row.expected.length !== model.config.layers[model.config.layers.length - 1] ||
            [...row.input, ...row.expected].some(
                (v) => typeof v !== 'number' || !Number.isFinite(v)
            )
        )
            throw new Error('Dataset is incompatible with numeric training.');
        // Apply the existing neural engine's target semantics to both splits before training.
        // Held-out rows never reach NeuralNet.train, so it cannot validate their labels for us.
        const labels = row.expected as number[];
        if (model.config.task !== 'regression' && labels.some((v) => v < 0 || v > 1))
            throw new Error('Classification targets must be in [0, 1].');
        if (
            model.config.task === 'multiclass' &&
            Math.abs(labels.reduce((sum, v) => sum + v, 0) - 1) > 1e-6
        )
            throw new Error('Multiclass targets must sum to 1.');
    }
    const result = trainOfflineCandidate(
        model,
        train.map((r) => r.input as number[]),
        train.map((r) => r.expected as number[]),
        options
    );
    return { ...result, heldOut: test };
}
