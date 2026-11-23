import type { GameEvent, GameEventOf, GameEventType, GameState } from './types';
import type { Vec2 } from './vec';

/** An event's own fields: everything but the time stamp; `assistIds` defaults to none. */
export type EventFields<T extends GameEventType> = Omit<GameEventOf<T>, 'tick' | 'period' | 'clock' | 'assistIds' | 'pos'> & {
  assistIds?: string[];
  pos: Vec2;
};

/** A GameEvent stamped with the state's tick, period and clock (its `pos` copied, so it never aliases the state). */
export function gameEvent<T extends GameEventType>(state: GameState, e: EventFields<T>): GameEventOf<T> {
  return {
    ...e, tick: state.tick, period: state.period, clock: state.clock, assistIds: e.assistIds ?? [], pos: { x: e.pos.x, y: e.pos.y },
  } as GameEventOf<T>;
}

/** Narrows an event to one type. */
export const isEvent = <T extends GameEventType>(e: GameEvent, type: T): e is Extract<GameEvent, { type: T }> => e.type === type;
