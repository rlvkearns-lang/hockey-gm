import { RINK, type GameState, type SkaterState } from '@hockey/engine';
import { bodyDims } from '../body';
import type { AnimContext, SkaterSample } from '../animator';
import { buildTimeline } from '../timeline';

/** Helpers for animator tests: a skater sample and a frame context made up by hand (no recorded game). */

/** A left-shot skater at (3, -2) facing +x, moving along his facing at `speed`, on the ice, not carrying. */
export function sample(o: { speed?: number; right?: boolean; carrying?: boolean; facing?: number } = {}): SkaterSample {
  const facing = o.facing ?? 0, v = o.speed ?? 0;
  const pos = { x: 3, y: -2 }, vel = { x: v * Math.cos(facing), y: v * Math.sin(facing) };
  const state = { id: 'p1', side: 'home', pos: { ...pos }, vel: { ...vel }, facing, onIce: true, downT: 0, contestId: null } as unknown as SkaterState;
  return {
    id: 'p1', side: 'home', right: o.right ?? false, dims: bodyDims(185, 90), onIce: true,
    pos, vel, facing, accelAlong: 0, turnRate: 0, down: false, carrying: o.carrying ?? false, state,
  };
}

/** A frame's context with nothing else on the ice: play live, the puck at centre, home attacking toward +x. */
export function emptyContext(): AnimContext {
  return contextWith({});
}

/** The same with the game phase and faceoff spot given. */
export function contextWith(o: { phase?: GameState['phase']; faceoffSpot?: { x: number; y: number } }): AnimContext {
  const state = {
    tick: 1000, phase: o.phase ?? 'live', faceoffSpot: o.faceoffSpot ?? { x: 0, y: 0 }, contests: [], carrierId: null,
    attackDir: { home: 1, away: -1 }, puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, z: 0, vz: 0 },
  } as unknown as GameState;
  return {
    tick: 1000, alpha: 0, time: 1000 / 30, state,
    skaters: new Map(), goalies: new Map(),
    puck: { engine: { x: 0, y: 0, z: 0 }, drawn: { x: 0, y: 0, z: 0 }, carrierId: null },
    contests: [], timeline: buildTimeline([]), rink: RINK, defends: { home: -1, away: 1 },
  };
}
