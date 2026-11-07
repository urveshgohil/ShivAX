import type { UISnapshot, UINode, ElementRelationship } from '../types.js';
import { validateUISnapshot } from '../validation.js';
import type { MatchCandidate, MatchingOptions, MatchingResult, MatchEvidence, ElementMatch } from './types.js';
export type { MatchingOptions, MatchingResult, MatchEvidence, MatchingSignal, MatchCandidate,
    ElementMatch, UncertainElement, UncertainTargetElement, RelationshipMatch } from './types.js';

const weights = { role: 0.25, content: 0.35, grouping: 0.20, structure: 0.20, parent: 0.25, siblings: 0.10, geometry: 0.05, relationships: 0.25 };
const levels = ['region', 'section', 'group', 'element'] as const;
const normalizeText = (text = '') => text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
const roleAliases: Record<string, string> = { img: 'image', p: 'paragraph', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', article: 'group', card: 'group', container: 'group',
    banner: 'header', contentinfo: 'footer', navigation: 'nav' };
function role(node: UINode): string {
    const value = normalizeText(node.role);
    return Object.prototype.hasOwnProperty.call(roleAliases, value) ? roleAliases[value] : value;
}
function level(node: UINode): number {
    const r = role(node);
    return ['document', 'main', 'header', 'footer', 'nav', 'region'].includes(r) ? 0 : r === 'section' ? 1 : ['group', '', 'generic'].includes(r) ? 2 : 3;
}
function similarity(a: string, b: string): number {
    if (a === b) return 1;
    const aa = new Set(a.split(' ')), bb = new Set(b.split(' '));
    return [...aa].filter(t => bb.has(t)).length / new Set([...aa, ...bb]).size;
}
function setSimilarity(a: Set<string>, b: Set<string>): number {
    return [...a].filter(x => b.has(x)).length / new Set([...a, ...b]).size;
}
type Scene = ReturnType<typeof scene>;
function scene(snapshot: UISnapshot, tick: () => void) {
    const nodes = new Map(snapshot.nodes.map(n => [n.id, n]));
    const rawParent = new Map<string, string>(), rawChildren = new Map<string, string[]>(), rawQuality = new Map<string, number>();
    for (const r of snapshot.relationships) {
        tick();
        if (r.type === 'parent-child') {
            rawParent.set(r.to, r.from);
            rawQuality.set(r.to, r.confidence.score!);
            const list = rawChildren.get(r.from) ?? []; list.push(r.to); rawChildren.set(r.from, list);
        }
    }
    const wrappers = new Set(snapshot.nodes.filter(n => {
        const r = role(n);
        return !normalizeText(n.text) && (rawChildren.get(n.id)?.length ?? 0) > 0 &&
            (r === '' || r === 'generic' || (normalizeText(n.role) === 'container' && rawChildren.get(n.id)!.length === 1));
    }).map(n => n.id));
    const parent = new Map<string, string | undefined>();
    const resolved = new Map<string, string | undefined>();
    const resolvedQuality = new Map<string, number>(), parentQuality = new Map<string, number>();
    for (const n of snapshot.nodes) {
        const path: string[] = []; let p = rawParent.get(n.id);
        while (p !== undefined && wrappers.has(p) && !resolved.has(p)) { tick(); path.push(p); p = rawParent.get(p); }
        let quality = p !== undefined ? resolvedQuality.get(p) ?? 1 : 1;
        if (p !== undefined && resolved.has(p)) p = resolved.get(p);
        for (let i = path.length - 1; i >= 0; i--) {
            quality = Math.min(quality, rawQuality.get(path[i]) ?? 1);
            resolved.set(path[i], p); resolvedQuality.set(path[i], quality);
        }
        parent.set(n.id, p);
        const raw = rawParent.get(n.id);
        parentQuality.set(n.id, Math.min(rawQuality.get(n.id) ?? 1, raw === undefined ? 1 : resolvedQuality.get(raw) ?? 1));
    }
    const children = new Map<string | undefined, string[]>();
    for (const n of snapshot.nodes) if (!wrappers.has(n.id)) {
        const p = parent.get(n.id);
        const list = children.get(p) ?? []; list.push(n.id); children.set(p, list);
    }
    // Visible control/image labels also anchor otherwise textless page regions.
    const anchors = new Map<string, Set<string>>();
    const anchorQuality = new Map<string, number>();
    const remaining = new Map<string, number>();
    const queue: string[] = [];
    for (const n of snapshot.nodes) if (!wrappers.has(n.id)) {
        anchors.set(n.id, new Set(normalizeText(n.text) ? [normalizeText(n.text)] : []));
        anchorQuality.set(n.id, 1);
        const count = children.get(n.id)?.length ?? 0; remaining.set(n.id, count);
        if (!count) queue.push(n.id);
    }
    for (let i = 0; i < queue.length; i++) {
        tick(); const id = queue[i], p = parent.get(id);
        if (p !== undefined) {
            const set = anchors.get(p)!;
            for (const text of anchors.get(id)!) {
                tick(); set.add(text);
                if (set.size > 16) set.delete([...set].sort()[set.size - 1]);
            }
            if (anchors.get(id)!.size) anchorQuality.set(p, Math.min(anchorQuality.get(p)!, parentQuality.get(id)!, anchorQuality.get(id)!));
            remaining.set(p, remaining.get(p)! - 1);
            if (remaining.get(p) === 0) queue.push(p);
        }
    }
    const links = new Map<string, ElementRelationship[]>();
    for (const r of snapshot.relationships) if (r.type !== 'parent-child') {
        const list = links.get(r.from) ?? []; list.push(r); links.set(r.from, list);
    }
    const structure = new Map<string, string>(), structureQuality = new Map<string, number>();
    const texts = new Map<string, string[]>(), regionCounts = new Map<string, number>();
    for (const n of snapshot.nodes) if (!wrappers.has(n.id)) {
        const kids = children.get(n.id) ?? [];
        const roles = kids.map(id => { tick(); return role(nodes.get(id)!); });
        // A semantic signature, independent of DOM order and visual styling.
        if (roles.length && roles.every(Boolean)) {
            structure.set(n.id, JSON.stringify(roles.sort()));
            structureQuality.set(n.id, Math.min(...kids.map(id => parentQuality.get(id)!)));
        }
        const text = normalizeText(n.text);
        if (text) {
            const key = JSON.stringify([role(n), text]);
            const list = texts.get(key) ?? []; list.push(n.id); texts.set(key, list);
        }
        if (level(n) === 0) regionCounts.set(role(n), (regionCounts.get(role(n)) ?? 0) + 1);
    }
    return { nodes, rawParent, rawChildren, parent, parentQuality, children, anchors, anchorQuality, wrappers, links,
        structure, structureQuality, texts, regionCounts };
}

