import type { Movement } from './skating';
import { TUNING } from './tuning';
import type { GoalieState, SkaterState } from './types';
import { hypot2 } from './vec';

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
 * does not push him back in), and loses the parts of his velocity (along x, along y) toward that goalie. Returns how
 * many pushes there were.
 */
export function resolveGoalies(skaters: SkaterState[], moves: readonly Movement[], goalies: readonly GoalieState[]): number {
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
      // He loses whatever of his velocity, along x and along y, heads toward the goalie: he stops on him, not slides round.
      if (s.vel.x * nx < 0) s.vel.x = 0;
      if (s.vel.y * ny < 0) s.vel.y = 0;
    }
  }
  return pushed;
}
