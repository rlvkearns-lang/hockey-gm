import { describe, it, expect } from 'vitest';
import { blendHabits, STYLES, styleLabel, styleOf } from '../src/styles';
import { PLAYER_TYPES } from '../src/player-types';
import { def } from './helpers';

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
});
