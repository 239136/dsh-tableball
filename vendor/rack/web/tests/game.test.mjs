import test from 'node:test';
import assert from 'node:assert/strict';

import { Physics, TABLE, EVENT } from '../js/physics.js';
import { Game, PHASE, RULES, groupOfBall, isSolid, isStripe } from '../js/game.js';

const advanceUntilDone = (game, maximumFrames = 4000) => {
    for (let i = 0; i < maximumFrames; i += 1) {
        if (game.phase !== PHASE.ROLLING)
            return true;
        game.advanceFrame();
    }
    return game.phase !== PHASE.ROLLING;
};

const clearTable = (game, rules) => {
    game.start(rules, 'Host', 'Guest', 12345);
    game.physics.balls = [];
    game.rules = rules;
    game.phase = PHASE.AIMING;
    game.winner = -1;
    game.current = 0;
    game.myPlayer = -1;
    game.practice = false;
    game.isBreak = false;
    game.group[0] = 0;
    game.group[1] = 0;
    game.pocketedThisShot = [];
    game.firstContact = -1;
    game.railAfterContact = false;
};

const add = (game, id, x, y) => {
    game.physics.balls.push({ id, x, y, vx: 0, vy: 0, active: true });
};

test('physics comes to rest inside the table', () => {
    const physics = new Physics();
    physics.balls.push({ id: 0, x: 1.0, y: 0.6, vx: 0, vy: 0, active: true });
    physics.strike(0, 0.4, 0.6);
    for (let i = 0; i < 20000 && physics.rolling(); i += 1)
        physics.step();
    assert.equal(physics.rolling(), false);
    const ball = physics.balls[0];
    assert.ok(ball.x >= TABLE.ballRadius && ball.x <= TABLE.width - TABLE.ballRadius);
    assert.ok(ball.y >= TABLE.ballRadius && ball.y <= TABLE.height - TABLE.ballRadius);
});

test('physics pockets a corner ball', () => {
    const physics = new Physics();
    physics.balls.push({ id: 3, x: 0.02, y: 0.02, vx: 0, vy: 0, active: true });
    const events = [];
    physics.step(events);
    assert.equal(physics.balls[0].active, false);
    assert.ok(events.some((event) => event.type === EVENT.POCKET && event.a === 3));
});

test('physics bounces off a cushion', () => {
    const physics = new Physics();
    physics.balls.push({ id: 0, x: 0.06, y: 0.6, vx: -2.0, vy: 0, active: true });
    for (let i = 0; i < 40; i += 1)
        physics.step();
    assert.ok(physics.balls[0].vx > 0);
    assert.ok(physics.balls[0].x >= TABLE.ballRadius);
});

test('cue placement is validated', () => {
    const physics = new Physics();
    physics.balls.push({ id: 1, x: 0.5, y: 0.5, vx: 0, vy: 0, active: true });
    assert.equal(physics.validCuePlacement(1.0, 1.0), true);
    assert.equal(physics.validCuePlacement(0.5, 0.5), false);   // occupied
    assert.equal(physics.validCuePlacement(0.01, 0.01), false); // pocket
    assert.equal(physics.validCuePlacement(3.0, 0.5), false);   // off the table
});

test('8-ball rack is legal', () => {
    const game = new Game();
    game.start(RULES.EIGHT_BALL, 'A', 'B', 42);

    const balls = game.physics.balls;
    assert.equal(balls.length, 16);
    const ids = new Set(balls.map((ball) => ball.id));
    for (const ball of balls) {
        assert.ok(ball.x >= TABLE.ballRadius && ball.x <= TABLE.width - TABLE.ballRadius);
        assert.ok(ball.y >= TABLE.ballRadius && ball.y <= TABLE.height - TABLE.ballRadius);
    }
    for (let id = 0; id <= 15; id += 1)
        assert.ok(ids.has(id));

    const spacing = 2 * TABLE.ballRadius * 1.006;
    const rowStep = spacing * Math.sqrt(3) / 2;
    const apexX = TABLE.width * 0.75;
    const eight = game.physics.find(8);
    assert.ok(Math.abs(eight.x - (apexX + 2 * rowStep)) < 1e-9);
    assert.ok(Math.abs(eight.y - TABLE.height / 2) < 1e-9);

    const back = balls.filter((ball) => ball.id > 0
        && Math.abs(ball.x - (apexX + 4 * rowStep)) < 1e-9)
        .sort((a, b) => a.y - b.y);
    assert.equal(back.length, 5);
    const lowSolid = isSolid(back[0].id);
    const highStripe = isStripe(back[back.length - 1].id);
    assert.ok((lowSolid && highStripe) || (isStripe(back[0].id) && isSolid(back[back.length - 1].id)));

    for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
            const distance = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
            assert.ok(distance >= 2 * TABLE.ballRadius - 1e-7);
        }
    }
});

