/**
 * Task 13b item 1: the hard clear. A carrier in his own zone can fire or flip the puck down the ice (off the glass along
 * his side, or up the middle), giving up the puck for territory and a line change, at the risk of icing.
 */
import { describe, it, expect } from 'vitest';
import { hardClearOutlook, listOptions, type Option } from '../src/options';
import { executeHardClear, tryKnockDown } from '../src/actions';
import { refereeTick } from '../src/referee';
import { stepPuck } from '../src/puck';
import { DT } from '../src/constants';
import { RINK } from '../src/rink';
import { createRng } from '../src/rng';
import type { GameEvent, GameState, SkaterState } from '../src/types';
import { def, defs, firstLook, place, stateWith } from './helpers';

/**
 * Home LD has the puck deep in his own corner (home defends -x) with an away forechecker on him, 1.3 m off, his line a
 * while into its shift under pressure (energy 0.85; `tired`: 0.6). Every teammate has a man on him (no safe pass); the
 * away defencemen hold the blue line. With `outlet`, home C stands open in the middle of the zone, his man gone up ice.
 */
function pinned(o: { outlet?: boolean; tired?: boolean } = {}): GameState {
  const st = stateWith({ carrier: 'home', puckX: -24, puckY: 9, carrierSlot: 'LD' });
  place(st, 'home:LD', -24, 9.6);
  place(st, 'away:C', -23.2, 10.6);
  place(st, 'home:RD', -24, -6); place(st, 'away:LW', -23, -5.6);
  place(st, 'home:C', -18, 2); place(st, 'away:RW', -17.2, 1.6);
  place(st, 'home:LW', -12, 11); place(st, 'away:LD', -11, 10.6);
  place(st, 'home:RW', -12, -10); place(st, 'away:RD', -11, -9.6);
  if (o.outlet) { place(st, 'home:C', -17, 4); place(st, 'away:RW', 2, 0); }
  for (const s of st.skaters) if (s.side === 'home') s.energy = o.tired ? 0.6 : 0.85;
  // (Task 14) He has had it a second and faces up ice: he can fire it.
  const c = st.skaters.find((k) => k.id === st.carrierId)!;
  c.facing = 0;
  st.touches = { side: c.side, ids: [c.id], ticks: [st.tick - 60] };
  return st;
}

/** Share of `kind` among n first looks (helpers.ts firstLook, seeds 1..n) by the carrier of `st`. */
function share(st: GameState, kind: string, n = 2000): number {
  const id = st.carrierId!;
  const me = { ...def({ id, position: 'LD' }) };
  const ds = new Map(defs); ds.set(id, me);
  let k = 0;
  for (let seed = 1; seed <= n; seed++) if (firstLook(st, me, ds, createRng(seed)).kind === kind) k++;
  return k / n;
}

/** Put `s` still at (x, y). */
const put = (s: SkaterState, x: number, y: number): void => { s.pos = { x, y }; s.target = { x, y }; s.vel = { x: 0, y: 0 }; };
const optionsOf = (st: GameState): Option[] => listOptions(st, defs.get(st.carrierId!)!, defs, []);

