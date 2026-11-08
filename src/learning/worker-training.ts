import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { BotSignal } from '../agents/types.js';
import type { SerializedNeuralNet, TrainingResult } from '../nn/NeuralNet.js';
import { validateTrainingExport, type CuratedTrainingRow } from './training.js';
import {
    WORKER_TRAINING_LIMITS,
    WorkerTrainingError,
    parseWorkerMessage,
    prepareWorkerJob,
    type PreparedWorkerJob,
    type WorkerTermination,
    type WorkerTrainOptions,
    type WorkerTrainingErrorCode,
    type WorkerTrainingProgress,
    type WorkerValidationSet,
} from './worker-protocol.js';

/*
 * SARASWATI S03: Node-only asynchronous training (`shivax/learning/node`).
 * Each job runs in its own worker_threads Worker built from a validated, serialized candidate.
 * The active model is never shared with a worker, and the synchronous APIs are unchanged.
 */

export interface WorkerTrainingPoolOptions {
    /** Simultaneous workers. Default 1, maximum 16. Keep it at or below the host's CPU count. */
    readonly concurrency?: number;
    /** Jobs waiting for a free slot. Default 16, maximum 256. Extra requests are rejected with `queue-full`. */
    readonly maxQueued?: number;
    /** Default per-job deadline (ms). Default 600 000, maximum 3 600 000. */
    readonly timeoutMs?: number;
    /** Time allowed for a worker to start and report ready. Default 10 000, maximum 60 000. */
    readonly startupTimeoutMs?: number;
    /** After cancellation, how long the worker may take to stop on its own before it is terminated. Default 1 000. */
    readonly terminateGraceMs?: number;
    /** V8 heap limits for each worker. Exceeding them fails the job with `resource-limit`. Default old generation 512 MB. */
    readonly resourceLimits?: { readonly maxOldGenerationSizeMb?: number; readonly maxYoungGenerationSizeMb?: number; readonly stackSizeMb?: number };
    /** Lower data limits than WORKER_TRAINING_LIMITS. */
    readonly maxSamples?: number;
    readonly maxValues?: number;
    /**
     * Trusted host override for the worker script: a `file:` URL string or URL object. Defaults to the packaged
     * worker. Typed structurally so consumers without DOM or Node typings can still compile.
     */
    readonly workerURL?: string | { readonly href: string };
}
export interface WorkerTrainingRequest {
    /** Serialized model (object or JSON text). It is validated and cloned; the caller's model is never touched. */
    readonly model: SerializedNeuralNet | string;
    readonly inputs: readonly ArrayLike<number>[];
    readonly labels: readonly ArrayLike<number>[];
    readonly options?: WorkerTrainOptions;
    /** Optional held-out rows. Metrics are measured in the worker and reported with progress; never trained on. */
    readonly validation?: WorkerValidationSet;
    /** Report every N epochs (the last epoch is always reported). Default 1. */
    readonly progressEvery?: number;
    readonly signal?: BotSignal;
    /** Called for each progress message the worker actually sent. Exceptions are ignored. */
    readonly onProgress?: (progress: WorkerTrainingProgress) => void;
    /** Overrides the pool's job deadline. */
    readonly timeoutMs?: number;
}
export interface WorkerTrainingResult {
    readonly model: SerializedNeuralNet;
    readonly training: TrainingResult;
    readonly weightsUpdated: boolean;
    /** Measured on the host. `startupMs`: spawn to ready. `trainingMs`: job sent to result received. */
    readonly metrics: { readonly startupMs: number; readonly trainingMs: number; readonly totalMs: number; readonly progressEvents: number };
}
export interface WorkerTrainingPoolStats {
    readonly running: number;
    readonly queued: number;
    /** Workers whose `exit` has not been observed yet. */
    readonly liveWorkers: number;
    readonly started: number;
    readonly closed: boolean;
}

const DEFAULT_WORKER_URL = new URL('./learning-worker.mjs', import.meta.url);
type Outcome = { ok: true; value: WorkerTrainingResult } | { ok: false; error: WorkerTrainingError };
interface Job {
    readonly id: number;
    readonly prepared: PreparedWorkerJob;
    readonly signal?: BotSignal;
    readonly onProgress?: (progress: WorkerTrainingProgress) => void;
    readonly timeoutMs: number;
    readonly resolve: (value: WorkerTrainingResult) => void;
    readonly reject: (error: WorkerTrainingError) => void;
}

