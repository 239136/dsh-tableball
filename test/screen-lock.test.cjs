const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectGameDisplay,returnToLockedScreen}=require('../runtime/screen-lock.cjs');
const displays=[{id:1,workArea:{x:0,y:0,width:1920,height:1032}},{id:2,workArea:{x:1920,y:5,width:2048,height:1104}},{id:3,workArea:{x:-1280,y:-100,width:1280,height:1000}}];
test('select game display from pet position instead of always using primary',()=>{assert.equal(selectGameDisplay(displays,{x:2400,y:500},1).id,2);assert.equal(selectGameDisplay(displays,{x:500,y:500},1).id,1);assert.equal(selectGameDisplay(displays,{x:-1000,y:0},1).id,3);});
test('display gaps use explicit primary fallback without merging screens',()=>{assert.equal(selectGameDisplay(displays,{x:5000,y:0},1).id,1);});
test('manual drag does not fight user; release on another screen returns to locked table',()=>{const work={width:1920,height:1032};assert.equal(returnToLockedScreen({x:2100,y:500,radius:80,down:true},work),null);assert.deepEqual(returnToLockedScreen({x:2100,y:500,radius:80,down:false},work),{x:1840,y:500});assert.equal(returnToLockedScreen({x:500,y:500,radius:80,down:false},work),null);});
