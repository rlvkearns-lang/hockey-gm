import type { Movement } from './skating';
import type { SkaterState } from './types';
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
): { a: string; b: string; closing: number }[] {
  const contacts: { a: string; b: string; closing: number }[] = [];
  const n = skaters.length;
  scratch.length = n;
  for (let i = 0; i < n; i++) { const s = skaters[i]!; scratch[i] = s.onIce ? move(s.id) : null; }
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
