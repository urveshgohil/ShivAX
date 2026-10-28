import { array, identifier, record, snapshotValue } from '../agents/validation.js';
import { WorkflowError } from './errors.js';
import type { AutonomousWorkflowPlan, WorkflowOptions } from './types.js';

export function integer(value: unknown, min: number, max: number): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
        throw new WorkflowError('invalid-options');
}
/** Decimal nanodollars: reservations round up, host budgets down; never widen a limit. */
export function moneyUnits(value: unknown, rounding: 'up' | 'down' = 'up'): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)
        throw new WorkflowError('invalid-options');
    // Parse the decimal representation instead of multiplying floats at a rounding boundary.
    const [coefficient, exponent = '0'] = value.toString().split('e');
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = BigInt(whole + fraction);
    const scale = Number(exponent) + 9 - fraction.length;
    if (scale >= 0) return Number(digits * 10n ** BigInt(scale));
    const divisor = 10n ** BigInt(-scale);
    return Number(digits / divisor + (rounding === 'up' && digits % divisor !== 0n ? 1n : 0n));
}
export function settings(options: WorkflowOptions, capability: string) {
    try {
        const value = record(
            options,
            [
                'allowedCapabilities',
                'maxSteps',
                'maxToolCalls',
                'maxParallel',
                'maxRetries',
                'modelBudget',
            ],
            'invalid-input'
        );
        const allowed = array(value.allowedCapabilities ?? [capability], 128, 'invalid-input');
        allowed.forEach((v) => identifier(v, 'invalid-input'));
        if (!allowed.length || new Set(allowed).size !== allowed.length)
            throw new WorkflowError('invalid-options');
        const maxSteps = value.maxSteps ?? 32,
            maxToolCalls = value.maxToolCalls ?? 32;
        const maxParallel = value.maxParallel ?? 1,
            maxRetries = value.maxRetries ?? 0;
        integer(maxSteps, 1, 100);
        integer(maxToolCalls, 1, 100);
        integer(maxParallel, 1, 8);
        integer(maxRetries, 0, 3);
        const budget = record(
            value.modelBudget ?? { maxCalls: 0, maxTokens: 0, maxCostUSD: 0 },
            ['maxCalls', 'maxTokens', 'maxCostUSD'],
            'invalid-input'
        );
        integer(budget.maxCalls, 0, 100);
        integer(budget.maxTokens, 0, 100_000_000);
        const costUnits = moneyUnits(budget.maxCostUSD, 'down');
        return Object.freeze({
            allowed: Object.freeze([...allowed] as string[]),
            maxSteps,
            maxToolCalls,
            maxParallel,
            maxRetries,
            modelCalls: budget.maxCalls,
            modelTokens: budget.maxTokens,
            costUnits,
        });
    } catch {
        throw new WorkflowError('invalid-options');
    }
}
export function plan(raw: unknown, maxSteps: number, maxBytes: number): AutonomousWorkflowPlan {
    try {
        const safe = snapshotValue(raw, maxBytes, 'invalid-input');
        const root = record(safe, ['actions'], 'invalid-input');
        const actions = array(root.actions, maxSteps, 'invalid-input');
        if (!actions.length) throw new WorkflowError('invalid-plan');
        const seen = new Set<string>();
        for (const rawAction of actions) {
            const action = record(
                rawAction,
                ['id', 'capability', 'input', 'dependsOn'],
                'invalid-input'
            );
            identifier(action.id, 'invalid-input');
            identifier(action.capability, 'invalid-input');
            if (seen.has(action.id)) throw new WorkflowError('invalid-plan');
            const input = record(action.input, ['source', 'stepId', 'data'], 'invalid-input');
            if (input.source === 'task') {
                if (Object.keys(input).length !== 1) throw new WorkflowError('invalid-plan');
            } else if (input.source === 'literal') {
                if (Object.keys(input).length !== 2 || !('data' in input))
                    throw new WorkflowError('invalid-plan');
            } else if (input.source === 'step') {
                if (Object.keys(input).length !== 2 || !seen.has(input.stepId as string))
                    throw new WorkflowError('invalid-plan');
            } else throw new WorkflowError('invalid-plan');
            const dependencies = array(action.dependsOn ?? [], 100, 'invalid-input');
            if (
                new Set(dependencies).size !== dependencies.length ||
                dependencies.some((id) => !seen.has(id as string))
            )
                throw new WorkflowError('invalid-plan');
            seen.add(action.id);
        }
        return safe as unknown as AutonomousWorkflowPlan;
    } catch {
        throw new WorkflowError('invalid-plan');
    }
}
