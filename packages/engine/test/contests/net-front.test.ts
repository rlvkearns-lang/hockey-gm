import { describe, it, expect } from 'vitest';
import { attackerId, canReceive, harnessStep, isScreened, netFrontEnded, netFrontStart, netFrontWonByAttacker, netFrontWonByDefender, netFrontRounds, even } from '../helpers';
import { RINK } from '../../src/rink';

/**
 * Of `n` net-front battles (seeded) whose defender starts 0.9 m from the attacker, anywhere from straight goal-side to
 * 110 degrees off it either way: over each battle's ticks after its first half second (at most 4 s), the share with the
 * defender within 0.6 m of the segment from the attacker to the centre of the net.
 */
function netFrontBetweenShare(n: number): number {
  let ticks = 0, between = 0;
  for (let seed = 1; seed <= n; seed++) {
    const off = ((seed % 23) / 22 * 2 - 1) * (110 * Math.PI / 180);
    const { h, c } = netFrontStart(even, even, {
      seed: 80_000 + seed,
      place: (st, spot) => {
        const net = { x: RINK.goalLineX, y: 0 }, a = Math.atan2(net.y - spot.y, net.x - spot.x) + off;
        const d = st.skaters.find((k) => k.id === 'away-LD')!;
        d.pos = { x: spot.x + Math.cos(a) * 0.9, y: spot.y + Math.sin(a) * 0.9 }; d.target = { ...d.pos };
      },
    });
    const st = h.st;
    const att = st.skaters.find((k) => k.id === 'home-C')!, def = st.skaters.find((k) => k.id === 'away-LD')!;
    for (let i = 0; i < 120 && st.contests.includes(c); i++) {
      harnessStep(h);
      if (i < 15 || !st.contests.includes(c)) continue;
      ticks++;
      const ax = att.pos.x, ay = att.pos.y, bx = RINK.goalLineX - ax, by = -ay, l2 = bx * bx + by * by;
      const t = Math.max(0, Math.min(1, ((def.pos.x - ax) * bx + (def.pos.y - ay) * by) / l2));
      if (Math.hypot(def.pos.x - (ax + t * bx), def.pos.y - (ay + t * by)) <= 0.6) between++;
    }
  }
  return between / ticks;
}

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
  it('the defender plays between the attacker and the net: within 0.6 m of that line for 85% of the battle after its first half second', () => { expect(netFrontBetweenShare(60)).toBeGreaterThan(0.85); });
  it('a net-front battle that has had a round credits its last winner with a battle', () => {
    const r = netFrontEnded(3);
    expect(r.leader).not.toBeNull();
    expect(r.battles).toHaveLength(1);
    expect(r.battles[0]).toMatchObject({ playerId: r.leader, detail: { how: 'netFront' } });
  });
});
