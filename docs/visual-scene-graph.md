# UI scene graph — Phase 1

Shivax now accepts a dependency-free, versioned UI scene representation. This is
a data/geometry API, not a scanner, element matcher, comparison engine or trained
visual model. All exports are additive through `shivax` (ESM/CJS/declarations).
Tensor, NeuralNet, optimizers, model serialization and BagOfWords are unchanged.

See [the working TypeScript example](../examples/visual.ts). After `pnpm build`:

```sh
node --experimental-strip-types examples/visual.ts
```

## Data contract

`UISnapshot` version 1 contains `sourceType` (`url`, `figma`, `png`), `scope`,
`viewport`, `coordinates`, `nodes` and `relationships`. IDs are local to one
snapshot; they do not establish identity across sources. Scope has a `company`
or `personal` kind and a caller-owned namespace ID. Shivax performs no storage,
network access, global caching or cross-snapshot merging. Applications must
enforce workspace authorization and separate storage; scope metadata alone is
not a security boundary. Do not put secrets or personal content in reference IDs.

`UINode` has an ID and measured `bounds`, plus optional role, text, typography
and layout. Bounds contain x/y/width/height. Typography includes font family,
size, weight, numeric line height and letter/word spacing. Layout includes
display, four paddings, four margins and row/column gaps. Missing optional
properties are unavailable, not zero. CSS values such as unresolved `normal`,
percentages or `auto` must be resolved by the adapter or explicitly unknown;
Shivax never guesses them. Negative margins/letter spacing and coordinates are
valid; widths, heights, padding and gaps cannot be negative.

Every supplied property uses `Measurement<T>`:

| Status / provenance kind | Meaning | Confidence score |
| --- | --- | --- |
| known / computed | URL adapter's computed browser measurement | 1 |
| known / design | Figma design measurement, not a rendered browser observation | 1 |
| known / estimated | Image-derived or otherwise inferred value, including PNG data | finite 0–1 |
| unknown / unknown | No value supplied; `value` must be absent | null |

`SourceProvenance` records sourceType, kind, nonempty method and optional opaque
reference. PNG values cannot claim computed/design exactness. Provenance source
must agree with the snapshot for every property/relationship. Confidence is a
quality annotation, **not a calibrated probability**. A design score of 1 does
not mean Figma and browser rendering agree. Validation checks the contract, not
the truth of caller-supplied measurements. Normalizing estimates never promotes
them to exact measurements. Unknown bounds remain unknown, not empty rectangles.

`ElementRelationship` references two existing local IDs, a type (`parent-child`,
`contains`, `labelled-by`), provenance and confidence. Self/duplicate edges and
multiple parents/parent cycles are rejected. Relationships are supplied by the
adapter; Shivax does not infer them or verify claimed containment from geometry.
The parent-child subset forms a forest; other links need not form a tree.

## Coordinate normalization

`viewport.width`/`height` are always CSS pixels. `devicePixelRatio` is metadata,
not a conversion instruction. `coordinates` specifies a shared origin
(`viewport`, `document`, `artboard`), unit and `unitsPerCssPixel`:

- URL computed CSS pixels: `unit: 'css-px', unitsPerCssPixel: 1`.
- A PNG rendered at twice the CSS dimensions: `image-px`, scale 2.
- Figma design coordinates: `design-unit`, caller-specified scale (often 1).

Call `normalizeUISnapshot(input)` before using geometry helpers. It validates,
deep-copies, and divides coordinates, dimensions and typography/layout lengths
by scale, preserving fractional precision. Font weight, strings, confidence,
provenance, viewport and origin are unchanged. Output uses CSS pixels/scale 1;
`coordinates.original` retains original image/design unit and scale.
Normalization is idempotent and does not mutate the original snapshot.

Adapters must resolve frame-local transforms, rotation/skew into axis-aligned
bounds, scroll offsets and crop origins before supplying data. No implicit
origin translation, pixel decoding, DPR inference or image analysis occurs.
Do not compare rectangles with different origins/viewports without adapter-level
reconciliation. Full-page image dimensions are not necessarily the viewport.

## Validation API and limits

`validateUISnapshot(value)` and `validateComparisonOptions(value)` are TypeScript
assertion functions: return normally on success, throw TypeError on invalid
input. Individual assertion exports: `validateUINode`,
`validateBoundingRectangle`, `validateTypographyProperties`,
`validateLayoutProperties`, `validateElementRelationship`,
`validateSourceProvenance`, `validateConfidence`. Node/property/relationship
validators also take the expected source type; snapshot validation additionally
checks graph references and cycles.

Inputs must be plain data objects/arrays, not class instances or executable
hooks. Unexpected properties, accessors, nonfinite numbers and unsupported
versions are rejected. Limits: 10,000 nodes (`MAX_UI_NODES`), 40,000 links,
256-character IDs, 2,048-character text/method/reference values, absolute
coordinates/lengths up to 1e9, scale 1e-6 to 1e6, DPR 0.01 to 100. Rectangle
right/bottom edges must also remain within coordinate limits; normalization
revalidates outputs. Callers must limit incoming JSON bytes before parsing;
these APIs do not provide a hostile JavaScript Proxy sandbox or network parser.

`ComparisonOptions` currently validates optional `geometryToleranceCssPx`
(nonnegative), `minConfidence` (0–1), `compareTypography` and `compareLayout`
(booleans). It performs no comparison and introduces no matching defaults.

## Geometry utilities

Helpers accept **known, already normalized** `BoundingRectangle` values and
validate them without mutation. Numeric results are geometric calculations, not
AI estimates; callers must retain the provenance of their source bounds.

| Export | Semantics |
| --- | --- |
| `distance(a,b)` | Euclidean distance between centers |
| `relativePosition(a,b)` | Signed center displacement `{dx,dy}`; right/down positive |
| `overlap(a,b)` | `{rectangle, area, intersectionOverUnion}`; area in CSS px squared |
| `alignment(a,b,tolerance=0)` | left/right/top/bottom/centerX/centerY booleans |
| `horizontalGap(a,b)` | Directed `b.left - a.right` |
| `verticalGap(a,b)` | Directed `b.top - a.bottom` |
| `contains(outer,inner)` | Inclusive edge containment |

Touching edges have zero overlap and a null intersection rectangle. Empty union
has IoU 0; zero-sized bounds are allowed. Negative directed gaps mean overlapping
projections or reverse order, not necessarily overlapping rectangles. Alignment
tolerance is in CSS pixels, finite and nonnegative. No rounding is introduced.

## Checks and boundaries

`tests/visual.test.mjs` covers three source types, provenance/unknown values,
fractional normalization and defensive copies, malformed/oversized graphs,
cycles and accessors, independent validators, ESM/CJS exports, and hand-computed
geometry. Existing neural-network/worker/package tests continue to run.

No matching, comparison algorithm changes, scan runner, browser/UI dependencies,
storage, image extraction or application workflow is implemented in this phase.
