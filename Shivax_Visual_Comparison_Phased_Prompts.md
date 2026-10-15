# Shivax AI + inspectra: Implementation plan and copy-ready prompts

Audit date: 14 October 2026. Inputs reviewed: `shivax(1).zip`, `inspectra.zip`.

## Rules for every Codex / Claude implementation turn

Paste this preface before each phase prompt:

> Work ONLY on the repository and phase specified below. Inspect relevant source, existing tests and package exports before editing. Preserve backward compatibility and do not rewrite unrelated code. Make the smallest maintainable changes. Never invent SLM capabilities or scan progress. Playwright, axe-core, Figma network access and browser streaming remain exclusively inside `inspectra`; `shivax` must be a reusable, browser-safe (when no optional provider is used), Playwright-free npm library. No pixel-to-pixel comparison as the primary engine. Create a short plan before edits, run relevant tests, then report changed files, exact commands, test results, limitations and next phase gate. Do not start the next phase automatically. Do not publish packages or change dependencies unless this phase explicitly requires it. Keep generated artifacts, tokens, credentials, datasets and reports out of version control.

## Verified audit summary

### Shivax (`package.json` name `shivax`, version `0.1.0`)

- TypeScript source under `src`, single public root export in `src/index.ts`, Rollup output `dist/index.cjs` and `dist/index.esm.js`.
- `Tensor`, `NeuralNet`, configurable activation functions, SGD/momentum/Adam, `toJSON`/`fromJSON`, evaluation utilities, `BagOfWords`.
- Phase 4 digit demo with model import/export and dashboard. `BagOfWords` is NOT an SLM, and the package currently has no SLM provider or visual analyzer.
- `node --test tests/*.test.mjs`: **64 passed** on the extracted build. Full rebuild/lint not rerun because installed dependencies and pnpm were unavailable in inspection environment.
- Package's `files` allowlist has bundled root JS files and `.d.ts`; if creating secondary subpaths, update exports, Rollup, and the allowlist deliberately. Simpler MVP: export the visual API from the existing root entry.

### Scanner (`package.json` private name `inspectra`)

- Existing dependencies: Playwright, axe-core, Lighthouse, optional pixelmatch/pngjs.
- `server.js` uses CommonJS, dynamically imports ESM `compare.js`, `dom-compare.js`, `ui-check.js`.
- `/api/compare` pixel-based URL/image/Figma raster comparison; `/api/compare-dom` DOM-path/tag/position matching; `/api/ui-check` structured UI inventory, positional matching, screenshot overlays and review controls.
- `ui/compare-3.html` currently uses a POST that resolves only after scanning and displays saved screenshots, NOT live browser feeds.
- `tests/ui-check/regression.mjs` contains positive and negative fixture cases. Scanner syntax checks passed, but its browser tests were not rerun because Playwright was not installed in the inspection environment.
- Current scan runs create files under `visual-reports/runs/` and retain a limited number of runs. Keep artifacts isolated per scan ID; watch collisions with older paths in compare modules.

## Architectural contract

`inspectra` --> normalized `UISnapshot` --> `shivax.analyzeUI({ baseline, target, policy })` --> structured matches + issues + streamable events --> scanner live UI.

Suggested versioned input (type definitions live in Shivax; extraction only in scanner):

```ts
type SourceKind = 'url' | 'figma' | 'image';
type EvidenceKind = 'measured' | 'design' | 'estimated';
interface UiRect { x: number; y: number; width: number; height: number; }
interface UiNode {
  id: string; parentId: string | null; order: number;
  role: string; tag?: string; text?: string; accessibleName?: string;
  rect: UiRect; textRect?: UiRect;
  typography?: Partial<Record<'fontFamily'|'fontSize'|'fontWeight'|'lineHeight'|'letterSpacing'|'wordSpacing'|'color', string | number>>;
  layout?: Record<string, string | number | boolean | null>;
  media?: { alt?: string; assetHint?: string; aspectRatio?: number };
  sourceEvidence: EvidenceKind;
  selectors?: string[]; // hints for browser highlight only; NEVER identity keys
}
interface UISnapshot {
  schemaVersion: 1;
  source: SourceKind;
  viewport: { width: number; height: number; deviceScaleFactor?: number };
  page: { width: number; height: number; url?: string };
  nodes: UiNode[];
  captureId?: string;
}
interface UiIssue {
  id: string; fingerprint: string; category: 'typography'|'spacing'|'layout'|'content'|'media'|'structure';
  severity: 'high'|'medium'|'low';
  baselineNodeId?: string; targetNodeId?: string;
  expected?: unknown; actual?: unknown; difference?: unknown;
  baselineRect?: UiRect; targetRect?: UiRect;
  confidence: number; evidence: EvidenceKind[]; explanation: string; recommendation: string;
}
```

