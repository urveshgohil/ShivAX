import { NeuralNet, type SerializedNeuralNet, type TrainingResult } from '../nn/NeuralNet.js';
import { resolveOptimizer, type OptimizerConfig, type ResolvedOptimizer } from '../nn/optimizer.js';

/*
 * SARASWATI S03: message protocol for worker-based training. This module has no Node imports; the Node-only
 * pool (`worker-training.ts`) and the worker script (`training-worker.ts`) both use it.
 * Messages are plain data. Nothing in a message is ever evaluated or executed.
 */

export const WORKER_TRAINING_PROTOCOL = 1;
export const WORKER_TRAINING_LIMITS = Object.freeze({
    /** Training plus validation rows. NeuralNet itself allows 100 000. */
    maxSamples: 50_000,
    /** Numbers sent to a worker (inputs and labels, training and validation): 32 MiB as Float64. */
    maxValues: 4_000_000,
    maxEpochs: 100_000,
    /** Same work limit as NeuralNet.train: epochs × rows × parameters. */
    maxWork: 250_000_000,
    maxConcurrency: 16,
    maxQueued: 256,
    defaultTimeoutMs: 600_000,
    maxTimeoutMs: 3_600_000,
    defaultStartupTimeoutMs: 10_000,
    maxStartupTimeoutMs: 60_000,
    defaultGraceMs: 1_000,
    maxGraceMs: 30_000,
    defaultMaxOldGenerationMb: 512,
    maxErrorMessageLength: 200,
});

export const WORKER_TRAINING_ERROR_CODES = Object.freeze([
    'invalid-input',
    'cancelled',
    'timeout',
    'startup-failed',
    'worker-crashed',
    'resource-limit',
    'protocol-error',
    'training-failed',
    'queue-full',
    'pool-closed',
] as const);
export type WorkerTrainingErrorCode = (typeof WORKER_TRAINING_ERROR_CODES)[number];

/** `cooperative`: the worker stopped at a batch boundary. `forced`: the worker was terminated. */
export type WorkerTermination = 'cooperative' | 'forced';
export class WorkerTrainingError extends Error {
    readonly code: WorkerTrainingErrorCode;
    readonly termination: WorkerTermination | null;
    constructor(code: WorkerTrainingErrorCode, message?: string, termination: WorkerTermination | null = null) {
        super(message ?? `Worker training failed: ${code}.`);
        this.name = 'WorkerTrainingError';
        this.code = code;
        this.termination = termination;
    }
}

/** The serializable subset of `TrainOptions`. Callbacks and signals stay on the host. */
export interface WorkerTrainOptions {
    readonly epochs?: number;
    readonly learningRate?: number;
    readonly batchSize?: number;
    readonly shuffle?: boolean;
    readonly optimizer?: OptimizerConfig;
}
export interface WorkerValidationSet {
    readonly inputs: readonly ArrayLike<number>[];
    readonly labels: readonly ArrayLike<number>[];
}
export interface WorkerTrainingProgress {
    /** `cancelling` once cancellation, a timeout or pool shutdown has been requested. */
    readonly status: 'training' | 'cancelling';
    readonly epoch: number;
    readonly totalEpochs: number;
    /** Training loss the worker measured after this epoch. */
    readonly loss: number;
    /** Present only when a validation set was supplied. `accuracy` is null for regression. */
    readonly validation: { readonly loss: number; readonly accuracy: number | null } | null;
    readonly cancelRequested: boolean;
}

interface Packed {
    readonly count: number;
    readonly width: number;
    readonly values: Float64Array;
}
interface ResolvedOptions {
    readonly epochs: number;
    readonly learningRate: number;
    readonly batchSize: number;
    readonly shuffle: boolean;
    readonly optimizer: ResolvedOptimizer | null;
}
/** Host → worker. `cancel` is a shared 4-byte flag; the worker reads it between batches. */
export interface WorkerJobMessage {
    readonly type: 'train';
    readonly protocol: 1;
    readonly jobId: number;
    readonly model: SerializedNeuralNet;
    readonly inputs: Packed;
    readonly labels: Packed;
    readonly validation: { readonly inputs: Packed; readonly labels: Packed } | null;
    readonly options: ResolvedOptions;
    readonly progressEvery: number;
    readonly cancel: SharedArrayBuffer;
}
export interface PreparedWorkerJob {
    readonly model: SerializedNeuralNet;
    readonly parametersBefore: string;
    readonly body: Omit<WorkerJobMessage, 'jobId' | 'cancel'>;
}

