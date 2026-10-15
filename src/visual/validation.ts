import type { BoundingRectangle, ComparisonOptions, UISnapshot, UINode, SourceType,
    TypographyProperties, LayoutProperties, ElementRelationship, Confidence, SourceProvenance } from './types.js';

export const MAX_UI_NODES = 10_000;
const MAX_LENGTH = 1_000_000_000;
const typography = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'color', 'textAlign'];
const layout = ['display', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap', 'flexDirection', 'alignItems', 'justifyContent'];
type RecordValue = Record<string, unknown>;
function fail(name: string): never { throw new TypeError(`Invalid UI scene: ${name}`); }
function object(value: unknown, keys: readonly string[]): RecordValue {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('plain object required');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key])) fail('unexpected property or accessor');
    }
    return value as RecordValue;
}
function text(value: unknown, max = 2048): asserts value is string {
    if (typeof value !== 'string' || !value.length || value.length > max) fail('string length');
}
function number(value: unknown, min = -MAX_LENGTH, max = MAX_LENGTH): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('finite numeric range');
}
function choice(value: unknown, values: readonly unknown[]): void { if (!values.includes(value)) fail('enum'); }
function array(value: unknown, max: number): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) fail('array size or prototype');
    for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key)!;
        if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !('value' in d))) fail('array property or accessor');
    }
}

export function validateConfidence(value: unknown): asserts value is Confidence {
    const c = object(value, ['score']);
    if (c.score !== null) number(c.score, 0, 1);
}
export function validateSourceProvenance(value: unknown): asserts value is SourceProvenance {
    const p = object(value, ['sourceType', 'kind', 'method', 'reference']);
    choice(p.sourceType, ['url', 'figma', 'png']); choice(p.kind, ['computed', 'design', 'estimated', 'unknown']);
    text(p.method); if (p.reference !== undefined) text(p.reference);
    if ((p.kind === 'computed' && p.sourceType !== 'url') || (p.kind === 'design' && p.sourceType !== 'figma')) fail('provenance kind/source');
}

export function validateBoundingRectangle(value: unknown): asserts value is BoundingRectangle {
    const r = object(value, ['x', 'y', 'width', 'height']);
    number(r.x); number(r.y); number(r.width, 0); number(r.height, 0);
    number((r.x as number) + (r.width as number)); number((r.y as number) + (r.height as number));
}
function evidence(provenance: unknown, confidence: unknown, source: unknown, unknown = false): void {
    validateSourceProvenance(provenance); validateConfidence(confidence);
    const p = provenance, c = confidence;
    if (p.sourceType !== source) fail('provenance source mismatch');
    if (unknown) {
        if (p.kind !== 'unknown' || c.score !== null) fail('unknown evidence');
    } else {
        number(c.score, 0, 1);
        if (p.kind === 'unknown') fail('measurement provenance');
        if (p.kind !== 'estimated' && c.score !== 1) fail('exact/design quality must be 1');
    }
}

export function validateTypographyProperties(value: unknown, source: SourceType): asserts value is TypographyProperties {
    choice(source, ['url', 'figma', 'png']); properties(value, source, typography);
}
export function validateLayoutProperties(value: unknown, source: SourceType): asserts value is LayoutProperties {
    choice(source, ['url', 'figma', 'png']); properties(value, source, layout);
}
export function validateUINode(value: unknown, source: SourceType): asserts value is UINode {
    choice(source, ['url', 'figma', 'png']);
    const n = object(value, ['id', 'role', 'text', 'bounds', 'typography', 'layout']);
    text(n.id, 256);
    if (n.role !== undefined) text(n.role, 256);
    if (n.text !== undefined && (typeof n.text !== 'string' || n.text.length > 2048)) fail('node text');
    measurement(n.bounds, source, validateBoundingRectangle);
    if (n.typography !== undefined) validateTypographyProperties(n.typography, source);
    if (n.layout !== undefined) validateLayoutProperties(n.layout, source);
}
export function validateElementRelationship(value: unknown, source: SourceType): asserts value is ElementRelationship {
    choice(source, ['url', 'figma', 'png']);
    const r = object(value, ['from', 'to', 'type', 'provenance', 'confidence']);
    text(r.from, 256); text(r.to, 256);
    if (r.from === r.to) fail('self relationship');
    choice(r.type, ['parent-child', 'contains', 'labelled-by', 'heading-description', 'image-content']);
    evidence(r.provenance, r.confidence, source);
}
function measurement(value: unknown, source: unknown, check: (v: unknown) => void): void {
    const m = object(value, ['status', 'value', 'provenance', 'confidence']);
    choice(m.status, ['known', 'unknown']);
    evidence(m.provenance, m.confidence, source, m.status === 'unknown');
    if (m.status === 'known') check(m.value);
    else if ('value' in m) fail('unknown must not have a value');
}
function properties(value: unknown, source: unknown, keys: string[]): void {
    const props = object(value, keys);
    for (const key of Object.keys(props)) measurement(props[key], source, v => {
        if (key === 'color') {
            const color = object(v, ['r', 'g', 'b', 'a']);
            for (const channel of ['r', 'g', 'b']) number(color[channel], 0, 255);
            number(color.a, 0, 1);
        }
        else if (key === 'textAlign') choice(v, ['left', 'right', 'center', 'start', 'end', 'justify']);
        else if (key === 'flexDirection') choice(v, ['row', 'row-reverse', 'column', 'column-reverse']);
        else if (['fontFamily', 'display', 'alignItems', 'justifyContent'].includes(key)) text(v, 256);
        else if (key === 'fontWeight') number(v, 1, 1000);
        else if (key.startsWith('margin') || key.endsWith('Spacing')) number(v);
        else number(v, 0);
    });
}

