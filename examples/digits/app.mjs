// Catch missing module routes from an old server instead of leaving dead controls.
let preprocessImageData, attachDrawing;
try {
    ({ preprocessImageData } = await import('./preprocess.mjs'));
    ({ attachDrawing } = await import('./drawing.mjs'));
} catch (error) {
    document.getElementById('status').textContent = 'The demo could not load its JavaScript modules. Stop the old demo server with Ctrl+C, run pnpm example:digits again, open the URL it prints, and reload this page.';
    throw error;
}

const $ = id => document.getElementById(id);
const canvas = $('drawing');
const context = canvas.getContext('2d', { willReadFrequently: true });
const preview = $('input-preview').getContext('2d');
let worker, dataset;
let ready = false;
let requestId = 0;
let previewFrame;
const status = text => { $('status').textContent = text; };
function renderPreview(pixels) {
    const image = preview.createImageData(28, 28);
    pixels.forEach((value, i) => {
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = Math.round(value * 255);
        image.data[i * 4 + 3] = 255;
    });
    preview.putImageData(image, 0, 0);
}
function processDrawing() {
    const processed = preprocessImageData(context.getImageData(0, 0, canvas.width, canvas.height));
    renderPreview(processed.pixels);
    return processed;
}
function invalidatePrediction() {
    requestId++;
    $('result').textContent = 'Drawing changed. Recognize to update the prediction.';
    $('top-predictions').replaceChildren();
    $('feedback').textContent = '';
    $('preview-caption').textContent = 'Live 28 × 28 preview — not submitted yet.';
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(processDrawing);
}
const cancelStroke = attachDrawing(canvas, context, invalidatePrediction, () => Number($('stroke-width').value));
const clear = () => {
    cancelStroke();
    cancelAnimationFrame(previewFrame);
    requestId++;
    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);
    renderPreview(new Array(784).fill(0));
    $('result').textContent = 'No prediction yet.';
    $('top-predictions').replaceChildren();
    $('feedback').textContent = '';
    $('preview-caption').textContent = 'Blank input — nothing submitted.';
};
clear();
$('clear').addEventListener('click', clear);

function resetWorker() {
    worker?.terminate();
    worker = undefined;
    ready = false;
    requestId++;
    $('result').textContent = 'No prediction yet.';
    $('top-predictions').replaceChildren();
    $('feedback').textContent = '';
    $('predict').disabled = true;
    $('stop').disabled = true;
    $('train').disabled = !dataset;
    $('dataset').disabled = false;
    $('training-settings').disabled = false;
    $('training-metrics').textContent = '';
    $('evaluation-summary').textContent = 'No evaluation yet.';
    $('digit-metrics').querySelector('tbody').replaceChildren();
    $('confusion').replaceChildren();
}

function showEvaluation(report) {
    const percent = value => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
    const { splitCounts, training, validation, test } = report;
    $('training-metrics').textContent = `Selected epoch ${report.selectedEpoch}; ran ${report.epochsCompleted}. Training loss ${training.loss.toFixed(4)}, accuracy ${percent(training.accuracy)}; validation loss ${validation?.loss.toFixed(4) ?? 'n/a'}, accuracy ${percent(validation?.accuracy ?? null)}.`;
    $('evaluation-summary').textContent = `Samples: train ${splitCounts.train}, validation ${splitCounts.validation}, test ${splitCounts.test}. Test accuracy ${percent(test.accuracy)}; incorrect ${test.incorrect}/${test.count}. Removed ${report.duplicatesRemoved} exact duplicates. ${report.warning ?? ''}`;
    const row = (values, header = false) => {
        const tr = document.createElement('tr');
        for (const value of values) { const cell = document.createElement(header ? 'th' : 'td'); cell.textContent = String(value); tr.append(cell); }
        return tr;
    };
    $('digit-metrics').querySelector('tbody').replaceChildren(...test.perDigit.map(d => row([d.digit,d.count,percent(d.accuracy),d.incorrect])));
    const caption = document.createElement('caption');
    caption.textContent = 'Confusion matrix: rows = true digit, columns = prediction';
    $('confusion').replaceChildren(caption,row(['True / Predicted',0,1,2,3,4,5,6,7,8,9],true),...test.confusionMatrix.map((values,digit) => row([digit,...values])));
}

