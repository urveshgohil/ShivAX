# Semantic element matching — Phase 3

`matchUISnapshots(reference, target, options?)` is an additive `shivax` export.
It consumes validated, **normalized CSS-pixel** `UISnapshot` objects, without
browser automation, image decoding, pixel comparison, ML dependencies or an SLM.
Existing neural-network APIs and scene-graph validation are unchanged.

```ts
import { normalizeUISnapshot, matchUISnapshots, type UISnapshot } from 'shivax';

function match(reference: UISnapshot, target: UISnapshot) {
  return matchUISnapshots(
    normalizeUISnapshot(reference), normalizeUISnapshot(target),
    { minScore: 0.6, ambiguityMargin: 0.1, maxWork: 250_000 },
  );
}
```

Snapshots must have identical `scope.kind` AND `scope.id`; crossing a company,
personal or other workspace boundary throws. Calls retain no global state or
data. This guard does not replace authorization in the Visynq application.

## One hierarchical implementation

1. Use supplied `parent-child` edges to construct a forest. Ignore textless
   generic/roleless wrappers with children, and single-child `container`
   wrappers. Keep semantic groups even when a wrapper is their sole child.
2. Match main/header/footer/nav/region nodes, then sections, then groups, then
   other semantic elements. Resolve content, labels and region anchors to a fixed
   point before contextual fallback. Control/image labels now contribute to
   region anchors, so a control-only page can establish its main region.
   Unique root regions can also use equal nonempty child-role counts when copy
   changes. Reordered sections can match by their content anchors.
3. Generate candidates with compatible normalized semantic roles and hierarchy
   levels. Common equivalents include heading/h1–h6, image/img, paragraph/p,
   group/article/card/container, header/banner, footer/contentinfo and
   nav/navigation. IDs only identify results; they are NOT matching signals.
4. Recover changed parentage within an already matched page region using unique
   exact text. Duplicate labels require equal sets of matched local sibling
   identities in the original wrapper subtrees. Global page peers cannot replace
   local siblings. A group/generic difference can therefore preserve descendant
   identity without pretending the unmatched group itself has a counterpart.
   Reserve an available exact-text counterpart before changed-content fallback;
   Cancel moved into a group must not be consumed by Archive at its old position.
5. Require reciprocal best candidates, a minimum evidence score, and a margin
   over both competing references and competing targets. Accept pairs together,
   never assign an element twice. Ties are not broken into artificial matches.
6. Map relationships by accepted endpoint pairs and relationship type. Missing,
   extra and unresolved links remain separate; no links are fabricated.

No DOM paths, class names or exact tags are required. Adapters must supply
semantic roles, visible text/image descriptions and explicit hierarchy when
available; the matcher does not infer a DOM tree from overlapping rectangles.
`contains` is a relationship signal, not an implicit parent edge (the scene
format permits cyclic/non-tree contains links). Neutral wrappers are reported
separately, not counted as missing semantic elements.

## Evidence and score calculation

All element correspondences are **inferred**, never exact measurements. Each
candidate returns source/target IDs and an `evidence` list containing signal,
similarity, reliability, weight and method detail. Accepted matches additionally
return `confidence: {score, method: 'weighted-evidence-v1', margin}` and level.

| Signal | Weight | Evidence |
| --- | --- | --- |
| Role | .25 | Same normalized semantic role |
| Content | .35 | NFKC/case/whitespace-normalized visible-text token Jaccard similarity; exact text = 1 |
| Grouping | .20 | Jaccard similarity of up to 16 lexically selected descendant text/label anchors |
| Structure | .20 | Equal nonempty child-role counts of a unique root region of the same semantic role |
| Parent | .25 | Already matched effective parent |
| Siblings | .10 | Accepted sibling correspondences in the same group, or agreeing local siblings across raw wrapper subtrees |
| Relative geometry | .05 | `max(0, 1 - normalizedTopLeftDistance)` within parents or viewports |
| Relationships | .25 | Supplied outgoing typed links to already matched endpoints |

For available signals only:

`score = sum(weight * similarity * reliability) / sum(weight)`.

Unknown/unavailable evidence is omitted, not assumed equal. Geometry reliability
uses the minimum supplied bounds quality; parent/group evidence incorporates
hierarchy-edge quality, and outgoing-link evidence incorporates relationship
quality from both scenes. Roles and visible text are unscored adapter metadata
in the current scene schema, so their reliability is assumed 1; this is a
limitation, not an assertion that image-extracted labels are certain.

Role or geometry alone cannot establish identity. An anchor candidate needs text
similarity >= .5, reliable group-anchor similarity >= .5, a reliable unique-root
structural signature, or corroborating relationships. Contextual fallback can
use an accepted parent and semantic role for changed heading/paragraph copy.
Action controls require equal normalized labels or corroborating relationships;
shared nouns such as “Delete user” / “Create user” are insufficient. Reworded or
missing action labels therefore remain uncertain without additional evidence.
Low-coverage pairs can remain uncertain even when their role agrees.
Geometry is omitted during cross-parent recovery or when origins differ;
when supplied parent bounds are unknown it falls back to viewport coordinates.
Widths/heights only normalize relative positions. Font sizes, typography,
padding, gaps, colors and layout style values are never matching features.

