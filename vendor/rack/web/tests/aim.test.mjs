import test from 'node:test';
import assert from 'node:assert/strict';

import { TABLE } from '../js/physics.js';
import { firstHit, contactGuide, reflectedDir, railDistance } from '../js/aim.js';

const r = TABLE.ballRadius;
const ball = (id, x, y) => ({ id, x, y, active: true });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
    `${actual} should be ${expected}`);

test('the guide finds the first object ball in line', () => {
    const balls = [ball(0, 0.5, 0.635), ball(1, 1.5, 0.635), ball(2, 2.0, 0.635)];
    const hit = firstHit(balls, 0.5, 0.635, 0);
    assert.equal(hit.ball.id, 1);
    near(hit.distance, 1.0 - 2 * r);
    near(hit.x, 1.5 - 2 * r);
    near(hit.y, 0.635);
});

test('the guide finds the cushion when the path is clear', () => {
    const balls = [ball(0, 0.5, 0.635)];
    const hit = firstHit(balls, 0.5, 0.635, 0);
    assert.equal(hit.ball, null);
    near(hit.x, TABLE.width - r);
    near(hit.y, 0.635);
    assert.deepEqual(hit.normal, { x: -1, y: 0 });
});

test('a straight hit sends the object ball forward and stops the cue', () => {
    const hit = firstHit([ball(0, 0.5, 0.635), ball(1, 1.5, 0.635)], 0.5, 0.635, 0);
    const guide = contactGuide(hit, 0);
    near(guide.objectDir.x, 1);
    near(guide.objectDir.y, 0);
    assert.equal(guide.cueDir, null);
    assert.ok(guide.objectLength > 0.15);
});

test('a cut sends the cue ball along the tangent', () => {
    const hit = firstHit([ball(0, 0.5, 0.635), ball(1, 1.5, 0.68)], 0.5, 0.635, 0);
    assert.ok(hit.ball);
    const guide = contactGuide(hit, 0);
    assert.ok(guide.objectDir.y > 0);
    assert.ok(guide.cueDir);
    assert.ok(guide.cueDir.y < 0, 'the cue ball deflects the other way');
    assert.ok(guide.cueLength > 0);
});

test('a cushion bounce mirrors the direction', () => {
    assert.deepEqual(reflectedDir({ x: 1, y: 0 }, { x: -1, y: 0 }), { x: -1, y: 0 });
    assert.deepEqual(reflectedDir({ x: 0, y: -1 }, { x: 0, y: 1 }), { x: 0, y: 1 });
    const diagonal = reflectedDir({ x: 1, y: -1 }, { x: 0, y: 1 });
    assert.deepEqual(diagonal, { x: 1, y: 1 });
});

test('rail distance stops at the cushion', () => {
    near(railDistance(1.0, 0.635, { x: 1, y: 0 }), TABLE.width - r - 1.0);
    near(railDistance(1.0, 0.635, { x: 0, y: 1 }), TABLE.height - r - 0.635);
    near(railDistance(1.0, 0.635, { x: -1, y: 0 }), 1.0 - r);
});
