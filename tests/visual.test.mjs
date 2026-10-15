import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
    validateUISnapshot, normalizeUISnapshot, validateBoundingRectangle, validateComparisonOptions,
    validateUINode, validateTypographyProperties, validateLayoutProperties, validateElementRelationship,
    validateSourceProvenance, validateConfidence, MAX_UI_NODES,
    distance, overlap, alignment, relativePosition, horizontalGap, verticalGap, contains,
} from 'shivax';

const rect = (x = 0, y = 0, width = 10, height = 10) => ({ x, y, width, height });
const provenance = (sourceType = 'url', kind = 'computed') => ({ sourceType, kind, method: 'local-test-measurement' });
const known = (value, source = 'url', kind = source === 'url' ? 'computed' : source === 'figma' ? 'design' : 'estimated') => ({
    status: 'known', value, provenance: provenance(source, kind), confidence: { score: kind === 'estimated' ? 0.7 : 1 },
});
const unknown = () => ({ status: 'unknown', provenance: provenance('url', 'unknown'), confidence: { score: null } });
function snapshot(sourceType = 'url', scale = 1) {
    return {
        version: 1, sourceType, scope: { kind: 'personal', id: 'local-fixture' },
        viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
        coordinates: { unit: sourceType === 'png' ? 'image-px' : sourceType === 'figma' ? 'design-unit' : 'css-px',
            unitsPerCssPixel: scale, origin: sourceType === 'figma' ? 'artboard' : 'document' },
        nodes: [{ id: 'title', bounds: known(rect(20, 40, 200, 80), sourceType),
            typography: { fontSize: known(32, sourceType), fontWeight: known(700, sourceType),
                fontFamily: known('Arial', sourceType), letterSpacing: known(-2, sourceType) },
            layout: { paddingTop: known(12, sourceType), marginTop: known(-6, sourceType) } }],
        relationships: [],
    };
}

test('visual snapshots support all sources with explicit measurement provenance', () => {
    for (const source of ['url', 'figma', 'png']) {
        const s = snapshot(source); validateUISnapshot(s);
        assert.equal(normalizeUISnapshot(s).nodes[0].bounds.value.width, 200);
    }
    const s = snapshot(); s.nodes[0].typography.lineHeight = unknown(); validateUISnapshot(s);
    assert.deepEqual(normalizeUISnapshot(s).nodes[0].typography.lineHeight, unknown());
});

test('normalization divides lengths only, preserves precision, viewport, evidence and source scale', () => {
    for (const source of ['png', 'figma']) {
        const s = snapshot(source, 2); s.nodes[0].bounds.value.x = 20.5;
        const normalized = normalizeUISnapshot(s);
        assert.deepEqual(normalized.nodes[0].bounds.value, rect(10.25, 20, 100, 40));
        assert.equal(normalized.nodes[0].typography.fontSize.value, 16);
        assert.equal(normalized.nodes[0].typography.fontWeight.value, 700);
        assert.equal(normalized.nodes[0].typography.letterSpacing.value, -1);
        assert.equal(normalized.nodes[0].layout.paddingTop.value, 6);
        assert.equal(normalized.nodes[0].layout.marginTop.value, -3);
        assert.deepEqual(normalized.viewport, s.viewport);
        assert.deepEqual(normalized.coordinates.original, { unit: s.coordinates.unit, unitsPerCssPixel: 2 });
        assert.deepEqual(normalizeUISnapshot(normalized), normalized);
        normalized.nodes[0].bounds.value.x = 99;
        assert.equal(s.nodes[0].bounds.value.x, 20.5);
        assert.equal(s.coordinates.unitsPerCssPixel, 2);
    }
    // DPR is not automatically a screenshot conversion factor.
    assert.equal(normalizeUISnapshot(snapshot()).nodes[0].bounds.value.width, 200);
});

