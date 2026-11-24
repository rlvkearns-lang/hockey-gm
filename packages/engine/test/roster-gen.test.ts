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
  it('goalies catch left 88% of the time (a stream of their own: every other roster value is as it was, see task-6-report.md)', () => {
    let left = 0, n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const p of generateTeam(seed, 'T', 'T').players) {
        if (p.position !== 'G') { expect(p.catches).toBeUndefined(); continue; }
        n++; if (p.catches === 'L') left++; else expect(p.catches).toBe('R');
      }
    }
    expect(left / n).toBeGreaterThan(0.84); expect(left / n).toBeLessThan(0.92);
  });
});

describe('roster-gen tactics (Task 11)', () => {
  it('each team gets the tactics that suit its roster, with the usual shift lengths', async () => {
    const { naturalTactics } = await import('../src/tactics');
    for (const seed of [1, 2, 3, 4]) {
      const t = generateTeam(seed, 'T', 'T');
      expect(t.tactics).toEqual({ ...naturalTactics(t.players, t.lines), shiftSeconds: { forwards: 45, defence: 55 } });
    }
  });
});
