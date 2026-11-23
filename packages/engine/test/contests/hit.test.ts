import { describe, it, expect } from 'vitest';
import { simulateGame } from '../../src/game';
import { hitChance } from '../../src/contests/hit';
import { def, hitsPer60, hitThatLands, runHit, setup, share, st as skaterState, target } from '../helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

describe('hits', () => {
  it('size and speed make hits land; the small man still wins some', () => {
    const big = share(2000, () => runHit(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6));
    const small = share(2000, () => runHit(def({ bodyChecking: 60, strength: 58, weightKg: 78 }), def({ balance: 88, strength: 90, weightKg: 104 }), 6));
    expect(big).toBeGreaterThan(small + 0.2); expect(small).toBeGreaterThanOrEqual(0.1);
    // true rate is the 0.9 parity cap; 0.92 allows sampling noise over 2,000 trials
    expect(big).toBeLessThanOrEqual(0.92);
    // The rule itself, without noise: the chance the hit code computes for this matchup is exactly the cap, never above.
    expect(hitChance(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), skaterState({}), def({ balance: 62, strength: 60, weightKg: 80 }), skaterState({}), 6)).toBe(0.9);
  });
  it('a landed hit puts the target down and frees the puck', () => { const st = hitThatLands(); expect(target(st).downT).toBeGreaterThan(0.5); expect(st.carrierId).toBeNull(); });
  it('enforcers hit more often than playmakers over a game', () => { const r = simulateGame(setup(3)); expect(hitsPer60(r, 'Enforcer', 'Grinder')).toBeGreaterThan(hitsPer60(r, 'Playmaker', 'Sniper')); }, GAME_TIMEOUT);
});
