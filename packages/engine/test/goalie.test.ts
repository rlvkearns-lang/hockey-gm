import { describe, it, expect } from 'vitest';
import { saveChance } from '../src/goalie';
import { simulateGame } from '../src/game';
import { blockAttempt, count, def, g, setup, share, simulateUntilFirstGoal, sum } from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

const base = { goalie: g(70), lateralMiss: 0.2, shotSpeed: 32, distance: 12, screened: false, goalieMovingSpeed: 0, height: 0.4 };

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
  it('shot blockers block more', () => { expect(share(3000, () => blockAttempt(def({ shotBlocking: 92 })))).toBeGreaterThan(share(3000, () => blockAttempt(def({ shotBlocking: 40 }))) + 0.15); });
  it('shots, saves and goals reconcile', () => { const r = simulateGame(setup(4)); expect(r.team.home.shots).toBe(count(r, 'save', 'away') + r.score.home); }, GAME_TIMEOUT);
});
