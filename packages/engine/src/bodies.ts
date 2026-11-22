import type { Movement } from './skating';
import type { SkaterState } from './types';

/**
 * Push overlapping on-ice bodies apart, the lighter one giving more.
 * Returns each contact with the closing speed along the line between centres (0 if already parting).
 */
export function resolveBodies(
  skaters: SkaterState[],
  move: (id: string) => Movement,
): { a: string; b: string; closing: number }[] {
  const contacts: { a: string; b: string; closing: number }[] = [];
  for (let i = 0; i < skaters.length; i++) {
    const a = skaters[i]!;
    if (!a.onIce) continue;
    const ma = move(a.id);
    for (let j = i + 1; j < skaters.length; j++) {
      const b = skaters[j]!;
      if (!b.onIce) continue;
      const mb = move(b.id);
      let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      let d = Math.hypot(dx, dy);
      const min = ma.radius + mb.radius;
      if (d >= min) continue;
      if (d < 1e-9) { dx = 1; dy = 0; d = 1; }
      const nx = dx / d, ny = dy / d;
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
