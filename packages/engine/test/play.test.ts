import { describe, it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { gameSetup } from './helpers';
import { countGames, measureGames } from './measures';
import type { GameResult } from '../src/types';
import type { PlayCounters, PlayMeasures } from './measures';

/** Whole-game behaviour on seeds 1, 2, 3 (each played once per file): the guard rails every task keeps, and each task's numbers. */
function lazy<T>(f: () => T): () => T { let v: { x: T } | null = null; return () => (v ??= { x: f() }).x; }

const games = lazy((): GameResult[] => [1, 2, 3].map((seed) => simulateGame(gameSetup(seed))));
const m = lazy((): PlayMeasures => measureGames([1, 2, 3]));
/** The three games' counters added up. */
const counters = lazy((): PlayCounters => countGames([1, 2, 3]));

describe('guard rails', () => {
  it('three games complete with 1 to 5 goals a team on average and no NaN', () => {
    const goals = games().reduce((a, r) => a + r.score.home + r.score.away, 0) / 6;
    expect(goals).toBeGreaterThanOrEqual(1); expect(goals).toBeLessThanOrEqual(5);
    expect(JSON.stringify(games())).not.toMatch(/NaN/);
  }, 60_000);
  it('every measure is a finite number, shares within 0 to 1', () => {
    for (const [k, v] of Object.entries(m())) { expect(Number.isFinite(v), k).toBe(true); if (k.endsWith('Share') || k === 'passCompletion' || k === 'pointPassCompletion') { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  }, 60_000);
  it('the observer sees live play: skater ticks, passes and attempts in every game set', () => {
    const c = counters();
    expect(c.liveTicks).toBeGreaterThan(3 * 50_000); expect(c.skaterTicks).toBeGreaterThan(c.liveTicks); expect(c.passes).toBeGreaterThan(0); expect(c.attempts).toBeGreaterThan(0);
  }, 60_000);
});
