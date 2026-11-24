import { describe, it, expect } from 'vitest';
import { createGame } from '../src/game';
import { gameSetup } from './helpers';
import { countGames, measureGames } from './measures';
import type { GameResult, GameState } from '../src/types';
import type { PlayCounters, PlayMeasures } from './measures';

/** Whole-game behaviour on seeds 1, 2, 3 (each played once per file): the guard rails every task keeps, and each task's numbers. */
function lazy<T>(f: () => T): () => T { let v: { x: T } | null = null; return () => (v ??= { x: f() }).x; }

/** Each game's result and its final state (createGame stepped to the end, as simulateGame does). */
const played = lazy((): { result: GameResult; state: GameState }[] => [1, 2, 3].map((seed) => {
  const g = createGame(gameSetup(seed));
  while (!g.done) g.step();
  return { result: g.result(), state: g.state };
}));
const games = (): GameResult[] => played().map((p) => p.result);

/** Paths (like `events[12].pos.x`) of every number in `v` that is not finite (NaN or +-Infinity). */
function nonFinite(v: unknown, path = '$', out: string[] = []): string[] {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(path); }
  else if (Array.isArray(v)) v.forEach((x, i) => nonFinite(x, `${path}[${i}]`, out));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) nonFinite(x, `${path}.${k}`, out);
  return out;
}
const m = lazy((): PlayMeasures => measureGames([1, 2, 3]));
/** The three games' counters added up. */
const counters = lazy((): PlayCounters => countGames([1, 2, 3]));

describe('guard rails', () => {
  it('three games complete with 1 to 5 goals a team on average and no NaN or Infinity anywhere in the result or final state', () => {
    const goals = games().reduce((a, r) => a + r.score.home + r.score.away, 0) / 6;
    expect(goals).toBeGreaterThanOrEqual(1); expect(goals).toBeLessThanOrEqual(5);
    for (const p of played()) { expect(nonFinite(p.result)).toEqual([]); expect(nonFinite(p.state)).toEqual([]); }
  }, 60_000);
  it('the no-NaN check finds NaN and Infinity wherever they are', () => {
    expect(nonFinite({ score: { home: 1, away: 2 }, events: [{ pos: { x: 1, y: 2 }, detail: { speed: 3 } }] })).toEqual([]);
    expect(nonFinite({ events: [{ pos: { x: NaN, y: 0 } }] })).toEqual(['$.events[0].pos.x']);
    expect(nonFinite({ players: [{ toi: 1 }, { toi: Infinity }], detail: { v: -Infinity } })).toEqual(['$.players[1].toi', '$.detail.v']);
  });
  it('every measure is a finite number, shares within 0 to 1', () => {
    for (const [k, v] of Object.entries(m())) { expect(Number.isFinite(v), k).toBe(true); if (k.endsWith('Share') || k === 'passCompletion' || k === 'pointPassCompletion') { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  }, 60_000);
  it('the observer sees live play: skater ticks, passes and attempts in every game set', () => {
    const c = counters();
    expect(c.liveTicks).toBeGreaterThan(3 * 50_000); expect(c.skaterTicks).toBeGreaterThan(c.liveTicks); expect(c.passes).toBeGreaterThan(0); expect(c.attempts).toBeGreaterThan(0);
  }, 60_000);
});