test('9-ball rack is legal', () => {
    const game = new Game();
    game.start(RULES.NINE_BALL, 'A', 'B', 7);
    assert.equal(game.physics.balls.length, 10);

    const spacing = 2 * TABLE.ballRadius * 1.006;
    const rowStep = spacing * Math.sqrt(3) / 2;
    const apexX = TABLE.width * 0.75;
    const one = game.physics.find(1);
    const nine = game.physics.find(9);
    assert.ok(Math.abs(one.x - apexX) < 1e-9);
    assert.ok(Math.abs(one.y - TABLE.height / 2) < 1e-9);
    assert.ok(Math.abs(nine.x - (apexX + 2 * rowStep)) < 1e-9);
    assert.ok(Math.abs(nine.y - TABLE.height / 2) < 1e-9);
});

test('break settles and spreads the rack', () => {
    const game = new Game();
    game.start(RULES.EIGHT_BALL, 'A', 'B', 99);
    game.setMyPlayer(-1);

    const before = new Map();
    for (const ball of game.physics.balls) {
        if (ball.id > 0)
            before.set(ball.id, { x: ball.x, y: ball.y });
    }

    game.shoot(0.0, 1.0);
    assert.equal(game.phase, PHASE.ROLLING);
    assert.ok(advanceUntilDone(game));

    let moved = 0;
    for (const ball of game.physics.balls) {
        if (ball.id === 0 || !ball.active)
            continue;
        const start = before.get(ball.id);
        if (Math.hypot(ball.x - start.x, ball.y - start.y) > 0.02)
            moved += 1;
    }
    assert.ok(moved >= 5, `only ${moved} balls moved`);

    for (const ball of game.physics.balls) {
        if (!ball.active)
            continue;
        assert.ok(ball.x >= 0 && ball.x <= TABLE.width);
        assert.ok(ball.y >= 0 && ball.y <= TABLE.height);
    }
});

test('pocketing the 8-ball early loses', () => {
    const game = new Game();
    clearTable(game, RULES.EIGHT_BALL);
    game.group[0] = 1;
    game.group[1] = 2;
    add(game, 0, 1.27, 0.25);
    add(game, 8, 1.27, 0.08);
    add(game, 1, 0.35, 0.95);
    add(game, 9, 2.0, 1.0);

    game.shoot(-Math.PI / 2, 0.35);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.winner, 1);
});

test('legal 8-ball wins', () => {
    const game = new Game();
    clearTable(game, RULES.EIGHT_BALL);
    game.group[0] = 1;
    game.group[1] = 2;
    add(game, 0, 1.27, 0.25);
    add(game, 8, 1.27, 0.08);

    game.shoot(-Math.PI / 2, 0.35);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.winner, 0);
});

test('9-ball pockets the 9', () => {
    const game = new Game();
    clearTable(game, RULES.NINE_BALL);
    add(game, 0, 1.27, 0.25);
    add(game, 9, 1.27, 0.08);

    game.shoot(-Math.PI / 2, 0.35);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.winner, 0);
});

test('9-ball wrong first contact is a foul', () => {
    const game = new Game();
    clearTable(game, RULES.NINE_BALL);
    add(game, 0, 0.45, 0.635);
    add(game, 1, 1.85, 0.95);
    add(game, 5, 0.80, 0.635);
    add(game, 9, 2.1, 0.3);

    game.shoot(0.0, 0.55);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.phase, PHASE.BALL_IN_HAND);
    assert.equal(game.current, 1);
    assert.equal(game.physics.find(0).active, false);
});