/** Hierarchical semantic correspondence only. Does not compare styling or pixels. */
export function matchUISnapshots(reference: UISnapshot, target: UISnapshot, options: MatchingOptions = {}): MatchingResult {
    validateUISnapshot(reference); validateUISnapshot(target);
    if (reference.scope.kind !== target.scope.kind || reference.scope.id !== target.scope.id) throw new TypeError('Cannot match across workspace scopes');
    for (const s of [reference, target]) if (s.coordinates.unit !== 'css-px' || s.coordinates.unitsPerCssPixel !== 1) throw new TypeError('Matching requires normalized CSS pixels');
    if (!options || typeof options !== 'object' || Object.getPrototypeOf(options) !== Object.prototype) throw new TypeError('Invalid matching options');
    for (const key of Reflect.ownKeys(options)) {
        const descriptor = Object.getOwnPropertyDescriptor(options, key)!;
        if (typeof key !== 'string' || !['minScore', 'ambiguityMargin', 'maxWork'].includes(key) || !('value' in descriptor)) throw new TypeError('Invalid matching option');
    }
    const minScore = options.minScore === undefined ? 0.6 : options.minScore;
    const margin = options.ambiguityMargin === undefined ? 0.1 : options.ambiguityMargin;
    const maxWork = options.maxWork === undefined ? 250_000 : options.maxWork;
    if (![minScore, margin].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
        !Number.isSafeInteger(maxWork) || maxWork < 1 || maxWork > 1_000_000) throw new RangeError('Invalid matching thresholds/work limit');
    let work = 0;
    const tick = () => { if (++work > maxWork) throw new RangeError('UI matching work limit exceeded'); };
    const a = scene(reference, tick), b = scene(target, tick);
    const accepted = new Map<string, string>(), reverse = new Map<string, string>();
    const matches: ElementMatch[] = [];
    const meaningful = (s: Scene) => [...s.nodes.values()].filter(n => !s.wrappers.has(n.id)).sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    const aa = meaningful(a), bb = meaningful(b);
    const buckets = new Map<string, UINode[]>();
    for (const n of bb) { const key = JSON.stringify([b.parent.get(n.id) ?? null, level(n), role(n)]); const list = buckets.get(key) ?? []; list.push(n); buckets.set(key, list); }

    // Mappings are fixed within one search pass. Reuse hierarchy/sibling evidence
    // instead of walking the same DOM subtree for every candidate pair.
    let regionReference = new Map<string, string | undefined>(), regionTarget = new Map<string, string | undefined>();
    let siblingsReference = new Map<string, Set<string>>(), siblingsTarget = new Map<string, Set<string>>();
    function matchedRegion(s: Scene, id: string, mapping: Map<string, string>): string | undefined {
        const cache = s === a ? regionReference : regionTarget;
        if (cache.has(id)) return cache.get(id);
        let p = s.parent.get(id), closest: string | undefined;
        while (p !== undefined) {
            tick();
            if (mapping.has(p)) {
                closest ??= p;
                if (level(s.nodes.get(p)!) === 0) { cache.set(id, p); return p; }
            }
            p = s.parent.get(p);
        }
        cache.set(id, closest);
        return closest;
    }
    let localReference = new Map<string, Set<string>>(), localTarget = new Map<string, Set<string>>();
    function localAnchors(s: Scene, id: string, mapping: Map<string, string>, translate: boolean,
        cache: Map<string, Set<string>>): Set<string> {
        const cached = cache.get(id); if (cached) return cached;
        let p = s.rawParent.get(id);
        while (p !== undefined && level(s.nodes.get(p)!) !== 0) {
            tick();
            const found = new Set<string>(), stack = [...(s.rawChildren.get(p) ?? [])];
            while (stack.length) {
                tick(); const child = stack.pop()!;
                if (child === id) continue;
                if (mapping.has(child)) found.add(translate ? mapping.get(child)! : child);
                else for (const next of s.rawChildren.get(child) ?? []) stack.push(next);
            }
            if (found.size) { cache.set(id, found); return found; }
            // Only climb through a neutral single-child wrapper. An unrelated
            // component's accepted peers cannot stand in for local siblings.
            if (!s.wrappers.has(p) || (s.rawChildren.get(p)?.length ?? 0) > 1) break;
            p = s.rawParent.get(p);
        }
        const empty = new Set<string>(); cache.set(id, empty); return empty;
    }
    type Phase = 'anchor' | 'context' | 'all';
    function candidate(x: UINode, y: UINode, phase: Phase): MatchCandidate | undefined {
        tick();
        const p = a.parent.get(x.id), q = b.parent.get(y.id);
        const sameParent = (p === undefined && q === undefined) ||
            (p !== undefined && q !== undefined && accepted.has(p) && accepted.get(p) === q);
        const tx = normalizeText(x.text), ty = normalizeText(y.text);
        // Data-driven categories may move between cards. Different category names
        // do not establish comparable color/style identities through parent position.
        if (role(x) === 'category-badge' && (!tx || tx !== ty)) return;
        // Captured documents have one explicit scene root even when frameworks
        // change every wrapper and the root's aggregated text/child-role counts.
        // This establishes the document boundary, never descendant identity.
        const documentRoot = role(x) === 'document' && p === undefined && q === undefined &&
            a.regionCounts.get('document') === 1 && b.regionCounts.get('document') === 1;
        const textKey = JSON.stringify([role(x), tx]);
        const exactTargets = a.texts.has(textKey) ? b.texts.get(textKey) ?? [] : [];
        const uniqueText = Boolean(tx) && tx === ty && a.texts.get(textKey)?.length === 1 && exactTargets.length === 1;
        let wrapperContext = false;
        if (!sameParent) {
            if (!tx || tx !== ty) return;
            const ra = matchedRegion(a, x.id, accepted), rb = matchedRegion(b, y.id, reverse);
            if (ra === undefined || rb === undefined || accepted.get(ra) !== rb) return;
            if (!uniqueText) {
                // Duplicate labels need the same already-matched local siblings.
                // Retain raw wrapper membership only for this identity evidence.
                const sa = localAnchors(a, x.id, accepted, true, localReference);
                const sb = localAnchors(b, y.id, reverse, false, localTarget);
                wrapperContext = sa.size > 0 && sa.size === sb.size && [...sa].every(id => sb.has(id));
                if (!wrapperContext) return;
            }
        }
        // Do not let changed-content fallback steal an element with an exact
        // counterpart elsewhere, even if its old parent looks more similar.
        if (tx && tx !== ty && exactTargets.length) return;
        const evidence: MatchEvidence[] = [];
        const add = (signal: MatchEvidence['signal'], similarity: number, detail: string, reliability = 1) =>
            evidence.push({ signal, similarity, reliability, weight: weights[signal], detail });
        if (role(x)) add('role', 1, `same semantic role: ${role(x)}`);
        const content = !documentRoot && tx && ty ? similarity(tx, ty) : 0;
        if (!documentRoot && tx && ty) add('content', content, 'normalized visible-text token overlap');
        const ax = a.anchors.get(x.id)!, ay = b.anchors.get(y.id)!;
        // Only container descendants are component-group identity evidence.
        const grouping = !documentRoot && level(x) < 3 && ax.size && ay.size ? setSimilarity(ax, ay) : 0;
        if (!documentRoot && level(x) < 3 && ax.size && ay.size) add('grouping', grouping, 'shared descendant content anchors (up to 16)', Math.min(a.anchorQuality.get(x.id)!, b.anchorQuality.get(y.id)!));
        const sameStructure = Boolean(a.structure.get(x.id)) && a.structure.get(x.id) === b.structure.get(y.id);
        const rootStructure = documentRoot || (level(x) === 0 && p === undefined && q === undefined && sameStructure &&
            a.regionCounts.get(role(x)) === 1 && b.regionCounts.get(role(y)) === 1);
        const structureQuality = documentRoot ? 1 : Math.min(a.structureQuality.get(x.id) ?? 0, b.structureQuality.get(y.id) ?? 0);
        if (rootStructure) add('structure', 1, documentRoot ? 'unique explicit document scene roots' : 'unique semantic page region with identical child-role counts', structureQuality);
        if (p !== undefined || q !== undefined) {
            add('parent', sameParent ? 1 : 0, sameParent ? 'effective parent already matched (neutral wrappers skipped)' :
                'exact text recovered across parents inside an accepted page region', Math.min(a.parentQuality.get(x.id)!, b.parentQuality.get(y.id)!));
        }
        if (wrapperContext) add('siblings', 1, 'accepted local sibling identities agree across raw wrapper subtrees',
            Math.min(a.parentQuality.get(x.id)!, b.parentQuality.get(y.id)!));
        if (sameParent && p !== undefined) {
            let siblings = siblingsReference.get(p);
            if (!siblings) {
                siblings = new Set((a.children.get(p) ?? []).map(id => { tick(); return accepted.get(id); }).filter((id): id is string => id !== undefined));
                siblingsReference.set(p, siblings);
            }
            if (siblings.size) {
                let other = siblingsTarget.get(q!);
                if (!other) { other = new Set((b.children.get(q) ?? []).map(id => { tick(); return id; })); siblingsTarget.set(q!, other); }
                add('siblings', [...siblings].filter(id => other.has(id)).length / siblings.size, 'accepted siblings in the same component group', Math.min(a.parentQuality.get(x.id)!, b.parentQuality.get(y.id)!));
            }
        }
        const outgoing = (a.links.get(x.id) ?? []).filter(r => { tick(); return accepted.has(r.to); });
        if (outgoing.length) {
            const other = b.links.get(y.id) ?? [];
            const agreeing = outgoing.filter(r => other.some(t => { tick(); return t.type === r.type && t.to === accepted.get(r.to); }));
            const targetQuality = agreeing.map(r => other.find(t => t.type === r.type && t.to === accepted.get(r.to))!.confidence.score!);
            add('relationships', agreeing.length / outgoing.length, 'outgoing relationships to matched endpoints', Math.min(...outgoing.map(r => r.confidence.score!), ...targetQuality));
        }
        // Weak support only: normalized top-left within the matched parent/viewport.
        if (sameParent && x.bounds.status === 'known' && y.bounds.status === 'known' && reference.coordinates.origin === target.coordinates.origin) {
            const parentA = p === undefined ? undefined : a.nodes.get(p)!.bounds;
            const parentB = q === undefined ? undefined : b.nodes.get(q)!.bounds;
            const ra = parentA?.status === 'known' ? parentA.value : { x: 0, y: 0, ...reference.viewport };
            const rb = parentB?.status === 'known' ? parentB.value : { x: 0, y: 0, ...target.viewport };
            if (ra.width && ra.height && rb.width && rb.height) {
                const delta = Math.hypot((x.bounds.value.x - ra.x) / ra.width - (y.bounds.value.x - rb.x) / rb.width,
                    (x.bounds.value.y - ra.y) / ra.height - (y.bounds.value.y - rb.y) / rb.height);
                add('geometry', Math.max(0, 1 - delta), 'relative top-left proximity; no font, color, size or gap matching',
                    Math.min(x.bounds.confidence.score!, y.bounds.confidence.score!, parentA?.status === 'known' ? parentA.confidence.score! : 1, parentB?.status === 'known' ? parentB.confidence.score! : 1));
            }
        }
        const relationship = evidence.find(e => e.signal === 'relationships');
        const linked = Boolean(relationship && relationship.similarity * relationship.reliability >= 0.5);
        const anchored = content >= 0.5 || grouping * Math.min(a.anchorQuality.get(x.id)!, b.anchorQuality.get(y.id)!) >= 0.5 ||
            (rootStructure && structureQuality >= 0.5) || linked;
        // Shared nouns do not prove that two controls perform the same action.
        // Reworded actions need explicit matching relationship evidence.
        const conflictingControl = ['button', 'link', 'input', 'checkbox', 'radio', 'combobox', 'switch'].includes(role(x)) &&
            (!tx || tx !== ty) && !linked;
        const contextual = sameParent && p !== undefined && Boolean(role(x)) && !conflictingControl &&
            Math.min(a.parentQuality.get(x.id)!, b.parentQuality.get(y.id)!) > 0;
        if (phase === 'anchor' && !anchored) return;
        const supported = (anchored || contextual) && !conflictingControl;
        const denominator = evidence.reduce((sum, e) => sum + e.weight, 0);
        const score = supported && denominator ? evidence.reduce((sum, e) => sum + e.weight * e.similarity * e.reliability, 0) / denominator : 0;
        return { referenceId: x.id, targetId: y.id, score, evidence };
    }

    function search(currentLevel: number, phase: Phase = 'all') {
        // Accepted mappings change between stages; cached sibling sets must not.
        localReference = new Map(); localTarget = new Map();
        regionReference = new Map(); regionTarget = new Map();
        siblingsReference = new Map(); siblingsTarget = new Map();
        const rows = new Map<string, MatchCandidate[]>(), columns = new Map<string, MatchCandidate[]>();
        for (const x of aa) {
            tick(); if (accepted.has(x.id) || level(x) !== currentLevel) continue;
            const text = normalizeText(x.text);
            const exact = text ? b.texts.get(JSON.stringify([role(x), text])) : undefined;
            // candidate() already excludes different text when an exact counterpart
            // exists. Index the same eligible targets without evaluating every peer.
            // Non-exact recovery is eligible only inside an accepted parent.
            // Index that same candidate set instead of scanning every page peer.
            const parent = a.parent.get(x.id), targetParent = parent === undefined ? undefined : accepted.get(parent);
            const candidates = exact?.length ? exact.map(id => b.nodes.get(id)!) :
                parent !== undefined && targetParent === undefined ? [] : buckets.get(JSON.stringify([targetParent ?? null, currentLevel, role(x)])) ?? [];
            for (const y of candidates) {
                if (reverse.has(y.id)) continue;
                const c = candidate(x, y, phase); if (!c) continue;
                const row = rows.get(x.id) ?? []; row.push(c); rows.set(x.id, row);
                const col = columns.get(y.id) ?? []; col.push(c); columns.set(y.id, col);
            }
        }
        const sort = (list: MatchCandidate[]) => list.sort((x, y) => y.score - x.score ||
            (x.targetId < y.targetId ? -1 : x.targetId > y.targetId ? 1 : x.referenceId < y.referenceId ? -1 : x.referenceId > y.referenceId ? 1 : 0));
        for (const list of [...rows.values(), ...columns.values()]) sort(list);
        return { rows, columns };
    }
    // Coarse-to-fine passes; repeat after new parents/relationship anchors resolve.
    let progress = true;
    while (progress) {
        progress = false;
        // Resolve semantic anchors to a fixed point before structural fallback.
        for (const phase of ['anchor', 'context'] as const) {
          for (let stage = 0; stage < levels.length; stage++) {
            const { rows, columns } = search(stage, phase);
            const selected: { c: MatchCandidate; gap: number }[] = [];
            for (const row of rows.values()) {
                const c = row[0], column = columns.get(c.targetId)!;
                const gap = Math.min(c.score - (row[1]?.score ?? 0), c.score - (column[1]?.score ?? 0));
                if (column[0] === c && c.score >= minScore && gap > margin) selected.push({ c, gap });
            }
            for (const { c, gap } of selected) {
                accepted.set(c.referenceId, c.targetId); reverse.set(c.targetId, c.referenceId);
                matches.push({ ...c, confidence: { score: c.score, method: 'weighted-evidence-v1', margin: gap }, level: levels[stage] });
                progress = true;
            }
          }
          if (progress) break;
        }
    }
    const uncertain: MatchingResult['uncertain'] = [];
    const uncertainTarget: MatchingResult['uncertainTarget'] = [];
    for (let stage = 0; stage < levels.length; stage++) {
        const { rows, columns } = search(stage);
        for (const x of aa.filter(n => !accepted.has(n.id) && level(n) === stage)) {
            const row = rows.get(x.id) ?? [], p = a.parent.get(x.id);
            const blocked = p !== undefined && !accepted.has(p) && !row.some(c => c.score > 0);
            if (row.length || role(x) === 'category-badge' || (p !== undefined && !accepted.has(p))) uncertain.push({ referenceId: x.id,
                reason: blocked ? 'unmatched-parent' : row[0]?.score >= minScore ? 'ambiguous' : 'insufficient-evidence', candidates: row.slice(0, 3) });
        }
        for (const y of bb.filter(n => !reverse.has(n.id) && level(n) === stage)) {
            const column = columns.get(y.id) ?? [], p = b.parent.get(y.id);
            const blocked = p !== undefined && !reverse.has(p) && !column.some(c => c.score > 0);
            if (column.length || role(y) === 'category-badge' || (p !== undefined && !reverse.has(p))) uncertainTarget.push({ targetId: y.id,
                reason: blocked ? 'unmatched-parent' : column[0]?.score >= minScore ? 'ambiguous' : 'insufficient-evidence', candidates: column.slice(0, 3) });
        }
    }
    const relationships: MatchingResult['relationships'] = { matched: [], missing: [], extra: [], unresolvedReference: [], unresolvedTarget: [] };
    const key = (from: string, to: string, type: string) => JSON.stringify([from, to, type]);
    const targetEdges = new Map(target.relationships.map(r => [key(r.from, r.to, r.type), r]));
    const usedEdges = new Set<ElementRelationship>();
    const scores = new Map(matches.map(m => [m.referenceId, m.score]));
    for (const r of reference.relationships) {
        const from = accepted.get(r.from), to = accepted.get(r.to);
        if (!from || !to) { relationships.unresolvedReference.push(r); continue; }
        const t = targetEdges.get(key(from, to, r.type));
        if (!t) relationships.missing.push(r);
        else { usedEdges.add(t); relationships.matched.push({ reference: r, target: t, method: 'matched-endpoints-and-type',
            score: Math.min(r.confidence.score!, t.confidence.score!, scores.get(r.from)!, scores.get(r.to)!) }); }
    }
    for (const t of target.relationships) if (!usedEdges.has(t)) {
        if (!reverse.has(t.from) || !reverse.has(t.to)) relationships.unresolvedTarget.push(t);
        else relationships.extra.push(t);
    }
    return { matches, unmatchedReference: aa.filter(n => !accepted.has(n.id)).map(n => n.id),
        unmatchedTarget: bb.filter(n => !reverse.has(n.id)).map(n => n.id), uncertain, uncertainTarget,
        ignoredReferenceWrappers: [...a.wrappers].sort(), ignoredTargetWrappers: [...b.wrappers].sort(), relationships, work };
}
