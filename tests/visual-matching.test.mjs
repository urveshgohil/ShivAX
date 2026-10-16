import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { matchUISnapshots } from 'shivax';
import { scene, page, corpus } from './fixtures/visual-matching.mjs';

const pairs = result => new Set(result.matches.map(m => JSON.stringify([m.referenceId, m.targetId])));
test('labeled hierarchical matching corpus: positive and missing/extra cases', t => {
    let tp = 0, fp = 0, fn = 0;
    for (const fixture of corpus) {
        const result = matchUISnapshots(fixture.reference, fixture.target);
        const actual = pairs(result), expected = new Set(fixture.expected.map(p => JSON.stringify(p)));
        const correct = [...actual].filter(p => expected.has(p)).length;
        tp += correct; fp += actual.size - correct; fn += expected.size - correct;
        assert.deepEqual([...actual].sort(), [...expected].sort(), fixture.name);
        assert.equal(new Set(result.matches.map(m => m.targetId)).size, result.matches.length);
        assert.equal(new Set(result.matches.map(m => m.referenceId)).size, result.matches.length);
        for (const m of result.matches) {
            const calculated = m.evidence.reduce((sum, e) => sum + e.weight * e.similarity * e.reliability, 0) / m.evidence.reduce((sum, e) => sum + e.weight, 0);
            assert.equal(m.confidence.score, calculated);
            assert.ok(m.confidence.margin > 0.1);
        }
    }
    t.diagnostic(JSON.stringify({ corpus: 'five hand-labeled synthetic scenes', tp, fp, fn,
        precision: tp / (tp + fp), recall: tp / (tp + fn) }));
});

test('indistinguishable repeated cards remain uncertain, not forced by position or IDs', () => {
    const entries = [['root', 'main', 'Shop'], ['a', 'group', '', 'root', 0, 100],
        ['aa', 'heading', 'Same product', 'a', 0, 100], ['ab', 'button', 'Buy', 'a'],
        ['b', 'group', '', 'root', 400, 100], ['ba', 'heading', 'Same product', 'b', 400, 100], ['bb', 'button', 'Buy', 'b']];
    const result = matchUISnapshots(scene('r', entries), scene('t', entries));
    assert.deepEqual([...pairs(result)], [JSON.stringify(['rroot', 'troot'])]);
    assert.equal(result.uncertain.find(u => u.referenceId === 'ra').reason, 'ambiguous');
    assert.equal(result.uncertain.find(u => u.referenceId === 'raa').reason, 'unmatched-parent');
    assert.ok(result.unmatchedTarget.includes('ta'));
    assert.equal(result.uncertainTarget.find(u => u.targetId === 'ta').reason, 'ambiguous');
});

test('document anchoring does not force repeated titles or unrelated descendants', () => {
    const entries = [['root', 'document', 'Page'], ['a', 'group', '', 'root'], ['title-a', 'heading', 'Same title', 'a'],
        ['b', 'group', '', 'root'], ['title-b', 'heading', 'Same title', 'b']];
    const result = matchUISnapshots(scene('r-', entries), scene('t-', entries));
    assert.deepEqual(result.matches.map(m => [m.referenceId, m.targetId]), [['r-root', 't-root']]);
    const other = scene('t-', [['root', 'document', 'Other page'], ['title', 'button', 'Delete account', 'root']]);
    const unrelated = matchUISnapshots(scene('r-', [['root', 'document', 'Page'], ['title', 'button', 'Save settings', 'root']]), other);
    assert.ok(unrelated.matches.some(m => m.referenceId === 'r-root'));
    assert.ok(!unrelated.matches.some(m => m.referenceId === 'r-title'));
});

test('document recovery across framework wrappers stays inside the default work budget', () => {
    const entries = [['root', 'document', 'Page'], ['layout', 'generic', 'Aggregated document text', 'root']];
    for (let i = 0; i < 160; i++) entries.push([`title-${i}`, 'heading', `Unique title ${i}`, 'layout']);
    const baseline = scene('r-', entries);
    const target = scene('t-', [['root', 'document', 'Different page copy'], ['main', 'main', 'Changed aggregate text', 'root'],
        ...entries.slice(2).map(([id, role, text]) => [id, role, text, 'main'])]);
    const result = matchUISnapshots(baseline, target);
    assert.equal(result.matches.filter(m => m.level === 'element').length, 160);
    assert.ok(result.work < 250_000);
});

