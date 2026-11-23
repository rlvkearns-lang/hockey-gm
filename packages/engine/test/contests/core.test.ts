import { describe, it, expect } from 'vitest';
import { chemistryWith, contestTick, effective, winProb } from '../../src/contests/core';
import { DT } from '../../src/constants';
import { interceptChance } from '../../src/actions';
import { stopPlay } from '../../src/faceoff';
import { d, def, interceptedPasses, interceptShare, st, startPoke, stateOf } from '../helpers';

describe('contest core', () => {
  it('parity curve', () => { expect(winProb(0)).toBeCloseTo(0.5, 5); expect(winProb(15)).toBeGreaterThan(0.62); expect(winProb(15)).toBeLessThan(0.68); expect(winProb(500)).toBe(0.9); expect(winProb(-500)).toBe(0.1); expect(winProb(10) + winProb(-10)).toBeCloseTo(1, 5); });
  it('tired or out-of-form players are worse, a little', () => { const w = { strength: 1 }; expect(effective(d, st({ energy: 0 }), w)).toBeCloseTo(effective(d, st({ energy: 1 }), w) - 8, 0); });
  it('form and morale move a rating up to 4 points each, chemistry up to 3', () => {
    const w = { strength: 1 }, base = effective(d, st({}), w);
    expect(effective({ ...d, form: 1 }, st({}), w)).toBeCloseTo(base + 4, 5);
    expect(effective({ ...d, morale: -1 }, st({}), w)).toBeCloseTo(base - 4, 5);
    expect(effective(d, st({}), w, 1)).toBeCloseTo(base + 3, 5);
    expect(effective(d, st({}), w, -1)).toBeCloseTo(base - 3, 5);
  });
  it('chemistry is the mean over the teammates in the contest, unknown pairs counting 0', () => {
    const pairs = [{ a: 'x', b: 'y', value: 0.8 }, { a: 'z', b: 'x', value: -0.4 }];
    expect(chemistryWith(pairs, 'x', [])).toBe(0);
    expect(chemistryWith(pairs, 'x', ['y'])).toBeCloseTo(0.8, 5);
    expect(chemistryWith(pairs, 'x', ['y', 'z'])).toBeCloseTo(0.2, 5);
    expect(chemistryWith(pairs, 'x', ['y', 'w'])).toBeCloseTo(0.4, 5);
  });
  it('a whistle ends every contest and frees its players', () => {
    const c = startPoke(); const s = stateOf(c);
    expect(s.skaters.filter((k) => k.contestId === c.id).length).toBe(2);
    stopPlay(s, { x: 0, y: 0 });
    expect(s.contests).toEqual([]); expect(s.skaters.every((k) => k.contestId === null)).toBe(true);
  });
  it('nothing starts or runs while play is not live', () => {
    const c = startPoke(); const s = stateOf(c); stopPlay(s, { x: 0, y: 0 });
    contestTick(s, new Map([...s.skaters].map((k) => [k.id, def({ id: k.id })])), { next: () => 0.5 } as never, DT);
    expect(s.contests).toEqual([]);
  });
});

describe('interceptions', () => {
  it('a good defender in the lane intercepts more often than a poor one, neither always', () => {
    const good = interceptShare(def({ stickChecking: 92, defensivePositioning: 90 }), 2000);
    const poor = interceptShare(def({ stickChecking: 40, defensivePositioning: 40 }), 2000);
    expect(good).toBeGreaterThan(poor + 0.08); expect(good).toBeLessThan(0.97); expect(poor).toBeGreaterThan(0.03);
  });
  it('parity: the interception chance stays within [0.03, 0.97], even for a weak defender against a hard pass', () => {
    expect(interceptChance(def({ stickChecking: 1, defensivePositioning: 1 }), 40)).toBeGreaterThanOrEqual(0.03);
    expect(interceptChance(def({ stickChecking: 100, defensivePositioning: 100 }), 5)).toBeLessThanOrEqual(0.97);
  });
  it('an intercepted or deflected pass is a turnover won by the interceptor off the passer', () => {
    const evs = interceptedPasses(def({ stickChecking: 92, defensivePositioning: 90 }), 300);
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) expect(e).toMatchObject({ type: 'turnover', side: 'away', playerId: 'away-LD', otherId: 'home-C' });
  });
});
