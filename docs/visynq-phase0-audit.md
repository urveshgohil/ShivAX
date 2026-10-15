# VISYNQ Phase 0 audit

Date: 2026-10-15. Scope: Shivax and `D:/Project/packages/inspectra` (already named Inspectra, not `axe-playwright-scan`). No comparison algorithms, production APIs, package manifests, or neural-network code changed. No dataset downloaded. Node v24.19.0; installed scanner dependencies from its existing manifest (no scripts or lockfile), and Playwright 1.64.1 Chromium for local regression execution.

## Architecture and file map

| Owner / file | Current responsibility |
| --- | --- |
| Shivax `package.json`, `src/index.ts` | Independent Apache-2.0 npm library, version 0.1.0, Node >=22, zero runtime dependencies; ESM/CJS and declarations |
| `src/core/{Tensor,math}.ts` | Bounded tensors, numeric operations, seeded randomness |
| `src/nn/{NeuralNet,activations,optimizer}.ts` | Dense network, training/inference, activations, SGD/momentum/Adam, versioned serialization |
| `src/metrics/evaluation.ts`, `src/text/BagOfWords.ts` | Independent classification/regression metrics and text features |
| `examples/digits/`, `tests/*.test.mjs` | Existing worker-based educational playground and library regressions; not Visynq application UI |
| Inspectra `server.js` | Loopback Node HTTP adapter, Lighthouse/axe scans, comparison routes, report and review persistence |
| `ui-check.js` | Chromium page inventory, DOM/computed-style measurements, heuristic component matching, completeness/layout/styling, optional spelling/pixel diagnostic |
| `dom-compare.js` | Separate DOM-path/tag/nearest-position matcher and typography/spacing differ |
| `compare.js` | URL/image/Figma screenshot capture, PNG padding, pixelmatch and pixel-region grouping |
| `scan.js` | CLI accessibility scan using injected local axe script |
| `ui/compare-3.html` | Vanilla local UI, `/api/ui-check` client, overlays, review fingerprints and inferred CSS suggestions |
| `tests/ui-check/regression.mjs` | Existing 47 local browser regression cases |
| `tests/a11y.spec.js`, `playwright.config.js`, `pages.json` | Accessibility integration suite: home/about/contact, desktop/mobile, external local app at port 4015 |
| New `tests/fixtures/phase0/{cases.mjs,README.md}` | Seven reusable offline HTML fixture variants and measurement expectations |
| New `tests/ui-check/phase0-audit.mjs` | Direct reuse of existing inspector/completeness engine; no report pruning or second comparison engine |

Target ownership remains: only Shivax and Inspectra are npm packages; Playwright executes in Inspectra's local Node runner, never in browsers or Shivax. Visynq workstation owns React UI/workflows. Sanity and licensing endpoints belong to the website. Workstation/website repositories were not audited. There is no mandatory hosted scanner requirement and no need for NestJS, Redis, or microservices.

## Shivax contract and verification

Root export `.` resolves import to `dist/index.esm.js`, require to `dist/index.cjs`, types to `dist/index.d.ts`. Runtime exports: `Tensor`, `MAX_TENSOR_ELEMENTS`, `dot`, `sigmoid`, `softmax`, `seededRandom`, `NeuralNet`, `classificationAccuracy`, `crossEntropy`, `evaluateClassification`, `evaluateRegression`, `BagOfWords`, `VERSION`; corresponding public configuration/result types are exported from `src/index.ts`. No Playwright, axe-core or React dependency/import was found in the inspected library source/manifest.

`new NeuralNet({layers, task, seed?, activation?, negativeSlope?, initialization?, optimizer?, learningRate?})`; methods `train(inputs, targets, options)`, `predict`, `predictClass`, `resetOptimizer`, `toJSON`, `NeuralNet.fromJSON`. Existing defaults remain tanh/Xavier/SGD, seed 42; task-specific binary sigmoid, multiclass softmax, regression linear outputs. Training options cover epochs, batches, shuffle, learning rate, optimizer, epoch callback and cancellation. Training is synchronous; worker execution is the application's responsibility.

SGD, momentum and Adam equations/bias correction, seeded convergence, finite-difference activation gradients, numeric-update safety and deterministic legacy behavior are covered by passing tests. Serialization is `shivax-neural-net`, version 1: configuration, weights and biases. Imports enforce finite values, dimensions and size limits; inference restoration is tested across all tasks. Optimizer moments/random progress are not checkpointed, so serialization is not an exact training-resume contract. Safety limits include 8 layer widths, width 4096 and one million parameters.