let fileRequest = 0;
$('dataset').addEventListener('change', async () => {
    const current = ++fileRequest;
    resetWorker();
    dataset = undefined;
    $('train').disabled = true;
    const file = $('dataset').files[0];
    if (!file) return;
    if (file.size > 5_000_000) { status('File exceeds 5 MB limit.'); return; }
    try {
        const text = await file.text();
        if (current !== fileRequest) return;
        dataset = text;
        $('train').disabled = false;
        status('Data loaded. Training will validate, remove exact duplicates, and create seeded per-digit splits.');
    } catch { status('Could not read the selected file.'); }
});

$('train').addEventListener('click', () => {
    for (const input of $('training-settings').querySelectorAll('input')) if (!input.reportValidity()) return;
    const options = { epochs: Number($('epochs').value), batchSize: Number($('batch-size').value), learningRate: Number($('learning-rate').value), seed: Number($('seed').value), patience: Number($('patience').value), augmentation: $('augmentation').checked };
    for (const name of ['rotation','translation','scale','thickness','intensity']) options[name] = Number($(name).value);
    resetWorker();
    worker = new Worker('./worker.mjs', { type: 'module' });
    $('train').disabled = true;
    $('dataset').disabled = true;
    $('stop').disabled = false;
    $('training-settings').disabled = true;
    status('Validating data…');
    worker.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') {
            status(`Epoch ${data.epoch}/${data.epochs}`);
            $('training-metrics').textContent = `Training loss ${data.trainingLoss.toFixed(4)}, accuracy ${(data.trainingAccuracy*100).toFixed(1)}%; validation loss ${data.validationLoss?.toFixed(4) ?? 'n/a'}, accuracy ${data.validationAccuracy === null ? 'n/a' : (data.validationAccuracy*100).toFixed(1)+'%'}.`;
        }
        if (data.type === 'restoring') status(`Restoring validation-selected model: replay epoch ${data.epoch}/${data.epochs}.`);
        if (data.type === 'ready') {
            ready = true;
            $('predict').disabled = false;
            $('dataset').disabled = false;
            $('train').disabled = false;
            $('training-settings').disabled = false;
            showEvaluation(data.report);
            status(`Ready · untouched test accuracy ${(data.accuracy * 100).toFixed(1)}% on ${data.count} samples. This does not measure canvas handwriting accuracy.`);
        }
        if (data.type === 'prediction' && data.requestId === requestId) {
            $('result').textContent = `Predicted digit: ${data.digit}`;
            $('top-predictions').replaceChildren(...data.top3.map(({ digit, probability }) => {
                const item = document.createElement('li');
                item.textContent = `${digit}: ${(probability * 100).toFixed(1)}%`;
                return item;
            }));
            $('feedback').textContent = data.uncertain
                ? 'Uncertain: the leading probability is low or the top two digits are close. Compare the preview with your drawing; try a clearer stroke or more representative training data.'
                : 'Model probabilities are not calibrated confidence. A high probability can still be wrong.';
        }
        if (data.type === 'error') { resetWorker(); status(data.message); }
    });
    worker.addEventListener('error', () => { resetWorker(); status('Worker failed. Check the browser console and dataset.'); });
    worker.postMessage({ type: 'train', json: dataset, options });
});
$('stop').addEventListener('click', () => { resetWorker(); status('Worker stopped and model discarded.'); });
$('predict').addEventListener('click', () => {
    cancelAnimationFrame(previewFrame);
    const processed = processDrawing();
    $('top-predictions').replaceChildren();
    $('feedback').textContent = '';
    const id = ++requestId;
    if (processed.blank) {
        $('result').textContent = 'Draw a digit first.';
        $('preview-caption').textContent = 'Blank input — nothing submitted.';
        return;
    }
    if (!ready) return;
    $('preview-caption').textContent = 'Exact 28 × 28 pixels submitted to the model.';
    $('result').textContent = 'Recognizing…';
    worker.postMessage({ type: 'predict', pixels: processed.pixels, requestId: id });
});
status('Load labeled data to begin. This is an educational demo, not a pretrained recognizer.');
