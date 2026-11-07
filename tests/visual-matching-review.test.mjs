import assert from 'node:assert/strict';
import test from 'node:test';
import { matchUISnapshots, seededRandom } from 'shivax';
import { reviewCorpus } from './fixtures/visual-matching-review.mjs';
import { scene } from './fixtures/visual-matching.mjs';

test('review regressions: moved elements, controls, wrappers and copy changes', t => {
    let tp = 0, fp = 0, fn = 0;
    const failures = [];
    for (const fixture of reviewCorpus) {
        const result = matchUISnapshots(fixture.reference, fixture.target);
        const actual = new Set(result.matches.map(m => JSON.stringify([m.referenceId, m.targetId])));
        const expected = new Set(fixture.expected.map(pair => JSON.stringify(pair)));
        const correct = [...actual].filter(pair => expected.has(pair)).length;
        tp += correct; fp += actual.size - correct; fn += expected.size - correct;
        if (actual.size !== expected.size || correct !== expected.size) failures.push({ name: fixture.name,
            missing: [...expected].filter(pair => !actual.has(pair)), wrong: [...actual].filter(pair => !expected.has(pair)) });
    }
    t.diagnostic(JSON.stringify({ corpus: 'four review regressions', tp, fp, fn,
        precision: tp + fp ? tp / (tp + fp) : null, recall: tp / (tp + fn) }));
    assert.deepEqual(failures, []);
});

test('unrelated replacement controls and ambiguous duplicate labels are not forced', () => {
    const base = [['root', 'main', 'Account'], ['title', 'heading', 'Settings', 'root']];
    const ref = scene('r-', [...base, ['old', 'button', 'Cancel', 'root']]);
    const target = scene('t-', [...base, ['new', 'button', 'Archive', 'root']]);
    const result = matchUISnapshots(ref, target);
    assert.ok(result.unmatchedReference.includes('r-old'));
    assert.ok(result.unmatchedTarget.includes('t-new'));
    const duplicates = scene('t-', [...base, ['one', 'button', 'Cancel', 'root'], ['two', 'button', 'Cancel', 'root']]);
    assert.ok(matchUISnapshots(ref, duplicates).unmatchedReference.includes('r-old'));
});

test('duplicate controls follow matched sibling labels through group/generic wrappers', () => {
    const entries = [['root', 'main', 'Shop'],
        ['a', 'group', '', 'root'], ['label-a', 'heading', 'Analytics', 'a'], ['open-a', 'button', 'Open', 'a'],
        ['b', 'group', '', 'root'], ['label-b', 'heading', 'Automation', 'b'], ['open-b', 'button', 'Open', 'b']];
    const ref = scene('r-', entries);
    const target = scene('t-', entries.map(e => e[1] === 'group' ? [e[0], 'generic', ...e.slice(2)] : e));
    for (const [left, right, prefixA, prefixB] of [[ref, target, 'r-', 't-'], [target, ref, 't-', 'r-']]) {
        const result = matchUISnapshots(left, right);
        for (const id of ['root', 'label-a', 'label-b', 'open-a', 'open-b']) {
            assert.equal(result.matches.find(m => m.referenceId === `${prefixA}${id}`)?.targetId, `${prefixB}${id}`);
        }
    }
});

test('shared nouns do not turn contradictory action labels into matches', () => {
    const base = [['root', 'main', 'Account'], ['title', 'heading', 'Settings', 'root']];
    for (const [oldText, newText] of [['Delete user', 'Create user'], ['Enable alerts', 'Disable alerts'], ['Cancel', '']]) {
        const result = matchUISnapshots(scene('r-', [...base, ['action', 'button', oldText, 'root']]),
            scene('t-', [...base, ['action', 'button', newText, 'root']]));
        assert.ok(result.unmatchedReference.includes('r-action'), `${oldText} / ${newText}`);
    }
});

