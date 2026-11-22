import type { GameEvent, GameState } from './types';

/** Offside, icing and other whistles. Task 8 fills this in; a no-op until then. */
export function refereeTick(_state: GameState, _prevPuckX: number): GameEvent | null {
  return null;
}
