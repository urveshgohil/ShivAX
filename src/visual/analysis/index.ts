import type { BoundingRectangle, ElementRelationship, Measurement, RGBAColor, UISnapshot, UINode } from '../types.js';
import { matchUISnapshots } from '../matching/index.js';
import type { ElementMatch } from '../matching/types.js';
import { horizontalGap, verticalGap } from '../geometry.js';
import { resolveTolerances, validateUIAnalysisOptions } from './options.js';
import type { UIAnalysisOptions, UIAnalysisResult, UIIssue, UIIssueCategory, UIIssueDifference,
    UIIssueValue, UISupportingMeasurement } from './types.js';
export type { ContentPolicy, UITolerances, UIAnalysisOptions, UIIssueCategory, UIIssueValue,
    UIIssueDifference, UISupportingMeasurement, UISuppressedIssue, UIIssue, UIAnalysisDiagnostic, UIAnalysisResult } from './types.js';
export { validateUIAnalysisOptions } from './options.js';

function copy<T>(value: T): T {
    if (Array.isArray(value)) return value.map(copy) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
    return value;
}
function index(snapshot: UISnapshot, ignored: string[], tick: () => void) {
    const nodes = new Map(snapshot.nodes.map(n => [n.id, n]));
    const raw = new Map(snapshot.relationships.filter(r => r.type === 'parent-child').map(r => [r.to, r.from]));
    const wrappers = new Set(ignored), parent = new Map<string, string | undefined>(), cache = new Map<string, string | undefined>();
    const children = new Map<string | undefined, string[]>();
    for (const n of snapshot.nodes) if (!wrappers.has(n.id)) {
        tick(); let p = raw.get(n.id); const path: string[] = [];
        while (p !== undefined && wrappers.has(p) && !cache.has(p)) { tick(); path.push(p); p = raw.get(p); }
        if (p !== undefined && cache.has(p)) p = cache.get(p);
        for (const id of path) cache.set(id, p);
        parent.set(n.id, p);
        const list = children.get(p) ?? []; list.push(n.id); children.set(p, list);
    }
    return { nodes, parent, children };
}
const heading = (n: UINode) => /^(heading|h[1-6])$/i.test(n.role ?? '');
const paragraph = (n: UINode) => /^(paragraph|p)$/i.test(n.role ?? '');
const image = (n: UINode) => /^(image|img)$/i.test(n.role ?? '');
const key = (...parts: unknown[]) => JSON.stringify(parts);

