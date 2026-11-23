import { describe, it, expect } from 'vitest';
import { def, raceWithRebound, runRace, share } from '../helpers';

describe('loose-puck races', () => {
  it('the closer man usually wins the race', () => { expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeGreaterThan(0.7); expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeLessThanOrEqual(0.9); });

  it('a dead heat is a coin flip, with some bounces that stay loose', () => {
    const r = Array.from({ length: 2000 }, () => runRace({ aLead: 0 }));
    const a = r.filter((x) => x.winner === 'a').length / 2000, loose = r.filter((x) => x.winner === null).length / 2000;
    expect(a).toBeGreaterThan(0.35); expect(a).toBeLessThan(0.5);
    expect(loose).toBeGreaterThan(0.1); expect(loose).toBeLessThan(0.22);
  });
  it('compete and agility tip a close race', () => {
    const keen = def({ compete: 90, agility: 88, balance: 85 }), slack = def({ compete: 55, agility: 60, balance: 60 });
    expect(share(2000, () => runRace({ aLead: 0, a: keen, b: slack }).winner === 'a')).toBeGreaterThan(share(2000, () => runRace({ aLead: 0 }).winner === 'a') + 0.1);
  });
  it('the man who won the net-front battle is first to the rebound', () => {
    expect(share(2000, () => raceWithRebound().winner === 'a')).toBeGreaterThan(share(2000, () => runRace({ aLead: 0 }).winner === 'a') + 0.06);
  });
  it('the race takes time and shows who is ahead', () => {
    const r = runRace({ aLead: 0.3 });
    expect(r.stages).toEqual(['race', 'resolve']);
    expect(r.seconds).toBeGreaterThan(0.4);
    expect(r.raceLeaders.every((l) => l === 'home-C')).toBe(true);
  });
});
