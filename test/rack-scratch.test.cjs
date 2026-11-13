const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRackSession } = require('../runtime/rack-session.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 400; i++) { if (fn()) return; await sleep(5); }
  throw Error('Scratch synchronization timeout');
}
async function pair(t, rules) {
  let clock = 0;
  const host = await createRackSession('host', { bind:'127.0.0.1',port:0,code:'SCRA23',rules,clock:()=>clock });
  t.after(() => host.close());
  const guest = await createRackSession('guest', { address:'127.0.0.1',port:host.port,code:'SCRA23',clock:()=>clock });
  t.after(() => guest.close());
  await until(() => host.ready[1]); host.start(); await until(() => guest.phase === 'playing');
  return { host, guest, settle() {
    for (let i=0; i<3600 && host.game.phase===host.module.PHASE.ROLLING; i++) {
      clock += 1000/60; host.tick(1/60);
    }
  }};
}
for (const rules of [0,1]) for (const offender of [0,1]) {
  test('real '+(rules?'9':'8')+'-ball scratch by player '+offender+' preserves both previews and opponent placement', async t => {
    const {host,guest,settle} = await pair(t,rules);
    host.game.current=offender; host.game.isBreak=false;
    const white=host.game.physics.find(0);
    Object.assign(white,{x:.06,y:.06,vx:0,vy:0,active:true}); host.publish();
    await until(() => guest.game.current===offender && guest.game.physics.find(0).x===.06);
    const shooter=offender?guest:host;
    assert.equal(shooter.shoot(-135,1.5),true); await until(() => host.shots===1); settle();
    assert.ok(host.game.pocketedThisShot.includes(0),'must pocket the real physics cue');
    assert.equal(white.active,false);
    assert.equal(host.game.phase,host.module.PHASE.BALL_IN_HAND); host.publish();
    await until(() => guest.game.phase===host.module.PHASE.BALL_IN_HAND);
    const active=1-offender,placer=active?guest:host,waiting=offender?guest:host;
    assert.equal(host.game.current,active);
    for (const peer of [host,guest]) {
      const scene=peer.scene();
      assert.equal(scene.needsPlacement,true);
      assert.equal(scene.cue.pocketed,true,'physical cue stays inactive until placement');
      assert.equal(scene.cue.placementPreview,true);
      assert.equal(scene.lan.ballInHand,true);
      assert.equal(scene.localCanPlace,peer.localPlayer===active);
      assert.equal(scene.canShoot,false);
      assert.ok(Number.isFinite(scene.cue.x)&&Number.isFinite(scene.cue.y));
    }
    const point=placer.scene().cue,before=JSON.stringify(host.game.snapshot());
    assert.equal(waiting.placeWorld(point.x,point.y),false);
    assert.equal(placer.placeWorld(0,800),false,'cannot place in a pocket');
    assert.equal(JSON.stringify(host.game.snapshot()),before);
    assert.equal(placer.placeWorld(point.x,point.y),true);
    await until(() => host.game.phase===host.module.PHASE.AIMING && guest.game.phase===host.module.PHASE.AIMING);
    assert.deepEqual(guest.game.snapshot(),host.game.snapshot());
    for (const peer of [host,guest]) {
      assert.equal(peer.scene().cue.pocketed,false);
      assert.equal(peer.scene().needsPlacement,false);
      assert.equal(peer.scene().cue.placementPreview,false);
    }
    assert.equal(placer.canShoot,true); assert.equal(waiting.canShoot,false);
    assert.equal(placer.shoot(0,.4),true); await until(() => host.shots===2);
  });
}
for (const rules of [0,1]) {
  test('non-scratch '+(rules?'9':'8')+'-ball foul also displays free ball before acknowledgment',async t => {
    const {host,guest,settle}=await pair(t,rules); host.game.isBreak=false;
    assert.equal(host.shoot(180,.05),true); settle();
    assert.equal(host.game.pocketedThisShot.includes(0),false);
    assert.equal(host.game.phase,host.module.PHASE.BALL_IN_HAND); host.publish();
    await until(() => guest.game.phase===host.module.PHASE.BALL_IN_HAND);
    assert.equal(host.scene().cue.placementPreview,true);
    assert.equal(guest.scene().cue.placementPreview,true);
    assert.equal(host.scene().cue.pocketed,true); assert.equal(guest.canPlace,true);
    const point=guest.scene().cue;
    assert.equal(guest.placeWorld(point.x,point.y),true);
    await until(() => host.canShoot===false && guest.canShoot===true);
  });
}