/** Deterministic comparison of measured properties through the canonical matcher. */
export function analyzeUI(baseline: UISnapshot, target: UISnapshot, options: UIAnalysisOptions = {}, onPhase?: (phase: 'matching' | 'comparing') => void): UIAnalysisResult {
    validateUIAnalysisOptions(options);
    // Matching validates scene data, normalization and workspace boundaries.
    onPhase?.('matching');
    const matching = matchUISnapshots(baseline, target, options.matchingOptions);
    onPhase?.('comparing');
    let work = 0;
    const tick = () => { if (++work > (options.maxWork ?? 250_000)) throw new RangeError('UI analysis work limit exceeded'); };
    const a = index(baseline, matching.ignoredReferenceWrappers, tick), b = index(target, matching.ignoredTargetWrappers, tick);
    const pairs = new Map(matching.matches.map(m => [m.referenceId, m]));
    const reverse = new Map(matching.matches.map(m => [m.targetId, m.referenceId]));
    const selected = new Set(options.selectedNodeIds ?? []);
    for (const id of selected) if (!a.nodes.has(id)) throw new TypeError(`Unknown baseline selection: ${id}`);
    const policy = options.contentPolicy ?? 'structural', tolerance = resolveTolerances(options);
    const issues: UIIssue[] = [], diagnostics: UIAnalysisResult['diagnostics'] = [];
    const lookup = new Map<string, UIIssue>();
    const geometry = options.compareLayout !== false && baseline.viewport.width === target.viewport.width && baseline.viewport.height === target.viewport.height;
    const diagnostic = (code: UIAnalysisResult['diagnostics'][number]['code'], id: string | null, targetId: string | null, property: string, message: string) => {
        tick(); diagnostics.push({ code, baselineNodeId: id, targetNodeId: targetId, property, message });
    };
    if (options.compareLayout !== false && !geometry) diagnostic('viewport-mismatch', null, null, 'viewport', 'Bounds, rendered gaps and alignment require equal CSS-pixel viewports; measured CSS properties are still compared.');
    const known = <T>(value: T, source: UISnapshot, method: string, score: number, estimated = false): Measurement<T> => ({ status: 'known', value,
        provenance: { sourceType: source.sourceType, kind: estimated || source.sourceType === 'png' ? 'estimated' : source.sourceType === 'figma' ? 'design' : 'computed', method }, confidence: { score } });
    const unknownCoordinates = (): Measurement<BoundingRectangle> => ({ status: 'unknown', provenance: { sourceType: target.sourceType, kind: 'unknown', method: 'target coordinates unavailable' }, confidence: { score: null } });
    const support = (side: 'baseline' | 'target', ids: string[], property: string, measurement: Measurement<UIIssueValue>, derivation?: string): UISupportingMeasurement =>
        ({ side, nodeIds: ids, property, measurement: copy(measurement), ...(derivation ? { derivation } : {}) });
    function emit(category: UIIssueCategory, property: string, id: string | null, targetId: string | null,
        expected: UIIssueValue, actual: UIIssueValue, difference: UIIssueDifference, measurements: UISupportingMeasurement[], score: number,
        relatedA: string[] = id === null ? [] : [id], relatedB: string[] = targetId === null ? [] : [targetId], coordinateId = targetId): UIIssue | undefined {
        tick();
        const quality = Math.min(score, ...measurements.filter(s => s.measurement.status === 'known').map(s => s.measurement.confidence.score!));
        if (quality < (options.minConfidence ?? 0)) { diagnostic('below-confidence', id, targetId, property, 'Issue omitted by minConfidence; scores are evidence quality, not calibrated probabilities.'); return; }
        const identity = key(category, id, targetId, property);
        if (lookup.has(identity)) return lookup.get(identity);
        if (issues.length >= 40_000) throw new RangeError('UI analysis issue limit exceeded');
        const coords = coordinateId === null ? undefined : b.nodes.get(coordinateId)?.bounds;
        const issue: UIIssue = {
            id: `ui:${encodeURIComponent(key(baseline.scope.kind, baseline.scope.id, category, id, targetId, property))}`,
            category, severity: category === 'structure' ? 'high' : 'medium', baselineNodeId: id, targetNodeId: targetId,
            relatedBaselineNodeIds: [...relatedA], relatedTargetNodeIds: [...relatedB], property,
            expected: copy(expected), actual: copy(actual), difference: copy(difference), supportingMeasurements: measurements,
            targetCoordinates: coords ? copy(coords) : unknownCoordinates(), coordinateNodeId: coordinateId,
            suggestedCorrection: { action: category === 'structure' ? expected === true ? 'Restore the missing element in its matched container.' : 'Review or remove the extra element.' :
                category === 'order' ? 'Restore the baseline visual order.' : `Review ${property} and restore the baseline value where intended.`, property, value: copy(expected), automatic: false },
            confidence: { score: quality, method: 'minimum-evidence-quality' }, provenance: { kind: 'inferred', method: 'deterministic-ui-analysis-v1' },
            reviewStatus: category === 'structure' || measurements.some(s => s.measurement.provenance.kind === 'estimated') ? 'needs-review' : 'unreviewed', suppressedIssues: [],
        };
        issues.push(issue); lookup.set(identity, issue); return issue;
    }
    function measured(id: string, targetId: string, property: string, x: Measurement<UIIssueValue> | undefined, y: Measurement<UIIssueValue> | undefined) {
        tick(); if (!x && !y) return;
        if (x?.status !== 'known' || y?.status !== 'known') { diagnostic('unknown-measurement', id, targetId, property, 'Property unavailable on one or both sides; no value was inferred.'); return; }
        return { x: x.value, y: y.value, support: [support('baseline', [id], property, x), support('target', [targetId], property, y)] };
    }
    function numeric(category: UIIssueCategory, property: string, m: ElementMatch, x: Measurement<number> | undefined, y: Measurement<number> | undefined, threshold: number) {
        const values = measured(m.referenceId, m.targetId, property, x, y);
        if (values && typeof values.x === 'number' && typeof values.y === 'number' && Math.abs(values.y - values.x) > threshold) {
            return emit(category, property, m.referenceId, m.targetId, values.x, values.y, { delta: values.y - values.x, absolute: Math.abs(values.y - values.x) }, values.support, m.score);
        }
    }
    const fromBounds = (node: UINode, value: number, derivation: string): Measurement<number> | undefined => node.bounds.status === 'known' ?
        { ...copy(node.bounds), value, provenance: { ...node.bounds.provenance, method: derivation } } : undefined;
    const local = new Map<string, { x: number; y: number }>();
    for (const m of matching.matches) {
        tick(); const x = a.nodes.get(m.referenceId)!, y = b.nodes.get(m.targetId)!;
        if (options.compareTypography !== false) {
            for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing'] as const) numeric('typography', `typography.${property}`, m, x.typography?.[property], y.typography?.[property], tolerance[property]);
            for (const property of ['fontFamily', 'textAlign'] as const) {
                const values = measured(x.id, y.id, `typography.${property}`, x.typography?.[property], y.typography?.[property]);
                const normalize = (value: UIIssueValue) => typeof value === 'string' ? property === 'fontFamily' ?
                    value.split(',').map(f => f.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').toLowerCase()).join(',') : value.trim().toLowerCase() : value;
                if (values && normalize(values.x) !== normalize(values.y)) emit(property === 'textAlign' ? 'alignment' : 'typography', `typography.${property}`, x.id, y.id, values.x, values.y, { changed: true }, values.support, m.score);
            }
            const color = measured(x.id, y.id, 'typography.color', x.typography?.color, y.typography?.color);
            if (color) {
                const c = color.x as RGBAColor, d = color.y as RGBAColor;
                if (['r', 'g', 'b'].some(k => Math.abs(d[k as 'r'] - c[k as 'r']) > tolerance.colorChannel) || Math.abs(d.a - c.a) > tolerance.colorAlpha) {
                    emit('color', 'typography.color', x.id, y.id, c, d, { channels: { r: d.r - c.r, g: d.g - c.g, b: d.b - c.b, a: d.a - c.a } }, color.support, m.score);
                }
            }
        }
        if (policy === 'strict' || (policy === 'selective' && selected.has(x.id))) {
            if (x.text !== undefined && y.text !== undefined && x.text !== y.text) emit('content', 'text', x.id, y.id, x.text, y.text, { changed: true }, [
                support('baseline', [x.id], 'text', known(x.text, baseline, 'supplied node text; PNG text has no separate quality annotation', baseline.sourceType === 'png' ? 0 : 1)),
                support('target', [y.id], 'text', known(y.text, target, 'supplied node text; PNG text has no separate quality annotation', target.sourceType === 'png' ? 0 : 1)),
            ], m.score);
            else if ((x.text === undefined) !== (y.text === undefined)) diagnostic('unknown-measurement', x.id, y.id, 'text', 'Text unavailable; undefined is not an empty string.');
        }
        if (options.compareLayout !== false) {
            for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap'] as const) numeric('spacing', `layout.${property}`, m, x.layout?.[property], y.layout?.[property], tolerance.spacing);
            for (const property of ['display', 'flexDirection', 'alignItems', 'justifyContent'] as const) {
                const values = measured(x.id, y.id, `layout.${property}`, x.layout?.[property], y.layout?.[property]);
                if (values && values.x !== values.y) emit(property === 'alignItems' || property === 'justifyContent' ? 'alignment' : 'position', `layout.${property}`, x.id, y.id, values.x, values.y, { changed: true }, values.support, m.score);
            }
        }
        if (!geometry) continue;
        if (x.bounds.status !== 'known' || y.bounds.status !== 'known') { diagnostic('unknown-measurement', x.id, y.id, 'bounds', 'Unknown bounds are not compared.'); continue; }
        const u = x.bounds.value, v = y.bounds.value;
        if (m.level !== 'element' || image(x)) for (const dim of ['width', 'height'] as const) numeric('dimensions', `bounds.${dim}`, m, fromBounds(x, u[dim], `bounds.${dim}`), fromBounds(y, v[dim], `bounds.${dim}`), tolerance.dimensions);
        const p = a.parent.get(x.id), q = b.parent.get(y.id), pa = p === undefined ? undefined : a.nodes.get(p), pb = q === undefined ? undefined : b.nodes.get(q);
        let ex = u.x, ey = u.y, ax = v.x, ay = v.y;
        const supports = [support('baseline', [x.id], 'bounds', x.bounds), support('target', [y.id], 'bounds', y.bounds)];
        if (p !== undefined && q !== undefined && pairs.get(p)?.targetId === q && pa?.bounds.status === 'known' && pb?.bounds.status === 'known') {
            ex -= pa.bounds.value.x; ey -= pa.bounds.value.y; ax -= pb.bounds.value.x; ay -= pb.bounds.value.y;
            supports.push(support('baseline', [p], 'parent.bounds', pa.bounds), support('target', [q], 'parent.bounds', pb.bounds));
        } else if (baseline.coordinates.origin !== target.coordinates.origin) {
            diagnostic('coordinate-context', x.id, y.id, 'position', 'Origins differ and no matched measured parent can define a common local frame.'); continue;
        }
        local.set(x.id, { x: ax - ex, y: ay - ey });
        for (const [axis, expected, actual] of [['x', ex, ax], ['y', ey, ay]] as const) if (Math.abs(actual - expected) > tolerance.position) {
            emit('position', `position.${axis}`, x.id, y.id, expected, actual, { delta: actual - expected, absolute: Math.abs(actual - expected) }, copy(supports), m.score);
        }
    }

    const suppressed = new Map<string, UIIssue>();
    function suppress(child: UIIssue | undefined, cause: UIIssue | undefined, reason: string) {
        if (!child || !cause || child === cause || suppressed.has(child.id)) return;
        while (suppressed.has(cause.id)) cause = suppressed.get(cause.id)!;
        if (cause === child) return;
        suppressed.set(child.id, cause);
        cause.suppressedIssues.push({ id: child.id, baselineNodeId: child.baselineNodeId, targetNodeId: child.targetNodeId, property: child.property, reason });
        cause.suppressedIssues.push(...child.suppressedIssues);
        cause.relatedBaselineNodeIds = [...new Set([...cause.relatedBaselineNodeIds, ...child.relatedBaselineNodeIds])];
        cause.relatedTargetNodeIds = [...new Set([...cause.relatedTargetNodeIds, ...child.relatedTargetNodeIds])];
        cause.supportingMeasurements.push(...child.supportingMeasurements);
        cause.confidence.score = Math.min(cause.confidence.score, child.confidence.score);
        if (child.reviewStatus === 'needs-review') cause.reviewStatus = 'needs-review';
    }
    const find = (category: UIIssueCategory, id: string, property: string) => lookup.get(key(category, id, pairs.get(id)?.targetId ?? null, property));
    const delta = (issue: UIIssue | undefined): number | undefined => issue && 'delta' in issue.difference ? issue.difference.delta : undefined;
    function followsParentAlignment(id: string, targetId: string, p: string): boolean {
        const m = pairs.get(p); if (!m) return false;
        const pa = a.nodes.get(p)!, pb = b.nodes.get(m.targetId)!, x = a.nodes.get(id)!, y = b.nodes.get(targetId)!;
        const flow = pa.layout?.flexDirection;
        if (flow?.status !== 'known' || pb.layout?.flexDirection?.status !== 'known' || flow.value !== pb.layout.flexDirection.value) return false;
        const axis = flow.value.startsWith('row') ? 'y' : 'x', dimension = axis === 'x' ? 'width' : 'height';
        const start = axis === 'x' ? 'paddingLeft' : 'paddingTop', end = axis === 'x' ? 'paddingRight' : 'paddingBottom';
        for (const [parent, node] of [[pa, x], [pb, y]]) {
            const align = parent.layout?.alignItems, before = parent.layout?.[start], after = parent.layout?.[end];
            if (parent.bounds.status !== 'known' || node.bounds.status !== 'known' || align?.status !== 'known' || before?.status !== 'known' || after?.status !== 'known') return false;
            const kind = align.value.replace(/^flex-/, '');
            if (!['start', 'center', 'end'].includes(kind)) return false;
            const free = parent.bounds.value[dimension] - before.value - after.value - node.bounds.value[dimension];
            const expected = parent.bounds.value[axis] + before.value + (kind === 'center' ? free / 2 : kind === 'end' ? free : 0);
            if (Math.abs(node.bounds.value[axis] - expected) > tolerance.alignment) return false;
        }
        return true;
    }
    // Common parent translation is already removed by local coordinates.
    // Suppress observed shifts exactly explained by measured parent padding.
    for (const m of matching.matches) {
        const p = a.parent.get(m.referenceId); if (p === undefined || pairs.get(p)?.targetId !== b.parent.get(m.targetId)) continue;
        const offset = local.get(m.referenceId);
        for (const [axis, property] of [['x', 'paddingLeft'], ['y', 'paddingTop']] as const) {
            const cause = find('spacing', p, `layout.${property}`), d = delta(cause);
            if (offset && d !== undefined && Math.abs(offset[axis] - d) <= tolerance.position) suppress(find('position', m.referenceId, `position.${axis}`), cause, 'Local displacement equals the measured parent padding change.');
        }
        const alignCause = find('alignment', p, 'layout.alignItems');
        const flow = a.nodes.get(p)!.layout?.flexDirection;
        if (alignCause && flow?.status === 'known' && followsParentAlignment(m.referenceId, m.targetId, p)) suppress(find('position', m.referenceId, `position.${flow.value.startsWith('row') ? 'y' : 'x'}`), alignCause,
            'Measured child coordinates follow the supplied parent cross-axis alignment on both sides.');
        const parentA = a.nodes.get(p)!, parentB = b.nodes.get(pairs.get(p)!.targetId)!, nodeA = a.nodes.get(m.referenceId)!, nodeB = b.nodes.get(m.targetId)!;
        if (parentA.bounds.status === 'known' && parentB.bounds.status === 'known' && nodeA.bounds.status === 'known' && nodeB.bounds.status === 'known') {
            for (const [dim, start, end] of [['width', 'paddingLeft', 'paddingRight'], ['height', 'paddingTop', 'paddingBottom']] as const) {
                const left = parentA.layout?.[start], right = parentA.layout?.[end], actualLeft = parentB.layout?.[start], actualRight = parentB.layout?.[end];
                if (left?.status !== 'known' || right?.status !== 'known' || actualLeft?.status !== 'known' || actualRight?.status !== 'known') continue;
                if (Math.abs(nodeA.bounds.value[dim] - (parentA.bounds.value[dim] - left.value - right.value)) <= tolerance.dimensions &&
                    Math.abs(nodeB.bounds.value[dim] - (parentB.bounds.value[dim] - actualLeft.value - actualRight.value)) <= tolerance.dimensions) {
                    suppress(find('dimensions', m.referenceId, `bounds.${dim}`), find('dimensions', p, `bounds.${dim}`) ?? find('spacing', p, `layout.${start}`) ?? find('spacing', p, `layout.${end}`),
                        'Child dimensions equal the measured parent content-box dimensions on both sides.');
                }
            }
        }
    }

    const semanticPairs = new Map<string, { type: string; explicit: boolean; score: number; relationship?: ElementRelationship }>();
    for (const r of [...baseline.relationships].sort((x, y) => x.type < y.type ? -1 : x.type > y.type ? 1 : 0)) if (r.type === 'heading-description' || r.type === 'image-content') semanticPairs.set(key(r.from, r.to), { type: r.type, explicit: true, score: r.confidence.score!, relationship: r });
    const handledRelations = new Set<string>();
    const matchedSemanticPairs = new Map(matching.relationships.matched.filter(r => r.reference.type === 'heading-description' || r.reference.type === 'image-content').map(r => [key(r.reference.from, r.reference.to), r.score]));
    function comparePair(left: string, right: string, axis: 'x' | 'y', relation?: { type: string; explicit: boolean; score: number }) {
        tick(); const mx = pairs.get(left)!, my = pairs.get(right)!;
        if (relation?.explicit && !matchedSemanticPairs.has(key(left, right))) return;
        const x = a.nodes.get(left)!, y = a.nodes.get(right)!, xx = b.nodes.get(mx.targetId)!, yy = b.nodes.get(my.targetId)!;
        if (x.bounds.status !== 'known' || y.bounds.status !== 'known' || xx.bounds.status !== 'known' || yy.bounds.status !== 'known') return;
        const gap = axis === 'x' ? horizontalGap : verticalGap;
        const expected = gap(x.bounds.value, y.bounds.value), actual = gap(xx.bounds.value, yy.bounds.value);
        const derivation = relation ? `${relation.explicit ? 'supplied typed link' : 'inferred adjacent sibling roles'}: ${relation.type}; ${axis === 'x' ? 'horizontalGap' : 'verticalGap'} of measured endpoints` : 'rendered gap/alignment of adjacent matched siblings';
        const evidence = [support('baseline', [left], 'bounds', x.bounds, derivation), support('baseline', [right], 'bounds', y.bounds, derivation),
            support('target', [xx.id], 'bounds', xx.bounds, derivation), support('target', [yy.id], 'bounds', yy.bounds, derivation)];
        const score = Math.min(mx.score, my.score, relation?.score ?? 1, relation?.explicit ? matchedSemanticPairs.get(key(left, right))! : 1);
        const prefix = relation ? `${relation.type}:${right}` : `renderedGap.${axis}:${right}`;
        let gapIssue: UIIssue | undefined;
        if (Math.abs(actual - expected) > tolerance.spacing) {
            const issue = gapIssue = emit(relation ? 'relationship' : 'spacing', `${prefix}.gap`, left, xx.id, expected, actual,
                { delta: actual - expected, absolute: Math.abs(actual - expected) }, copy(evidence), score, [left, right], [xx.id, yy.id]);
            if (issue && relation && !relation.explicit) issue.reviewStatus = 'needs-review';
            const p = a.parent.get(left);
            if (p !== undefined && p === a.parent.get(right)) {
                const cause = find('spacing', p, `layout.${axis === 'y' ? 'rowGap' : 'columnGap'}`);
                if (delta(cause) !== undefined && Math.abs(actual - expected - delta(cause)!) <= tolerance.spacing) suppress(issue, cause, 'Rendered gap change equals the measured parent CSS gap change.');
            }
            const before = local.get(left), after = local.get(right);
            if (before && after) {
                const sizeDelta = yy.bounds.value[axis === 'x' ? 'width' : 'height'] - y.bounds.value[axis === 'x' ? 'width' : 'height'];
                const leftSizeDelta = xx.bounds.value[axis === 'x' ? 'width' : 'height'] - x.bounds.value[axis === 'x' ? 'width' : 'height'];
                for (const [id, explained] of [[right, Math.abs(before[axis]) <= tolerance.position && Math.abs(leftSizeDelta) <= tolerance.dimensions && Math.abs(after[axis] - (actual - expected)) <= tolerance.position],
                    [left, Math.abs(after[axis]) <= tolerance.position && Math.abs(sizeDelta) <= tolerance.dimensions && Math.abs(before[axis] + actual - expected) <= tolerance.position]] as const) {
                    if (!explained) continue;
                    const position = find('position', id, `position.${axis}`), cause = position ? suppressed.get(position.id) : undefined;
                    if (cause) suppress(issue, cause, 'Secondary gap change is explained by the same measured child displacement.');
                    else suppress(position, issue, 'The same child displacement is described by this rendered gap.');
                }
            }
        }
        // Preserve the baseline's actual aligned edge/center instead of guessing
        // alignment from tag names or comparing font-dependent text widths.
        const ua = x.bounds.value, ub = y.bounds.value, va = xx.bounds.value, vb = yy.bounds.value;
        const choices = axis === 'y' ? [
            ['left', ub.x - ua.x, vb.x - va.x], ['centerX', ub.x + ub.width / 2 - ua.x - ua.width / 2, vb.x + vb.width / 2 - va.x - va.width / 2],
            ['right', ub.x + ub.width - ua.x - ua.width, vb.x + vb.width - va.x - va.width],
        ] as const : [
            ['centerY', ub.y + ub.height / 2 - ua.y - ua.height / 2, vb.y + vb.height / 2 - va.y - va.height / 2],
            ['top', ub.y - ua.y, vb.y - va.y], ['bottom', ub.y + ub.height - ua.y - ua.height, vb.y + vb.height - va.y - va.height],
        ] as const;
        const aligned = choices.find(([, ex]) => Math.abs(ex) <= tolerance.alignment);
        if (aligned && Math.abs(aligned[2] - aligned[1]) > tolerance.alignment) {
            const issue = emit(relation ? 'relationship' : 'alignment', `${prefix}.${aligned[0]}`, left, xx.id, aligned[1], aligned[2],
                { delta: aligned[2] - aligned[1], absolute: Math.abs(aligned[2] - aligned[1]) }, copy(evidence), score, [left, right], [xx.id, yy.id]);
            if (issue && relation && !relation.explicit) issue.reviewStatus = 'needs-review';
            const parent = a.parent.get(left);
            if (parent !== undefined && parent === a.parent.get(right) && followsParentAlignment(left, xx.id, parent) && followsParentAlignment(right, yy.id, parent)) suppress(issue, find('alignment', parent, 'layout.alignItems'),
                'Rendered alignment follows the measured parent alignItems change.');
            const otherAxis = axis === 'x' ? 'y' : 'x', before = local.get(left), after = local.get(right);
            if (before && after && Math.abs(before[otherAxis]) <= tolerance.position && Math.abs(after[otherAxis] - (aligned[2] - aligned[1])) <= tolerance.position) suppress(find('position', right, `position.${otherAxis}`), issue, 'The same child displacement is described by this alignment measurement.');
        }
        if (Math.abs(actual - expected) <= tolerance.spacing) {
            const before = local.get(left), after = local.get(right), dimension = axis === 'x' ? 'width' : 'height';
            const sizeDelta = xx.bounds.value[dimension] - x.bounds.value[dimension];
            if (before && after && Math.abs(after[axis] - before[axis] - sizeDelta) <= tolerance.position) {
                const cause = find('dimensions', left, `bounds.${dimension}`) ?? find('position', left, `position.${axis}`);
                suppress(find('position', right, `position.${axis}`), cause, 'The unchanged rendered gap and preceding box resize/shift explain the downstream displacement.');
            }
        }
        return gapIssue;
    }

    if (geometry) for (const [p, ids] of a.children) {
        tick();
        const targetParent = p === undefined ? undefined : pairs.get(p)?.targetId;
        if (p !== undefined && targetParent === undefined) continue;
        const common = ids.filter(id => pairs.has(id) && b.parent.get(pairs.get(id)!.targetId) === targetParent && a.nodes.get(id)!.bounds.status === 'known' && b.nodes.get(pairs.get(id)!.targetId)!.bounds.status === 'known');
        if (common.length < 2) continue;
        const rect = (id: string, side: 'baseline' | 'target') => (side === 'baseline' ? a.nodes.get(id)!.bounds : b.nodes.get(pairs.get(id)!.targetId)!.bounds) as { status: 'known'; value: BoundingRectangle };
        const sort = (list: string[], axis: 'x' | 'y', side: 'baseline' | 'target') => [...list].sort((x, y) => rect(x, side).value[axis] - rect(y, side).value[axis] || (x < y ? -1 : x > y ? 1 : 0));
        const disjoint = (list: string[], axis: 'x' | 'y', side: 'baseline' | 'target') => list.every((id, i) => !i || rect(list[i - 1], side).value[axis] + rect(list[i - 1], side).value[axis === 'x' ? 'width' : 'height'] <= rect(id, side).value[axis]);
        const flow = p === undefined ? undefined : a.nodes.get(p)!.layout?.flexDirection;
        const explicitAxis = flow?.status === 'known' ? flow.value.startsWith('row') ? 'x' : 'y' : undefined;
        const axis: 'x' | 'y' | undefined = explicitAxis ?? (disjoint(sort(common, 'y', 'baseline'), 'y', 'baseline') ? 'y' : disjoint(sort(common, 'x', 'baseline'), 'x', 'baseline') ? 'x' : undefined);
        if (!axis) continue;
        const ordered = sort(common, axis, 'baseline'), actualOrder = sort(common, axis, 'target');
        const clearOrder = disjoint(ordered, axis, 'baseline') && disjoint(actualOrder, axis, 'target');
        const reordered = clearOrder && ordered.some((id, i) => id !== actualOrder[i]);
        if (reordered) {
            const owner = p ?? ordered[0], m = pairs.get(owner)!;
            const evidence = ordered.flatMap(id => [support('baseline', [id], 'bounds', a.nodes.get(id)!.bounds), support('target', [pairs.get(id)!.targetId], 'bounds', b.nodes.get(pairs.get(id)!.targetId)!.bounds)]);
            const issue = emit('order', 'visualOrder', owner, m.targetId, ordered.map(id => pairs.get(id)!.targetId), actualOrder.map(id => pairs.get(id)!.targetId), { changed: true }, evidence, Math.min(...ordered.map(id => pairs.get(id)!.score)), ordered, ordered.map(id => pairs.get(id)!.targetId));
            for (const id of ordered) suppress(find('position', id, `position.${axis}`), issue, 'Displacement along the ordering axis belongs to the same reordered sibling group.');
            continue;
        }
        const allReference = sort(ids.filter(id => a.nodes.get(id)!.bounds.status === 'known'), axis, 'baseline');
        const targetIds = b.children.get(targetParent) ?? [];
        const actualIndices = new Map([...targetIds].filter(id => b.nodes.get(id)!.bounds.status === 'known').sort((x, y) => {
            const xx = b.nodes.get(x)!.bounds, yy = b.nodes.get(y)!.bounds;
            return (xx as { value: BoundingRectangle }).value[axis] - (yy as { value: BoundingRectangle }).value[axis];
        }).map((id, i) => [id, i]));
        const gapIssues: UIIssue[] = [];
        for (let i = 1; i < ordered.length; i++) {
            const left = ordered[i - 1], right = ordered[i], mx = pairs.get(left)!, my = pairs.get(right)!;
            if (allReference.indexOf(right) !== allReference.indexOf(left) + 1 || actualIndices.get(my.targetId) !== actualIndices.get(mx.targetId)! + 1) continue;
            let relation = semanticPairs.get(key(left, right)), from = left, to = right;
            if (!relation && semanticPairs.has(key(right, left))) { relation = semanticPairs.get(key(right, left)); from = right; to = left; }
            if (!relation) {
                const x = a.nodes.get(left)!, y = a.nodes.get(right)!;
                if (heading(x) && paragraph(y)) relation = { type: 'heading-description', explicit: false, score: 1 };
                else if (image(x) && (heading(y) || paragraph(y) || pairs.get(right)!.level === 'group')) relation = { type: 'image-content', explicit: false, score: 1 };
                else if (image(y) && (heading(x) || paragraph(x) || pairs.get(left)!.level === 'group')) { relation = { type: 'image-content', explicit: false, score: 1 }; from = right; to = left; }
            }
            if (relation) handledRelations.add(key(from, to));
            const gapIssue = comparePair(from, to, axis, relation);
            if (gapIssue && !suppressed.has(gapIssue.id)) gapIssues.push(gapIssue);
            if (p !== undefined) {
                const gapChange = delta(find('spacing', p, `layout.${axis === 'y' ? 'rowGap' : 'columnGap'}`));
                const offset = local.get(right), first = local.get(ordered[0]);
                if (gapChange !== undefined && offset && first && Math.abs(offset[axis] - first[axis] - i * gapChange) <= tolerance.position) {
                    suppress(find('position', right, `position.${axis}`), find('spacing', p, `layout.${axis === 'y' ? 'rowGap' : 'columnGap'}`), 'Progressive displacement equals the cumulative measured CSS gap change.');
                }
            }
        }
        if (gapIssues.length >= 2 && gapIssues.length === ordered.length - 1) {
            const firstDelta = delta(gapIssues[0])!;
            if (gapIssues.every(issue => Math.abs(delta(issue)! - firstDelta) <= tolerance.spacing)) {
                const owner = p ?? ordered[0], m = pairs.get(owner)!;
                const group = emit('spacing', axis === 'y' ? 'renderedRowGaps' : 'renderedColumnGaps', owner, m.targetId,
                    gapIssues.map(i => i.expected as number), gapIssues.map(i => i.actual as number), { delta: firstDelta, absolute: Math.abs(firstDelta) },
                    [], Math.min(...gapIssues.map(i => i.confidence.score)), ordered, ordered.map(id => pairs.get(id)!.targetId));
                if (group) group.reviewStatus = 'needs-review';
                for (const issue of gapIssues) suppress(issue, group, 'Adjacent rendered gaps share the same measured delta; grouped as one inferred parent layout problem.');
                const firstOffset = local.get(ordered[0]);
                for (let i = 1; i < ordered.length; i++) {
                    const offset = local.get(ordered[i]);
                    if (offset && firstOffset && Math.abs(offset[axis] - firstOffset[axis] - i * firstDelta) <= tolerance.position) suppress(find('position', ordered[i], `position.${axis}`), group,
                        'Progressive displacement equals the cumulative observed rendered gap change.');
                }
            }
        }
    }
    if (geometry) for (const [identity, relation] of semanticPairs) {
        tick(); const r = relation.relationship!;
        if (!handledRelations.has(identity) && pairs.has(r.from) && pairs.has(r.to)) {
            const from = a.nodes.get(r.from)!.bounds, to = a.nodes.get(r.to)!.bounds;
            if (from.status === 'known' && to.status === 'known') comparePair(r.from, r.to,
                Math.abs(to.value.x - from.value.x) > Math.abs(to.value.y - from.value.y) ? 'x' : 'y', relation);
        }
    }
    if (options.compareLayout !== false) for (const [side, links] of [['baseline', matching.relationships.missing], ['target', matching.relationships.extra]] as const) {
        for (const r of links) {
            if (r.type === 'parent-child' || r.type === 'contains') continue;
            const id = side === 'baseline' ? r.from : reverse.get(r.from)!, targetId = pairs.get(id)!.targetId;
            const related = side === 'baseline' ? pairs.get(r.to)! : pairs.get(reverse.get(r.to)!)!;
            const expected = side === 'baseline', score = Math.min(pairs.get(id)!.score, related.score, r.confidence.score!);
            emit('relationship', `relationship.${r.type}:${related.referenceId}`, id, targetId, expected, !expected, { changed: true }, [
                support(side, [r.from, r.to], r.type, known(true, side === 'baseline' ? baseline : target, 'supplied typed relationship', r.confidence.score!, r.provenance.kind === 'estimated')),
            ], score, [id, related.referenceId], [targetId, related.targetId]);
        }
    }

    const uncertainA = new Set(matching.uncertain.map(u => u.referenceId)), uncertainB = new Set(matching.uncertainTarget.map(u => u.targetId));
    function absent(side: 'baseline' | 'target', ids: string[], uncertain: Set<string>) {
        const source = side === 'baseline' ? a : b;
        const unmatched = new Set(ids), missing = side === 'baseline';
        for (const id of ids) {
            tick(); let p = source.parent.get(id), ancestor = p; let covered = false;
            while (ancestor !== undefined) {
                tick(); if (unmatched.has(ancestor) && !uncertain.has(ancestor)) { covered = true; break; }
                ancestor = source.parent.get(ancestor);
            }
            if (covered) continue;
            if (uncertain.has(id)) { diagnostic('uncertain-match', missing ? id : null, missing ? null : id, 'presence', 'Unresolved correspondence requires review; not classified as a definite missing/extra element.'); continue; }
            let owner: ElementMatch | undefined;
            while (p !== undefined && !owner) { tick(); owner = missing ? pairs.get(p) : pairs.get(reverse.get(p) ?? ''); p = source.parent.get(p); }
            const score = owner?.score ?? 1, node = source.nodes.get(id)!;
            const quality = node.bounds.status === 'known' ? node.bounds.confidence.score! : (missing ? baseline : target).sourceType === 'png' ? 0 : 1;
            const baselineId = missing ? id : null, targetId = missing ? null : id;
            const parentId = missing ? owner?.targetId : owner?.referenceId;
            emit('structure', missing ? 'missing' : 'extra', baselineId, targetId, missing, !missing, { changed: true }, [
                support(side, [id], 'presence', known(true, missing ? baseline : target, 'node present in supplied snapshot', quality)),
                support(missing ? 'target' : 'baseline', parentId ? [parentId] : [], 'absence', known(false, missing ? target : baseline, 'unmatched after canonical one-to-one matching', score, true)),
            ], Math.min(score, quality), missing ? [id] : owner ? [owner.referenceId] : [], missing ? owner ? [owner.targetId] : [] : [id], missing ? owner?.targetId ?? null : id);
        }
    }
    absent('baseline', matching.unmatchedReference, uncertainA); absent('target', matching.unmatchedTarget, uncertainB);
    const sorted = issues.filter(issue => !suppressed.has(issue.id)).sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    return { issues: sorted, matching, diagnostics, contentPolicy: policy, work: work + matching.work };
}
