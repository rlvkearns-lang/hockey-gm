import { describe, it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { battleWinShareByType, goalsPer60ByType, runGames, setup, styleParity, summarise, winShare } from './helpers';

/**
 * 1,000 games of two overall-70 teams (fresh rosters every game; Task 14b, see EVEN), and 300 of a 76 against a 66, played on worker
 * threads (runGames caches them for the file). Whichever test of a set runs first pays for its games: about 1.5 s a
 * game, so up to 8 minutes on a single core; every test has the long timeout so any one of them can run alone.
 */
const GAMES_TIMEOUT = 1_800_000; // Task 14b: 1,000 games on four cores take about ten minutes
/** Baseline box-score takeaways and giveaways per team per game (docs/superpowers/reviews/engine-scorecard-baseline.md). */
const BASELINE = { takeaways: 6.32, giveaways: 5.03 };
/**
 * Task 14b (section 4; brief: "where the design's band is simply narrower than the noise at 300 games, pin the
 * calibration test on a larger fixed set"): the rates and shares read on 1,000 games of two overall-70 teams (bootstrap
 * standard errors at 300 games: goals 0.077, save % .0022, attempts 0.75, giveaways 0.11, defence attempts 0.24, rebound
 * chances 0.13 against bands 0.2, .005, 7, 3, 8 wide; the first 300 games read goals 2.30 and save % .9225 where the
 * 1,000 read 2.44 and .918 at the same commit). Counts and extremes that grow with the number of games (the largest
 * game, 0-0 games, puck jumps) and the style tables keep the first 300 of them (the same games runGames(300) would play).
 */
const EVEN = 1000;
const even = (): ReturnType<typeof runGames> => runGames(EVEN);
const even300 = (): ReturnType<typeof runGames> => runGames(EVEN).slice(0, 300);

describe('calibration', () => {
  // Task 12 close-out ruling 3 (the owner's rule: "the power forward doesn't ALWAYS beat the two way guy"): over the 300
  // games, for board battles, engagements, net-front battles and hits, no primary style wins more than 75% of its
  // contests against another, judged on the pairs with 150 or more (the rest are too few to judge). At the close-out
  // (160 games): largest board 0.72 (Power Forward v Playmaker), engagements 0.71 (PF v Speedster), net front 0.66 (PF v
  // Offensive D), hits 0.71 (Enforcer v Offensive D).
  it('style parity: no style wins over 75% of its board battles, engagements, net-front battles or hits against another', () => {
    const sum: Record<string, number> = {};
    for (const r of even300()) for (const [k, v] of Object.entries(r.styleDuels)) sum[k] = (sum[k] ?? 0) + v;
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
    const m = summarise(even());
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
  // Task 14b (controller ruling, section 3): 8 to 12 a team (the design's 13 to 16; it reads 9.5). The NHL's about 14.5
  // needs shot wind-ups, so that a lane can close between the choice and the release: carried to Part B.
  it('blocked shots: 8 to 12 a team (the design\'s 13 to 16 waits for shot wind-ups, Part B)', () => {
    const m = summarise(even());
    expect(m.blocks).toBeGreaterThanOrEqual(8);    expect(m.blocks).toBeLessThanOrEqual(12);
  }, GAMES_TIMEOUT);
  it('box-score takeaways and giveaways are near the baseline\'s (within 30% of 6.32 and 5.03 a team)', () => {
    const m = summarise(even());
    expect(m.takeaways).toBeGreaterThan(BASELINE.takeaways * 0.7); expect(m.takeaways).toBeLessThan(BASELINE.takeaways * 1.3);
    expect(m.giveaways).toBeGreaterThan(BASELINE.giveaways * 0.7); expect(m.giveaways).toBeLessThan(BASELINE.giveaways * 1.3);
  }, GAMES_TIMEOUT);
  it('a fifth to a quarter of goals come from rebounds and tips, and some from the point through traffic', () => {
    const rs = even(); const goals = rs.reduce((a, r) => a + r.score.home + r.score.away, 0); const n = (k: string): number => rs.reduce((a, r) => a + (r.counts[k] ?? 0), 0);
    // (A tipped rebound is one goal: goal:second counts a goal that was either.)
    const second = n('goal:second') / goals; expect(second).toBeGreaterThanOrEqual(0.18); expect(second).toBeLessThanOrEqual(0.27);
    const point = n('goal:pointTraffic') / goals; expect(point).toBeGreaterThanOrEqual(0.06); expect(point).toBeLessThanOrEqual(0.20);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: skating', () => {
    const p = summarise(even()).play;
    expect(p.stationaryShare).toBeLessThan(0.08);                                                   // was 0.175
    expect(p.glideShare).toBeGreaterThanOrEqual(0.22);  // Task 14b ruling (was 0.30): with real effort the cruise share below is the measure that matters
    // Real effort (addendum, headline 3; NHL EDGE 2023-24: about 41 bursts over 20 mph and 2 over 22 mph a game, the fastest skater of a team's season 23.6 mph).
    expect(p.cruiseShare).toBeGreaterThan(0.6); expect(p.topSpeedShare).toBeLessThan(0.03);
    expect(p.bursts20PerGame).toBeGreaterThanOrEqual(20); expect(p.bursts20PerGame).toBeLessThanOrEqual(200); expect(p.bursts22PerGame).toBeLessThan(10);
    expect(p.fastestSkaterMph).toBeGreaterThanOrEqual(22); expect(p.fastestSkaterMph).toBeLessThanOrEqual(24.5); expect(p.fastestSkaterMphMax).toBeLessThanOrEqual(25.3);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: passes', () => {
    const p = summarise(even()).play;
    expect(p.passCompletion).toBeGreaterThan(0.70); expect(p.passCompletion).toBeLessThan(0.85);  // controller ruling (Task 9 close-out): 0.70 to 0.85; the design said 0.75 to 0.90
    expect(p.pointPassKeptShare).toBeGreaterThan(0.90); expect(p.pointPassCompletion).toBeGreaterThanOrEqual(0.72);  // Task 14b ruling (was 0.75): passes not re-tuned for real effort
  }, GAMES_TIMEOUT);
  it('it looks like hockey: shots, rebounds and the zone', () => {
    const p = summarise(even()).play;
    // Task 14b ruling: rebound chances 3 to 8 a game (the design's 8 to 20 needs more net-front offence: Part B).
    expect(p.reboundChancesPerGame).toBeGreaterThanOrEqual(3); expect(p.reboundChancesPerGame).toBeLessThanOrEqual(8);
    expect(p.defenceAttemptsPerTeam).toBeGreaterThanOrEqual(12); expect(p.defenceAttemptsPerTeam).toBeLessThanOrEqual(20);
    // Task 14b rulings: attempts per offensive-zone possession 0.30 or more (was 0.33); two teammates open 0.44 or more (was 0.50).
    expect(p.ozoneSecondsPerPossession).toBeGreaterThan(4.0); expect(p.attemptsPerOzonePossession).toBeGreaterThanOrEqual(0.30);                           // were 4.0 and 0.30
    expect(p.twoOpenShare).toBeGreaterThanOrEqual(0.44); expect(p.dangerShadowedShare).toBeGreaterThan(0.60); expect(p.dangerShadowedShare).toBeLessThan(0.90);
    expect(p.behindNetPossessionsPerGame).toBeGreaterThanOrEqual(8); expect(p.passesOutFrontPerGame).toBeGreaterThanOrEqual(2); expect(p.wrapAttemptsPerGame).toBeGreaterThanOrEqual(0.5);
  }, GAMES_TIMEOUT);
  it('it looks like hockey: battles, hits and no teleports', () => {
    const p = summarise(even300()).play;
    expect(p.battleWinnerCameAwayShare).toBeGreaterThan(0.60); expect(p.battleToWinnerIsWinnerShare).toBeGreaterThan(0.85); expect(p.battlesNoWinnerPerGame).toBeLessThan(14);
    expect(p.knockdownShare).toBeGreaterThan(0.30); expect(p.knockdownShare).toBeLessThan(0.70);
    expect(p.puckJumpsPerGame).toBe(0); expect(p.maxPuckJump).toBeLessThanOrEqual(1.2);
  }, GAMES_TIMEOUT);
  // Task 14b: at most 2 a game ratified by the controller (section 3).
  it('whistles: live stretches over four minutes are rare (at most 2 a game; no timer stops play)', () => {
    // The addendum asked for none in seeds 1-16. With about 53 whistles a game the mean stretch is 68 s, and whistles that
    // come at random give e^(-240/68) = 3% of stretches over four minutes: about 1.5 a game. task-14-report.md.
    const p = summarise(even()).play;
    expect(p.liveOver240PerGame).toBeLessThanOrEqual(2);
  }, GAMES_TIMEOUT);
  it('faceoff shares stay believable game to game: at most 10% of games outside 35% to 65%', () => {
    expect(summarise(even()).faceoffShareOutside).toBeLessThanOrEqual(0.10);
  }, GAMES_TIMEOUT);
  it('no freak scores: nothing like 15 goals in a game, and few 0-0 games', () => {
    const totals = even300().map((r) => r.score.home + r.score.away);
    expect(Math.max(...totals)).toBeLessThan(15);
    // Task 14b (section 4): the count in 300 games has a standard error of about 2 (read 4 to 7 in the first 300 across
    // this task's tunings, 4.5 to 5.7 per 300 over the 1,000); left on the first 300, reported as not robust.
    expect(even300().filter((r) => r.score.home === 0 && r.score.away === 0).length).toBeLessThanOrEqual(5);
  }, GAMES_TIMEOUT);
  it('the 76 still beats the 66 about three quarters of the time, and loses plenty', () => {
    // Task 14b (section 4): read on 1,000 games (se of the 76's share 0.023 and of the 66's 0.016 at 300: 1.6 se inside
    // the bars at 867e714; 0.016 and 0.010 at 1,000).
    const w = winShare(runGames(EVEN, { homeOverall: 76, awayOverall: 66 })); expect(w.home).toBeGreaterThanOrEqual(0.70); expect(w.home).toBeLessThanOrEqual(0.80); expect(w.away).toBeGreaterThan(0.10);
  }, GAMES_TIMEOUT);
  it('snipers outscore grinders per 60 minutes', () => { const g = goalsPer60ByType(even300()); expect(g['Sniper']).toBeGreaterThan(g['Grinder']! * 1.5); }, GAMES_TIMEOUT);
  it('heavier, stronger players win more battles, under 75%', () => { const b = battleWinShareByType(even300()); expect(b['Power Forward']).toBeGreaterThan(b['Speedster']! + 0.05); expect(b['Power Forward']).toBeLessThan(0.75); }, GAMES_TIMEOUT);
  it('a game runs within budget: 2.5 s', () => { const t0 = performance.now(); for (let i = 0; i < 5; i++) simulateGame(setup(i)); expect((performance.now() - t0) / 5).toBeLessThan(2500); }, 60_000);
});