Make `undefined`/missing-property semantics explicit; never silently convert unknown screenshot CSS values into zero. Snapshot rectangles use document CSS pixels for URL sources, Figma-frame-relative coordinates for Figma sources, and image pixels converted to selected CSS reference scale for PNG sources. Add `sourceEvidence` to distinguish measured vs inferred properties. Test serialized JSON schema and malformed inputs.

## Phase 0 — Freeze baseline and add shared fixture plan (both repos; audit first)

**Prompt:**

> Inspect BOTH repos as they are. In Shivax inspect `src/index.ts`, `src/nn/NeuralNet.ts`, `src/text/BagOfWords.ts`, `rollup.config.mjs`, `package.json`, `tests` and `docs`. In scanner inspect `server.js`, `compare.js`, `dom-compare.js`, `ui-check.js`, `ui/compare-3.html`, `tests/ui-check/regression.mjs`. Record current route contracts and regression expectations. Run existing tests (`node --test tests/*.test.mjs` in Shivax; install the scanner dependencies locally, then `npm run test:ui-check`), report precise blockers. Add an architecture document with the repository ownership rule. Add fixture acceptance cases: identical pages, different wrappers/classes, changed typography, 16px heading-description gap, changed column alignment, wrong image dimensions, one missing paragraph, dynamic content opted out, reordered cards. Do not change matching algorithms, UIs, public APIs or npm publication in this phase. Acceptance: baseline documented and tests characterized; no functional changes.

## Phase 1 — Shivax UI contracts and deterministic geometry primitives (Shivax only)

**Prompt:**

> In `shivax`, add an isolated `src/visual/` module with versioned TypeScript interfaces for `UISnapshot`, `UiNode`, `UiRect`, `UiMatch`, `UiIssue`, policies, tolerances and analysis events. Add runtime validation for malformed/untrusted JSON, coordinate bounds, element caps and string lengths. Implement pure, deterministic geometry utilities (horizontal/vertical gaps, overlap ratio, alignment, relative position, aspect ratio, comparable colors/units, normalized font values). Do NOT import Playwright, browser DOM, Node filesystem or external SLM runtime. Avoid changing `src/nn/*` or the digits demo. Export a minimal API from `src/index.ts` using the existing bundle pipeline. Add unit tests for geometry, unknown values, validation, reversed positions, negative/overlapping gaps and numerical tolerances. Run `pnpm lint`, `pnpm test`, `pnpm build`, `npm pack --dry-run --ignore-scripts`. Stop after the phase; show API and changed files. Acceptance: the package still loads ESM/CommonJS; no browser dependency; existing 64 tests continue passing plus new tests.

## Phase 2 — Scanner snapshot extraction adapter (scanner only)

**Prompt:**

> In `inspectra`, reuse `inspectPage`, `settlePage` and `VIEWPORTS` from `ui-check.js` where practical, but move reusable capture/extraction to a small module such as `scanner/browser-snapshot.js`. Implement `captureUISnapshot(page, options)` returning the Shivax `UISnapshot` contract. Extract semantic roles, accessible labels, meaningful text (configurable policy), stable session node IDs, parent IDs, sibling ordering, text glyph boxes, image boxes, typography, computed layout and measured geometry. Use the same logical browser viewport, DPR, font readiness, deterministic animation settings and scroll state for both captures. Normalize CSS px and selectors. Keep legacy `/api/ui-check` output functioning. No Shivax matching in this phase. Add extraction fixture tests for wrapper changes, HTML-equivalent nodes, font changes, image/content relationships, clipping and coordinates. Acceptance: two websites produce schema-valid snapshots with trustworthy geometry; existing scanner UI and regression tests are unchanged.

## Phase 3 — Shivax hierarchical matching and scene relationships (Shivax only)

**Prompt:**

