import { describe, it, expect } from 'vitest';
import { simulateGame } from '../../src/game';
import { bounceChance, hitAttemptChance, hitChance } from '../../src/contests/hit';
import { def, hitOutcomes, landedHitEvents, hitsPer60, hitThatLands, runHit, setup, share, st as skaterState, target, targetsDuringHitClose } from '../helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

describe('hits', () => {
  it('size and speed make hits land; the small man still wins some', () => {
    const big = share(2000, () => runHit(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6));
    const small = share(2000, () => runHit(def({ bodyChecking: 60, strength: 58, weightKg: 78 }), def({ balance: 88, strength: 90, weightKg: 104 }), 6));
    expect(big).toBeGreaterThan(small + 0.2); expect(small).toBeGreaterThanOrEqual(0.1);
    // true rate is about 0.83 (below the 0.9 parity cap); 0.92 allows sampling noise over 2,000 trials
    expect(big).toBeLessThanOrEqual(0.92);
    // The rule itself, without noise. Task 12 rescaled the momentum term (scale 12 -> 30, owner steer): this strong
    // matchup at 6 m/s is about 0.83, no longer the 0.9 cap; only an extreme one at high speed nears the cap.
    expect(hitChance(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), skaterState({}), def({ balance: 62, strength: 60, weightKg: 80 }), skaterState({}), 6)).toBeCloseTo(0.8341, 4);
  });
  it('an ordinary mismatch at ordinary speed is a clear edge, an extreme one at speed nears the cap', () => {
    const ordinary = hitChance(def({ weightKg: 95, bodyChecking: 75 }), skaterState({}), def({ weightKg: 85 }), skaterState({}), 5);
    expect(ordinary).toBeGreaterThan(0.6); expect(ordinary).toBeLessThan(0.8);
    const extreme = hitChance(def({ weightKg: 104, bodyChecking: 85, strength: 85 }), skaterState({}), def({ weightKg: 75, balance: 60, strength: 60 }), skaterState({}), 9);
    expect(extreme).toBeGreaterThan(0.85); expect(extreme).toBeLessThanOrEqual(0.9);
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
