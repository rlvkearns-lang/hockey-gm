import { GOALIE_ATTRS, SKATER_ATTRS } from './attributes';
import type { GameSetup, PlayerDef, TeamDef, Tendencies } from './types';

/** What is wrong with a setup (SetupError.code). */
export type SetupProblem =
  | 'not-an-object' | 'bad-seed' | 'bad-chemistry' | 'bad-team' | 'duplicate-id' | 'bad-player' | 'bad-position'
  | 'bad-attribute' | 'missing-goalie-attributes' | 'bad-size' | 'bad-tendency' | 'bad-form' | 'bad-morale'
  | 'bad-fatigue' | 'bad-tactics' | 'bad-lines';

/** A GameSetup that cannot be played: `code` names the kind of problem, the message says exactly what and where. */
export class SetupError extends Error {
  readonly code: SetupProblem;
  constructor(code: SetupProblem, message: string) {
    super(message);
    this.name = 'SetupError';
    this.code = code;
  }
}

const fail = (code: SetupProblem, message: string): never => { throw new SetupError(code, message); };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const POSITIONS = ['C', 'LW', 'RW', 'LD', 'RD', 'G'];
const FORECHECKS = ['passive', 'balanced', 'aggressive'];
const TENDENCIES: readonly (keyof Tendencies)[] = ['shoot', 'pass', 'carry', 'dump', 'hit', 'forecheck', 'netFront', 'joinRush'];
/** Plausible body sizes (anything outside is a data error, not a player). */
const HEIGHT_CM: [number, number] = [140, 230];
const WEIGHT_KG: [number, number] = [45, 160];

function checkRating(who: string, name: string, v: unknown): void {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 100) {
    fail('bad-attribute', `${who}: attribute ${name} must be an integer 1 to 100, got ${String(v)}`);
  }
}

function inRange(who: string, code: SetupProblem, name: string, v: unknown, lo: number, hi: number): void {
  if (!isNum(v) || v < lo || v > hi) fail(code, `${who}: ${name} must be a number from ${lo} to ${hi}, got ${String(v)}`);
}

function checkPlayer(team: TeamDef, p: PlayerDef): void {
  const who = `${team.abbr} ${p.id}`;
  if (!POSITIONS.includes(p.position)) fail('bad-position', `${who}: position must be one of ${POSITIONS.join(', ')}, got ${String(p.position)}`);
  if (!isObj(p.attrs)) fail('bad-attribute', `${who}: has no attributes`);
  for (const k of SKATER_ATTRS) checkRating(who, k, p.attrs[k]);
  if (p.position === 'G') {
    if (!isObj(p.goalie)) fail('missing-goalie-attributes', `${who}: goalie has no goalie attributes`);
    for (const k of GOALIE_ATTRS) checkRating(who, `goalie.${k}`, p.goalie![k]);
  }
  inRange(who, 'bad-size', 'heightCm', p.heightCm, HEIGHT_CM[0], HEIGHT_CM[1]);
  inRange(who, 'bad-size', 'weightKg', p.weightKg, WEIGHT_KG[0], WEIGHT_KG[1]);
  if (!isObj(p.tendencies)) fail('bad-tendency', `${who}: has no tendencies`);
  for (const k of TENDENCIES) inRange(who, 'bad-tendency', `tendency ${k}`, p.tendencies[k], 0, 1);
  inRange(who, 'bad-form', 'form', p.form, -1, 1);
  inRange(who, 'bad-morale', 'morale', p.morale, -1, 1);
  inRange(who, 'bad-fatigue', 'fatigue', p.fatigue, 0, 1);
  if (p.catches !== undefined && p.catches !== 'L' && p.catches !== 'R') fail('bad-player', `${who}: catches must be 'L' or 'R', got ${String(p.catches)}`);
}

