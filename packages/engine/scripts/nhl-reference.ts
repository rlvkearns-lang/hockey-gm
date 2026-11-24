/**
 * The NHL scorecard's reference column: for each total and "looks like hockey" measure, the NHL's value (null where
 * the league publishes nothing), our target band (the one Task 14 of the round-2a plan asserts), and where the number
 * comes from. Totals are per team per game (60 minutes, 5-on-5 where the league splits by strength), as our games are
 * 60 minutes of 5-on-5.
 *
 * Verification (2026-11-24): the session that wrote this file could not open the league's statistics pages (the
 * network refused nhl.com's API, hockey-reference.com and dailyfaceoff.com). A web search returned the 2024-25
 * all-situations league averages quoted in the `goals`, `shots` and `savePct` rows, but no 5-on-5 rates, so every NHL
 * number below is from memory and `verified: false`. Someone with access should check them (Natural Stat Trick, league
 * 5v5 per-60 rates; NHL.com team "Realtime" stats for hits, blocks, takeaways, giveaways; NHL.com faceoffs) before the
 * owner reads the scorecard as a comparison.
 */
export type Reference = {
  key: string;            // e.g. 'goals', 'shots', 'attempts', 'savePct', 'hits', 'blocks', 'takeaways', 'giveaways', 'faceoffsTotal', 'favouriteWinShare', or a PlayMeasures key
  label: string;
  /** The NHL's value, or null where the league publishes nothing. */
  nhl: number | null;
  band: [number, number]; // our target band
  unit: string;
  source: string;         // publication and URL, or 'ours' with the reasoning for the band
  season: string | null;
  verified: boolean;      // false: "from memory, unverified"
};

const NST = 'Natural Stat Trick, league 5v5 per-60 rates (naturalstattrick.com/teamtable.php, situation 5v5), from memory';
const NHL_REALTIME = 'NHL.com team Realtime stats, all situations, per team per game (nhl.com/stats/teams?report=realtime), from memory';
/** The 2024-25 all-situations averages a web search returned (Hockey-Reference league averages, hockey-reference.com/leagues/NHL_2025.html, quoted in the search result; the page itself could not be opened). */
const HR_2025 = 'all situations 2024-25 per Hockey-Reference as quoted by a web search (page not opened)';
/** Baseline box-score takeaways and giveaways per team per game (docs/superpowers/reviews/engine-scorecard-baseline.md): Task 14 keeps them within 30%. */
const BASELINE = { takeaways: 6.32, giveaways: 5.03 };
const OPEN = Infinity;

