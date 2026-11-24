import { TUNING } from './tuning';
import type { Engagement, GameState } from './types';

/**
 * Reading engagements (engagements.ts, Task 10) without its imports: a leaf module, so passing, shots, tips and options can
 * read a man's tie without an import cycle. engagements.ts re-exports these.
 */

const E = TUNING.engage;

/** 0..1: how tied up `id` is now (0 when he is in no engagement). */
export function tieOf(state: GameState, id: string): number {
  const es = state.engagements;
  for (let i = 0; i < es.length; i++) {
    const e = es[i]!;
    if (e.a === id) return e.tieA;
    if (e.b === id) return e.tieB;
  }
  return 0;
}

/** The engagement `id` is in, or null. */
export function engagementOf(state: GameState, id: string): Engagement | null {
  const es = state.engagements;
  for (let i = 0; i < es.length; i++) { const e = es[i]!; if (e.a === id || e.b === id) return e; }
  return null;
}

/** The share of his top speed `id` keeps in his engagement: 1 - TUNING.engage.slow * his tie (1 when in none). */
export function engageSpeedFactor(state: GameState, id: string): number {
  return 1 - E.slow * tieOf(state, id);
}

/** `p` cut for a man with tie `tie` by `share` of itself per unit of tie, clamped to [0.03, 0.97]: reduced, never zero. */
export function tiedChance(p: number, tie: number, share: number): number {
  const v = p * (1 - share * tie);
  return v < 0.03 ? 0.03 : v > 0.97 ? 0.97 : v;
}

