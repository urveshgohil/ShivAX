import assert from 'node:assert/strict';
import test from 'node:test';
import { seededRandom } from 'shivax';
import { parseDataset, stratifiedSplit, augmentImage, trainingOptions, evaluate, trainDigits } from '../examples/digits/training.mjs';
import { prepareSubset } from '../scripts/prepare-mnist.mjs';

const fixture = (count = 100) => ({ images: Array.from({length:count},(_,i)=>Array.from({length:784},(_,p)=>p===i%10 ? 1 : p===100+i ? 0.01 : 0)), labels: Array.from({length:count},(_,i)=>i%10) });

test('stratification is reproducible, disjoint and covers every digit in every split',()=>{
    const {labels}=fixture(500);
    const split=stratifiedSplit(labels,42);
    assert.deepEqual(split,stratifiedSplit(labels,42));
    assert.notDeepEqual(split,stratifiedSplit(labels,43));
    assert.equal(new Set([...split.train,...split.validation,...split.test]).size,500);
    for(const name of ['train','validation','test']) assert.equal(new Set(split[name].map(i=>labels[i])).size,10);
    assert.deepEqual([split.train.length,split.validation.length,split.test.length],[360,70,70]);
});

test('rare classes fall back explicitly or reject instead of leaking samples',()=>{
    const labels=[0,0,...Array.from({length:9},(_,i)=>new Array(6).fill(i+1)).flat()];
    const split=stratifiedSplit(labels);
    assert.equal(split.validation.length,0);
    assert.match(split.warning,/disabled/);
    assert.equal(new Set(split.train.map(i=>labels[i])).size,10);
    assert.equal(new Set(split.test.map(i=>labels[i])).size,10);
    assert.throws(()=>stratifiedSplit(labels.slice(1)),/two unique/);
});

test('dataset validation rejects oversized, blank, conflicting and malformed data; deduplicates exact images',()=>{
    const data=fixture();
    data.images[10]=data.images[0].slice();
    const parsed=parseDataset(JSON.stringify(data));
    assert.equal(parsed.duplicatesRemoved,1);
    assert.equal(parsed.images.length,99);
    data.labels[10]=1;
    assert.throws(()=>parseDataset(JSON.stringify(data)),/conflicting/);
    assert.throws(()=>parseDataset(' '.repeat(5_000_001)),/size/);
    const bad=fixture(); bad.images[0][0]=2;
    assert.throws(()=>parseDataset(JSON.stringify(bad)),/784 finite/);
    bad.images[0].fill(0);
    assert.throws(()=>parseDataset(JSON.stringify(bad)),/blank/);
    assert.throws(()=>parseDataset(JSON.stringify(fixture(501))),/50–500/);
});

test('augmentation is deterministic, bounded, non-mutating and independently configurable',()=>{
    const image=Array.from({length:784},(_,i)=>i%28>=10&&i%28<17&&Math.floor(i/28)>5&&Math.floor(i/28)<23?0.8:0);
    const original=image.slice(), options=trainingOptions();
    const a=augmentImage(image,seededRandom(42),options),b=augmentImage(image,seededRandom(42),options);
    assert.deepEqual(a,b); assert.deepEqual(image,original); assert.notDeepEqual(a,image);
    assert.equal(a.length,784); assert.ok(a.every(p=>p>=0&&p<=1&&Number.isFinite(p)));
    assert.deepEqual(augmentImage(image,seededRandom(),trainingOptions({augmentation:false})),image);
    for(const transform of ['rotation','translation','scale','thickness','intensity']) {
        const settings={rotation:0,translation:0,scale:0,thickness:0,intensity:0,[transform]:options[transform]};
        assert.notDeepEqual(augmentImage(image,seededRandom(10),trainingOptions(settings)),image,transform);
    }
    assert.throws(()=>trainingOptions({rotation:90}));
    assert.throws(()=>trainingOptions({epochs:101}));
    assert.throws(()=>trainingOptions({learningRate:0}));
    assert.throws(()=>trainingOptions({augmentation:'yes'}));
});