test('a legal miss passes the turn', () => {
    const game = new Game();
    clearTable(game, RULES.EIGHT_BALL);
    game.group[0] = 1;
    game.group[1] = 2;
    add(game, 0, 0.45, 0.635);
    add(game, 1, 1.40, 0.635);
    add(game, 9, 2.1, 1.0);

    game.shoot(0.0, 0.65);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.phase, PHASE.AIMING);
    assert.equal(game.current, 1);
});

test('ball-in-hand placement restores the cue', () => {
    const game = new Game();
    clearTable(game, RULES.NINE_BALL);
    add(game, 0, 0.45, 0.635);
    add(game, 1, 1.85, 0.95);
    add(game, 5, 0.80, 0.635);
    add(game, 9, 2.1, 0.3);
    game.shoot(0.0, 0.55);
    assert.ok(advanceUntilDone(game));
    assert.equal(game.phase, PHASE.BALL_IN_HAND);

    assert.equal(game.canPlaceCueBall(1.0, 0.4), true);
    assert.equal(game.placeCueBall(1.0, 0.4), true);
    assert.equal(game.phase, PHASE.AIMING);
    assert.equal(game.physics.find(0).active, true);
    assert.ok(Math.abs(game.physics.find(0).x - 1.0) < 1e-9);
});

test('a pot on the break keeps the breaker at the table', () => {
    const game = new Game();
    game.start(RULES.EIGHT_BALL, 'A', 'B', 42);
    game.physics.find(1).active = false;
    game.pocketedThisShot = [1];
    game.firstContact = 1;
    game.railAfterContact = true;
    game.isBreak = true;
    game.finishShot();

    assert.equal(game.phase, PHASE.AIMING);
    assert.equal(game.current, 0);
    assert.deepEqual(game.group, [0, 0], 'the table stays open after a break pot');
});

test('a legal pot keeps the turn in 8-ball', () => {
    const game = new Game();
    clearTable(game, RULES.EIGHT_BALL);
    game.group[0] = 1;
    game.group[1] = 2;
    add(game, 0, 0.5, 0.5);
    add(game, 1, 1.0, 0.5);
    add(game, 9, 2.0, 1.0);
    game.physics.find(1).active = false;
    game.pocketedThisShot = [1];
    game.firstContact = 1;
    game.railAfterContact = true;
    game.remainingBeforeShot = 1;
    game.finishShot();

    assert.equal(game.phase, PHASE.AIMING);
    assert.equal(game.current, 0);
});

test('a legal pot keeps the turn in 9-ball', () => {
    const game = new Game();
    clearTable(game, RULES.NINE_BALL);
    add(game, 0, 0.5, 0.5);
    add(game, 1, 1.0, 0.5);
    add(game, 9, 2.0, 1.0);
    game.physics.find(1).active = false;
    game.pocketedThisShot = [1];
    game.firstContact = 1;
    game.railAfterContact = true;
    game.targetBeforeShot = 1;
    game.finishShot();

    assert.equal(game.phase, PHASE.AIMING);
    assert.equal(game.current, 0);
});

test('snapshot round-trips', () => {
    const host = new Game();
    host.start(RULES.NINE_BALL, 'Host', 'Guest', 5);
    host.setMyPlayer(0);
    const snapshot = host.snapshot();

    const guest = new Game();
    guest.applySnapshot(snapshot);
    assert.equal(guest.rules, RULES.NINE_BALL);
    assert.equal(guest.names[0], 'Host');
    assert.equal(guest.names[1], 'Guest');
    assert.equal(guest.physics.balls.length, host.physics.balls.length);
    assert.equal(guest.phase, host.phase);
    assert.equal(guest.current, host.current);
    assert.ok(Math.abs(guest.cueGhost.x - host.cueGhost.x) < 1e-9);
    assert.ok(Math.abs(guest.cueGhost.y - host.cueGhost.y) < 1e-9);
});

test('groups map solids and stripes', () => {
    assert.equal(groupOfBall(1), 1);
    assert.equal(groupOfBall(7), 1);
    assert.equal(groupOfBall(8), 0);
    assert.equal(groupOfBall(9), 2);
    assert.equal(groupOfBall(15), 2);
});
