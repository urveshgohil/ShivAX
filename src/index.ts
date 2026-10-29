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
export * from './slm/index.js';
export * from './agents/index.js';
export * from './security/index.js';
export * from './bots/index.js';
export * from './intelligence/index.js';
export * from './memory/index.js';
export * from './inspection/index.js';
export * from './workflows/index.js';
export * from './learning/index.js';
export * from './learning/updates.js';
export * from './learning/training.js';
export { toSDKDiagnostic } from './sdk/diagnostics.js';
export type { SDKDiagnostic } from './sdk/diagnostics.js';

export const VERSION = '0.1.1';
