import { finite, integer } from '../core/Tensor.js';

type Rows = readonly ArrayLike<number>[];
export interface ClassMetrics { class: number; support: number; predicted: number; precision: number; recall: number }
export interface ClassificationMetrics {
    accuracy: number;
    crossEntropy: number;
    confusionMatrix: number[][];
    perClass: ClassMetrics[];
    incorrect: number;
    count: number;
}
export interface RegressionMetrics { meanSquaredError: number; rootMeanSquaredError: number; meanAbsoluteError: number; rSquared: number | null; count: number }

function countMatch(a: number, b: number): void {
    integer(a,1,100_000,'sample count');
    if (a !== b) throw new RangeError('Prediction/target counts must match');
}

export function classificationAccuracy(predictions: ArrayLike<number>, labels: ArrayLike<number>): number {
    countMatch(predictions.length,labels.length);
    let correct = 0;
    for (let i = 0; i < labels.length; i++) {
        integer(predictions[i],0,4095,'predicted class'); integer(labels[i],0,4095,'target class');
        correct += Number(predictions[i] === labels[i]);
    }
    return correct/labels.length;
}

/** Binary rows contain P(class 1); multiclass rows contain normalized probabilities. */
export function evaluateClassification(probabilities: Rows, labels: ArrayLike<number>, threshold = 0.5): ClassificationMetrics {
    countMatch(probabilities.length,labels.length);
    finite(threshold,'threshold');
    if (threshold <= 0 || threshold >= 1) throw new RangeError('threshold must be in (0, 1)');
    const width = integer(probabilities[0].length,1,1024,'probability width');
    if (width * probabilities.length > 10_000_000) throw new RangeError('Evaluation work limit exceeded');
    const classes = width === 1 ? 2 : width;
    const confusionMatrix = Array.from({ length: classes }, () => new Array<number>(classes).fill(0));
    let loss = 0, correct = 0;
    for (let r = 0; r < labels.length; r++) {
        const row = probabilities[r], label = integer(labels[r],0,classes-1,'target class');
        if (row.length !== width) throw new RangeError('Probability row widths must match');
        let sum = 0, predicted = 0;
        for (let i = 0; i < width; i++) {
            const p = finite(row[i],'probability');
            if (p < 0 || p > 1) throw new RangeError('Probability must be in [0, 1]');
            sum += p;
            if (row[i] > row[predicted]) predicted = i;
        }
        if (width === 1) {
            predicted = Number(row[0] >= threshold);
            loss -= Math.log(Math.max(1e-15,label ? row[0] : 1-row[0]));
        } else {
            if (Math.abs(sum - 1) > 1e-6) throw new RangeError('Multiclass probabilities must sum to 1');
            loss -= Math.log(Math.max(1e-15,row[label]));
        }
        confusionMatrix[label][predicted]++;
        correct += Number(predicted === label);
    }
    const perClass = confusionMatrix.map((row,c) => {
        const support = row.reduce((a,b) => a+b,0), predicted = confusionMatrix.reduce((sum,row) => sum+row[c],0), truePositive = row[c];
        return { class: c, support, predicted, precision: predicted ? truePositive/predicted : 0, recall: support ? truePositive/support : 0 };
    });
    return { accuracy: correct/labels.length, crossEntropy: finite(loss/labels.length,'cross entropy'), confusionMatrix, perClass, incorrect: labels.length-correct, count: labels.length };
}

export function crossEntropy(probabilities: Rows, labels: ArrayLike<number>): number {
    return evaluateClassification(probabilities,labels).crossEntropy;
}

/** Aggregates MSE/MAE across all outputs; R² is pooled after centering each output. */
export function evaluateRegression(predictions: Rows, targets: Rows): RegressionMetrics {
    countMatch(predictions.length,targets.length);
    const width = integer(predictions[0].length,1,4096,'output width');
    const elements = width * predictions.length;
    if (elements > 10_000_000) throw new RangeError('Evaluation work limit exceeded');
    const sums = new Float64Array(width);
    let squaredError = 0, absoluteError = 0;
    for (let r = 0; r < targets.length; r++) {
        if (predictions[r].length !== width || targets[r].length !== width) throw new RangeError('Output widths must match');
        for (let i = 0; i < width; i++) {
            const target = finite(targets[r][i],'target'), difference = finite(predictions[r][i],'prediction')-target;
            squaredError += difference*difference; absoluteError += Math.abs(difference); sums[i] += target/targets.length;
        }
    }
    let totalVariance = 0;
    for (let r = 0; r < targets.length; r++) for (let i = 0; i < width; i++) totalVariance += (targets[r][i]-sums[i])**2;
    finite(squaredError,'squared error'); finite(absoluteError,'absolute error'); finite(totalVariance,'variance');
    const meanSquaredError = squaredError/elements;
    return { meanSquaredError, rootMeanSquaredError: Math.sqrt(meanSquaredError), meanAbsoluteError: absoluteError/elements,
        rSquared: totalVariance ? finite(1-squaredError/totalVariance,'R squared') : null, count: targets.length };
}
