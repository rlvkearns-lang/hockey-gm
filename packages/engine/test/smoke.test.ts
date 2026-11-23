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
    expect(count(r, 'save') + goals).toBe(r.team.home.shots + r.team.away.shots);
  }, 20_000);
});
