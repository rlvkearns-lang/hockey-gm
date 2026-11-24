import { describe, it, expect } from 'vitest';
import { DEFAULT_TACTICS, entryFactors, lineHabit, naturalTactics, offenceFactors, patienceFactor, resolveTactics, shade } from '../src/tactics';
import { generateTeam } from '../src/roster-gen';
import { PLAYER_TYPES } from '../src/player-types';
import { validateSetup } from '../src/validate';
import { TUNING } from '../src/tuning';
import { resolveTactics as resolveFromIndex } from '../src/index';
import type { GameSetup, Side, Tactics } from '../src/types';
import { gameSetup, stateWith } from './helpers';
import { observeGame, tacticCounts, tacticMeasures } from './measures';

/** `s` with `side`'s tactics changed by `t` (the rosters are the same). */
const withTactics = (s: GameSetup, side: Side, t: Partial<Tactics>): GameSetup => ({ ...s, [side]: { ...s[side], tactics: { ...s[side].tactics, ...t } } });
/** `s` with every forward of `side` given the mean habits of player type `type` (attributes unchanged), and tactics `t`. */
function allOfType(s: GameSetup, side: Side, type: string, t: Partial<Tactics>): GameSetup {
  const players = s[side].players.map((p) => (p.position === 'G' || p.position === 'LD' || p.position === 'RD' ? p : { ...p, tendencies: { ...PLAYER_TYPES[type]!.tendencies } }));
  return withTactics({ ...s, [side]: { ...s[side], players } }, side, t);
}
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const home = (t: Partial<Tactics>, n = 4) => tacticMeasures(tacticCounts(withTactics(gameSetup(1), 'home', t), 'home', n));
const homeCounts = (t: Partial<Tactics>, n = 4) => tacticCounts(withTactics(gameSetup(1), 'home', t), 'home', n);
const LONG = 600_000;

describe('tactics: the input', () => {
  it('a setup without the new fields is valid and plays with the defaults', () => {
    const s = gameSetup(1);
    expect(() => validateSetup(withTactics(s, 'home', { zoneEntry: undefined, offence: undefined, defence: undefined, pinch: undefined }))).not.toThrow();
    expect(resolveTactics({ forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 } })).toMatchObject({ zoneEntry: 'mixed', offence: 'cycle', defence: 'collapse', pinch: 'sometimes' });
    expect(resolveFromIndex).toBe(resolveTactics);
    expect(() => validateSetup(withTactics(s, 'home', { zoneEntry: 'chip' as never }))).toThrow(/zoneEntry/);
    expect(() => validateSetup(withTactics(s, 'home', { offence: 'trap' as never }))).toThrow(/offence/);
    expect(() => validateSetup(withTactics(s, 'home', { defence: 'zone' as never }))).toThrow(/defence/);
    expect(() => validateSetup(withTactics(s, 'home', { pinch: 'never' as never }))).toThrow(/pinch/);
  });
  it('the default tactics are all ones: they play as before', () => {
    const d = resolveTactics({ forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 } });
    expect(d).toMatchObject(DEFAULT_TACTICS);
    expect(entryFactors(d, 0.9, 0.1)).toEqual({ carryIn: 1, dump: 1 });
    expect(Object.values(offenceFactors(d))).toEqual([1, 1, 1, 1, 1]);
    expect(patienceFactor(d.offence)).toBe(1);
  });
  it('the offence factors keep tuning\'s ratios between tactics, the default all ones', () => {
    const f = (offence: 'cycle' | 'pointShots' | 'rush') => offenceFactors(resolveTactics({ forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 }, offence }));
    const O = TUNING.tactics.offence;
    for (const k of ['lowCycle', 'pointPass', 'pointShot', 'rushShot', 'hold'] as const) {
      expect(f('pointShots')[k] / f('rush')[k]).toBeCloseTo(O.pointShots[k] / O.rush[k], 10);
      expect(f('pointShots')[k] / f('cycle')[k]).toBeCloseTo(O.pointShots[k] / O.cycle[k], 10);
    }
    expect(f('pointShots').pointShot).toBeGreaterThan(1); expect(f('rush').rushShot).toBeGreaterThan(1); expect(f('rush').lowCycle).toBeLessThan(1);
    // (Close-out ruling 3b: a point-shot team is as patient as a cycle team, 1.0, to keep its attempts inside 40 to 70.)
    expect(patienceFactor('cycle')).toBeGreaterThanOrEqual(patienceFactor('pointShots')); expect(patienceFactor('pointShots')).toBeGreaterThan(patienceFactor('rush'));
  });
  it('a factor k multiplies the option\'s weight in an average player\'s draw by k (a shift of temp * ln k on its value)', () => {
    const T = TUNING.tactics.temp;
    expect(shade(0.2, 1)).toBe(0.2);
    expect(Math.exp((shade(-0.03, 4) - -0.03) / T)).toBeCloseTo(4, 6);
    expect(Math.exp((shade(0.01, 0.5) - 0.01) / T)).toBeCloseTo(0.5, 6);
  });
  it('lineHabit is the mean habit of the forwards (or defencemen) on the ice', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 });
    const s = gameSetup(1);
    const defs = new Map([...s.home.players, ...s.away.players].map((p) => [p.id, p]));
    const ids = st.skaters.filter((k) => k.onIce && k.side === 'home' && k.slot !== 'LD' && k.slot !== 'RD').map((k) => k.id);
    const known = ids.filter((id) => defs.has(id));
    const h = lineHabit(st, 'home', defs, 'dump', 'F');
    if (known.length === 0) expect(h).toBe(0.5);
    else expect(h).toBeCloseTo(known.reduce((a, id) => a + defs.get(id)!.tendencies.dump, 0) / known.length, 10);
  });
});

