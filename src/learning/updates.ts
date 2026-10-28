import type { BotSignal, BotValue } from '../agents/types.js';
import { snapshotValue } from '../agents/validation.js';
import {
    evaluateDataset,
    validateEvaluationDataset,
    type EvaluationDomain,
    type EvaluationObservation,
    type EvaluationRecord,
} from './index.js';
export interface ModelConfigurationVersion {
    readonly model: BotValue;
    readonly configuration: BotValue;
}
/** Host-only, immutable snapshots. Evidence is generated here, never accepted from callers. */
export class EvaluatedModelUpdates {
    #active: ModelConfigurationVersion;
    #history: ModelConfigurationVersion[] = [];
    #busy = false;
    constructor(initial: ModelConfigurationVersion) {
        this.#active = this.#copy(initial);
    }
    #copy(value: ModelConfigurationVersion): ModelConfigurationVersion {
        return snapshotValue(
            { model: value.model, configuration: value.configuration },
            1_048_576,
            'invalid-input'
        ) as unknown as ModelConfigurationVersion;
    }
    get active(): ModelConfigurationVersion {
        return this.#active;
    }
    async propose(
        candidate: ModelConfigurationVersion,
        dataset: unknown,
        evaluate: (
            version: ModelConfigurationVersion,
            input: BotValue,
            domain: EvaluationDomain,
            signal: BotSignal
        ) => Promise<EvaluationObservation>,
        approve: (comparison: {
            baseline: EvaluationRecord;
            candidate: EvaluationRecord;
        }) => boolean | Promise<boolean>,
        signal: BotSignal
    ) {
        if (this.#busy) throw new Error('Model update busy.');
        this.#busy = true;
        try {
            const next = this.#copy(candidate),
                cases = validateEvaluationDataset(dataset);
            const baseline = await evaluateDataset(
                cases,
                (input, domain, signal) => evaluate(this.#active, input, domain, signal),
                signal
            );
            const result = await evaluateDataset(
                cases,
                (input, domain, signal) => evaluate(next, input, domain, signal),
                signal
            );
            const comparison = Object.freeze({ baseline, candidate: result });
            if (
                result.accuracy !== 1 ||
                result.invalidOutputRate !== 0 ||
                result.completionRate !== 1
            )
                return { accepted: false, comparison };
            if ((await approve(comparison)) !== true) return { accepted: false, comparison };
            signal.throwIfAborted();
            this.#history.push(this.#active);
            if (this.#history.length > 16) this.#history.shift();
            this.#active = next;
            return { accepted: true, comparison };
        } finally {
            this.#busy = false;
        }
    }
    async rollback(
        approve: (target: ModelConfigurationVersion) => boolean | Promise<boolean>,
        signal: BotSignal
    ): Promise<boolean> {
        if (this.#busy) throw new Error('Model update busy.');
        this.#busy = true;
        try {
            signal.throwIfAborted();
            const target = this.#history[this.#history.length - 1];
            if (!target || (await approve(target)) !== true) return false;
            signal.throwIfAborted();
            this.#active = target;
            this.#history.pop();
            return true;
        } finally {
            this.#busy = false;
        }
    }
}
