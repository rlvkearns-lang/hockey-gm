import { describe, it, expect } from 'vitest';
import { simulateGame } from '../../src/game';
import { bounceChance, hitAttemptChance, hitChance, hitDegreeChances, staggerCap } from '../../src/contests/hit';
import { startContest } from '../../src/contests/core';
import { hitContest } from '../../src/contests/hit';
import type { SkaterState } from '../../src/types';
import { def, duel, duelStep, hitOutcomes, landedHitEvents, hitsPer60, hitThatLands, runHit, setup, share, st as skaterState, target, targetsDuringHitClose } from '../helpers';

// ---- Task 9: degrees of a landed hit ----

/**
 * Shares of bump / stagger / knockdown among the landed hits of `n` checks (away C at 8 m/s from 1.5 m on the still home
 * C carrier; every other attribute 70): `sawIt` has the target facing the hitter, else facing away from him.
 */
function landedDegrees(o: { hitterKg: number; targetKg: number; sawIt: boolean }, n: number): Record<string, number> {
  const out: Record<string, number> = { bump: 0, stagger: 0, knockdown: 0 };
  let landed = 0;
  for (let i = 0; i < n; i++) {
    const h = duel(def({ weightKg: o.hitterKg }), def({ weightKg: o.targetKg }), 0.9, -8, 40_000 + i);
    if (!o.sawIt) h.st.skaters.find((k) => k.id === 'home-C')!.facing = Math.PI;
    startContest(h.st, h.ds, h.rng, hitContest, ['away-C', 'home-C'], h.events);
    for (let k = 0; k < 60 && !h.events.some((e) => e.type === 'hit'); k++) duelStep(h);
    const e = h.events.find((x) => x.type === 'hit');
    if (e?.type !== 'hit' || e.detail.result !== 'landed') continue;
    landed++;
    out[e.detail.degree!]!++;
  }
  for (const k of Object.keys(out)) out[k]! /= landed;
  return out;
}

/** The first check that lands as a stagger on a carrier skating across at 3 m/s: him, his speed just before and after, and the cap over the next half second. */
function staggerHit(): { target: SkaterState; speedBefore: number; speedAfter: number; capForHalfSecond: number; capAfter: number } {
  for (let i = 0; i < 400; i++) {
    const h = duel(def({ weightKg: 86 }), def({ weightKg: 92 }), 0.9, -7, 50_000 + i);
    const t = h.st.skaters.find((k) => k.id === 'home-C')!;
    t.vel = { x: 0, y: 3 }; t.target = { x: -0.6, y: 30 };
    startContest(h.st, h.ds, h.rng, hitContest, ['away-C', 'home-C'], h.events);
    let before = 3;
    for (let k = 0; k < 60 && !h.events.some((e) => e.type === 'hit'); k++) { before = Math.hypot(t.vel.x, t.vel.y); duelStep(h); }
    const e = h.events.find((x) => x.type === 'hit');
    if (e?.type !== 'hit' || e.detail.degree !== 'stagger') continue;
    const speedAfter = Math.hypot(t.vel.x, t.vel.y);
    let cap = 0;
    for (let k = 0; k < 14; k++) { cap = Math.max(cap, staggerCap(h.st, t.id)); h.st.tick++; }
    h.st.tick += 2;
    return { target: t, speedBefore: before, speedAfter, capForHalfSecond: cap, capAfter: staggerCap(h.st, t.id) };
  }
  throw new Error('no stagger in 400 checks');
}

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