The fixed weights/thresholds are explicit engineering heuristics, not learned
confidence values. Scores and margins are calculated from actual input evidence
and returned for inspection; they are **not calibrated probabilities** or proof
of identity. No score is supplied as fabricated AI output. Application UI should
say “matching evidence score,” not “probability of a correct match.” A high score
can still be wrong, particularly after substantial content/group changes.

Defaults remain `minScore=.6`, `ambiguityMargin=.1`; neither was lowered for the
accuracy fixes. Both accept finite values 0–1.
Both row and column margins must be strictly greater than ambiguityMargin within
the current anchor/context phase. Anchor resolution takes precedence over
context-only alternatives, rather than combining all candidates in one pass.
Reducing thresholds trades precision for coverage; it does not add evidence.

## Output and ambiguity

- `matches`: accepted one-to-one pairs, level, evidence and derived confidence.
- `unmatchedReference` / `unmatchedTarget`: every unaccepted semantic ID,
  including uncertain nodes. These are not automatically missing/added defects.
- `uncertain` / `uncertainTarget`: candidates (up to three), with reasons
  ambiguous, insufficient-evidence or unmatched-parent. Blocked descendants
  have no proposed candidates unless supported recovery can bypass that parent.
- `ignoredReferenceWrappers` / `ignoredTargetWrappers`: collapsed adapter nodes.
- `relationships`: matched, missing, extra, unresolvedReference/Target. Endpoint
  uncertainty is not reported as a definite missing relationship. Link scores
  are minima of endpoint-match and original relationship evidence scores, with
  method `matched-endpoints-and-type`. Raw wrapper edges may remain unresolved;
  this is not a styling/completeness defect report.
- `work`: preprocessing/search budget consumed. Default maxWork=250,000; range
  1–1,000,000. Exceeding it throws RangeError, rather than returning silently
  truncated matches. Large repeated groups may require partitioning by known
  page regions. Calls are synchronous; applications can use a Web Worker.

Result relationship records refer to input relationship data. Treat these as
read-only. Matching itself does not mutate inputs.

## Verified evaluation

`tests/fixtures/visual-matching.mjs` supplies five hand-labeled synthetic scene
pairs: unchanged semantics, nested wrapper/role aliases, reordered sections,
changed paragraphs, and missing paragraph/added button. IDs differ between scenes;
expected correspondence is supplied separately, not generated by the matcher.

On those **74 labeled unambiguous pairs**: TP=74, FP=0, FN=0,
precision=TP/(TP+FP)=1.0, recall=TP/(TP+FN)=1.0. This small constructed corpus is
NOT real-site match accuracy, an independently sampled benchmark, or a claim of
generalization. Recall here excludes deliberately identity-ambiguous pairs.

Additional assertions cover abstention on indistinguishable cards, unrelated
content and role conflicts; repeated-button label relationships; geometry and
style changes; unknown bounds; estimated evidence; deterministic input reorder;
workspace boundaries; one-to-one assignment; malformed options; work limits;
input immutability; ESM/CJS exports. Run `pnpm test` for these and all existing
library regressions. No scanner result or scan-progress simulation is involved.

The accuracy review added a separate frozen set of four regressions in
`tests/fixtures/visual-matching-review.mjs`. Before editing the implementation,
these yielded TP=5, FP=1, FN=8: precision 83.3%, recall 38.5%. After the fixes they
yield TP=13, FP=0, FN=0: precision/recall 100% on those 13 expected pairs. The
original 74-pair corpus still passes unchanged.

An additional sweep uses seed 73019 across 12 transformations combining reordered
cards, different positions, heading aliases/case/whitespace, group/generic
wrappers, removed controls and added controls: TP=194, FP=0, FN=0. Additional
negative tests reject contradictory/missing action labels, ambiguous recovery
candidates, and cross-region relocation. Both directions of wrapper recovery
are checked. These synthetic evaluations validate specified behaviors; they
remain insufficient for a real-site accuracy estimate.

## Limitations / phase boundary

This is conservative reciprocal-best matching, not a global optimum assignment
or language model. Parent failure blocks descendants without supported recovery;
radically changed content, missing hierarchy/roles and identical repeated
components may remain unmatched. Reworded action labels can reduce recall by
design. A rewritten paragraph and a removed/replaced paragraph may have
indistinguishable input features: contextual matching can still confuse them.
Exact element IDs or richer adapter evidence would be needed to distinguish
those cases reliably; current local node IDs are never treated as stable IDs.
It uses token overlap, not language understanding, and accepts annotations from
adapters without verifying their visibility. Anchor storage is bounded at 16.
Recovery across changed semantic parenting is limited to an accepted page region
and strong content/sibling evidence. No real-site annotated dataset was available
in this phase.

Inspectra's legacy engines are untouched. Integration/migration to this single
ShivAX matcher, style-difference reporting, extraction, UI workflows, model
training and SLM features are not part of this implementation.
