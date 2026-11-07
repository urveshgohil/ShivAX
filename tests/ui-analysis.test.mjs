import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { analyzeUI, normalizeUISnapshot, validateUISnapshot, validateUIAnalysisOptions } from 'shivax';
import { paired, measurement, unknown, documentPair } from './fixtures/ui-analysis.mjs';

test('identical snapshots produce no issues and analysis is deterministic/nonmutating', () => {
    const { baseline, target } = paired(); const before = structuredClone([baseline, target]);
    const result = analyzeUI(baseline, target);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(analyzeUI(baseline, target), result);
    assert.deepEqual([baseline, target], before);
    assert.equal(typeof createRequire(import.meta.url)('shivax').analyzeUI, 'function');
});

test('captured documents with different wrappers preserve same-title measured color differences', () => {
    const { baseline, target } = documentPair();
    const result = analyzeUI(baseline, target);
    const root = result.matching.matches.find(match => match.referenceId === 'old-body');
    assert.equal(root.targetId, 'new-body'); assert.equal(root.level, 'region');
    assert.ok(root.evidence.some(item => item.detail === 'unique explicit document scene roots'));
    assert.equal(result.matching.matches.find(match => match.referenceId === 'old-title').targetId, 'new-title');
    const color = result.issues.find(issue => issue.property === 'typography.color');
    assert.deepEqual(color.expected, { r: 25, g: 133, b: 104, a: 1 });
    assert.deepEqual(color.actual, { r: 16, g: 24, b: 40, a: 1 });
    assert.deepEqual(color.supportingMeasurements[0].measurement, baseline.nodes[2].typography.color);
    assert.ok(!result.issues.some(issue => issue.category === 'structure' && issue.baselineNodeId === 'old-title'));
});

test('category badge colors require the same category label; changed data stays unresolved', () => {
    const { baseline, target } = documentPair();
    const a = baseline.nodes[2], b = target.nodes[3];
    a.role = b.role = 'category-badge';
    a.text = `Category ${17 * 23}`; b.text = `Category ${41 * 7}`;
    const changed = analyzeUI(baseline, target);
    assert.ok(!changed.matching.matches.some(match => match.referenceId === a.id));
    assert.ok(changed.matching.uncertain.some(item => item.referenceId === a.id));
    assert.ok(!changed.issues.some(issue => issue.baselineNodeId === a.id && ['color', 'structure'].includes(issue.category)));
    b.text = a.text;
    const same = analyzeUI(baseline, target);
    assert.ok(same.issues.some(issue => issue.baselineNodeId === a.id && issue.category === 'color'));
});

test('known typography, canonical color and text alignment differences are measured exactly', () => {
    for (const [property, value, category] of [['fontFamily', 'Georgia', 'typography'], ['fontSize', 24, 'typography'],
        ['fontWeight', 400, 'typography'], ['lineHeight', 32, 'typography'], ['letterSpacing', 2, 'typography'],
        ['wordSpacing', 4, 'typography'], ['color', { r: 120, g: 30, b: 40, a: 1 }, 'color'], ['textAlign', 'center', 'alignment']]) {
        const { baseline, target, node } = paired(); node('title').typography[property] = measurement(value);
        const result = analyzeUI(baseline, target);
        assert.equal(result.issues.length, 1, property);
        const issue = result.issues[0];
        assert.equal(issue.category, category); assert.equal(issue.property, `typography.${property}`);
        assert.equal(issue.baselineNodeId, 'title'); assert.equal(issue.targetNodeId, 'target-title');
        assert.deepEqual(issue.actual, value); assert.equal(issue.suggestedCorrection.automatic, false);
        assert.deepEqual(issue.targetCoordinates.value, node('title').bounds.value);
        assert.equal(issue.supportingMeasurements.length, 2);
        if (typeof value === 'number') assert.equal(issue.difference.delta, value - baseline.nodes.find(n => n.id === 'title').typography[property].value);
    }
});

