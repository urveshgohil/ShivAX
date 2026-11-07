import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { NeuralNet } from 'shivax';
import { LiveInference } from '../examples/digits/live-inference.mjs';
import { ModelStore } from '../examples/digits/model-store.mjs';
import { chartPoints, confusedPairs } from '../examples/digits/dashboard.mjs';

function liveFixture() {
    const timers=new Map(),sent=[],shown=[]; let number=0,blank=false,pixels=[1];
    const live=new LiveInference({prepare:()=>({pixels,blank}),send:m=>sent.push(m),result:m=>shown.push(m),blank:()=>shown.push('blank'),
        schedule:fn=>{timers.set(++number,fn);return number;},cancel:id=>timers.delete(id)});
    const flush=()=>{for(const [id,fn] of [...timers]) {timers.delete(id);fn();}};
    return {live,sent,shown,flush,timers,setPixels:value=>{pixels=value;},setBlank:value=>{blank=value;}};
}

test('live inference debounces, pauses without a model, and avoids duplicate normalized inputs',()=>{
    const f=liveFixture(); f.live.changed(); f.flush(); assert.equal(f.sent.length,0);
    f.live.setReady(true); f.live.changed(); f.live.changed(); assert.equal(f.timers.size,1);
    f.flush(); assert.equal(f.sent.length,1);
    f.live.receive({requestId:f.sent[0].requestId,digit:1});
    f.live.changed(); f.flush(); assert.equal(f.sent.length,1); assert.equal(f.shown.at(-1).cached,true);
    f.live.setEnabled(false); f.setPixels([2]); f.live.changed(); f.flush(); assert.equal(f.sent.length,1);
    f.live.request(); assert.equal(f.sent.length,2);
});

test('live inference keeps one request in flight and rejects stale or discarded responses',()=>{
    const f=liveFixture(); f.live.setReady(true); f.flush(); const old=f.sent[0].requestId;
    f.setPixels([2]); f.live.changed(); f.flush(); assert.equal(f.sent.length,1);
    f.live.receive({requestId:old,digit:1}); assert.equal(f.shown.length,0);
    f.flush(); assert.equal(f.sent.length,2);
    f.live.receive({requestId:old,digit:1}); assert.equal(f.shown.length,0);
    f.live.receive({requestId:f.sent[1].requestId,digit:2}); assert.equal(f.shown[0].digit,2);
    f.live.setReady(false); f.live.receive({requestId:f.sent[1].requestId,digit:3}); assert.equal(f.shown.length,1);
    assert.equal(f.timers.size,0);
});

test('blank drawings never enter inference and failed requests release the flight',()=>{
    const f=liveFixture(); f.setBlank(true); f.live.setReady(true); f.flush(); assert.equal(f.sent.length,0); assert.equal(f.shown[0],'blank');
    f.setBlank(false); f.live.request(); f.live.fail(f.sent[0].requestId); f.live.request(); assert.equal(f.sent.length,2);
});

test('a manual request made during a flight is honored even with live mode disabled',()=>{
    const f=liveFixture(); f.live.setEnabled(false); f.live.setReady(true); f.live.request();
    f.setPixels([2]); f.live.changed(); f.live.request(); assert.equal(f.sent.length,1);
    f.live.receive({requestId:f.sent[0].requestId,digit:1}); assert.equal(f.shown.length,0);
    f.flush(); assert.equal(f.sent.length,2);
    f.live.receive({requestId:f.sent[1].requestId,digit:2}); assert.equal(f.shown[0].digit,2);
});

