import { DT } from './constants';
import { gameEvent } from './events';
import { TUNING } from './tuning';
import type { GameEvent, GameState, Side } from './types';

const B = TUNING.boxScore;
const EPS = 1e-9;

/**
 * A turnover that may go in the box score: `side`'s `playerId` has just won the puck off `otherId`. Only clean ones
 * are candidates (the caller decides): a poke check or board battle won with the puck on his stick (a takeaway, if
 * the loser had `held` it at least B.controlSeconds: it ended a possession, not a scramble for a loose puck), or a
 * pass taken cleanly (the passer's giveaway if he was under less than B.unforcedPressure when he passed: an unforced
 * error; else nobody's). It counts once `side` keeps the puck (see confirmTurnover).
 */
export function watchTurnover(
  state: GameState, side: Side, playerId: string, otherId: string, how: 'poke' | 'battle' | 'intercepted', o: { held: number } | { passPressure: number },
): void {
  const pos = { x: state.puck.pos.x, y: state.puck.pos.y };
  if ('passPressure' in o) {
    if (o.passPressure < B.unforcedPressure) state.turnoverWatch = { kind: 'giveaway', side, playerId, otherId, how, tick: state.tick, pos };
    return;
  }
  // A takeaway ends a possession: the man who lost it must have had it under control for a while.
  if (o.held < B.controlSeconds - EPS) return;
  state.turnoverWatch = { kind: 'takeaway', side, playerId, otherId, how, tick: state.tick, pos };
}

/** Seconds the carrier `id` has had the puck (since his last pickup), from the touch chain; 0 if he is not its last touch. */
export function heldSeconds(state: GameState, id: string): number {
  const t = state.touches;
  const last = t.ids.length - 1;
  return last >= 0 && t.ids[last] === id ? (state.tick - t.ticks[last]!) * DT : 0;
}

/**
 * Once per tick after play: the watched turnover goes in the box score (a `takeaway` for the winner or a `giveaway` for
 * the loser, returned, with `pos` and `atTick` where and when the puck changed hands) once its side has kept the puck
 * for B.keepSeconds, or at a stoppage before then if its side touched the puck last; it is dropped as soon as the other
 * side has the puck.
 */
export function confirmTurnover(state: GameState): GameEvent | null {
  const w = state.turnoverWatch;
  if (w === null) return null;
  const live = state.phase === 'live';
  const kept = live ? state.possession === w.side : state.lastTouch?.side === w.side;
  if (!kept) { state.turnoverWatch = null; return null; }
  if (live && (state.tick - w.tick) * DT < B.keepSeconds - EPS) return null;
  state.turnoverWatch = null;
  if (w.kind === 'takeaway' && w.how !== 'intercepted') {
    return gameEvent(state, { type: 'takeaway', side: w.side, playerId: w.playerId, otherId: w.otherId, pos: w.pos, detail: { how: w.how, atTick: w.tick } });
  }
  if (w.kind === 'giveaway' && w.how === 'intercepted') {
    return gameEvent(state, { type: 'giveaway', side: w.side === 'home' ? 'away' : 'home', playerId: w.otherId, otherId: w.playerId, pos: w.pos, detail: { how: w.how, atTick: w.tick } });
  }
  return null;
}
