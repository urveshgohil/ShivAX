import { array, record, snapshotValue } from '../../agents/validation.js';
import { costUnits } from '../../intelligence/cost.js';
import { FirewallError } from './errors.js';
import type { FirewallOperation, FirewallPolicy, FirewallRealm } from './types.js';

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    return record(value, keys, 'invalid-input');
}
export function id(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
        throw new FirewallError('invalid-configuration');
}
export function count(value: unknown, min: number, max: number): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new FirewallError('invalid-policy');
}
export function list(value: unknown, validate: (item: unknown) => void = id): readonly string[] {
    const items = array(value, 256, 'invalid-input');
    items.forEach(validate);
    if (new Set(items).size !== items.length) throw new FirewallError('invalid-policy');
    return Object.freeze([...items]) as readonly string[];
}
export function path(value: unknown): void {
    if (
        typeof value !== 'string' ||
        value.length > 4096 ||
        !/^(?:[A-Za-z]:\/|\/)/.test(value) ||
        /[\\\u0000-\u001f*?%]/.test(value) ||
        value.split('/').some((segment) => segment === '.' || segment === '..') ||
        value.includes('//') ||
        /[:]/.test(value.replace(/^[A-Za-z]:/, '')) ||
        value.split('/').some((segment) => /[. ]$/.test(segment))
    )
        throw new FirewallError('invalid-policy');
}
export function origin(value: unknown): void {
    if (typeof value !== 'string' || value.length > 2048) throw new FirewallError('invalid-policy');
    const url = new URL(value);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== value ||
        url.username ||
        url.password
    )
        throw new FirewallError('invalid-policy');
}
export function files(value: unknown): FirewallPolicy['files'] {
    const source = object(value, ['read', 'write']);
    return Object.freeze({ read: list(source.read, path), write: list(source.write, path) });
}
export function realm(value: unknown): FirewallRealm {
    const safe = snapshotValue(value, 4096, 'invalid-context');
    const source = object(safe, ['issuer', 'scope']);
    id(source.issuer);
    const scope = object(source.scope, ['kind', 'id']);
    if (scope.kind !== 'personal' && scope.kind !== 'company')
        throw new FirewallError('invalid-configuration');
    id(scope.id);
    return safe as unknown as FirewallRealm;
}
export function policy(
    value: unknown,
    operations: ReadonlyMap<string, FirewallOperation>
): FirewallPolicy {
    try {
        const safe = snapshotValue(value, 1_048_576, 'invalid-input');
        const source = object(safe, [
            'mode',
            'rules',
            'providers',
            'capabilities',
            'bots',
            'files',
            'network',
            'limits',
            'audit',
        ]);
        if (!['enforce', 'monitor', 'lockdown'].includes(source.mode as string)) throw 0;
        const rules = array(source.rules, 256, 'invalid-input');
        const ruleIds = new Set<string>();
        for (const raw of rules) {
            const rule = object(raw, ['id', 'operationIds', 'decision', 'optional']);
            id(rule.id);
            if (ruleIds.has(rule.id)) throw 0;
            ruleIds.add(rule.id);
            const ids = list(rule.operationIds);
            if (!ids.length || ids.some((name) => !operations.has(name))) throw 0;
            if (rule.decision !== 'allow' && rule.decision !== 'deny') throw 0;
            if (rule.optional !== undefined && typeof rule.optional !== 'boolean') throw 0;
            if (rule.optional === true && rule.decision !== 'deny') throw 0;
        }
        const providers = object(source.providers, ['ids', 'localities']);
        list(providers.ids);
        list(providers.localities, (value) => {
            if (!['in-process', 'local', 'remote'].includes(value as string)) throw 0;
        });
        list(source.capabilities);
        list(source.bots);
        files(source.files);
        const network = object(source.network, ['origins']);
        list(network.origins, origin);
        const limits = object(source.limits, [
            'maxConcurrent',
            'maxOperations',
            'maxTokens',
            'maxCostUSD',
            'maxInputBytes',
            'maxOutputBytes',
            'timeoutMs',
        ]);
        count(limits.maxConcurrent, 1, 1024);
        count(limits.maxOperations, 0, 1_000_000);
        count(limits.maxTokens, 0, 100_000_000);
        costUnits(limits.maxCostUSD as number);
        count(limits.maxInputBytes, 1, 1_048_576);
        count(limits.maxOutputBytes, 1, 1_048_576);
        count(limits.timeoutMs, 1, 300_000);
        const audit = object(source.audit, ['required']);
        if (typeof audit.required !== 'boolean') throw 0;
        return safe as unknown as FirewallPolicy;
    } catch {
        throw new FirewallError('invalid-policy');
    }
}
/** Missing baseline allow and all resource restrictions remain mandatory in monitor. */
export function evaluate(policy: FirewallPolicy, operation: FirewallOperation): boolean {
    if (policy.mode === 'lockdown' && operation.kind !== 'cpu') throw new FirewallError('lockdown');
    const rules = policy.rules.filter((rule) => rule.operationIds.includes(operation.id));
    if (
        !rules.some((rule) => rule.decision === 'allow' && !rule.optional) ||
        rules.some((rule) => rule.decision === 'deny' && !rule.optional) ||
        !policy.capabilities.includes(operation.capability) ||
        (operation.botId !== undefined && !policy.bots.includes(operation.botId)) ||
        operation.files.read.some((path) => !policy.files.read.includes(path)) ||
        operation.files.write.some((path) => !policy.files.write.includes(path)) ||
        operation.networkOrigins.some((origin) => !policy.network.origins.includes(origin))
    )
        throw new FirewallError('denied');
    if (
        operation.kind === 'model' &&
        (!policy.providers.ids.includes(operation.provider.id) ||
            !policy.providers.localities.includes(operation.provider.locality))
    )
        throw new FirewallError('denied');
    const optionalDenied = rules.some((rule) => rule.decision === 'deny' && rule.optional);
    if (optionalDenied && policy.mode !== 'monitor') throw new FirewallError('denied');
    return optionalDenied;
}
