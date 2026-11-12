// Geometry for the aiming guide: where the cue ball first touches something,
// which way the object ball leaves, and where the cue ball deflects.

import { TABLE } from './physics.js';

export function firstHit(balls, cx, cy, angle, table = TABLE) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const r = table.ballRadius;
    let best = null;

    for (const ball of balls) {
        if (!ball.active || ball.id === 0)
            continue;
        const toX = ball.x - cx;
        const toY = ball.y - cy;
        const along = toX * dx + toY * dy;
        if (along <= 0)
            continue;
        const cross = Math.abs(toX * dy - toY * dx);
        const diameter = 2 * r;
        if (cross > diameter)
            continue;
        const back = Math.sqrt(Math.max(0, diameter * diameter - cross * cross));
        const distance = along - back;
        if (distance > 0 && (!best || distance < best.distance)) {
            best = {
                distance,
                x: cx + dx * distance,
                y: cy + dy * distance,
                ball,
            };
        }
    }

    const candidates = [];
    if (dx < 0)
        candidates.push((r - cx) / dx);
    if (dx > 0)
        candidates.push((table.width - r - cx) / dx);
    if (dy < 0)
        candidates.push((r - cy) / dy);
    if (dy > 0)
        candidates.push((table.height - r - cy) / dy);

    for (const distance of candidates) {
        if (distance <= 0 || !Number.isFinite(distance))
            continue;
        const x = cx + dx * distance;
        const y = cy + dy * distance;
        if (x < r - 1e-6 || x > table.width - r + 1e-6
            || y < r - 1e-6 || y > table.height - r + 1e-6)
            continue;
        if (!best || distance < best.distance) {
            best = {
                distance,
                x,
                y,
                ball: null,
                normal: {
                    x: Math.abs(x - r) < 1e-6 ? 1 : Math.abs(x - (table.width - r)) < 1e-6 ? -1 : 0,
                    y: Math.abs(y - r) < 1e-6 ? 1 : Math.abs(y - (table.height - r)) < 1e-6 ? -1 : 0,
                },
            };
        }
    }

    return best;
}

export function railDistance(x, y, direction, table = TABLE) {
    const r = table.ballRadius;
    let best = Infinity;
    if (direction.x > 1e-9)
        best = Math.min(best, (table.width - r - x) / direction.x);
    if (direction.x < -1e-9)
        best = Math.min(best, (r - x) / direction.x);
    if (direction.y > 1e-9)
        best = Math.min(best, (table.height - r - y) / direction.y);
    if (direction.y < -1e-9)
        best = Math.min(best, (r - y) / direction.y);
    return Number.isFinite(best) ? Math.max(0, best) : 0;
}

export function contactGuide(hit, angle, table = TABLE) {
    if (!hit || !hit.ball)
        return null;

    const nx = hit.ball.x - hit.x;
    const ny = hit.ball.y - hit.y;
    const length = Math.hypot(nx, ny);
    if (length < 1e-9)
        return null;

    const objectDir = { x: nx / length, y: ny / length };
    const shot = { x: Math.cos(angle), y: Math.sin(angle) };
    const transfer = Math.max(0, shot.x * objectDir.x + shot.y * objectDir.y);

    // The cue ball leaves along the tangent of the contact. A full ball hit
    // has almost no tangent, which is why it stops dead.
    let cueDir = {
        x: shot.x - transfer * objectDir.x,
        y: shot.y - transfer * objectDir.y,
    };
    const cueSpeed = Math.hypot(cueDir.x, cueDir.y);
    if (cueSpeed > 0.025) {
        cueDir = { x: cueDir.x / cueSpeed, y: cueDir.y / cueSpeed };
    } else {
        cueDir = null;
    }

    const objectLength = Math.max(0.16,
        Math.min(0.8, railDistance(hit.ball.x, hit.ball.y, objectDir, table)));
    const cueLength = cueDir
        ? Math.min(0.28, railDistance(hit.x, hit.y, cueDir, table))
        : 0;

    return {
        objectDir,
        objectLength,
        cueDir,
        cueLength,
        transfer,
    };
}

export function reflectedDir(direction, normal) {
    if (!normal)
        return direction;
    const dot = direction.x * normal.x + direction.y * normal.y;
    return {
        x: direction.x - 2 * dot * normal.x,
        y: direction.y - 2 * dot * normal.y,
    };
}
