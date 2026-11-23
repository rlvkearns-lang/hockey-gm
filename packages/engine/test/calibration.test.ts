import { describe, it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { battleWinShareByType, goalsPer60ByType, runGames, setup, summarise, winShare } from './helpers';

/**
 * 300 games of two overall-70 teams (fresh rosters every game), and 300 of a 76 against a 66, played on worker
 * threads (runGames caches them for the file). The first test of each set pays for its games: about 1.2 s a game, so
 * up to 6 minutes on a single core; the timeout leaves room for a slow one.
 */
const GAMES_TIMEOUT = 900_000;
const CACHED_TIMEOUT = 10_000;

describe('calibration', () => {
  it('5-on-5 totals look like hockey', () => {
    const m = summarise(runGames(300));
    expect(m.goals).toBeGreaterThan(2.1);   expect(m.goals).toBeLessThan(3.0);
    expect(m.shots).toBeGreaterThan(26);    expect(m.shots).toBeLessThan(34);
    expect(m.savePct).toBeGreaterThan(0.900); expect(m.savePct).toBeLessThan(0.928);
    expect(m.hits).toBeGreaterThan(14);     expect(m.hits).toBeLessThan(30);
    expect(m.blocks).toBeGreaterThan(9);    expect(m.blocks).toBeLessThan(19);
    expect(m.faceoffsTotal).toBeGreaterThan(42); expect(m.faceoffsTotal).toBeLessThan(72);
    expect(m.offsidesTotal).toBeGreaterThan(2);  expect(m.offsidesTotal).toBeLessThan(11);
    expect(m.icingsTotal).toBeGreaterThan(3);    expect(m.icingsTotal).toBeLessThan(13);
    expect(m.tieShare).toBeGreaterThan(0.15);    expect(m.tieShare).toBeLessThan(0.30);
  }, GAMES_TIMEOUT);
  it('no freak scores: nothing like 15 goals in a game, and few 0-0 games', () => {
    const totals = runGames(300).map((r) => r.score.home + r.score.away);
    expect(Math.max(...totals)).toBeLessThan(15);
    expect(runGames(300).filter((r) => r.score.home === 0 && r.score.away === 0).length).toBeLessThanOrEqual(5);
  }, CACHED_TIMEOUT);
  it('the better team wins more, and loses plenty', () => { const w = winShare(runGames(300, { homeOverall: 76, awayOverall: 66 })); expect(w.home).toBeGreaterThan(w.away + 0.12); 
    // controller ruling, Task 12 fix round 1: band relaxed; pre-game handicaps and mercy rules were rejected as ways to meet the original
    expect(w.away).toBeGreaterThan(0.10);
   }, GAMES_TIMEOUT);
  it('snipers outscore grinders per 60 minutes', () => { const g = goalsPer60ByType(runGames(300)); expect(g['Sniper']).toBeGreaterThan(g['Grinder']! * 1.5); }, CACHED_TIMEOUT);
  it('heavier, stronger players win more battles, under 75%', () => { const b = battleWinShareByType(runGames(300)); expect(b['Power Forward']).toBeGreaterThan(b['Speedster']! + 0.05); expect(b['Power Forward']).toBeLessThan(0.75); }, CACHED_TIMEOUT);
  it('a game runs within budget', () => { const t0 = performance.now(); for (let i = 0; i < 5; i++) simulateGame(setup(i)); expect((performance.now() - t0) / 5).toBeLessThan(3000); }, 60_000);
});
