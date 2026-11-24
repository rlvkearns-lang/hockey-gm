import { describe, it, expect } from 'vitest';
import { decideCarrier } from '../src/brain';
import { createRng } from '../src/rng';
import type { GameState } from '../src/types';
import { def, defs, heldFor, meanMiss, place, playmaker, rate, slotState, sniper, stateWith, withScore } from './helpers';

/**
 * Home C with the puck high in the zone at (14, 4): both wingers low and open but each with a defender near his lane,
 * both defencemen at the points, the away C a step off the carrier. Passing is a live choice here for a sniper and for
 * a playmaker alike (Task 5 review, Important 3).
 */
const passState = (): GameState => {
  const st = stateWith({ carrier: 'home', puckX: 14, puckY: 4, carrierSlot: 'C' });
  place(st, 'home:LW', 22.5, 6); place(st, 'home:RW', 21, -4.5); place(st, 'home:LD', 9, 8); place(st, 'home:RD', 9, -7);
  place(st, 'away:LD', 21.8, -3.95); place(st, 'away:RD', 22.4, 5.45); place(st, 'away:C', 16.5, 3.4); place(st, 'away:LW', 12, 8.5); place(st, 'away:RW', 12, -6);
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
    expect(rate('shoot', sniper, st)).toBeGreaterThan(rate('shoot', playmaker, st) + 0.05);
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
    expect(low).toBeLessThanOrEqual(1); expect(high).toBeGreaterThan(low + 0.8);
  });
});