test('tolerance thresholds include equality and never turn unknown values into zero', () => {
    const { baseline, target, node } = paired(); node('title').typography.fontSize.value += 0.5;
    assert.equal(analyzeUI(baseline, target).issues.length, 0);
    assert.equal(analyzeUI(baseline, target, { tolerances: { fontSize: 0.49 } }).issues.length, 1);
    node('title').typography.fontSize = unknown();
    const result = analyzeUI(baseline, target);
    assert.equal(result.issues.length, 0);
    assert.ok(result.diagnostics.some(d => d.property === 'typography.fontSize' && d.code === 'unknown-measurement'));
    node('title').typography.fontSize = measurement(20);
    node('title').typography.color.value.r += 1;
    assert.equal(analyzeUI(baseline, target, { tolerances: { colorChannel: 1 } }).issues.length, 0);
});

test('structural, strict and selective policies have explicit text behavior', () => {
    const { baseline, target, node } = paired(); node('description').text = 'Rewritten description';
    assert.equal(analyzeUI(baseline, target).issues.filter(i => i.category === 'content').length, 0);
    assert.equal(analyzeUI(baseline, target, { contentPolicy: 'strict' }).issues.filter(i => i.category === 'content').length, 1);
    assert.equal(analyzeUI(baseline, target, { contentPolicy: 'selective', selectedNodeIds: ['title'] }).issues.filter(i => i.category === 'content').length, 0);
    assert.equal(analyzeUI(baseline, target, { contentPolicy: 'selective', selectedNodeIds: ['description'] }).issues.filter(i => i.category === 'content').length, 1);
    assert.throws(() => analyzeUI(baseline, target, { contentPolicy: 'selective', selectedNodeIds: ['unknown'] }));
});

test('container translation produces one position issue without repeated descendant displacement', () => {
    const { baseline, target, node } = paired();
    for (const n of target.nodes) if (n.id !== 'target-root') n.bounds.value.x += 12;
    const result = analyzeUI(baseline, target);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].baselineNodeId, 'panel');
    assert.equal(result.issues[0].difference.delta, 12);
    assert.equal(result.issues[0].category, 'position');
    assert.equal(node('title').bounds.value.x, 52);
});

test('parent padding explains identical child position shifts without hiding independent typography', () => {
    const { baseline, target, node } = paired(); node('panel').layout.paddingLeft.value += 12;
    for (const n of target.nodes) if (!['target-root', 'target-panel'].includes(n.id)) n.bounds.value.x += 12;
    node('title').typography.fontWeight.value = 400;
    const result = analyzeUI(baseline, target);
    assert.deepEqual(result.issues.map(i => i.category).sort(), ['spacing', 'typography']);
    const padding = result.issues.find(i => i.property === 'layout.paddingLeft');
    assert.equal(padding.suppressedIssues.length, 4);
});

test('missing and extra elements are reported once with container coordinates for absence', () => {
    const { baseline, target } = paired();
    target.nodes = target.nodes.filter(n => n.id !== 'target-description');
    target.relationships = target.relationships.filter(r => r.to !== 'target-description');
    const result = analyzeUI(baseline, target);
    const missing = result.issues.filter(i => i.property === 'missing');
    assert.equal(missing.length, 1); assert.equal(missing[0].baselineNodeId, 'description');
    assert.equal(missing[0].targetNodeId, null); assert.equal(missing[0].coordinateNodeId, 'target-panel');
    assert.equal(missing[0].reviewStatus, 'needs-review');
    const reverse = analyzeUI(target, baseline);
    assert.equal(reverse.issues.filter(i => i.property === 'extra').length, 1);
});

test('visual section order is independent of snapshot array order', () => {
    const { baseline, target, node } = paired();
    baseline.nodes = baseline.nodes.filter(n => n.id === 'root' || n.id === 'panel');
    baseline.relationships = baseline.relationships.filter(r => r.from === 'root');
    const second = structuredClone(baseline.nodes[1]); second.id = 'second'; second.text = 'Second panel'; second.bounds.value.y = 650; second.bounds.value.height = 100;
    baseline.nodes.push(second); baseline.relationships.push({ ...structuredClone(baseline.relationships[0]), to: 'second' });
    target.nodes = structuredClone(baseline.nodes).map(n => ({ ...n, id: `target-${n.id}` }));
    target.relationships = structuredClone(baseline.relationships).map(r => ({ ...r, from: `target-${r.from}`, to: `target-${r.to}` }));
    node('panel').bounds.value.y = 150; node('second').bounds.value.y = 20;
    target.nodes.reverse();
    const result = analyzeUI(baseline, target);
    const order = result.issues.find(i => i.category === 'order');
    assert.ok(order); assert.deepEqual(order.expected, ['target-panel', 'target-second']);
    assert.deepEqual(order.actual, ['target-second', 'target-panel']);
    assert.equal(result.issues.filter(i => i.category === 'position').length, 0);
});