test('negative pairs reject unrelated text, role conflicts and missing context', () => {
    for (const [a, b] of [[['a', 'heading', 'Alpha'], ['b', 'heading', 'Omega']],
        [['a', 'button', 'Continue'], ['b', 'image', 'Continue']],
        [['a', 'group', ''], ['b', 'group', '']]]) {
        const result = matchUISnapshots(scene('r', [a]), scene('t', [b]));
        assert.equal(result.matches.length, 0);
        assert.equal(result.unmatchedReference.length, 1);
        assert.equal(result.unmatchedTarget.length, 1);
    }
});

test('estimated geometry and hierarchy quality remain visible in evidence', () => {
    const ref = scene('r', page), target = scene('t', page);
    for (const n of target.nodes) {
        n.bounds.provenance.kind = 'estimated'; n.bounds.confidence.score = 0.7;
    }
    // Reliable component anchors still allow matching; weak measurements are not promoted.
    const result = matchUISnapshots(ref, target);
    assert.equal(result.matches.length, page.length);
    for (const m of result.matches) {
        const geometry = m.evidence.find(e => e.signal === 'geometry');
        if (geometry) assert.equal(geometry.reliability, 0.7);
    }
    const low = scene('t', page);
    for (const r of low.relationships) { r.provenance.kind = 'estimated'; r.confidence.score = 0.8; }
    const weak = matchUISnapshots(ref, low, { minScore: 0.5 });
    assert.ok(weak.matches.some(m => m.evidence.some(e => e.signal === 'parent' && e.reliability === 0.8)));
});

test('styling differences cannot change matching; flat geometry/role alone cannot establish identity', () => {
    const fixture = corpus[0], target = structuredClone(fixture.target);
    for (const n of target.nodes) {
        n.typography = { fontSize: { ...structuredClone(n.bounds), value: 500 } };
        n.layout = { marginTop: { ...structuredClone(n.bounds), value: -200 } };
        if (n.bounds.status === 'known') { n.bounds.value.x += 400; n.bounds.value.y += 80; }
    }
    assert.deepEqual(pairs(matchUISnapshots(fixture.reference, target)), pairs(matchUISnapshots(fixture.reference, fixture.target)));
    assert.equal(matchUISnapshots(scene('r', [['a', 'image', '']]), scene('t', [['a', 'image', '']])).matches.length, 0);
    assert.equal(matchUISnapshots(scene('r', [['a', 'heading', 'Save']]), scene('t', [['a', 'button', 'Save']])).matches.length, 0);
});

test('relationships are mapped through accepted endpoints; changed links are not fabricated', () => {
    const ref = scene('r', page), target = scene('t', page);
    const link = (from, to) => ({ from, to, type: 'labelled-by', provenance: { sourceType: 'url', kind: 'computed', method: 'fixture' }, confidence: { score: 1 } });
    ref.relationships.push(link('ralpha-button', 'ralpha-title'));
    target.relationships.push(link('talpha-button', 'talpha-title'));
    let result = matchUISnapshots(ref, target);
    assert.equal(result.relationships.matched.length, ref.relationships.length);
    target.relationships[target.relationships.length - 1].to = 'tbeta-title';
    result = matchUISnapshots(ref, target);
    assert.equal(result.relationships.missing.filter(r => r.type === 'labelled-by').length, 1);
    assert.equal(result.relationships.extra.filter(r => r.type === 'labelled-by').length, 1);
});

