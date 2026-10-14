import assert from 'node:assert/strict';
import test from 'node:test';
import { NeuralNet, classificationAccuracy, crossEntropy, evaluateClassification, evaluateRegression } from 'shivax';

const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function linear(optimizer='sgd') {
    const json=new NeuralNet({layers:[1,1],task:'regression',optimizer}).toJSON();
    json.parameters[0].weights=[0]; json.parameters[0].biases=[0];
    return NeuralNet.fromJSON(json);
}
const step=net=>net.train([[1]],[[1]],{epochs:1,learningRate:0.1,shuffle:false});

test('default initialization and SGD preserve the established XOR output',()=>{
    const net=new NeuralNet({layers:[2,8,1],task:'binary',seed:42});
    net.train([[0,0],[0,1],[1,0],[1,1]],[[0],[1],[1],[0]],{epochs:2000,learningRate:0.5,batchSize:4});
    near(net.predict([0,0])[0],0.0005891139621383979,1e-15);
});

test('SGD and momentum updates match hand calculations across calls',()=>{
    const sgd=linear(); step(sgd); near(sgd.toJSON().parameters[0].weights[0],0.2);
    step(sgd); near(sgd.toJSON().parameters[0].weights[0],0.32);
    const momentum=linear({type:'momentum',momentum:0.9});
    step(momentum); near(momentum.toJSON().parameters[0].weights[0],0.2);
    step(momentum); near(momentum.toJSON().parameters[0].weights[0],0.5);
    momentum.resetOptimizer(); step(momentum); near(momentum.toJSON().parameters[0].weights[0],0.5);
});

test('Adam moments and bias correction match two hand-calculated steps',()=>{
    const beta1=0.8,beta2=0.9,epsilon=1e-6;
    const net=linear({type:'adam',beta1,beta2,epsilon});
    const g1=-2,m1=(1-beta1)*g1,v1=(1-beta2)*g1*g1;
    const w1=-0.1*(m1/(1-beta1))/(Math.sqrt(v1/(1-beta2))+epsilon);
    step(net); near(net.toJSON().parameters[0].weights[0],w1);
    const g2=2*(2*w1-1),m2=beta1*m1+(1-beta1)*g2,v2=beta2*v1+(1-beta2)*g2*g2;
    const w2=w1-0.1*(m2/(1-beta1**2))/(Math.sqrt(v2/(1-beta2**2))+epsilon);
    step(net); near(net.toJSON().parameters[0].weights[0],w2);
});

test('optimizer state persists, resets on reconfiguration, and rejects bad options',()=>{
    const a=linear('adam'),b=linear('adam');
    a.train([[1]],[[1]],{epochs:2,learningRate:0.1,shuffle:false});
    step(b); step(b); assert.deepEqual(a.toJSON(),b.toJSON());
    b.train([[1]],[[1]],{epochs:1,learningRate:0.1,shuffle:false,optimizer:'sgd'});
    const clone=NeuralNet.fromJSON(a.toJSON());
    clone.train([[1]],[[1]],{epochs:1,learningRate:0.1,shuffle:false,optimizer:'sgd'});
    assert.deepEqual(b.toJSON(),clone.toJSON());
    for(const optimizer of ['unknown',{type:'adam',beta1:1},{type:'momentum',momentum:-1},{type:'adam',epsilon:0}]) {
        assert.throws(()=>new NeuralNet({layers:[1,1],task:'regression',optimizer}));
    }
});

test('failed numerical update commits neither weights nor Adam state',()=>{
    const a=linear('adam'),b=linear('adam'); step(a); step(b);
    const before=a.toJSON();
    assert.throws(()=>a.train([[1e154]],[[1e308]],{epochs:1,shuffle:false}),/gradient|moment|update|finite/);
    assert.deepEqual(a.toJSON(),before);
    step(a); step(b); assert.deepEqual(a.toJSON(),b.toJSON());
    assert.throws(()=>a.predict([Infinity]));
});

for(const activation of ['tanh','relu','leakyRelu','sigmoid']) {
    test(`${activation} derivatives agree with finite-difference gradients`,()=>{
        const net=new NeuralNet({layers:[2,3,1],task:'binary',activation,seed:7});
        // Keep finite-difference points away from ReLU/Leaky ReLU kinks.
        net.parameters[0].biases.set([0.5,-0.8,1]);
        const input=[0.2,-0.4];
        const loss=()=>-Math.log(net.predict(input)[0]);
        const entries=[];
        for(const layer of net.parameters) for(const key of ['weights','biases']) for(let i=0;i<layer[key].length;i++) {
            const buffer=layer[key],original=buffer[i],epsilon=1e-5;
            buffer[i]=original+epsilon; const plus=loss();
            buffer[i]=original-epsilon; const minus=loss(); buffer[i]=original;
            entries.push({buffer,i,original,gradient:(plus-minus)/(2*epsilon)});
        }
        net.train([input],[[1]],{epochs:1,learningRate:0.01,shuffle:false});
        for(const {buffer,i,original,gradient} of entries) near((original-buffer[i])/0.01,gradient,1e-7);
    });
}

