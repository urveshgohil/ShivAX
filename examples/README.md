# CPU examples

The digit demo is now a responsive local ML playground with live/manual
recognition, loss/accuracy charts, inspectable evaluation metrics, and explicit
IndexedDB save/load plus model JSON export/import. It never restores models
automatically. Discard deletes active and saved models. See
[Phase 4 guide](../docs/digit-phase4.md) for usage and verified testing.

Run examples from the repository after `pnpm install --frozen-lockfile`.
The `pnpm example:*` commands rebuild automatically. These examples are not
included in the npm tarball.

- `pnpm example:xor`: a 2 → 8 → 1 binary network learns XOR.
- `pnpm example:core`: a typed example of Adam/Leaky ReLU, momentum regression,
  versioned inference serialization, and reusable evaluation utilities.
- `pnpm example:regression`: a one-input linear dense layer predicts synthetic
  house prices after feature/target normalization. This is not a real valuation model.
- `pnpm example:text`: a fitted bag-of-words vocabulary feeds an 8-unit hidden
  layer and binary spam output. Replace the toy corpus with independent training,
  validation, and test data for meaningful evaluation. Sentiment uses the same
  pipeline with positive/negative labels.
- `pnpm example:digits`: serves the drawing demo at http://127.0.0.1:4173.
  If 4173 is occupied, the launcher tries ports through 4182 and prints the
  actual URL. Open that printed URL. Stop the local server with Ctrl+C.
  It binds only to localhost; changing Node versions does not free an occupied port.
  The launcher watches server code and restarts when routes change. If a page has
  disabled controls after an update, stop older demo servers, restart this command,
  and reload the printed URL. Startup failures now show recovery instructions.

## Digit data

Supply a JSON file with exactly this structure (the abbreviated array below is
illustrative, not a complete image):

```json
{"images": [[0, 0, 0.5, 1, 0]], "labels": [3]}
```

Each actual image must contain **784 values** in row-major order: 28 rows × 28
columns, grayscale in [0, 1], white ink on black. Convert byte-valued MNIST pixels
by dividing by 255. Labels are integers 0–9. The demo accepts 50–500 samples,
requires all ten classes, and rejects files larger than 5 MB. Prepare a balanced
subset from a dataset you have permission to use; no dataset is downloaded or
included automatically. Raw IDX MNIST files must be converted to this JSON first.

The worker deduplicates exact images and splits originals by digit with a seed.
For 500 balanced unique images it uses 360 training, 70 validation, and 70 test
samples. Scarce classes trigger documented fallback or rejection. Training uses
the same 784 → 32 → 10 network; epochs, batch size, learning rate, seed,
training-only augmentation and early stopping are configurable. Epoch progress
includes training/validation loss and accuracy; final evaluation reports per-digit
errors and a confusion matrix on untouched test samples. A small sample may
generalize poorly to handwriting. Displayed model
scores are uncalibrated probabilities, not a reliability guarantee. There is no
pretrained model or model persistence: reloading discards training.

The drawing input accepts mouse, pen, or touch, with thin/medium/thick strokes.
Before inference, a pure preprocessing module composites RGBA over black, detects
ink, and area-averages an aspect-preserving crop into a 20 × 20 region. It shifts
the image to center its intensity-weighted mass in a black 28 × 28 image, clamping
the shift if needed to avoid clipping. It does not thicken, thin, binarize, or
deskew the digit. Blank input is not submitted. The original drawing is preserved.

The live preview becomes the exact submitted image when Recognize is pressed.
The same quantized grayscale values (784 row-major values in [0,1]) are used for
the preview and worker message. Results show the top three model probabilities.
A top probability below 65% or top-two gap below 15 percentage points triggers
heuristic uncertainty feedback, not calibrated confidence. Clear or a new stroke
invalidates outstanding predictions so old responses cannot label a new drawing.

Uploaded training images remain unchanged. They should already use the same
white-on-black polarity, roughly 20-pixel digit extent, mass centering, and
representative handwriting/stroke widths. The held-out score measures uploaded
images, not canvas drawings. A preprocessing fix alone cannot guarantee recognition
accuracy. See [Phase 1 validation](../docs/digit-phase1.md) for evidence and limits.
The Stop button terminates the worker immediately and discards the model.

See [Phase 2 training guide](../docs/digit-phase2.md) for local original-MNIST IDX
preparation, augmentation ranges, split rules, validation-based early stopping,
and the reproducible local 500-sample A/B comparison command. Nothing is downloaded.
