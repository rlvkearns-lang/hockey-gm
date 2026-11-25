import { DT } from './constants';
import type { Movement } from './skating';
import { TUNING as TUNING_ } from './tuning';
import type { GoalieState, SkaterState } from './types';
import { hypot2 as hypot2_, type Vec2 } from './vec';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const TUNING = TUNING_;
const hypot2 = hypot2_;

/**
 * An engaged pair (engagements.ts, Task 10), as indexes into the `skaters` given to resolveBodies, with each man's tie.
 * Callers reuse these objects (no allocation per tick).
 */
export type EngagedPair = { i: number; j: number; tieI: number; tieJ: number };

/** Two bodies whose gap is under this (m) are in contact: far above float rounding at rink scale, far below any real gap. */
const CONTACT_EPS = 1e-6;

/** Reused per call so the pair loop looks movement up once per skater, not once per pair. */
const scratch: (Movement | null)[] = [];

/**
 * Single pass; the caller clamps to the boards afterwards.
 * Push overlapping on-ice bodies apart, the lighter one giving more.
 * Engaged pairs (`engaged`, the first `engagedCount` of them; Task 10) are held at contact: their overlap is removed as
 * any other's, two men leaning into each other stop each other along the line between them (the heavier giving less), and
 * a tied-up man does not slide round the other (he keeps 1 - his tie of his speed across the line relative to the other),
 * and a man moving away from the other keeps only 1 - his tie of his velocity away from him (and of this
 * tick's step away, while they are beyond contact), so a tied-up man cannot simply skate off. Pairs that are not engaged
 * separate as before.
 * Returns each contact with the closing speed along the line between centres (0 if already parting).
 */
export function resolveBodies(
  skaters: SkaterState[],
  move: (id: string) => Movement,
  /** Each skater's Movement, parallel to `skaters`, when the caller already has them (then `move` is not asked). */
  moves?: readonly Movement[],
  engaged?: readonly EngagedPair[],
  engagedCount = engaged?.length ?? 0,
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
  for (let k = 0; k < engagedCount; k++) {
    const e = engaged![k]!;
    const ma = scratch[e.i], mb = scratch[e.j];
    if (!ma || !mb) continue;
    hold(skaters[e.i]!, skaters[e.j]!, ma.radius + mb.radius, ma.mass, mb.mass, e.tieI, e.tieJ);
  }
  return contacts;
}


/**
 * Holds engaged `a` and `b` together: each keeps only 1 - his tie of his velocity away from the other, and, while they are
 * beyond contact (`min`, their radii), gives back that share of this tick's step away (never closer than contact).
 */
function hold(a: SkaterState, b: SkaterState, min: number, massA: number, massB: number, tieA: number, tieB: number): void {
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
  const d = hypot2(dx, dy);
  if (d < 1e-9) return;
  const nx = dx / d, ny = dy / d;
  let gap = d - min;
  // At contact: the overlap was just removed, so the gap is zero only up to rounding (one ulp either way; Task 10
  // review, Important 1: a test of gap <= 0 skipped the hold on about 45% of contact ticks).
  const touching = gap <= CONTACT_EPS;
  // Leaning into each other they stop each other (no bounce, no sliding through): along the line between them, while
  // closing, both move at their common (mass-weighted) speed; the heavier man gives less.
  const va = a.vel.x * nx + a.vel.y * ny, vb = b.vel.x * nx + b.vel.y * ny;
  if (touching && va > vb) {
    const v = (va * massA + vb * massB) / (massA + massB);
    a.vel.x += nx * (v - va); a.vel.y += ny * (v - va);
    b.vel.x += nx * (v - vb); b.vel.y += ny * (v - vb);
  }
  // Nor does a tied-up man slide round the other: each keeps only 1 - his tie of his speed across the line relative to
  // the other's (both move toward their common, mass-weighted speed across it, by his tie).
  if (touching) {
    const ta = -a.vel.x * ny + a.vel.y * nx, tb = -b.vel.x * ny + b.vel.y * nx;
    const t = (ta * massA + tb * massB) / (massA + massB);
    const da = (t - ta) * tieA, db = (t - tb) * tieB;
    a.vel.x += -ny * da; a.vel.y += nx * da;
    b.vel.x += -ny * db; b.vel.y += nx * db;
  }
  const awayA = -(a.vel.x * nx + a.vel.y * ny);
  if (awayA > 0 && tieA > 0) {
    const cut = awayA * tieA;
    a.vel.x += nx * cut; a.vel.y += ny * cut;
    const back = Math.min(cut * DT, Math.max(0, gap));
    a.pos.x += nx * back; a.pos.y += ny * back;
    gap -= back;
  }
  const awayB = b.vel.x * nx + b.vel.y * ny;
  if (awayB > 0 && tieB > 0) {
    const cut = awayB * tieB;
    b.vel.x -= nx * cut; b.vel.y -= ny * cut;
    const back = Math.min(cut * DT, Math.max(0, gap));
    b.pos.x -= nx * back; b.pos.y -= ny * back;
  }
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
/** The way round a goalie on the centre-ice side of him is taken when it is this much (m) nearer centre ice than the other. */
const FRONT_SIDE = 0.05;

/**
 * With a goalie's body (TUNING.goalieBody.radius grown by `radius`) on the straight line from `from` to `to` and within
 * GOALIE_NEAR of `from`, a waypoint beside that goalie (GOALIE_ROUND m clear) on the side nearer centre ice (in front of
 * him, never between him and his net), or, when neither side is, on the side of the line away from him;
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
    // He passes on the side of the line away from him, unless the other side is the way out in front of the net: he
    // never squeezes between a goalie and his net (Task 13: with the goalie in the middle of his crease at a stoppage,
    // a defenceman from beside the net flipped between the two sides and never got to his faceoff spot).
    let side = across > 0 ? 1 : -1;
    const ox = (-dy / l) * (reach + GOALIE_ROUND);
    if (Math.abs(g.pos.x - ox) < Math.abs(g.pos.x + ox) - FRONT_SIDE) side = -1;
    else if (Math.abs(g.pos.x + ox) < Math.abs(g.pos.x - ox) - FRONT_SIDE) side = 1;
    out.x = g.pos.x + (-dy / l) * side * (reach + GOALIE_ROUND);
    out.y = g.pos.y + (dx / l) * side * (reach + GOALIE_ROUND);
    return true;
  }
  return false;
}