test('evaluation reports a hand-computed confusion matrix, per-digit errors and loss',()=>{
    const model={predict:row=>row[0]===0?[0.8,0.2,...new Array(8).fill(0)]:[0.6,0.4,...new Array(8).fill(0)]};
    const result=evaluate(model,[[0],[1]],[0,1],[0,1]);
    assert.equal(result.accuracy,0.5); assert.equal(result.incorrect,1);
    assert.equal(result.confusionMatrix[0][0],1); assert.equal(result.confusionMatrix[1][0],1);
    assert.equal(result.perDigit[1].accuracy,0); assert.equal(result.perDigit[2].accuracy,null);
    assert.ok(Math.abs(result.loss-(-Math.log(0.8)-Math.log(0.4))/2)<1e-12);
    assert.equal(evaluate(model,[],[],[]),null);
});

test('changing test pixels cannot affect training, validation history or model selection',()=>{
    const data=fixture(), original=JSON.stringify(data), options={epochs:4,seed:42,augmentation:true};
    const first=trainDigits(original,options);
    for(const index of first.report.sourceIndices.test) data.images[index]=data.images[index].map(p=>p*0.5);
    const second=trainDigits(JSON.stringify(data),options);
    assert.deepEqual(first.report.history,second.report.history);
    assert.equal(first.report.selectedEpoch,second.report.selectedEpoch);
    assert.deepEqual(first.model.predict(data.images[0]),second.model.predict(data.images[0]));
    const repeat=trainDigits(original,options);
    assert.deepEqual(first.report,repeat.report);
    assert.equal(JSON.stringify(fixture()),original);
});

test('early stopping restores the validation-selected epoch by exact replay',()=>{
    const data=fixture(50),random=seededRandom(99);
    data.images=data.images.map(()=>Array.from({length:784},()=>random()*0.2));
    const json=JSON.stringify(data), options={epochs:20,patience:1,learningRate:1,augmentation:true,seed:4};
    const result=trainDigits(json,options);
    assert.equal(result.report.earlyStopped,true);
    assert.ok(result.report.selectedEpoch<result.report.epochsCompleted);
    const selected=trainDigits(json,{...options,epochs:result.report.selectedEpoch,patience:0});
    assert.deepEqual(result.model.predict(data.images[0]),selected.model.predict(data.images[0]));
    assert.deepEqual(result.report.validation,selected.report.validation);
});

test('no-validation fallback disables early stopping and reports null validation',()=>{
    const data=fixture(50);
    data.labels=data.labels.map((label,i)=>label===0&&i>10?1:label);
    const {report}=trainDigits(JSON.stringify(data),{epochs:2,patience:1,augmentation:false});
    assert.equal(report.validation,null); assert.equal(report.selectedEpoch,2); assert.equal(report.earlyStopped,false);
});

function idxFixture() {
    const images=Buffer.alloc(16+100*784),labels=Buffer.alloc(8+100);
    images.writeUInt32BE(2051,0); images.writeUInt32BE(100,4); images.writeUInt32BE(28,8); images.writeUInt32BE(28,12);
    labels.writeUInt32BE(2049,0); labels.writeUInt32BE(100,4);
    for(let i=0;i<100;i++){ labels[8+i]=i%10; images[16+i*784+i]=128; images[16+i*784+783]=255; }
    return {images,labels};
}

test('local IDX preparation preserves original grayscale/orientation and produces a balanced bounded JSON',()=>{
    const {images,labels}=idxFixture();
    const json=prepareSubset(images,labels,50,42),data=JSON.parse(json);
    assert.equal(json,prepareSubset(images,labels,50,42));
    assert.notEqual(json,prepareSubset(images,labels,50,43));
    assert.deepEqual(Array.from({length:10},(_,digit)=>data.labels.filter(d=>d===digit).length),new Array(10).fill(5));
    assert.ok(data.images.every(row=>row.length===784&&row.includes(128/255)&&row[783]===1));
    assert.ok(Buffer.byteLength(json)<=5_000_000);
    assert.throws(()=>prepareSubset(images.subarray(0,-1),labels,50),/Truncated/);
    assert.throws(()=>prepareSubset(images,labels,51),/multiple/);
    const bad=Buffer.from(images); bad.writeUInt32BE(27,8);
    assert.throws(()=>prepareSubset(bad,labels,50),/28x28/);
});