test('explicit labelled-by relationships disambiguate repeated controls after headings match', () => {
    const entries = [['root', 'main', 'Settings'], ['label-a', 'heading', 'Account', 'root'],
        ['label-b', 'heading', 'Privacy', 'root'], ['a', 'button', 'Open', 'root'], ['b', 'button', 'Open', 'root']];
    const ref = scene('r', entries), target = scene('t', entries);
    for (const [s, prefix] of [[ref, 'r'], [target, 't']]) for (const id of ['a', 'b']) s.relationships.push({
        from: `${prefix}${id}`, to: `${prefix}label-${id}`, type: 'labelled-by',
        provenance: { sourceType: 'url', kind: 'computed', method: 'fixture accessible labels' }, confidence: { score: 1 },
    });
    const result = matchUISnapshots(ref, target);
    assert.equal(result.matches.length, entries.length);
    assert.equal(result.matches.find(m => m.referenceId === 'ra').targetId, 'ta');
    assert.ok(result.matches.find(m => m.referenceId === 'ra').evidence.some(e => e.signal === 'relationships'));
});

test('normalized input, workspace isolation, options and bounded work are enforced', () => {
    const ref = scene('r', page), target = scene('t', page);
    const before = structuredClone([ref, target]);
    matchUISnapshots(ref, target); assert.deepEqual([ref, target], before);
    target.scope.kind = 'company'; assert.throws(() => matchUISnapshots(ref, target), /scope/);
    target.scope = { ...ref.scope, id: 'another-person' }; assert.throws(() => matchUISnapshots(ref, target), /scope/);
    target.scope = { ...ref.scope }; target.sourceType = 'png'; target.coordinates.unit = 'image-px';
    for (const n of target.nodes) { n.bounds.provenance = { sourceType: 'png', kind: 'estimated', method: 'fixture' }; }
    for (const r of target.relationships) r.provenance = { sourceType: 'png', kind: 'estimated', method: 'fixture' };
    assert.throws(() => matchUISnapshots(ref, target), /normalized/);
    for (const options of [{ minScore: NaN }, { ambiguityMargin: -1 }, { maxWork: Infinity }, { unknown: true }]) {
        assert.throws(() => matchUISnapshots(ref, ref, options));
    }
    assert.throws(() => matchUISnapshots(ref, ref, { maxWork: 1 }), /work limit/);
    assert.equal(createRequire(import.meta.url)('shivax').matchUISnapshots(ref, ref).matches.length, page.length);
});

test('unknown geometry, reordered input arrays and empty snapshots are supported', () => {
    const ref = scene('r', page), target = scene('t', page);
    for (const n of [...ref.nodes, ...target.nodes]) n.bounds = { status: 'unknown',
        provenance: { sourceType: 'url', kind: 'unknown', method: 'not measured' }, confidence: { score: null } };
    target.nodes.reverse(); target.relationships.reverse();
    assert.equal(matchUISnapshots(ref, target).matches.length, page.length);
    assert.equal(matchUISnapshots(scene('r', []), scene('t', [])).matches.length, 0);
});

test('reordered cards retain identity by group anchors rather than repeated button labels', () => {
    const ref = scene('r', page), target = scene('t', page);
    for (const n of target.nodes) {
        if (n.id.startsWith('talpha')) n.bounds.value.x += 400;
        if (n.id.startsWith('tbeta')) n.bounds.value.x -= 400;
    }
    target.nodes.reverse();
    const result = matchUISnapshots(ref, target);
    assert.equal(result.matches.find(m => m.referenceId === 'ralpha-button').targetId, 'talpha-button');
    assert.equal(result.matches.find(m => m.referenceId === 'rbeta-button').targetId, 'tbeta-button');
    assert.equal(result.matches.length, page.length);
});

test('large unique-text sibling sets match within the default budget without forcing repeated labels', () => {
    const entries = [['root', 'main', 'Catalog']];
    for (let i = 0; i < 600; i++) entries.push([`heading-${i}`, 'heading', `Unique service ${i}`, 'root', 0, i * 60]);
    const reference = scene('r-', entries), target = scene('t-', entries);
    target.nodes.reverse(); target.relationships.reverse();
    const result = matchUISnapshots(reference, target);
    assert.equal(result.matches.length, entries.length);
    for (const match of result.matches) assert.equal(match.targetId, match.referenceId.replace(/^r-/, 't-'));
    assert.ok(result.work < 250000);
    assert.throws(() => matchUISnapshots(reference, target, { maxWork: 1 }), /work limit/);
});