test('default timer wrappers preserve the browser global receiver',async()=>{
    const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
    let live;
    try {
        globalThis.setTimeout=function(fn){assert.equal(this,globalThis);return originalSet(fn,0);};
        globalThis.clearTimeout=function(id){assert.equal(this,globalThis);return originalClear(id);};
        await new Promise(resolve=>{
            live=new LiveInference({prepare:()=>({pixels:[1],blank:false}),send:resolve,result(){},blank(){}});
            live.setReady(true);
        });
        live.setReady(false);
    } finally {globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('chart coordinates and confusion-pair ranking match hand-computed data',()=>{
    const points=chartPoints([{loss:0},{loss:1},{loss:null}],'loss',1);
    assert.deepEqual(points,[[34,140],[209,28],null]);
    assert.deepEqual(confusedPairs([[3,2],[1,4]]),[{truth:0,predicted:1,count:2},{truth:1,predicted:0,count:1}]);
});

function fakeStorage() {
    const records=new Map(); let opens=0,closes=0,created=false;
    const factory={open(){
        opens++; const request={}; const db={createObjectStore(){created=true;},close(){closes++;},transaction(){
            const transaction={};
            const operation=fn=>{
                const result={}; queueMicrotask(()=>{result.result=fn();result.onsuccess?.();queueMicrotask(()=>transaction.oncomplete?.());}); return result;
            };
            transaction.objectStore=()=>({put:(value,key)=>operation(()=>records.set(key,value)),get:key=>operation(()=>records.get(key)),delete:key=>operation(()=>records.delete(key))});
            return transaction;
        }};
        queueMicrotask(()=>{request.result=db;if(!created)request.onupgradeneeded?.();request.onsuccess?.();});return request;
    }};
    return {factory,records,counts:()=>({opens,closes})};
}

test('browser storage is explicit and queued discard removes an in-flight saved copy',async()=>{
    const fake=fakeStorage(),store=new ModelStore(fake.factory);
    assert.deepEqual(fake.counts(),{opens:0,closes:0});
    assert.equal(await store.load(),undefined);
    await store.save('model'); assert.equal(await store.load(),'model');
    const saving=store.save('new'); const discarding=store.remove(); await Promise.all([saving,discarding]);
    assert.equal(await store.load(),undefined);
    assert.equal(fake.counts().opens,fake.counts().closes);
    await assert.rejects(new ModelStore(null).load(),/unavailable/);
});

function response(worker,type,requestId) {
    return new Promise((resolve,reject)=>{
        const message=data=>{
            if(data.requestId!==requestId)return;
            if(data.type===type){cleanup();resolve(data);}
            else if(data.type==='error'){cleanup();reject(new Error(data.message));}
        };
        const fail=error=>{cleanup();reject(error);};
        const cleanup=()=>{worker.off('message',message);worker.off('error',fail);};
        worker.on('message',message);worker.on('error',fail);
    });
}

test('worker imports/exports digit models, validates datasets and preserves a model on invalid import', {timeout:15000}, async()=>{
    const worker=new Worker(new URL('./fixtures/digit-worker.mjs',import.meta.url));
    try {
        const model=new NeuralNet({layers:[784,10],task:'multiclass',seed:9}),pixels=new Array(784).fill(0);pixels[20]=1;
        const imported=response(worker,'imported',1);worker.postMessage({type:'import',json:JSON.stringify(model.toJSON()),requestId:1});await imported;
        const predicted=response(worker,'prediction',2);worker.postMessage({type:'predict',pixels,requestId:2});const prediction=await predicted;
        assert.deepEqual(prediction.probabilities,model.predict(pixels));assert.equal(prediction.probabilities.length,10);
        const exported=response(worker,'exported',3);worker.postMessage({type:'export',requestId:3});const {json}=await exported;
        assert.deepEqual(NeuralNet.fromJSON(json).predict(pixels),model.predict(pixels));
        const invalid=response(worker,'imported',4);worker.postMessage({type:'import',json:JSON.stringify(new NeuralNet({layers:[2,1],task:'binary'}).toJSON()),requestId:4});await assert.rejects(invalid,/784 inputs/);
        const after=response(worker,'prediction',5);worker.postMessage({type:'predict',pixels,requestId:5});assert.deepEqual((await after).probabilities,prediction.probabilities);
        const dataset={images:Array.from({length:50},(_,i)=>Array.from({length:784},(_,p)=>p===i%10?1:p===50+i?0.01:0)),labels:Array.from({length:50},(_,i)=>i%10)};
        const validated=response(worker,'validated',6);worker.postMessage({type:'validate',json:JSON.stringify(dataset),requestId:6});assert.equal((await validated).count,50);
        const discarded=response(worker,'discarded',7);worker.postMessage({type:'discard',requestId:7});await discarded;
        const rejected=response(worker,'prediction',8);worker.postMessage({type:'predict',pixels,requestId:8});await assert.rejects(rejected,/Train a model/);
    } finally {await worker.terminate();}
});
