/**
 * Task 13b item 4 (slow suite, `npm run test:calibration`): the numbers the carrier's valuation (options.ts) takes from
 * execution, re-measured, so a re-tune that changes play cannot leave them stale. Each check fails when the valuation's
 * number is off what execution now gives by more than its stated tolerance; scripts/fit-valuation.ts prints the same
 * readings to refit them.
 * - the shot badges (TUNING.badges.value): paired executed shots (test/badge-lab.ts), 40,000 a case;
 * - the traffic lift (TUNING.value.traffic), what follows a shot (TUNING.value.after) and the goal chance by distance
 *   (V.goal * shot quality * skill): every attempt of gameSetup(1..32) (test/valuation-fit.ts).
 */
import { describe, it, expect } from 'vitest';
import { TUNING } from '../src/tuning';
import { gameSetup } from './helpers';
import { labLift, type LabCase } from './badge-lab';
import { AFTER_KEYS, afterShares, attemptsOf, distanceFit, trafficLift, type Attempt } from './valuation-fit';

const LONG = 900_000;
const BV = TUNING.badges.value;
let cache: Attempt[] | null = null;
// Task 14 (Task 13b review, Important 2): 64 games, not 32, so the tighter tolerances below are read, not noise.
const GAMES = 64;
const attempts = (): Attempt[] => (cache ??= Array.from({ length: GAMES }, (_, i) => attemptsOf(gameSetup(i + 1))).flat());

describe('the valuation matches execution (Task 13b)', () => {
  // Tolerance 0.04 on each factor (with 40,000 paired shots a factor's error is about 0.01 to 0.02).
  it('shot badges: each valuation factor is within 0.04 of its measured lift', () => {
    const valued: Record<LabCase, number> = {
      oneTimer: BV.oneTimer, heavySlap: BV.heavySlap, quickReleaseCalm: BV.quickReleaseCalm, quickReleasePressed: BV.quickReleaseCalm * (1 + BV.quickRelease * 0.95),
      finisherRebound: BV.finisherRebound, finisherScreen: BV.finisherScreen,
    };
    for (const c of Object.keys(valued) as LabCase[]) {
      const m = labLift(c, 40_000);
      expect(Math.abs(m.lift - valued[c]), `${c}: measured ${m.lift.toFixed(3)} (${m.with} / ${m.without}), valued ${valued[c].toFixed(3)}`).toBeLessThanOrEqual(0.04);
    }
  }, LONG);
  // Tolerance: two standard errors of the measured lift, at least 0.02. (Task 13b review, Minor 10: this was red on purpose from Task 13b, unannounced at the test, until Task 14 fitted V.traffic to the lift; green since.)
  it('traffic: TUNING.value.traffic is within two standard errors (at least 0.02) of the lift a man in front gives far shots', () => {
    const t = trafficLift(attempts());
    expect(t.with.n).toBeGreaterThan(60); expect(t.without.n).toBeGreaterThan(200);
    expect(Math.abs(t.lift - TUNING.value.traffic), `lift ${t.lift.toFixed(3)} (se ${t.se.toFixed(3)}), valued ${TUNING.value.traffic}`).toBeLessThanOrEqual(Math.max(0.02, 2 * t.se));
  }, LONG);
  // Tolerance 0.05 on each share (Task 14, Task 13b review Important 2: it was 0.12, wide enough to pass the 0.11 and
  // 0.09 gaps Task 13b handed over; two standard errors on 700 to 1,700 outcomes are 0.02 to 0.04).
  it('what follows a shot: each TUNING.value.after keep and rush share is within 0.05 of what follows in play', () => {
    const m = afterShares(attempts());
    for (const k of AFTER_KEYS) {
      const v = TUNING.value.after[k];
      expect(m[k].n, k).toBeGreaterThan(300);
      expect(Math.abs(m[k].keep - v.keep), `${k} keep: measured ${m[k].keep.toFixed(3)}, valued ${v.keep}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(m[k].rush - v.rush), `${k} rush: measured ${m[k].rush.toFixed(3)}, valued ${v.rush}`).toBeLessThanOrEqual(0.05);
    }
  }, LONG);
  // Tolerance (Task 14, Task 13b review Important 2: it was 0.4 to 2): in every distance band with 80 or more free
  // shots, measured over valued within 0.8 to 1.25, or, where the band's sample cannot read that finely, the gap within
  // two standard errors of the measured rate; and over all free shots together (the sample that can be read) within 0.8
  // to 1.25 outright.
  it('goal chance by distance: a free shot scores 0.8 to 1.25 times what the valuation gives it, in each band and over all', () => {
    const bands = distanceFit(attempts()).filter((b) => b.n >= 80);
    expect(bands.length).toBeGreaterThanOrEqual(3);
    let n = 0, goals = 0, valued = 0;
    for (const b of bands) {
      const r = b.measured / b.valued, se = Math.sqrt((b.measured * (1 - b.measured)) / b.n);
      n += b.n; goals += b.measured * b.n; valued += b.valued * b.n;
      const ok = (r >= 0.8 && r <= 1.25) || Math.abs(b.measured - b.valued) <= 2 * se;
      expect(ok, `${b.from}-${b.to} m: measured ${b.measured.toFixed(3)} of ${b.n} (se ${se.toFixed(3)}), valued ${b.valued.toFixed(3)}, ratio ${r.toFixed(2)}`).toBe(true);
    }
    expect(n).toBeGreaterThan(300);
    expect(goals / valued, `all free shots: ${goals.toFixed(0)} goals of ${n}, valued ${valued.toFixed(1)}`).toBeGreaterThanOrEqual(0.8);
    expect(goals / valued).toBeLessThanOrEqual(1.25);
  }, LONG);
});