test('visual validation rejects malformed numbers, scales, versions, shapes and missing metadata', () => {
    const changes = [s => { s.version = 2; }, s => { s.sourceType = 'html'; },
        s => { s.viewport.width = 0; }, s => { s.viewport.devicePixelRatio = Infinity; },
        s => { s.coordinates.unitsPerCssPixel = 0; }, s => { s.coordinates.unitsPerCssPixel = 2; },
        s => { s.coordinates.unit = 'image-px'; }, s => { delete s.scope; },
        s => { s.nodes[0].bounds.value.width = -1; }, s => { s.nodes[0].bounds.value.x = NaN; },
        s => { s.nodes[0].typography.fontSize.value = -1; },
        s => { s.nodes[0].typography.fontWeight.value = 1001; },
        s => { s.nodes[0].layout.rowGap = known('normal'); },
        s => { s.nodes[0].id = ''; }, s => { s.nodes[0].unexpected = true; },
        s => { s.nodes.push(structuredClone(s.nodes[0])); },
        s => { s.nodes = Array(MAX_UI_NODES + 1); },
        s => { s.relationships = Array(MAX_UI_NODES * 4 + 1); }];
    for (const change of changes) { const s = snapshot(); change(s); assert.throws(() => validateUISnapshot(s)); }
    assert.throws(() => validateUISnapshot(null));
    const s = snapshot('png', 0.000001); s.nodes[0].bounds.value.width = 1e9;
    assert.throws(() => normalizeUISnapshot(s), /numeric range/);
});

test('image estimates cannot masquerade as computed/design measurements; unknown is not zero', () => {
    for (const kind of ['computed', 'design']) {
        const s = snapshot('png'); s.nodes[0].bounds.provenance.kind = kind;
        assert.throws(() => validateUISnapshot(s));
    }
    for (const score of [-0.1, 1.1, NaN, null]) {
        const s = snapshot('png'); s.nodes[0].bounds.confidence.score = score;
        assert.throws(() => validateUISnapshot(s));
    }
    const s = snapshot(); s.nodes[0].bounds.provenance.sourceType = 'figma';
    assert.throws(() => validateUISnapshot(s));
    s.nodes[0].bounds = unknown(); validateUISnapshot(s);
    s.nodes[0].bounds.value = rect(); assert.throws(() => validateUISnapshot(s));
    s.nodes[0].bounds = known(rect()); s.nodes[0].bounds.confidence.score = 0.9;
    assert.throws(() => validateUISnapshot(s));
});

test('graph validates endpoints, duplicate edges, single parents and cycles', () => {
    const s = snapshot(); s.nodes.push({ id: 'child', bounds: unknown() });
    const edge = { from: 'title', to: 'child', type: 'parent-child', provenance: provenance(), confidence: { score: 1 } };
    s.relationships.push(edge); validateUISnapshot(s);
    s.relationships.push({ ...edge, from: 'child', to: 'title' });
    assert.throws(() => validateUISnapshot(s), /cycle/);
    s.relationships = [edge, { ...edge }]; assert.throws(() => validateUISnapshot(s), /duplicate/);
    s.relationships = [{ ...edge, to: 'missing' }]; assert.throws(() => validateUISnapshot(s), /endpoints/);
    s.relationships = [{ ...edge, to: 'title' }]; assert.throws(() => validateUISnapshot(s), /self/);
    s.nodes.push({ id: 'other', bounds: unknown() });
    s.relationships = [edge, { ...edge, from: 'other' }]; assert.throws(() => validateUISnapshot(s), /parents/);
});

test('validators reject accessors and executable array hooks without invoking them', () => {
    const s = snapshot(); let calls = 0;
    Object.defineProperty(s.nodes[0], 'role', { get() { calls++; return 'heading'; }, enumerable: true });
    assert.throws(() => normalizeUISnapshot(s)); assert.equal(calls, 0);
    const a = snapshot(); a.nodes.toJSON = () => { calls++; return []; };
    assert.throws(() => normalizeUISnapshot(a)); assert.equal(calls, 0);
    const b = snapshot(); Object.defineProperty(b.nodes, '0', { get() { calls++; return {}; } });
    assert.throws(() => normalizeUISnapshot(b)); assert.equal(calls, 0);
});

