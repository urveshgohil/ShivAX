// ShivAX — AI/ML library
// Dependency-free CPU foundations.

export type { Vector, Matrix, Label, ModelConfig } from './types/index.js';
export { Tensor, MAX_TENSOR_ELEMENTS } from './core/Tensor.js';
export { dot, sigmoid, softmax, seededRandom } from './core/math.js';
export { NeuralNet } from './nn/NeuralNet.js';
export type { NeuralNetOptions, TrainOptions, TrainingResult, Task, Initialization, SerializedNeuralNet } from './nn/NeuralNet.js';
export type { Activation } from './nn/activations.js';
export type { OptimizerName, OptimizerOptions, OptimizerConfig } from './nn/optimizer.js';
export { classificationAccuracy, crossEntropy, evaluateClassification, evaluateRegression } from './metrics/evaluation.js';
export type { ClassMetrics, ClassificationMetrics, RegressionMetrics } from './metrics/evaluation.js';
export { BagOfWords } from './text/BagOfWords.js';
export * from './visual/index.js';

export const VERSION = '0.1.0';
