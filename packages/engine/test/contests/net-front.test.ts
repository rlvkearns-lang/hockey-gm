import { describe, it, expect } from 'vitest';
import { attackerId, canReceive, isScreened, netFrontEnded, netFrontWonByAttacker, netFrontWonByDefender, netFrontRounds } from '../helpers';

describe('net-front battles', () => {
  it('a net-front winner screens the goalie', () => { const st = netFrontWonByAttacker(); expect(isScreened(st)).toBe(true); });
  it('a tied-up forward cannot take a pass', () => { const st = netFrontWonByDefender(); expect(canReceive(st, attackerId)).toBe(false); });

  it('a forward who holds his ground can take a pass', () => { const st = netFrontWonByAttacker(); expect(canReceive(st, attackerId)).toBe(true); });
  it('jostles every 1.2 s, and the stage and leader follow each round', () => {
    const r = netFrontRounds(6);
    expect(r.stages[0]).toBe('jostle');
    expect(r.roundTimes.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < r.roundTimes.length; i++) expect(r.roundTimes[i]! - r.roundTimes[i - 1]!).toBeCloseTo(1.2, 5);
    for (const x of r.rounds) expect(x.stage).toBe(x.leader === attackerId ? 'free' : 'tied');
  });
  it('the defender pushes a tied-up forward out about 1.5 m', () => {
    const r = netFrontRounds(6);
    const tied = r.rounds.find((x) => x.stage === 'tied');
    expect(tied).toBeDefined();
    expect(tied!.attackerTarget).toBeGreaterThan(1.4);
    expect(tied!.attackerTarget).toBeLessThan(1.6);
  });
  it('a net-front battle that has had a round credits its last winner with a battle', () => {
    const r = netFrontEnded(3);
    expect(r.leader).not.toBeNull();
    expect(r.battles).toHaveLength(1);
    expect(r.battles[0]).toMatchObject({ playerId: r.leader, detail: 'netFront' });
  });
});
