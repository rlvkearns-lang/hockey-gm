import { GOALIE_ATTRS, SKATER_ATTRS } from './attributes';
import type { GameSetup, PlayerDef, TeamDef } from './types';

function checkRating(who: string, name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > 100) {
    throw new Error(`${who}: attribute ${name} must be an integer 1 to 100, got ${v}`);
  }
}

function checkPlayer(team: TeamDef, p: PlayerDef): void {
  const who = `${team.abbr} ${p.id}`;
  for (const k of SKATER_ATTRS) checkRating(who, k, p.attrs[k]);
  if (p.position === 'G') {
    if (!p.goalie) throw new Error(`${who}: goalie has no goalie attributes`);
    for (const k of GOALIE_ATTRS) checkRating(who, `goalie.${k}`, p.goalie[k]);
  }
  if (p.form < -1 || p.form > 1) throw new Error(`${who}: form must be -1 to 1`);
  if (p.morale < -1 || p.morale > 1) throw new Error(`${who}: morale must be -1 to 1`);
  if (p.fatigue < 0 || p.fatigue > 1) throw new Error(`${who}: fatigue must be 0 to 1`);
}

function checkLines(team: TeamDef): void {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const { forwards, defence, goalie } = team.lines;
  if (forwards.length < 3 || forwards.length > 4) {
    throw new Error(`${team.abbr}: needs 3 or 4 forward lines, got ${forwards.length}`);
  }
  if (defence.length < 2 || defence.length > 3) {
    throw new Error(`${team.abbr}: needs 2 or 3 defence pairs, got ${defence.length}`);
  }
  const seen = new Set<string>();
  const use = (id: string, slot: string, skater: boolean): void => {
    const p = byId.get(id);
    if (!p) throw new Error(`${team.abbr}: ${slot} names ${id}, who is not on the team`);
    if (skater && p.position === 'G') throw new Error(`${team.abbr}: ${slot} has goalie ${id}`);
    if (!skater && p.position !== 'G') throw new Error(`${team.abbr}: ${slot} must be a goalie, got ${id}`);
    if (seen.has(id)) throw new Error(`${team.abbr}: ${id} is on the lines twice`);
    seen.add(id);
  };
  forwards.forEach((line, i) => {
    if (line.length !== 3) throw new Error(`${team.abbr}: forward line ${i + 1} needs 3 players`);
    line.forEach((id) => use(id, `forward line ${i + 1}`, true));
  });
  defence.forEach((pair, i) => {
    if (pair.length !== 2) throw new Error(`${team.abbr}: defence pair ${i + 1} needs 2 players`);
    pair.forEach((id) => use(id, `defence pair ${i + 1}`, true));
  });
  use(goalie, 'goalie slot', false);
}

/** Throws an Error naming the first problem found. */
export function validateSetup(setup: GameSetup): void {
  const ids = new Set<string>();
  for (const team of [setup.home, setup.away]) {
    for (const p of team.players) {
      if (ids.has(p.id)) throw new Error(`duplicate player id ${p.id}`);
      ids.add(p.id);
    }
  }
  for (const team of [setup.home, setup.away]) {
    for (const p of team.players) checkPlayer(team, p);
    checkLines(team);
  }
  for (const c of setup.chemistry) {
    if (!ids.has(c.a) || !ids.has(c.b)) throw new Error(`chemistry names unknown player ${c.a} or ${c.b}`);
  }
}
