import { hypot2, type Vec2 } from './vec';

export const RINK = {
  halfLength: 30.48,
  halfWidth: 12.955,
  cornerRadius: 8.53,
  goalLineX: 27.13,
  blueLineX: 7.62,
  netHalfWidth: 0.915,
  netHeight: 1.22,
  netDepth: 1.0,
  creaseRadius: 1.83,
} as const;

export const FACEOFF_DOTS: { centre: Vec2; neutral: Vec2[]; end: Vec2[] } = {
  centre: { x: 0, y: 0 },
  neutral: [
    { x: -6.1, y: -6.7 }, { x: -6.1, y: 6.7 }, { x: 6.1, y: -6.7 }, { x: 6.1, y: 6.7 },
  ],
  end: [
    { x: -21.03, y: -6.7 }, { x: -21.03, y: 6.7 }, { x: 21.03, y: -6.7 }, { x: 21.03, y: 6.7 },
  ],
};

/**
 * What stands round the ice (m), for a puck lifted out of play (Task 13): boards `boards` high; glass `sideGlass` above
 * them along the sides and `endGlass` behind the goal lines (netting above that); in front of the players' benches
 * (on the -y side, |x| from `bench.fromX` to `bench.toX`, round the doors at x = 7 and -7) nothing above the boards.
 */
export const GLASS = { boards: 1.07, sideGlass: 1.52, endGlass: 2.44, bench: { fromX: 3.4, toX: 10.6 } } as const;

/** Where a lifted puck meets the boards at `p`: the height (m) above which it leaves play, and what it goes over. */
export function glassAt(p: Vec2): { top: number; where: 'glass' | 'netting' | 'bench' } {
  const ax = Math.abs(p.x);
  if (ax > RINK.goalLineX) return { top: GLASS.boards + GLASS.endGlass, where: 'netting' };
  if (p.y < 0 && ax >= GLASS.bench.fromX && ax <= GLASS.bench.toX) return { top: GLASS.boards, where: 'bench' };
  return { top: GLASS.boards + GLASS.sideGlass, where: 'glass' };
}

export type Zone = 'D' | 'N' | 'O';

/** Zone of an x position for a team attacking toward attackDir (blue lines divide the zones). */
export function zoneOf(x: number, attackDir: 1 | -1): Zone {
  const rel = x * attackDir;
  if (rel > RINK.blueLineX) return 'O';
  if (rel < -RINK.blueLineX) return 'D';
  return 'N';
}

/**
 * Keep a circular body of the given radius inside the rounded-rectangle boards.
 * Mutates pos and vel (outward normal velocity is reflected with restitution).
 * Returns true only on a real hit: penetrating the boards while moving into them.
 */
export function resolveBoards(pos: Vec2, vel: Vec2, radius: number, restitution: number): boolean {
  const R = RINK.cornerRadius;
  const cx = RINK.halfLength - R;
  const cy = RINK.halfWidth - R;
  let hit = false;

  if (Math.abs(pos.x) > cx && Math.abs(pos.y) > cy) {
    const sx = Math.sign(pos.x), sy = Math.sign(pos.y);
    const dx = pos.x - sx * cx, dy = pos.y - sy * cy;
    const d = hypot2(dx, dy);
    const limit = R - radius;
    if (d > limit) {
      const nx = dx / d, ny = dy / d;
      pos.x = sx * cx + nx * limit;
      pos.y = sy * cy + ny * limit;
      const vn = vel.x * nx + vel.y * ny;
      if (vn > 0) {
        vel.x -= (1 + restitution) * vn * nx;
        vel.y -= (1 + restitution) * vn * ny;
        return true;
      }
    }
    return false;
  }

  const lx = RINK.halfLength - radius;
  if (pos.x > lx) { pos.x = lx; if (vel.x > 0) { vel.x = -vel.x * restitution; hit = true; } }
  else if (pos.x < -lx) { pos.x = -lx; if (vel.x < 0) { vel.x = -vel.x * restitution; hit = true; } }
  const ly = RINK.halfWidth - radius;
  if (pos.y > ly) { pos.y = ly; if (vel.y > 0) { vel.y = -vel.y * restitution; hit = true; } }
  else if (pos.y < -ly) { pos.y = -ly; if (vel.y < 0) { vel.y = -vel.y * restitution; hit = true; } }
  return hit;
}

