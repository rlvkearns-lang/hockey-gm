import { describe, it, expect } from 'vitest';
import { brainTick, decideCarrier } from '../src/brain';
import { createRng } from '../src/rng';
import type { GameState } from '../src/types';
import { def, defs, heldFor, meanMiss, place, playmaker, rate, skater, slotState, sniper, stateWith, withScore } from './helpers';

/**
 * Home C with the puck high in the zone at (14, 4), the two away defencemen low by the net and the rest of them away
 * from the play: both wingers in the slot and open (nearly as good a pass as each other), the points manned. Passing is a live choice here
 * for a sniper and for a playmaker alike (Task 5 review, Important 3). (Task 6 moved the defenders off the lanes for its
 * absolute lane rule; with Task 7's softer rule the Task 5 state, defenders near both wingers, makes passing a rare choice
 * for a sniper (0.06), so this state stays.)
 */
const passState = (): GameState => {
  const st = stateWith({ carrier: 'home', puckX: 14, puckY: 4, carrierSlot: 'C' });
  place(st, 'home:LW', 20.5, 2.5); place(st, 'home:RW', 21, -4.5); place(st, 'home:LD', 9, 8); place(st, 'home:RD', 9, -7);
  place(st, 'away:LD', 26, -3); place(st, 'away:RD', 25.5, 3); place(st, 'away:C', 17, 9.5); place(st, 'away:LW', 4, 11); place(st, 'away:RW', 4, -11);
  return st;
};


describe('player brain', () => {
  it('a sniper in the slot shoots more than a playmaker does', () => {
    expect(rate('shoot', sniper, slotState)).toBeGreaterThan(rate('shoot', playmaker, slotState) + 0.1);
  });
  it('where passing is a live choice, a playmaker passes at least 1.3 times as often as a sniper, and the sniper shoots more', () => {
    const st = passState();
    const pm = rate('pass', playmaker, st), sn = rate('pass', sniper, st);
    expect(sn).toBeGreaterThan(0.1); expect(pm).toBeLessThan(0.9); expect(pm).toBeGreaterThan(sn * 1.3);
    const snShoot = rate('shoot', sniper, st); expect(snShoot).toBeGreaterThan(0.03); expect(snShoot).toBeGreaterThan(rate('shoot', playmaker, st) * 3);
  });
  it('no option is ever certain', () => { for (const k of ['shoot', 'pass', 'carry'] as const) { expect(rate(k, sniper, slotState)).toBeLessThan(0.97); } });
  it('a pressured carrier in his own half dumps much less than one just past centre (icing)', () => {
    const dumper = def({ tendencies: { ...def().tendencies, dump: 1 } });
    const own = rate('dump', dumper, stateWith({ carrier: 'home', puckX: -2 })), past = rate('dump', dumper, stateWith({ carrier: 'home', puckX: 4 }));
    expect(own).toBeLessThan(past * 0.5);
    expect(rate('pass', dumper, stateWith({ carrier: 'home', puckX: -2 })) + rate('carry', dumper, stateWith({ carrier: 'home', puckX: -2 }))).toBeGreaterThan(own * 3);
  });
  it('better passers put the puck closer to the target', () => { expect(meanMiss(def({ passing: 95 }))).toBeLessThan(meanMiss(def({ passing: 45 })) * 0.7); });
  it('score effects are modest: comfortably behind he shoots a little more, ahead a little less', () => {
    const level = rate('shoot', sniper, slotState), behind = rate('shoot', sniper, withScore(slotState, 0, 5)), ahead = rate('shoot', sniper, withScore(slotState, 5, 0));
    expect(behind).toBeGreaterThan(level); expect(behind).toBeLessThan(level * 1.35);
    expect(ahead).toBeLessThan(level); expect(ahead).toBeGreaterThan(level * 0.75);
  });
  it('the longer he has had the puck, the more he moves it on', () => {
    expect(rate('pass', playmaker, heldFor(slotState, 10))).toBeGreaterThan(rate('pass', playmaker, heldFor(slotState, 0)) + 0.1);
    expect(rate('carry', playmaker, heldFor(slotState, 10))).toBeLessThan(rate('carry', playmaker, heldFor(slotState, 0)));
  });
  it('vision widens what he sees: on one read of the play a high-vision carrier passes to clearly more teammates', () => {
    const st = passState();
    const receivers = (vision: number): number => {
      const me = { ...def({ vision }), id: 'home-C', position: 'C' as const }; const ds = new Map(defs); ds.set('home-C', me);
      let total = 0;
      for (let read = 1; read <= 20; read++) {
        st.carrierPlan = { id: 'home-C', kind: 'carry', lane: null, toId: null, to: null, tick: 0, seed: read * 7919 };
        const to = new Set<string>();
        for (let seed = 1; seed <= 300; seed++) { const d = decideCarrier(st, me, ds, createRng(seed)); if (d.kind === 'pass') to.add(d.toId); }
        total += to.size;
      }
      return total / 20;
    };
    const low = receivers(20), high = receivers(95);
    expect(low).toBeLessThanOrEqual(1); expect(high).toBeGreaterThan(low + 0.5);
  });
});