const invalid = (message: string): never => {
    throw new WorkerTrainingError('invalid-input', message);
};
function plain(value: unknown, what: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        invalid(`${what} must be a plain object.`);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) if (d.get || d.set) invalid(`${what} must not have accessors.`);
    return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: readonly string[], what: string): void {
    for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`Unknown ${what} field: ${key.slice(0, 64)}.`);
}
function int(value: unknown, min: number, max: number, what: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${what} must be an integer from ${min} to ${max}.`);
    return value as number;
}

/** Copies rows into one Float64Array after checking count, width and finiteness. */
function pack(rows: unknown, width: number, what: string, maxSamples: number): Packed {
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) invalid(`${what} must be an array of rows.`);
    const list = rows as unknown[];
    int(list.length, 1, maxSamples, `${what} row count`);
    const values = new Float64Array(list.length * width);
    for (let r = 0; r < list.length; r++) {
        const row = list[r];
        const ok = Array.isArray(row) || row instanceof Float64Array || row instanceof Float32Array;
        if (!ok || (row as ArrayLike<number>).length !== width) invalid(`${what} row ${r} must have ${width} values.`);
        if (Array.isArray(row)) {
            // Plain data only: no accessors, holes or subclassed arrays (host getters are never invoked).
            if (Object.getPrototypeOf(row) !== Array.prototype) invalid(`${what} row ${r} must be a plain array.`);
            for (let i = 0; i < width; i++) {
                const d = Object.getOwnPropertyDescriptor(row, i);
                if (!d || !('value' in d)) invalid(`${what} row ${r} must contain plain values.`);
            }
        }
        for (let i = 0; i < width; i++) {
            const v = (row as ArrayLike<number>)[i];
            if (typeof v !== 'number' || !Number.isFinite(v)) invalid(`${what} row ${r} contains a non-finite value.`);
            values[r * width + i] = v;
        }
    }
    return { count: list.length, width, values };
}
/** The same target rules NeuralNet.train applies, checked before any worker starts. */
function checkTargets(labels: Packed, task: string, what: string): void {
    if (task === 'regression') return;
    for (let r = 0; r < labels.count; r++) {
        let sum = 0;
        for (let i = 0; i < labels.width; i++) {
            const v = labels.values[r * labels.width + i];
            if (v < 0 || v > 1) invalid(`${what}: classification targets must be in [0, 1].`);
            sum += v;
        }
        if (task === 'multiclass' && Math.abs(sum - 1) > 1e-6) invalid(`${what}: multiclass targets must sum to 1.`);
    }
}
function resolveOptions(raw: unknown, defaultRate: number): ResolvedOptions {
    const o = plain(raw ?? {}, 'training options');
    if ('onEpoch' in o || 'signal' in o)
        invalid('onEpoch and signal cannot cross a worker boundary; use onProgress and signal on the request.');
    closed(o, ['epochs', 'learningRate', 'batchSize', 'shuffle', 'optimizer'], 'training option');
    const epochs = int(o.epochs ?? 100, 1, WORKER_TRAINING_LIMITS.maxEpochs, 'epochs');
    const batchSize = int(o.batchSize ?? 16, 1, 4096, 'batchSize');
    const learningRate = o.learningRate ?? defaultRate;
    if (typeof learningRate !== 'number' || !Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 10)
        invalid('learningRate must be in (0, 10].');
    if (o.shuffle !== undefined && typeof o.shuffle !== 'boolean') invalid('shuffle must be a boolean.');
    let optimizer: ResolvedOptimizer | null = null;
    if (o.optimizer !== undefined) {
        if (typeof o.optimizer === 'object') {
            const opt = plain(o.optimizer, 'optimizer');
            closed(opt, ['type', 'momentum', 'beta1', 'beta2', 'epsilon'], 'optimizer');
        }
        try {
            optimizer = resolveOptimizer(o.optimizer as OptimizerConfig);
        } catch (error) {
            invalid(error instanceof Error ? `optimizer: ${error.message}` : 'Invalid optimizer.');
        }
    }
    return { epochs, learningRate: learningRate as number, batchSize, shuffle: o.shuffle !== false, optimizer };
}

/** Validates and packs a training request on the host, before any worker is started. */
export function prepareWorkerJob(
    request: { readonly model: unknown; readonly inputs: unknown; readonly labels: unknown; readonly options?: unknown; readonly validation?: unknown; readonly progressEvery?: unknown },
    limits: { readonly maxSamples: number; readonly maxValues: number } = WORKER_TRAINING_LIMITS
): PreparedWorkerJob {
    let net: NeuralNet;
    try {
        net = NeuralNet.fromJSON(typeof request.model === 'string' ? request.model : JSON.stringify(request.model));
    } catch (error) {
        return invalid(`Invalid model: ${error instanceof Error ? error.message.slice(0, 120) : 'unreadable'}.`);
    }
    const model = net.toJSON();
    const inWidth = model.config.layers[0], outWidth = model.config.layers[model.config.layers.length - 1];
    const options = resolveOptions(request.options, model.config.learningRate);
    const inputs = pack(request.inputs, inWidth, 'inputs', limits.maxSamples);
    const labels = pack(request.labels, outWidth, 'labels', limits.maxSamples);
    if (inputs.count !== labels.count) invalid('inputs and labels must have the same number of rows.');
    checkTargets(labels, model.config.task, 'labels');
    let validation: WorkerJobMessage['validation'] = null;
    if (request.validation !== undefined) {
        const v = plain(request.validation, 'validation set');
        closed(v, ['inputs', 'labels'], 'validation');
        const vi = pack(v.inputs, inWidth, 'validation inputs', limits.maxSamples);
        const vl = pack(v.labels, outWidth, 'validation labels', limits.maxSamples);
        if (vi.count !== vl.count) invalid('validation inputs and labels must have the same number of rows.');
        checkTargets(vl, model.config.task, 'validation labels');
        validation = { inputs: vi, labels: vl };
    }
    const rows = inputs.count + (validation?.inputs.count ?? 0);
    const values = inputs.values.length + labels.values.length + (validation ? validation.inputs.values.length + validation.labels.values.length : 0);
    if (rows > limits.maxSamples) invalid(`At most ${limits.maxSamples} rows can be sent to a worker.`);
    if (values > limits.maxValues) invalid(`At most ${limits.maxValues} values can be sent to a worker.`);
    const parameters = model.parameters.reduce((n, l) => n + l.weights.length + l.biases.length, 0);
    if (options.epochs * inputs.count * parameters > WORKER_TRAINING_LIMITS.maxWork) invalid('Training work limit exceeded; split training into smaller calls.');
    const progressEvery = int(request.progressEvery ?? 1, 1, WORKER_TRAINING_LIMITS.maxEpochs, 'progressEvery');
    return {
        model,
        parametersBefore: JSON.stringify(model.parameters),
        body: { type: 'train', protocol: 1, model, inputs, labels, validation, options, progressEvery },
    };
}

/* ------------------------------------------------------------------ worker side */

function rowsOf(raw: unknown, width: number, what: string): Float64Array[] {
    const p = plain(raw, what);
    closed(p, ['count', 'width', 'values'], what);
    const count = int(p.count, 1, WORKER_TRAINING_LIMITS.maxSamples, `${what} count`);
    if (p.width !== width || !(p.values instanceof Float64Array) || p.values.length !== count * width) invalid(`${what} has the wrong shape.`);
    const values = p.values as Float64Array;
    for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) invalid(`${what} contains a non-finite value.`);
    return Array.from({ length: count }, (_, r) => values.subarray(r * width, (r + 1) * width));
}
function measure(net: NeuralNet, inputs: Float64Array[], labels: Float64Array[]): { loss: number; accuracy: number | null } {
    const outWidth = labels[0].length;
    let loss = 0, correct = 0;
    for (let r = 0; r < inputs.length; r++) {
        const p = net.predict(inputs[r]), y = labels[r];
        for (let i = 0; i < outWidth; i++) {
            if (net.task === 'regression') loss += (p[i] - y[i]) ** 2 / outWidth;
            else {
                loss -= y[i] * Math.log(Math.max(1e-15, p[i]));
                if (net.task === 'binary') loss -= (1 - y[i]) * Math.log(Math.max(1e-15, 1 - p[i]));
            }
        }
        if (net.task === 'binary') correct += Number((p[0] >= 0.5) === (y[0] >= 0.5));
        else if (net.task === 'multiclass') correct += Number(p.indexOf(Math.max(...p)) === Array.from(y).indexOf(Math.max(...y)));
    }
    return { loss: loss / inputs.length, accuracy: net.task === 'regression' ? null : correct / inputs.length };
}

/**
 * Runs one job inside the worker. The message is re-validated here (defence in depth): the model goes through
 * NeuralNet.fromJSON and every buffer is shape- and finiteness-checked. Training is the same NeuralNet.train call
 * the synchronous API makes, on a fresh candidate built from the serialized model.
 */
export function executeWorkerJob(raw: unknown, post: (message: unknown) => void): void {
    const m = plain(raw, 'job');
    closed(m, ['type', 'protocol', 'jobId', 'model', 'inputs', 'labels', 'validation', 'options', 'progressEvery', 'cancel'], 'job');
    if (m.type !== 'train' || m.protocol !== WORKER_TRAINING_PROTOCOL) invalid('Unsupported job message.');
    const jobId = int(m.jobId, 1, Number.MAX_SAFE_INTEGER, 'jobId');
    if (!(m.cancel instanceof SharedArrayBuffer) || m.cancel.byteLength !== 4) invalid('Missing cancellation flag.');
    const flag = new Int32Array(m.cancel as SharedArrayBuffer);
    const candidate = NeuralNet.fromJSON(m.model);
    const inWidth = candidate.layers[0], outWidth = candidate.layers[candidate.layers.length - 1];
    const inputs = rowsOf(m.inputs, inWidth, 'inputs'), labels = rowsOf(m.labels, outWidth, 'labels');
    if (inputs.length !== labels.length) invalid('inputs and labels must have the same number of rows.');
    let validation: { inputs: Float64Array[]; labels: Float64Array[] } | null = null;
    if (m.validation !== null) {
        const v = plain(m.validation, 'validation');
        closed(v, ['inputs', 'labels'], 'validation');
        validation = { inputs: rowsOf(v.inputs, inWidth, 'validation inputs'), labels: rowsOf(v.labels, outWidth, 'validation labels') };
    }
    const o = plain(m.options, 'options');
    closed(o, ['epochs', 'learningRate', 'batchSize', 'shuffle', 'optimizer'], 'options');
    const epochs = int(o.epochs, 1, WORKER_TRAINING_LIMITS.maxEpochs, 'epochs');
    const progressEvery = int(m.progressEvery, 1, WORKER_TRAINING_LIMITS.maxEpochs, 'progressEvery');
    if (typeof o.shuffle !== 'boolean' || typeof o.learningRate !== 'number') invalid('Invalid options.');
    const options = {
        epochs,
        learningRate: o.learningRate as number,
        batchSize: int(o.batchSize, 1, 4096, 'batchSize'),
        shuffle: o.shuffle as boolean,
        ...(o.optimizer !== null ? { optimizer: resolveOptimizer(o.optimizer as OptimizerConfig) } : {}),
    };
    const signal = {
        get aborted() {
            return Atomics.load(flag, 0) !== 0;
        },
    };
    const training: TrainingResult = candidate.train(inputs, labels, {
        ...options,
        signal,
        onEpoch(epoch, loss) {
            if (epoch % progressEvery !== 0 && epoch !== epochs) return;
            post({ type: 'progress', jobId, epoch, totalEpochs: epochs, loss, validation: validation ? measure(candidate, validation.inputs, validation.labels) : null });
        },
    });
    post({ type: 'done', jobId, model: candidate.toJSON(), training, cancelled: signal.aborted });
}

/* ------------------------------------------------------------------ host side */

export type WorkerMessage =
    | { readonly type: 'ready' }
    | { readonly type: 'progress'; readonly epoch: number; readonly totalEpochs: number; readonly loss: number; readonly validation: WorkerTrainingProgress['validation'] }
    | { readonly type: 'done'; readonly model: SerializedNeuralNet; readonly training: TrainingResult; readonly cancelled: boolean }
    | { readonly type: 'error'; readonly code: 'invalid-input' | 'training-failed'; readonly message: string };

const SAFE_TEXT = /^[\w\s.,:;()[\]'"/<>=+-]*$/;
/** Validates a worker message against the job it belongs to. Throws `protocol-error` on anything unexpected. */
export function parseWorkerMessage(raw: unknown, job: { readonly jobId: number; readonly model: SerializedNeuralNet; readonly epochs: number }): WorkerMessage {
    const bad = (why: string): never => {
        throw new WorkerTrainingError('protocol-error', `Malformed worker message: ${why}.`);
    };
    let m: Record<string, unknown>;
    try {
        m = plain(raw, 'message');
    } catch {
        return bad('not a plain object');
    }
    const keys = (allowed: string[]) => {
        if (Object.keys(m).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in m))) bad(`unexpected fields for ${String(m.type).slice(0, 32)}`);
    };
    if (m.type === 'ready') {
        keys(['type', 'protocol']);
        if (m.protocol !== WORKER_TRAINING_PROTOCOL) bad('protocol version');
        return { type: 'ready' };
    }
    if (m.jobId !== job.jobId) bad('job id');
    const finiteNonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (m.type === 'progress') {
        keys(['type', 'jobId', 'epoch', 'totalEpochs', 'loss', 'validation']);
        if (!Number.isSafeInteger(m.epoch) || (m.epoch as number) < 1 || (m.epoch as number) > job.epochs || m.totalEpochs !== job.epochs || !finiteNonNegative(m.loss))
            bad('progress values');
        let validation: WorkerTrainingProgress['validation'] = null;
        if (m.validation !== null) {
            let v: Record<string, unknown>;
            try {
                v = plain(m.validation, 'validation');
            } catch {
                return bad('validation metrics');
            }
            if (Object.keys(v).length !== 2 || !finiteNonNegative(v.loss) || !(v.accuracy === null || (finiteNonNegative(v.accuracy) && (v.accuracy as number) <= 1)))
                bad('validation metrics');
            validation = { loss: v.loss as number, accuracy: v.accuracy as number | null };
        }
        return { type: 'progress', epoch: m.epoch as number, totalEpochs: job.epochs, loss: m.loss as number, validation };
    }
    if (m.type === 'done') {
        keys(['type', 'jobId', 'model', 'training', 'cancelled']);
        if (typeof m.cancelled !== 'boolean') bad('cancelled flag');
        let model: SerializedNeuralNet;
        try {
            model = NeuralNet.fromJSON(m.model).toJSON();
        } catch {
            return bad('model');
        }
        const a = model.config, b = job.model.config;
        if (JSON.stringify([a.layers, a.task, a.seed, a.activation, a.negativeSlope, a.initialization]) !== JSON.stringify([b.layers, b.task, b.seed, b.activation, b.negativeSlope, b.initialization]))
            bad('model architecture changed');
        let t: Record<string, unknown>;
        try {
            t = plain(m.training, 'training');
        } catch {
            return bad('training result');
        }
        const losses = t.losses;
        if (
            Object.keys(t).length !== 3 ||
            !Array.isArray(losses) ||
            losses.length !== t.epochsCompleted ||
            losses.length > job.epochs ||
            losses.some((l) => !finiteNonNegative(l)) ||
            t.stopped !== losses.length < job.epochs ||
            (!m.cancelled && losses.length !== job.epochs)
        )
            bad('training result');
        return { type: 'done', model, training: { losses: [...(losses as number[])], epochsCompleted: (losses as number[]).length, stopped: t.stopped as boolean }, cancelled: m.cancelled as boolean };
    }
    if (m.type === 'error') {
        keys(['type', 'jobId', 'code', 'message']);
        if (m.code !== 'invalid-input' && m.code !== 'training-failed') bad('error code');
        const text = typeof m.message === 'string' && m.message.length <= WORKER_TRAINING_LIMITS.maxErrorMessageLength && SAFE_TEXT.test(m.message) ? m.message : 'Training failed in the worker.';
        return { type: 'error', code: m.code as 'invalid-input' | 'training-failed', message: text };
    }
    return bad('unknown type');
}
