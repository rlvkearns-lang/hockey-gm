import { generateTeam } from '../src/roster-gen';
import { SKATER_ATTRS, type SkaterAttrs } from '../src/attributes';
import { DT } from '../src/constants';
import { stepPuck } from '../src/puck';
import type { Puck, PuckEvent } from '../src/puck';
import type { GameSetup, PlayerDef, Side, SkaterState, TeamDef } from '../src/types';
import type { Game } from '../src/game';
import { movementOf, stepSkater } from '../src/skating';
import type { Movement } from '../src/skating';

export const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mean of every skater attribute across the team's skaters. */
export function teamMean(team: TeamDef): number {
  const skaters = team.players.filter((p) => p.position !== 'G');
  return avg(skaters.flatMap((p) => SKATER_ATTRS.map((k) => p.attrs[k])));
}

/** A fresh valid GameSetup from two generated teams. */
export function validSetup(): GameSetup {
  return {
    home: generateTeam(1, 'Harbour City', 'HBR'),
    away: generateTeam(2, 'Northern Peaks', 'NPK'),
    seed: 42,
    chemistry: [],
  };
}

export function puckAt(x: number, y: number, vx: number, vy: number, z = 0, vz = 0): Puck {
  return { pos: { x, y }, z, vel: { x: vx, y: vy }, vz };
}

/** Step the puck with DT for the given number of simulated seconds. */
export function run(puck: Puck, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepPuck(puck, DT);
}

/** Step until the first non-boards event; throws after 5 s of sim time. */
export function runUntilEvent(puck: Puck): PuckEvent & Partial<{ y: number; z: number; speed: number }> {
  const n = Math.round(5 / DT);
  for (let i = 0; i < n; i++) {
    for (const ev of stepPuck(puck, DT)) if (ev.kind !== 'boards') return ev;
  }
  throw new Error('no puck event within 5 s');
}

// ---- skating helpers ----

/** A PlayerDef with every attribute 70, overridable (attrs partially, top-level fields directly). */
export function def(overrides: Partial<Omit<PlayerDef, 'attrs'>> & { [K in keyof SkaterAttrs]?: number } = {}): PlayerDef {
  const attrs = {} as SkaterAttrs;
  for (const k of SKATER_ATTRS) attrs[k] = 70;
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if ((SKATER_ATTRS as readonly string[]).includes(k)) (attrs as Record<string, number>)[k] = v as number;
    else top[k] = v;
  }
  return {
    id: 'p', name: 'P', number: 1, position: 'C', shoots: 'L', heightCm: 185, weightKg: 85,
    type: 'balanced', subType: null, attrs, goalie: null,
    tendencies: { shoot: 0.5, pass: 0.5, carry: 0.5, dump: 0.5, hit: 0.5, forecheck: 0.5, netFront: 0.5, joinRush: 0.5 },
    form: 0, morale: 0, fatigue: 0,
    ...top,
  };
}

let skaterSeq = 0;
/** A stationary skater at (x, y) facing +x, full effort, fresh. */
export function at(x: number, y: number): SkaterState {
  return {
    id: `s${skaterSeq++}`, side: 'home', slot: null, pos: { x, y }, vel: { x: 0, y: 0 }, facing: 0,
    target: { x, y }, faceTarget: null, speedCap: 1, energy: 1, onIce: true, leaving: false,
    downT: 0, contestId: null, shiftStart: 0,
  };
}

/** A skater at the origin moving (vx, vy), facing his travel direction. */
export function movingAt(vx: number, vy: number): SkaterState {
  const s = at(0, 0);
  s.vel = { x: vx, y: vy };
  s.facing = Math.atan2(vy, vx);
  return s;
}

export function stepFor(s: SkaterState, seconds: number, m: Movement = movementOf(def({}), 1)): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepSkater(s, m, DT);
}

/** Straight-line top-effort speed after `seconds` from rest. */
export function speedAfter(d: PlayerDef, seconds: number): number {
  const s = at(-29, 0);
  s.target = { x: 1000, y: 0 };
  stepFor(s, seconds, movementOf(d, 1));
  return Math.hypot(s.vel.x, s.vel.y);
}

/** Speed skating backward (facing +x, retreating toward -x) after `seconds` from rest. */
export function backwardSpeedAfter(seconds: number): number {
  const s = at(5, 0);
  s.target = { x: -1000, y: 0 };
  s.faceTarget = { x: 1000, y: 0 };
  stepFor(s, seconds, movementOf(def({}), 1));
  return Math.hypot(s.vel.x, s.vel.y);
}

/** A Movement for a player of the given weight. */
export function mv(weightKg: number): Movement {
  return movementOf(def({ weightKg }), 1);
}

// ---- game helpers ----

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** The two generated teams game tests play with (HBR v NGT). */
export function gameSetup(seed = 1): GameSetup {
  return { home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] };
}

/** Filter for result player lines: skaters (not goalies) of the given side in `setup` (default gameSetup()). */
export function isSkaterOf(side: Side, setup: GameSetup = gameSetup()): (p: { id: string }) => boolean {
  const ids = new Set(setup[side].players.filter((p) => p.position !== 'G').map((p) => p.id));
  return (p) => ids.has(p.id);
}

/** Step until the game is in period n (or over). */
export function runToPeriod(game: Game, n: number): void {
  while (!game.done && game.state.period < n) game.step();
}
