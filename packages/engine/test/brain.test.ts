import { describe, it, expect } from 'vitest';
import { def, heldFor, meanMiss, playmaker, rate, slotState, sniper, stateWith, withScore } from './helpers';

describe('player brain', () => {
  it('a sniper in the slot shoots more than a playmaker does', () => {
    expect(rate('shoot', sniper, slotState)).toBeGreaterThan(rate('shoot', playmaker, slotState) + 0.1);
    expect(rate('pass', playmaker, slotState)).toBeGreaterThan(rate('pass', sniper, slotState));
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
  it('vision changes which lane he picks, not how often he passes', () => {
    expect(Math.abs(rate('pass', def({ vision: 95 }), slotState) - rate('pass', def({ vision: 20 }), slotState))).toBeLessThan(0.15);
  });
});
