import { describe, expect, it } from 'vitest';
import { DT, type GameSetup } from '@hockey/engine';
import type { Pose } from './gait';
import type { Playback } from './playback';
import { createGameScene, seekScene, type GameScene } from './scene';
import { CONTACT_FRAME_BOUND, contactFrames as contactFramesOf } from './test/contact-frames';
import { sharedPlayback } from './test/game';

/**
 * The seek sweep against play and the real-game continuity bound through the scene (npm run test:picture; moved from
 * scene-seek.test.ts, unchanged).
 */

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The largest move of a foot, a hand or the hip between two poses (body frame, m). */
function moved(a: Pose, b: Pose): number {
  let j = Math.abs(a.hipY - b.hipY);
  for (const i of [0, 1] as const) j = Math.max(j, dist3(a.legs[i].foot, b.legs[i].foot), dist3(a.arms[i].hand, b.arms[i].hand));
  return j;
}
const copyPose = (p: Readonly<Pose>): Pose => ({
  ...p,
  legs: [{ ...p.legs[0], foot: { ...p.legs[0].foot } }, { ...p.legs[1], foot: { ...p.legs[1].foot } }],
  arms: [{ hand: { ...p.arms[0].hand } }, { hand: { ...p.arms[1].hand } }],
});

describe('seeking shows the moment as play would have', () => {
  const { setup: game, pb } = sharedPlayback() as { setup: GameSetup; pb: Playback };
  const sc: GameScene = createGameScene(game);

  it('the pose at a tick reached by seeking is close to the pose reached by playing', () => {
    const played = createGameScene(game);
    const hip: number[] = [], pitch: number[] = [], styles: number[] = [];
    for (const t of [3100, 11000, 26500, 41000, 57000, 70000, 86000]) {
      // Played: 10 s of play at 60 Hz up to t.
      seekScene(pb, played, t - 300, 0);
      for (let i = 0; i < 600; i++) { pb.seek(t - 300 + (i + 1) / 2); played.update(pb.frame(), 1 / 60); }
      const want = new Map<string, Pose>();
      for (const s of pb.frame().prev.skaters) if (s.onIce) want.set(s.id, copyPose(played.figure(s.id)!.pose!));
      // Seeked.
      seekScene(pb, sc, t);
      for (const [id, a] of want) {
        const b = sc.figure(id)!.pose!;
        hip.push(Math.abs(a.hipY - b.hipY));
        pitch.push(Math.abs(a.pitch - b.pitch));
        styles.push(Math.abs(a.hipY - b.hipY) < 0.03 && Math.abs(a.pitch - b.pitch) < 0.05 ? 1 : 0);
      }
    }
    played.dispose();
    const sorted = (v: number[]) => [...v].sort((x, y) => x - y);
    const q = (v: number[], k: number) => sorted(v)[Math.floor((v.length - 1) * k)]!;
    // Measured with the 1.5 s pre-roll: hip within 2.9 cm and lean within 0.08 rad for 90% of figures, worst hip
    // 12.8 cm, 84% agreeing on both. What is left is the stride's phase (which foot is pushing, and so the pelvis's
    // rise and fall): it is the gait's own clock, which no engine state sets, so no pre-roll pins it.
    expect(q(hip, 0.9)).toBeLessThan(0.04);
    expect(Math.max(...hip)).toBeLessThan(0.16);
    expect(q(pitch, 0.9)).toBeLessThan(0.1);
    expect(styles.reduce((x, y) => x + y, 0) / styles.length).toBeGreaterThan(0.75);
  });
});

describe('continuity in a real game', () => {
  it('no foot, hand or hip moves more than 10 cm in a 60 Hz frame over two minutes of real play through the scene', () => {
    const { setup: game, pb } = sharedPlayback();
    const sc = createGameScene(game);
    seekScene(pb, sc, 1200);
    const last = new Map<string, Pose>();
    let worst = 0, worstContact = 0, worstAt = '';
    // Milestone 3 Task 4: the frames of a hit's impact and of a fall and getting up (test/contact-frames.ts, from engine
    // facts) are measured apart, against the larger bound stated for them.
    const cf = contactFramesOf();
    for (let i = 0; i < 60 * 120; i++) {
      pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
      const cut = sc.cutNow(), fr = pb.frame();
      for (const s of fr.prev.skaters) {
        const f = sc.figure(s.id)!;
        if (!f.onIce || !f.pose) { last.delete(s.id); continue; }
        const was = last.get(s.id);
        const contact = cf.at((fr.tick + fr.alpha) * DT, fr.prev, fr.next, s.id);
        if (was && !cut && contact) worstContact = Math.max(worstContact, moved(was, f.pose));
        else if (was && !cut) { const m = moved(was, f.pose); if (m > worst) { worst = m; worstAt = `${fr.tick}+${fr.alpha} ${s.id}`; } }
        last.set(s.id, copyPose(f.pose));
      }
    }
    sc.dispose();
    // Today's worst is 9.1 cm (blends under the engine's rapid changes; the synthetic bound in gait.test.ts is 6).
    expect(worst).toBeGreaterThan(0.03);
    expect(worst, worstAt).toBeLessThan(0.1);
    expect(worstContact).toBeLessThan(CONTACT_FRAME_BOUND); // feet, hands and hip together
  });
});
