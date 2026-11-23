import { describe, expect, it } from 'vitest';
import type { GameEventOf } from '@hockey/engine';
import { OVERLAYS, type Overlay } from '../animator';
import { createCursor } from '../playback';
import type { Vec3 } from '../pose-mix';
import { createGameScene, seekScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline } from '../timeline';
import { BATTLE_OVERLAYS } from './battles';

/** Seeks into a battle against play (npm run test:picture; moved from battles.test.ts, unchanged). */

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('seeking into a battle', () => {
  /** Seek against play (4 s of play at 60 Hz before) at each moment: the stance parts of everyone in the battle. */
  function compare(seed: number, moments: { t: number; ids: string[] }[], skaters?: readonly Overlay[]): { worst: number; worstAt: string; pos: number; posAt: string; each: number[] } {
    const rec = recorded(seed), setup = testSetup(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
    const opts = skaters ? { timeline: tl, animation: { skaters } } : { timeline: tl };
    const played = createGameScene(setup, opts), seeked = createGameScene(setup, opts);
    let worst = 0, worstAt = '', pos = 0, posAt = '';
    const each: number[] = [];
    for (const { t, ids } of moments) {
      seekScene(pb, played, t - 120, 0);
      for (let i = 1; i <= 240; i++) { pb.seek(t - 120 + i / 2); played.update(pb.frame(), 1 / 60); }
      seekScene(pb, seeked, t);
      let here = 0;
      for (const id of ids) {
        const fa = played.figure(id)!, fb = seeked.figure(id)!;
        if (!fa.pose || !fb.pose) continue;
        const a = fa.pose, b = fb.pose;
        // The stance's own parts: the blade, the free hand, the shoulders' turn. (The hips and the top hand solved from
        // the blade also carry the gait's stride, whose phase depends on the gait's history: scene-seek.picture.test.ts.)
        const m = Math.max(dist3(a.arms[0].hand, b.arms[0].hand), dist3(a.blade, b.blade), Math.abs((a.twist ?? 0) - (b.twist ?? 0)));
        here = Math.max(here, m);
        if (m > worst) { worst = m; worstAt = `${t} ${id}`; }
        const d = Math.hypot(fa.position.x - fb.position.x, fa.position.z - fb.position.z);
        if (d > pos) { pos = d; posAt = `${t} ${id}`; }
      }
      each.push(here);
    }
    played.dispose(); seeked.dispose();
    return { worst, worstAt, pos, posAt, each };
  }

  it('a seek into the middle of a dig shows the poses play shows', () => {
    const rec = recorded(5), tl = buildTimeline(rec.events);
    const moments = rec.events.filter((e): e is GameEventOf<'contestStart'> => e.type === 'contestStart' && e.detail.kind === 'boardBattle')
      .map((e) => ({ e, end: tl.contest(e.detail.contestId)?.end }))
      .filter(({ e, end }) => end && end.detail.result !== 'protected' && end.tick - e.tick >= 70).slice(0, 4)
      .map(({ e, end }) => ({ t: end!.tick - 20, ids: e.detail.participants })); // in the dig, the stances well under way
    expect(moments.length).toBe(4);
    const r = compare(5, moments), plain = compare(5, moments, OVERLAYS.filter((o) => !BATTLE_OVERLAYS.includes(o)));
    // The gait's stride phase is not pinned by any engine state (scene-seek.test.ts); the battle stances are: they add
    // no more than 0.03 m to what the skating alone differs by, and stay within 0.1 m.
    r.each.forEach((m, i) => expect(m, `${moments[i]!.t}: ${m.toFixed(3)} against ${plain.each[i]!.toFixed(3)} plain`).toBeLessThan(Math.max(0.1, plain.each[i]! + 0.03)));
  });

  it('a seek just after a man is pinned or a supporter joins shows what play shows', () => {
    // From the engine's states: the tick each of the first battles names its pinned man, and the tick a supporter joins.
    const seed = 5, rec = recorded(seed), pb = createCursor(testSetup(seed), rec);
    const moments: { t: number; ids: string[] }[] = [];
    let pins = 0, sups = 0;
    for (const e of rec.events) {
      if (pins >= 3 && sups >= 3) break;
      if (e.type !== 'contestStart' || e.detail.kind !== 'boardBattle') continue;
      let pinSeen = false, supSeen = false;
      for (let t = e.tick; t < e.tick + 150; t++) {
        pb.seek(t);
        const c = pb.frame().prev.contests.find((k) => k.id === e.detail.contestId);
        if (!c || c.kind !== 'boardBattle') break;
        if (!pinSeen && c.roles.pinned !== null) { pinSeen = true; if (pins < 3) { pins++; moments.push({ t: t + 3, ids: c.participants.slice() }); } }
        if (!supSeen && (c.roles.supportA !== null || c.roles.supportB !== null)) { supSeen = true; if (sups < 3) { sups++; moments.push({ t: t + 3, ids: c.participants.slice() }); } }
      }
    }
    expect(moments.length).toBe(6);
    const r = compare(seed, moments);
    // The same moments with the battle overlays out: what the skating itself differs by (its stride's phase, which no
    // engine state pins, swings a free arm and the stick). The battle stances add no more than 0.08 m to it, at each
    // moment, and the drawn places agree within 0.15 m.
    const plain = compare(seed, moments, OVERLAYS.filter((o) => !BATTLE_OVERLAYS.includes(o)));
    r.each.forEach((m, i) => expect(m, `${moments[i]!.t}: ${m.toFixed(3)} against ${plain.each[i]!.toFixed(3)} without the battle stances`).toBeLessThan(Math.max(0.15, plain.each[i]! + 0.08)));
    expect(r.pos, `drawn place ${r.posAt}`).toBeLessThan(0.15);
  });
});
