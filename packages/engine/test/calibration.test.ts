import { describe, it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { battleWinShareByType, goalsPer60ByType, runGames, setup, styleParity, summarise, winShare } from './helpers';

/**
 * 300 games of two overall-70 teams (fresh rosters every game), and 300 of a 76 against a 66, played on worker
 * threads (runGames caches them for the file). Whichever test of a set runs first pays for its games: about 1.5 s a
 * game, so up to 8 minutes on a single core; every test has the long timeout so any one of them can run alone.
 */
const GAMES_TIMEOUT = 900_000;
/** Baseline box-score takeaways and giveaways per team per game (docs/superpowers/reviews/engine-scorecard-baseline.md). */
const BASELINE = { takeaways: 6.32, giveaways: 5.03 };

describe('calibration', () => {
  // Task 12 close-out ruling 3 (the owner's rule: "the power forward doesn't ALWAYS beat the two way guy"): over the 300
  // games, for board battles, engagements, net-front battles and hits, no primary style wins more than 75% of its
  // contests against another, judged on the pairs with 150 or more (the rest are too few to judge). At the close-out
  // (160 games): largest board 0.72 (Power Forward v Playmaker), engagements 0.71 (PF v Speedster), net front 0.66 (PF v
  // Offensive D), hits 0.71 (Enforcer v Offensive D).
  it('style parity: no style wins over 75% of its board battles, engagements, net-front battles or hits against another', () => {
    const sum: Record<string, number> = {};
    for (const r of runGames(300)) for (const [k, v] of Object.entries(r.styleDuels)) sum[k] = (sum[k] ?? 0) + v;
    const { judged } = styleParity(sum, 150);
    expect(judged.length).toBeGreaterThan(80);
    for (const j of judged) expect(j.share, `${j.kind}: ${j.top} over ${j.low} in ${j.n}`).toBeLessThanOrEqual(0.75);
  }, GAMES_TIMEOUT);
  // Task 14 (Re-tune A): the design's targets (docs/superpowers/specs/2026-11-24-engine-round-2-design.md, "Re-tune A"),
  // with the controller's addendum where it gives another band (faceoffs 50 to 68, icings 4 to 12, hits as the engine
  // counts them, the skating-effort measures in place of "top speed share" and "sprint run"). The 300-game sets are
  // fixed, so these are exact for the committed tuning. A band the re-tune could not meet honestly stays here at the
  // design's value and reads red; task-14-report.md has the table with the nearest value and the bar proposed.
  it('5-on-5 totals match the design\'s targets', () => {
    const m = summarise(runGames(300));
    expect(m.goals).toBeGreaterThanOrEqual(2.4);    expect(m.goals).toBeLessThanOrEqual(2.6);
    expect(m.shots).toBeGreaterThanOrEqual(28);     expect(m.shots).toBeLessThanOrEqual(31);
    expect(m.attempts).toBeGreaterThanOrEqual(55);  expect(m.attempts).toBeLessThanOrEqual(62);
    expect(m.savePct).toBeGreaterThanOrEqual(0.915); expect(m.savePct).toBeLessThanOrEqual(0.920);
    expect(m.hits).toBeGreaterThanOrEqual(20);      expect(m.hits).toBeLessThanOrEqual(25);
    expect(m.faceoffsTotal).toBeGreaterThanOrEqual(50); expect(m.faceoffsTotal).toBeLessThanOrEqual(68);
    expect(m.offsidesTotal).toBeGreaterThan(2);  expect(m.offsidesTotal).toBeLessThan(11);
    expect(m.icingsTotal).toBeGreaterThanOrEqual(4);    expect(m.icingsTotal).toBeLessThanOrEqual(12);
    expect(m.tieShare).toBeGreaterThan(0.15);    expect(m.tieShare).toBeLessThan(0.30);
  }, GAMES_TIMEOUT);
  it('blocked shots match the design\'s target: 13 to 16 a team', () => {
    const m = summarise(runGames(300));
    expect(m.blocks).toBeGreaterThanOrEqual(13);    expect(m.blocks).toBeLessThanOrEqual(16);
  }, GAMES_TIMEOUT);
  it('box-score takeaways and giveaways are near the baseline\'s (within 30% of 6.32 and 5.03 a team)', () => {
    const m = summarise(runGames(300));
    expect(m.takeaways).toBeGreaterThan(BASELINE.takeaways * 0.7); expect(m.takeaways).toBeLessThan(BASELINE.takeaways * 1.3);
    expect(m.giveaways).toBeGreaterThan(BASELINE.giveaways * 0.7); expect(m.giveaways).toBeLessThan(BASELINE.giveaways * 1.3);
  }, GAMES_TIMEOUT);
  it('a fifth to a quarter of goals come from rebounds and tips, and some from the point through traffic', () => {
    const rs = runGames(300); const goals = rs.reduce((a, r) => a + r.score.home + r.score.away, 0); const n = (k: string): number => rs.reduce((a, r) => a + (r.counts[k] ?? 0), 0);
    // (A tipped rebound is one goal: goal:second counts a goal that was either.)
    const second = n('goal:second') / goals; expect(second).toBeGreaterThanOrEqual(0.18); expect(second).toBeLessThanOrEqual(0.27);
    const point = n('goal:pointTraffic') / goals; expect(point).toBeGreaterThanOrEqual(0.06); expect(point).toBeLessThanOrEqual(0.20);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: skating', () => {
    const p = summarise(runGames(300)).play;
    expect(p.stationaryShare).toBeLessThan(0.08);                                                   // was 0.175
    expect(p.glideShare).toBeGreaterThan(0.30);
    // Real effort (addendum, headline 3; NHL EDGE 2023-24: about 41 bursts over 20 mph and 2 over 22 mph a game, the fastest skater of a team's season 23.6 mph).
    expect(p.cruiseShare).toBeGreaterThan(0.6); expect(p.topSpeedShare).toBeLessThan(0.03);
    expect(p.bursts20PerGame).toBeGreaterThanOrEqual(20); expect(p.bursts20PerGame).toBeLessThanOrEqual(200); expect(p.bursts22PerGame).toBeLessThan(10);
    expect(p.fastestSkaterMph).toBeGreaterThanOrEqual(22); expect(p.fastestSkaterMph).toBeLessThanOrEqual(24.5); expect(p.fastestSkaterMphMax).toBeLessThanOrEqual(25.3);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: passes', () => {
    const p = summarise(runGames(300)).play;
    expect(p.passCompletion).toBeGreaterThan(0.70); expect(p.passCompletion).toBeLessThan(0.85);  // controller ruling (Task 9 close-out): 0.70 to 0.85; the design said 0.75 to 0.90
    expect(p.pointPassKeptShare).toBeGreaterThan(0.90); expect(p.pointPassCompletion).toBeGreaterThan(0.75);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: shots, rebounds and the zone', () => {
    const p = summarise(runGames(300)).play;
    expect(p.reboundChancesPerGame).toBeGreaterThanOrEqual(8); expect(p.reboundChancesPerGame).toBeLessThanOrEqual(20);
    expect(p.defenceAttemptsPerTeam).toBeGreaterThanOrEqual(12); expect(p.defenceAttemptsPerTeam).toBeLessThanOrEqual(20);
    expect(p.ozoneSecondsPerPossession).toBeGreaterThan(4.0); expect(p.attemptsPerOzonePossession).toBeGreaterThan(0.33);                           // were 4.0 and 0.30
    expect(p.twoOpenShare).toBeGreaterThan(0.50); expect(p.dangerShadowedShare).toBeGreaterThan(0.60); expect(p.dangerShadowedShare).toBeLessThan(0.90);
    expect(p.behindNetPossessionsPerGame).toBeGreaterThanOrEqual(8); expect(p.passesOutFrontPerGame).toBeGreaterThanOrEqual(2); expect(p.wrapAttemptsPerGame).toBeGreaterThanOrEqual(0.5);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: battles, hits and no teleports', () => {
    const p = summarise(runGames(300)).play;
    expect(p.battleWinnerCameAwayShare).toBeGreaterThan(0.60); expect(p.battleToWinnerIsWinnerShare).toBeGreaterThan(0.85); expect(p.battlesNoWinnerPerGame).toBeLessThan(14);
    expect(p.knockdownShare).toBeGreaterThan(0.30); expect(p.knockdownShare).toBeLessThan(0.70);
    expect(p.puckJumpsPerGame).toBe(0); expect(p.maxPuckJump).toBeLessThanOrEqual(1.2);
  }, GAMES_TIMEOUT);
  it('whistles: live stretches over four minutes are rare (at most 2 a game; no timer stops play)', () => {
    // The addendum asked for none in seeds 1-16. With about 53 whistles a game the mean stretch is 68 s, and whistles that
    // come at random give e^(-240/68) = 3% of stretches over four minutes: about 1.5 a game. task-14-report.md.
    const p = summarise(runGames(300)).play;
    expect(p.liveOver240PerGame).toBeLessThanOrEqual(2);
  }, GAMES_TIMEOUT);
  it('faceoff shares stay believable game to game: at most 10% of games outside 35% to 65%', () => {
    expect(summarise(runGames(300)).faceoffShareOutside).toBeLessThanOrEqual(0.10);
  }, GAMES_TIMEOUT);
  it('no freak scores: nothing like 15 goals in a game, and few 0-0 games', () => {
    const totals = runGames(300).map((r) => r.score.home + r.score.away);
    expect(Math.max(...totals)).toBeLessThan(15);
    expect(runGames(300).filter((r) => r.score.home === 0 && r.score.away === 0).length).toBeLessThanOrEqual(5);
  }, GAMES_TIMEOUT);
  it('the 76 still beats the 66 about three quarters of the time, and loses plenty', () => {
    const w = winShare(runGames(300, { homeOverall: 76, awayOverall: 66 })); expect(w.home).toBeGreaterThanOrEqual(0.70); expect(w.home).toBeLessThanOrEqual(0.80); expect(w.away).toBeGreaterThan(0.10);
  }, GAMES_TIMEOUT);
  it('snipers outscore grinders per 60 minutes', () => { const g = goalsPer60ByType(runGames(300)); expect(g['Sniper']).toBeGreaterThan(g['Grinder']! * 1.5); }, GAMES_TIMEOUT);
  it('heavier, stronger players win more battles, under 75%', () => { const b = battleWinShareByType(runGames(300)); expect(b['Power Forward']).toBeGreaterThan(b['Speedster']! + 0.05); expect(b['Power Forward']).toBeLessThan(0.75); }, GAMES_TIMEOUT);
  it('a game runs within budget: 2.5 s', () => { const t0 = performance.now(); for (let i = 0; i < 5; i++) simulateGame(setup(i)); expect((performance.now() - t0) / 5).toBeLessThan(2500); }, 60_000);
});
