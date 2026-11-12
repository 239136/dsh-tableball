// Rolling-ball billiards, ported from the desktop build.
//
// All positions are in metres on a 2.54 x 1.27 m playing surface with the
// origin at the bottom-left corner. There is no spin: the cue strikes through
// the centre of the ball, balls collide as equal masses, and cloth friction
// bleeds speed until everything stops.

export const TABLE = Object.freeze({
    width: 2.54,
    height: 1.27,
    ballRadius: 0.028575,
    cornerPocketRadius: 0.062,
    sidePocketRadius: 0.067,
    friction: 0.22,
    cushionRestitution: 0.82,
    ballRestitution: 0.95,
    stopSpeed: 0.012,
    stepSeconds: 1 / 480,
    maxShotSpeed: 7.2,
});

export const EVENT = Object.freeze({
    BALL: 'ball',
    RAIL: 'rail',
    POCKET: 'pocket',
});

export function pocketCenters() {
    const { width: w, height: h } = TABLE;
    return [
        { x: 0, y: 0 },
        { x: w / 2, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w / 2, y: h },
        { x: w, y: h },
    ];
}

export function inPocket(x, y) {
    for (const pocket of pocketCenters()) {
        const side = Math.abs(pocket.x - TABLE.width / 2) < 1e-9;
        const radius = side ? TABLE.sidePocketRadius : TABLE.cornerPocketRadius;
        if (Math.hypot(x - pocket.x, y - pocket.y) < radius)
            return true;
    }
    return false;
}

export function insideTable(x, y) {
    const r = TABLE.ballRadius;
    return x >= r && x <= TABLE.width - r
        && y >= r && y <= TABLE.height - r
        && !inPocket(x, y);
}

export class Physics {
    constructor() {
        this.balls = [];
    }

    reset() {
        this.balls = [];
    }

    find(id) {
        return this.balls.find((ball) => ball.id === id) || null;
    }

    validCuePlacement(x, y, ignoreId = -1) {
        if (!insideTable(x, y))
            return false;

        for (const ball of this.balls) {
            if (!ball.active || ball.id === ignoreId)
                continue;
            if (Math.hypot(x - ball.x, y - ball.y) < 2 * TABLE.ballRadius + 0.001)
                return false;
        }
        return true;
    }

    strike(id, angle, power) {
        const ball = this.find(id);
        if (!ball || !ball.active)
            return;

        const clamped = Math.min(1, Math.max(0.02, power));
        const speed = clamped * TABLE.maxShotSpeed;
        ball.vx = Math.cos(angle) * speed;
        ball.vy = Math.sin(angle) * speed;
    }

    rolling() {
        return this.balls.some((ball) => ball.active && (ball.vx !== 0 || ball.vy !== 0));
    }

    stopAll() {
        for (const ball of this.balls) {
            ball.vx = 0;
            ball.vy = 0;
        }
    }

    step(events) {
        // Move first, then resolve. At the top speed a ball travels 15 mm per
        // step, well under a ball diameter, so overlap tests cannot tunnel.
        for (const ball of this.balls) {
            if (!ball.active)
                continue;
            ball.x += ball.vx * TABLE.stepSeconds;
            ball.y += ball.vy * TABLE.stepSeconds;
        }

        this.collectPockets(events);
        this.collideCushions(events);
        this.collideBalls(events);
        this.applyFriction();
    }

    collectPockets(events) {
        for (const ball of this.balls) {
            if (!ball.active)
                continue;
            if (inPocket(ball.x, ball.y)) {
                ball.active = false;
                ball.vx = 0;
                ball.vy = 0;
                if (events)
                    events.push({ type: EVENT.POCKET, a: ball.id, b: -1 });
            }
        }
    }

    collideCushions(events) {
        const r = TABLE.ballRadius;
        for (const ball of this.balls) {
            if (!ball.active)
                continue;

            if (ball.x < r) {
                ball.x = r;
                ball.vx = -ball.vx * TABLE.cushionRestitution;
                if (events && Math.abs(ball.vx) > 0.05)
                    events.push({ type: EVENT.RAIL, a: ball.id, b: -1 });
            } else if (ball.x > TABLE.width - r) {
                ball.x = TABLE.width - r;
                ball.vx = -ball.vx * TABLE.cushionRestitution;
                if (events && Math.abs(ball.vx) > 0.05)
                    events.push({ type: EVENT.RAIL, a: ball.id, b: -1 });
            }

            if (ball.y < r) {
                ball.y = r;
                ball.vy = -ball.vy * TABLE.cushionRestitution;
                if (events && Math.abs(ball.vy) > 0.05)
                    events.push({ type: EVENT.RAIL, a: ball.id, b: -1 });
            } else if (ball.y > TABLE.height - r) {
                ball.y = TABLE.height - r;
                ball.vy = -ball.vy * TABLE.cushionRestitution;
                if (events && Math.abs(ball.vy) > 0.05)
                    events.push({ type: EVENT.RAIL, a: ball.id, b: -1 });
            }
        }
    }

    collideBalls(events) {
        const diameter = 2 * TABLE.ballRadius;
        for (let i = 0; i < this.balls.length; i += 1) {
            for (let j = i + 1; j < this.balls.length; j += 1) {
                const a = this.balls[i];
                const b = this.balls[j];
                if (!a.active || !b.active)
                    continue;

                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let distance = Math.hypot(dx, dy);
                if (distance >= diameter)
                    continue;
                if (distance < 1e-9) {
                    // Exactly coincident balls need an arbitrary but stable normal.
                    dx = 1;
                    dy = 0;
                    distance = 1;
                }

                const nx = dx / distance;
                const ny = dy / distance;
                const overlap = diameter - distance;
                a.x -= nx * overlap / 2;
                a.y -= ny * overlap / 2;
                b.x += nx * overlap / 2;
                b.y += ny * overlap / 2;

                const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (relative < 0) {
                    const impulse = -(1 + TABLE.ballRestitution) * relative / 2;
                    a.vx -= impulse * nx;
                    a.vy -= impulse * ny;
                    b.vx += impulse * nx;
                    b.vy += impulse * ny;
                    if (events)
                        events.push({ type: EVENT.BALL, a: a.id, b: b.id });
                }
            }
        }
    }

    applyFriction() {
        for (const ball of this.balls) {
            if (!ball.active)
                continue;

            const speed = Math.hypot(ball.vx, ball.vy);
            if (speed === 0)
                continue;

            const drop = TABLE.friction * TABLE.stepSeconds;
            if (speed <= drop || speed <= TABLE.stopSpeed) {
                ball.vx = 0;
                ball.vy = 0;
            } else {
                const scale = (speed - drop) / speed;
                ball.vx *= scale;
                ball.vy *= scale;
            }
        }
    }
}
