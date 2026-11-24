import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
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

describe('A1: commitment (Task 3)', () => {
  it('A1: targets are held: under 10% of spot ticks see the target move (was 39%)', () => { expect(m().retargetShare).toBeLessThan(0.10); }, 60_000);
  it('A1: more gliding and more top speed than before: glide over 30% (was 25%), top speed over 17% (was 14%), sprints over 1.2 s (was 0.8)', () => {
    expect(m().glideShare).toBeGreaterThan(0.30); expect(m().topSpeedShare).toBeGreaterThan(0.17); expect(m().sprintRunSeconds).toBeGreaterThan(1.2);
  }, 60_000);
  it('A1: skaters never overlap a goalie, and a race win never moves the puck to the winner', () => { expect(counters().goalieOverlapTicks).toBe(0); expect(counters().raceJumpTicks).toBe(0); }, 60_000);
  it('A1: players hold up at the blue line: under 14 offsides a game on seeds 1, 2, 3 and 8 (12 to 18 after Task 2)', () => {
    const offsides = (r: GameResult): number => r.events.filter((e) => e.type === 'offside').length;
    const total = games().reduce((a, r) => a + offsides(r), 0) + offsides(simulateGame(gameSetup(8)));
    // Tasks 5-6 tighten this to under 10 (carrier decisions at the line); see task-3-report.md
    expect(total / 4).toBeLessThan(14);
  }, 60_000);
});

describe('A2: every player has a job (Task 4)', () => {
  it('A2: no two skaters of a team ever hold the same job', () => { expect(counters().duplicateJobTicks).toBe(0); }, 60_000);
  it('A2: standing still is under 9% of a skater\'s live time (was 17.5%)', () => { expect(m().stationaryShare).toBeLessThan(0.09); }, 60_000);
  it('A2: at least two attackers are open in over 50% of offensive-zone time (was 40%)', () => { expect(m().twoOpenShare).toBeGreaterThan(0.50); }, 60_000);
  it('A2: the most dangerous option is shadowed in 60% to 90% of it (was 76%)', () => { expect(m().dangerShadowedShare).toBeGreaterThan(0.60); expect(m().dangerShadowedShare).toBeLessThan(0.90); }, 60_000);
  it('A2: the net-front defender is between his man and the net in over 85% of the time he has one', () => { const c = counters(); expect(c.netFrontDefenderBetween / c.netFrontDefenderTicks).toBeGreaterThan(0.85); }, 60_000);
  it('A2: the side with the puck skates forward: under 3% of its time backward', () => { expect(m().backwardShareWithPuck).toBeLessThan(0.03); }, 60_000);
});