export const NHL_REFERENCE: readonly Reference[] = [
  // ---- totals (design, Re-tune A) ----
  { key: 'goals', label: 'goals', nhl: 2.45, band: [2.4, 2.6], unit: 'per team per 60 (5v5)', source: `${NST}; ${HR_2025}: 3.01 a game`, season: '2023-24', verified: false },
  { key: 'shots', label: 'shots on goal', nhl: 29.0, band: [28, 31], unit: 'per team per 60 (5v5)', source: `${NST}; ${HR_2025}: 28.1 a game`, season: '2023-24', verified: false },
  { key: 'attempts', label: 'shot attempts (Corsi)', nhl: 57.0, band: [55, 62], unit: 'per team per 60 (5v5)', source: NST, season: '2023-24', verified: false },
  { key: 'savePct', label: 'save percentage', nhl: 0.917, band: [0.915, 0.92], unit: 'saves / shots (5v5)', source: `${NST}; ${HR_2025}: .900`, season: '2023-24', verified: false },
  { key: 'hits', label: 'hits', nhl: 22.5, band: [20, 25], unit: 'per team per game', source: `${NHL_REALTIME}; ours counts absorbed and bounced checks too`, season: '2023-24', verified: false },
  { key: 'blocks', label: 'blocked shots', nhl: 14.5, band: [13, 16], unit: 'per team per game', source: NHL_REALTIME, season: '2023-24', verified: false },
  { key: 'takeaways', label: 'takeaways', nhl: 6.5, band: [BASELINE.takeaways * 0.7, BASELINE.takeaways * 1.3], unit: 'per team per game', source: `${NHL_REALTIME}; band: within 30% of our baseline (scorekeepers differ arena to arena)`, season: '2023-24', verified: false },
  { key: 'giveaways', label: 'giveaways', nhl: 8.5, band: [BASELINE.giveaways * 0.7, BASELINE.giveaways * 1.3], unit: 'per team per game', source: `${NHL_REALTIME}; band: within 30% of our baseline (scorekeepers differ arena to arena)`, season: '2023-24', verified: false },
  { key: 'faceoffsTotal', label: 'faceoffs', nhl: 57, band: [42, 72], unit: 'per game, both teams', source: 'NHL.com team faceoff stats, all situations, from memory', season: '2023-24', verified: false },
  { key: 'favouriteWinShare', label: 'a 76 beats a 66', nhl: null, band: [0.7, 0.8], unit: 'share of games', source: 'ours: the league has no ratings to compare; a clearly better team should win about three times in four and still lose plenty (design, Re-tune A)', season: null, verified: false },
  // ---- looks like hockey (the measures Task 14 asserts) ----
  { key: 'stationaryShare', label: 'standing still (< 0.5 m/s)', nhl: null, band: [0, 0.08], unit: 'share of live skater time', source: 'ours: no public tracking split; NHL skaters are almost never still while play is live, so under 8%', season: null, verified: false },
  { key: 'glideShare', label: 'gliding', nhl: null, band: [0.33, OPEN], unit: 'share of live skater time', source: 'ours: skaters coast between strides and turns much of the time; clearly more than today (0.25)', season: null, verified: false },
  { key: 'topSpeedShare', label: 'at 90% of top speed or more', nhl: null, band: [0.18, OPEN], unit: 'share of live skater time', source: 'ours: NHL EDGE publishes bursts over 20 mph per player, not time shares; clearly more than today (0.144)', season: null, verified: false },
  { key: 'sprintRunSeconds', label: 'length of a top-speed run', nhl: null, band: [1.5, OPEN], unit: 's', source: 'ours: a rush or a backcheck holds top speed for seconds, not a fraction of one', season: null, verified: false },
  { key: 'passCompletion', label: 'pass completion', nhl: null, band: [0.75, 0.9], unit: 'share of passes', source: 'ours: no public league figure (tracking vendors report roughly 75-85% for tape-to-tape passes)', season: null, verified: false },
  { key: 'pointPassKeptShare', label: 'point passes kept in', nhl: null, band: [0.9, OPEN], unit: 'share of point passes', source: 'ours: a pass back to the point is rarely allowed to leave the zone', season: null, verified: false },
  { key: 'pointPassCompletion', label: 'point passes completed', nhl: null, band: [0.75, OPEN], unit: 'share of point passes', source: 'ours: the short, open pass back to the point is usually taken', season: null, verified: false },
  { key: 'reboundChancesPerGame', label: 'rebound chances', nhl: null, band: [8, 20], unit: 'per game, both teams', source: 'ours: a few rebound attempts per team per game (MoneyPuck and Natural Stat Trick count rebound shots but not on this definition)', season: null, verified: false },
  { key: 'defenceAttemptsPerTeam', label: 'attempts by defencemen', nhl: null, band: [12, 20], unit: 'per team per game', source: 'ours: defencemen take roughly a quarter to a third of NHL shot attempts', season: null, verified: false },
  { key: 'battleWinnerCameAwayShare', label: 'battle winner comes away with it', nhl: null, band: [0.6, OPEN], unit: 'share of decided board battles', source: 'ours: the man who wins a battle usually leaves with the puck', season: null, verified: false },
  { key: 'battleToWinnerIsWinnerShare', label: 'puck to the battle winner himself', nhl: null, band: [0.85, OPEN], unit: 'share of toWinner board battles', source: 'ours: a clean win puts the puck on the winner\'s stick, rarely straight to his support', season: null, verified: false },
  { key: 'battlesNoWinnerPerGame', label: 'board battles with no winner', nhl: null, band: [0, 14], unit: 'per game', source: 'ours: most board battles are decided', season: null, verified: false },
  { key: 'knockdownShare', label: 'landed hits that knock him down', nhl: null, band: [0.3, 0.7], unit: 'share of landed hits', source: 'ours: many hits are bumps and staggers, not knockdowns', season: null, verified: false },
  { key: 'ozoneSecondsPerPossession', label: 'offensive-zone time per possession', nhl: null, band: [4, OPEN], unit: 's', source: 'ours: teams hold the zone longer than today (4.0 s)', season: null, verified: false },
  { key: 'attemptsPerOzonePossession', label: 'attempts per offensive-zone possession', nhl: null, band: [0.33, OPEN], unit: 'per possession', source: 'ours: more zone possessions end in an attempt than today (0.30)', season: null, verified: false },
  { key: 'twoOpenShare', label: 'two teammates open', nhl: null, band: [0.5, OPEN], unit: 'share of zone samples', source: 'ours: attackers without the puck get open, so the carrier usually has two outlets', season: null, verified: false },
  { key: 'dangerShadowedShare', label: 'most dangerous man shadowed', nhl: null, band: [0.6, 0.9], unit: 'share of zone samples', source: 'ours: defenders take the dangerous lane away most of the time, not always', season: null, verified: false },
  { key: 'behindNetPossessionsPerGame', label: 'possessions behind the net', nhl: null, band: [8, OPEN], unit: 'per game', source: 'ours: carriers use the space behind the net (the office) several times a game', season: null, verified: false },
  { key: 'passesOutFrontPerGame', label: 'passes out front from behind the net', nhl: null, band: [2, OPEN], unit: 'per game', source: 'ours: a carrier behind the net looks for the man in front', season: null, verified: false },
  { key: 'wrapAttemptsPerGame', label: 'wraparounds', nhl: null, band: [0.5, OPEN], unit: 'per game', source: 'ours: a wraparound now and then', season: null, verified: false },
  { key: 'puckJumpsPerGame', label: 'puck jumps', nhl: null, band: [0, 0.001], unit: 'per game', source: 'ours: the puck never moves further in a tick than its speed allows (must be 0; any jump in 1,000 games reads out)', season: null, verified: false },
];
