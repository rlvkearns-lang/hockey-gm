/**
 * The engine's public surface: what a viewer, the debug view or a later stage builds on. Everything else under src is
 * internal and may change without notice (tests import modules directly).
 *
 * - Play: createGame (step it, read `state` between steps, drain its events), simulateGame (a whole game at once),
 *   restoreGame (carry on from a snapshot of `state`).
 * - Input: validateSetup (throws a SetupError naming the problem), generateTeam (fictional test rosters), PLAYER_TYPES.
 * - Data: the types (GameSetup in; GameState, GameEvent and GameResult out), rink geometry, the clock constants.
 */
export { createGame, restoreGame, simulateGame, type Game } from './game';
export { SetupError, validateSetup, type SetupProblem } from './validate';
export { generateTeam } from './roster-gen';
export { PLAYER_TYPES, type PlayerTypeDef } from './player-types';
export { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from './attributes';
export * from './types';
export type { Vec2 } from './vec';
export type { Puck } from './puck';
export type { RngState } from './rng';
export { FACEOFF_DOTS, RINK, zoneOf, type Zone } from './rink';
export { BENCH_DOORS } from './bench';
export { bodyRadius } from './skating';
export { BRAIN_INTERVAL_TICKS, DT, PERIODS, PERIOD_SECONDS } from './constants';
