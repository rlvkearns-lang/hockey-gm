import type { Rng } from './rng';
import type { GameState, PlayerDef } from './types';

/** Goalie movement and covering. Task 7 fills this in; a no-op until then (goalies stand in their creases). */
export function goalieTick(_state: GameState, _defs: Map<string, PlayerDef>, _rng: Rng, _dt: number): void {}
