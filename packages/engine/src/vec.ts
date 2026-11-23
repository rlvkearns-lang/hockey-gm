import { datan2, dcos, dsin } from './dmath';
export type Vec2 = { x: number; y: number };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
/**
 * sqrt(x*x + y*y), bit-identical to V8's Math.hypot for two arguments (same scaling and sum order, ported
 * from V8's math.tq) but several times faster, and the same on every JS engine.
 */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  const max = Math.max(ax, ay);
  if (max === 0) return 0;
  // V8 sums (ax/max)^2 then (ay/max)^2 with Kahan compensation; with two terms the compensation is exactly 0.
  const nx = ax / max, ny = ay / max;
  return Math.sqrt(nx * nx + ny * ny) * max;
}

export const len = (a: Vec2): number => hypot2(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => hypot2(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = dcos(angle), s = dsin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const angleOf = (a: Vec2): number => datan2(a.y, a.x);

/** Shortest distance from point (px, py) to segment (ax, ay)-(bx, by); allocation-free. */
export function segDistXY(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / l2));
  return hypot2(px - (ax + abx * t), py - (ay + aby * t));
}

/** Shortest distance from point p to segment a-b. */
export const segDist = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
};
