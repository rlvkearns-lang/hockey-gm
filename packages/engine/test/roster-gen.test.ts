import { describe, it, expect } from 'vitest';
import { generateTeam } from '../src/roster-gen';
import { SKATER_ATTRS, type SkaterAttrs } from '../src/attributes';
import { avg, teamMean } from './helpers';

describe('roster-gen', () => {
  it('builds a legal 20-man team, same every time for a seed', () => {
    const t = generateTeam(7, 'Harbour City', 'HBR');
    expect(t.players.length).toBe(20);
    expect(t.lines.forwards.length).toBe(4);
    expect(t.lines.defence.length).toBe(3);
    expect(generateTeam(7, 'Harbour City', 'HBR')).toEqual(t);
    for (const p of t.players)
      for (const k of SKATER_ATTRS) {
        expect(p.attrs[k]).toBeGreaterThanOrEqual(1);
        expect(p.attrs[k]).toBeLessThanOrEqual(100);
        expect(Number.isInteger(p.attrs[k])).toBe(true);
      }
  });
  it('every player has his own number; goalies wear goalie numbers', () => {
    for (const seed of [1, 2, 7, 42]) {
      const t = generateTeam(seed, 'T', 'TTT');
      expect(new Set(t.players.map((p) => p.number)).size).toBe(t.players.length);
      for (const p of t.players) {
        expect(Number.isInteger(p.number) && p.number >= 1 && p.number <= 98).toBe(true);
        if (p.position === 'G') expect([30, 31, 35, 1, 29, 33, 34, 39, 40, 41, 70]).toContain(p.number);
      }
    }
    expect(generateTeam(1, 'A', 'AAA').players.map((p) => p.number)).not.toEqual(generateTeam(2, 'B', 'BBB').players.map((p) => p.number));
  });
  it('types look different', () => {
    const ps = Array.from({ length: 40 }, (_, i) => generateTeam(i, 'T', 'T').players).flat();
    const mean = (type: string, k: keyof SkaterAttrs) =>
      avg(ps.filter((p) => p.type === type).map((p) => p.attrs[k]));
    expect(mean('Sniper', 'shootingAccuracy')).toBeGreaterThan(mean('Grinder', 'shootingAccuracy') + 10);
    expect(mean('Power Forward', 'strength')).toBeGreaterThan(mean('Speedster', 'strength') + 10);
    expect(avg(ps.filter((p) => p.type === 'Power Forward').map((p) => p.weightKg))).toBeGreaterThan(
      avg(ps.filter((p) => p.type === 'Speedster').map((p) => p.weightKg)) + 8,
    );
  });
  it('overall shifts the whole team', () => {
    expect(teamMean(generateTeam(1, 'A', 'A', 85))).toBeGreaterThan(teamMean(generateTeam(1, 'A', 'A', 55)) + 20);
  });
});
