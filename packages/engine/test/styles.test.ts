import { describe, it, expect } from 'vitest';
import { blendHabits, STYLES, styleGaps, styleLabel, styleOf } from '../src/styles';
import { TUNING } from '../src/tuning';
import { PLAYER_TYPES } from '../src/player-types';
import { generateTeam } from '../src/roster-gen';
import { at, def, runBattle, shareOf } from './helpers';
import { engageChance } from '../src/engagements';
import type { PlayerDef, Style } from '../src/types';

describe('styles (Task 12)', () => {
  it('habits are two thirds primary and one third secondary', () => {
    const h = blendHabits('Power Forward', 'Sniper'); expect(h.shoot).toBeCloseTo((2 * 0.55 + 0.8) / 3, 9); expect(h.hit).toBeCloseTo((2 * 0.8 + 0.2) / 3, 9);
    expect(h.block).toBeCloseTo((2 * 0.5 + 0.2) / 3, 9);
    expect(blendHabits('Grinder', null)).toEqual(STYLES.Grinder.habits);
  });
  it('named secondary then primary', () => {
    expect(styleLabel('Power Forward', 'Sniper')).toBe('Sniping Power Forward'); expect(styleLabel('Speedster', 'Playmaker')).toBe('Playmaking Speedster');
    expect(styleLabel('Sniper', 'Two-Way Forward')).toBe('Two-Way Sniper'); expect(styleLabel('Grinder', null)).toBe('Grinder');
    expect(styleLabel('Offensive Defenceman', 'Defensive Defenceman')).toBe('Defensive Offensive Defenceman');
  });
  it('the label is worked out from the player, with an override', () => {
    const pf = def({ position: 'RW', strength: 92, bodyChecking: 88, balance: 82, shootingAccuracy: 90, shootingPower: 86, speed: 62, agility: 60, tendencies: blendHabits('Power Forward', 'Sniper') });
    expect(styleOf(pf)!.label).toBe('Sniping Power Forward');
    expect(styleOf({ ...pf, style: { primary: 'Grinder', secondary: null } })!.label).toBe('Grinder');
    expect(styleOf(def({ position: 'G' }))).toBeNull();
    expect(styleOf(def({ position: 'LD', defensivePositioning: 92, shotBlocking: 90, stickChecking: 85, tendencies: blendHabits('Defensive Defenceman', null) }))!.primary).toBe('Defensive Defenceman');
  });
  it('a pure player is read as his style alone, with no secondary', () => {
    const sniper = def({ position: 'LW', shootingAccuracy: 90, shootingPower: 84, strength: 64, bodyChecking: 58, tendencies: blendHabits('Sniper', null) });
    expect(styleOf(sniper)).toEqual({ primary: 'Sniper', secondary: null, label: 'Sniper' });
  });
  it('the Shutdown Forward is a style and a type of its own; every style keeps the habits of its type (with block)', () => {
    expect(STYLES['Shutdown Forward'].habits).toEqual({ shoot: 0.25, pass: 0.45, carry: 0.3, dump: 0.5, hit: 0.5, forecheck: 0.55, netFront: 0.2, joinRush: 0.2, block: 0.8 });
    expect(PLAYER_TYPES['Shutdown Forward']!.build).toEqual({ heightCm: [182, 194], weightKg: [86, 98] });
    expect(STYLES['Defensive Defenceman'].typeKey).toBe('Shutdown Defenceman');
    for (const s of Object.values(STYLES)) {
      const { block, ...rest } = s.habits;
      expect(rest).toEqual(PLAYER_TYPES[s.typeKey]!.tendencies); expect(block).toBeGreaterThan(0); expect(s.attrBias).toBe(PLAYER_TYPES[s.typeKey]!.attrBias);
    }
    const blocks = Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.habits.block]));
    expect(blocks).toEqual({
      Sniper: 0.2, Playmaker: 0.2, 'Power Forward': 0.5, 'Two-Way Forward': 0.6, 'Shutdown Forward': 0.8, Speedster: 0.2, Grinder: 0.7, Enforcer: 0.5,
      'Offensive Defenceman': 0.4, 'Defensive Defenceman': 0.85, 'Two-Way Defenceman': 0.6,
    });
  });
  it('generated players: every style appears, about 60% have a secondary, most have 0 to 3 badges', () => {
    const ps = Array.from({ length: 30 }, (_, i) => generateTeam(i + 1, 'T', 'T')).flatMap((t) => t.players.filter((p) => p.position !== 'G'));
    const styles = ps.map((p) => styleOf(p)!); for (const s of Object.keys(STYLES)) expect(styles.some((x) => x.primary === s)).toBe(true);
    const withSecond = styles.filter((s) => s.secondary !== null).length / styles.length; expect(withSecond).toBeGreaterThan(0.3); expect(withSecond).toBeLessThan(0.8);
    expect(shareOf(ps, (p) => (p.badges ?? []).length <= 3)).toBeGreaterThan(0.9); expect(shareOf(ps, (p) => (p.badges ?? []).length >= 1)).toBeGreaterThan(0.1);
    // (Task 12 close-out: about one goalie in five holds a badge.)
    const gs = Array.from({ length: 100 }, (_, i) => generateTeam(i + 1, 'T', 'T')).flatMap((t) => t.players.filter((p) => p.position === 'G'));
    const withBadge = shareOf(gs, (p) => (p.badges ?? []).length >= 1); expect(withBadge).toBeGreaterThan(0.12); expect(withBadge).toBeLessThan(0.3);
  });
  it('a generated player: his type is his drawn primary style\'s, no sub-type, no style set by hand, habits a blend of his styles (Task 12)', () => {
    const ps = Array.from({ length: 10 }, (_, i) => generateTeam(i + 1, 'T', 'T')).flatMap((t) => t.players);
    for (const p of ps) {
      expect(p.subType).toBeNull(); expect(p.style).toBeUndefined();
      if (p.position === 'G') { expect(p.type).toBe('Goalie'); continue; }
      expect(Object.values(STYLES).some((st) => st.typeKey === p.type)).toBe(true);
      expect(p.tendencies.block).toBeGreaterThanOrEqual(0); expect(p.tendencies.block).toBeLessThanOrEqual(1);
    }
    expect(ps.some((p) => p.type === 'Shutdown Forward')).toBe(true);
  });
});

