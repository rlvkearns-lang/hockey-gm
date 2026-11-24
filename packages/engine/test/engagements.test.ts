import { describe, it, expect } from 'vitest';
import { resolveBodies, type EngagedPair } from '../src/bodies';
import { DT } from '../src/constants';
import { contestTick, startContest } from '../src/contests/core';
import { boardBattleContest } from '../src/contests/board-battle';
import { netFrontContest } from '../src/contests/net-front';
import { engageChance, engagementOf, engagementTick, engageSpeedFactor, tieOf } from '../src/engagements';
import { shotSpread } from '../src/actions';
import { receiveChance } from '../src/passing';
import { createGame } from '../src/game';
import { bodyRadius, stepSkater } from '../src/skating';
import { driveOf } from '../src/team-play';
import { tipChance } from '../src/tips';
import type { Engagement, GameEventOf, PlayerDef, SkaterState } from '../src/types';
import { def, even, gameSetup, harness, place2, st, type Harness } from './helpers';

/** One live tick of the harness as game.ts runs it: contests, engagements, movement (slowed by ties), bodies held. */
function step(h: Harness): void {
  const s = h.st;
  s.tick++;
  contestTick(s, h.ds, h.rng, DT, h.events);
  engagementTick(s, h.ds, h.rng, h.events);
  const on = s.skaters.filter((k) => k.onIce);
  for (const k of on) {
    const cap = k.speedCap;
    k.speedCap = cap * engageSpeedFactor(s, k.id);
    stepSkater(k, h.moves.get(k.id)!, DT, driveOf(s, k, s.skaters.indexOf(k)));
    k.speedCap = cap;
  }
  const pairs: EngagedPair[] = s.engagements.map((e) => ({ i: on.findIndex((k) => k.id === e.a), j: on.findIndex((k) => k.id === e.b), tieI: e.tieA, tieJ: e.tieB }));
  resolveBodies(on, (id) => h.moves.get(id)!, undefined, pairs);
}

const sk = (h: Harness, id: string): SkaterState => h.st.skaters.find((k) => k.id === id)!;
const gapOf = (h: Harness, a: string, b: string): number => {
  const x = sk(h, a), y = sk(h, b);
  return Math.hypot(x.pos.x - y.pos.x, x.pos.y - y.pos.y) - bodyRadius(h.ds.get(a)!.weightKg) - bodyRadius(h.ds.get(b)!.weightKg);
};

/** Home C and away LD skating into each other at the net front for 1.5 s: the state then, and how long they were in contact. */
function pairInContact(c: PlayerDef, d: PlayerDef): { state: Harness['st']; secondsInContact: number } {
  const h = harness(['home-C', 'away-LD'], { 'home-C': c, 'away-LD': d }, { puckX: 15, puckY: 8 });
  place2(h.st, 'home-C', 22, 0.05, 0); place2(h.st, 'away-LD', 23.6, 0, Math.PI);
  sk(h, 'home-C').vel = { x: 2, y: 0 }; sk(h, 'away-LD').vel = { x: -1, y: 0 };
  sk(h, 'home-C').target = { x: 25.5, y: 0 }; sk(h, 'away-LD').target = { x: 21, y: 0.05 };
  let contact = 0;
  for (let i = 0; i < 45; i++) { step(h); if (gapOf(h, "home-C", "away-LD") <= 0.15 + 1e-9) contact += DT; }
  return { state: h.st, secondsInContact: contact };
}

/** Home C and away C standing in body contact, engaged (home C's tie `tie`, away C's 0): the harness. */
function tiedUp(tie: number): Harness & { speedCapFactor: number } {
  const h = harness(['home-C', 'away-C'], {}, { carrier: 'home', carrierSlot: 'C', puckX: 14, puckY: 3 });
  place2(h.st, 'home-C', 14, 3, 0); place2(h.st, 'away-C', 14.8, 3, Math.PI);
  h.st.puck.pos = { x: 14.6, y: 3.3 };
  const e: Engagement = { a: 'home-C', b: 'away-C', sinceTick: 0, kind: 'ride', inside: null, tieA: tie, tieB: 0, lastWon: null, nextDrawTick: 12 };
  h.st.engagements = [e];
  return Object.assign(h, { speedCapFactor: engageSpeedFactor(h.st, 'home-C') });
}

const receiveChanceFor = (h: Harness): number => receiveChance(def({}), 10, false, 0, tieOf(h.st, 'home-C'));
const tipChanceFor = (h: Harness): number => tipChance(def({}), tieOf(h.st, 'home-C'));
const shotSpreadFor = (h: Harness): number => shotSpread(h.st, 'home-C', h.ds, 'wrist');

