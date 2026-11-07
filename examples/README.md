# CPU examples

The SDK examples in [`sdk/`](sdk/README.md) ship in the npm package. The CPU
examples and the digit playground below run from a source checkout. Their files
are not in the npm package.

The digit demo is a local ML playground. It recognizes digits live or on demand,
draws loss and accuracy charts, and shows its evaluation scores. You can save and
load models in IndexedDB, and export or import them as JSON. It never restores a
model unless you ask. Discard deletes both the active model and saved models. See
the [Phase 4 guide](../docs/digit-phase4.md) for how to use it and how it was tested.

Run the examples from the repository after `pnpm install --frozen-lockfile`. The
`pnpm example:*` commands rebuild first.

- `pnpm example:xor`: a 2 → 8 → 1 binary network learns XOR.
- `pnpm example:core`: a typed example of Adam with Leaky ReLU, momentum
  regression, versioned model saving and the evaluation helpers.
- `pnpm example:regression`: a one-input linear layer predicts made-up house
  prices after it normalizes the inputs and targets. It is not a real pricing model.
- `pnpm example:text`: a bag-of-words vocabulary feeds an 8-unit hidden layer that
  flags spam. The corpus is a toy. For a real test, use separate training,
  validation and test data. Sentiment works the same way with positive and
  negative labels.
- `pnpm example:digits`: serves the drawing demo at http://127.0.0.1:4173. If
  port 4173 is busy, it tries ports up to 4182 and prints the URL it used. Open
  that URL, and press Ctrl+C to stop the server. It listens only on localhost.
  Switching Node versions does not free a busy port. The launcher watches the
  server code and restarts when routes change. If the page shows disabled
  controls after an update, stop any older demo servers, run this command again
  and reload the printed URL. If startup fails, it prints steps to recover.

## Digit data

Supply a JSON file with this exact structure. The short array below is only a
sample, not a full image:

```json
{"images": [[0, 0, 0.5, 1, 0]], "labels": [3]}
```

Each real image must have **784 values** in row order: 28 rows × 28 columns,
grayscale from 0 to 1, white ink on black. To convert MNIST byte pixels, divide
by 255. Labels are whole numbers from 0 to 9. The demo takes 50 to 500 samples,
needs all ten digits, and rejects files over 5 MB. Build a balanced subset from a
dataset you have the right to use. The demo does not download or include any
dataset. Convert raw IDX MNIST files to this JSON first.

The worker removes exact duplicate images and splits the rest by digit, using a
seed. For 500 balanced, unique images, it uses 360 for training, 70 for
validation and 70 for testing. If a digit has too few samples, it falls back to a
documented split or rejects the file. Training uses the same 784 → 32 → 10
network. You can set the epochs, batch size, learning rate, seed, training-only
augmentation and early stopping. Each epoch reports training and validation loss
and accuracy. The final report shows errors per digit and a confusion matrix on
test samples the model never saw. A small sample may not handle new handwriting
well. The scores shown are raw model probabilities, not a promise of accuracy.
There is no pretrained model, and reloading the page discards training.

You can draw with a mouse, pen or touch, using thin, medium or thick strokes.
Before the model sees the drawing, a preprocessing step lays it over black, finds
the ink, and scales it into a 20 × 20 box without changing its shape. It then
moves the image so its weight sits at the center of a black 28 × 28 image,
limiting the move so nothing is cut off. It does not thicken, thin, threshold or
straighten the digit. A blank canvas is not sent. Your original drawing is kept.

When you press Recognize, the live preview becomes the exact image sent to the
model. The preview and the worker get the same 784 grayscale values. Results
show the top three probabilities. If the top one is below 65%, or the top two are
less than 15 points apart, the demo marks the result as uncertain. This is a rule
of thumb, not a measured confidence. Clear or a new stroke cancels pending
predictions, so an old answer cannot label a new drawing.

Uploaded training images are used as they are. They should already be white on
black, about 20 pixels tall, centered by weight, and drawn with a mix of
handwriting and stroke widths. The test score measures uploaded images, not
canvas drawings. Better preprocessing alone cannot promise better recognition.
See [Phase 1 validation](../docs/digit-phase1.md) for test results and limits.
The Stop button ends the worker at once and discards the model.

See the [Phase 2 training guide](../docs/digit-phase2.md) for preparing local
MNIST IDX files, augmentation ranges, split rules, early stopping on validation
results, and the command for a repeatable local 500-sample A/B test. Nothing is
downloaded.