// Task 13b item 5 (Task 12 review): a label kept unless the evidence clearly crosses. His declared style (his type's) stays
// his primary unless another scores TUNING.styles.keepMargin more.
describe('style labels with a margin (Task 13b)', () => {
  const skaters = (): PlayerDef[] => Array.from({ length: 40 }, (_, k) => generateTeam(k + 1, 'T', 'TTT').players).flat().filter((p) => p.position !== 'G');
  const declared = (d: PlayerDef): Style | undefined => (Object.keys(STYLES) as Style[]).find((k) => STYLES[k].typeKey === d.type);
  it('a generated player is read as his own type nearly always (under 2% otherwise; about 7% before)', () => {
    const ps = skaters();
    const off = ps.filter((p) => styleOf(p)!.primary !== declared(p)).length;
    expect(off / ps.length).toBeLessThan(0.02);
  });
  it('a one-point change in any single attribute flips no label that was not within its margin', () => {
    const M = TUNING.styles.keepMargin, W = TUNING.styles.secondaryWithin, NEAR = 0.015;
    let cases = 0, flips = 0;
    for (const p of skaters()) {
      const before = styleOf(p)!;
      for (const a of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) for (const dv of [-1, 1]) {
        const q: PlayerDef = { ...p, attrs: { ...p.attrs, [a]: p.attrs[a] + dv } };
        const after = styleOf(q)!;
        cases++;
        if (after.label === before.label) continue;
        flips++;
        const g = styleGaps(p);
        // Either the primary's challenger stood within NEAR of beating it by the margin, or the secondary within NEAR of its
        // threshold, or two styles within NEAR of each other for the secondary (no declared secondary to keep).
        expect(Math.abs(g.challenger - M) <= NEAR || Math.abs(g.secondaryRatio - W) <= NEAR || g.secondaryTie <= NEAR, `${p.id} ${a} ${dv}: ${before.label} -> ${after.label}`).toBe(true);
      }
    }
    expect(cases).toBeGreaterThan(5000);
    expect(flips / cases).toBeLessThan(0.01);
  });
});

describe('style parity, a quick check (Task 12 close-out; the full table is in the calibration suite)', () => {
  /** A typical player of `s`: every attribute 70 plus the style's bias, his style's habits and middle of its build. */
  const typical = (s: Style): PlayerDef => {
    const st = STYLES[s], b = PLAYER_TYPES[st.typeKey]!.build;
    return def({ ...Object.fromEntries(Object.entries(st.attrBias).map(([k, v]) => [k, 70 + v])), tendencies: st.habits, weightKg: (b.weightKg[0] + b.weightKg[1]) / 2 });
  };
  it('a power forward does not always win a board battle against a playmaker, nor an engagement draw against a speedster', () => {
    let won = 0, n = 0;
    for (let i = 0; i < 300; i++) { const r = runBattle(typical('Power Forward'), typical('Playmaker')); if (r.winner !== null) { n++; if (r.winner === 'a') won++; } }
    expect(won / n).toBeGreaterThan(0.5); expect(won / n).toBeLessThan(0.75);
    const p = engageChance(typical('Power Forward'), at(0, 0), typical('Speedster'), at(1, 0), null);
    expect(p).toBeGreaterThan(0.5); expect(p).toBeLessThan(0.75);
  }, 120_000);
});