export function validateUISnapshot(value: unknown): asserts value is UISnapshot {
    const s = object(value, ['version', 'sourceType', 'scope', 'viewport', 'coordinates', 'nodes', 'relationships']);
    if (s.version !== 1) fail('version');
    choice(s.sourceType, ['url', 'figma', 'png']);
    const scope = object(s.scope, ['kind', 'id']); choice(scope.kind, ['company', 'personal']); text(scope.id, 256);
    const v = object(s.viewport, ['width', 'height', 'devicePixelRatio']);
    number(v.width, Number.MIN_VALUE); number(v.height, Number.MIN_VALUE); number(v.devicePixelRatio, 0.01, 100);
    const c = object(s.coordinates, ['unit', 'unitsPerCssPixel', 'origin', 'original']);
    choice(c.unit, ['css-px', 'design-unit', 'image-px']); choice(c.origin, ['viewport', 'document', 'artboard']);
    number(c.unitsPerCssPixel, 0.000001, 1_000_000);
    if (c.unit === 'css-px' && c.unitsPerCssPixel !== 1) fail('CSS pixel scale must be 1');
    if (c.unit === 'image-px' && s.sourceType !== 'png') fail('image units require png');
    if (c.unit === 'design-unit' && s.sourceType !== 'figma') fail('design units require figma');
    if (c.original !== undefined) {
        const original = object(c.original, ['unit', 'unitsPerCssPixel']);
        if (c.unit !== 'css-px') fail('normalization trail requires CSS pixels');
        choice(original.unit, s.sourceType === 'png' ? ['image-px'] : s.sourceType === 'figma' ? ['design-unit'] : []);
        number(original.unitsPerCssPixel, 0.000001, 1_000_000);
    }
    array(s.nodes, MAX_UI_NODES);
    const ids = new Set<string>();
    for (const node of s.nodes) {
        validateUINode(node, s.sourceType as SourceType);
        if (ids.has(node.id)) fail('duplicate node id'); ids.add(node.id);
    }
    array(s.relationships, MAX_UI_NODES * 4);
    const parents = new Map<string, string>();
    const edges = new Set<string>();
    for (const relationship of s.relationships) {
        validateElementRelationship(relationship, s.sourceType as SourceType);
        const r = relationship;
        if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) fail('relationship endpoints');
        const key = JSON.stringify([r.from, r.to, r.type]);
        if (edges.has(key)) fail('duplicate relationship'); edges.add(key);
        if (r.type === 'parent-child') {
            if (parents.has(r.to)) fail('multiple parents'); parents.set(r.to, r.from);
        }
    }
    // Iterative, linear-time cycle detection; no recursion on untrusted graphs.
    const done = new Set<string>();
    for (const id of parents.keys()) {
        const path = new Set<string>(); let current: string | undefined = id;
        while (current !== undefined && !done.has(current)) {
            if (path.has(current)) fail('parent cycle'); path.add(current); current = parents.get(current);
        }
        for (const item of path) done.add(item);
    }
}

export function validateComparisonOptions(value: unknown): asserts value is ComparisonOptions {
    const o = object(value, ['geometryToleranceCssPx', 'minConfidence', 'compareTypography', 'compareLayout']);
    if (o.geometryToleranceCssPx !== undefined) number(o.geometryToleranceCssPx, 0);
    if (o.minConfidence !== undefined) number(o.minConfidence, 0, 1);
    for (const key of ['compareTypography', 'compareLayout']) if (o[key] !== undefined && typeof o[key] !== 'boolean') fail('boolean option');
}

/** Defensive copy; viewport is already CSS pixels. Only lengths are scaled. */
export function normalizeUISnapshot(value: unknown): UISnapshot {
    validateUISnapshot(value);
    // Clone data without invoking toJSON or retaining caller-owned arrays/objects.
    const clone = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(clone);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, clone(item)]));
        return v;
    };
    const result = clone(value) as UISnapshot;
    const scale = result.coordinates.unitsPerCssPixel;
    for (const node of result.nodes) {
        if (node.bounds.status === 'known') {
            for (const key of ['x', 'y', 'width', 'height'] as const) node.bounds.value[key] /= scale;
        }
        for (const props of [node.typography, node.layout]) if (props) {
            for (const [key, m] of Object.entries(props)) if (m.status === 'known' && typeof m.value === 'number' && key !== 'fontWeight') m.value /= scale;
        }
    }
    const original = result.coordinates.unit === 'css-px' ? result.coordinates.original
        : { unit: result.coordinates.unit, unitsPerCssPixel: scale };
    result.coordinates = { ...result.coordinates, unit: 'css-px', unitsPerCssPixel: 1,
        ...(original ? { original } : {}) };
    validateUISnapshot(result);
    return result;
}
