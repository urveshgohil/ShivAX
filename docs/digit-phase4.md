# Phase 4: browser ML playground

Run `pnpm example:digits` and open the printed localhost URL. Reload after updating
the code. No framework, CDN, new dependency, dataset download, or model-service
request is used. Phases 1–3 preprocessing, training recipe and public library
APIs remain unchanged. CSP continues to allow only local scripts/styles/workers.

## Interface and behavior

The navy/mint ShivAX interface has sections for dataset upload, configuration,
training progress, handwriting, normalized input, predictions, evaluation and
model management. Mobile layout stacks panels; wide tables scroll inside their
own regions. The input preview retains exact Phase 1 submitted pixel values.

Dataset files retain the 5 MB / 50–500 sample limits. Parsing, deduplication and
split validation run in the worker before Train becomes available. Original
train/validation/test separation and augmentation rules are unchanged.

Training shows epoch/budget, progress, elapsed wall-clock time, train/validation
loss and accuracy, status and early-stop restoration progress. SVG charts plot
train (solid mint) and validation (dashed gold) series; current metric values are
also available as text. Screen readers receive lifecycle status updates rather
than an announcement on every epoch. Stop terminates the worker immediately and
discards both active and saved models. Drawing stays available during training,
but inference waits for a model.

Live recognition is on by default and can be disabled. It waits 160 ms after the
last drawing change, processes at most one inference request at a time, skips
duplicate normalized inputs, and rejects replies for older drawings or models.
Manual Recognize works when live mode is off; a manual request queued behind an
in-flight request is honored. Clear invalidates responses and resets the preview,
probabilities and result. Blank drawings are never sent for inference.

Predictions show a large digit, all ten probabilities, the leading card, top three
alternatives and heuristic uncertainty feedback. Raw softmax probabilities are
not calibrated confidence. Prediction announcements are limited to changed
results, at most once per two seconds, to avoid flooding assistive technology.

Evaluation shows original train/validation/test counts, held-out test accuracy,
correct/incorrect totals, per-digit accuracy/errors, a 10x10 matrix and the five
most frequent confused pairs. Matrix rows are true digits and columns are model
predictions. Populated cells are keyboard-accessible buttons with descriptive
labels; selecting one shows the count and true-class support. Imported models
clear evaluation/history instead of retaining unrelated scores.

## Explicit model management

- **Save in browser:** serialize in the worker and store JSON in IndexedDB.
- **Load saved model:** explicitly read and validate that saved model in the worker.
- **Export JSON:** download the versioned Phase 3 inference format. The temporary
  Blob URL is revoked after the download starts.
- **Import model JSON:** read a bounded file, then validate using
  `NeuralNet.fromJSON()` inside the worker. Only multiclass models with 784 inputs
  and 10 outputs are accepted. Invalid imports preserve any existing valid model.
- **Discard model & saved copy:** terminate the active worker, cancel pending
  operations, and delete the saved record. Delayed save/load callbacks cannot
  silently revive it. Storage operations are ordered and database connections close
  after their transaction commits or fails.

Nothing is loaded automatically on page load, reload or browser history restore.
Leaving the page terminates its worker. Weights/configuration can be kept via
explicit save/export; optimizer state and evaluation history are not persisted.
Storage is per browser and origin (including port), so changing demo ports uses
a different store. Private browsing, quota limits or clearing site data can remove
saved models; JSON export/import remains available when IndexedDB is unavailable.
Model files have a 32 MB demo limit in addition to core model validation limits.

## Accessibility and lightweight execution

Semantic sections/headings, skip link, labels, fieldsets, real buttons/progress,
table headers, keyboard-operable controls, visible focus and reduced-motion CSS
are included. Charts have accessible descriptions and textual current metrics.
The drawing canvas itself needs mouse/touch/stylus; there is no keyboard drawing
editor. Physical touch/stylus and real screen-reader behavior have not been tested.

No training, inference, model JSON parsing or serialization occurs on the main
thread. Bounded file reads, drawing preprocessing, SVG rendering and compact UI
updates remain there. Probability nodes are reused across updates; histories are
bounded by the existing 100-epoch limit. Frame/timer/worker cleanup runs on page
exit and discard. No measured speedup or absolute latency claim is made.

## Validation evidence

- `pnpm lint`: passed.
- `pnpm test`: 64 passed, zero failures, including all prior library/Phase 1–3 tests.
- `pnpm build`: passed.
- New tests cover debounce/model gating, single-flight requests, stale responses,
  duplicate suppression, blank/failure handling, queued manual recognition with
  live disabled, browser timer receiver binding, chart coordinates, confusion-pair
  ranking, explicit storage/ordered discard, worker import/export/prediction
  equality, invalid-model rejection, and dataset validation.
- Browser testing exercised a synthetic UI-only dataset: upload validation,
  configuration, per-epoch progress, Stop/discard, retraining, SVG chart series,
  counts and confusion-cell inspection.
- Browser drawing exercised live recognition, exact pixel preview, all ten model
  probabilities and live-disable/manual recognition. The synthetic model was not
  trained on handwriting and its incorrect prediction is not an accuracy result.
- Browser persistence: Save, reload without auto-restoration, explicit Load,
  export download, file import with matching displayed probabilities, Discard,
  then Load reporting no saved model. Test-generated saved data was removed.
- Desktop and 390px layouts were inspected. At 390px, the document fit the
  viewport without horizontal overflow; all inputs/selects had accessible labels.
  Keyboard Tab navigation produced a visible solid focus outline.

Browser testing initially found an illegal timer receiver that Node's mocked
timers missed. The default timer functions now call through the global object;
the browser checks were repeated and a regression test reproduces this constraint.

No actual MNIST/handwriting accuracy improvement is claimed. Browser integration
used synthetic pixel fixtures solely to test behavior, never a benchmark. Remaining
limits include synchronous worker training (cancelled by termination), small
dataset evaluation uncertainty, no full training checkpoint, and browser-specific
storage/download behavior. Only this browser environment and mouse interactions
were tested; hardware touch/pen, cross-browser behavior and assistive technology
need further testing. Phase 4 only.

## Modified files

- `examples/digits/index.html`, `style.css`, `app.mjs`, `worker.mjs`
- `examples/digits/live-inference.mjs`, `model-store.mjs`, `dashboard.mjs`
- `scripts/serve-examples.mjs`
- `tests/digit-playground.test.mjs`
- `examples/README.md`, `README.md`, `docs/digit-phase4.md`
