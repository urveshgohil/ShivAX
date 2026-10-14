# Phase 3: configurable neural-network core

## Backward compatibility

Existing `new NeuralNet({ layers, task, seed })`, `train`, `predict`, and
`predictClass` calls work unchanged. Defaults remain tanh hidden activation,
Xavier-uniform initialization, SGD, constructor learning rate 0.1, and seed 42.
Train-call learning rate overrides the constructor default. Binary uses sigmoid
output, multiclass uses softmax, and regression uses a linear output regardless
of the configured hidden activation. Existing resource limits, callback/stop
behavior, task losses and Phase 1/2 worker behavior remain in place.

The regression test retains the prior default XOR probability to 1e-15 tolerance.
No framework or runtime dependency was added. The module is browser/worker safe;
filesystem persistence belongs to the caller.

## API additions

`NeuralNetOptions` now accepts:

| Option | Values / default |
| --- | --- |
| `activation` | `tanh` (default), `relu`, `leakyRelu`, `sigmoid` |
| `negativeSlope` | Leaky ReLU slope in (0,1], default 0.01 |
| `initialization` | `xavier` (default), `he`, `auto` |
| `optimizer` | `sgd` (default), `momentum`, `adam`, or a configuration object |
| `learningRate` | Default rate for subsequent training calls, in (0,10] |

Activation applies to all hidden layers. Derivatives use cached layer outputs:
tanh: 1-a²; sigmoid: a(1-a); ReLU: 1 for positive output, otherwise zero; Leaky
ReLU: 1 on the nonnegative branch and `negativeSlope` on the negative branch.
The ReLU derivative at its kink is zero; Leaky ReLU uses the right derivative
there. Numerical gradient checks avoid these nondifferentiable points.

`he` uses hidden-layer uniform bounds sqrt(6/fanIn), adjusted by
sqrt(1+negativeSlope²) for Leaky ReLU. `auto` selects He for ReLU/Leaky ReLU hidden
layers and Xavier otherwise. Output layers retain Xavier initialization. Every
random weight is seeded. Configurations and nonfinite values are validated.

`TrainOptions.optimizer` can override the current optimizer configuration.
Example configurations:

```ts
optimizer: 'sgd'
optimizer: { type: 'momentum', momentum: 0.9 }
optimizer: { type: 'adam', beta1: 0.9, beta2: 0.999, epsilon: 1e-8 }
```

Momentum and both beta values must be in [0,1); epsilon must be in (0,1]. Defaults
are momentum 0.9, beta1 0.9, beta2 0.999, and epsilon 1e-8. Configuration is copied
and frozen. Learning rates are explicitly configured; choosing Adam does not
silently substitute a different rate (0.001–0.02 is a useful experiment range).

For batch-mean gradient g, updates are:

- SGD: θ ← θ - learningRate × g, preserving previous default arithmetic.
- Momentum: v ← momentum × v + g; θ ← θ - learningRate × v.
- Adam: m ← beta1 × m + (1-beta1) × g; v ← beta2 × v + (1-beta2) × g²;
  bias-correct m/(1-beta1^t), v/(1-beta2^t), then subtract
  learningRate × correctedM / (sqrt(correctedV) + epsilon).

Adam's t advances once per successful mini-batch. State persists across train
calls and rate changes. Changing optimizer type or hyperparameters resets state;
`resetOptimizer()` explicitly discards moments while preserving weights and the
selected optimizer configuration. Resetting during training is rejected.
If a batch has an invalid gradient, moment or update, no parameter or optimizer
state from that batch is committed. Completed earlier batches are retained.

## Versioned inference serialization

`model.toJSON()` returns independent plain arrays. `NeuralNet.fromJSON(value)`
accepts that object or JSON text. Format version 1 stores:

```ts
{
  format: 'shivax-neural-net',
  version: 1,
  config: { layers, task, seed, activation, negativeSlope, initialization,
            optimizer, learningRate },
  parameters: [{ weights: [...], biases: [...] }, ...]
}
```

