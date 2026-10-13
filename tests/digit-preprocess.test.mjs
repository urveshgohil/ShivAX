import assert from 'node:assert/strict';
import test from 'node:test';
import { preprocessGrayscale, preprocessImageData, centerOfMass } from '../examples/digits/preprocess.mjs';
import { handwriting, rasterize } from './fixtures/handwriting.mjs';

test('blank/transparent input produces no digit, and invalid pixels are rejected', () => {
    assert.equal(preprocessGrayscale(new Float64Array(280*280),280,280).blank,true);
    const transparent = new Uint8ClampedArray(4*28*28).fill(255);
    for(let i=3;i<transparent.length;i+=4) transparent[i]=0;
    assert.equal(preprocessImageData({data:transparent,width:28,height:28}).blank,true);
    assert.throws(()=>preprocessGrayscale([NaN],1,1));
    assert.throws(()=>preprocessGrayscale([1.01],1,1));
    assert.throws(()=>preprocessGrayscale([1],2,2));
});

test('area resize preserves aspect ratio, grayscale, source and row-major order', () => {
    const source = new Float64Array(80*80);
    for(let y=20;y<60;y++) for(let x=30;x<50;x++) source[y*80+x]=0.5;
    const before=source.slice();
    const result=preprocessGrayscale(source,80,80);
    assert.deepEqual(source,before);
    assert.deepEqual(result.bounds,{left:30,top:20,right:49,bottom:59});
    assert.equal(result.pixels.length,784);
    assert.ok(result.pixels.every(p=>Number.isFinite(p)&&p>=0&&p<=1));
    assert.ok(Math.max(...result.pixels)<=0.51);
    const occupied=result.pixels.map((p,i)=>p>0?i:-1).filter(i=>i>=0);
    const xs=occupied.map(i=>i%28),ys=occupied.map(i=>Math.floor(i/28));
    assert.ok(Math.max(...ys)-Math.min(...ys)>Math.max(...xs)-Math.min(...xs));
    assert.ok(Math.max(...ys)-Math.min(...ys)<=21);
    assert.ok(result.pixels[13*28+13]>0);
    assert.equal(result.pixels[0],0);
});

test('asymmetric ink is centered by mass rather than bounding-box midpoint', () => {
    const source = new Float64Array(100*100);
    for(let y=10;y<85;y++) for(let x=35;x<45;x++) source[y*100+x]=1;
    for(let y=10;y<40;y++) for(let x=35;x<75;x++) source[y*100+x]=1;
    const center=centerOfMass(preprocessGrayscale(source,100,100).pixels);
    assert.ok(Math.abs(center.x-13.5)<0.1);
    assert.ok(Math.abs(center.y-13.5)<0.1);
});

test('edge drawings stay nonblank and translated shapes normalize identically', () => {
    const shape=(dx,dy)=>{
        const p=new Float64Array(80*80);
        for(let y=0;y<30;y++) for(let x=0;x<10;x++) p[(y+dy)*80+x+dx]=1;
        return preprocessGrayscale(p,80,80);
    };
    for(const [x,y] of [[0,0],[70,0],[0,50],[70,50],[30,20]]) {
        const output=shape(x,y);
        assert.equal(output.blank,false);
        assert.ok(Math.abs(output.center.x-13.5)<0.1);
        assert.ok(Math.abs(output.center.y-13.5)<0.1);
    }
    assert.deepEqual(shape(10,10).pixels,shape(30,30).pixels);
});

for(const example of handwriting) for(const thickness of [8,22,32]) {
    test(`${example.name}, stroke ${thickness}: antialiasing/range/centering`,()=>{
        const input=rasterize(example,{thickness});
        const result=preprocessGrayscale(input,280,280);
        assert.equal(result.blank,false);
        assert.equal(result.pixels.length,784);
        assert.ok(result.pixels.every(p=>p>=0&&p<=1&&Number.isFinite(p)));
        assert.ok(result.pixels.some(p=>p>0&&p<1));
        assert.ok(Math.abs(result.center.x-13.5)<0.15);
        assert.ok(Math.abs(result.center.y-13.5)<0.15);
        if(example.digit===8) {
            // Both loop interiors remain black relative to their surrounding strokes.
            const rowHoles = [8,19].map(y=>{
                const row=result.pixels.slice(y*28,(y+1)*28);
                const ink=row.map((p,i)=>p>0.1?i:-1).filter(i=>i>=0);
                return ink.length && row.slice(ink[0]+1,ink.at(-1)).some(p=>p<0.05);
            });
            assert.ok(rowHoles.every(Boolean),'8 loop detail must survive');
        }
    });
}

test('RGBA conversion composites alpha and produces preview-exact byte values',()=>{
    const data=new Uint8ClampedArray(40*40*4);
    for(let y=5;y<35;y++) for(let x=15;x<25;x++) {
        const i=(y*40+x)*4;
        data.set([255,255,255,128],i);
    }
    const {pixels}=preprocessImageData({data,width:40,height:40});
    assert.ok(Math.max(...pixels)<=128/255);
    assert.ok(pixels.every(p=>Math.round(p*255)/255===p));
});
