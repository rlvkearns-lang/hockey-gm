import { describe, it, expect } from 'vitest';
import { DEFAULT_TACTICS, entryFactors, lineHabit, naturalTactics, offenceFactors, patienceFactor, resolveTactics, shade } from '../src/tactics';
import { generateTeam } from '../src/roster-gen';
import { PLAYER_TYPES } from '../src/player-types';
import { validateSetup } from '../src/validate';
import { TUNING } from '../src/tuning';
import { resolveTactics as resolveFromIndex } from '../src/index';
import type { GameSetup, Side, Tactics } from '../src/types';
import { gameSetup, stateWith } from './helpers';
import { tacticCounts, tacticMeasures } from './measures';

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
  it('the offence factors keep the brief\'s ratios between tactics', () => {
    const f = (offence: 'cycle' | 'pointShots' | 'rush') => offenceFactors(resolveTactics({ forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 }, offence }));
    const O = TUNING.tactics.offence;
    for (const k of ['lowCycle', 'pointPass', 'pointShot', 'rushShot', 'hold'] as const) {
      expect(f('pointShots')[k] / f('rush')[k]).toBeCloseTo(O.pointShots[k] / O.rush[k], 10);
      expect(f('pointShots')[k] / f('cycle')[k]).toBeCloseTo(O.pointShots[k] / O.cycle[k], 10);
    }
    expect(f('pointShots').pointShot).toBeGreaterThan(1); expect(f('rush').rushShot).toBeGreaterThan(1); expect(f('rush').lowCycle).toBeLessThan(1);
    expect(patienceFactor('cycle')).toBeGreaterThan(patienceFactor('pointShots')); expect(patienceFactor('pointShots')).toBeGreaterThan(patienceFactor('rush'));
  });
  it('a factor shades a value, it never flips its sign', () => {
    expect(shade(0.2, 1.5)).toBeCloseTo(0.3); expect(shade(-0.2, 1.5)).toBeCloseTo(-0.2 / 1.5); expect(shade(-0.2, 0.5)).toBeCloseTo(-0.4); expect(shade(0, 2)).toBe(0);
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
    expect(grind / skill).toBeLessThan(home({ zoneEntry: 'dump' }).dumpInShare / home({ zoneEntry: 'carry' }).dumpInShare);
  }, LONG);
});

describe('tactics: two teams look different', () => {
  it('a dump-and-chase team and a carry-in team: dump-ins over 45% of one\'s entries, under 25% of the other\'s, and 1.6 times the share', () => {
    const dump = home({ zoneEntry: 'dump' }).dumpInShare, carry = home({ zoneEntry: 'carry' }).dumpInShare;
    expect(dump).toBeGreaterThan(0.45); expect(carry).toBeLessThan(0.25); expect(dump).toBeGreaterThan(carry * 1.6);
  }, LONG);
  it('a cycle team holds the zone longer than a rush team, and cycles more below the dots', () => {
    const cyc = home({ offence: 'cycle' }), rush = home({ offence: 'rush' });
    expect(cyc.ozoneSecondsPerPossession).toBeGreaterThan(rush.ozoneSecondsPerPossession * 1.2);
    expect(cyc.lowPassesPerPossession).toBeGreaterThan(rush.lowPassesPerPossession);
    expect(cyc.lowSecondsPerPossession).toBeGreaterThan(rush.lowSecondsPerPossession);
  }, LONG);
  it('a point-shot team shoots more from the defence and from the point', () => {
    const pts = home({ offence: 'pointShots' }), cyc = home({ offence: 'cycle' });
    expect(pts.defenceAttemptsPerGame).toBeGreaterThan(cyc.defenceAttemptsPerGame * 1.4);
    expect(pts.pointAttemptShare).toBeGreaterThan(cyc.pointAttemptShare * 1.4);
  }, LONG);
  it('an aggressive forecheck has two men deep; a trap has at most one', () => {
    expect(home({ forecheck: 'aggressive' }, 2).twoDeepShare).toBeGreaterThan(0.40);
    expect(home({ forecheck: 'passive' }, 2).twoDeepShare).toBeLessThan(0.10);
  }, LONG);
  it('a pressure team presses the carrier in its zone more than a collapse team and gives up relatively more from the slot', () => {
    const pr = home({ defence: 'pressure' }), co = home({ defence: 'collapse' });
    expect(pr.dzonePressedShare).toBeGreaterThan(co.dzonePressedShare);
    expect(pr.dzoneTwoShare).toBeGreaterThan(co.dzoneTwoShare);
    expect(pr.slotToPoint).toBeGreaterThan(co.slotToPoint);
  }, LONG);
  it('against a carrier behind the net a pressure team chases and a collapse team holds the front', () => {
    expect(home({ defence: 'pressure' }).chaseShare).toBeGreaterThan(0.7); expect(home({ defence: 'collapse' }).chaseShare).toBeLessThan(0.3);
  }, LONG);
  it('point men pinch more when told to, and only with a forward above them', () => {
    const often = homeCounts({ pinch: 'often' }), rarely = homeCounts({ pinch: 'rarely' }), some = homeCounts({ pinch: 'sometimes' });
    expect(often.pinches).toBeGreaterThan(rarely.pinches * 2);
    expect(often.pinchesWithoutCover + rarely.pinchesWithoutCover + some.pinchesWithoutCover).toBe(0);
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