> Implement `matchUI(baseline, target, options)` and UI relationship analysis in `src/visual/`. Match top-level sections first, then containers, then leaf elements. Use role, stable text/accessible-name similarity (when policy allows), parent/neighbor context, relative position and semantic order. Use optimal or bounded bipartite assignment within matched groups, not only DOM path or greedy nearest-neighbor matching. Do not depend on selectors, class names, raw tag equivalence or a close match in font/spacing to establish identity. Return one-to-one matches, unmatched nodes, scores, reasons and ambiguity status. Compare relationships: inside, above/below, left/right, same row/column, align-left/center/right, vertical/horizontal gap. If identity is ambiguous, return `needs_review` rather than invent a match. Add positive and negative fixture tests, including a large font mismatch that must not break matching. Acceptance: correct matches with reordered wrappers; no false missing issue solely from wrapper changes.

## Phase 4 — Shivax difference engine + scanner integration (both repos, Shivax first)

**Prompt:**

> Implement a deterministic `analyzeUI({ baseline, target, policy })` in Shivax. From established matches, compare exact typography, rendered text bounds, parent padding, margins, row/column gaps, alignment, image dimensions/aspect ratio, content and missing/extra components. Support `structural`, `strict` and `selective` content policies. Group related findings; assign the root cause at the parent when possible; deduplicate cascaded child movement issues. Emit schema-validated `UiIssue` with baseline/target nodes/rects, values, delta, evidence, confidence (derived from match quality and available data; never fake accuracy), and deterministic fix suggestions. Add unit tests. After Shivax passes, install the local built `shivax` package into scanner, add one `visual-comparison-service.js` adapter, and introduce opt-in `/api/ui-check-v2` or `engine=v2` while preserving all existing routes and legacy tests. Keep actual Playwright-only capture in scanner. Verify a controlled URL-to-URL fixture returns expected findings. Acceptance: end-to-end exact font/spacing findings and accurate element links, with legacy comparisons still functioning.

## Phase 5 — Full-screen scan interface and real events (scanner only)

**Prompt:**

> Upgrade `ui/compare-3.html` into a true full-screen, side-by-side Baseline/Target workspace (extract JS/CSS modules only if it reduces maintenance risk). Preserve existing review controls and results in a collapsible drawer. Add a `ScanSessionManager` on the Node server, unique scan IDs, independent Playwright pages, cancellable tasks, lifecycle cleanup, per-scan artifacts, and Server-Sent Events for actual progress (or WebSocket if browser-frame transport requires it). Events must reflect real capture/extraction/matching/comparison operations: `scan.started`, `page.loading`, `page.ready`, `snapshot.ready`, `section.matched`, `node.matched`, `issue.detected`, `scan.completed`, `scan.failed`, `scan.cancelled`. Show both websites through backend browser frames, never rely on cross-origin iframes; use throttled JPEG screenshots or a supported Playwright screencast API after checking actual installed API. Do not claim live site interactivity if only frames are streamed. Render highlight and scan-line overlays using node/issue rectangles in document CSS coordinates transformed by actual preview scale/scroll; never modify the website DOM to draw scanner overlays. Provide visible progress, synchronized scroll, zoom, select/highlight matching nodes, inspect issue, confirm/ignore/needs-review, stop, retry. Use reduced-motion support and robust reconnect/cancel handling. Avoid hard-coded timers that pretend a scan is advancing. Acceptance: two local fixture websites visibly load; the user watches actual events and sees differences highlighted with correct alignment and no stale session frames.

## Phase 6 — Optional SLM reasoning provider (Shivax + scanner adapter)

**Prompt:**

> Shivax currently has `BagOfWords`, not an SLM. Add an OPTIONAL, explicitly configured `SmallLanguageModelProvider` interface accepting constrained structured input and returning validated JSON for (a) ambiguous element-matching assistance and (b) human-friendly issue explanations. Implement a baseline `NoopProvider` (deterministic analysis works fully without an SLM) and one small-model provider adapter (local Ollama is acceptable) with timeout, cancellation, context cap, concurrency bound, error/fallback and zero hidden automatic downloads. Keep the default `shivax` npm bundle lightweight and browser-safe; isolate provider dependencies in optional subpaths if required and update the publish allowlist. In scanner, pass only bounded, relevant sanitized UI descriptors and measured differences; never send entire pages, secrets or arbitrary page instructions to the model. Validate returned node IDs and suggested fixes against deterministic evidence; SLM must not fabricate measurements or mark uncertain matches as fact. Provide opt-in `reasoning:off|local`, logs without raw page secrets, repeatability tests with mock SLM responses and failure fallback tests. Acceptance: URL-to-URL comparison continues working without a model; model-enabled mode improves issue descriptions or ambiguous matches only when valid.

