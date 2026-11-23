import type { GameState, Side, SkaterState } from './types';

/** Small helpers and constants shared across the engine. */

export const SIDES = ['home', 'away'] as const;

/** The other team. */
export const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Puck radius (m) for contact with boards, posts, netting and lines. */
export const PUCK_RADIUS = 0.05;
/** m/s^2. */
export const GRAVITY = 9.81;

/** The skater with this id, or null. */
export function findSkater(state: GameState, id: string | null): SkaterState | null {
  if (id === null) return null;
  for (const s of state.skaters) if (s.id === id) return s;
  return null;
}

/** The skater with this id (throws if there is none). */
export function skaterById(state: GameState, id: string): SkaterState {
  const s = findSkater(state, id);
  if (s === null) throw new Error(`no skater ${id}`);
  return s;
}

/** The skater carrying the puck, or null. */
export const carrierOf = (state: GameState): SkaterState | null => findSkater(state, state.carrierId);