describe('hits', () => {
  it('size and speed make hits land; the small man still wins some', () => {
    const big = share(2000, () => runHit(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6));
    const small = share(2000, () => runHit(def({ bodyChecking: 60, strength: 58, weightKg: 78 }), def({ balance: 88, strength: 90, weightKg: 104 }), 6));
    expect(big).toBeGreaterThan(small + 0.2); expect(small).toBeGreaterThanOrEqual(0.1);
    // true rate is about 0.71 (below the 0.9 parity cap); 0.8 allows sampling noise over 2,000 trials
    expect(big).toBeLessThanOrEqual(0.8);
    // The rule itself, without noise. Task 12 rescaled the momentum term (scale 12 -> 30, owner steer): this strong
    // matchup at 6 m/s was about 0.83. Task 12 close-out (style parity, the owner's rule that the power forward does not
    // always win): momentumScale 50 and attrScale 0.5, so it is about 0.71.
    expect(hitChance(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), skaterState({}), def({ balance: 62, strength: 60, weightKg: 80 }), skaterState({}), 6)).toBeCloseTo(0.7062, 4);
  });
  it('an ordinary mismatch at ordinary speed is an edge, an extreme one at speed a big one, still short of the cap', () => {
    // (Task 12 close-out: momentumScale 50 and attrScale 0.5 for style parity: ordinary 0.58 (was 0.6-0.8), extreme 0.75
    // (was 0.85-0.9).)
    const ordinary = hitChance(def({ weightKg: 95, bodyChecking: 75 }), skaterState({}), def({ weightKg: 85 }), skaterState({}), 5);
    expect(ordinary).toBeGreaterThan(0.55); expect(ordinary).toBeLessThan(0.8);
    const extreme = hitChance(def({ weightKg: 104, bodyChecking: 85, strength: 85 }), skaterState({}), def({ weightKg: 75, balance: 60, strength: 60 }), skaterState({}), 9);
    expect(extreme).toBeGreaterThan(0.7); expect(extreme).toBeLessThanOrEqual(0.9);
  });
  it('a failed hit does not always bounce the hitter off, even when he was the big favourite', () => {
    const o = hitOutcomes(def({ weightKg: 104, bodyChecking: 95, strength: 95 }), def({ weightKg: 75, balance: 50, strength: 50 }), 8, 1500);
    expect(o.absorbed! + o.bounced!).toBeGreaterThan(50);
    expect(o.bounced! / (o.absorbed! + o.bounced!)).toBeLessThan(0.3);
    expect(bounceChance(0.9)).toBeGreaterThanOrEqual(0.03); expect(bounceChance(0.1)).toBeLessThanOrEqual(0.97);
  });
  it('a landed hit that knocks the puck off the carrier is the hitter\'s turnover', () => {
    const e = landedHitEvents();
    expect(e.find((x) => x.type === 'turnover')).toMatchObject({ playerId: 'away-C', otherId: 'home-C', detail: { how: 'hit' } });
  });
  it('a landed hit has degrees, and a much heavier man who sees it coming is rarely put down', () => {
    const k = (o: { hitterKg: number; targetKg: number; sawIt: boolean }): Record<string, number> => landedDegrees(o, 2000);   // shares of bump / stagger / knockdown among landed hits, closing 8 m/s
    const heavy = k({ hitterKg: 82, targetKg: 100, sawIt: true }), light = k({ hitterKg: 100, targetKg: 82, sawIt: false }), level = k({ hitterKg: 90, targetKg: 90, sawIt: false });
    expect(heavy.knockdown).toBeLessThan(0.20); expect(heavy.knockdown).toBeGreaterThanOrEqual(0.03);
    expect(light.knockdown).toBeGreaterThan(0.75); expect(light.knockdown).toBeLessThanOrEqual(0.97);
    for (const d of ['bump', 'stagger', 'knockdown']) expect(level[d]).toBeGreaterThan(0.03);
    expect(k({ hitterKg: 90, targetKg: 90, sawIt: true }).knockdown).toBeLessThan(level.knockdown! - 0.1);
  }, 60_000);
  it('the degree chances follow the formula and are never certain', () => {
    // x = (closing - 6) * 0.25 + (hitterMass - targetMass) / 8 - (balance - 70) / 20 - (sawIt ? 0.8 : 0) + margin
    const c = hitDegreeChances(6, 90, 90, 70, false, 0.2);                           // x = 0.2
    expect(c.knockdown).toBeCloseTo(0.5, 9); expect(c.stagger).toBeCloseTo(1 / (1 + Math.exp(-1.4)), 9);
    const big = hitDegreeChances(20, 200, 60, 1, false, 1), small = hitDegreeChances(0, 60, 200, 99, true, 0);
    expect(big.knockdown).toBe(0.97); expect(big.stagger).toBe(0.97); expect(small.knockdown).toBe(0.03); expect(small.stagger).toBe(0.03);
  });
  it('a staggered man keeps his feet and loses a step', () => {
    const s = staggerHit();
    expect(s.target.downT).toBe(0); expect(s.speedAfter).toBeLessThan(s.speedBefore * 0.7); expect(s.capForHalfSecond).toBeLessThanOrEqual(0.4);
    expect(s.capAfter).toBe(1);
  });
  it('a landed hit puts the target down and frees the puck', () => { const st = hitThatLands(); expect(target(st).downT).toBeGreaterThan(0.5); expect(st.carrierId).toBeNull(); });
  it('the target keeps playing while the hitter closes: team play still gives him a job and a target', () => {
    const r = targetsDuringHitClose();
    expect(r.stages).toEqual(['close', 'close', 'close']);
    expect(r.freeIds.every((f) => f.length === 1)).toBe(true);
    // Targets are held now (commit.ts), so team play moves his target when it issues one, not every tick.
    expect(r.jobs.every((j) => j !== 'contest')).toBe(true);
    expect(Math.hypot(r.targets[0]!.x - r.start.x, r.targets[0]!.y - r.start.y)).toBeGreaterThan(0.01);
  });
  it('nobody always or never goes for a hit', () => {
    const t = def().tendencies;
    expect(hitAttemptChance(def({ tendencies: { ...t, hit: 0 } }))).toBe(0.03);
    expect(hitAttemptChance(def({ tendencies: { ...t, hit: 1 }, aggression: 100 }))).toBe(0.97);
  });
  it('enforcers hit more often than playmakers over a game', () => { const r = simulateGame(setup(3)); expect(hitsPer60(r, 'Enforcer', 'Grinder')).toBeGreaterThan(hitsPer60(r, 'Playmaker', 'Sniper')); }, GAME_TIMEOUT);
});