test('heading-description and image-content geometry use explicit measured endpoints', () => {
    const { baseline, target, node } = paired();
    for (const [source, prefix] of [[baseline, ''], [target, 'target-']]) source.relationships.push({
        from: `${prefix}title`, to: `${prefix}description`, type: 'heading-description',
        provenance: { sourceType: 'url', kind: 'computed', method: 'fixture semantic association' }, confidence: { score: 1 } });
    node('description').bounds.value.y += 10;
    const result = analyzeUI(baseline, target);
    const gap = result.issues.find(i => i.property === 'heading-description:description.gap');
    assert.ok(gap); assert.equal(gap.expected, 16); assert.equal(gap.actual, 26); assert.equal(gap.difference.delta, 10);
    for (const id of ['title', 'description', 'target-title', 'target-description']) assert.ok(gap.supportingMeasurements.some(s => s.nodeIds.includes(id)));
    assert.ok(gap.suppressedIssues.some(i => i.property === 'position.y'));
    const imagePair = paired();
    for (const [source, prefix] of [[imagePair.baseline, ''], [imagePair.target, 'target-']]) source.relationships.push({
        from: `${prefix}image`, to: `${prefix}description`, type: 'image-content',
        provenance: { sourceType: 'url', kind: 'computed', method: 'fixture semantic association' }, confidence: { score: 1 } });
    imagePair.node('image').bounds.value.x += 15;
    assert.ok(analyzeUI(imagePair.baseline, imagePair.target).issues.some(i => i.category === 'relationship' && i.property.startsWith('image-content')));
});

test('rendered gaps consolidate with CSS gap changes and preserve measured arithmetic', () => {
    for (const suppliedCSS of [true, false]) {
        const { baseline, target, node } = paired();
        const ids = ['title', 'description', 'save', 'image'];
        let y = 40;
        for (const id of ids) {
            const n = baseline.nodes.find(n => n.id === id); n.bounds.value.y = y;
            node(id).bounds.value.y = y + ids.indexOf(id) * 12;
            y += n.bounds.value.height + 16;
        }
        if (suppliedCSS) {
            baseline.nodes.find(n => n.id === 'panel').layout.rowGap = measurement(16);
            node('panel').layout.rowGap = measurement(28);
        }
        const result = analyzeUI(baseline, target);
        assert.equal(result.issues.length, 1, JSON.stringify(result.issues.map(i => i.property)));
        const issue = result.issues[0];
        assert.equal(issue.property, suppliedCSS ? 'layout.rowGap' : 'renderedRowGaps');
        assert.equal(issue.difference.delta, 12);
        assert.ok(issue.suppressedIssues.length >= 3);
        if (!suppliedCSS) { assert.deepEqual(issue.expected, [16, 16, 16]); assert.deepEqual(issue.actual, [28, 28, 28]); }
    }
});

