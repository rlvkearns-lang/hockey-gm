import { dcos, dlog } from './dmath';
export type Rng = {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  gauss(): number;
  pick<T>(items: readonly T[]): T;
};

/** FNV-1a style string hash with a final avalanche, returning a 32-bit state word. */
function hashString(s: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const text = String(seed);
  let a = hashString(text, 0x9e3779b9);
  let b = hashString(text, 0x85ebca6b);
  let c = hashString(text, 0xc2b2ae35);
  let d = 1;

  // sfc32
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    gauss: () => {
      const u = 1 - next(); // (0, 1]
      const v = next();
      return Math.sqrt(-2 * dlog(u)) * dcos(2 * Math.PI * v);
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
  return rng;
}
