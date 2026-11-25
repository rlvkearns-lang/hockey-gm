/**
 * The NHL scorecard's reference column: for each total and "looks like hockey" measure, the NHL's value (null where
 * the league publishes nothing), our target band (the one Task 14 of the round-2a plan asserts), and where the number
 * comes from. Totals are per team per game (60 minutes, 5-on-5 where the league splits by strength), as our games are
 * 60 minutes of 5-on-5.
 *
 * Verification (2026-11-25, Task 14): a second try. The statistics hosts are still refused from the build session
 * (edge.nhl.com, hockey-reference.com: no route), but a web search quoted figures from them, used below and marked
 * `quoted` ("quoted by a web search, page not opened"): the NHL EDGE league-average team of 2023-24 (the league-average
 * column of edge.nhl.com/en/team/20232024-regular-PHI: 1,690.7 bursts over 20 mph and 77.3 over 22 mph a season, top
 * skating speed 23.60 mph, top shot speed 100.39 mph) and Hockey-Reference's league averages (2023-24: 3.08 goals, 30.1
 * shots, .903; 2024-25: 3.01, 28.1, .900; all situations). The 5-on-5 rates, hits, blocks, takeaways, giveaways,
 * faceoffs and icings were not found: still from memory, `verified: false`.
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
  /** True when the number was read in a web search's quotation of the source, the page itself not opened (Task 14). */
  quoted?: boolean;
};

const NST = 'Natural Stat Trick, league 5v5 per-60 rates (naturalstattrick.com/teamtable.php, situation 5v5), from memory';
const NHL_REALTIME = 'NHL.com team Realtime stats, all situations, per team per game (nhl.com/stats/teams?report=realtime), from memory';
/** The 2024-25 all-situations averages a web search returned (Hockey-Reference league averages, hockey-reference.com/leagues/NHL_2025.html, quoted in the search result; the page itself could not be opened). */
const HR_2025 = 'all situations per Hockey-Reference league averages as quoted by a web search (page not opened), 2023-24 / 2024-25';
/** Baseline box-score takeaways and giveaways per team per game (docs/superpowers/reviews/engine-scorecard-baseline.md): Task 14 keeps them within 30%. */
const BASELINE = { takeaways: 6.32, giveaways: 5.03 };
const OPEN = Infinity;
/** NHL EDGE puck and player tracking (nhl.com/nhl-edge: skating speed, 20+ and 22+ mph bursts, shot speed), from memory. */
const EDGE = 'NHL EDGE tracking (nhl.com/nhl-edge), from memory';
/** NHL EDGE league-average team figures as a web search quoted them from edge.nhl.com team pages (Task 14; the pages could not be opened). */
const EDGE_Q = 'NHL EDGE league-average team (edge.nhl.com team pages, quoted by a web search, page not opened)';

