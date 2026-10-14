let preprocessImageData, attachDrawing, LiveInference, ModelStore, renderChart, confusedPairs;
try {
    ({ preprocessImageData } = await import('./preprocess.mjs'));
    ({ attachDrawing } = await import('./drawing.mjs'));
    ({ LiveInference } = await import('./live-inference.mjs'));
    ({ ModelStore } = await import('./model-store.mjs'));
    ({ renderChart, confusedPairs } = await import('./dashboard.mjs'));
} catch (error) {
    document.getElementById('status').textContent = 'Could not load the playground scripts. Restart pnpm example:digits and reload the printed URL.';
    throw error;
}

const $ = id => document.getElementById(id);
const context = $('drawing').getContext('2d', { willReadFrequently: true });
const preview = $('input-preview').getContext('2d');
const store = new ModelStore();
let worker, dataset, pendingDataset;
let ready = false, training = false, modelBusy = false, datasetLoading = false;
let operation = 0, generation = 0, fileRequest = 0, modelAction = null, previewFrame, elapsedTimer;
let history = [], started = 0;
let lastAnnouncement = '', announcedAt = 0;
const probabilityCards = [];
const status = text => { $('status').textContent = text; };
const modelStatus = text => { $('model-status').textContent = text; };
const percent = value => value == null ? '—' : `${(value*100).toFixed(1)}%`;
const decimal = value => value == null ? '—' : value.toFixed(4);
function controls() {
    $('train').disabled = !dataset || training || modelBusy || datasetLoading;
    $('stop').disabled = !training;
    $('dataset').disabled = training || modelBusy;
    $('training-settings').disabled = training || modelBusy;
    $('predict').disabled = !ready || training || modelBusy;
    $('save-model').disabled = $('export-model').disabled = !ready || training || modelBusy;
    $('load-model').disabled = $('import-model').disabled = training || modelBusy;
}
function renderPreview(pixels) {
    const image = preview.createImageData(28,28);
    pixels.forEach((p,i) => { image.data[i*4] = image.data[i*4+1] = image.data[i*4+2] = Math.round(p*255); image.data[i*4+3] = 255; });
    preview.putImageData(image,0,0);
}
function processDrawing() {
    const result = preprocessImageData(context.getImageData(0,0,280,280));
    renderPreview(result.pixels); return result;
}
function probabilities(values = null) {
    if (!probabilityCards.length) $('probabilities').replaceChildren(...Array.from({length:10},(_,digit) => {
        const card = document.createElement('div');
        card.className = 'probability';
        const label = document.createElement('strong'); label.textContent = String(digit);
        const meter = document.createElement('meter'); meter.min=0; meter.max=1;
        const text = document.createElement('span');
        probabilityCards.push({card,meter,text});
        card.append(label,meter,text); return card;
    }));
    const winner = values ? values.indexOf(Math.max(...values)) : -1;
    probabilityCards.forEach(({card,meter,text},digit) => {
        card.classList.toggle('winner',digit===winner);
        meter.value=values?.[digit] ?? 0; meter.setAttribute('aria-label',`Digit ${digit}: ${percent(values?.[digit])}`);
        text.textContent=percent(values?.[digit]);
    });
}
function clearResults(note = 'Draw a digit to inspect a prediction.') {
    const visibleResult = $('result').textContent !== '—';
    $('result').textContent='—'; $('prediction-note').textContent=note;
    if (visibleResult || !probabilityCards.length) { $('top-predictions').replaceChildren(); $('feedback').textContent=''; probabilities(); }
    $('prediction-announcement').textContent='';
}
function showPrediction(data) {
    if (data.cached) $('preview-caption').textContent='Exact pixels match the previous request · cached result.';
    $('result').textContent=String(data.digit); $('prediction-note').textContent=`Predicted digit · leading probability ${percent(data.score)}`;
    $('top-predictions').replaceChildren(...data.top3.map(({digit,probability}) => { const li=document.createElement('li'); li.textContent=`${digit} · ${percent(probability)}`; return li; }));
    probabilities(data.probabilities);
    $('feedback').textContent=data.uncertain ? 'Ambiguous or low probability. Inspect the preview and alternatives; try a clearer drawing.' : 'Model probabilities are uncalibrated. A high score can still be wrong.';
    const now=performance.now(), announcement=`Predicted digit ${data.digit}${data.uncertain ? ', uncertain' : ''}.`;
    if (announcement !== lastAnnouncement && now-announcedAt > 2000) {
        $('prediction-announcement').textContent=announcement; lastAnnouncement=announcement; announcedAt=now;
    }
}
const live = new LiveInference({
    prepare: () => { cancelAnimationFrame(previewFrame); return processDrawing(); },
    send: message => { $('preview-caption').textContent='Exact 28 × 28 pixels submitted to the worker.'; ensureWorker().postMessage(message); },
    result: showPrediction,
    blank: () => { clearResults('Draw a digit first.'); $('preview-caption').textContent='Blank input — nothing submitted.'; },
});
function drawingChanged() {
    clearResults(ready ? 'Drawing changed…' : 'Train or load a model to recognize.');
    $('preview-caption').textContent='Live normalized preview · not yet submitted.';
    live.changed(); cancelAnimationFrame(previewFrame);
    previewFrame=requestAnimationFrame(processDrawing);
}
const cancelStroke = attachDrawing($('drawing'),context,drawingChanged,() => Number($('stroke-width').value));
function clearDrawing() {
    cancelStroke(); live.reset(); cancelAnimationFrame(previewFrame);
    context.fillStyle='black'; context.fillRect(0,0,280,280);
    renderPreview(new Array(784).fill(0)); clearResults(ready ? 'Draw a digit to begin.' : 'Train or load a model to begin.');
    $('preview-caption').textContent='Blank input — nothing submitted.';
}
$('clear').addEventListener('click',clearDrawing);
$('predict').addEventListener('click',() => live.request());
$('live-recognition').addEventListener('change',() => live.setEnabled($('live-recognition').checked));

