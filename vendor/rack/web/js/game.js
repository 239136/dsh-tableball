// One match of 8-ball or 9-ball, ported from the desktop build. The same
// object drives local play and can round-trip snapshots for network play.

import { Physics, TABLE, EVENT, inPocket, insideTable } from './physics.js';

export const RULES = Object.freeze({ EIGHT_BALL: 0, NINE_BALL: 1 });

export const PHASE = Object.freeze({
    AIMING: 0,
    ROLLING: 1,
    BALL_IN_HAND: 2,
    FINISHED: 3,
});

export function rulesName(rules) {
    return rules === RULES.NINE_BALL ? '9-Ball' : '8-Ball';
}

export function groupOfBall(id) {
    if (id >= 1 && id <= 7)
        return 1;
    if (id >= 9 && id <= 15)
        return 2;
    return 0;
}

export function isStripe(id) {
    return id >= 9 && id <= 15;
}

export function isSolid(id) {
    return id >= 1 && id <= 7;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(list, random) {
    for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

export class Game {
    constructor() {
        this.physics = new Physics();
        this.rules = RULES.EIGHT_BALL;
        this.phase = PHASE.AIMING;
        this.current = 0;
        this.winner = -1;
        this.group = [0, 0];
        this.names = ['Player 1', 'Player 2'];
        this.message = '';
        this.seed = 1;
        this.myPlayer = -1;
        this.practice = false;
        this.isBreak = true;
        this.aimAngle = 0;
        this.aimPower = 0.55;
        this.cueGhost = { x: TABLE.width * 0.25, y: TABLE.height / 2 };

        this.pocketedThisShot = [];
        this.firstContact = -1;
        this.railAfterContact = false;
        this.targetBeforeShot = -1;
        this.remainingBeforeShot = 0;

        this.handlers = {
            sound: () => {},
            message: () => {},
            end: () => {},
            change: () => {},
        };
    }

    emitChanged() {
        this.handlers.change(this);
    }

    setMessage(message) {
        if (this.message === message)
            return;
        this.message = message;
        this.handlers.message(message);
    }

    playSound(kind) {
        this.handlers.sound(kind);
    }

    headSpot() {
        return { x: TABLE.width * 0.25, y: TABLE.height / 2 };
    }

    footSpot() {
        return { x: TABLE.width * 0.75, y: TABLE.height / 2 };
    }

    start(rules, player0, player1, seed) {
        this.practice = false;
        this.rules = rules;
        this.names[0] = player0 || 'Player 1';
        this.names[1] = player1 || 'Player 2';
        this.seed = seed ? seed >>> 0 : (Math.random() * 0xFFFFFFFF) >>> 0;
        this.resetState();
        this.buildRack(this.seed);
        this.current = 0;
        this.phase = PHASE.AIMING;
        this.winner = -1;
        this.isBreak = true;
        this.cueGhost = this.headSpot();
        this.message = `${this.names[0]} breaks.`;
        this.emitChanged();
    }

    startPractice(rules, playerName) {
        this.start(rules, playerName || 'You', 'Table');
        this.practice = true;
        this.myPlayer = 0;
        this.message = 'Practice. Break when you are ready.';
        this.emitChanged();
    }

    clear() {
        this.physics.reset();
        this.names[0] = '';
        this.names[1] = '';
        this.winner = -1;
        this.phase = PHASE.AIMING;
        this.pocketedThisShot = [];
        this.emitChanged();
    }

    resetState() {
        this.physics.reset();
        this.group[0] = 0;
        this.group[1] = 0;
        this.phase = PHASE.AIMING;
        this.current = 0;
        this.winner = -1;
        this.pocketedThisShot = [];
        this.firstContact = -1;
        this.railAfterContact = false;
        this.targetBeforeShot = -1;
        this.remainingBeforeShot = 0;
        this.aimPower = 0.55;
    }

    addBall(id, x, y) {
        this.physics.balls.push({ id, x, y, vx: 0, vy: 0, active: true });
    }

    buildRack(seed) {
        this.physics.reset();
        this.addBall(0, this.headSpot().x, this.headSpot().y);

        const random = mulberry32(seed);
        const spacing = 2 * TABLE.ballRadius * 1.006;
        const rowStep = spacing * Math.sqrt(3) / 2;
        const apexX = TABLE.width * 0.75;
        const centerY = TABLE.height / 2;

        const placeRow = (row, count, ids) => {
            const x = apexX + row * rowStep;
            for (let i = 0; i < count; i += 1) {
                const y = centerY + (i - (count - 1) / 2) * spacing;
                this.addBall(ids[i], x, y);
            }
        };

        if (this.rules === RULES.EIGHT_BALL) {
            const solids = shuffle([1, 2, 3, 4, 5, 6, 7], random);
            const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], random);

            const positions = new Array(15).fill(0);
            positions[4] = 8;                 // centre of the third row
            positions[10] = solids.pop();     // one back corner is a solid
            positions[14] = stripes.pop();    // the other is a stripe

            const rest = shuffle([...solids, ...stripes], random);
            for (let i = 0, n = 0; i < 15; i += 1) {
                if (positions[i] === 0)
                    positions[i] = rest[n++];
            }

            let cursor = 0;
            for (let row = 0; row < 5; row += 1) {
                const count = row + 1;
                placeRow(row, count, positions.slice(cursor, cursor + count));
                cursor += count;
            }
        } else {
            const rest = shuffle([2, 3, 4, 5, 6, 7, 8], random);
            const positions = new Array(9).fill(0);
            positions[0] = 1; // apex
            positions[4] = 9; // centre of the diamond
            for (let i = 0, n = 0; i < 9; i += 1) {
                if (positions[i] === 0)
                    positions[i] = rest[n++];
            }

            // A diamond pointing at the foot spot: 1, 2, 3, 2, 1.
            const diamond = [1, 2, 3, 2, 1];
            let cursor = 0;
            for (let row = 0; row < 5; row += 1) {
                const count = diamond[row];
                placeRow(row, count, positions.slice(cursor, cursor + count));
                cursor += count;
            }
        }

        this.cueGhost = this.headSpot();
    }

    groupsAssigned() {
        return this.group[0] !== 0 && this.group[1] !== 0;
    }

    remainingFor(player) {
        if (this.rules === RULES.NINE_BALL)
            return this.activeObjectBalls();
        if (player < 0 || player > 1 || this.group[player] === 0)
            return 7;
        let count = 0;
        for (const ball of this.physics.balls) {
            if (ball.active && groupOfBall(ball.id) === this.group[player])
                count += 1;
        }
        return count;
    }

    remaining0() {
        return this.remainingFor(0);
    }

    remaining1() {
        return this.remainingFor(1);
    }

    targetBall() {
        if (this.rules === RULES.NINE_BALL)
            return this.lowestBall();
        if (this.onEight(this.current))
            return 8;
        return -1;
    }

    canShoot() {
        if (this.phase !== PHASE.AIMING || this.winner >= 0)
            return false;
        if (this.myPlayer >= 0 && this.current !== this.myPlayer)
            return false;
        const cue = this.physics.find(0);
        return Boolean(cue && cue.active);
    }

    ballInHand() {
        return this.phase === PHASE.BALL_IN_HAND
            && (this.myPlayer < 0 || this.current === this.myPlayer);
    }

    cueVisible() {
        const cue = this.physics.find(0);
        return Boolean((cue && cue.active) || this.phase === PHASE.BALL_IN_HAND);
    }

    setMyPlayer(player) {
        const value = Math.max(-1, Math.min(1, player));
        if (this.myPlayer === value)
            return;
        this.myPlayer = value;
        this.emitChanged();
    }

    setAim(angle) {
        if (!Number.isFinite(angle))
            return;
        const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));
        if (Math.abs(normalized - this.aimAngle) < 1e-6)
            return;
        this.aimAngle = normalized;
        this.emitChanged();
    }

    setAimPower(power) {
        const clamped = Math.min(1, Math.max(0, power));
        if (Math.abs(clamped - this.aimPower) < 1e-6)
            return;
        this.aimPower = clamped;
        this.emitChanged();
    }

    shoot(angle, power) {
        if (this.phase !== PHASE.AIMING || this.winner >= 0)
            return false;
        const cue = this.physics.find(0);
        if (!cue || !cue.active)
            return false;

        this.setAim(angle);
        this.aimPower = Math.min(1, Math.max(0.02, power));

        this.pocketedThisShot = [];
        this.firstContact = -1;
        this.railAfterContact = false;
        this.targetBeforeShot = this.lowestBall();
        this.remainingBeforeShot = this.remainingFor(this.current);
        this.phase = PHASE.ROLLING;

        this.physics.strike(0, this.aimAngle, this.aimPower);
        this.handlers.sound('cue');
        this.emitChanged();
        return true;
    }

    canPlaceCueBall(x, y) {
        return this.phase === PHASE.BALL_IN_HAND && this.physics.validCuePlacement(x, y);
    }

    placeCueBall(x, y) {
        if (this.phase !== PHASE.BALL_IN_HAND || !this.physics.validCuePlacement(x, y))
            return false;

        const cue = this.physics.find(0);
        if (!cue)
            return false;
        cue.active = true;
        cue.x = x;
        cue.y = y;
        cue.vx = 0;
        cue.vy = 0;
        this.cueGhost = { x, y };
        this.phase = PHASE.AIMING;
        this.setMessage(`${this.names[this.current]} to shoot.`);
        this.emitChanged();
        return true;
    }

    previewCueBall(x, y) {
        if (this.phase !== PHASE.BALL_IN_HAND || !this.physics.validCuePlacement(x, y))
            return;
        if (Math.abs(this.cueGhost.x - x) < 1e-6 && Math.abs(this.cueGhost.y - y) < 1e-6)
            return;
        this.cueGhost = { x, y };
        this.emitChanged();
    }

    rackAgain() {
        const myPlayer = this.myPlayer;
        const practice = this.practice;
        const name0 = this.names[0];
        const name1 = this.names[1];
        this.start(this.rules, name0, name1, (Math.random() * 0xFFFFFFFF) >>> 0);
        this.myPlayer = myPlayer;
        this.practice = practice;
        this.message = practice ? 'Fresh rack.' : `${this.names[0]} breaks.`;
        this.emitChanged();
    }

    noteEvents(events) {
        for (const event of events) {
            if (event.type === EVENT.BALL) {
                this.playSound('click');
                if (this.firstContact < 0 && (event.a === 0 || event.b === 0))
                    this.firstContact = event.a === 0 ? event.b : event.a;
            } else if (event.type === EVENT.RAIL) {
                this.playSound('rail');
                if (this.firstContact >= 0)
                    this.railAfterContact = true;
            } else if (event.type === EVENT.POCKET) {
                if (!this.pocketedThisShot.includes(event.a))
                    this.pocketedThisShot.push(event.a);
                this.playSound('pocket');
            }
        }
    }

    // 8 x 1/480 s = 60 Hz of table time, matching the desktop timer.
    advanceFrame() {
        if (this.phase !== PHASE.ROLLING)
            return;
        const events = [];
        for (let i = 0; i < 8; i += 1)
            this.physics.step(events);
        this.noteEvents(events);

        if (!this.physics.rolling()) {
            this.finishShot();
        }
        this.emitChanged();
    }

    finishShot() {
        if (this.rules === RULES.EIGHT_BALL)
            this.evaluateEightBall();
        else
            this.evaluateNineBall();
        this.emitChanged();
    }

    finishTurn(foul, reason, objectPockets) {
        if (foul) {
            this.giveBallInHand(this.practice ? 0 : this.otherPlayer(), reason);
            return;
        }

        this.setMessage(`${this.names[this.current]} to shoot.`);
        if (objectPockets.length === 0)
            this.switchTurn();
        this.emitChanged();
    }

    evaluateEightBall() {
        const objects = this.pocketedThisShot.filter((id) => id > 0);
        const scratch = this.pocketedThisShot.includes(0);
        const eight = this.pocketedThisShot.includes(8);
        const wasBreak = this.isBreak;
        this.isBreak = false;

        if (wasBreak && eight) {
            this.rerack();
            this.setMessage('The 8-ball went in on the break. Re-rack.');
            return;
        }

        // Whether the shooter was already on the 8 before this shot decided
        // which ball had to be contacted first. Using the current count would
        // penalise a player for pocketing their last group ball.
        const wasOnEight = this.groupsAssigned() && this.remainingBeforeShot === 0;

        let foul = false;
        let reason = '';
        if (this.firstContact < 0) {
            foul = true;
            reason = 'No object ball was contacted.';
        } else if (scratch) {
            foul = true;
            reason = 'Cue ball pocketed.';
        } else if (!this.groupsAssigned() && this.firstContact === 8) {
            foul = true;
            reason = 'The 8-ball was hit first.';
        } else if (wasOnEight && this.firstContact !== 8) {
            foul = true;
            reason = 'The 8-ball must be hit first.';
        } else if (this.groupsAssigned() && !wasOnEight
                   && groupOfBall(this.firstContact) !== this.group[this.current]) {
            foul = true;
            reason = 'The wrong group was hit first.';
        } else if (objects.length === 0 && !this.railAfterContact) {
            foul = true;
            reason = 'No rail after contact.';
        }

        if (eight) {
            const legalWin = !foul && this.groupsAssigned() && this.remainingBeforeShot === 0;
            if (legalWin)
                this.endMatch(this.current, `${this.names[this.current]} pocketed the 8-ball.`);
            else
                this.endMatch(this.otherPlayer(), `${this.names[this.current]} pocketed the 8-ball early.`);
            return;
        }

        if (foul) {
            this.giveBallInHand(this.practice ? 0 : this.otherPlayer(), `${reason} Ball in hand.`);
            return;
        }

        if (wasBreak) {
            if (objects.length === 0) {
                this.switchTurn();
            } else {
                // A pot on the break keeps the breaker at the table, and the
                // table stays open.
                this.phase = PHASE.AIMING;
                this.setMessage(`${this.names[this.current]} to shoot.`);
            }
            return;
        }

        if (!this.groupsAssigned() && objects.length > 0) {
            const first = this.pocketedThisShot.find((id) => id > 0 && id !== 8);
            if (first) {
                this.group[this.current] = groupOfBall(first);
                this.group[this.otherPlayer()] = 3 - this.group[this.current];
                const groupName = this.group[this.current] === 1 ? 'solids' : 'stripes';
                this.setMessage(`${this.names[this.current]} is on ${groupName}.`);
            }
        }

        let pocketedOwn = false;
        if (this.groupsAssigned()) {
            pocketedOwn = objects.some((id) => groupOfBall(id) === this.group[this.current]);
        } else {
            pocketedOwn = objects.length > 0;
        }

        if (!pocketedOwn) {
            this.switchTurn();
        } else {
            this.phase = PHASE.AIMING;
        }
        this.emitChanged();
    }

    evaluateNineBall() {
        const objects = this.pocketedThisShot.filter((id) => id > 0);
        const scratch = this.pocketedThisShot.includes(0);
        const nine = this.pocketedThisShot.includes(9);
        this.isBreak = false;

        let foul = false;
        let reason = '';
        if (this.firstContact < 0) {
            foul = true;
            reason = 'No object ball was contacted.';
        } else if (this.targetBeforeShot > 0 && this.firstContact !== this.targetBeforeShot) {
            foul = true;
            reason = `The ${this.targetBeforeShot} was not hit first.`;
        } else if (scratch) {
            foul = true;
            reason = 'Cue ball pocketed.';
        } else if (objects.length === 0 && !this.railAfterContact) {
            foul = true;
            reason = 'No rail after contact.';
        }

        if (nine) {
            if (!foul) {
                this.endMatch(this.current, `${this.names[this.current]} pocketed the 9-ball.`);
            } else {
                this.spotBall(9);
                this.giveBallInHand(this.practice ? 0 : this.otherPlayer(),
                    'The 9-ball was spotted. Ball in hand.');
            }
            return;
        }

        if (foul) {
            this.giveBallInHand(this.practice ? 0 : this.otherPlayer(), `${reason} Ball in hand.`);
            return;
        }

        if (objects.length === 0) {
            this.switchTurn();
        } else {
            // A legal pot keeps the shooter at the table.
            this.phase = PHASE.AIMING;
            this.setMessage(`${this.names[this.current]} to shoot.`);
            this.emitChanged();
        }
    }

    giveBallInHand(player, reason) {
        if (this.winner >= 0)
            return;

        this.current = this.practice ? 0 : player;
        const cue = this.physics.find(0);
        if (cue) {
            this.cueGhost = {
                x: Math.min(TABLE.width - TABLE.ballRadius,
                    Math.max(TABLE.ballRadius, cue.x)),
                y: Math.min(TABLE.height - TABLE.ballRadius,
                    Math.max(TABLE.ballRadius, cue.y)),
            };
            if (!this.physics.validCuePlacement(this.cueGhost.x, this.cueGhost.y)) {
                // Walk toward the centre until there is a legal spot to offer.
                for (let i = 0; i < 30; i += 1) {
                    const t = i / 30;
                    const x = this.cueGhost.x * (1 - t) + TABLE.width / 2 * t;
                    const y = this.cueGhost.y * (1 - t) + TABLE.height / 2 * t;
                    if (this.physics.validCuePlacement(x, y)) {
                        this.cueGhost = { x, y };
                        break;
                    }
                }
            }
            cue.active = false;
            cue.vx = 0;
            cue.vy = 0;
        }
        this.phase = PHASE.BALL_IN_HAND;
        this.setMessage(reason);
        this.emitChanged();
    }

    switchTurn() {
        this.current = this.practice ? 0 : this.otherPlayer();
        this.phase = PHASE.AIMING;
        this.setMessage(`${this.names[this.current]} to shoot.`);
    }

    endMatch(winner, reason) {
        this.winner = winner;
        this.phase = PHASE.FINISHED;
        this.setMessage(reason);
        this.handlers.end(winner, reason);
        this.handlers.message(reason);
        this.emitChanged();
    }

    rerack() {
        this.resetState();
        this.buildRack(this.seed);
        this.isBreak = true;
        this.phase = PHASE.AIMING;
        this.winner = -1;
        this.message = `${this.names[this.current]} breaks again.`;
        this.emitChanged();
    }

    spotBall(id) {
        const ball = this.physics.find(id);
        if (!ball)
            return;
        ball.active = true;
        ball.vx = 0;
        ball.vy = 0;

        const spot = this.footSpot();
        ball.x = spot.x;
        ball.y = spot.y;
        for (let step = 1; step <= 40; step += 1) {
            if (this.physics.validCuePlacement(ball.x, ball.y, id))
                return;
            ball.x = spot.x + step * TABLE.ballRadius * 2.1;
            if (ball.x > TABLE.width - TABLE.ballRadius) {
                ball.x = spot.x - step * TABLE.ballRadius * 2.1;
                if (ball.x < TABLE.ballRadius)
                    break;
            }
        }
        ball.x = TABLE.width / 2;
        ball.y = TABLE.height / 2;
    }

    otherPlayer() {
        return this.current === 0 ? 1 : 0;
    }

    onEight(player) {
        return this.groupsAssigned() && player >= 0 && player <= 1
            && this.group[player] !== 0 && this.remainingFor(player) === 0;
    }

    activeObjectBalls() {
        return this.physics.balls.filter((ball) => ball.active && ball.id > 0).length;
    }

    lowestBall() {
        let lowest = 0;
        for (const ball of this.physics.balls) {
            if (!ball.active || ball.id <= 0)
                continue;
            if (lowest === 0 || ball.id < lowest)
                lowest = ball.id;
        }
        return lowest;
    }

    snapshot() {
        return {
            rules: this.rules,
            phase: this.phase,
            current: this.current,
            group0: this.group[0],
            group1: this.group[1],
            winner: this.winner,
            message: this.message,
            breaking: this.isBreak,
            names: [...this.names],
            balls: this.physics.balls.map((ball) => ({
                i: ball.id, x: ball.x, y: ball.y, a: ball.active,
            })),
            cue: [this.cueGhost.x, this.cueGhost.y],
        };
    }

    applySnapshot(object) {
        this.rules = object.rules;
        this.phase = object.phase;
        this.current = object.current;
        this.group[0] = object.group0;
        this.group[1] = object.group1;
        this.winner = object.winner;
        this.message = object.message;
        this.isBreak = object.breaking;

        if (Array.isArray(object.names) && object.names.length === 2)
            this.names = [...object.names];

        if (Array.isArray(object.balls) && object.balls.length > 0) {
            this.physics.balls = object.balls.map((entry) => ({
                id: entry.i,
                x: entry.x,
                y: entry.y,
                vx: 0,
                vy: 0,
                active: entry.a !== false,
            }));
        }

        if (Array.isArray(object.cue) && object.cue.length === 2)
            this.cueGhost = { x: object.cue[0], y: object.cue[1] };

        this.emitChanged();
    }
}

export { TABLE, inPocket, insideTable };
