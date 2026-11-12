'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PhysicsEngine, segmentCircle, MAX_DT } = require('../runtime/physics.cjs');
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance, a+' != '+b);
const engine=(balls, extra={})=>new PhysicsEngine({table:{x:0,y:0,width:1000,height:600},ballRadius:10,friction:0,balls,...extra});
const advance=(g,seconds)=>{const out=[];while(seconds>1e-8){const dt=Math.min(.25,seconds);out.push(...g.step(dt));seconds-=dt;}return out;};

test('default dimensions use correct proportional radius, nine balls and six pockets',()=>{
  const g=new PhysicsEngine();const s=g.snapshot();close(s.radius,16.512);
  assert.equal(s.balls.length,9);assert.equal(s.pockets.length,6);assert.equal(s.remaining,9);
  assert.deepEqual(s.pockets.map(p=>[p.x,p.y]),[[0,0],[960,0],[1920,0],[0,1032],[960,1032],[1920,1032]]);
  for(let i=0;i<9;i++)for(let j=i+1;j<9;j++)assert.ok(Math.hypot(s.balls[i].x-s.balls[j].x,s.balls[i].y-s.balls[j].y)>=s.radius*2);
});
test('offset work area and detached snapshots',()=>{
  const g=new PhysicsEngine({table:{x:-1920,y:42,width:1920,height:1032}}),s=g.snapshot();
  assert.deepEqual(s.breakPoint,{x:-1440,y:558});s.balls[0].x=999;s.pockets[0].x=999;s.table.x=999;
  assert.notEqual(g.snapshot().balls[0].x,999);assert.equal(g.snapshot().pockets[0].x,-1920);
});
test('segment-circle handles swept crossing, tangent, stationary and miss',()=>{
  close(segmentCircle(-10,0,10,0,0,0,1),.45);
  close(segmentCircle(-10,1,10,1,0,0,1),.5);
  assert.equal(segmentCircle(0,0,0,0,0,0,1),0);
  assert.equal(segmentCircle(10,0,10,0,0,0,1),null);
  assert.equal(segmentCircle(-10,2,10,2,0,0,1),null);
});
test('cue crossing between samples transfers velocity one-way without mutating cue',()=>{
  const g=engine([{x:500,y:300}]);
  const a=Object.freeze({x:100,y:300,radius:10}),b=Object.freeze({x:900,y:300,radius:10});
  g.step(.01,a);g.step(.01,b);
  assert.ok(g.balls[0].vx>0);assert.ok(g.balls[0].x>500);assert.deepEqual(b,{x:900,y:300,radius:10});
});
test('first sample or reacquisition does not infer a phantom throw',()=>{
  const g=engine([{x:500,y:300}]);g.step(.01,{x:505,y:300,radius:10});assert.equal(g.balls[0].vx,0);
  g.step(.01);g.step(.01,{x:900,y:300,radius:10});assert.equal(g.balls[0].vx,0);
});
test('cue swept miss and receding overlap do not kick balls',()=>{
  const g=engine([{x:500,y:300}]);g.step(.01,{x:100,y:340,radius:10});g.step(.01,{x:900,y:340,radius:10});
  assert.equal(g.balls[0].vx,0);
  const h=engine([{x:500,y:300}]);h.step(.01,{x:510,y:300,radius:10});h.step(.01,{x:515,y:300,radius:10});assert.equal(h.balls[0].vx,0);
});
test('equal-mass head-on collision conserves momentum with configured restitution',()=>{
  const g=engine([{x:400,y:300,vx:100},{x:425,y:300}],{ballRestitution:1});g.step(.1);
  close(g.balls[0].vx,0);close(g.balls[1].vx,100);close(g.balls[0].vx+g.balls[1].vx,100);
});
test('fast ball pair does not tunnel and stays finite',()=>{
  const g=engine([{x:300,y:300,vx:1e9},{x:700,y:300,vx:-1e9}],{ballRestitution:1,wallRestitution:1});g.step(.01);
  assert.ok(g.balls[0].x<g.balls[1].x);
  for(const b of g.balls)for(const k of ['x','y','vx','vy'])assert.ok(Number.isFinite(b[k]));
});
test('coincident balls separate deterministically without NaN',()=>{
  const g=engine([{x:400,y:300},{x:400,y:300}]);g.step(.01);
  close(Math.hypot(g.balls[0].x-g.balls[1].x,g.balls[0].y-g.balls[1].y),20);
});
test('exponential friction matches elapsed simulation time and eventually sleeps',()=>{
  const g=engine([{x:200,y:300,vx:100}],{friction:.55});advance(g,1);close(g.balls[0].vx,100*Math.exp(-.55));
  advance(g,10);assert.equal(g.balls[0].vx,0);
});
test('walls reflect outward motion at .82 restitution without gaining speed',()=>{
  const g=engine([{x:15,y:300,vx:-100}]);g.step(.1);close(g.balls[0].vx,82);assert.ok(g.balls[0].x>=10);
});
test('all six pockets score once, including swept top and bottom middle entry',()=>{
  for(const [x,y,vx,vy] of [[12,12,-100,-100],[500,40,0,-1000],[988,12,100,-100],[12,588,-100,100],[500,560,0,1000],[988,588,100,100]]){
    const g=engine([{x,y,vx,vy}]);const events=g.step(.05);
    assert.equal(events.filter(e=>e.type==='pocket').length,1);assert.equal(g.score,10);assert.equal(g.balls[0].pocketed,true);
    assert.equal(g.step(.05).filter(e=>e.type==='pocket').length,0);
  }
});
test('combo points progress 10/13/16/20 and cap at 2x',()=>{
  const g=engine(Array.from({length:5},(_,i)=>({x:i*100+100,y:300})));
  const values=[];
  for(let i=0;i<5;i++){g.balls[i].x=500;g.balls[i].y=0;values.push(...g.step(.01).filter(e=>e.type==='pocket').map(e=>e.points));}
  assert.deepEqual(values,[10,13,16,20,20]);assert.equal(g.score,79);assert.equal(g.snapshot().multiplier,2);
});
test('combo expires at eight seconds but not just before',()=>{
  const g=engine([{x:500,y:0},{x:300,y:300},{x:700,y:300}]);g.step(.01);
  advance(g,7.9);g.balls[1].x=500;g.balls[1].y=0;
  assert.equal(g.step(.01).find(e=>e.type==='pocket').points,13);
  advance(g,8);g.balls[2].x=500;g.balls[2].y=0;
  assert.equal(g.step(.01).find(e=>e.type==='pocket').points,10);
});
test('scratch deducts twenty, clamps score and resets combo; lingering samples latch',()=>{
  const g=engine([{x:100,y:300}]);g.score=35;g.roundScore=35;g.combo=3;
  g.step(.01,{x:500,y:200,radius:10});const cue=Object.freeze({x:500,y:0,radius:10});
  const event=g.step(.01,cue).find(e=>e.type==='scratch');
  assert.equal(event.penalty,20);assert.deepEqual(event.position,{x:250,y:300});assert.equal(g.score,15);assert.equal(g.combo,0);
  assert.equal(g.step(.01,cue).filter(e=>e.type==='scratch').length,0);
  g.step(.01);assert.equal(g.step(.01,cue).find(e=>e.type==='scratch').penalty,15);assert.equal(g.score,0);
});
test('nine-ball clear counts one round and reracks after 1.2 seconds',()=>{
  const g=new PhysicsEngine();g.balls.forEach(b=>{b.x=960;b.y=0;});
  const events=g.step(.01);assert.equal(events.filter(e=>e.type==='clear').length,1);assert.equal(g.rounds,1);assert.equal(g.cleared,true);
  advance(g,1.1);assert.equal(g.cleared,true);const restart=advance(g,.15);assert.equal(restart.filter(e=>e.type==='round-start').length,1);
  assert.equal(g.round,2);assert.equal(g.snapshot().remaining,9);assert.equal(g.roundScore,0);assert.ok(g.score>0);
});
test('bounded lag handling, input validation and zero-duration no-op',()=>{
  const g=new PhysicsEngine();assert.deepEqual(g.step(0),[]);const events=g.step(100);assert.equal(events[0].type,'time-dropped');close(g.time,MAX_DT);
  for(const dt of [-1,NaN,Infinity])assert.throws(()=>g.step(dt));
  assert.throws(()=>g.step(.01,{x:NaN,y:0}));assert.throws(()=>new PhysicsEngine({table:{width:0}}));
  assert.throws(()=>new PhysicsEngine({friction:-1}));assert.throws(()=>new PhysicsEngine({balls:[{x:1,y:1,id:1},{x:2,y:2,id:1}]}));
});
test('identical sample sequences produce identical snapshots and events',()=>{
  const a=new PhysicsEngine(),b=new PhysicsEngine();
  for(let i=0;i<200;i++){const cue={x:300+i*4,y:500+Math.sin(i*.1)*50,radius:35};assert.deepEqual(a.step(1/60,cue),b.step(1/60,cue));}
  assert.deepEqual(a.snapshot(),b.snapshot());
});
