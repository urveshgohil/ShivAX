# Phase 2: local digit training and evaluation

## Scope and compatibility

The 784 -> 32 -> 10 tanh/softmax network, SGD implementation, public TypeScript
API, and Phase 1 drawing preprocessing are unchanged. No ML or runtime dependency
was added. JSON remains `{ "images": [[...784 values...]], "labels": [0, ...] }`.
The demo still accepts only 50–500 images and files no larger than 5,000,000 bytes.
Pixels must be finite grayscale values in [0,1], white digits on black; all digits
0–9 are required. Blank training images and contradictory duplicate labels are
rejected. Uploaded original pixels are not thresholded or recentered.

## Preparing original MNIST locally

Use matching original MNIST IDX image/label files that you already obtained from
a legitimate source and have permission to use. The utility has no network code
and performs no downloads. Raw IDX and gzip-compressed IDX are accepted. Do not
mix training images with test labels or combine benchmark test files into a
training pool if you intend to report official MNIST benchmark results.

From the repository, build first and run (PowerShell example):

```powershell
pnpm build
New-Item -ItemType Directory -Force datasets
node scripts/prepare-mnist.mjs "C:\data\mnist\train-images-idx3-ubyte.gz" "C:\data\mnist\train-labels-idx1-ubyte.gz" "datasets\mnist-500.json" 500 42
```

Replace input paths with your own local files. The destination must not exist;
the command refuses to overwrite it. It validates IDX magic numbers, sample
counts, dimensions (28x28), labels, exact lengths, and bounded decompression.
It shuffles class indices with the seed, takes 50 unique nonblank images per digit,
and outputs each original byte divided by 255, without binarization or rounding.
Other balanced sizes must be multiples of ten between 50 and 500. The final
serialized JSON is checked against the same 5 MB demo limit. No automatic size
limit increase or lossy reduction occurs. SHA-256 hashes of the decompressed
sources and output are printed for provenance. IDX validity alone cannot certify
a dataset's origin: retain the original source/license information yourself.

`datasets/` is ignored by Git. The npm package allowlist excludes datasets,
examples, and scripts; the full MNIST dataset is never bundled.

## Reproducible splitting and isolation

Exact duplicate pixel arrays are deduplicated before splitting (first occurrence
retained). Identical pixels with different labels are rejected. The report gives
duplicate counts and original input indices for every split, making the allocation
auditable. Near-duplicates/writer identity cannot be detected reliably from this
images/labels format; use independently sourced samples and avoid pre-augmented
duplicates in the uploaded pool.

Each digit's original images are independently shuffled with a seeded PRNG:

- At least three unique samples for every digit: reserve floor(15%) per class for
  test and floor(15%) for validation, with a minimum of one each; train on the rest.
  A balanced 500-image dataset produces 360 train / 70 validation / 70 test.
- If any class has exactly two unique samples: no validation set for the whole
  run; reserve max(1, floor(20%)) per class for test and the rest for training.
  A visible warning explains that early stopping is disabled.
- Fewer than two unique images in any digit: reject with an actionable error.

All active splits contain all ten classes. No training original or its augmentation
is reused for validation/test. All training selection and early stopping depend
only on the training/validation sets. The test set is evaluated once at the end.

## Training-only augmentation

Defaults: augmentation enabled; each original training sample has a 50% chance
of receiving one freshly generated variant per epoch. Dataset size does not grow.
The random stream is deterministic and separate from split and weight initialization.
Each output remains a 28x28 row-major image with values clamped to [0,1]. Labels
are copied unchanged. Validation and test images are never augmented.

| Transformation | Default range | Maximum configurable range |
| --- | --- | --- |
| Rotation | ±8 degrees | ±10 degrees |
| X/Y translation | ±1.5 pixels each | ±2 pixels |
| Uniform scale | 0.92–1.08 | 0.90–1.10 |
| Stroke variation | ≤15% blend toward local min/max | ≤20% blend |
| Intensity gain | 0.90–1.10 | 0.85–1.15 |

Affine resampling uses bilinear interpolation about the image center and black
padding. Stroke variation softly blends with the four neighboring pixels, rather
than a full erosion/dilation. A transformed image whose total ink mass falls below
65% or above 140% of the original is discarded in favor of the original. There
are no flips, polarity inversion, large rotations, or aggressive morphological
changes. These conservative bounds reduce identity changes but cannot guarantee
them for every ambiguous or edge-clipped drawing. Disable augmentation or reduce
individual ranges to zero when the dataset warrants it.

## Controls, progress and early stopping

Epochs: 1–100 (default 30); batch size: 1–128 (16); learning rate: 0.0001–1 (0.1);
seed: unsigned 32-bit integer (42); patience: 0–20 (5; zero disables).
Options are checked in both the UI and worker. The network's existing resource
limits also remain active. All parsing, augmentation, training, and evaluation run
inside the worker. The main thread only reads the bounded file and renders compact
messages. Stop and Discard terminates the worker, including any restoration work.

Each epoch reports loss and accuracy on **original, unaugmented** training samples
and validation samples. Validation cross-entropy must improve by more than 0.0001
to reset patience. On patience expiry training stops; the selected epoch is the
best qualifying validation epoch, including when the full epoch budget is reached.
No validation or patience=0 means using the final epoch without model selection.

To avoid modifying the core public API or exposing mutable weights, the selected
model is restored by deterministic replay from the same initialization, sample
order and augmentation stream. Replay occurs only if the selected epoch differs
from the final one, emits restoration progress, and does not inspect test data.
This adds up to roughly another training pass but keeps only one live model and
one epoch of generated data; there is no unbounded checkpoint cache.

Final reports include selected/completed epochs, split counts/source indices,
train/validation loss and accuracy, overall test accuracy and incorrect count,
per-digit counts/accuracy/errors, and a 10x10 confusion matrix (true digit rows,
predicted digit columns). Absent validation is null, not a fabricated zero.

## Reproducible A/B comparison

After placing your existing dataset and prepared MNIST subset locally:

```powershell
node scripts/compare-digits.mjs "datasets\shivax_ai_training_500.json" "datasets\mnist-500.json"
```

Both files must contain 500 unique samples; MNIST must have exactly 50 per digit.
The same shared training function, 784-32-10 architecture, SGD, default options,
seed, splitting policy, augmentation and validation-selection rule run for both.
The command prints JSON reports including hashes, history, indices and all metrics.
Each model has its own held-out dataset: this compares in-domain performance,
not performance on a shared independent handwriting benchmark. Do not select
hyperparameters repeatedly against the reported test scores.

## Verified results and remaining limitations

`pnpm lint`, `pnpm test`, and `pnpm build` passed. The suite has 41 passing tests,
including all Phase 1 tests, reproducible/disjoint splits, duplicate rejection,
rare-class fallback, augmentation/range/non-mutation checks, evaluation arithmetic,
test-isolation checks, exact early-stopping replay, and IDX conversion validation.

The synthetic worker fixture scored 10/10 (100%) on its test split with augmentation
disabled. This is an integration check on deliberately simple synthetic pixels,
not MNIST or handwriting accuracy. The fixture now uses unique originals; previous
repeated identical vectors would correctly fail the leakage checks.

The existing `shivax_ai_training_500.json` and original MNIST files were not found
in this workspace. Therefore A/B accuracy, per-digit differences and a real-MNIST
confusion matrix could not be measured. No metric for those datasets is invented,
and no recognition-quality improvement is claimed. Seventy test images still give
noisy per-digit estimates; real handwriting remains out-of-distribution unless the
training data represents it. Phase 3/Adam/architecture changes are not implemented.