describe('tactics: the players bend them', () => {
  it('grinders asked to carry still dump 1.3 times as often as a skilled line (factors); an average line plays the tactic as written', () => {
    const f = (habit: { dump: number; carry: number }, zoneEntry: 'carry' | 'dump'): number => {
      const e = entryFactors(resolveTactics({ ...gameSetup(1).home.tactics, zoneEntry }), habit.dump, habit.carry);
      return e.dump / (e.dump + e.carryIn);
    };
    expect(f({ dump: 0.6, carry: 0.3 }, 'carry')).toBeGreaterThan(f({ dump: 0.2, carry: 0.6 }, 'carry') * 1.3);
    expect(f({ dump: 0.6, carry: 0.3 }, 'dump')).toBeGreaterThan(f({ dump: 0.2, carry: 0.6 }, 'dump'));
    const avg = entryFactors(resolveTactics({ ...gameSetup(1).home.tactics, zoneEntry: 'dump' }), 0.5, 0.5);
    expect(avg.dump).toBeCloseTo(TUNING.tactics.entry.dump.dump, 10); expect(avg.carryIn).toBeCloseTo(TUNING.tactics.entry.dump.carryIn, 10);
  });
  it('a skilled line asked to dump still carries a quarter of its entries', () => {
    const c = tacticCounts(allOfType(gameSetup(1), 'home', 'Playmaker', { zoneEntry: 'dump' }), 'home', 4);
    expect(c.carryIns / (c.dumpIns + c.carryIns)).toBeGreaterThan(0.25);
  }, LONG);
  it('with the same tactic a line of grinders dumps more than a skilled line, by less than the tactic itself moves it', () => {
    const share = (type: string) => tacticMeasures(tacticCounts(allOfType(gameSetup(1), 'home', type, { zoneEntry: 'mixed' }), 'home', 4)).dumpInShare;
    const grind = share('Grinder'), skill = share('Playmaker');
    expect(grind).toBeGreaterThan(skill);
    expect(grind / skill).toBeLessThan(home({ zoneEntry: 'dump' }, 8).dumpInShare / home({ zoneEntry: 'carry' }, 8).dumpInShare);
  }, LONG);
});

