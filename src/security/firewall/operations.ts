import { array, snapshotValue } from '../../agents/validation.js';
import { ModelProviderRegistry } from '../../intelligence/registry.js';
import { limits, schema } from '../../intelligence/validation.js';
import { costUnits, reservationUSD } from '../../intelligence/cost.js';
import { FirewallError } from './errors.js';
import { files, id, list, object, origin } from './policy.js';
import type { FirewallOperation } from './types.js';

export function operations(raw: unknown): ReadonlyMap<string, FirewallOperation> {
    const result = new Map<string, FirewallOperation>();
    try {
        for (const value of array(raw, 256, 'invalid-input')) {
            const item = object(value, [
                'id',
                'kind',
                'capability',
                'effect',
                'botId',
                'files',
                'networkOrigins',
                'check',
                'execute',
                'toolId',
                'provider',
                'modelCapability',
                'output',
                'limits',
            ]);
            id(item.id);
            id(item.capability);
            if (
                result.has(item.id) ||
                !['read-only', 'state-changing'].includes(item.effect as string) ||
                typeof item.check !== 'function'
            )
                throw 0;
            if (item.botId !== undefined) id(item.botId);
            const base = {
                id: item.id,
                capability: item.capability,
                effect: item.effect,
                ...(item.botId === undefined ? {} : { botId: item.botId }),
                files: files(snapshotValue(item.files, 65_536, 'invalid-input')),
                networkOrigins: list(item.networkOrigins, origin),
                check: item.check.bind(value),
            };
            if (base.files.write.length && base.effect !== 'state-changing') throw 0;
            let operation: FirewallOperation;
            if (item.kind === 'model') {
                if (
                    item.execute !== undefined ||
                    item.toolId !== undefined ||
                    base.effect !== 'read-only'
                )
                    throw 0;
                object(item.provider, [
                    'id',
                    'capabilities',
                    'locality',
                    'tokenBased',
                    'pricing',
                    'infer',
                ]);
                const registry = new ModelProviderRegistry().register(item.provider as never);
                const registered = registry.get(registry.list()[0].id)!;
                if (registered.locality !== 'in-process' && !base.networkOrigins.length) throw 0;
                if (!registered.capabilities.includes(item.modelCapability as never)) throw 0;
                const output = object(item.output, ['schema', 'validate']);
                if (output.validate !== undefined && typeof output.validate !== 'function') throw 0;
                // Require a complete explicit model budget, not permissive defaults.
                const budget = object(item.limits, [
                    'maxCalls',
                    'maxTokens',
                    'maxCostUSD',
                    'timeoutMs',
                    'maxInputTokens',
                    'maxOutputTokens',
                    'maxInputBytes',
                    'maxOutputBytes',
                ]);
                if (
                    Object.keys(budget).length !== 8 ||
                    Object.values(budget).some((value) => value === undefined)
                )
                    throw 0;
                operation = Object.freeze({
                    ...base,
                    kind: 'model',
                    provider: registered,
                    modelCapability: item.modelCapability,
                    output: Object.freeze({
                        schema: schema(output.schema),
                        ...(output.validate === undefined
                            ? {}
                            : { validate: output.validate.bind(item.output) }),
                    }),
                    limits: limits(budget),
                }) as FirewallOperation;
                modelReservation(operation);
            } else if (item.kind === 'tool') {
                if (
                    item.execute !== undefined ||
                    item.provider !== undefined ||
                    item.output !== undefined ||
                    item.limits !== undefined ||
                    item.modelCapability !== undefined
                )
                    throw 0;
                id(item.toolId);
                operation = Object.freeze({
                    ...base,
                    kind: 'tool',
                    toolId: item.toolId,
                }) as FirewallOperation;
            } else {
                if (
                    !['cpu', 'workflow', 'bot', 'file', 'network'].includes(item.kind as string) ||
                    typeof item.execute !== 'function' ||
                    item.provider !== undefined ||
                    item.output !== undefined ||
                    item.toolId !== undefined ||
                    item.limits !== undefined ||
                    item.modelCapability !== undefined
                )
                    throw 0;
                if (
                    item.kind === 'cpu' &&
                    (base.effect !== 'read-only' ||
                        base.files.read.length ||
                        base.files.write.length ||
                        base.networkOrigins.length)
                )
                    throw 0;
                if (item.kind === 'bot' && base.botId === undefined) throw 0;
                operation = Object.freeze({
                    ...base,
                    kind: item.kind,
                    execute: item.execute.bind(value),
                }) as FirewallOperation;
            }
            result.set(operation.id, operation);
        }
        return result;
    } catch {
        throw new FirewallError('invalid-configuration');
    }
}
export function modelReservation(operation: FirewallOperation): {
    input: number;
    output: number;
    cost: bigint;
} {
    if (operation.kind !== 'model') return { input: 0, output: 0, cost: 0n };
    const input = operation.provider.tokenBased ? operation.limits.maxInputTokens : 0;
    const output = operation.provider.tokenBased ? operation.limits.maxOutputTokens : 0;
    const price = operation.provider.pricing;
    const exact =
        costUnits(price.callUSD) +
        costUnits(price.inputTokenUSD) * BigInt(input) +
        costUnits(price.outputTokenUSD) * BigInt(output);
    return { input, output, cost: costUnits(reservationUSD(exact)) };
}