const NET_BACK = RINK.goalLineX + RINK.netDepth;

/**
 * Keep a circular body out of both net frames (the box from the goal line to the back of the net, between the posts),
 * grown by its radius. It is pushed out through the nearest face (it can only enter a few cm per tick, so that is the
 * face it came through) and its velocity into that face is removed. Mutates pos and vel.
 */
export function resolveNets(pos: Vec2, vel: Vec2, radius: number): void {
  const end = pos.x >= 0 ? 1 : -1;
  const rx = pos.x * end;
  const front = RINK.goalLineX - radius, back = NET_BACK + radius, side = RINK.netHalfWidth + radius;
  if (rx <= front || rx >= back || Math.abs(pos.y) >= side) return;
  const toFront = rx - front, toBack = back - rx, toSide = side - Math.abs(pos.y);
  if (toFront <= toBack && toFront <= toSide) {
    pos.x = end * front;
    if (vel.x * end > 0) vel.x = 0;
  } else if (toBack <= toSide) {
    pos.x = end * back;
    if (vel.x * end < 0) vel.x = 0;
  } else {
    const sy = pos.y >= 0 ? 1 : -1;
    pos.y = sy * side;
    if (vel.y * sy < 0) vel.y = 0;
  }
}

/**
 * Move `to` back along the segment from `from` to the first point where the segment meets a net frame grown by
 * `margin`, so whatever sits at `to` stays on the `from` side of the frame. `from` must be outside the grown frame.
 * No change when the segment misses both nets. Mutates `to`.
 */
export function clipToNets(from: Vec2, to: Vec2, margin: number): void {
  const dx = to.x - from.x, dy = to.y - from.y;
  for (const end of [1, -1] as const) {
    // Slab test against the grown box for this end.
    const x0 = end === 1 ? RINK.goalLineX - margin : -NET_BACK - margin;
    const x1 = end === 1 ? NET_BACK + margin : -RINK.goalLineX + margin;
    const y0 = -RINK.netHalfWidth - margin, y1 = RINK.netHalfWidth + margin;
    let tIn = 0, tOut = 1;
    if (dx === 0) { if (from.x <= x0 || from.x >= x1) continue; }
    else {
      let a = (x0 - from.x) / dx, b = (x1 - from.x) / dx;
      if (a > b) [a, b] = [b, a];
      tIn = Math.max(tIn, a); tOut = Math.min(tOut, b);
    }
    if (dy === 0) { if (from.y <= y0 || from.y >= y1) continue; }
    else {
      let a = (y0 - from.y) / dy, b = (y1 - from.y) / dy;
      if (a > b) [a, b] = [b, a];
      tIn = Math.max(tIn, a); tOut = Math.min(tOut, b);
    }
    if (tIn >= tOut) continue;
    to.x = from.x + dx * tIn;
    to.y = from.y + dy * tIn;
    return;
  }
}

const routeScratch: Vec2 = { x: 0, y: 0 };
/** True when the segment from `from` to `to` meets no net frame grown by `margin`. */
function clearOfNets(from: Vec2, x: number, y: number, margin: number): boolean {
  routeScratch.x = x;
  routeScratch.y = y;
  clipToNets(from, routeScratch, margin);
  return routeScratch.x === x && routeScratch.y === y;
}

/**
 * Where to skate on the way from `from` to `to` so as to go round a net frame rather than into it: `to` itself when
 * the straight line clears both frames (grown by `margin`), else a corner of the frame in the way on `from`'s side of
 * it (`margin` + `round` out from the frame): the corner at the end his target lies beyond if it can be reached in a straight line, else
 * the other one. Writes `out` and returns it.
 */
