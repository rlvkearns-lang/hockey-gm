import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from './attributes';
import { PLAYER_TYPES } from './player-types';
import { createRng, type Rng } from './rng';
import type { PlayerDef, Position, TeamDef, Tendencies } from './types';

const FIRST = ['Alex', 'Ben', 'Cal', 'Dan', 'Eli', 'Finn', 'Gus', 'Hank', 'Ivan', 'Jon', 'Kai', 'Leo', 'Max', 'Nate', 'Owen', 'Pete', 'Quin', 'Ray', 'Sam', 'Theo'];
const LAST = ['Arden', 'Brandt', 'Carver', 'Dahl', 'Ekberg', 'Frost', 'Grey', 'Holm', 'Ingram', 'Jarvis', 'Keane', 'Lund', 'Marsh', 'Novak', 'Oakes', 'Pryor', 'Quist', 'Reyes', 'Sorel', 'Thorne'];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
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

/** 12 forwards, 6 defencemen, 2 goalies. `overall` is the mean attribute before type bias. */
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

  return {
    id: abbr.toLowerCase(),
    name,
    abbr,
    players,
    lines: { forwards, defence, goalie },
    tactics: { forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 } },
  };
}
