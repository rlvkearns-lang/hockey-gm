import type { Movement } from './skating';
import { TUNING as TUNING_ } from './tuning';
import type { GoalieState, SkaterState } from './types';
import { hypot2 as hypot2_, type Vec2 } from './vec';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const TUNING = TUNING_;
const hypot2 = hypot2_;

/** Reused per call so the pair loop looks movement up once per skater, not once per pair. */
const scratch: (Movement | null)[] = [];

/**
 * Single pass; the caller clamps to the boards afterwards.
 * Push overlapping on-ice bodies apart, the lighter one giving more.
 * Returns each contact with the closing speed along the line between centres (0 if already parting).
 */
export function resolveBodies(
  skaters: SkaterState[],
  move: (id: string) => Movement,
  /** Each skater's Movement, parallel to `skaters`, when the caller already has them (then `move` is not asked). */
  moves?: readonly Movement[],
): { a: string; b: string; closing: number }[] {
  const contacts: { a: string; b: string; closing: number }[] = [];
  const n = skaters.length;
  scratch.length = n;
  for (let i = 0; i < n; i++) { const s = skaters[i]!; scratch[i] = s.onIce ? moves?.[i] ?? move(s.id) : null; }
  for (let i = 0; i < n; i++) {
    const a = skaters[i]!;
    const ma = scratch[i];
    if (!ma) continue;
    for (let j = i + 1; j < n; j++) {
      const mb = scratch[j];
      if (!mb) continue;
      const b = skaters[j]!;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const min = ma.radius + mb.radius;
      // Clearly apart (margin far above rounding): same outcome as the exact test below, without the square root.
      if (dx * dx + dy * dy > min * min * (1 + 1e-9)) continue;
      const d = hypot2(dx, dy);
      if (d >= min) continue;
      // Coincident centres: separate along +x, but keep d = 0 for the overlap.
      const nx = d < 1e-9 ? 1 : dx / d, ny = d < 1e-9 ? 0 : dy / d;
      const closing = Math.max(0, (a.vel.x - b.vel.x) * nx + (a.vel.y - b.vel.y) * ny);
      const overlap = min - d;
      const total = ma.mass + mb.mass;
      const moveA = (overlap * mb.mass) / total, moveB = (overlap * ma.mass) / total;
      a.pos.x -= nx * moveA; a.pos.y -= ny * moveA;
      b.pos.x += nx * moveB; b.pos.y += ny * moveB;
      contacts.push({ a: a.id, b: b.id, closing });
    }
  }
  return contacts;
}

/**
 * Goalies are solid: each on-ice skater is pushed out to TUNING.goalieBody.radius plus his own radius from each
 * goalie's centre (only the skater moves; one between the goalie and his net is pushed out sideways, so the net frame
 * does not push him back in), and loses the parts of his velocity (along x, along y) toward that goalie. With `maxMove`
 * a push moves him at most that far (Task 8b close-out: at a change of ends a goalie landed on a skater, who jumped
 * 0.66 m in a tick). Returns how many pushes there were.
 */
export function resolveGoalies(skaters: SkaterState[], moves: readonly Movement[], goalies: readonly GoalieState[], maxMove = Infinity): number {
  const gr = TUNING.goalieBody.radius;
  let pushed = 0;
  for (let i = 0; i < skaters.length; i++) {
    const s = skaters[i]!;
    if (!s.onIce) continue;
    const min = gr + moves[i]!.radius;
    for (const g of goalies) {
      const dx = s.pos.x - g.pos.x, dy = s.pos.y - g.pos.y;
      if (dx >= min || dx <= -min || dx * dx + dy * dy >= min * min) continue;
      pushed++;
      const x0 = s.pos.x, y0 = s.pos.y;
      const d = hypot2(dx, dy);
      let nx: number, ny: number;
      if (dx * (g.pos.x >= 0 ? 1 : -1) > 0) {
        // Between him and his net: out to the side, so the net frame does not push him straight back in.
        const side = dy >= 0 ? 1 : -1;
        s.pos.y = g.pos.y + side * Math.sqrt(min * min - dx * dx);
        nx = dx / min;
        ny = (s.pos.y - g.pos.y) / min;
      } else {
        // Coincident centres: out in front of him (up ice from his net).
        nx = d < 1e-9 ? (g.pos.x >= 0 ? -1 : 1) : dx / d;
        ny = d < 1e-9 ? 0 : dy / d;
        s.pos.x = g.pos.x + nx * min;
        s.pos.y = g.pos.y + ny * min;
      }
      // With `maxMove` (play stopped: the goalies have changed ends and one has come to stand where a skater was), he
      // is moved out at most that far a tick.
      const mv = hypot2(s.pos.x - x0, s.pos.y - y0);
      if (mv > maxMove) { s.pos.x = x0 + ((s.pos.x - x0) / mv) * maxMove; s.pos.y = y0 + ((s.pos.y - y0) / mv) * maxMove; }
      // He loses whatever of his velocity, along x and along y, heads toward the goalie: he stops on him, not slides round.
      if (s.vel.x * nx < 0) s.vel.x = 0;
      if (s.vel.y * ny < 0) s.vel.y = 0;
    }
  }
  return pushed;
}

/** A skater within GOALIE_NEAR (m) of a goalie's body with it on his line skates round it, GOALIE_ROUND (m) clear of it. */
const GOALIE_NEAR = 1;
const GOALIE_ROUND = 0.3;

/**
 * With a goalie's body (TUNING.goalieBody.radius grown by `radius`) on the straight line from `from` to `to` and within
 * GOALIE_NEAR of `from`, a waypoint beside that goalie on the side of the line away from him (GOALIE_ROUND m clear);
 * else `to` is left in `out` as it was. Writes `out` only when it routes, and returns true then. Without it the goalie's
 * body and the net frame can pin a skater in the crease.
 */
export function routeAroundGoalies(from: Vec2, to: Vec2, radius: number, goalies: readonly GoalieState[], out: Vec2): boolean {
  const reach = TUNING.goalieBody.radius + radius;
  for (const g of goalies) {
    const gx = g.pos.x - from.x, gy = g.pos.y - from.y;
    if (gx * gx + gy * gy > (reach + GOALIE_NEAR) * (reach + GOALIE_NEAR)) continue;
    const dx = to.x - from.x, dy = to.y - from.y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) continue;
    const along = (gx * dx + gy * dy) / l;
    if (along <= 0 || along >= l) continue;
    const across = (gx * dy - gy * dx) / l;          // > 0: the goalie is to the right of his line
    if (Math.abs(across) >= reach) continue;
    const side = across > 0 ? 1 : -1;                  // so he passes on the left of the goalie
    out.x = g.pos.x + (-dy / l) * side * (reach + GOALIE_ROUND);
    out.y = g.pos.y + (dx / l) * side * (reach + GOALIE_ROUND);
    return true;
  }
  return false;
}
