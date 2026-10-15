# Deterministic UI comparison — Phase 4

`analyzeUI(baseline, target, options?)` is exported from `shivax` in ESM, CJS and
TypeScript declarations. It validates normalized CSS-pixel `UISnapshot` data,
calls the existing `matchUISnapshots()` once, then compares available measured
properties. The result contains `issues`, `matching`, `diagnostics`,
`contentPolicy` and `work`. No model, browser, server or external dependency is
required. The matching algorithm and existing ML APIs are preserved.

See [the runnable TypeScript example](../examples/ui-analysis.ts):

```sh
pnpm build
node --experimental-strip-types examples/ui-analysis.ts
```

```ts
import { analyzeUI, normalizeUISnapshot } from 'shivax';

const result = analyzeUI(normalizeUISnapshot(baseline), normalizeUISnapshot(target), {
  contentPolicy: 'selective',
  selectedNodeIds: ['checkout-heading', 'price'], // baseline IDs
  geometryToleranceCssPx: 1,
  tolerances: { fontSize: 0.5, spacing: 2, colorChannel: 0 },
});
```

## Measurements and schema additions

Font family, size, weight, line height, letter/word spacing and alignment are
compared from known typography measurements. `TypographyProperties` now also
accepts `color: Measurement<RGBAColor>` with sRGB r/g/b in 0–255 and alpha a in
0–1, and `textAlign` (left/right/center/start/end/justify). Adapters resolve CSS
color expressions and canonical font stacks before submitting them. Color
channels and font weight are never length-scaled. Common font-family quoting,
case and whitespace differences are normalized; full CSS escape syntax and
quoted family names containing commas need adapter canonicalization.

`LayoutProperties` additionally accepts measured `flexDirection`, `alignItems`
and `justifyContent`. Declared padding/margins/gaps and layout properties are
compared directly. Actual rendered gaps are independently calculated from
adjacent matched sibling rectangles. A CSS gap is not assumed to equal a
rendered gap. Container and image widths/heights are compared; text-run widths
and heights are not independently reported as container defects.

Position uses a matched parent's local coordinates when available. Common parent
translation does not become repeated child movement. Root/absolute coordinates
are compared only with a shared origin. Viewport dimensions must agree for
bounds/gap/alignment/order checks; otherwise these checks are skipped with a
diagnostic while explicit CSS property comparisons still run. Different origins
can still use measured matched-parent coordinates. No scroll/frame offsets are
guessed.

Sibling flow uses measured flexDirection or a clearly nonoverlapping row/column.
Reading order comes from measured x/y positions, never node-array order. Wrapped
grids or overlapping layouts without a clear axis are not forced into an order.
Row centers/top/bottom and column left/center/right alignment are compared using
an aligned baseline edge. Gaps are directed edge differences; negative values
can represent overlap or reverse direction.

Typed `heading-description` and `image-content` links are optional additions to
`ElementRelationship.type`. Their measured endpoint gaps/alignment and link
presence are compared. Adjacent heading/paragraph or image/content siblings can
also supply an inferred association; its rule is recorded in supporting evidence
and the issue requires review. An explicitly missing link is not silently
replaced by an inferred link. One endpoint pair receives one geometric report
even if multiple semantic link types describe it.

## Content policies and uncertainty

- `structural` (default): ignores text changes; checks visual properties and
  structural presence/order. It does not automatically ignore geometry changes
  caused by dynamic content.
- `strict`: compares raw supplied text for every accepted match, including
  whitespace. Undefined text remains unknown, rather than an empty string.
- `selective`: compares text only for `selectedNodeIds`. IDs must exist in the
  baseline. All ordinary visual/structural checks remain active.

Missing/extra elements use canonical unmatched results. Missing parent subtrees
produce one structural issue. Ambiguous or blocked correspondences become
`uncertain-match` diagnostics, not definite missing/extra claims; the full
matching result remains available. Reworded controls may therefore need manual
review before a strict content comparison is possible.

## Thresholds and output

