import { describe, it, expect } from 'vitest';
import { DT } from '../../src/constants';
import { beatenChance, pokeAttemptChance, pokeCheckContest } from '../../src/contests/poke-check';
import { createRng } from '../../src/rng';
import { defs, place, skater, stateWith } from '../helpers';
import { def, pokeOutcomes, pokeOutOfReach, pokeReleased, runPoke, share, startPoke, stepsUntilDone } from '../helpers';

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
