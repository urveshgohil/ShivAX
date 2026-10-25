import { array, identifier, record, snapshotValue } from '../validation.js';
import { RudraError } from './errors.js';
import type { RudraOptions, WorkflowPlan } from './types.js';

export function options(value: RudraOptions, capability: string): Required<RudraOptions> {
    try {
        const input = record(
            value,
            ['maxSteps', 'maxRetries', 'allowedCapabilities'],
            'invalid-context'
        );
        const maxSteps = input.maxSteps === undefined ? 16 : input.maxSteps;
        const maxRetries = input.maxRetries === undefined ? 0 : input.maxRetries;
        if (
            typeof maxSteps !== 'number' ||
            !Number.isSafeInteger(maxSteps) ||
            maxSteps < 1 ||
            maxSteps > 100 ||
            typeof maxRetries !== 'number' ||
            !Number.isSafeInteger(maxRetries) ||
            maxRetries < 0 ||
            maxRetries > 3
        )
            throw new RudraError('invalid-options');
        const allowedCapabilities = array(
            input.allowedCapabilities === undefined ? [capability] : input.allowedCapabilities,
            128,
            'invalid-context'
        ).map((item) => {
            identifier(item, 'invalid-context');
            return item;
        });
        if (new Set(allowedCapabilities).size !== allowedCapabilities.length)
            throw new RudraError('invalid-options');
        return Object.freeze({
            maxSteps,
            maxRetries,
            allowedCapabilities: Object.freeze(allowedCapabilities),
        });
    } catch {
        throw new RudraError('invalid-options');
    }
}

export function plan(value: unknown, maxSteps: number, maxBytes: number): WorkflowPlan {
    // Copy first: subsequent checks never invoke getters or consume mutable planner output.
    let snapshot: unknown;
    try {
        snapshot = snapshotValue(value, maxBytes, 'invalid-input');
    } catch {
        throw new RudraError('invalid-plan');
    }
    try {
        const root = record(snapshot, ['steps'], 'invalid-input');
        const steps = array(root.steps, 100, 'invalid-input');
        if (!steps.length) throw new RudraError('invalid-plan');
        if (steps.length > maxSteps) throw new RudraError('max-steps');
        const previous = new Set<string>();
        for (const value of steps) {
            const step = record(value, ['id', 'capability', 'input'], 'invalid-input');
            identifier(step.id, 'invalid-input');
            identifier(step.capability, 'invalid-input');
            if (previous.has(step.id)) throw new RudraError('invalid-plan');
            const input = record(step.input, ['source', 'data', 'stepId'], 'invalid-input');
            if (input.source === 'task') record(input, ['source'], 'invalid-input');
            else if (input.source === 'literal') {
                record(input, ['source', 'data'], 'invalid-input');
                if (!Object.prototype.hasOwnProperty.call(input, 'data'))
                    throw new RudraError('invalid-plan');
            } else if (input.source === 'step') {
                record(input, ['source', 'stepId'], 'invalid-input');
                identifier(input.stepId, 'invalid-input');
                if (!previous.has(input.stepId)) throw new RudraError('invalid-plan');
            } else throw new RudraError('invalid-plan');
            previous.add(step.id);
        }
        return snapshot as WorkflowPlan;
    } catch (error) {
        if (error instanceof RudraError) throw error;
        throw new RudraError('invalid-plan');
    }
}
