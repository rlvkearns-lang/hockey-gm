import { describe, expect, it } from 'vitest';
import { DT } from '@hockey/engine';
import { buildTimeline, lastSinceDrop } from './timeline';
import { recorded } from './test/game';

describe('timeline', () => {
  it('answers score and shots as of any tick, and finds the next and last event for a player', () => {
    const rec = recorded(42); const tl = buildTimeline(rec.events); const g = tl.goals[0]!;
    expect(tl.scoreAt(g.tick - 1).home + tl.scoreAt(g.tick - 1).away + 1).toBe(tl.scoreAt(g.tick).home + tl.scoreAt(g.tick).away);
    const rel = rec.events.find(e => e.type === 'release')!;
    expect(tl.next('release', rel.tick - 10, 30, rel.playerId!)).toBe(rel);
    expect(tl.next('release', rel.tick, 30, rel.playerId!)).not.toBe(rel);
    expect(tl.last('release', rel.tick + 5, 30, rel.playerId!)).toBe(rel);
    expect(tl.scoreAt(rec.totalTicks)).toEqual(rec.result.score);
  });

  // Beyond the brief's list.
  it('agrees with a plain scan of the log for shots, score, next, last, forPlayer and contests', () => {
    for (const seed of [5, 42]) {
      const rec = recorded(seed), tl = buildTimeline(rec.events), ev = rec.events;
      for (let t = 0; t <= rec.totalTicks; t += 997) {
        const upTo = ev.filter((e) => e.tick <= t);
        expect(tl.shotsAt(t)).toEqual({ home: upTo.filter((e) => e.type === 'shot' && e.side === 'home').length, away: upTo.filter((e) => e.type === 'shot' && e.side === 'away').length });
        expect(tl.scoreAt(t)).toEqual({ home: upTo.filter((e) => e.type === 'goal' && e.side === 'home').length, away: upTo.filter((e) => e.type === 'goal' && e.side === 'away').length });
        expect(tl.next('shot', t, 300)).toBe(ev.find((e) => e.type === 'shot' && e.tick > t && e.tick <= t + 300));
        expect(tl.last('save', t, 300)).toBe(ev.filter((e) => e.type === 'save' && e.tick <= t && e.tick >= t - 300).at(-1));
      }
      const someone = ev.find((e) => e.type === 'release')!.playerId!;
      expect(tl.forPlayer(someone, 2000, 9000)).toEqual(ev.filter((e) => (e.playerId === someone || e.otherId === someone) && e.tick >= 2000 && e.tick <= 9000));
      const start = ev.find((e) => e.type === 'contestStart')!;
      const id = start.type === 'contestStart' ? start.detail.contestId : -1;
      const c = tl.contest(id)!;
      expect(c.start).toBe(start);
      expect(c.end).toBe(ev.find((e) => e.type === 'contestEnd' && e.detail.contestId === id));
      expect(tl.contest(-5)).toBeUndefined();
      expect(tl.goals.length).toBe(rec.result.score.home + rec.result.score.away);
      expect(tl.periodEnds).toEqual(ev.filter((e) => e.type === 'periodEnd').map((e) => e.tick));
      expect(tl.shotsAt(Infinity).home + tl.shotsAt(Infinity).away).toBe(ev.filter((e) => e.type === 'shot').length);
    }
  });
  it('finds events by the part a player has in them (player, other or either), as a plain scan does', () => {
    for (const seed of [5, 42]) {
      const ev = recorded(seed).events, tl = buildTimeline(ev);
      const has = (e: (typeof ev)[number], id: string, role: 'player' | 'other' | 'either'): boolean =>
        role === 'player' ? e.playerId === id : role === 'other' ? e.otherId === id : e.playerId === id || e.otherId === id;
      const passes = ev.filter((e) => e.type === 'pass' && e.otherId).slice(0, 25);
      const saves = ev.filter((e) => e.type === 'shot' && e.otherId).slice(0, 10);
      for (const ref of [...passes, ...saves]) for (const id of [ref.playerId!, ref.otherId!]) for (const role of ['player', 'other', 'either'] as const) {
        for (const t of [ref.tick - 40, ref.tick - 1, ref.tick, ref.tick + 3]) {
          expect(tl.next(ref.type, t, 120, id, role), `${role} next`).toBe(ev.find((e) => e.type === ref.type && e.tick > t && e.tick <= t + 120 && has(e, id, role)));
          expect(tl.last(ref.type, t, 120, id, role), `${role} last`).toBe(ev.filter((e) => e.type === ref.type && e.tick <= t && e.tick >= t - 120 && has(e, id, role)).at(-1));
        }
      }
      // "The pass on its way to me": the receiver finds it by his part as its other player.
      const p = passes[0]!;
      expect(tl.last('pass', p.tick + 2, 30, p.otherId!, 'other')).toBe(p);
      expect(tl.last('pass', p.tick + 2, 30, p.otherId!)).not.toBe(p);
    }
  });
  it('a lookup is indexed: a million of them take well under a second', () => {
    const tl = buildTimeline(recorded(5).events);
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 1e6; i++) if (tl.last('release', (i * 37) % 100000, Math.round(1.5 / DT))) n++;
    expect(n).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('lastSinceDrop finds the latest event with no faceoff or period end since it', () => {
    const ev = (type: string, tick: number) => ({ type, tick, side: null, playerId: null, otherId: null, pos: { x: 0, y: 0 }, period: 1, clock: 0, assistIds: [], detail: {} });
    const tl = buildTimeline([ev('goal', 100), ev('faceoff', 250), ev('goal', 400), ev('periodEnd', 500), ev('faceoff', 900)] as unknown as Parameters<typeof buildTimeline>[0]);
    expect(lastSinceDrop(tl, 'goal', 249)?.tick).toBe(100);
    expect(lastSinceDrop(tl, 'goal', 250)).toBeUndefined();
    expect(lastSinceDrop(tl, 'goal', 499)?.tick).toBe(400);
    expect(lastSinceDrop(tl, 'goal', 600)).toBeUndefined();
    expect(lastSinceDrop(tl, 'goal', 99)).toBeUndefined();
  });
});