test('deterministic transformation sweep preserves identity without sharing IDs', t => {
    const random = seededRandom(73019);
    let tp = 0, fp = 0, fn = 0;
    for (let variant = 0; variant < 12; variant++) {
        const entries = [['root', 'main', 'Workspace']];
        const expectedIds = ['root'];
        for (let i = 0; i < 3 + variant % 4; i++) {
            entries.push([`card-${i}`, 'group', '', 'root', i * 220, 100],
                [`label-${i}`, 'heading', `Service ${i}`, `card-${i}`, i * 220, 100],
                [`open-${i}`, 'button', 'Open', `card-${i}`, i * 220, 170],
                [`image-${i}`, 'image', `Service illustration ${i}`, `card-${i}`, i * 220, 220]);
            if (variant % 2 === 0) expectedIds.push(`card-${i}`);
            expectedIds.push(`label-${i}`, `open-${i}`, `image-${i}`);
        }
        const targetEntries = structuredClone(entries).filter(e => !(variant % 3 === 0 && e[0] === 'open-1'));
        if (variant % 3 === 0) expectedIds.splice(expectedIds.indexOf('open-1'), 1);
        for (const e of targetEntries) {
            e[4] = Math.floor(random() * 800); e[5] = Math.floor(random() * 600);
            if (variant % 2 && e[1] === 'group') e[1] = 'generic';
            if (e[1] === 'heading') { e[1] = 'h3'; e[2] = `  ${e[2].toUpperCase()}  `; }
        }
        for (let i = targetEntries.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1)); [targetEntries[i], targetEntries[j]] = [targetEntries[j], targetEntries[i]];
        }
        targetEntries.push(['extra', 'button', 'Subscribe', 'root']);
        const ref = scene('before-', entries), target = scene('after-', targetEntries);
        const result = matchUISnapshots(ref, target);
        const expected = new Set(expectedIds.map(id => JSON.stringify([`before-${id}`, `after-${id}`])));
        const actual = new Set(result.matches.map(m => JSON.stringify([m.referenceId, m.targetId])));
        const correct = [...actual].filter(pair => expected.has(pair)).length;
        tp += correct; fp += actual.size - correct; fn += expected.size - correct;
        assert.deepEqual([...actual].sort(), [...expected].sort(), `variant ${variant}`);
        assert.deepEqual(matchUISnapshots(ref, target), result, 'repeat calls must be deterministic');
    }
    t.diagnostic(JSON.stringify({ corpus: '12 seeded transformation variants', tp, fp, fn,
        precision: tp / (tp + fp), recall: tp / (tp + fn) }));
});

test('cross-parent recovery stays inside accepted page regions', () => {
    const ref = scene('r-', [['header', 'header', 'Header'], ['footer', 'footer', 'Footer'],
        ['cancel', 'button', 'Cancel', 'header']]);
    const target = scene('t-', [['header', 'header', 'Header'], ['footer', 'footer', 'Footer'],
        ['cancel', 'button', 'Cancel', 'footer'], ['archive', 'button', 'Archive', 'header']]);
    const result = matchUISnapshots(ref, target);
    assert.ok(result.unmatchedReference.includes('r-cancel'));
    assert.equal(result.matches.length, 2);
});

test('ambiguous recovery candidates remain uncertain even after local siblings match', () => {
    const ref = scene('r-', [['root', 'main', 'Shop'], ['group', 'group', '', 'root'],
        ['label', 'heading', 'Analytics', 'group'], ['open', 'button', 'Open', 'group']]);
    const target = scene('t-', [['root', 'main', 'Shop'], ['group', 'generic', '', 'root'],
        ['label', 'heading', 'Analytics', 'group'], ['one', 'button', 'Open', 'group'], ['two', 'button', 'Open', 'group']]);
    const result = matchUISnapshots(ref, target);
    const uncertain = result.uncertain.find(u => u.referenceId === 'r-open');
    assert.equal(uncertain.reason, 'ambiguous');
    assert.equal(uncertain.candidates.length, 2);
    assert.ok(!result.matches.some(m => m.referenceId === 'r-open'));
});