describe('decision points do not flicker (Task 8b)', () => {
  /**
   * The home LW carries low on the wall for `seconds`, the puck put back on his stick whenever he lets it go (his plan
   * is kept), with the away LD `far` (6 m off) or on him (1.4 m off) as `where(t)` says: each decision's trigger.
   */
  function triggers(seconds: number, where: (t: number) => 'far' | 'on'): string[] {
    const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9, carrierSlot: 'LW' });
    place(st, 'home:C', 24.5, 0.5); place(st, 'home:RW', 18, -9); place(st, 'home:LD', 10, 7); place(st, 'home:RD', 10, -7);
    place(st, 'away:RD', 24.5, -2); place(st, 'away:C', 18, 0); place(st, 'away:LW', 12, 4); place(st, 'away:RW', 12, -5);
    const lw = skater(st, 'home', 'LW'), ld = skater(st, 'away', 'LD');
    const home = { x: lw.pos.x, y: lw.pos.y }, puck = { x: st.puck.pos.x, y: st.puck.pos.y };
    const rng = createRng(5); const why: string[] = [];
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      st.tick++;
      // Everyone stays where he is: only the checker comes and goes.
      lw.pos = { ...home }; lw.vel = { x: 0, y: 0 }; st.puck.pos = { ...puck }; st.puck.vel = { x: 0, y: 0 };
      ld.pos = where(t / 30) === 'on' ? { x: home.x + 1.0, y: home.y - 1.0 } : { x: home.x - 1, y: home.y - 6 };
      st.carrierId = 'home-LW'; st.pendingPass = null; st.shotInFlight = null; st.pickupBlock = null; st.phase = 'live';
      brainTick(st, defs, rng, []);
      const plan = st.carrierPlan;
      if (plan !== null && plan.tick === st.tick) why.push(plan.why ?? '?');
      // What he let go comes back to him; his plan stays his.
      if (st.carrierId === null && plan !== null) { st.carrierId = 'home-LW'; st.carrierPlan = plan; }
    }
    return why;
  }
  it('a checker who arrives and stays within reach for 3 s is one pressure decision, and steady pressure is under 1.5 decisions a second', () => {
    const why = triggers(4, (t) => (t >= 1 ? 'on' : 'far'));
    expect(why.filter((w) => w === 'pressure').length).toBe(1);
    const steady = triggers(6, () => 'on');
    expect(steady.filter((w) => w === 'pressure').length).toBe(0);
    expect(steady.length / 6).toBeLessThan(1.5); expect(steady.length).toBeGreaterThanOrEqual(1);
  });
  it('pressure that leaves is no decision point, and a checker hovering at the edge of reach does not re-trigger', () => {
    // On him for a second, then gone: one arrival, nothing when he leaves.
    expect(triggers(4, (t) => (t >= 1 && t < 2 ? 'on' : 'far')).filter((w) => w === 'pressure').length).toBe(1);
    // In and out every 0.2 s for 3 s: the cooldown lets through at most one arrival a second and a half.
    expect(triggers(4, (t) => (t >= 1 && Math.floor(t * 5) % 2 === 0 ? 'on' : 'far')).filter((w) => w === 'pressure').length).toBeLessThanOrEqual(2);
  });
});
