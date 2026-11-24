/**
 * Test-only harness for a shot in flight (Task 8): the puck part of a live tick as game.ts runs it (goalies move, then
 * shots.ts moveLoosePuck: tips, blocks, the goalie's save at his plane, the puck step and the net), without skaters
 * moving or picking the puck up.
 */
import { DT } from '../src/constants';
import { goalieTick } from '../src/goalie';
import { moveLoosePuck, trackShot } from '../src/shots';
import type { Rng } from '../src/rng';
import type { GameEvent, GameState, PlayerDef } from '../src/types';
import type { GoalieAttrs } from '../src/attributes';
import { def, defs, g } from './helpers';

/** stateWith's skaters (helpers.defs) plus both goalies, `goalie` rated (default 70 all round), catching with `catches`. */
export function withGoalies(o: { goalie?: GoalieAttrs; catches?: 'L' | 'R' } = {}): Map<string, PlayerDef> {
  const ds = new Map(defs);
  for (const id of ['home-G', 'away-G']) ds.set(id, { ...def({ id, position: 'G' }), goalie: o.goalie ?? g(70), catches: o.catches ?? 'L' });
  return ds;
}

export type LabTick = { tick: number; before: { x: number; y: number }; after: { x: number; y: number }; speed: number; events: GameEvent[] };

/** Steps the shot in `st` until it is over (and play stopped or the puck loose with no shot): every tick's record. */
export function flyShot(st: GameState, ds: Map<string, PlayerDef>, rng: Rng, maxTicks = 120): LabTick[] {
  const ticks: LabTick[] = [];
  const prev = { x: 0, y: 0 };
  for (let t = 0; t < maxTicks && st.phase === 'live' && st.shotInFlight !== null; t++) {
    st.tick++;
    const out: GameEvent[] = [];
    goalieTick(st, ds, DT, out);
    const before = { x: st.puck.pos.x, y: st.puck.pos.y };
    const speed = Math.hypot(st.puck.vel.x, st.puck.vel.y, st.puck.vz);
    const r = moveLoosePuck(st, ds, rng, out, prev);
    if (st.phase === 'live' && !r.onNet) trackShot(st, r.puckEvents, out);
    ticks.push({ tick: st.tick, before, after: { x: st.puck.pos.x, y: st.puck.pos.y }, speed, events: out });
  }
  return ticks;
}

/** All events of a lab run. */
export const eventsOf = (ticks: LabTick[]): GameEvent[] => ticks.flatMap((t) => t.events);
