import { describe, expect, it } from 'vitest';
import { DT, type GameEventOf, type GameSetup } from '@hockey/engine';
import { createCursor, type Playback, type Recording } from '../playback';
import type { SkaterPose, Vec3 } from '../pose-mix';
import { createGameScene, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';
import { HIT_EFFECT_TICKS } from './contact';

/** A seek into a fall against play (npm run test:picture; moved from contact.test.ts, unchanged). */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene };
const games = new Map<number, Game>();
function game(seed: number): Game {
  let g = games.get(seed);
  if (!g) {
    const rec = recorded(seed), tl = buildTimeline(rec.events), setup = testSetup(seed);
    g = { rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl }) };
    games.set(seed, g);
  }
  return g;
}
/** Seek with the pre-roll to 1.5 s before `from`, then play at 60 Hz to display time `to`, calling `each` every frame. */
function play(g: Game, from: number, to: number, each?: (t: number) => void): void {
  const start = from - 45;
  seekScene(g.pb, g.sc, start);
  for (let i = 1; start + i * 0.5 <= to + 1e-9; i++) { g.pb.seek(start + i * 0.5); g.sc.update(g.pb.frame(), 1 / 60); each?.(start + i * 0.5); }
}
const hitsOf = (g: Game, result: string): GameEventOf<'hit'>[] =>
  g.rec.events.filter((e): e is GameEventOf<'hit'> => e.type === 'hit' && e.detail.result === result);
const engineAt = (g: Game, tick: number): ReturnType<Playback['frame']>['prev'] => { g.pb.seek(tick); return g.pb.frame().prev; };
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copyPose = (p: SkaterPose): SkaterPose => ({
  ...p, legs: [{ ...p.legs[0], foot: { ...p.legs[0].foot } }, { ...p.legs[1], foot: { ...p.legs[1].foot } }],
  arms: [{ hand: { ...p.arms[0].hand } }, { hand: { ...p.arms[1].hand } }], blade: { ...p.blade },
});

describe('a fall is the same however you reach it', () => {
  // The target through his fall and get-up (down, mid-down, getting up, up as downT ends): every joint and where he is
  // drawn. The hitter while the hit still shows on him (to HIT_EFFECT_TICKS): where he is drawn (the hit's offsets).
  // His pose is his skating gait with the hit on top, and a seek's pre-roll at 1/30 s can settle a gait in another
  // style or phase than play at 1/60 s (a glide for a sprint, a stop to the other side), as before this task; the same
  // holds for the target before T + 8 and after downT ends, while some of his gait still shows.
  it('seeking into a landed hit\'s fall and get-up shows what play shows (worst joint within 0.1 m)', () => {
    let checked = 0, worst = 0, worstAt = '';
    for (const seed of [5, 42]) {
      const g = game(seed), end1 = g.tl.periodEnds[0]!;
      for (const e of hitsOf(g, 'landed').filter((h) => h.tick < end1)) {
        const T = e.tick, ids = [e.otherId!, e.playerId!];
        const D = engineAt(g, T).skaters.find((k) => k.id === e.otherId)!.downT;
        if (!(D > 0)) continue;
        const endT = T + Math.ceil(D / DT - 1e-6);
        const points = [T + 8, T + Math.round(D / 2 / DT), endT - 4, endT];
        const played = new Map<number, { pose: SkaterPose; x: number; z: number }[]>();
        const grab = (id: string): { pose: SkaterPose; x: number; z: number } => { const f = g.sc.figure(id)!; return { pose: copyPose(f.pose!), x: f.position.x, z: f.position.z }; };
        // Play from 90 ticks before the hit.
        play(g, T - 45, points[3]!, (tk) => { if (points.includes(tk)) played.set(tk, ids.map(grab)); });
        for (const pt of points) {
          seekScene(g.pb, g.sc, pt);
          ids.forEach((id, k) => {
            if (k === 1 && pt > T + HIT_EFFECT_TICKS) return;
            const was = played.get(pt)![k]!, a = was.pose, now = grab(id), b = now.pose;
            const at = Math.hypot(was.x - now.x, was.z - now.z);
            // The torso's turns as metres at the shoulders (0.5 m up).
            const torso = 0.5 * Math.max(Math.abs(a.pitch - b.pitch), Math.abs(a.roll - b.roll), Math.abs((a.twist ?? 0) - (b.twist ?? 0)));
            const d = k === 1 ? at : Math.max(at, torso, dist(a.arms[0].hand, b.arms[0].hand), dist(a.arms[1].hand, b.arms[1].hand), dist(a.legs[0].foot, b.legs[0].foot),
              dist(a.legs[1].foot, b.legs[1].foot), dist(a.blade, b.blade), Math.abs(a.hipY - b.hipY));
            if (d > worst) { worst = d; worstAt = `${seed}@${T} ${id} at ${pt}`; }
          });
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(worst, worstAt).toBeLessThan(0.1);
  });
});
