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
import { CERTAINTY_PAIRS, tacticCounts, tacticMeasures } from './measures';

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
/**
 * Task 13 close-out ruling 2: a measure of `side`'s team under tactics `t`, read as the mean over CERTAINTY_PAIRS (six)
 * generated team pairs (teams 2k+1 v 2k+2, two games each, as the certainty guards): a single setup moves whenever play
 * changes.
 */
function pairsMean(t: Partial<Tactics>, read: (m: ReturnType<typeof tacticMeasures>) => number, games = 2): number {
  let sum = 0;
  for (let k = 1; k <= CERTAINTY_PAIRS; k++) {
    const s: GameSetup = { home: generateTeam(2 * k + 1, 'A', 'AAA'), away: generateTeam(2 * k + 2, 'B', 'BBB'), seed: 1, chemistry: [] };
    sum += read(tacticMeasures(tacticCounts(withTactics(s, 'home', t), 'home', games)));
  }
  return sum / CERTAINTY_PAIRS;
}

/**
 * Task 13 review, Minor 2 (Task 13b item 7e): as pairsMean, but the counts are pooled over the CERTAINTY_PAIRS pairs and
 * the measure is read once on the sums (the ruling's "pooled"), so a pair with few events weighs as little as it says.
 */
function pairsPooled(t: Partial<Tactics>, read: (m: ReturnType<typeof tacticMeasures>) => number, games = 2): number {
  let sum: ReturnType<typeof tacticCounts> | null = null;
  for (let k = 1; k <= CERTAINTY_PAIRS; k++) {
    const s: GameSetup = { home: generateTeam(2 * k + 1, 'A', 'AAA'), away: generateTeam(2 * k + 2, 'B', 'BBB'), seed: 1, chemistry: [] };
    const c = tacticCounts(withTactics(s, 'home', t), 'home', games);
    if (sum === null) sum = { ...c }; else for (const key of Object.keys(c) as (keyof typeof c)[]) sum[key] += c[key];
  }
  return read(tacticMeasures(sum!));
}

describe('tactics: two teams look different (defence, pinching)', () => {
  it('a pressure team presses the carrier in its zone more than a collapse team and gives up relatively more from the slot', () => {
    const pr = home({ defence: 'pressure' }, 8), co = home({ defence: 'collapse' }, 8);
    expect(pr.dzonePressedShare).toBeGreaterThan(co.dzonePressedShare);
    expect(pr.dzoneTwoShare).toBeGreaterThan(co.dzoneTwoShare);
    // Task 13 close-out ruling 2: on gameSetup(1) this read flipped with every change of play (1.256 / 1.232 before Task
    // 13, 1.000 / 1.142 after it); read as the mean over six generated team pairs (0.775 / 0.656 at Task 13's close-out).
    // Task 13 review, Minor 2: the counts pooled over the pairs, not a mean of per-pair ratios; same bar.
    // Task 14b (section 2): failed once in four slow runs at 12 games a variant; four games a pair (24), pooled; same bar.
    const sp = pairsPooled({ defence: 'pressure' }, (m) => m.slotToPoint, 4), sc = pairsPooled({ defence: 'collapse' }, (m) => m.slotToPoint, 4);
    expect(sp).toBeGreaterThan(sc);
  }, LONG);
  it('against a carrier behind the net a pressure team chases (twice as often as a collapse team, and over half the time) and a collapse team holds the front', () => {
    // Task 11 close-out ruling 2: the brief's "over 0.7" is replaced by what matters, pressure at least twice collapse and
    // over 0.5 (0.576 against 0.234 on seeds 1-16 at the close-out: from where the pressing men are, getting behind the
    // goal line takes about a second). Collapse stays under 0.3.
    // (Pooled over seeds 1-16, as the ruling was measured: on 8 seeds collapse reads 0.275 and the ratio 1.97.)
    // Task 13 close-out ruling 2: on gameSetup(1), seeds 1-16, collapse crept up to 0.313 with pressure 0.589 as play
    // changed (0.224 / 0.603 before Task 13); read as the mean over six generated team pairs (0.250 / 0.619 at Task 13's
    // close-out; four games a pair read 0.288 / 0.621). Bars unchanged.
    // Task 14b (section 2): failed once in four slow runs (0.586 against 0.679 for twice collapse) as a mean of per-pair
    // shares over 12 games; now the counts pooled over the six pairs, four games a pair (24); same bars.
    const pr = pairsPooled({ defence: 'pressure' }, (m) => m.chaseShare, 4), co = pairsPooled({ defence: 'collapse' }, (m) => m.chaseShare, 4);
    expect(pr).toBeGreaterThan(0.5); expect(pr).toBeGreaterThanOrEqual(2 * co); expect(co).toBeLessThan(0.3);
  }, 1_200_000);
  it('point men pinch more when told to, and only with a forward above them', () => {
    const often = homeCounts({ pinch: 'often' }, 8), rarely = homeCounts({ pinch: 'rarely' }, 8), some = homeCounts({ pinch: 'sometimes' }, 8);
    expect(often.pinches).toBeGreaterThan(rarely.pinches * 2);
    expect(often.pinchesWithoutCover + rarely.pinchesWithoutCover + some.pinchesWithoutCover).toBe(0);
  }, LONG);
});
