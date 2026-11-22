import { describe, it, expect } from 'vitest';
import { def, meanMiss, playmaker, rate, slotState, sniper } from './helpers';

describe('player brain', () => {
  it('a sniper in the slot shoots more than a playmaker does', () => {
    expect(rate('shoot', sniper, slotState)).toBeGreaterThan(rate('shoot', playmaker, slotState) + 0.1);
    expect(rate('pass', playmaker, slotState)).toBeGreaterThan(rate('pass', sniper, slotState));
  });
  it('no option is ever certain', () => { for (const k of ['shoot', 'pass', 'carry'] as const) { expect(rate(k, sniper, slotState)).toBeLessThan(0.97); } });
  it('better passers put the puck closer to the target', () => { expect(meanMiss(def({ passing: 95 }))).toBeLessThan(meanMiss(def({ passing: 45 })) * 0.7); });
});