function stopClock() { clearInterval(elapsedTimer); elapsedTimer=undefined; }
function tickClock() {
    const seconds=Math.floor((performance.now()-started)/1000);
    $('elapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} elapsed`;
}
function metricValues(metrics) {
    $('train-loss').textContent=decimal(metrics.trainingLoss); $('val-loss').textContent=decimal(metrics.validationLoss);
    $('train-accuracy').textContent=percent(metrics.trainingAccuracy); $('val-accuracy').textContent=percent(metrics.validationAccuracy);
}
function charts() { renderChart($('loss-chart'),history,'loss'); renderChart($('accuracy-chart'),history,'accuracy'); }
function clearDashboard(note='No evaluation available.') {
    stopClock(); history=[]; charts(); metricValues({});
    $('epoch-count').textContent=`0 / ${$('epochs').value}`; $('training-progress').value=0; $('training-progress').max=Number($('epochs').value);
    $('elapsed').textContent='00:00 elapsed'; $('training-state').textContent='Idle'; $('training-metrics').textContent='Start training to see epoch metrics.';
    $('evaluation-summary').textContent=note;
    for (const id of ['test-accuracy','test-correct','test-incorrect','split-counts']) $(id).textContent='—';
    $('digit-metrics').querySelector('tbody').replaceChildren(); $('confusion').replaceChildren(); $('confused-pairs').replaceChildren();
    $('matrix-detail').textContent='Select a populated confusion cell to inspect the pair.';
}
function showEvaluation(report) {
    const { splitCounts, training:train, validation, test }=report;
    history=report.history; charts();
    metricValues({trainingLoss:train.loss,trainingAccuracy:train.accuracy,validationLoss:validation?.loss,validationAccuracy:validation?.accuracy});
    $('training-metrics').textContent=`Selected epoch ${report.selectedEpoch}; completed ${report.epochsCompleted}. ${report.earlyStopped ? 'Early stopping applied.' : ''}`;
    $('evaluation-summary').textContent=`Untouched test samples. ${report.duplicatesRemoved} exact duplicates removed. ${report.warning ?? ''}`;
    $('test-accuracy').textContent=percent(test.accuracy); $('test-correct').textContent=String(test.correct); $('test-incorrect').textContent=String(test.incorrect);
    $('split-counts').textContent=`${splitCounts.train} / ${splitCounts.validation} / ${splitCounts.test}`;
    const row=values => { const tr=document.createElement('tr'); for(const value of values) { const td=document.createElement('td'); td.textContent=String(value); tr.append(td); } return tr; };
    $('digit-metrics').querySelector('tbody').replaceChildren(...test.perDigit.map(d=>row([d.digit,d.count,percent(d.accuracy),d.incorrect])));
    const caption=document.createElement('caption'); caption.textContent='True digit rows · prediction columns';
    const head=document.createElement('tr');
    for(const label of ['True / Predicted',0,1,2,3,4,5,6,7,8,9]) { const th=document.createElement('th'); th.scope='col'; th.textContent=String(label); head.append(th); }
    const body=test.confusionMatrix.map((values,truth) => {
        const tr=document.createElement('tr'),th=document.createElement('th'); th.scope='row'; th.textContent=String(truth); tr.append(th);
        values.forEach((count,predicted) => {
            const td=document.createElement('td');
            if (!count) { td.textContent='0'; tr.append(td); return; }
            if(count) td.className=truth===predicted?'matrix-correct':'matrix-error';
            const button=document.createElement('button'); button.className='matrix-cell'; button.textContent=String(count);
            button.setAttribute('aria-label',`True ${truth}, predicted ${predicted}: ${count} samples`);
            button.addEventListener('click',() => { $('matrix-detail').textContent=`${count} of ${test.perDigit[truth].count} true ${truth} samples were predicted as ${predicted}.`; });
            td.append(button); tr.append(td);
        }); return tr;
    });
    $('confusion').replaceChildren(caption,head,...body);
    const pairs=confusedPairs(test.confusionMatrix).slice(0,5);
    $('confused-pairs').replaceChildren(...(pairs.length ? pairs : [{truth:null}]).map(pair => {
        const li=document.createElement('li'); li.textContent=pair.truth===null ? 'No errors in this test split.' : `${pair.truth} → ${pair.predicted}: ${pair.count} errors`; return li;
    }));
}
function resetRuntime() {
    generation++; worker?.terminate(); worker=undefined; ready=false; training=false; modelBusy=false; modelAction=null;
    if(datasetLoading) { fileRequest++; pendingDataset=null; datasetLoading=false; }
    live.setReady(false); stopClock(); clearResults('Train or load a model to begin.'); controls();
}
function ensureWorker() {
    if (worker) return worker;
    const current=new Worker('./worker.mjs',{type:'module'}); worker=current;
    current.addEventListener('message',({data}) => {
        if(current !== worker) return;
        if(data.type==='validated' && pendingDataset?.requestId===data.requestId) {
            dataset=pendingDataset.json; $('dataset-note').textContent=`${pendingDataset.name}: ${data.count} unique samples, ${data.duplicatesRemoved} duplicates removed. ${data.warning ?? ''}`;
            pendingDataset=null; datasetLoading=false; controls(); status('Dataset validated. Configure training and start when ready.');
        }
        if(data.type==='progress') {
            history.push(data); metricValues(data); charts();
            $('epoch-count').textContent=`${data.epoch} / ${data.epochs}`; $('training-progress').max=data.epochs; $('training-progress').value=data.epoch;
            $('training-state').textContent='Training';
            $('training-metrics').textContent=`Epoch ${data.epoch}: original training and untouched validation samples.`;
            // Do not announce every epoch to screen readers.
        }
        if(data.type==='restoring') { $('training-state').textContent='Restoring'; $('training-metrics').textContent=`Restoring selected model: ${data.epoch} / ${data.epochs}.`; }
        if(data.type==='ready') {
            training=false; ready=true; tickClock(); stopClock(); $('training-state').textContent='Complete';
            showEvaluation(data.report); controls(); live.setReady(true);
            status(`Training complete. Test accuracy ${percent(data.accuracy)} on ${data.count} uploaded samples; canvas handwriting may differ.`);
            modelStatus('Active trained model. Save or export it explicitly to keep it.');
        }
        if(data.type==='prediction') live.receive(data);
        if(data.type==='imported' && modelAction?.requestId===data.requestId) {
            modelBusy=false; ready=true; modelAction=null;
            clearDashboard('Imported model: no verified evaluation history. Train on a dataset for test metrics.'); controls(); live.setReady(true);
            status('Model loaded. Drawing recognition is ready.'); modelStatus('Model loaded explicitly. No evaluation metrics were imported.');
        }
        if(data.type==='exported' && modelAction?.requestId===data.requestId) {
            const action=modelAction; modelAction=null;
            if(action.kind==='download') {
                const url=URL.createObjectURL(new Blob([data.json],{type:'application/json'}));
                const link=document.createElement('a'); link.href=url; link.download='shivax-digit-model.json'; link.click();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
                modelBusy=false; controls(); live.setReady(ready); modelStatus('JSON export created. It contains inference weights and configuration.');
            } else {
                store.save(data.json).then(() => { if(action.generation===generation) modelStatus('Model saved in this browser. Use Load saved model to restore it.'); })
                    .catch(error => { if(action.generation===generation) modelStatus(error.message); })
                    .finally(() => { if(action.generation===generation) { modelBusy=false; controls(); live.setReady(ready); } });
            }
        }
        if(data.type==='error') {
            if(data.operation==='predict') { live.fail(data.requestId); status(data.message); return; }
            if(data.operation==='validate' && pendingDataset?.requestId===data.requestId) {
                datasetLoading=false; pendingDataset=null; dataset=undefined; $('dataset-note').textContent=data.message; controls(); status('Dataset validation failed. Choose a corrected file.'); return;
            }
            if(data.operation==='import' || data.operation==='export') {
                modelBusy=false; modelAction=null; controls(); live.setReady(ready); modelStatus(data.message); return;
            }
            resetRuntime(); $('training-state').textContent='Error'; status(data.message);
        }
    });
    current.addEventListener('error',() => {
        if(current!==worker) return;
        resetRuntime(); $('training-state').textContent='Error'; status('Worker could not run. Restart the demo server and reload its printed URL.');
    });
    return current;
}
$('dataset').addEventListener('change',async () => {
    const token=++fileRequest; dataset=undefined; datasetLoading=true; controls();
    const file=$('dataset').files[0];
    if(!file) { datasetLoading=false; controls(); $('dataset-note').textContent='No dataset selected.'; return; }
    if(file.size>5_000_000) { datasetLoading=false; controls(); $('dataset-note').textContent='Dataset exceeds the 5 MB limit.'; return; }
    try {
        const json=await file.text(); if(token!==fileRequest) return;
        pendingDataset={requestId:++operation,json,name:file.name}; $('dataset-note').textContent='Validating in worker…';
        ensureWorker().postMessage({type:'validate',json,requestId:pendingDataset.requestId});
    } catch(error) { if(token===fileRequest) { datasetLoading=false; controls(); status(error.message); } }
});
$('train').addEventListener('click',() => {
    for(const input of $('training-settings').querySelectorAll('input')) if(!input.checkValidity()) { input.closest('details')?.setAttribute('open',''); input.reportValidity(); return; }
    const options={epochs:Number($('epochs').value),batchSize:Number($('batch-size').value),learningRate:Number($('learning-rate').value),seed:Number($('seed').value),patience:Number($('patience').value),augmentation:$('augmentation').checked};
    for(const key of ['rotation','translation','scale','thickness','intensity']) options[key]=Number($(key).value);
    resetRuntime(); clearDashboard(); training=true; controls();
    started=performance.now(); elapsedTimer=setInterval(tickClock,1000); $('training-state').textContent='Training'; status('Training started. Drawing remains available; inference resumes after training.');
    try { ensureWorker().postMessage({type:'train',json:dataset,options}); } catch(error) { resetRuntime(); status(error.message); }
});
async function discard() {
    resetRuntime(); clearDashboard(); status('Active model discarded.'); modelStatus('Deleting the saved browser copy…');
    const token=generation;
    try { await store.remove(); if(token===generation) modelStatus('Active and saved model discarded. Nothing will be restored automatically.'); }
    catch(error) { if(token===generation) modelStatus(`Active model discarded. Saved copy could not be deleted: ${error.message}`); }
}
$('stop').addEventListener('click',discard);
$('discard-model').addEventListener('click',discard);
function exportModel(kind) {
    modelBusy=true; controls(); live.setReady(false);
    modelAction={kind,requestId:++operation,generation}; modelStatus(kind==='save'?'Saving model…':'Preparing export…');
    ensureWorker().postMessage({type:'export',requestId:modelAction.requestId});
}
$('save-model').addEventListener('click',()=>exportModel('save'));
$('export-model').addEventListener('click',()=>exportModel('download'));
function importText(json,token) {
    if(token!==generation) return;
    modelAction={kind:'import',requestId:++operation,generation}; ensureWorker().postMessage({type:'import',json,requestId:modelAction.requestId});
}
$('import-model').addEventListener('change',async () => {
    const file=$('import-model').files[0]; if(!file) return;
    if(file.size>32_000_000) { modelStatus('Model exceeds the 32 MB limit.'); $('import-model').value=''; return; }
    const token=generation; modelBusy=true; controls(); live.setReady(false); modelStatus('Validating model in worker…');
    try { const json=await file.text(); importText(json,token); }
    catch(error) { if(token===generation) { modelBusy=false; controls(); live.setReady(ready); modelStatus(error.message); } }
    finally { $('import-model').value=''; }
});
$('load-model').addEventListener('click',async () => {
    const token=generation; modelBusy=true; controls(); live.setReady(false); modelStatus('Loading saved model…');
    try {
        const json=await store.load(); if(token!==generation) return;
        if(!json) { modelBusy=false; controls(); live.setReady(ready); modelStatus('No model is saved in this browser.'); return; }
        importText(json,token);
    } catch(error) { if(token===generation) { modelBusy=false; controls(); live.setReady(ready); modelStatus(error.message); } }
});
window.addEventListener('pagehide',() => { resetRuntime(); cancelAnimationFrame(previewFrame); });
window.addEventListener('pageshow',event => { if (event.persisted) { clearDashboard(); status('Page restored. Explicitly load/import a model or train again.'); } });
clearDashboard(); clearDrawing(); controls();
status('Ready to explore. Choose a dataset to train, or explicitly load/import a model.');
