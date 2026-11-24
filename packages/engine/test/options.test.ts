import { describe, it, expect } from 'vitest';
import { chooseOption, listOptions, readSituation, threat, type Option } from '../src/options';
import { decideCarrier, type Decision } from '../src/brain';
import { contestTick } from '../src/contests/core';
import { executeRim } from '../src/actions';
import { crossesEndBox } from '../src/lanes';
import { DT } from '../src/constants';
import { createRng } from '../src/rng';
import type { GameState, PlayerDef, SkaterState } from '../src/types';
import { def, defs, place, playmaker, skater, sniper, stateWith, tactics } from './helpers';

/** decideCarrier for seeds 1..n with `d` (given the carrier's id and slot) as the carrier in `st`. */
function decisions(st: GameState, d: PlayerDef, n: number): Decision[] {
  const id = st.carrierId!;
  const carrier = st.skaters.find((s) => s.id === id)!;
  const me = { ...d, id, position: carrier.slot ?? d.position };
  const ds = new Map(defs);
  ds.set(id, me);
  const out: Decision[] = [];
  for (let seed = 1; seed <= n; seed++) out.push(decideCarrier(st, me, ds, createRng(seed), tactics.home));
  return out;
}
const skaterById = (st: GameState, id: string): SkaterState => st.skaters.find((s) => s.id === id)!;

const breakaway = (x: number): GameState => {
  const st = stateWith({ carrier: 'home', puckX: x, carrierSlot: 'C' });
  for (const s of st.skaters) { if (s.side === 'away') s.pos = { x: x - 6 - Math.abs(s.pos.y), y: s.pos.y }; else if (s.id !== 'home-C') s.pos.x = x - 8; }
  place(st, 'home:LD', x - 14, 6); place(st, 'home:RD', x - 14, -6); return st;
};

/**
 * Home RW carries at (17.4, 10) in the zone: home C open at (20, 5) is the best option; home LW at (24, 8) is covered;
 * three defenders are goal-side (no breakaway, no odd-man rush) and the other two far up ice.
 */
const oneBestPass = (): GameState => {
  const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 });
  place(st, 'home:C', 20, 5); place(st, 'home:LW', 24, 8);
  for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 5, y: s.pos.y };
  place(st, 'away:RD', 24.6, 8.4); place(st, 'away:LD', 24.5, 1); place(st, 'away:C', 23.5, 4);
  return st;
};

describe('the carrier values his options', () => {
  it('a breakaway never passes backward, never dumps and never just protects: 2,000 seeds at three spots', () => {
    for (const x of [3, 12, 21]) {
      const st = breakaway(x); expect(readSituation(st, skater(st, 'home', 'C')).breakaway).toBe(true);
      for (const d of decisions(st, def({}), 2000)) {
        expect(['dump', 'protect', 'rim', 'clear']).not.toContain(d.kind);
        if (d.kind === 'pass') expect(skaterById(st, d.toId).pos.x).toBeGreaterThanOrEqual(x - 0.6 - 1);
        if (d.kind === 'carry') expect(d.lane).toBe('net');
      }
    }
  }, 30_000);
  it('a clear path to the net is taken: outside shooting range he carries at the net at least 95% of the time', () => {
    const ds = decisions(breakaway(3), def({}), 2000); expect(ds.filter((d) => d.kind === 'carry' && d.lane === 'net').length / 2000).toBeGreaterThanOrEqual(0.95);
  });
  it('a 2-on-1 passes only across or ahead', () => {
    const st = breakaway(10); place(st, 'home:LW', 10.5, 7); place(st, 'away:LD', 17, 2);
    expect(readSituation(st, skater(st, 'home', 'C')).oddMan).toBe(true);
    const ds = decisions(st, def({}), 2000); expect(ds.some((d) => d.kind === 'pass' && d.toId === 'home-LW')).toBe(true);
    for (const d of ds) if (d.kind === 'pass') expect(d.toId).toBe('home-LW');
  });
  it('under pressure down low he protects, cycles or shoots: never a throw to the point', () => {
    const st = stateWith({ carrier: 'home', puckX: 24, puckY: 10, carrierSlot: 'LW' }); place(st, 'away:LD', 24.4, 9.2); place(st, 'home:LD', 9.1, 8.5); place(st, 'home:RD', 9.1, -4);
    expect(readSituation(st, skater(st, 'home', 'LW')).pressuredLow).toBe(true);
    for (const d of decisions(st, def({}), 2000)) { expect(['protect', 'rim', 'shoot', 'pass', 'carry']).toContain(d.kind); if (d.kind === 'pass') expect(['home-LD', 'home-RD']).not.toContain(d.toId); }
  });
  it('behind the net he holds it, passes out front or wraps: all three happen, and he is not sent straight back out', () => {
    const st = stateWith({ carrier: 'home', puckX: 28.9, puckY: 1, carrierSlot: 'C' }); place(st, 'home:LW', 22, 1); place(st, 'away:LD', 26, 0.5);
    expect(readSituation(st, skater(st, 'home', 'C')).behindNet).toBe(true);
    const ds = decisions(st, def({}), 2000); const share = (f: (d: Decision) => boolean): number => ds.filter(f).length / 2000;
    expect(share((d) => d.kind === 'carry' && d.lane === 'hold')).toBeGreaterThan(0.15);
    expect(share((d) => d.kind === 'pass')).toBeGreaterThan(0.10);
    expect(share((d) => d.kind === 'carry' && d.lane === 'wrap')).toBeGreaterThan(0.03);
  });
  it('a shadowed lane is tried less: a defender\'s stick in the lane at least halves the passes into it', () => {
    const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 }); place(st, 'home:C', 22, 0); for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 5, y: s.pos.y };
    const open = decisions(st, playmaker, 2000).filter((d) => d.kind === 'pass' && d.toId === 'home-C').length;
    place(st, 'away:C', 20.2, 5.4); // 0.5 m off the lane
    const shadowed = decisions(st, playmaker, 2000).filter((d) => d.kind === 'pass' && d.toId === 'home-C').length;
    expect(open).toBeGreaterThan(200); expect(shadowed).toBeLessThan(open * 0.5); expect(shadowed).toBeGreaterThan(0);
  });
  it('a smart player takes the best option more often than a limited one, who sometimes forces it', () => {
    const st = oneBestPass();
    const best = (d: PlayerDef): number => decisions(st, d, 2000).filter((x) => x.kind === 'pass' && x.toId === 'home-C').length / 2000;
    expect(best(def({ iq: 95, vision: 95, poise: 95 }))).toBeGreaterThan(best(def({ iq: 35, vision: 35, poise: 35 })) + 0.1);
  });
  it('threat grows toward the net: own zone under neutral zone under the point under the slot', () => {
    expect(threat(-20, 0)).toBeLessThan(threat(0, 0)); expect(threat(0, 0)).toBeLessThan(threat(10, 8)); expect(threat(10, 8)).toBeLessThan(threat(22, 0)); expect(threat(22, 0)).toBeLessThan(0.25);
  });
  it('valuing the options costs under 0.15 ms a decision', () => {
    const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 }); const out: Option[] = [];
    const me = { ...sniper, id: 'home-RW', position: 'RW' as const };
    const t = performance.now();
    for (let i = 0; i < 20_000; i++) listOptions(st, me, defs, tactics.home, out);
    expect((performance.now() - t) / 20_000).toBeLessThan(0.15);
  });
  it('the pick is the best value as he sees it: a clearly better option wins almost always, the committed one is favoured', () => {
    const st = oneBestPass();
    const me = { ...def({}), id: 'home-RW', position: 'RW' as const };
    const sit = readSituation(st, skater(st, 'home', 'RW'));
    const opts: Option[] = [{ kind: 'protect', value: 0 }, { kind: 'shoot', value: 0.05 }];
    let shots = 0;
    for (let seed = 1; seed <= 500; seed++) if (chooseOption(opts, me, sit, null, createRng(seed)).kind === 'shoot') shots++;
    expect(shots).toBeGreaterThan(490);
    const close: Option[] = [{ kind: 'protect', value: 0 }, { kind: 'shoot', value: 0 }];
    let kept = 0;
    for (let seed = 1; seed <= 2000; seed++) if (chooseOption(close, me, sit, { id: 'home-RW', kind: 'protect', lane: null, toId: null, to: null, tick: 0 }, createRng(seed)).kind === 'protect') kept++;
    expect(kept / 2000).toBeGreaterThan(0.55);
  });
});