`UIAnalysisOptions` extends the existing `ComparisonOptions`. All numeric
thresholds are absolute and finite; a difference must be strictly greater than
the threshold. Defaults:

| Tolerance | Default |
| --- | --- |
| fontSize / lineHeight | 0.5 CSS px |
| letterSpacing / wordSpacing | 0.1 CSS px |
| fontWeight | 0 |
| colorChannel / colorAlpha | 0 |
| dimensions / position / spacing / alignment | geometryToleranceCssPx, default 1 CSS px |

`compareTypography` and `compareLayout` retain their existing meanings.
`minConfidence` defaults to 0 and filters lower-quality issues with a diagnostic.
`matchingOptions` is forwarded to the existing matcher. `maxWork` bounds analysis
work (default 250,000, maximum 1,000,000); the matching budget remains separate.
Analysis throws on work/issue limits (40,000 issues), without silently truncating
the result. Calls are synchronous; applications may run them in a Web Worker.

Each `UIIssue` contains a deterministic scope/node/property ID, category,
severity, baseline/target IDs, expected/actual values, signed numeric or channel
differences, supporting measurements and their original provenance, target
coordinates, a suggested correction, confidence and review status. Numeric
differences expose both signed delta and absolute magnitude; string/presence/
order changes use `changed: true`. Suggestions contain `automatic: false` and
are never executed or applied.

Coordinates refer to the actual target node; for a missing element they identify
the matched container via `coordinateNodeId`. The analyzer does not invent an
exact rectangle for an absent element. Unknown coordinates remain explicitly
unknown. Structural issues have high severity; other differences have medium
severity. These are deterministic triage rules, not accessibility certification.

Confidence is the minimum of relevant match scores and supplied measurement/link
qualities, with method `minimum-evidence-quality`. It is not a calibrated
probability. Exact input values remain exact even though correspondence is
inferred; every issue records inferred comparison provenance. Estimated evidence,
inferred semantic associations, structural absence and grouped parent causes
require review. Other new issues start unreviewed. No human review status is
fabricated or persisted. Raw PNG node text has no independent quality annotation
in the current schema, so strict text issues use quality 0 and require review.

## Duplicate suppression

The analyzer retains the measured evidence and suppressed issue IDs while
grouping observations explained by the same layout change:

- Parent padding and common container translation do not repeat as child shifts.
- A child that exactly fills the measured parent content box does not repeat a
  parent resize/padding defect as a separate dimension problem.
- Supplied start/center/end parent alignment can explain child motion when both
  snapshots' measured coordinates satisfy that alignment. Independent offsets
  remain visible.
- A measured CSS gap change can explain rendered gaps and progressive shifts.
  Repeated equal rendered-gap deltas can also form one inferred parent issue.
- A semantic gap/alignment report can include the same child-position change.
  An unchanged gap can identify downstream displacement after a preceding resize.
- Reordered siblings produce one group-order issue instead of repeated position
  issues along the ordering axis. Independent cross-axis/style changes remain.

These rules group observed equalities; they do not prove a browser's CSS causal
chain. Independent typography/dimension changes are preserved unless the measured
content-box equality supports suppression. `suppressedIssues`, related IDs and
supporting measurements retain the affected details.

## Validation and limits

`tests/ui-analysis.test.mjs` covers hand-specified differences in every requested
property group, all content policies, missing/extra/reordered structure, explicit
and inferred relationships, unknown/estimated values, scope isolation, tolerances,
duplicate suppression and ESM/CJS exports. Fixture measurements are specified
locally; they are not fabricated scan results or real-site accuracy metrics.

Adapters must supply reliable roles, parent links, canonical measurements and
viewport metadata. Font loading, transformed bounds, visual baselines of inline
glyphs and complex wrapped grids require extraction work in Inspectra. This phase
does not migrate its legacy comparison routes or create an application UI.
Matching ambiguity, especially rewritten versus replaced paragraphs, still
limits which comparisons can be made reliably. No LLM or SLM is used.
