import { describe, expect, it } from 'vitest';
import type { GameEventOf, GameSetup } from '@hockey/engine';
import { OVERLAYS, type Overlay } from '../animator';
import { createCursor, type Playback, type Recording } from '../playback';
import { createGameScene, seekScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';
import { STICK_OVERLAYS, stickSlotOf } from './stick';

/** The stick actions' seek sweep (npm run test:picture; moved from stick.test.ts, unchanged). */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback };
function game(seed: number): Game {
  const rec = recorded(seed), setup = testSetup(seed);
  return { rec, tl: buildTimeline(rec.events), setup, pb: createCursor(setup, rec) };
}
const releases = (rec: Recording): GameEventOf<'release'>[] => rec.events.filter((e): e is GameEventOf<'release'> => e.type === 'release');

describe('stick actions', () => {
  it('a seek shows the stick actions play shows: their state and weights around shots, passes and dumps', () => {
    for (const seed of [5, 42]) {
      const g = game(seed);
      const watch = { id: '', tick: 0 };
      type Got = { w: Record<string, number>; style: string; pending: boolean; aim: number };
      const box: { v: Got | null } = { v: null };
      const skaters = OVERLAYS.map((ov): Overlay => ({
        ...ov,
        weight: (a, s, c) => {
          const w = ov.weight(a, s, c);
          if (s.id === watch.id) {
            const got = (box.v ??= { w: {}, style: '', pending: false, aim: 0 });
            got.w[ov.id] = w;
            const act = stickSlotOf(a)?.acts.find((x) => x.tick === watch.tick);
            if (act) { got.style = act.style; got.pending = act.pending; got.aim = act.aim; }
          }
          return w;
        },
      }));
      const sc = createGameScene(g.setup, { timeline: g.tl, animation: { skaters } });
      const rels = releases(g.rec);
      const pick = (kind: string): GameEventOf<'release'>[] => rels.filter((e) => e.detail.kind === kind && e.tick > 400).slice(0, 12);
      const offsets = [-12, -4, 0, 6];
      let compared = 0;
      for (const rel of [...pick('shot'), ...pick('pass'), ...pick('dump')]) {
        watch.id = rel.playerId!; watch.tick = rel.tick;
        // Play: from 1.5 s before the first offset, at 60 Hz.
        const start = rel.tick + offsets[0]! - 45, played = new Map<number, Got | null>();
        seekScene(g.pb, sc, start);
        for (let i = 1; start + i * 0.5 <= rel.tick + offsets[offsets.length - 1]!; i++) {
          box.v = null; g.pb.seek(start + i * 0.5); sc.update(g.pb.frame(), 1 / 60);
          const at = start + i * 0.5;
          if (offsets.includes(at - rel.tick)) played.set(at - rel.tick, box.v);
        }
        for (const off of offsets) {
          box.v = null; seekScene(g.pb, sc, rel.tick + off);
          const p = played.get(off), q = box.v as Got | null;
          if (!p || !q) continue; // off the ice at that moment
          expect(q.style, `${seed} ${rel.tick} ${off}`).toBe(p.style);
          expect(q.pending).toBe(p.pending);
          // The aim is followed step by step until the contact and kept from there: a 30 Hz pre-roll may keep it a
          // fraction of a tick earlier than a 60 Hz play.
          expect(Math.abs(q.aim - p.aim)).toBeLessThan(0.1);
          for (const ov of STICK_OVERLAYS) expect(Math.abs((q.w[ov.id] ?? 0) - (p.w[ov.id] ?? 0)), `${seed} ${rel.tick} ${off} ${ov.id}`).toBeLessThan(0.05);
          compared++;
        }
      }
      sc.dispose();
      expect(compared).toBeGreaterThan(120);
    }
  });
});
