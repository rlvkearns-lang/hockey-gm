/** Task 11, measured: the defensive-zone and pinching tactics move their team's own numbers (see tactics-play.test.ts). */
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

describe('tactics: two teams look different (defence, pinching)', () => {
  it('a pressure team presses the carrier in its zone more than a collapse team and gives up relatively more from the slot', () => {
    const pr = home({ defence: 'pressure' }, 8), co = home({ defence: 'collapse' }, 8);
    expect(pr.dzonePressedShare).toBeGreaterThan(co.dzonePressedShare);
    expect(pr.dzoneTwoShare).toBeGreaterThan(co.dzoneTwoShare);
    expect(pr.slotToPoint).toBeGreaterThan(co.slotToPoint);
  }, LONG);
  it('against a carrier behind the net a pressure team chases and a collapse team holds the front', () => {
    expect(home({ defence: 'pressure' }, 8).chaseShare).toBeGreaterThan(0.7); expect(home({ defence: 'collapse' }, 8).chaseShare).toBeLessThan(0.3);
  }, LONG);
  it('point men pinch more when told to, and only with a forward above them', () => {
    const often = homeCounts({ pinch: 'often' }, 8), rarely = homeCounts({ pinch: 'rarely' }, 8), some = homeCounts({ pinch: 'sometimes' }, 8);
    expect(often.pinches).toBeGreaterThan(rarely.pinches * 2);
    expect(often.pinchesWithoutCover + rarely.pinchesWithoutCover + some.pinchesWithoutCover).toBe(0);
  }, LONG);
});