## Inspectra current API contracts

There is no declared npm `exports`, main, bin or types contract. The following are existing source-level/HTTP contracts to preserve, not new supported public exports.

| Entry | Inputs / outputs |
| --- | --- |
| `compareVisuals(options)` | `reference`, `actual`: URL, local/data image, or Figma source; viewport, threshold, fullPage, animation/hide options. Returns source identity, viewport, pixel counts/percent, image URLs, diff regions, size mismatch, timestamp. `comparePages(ref, actual, options)` and `capturePage(browser,url,filename)` are compatibility helpers. |
| `compareDom(options)` | `referenceUrl`, `actualUrl`, viewport, tolerance, ignoreSelectors, fullPage, disableAnimations. Returns reference/target images and dimensions, summary counts, changed items with CSS differences and measured rectangles. `matchAndDiff(refNodes,actNodes,tolerance)` is separately exported. |
| `runUiCheck(options)` | targetUrl and referenceUrl or checklist; viewport keys, customWords, ignoreSelectors, spelling, styling, pixelDiff. Returns runId, URLs, severity summary, per-viewport counts/images/completeness/layout/styling/optional pixels, spelling data and timestamp. Defaults: desktop, styling on, spelling/pixels off. |
| Other UI-check exports | `VIEWPORTS`, `inspectPage({props,ignore})` (browser evaluator), `settlePage(page,disableAnimations)`, `checkCompleteness(ref,tgt)`, `spellCheckUrl({url,viewport,customWords,ignoreSelectors})`. |
| `POST /scan` | `{url,bestPractice}` -> URL, Lighthouse scores/categories/error/reportId, weighted axe scores, counts and violations with affected nodes. Lighthouse failure is reported, not fabricated. |
| `POST /api/compare` | JSON forwarded to `compareVisuals`. |
| `POST /api/compare-dom` | referenceUrl,targetUrl,width,height,tolerance,ignoreSelectors comma string,spelling -> `{dom,spelling,referenceUrl,targetUrl,viewport}`. HTTP targetUrl maps to engine actualUrl; spelling defaults on. |
| `POST /api/ui-check` | referenceUrl,targetUrl,viewports, newline checklist/customWords, comma ignoreSelectors, spelling/styling/pixelDiff -> `runUiCheck` result. |
| `/api/reviews` | GET `?ref=&tgt=` -> review map; POST URL pair,fingerprint,status,note,type -> persistence/update; status issue/accepted/ignored/null. No account/workspace scope. |
| Read-only routes | `/api/last-compare-result`, `/visual-reports/...`, `/report/:id`; HTML pages `/`, `/compare`, `/compare-2`, `/compare-3`. |
| `node scan.js <url>` | Requires `AXE_PATH` or sibling `../axe-core/axe.js`; prints axe violations. Not an npm bin contract. |

All browser launching, navigation, font settling, lazy-content scrolling, page evaluation, screenshots, axe injection and Lighthouse Chrome connection are currently Node-side. `ui/compare-3.html` does not execute Playwright. Its loading text is an estimate, not measured incremental progress. Review statuses and CSS suggestions are UI workflow data, not AI predictions.

## Comparison overlap, exactness and risks

