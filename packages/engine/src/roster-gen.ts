import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from './attributes';
import { PLAYER_TYPES } from './player-types';
import { createRng, type Rng } from './rng';
import { naturalTactics } from './tactics';
import type { PlayerDef, Position, TeamDef, Tendencies } from './types';
import { clamp } from './util';

const FIRST = ['Alex', 'Ben', 'Cal', 'Dan', 'Eli', 'Finn', 'Gus', 'Hank', 'Ivan', 'Jon', 'Kai', 'Leo', 'Max', 'Nate', 'Owen', 'Pete', 'Quin', 'Ray', 'Sam', 'Theo'];
const LAST = ['Arden', 'Brandt', 'Carver', 'Dahl', 'Ekberg', 'Frost', 'Grey', 'Holm', 'Ingram', 'Jarvis', 'Keane', 'Lund', 'Marsh', 'Novak', 'Oakes', 'Pryor', 'Quist', 'Reyes', 'Sorel', 'Thorne'];

const rating = (v: number): number => clamp(Math.round(v), 1, 100);

const typesFor = (pos: Position): string[] =>
  Object.keys(PLAYER_TYPES).filter((k) => PLAYER_TYPES[k]!.positions.includes(pos));

function makeSkaterAttrs(rng: Rng, overall: number, bias: Partial<SkaterAttrs>): SkaterAttrs {
  const attrs = {} as SkaterAttrs;
  for (const k of SKATER_ATTRS) attrs[k] = rating(overall + (bias[k] ?? 0) + rng.gauss() * 7);
  return attrs;
}

function makeGoalie(rng: Rng, overall: number): GoalieAttrs {
  const g = {} as GoalieAttrs;
  for (const k of GOALIE_ATTRS) g[k] = rating(overall + rng.gauss() * 6);
  return g;
}

function makeTendencies(rng: Rng, base: Tendencies): Tendencies {
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof Tendencies)[]) out[k] = clamp(base[k] + rng.gauss() * 0.08, 0, 1);
  return out;
}

function makePlayer(rng: Rng, team: string, n: number, position: Position, typeName: string, overall: number): PlayerDef {
  const def = PLAYER_TYPES[typeName]!;
  const isGoalie = position === 'G';
  const [h0, h1] = def.build.heightCm;
  const [w0, w1] = def.build.weightKg;
  return {
    id: `${team}-${n}`,
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    number: n,
    position,
    shoots: position === 'LW' || position === 'LD' ? (rng.chance(0.8) ? 'L' : 'R') : position === 'G' ? 'L' : rng.chance(0.8) ? 'R' : 'L',
    heightCm: Math.round(rng.range(h0, h1)),
    weightKg: Math.round(rng.range(w0, w1)),
    type: typeName,
    subType: rng.pick(def.subTypes),
    // Goalies keep a full, low, valid skater attribute set so every PlayerDef has one shape.
    attrs: isGoalie ? makeSkaterAttrs(rng, 20, {}) : makeSkaterAttrs(rng, overall, def.attrBias),
    goalie: isGoalie ? makeGoalie(rng, overall) : null,
    tendencies: makeTendencies(rng, def.tendencies),
    form: 0,
    morale: 0,
    fatigue: 0,
  };
}

/** Numbers goalies wear; skaters wear anything else from 2 to 98. */
const GOALIE_NUMBERS = [30, 31, 35, 1, 29, 33, 34, 39, 40, 41, 70];
const SKATER_NUMBERS = Array.from({ length: 97 }, (_, i) => i + 2).filter((k) => !GOALIE_NUMBERS.includes(k));

/**
 * Sweater numbers: goalies from the conventional goalie numbers, skaters from the rest, all different. Drawn from a
 * stream of their own (seed + 0.5), so they leave the players themselves exactly as they were.
 */
function assignNumbers(seed: number, players: PlayerDef[]): void {
  const rng = createRng(seed + 0.5);
  const draw = (pool: readonly number[]): (() => number) => {
    const left = pool.slice();
    return () => left.splice(rng.int(0, left.length - 1), 1)[0]!;
  };
  const goalie = draw(GOALIE_NUMBERS), skater = draw(SKATER_NUMBERS);
  for (const p of players) p.number = p.position === 'G' ? goalie() : skater();
}

/** Share of goalies who catch with the left hand (the glove on the left). */
const CATCHES_LEFT = 0.88;

/**
 * Goalies' catching hands: 'L' for 88%, 'R' for 12%, drawn from a stream of their own (seed + 0.25), so they leave the
 * players themselves exactly as they were.
 */
function assignCatches(seed: number, players: PlayerDef[]): void {
  const rng = createRng(seed + 0.25);
  for (const p of players) if (p.position === 'G') p.catches = rng.chance(CATCHES_LEFT) ? 'L' : 'R';
}

/** 12 forwards, 6 defencemen, 2 goalies, and the tactics that suit them (tactics.ts naturalTactics). `overall` is the mean attribute before type bias. */
export function generateTeam(seed: number, name: string, abbr: string, overall = 70): TeamDef {
  const rng = createRng(seed);
  const players: PlayerDef[] = [];
  let n = 0;
  const add = (position: Position, typeName: string): string => {
    n += 1;
    const p = makePlayer(rng, abbr, n, position, typeName, overall);
    players.push(p);
    return p.id;
  };

  const forwards: [string, string, string][] = [];
  for (let line = 0; line < 4; line++) {
    forwards.push(
      (['LW', 'C', 'RW'] as const).map((pos) => add(pos, rng.pick(typesFor(pos)))) as [string, string, string],
    );
  }
  const defence: [string, string][] = [];
  for (let pair = 0; pair < 3; pair++) {
    defence.push((['LD', 'RD'] as const).map((pos) => add(pos, rng.pick(typesFor(pos)))) as [string, string]);
  }
  const goalie = add('G', 'Goalie');
  add('G', 'Goalie');
  assignNumbers(seed, players);
  assignCatches(seed, players);
  const lines = { forwards, defence, goalie };

  return {
    id: abbr.toLowerCase(),
    name,
    abbr,
    players,
    lines,
    // Tactics that suit the roster (Task 11): a pure function of the players and lines, no draw, so the roster is as before.
    tactics: { ...naturalTactics(players, lines), shiftSeconds: { forwards: 45, defence: 55 } },
  };
}
