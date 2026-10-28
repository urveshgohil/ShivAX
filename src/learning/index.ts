import type { BotSignal, BotValue } from '../agents/types.js';
import { snapshotValue, record, identifier } from '../agents/validation.js';
import { NeuralNet, type TrainOptions, type SerializedNeuralNet } from '../nn/NeuralNet.js';
import type { BotToolClient } from '../security/types.js';
import { object, id, value } from '../bots/schema.js';

export const EVALUATION_DOMAINS = Object.freeze([
    'routing',
    'reasoning',
    'code',
    'visual',
    'permission',
    'memory',
] as const);
export type EvaluationDomain = (typeof EVALUATION_DOMAINS)[number];
export const learningFeedbackSchema = object(
    {
        version: { enum: [1] },
        id,
        taskId: id,
        botId: id,
        domain: { enum: EVALUATION_DOMAINS },
        input: value,
        output: value,
        decision: { enum: ['accept', 'reject', 'correct'] },
        correction: value,
    },
    ['version', 'id', 'taskId', 'botId', 'domain', 'input', 'output', 'decision']
);
export interface FeedbackRecord {
    readonly version: 1;
    readonly id: string;
    readonly taskId: string;
    readonly botId: string;
    readonly domain: EvaluationDomain;
    readonly input: BotValue;
    readonly output: BotValue;
    readonly decision: 'accept' | 'reject' | 'correct';
    readonly correction?: BotValue;
}
export function validateFeedback(raw: unknown): FeedbackRecord {
    const safe = snapshotValue(raw, 65536, 'invalid-input');
    const v = record(
        safe,
        ['version', 'id', 'taskId', 'botId', 'domain', 'input', 'output', 'decision', 'correction'],
        'invalid-input'
    );
    for (const key of ['id', 'taskId', 'botId']) identifier(v[key], 'invalid-input');
    if (
        v.version !== 1 ||
        !EVALUATION_DOMAINS.includes(v.domain as EvaluationDomain) ||
        !['accept', 'reject', 'correct'].includes(v.decision as string) ||
        !('input' in v) ||
        !('output' in v) ||
        (v.decision === 'correct') !== 'correction' in v
    )
        throw new Error('Invalid feedback.');
    return safe as unknown as FeedbackRecord;
}
/** Uses Chitragupt's existing protected record service. Host verification and Vijay approval remain mandatory. */
export async function storeLearningFeedback(tools: BotToolClient, raw: unknown): Promise<BotValue> {
    const feedback = validateFeedback(raw);
    return tools.execute('shivax.memory.records.save', {
        id: feedback.id,
        category: 'verified-outcome',
        value: feedback as unknown as BotValue,
        tags: ['learning-feedback'],
    });
}
export interface EvaluationCase {
    readonly id: string;
    readonly domain: EvaluationDomain;
    readonly input: BotValue;
    readonly expected: BotValue;
}
export interface EvaluationObservation {
    readonly completed: boolean;
    readonly valid: boolean;
    readonly actual: BotValue;
    readonly modelCalls: number;
    readonly modelTokens: number;
}
export interface EvaluationRecord {
    readonly version: 1;
    readonly dataset: readonly EvaluationCase[];
    readonly outcomes: readonly {
        readonly id: string;
        readonly passed: boolean;
        readonly latencyMs: number;
    }[];
    readonly completionRate: number;
    readonly accuracy: number;
    readonly routingAccuracy: number | null;
    readonly invalidOutputRate: number;
    readonly falsePositives: number;
    readonly falseNegatives: number;
    readonly securityPassRate: number | null;
    readonly modelCalls: number;
    readonly modelTokens: number;
    readonly usageComplete: boolean;
}
export function validateEvaluationDataset(raw: unknown): readonly EvaluationCase[] {
    const safe = snapshotValue(raw, 1_048_576, 'invalid-input');
    if (!Array.isArray(safe) || !safe.length || safe.length > 256)
        throw new Error('Invalid evaluation dataset.');
    const ids = new Set();
    for (const item of safe) {
        const v = record(item, ['id', 'domain', 'input', 'expected'], 'invalid-input');
        identifier(v.id, 'invalid-input');
        if (
            ids.has(v.id) ||
            !EVALUATION_DOMAINS.includes(v.domain as EvaluationDomain) ||
            !('input' in v) ||
            !('expected' in v)
        )
            throw new Error('Invalid evaluation case.');
        ids.add(v.id);
    }
    return safe as unknown as readonly EvaluationCase[];
}
function canonical(value: BotValue): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object')
        return (
            '{' +
            Object.keys(value)
                .sort()
                .map(
                    (k) =>
                        JSON.stringify(k) + ':' + canonical((value as Record<string, BotValue>)[k])
                )
                .join(',') +
            '}'
        );
    return JSON.stringify(value);
}
export async function evaluateDataset(
    raw: unknown,
    run: (
        input: BotValue,
        domain: EvaluationDomain,
        signal: BotSignal
    ) => Promise<EvaluationObservation>,
    signal: BotSignal,
    timeoutMs = 30_000
): Promise<EvaluationRecord> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
        throw new Error('Invalid evaluation timeout.');
    const controller = new AbortController(),
        started = performance.now();
    const cancel = () => controller.abort(new Error('Evaluation cancelled.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('Evaluation timeout.')), timeoutMs);
    const checkpoint = () => {
        signal.throwIfAborted();
        if (performance.now() - started >= timeoutMs)
            controller.abort(new Error('Evaluation timeout.'));
        controller.signal.throwIfAborted();
    };
    const aborted = new Promise<never>((_, reject) => {
        const abort = () => reject(new Error('Evaluation stopped.'));
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
    });
    void aborted.catch(() => {});
    try {
        const dataset = validateEvaluationDataset(raw),
            outcomes = [];
        let complete = 0,
            invalid = 0,
            passed = 0,
            routing = 0,
            routed = 0,
            security = 0,
            secured = 0,
            fp = 0,
            fn = 0,
            calls = 0,
            tokens = 0;
        for (const item of dataset) {
            checkpoint();
            const start = performance.now();
            let rawResult: unknown;
            try {
                rawResult = await Promise.race([
                    Promise.resolve().then(() => {
                        checkpoint();
                        return run(item.input, item.domain, controller.signal);
                    }),
                    aborted,
                ]);
            } catch {
                checkpoint();
                rawResult = null;
            }
            checkpoint();
            let result: EvaluationObservation | undefined;
            try {
                const safe = snapshotValue(rawResult, 65536, 'invalid-output');
                const v = record(
                    safe,
                    ['completed', 'valid', 'actual', 'modelCalls', 'modelTokens'],
                    'invalid-output'
                );
                if (
                    typeof v.completed !== 'boolean' ||
                    typeof v.valid !== 'boolean' ||
                    !('actual' in v) ||
                    !Number.isSafeInteger(v.modelCalls) ||
                    (v.modelCalls as number) < 0 ||
                    (v.modelCalls as number) > 1_000_000 ||
                    !Number.isSafeInteger(v.modelTokens) ||
                    (v.modelTokens as number) < 0 ||
                    (v.modelTokens as number) > 100_000_000
                )
                    throw new Error();
                result = safe as unknown as EvaluationObservation;
            } catch {
                /* Invalid observations count as failed outputs, never successful evaluations. */
            }
            const ok =
                !!result?.completed &&
                result.valid &&
                canonical(result.actual) === canonical(item.expected);
            if (result?.completed) complete++;
            if (!result?.valid) invalid++;
            if (ok) passed++;
            if (item.domain === 'routing') {
                routing++;
                if (ok) routed++;
            }
            if (item.domain === 'permission') {
                security++;
                if (ok) secured++;
            }
            if (typeof item.expected === 'boolean' && typeof result?.actual === 'boolean') {
                if (result.actual && !item.expected) fp++;
                if (!result.actual && item.expected) fn++;
            }
            calls += result?.modelCalls ?? 0;
            tokens += result?.modelTokens ?? 0;
            outcomes.push({
                id: item.id,
                passed: ok,
                latencyMs: Math.max(0, performance.now() - start),
            });
        }
        return snapshotValue(
            {
                version: 1,
                dataset,
                outcomes,
                completionRate: complete / dataset.length,
                accuracy: passed / dataset.length,
                routingAccuracy: routing ? routed / routing : null,
                invalidOutputRate: invalid / dataset.length,
                falsePositives: fp,
                falseNegatives: fn,
                securityPassRate: security ? secured / security : null,
                modelCalls: calls,
                modelTokens: tokens,
                usageComplete: invalid === 0,
            },
            1_048_576,
            'invalid-output'
        ) as unknown as EvaluationRecord;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}

/** Validates imported report shape; imported reports never authorize model activation. */
export function validateEvaluationRecord(raw: unknown): EvaluationRecord {
    const safe = snapshotValue(raw, 1_048_576, 'invalid-input');
    const v = record(
        safe,
        [
            'version',
            'dataset',
            'outcomes',
            'completionRate',
            'accuracy',
            'routingAccuracy',
            'invalidOutputRate',
            'falsePositives',
            'falseNegatives',
            'securityPassRate',
            'modelCalls',
            'modelTokens',
            'usageComplete',
        ],
        'invalid-input'
    );
    const cases = validateEvaluationDataset(v.dataset);
    if (
        v.version !== 1 ||
        typeof v.usageComplete !== 'boolean' ||
        !Array.isArray(v.outcomes) ||
        v.outcomes.length !== cases.length
    )
        throw new Error('Invalid evaluation report.');
    for (const key of [
        'completionRate',
        'accuracy',
        'invalidOutputRate',
        'routingAccuracy',
        'securityPassRate',
    ]) {
        if ((key === 'routingAccuracy' || key === 'securityPassRate') && v[key] === null) continue;
        if (typeof v[key] !== 'number' || v[key] < 0 || v[key] > 1)
            throw new Error('Invalid evaluation rate.');
    }
    for (const key of ['falsePositives', 'falseNegatives', 'modelCalls', 'modelTokens'])
        if (!Number.isSafeInteger(v[key]) || (v[key] as number) < 0)
            throw new Error('Invalid evaluation count.');
    let passed = 0,
        routing = 0,
        routed = 0,
        security = 0,
        secured = 0,
        possibleFalsePositives = 0,
        possibleFalseNegatives = 0;
    v.outcomes.forEach((raw, i) => {
        const o = record(raw, ['id', 'passed', 'latencyMs'], 'invalid-input');
        if (
            o.id !== cases[i].id ||
            typeof o.passed !== 'boolean' ||
            typeof o.latencyMs !== 'number' ||
            o.latencyMs < 0
        )
            throw new Error('Invalid evaluation outcome.');
        if (o.passed) passed++;
        if (cases[i].domain === 'routing') {
            routing++;
            if (o.passed) routed++;
        }
        if (cases[i].domain === 'permission') {
            security++;
            if (o.passed) secured++;
        }
        if (!o.passed && cases[i].expected === false) possibleFalsePositives++;
        if (!o.passed && cases[i].expected === true) possibleFalseNegatives++;
    });
    if (v.accuracy !== passed / cases.length) throw new Error('Inconsistent evaluation accuracy.');
    if (
        v.routingAccuracy !== (routing ? routed / routing : null) ||
        v.securityPassRate !== (security ? secured / security : null)
    )
        throw new Error('Inconsistent domain evaluation accuracy.');
    if (
        (v.falsePositives as number) > possibleFalsePositives ||
        (v.falseNegatives as number) > possibleFalseNegatives ||
        (v.completionRate as number) < passed / cases.length ||
        (v.invalidOutputRate as number) > (cases.length - passed) / cases.length
    )
        throw new Error('Inconsistent evaluation counts.');
    return safe as unknown as EvaluationRecord;
}
/** Host curator must explicitly select records; acceptance alone is not training consent. */
export function exportTrainingData(
    records: readonly FeedbackRecord[],
    approve: (record: FeedbackRecord) => boolean
): BotValue {
    if (!Array.isArray(records) || records.length > 256)
        throw new Error('Invalid training export.');
    const rows = records
        .map(validateFeedback)
        .filter((r) => r.decision !== 'reject' && approve(r) === true)
        .map((r) => ({
            feedbackId: r.id,
            domain: r.domain,
            input: r.input,
            expected: r.decision === 'correct' ? r.correction! : r.output,
        }));
    if (new Set(rows.map((r) => r.feedbackId)).size !== rows.length)
        throw new Error('Duplicate training feedback.');
    return snapshotValue(
        { format: 'shivax-curated-training', version: 1, trust: 'untrusted', rows },
        1_048_576,
        'invalid-input'
    );
}
/** Explicit CPU training on an isolated candidate. Never mutates the supplied active model. */
export function trainOfflineCandidate(
    model: SerializedNeuralNet,
    inputs: readonly number[][],
    labels: readonly number[][],
    options: TrainOptions = {}
) {
    const rows = snapshotValue({ inputs, labels }, 1_048_576, 'invalid-input') as unknown as {
        inputs: number[][];
        labels: number[][];
    };
    if (!inputs.length || inputs.length > 4096 || inputs.length !== labels.length)
        throw new Error('Invalid numeric training dataset.');
    const candidate = NeuralNet.fromJSON(JSON.stringify(model));
    const before = JSON.stringify(candidate.toJSON().parameters);
    const training = candidate.train(rows.inputs, rows.labels, options),
        trained = candidate.toJSON();
    return {
        model: trained,
        training,
        weightsUpdated: JSON.stringify(trained.parameters) !== before,
    };
}