test('He and auto initialization are seeded and retain task-specific outputs',()=>{
    const config={layers:[2,8,1],task:'binary',activation:'relu',initialization:'auto',seed:123};
    const a=new NeuralNet(config),b=new NeuralNet(config);
    assert.deepEqual(a.toJSON(),b.toJSON());
    assert.notDeepEqual(a.toJSON().parameters,new NeuralNet({...config,initialization:'xavier'}).toJSON().parameters);
    const scale=Math.sqrt(6/2);
    assert.ok(a.toJSON().parameters[0].weights.every(w=>Math.abs(w)<=scale));
    assert.ok(a.predict([1,-1])[0]>=0&&a.predict([1,-1])[0]<=1);
    for(const option of [{activation:'bad'},{initialization:'bad'},{negativeSlope:0},{seed:NaN},{learningRate:Infinity}]) assert.throws(()=>new NeuralNet({...config,...option}));
});

test('Adam with Leaky ReLU converges on deterministic XOR',()=>{
    const x=[[0,0],[0,1],[1,0],[1,1]],y=[[0],[1],[1],[0]];
    const train=()=>{
        const net=new NeuralNet({layers:[2,8,1],task:'binary',activation:'leakyRelu',initialization:'auto',optimizer:'adam',seed:42});
        const result=net.train(x,y,{epochs:1200,learningRate:0.02,batchSize:4});
        assert.ok(result.losses.at(-1)<0.03);
        assert.deepEqual(x.map(row=>net.predictClass(row)),[0,1,1,0]);
        return net.toJSON();
    };
    assert.deepEqual(train(),train());
});

test('serialization restores all tasks exactly and returns independent arrays',()=>{
    for(const [task,width] of [['binary',1],['multiclass',3],['regression',2]]) {
        const net=new NeuralNet({layers:[2,4,width],task,activation:'sigmoid',optimizer:'adam'});
        const targets=task==='binary'?[[1]]:task==='multiclass'?[[0,1,0]]:[[0.4,-0.5]];
        net.train([[0.2,-0.1]],targets,{epochs:3,learningRate:0.01});
        const data=net.toJSON(),restored=NeuralNet.fromJSON(JSON.stringify(data));
        assert.deepEqual(restored.predict([0.3,-0.2]),net.predict([0.3,-0.2]));
        data.parameters[0].weights.fill(999);
        assert.deepEqual(restored.predict([0.3,-0.2]),net.predict([0.3,-0.2]));
    }
});

test('serialization rejects malformed, nonfinite, oversized and executable fields',()=>{
    const base=linear().toJSON();
    for(const mutate of [
        data=>{data.version=2;},data=>{data.parameters[0].weights=[NaN];},data=>{data.parameters[0].biases=[];},
        data=>{data.config.layers=[4096,4096];},data=>{data.config.activation='eval';},data=>{delete data.parameters[0].weights[0];},
        data=>{data.parameters=[];},data=>{data.execute='alert(1)';},
    ]) { const data=structuredClone(base); mutate(data); assert.throws(()=>NeuralNet.fromJSON(data)); }
    assert.throws(()=>NeuralNet.fromJSON('x'.repeat(32_000_001)),/limit/);
    let executed=false;
    const data=structuredClone(base);
    Object.defineProperty(data.parameters[0].weights,'0',{get(){executed=true;return 0;}});
    assert.throws(()=>NeuralNet.fromJSON(data)); assert.equal(executed,false);
    const layers=structuredClone(base);
    Object.defineProperty(layers.config.layers,'0',{get(){executed=true;return 1;}});
    assert.throws(()=>NeuralNet.fromJSON(layers)); assert.equal(executed,false);
});

test('classification metrics match hand-computed precision/recall and binary loss',()=>{
    const predictions=[[0.8,0.2],[0.7,0.3],[0.1,0.9]],labels=[0,1,1];
    const metrics=evaluateClassification(predictions,labels);
    near(metrics.accuracy,2/3); assert.deepEqual(metrics.confusionMatrix,[[1,0],[1,1]]);
    near(metrics.perClass[0].precision,0.5); near(metrics.perClass[0].recall,1);
    near(metrics.perClass[1].precision,1); near(metrics.perClass[1].recall,0.5);
    near(crossEntropy(predictions,labels),(-Math.log(0.8)-Math.log(0.3)-Math.log(0.9))/3);
    near(evaluateClassification([[0.1],[0.9]],[0,1]).crossEntropy,-Math.log(0.9));
    near(classificationAccuracy([0,0,1],labels),2/3);
    assert.equal(evaluateClassification([[1,0,0]],[0]).perClass[2].recall,0);
    assert.throws(()=>evaluateClassification([[0.2,0.2]],[0]));
    assert.throws(()=>evaluateClassification([[NaN]],[0]));
    assert.throws(()=>evaluateClassification([[1]],[2]));
});

test('regression metrics match MSE/MAE/R² and reject numerical overflow',()=>{
    const result=evaluateRegression([[2],[2],[4]],[[1],[2],[3]]);
    near(result.meanSquaredError,2/3); near(result.meanAbsoluteError,2/3); near(result.rSquared,0);
    assert.equal(evaluateRegression([[1],[1]],[[1],[1]]).rSquared,null);
    assert.throws(()=>evaluateRegression([[Infinity]],[[1]]));
    assert.throws(()=>evaluateRegression([[1e308]],[[-1e308]]));
    assert.throws(()=>evaluateRegression([[1,2]],[[1]]));
});
