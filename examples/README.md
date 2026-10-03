# CPU examples

Run examples from the repository after `pnpm install --frozen-lockfile`.
The `pnpm example:*` commands rebuild automatically. These examples are not
included in the npm tarball.

- `pnpm example:xor`: a 2 → 8 → 1 binary network learns XOR.
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

The worker shuffles deterministically and reserves 20% of samples for evaluation.
Training uses a 784 → 32 → 10 network, 30 epochs, mini-batches of 16, and learning
rate 0.1. A small sample may generalize poorly to handwriting. Displayed model
scores are uncalibrated probabilities, not a reliability guarantee. There is no
pretrained model or model persistence: reloading discards training.

The drawing input needs a mouse, pen, or touch. Before inference, its bounding
box is resized into a 20 × 20 region and centered in a black 28 × 28 image. This
simple geometric centering is not a complete MNIST preprocessing pipeline.
The Stop button terminates the worker immediately and discards the model.
