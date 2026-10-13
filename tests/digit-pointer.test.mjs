import assert from 'node:assert/strict';
import test from 'node:test';
import { attachDrawing } from '../examples/digits/drawing.mjs';

test('pointer mapping excludes scaled borders; secondary touches and cancelled strokes cannot draw',()=>{
    const listeners=new Map(), points=[];
    let capture=null,changes=0;
    const canvas={width:280,height:280,offsetWidth:284,offsetHeight:284,clientWidth:280,clientHeight:280,clientLeft:2,clientTop:2,
        getBoundingClientRect:()=>({left:10,top:20,width:142,height:142}),
        addEventListener:(name,fn)=>listeners.set(name,fn),setPointerCapture:id=>{capture=id;},
        hasPointerCapture:id=>capture===id,releasePointerCapture:()=>{capture=null;}};
    const context={beginPath(){},arc(x,y){points.push([x,y]);},fill(){},moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},stroke(){}};
    const cancel=attachDrawing(canvas,context,()=>changes++);
    const event={pointerId:1,isPrimary:true,button:0,clientX:81,clientY:91,preventDefault(){}};
    listeners.get('pointerdown')(event);
    assert.deepEqual(points[0],[140,140]);
    const count=points.length;
    listeners.get('pointerdown')({...event,pointerId:2,isPrimary:false});
    listeners.get('pointermove')({...event,pointerId:2});
    listeners.get('pointercancel')({...event,pointerId:2});
    assert.equal(points.length,count);
    listeners.get('pointermove')({...event,getCoalescedEvents:()=>[{...event,clientX:82},{...event,clientX:83}]});
    assert.deepEqual(points.at(-1),[144,140]);
    listeners.get('pointercancel')(event);
    listeners.get('pointermove')(event);
    assert.equal(changes,2);
    assert.equal(capture,null);
    listeners.get('pointerdown')({...event,pointerId:3});
    cancel();
    listeners.get('pointermove')({...event,pointerId:3});
    assert.equal(changes,3);
});