## Phase 7 — Figma-to-URL (scanner adapter; Shivax unchanged if contract sufficient)

**Prompt:**

> In scanner, extend the existing Figma URL parsing and image fetch in `compare.js` with a new structured Figma adapter. Call the official Figma file nodes endpoint for a selected frame (`GET /v1/files/:key/nodes?ids=...`) from server-side credentials. Extract text content, typography, auto-layout, constraints, absolute frame bounds, image/vector nodes, hierarchy and layout relations into the SAME Shivax `UISnapshot` contract. Also retain the rendered PNG for left-panel preview. Do not send Figma tokens to the browser or persist them to scan artifacts. Validate selected frame, token scope and rate/error handling. Compare a Figma frame to a Playwright URL snapshot using the existing Shivax engine; respect Figma-frame coordinate scale and unsupported values. Add fixture-based mapping tests with mocked API responses. Acceptance: detects known Figma typography/layout differences with exact/derived evidence and renders side-by-side previews; legacy raster Figma comparison remains available as an optional mode.

## Phase 8 — PNG-to-URL (scanner vision adapter; measured vs estimated evidence)

**Prompt:**

> Implement an image baseline adapter in scanner. Determine image dimensions, expected viewport/scaling, text regions and recognized text using an OCR provider, and detect layout regions/image groups using a documented CV or vision-model adapter. Convert observations to the existing `UISnapshot` with `sourceEvidence:'estimated'`; never claim original CSS font-family, weight, line-height or margin values are directly known from pixels. Reuse Shivax matching and comparisons, but report inferred results with a lower and calibrated confidence, bounded geometric tolerance and a 'needs review' path. Add sample PNG fixtures from the controlled URL baseline, plus distorted/shifted headings and image alignment. Ensure OCR/model features are optional and scanner still works without them. Acceptance: highlights probable heading/paragraph/image region differences and clearly distinguishes inferred data from computed-browser CSS; no pixelmatch dependence for semantic issue generation.

## Phase 9 — Hardening, CI and release

**Prompt:**

> Consolidate regression and integration coverage. Re-run all Shivax ESM/CommonJS/package tests and scanner Playwright fixture tests at 1440/768/375 widths. Audit URL input validation: block unsafe hosts/ports, protect against SSRF and redirects when deployed, cap response/request sizes, concurrency and page height, isolate browser contexts, clean up sessions, and restrict `file://` navigation to explicit test mode. Add structured per-scan issue fingerprints independent of volatile detail text and stable review persistence by source+viewport+element identity. Keep uploaded PNGs and Figma credentials private. Measure matching precision, issue precision/recall and false positives from labeled fixtures; document limitations rather than inventing a 99% score. Ensure no new Playwright dependency in Shivax. Produce a changelog, migration notes and ready-to-publish npm pack inspection; DO NOT publish without explicit approval. Acceptance: end-to-end demo and measurable test evidence; old routes and digit demo still pass.

## Order to run agents without wasting tokens

1. Codex in Shivax: Phase 0 (Shivax audit); Claude in scanner: Phase 0 (scanner audit). They must share the same `UISnapshot` contract.
2. Codex in Shivax: Phase 1. Do NOT let scanner proceed to integrated matching until Phase 1 API is stable.
3. Claude in scanner: Phase 2, using the exact exported schema from Phase 1.
4. Codex in Shivax: Phase 3, then Phase 4 (Shivax half).
5. Claude in scanner: Phase 4 (integration half). **MVP gate here:** URL-to-URL correctly detects typography/gaps and avoids wrapper false positives.
6. Claude in scanner: Phase 5, full-screen live interface. **Visual demo gate here.**
7. Codex in Shivax: Phase 6 optional SLM, only after deterministic comparison is good.
8. Claude in scanner: Phase 7 Figma and Phase 8 PNG separately.
9. Both agents: Phase 9 hardening and integration tests.

Every phase should result in `changed files`, `commands`, `passing/failing tests`, `known limitations`, and a single explicit go/no-go gate. Do not let the agents implement later phases in a single huge edit.
