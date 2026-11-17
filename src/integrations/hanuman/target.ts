import { array, identifier, record, snapshotValue } from '../../agents/validation.js';
import { HanumanFetchError } from './error.js';
import type { HanumanFetchLimits, HanumanFetchTarget } from './types.js';

export function bounded(value: unknown, maximum: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new HanumanFetchError('invalid-input');
    return value;
}

export function targets(
    raw: unknown,
    limits: HanumanFetchLimits
): ReadonlyMap<string, HanumanFetchTarget> {
    try {
        const result = new Map<string, HanumanFetchTarget>();
        for (const entry of array(raw, 256, 'invalid-input')) {
            const target = record(
                snapshotValue(entry, 16384, 'invalid-input'),
                ['id', 'url', 'issuer', 'scope', 'mediaTypes', 'maxResponseBytes'],
                'invalid-input'
            );
            identifier(target.id, 'invalid-input');
            identifier(target.issuer, 'invalid-input');
            const scope = record(target.scope, ['kind', 'id'], 'invalid-input');
            identifier(scope.id, 'invalid-input');
            if (!['personal', 'company'].includes(scope.kind as string) || result.has(target.id))
                throw 0;
            if (typeof target.url !== 'string' || target.url.length > 2048) throw 0;
            const url = new URL(target.url);
            if (
                url.href !== target.url ||
                url.protocol !== 'https:' ||
                url.username ||
                url.password ||
                url.hash ||
                target.url.includes('#') ||
                url.port ||
                !/^[a-z0-9.-]+$/.test(url.hostname) ||
                !url.hostname.includes('.') ||
                /^\d+(\.\d+){3}$/.test(url.hostname) ||
                url.hostname.endsWith('.') ||
                /(^|\.)(localhost|local|internal|home\.arpa)$/.test(url.hostname)
            )
                throw 0;
            const media = array(target.mediaTypes, 2, 'invalid-input');
            if (
                !media.length ||
                new Set(media).size !== media.length ||
                media.some((value) => value !== 'text/plain' && value !== 'application/json')
            )
                throw 0;
            if (target.maxResponseBytes !== undefined)
                bounded(target.maxResponseBytes, limits.maxResponseBytes);
            result.set(target.id, target as unknown as HanumanFetchTarget);
        }
        return result;
    } catch {
        throw new HanumanFetchError('invalid-input');
    }
}