/** Home C (no puck) skating hard away from away C for `seconds`: how far apart (centres, m) they end. */
function metresApartAfter(h: Harness, seconds: number): number {
  h.st.carrierId = null; h.st.possession = null;
  h.st.puck.pos = { x: -20, y: -10 }; // nobody's puck: no race for it
  sk(h, 'home-C').target = { x: 4, y: 3 }; sk(h, 'home-C').facing = Math.PI;
  for (let i = 0; i < Math.round(seconds / DT); i++) step(h);
  const a = sk(h, 'home-C'), b = sk(h, 'away-C');
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

/**
 * The share of `n` draws `a` (home C) wins against `b` (away C), the two standing engaged in body contact (the draws are
 * engagementTick's own, inside position included).
 */
function insideShare(a: PlayerDef, b: PlayerDef, n: number): number {
  let won = 0, draws = 0;
  for (let seed = 1; draws < n; seed++) {
    const h = harness(['home-C', 'away-C'], { 'home-C': a, 'away-C': b }, { puckX: -10, seed });
    place2(h.st, 'home-C', 0, 3, 0); place2(h.st, 'away-C', 0.8, 3, Math.PI);
    for (let t = 0; t < 120 && draws < n; t++) {
      h.st.tick++;
      engagementTick(h.st, h.ds, h.rng, h.events);
      const e = h.st.engagements[0];
      if (e === undefined) break;
      if (e.nextDrawTick === h.st.tick + Math.round(0.4 / DT)) { draws++; if (e.lastWon === 'home-C') won++; }
    }
  }
  return won / draws;
}

/**
 * `n` tries: home C (attacker, `a`) engaged with away LD (`d`) at the net front, the puck loose 4 m behind the defender
 * (home C's target); the share in which home C gets loose (fought through or spun off) within 3 s.
 */
function foughtThroughShare(a: PlayerDef, d: PlayerDef, n: number): number {
  let loose = 0;
  for (let seed = 1; seed <= n; seed++) {
    // (The puck is on its way there: it stands for where he wants to go, out of reach of a race for it.)
    const h = harness(['home-C', 'away-LD'], { 'home-C': a, 'away-LD': d }, { puckX: -20, puckY: -10, seed: 5000 + seed });
    place2(h.st, 'home-C', 21.5, 0, 0); place2(h.st, 'away-LD', 22.3, 0, Math.PI);
    for (let t = 0; t < 90; t++) {
      sk(h, 'home-C').target = { x: 26, y: -3 };
      step(h);
      const end = h.events.find((e): e is GameEventOf<'engagement'> => e.type === 'engagement');
      // (The defender holds his ground, his target where he stands, so a man who gets loose is the attacker.)
      if (end !== undefined) { if (end.detail.result === 'foughtThrough' || end.detail.result === 'spunOff') loose++; break; }
      sk(h, 'away-LD').target = { ...sk(h, 'away-LD').pos };
    }
  }
  return loose / n;
}

/** Home C and away C engaged on the boards with away C inside; the puck arrives in their feet and a board battle starts. */
function engagementIntoBattle(): { endResult: string | undefined; battle: Extract<Harness['st']['contests'][number], { kind: 'boardBattle' }>; insideId: string } {
  const h = harness(['home-C', 'away-C'], {}, { puckX: 12, puckY: 11.5 });
  place2(h.st, 'home-C', 11.6, 12, 0); place2(h.st, 'away-C', 12.4, 12, Math.PI);
  h.st.engagements = [{ a: 'home-C', b: 'away-C', sinceTick: -30, kind: 'lean', inside: 'away-C', tieA: 0.6, tieB: 0.2, lastWon: 'away-C', nextDrawTick: 100 }];
  const battle = startContest(h.st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  h.st.tick++;
  engagementTick(h.st, h.ds, h.rng, h.events);
  const end = h.events.find((e): e is GameEventOf<'engagement'> => e.type === 'engagement');
  return { endResult: end?.detail.result, battle, insideId: 'away-C' };
}

describe('engagements: battling for position (Task 10)', () => {
  it('opponents who come together engage instead of bouncing apart', () => {
    const h = pairInContact(even, even);
    expect(h.state.engagements).toHaveLength(1); expect(h.secondsInContact).toBeGreaterThan(1.0);
    const e = h.state.engagements[0]!; expect([e.a, e.b].sort()).toEqual(['away-LD', 'home-C']); expect(e.kind).toBe('boxOut');
  });
  it('the stronger, heavier man gets inside position more often, never always', () => {
    const strong = def({ strength: 92, balance: 88, compete: 85, weightKg: 100 }), light = def({ strength: 55, balance: 60, compete: 60, weightKg: 78 });
    const s = insideShare(strong, light, 600); expect(s).toBeGreaterThan(0.6); expect(s).toBeLessThanOrEqual(0.9);
    expect(engageChance(strong, st({}), light, st({}), 'a')).toBeLessThanOrEqual(0.9); expect(engageChance(light, st({}), strong, st({}), null)).toBeGreaterThanOrEqual(0.1);
  });
  it('being tied up slows him and limits him, and never to nothing', () => {
    const h = tiedUp(1);
    expect(h.speedCapFactor).toBeCloseTo(0.5, 9);
    expect(receiveChanceFor(h)).toBeLessThan(receiveChance(def({}), 10, false) * 0.5); expect(receiveChanceFor(h)).toBeGreaterThanOrEqual(0.03);
    expect(tipChanceFor(h)).toBeLessThan(tipChance(def({})) * 0.5); expect(tipChanceFor(h)).toBeGreaterThanOrEqual(0.03);
    expect(shotSpreadFor(h)).toBeCloseTo(shotSpreadFor(tiedUp(0)) * 2, 6);
  });
  it('a tied-up man cannot simply skate away; a free one can', () => { expect(metresApartAfter(tiedUp(1), 1)).toBeLessThan(1.0); expect(metresApartAfter(tiedUp(0), 1)).toBeGreaterThan(2.5); });
  it('he can fight through: with the puck arriving behind his man, a free-enough attacker gets loose within 3 s in 25% to 75% of tries', () => {
    const s = foughtThroughShare(even, even, 400); expect(s).toBeGreaterThan(0.25); expect(s).toBeLessThan(0.75);
  });
  it('the puck arriving turns it into a board battle, with the inside man first in', () => {
    const b = engagementIntoBattle(); expect(b.endResult).toBe('contest'); expect(b.battle.roles.first).toBe(b.insideId);
  });
  it('a net-front battle out of an engagement gives the inside man the first-round edge', () => {
    const h = harness(['home-C', 'away-LD'], {}, { carrier: 'home', carrierSlot: 'C', puckX: 15, puckY: 8 });
    h.st.engagements = [{ a: 'home-C', b: 'away-LD', sinceTick: -30, kind: 'boxOut', inside: 'away-LD', tieA: 0.6, tieB: 0.2, lastWon: 'away-LD', nextDrawTick: 100 }];
    const c = startContest(h.st, h.ds, h.rng, netFrontContest, ['home-C', 'away-LD'], h.events);
    expect(c.data.inside).toBe('away-LD');
  });
  it('each skater is in at most one engagement, and none with a man a contest is steering; ties stay within 0 to 1', () => {
    const g = createGame(gameSetup(2));
    let engagedTicks = 0;
    for (let t = 0; t < 30 * 600 && !g.done; t++) {
      g.step();
      const s = g.state;
      const ids = s.engagements.flatMap((e) => [e.a, e.b]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of s.engagements) {
        const a = s.skaters.find((k) => k.id === e.a)!, b = s.skaters.find((k) => k.id === e.b)!;
        expect(a.side).not.toBe(b.side);
        expect(s.skaters.indexOf(a)).toBeLessThan(s.skaters.indexOf(b));
        expect(a.contestId).toBeNull(); expect(b.contestId).toBeNull();
        for (const t of [e.tieA, e.tieB]) { expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(1); }
        expect(e.inside === null || e.inside === e.a || e.inside === e.b).toBe(true);
      }
      if (s.engagements.length > 0) engagedTicks++;
      if (s.phase !== 'live') expect(s.engagements).toHaveLength(0);
    }
    expect(engagedTicks).toBeGreaterThan(1000);
  }, 60_000);
  it('every engagement event lasted 0.3 s or more and names the pair; a whistle ends the ones it cuts', () => {
    const g = createGame(gameSetup(3));
    while (!g.done) g.step();
    const es = g.result().events.filter((e): e is GameEventOf<'engagement'> => e.type === 'engagement');
    expect(es.length).toBeGreaterThan(100);
    for (const e of es) {
      expect(e.detail.seconds).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(e.playerId === null || e.playerId === e.detail.a || e.playerId === e.detail.b).toBe(true);
      if (e.playerId !== null) expect(e.otherId).toBe(e.playerId === e.detail.a ? e.detail.b : e.detail.a);
    }
    expect(es.some((e) => e.detail.result === 'whistle')).toBe(true);
    const results = new Set(es.map((e) => e.detail.result));
    for (const r of ['released', 'foughtThrough', 'contest'] as const) expect(results.has(r)).toBe(true);
  }, 60_000);
});

