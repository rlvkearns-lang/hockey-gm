/**
 * Golden games: a fingerprint of whole games that must come out bit-identical in every JavaScript runtime (Node here,
 * a real browser in `npm run test:browser`). Pure engine code only (no Node APIs): it is bundled into a browser page.
 */
import { SKATER_ATTRS, GOALIE_ATTRS } from '../src/attributes';
import { createGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { resolveTactics } from '../src/tactics';
import type { GameSetup, GameState, TeamDef } from '../src/types';

export const GOLDEN_SEEDS = [42, 7, 123456] as const;
/** Ticks at which the running position hash is recorded. */
export const GOLDEN_TICKS = [1, 10, 100, 1000, 10_000, 50_000, 100_000] as const;

/** The debug viewer's game for a seed (same teams, same seed), so its score can be checked against this. */
export const goldenSetup = (seed: number): GameSetup => ({
  home: generateTeam(seed * 2 + 1, 'Harbour City', 'HBR'),
  away: generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK'),
  seed,
  chemistry: [],
});

export type Golden = { roster: string; ticks: string[]; final: string; score: string; events: number };

/** Two 32-bit FNV-style lanes over the exact bits of every number fed in. */
class Hash {
  private h1 = 0x811c9dc5;
  private h2 = 0x1234567;
  private readonly view = new DataView(new ArrayBuffer(8));
  num(x: number): void {
    this.view.setFloat64(0, x);
    this.h1 = Math.imul(this.h1 ^ this.view.getUint32(0), 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 ^ this.view.getUint32(4), 0x85ebca6b) >>> 0;
    this.h2 = (this.h2 ^ (this.h2 >>> 13)) >>> 0;
  }
  str(s: string): void { for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i)); this.num(-1); }
  hex(): string { return this.h1.toString(16).padStart(8, '0') + this.h2.toString(16).padStart(8, '0'); }
}

function hashTeam(h: Hash, t: TeamDef): void {
  for (const p of t.players) {
    h.str(p.id); h.str(p.name); h.num(p.number); h.str(p.position); h.str(p.shoots); h.str(p.catches ?? ''); h.num(p.heightCm); h.num(p.weightKg);
    h.str(p.type); h.str(p.subType ?? '');
    for (const k of SKATER_ATTRS) h.num(p.attrs[k]);
    if (p.goalie) for (const k of GOALIE_ATTRS) h.num(p.goalie[k]);
    const td = p.tendencies;
    for (const v of [td.shoot, td.pass, td.carry, td.dump, td.hit, td.forecheck, td.netFront, td.joinRush]) h.num(v);
    // Task 12: the block habit, a style set by hand, the badges.
    h.num(td.block ?? -1); h.str(p.style?.primary ?? ''); h.str(p.style?.secondary ?? '');
    for (const b of p.badges ?? []) h.str(b);
    h.num(-2);
  }
  for (const line of t.lines.forwards) for (const id of line) h.str(id);
  for (const pair of t.lines.defence) for (const id of pair) h.str(id);
  h.str(t.lines.goalie);
  // Task 11: the tactics (resolved, so a setup without the optional fields hashes as its defaults).
  const tc = resolveTactics(t.tactics);
  for (const v of [tc.forecheck, tc.zoneEntry, tc.offence, tc.defence, tc.pinch]) h.str(v);
  h.num(tc.shiftSeconds.forwards); h.num(tc.shiftSeconds.defence);
}

function hashPositions(h: Hash, st: GameState): void {
  h.num(st.puck.pos.x); h.num(st.puck.pos.y); h.num(st.puck.z);
  for (const s of st.skaters) { h.num(s.pos.x); h.num(s.pos.y); h.num(s.facing); }
  h.num(st.goalies.home.pos.x); h.num(st.goalies.home.pos.y); h.num(st.goalies.away.pos.x); h.num(st.goalies.away.pos.y);
}

/** Plays golden game `seed` to the end, hashing every position on every tick. */
export function goldenRun(seed: number): Golden {
  const setup = goldenSetup(seed);
  const rh = new Hash();
  hashTeam(rh, setup.home);
  hashTeam(rh, setup.away);
  const g = createGame(setup);
  const h = new Hash();
  const ticks: string[] = [];
  let next = 0;
  while (!g.done) {
    g.step();
    hashPositions(h, g.state);
    if (g.state.tick === GOLDEN_TICKS[next]) { ticks.push(`${g.state.tick}:${h.hex()}`); next++; }
  }
  const r = g.result();
  return { roster: rh.hex(), ticks, final: h.hex(), score: `${r.score.home}-${r.score.away}`, events: r.events.length };
}