function checkTactics(team: TeamDef): void {
  const t = team.tactics;
  if (!isObj(t)) fail('bad-tactics', `${team.abbr}: has no tactics`);
  if (!FORECHECKS.includes(t.forecheck)) fail('bad-tactics', `${team.abbr}: tactics.forecheck must be one of ${FORECHECKS.join(', ')}, got ${String(t.forecheck)}`);
  if (!isObj(t.shiftSeconds)) fail('bad-tactics', `${team.abbr}: tactics.shiftSeconds is missing`);
  for (const unit of ['forwards', 'defence'] as const) {
    const v = t.shiftSeconds[unit];
    if (!isNum(v) || v <= 0) fail('bad-tactics', `${team.abbr}: tactics.shiftSeconds.${unit} must be a positive number of seconds, got ${String(v)}`);
  }
}

function checkLines(team: TeamDef): void {
  if (!isObj(team.lines) || !Array.isArray(team.lines.forwards) || !Array.isArray(team.lines.defence)) {
    fail('bad-lines', `${team.abbr}: lines must have forwards, defence and goalie`);
  }
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const { forwards, defence, goalie } = team.lines;
  if (forwards.length < 3 || forwards.length > 4) {
    fail('bad-lines', `${team.abbr}: needs 3 or 4 forward lines, got ${forwards.length}`);
  }
  if (defence.length < 2 || defence.length > 3) {
    fail('bad-lines', `${team.abbr}: needs 2 or 3 defence pairs, got ${defence.length}`);
  }
  const seen = new Set<string>();
  const use = (id: string, slot: string, skater: boolean): void => {
    const p = byId.get(id);
    if (!p) return fail('bad-lines', `${team.abbr}: ${slot} names ${id}, who is not on the team`);
    if (skater && p.position === 'G') fail('bad-lines', `${team.abbr}: ${slot} has goalie ${id}`);
    if (!skater && p.position !== 'G') fail('bad-lines', `${team.abbr}: ${slot} must be a goalie, got ${id}`);
    if (seen.has(id)) fail('bad-lines', `${team.abbr}: ${id} is on the lines twice`);
    seen.add(id);
  };
  forwards.forEach((line, i) => {
    if (!Array.isArray(line) || line.length !== 3) fail('bad-lines', `${team.abbr}: forward line ${i + 1} needs 3 players`);
    line.forEach((id) => use(id, `forward line ${i + 1}`, true));
  });
  defence.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) fail('bad-lines', `${team.abbr}: defence pair ${i + 1} needs 2 players`);
    pair.forEach((id) => use(id, `defence pair ${i + 1}`, true));
  });
  use(goalie, 'goalie slot', false);
}

/**
 * Checks everything the engine reads from a setup and throws a SetupError naming the first problem found: an invalid
 * setup is rejected before play rather than producing a broken game.
 */
export function validateSetup(setup: GameSetup): void {
  if (!isObj(setup)) fail('not-an-object', 'setup must be an object');
  if (!isNum(setup.seed)) fail('bad-seed', `seed must be a finite number, got ${String(setup.seed)}`);
  if (!Array.isArray(setup.chemistry)) fail('bad-chemistry', `chemistry must be an array of { a, b, value }, got ${String(setup.chemistry)}`);
  const ids = new Set<string>();
  for (const side of ['home', 'away'] as const) {
    const team = setup[side];
    if (!isObj(team) || !Array.isArray(team.players)) fail('bad-team', `${side} team must have a players array`);
    for (const p of team.players) {
      if (!isObj(p) || typeof p.id !== 'string' || p.id === '') fail('bad-player', `${team.abbr}: every player needs a string id`);
      if (ids.has(p.id)) fail('duplicate-id', `duplicate player id ${p.id}`);
      ids.add(p.id);
    }
  }
  for (const team of [setup.home, setup.away]) {
    for (const p of team.players) checkPlayer(team, p);
    checkTactics(team);
    checkLines(team);
  }
  for (const c of setup.chemistry) {
    if (!isObj(c) || !ids.has(c.a) || !ids.has(c.b)) fail('bad-chemistry', `chemistry names unknown player ${String(c?.a)} or ${String(c?.b)}`);
    inRange(`chemistry ${c.a}-${c.b}`, 'bad-chemistry', 'value', c.value, -1, 1);
  }
}