export const NHL_REFERENCE: readonly Reference[] = [
  // ---- totals (design, Re-tune A) ----
  { key: 'goals', label: 'goals', nhl: 2.45, band: [2.4, 2.6], unit: 'per team per 60 (5v5)', source: `${NST}; ${HR_2025}: 3.08 / 3.01 a game`, season: '2023-24', verified: false },
  { key: 'shots', label: 'shots on goal', nhl: 29.0, band: [28, 31], unit: 'per team per 60 (5v5)', source: `${NST}; ${HR_2025}: 30.1 / 28.1 a game`, season: '2023-24', verified: false },
  { key: 'attempts', label: 'shot attempts (Corsi)', nhl: 57.0, band: [55, 62], unit: 'per team per 60 (5v5)', source: NST, season: '2023-24', verified: false },
  { key: 'savePct', label: 'save percentage', nhl: 0.917, band: [0.915, 0.92], unit: 'saves / shots (5v5)', source: `${NST}; ${HR_2025}: .903 / .900`, season: '2023-24', verified: false },
  { key: 'hits', label: 'hits', nhl: 22.5, band: [20, 25], unit: 'per team per game', source: `${NHL_REALTIME}; ours counts absorbed and bounced checks too`, season: '2023-24', verified: false },
  { key: 'blocks', label: 'blocked shots', nhl: 14.5, band: [8, 12], unit: 'per team per game', source: `${NHL_REALTIME}; band 8 to 12 by the controller's ruling (Task 14b): the design's 13 to 16 needs shot wind-ups so a lane can close, carried to Part B`, season: '2023-24', verified: false },
  { key: 'takeaways', label: 'takeaways', nhl: 6.5, band: [BASELINE.takeaways * 0.7, BASELINE.takeaways * 1.3], unit: 'per team per game', source: `${NHL_REALTIME}; band: within 30% of our baseline (scorekeepers differ arena to arena)`, season: '2023-24', verified: false },
  { key: 'giveaways', label: 'giveaways', nhl: 8.5, band: [BASELINE.giveaways * 0.7, BASELINE.giveaways * 1.3], unit: 'per team per game', source: `${NHL_REALTIME}; band: within 30% of our baseline (scorekeepers differ arena to arena)`, season: '2023-24', verified: false },
  { key: 'faceoffsTotal', label: 'faceoffs', nhl: 57, band: [50, 68], unit: 'per game, both teams', source: 'NHL.com team faceoff stats, all situations, from memory', season: '2023-24', verified: false },
  { key: 'icingsTotal', label: 'icings', nhl: 8, band: [4, 12], unit: 'per game, both teams', source: 'from memory (no public league table found); band: the controller\'s (Task 13b)', season: '2023-24', verified: false },
  { key: 'offsidesTotal', label: 'offsides', nhl: null, band: [2, 11], unit: 'per game, both teams', source: 'ours: a handful a game', season: null, verified: false },
  { key: 'tieShare', label: 'games level after 60 minutes', nhl: 0.22, band: [0.15, 0.30], unit: 'share of games', source: 'from memory: a little over a fifth of NHL games go to overtime', season: '2023-24', verified: false },
  { key: 'favouriteWinShare', label: 'a 76 beats a 66', nhl: null, band: [0.7, 0.8], unit: 'share of games', source: 'ours: the league has no ratings to compare; a clearly better team should win about three times in four and still lose plenty (design, Re-tune A)', season: null, verified: false },
  // ---- looks like hockey (the measures Task 14 asserts) ----
  { key: 'stationaryShare', label: 'standing still (< 0.5 m/s)', nhl: null, band: [0, 0.08], unit: 'share of live skater time', source: 'ours: no public tracking split; NHL skaters are almost never still while play is live, so under 8%', season: null, verified: false },
  { key: 'glideShare', label: 'gliding (speed held within 1 m/s^2)', nhl: null, band: [0.22, OPEN], unit: 'share of live skater time', source: 'ours: skaters coast between strides and turns much of the time; 0.22 or more by the controller\'s ruling (Task 14b; it was 0.30): with real effort a skater pushes for longer toward top speed, and the cruise share is the measure that matters', season: null, verified: false },
  // Real effort (Task 14, controller ruling: NHL tracking wins over the earlier "top speed share over 0.18" and "top-speed run over 1.5 s").
  { key: 'cruiseShare', label: 'gliding or cruising (under 75% of his own top speed)', nhl: null, band: [0.6, 0.9], unit: 'share of live skater time', source: 'ours: NHL EDGE publishes bursts, not time shares; a game is played well under top speed (a team passes 20 mph about 20 times a game)', season: null, verified: false },
  { key: 'topSpeedShare', label: 'at 90% of top speed or more', nhl: null, band: [0, 0.03], unit: 'share of live skater time', source: 'ours: from the EDGE burst counts, time at top speed is a small share (41 bursts a game of a couple of seconds is about 0.2% of skater time)', season: null, verified: false },
  { key: 'passCompletion', label: 'pass completion', nhl: null, band: [0.70, 0.85], unit: 'share of passes', source: 'ours: no public league figure (tracking vendors report roughly 75-85% for tape-to-tape passes); band by the controller\'s ruling after Task 9 (the design said 0.75 to 0.90)', season: null, verified: false },
  { key: 'pointPassKeptShare', label: 'point passes kept in', nhl: null, band: [0.9, OPEN], unit: 'share of point passes', source: 'ours: a pass back to the point is rarely allowed to leave the zone', season: null, verified: false },
  { key: 'pointPassCompletion', label: 'point passes completed', nhl: null, band: [0.72, OPEN], unit: 'share of point passes', source: 'ours: the short, open pass back to the point is usually taken; 0.72 or more by the controller\'s ruling (Task 14b; it was 0.75): passes are not re-tuned for real effort yet', season: null, verified: false },
  { key: 'reboundChancesPerGame', label: 'rebound chances', nhl: null, band: [3, 8], unit: 'per game, both teams', source: 'ours: a few rebound attempts per team per game (MoneyPuck and Natural Stat Trick count rebound shots but not on this definition); 3 to 8 by the controller\'s ruling (Task 14b; the design said 8 to 20, which needs more net-front offence: Part B)', season: null, verified: false },
  { key: 'defenceAttemptsPerTeam', label: 'attempts by defencemen', nhl: null, band: [12, 20], unit: 'per team per game', source: 'ours: defencemen take roughly a quarter to a third of NHL shot attempts', season: null, verified: false },
  { key: 'battleWinnerCameAwayShare', label: 'battle winner comes away with it', nhl: null, band: [0.6, OPEN], unit: 'share of decided board battles', source: 'ours: the man who wins a battle usually leaves with the puck', season: null, verified: false },
  { key: 'battleToWinnerIsWinnerShare', label: 'puck to the battle winner himself', nhl: null, band: [0.85, OPEN], unit: 'share of toWinner board battles', source: 'ours: a clean win puts the puck on the winner\'s stick, rarely straight to his support', season: null, verified: false },
  { key: 'battlesNoWinnerPerGame', label: 'board battles with no winner', nhl: null, band: [0, 14], unit: 'per game', source: 'ours: most board battles are decided', season: null, verified: false },
  { key: 'knockdownShare', label: 'landed hits that knock him down', nhl: null, band: [0.3, 0.7], unit: 'share of landed hits', source: 'ours: many hits are bumps and staggers, not knockdowns', season: null, verified: false },
  { key: 'ozoneSecondsPerPossession', label: 'offensive-zone time per possession', nhl: null, band: [4, OPEN], unit: 's', source: 'ours: teams hold the zone longer than today (4.0 s)', season: null, verified: false },
  { key: 'attemptsPerOzonePossession', label: 'attempts per offensive-zone possession', nhl: null, band: [0.30, OPEN], unit: 'per possession', source: 'ours: more zone possessions end in an attempt than at the baseline (0.28); 0.30 or more by the controller\'s ruling (Task 14b; it was 0.33)', season: null, verified: false },
  { key: 'twoOpenShare', label: 'two teammates open', nhl: null, band: [0.44, OPEN], unit: 'share of zone samples', source: 'ours: attackers without the puck get open, so the carrier usually has two outlets; 0.44 or more by the controller\'s ruling (Task 14b; it was 0.50): men getting open skate at real effort, as do their checkers', season: null, verified: false },
  { key: 'dangerShadowedShare', label: 'most dangerous man shadowed', nhl: null, band: [0.6, 0.9], unit: 'share of zone samples', source: 'ours: defenders take the dangerous lane away most of the time, not always', season: null, verified: false },
  { key: 'behindNetPossessionsPerGame', label: 'possessions behind the net', nhl: null, band: [8, OPEN], unit: 'per game', source: 'ours: carriers use the space behind the net (the office) several times a game', season: null, verified: false },
  { key: 'passesOutFrontPerGame', label: 'passes out front from behind the net', nhl: null, band: [2, OPEN], unit: 'per game', source: 'ours: a carrier behind the net looks for the man in front', season: null, verified: false },
  { key: 'wrapAttemptsPerGame', label: 'wraparounds', nhl: null, band: [0.5, OPEN], unit: 'per game', source: 'ours: a wraparound now and then', season: null, verified: false },
  // ---- real-world scale (Task 13b; the owner: "McDavid can skate up to, what? 24 mph?") ----
  { key: 'fastestSkaterMph', label: 'top speed of the fastest skater in a game', nhl: 23.6, band: [22, 24.5], unit: 'mph, held 0.5 s on his feet, mean of the games', source: `${EDGE_Q}: top skating speed 23.60 mph is the league-average team's fastest of the season, so a single game's fastest is a little under it`, season: '2023-24', verified: false, quoted: true },
  { key: 'bursts20PerGame', label: 'bursts over 20 mph', nhl: 41, band: [20, 200], unit: 'per game, both teams, sustained 0.5 s', source: `${EDGE_Q}: 1,690.7 bursts over 20 mph a team a season, over 82 games, two teams. EDGE counts "a sustained speed above a threshold"; how long it must be sustained is not published, ours is 0.5 s`, season: '2023-24', verified: false, quoted: true },
  { key: 'bursts22PerGame', label: 'bursts over 22 mph', nhl: 1.9, band: [0, 10], unit: 'per game, both teams, sustained 0.5 s', source: `${EDGE_Q}: 77.3 bursts over 22 mph a team a season`, season: '2023-24', verified: false, quoted: true },
  { key: 'shotMphWrist', label: 'wrist and snap shot speed', nhl: null, band: [70, 85], unit: 'mph, mean at release', source: `ours: ${EDGE} publishes the hardest shots and counts over 90 mph, not means by type; a wrist or snap shot is about 70 to 90 mph at release (EDGE's league-average shot speed of about 61 mph, quoted by a web search, is over all shots and their whole flight)`, season: null, verified: false },
  { key: 'shotMphSlap', label: 'slapshot speed', nhl: null, band: [85, 100], unit: 'mph, mean at release', source: `ours: slapshots about 85 to 100+ mph (${EDGE}: the hardest about 100 to 105)`, season: null, verified: false },
  { key: 'shotMphMaxSlap', label: 'hardest slapshot', nhl: 100.4, band: [95, 108], unit: 'mph, the largest of the set', source: `${EDGE_Q}: top shot speed 100.39 mph is the league-average team's hardest of the season (the league's hardest about 105; skills-competition records near 108). Task 14b (controller): the cap is on the whole release speed, lift included`, season: '2023-24', verified: false, quoted: true },
  { key: 'shotMphOneTimer', label: 'one-timer speed', nhl: null, band: [80, 98], unit: 'mph, mean at release', source: 'ours: near slapshot speed', season: null, verified: false },
  { key: 'shotMphBackhand', label: 'backhand speed', nhl: null, band: [45, 70], unit: 'mph, mean at release', source: 'ours: a backhand is well under a wrist shot', season: null, verified: false },
  // ---- whistles and clears (Task 14) ----
  { key: 'liveOver240PerGame', label: 'live stretches over four minutes without a whistle', nhl: null, band: [0, 2], unit: 'per game', source: 'ours: with about 53 whistles a game at random the mean stretch is 68 s and 3% of stretches pass four minutes (about 1.5 a game); no timer stops play; ratified by the controller (Task 14b)', season: null, verified: false },
  { key: 'hardClearsPerGame', label: 'hard clears (off the glass or flipped out)', nhl: null, band: [10, 25], unit: 'per game, both teams', source: 'ours: a last resort under pressure with no outlet (controller, Task 14)', season: null, verified: false },
  { key: 'puckJumpsPerGame', label: 'puck jumps', nhl: null, band: [0, 0.001], unit: 'per game', source: 'ours: the puck never moves further in a tick than its speed allows (must be 0; any jump in 1,000 games reads out)', season: null, verified: false },
];