Dense weights are output-major: weight[outputIndex * inputWidth + inputIndex].
Dimensions, task configuration, finite numeric values, field names, plain arrays
and model size are checked. Nonstandard format versions, accessor properties,
sparse parameter arrays, and extra top-level/config/parameter fields are rejected.
Limits remain eight widths, width 4096, one million total weights+biases;
serialized text is additionally limited to 32 million UTF-16 code units before
parsing. JSON is data: no dynamic code evaluation or module loading is used.
For untrusted content, prefer JSON text: hostile live objects such as JavaScript
Proxies can execute traps during any inspection and should not enter the process.

The format restores inference exactly in the same JavaScript runtime. It omits
optimizer moments, step count and PRNG progress; imported models can train again
with fresh optimizer state, but this is not an exact training-resumption checkpoint.
Constructor configuration (not the last train call's learning rate) is saved.
Future model-format changes require an explicit version migration.

## Independent evaluation utilities

- `classificationAccuracy(predictedClasses, labels)` returns the fraction correct.
- `evaluateClassification(probabilityRows, labels, threshold = 0.5)` returns
  accuracy, crossEntropy, incorrect/count, a confusion matrix, and perClass
  precision/recall/support/predicted counts. A one-value row is P(class 1); a
  wider row is a normalized multiclass probability vector. Labels are integer
  class indices. Ties select the first class. Rows=true classes, columns=predictions.
- `crossEntropy(probabilityRows, labels)` returns the same clipped cross-entropy
  loss, using a floor of 1e-15 for zero target probability.
- `evaluateRegression(predictionRows, targetRows)` returns MSE, RMSE, MAE,
  pooled R² and count. Errors average across samples and outputs. R² centers
  each target output independently and is null when total target variance is zero.

Undefined precision/recall denominators return zero. Classification probabilities
must be finite, in [0,1], and multiclass rows must sum to one within 1e-6. Metrics
do not calibrate confidence. Evaluation requires 1–100,000 rows and at most ten
million output values. Confusion matrices cap class width at 1024; regression
caps output width at 4096. Numerical overflow produces an error instead of a
nonfinite metric.

## Working TypeScript example

See `examples/core.ts`, run with `pnpm example:core`. The file uses exported
configuration/serialization/result types, trains XOR using Adam/Leaky ReLU,
round-trips JSON, and evaluates a momentum-trained regression model. To typecheck:

```sh
pnpm exec tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext examples/core.ts
```

The example executes through Node's type stripping, rather than adding ts-node
or a framework. It was run successfully: XOR accuracy 4/4 and cross-entropy
0.0002523556441512297 on its four training cases, with identical restored
predictions. This is a deterministic convergence demonstration, not a dataset
generalization result or a claim about MNIST recognition accuracy.

## Validation and limitations

The suite has 56 passing tests: prior XOR/binary/multiclass/regression behavior,
digit preprocessing and worker training, all four activation derivatives, SGD/
momentum/Adam hand calculations including bias correction, state continuation/
reset, atomic rejected updates, seeded initialization, Adam convergence,
serialization for every task, unsafe-model rejection, and metric arithmetic.
Build, lint, and the TypeScript example check pass.

Gradient buffers and optimizer scratch/state buffers are reused across batches;
the unused input-layer delta allocation is removed. Forward activations and
hidden deltas still allocate per sample. Adam uses additional bounded moment and
scratch arrays; the one-million-parameter limit remains. There is no measured
speedup claim. No GPU, per-hidden-layer activation list, gradient clipping,
weight decay, learning-rate scheduler, dropout, or full training checkpoint is
introduced in this phase. High learning rates or unnormalized data can still
diverge; numerical checks reject invalid updates but cannot ensure good learning.

Phase 3 only. No Phase 4 work has been started.
