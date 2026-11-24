import { describe, it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { count, setup } from './helpers';

/** One tuned game, quickly: the full calibration bands live in `npm run test:calibration`. */
describe('tuned engine smoke check', () => {
  it('a full game produces a hockey-shaped box score', () => {
    const r = simulateGame(setup(2));
    const goals = r.score.home + r.score.away;
    expect(goals).toBeLessThan(15);
    for (const side of ['home', 'away'] as const) {
      expect(r.team[side].shots).toBeGreaterThan(12); expect(r.team[side].shots).toBeLessThan(55);
      expect(r.team[side].hits).toBeGreaterThan(3); expect(r.team[side].hits).toBeLessThan(60);
    }
    expect(count(r, 'faceoff')).toBeGreaterThan(25); expect(count(r, 'faceoff')).toBeLessThan(100);
    // A goal with releaseTick null went in with no shot (no shot on goal: Task 7 review).
    const shotGoals = r.events.filter((e) => e.type === 'goal' && e.detail.releaseTick !== null).length;
    expect(count(r, 'save') + shotGoals).toBe(r.team.home.shots + r.team.away.shots);
  }, 20_000);
});