function bounded(value: unknown, fallback: number, min: number, max: number, what: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
        throw new WorkerTrainingError('invalid-input', `${what} must be an integer from ${min} to ${max}.`);
    return value as number;
}

/** Bounded pool of single-use training workers. Call `close()` on host shutdown. */
export class WorkerTrainingPool {
    readonly #concurrency: number;
    readonly #maxQueued: number;
    readonly #timeoutMs: number;
    readonly #startupTimeoutMs: number;
    readonly #graceMs: number;
    readonly #limits: { maxSamples: number; maxValues: number };
    readonly #resourceLimits: ResourceLimits;
    readonly #url: URL;
    readonly #queue: Job[] = [];
    readonly #running = new Map<number, { cancel: (code: WorkerTrainingErrorCode) => void; done: Promise<void> }>();
    readonly #live = new Set<Worker>();
    #nextId = 1;
    #started = 0;
    #closed = false;

    constructor(options: WorkerTrainingPoolOptions = {}) {
        const L = WORKER_TRAINING_LIMITS;
        const o = options ?? {};
        this.#concurrency = bounded(o.concurrency, 1, 1, L.maxConcurrency, 'concurrency');
        this.#maxQueued = bounded(o.maxQueued, 16, 0, L.maxQueued, 'maxQueued');
        this.#timeoutMs = bounded(o.timeoutMs, L.defaultTimeoutMs, 1, L.maxTimeoutMs, 'timeoutMs');
        this.#startupTimeoutMs = bounded(o.startupTimeoutMs, L.defaultStartupTimeoutMs, 1, L.maxStartupTimeoutMs, 'startupTimeoutMs');
        this.#graceMs = bounded(o.terminateGraceMs, L.defaultGraceMs, 0, L.maxGraceMs, 'terminateGraceMs');
        this.#limits = {
            maxSamples: bounded(o.maxSamples, L.maxSamples, 1, L.maxSamples, 'maxSamples'),
            maxValues: bounded(o.maxValues, L.maxValues, 1, L.maxValues, 'maxValues'),
        };
        const r = o.resourceLimits ?? {};
        this.#resourceLimits = {
            maxOldGenerationSizeMb: bounded(r.maxOldGenerationSizeMb, L.defaultMaxOldGenerationMb, 16, 16_384, 'maxOldGenerationSizeMb'),
            ...(r.maxYoungGenerationSizeMb !== undefined ? { maxYoungGenerationSizeMb: bounded(r.maxYoungGenerationSizeMb, 0, 1, 1_024, 'maxYoungGenerationSizeMb') } : {}),
            stackSizeMb: bounded(r.stackSizeMb, 4, 1, 64, 'stackSizeMb'),
        };
        let url = DEFAULT_WORKER_URL;
        if (o.workerURL !== undefined) {
            const href = typeof o.workerURL === 'string' ? o.workerURL : typeof o.workerURL?.href === 'string' ? o.workerURL.href : undefined;
            try {
                url = new URL(href ?? 'invalid:');
            } catch {
                url = new URL('invalid:');
            }
            if (url.protocol !== 'file:') throw new WorkerTrainingError('invalid-input', 'workerURL must be a file: URL.');
        }
        this.#url = url;
    }

    get stats(): WorkerTrainingPoolStats {
        return Object.freeze({ running: this.#running.size, queued: this.#queue.length, liveWorkers: this.#live.size, started: this.#started, closed: this.#closed });
    }

    /** Validates the request on the host, then trains a candidate in a worker. Rejects with WorkerTrainingError. */
    train(request: WorkerTrainingRequest): Promise<WorkerTrainingResult> {
        try {
            if (this.#closed) throw new WorkerTrainingError('pool-closed', 'The training pool is closed.');
            if (!request || typeof request !== 'object') throw new WorkerTrainingError('invalid-input', 'A training request is required.');
            if (request.onProgress !== undefined && typeof request.onProgress !== 'function')
                throw new WorkerTrainingError('invalid-input', 'onProgress must be a function.');
            if (request.signal !== undefined && (typeof request.signal?.addEventListener !== 'function' || typeof request.signal.aborted !== 'boolean'))
                throw new WorkerTrainingError('invalid-input', 'signal must be an AbortSignal.');
            const timeoutMs = bounded(request.timeoutMs, this.#timeoutMs, 1, WORKER_TRAINING_LIMITS.maxTimeoutMs, 'timeoutMs');
            const prepared = prepareWorkerJob(request, this.#limits);
            if (request.signal?.aborted) throw new WorkerTrainingError('cancelled', 'Training was cancelled before it started.');
            if (this.#running.size >= this.#concurrency && this.#queue.length >= this.#maxQueued)
                throw new WorkerTrainingError('queue-full', 'The training queue is full.');
            return new Promise<WorkerTrainingResult>((resolve, reject) => {
                const job: Job = { id: this.#nextId++, prepared, signal: request.signal, onProgress: request.onProgress, timeoutMs, resolve, reject };
                this.#queue.push(job);
                if (job.signal) {
                    // A queued job that is cancelled leaves the queue without ever starting a worker.
                    const dequeue = () => {
                        const i = this.#queue.indexOf(job);
                        if (i >= 0) {
                            this.#queue.splice(i, 1);
                            reject(new WorkerTrainingError('cancelled', 'Training was cancelled while queued.'));
                        }
                    };
                    job.signal.addEventListener('abort', dequeue, { once: true });
                }
                this.#pump();
            });
        } catch (error) {
            return Promise.reject(error instanceof WorkerTrainingError ? error : new WorkerTrainingError('invalid-input', 'Invalid training request.'));
        }
    }

    /** Host shutdown: rejects queued jobs, cancels running ones and resolves once every worker has exited. */
    async close(): Promise<void> {
        this.#closed = true;
        for (const job of this.#queue.splice(0)) job.reject(new WorkerTrainingError('pool-closed', 'The training pool was closed.'));
        const running = [...this.#running.values()];
        for (const r of running) r.cancel('pool-closed');
        await Promise.all(running.map((r) => r.done));
    }

    #pump(): void {
        while (!this.#closed && this.#running.size < this.#concurrency && this.#queue.length) this.#start(this.#queue.shift()!);
    }

    #start(job: Job): void {
        const begin = performance.now();
        let worker: Worker | undefined;
        let settled = false, ready = false, readyAt = 0, sentAt = 0, lastEpoch = 0, progressEvents = 0;
        let cancelCode: WorkerTrainingErrorCode | null = null, forced = false;
        const cancelFlag = new Int32Array(new SharedArrayBuffer(4));
        const timers: ReturnType<typeof setTimeout>[] = [];
        let finishDone!: () => void;
        const done = new Promise<void>((r) => (finishDone = r));
        const exited = new Promise<void>((r) => {
            this.#started++;
            try {
                worker = new Worker(this.#url, { resourceLimits: this.#resourceLimits });
            } catch {
                worker = undefined;
                r();
                return;
            }
            this.#live.add(worker);
            const w = worker;
            w.once('exit', (code) => {
                this.#live.delete(w);
                r();
                if (!settled) {
                    if (cancelCode) finish({ ok: false, error: new WorkerTrainingError(cancelCode, undefined, forced ? 'forced' : 'cooperative') });
                    else if (!ready) finish({ ok: false, error: new WorkerTrainingError('startup-failed', 'The training worker exited before it was ready.') });
                    else finish({ ok: false, error: new WorkerTrainingError('worker-crashed', `The training worker exited unexpectedly (code ${code}).`) });
                }
            });
        });

        const finish = (outcome: Outcome) => {
            if (settled) return; // Duplicate completion, late messages and exit after a result are ignored.
            settled = true;
            timers.forEach(clearTimeout);
            job.signal?.removeEventListener('abort', onAbort);
            Atomics.store(cancelFlag, 0, 1);
            const terminate = worker ? worker.terminate().then(() => undefined, () => undefined) : Promise.resolve();
            // Settle only after the worker has really exited, so no job outlives its worker.
            void Promise.all([terminate, exited]).then(() => {
                this.#running.delete(job.id);
                if (outcome.ok) job.resolve(outcome.value);
                else job.reject(outcome.error);
                finishDone();
                this.#pump();
            });
        };
        const fail = (code: WorkerTrainingErrorCode, message?: string, termination: WorkerTermination | null = null) =>
            finish({ ok: false, error: new WorkerTrainingError(code, message, termination) });
        const cancel = (code: WorkerTrainingErrorCode) => {
            if (settled || cancelCode) return;
            cancelCode = code;
            Atomics.store(cancelFlag, 0, 1);
            if (!ready) {
                forced = true;
                fail(code, undefined, 'forced');
                return;
            }
            timers.push(setTimeout(() => {
                forced = true;
                fail(code, undefined, 'forced');
            }, this.#graceMs));
        };
        const onAbort = () => cancel('cancelled');

        this.#running.set(job.id, { cancel, done });
        if (!worker) {
            fail('startup-failed', 'The training worker could not be created.');
            return;
        }
        const w = worker as Worker;
        job.signal?.addEventListener('abort', onAbort, { once: true });
        if (job.signal?.aborted) onAbort();
        timers.push(setTimeout(() => {
            if (!ready) fail('startup-failed', 'The training worker did not start in time.', 'forced');
        }, this.#startupTimeoutMs));
        timers.push(setTimeout(() => cancel('timeout'), job.timeoutMs));

        const meta = { jobId: job.id, model: job.prepared.model, epochs: job.prepared.body.options.epochs };
        w.on('error', (error) => {
            const code = (error as { code?: unknown }).code;
            if (code === 'ERR_WORKER_OUT_OF_MEMORY') fail('resource-limit', 'The training worker exceeded its memory limit.', 'forced');
            else if (!ready) fail('startup-failed', 'The training worker failed to start.');
            else fail('worker-crashed', 'The training worker crashed.');
        });
        w.on('messageerror', () => fail('protocol-error', 'A worker message could not be deserialized.'));
        w.on('message', (raw) => {
            if (settled) return;
            let message;
            try {
                message = parseWorkerMessage(raw, meta);
            } catch (error) {
                fail('protocol-error', error instanceof Error ? error.message : undefined);
                return;
            }
            if (message.type === 'ready') {
                if (ready) return fail('protocol-error', 'The worker reported ready twice.');
                ready = true;
                readyAt = performance.now();
                if (cancelCode) return;
                const { inputs, labels, validation } = job.prepared.body;
                const transfer = [inputs.values.buffer, labels.values.buffer, ...(validation ? [validation.inputs.values.buffer, validation.labels.values.buffer] : [])] as ArrayBuffer[];
                sentAt = performance.now();
                w.postMessage({ ...job.prepared.body, jobId: job.id, cancel: cancelFlag.buffer }, transfer);
                return;
            }
            if (!ready) return fail('protocol-error', 'The worker sent a job message before it was ready.');
            if (message.type === 'progress') {
                // Progress must move forward; replayed or fabricated epochs are a protocol violation.
                if (message.epoch <= lastEpoch) return fail('protocol-error', 'The worker repeated a progress epoch.');
                lastEpoch = message.epoch;
                progressEvents++;
                try {
                    job.onProgress?.(Object.freeze({ status: cancelCode ? 'cancelling' : 'training', epoch: message.epoch, totalEpochs: message.totalEpochs, loss: message.loss, validation: message.validation ? Object.freeze({ ...message.validation }) : null, cancelRequested: cancelCode !== null }));
                } catch {
                    /* Host callback errors never affect the job. */
                }
                return;
            }
            if (message.type === 'error') return fail(message.code, message.message);
            // done
            if (cancelCode || message.cancelled) return fail(cancelCode ?? 'cancelled', undefined, 'cooperative');
            if (message.training.epochsCompleted > 0 && lastEpoch !== message.training.epochsCompleted)
                return fail('protocol-error', 'The final epoch was not reported as progress.');
            const end = performance.now();
            finish({
                ok: true,
                value: Object.freeze({
                    model: message.model,
                    training: message.training,
                    weightsUpdated: JSON.stringify(message.model.parameters) !== job.prepared.parametersBefore,
                    metrics: Object.freeze({ startupMs: readyAt - begin, trainingMs: end - sentAt, totalMs: end - begin, progressEvents }),
                }),
            });
        });
    }
}

export interface WorkerTrainingCallOptions extends WorkerTrainOptions, Omit<WorkerTrainingPoolOptions, 'concurrency' | 'maxQueued'> {
    readonly signal?: BotSignal;
    readonly onProgress?: (progress: WorkerTrainingProgress) => void;
    readonly validation?: WorkerValidationSet;
    readonly progressEvery?: number;
}
function split(options: WorkerTrainingCallOptions) {
    const { epochs, learningRate, batchSize, shuffle, optimizer, signal, onProgress, validation, progressEvery, ...pool } = options ?? {};
    const train: Record<string, unknown> = { epochs, learningRate, batchSize, shuffle, optimizer };
    for (const key of Object.keys(train)) if (train[key] === undefined) delete train[key];
    if ('onEpoch' in (options ?? {})) throw new WorkerTrainingError('invalid-input', 'onEpoch cannot cross a worker boundary; use onProgress.');
    return { train: train as WorkerTrainOptions, controls: { signal, onProgress, validation, progressEvery }, pool };
}
async function once(model: unknown, inputs: unknown, labels: unknown, options: WorkerTrainingCallOptions): Promise<WorkerTrainingResult> {
    const { train, controls, pool } = split(options);
    const runner = new WorkerTrainingPool({ ...pool, concurrency: 1, maxQueued: 0 });
    try {
        return await runner.train({
            model: model as SerializedNeuralNet,
            inputs: inputs as ArrayLike<number>[],
            labels: labels as ArrayLike<number>[],
            options: train,
            ...(controls.validation !== undefined ? { validation: controls.validation } : {}),
            ...(controls.progressEvery !== undefined ? { progressEvery: controls.progressEvery } : {}),
            ...(controls.signal !== undefined ? { signal: controls.signal } : {}),
            ...(controls.onProgress !== undefined ? { onProgress: controls.onProgress } : {}),
        });
    } finally {
        await runner.close();
    }
}

/**
 * Asynchronous counterpart of `trainOfflineCandidate`: same model format, options and arithmetic, run in a
 * dedicated worker. The supplied model is only read; the result is a new candidate.
 */
export function trainOfflineCandidateInWorker(
    model: SerializedNeuralNet,
    inputs: readonly number[][],
    labels: readonly number[][],
    options: WorkerTrainingCallOptions = {}
): Promise<WorkerTrainingResult> {
    try {
        return once(model, inputs, labels, options);
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * Asynchronous counterpart of `trainCuratedCandidate`. Applies the same checks before any worker starts:
 * non-empty v1 exports, no shared feedback ids or inputs between the splits, numeric rows matching the model,
 * and classification targets valid in both splits. Held-out rows are returned, never trained on.
 */
export async function trainCuratedCandidateInWorker(
    model: SerializedNeuralNet,
    training: unknown,
    heldOut: unknown,
    options: WorkerTrainingCallOptions = {}
): Promise<WorkerTrainingResult & { readonly heldOut: readonly CuratedTrainingRow[] }> {
    let train: readonly CuratedTrainingRow[], test: readonly CuratedTrainingRow[];
    try {
        train = validateTrainingExport(training);
        test = validateTrainingExport(heldOut);
    } catch {
        throw new WorkerTrainingError('invalid-input', 'Invalid training export.');
    }
    if (!train.length || !test.length) throw new WorkerTrainingError('invalid-input', 'Training and held-out data are required.');
    const key = (value: unknown) => JSON.stringify(value);
    const ids = new Set(train.map((r) => r.feedbackId)), inputs = new Set(train.map((r) => key(r.input)));
    if (test.some((r) => ids.has(r.feedbackId) || inputs.has(key(r.input)))) throw new WorkerTrainingError('invalid-input', 'Held-out overlap.');
    const layers = model?.config?.layers;
    if (!Array.isArray(layers) || layers.length < 2) throw new WorkerTrainingError('invalid-input', 'Invalid model.');
    for (const row of [...train, ...test]) {
        if (
            !Array.isArray(row.input) ||
            !Array.isArray(row.expected) ||
            row.input.length !== layers[0] ||
            row.expected.length !== layers[layers.length - 1] ||
            [...row.input, ...row.expected].some((v) => typeof v !== 'number' || !Number.isFinite(v))
        )
            throw new WorkerTrainingError('invalid-input', 'Dataset is incompatible with numeric training.');
        const values = row.expected as number[];
        if (model.config.task !== 'regression' && values.some((v) => v < 0 || v > 1))
            throw new WorkerTrainingError('invalid-input', 'Classification targets must be in [0, 1].');
        if (model.config.task === 'multiclass' && Math.abs(values.reduce((s, v) => s + v, 0) - 1) > 1e-6)
            throw new WorkerTrainingError('invalid-input', 'Multiclass targets must sum to 1.');
    }
    const result = await once(model, train.map((r) => r.input as number[]), train.map((r) => r.expected as number[]), options);
    return Object.freeze({ ...result, heldOut: test });
}
