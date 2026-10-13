# Digit recognition: Phase 1 investigation and validation

## Code-supported causes

The original path was pointer events -> 280x280 opaque black drawing canvas with
22px white strokes -> red-channel bounding box at intensity >20/255 -> browser
drawImage resize into a 20x20 region -> geometric centering -> red channel /255
-> 784 features -> worker -> NeuralNet.predict -> softmax argmax.

1. The worker takes uploaded 28x28 training and held-out images unchanged. The
   drawing path applied a separate transform; equal dimensions alone did not
   ensure equal scale, alignment, or stroke distribution. No dataset was provided
   for this investigation, so its actual preprocessing cannot be verified.
2. Bounding-box centering is not intensity center-of-mass alignment. Uneven loop
   sizes, crossbars and stroke weights can leave significant ink displacement.
3. The old >20/255 crop excluded faint outer pixels. Browser-default resize
   filtering and fractional sizing provided no deterministic area-average rule.
   A narrow gap or thin stroke can change at 28x28. The code supports this risk;
   it does not prove it caused the user's specific 8-to-7 error.
4. A fixed 22px brush yields different effective stroke widths after cropping
   small versus large drawings. Polarity/range were already correct for the
   opaque white-on-black canvas; inversion was not an observed bug.
5. Pointer positions used the border-inclusive bounding rectangle. A shared
   drawing boolean also allowed unrelated pointers to move/end a stroke.
6. The unchanged 784 -> 32 -> 10 dense model has separate weights for each pixel,
   not built-in translation invariance. Its 20% held-out split contains uploaded
   data only (10-100 images at current limits). The reported 97% cannot establish
   accuracy on new browser handwriting or diagnose one specific mistake.

## Changes

- Deterministic pure grayscale/RGBA preprocessing: bounded input, nonempty crop,
  one-pixel antialias padding, area averaging, aspect ratio preserved, 20px fit,
  subpixel center-of-mass shift. Shifts are clamped to retain ink at the boundary.
- Soft intensities/loop details retained without morphological stroke changes.
  Quantization occurs once; preview bytes and submitted floats match exactly.
- Live 28x28 preview and submitted-input caption; drawing remains untouched.
- Single active pointer, scaled-border coordinate correction, coalesced moves,
  capture cancellation, selectable stroke width, and stale-result invalidation.
- Worker input validation, top-three probabilities, and documented heuristic
  uncertainty feedback. Existing prediction digit/score fields remain available.
- Training JSON schema, uploaded images, train/test split, architecture,
  optimizer, epochs, and all library exports remain unchanged. No dependencies.

## Validation

- `pnpm lint`: passed (initial sandbox store-access failure; approved retry passed).
- `pnpm test`: 32 passed, 0 failed. Covers blank/transparent input, range/length,
  malformed input, crop/aspect ratio, row-major orientation, non-mutation, mass
  centering, canvas edges, antialiasing, exact preview quantization, thin/medium/
  thick hand-authored 8/7 fixtures, preservation of both 8 loops, pointer ownership
  and cancellation, and worker top-three/blank behavior plus existing library tests.
- `pnpm build`: passed.
- Browser: drew a medium-stroke 8 and thin crossbar 7 through actual pointer
  actions. Both previews visibly preserved identifying strokes/holes. Clear
  reset both canvases. Blank recognition produced "Draw a digit first".
- Browser: trained on independent synthetic pixel data solely to exercise UI
  integration. Recognize displayed three sorted probabilities and the exact-input
  caption. The drawn 7 was predicted as 8 (27.5%, runner-up 7 at 23.7%), correctly
  triggering uncertainty feedback. This model was not trained on handwriting and
  this result is NOT a handwriting accuracy benchmark. It was then discarded.
- Browser: 390px viewport fitted the drawing and stacked preview without horizontal
  overflow; no warning/error console logs observed. Physical touch and pen hardware
  were not tested. Pointer logic has automated event-level coverage.

The 8/7 stroke fixtures and browser drawings were never included in training.
No recognition-accuracy improvement is claimed. The user's actual training JSON,
failing drawing and trained weights were unavailable. A representative independent
handwriting set is needed for a meaningful before/after confusion matrix (especially
8 vs 7). Unusual slant, extreme stroke widths, clipped original drawings and dataset
mismatch can still cause mistakes; high softmax probability can still be wrong.

Phase 1 only. No network redesign, augmentation, new backend or Phase 2 work.
