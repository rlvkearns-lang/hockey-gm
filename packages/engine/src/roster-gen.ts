import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from './attributes';
import { earnedBadges } from './badges';
import { PLAYER_TYPES } from './player-types';
import { blendHabits, groupOf, STYLES, stylesFor, stylesOf } from './styles';
import { TUNING } from './tuning';
import { createRng, type Rng } from './rng';
import { naturalTactics } from './tactics';
import type { PlayerDef, Position, Style, TeamDef, Tendencies } from './types';
import { clamp } from './util';

const FIRST = ['Alex', 'Ben', 'Cal', 'Dan', 'Eli', 'Finn', 'Gus', 'Hank', 'Ivan', 'Jon', 'Kai', 'Leo', 'Max', 'Nate', 'Owen', 'Pete', 'Quin', 'Ray', 'Sam', 'Theo'];
const LAST = ['Arden', 'Brandt', 'Carver', 'Dahl', 'Ekberg', 'Frost', 'Grey', 'Holm', 'Ingram', 'Jarvis', 'Keane', 'Lund', 'Marsh', 'Novak', 'Oakes', 'Pryor', 'Quist', 'Reyes', 'Sorel', 'Thorne'];

const rating = (v: number): number => clamp(Math.round(v), 1, 100);

const ST = TUNING.styles;

/** The primary's attribute bias plus TUNING.styles.secondaryBias of the secondary's (Task 12). */
function biasOf(primary: Style, secondary: Style | null): Partial<SkaterAttrs> {
  const out: Partial<SkaterAttrs> = { ...STYLES[primary].attrBias };
  if (secondary !== null) for (const [k, v] of Object.entries(STYLES[secondary].attrBias) as [keyof SkaterAttrs, number][]) out[k] = (out[k] ?? 0) + ST.secondaryBias * v;
  return out;
}

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
  // (Every habit given, block included for a skater, gets the same noise.)
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof Tendencies)[]) out[k] = clamp((base[k] ?? 0.5) + rng.gauss() * 0.08, 0, 1);
  return out;
}

/**
 * A player: a skater of `primary` style (Task 12) draws a secondary style of his group (another one) with chance
 * TUNING.styles.secondaryChance; his build is his primary's type's, his attributes biased by the primary plus half the
 * secondary (biasOf), his habits blendHabits plus noise; `type` is the primary's PLAYER_TYPES key, `subType` null (badges
 * replace it), `style` unset (styleOf works it out), `badges` what he earns. A goalie (`primary` null) as before.
 */
function makePlayer(rng: Rng, team: string, n: number, position: Position, primary: Style | null, overall: number): PlayerDef {
  const typeName = primary === null ? 'Goalie' : STYLES[primary].typeKey;
  const def = PLAYER_TYPES[typeName]!;
  const isGoalie = position === 'G';
  const others = primary === null ? [] : stylesOf(groupOf(position)!).filter((k) => k !== primary);
  const secondary = primary !== null && rng.chance(ST.secondaryChance) ? rng.pick(others) : null;
  const [h0, h1] = def.build.heightCm;
  const [w0, w1] = def.build.weightKg;
  const p: PlayerDef = {
    id: `${team}-${n}`,
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    number: n,
    position,
    shoots: position === 'LW' || position === 'LD' ? (rng.chance(0.8) ? 'L' : 'R') : position === 'G' ? 'L' : rng.chance(0.8) ? 'R' : 'L',
    heightCm: Math.round(rng.range(h0, h1)),
    weightKg: Math.round(rng.range(w0, w1)),
    type: typeName,
    subType: null,
    // Goalies keep a full, low, valid skater attribute set so every PlayerDef has one shape.
    attrs: isGoalie || primary === null ? makeSkaterAttrs(rng, 20, {}) : makeSkaterAttrs(rng, overall, biasOf(primary, secondary)),
    goalie: isGoalie ? makeGoalie(rng, overall) : null,
    tendencies: makeTendencies(rng, primary === null ? def.tendencies : blendHabits(primary, secondary)),
    form: 0,
    morale: 0,
    fatigue: 0,
  };
  p.badges = earnedBadges(p);
  return p;
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
  const add = (position: Position, primary: Style | null): string => {
    n += 1;
    const p = makePlayer(rng, abbr, n, position, primary, overall);
    players.push(p);
    return p.id;
  };

  const forwards: [string, string, string][] = [];
  for (let line = 0; line < 4; line++) {
    forwards.push(
      (['LW', 'C', 'RW'] as const).map((pos) => add(pos, rng.pick(stylesFor(pos)))) as [string, string, string],
    );
  }
  const defence: [string, string][] = [];
  for (let pair = 0; pair < 3; pair++) {
    defence.push((['LD', 'RD'] as const).map((pos) => add(pos, rng.pick(stylesFor(pos)))) as [string, string]);
  }
  const goalie = add('G', null);
  add('G', null);
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
