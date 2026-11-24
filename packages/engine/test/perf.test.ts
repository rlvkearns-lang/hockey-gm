import { it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { gameSetup } from './helpers';

it('a game runs within budget', () => {
  const ms: number[] = [];
  for (let seed = 1; seed <= 3; seed++) {
    const t = performance.now();
    simulateGame(gameSetup(seed));
    ms.push(performance.now() - t);
  }
  expect(ms.reduce((a, b) => a + b, 0) / ms.length).toBeLessThan(2500);
}, 30_000);
