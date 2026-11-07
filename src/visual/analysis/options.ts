import { validateComparisonOptions } from '../validation.js';
import type { UIAnalysisOptions, UITolerances } from './types.js';

const toleranceKeys = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing',
    'colorChannel', 'colorAlpha', 'dimensions', 'position', 'spacing', 'alignment'] as const;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Invalid UI analysis options');
    for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !keys.includes(key) || !('value' in d)) throw new TypeError('Unknown option or accessor');
    }
    return value as Record<string, unknown>;
}
function finite(value: unknown, min: number, max: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError('Invalid analysis threshold');
}
export function validateUIAnalysisOptions(value: unknown): asserts value is UIAnalysisOptions {
    const o = record(value, ['geometryToleranceCssPx', 'minConfidence', 'compareTypography', 'compareLayout',
        'contentPolicy', 'selectedNodeIds', 'tolerances', 'matchingOptions', 'maxWork']);
    validateComparisonOptions({ geometryToleranceCssPx: o.geometryToleranceCssPx, minConfidence: o.minConfidence,
        compareTypography: o.compareTypography, compareLayout: o.compareLayout });
    if (o.contentPolicy !== undefined && !['structural', 'strict', 'selective'].includes(o.contentPolicy as string)) throw new TypeError('Invalid content policy');
    if (o.selectedNodeIds !== undefined) {
        if (!Array.isArray(o.selectedNodeIds) || Object.getPrototypeOf(o.selectedNodeIds) !== Array.prototype || o.selectedNodeIds.length > 10_000) throw new RangeError('Invalid selection size');
        for (const key of Reflect.ownKeys(o.selectedNodeIds)) {
            const d = Object.getOwnPropertyDescriptor(o.selectedNodeIds, key)!;
            if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !('value' in d))) throw new TypeError('Invalid selection array');
        }
        for (const id of o.selectedNodeIds) if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Invalid selected node ID');
        if (new Set(o.selectedNodeIds).size !== o.selectedNodeIds.length) throw new TypeError('Duplicate selected node ID');
        if (o.contentPolicy !== 'selective') throw new TypeError('Selected IDs require selective policy');
    } else if (o.contentPolicy === 'selective') throw new TypeError('Selective policy requires selectedNodeIds');
    if (o.tolerances !== undefined) {
        const t = record(o.tolerances, toleranceKeys);
        for (const [key, n] of Object.entries(t)) if (n !== undefined) finite(n, 0, key === 'colorAlpha' ? 1 : key === 'colorChannel' ? 255 : 1e9);
    }
    if (o.matchingOptions !== undefined) {
        const m = record(o.matchingOptions, ['minScore', 'ambiguityMargin', 'maxWork']);
        for (const key of ['minScore', 'ambiguityMargin']) if (m[key] !== undefined) finite(m[key], 0, 1);
        if (m.maxWork !== undefined) { finite(m.maxWork, 1, 1e6); if (!Number.isSafeInteger(m.maxWork)) throw new RangeError('Invalid matching work limit'); }
    }
    if (o.maxWork !== undefined) { finite(o.maxWork, 1, 1e6); if (!Number.isSafeInteger(o.maxWork)) throw new RangeError('Invalid analysis work limit'); }
}
export function resolveTolerances(options: UIAnalysisOptions): Required<UITolerances> {
    const geometry = options.geometryToleranceCssPx ?? 1;
    const defaults = { fontSize: 0.5, fontWeight: 0, lineHeight: 0.5, letterSpacing: 0.1, wordSpacing: 0.1,
        colorChannel: 0, colorAlpha: 0, dimensions: geometry, position: geometry, spacing: geometry, alignment: geometry };
    for (const key of toleranceKeys) if (options.tolerances?.[key] !== undefined) defaults[key] = options.tolerances[key]!;
    return defaults;
}