test('normalization has no shared state between company and personal snapshots', () => {
    const personal = snapshot();
    const company = snapshot(); company.scope = { kind: 'company', id: 'team-a' };
    company.nodes[0].text = 'Company-only fixture';
    const a = normalizeUISnapshot(personal), b = normalizeUISnapshot(company);
    assert.deepEqual(a.scope, { kind: 'personal', id: 'local-fixture' });
    assert.deepEqual(b.scope, { kind: 'company', id: 'team-a' });
    assert.equal(a.nodes[0].text, undefined);
    b.scope.id = 'mutated'; assert.equal(company.scope.id, 'team-a');
    const empty = snapshot(); empty.nodes = []; validateUISnapshot(empty);
});

test('individual scene validators and comparison configuration are exported', () => {
    const s = snapshot();
    validateConfidence({ score: null }); validateSourceProvenance(provenance());
    validateUINode(s.nodes[0], 'url'); validateTypographyProperties(s.nodes[0].typography, 'url');
    validateLayoutProperties(s.nodes[0].layout, 'url');
    validateElementRelationship({ from: 'a', to: 'b', type: 'contains', provenance: provenance(), confidence: { score: 1 } }, 'url');
    validateComparisonOptions({ geometryToleranceCssPx: 0.5, minConfidence: 0.7, compareTypography: true, compareLayout: false });
    for (const invalid of [{ geometryToleranceCssPx: -1 }, { minConfidence: 2 }, { compareLayout: 1 }, { matching: true }]) {
        assert.throws(() => validateComparisonOptions(invalid));
    }
    const cjs = createRequire(import.meta.url)('shivax');
    assert.equal(cjs.distance(rect(), rect(3, 4)), 5);
    assert.equal(typeof cjs.normalizeUISnapshot, 'function');
});

test('geometry: distance, overlap and IoU use exact fractional measurements', () => {
    assert.equal(distance(rect(), rect(3, 4)), 5);
    assert.deepEqual(relativePosition(rect(), rect(3, -4)), { dx: 3, dy: -4 });
    const result = overlap(rect(), rect(5, 0));
    assert.deepEqual(result.rectangle, rect(5, 0, 5, 10));
    assert.equal(result.area, 50); assert.equal(result.intersectionOverUnion, 1 / 3);
    assert.equal(overlap(rect(), rect()).intersectionOverUnion, 1);
    assert.equal(overlap(rect(), rect(10, 0)).rectangle, null);
    assert.equal(overlap(rect(0, 0, 0, 0), rect(0, 0, 0, 0)).intersectionOverUnion, 0);
    assert.equal(horizontalGap(rect(0.25, 0, 10, 10), rect(10.75)), 0.5);
});

test('geometry: alignment, directed gaps and containment cover edges and invalid input', () => {
    assert.equal(horizontalGap(rect(), rect(15)), 5);
    assert.equal(verticalGap(rect(), rect(0, 15)), 5);
    assert.equal(horizontalGap(rect(), rect(5)), -5);
    assert.equal(horizontalGap(rect(), rect(-15)), -25);
    assert.deepEqual(alignment(rect(), rect()), { left: true, right: true, top: true, bottom: true, centerX: true, centerY: true });
    assert.equal(alignment(rect(), rect(0.5), 0.5).left, true);
    assert.equal(alignment(rect(), rect(0.5)).left, false);
    assert.equal(contains(rect(), rect(1, 1, 2, 2)), true);
    assert.equal(contains(rect(), rect()), true);
    assert.equal(contains(rect(), rect(-1, 0)), false);
    for (const fn of [distance, overlap, relativePosition, horizontalGap, verticalGap, contains, alignment]) {
        assert.throws(() => fn(rect(0, 0, -1), rect()));
        assert.throws(() => fn(rect(), rect(Infinity)));
    }
    assert.throws(() => alignment(rect(), rect(), -1));
    assert.throws(() => alignment(rect(), rect(), NaN));
    assert.throws(() => validateBoundingRectangle({ x: 0, y: 0, width: '10', height: 1 }));
});