test('row and column alignment compare measured edges and centers', () => {
    for (const axis of ['row', 'column']) {
        const { baseline, target, node } = paired();
        baseline.nodes = baseline.nodes.filter(n => ['root', 'panel', 'save', 'image'].includes(n.id));
        baseline.relationships = baseline.relationships.filter(r => baseline.nodes.some(n => n.id === r.to));
        baseline.nodes.find(n => n.id === 'panel').layout.flexDirection = measurement(axis);
        const save = baseline.nodes.find(n => n.id === 'save'), img = baseline.nodes.find(n => n.id === 'image');
        if (axis === 'row') { save.bounds.value = { x: 40, y: 40, width: 100, height: 100 }; img.bounds.value = { x: 160, y: 40, width: 100, height: 100 }; }
        else { save.bounds.value = { x: 40, y: 40, width: 100, height: 100 }; img.bounds.value = { x: 40, y: 160, width: 100, height: 100 }; }
        target.nodes = structuredClone(baseline.nodes).map(n => ({ ...n, id: `target-${n.id}` }));
        target.relationships = structuredClone(baseline.relationships).map(r => ({ ...r, from: `target-${r.from}`, to: `target-${r.to}` }));
        node('image').bounds.value[axis === 'row' ? 'y' : 'x'] += 10;
        const result = analyzeUI(baseline, target);
        const issue = result.issues.find(i => i.category === 'alignment');
        assert.ok(issue, JSON.stringify(result.issues)); assert.equal(issue.difference.delta, 10);
        assert.equal(result.issues.filter(i => i.category === 'position').length, 0);
    }
});

test('container content-box resizing suppresses stretched descendants only', () => {
    const { baseline, target, node } = paired();
    const group = { id: 'group', role: 'group', text: 'Group', bounds: measurement({ x: 40, y: 400, width: 560, height: 100 }) };
    baseline.nodes.push(group); target.nodes.push({ ...structuredClone(group), id: 'target-group' });
    baseline.relationships.push({ ...structuredClone(baseline.relationships[1]), to: 'group' });
    target.relationships.push({ ...structuredClone(target.relationships[1]), to: 'target-group' });
    node('panel').bounds.value.width += 60; node('group').bounds.value.width += 60;
    let result = analyzeUI(baseline, target);
    assert.equal(result.issues.filter(i => i.category === 'dimensions').length, 1);
    assert.ok(result.issues.find(i => i.property === 'bounds.width').suppressedIssues.some(i => i.baselineNodeId === 'group'));
    node('group').bounds.value.width += 10;
    result = analyzeUI(baseline, target);
    assert.equal(result.issues.filter(i => i.category === 'dimensions').length, 2);
});

test('measured parent alignment explains child motion without hiding an independent offset', () => {
    const { baseline, target, node } = paired();
    baseline.nodes = baseline.nodes.filter(n => ['root', 'panel', 'save', 'image'].includes(n.id));
    baseline.relationships = baseline.relationships.filter(r => baseline.nodes.some(n => n.id === r.to));
    const panel = baseline.nodes.find(n => n.id === 'panel'); panel.layout.flexDirection = measurement('row'); panel.layout.alignItems = measurement('center');
    const save = baseline.nodes.find(n => n.id === 'save'), img = baseline.nodes.find(n => n.id === 'image');
    save.bounds.value = { x: 40, y: 270, width: 100, height: 100 };
    img.bounds.value = { x: 160, y: 280, width: 100, height: 80 };
    target.nodes = structuredClone(baseline.nodes).map(n => ({ ...n, id: `target-${n.id}` }));
    target.relationships = structuredClone(baseline.relationships).map(r => ({ ...r, from: `target-${r.from}`, to: `target-${r.to}` }));
    node('panel').layout.alignItems.value = 'flex-start'; node('save').bounds.value.y = 40; node('image').bounds.value.y = 40;
    let result = analyzeUI(baseline, target);
    assert.equal(result.issues.length, 1); assert.equal(result.issues[0].property, 'layout.alignItems');
    node('image').bounds.value.y += 8;
    result = analyzeUI(baseline, target);
    assert.ok(result.issues.length > 1, 'independent child offset must remain visible');
});

test('explicit relationship loss is not silently replaced by adjacency inference', () => {
    const { baseline, target } = paired();
    baseline.relationships.push({ from: 'title', to: 'description', type: 'heading-description',
        provenance: { sourceType: 'url', kind: 'computed', method: 'fixture association' }, confidence: { score: 1 } });
    const result = analyzeUI(baseline, target);
    const issue = result.issues.find(i => i.property === 'relationship.heading-description:description');
    assert.ok(issue); assert.equal(issue.expected, true); assert.equal(issue.actual, false);
});

