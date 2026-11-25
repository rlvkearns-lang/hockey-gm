/**
 * Moved out of tactics.test.ts at Task 13b (it plays 24 whole games): the fast suite keeps guards of at most 16 games;
 * this runs with `npm run test:calibration`.
 */
import { describe, it, expect } from 'vitest';
import { PLAYER_TYPES } from '../src/player-types';
import type { GameSetup, Side, Tactics } from '../src/types';
import { gameSetup } from './helpers';
import { generateTeam } from '../src/roster-gen';
import { CERTAINTY_PAIRS, tacticCounts, tacticMeasures } from './measures';

/** `s` with `side`'s tactics changed by `t` (the rosters are the same). */
const withTactics = (s: GameSetup, side: Side, t: Partial<Tactics>): GameSetup => ({ ...s, [side]: { ...s[side], tactics: { ...s[side].tactics, ...t } } });
/** `s` with every forward of `side` given the mean habits of player type `type` (attributes unchanged), and tactics `t`. */
function allOfType(s: GameSetup, side: Side, type: string, t: Partial<Tactics>): GameSetup {
  const players = s[side].players.map((p) => (p.position === 'G' || p.position === 'LD' || p.position === 'RD' ? p : { ...p, tendencies: { ...PLAYER_TYPES[type]!.tendencies } }));
  return withTactics({ ...s, [side]: { ...s[side], players } }, side, t);
}
const home = (t: Partial<Tactics>, n = 4) => tacticMeasures(tacticCounts(withTactics(gameSetup(1), 'home', t), 'home', n));
const LONG = 600_000;

describe('tactics: the players bend them', () => {
  it('with the same tactic a line of grinders dumps more than a skilled line, by less than the tactic itself moves it', () => {
    const share = (type: string) => tacticMeasures(tacticCounts(allOfType(gameSetup(1), 'home', type, { zoneEntry: 'mixed' }), 'home', 4)).dumpInShare;
    const grind = share('Grinder'), skill = share('Playmaker');
    expect(grind).toBeGreaterThan(skill);
    expect(grind / skill).toBeLessThan(home({ zoneEntry: 'dump' }, 8).dumpInShare / home({ zoneEntry: 'carry' }, 8).dumpInShare);
  }, LONG);
});

/** Counts of the home team under tactics `t`, pooled over the CERTAINTY_PAIRS generated team pairs, `games` games a pair. */
function pairsPooled(t: Partial<Tactics>, games = 2): ReturnType<typeof tacticMeasures> {
  let sum: ReturnType<typeof tacticCounts> | null = null;
  for (let k = 1; k <= CERTAINTY_PAIRS; k++) {
    const s: GameSetup = { home: generateTeam(2 * k + 1, 'A', 'AAA'), away: generateTeam(2 * k + 2, 'B', 'BBB'), seed: 1, chemistry: [] };
    const c = tacticCounts(withTactics(s, 'home', t), 'home', games);
    if (sum === null) sum = { ...c }; else for (const key of Object.keys(c) as (keyof typeof c)[]) sum[key] += c[key];
  }
  return tacticMeasures(sum!);
}

describe('tactics: the offence orders the zone jobs', () => {
  // Task 13b item 5 (the offence tactic's job order, Task 11/12 reviews): the net-front man is handed out first; after
  // him a cycle team's second forward takes low support before the high forward (jobs.ts phaseJobs).
  // Task 14b (Task 13b review, Minor 12: "a thin and possibly noisy fast guard"; a measure change for the controller to
  // ratify, the bar unchanged): read on counts pooled over six generated team pairs, two games each, here in the slow
  // suite. On gameSetup(1)'s 8 games it read 0.608 against 0.593 / 0.583 at Task 13b and flipped with a change of
  // interceptions at Task 14b (0.613 against 0.629); over the six pairs 0.629 against 0.606 to 0.617.
  it('a cycle team has a man in low support more of its zone time than a rush or point-shot team (six team pairs)', () => {
    const cyc = pairsPooled({ offence: 'cycle' }), rush = pairsPooled({ offence: 'rush' }), pts = pairsPooled({ offence: 'pointShots' });
    expect(cyc.lowSupportShare).toBeGreaterThan(rush.lowSupportShare); expect(cyc.lowSupportShare).toBeGreaterThan(pts.lowSupportShare);
  }, 1_200_000);
});
