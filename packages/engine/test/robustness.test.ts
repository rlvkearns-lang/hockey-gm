import { describe, it, expect } from 'vitest';
import { DT } from '../src/constants';
import { createGame, simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { playersOf, setup, sum } from './helpers';

/** Whole-game tests take about 1.3 s each; this leaves room for a loaded machine. */
const GAMES_TIMEOUT = 180_000;

describe('robustness', () => {
  it('the puck is never left alone', () => {
    for (let seed = 0; seed < 30; seed++) { const g = createGame(setup(seed)); let idle = 0, last = '';
      while (!g.done) { g.step(); const s = g.state; const key = s.carrierId + '|' + (s.lastTouch?.id ?? '');
        if (s.phase !== 'live' || key !== last || s.contests.length > 0) idle = 0; else idle += DT; last = key; expect(idle).toBeLessThan(15); } }
  }, GAMES_TIMEOUT);
  it('a hopeless mismatch still plays like a game', () => {
    const r = simulateGame({ ...setup(1), home: generateTeam(1, 'A', 'A', 95), away: generateTeam(2, 'B', 'B', 10) });
    expect(r.score.home + r.score.away).toBeLessThanOrEqual(20); expect(r.team.away.shots).toBeGreaterThan(3); expect(sum(playersOf(r, 'away').map(p => p.battlesWon))).toBeGreaterThan(0);
  }, 20_000);
  it('no NaN ever reaches the result', () => { for (let s = 0; s < 30; s++) expect(JSON.stringify(simulateGame(setup(s)))).not.toMatch(/NaN|null,null/); }, GAMES_TIMEOUT);
});
