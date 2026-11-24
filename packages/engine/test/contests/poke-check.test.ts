import { describe, it, expect } from 'vitest';
import { DT } from '../../src/constants';
import { beatenChance, pokeAttemptChance, pokeCheckContest } from '../../src/contests/poke-check';
import { createRng } from '../../src/rng';
import { defs, place, skater, stateWith } from '../helpers';
import { def, pokeOutcomes, pokeOutOfReach, pokeReleased, runPoke, share, startPoke, stepsUntilDone } from '../helpers';
import { startContest } from '../../src/contests/core';
import { duel, duelStep } from '../helpers';

/**
 * A poke check (seed `seed`) by away C standing 0.4 to 1.6 m in front of the puck (on the still home C carrier's stick at
 * (0, 0)), a little to one side or the other: how it ended, and how far he was from the puck when the stick went in.
 */
function pokeSeeded(seed: number): { result: string; checkerToPuck: number } {
  const h = duel(def(), def(), 0.4 + (seed % 13) * 0.1, 0, 60_000 + seed);
  const ck = h.st.skaters.find((k) => k.id === 'away-C')!;
  ck.pos.y = ((seed % 5) - 2) * 0.3; ck.target = { ...ck.pos };
  const c = startContest(h.st, h.ds, h.rng, pokeCheckContest, ['away-C', 'home-C'], h.events);
  let at = NaN;
  for (let i = 0; i < 90 && h.st.contests.includes(c); i++) {
    // The poke is decided at the start of a tick (the contests run before anyone moves): where he is then.
    const was = c.stage, d = Math.hypot(ck.pos.x - h.st.puck.pos.x, ck.pos.y - h.st.puck.pos.y);
    duelStep(h);
    if (was === 'reach' && c.stage === 'resolve') at = d;
  }
  const end = h.events.find((e) => e.type === 'contestEnd');
  return { result: end?.type === 'contestEnd' ? end.detail.result : 'running', checkerToPuck: at };
}

describe('poke checks', () => {
  it('the better stick wins more poke checks, not all', () => {
    const p = share(2000, () => runPoke(def({ stickChecking: 92, defensivePositioning: 85 }), def({ puckHandling: 60 })));
    const q = share(2000, () => runPoke(def({ stickChecking: 55 }), def({ puckHandling: 92, poise: 88 })));
    expect(p).toBeGreaterThan(q + 0.15); expect(p).toBeLessThan(0.9); expect(q).toBeGreaterThan(0.1);
  });
  it('a failed poke does not always leave the checker beaten, even when he was the big favourite', () => {
    const o = pokeOutcomes(def({ stickChecking: 99, defensivePositioning: 99, iq: 99 }), def({ puckHandling: 30, poise: 30, balance: 30 }), 1500);
    expect(o.kept + o.beaten).toBeGreaterThan(50);
    expect(o.beaten / (o.kept + o.beaten)).toBeLessThan(0.3);
    expect(beatenChance(0.95)).toBeGreaterThanOrEqual(0.03); expect(beatenChance(0.05)).toBeLessThanOrEqual(0.97);
  });
  it('a defender in range does not always poke: better stick checkers go for it more, never always or never', () => {
    expect(pokeAttemptChance(def({ stickChecking: 90 }))).toBeGreaterThan(pokeAttemptChance(def({ stickChecking: 50 })));
    expect(pokeAttemptChance(def({ stickChecking: 100 }))).toBeLessThan(0.97); expect(pokeAttemptChance(def({ stickChecking: 1 }))).toBeGreaterThanOrEqual(0.03);
  });
  it('the checker reaches from a stick length: at the poke he is 0.9 to 1.9 m from the puck', () => {
    let poked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const p = pokeSeeded(seed);
      if (p.result === 'outOfReach' || p.result === 'released') continue;
      poked++;
      expect(p.checkerToPuck).toBeGreaterThanOrEqual(0.9); expect(p.checkerToPuck).toBeLessThanOrEqual(1.9 + 1e-9);
    }
    expect(poked).toBeGreaterThan(150);
  });
  it('a poke check takes time and is visible in state', () => { const c = startPoke(); expect(c.stage).toBe('reach'); expect(stepsUntilDone(c)).toBeGreaterThanOrEqual(Math.floor(0.25 / DT)); });
  it('releasing the puck before the stick gets there ends it with no result', () => {
    const r = pokeReleased();
    expect(r.contests).toBe(0); expect(r.takeaways).toBe(0); expect(r.contestIds).toBe(0);
  });
  it('a checker out of stick reach when the reach ends gets no result, and nothing is decided', () => {
    const r = pokeOutOfReach();
    expect(r.c.stage).toBe('reach'); expect(r.c.leader).toBeNull();
    // Nothing happens but the contest's own start and end (its end says the stick could not get there).
    expect(r.events.filter((e) => e.type !== 'contestStart' && e.type !== 'contestEnd')).toEqual([]);
    expect(r.events.find((e) => e.type === 'contestEnd')).toMatchObject({ detail: { kind: 'pokeCheck', result: 'outOfReach', winnerId: null } });
    expect(r.carrierId).toBe('home-C'); expect(r.contestIds).toBe(0);
  });
  it('a poke measures to the puck on the blade, not to the carrier: in reach of the puck, out of reach of his body, he can poke (Task 6)', () => {
    let pokes = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const st = stateWith({ carrier: 'home', puckX: 0 });                          // carrier at (-0.6, 0), the puck at (0, 0)
      for (const o of st.skaters) if (o.side === 'away') place(st, `away:${o.slot}` as never, -20, o.pos.y);
      place(st, 'away:C', 1.5, 0);                                                    // 1.5 m from the puck, 2.1 m from the carrier
      const ctx = { state: st, defs, rng: createRng(seed), emit: () => {}, chemistry: [], memo: new Map<string, unknown>() };
      if (pokeCheckContest.trigger(ctx, skater(st, 'away', 'C')) !== null) pokes++;
    }
    expect(pokes).toBeGreaterThan(0);
  });
});
