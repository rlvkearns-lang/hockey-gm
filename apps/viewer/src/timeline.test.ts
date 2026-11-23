import { describe, expect, it } from 'vitest';
import { DT } from '@hockey/engine';
import { buildTimeline } from './timeline';
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
  it('a lookup is indexed: a million of them take well under a second', () => {
    const tl = buildTimeline(recorded(5).events);
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 1e6; i++) if (tl.last('release', (i * 37) % 100000, Math.round(1.5 / DT))) n++;
    expect(n).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
