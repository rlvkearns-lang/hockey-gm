import { describe, it, expect } from 'vitest';
import { looseRaceContest, raceChances, timeToReach } from '../../src/contests/loose-race';
import { contestTick, startContest } from '../../src/contests/core';
import { resolveBodies } from '../../src/bodies';
import { movementOf, stepSkater } from '../../src/skating';
import { stepPuck } from '../../src/puck';
import { driveOf } from '../../src/team-play';
import { createRng } from '../../src/rng';
import { DT } from '../../src/constants';
import type { GameEvent, GameEventOf } from '../../src/types';
import { at, def, defs, even, raceWithRebound, runRace, share, stateWith } from '../helpers';

/**
 * A loose-puck race as runRace sets it up (home C 3 m from a still puck, away C as far the other side as `aLead` s
 * more to reach it), played tick by tick with the real contestTick, skating (driven as the game drives them) and body
 * contact, the puck carried in front of its carrier once he has it. The race's end event and how far the puck moved
 * on the tick it ended.
 */
function runRaceTicks(o: { aLead: number; seed: number }): { end: GameEventOf<'contestEnd'>; puckStepAtEnd: number } {
  const st = stateWith({ carrier: null, puckX: 0 });
  for (const s of st.skaters) s.onIce = s.id === 'home-C' || s.id === 'away-C';
  st.onIce = { home: ['home-C'], away: ['away-C'] };
  const m = movementOf(even, 1);
  const place = (id: string, x: number, facing: number): void => { const s = st.skaters.find((k) => k.id === id)!; s.pos = { x, y: 0 }; s.target = { x, y: 0 }; s.vel = { x: 0, y: 0 }; s.facing = facing; };
  const tb = timeToReach(at(-3, 0), m, { x: 0, y: 0 }) + o.aLead;
  let lo = 0.9, hi = 40;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (timeToReach(at(-mid, 0), m, { x: 0, y: 0 }) < tb) lo = mid; else hi = mid; }
  place('home-C', -3, 0); place('away-C', lo, Math.PI);
  const ds = new Map(defs); for (const id of ['home-C', 'away-C']) ds.set(id, { ...even, id, position: 'C' });
  const rng = createRng(o.seed); const events: GameEvent[] = [];
  const c = startContest(st, ds, rng, looseRaceContest, ['home-C', 'away-C'], events);
  for (let t = 0; t < 150; t++) {
    st.tick++;
    const before = { x: st.puck.pos.x, y: st.puck.pos.y };
    const mark = events.length;
    contestTick(st, ds, rng, DT, events);
    const on = st.skaters.filter((k) => k.onIce);
    for (const k of on) stepSkater(k, m, DT, driveOf(st, k, st.skaters.indexOf(k)));
    resolveBodies(on, () => m);
    const carrier = on.find((k) => k.id === st.carrierId);
    if (carrier) st.puck.pos = { x: carrier.pos.x + Math.cos(carrier.facing) * 0.6, y: carrier.pos.y + Math.sin(carrier.facing) * 0.6 };
    else stepPuck(st.puck, DT);
    const end = events.slice(mark).find((e): e is GameEventOf<'contestEnd'> => e.type === 'contestEnd' && e.detail.contestId === c.id);
    if (end) return { end, puckStepAtEnd: Math.hypot(st.puck.pos.x - before.x, st.puck.pos.y - before.y) };
  }
  throw new Error('race still running after 5 s');
}

describe('loose-puck races', () => {
  it('the closer man usually wins the race', () => { expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeGreaterThan(0.7); expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeLessThanOrEqual(0.9); });

  it('a dead heat is a coin flip, with some bounces that stay loose', () => {
    const r = Array.from({ length: 2000 }, () => runRace({ aLead: 0 }));
    const a = r.filter((x) => x.winner === 'a').length / 2000, loose = r.filter((x) => x.winner === null).length / 2000;
    expect(a).toBeGreaterThan(0.35); expect(a).toBeLessThan(0.5);
    expect(loose).toBeGreaterThan(0.1); expect(loose).toBeLessThan(0.22);
  });
  it('compete and agility tip a close race', () => {
    const keen = def({ compete: 90, agility: 88, balance: 85 }), slack = def({ compete: 55, agility: 60, balance: 60 });
    expect(share(2000, () => runRace({ aLead: 0, a: keen, b: slack }).winner === 'a')).toBeGreaterThan(share(2000, () => runRace({ aLead: 0 }).winner === 'a') + 0.1);
  });
  it('the man who won the net-front battle is first to the rebound', () => {
    expect(share(2000, () => raceWithRebound().winner === 'a')).toBeGreaterThan(share(2000, () => runRace({ aLead: 0 }).winner === 'a') + 0.06);
  });
  it('parity: neither man\'s chance is ever below 0.03 or certain, however big the edge', () => {
    for (const edge of [-500, -60, 0, 60, 500]) {
      const p = raceChances(edge);
      expect(Math.min(p.a, p.b)).toBeGreaterThanOrEqual(0.03); expect(Math.max(p.a, p.b)).toBeLessThan(0.97);
      expect(p.a + p.b + p.bounce).toBeCloseTo(1, 12);
    }
  });
  it('the winner skates to the puck and picks it up: it never jumps to him', () => {
    let won = 0;
    for (let seed = 1; seed <= 200; seed++) { const r = runRaceTicks({ aLead: 0.3, seed });   // per-tick puck positions and the end event
      if (r.end.detail.result !== 'won') continue;
      won++;
      expect(r.puckStepAtEnd).toBeLessThanOrEqual(0.9 + 0.6 + 0.2); }
    expect(won).toBeGreaterThan(100);
  });
  it('the race takes time and shows who is ahead', () => {
    const r = runRace({ aLead: 0.3 });
    expect(r.stages).toEqual(['race', 'resolve']);
    expect(r.seconds).toBeGreaterThan(0.4);
    expect(r.raceLeaders.every((l) => l === 'home-C')).toBe(true);
  });
});
