import { generateTeam } from '../src/roster-gen';
import { SKATER_ATTRS } from '../src/attributes';
import type { GameSetup, TeamDef } from '../src/types';

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

import { DT } from '../src/constants';
import { stepPuck } from '../src/puck';
import type { Puck, PuckEvent } from '../src/puck';

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