describe('tactics: two teams look different', () => {
  it('a dump-and-chase team and a carry-in team (8 games each): the one dumps at least 1.6 times as often, a quarter of its entries or more', () => {
    // Task 11 close-out ruling 3a: the binding bar is the ratio between the two teams (at least 1.6) with the dump team
    // at 0.25 or more (the brief's "over 45%" took a draw-weight factor of 600 on the dump; certainty before the cap is
    // held under 0.15 for every tactic instead). The carry team stays under a quarter.
    const dump = home({ zoneEntry: 'dump' }, 8).dumpInShare, carry = home({ zoneEntry: 'carry' }, 8).dumpInShare;
    expect(dump).toBeGreaterThanOrEqual(0.25); expect(carry).toBeLessThan(0.25); expect(dump).toBeGreaterThanOrEqual(carry * 1.6);
  }, LONG);
});

describe('tactics shade, they never decide (Review Focus 3)', () => {
  it('for every entry and offence tactic (both teams, two games) one kind is certain before the cap in under 15% of ordinary decisions', () => {
    for (const t of [{ zoneEntry: 'dump' }, { zoneEntry: 'carry' }, { offence: 'pointShots' }, { offence: 'rush' }] as Partial<Tactics>[]) {
      const s = { ...gameSetup(1), home: { ...gameSetup(1).home, tactics: { ...gameSetup(1).home.tactics, ...t } }, away: { ...gameSetup(1).away, tactics: { ...gameSetup(1).away.tactics, ...t } } };
      const a = observeGame(s).counters, b = observeGame({ ...s, seed: 2 }).counters;
      expect((a.normalCertain + b.normalCertain) / (a.normalDecisionPoints + b.normalDecisionPoints), JSON.stringify(t)).toBeLessThan(0.15);
    }
  }, LONG);
  it('a dump-and-chase team still carries in, and a carry-in team still dumps (no tactic removes an option)', () => {
    expect(homeCounts({ zoneEntry: 'dump' }).carryIns).toBeGreaterThan(0);
    expect(homeCounts({ zoneEntry: 'carry' }).dumpIns).toBeGreaterThan(0);
  }, LONG);
});

describe('tactics: generated teams', () => {
  it('generated teams get tactics that suit them: deterministic, and across 40 seeds every setting takes at least two values', () => {
    const ts = Array.from({ length: 40 }, (_, i) => resolveTactics(generateTeam(i + 1, 'T', 'T').tactics));
    for (const k of ['forecheck', 'zoneEntry', 'offence', 'defence', 'pinch'] as const) expect(new Set(ts.map((t) => t[k])).size).toBeGreaterThanOrEqual(2);
    expect(generateTeam(7, 'T', 'T').tactics).toEqual(generateTeam(7, 'T', 'T').tactics);
    // The roster itself is unchanged by this task (same players and lines as before it: a fingerprint taken then).
    expect(fnv(JSON.stringify(generateTeam(7, 'T', 'T').players))).toBe('7d85cfb2');
    expect(fnv(JSON.stringify(generateTeam(1, 'T', 'T').players))).toBe('ad9d2797');
    expect(fnv(JSON.stringify(generateTeam(7, 'T', 'T').lines))).toBe('5f189b89');
    const t = generateTeam(7, 'T', 'T');
    expect(t.tactics).toMatchObject(naturalTactics(t.players, t.lines));
    expect(t.tactics.shiftSeconds).toEqual({ forwards: 45, defence: 55 });
  });
  it('the default test teams do not get the same tactic set', () => {
    const s = gameSetup(1);
    expect(resolveTactics(s.home.tactics)).not.toEqual(resolveTactics(s.away.tactics));
  });
  it('a heavy grinding roster leans dump and chase; a fast skilled one carries in and rushes', () => {
    const t = generateTeam(1, 'T', 'T');
    const fwd = new Set(t.lines.forwards.flat());
    const as = (type: string, bias: Partial<Record<'speed', number>>) => t.players.map((p) => (fwd.has(p.id) ? { ...p, tendencies: { ...PLAYER_TYPES[type]!.tendencies }, attrs: { ...p.attrs, speed: p.attrs.speed + (bias.speed ?? 0) } } : p));
    const grind = naturalTactics(as('Grinder', {}), t.lines), fast = naturalTactics(as('Speedster', { speed: 15 }), t.lines);
    expect(grind.zoneEntry).toBe('dump'); expect(grind.forecheck).toBe('aggressive');
    expect(fast.zoneEntry).toBe('carry');
    expect(fast.offence).toBe('rush');
  });
});