export function routeAroundNets(from: Vec2, to: Vec2, margin: number, round: number, out: Vec2): Vec2 {
  out.x = to.x;
  out.y = to.y;
  // Neither end near a goal line: the segment cannot meet a frame.
  const inner = RINK.goalLineX - margin;
  if ((from.x < inner && from.x > -inner && to.x < inner && to.x > -inner) || clearOfNets(from, to.x, to.y, margin)) return out;
  const end = from.x >= 0 ? 1 : -1;
  const side = from.y >= 0 ? 1 : -1;
  const m = margin + round;
  const y = side * (RINK.netHalfWidth + m);
  const front = end * (RINK.goalLineX - m), back = end * (NET_BACK + m);
  // Task 14: the far end is the one his target lies beyond (it was read off where he stands: a man beside the frame
  // heading across the front was sent to the back corner, and from behind the goal line to the front one again: he
  // went back and forth beside the post for a whole faceoff setup).
  const toFront = to.x * end < RINK.goalLineX + RINK.netDepth / 2;
  const far = toFront ? front : back, near = toFront ? back : front;
  out.x = clearOfNets(from, far, y, margin) ? far : near;
  out.y = y;
  return out;
}

/** Distance (m) from a point inside the rink to the boards (to the corner arc in the corners). */
export function distToBoards(p: Vec2): number {
  const R = RINK.cornerRadius;
  const cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
  const ax = Math.abs(p.x), ay = Math.abs(p.y);
  if (ax > cx && ay > cy) return R - hypot2(ax - cx, ay - cy);
  return Math.min(RINK.halfLength - ax, RINK.halfWidth - ay);
}

/** Unit normal (pointing out of the rink) of the stretch of boards nearest `p`. Writes and returns `out`. */
export function boardsNormal(p: Vec2, out: Vec2): Vec2 {
  const R = RINK.cornerRadius;
  const cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
  const ax = Math.abs(p.x), ay = Math.abs(p.y);
  const sx = p.x >= 0 ? 1 : -1, sy = p.y >= 0 ? 1 : -1;
  if (ax > cx && ay > cy) {
    const dx = ax - cx, dy = ay - cy;
    const d = hypot2(dx, dy) || 1;
    out.x = (sx * dx) / d;
    out.y = (sy * dy) / d;
  } else if (RINK.halfLength - ax < RINK.halfWidth - ay) { out.x = sx; out.y = 0; }
  else { out.x = 0; out.y = sy; }
  return out;
}

const supportScratch: Vec2 = { x: 0, y: 0 };
/**
 * Where a board battle's supporting player stands (Task 9): `off` m from the battle's `spot` toward the centre of the net
 * his side defends (at x = `ownNetX`), at least `minBoards` m off the boards, and clear of that net's frame. Writes `out`.
 */
export function supportSpot(spot: Vec2, ownNetX: number, off: number, minBoards: number, out: Vec2): Vec2 {
  const dx = ownNetX - spot.x, dy = -spot.y, d = hypot2(dx, dy) || 1;
  out.x = spot.x + (dx / d) * off;
  out.y = spot.y + (dy / d) * off;
  const b = distToBoards(out);
  if (b < minBoards) {
    const n = boardsNormal(out, supportScratch);
    out.x -= n.x * (minBoards - b);
    out.y -= n.y * (minBoards - b);
  }
  // Not in or against the net frame (a battle behind his own net): beside it, on the battle's side.
  const ax = Math.abs(out.x), clear = 0.6;
  if (ax > RINK.goalLineX - clear && ax < RINK.goalLineX + RINK.netDepth + clear && Math.abs(out.y) < RINK.netHalfWidth + clear) {
    out.y = (spot.y >= 0 ? 1 : -1) * (RINK.netHalfWidth + clear);
  }
  return out;
}
