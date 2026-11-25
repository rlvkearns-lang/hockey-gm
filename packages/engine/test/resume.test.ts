import { describe, it, expect } from 'vitest';
import { createGame, restoreGame, simulateGame, type Game } from '../src/game';
import type { GameEvent, GameResult, GameState } from '../src/types';
import { gameSetup } from './helpers';

const GAME_TIMEOUT = 60_000;
const setup = (seed = 11) => gameSetup(seed);

/** Steps `g` until `pred` holds after a step (at or after tick `from`); fails if the game ends first. */
function stepUntil(g: Game, from: number, pred: (s: GameState) => boolean): number {
  while (!g.done) {
    g.step();
    if (g.state.tick >= from && pred(g.state)) return g.state.tick;
  }
  throw new Error('game ended before the condition held');
}

/** A snapshot as a viewer or server would keep it: plain JSON, nothing shared with the running game. */
const snapshot = (g: Game): { state: GameState; events: GameEvent[] } =>
  JSON.parse(JSON.stringify({ state: g.state, events: g.result().events })) as { state: GameState; events: GameEvent[] };

function finish(g: Game): GameResult {
  while (!g.done) g.step();
  return g.result();
}

describe('resuming a game from a snapshot', () => {
  const straights = new Map<number, GameResult>();
  const straightOf = (seed: number): GameResult => { let r = straights.get(seed); if (!r) { r = simulateGame(setup(seed)); straights.set(seed, r); } return r; };
  // [name, condition, from tick, seed (default 11)]. Task 10: after engagements, seed 11 has no tipped shot and no shot
  // past the goalie after tick 10,000, so those two cases are read on seed 12.
  const cases: [string, (s: GameState) => boolean, number, number?][] = [
    ['the first tick', () => true, 0],
    ['mid-contest (a contest past its first stage)', (s) => s.contests.some((c) => c.stageT > 0.2 && c.stage !== 'close' && c.stage !== 'reach' && c.stage !== 'race'), 9_000],
    ['mid-board-battle', (s) => s.contests.some((c) => c.kind === 'boardBattle' && c.stage === 'dig'), 30_000],
    ['mid-line-change', (s) => s.bench.home.forwards.changing || s.bench.away.defence.changing, 40_000],
    ['with a shot in flight', (s) => s.shotInFlight !== null, 60_000],
    // Task 8: mid-flight past the goalie (a goal on its way in), with a rebound loose in front, mid-tip.
    ['with a shot past the goalie on its way in', (s) => s.shotInFlight !== null && s.shotInFlight.faced, 10_000, 12],
    ['with a rebound loose in front', (s) => s.lastSave !== null && s.lastSave.kind === 'rebound' && s.carrierId === null, 10_000],
    ['with a tipped shot in flight', (s) => s.shotInFlight !== null && s.shotInFlight.tippedBy !== null, 0, 12],
    // Task 8 fix round 2: mid-hold of a carrier's plan (a decision point not yet reached).
    ['mid-hold of a carrier\'s plan', (s) => s.carrierPlan !== null && s.carrierPlan.until !== undefined && s.carrierPlan.until - s.tick > 10 && s.tick - s.carrierPlan.tick > 3, 10_000],
    // Task 8b: mid-cooldown of the pressure trigger, the checker still on him.
    ['mid-cooldown of a carrier\'s pressure trigger', (s) => s.carrierPlan !== null && s.carrierPlan.checker != null && s.carrierPlan.pressUntil !== undefined && s.carrierPlan.pressUntil - s.tick > 5 && s.tick - s.carrierPlan.tick > 3, 10_000],
    // Task 7 review, Minor 4: a one-timer pass just taken.
    ['just after a one-timer pass was taken', (s) => s.oneTimerTaken !== null && s.tick - s.oneTimerTaken.tick <= 1, 10_000],
    ['while play is stopped', (s) => s.phase === 'stopped', 70_000],
    ['in the third period, a turnover being watched', (s) => s.period === 3 && s.turnoverWatch !== null, 80_000],
    ['mid-hold (a spot target issued under 0.2 s ago)', (s) => s.plans.some((p, i) => s.skaters[i]!.onIce && p.follow === 'spot' && s.tick - p.targetTick > 0 && s.tick - p.targetTick < 6), 20_000],
    // Task 10: mid-engagement, inside position taken, a draw or more in.
    ['mid-engagement', (s) => s.engagements.some((e) => s.tick - e.sinceTick > 15 && e.inside !== null), 25_000],
    ['with a phase change pending', (s) => s.teamPhase.home.pending !== null || s.teamPhase.away.pending !== null, 50_000],
    // Task 13b: a hard clear on its way, an opponent already passed by (his try is spent).
    ['with a hard clear on its way', (s) => s.hardClear !== null && s.hardClear.tried.length > 0, 20_000],
    ['mid-possession (a carrier plan with a seed, decided 1 to 4 ticks ago)', (s) => s.carrierPlan !== null && s.carrierPlan.seed !== undefined && s.tick - s.carrierPlan.tick >= 1 && s.tick - s.carrierPlan.tick <= 4, 30_000],
  ];
  for (const [name, when, from, seed = 11] of cases) {
    it(`restored ${name}, it plays out exactly as the straight run`, () => {
      const g = createGame(setup(seed));
      const straight = straightOf(seed);
      const k = stepUntil(g, from, when);
      const snap = snapshot(g);
      const resumed = restoreGame(setup(seed), snap.state, snap.events);
      expect(resumed.state.tick).toBe(k);
      expect(resumed.drainEvents()).toEqual([]); // events before the snapshot are not handed out again
      expect(finish(resumed)).toEqual(straight);
      expect(finish(g)).toEqual(straight); // the original, which the snapshot shares nothing with, is unaffected
    }, GAME_TIMEOUT);
  }
  it('the snapshot holds everything: the random stream and time on ice are in the state', () => {
    const g = createGame(setup());
    stepUntil(g, 5_000, () => true);
    expect(g.state.rng).toHaveLength(4);
    expect(g.state.skaters.every((s) => Number.isInteger(s.toiTicks))).toBe(true);
    expect(g.state.skaters.some((s) => s.toiTicks > 0)).toBe(true);
  }, GAME_TIMEOUT);
  it('a restored game rejects a state that does not belong to its setup', () => {
    const g = createGame(setup());
    g.step();
    const snap = snapshot(g);
    expect(() => restoreGame(gameSetup(12), snap.state, snap.events)).toThrow(/state/);
  });
});
