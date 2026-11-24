import { describe, it, expect } from 'vitest';
import { clearPathToNet, dangerMan, laneOpen, laneWidth } from '../src/lanes';
import { place, skater, stateWith } from './helpers';

describe('passing lanes', () => {
  it('lane width is the nearest standing opponent to the lane; a downed one does not count', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 });
    for (const s of st.skaters) if (s.side === 'away') place(st, `away:${s.slot}` as never, -25, s.pos.y > 0 ? 11 : -11);
    place(st, 'away:C', 5, 2);
    expect(laneWidth(st, 'home', { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(2, 6);
    skater(st, 'away', 'C').downT = 1;
    expect(laneWidth(st, 'home', { x: 0, y: 0 }, { x: 10, y: 0 })).toBeGreaterThan(9);
  });
  it('a lane is open with a metre of ice round it and nobody within 1.5 m of the receiver', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 });
    for (const s of st.skaters) if (s.side === 'away') place(st, `away:${s.slot}` as never, -25, s.pos.y > 0 ? 11 : -11);
    place(st, 'away:C', 5, 1.1);
    expect(laneOpen(st, 'home', { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
    place(st, 'away:C', 5, 0.9);
    expect(laneOpen(st, 'home', { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(false);
    place(st, 'away:C', 11.2, 0.5);                                                       // off the lane, but on the receiver
    expect(laneOpen(st, 'home', { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(false);
  });
  it('a clear path to the net: nobody ahead within 2.5 m of his line to it', () => {
    const st = stateWith({ carrier: 'home', puckX: 15, carrierSlot: 'C' });
    for (const s of st.skaters) if (s.side === 'away') place(st, `away:${s.slot}` as never, -25, s.pos.y > 0 ? 11 : -11);
    const c = skater(st, 'home', 'C');
    expect(clearPathToNet(st, c)).toBe(true);
    place(st, 'away:LD', 21, 2);                                                         // ahead, 2 m off his line
    expect(clearPathToNet(st, c)).toBe(false);
    place(st, 'away:LD', 12, 0);                                                         // behind him
    expect(clearPathToNet(st, c)).toBe(true);
  });
  it('the most dangerous teammate is the one in the slot, not the one on the point', () => {
    const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9 });
    place(st, 'home:C', 21, 0); place(st, 'home:LW', 24, 11); place(st, 'home:LD', 9, 8); place(st, 'home:RD', 9, -8);
    expect(dangerMan(st, skater(st, 'home', 'RW'))!.id).toBe('home-C');
    for (const s of st.skaters) if (s.side === 'home' && s.slot !== 'RW') place(st, `home:${s.slot}` as never, 0, 0);
    expect(dangerMan(st, skater(st, 'home', 'RW'))).toBeNull();
  });
});