describe('the hard clear (Task 13b)', () => {
  it('is on the list in his own zone, never elsewhere', () => {
    expect(optionsOf(pinned()).some((o) => o.kind === 'hardClear')).toBe(true);
    const nz = stateWith({ carrier: 'home', puckX: 0, carrierSlot: 'LD' });
    expect(optionsOf(nz).some((o) => o.kind === 'hardClear')).toBe(false);
    const oz = stateWith({ carrier: 'home', puckX: 15, carrierSlot: 'LD' });
    expect(optionsOf(oz).some((o) => o.kind === 'hardClear')).toBe(false);
  });
  it('pressured deep in his zone with no pass he fires it down the ice 20% to 60% of the time; with an open man he almost never does (under 5%)', () => {
    const none = share(pinned(), 'hardClear'), outlet = share(pinned({ outlet: true }), 'hardClear');
    expect(none).toBeGreaterThanOrEqual(0.2); expect(none).toBeLessThanOrEqual(0.6);
    expect(outlet).toBeLessThan(0.05);
  }, 60_000);
  // Task 14 (headline 2: a last resort; Task 13b review Minors 5 and 6).
  it('is a last resort: with the forechecker closing but not yet on him (1.7 m off), it is not on his list', () => {
    const st = pinned();
    place(st, 'away:C', -22.64, 10.62); // 1.7 m from him: closing, not yet on him
    expect(optionsOf(st).some((o) => o.kind === 'hardClear')).toBe(false);
  });
  it('he cannot fire it the moment he gets it, nor with his back to where it must go', () => {
    const fresh = pinned();
    fresh.touches = { side: 'home', ids: [fresh.carrierId!], ticks: [fresh.tick - 6] }; // 0.1 s with it
    expect(optionsOf(fresh).some((o) => o.kind === 'hardClear')).toBe(false);
    const turned = pinned();
    turned.skaters.find((k) => k.id === turned.carrierId)!.facing = Math.PI; // facing his own end boards
    expect(optionsOf(turned).some((o) => o.kind === 'hardClear')).toBe(false);
    expect(optionsOf(pinned()).some((o) => o.kind === 'hardClear')).toBe(true);
  });
  it('the icing race it expects leaves out a man heading off for a change, as the referee does', () => {
    const st = stateWith({ carrier: 'home', puckX: -24, puckY: 11.5, carrierSlot: 'LD' }); // by the boards: off the glass, to the far end
    const me = defs.get(st.carrierId!)!;
    const carrier = st.skaters.find((k) => k.id === st.carrierId)!;
    place(st, 'home:LW', 10, 11); // a home man far up ice: he wins the race to the far dots, so icing is less likely
    const withHim = hardClearOutlook(st, carrier, me, defs, { knocked: 0, knockRx: 0, knockLy: 0, reaches: false, ice: 0, win: 0, rx: 0, ly: 0 }).ice;
    st.skaters.find((k) => k.side === 'home' && k.slot === 'LW')!.leaving = true;
    const leaving = hardClearOutlook(st, carrier, me, defs, { knocked: 0, knockRx: 0, knockLy: 0, reaches: false, ice: 0, win: 0, rx: 0, ly: 0 }).ice;
    expect(withHim).toBeGreaterThan(0); expect(leaving).toBeGreaterThan(withHim + 0.05);
  });
  it('a tired line clears it more', () => {
    expect(share(pinned({ tired: true }), 'hardClear')).toBeGreaterThan(share(pinned(), 'hardClear'));
  }, 60_000);
  it('fired from his own zone with nobody in the way it reaches the far end, watched for icing, and is called icing when the other team wins the race', () => {
    const st = pinned();
    // Nobody of the other team near its path; their defencemen back at their own end.
    for (const s of st.skaters) if (s.side === 'away') put(s, -20, s.pos.y > 0 ? 3 : -3);
    place(st, 'away:LD', 22, 4); place(st, 'away:RD', 22, -4);
    const out: GameEvent[] = [];
    executeHardClear(st, st.carrierId!, defs, createRng(4), out);
    const pass = out.find((e) => e.type === 'pass');
    expect(pass?.detail).toMatchObject({ kind: 'clear', hard: true });
    expect(st.icingWatch?.side).toBe('home');
    expect(st.hardClear?.side).toBe('home');
    let call: GameEvent | null = null, maxZ = 0;
    for (let i = 0; i < 400 && call === null; i++) {
      const prev = st.puck.pos.x;
      stepPuck(st.puck, DT);
      maxZ = Math.max(maxZ, st.puck.z);
      st.tick++;
      call = refereeTick(st, prev, defs);
    }
    expect(call?.type).toBe('icing');
    expect(maxZ).toBeGreaterThan(0.5);
  });
  it('a point man in its path knocks it down now and then, and then it is his', () => {
    let knocked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const st = pinned();
      // Middle of the ice: flipped up the middle; the away LD stands in its path 4 m out, before it is over his head.
      place(st, 'home:LD', -24, 0.6); st.puck.pos = { x: -23.4, y: 0.6 }; place(st, 'away:C', -23, 2);
      place(st, 'away:LD', -19.5, 1); place(st, 'away:RW', -17, 6);
      const rng = createRng(seed);
      executeHardClear(st, st.carrierId!, defs, rng, []);
      for (let i = 0; i < 90; i++) {
        const prev = { x: st.puck.pos.x, y: st.puck.pos.y };
        stepPuck(st.puck, DT);
        st.tick++;
        const e = tryKnockDown(st, defs, rng, prev);
        if (e) { knocked++; expect(e.playerId).toBe('away-LD'); expect(st.hardClear).toBeNull(); expect(Math.hypot(st.puck.vel.x, st.puck.vel.y)).toBeLessThan(6); break; }
      }
    }
    expect(knocked / 400).toBeGreaterThan(0.05); expect(knocked / 400).toBeLessThan(0.6);
  });
  it('off the glass from the half-wall: lifted into the glass on his side, under its top, and out of the zone', () => {
    const st = pinned();
    place(st, 'home:LD', -20, 12.2); st.puck.pos = { x: -19.6, y: 12.0 }; place(st, 'away:C', -19, 11);
    for (const s of st.skaters) if (s.side === 'away' && s.slot !== 'C') put(s, 20, 0);
    executeHardClear(st, st.carrierId!, defs, createRng(2), []);
    let maxZ = 0, out = false;
    for (let i = 0; i < 180; i++) {
      const ev = stepPuck(st.puck, DT);
      if (ev.some((e) => e.kind === 'outOfPlay')) out = true;
      maxZ = Math.max(maxZ, st.puck.z);
    }
    expect(out).toBe(false);
    expect(maxZ).toBeGreaterThan(1);
    expect(st.puck.pos.x).toBeGreaterThan(-RINK.blueLineX);
  });
});