describe('rims (Task 5 review)', () => {
  it('a rim is offered along the boards or from behind the goal line, never from the slot', () => {
    const rims = (x: number, y: number): number => {
      const st = stateWith({ carrier: 'home', puckX: x, puckY: y, carrierSlot: 'LW' }); place(st, 'away:LD', x + 0.4, y - 0.8);
      expect(readSituation(st, skater(st, 'home', 'LW')).pressuredLow).toBe(true);
      const opts: Option[] = []; listOptions(st, { ...def({}), id: 'home-LW', position: 'LW' }, defs, tactics.home, opts);
      return opts.filter((o) => o.kind === 'rim').length;
    };
    expect(rims(24, 2)).toBe(0); expect(rims(23, -4)).toBe(0); expect(rims(24, 10.5)).toBe(1);
  });
  it('a rim is never aimed through the crease: from beside the net it goes round the other way', () => {
    const st = stateWith({ carrier: 'home', puckX: 25, puckY: 2.6, carrierSlot: 'LW' });
    place(st, 'home:C', 20, -9);
    executeRim(st, 'home-LW', 'home-C', defs, createRng(1));
    const p = st.puck.pos, v = st.puck.vel, l = Math.hypot(v.x, v.y);
    expect(crossesEndBox(p, { x: p.x + (v.x / l) * 6, y: p.y + (v.y / l) * 6 }, 27.13 - 1.83, 28.13, 1.83)).toBe(false);
  });
});

describe('behind the net', () => {
  it('a carrier behind the net starts no board battle unless an opponent is within 1.2 m of him', () => {
    const st = stateWith({ carrier: 'home', puckX: 29.4, puckY: 1, carrierSlot: 'C' });
    for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 0, y: s.pos.y };
    for (const s of st.skaters) if (s.side === 'home' && s.id !== 'home-C') s.pos = { x: 5, y: s.pos.y };
    place(st, 'away:C', 29.9, 2.6); // 1.6 m from the puck, 1.9 m from the carrier
    const a = structuredClone(st);
    contestTick(a, defs, createRng(1), DT);
    expect(a.contests.filter((c) => c.kind === 'boardBattle')).toEqual([]);
    place(st, 'away:C', 29.5, 1.8); // 0.8 m from the puck, 1.06 m from the carrier
    contestTick(st, defs, createRng(1), DT);
    expect(st.contests.filter((c) => c.kind === 'boardBattle').length).toBe(1);
  });
});
