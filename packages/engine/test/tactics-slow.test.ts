/**
 * Moved out of tactics.test.ts at Task 13b (it plays 24 whole games): the fast suite keeps guards of at most 16 games;
 * this runs with `npm run test:calibration`.
 */
import { describe, it, expect } from 'vitest';
import { PLAYER_TYPES } from '../src/player-types';
import type { GameSetup, Side, Tactics } from '../src/types';
import { gameSetup } from './helpers';
import { tacticCounts, tacticMeasures } from './measures';

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