- `compare.js` is pixel-first. `ui-check.js` separately has an optional pixelmatch layer; it imports image normalization/output paths from `compare.js`. Retain as legacy diagnostics, not the future primary comparison method.
- `dom-compare.js` and `ui-check.js` independently collect DOM/CSS, match components and compare typography/spacing with different tolerances and schemas. This is the main duplicate-engine risk. Within `ui-check.js`, styling calls completeness again and filters/remaps findings: repeated work, not a third independent matcher.
- Computed CSS and DOM rectangles are measurements; UI-check rounds rectangles to integer pixels, DOM comparison to tenths. Matching by position/kind/path, expected locations, region grouping, severity and suggested CSS are inferred. There is no systematic confidence/provenance schema. Do not label all outputs exact or AI-generated.
- DOM comparison skips image-only elements, ignores unmatched nodes, and reports style changes rather than positional deltas. UI-check intentionally ignores some dynamic copy/media changes; it is not a general semantic equivalence guarantee.
- Inspector section discovery unwraps single-child ancestors and filters narrow/short blocks; some valid pages can yield no sections and hence no completeness findings. Zero-sized `display: contents` wrappers also defeat its visible-child traversal. New fixtures deliberately retain normal page sections and assert that the reference actually exercises section comparison.
- Inspectra is `private:true`, has no build script, explicit module type, engines, license or publish surface. CommonJS server/CLI/config coexist with syntax-detected ESM engines. Node emits a module-type warning. Runtime imports of axe, cspell, pixelmatch and pngjs are classified as dev dependencies. A production-only install is not ready.
- Loopback binding is appropriate for a local runner, not a secured hosted service. Unbounded HTTP bodies, arbitrary scan URLs, unscoped reports/reviews and shared fixed screenshot/result filenames need review before application integration. Concurrent fixed filenames can overwrite results. No company/personal data isolation is enforced; URL-pair keys are not tenant identity.
- `runUiCheck` retains 20 runs and automatically deletes older report directories. The unchanged regression suite was executed in an isolated source copy to protect pre-existing reports. Existing source files and user reports were not rewritten.

## Tests and fixture observations

| Check | Verified result |
| --- | --- |
| Shivax `pnpm test` | 64 passed, 0 failed, including training/inference, gradients, optimizers, serialization, worker and ESM/CJS package loading |
| Shivax `pnpm build` | Passed, declarations and CJS/ESM bundles generated by existing build |
| Inspectra existing Node regressions | 47 passed, 0 failed; unchanged source in isolated output directory |
| New fixture harness | Six of seven leaf cases pass; equivalent-wrapper case fails. Node counts the failed parent too: 8 tests, 6 pass, 2 fail. Assertions were not weakened. |
| Scanner syntax | `node --check` passed for server, ui-check, compare, dom-compare and scan |
| Scanner build | No build script exists; not reported as passing |
| Accessibility integration | Not run: configured localhost:4015 target returned ECONNREFUSED. No replacement target or scan result fabricated. |

Fixture engine observations: identical -> zero findings; 16px to 20px font -> two typography findings; 24px to 32px line height -> two findings; 16px to 28px content gap -> one finding; missing paragraph -> one missing-text finding; image x=40 to x=60 -> **no finding (miss)**; display-contents wrappers with the same measured CSS/image bounds -> **four false missing-element findings**. Passing fixture assertions verify ground truth, not comprehensive detection accuracy. These are deterministic synthetic UI regressions, not measured real-site accuracy or performance claims.

Reproduce from Shivax: `pnpm test`, `pnpm build`. From Inspectra: `node --test tests/ui-check/phase0-audit.mjs`. Existing regression command: `node --test --test-concurrency=1 tests/ui-check/regression.mjs`; audit used unchanged copies of its source and engine modules under `.phase0-audit-run` so output pruning remained isolated. Dependencies were installed with `npm install --ignore-scripts --no-package-lock --no-audit --no-fund`; test browser with `npx playwright install chromium`.

## Smallest safe migration plan (not implemented)

1. Preserve these contracts and fixtures; agree on the red wrapper test and missed image movement as explicit acceptance cases before changing matching. Add missing detection assertions when the next algorithm phase is approved.
2. Make Inspectra publishable in-place: choose explicit ESM/CJS boundaries, declare the existing runner APIs/types, correct runtime dependency placement, define a minimal files/bin surface and production-install test. Do not create a third npm package or rename APIs silently.
3. Select one existing DOM measurement/matching path as canonical using fixture evidence. Adapt legacy routes/results to it incrementally rather than inventing another engine; keep pixel comparison optional/legacy. Preserve full measurement precision and attach source, units and confidence/provenance to inferred matches/suggestions.
4. Wrap the existing Node runner with a local application adapter; move application controls/reviews into Visynq workstation without embedding React/Playwright/axe into Shivax. Pass structured numeric features to Shivax only when a real trained/evaluated use case exists; current scanner heuristics are not Shivax AI output.
5. Before real multi-workspace use, scope storage, reviews and artifacts by explicit company/personal workspace identity, isolate runs, and constrain request sizes/URL access. Keep Sanity/licensing secrets exclusively in the website's secure server endpoints. No mandatory hosted scanner or new infrastructure.

Stop: Phase 0 only. No migration or algorithm changes have been started.
