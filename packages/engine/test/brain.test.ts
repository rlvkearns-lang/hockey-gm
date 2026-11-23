import { describe, it, expect } from 'vitest';
import { def, meanMiss, playmaker, rate, slotState, sniper, stateWith } from './helpers';

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
  it('vision changes which lane he picks, not how often he passes', () => {
    expect(rate('pass', def({ vision: 95 }), slotState)).toBe(rate('pass', def({ vision: 20 }), slotState));
  });
});
