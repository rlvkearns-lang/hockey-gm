import { describe, it, expect } from 'vitest';
import { saveChance } from '../src/goalie';
import { createGame, simulateGame } from '../src/game';
import type { GameResult } from '../src/types';
import { executeShot } from '../src/actions';
import { RINK } from '../src/rink';
import { createRng } from '../src/rng';
import type { PlayerDef } from '../src/types';
import { assistsWhenTouched, blockAttempt, count, def, defs, g, setup, share, shareOf, simulateUntilFirstGoal, stateWith, sum } from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

const base = { goalie: g(70), lateralMiss: 0.2, shotSpeed: 32, distance: 12, screened: false, goalieMovingSpeed: 0, height: 0.4 };

/** Where `n` shots by home C (`d`) from (x, y) cross the attacked goal line (y), and how hard each was lifted (vz). */
function shotsFrom(d: PlayerDef, x: number, y: number, n: number): { y: number; vz: number }[] {
  const out: { y: number; vz: number }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const st = stateWith({ carrier: 'home', puckX: x, puckY: y, carrierSlot: 'C' });
    for (const s of st.skaters) if (s.side === 'away') s.pos = { x: -20, y: s.pos.y };
    const ds = new Map(defs); ds.set('home-C', { ...d, id: 'home-C', position: 'C' });
    executeShot(st, 'home-C', ds, createRng(seed));
    const p = st.puck, t = (RINK.goalLineX - p.pos.x) / p.vel.x;
    out.push({ y: p.pos.y + p.vel.y * t, vz: p.vz });
  }
  return out;
}

describe('shots', () => {
  it('a few shots miss the net outright, more for a poor shooter; neither always nor never', () => {
    const wide = (d: PlayerDef) => shareOf(shotsFrom(d, 15, 0, 1500), (s) => Math.abs(s.y) > RINK.netHalfWidth + 0.1);
    const good = wide(def({ shootingAccuracy: 92 })), poor = wide(def({ shootingAccuracy: 40 }));
    expect(poor).toBeGreaterThan(good + 0.05); expect(good).toBeGreaterThan(0.03); expect(poor).toBeLessThan(0.6);
  });
  it('a shot from right beside the net is not launched skyward', () => {
    for (const s of shotsFrom(def({}), RINK.goalLineX - 0.4, 1.1, 300)) expect(s.vz).toBeLessThanOrEqual(10);
  });
});

describe('goalies, saves, goals', () => {
  it('better goalies save more, never everything', () => { expect(saveChance({ ...base, goalie: g(95) })).toBeGreaterThan(saveChance({ ...base, goalie: g(50) }) + 0.03); expect(saveChance({ ...base, goalie: g(100), distance: 50 })).toBeLessThanOrEqual(0.97); });
  it('being out of position, screens, speed and close range all hurt', () => {
    for (const worse of [{ lateralMiss: 0.9 }, { screened: true }, { shotSpeed: 42 }, { distance: 4 }, { goalieMovingSpeed: 4 }]) expect(saveChance({ ...base, ...worse })).toBeLessThan(saveChance(base));
  });
  it('an open net is nearly always a goal but a set goalie on a point shot nearly always saves', () => { expect(saveChance({ ...base, lateralMiss: 1.6 })).toBeLessThan(0.2); expect(saveChance({ ...base, distance: 18, lateralMiss: 0.05 })).toBeGreaterThan(0.95); });
  it('goals credit scorer, assists and plus/minus', () => {
    const r = simulateUntilFirstGoal(setup(11)); const goal = r.events.find(e => e.type === 'goal')!;
    expect(goal.playerId).not.toBeNull(); expect(goal.assistIds.length).toBeLessThanOrEqual(2); expect(goal.assistIds).not.toContain(goal.playerId);
    expect(sum(r.players.map(p => p.plusMinus))).toBe(0); expect(r.players.find(p => p.id === goal.playerId)!.goals).toBe(1);
  }, GAME_TIMEOUT);
  it('only touches within about 10 s of the goal earn an assist', () => {
    expect(assistsWhenTouched(4)).toEqual(['home-LW']);
    expect(assistsWhenTouched(12)).toEqual([]);
  });
  it('a goalie\'s night moves his save chance, and each game draws its own', () => {
    expect(saveChance({ ...base, distance: 6, night: 0.5 })).toBeGreaterThan(saveChance({ ...base, distance: 6 }));
    expect(saveChance({ ...base, distance: 6, night: -0.5 })).toBeLessThan(saveChance({ ...base, distance: 6 }));
    const nights = [1, 2, 3].map((s) => createGame(setup(s)).state.goalieNight);
    expect(new Set(nights.map((n) => n.home)).size).toBe(3);
    expect(createGame(setup(1)).state.goalieNight).toEqual(nights[0]);
  });
  it('shot blockers block more', () => { expect(share(3000, () => blockAttempt(def({ shotBlocking: 92 })))).toBeGreaterThan(share(3000, () => blockAttempt(def({ shotBlocking: 40 }))) + 0.15); });
  it('shots, saves and goals reconcile', () => { const r = simulateGame(setup(4)); expect(r.team.home.shots).toBe(count(r, 'save', 'away') + r.score.home); }, GAME_TIMEOUT);
  describe('every goal and shot is credited (seeds 1 to 8)', () => {
    const results: GameResult[] = [];
    const games = (): GameResult[] => { if (results.length === 0) for (let seed = 1; seed <= 8; seed++) results.push(simulateGame(setup(seed))); return results; };
    const sideOf = (s: ReturnType<typeof setup>, id: string | null) => (s.home.players.some(p => p.id === id) ? 'home' : s.away.players.some(p => p.id === id) ? 'away' : null);
    it('every goal and shot names a player of its own side', () => {
      const bad: string[] = [];
      games().forEach((r, i) => { const s = setup(i + 1); for (const e of r.events) if ((e.type === 'goal' || e.type === 'shot') && (e.playerId === null || sideOf(s, e.playerId) !== e.side)) bad.push(`seed ${i + 1} tick ${e.tick} ${e.type} ${e.playerId}`); });
      expect(bad).toEqual([]);
    }, GAME_TIMEOUT * 8);
    it('player goals add up to the score, and shots reconcile for both sides', () => {
      games().forEach((r, i) => {
        const s = setup(i + 1);
        for (const side of ['home', 'away'] as const) {
          const other = side === 'home' ? 'away' : 'home';
          const ids = new Set(s[side].players.map(p => p.id));
          expect(sum(r.players.filter(p => ids.has(p.id)).map(p => p.goals))).toBe(r.score[side]);
          expect(r.team[side].shots).toBe(count(r, 'save', other) + r.score[side]);
        }
      });
    }, GAME_TIMEOUT * 8);
    it('every goal is immediately preceded by a shot by the same player', () => {
      const bad: string[] = [];
      for (const r of games()) r.events.forEach((e, k) => { if (e.type !== 'goal') return; const prev = r.events[k - 1]; if (!prev || prev.type !== 'shot' || prev.playerId !== e.playerId) bad.push(`tick ${e.tick}`); });
      expect(bad).toEqual([]);
    }, GAME_TIMEOUT * 8);
  });
});
