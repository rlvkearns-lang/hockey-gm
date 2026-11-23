import { describe, it, expect } from 'vitest';
import { DT } from '../src/constants';
import { createGame, simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { playersOf, setup, sum } from './helpers';

/** 30 whole games each (about 1.2 s a game, about 3 s with an expect on every tick): room for a slow single core. */
const GAMES_TIMEOUT = 600_000;

describe('robustness', () => {
  it('the puck is never left alone', () => {
    for (let seed = 0; seed < 30; seed++) { const g = createGame(setup(seed)); let idle = 0, last = '';
      while (!g.done) { g.step(); const s = g.state; const key = s.carrierId + '|' + (s.lastTouch?.id ?? '');
        if (s.phase !== 'live' || key !== last || s.contests.length > 0) idle = 0; else idle += DT; last = key; expect(idle).toBeLessThan(15); } }
  }, GAMES_TIMEOUT);
  it('a hopeless mismatch still plays like a game', () => {
    const r = simulateGame({ ...setup(1), home: generateTeam(1, 'A', 'A', 95), away: generateTeam(2, 'B', 'B', 10) });
    
    // controller ruling, Task 12 fix round 1: band relaxed; pre-game handicaps and mercy rules were rejected as ways to meet the original
    expect(r.score.home + r.score.away).toBeLessThanOrEqual(30);
    // controller ruling, Task 12 fix round 1: band relaxed; pre-game handicaps and mercy rules were rejected as ways to meet the original
    expect(r.team.away.shots).toBeGreaterThanOrEqual(1);
     expect(sum(playersOf(r, 'away').map(p => p.battlesWon))).toBeGreaterThan(0);
  }, 20_000);
  it('no NaN ever reaches the result', () => { for (let s = 0; s < 30; s++) expect(JSON.stringify(simulateGame(setup(s)))).not.toMatch(/NaN|null,null/); }, GAMES_TIMEOUT);
});