test('removing a section collapses missing descendants; ambiguous matches require review', () => {
    const { baseline, target } = paired(); target.nodes = target.nodes.filter(n => n.id === 'target-root'); target.relationships = [];
    const result = analyzeUI(baseline, target);
    assert.equal(result.issues.filter(i => i.property === 'missing').length, 1);
    assert.equal(result.issues.find(i => i.property === 'missing').baselineNodeId, 'panel');
    const ambiguous = paired();
    const duplicate = structuredClone(ambiguous.node('save')); duplicate.id = 'target-other-save';
    ambiguous.target.nodes.push(duplicate);
    ambiguous.target.relationships.push({ ...structuredClone(ambiguous.target.relationships.find(r => r.to === 'target-save')), to: duplicate.id });
    const unresolved = analyzeUI(ambiguous.baseline, ambiguous.target);
    assert.ok(unresolved.diagnostics.some(d => d.code === 'uncertain-match' && d.baselineNodeId === 'save'));
    assert.ok(!unresolved.issues.some(i => i.property === 'missing' && i.baselineNodeId === 'save'));
});

test('unknown coordinates, viewport mismatch and estimated data preserve limitations', () => {
    const { baseline, target, node } = paired();
    node('title').bounds = unknown(); node('title').typography.fontSize = measurement(30);
    let result = analyzeUI(baseline, target);
    assert.equal(result.issues.find(i => i.property === 'typography.fontSize').targetCoordinates.status, 'unknown');
    const estimated = paired(); estimated.node('title').typography.fontSize.value = 30;
    estimated.node('title').typography.fontSize.provenance.kind = 'estimated'; estimated.node('title').typography.fontSize.confidence.score = 0.4;
    result = analyzeUI(estimated.baseline, estimated.target);
    assert.equal(result.issues[0].confidence.score, 0.4); assert.equal(result.issues[0].reviewStatus, 'needs-review');
    assert.equal(analyzeUI(estimated.baseline, estimated.target, { minConfidence: 0.5 }).issues.length, 0);
    const differentViewport = paired(); differentViewport.target.viewport.width = 900;
    differentViewport.node('panel').bounds.value.width += 20;
    result = analyzeUI(differentViewport.baseline, differentViewport.target);
    assert.equal(result.issues.length, 0); assert.ok(result.diagnostics.some(d => d.code === 'viewport-mismatch'));
});

test('new schema fields validate, color channels are not length-scaled, and invalid options fail', () => {
    const { baseline, target } = paired();
    for (const color of [{ r: -1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 256, a: 1 }, { r: 0, g: 0, b: 0, a: Infinity }]) {
        const bad = structuredClone(baseline); bad.nodes[2].typography.color = measurement(color); assert.throws(() => validateUISnapshot(bad));
    }
    assert.deepEqual(normalizeUISnapshot(baseline).nodes[2].typography.color.value, baseline.nodes[2].typography.color.value);
    for (const options of [{ contentPolicy: 'loose' }, { contentPolicy: 'selective' }, { selectedNodeIds: ['title'] },
        { tolerances: { position: NaN } }, { tolerances: { colorAlpha: 2 } }, { tolerances: { unknown: 1 } },
        { maxWork: 0 }, { matchingOptions: { minScore: null } }]) assert.throws(() => validateUIAnalysisOptions(options));
    const options = {}; let read = 0; Object.defineProperty(options, 'contentPolicy', { get() { read++; return 'strict'; } });
    assert.throws(() => analyzeUI(baseline, target, options)); assert.equal(read, 0);
    assert.throws(() => analyzeUI(baseline, target, { maxWork: 1 }), /work limit/);
    target.scope.kind = 'company'; assert.throws(() => analyzeUI(baseline, target), /scope/);
});


test('optional analysis phase observer reports real matcher and comparison boundaries', () => {
    const { baseline, target } = paired();
    const phases = [];
    const observed = analyzeUI(baseline, target, {}, phase => phases.push(phase));
    assert.deepEqual(phases, ['matching', 'comparing']);
    assert.deepEqual(observed, analyzeUI(baseline, target));
    const invalid = structuredClone(target); invalid.scope.id = 'different';
    const failed = [];
    assert.throws(() => analyzeUI(baseline, invalid, {}, phase => failed.push(phase)), /scope/);
    assert.deepEqual(failed, ['matching']);
});
