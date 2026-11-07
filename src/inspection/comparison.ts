import { analyzeUI } from '../visual/analysis/index.js';
import type { UIAnalysisResult } from '../visual/analysis/types.js';
import type { UISnapshot, UINode } from '../visual/types.js';
import type { InspectionPair } from './types.js';

const label = (node: UINode) =>
    (node.text ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');

/** A flat screenshot interpretation is partial evidence, not a captured DOM tree. */
export function analyzeInspectionPair(pair: InspectionPair): UIAnalysisResult {
    const baseline = pair.baseline.snapshot,
        target = pair.target.snapshot;
    if (
        baseline.sourceType !== 'png' ||
        baseline.relationships.length ||
        baseline.nodes.some((n) => n.role)
    )
        return analyzeUI(baseline, target);

    const result: UIAnalysisResult = {
        issues: [],
        diagnostics: [],
        contentPolicy: 'structural',
        work: 0,
        matching: {
            matches: [],
            unmatchedReference: [],
            unmatchedTarget: [],
            uncertain: [],
            uncertainTarget: [],
            ignoredReferenceWrappers: [],
            ignoredTargetWrappers: [],
            relationships: {
                matched: [],
                missing: [],
                extra: [],
                unresolvedReference: [...baseline.relationships],
                unresolvedTarget: [...target.relationships],
            },
            work: 0,
        },
    };
    // Exclude aggregate ancestor text using actual DOM structure, without assigning
    // DOM roles or parentage to model observations. Validated inspection pairs have
    // at most 64 nodes per side and acyclic parent-child relationships.
    const parent = new Map(
        target.relationships.filter((r) => r.type === 'parent-child').map((r) => [r.to, r.from])
    );
    const ancestors = new Set<string>();
    for (const node of target.nodes)
        if (label(node)) {
            let id = parent.get(node.id);
            while (id !== undefined) {
                result.work++;
                ancestors.add(id);
                id = parent.get(id);
            }
        }
    const targets = target.nodes.filter(
        (n) => label(n) && !ancestors.has(n.id) && n.role !== 'document'
    );
    const byLabel = (nodes: readonly UINode[]) => {
        const groups = new Map<string, UINode[]>();
        for (const node of nodes) {
            result.work++;
            const text = label(node);
            if (text) groups.set(text, [...(groups.get(text) ?? []), node]);
        }
        return groups;
    };
    const references = byLabel(baseline.nodes),
        candidates = byLabel(targets);
    const matchedTargets = new Set<string>();
    // Compare only unique exact semantic anchors. Geometry cannot choose between
    // duplicate labels or establish identity for an unlabelled visual object.
    const single = (snapshot: UISnapshot, node: UINode): UISnapshot => ({
        ...snapshot,
        nodes: [{ ...node, role: undefined }],
        relationships: [],
    });
    for (const node of baseline.nodes) {
        const text = label(node),
            peers = candidates.get(text) ?? [];
        if (text && references.get(text)?.length === 1 && peers.length === 1) {
            // Reuse measured-property comparison in a shared flat frame, one pair
            // at a time, so no sibling gaps or hierarchy are invented by projection.
            const compared = analyzeUI(single(baseline, node), single(target, peers[0]));
            result.work += compared.work;
            result.matching.work += compared.matching.work;
            result.matching.matches.push(...compared.matching.matches);
            result.issues.push(...compared.issues);
            result.diagnostics.push(...compared.diagnostics);
            if (compared.matching.matches.length) {
                matchedTargets.add(peers[0].id);
                continue;
            }
        }
        result.matching.unmatchedReference.push(node.id);
        result.matching.uncertain.push({
            referenceId: node.id,
            reason:
                peers.length > 1 || (references.get(text)?.length ?? 0) > 1
                    ? 'ambiguous'
                    : 'insufficient-evidence',
            candidates: [],
        });
        result.diagnostics.push({
            code: 'uncertain-match',
            baselineNodeId: node.id,
            targetNodeId: null,
            property: 'presence',
            message:
                'Screenshot label has no unique exact DOM text counterpart; no missing element is inferred.',
        });
    }
    for (const node of target.nodes)
        if (!matchedTargets.has(node.id)) {
            result.matching.unmatchedTarget.push(node.id);
            result.matching.uncertainTarget.push({
                targetId: node.id,
                reason: 'insufficient-evidence',
                candidates: [],
            });
            result.diagnostics.push({
                code: 'uncertain-match',
                baselineNodeId: null,
                targetNodeId: node.id,
                property: 'presence',
                message:
                    'Partial screenshot observations do not establish DOM coverage; no extra element is inferred.',
            });
        }
    result.issues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return result;
}
