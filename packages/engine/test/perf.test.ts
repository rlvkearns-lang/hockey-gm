import { it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { gameSetup } from './helpers';

/**
 * The best (fastest) of five full games, so the number does not depend on what else the machine is running.
 * `npm run test` runs this file on its own, after the rest of the suite.
 */
it('a game runs within budget', () => {
  const ms: number[] = [];
  for (let seed = 1; seed <= 5; seed++) {
    const t = performance.now();
    simulateGame(gameSetup(seed));
    ms.push(performance.now() - t);
  }
  console.log(ms.map(Math.round).join(" ")); expect(Math.min(...ms)).toBeLessThan(2500);
}, 60_000);
