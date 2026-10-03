const $ = id => document.getElementById(id);
const canvas = $('drawing');
const context = canvas.getContext('2d', { willReadFrequently: true });
let worker;
let dataset;
let drawing = false;
let ready = false;
const status = text => { $('status').textContent = text; };
const clear = () => {
    context.fillStyle = 'black';
    context.fillRect(0, 0, 280, 280);
    $('result').textContent = 'No prediction yet.';
};
clear();
const point = event => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * 280 / rect.width, (event.clientY - rect.top) * 280 / rect.height];
};
canvas.addEventListener('pointerdown', event => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    context.strokeStyle = 'white';
    context.fillStyle = 'white';
    context.lineWidth = 22;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const [x, y] = point(event);
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
});
canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    context.lineTo(...point(event));
    context.stroke();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, () => { drawing = false; });
}
$('clear').addEventListener('click', clear);

function resetWorker() {
    worker?.terminate();
    worker = undefined;
    ready = false;
    $('predict').disabled = true;
    $('stop').disabled = true;
    $('train').disabled = !dataset;
    $('dataset').disabled = false;
}

$('dataset').addEventListener('change', async () => {
    resetWorker();
    dataset = undefined;
    $('train').disabled = true;
    const file = $('dataset').files[0];
    if (!file) return;
    if (file.size > 5_000_000) { status('File exceeds 5 MB limit.'); return; }
    // Parse/validate in the worker so malformed datasets cannot freeze the drawing UI.
    dataset = await file.text();
    $('train').disabled = false;
    status('Data loaded. Training will validate the schema and reserve 20% for evaluation.');
});

$('train').addEventListener('click', () => {
    resetWorker();
    worker = new Worker('./worker.mjs', { type: 'module' });
    $('train').disabled = true;
    $('dataset').disabled = true;
    $('stop').disabled = false;
    status('Validating data…');
    worker.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') status(`Epoch ${data.epoch}/30 · training loss ${data.loss.toFixed(4)}`);
        if (data.type === 'ready') {
            ready = true;
            $('predict').disabled = false;
            $('dataset').disabled = false;
            $('train').disabled = false;
            status(`Ready · held-out accuracy ${(data.accuracy * 100).toFixed(1)}% on ${data.count} samples. Draw a digit.`);
        }
        if (data.type === 'prediction') $('result').textContent = `Prediction: ${data.digit} · model score ${(data.score * 100).toFixed(1)}%`;
        if (data.type === 'error') { resetWorker(); status(data.message); }
    });
    worker.addEventListener('error', () => { resetWorker(); status('Worker failed. Check the browser console and dataset.'); });
    worker.postMessage({ type: 'train', json: dataset });
});
$('stop').addEventListener('click', () => { resetWorker(); status('Worker stopped and model discarded.'); });
$('predict').addEventListener('click', () => {
    if (!ready) return;
    const pixels = context.getImageData(0, 0, 280, 280).data;
    let left = 280, top = 280, right = -1, bottom = -1;
    for (let y = 0; y < 280; y++) for (let x = 0; x < 280; x++) {
        if (pixels[(y * 280 + x) * 4] > 20) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
    }
    if (right < 0) { $('result').textContent = 'Draw a digit first.'; return; }
    const small = document.createElement('canvas');
    small.width = small.height = 28;
    const ctx = small.getContext('2d');
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 28, 28);
    const width = right - left + 1, height = bottom - top + 1;
    const scale = 20 / Math.max(width, height);
    ctx.drawImage(canvas, left, top, width, height, (28 - width * scale) / 2, (28 - height * scale) / 2, width * scale, height * scale);
    const data = ctx.getImageData(0, 0, 28, 28).data;
    worker.postMessage({ type: 'predict', pixels: Array.from({ length: 784 }, (_, i) => data[i * 4] / 255) });
});
