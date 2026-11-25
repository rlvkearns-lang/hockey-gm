/** Task 11, the measured half of the tactics tests (tactics.test.ts has the rest): each tactic moves its team's own numbers. */
import { describe, it, expect } from 'vitest';
import { DEFAULT_TACTICS, entryFactors, lineHabit, naturalTactics, offenceFactors, patienceFactor, resolveTactics, shade } from '../src/tactics';
import { generateTeam } from '../src/roster-gen';
import { PLAYER_TYPES } from '../src/player-types';
import { validateSetup } from '../src/validate';
import { TUNING } from '../src/tuning';
import { resolveTactics as resolveFromIndex } from '../src/index';
import type { GameSetup, Side, Tactics } from '../src/types';
import { gameSetup, stateWith } from './helpers';
import { tacticCounts, tacticMeasures } from './measures';

/** `s` with `side`'s tactics changed by `t` (the rosters are the same). */
const withTactics = (s: GameSetup, side: Side, t: Partial<Tactics>): GameSetup => ({ ...s, [side]: { ...s[side], tactics: { ...s[side].tactics, ...t } } });
/** `s` with every forward of `side` given the mean habits of player type `type` (attributes unchanged), and tactics `t`. */
function allOfType(s: GameSetup, side: Side, type: string, t: Partial<Tactics>): GameSetup {
  const players = s[side].players.map((p) => (p.position === 'G' || p.position === 'LD' || p.position === 'RD' ? p : { ...p, tendencies: { ...PLAYER_TYPES[type]!.tendencies } }));
  return withTactics({ ...s, [side]: { ...s[side], players } }, side, t);
}
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const home = (t: Partial<Tactics>, n = 4) => tacticMeasures(tacticCounts(withTactics(gameSetup(1), 'home', t), 'home', n));
const homeCounts = (t: Partial<Tactics>, n = 4) => tacticCounts(withTactics(gameSetup(1), 'home', t), 'home', n);
const LONG = 600_000;

describe('tactics: two teams look different (offence, forecheck)', () => {
  it('a cycle team holds the zone longer than a rush team, and cycles more below the dots (8 games each)', () => {
    const cyc = home({ offence: 'cycle' }, 8), rush = home({ offence: 'rush' }, 8);
    expect(cyc.ozoneSecondsPerPossession).toBeGreaterThan(rush.ozoneSecondsPerPossession * 1.2);
    expect(cyc.lowPassesPerPossession).toBeGreaterThan(rush.lowPassesPerPossession);
    expect(cyc.lowSecondsPerPossession).toBeGreaterThan(rush.lowSecondsPerPossession);
  }, LONG);
  it('a point-shot team shoots more from the defence and from the point (8 games each)', () => {
    const pts = home({ offence: 'pointShots' }, 8), cyc = home({ offence: 'cycle' }, 8);
    expect(pts.defenceAttemptsPerGame).toBeGreaterThan(cyc.defenceAttemptsPerGame * 1.4);
    expect(pts.pointAttemptShare).toBeGreaterThan(cyc.pointAttemptShare * 1.4);
  }, LONG);
  // (The offence's job-order check moved to tactics-slow.test.ts at Task 14b, read on six team pairs.)
  it('an aggressive forecheck has two men deep; a trap has at most one', () => {
    expect(home({ forecheck: 'aggressive' }, 2).twoDeepShare).toBeGreaterThan(0.40);
    expect(home({ forecheck: 'passive' }, 2).twoDeepShare).toBeLessThan(0.10);
  }, LONG);
});
