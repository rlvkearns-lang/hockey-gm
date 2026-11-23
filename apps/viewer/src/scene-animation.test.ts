import { describe, expect, it } from 'vitest';
import type { GameState } from '@hockey/engine';
import { initialGoalieAnim, poseGoalie, stepGoalieAnim, type GoalieOverlay, type Overlay } from './animator';
import { bodyDims } from './body';
import { createGameScene, seekScene } from './scene';
import { emptyContext, goalieSample } from './test/anim';
import { sharedPlayback } from './test/game';

/**
 * The animator's contract with the scene: every figure is sampled before any is stepped, so a step reads this frame's
 * samples of all the others; goalies have an overlay path of their own, with state the pre-roll rebuilds.
 */

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

describe('the scene animates in passes', () => {
  it('an overlay step reads this frame\'s samples of a skater later in the list and of a goalie, also on the first update after a seek', () => {
    const { setup, pb } = sharedPlayback();
    const t = 31000;
    pb.seek(t);
    const st = pb.frame().prev;
    const order = [...setup.home.players, ...setup.away.players].filter((p) => p.position !== 'G').map((p) => p.id);
    const on = order.filter((id) => st.skaters.find((s) => s.id === id)!.onIce);
    const first = on[0]!, last = on[on.length - 1]!, goalie = st.goalies.away.id;
    const seen: { tick: number; alpha: number; other: { x: number; y: number }; g: { x: number; y: number } }[] = [];
    const probe: Overlay<number> = {
      id: 'probe',
      step(slot, sample, ctx) {
        if (sample.id === first) {
          const o = ctx.skaters.get(last)!, g = ctx.goalies.get(goalie)!;
          seen.push({ tick: ctx.tick, alpha: ctx.alpha, other: { ...o.pos }, g: { ...g.pos } });
        }
        return (slot ?? 0) + 1;
      },
      weight: () => 0,
      apply: (raw) => raw,
    };
    const sc = createGameScene(setup, { events: pb.events, animation: { skaters: [probe] } });
    const expected = (f: { prev: GameState; next: GameState; alpha: number }) => {
      const p = f.prev.skaters.find((s) => s.id === last)!, n = f.next.skaters.find((s) => s.id === last)!;
      return {
        other: { x: lerp(p.pos.x, n.pos.x, f.alpha), y: lerp(p.pos.y, n.pos.y, f.alpha) },
        g: { x: lerp(f.prev.goalies.away.pos.x, f.next.goalies.away.pos.x, f.alpha), y: lerp(f.prev.goalies.away.pos.y, f.next.goalies.away.pos.y, f.alpha) },
      };
    };
    // Somewhere else first, so a stale sample would be from another time.
    seekScene(pb, sc, 9000, 0);
    seen.length = 0;
    seekScene(pb, sc, t, 0); // reset and one update
    expect(seen.length).toBe(1);
    const want0 = expected(pb.frame());
    expect(seen[0]!.other.x).toBeCloseTo(want0.other.x, 9); expect(seen[0]!.other.y).toBeCloseTo(want0.other.y, 9);
    expect(seen[0]!.g.x).toBeCloseTo(want0.g.x, 9); expect(seen[0]!.g.y).toBeCloseTo(want0.g.y, 9);
    for (let i = 0; i < 20; i++) {
      pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
      const s = seen[seen.length - 1]!, want = expected(pb.frame());
      expect(s.alpha).toBe(pb.frame().alpha);
      expect(s.other.x).toBeCloseTo(want.other.x, 9); expect(s.other.y).toBeCloseTo(want.other.y, 9);
      expect(s.g.x).toBeCloseTo(want.g.x, 9); expect(s.g.y).toBeCloseTo(want.g.y, 9);
    }
    sc.dispose();
  });

  it('a skater off the ice still has this frame\'s sample (his engine state, not on the ice)', () => {
    const { setup, pb } = sharedPlayback();
    const sc = createGameScene(setup, { animation: { skaters: [{
      id: 'check', weight: () => 0, apply: (raw) => raw,
      step(_slot, _sample, ctx) {
        for (const s of ctx.state.skaters) {
          const sm = ctx.skaters.get(s.id)!;
          if (!s.onIce) { expect(sm.onIce).toBe(false); expect(sm.state.id).toBe(s.id); expect(sm.pos.x).toBe(sm.state.pos.x); }
        }
        return 0;
      },
    }] } });
    seekScene(pb, sc, 20000, 0);
    for (let i = 0; i < 5; i++) { pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60); }
    sc.dispose();
  });

  it('a body pass runs between posing and drawing, and moves where a body is drawn', () => {
    const { setup, pb } = sharedPlayback();
    const id = setup.home.lines.forwards[0]![1]!;
    const sc = createGameScene(setup, { animation: { bodyPass: (bodies) => { for (const b of bodies) if (b.id === id) { b.offset.x += 0.2; b.eased.x += 1; } } } });
    const plain = createGameScene(setup);
    let t = 3000; for (; t < 40000; t += 50) { pb.seek(t); if (pb.frame().prev.skaters.find((s) => s.id === id)!.onIce) break; }
    seekScene(pb, sc, t, 0); seekScene(pb, plain, t, 0);
    expect(sc.figure(id)!.position.x - plain.figure(id)!.position.x).toBeCloseTo(0.2, 9);
    expect(sc.figure(id)!.position.z).toBe(plain.figure(id)!.position.z);
    sc.dispose(); plain.dispose();
  });
});

describe('goalie overlays', () => {
  /** A test-only overlay: raises the glove 0.2 m, its weight whatever `w` says, its state the seconds since he started afresh. */
  const raise = (w: (seconds: number) => number): GoalieOverlay<number> => ({
    id: 'raiseGlove',
    step: (slot, _s, _c, dt) => (slot ?? 0) + dt,
    weight: (anim) => w((anim.slots.raiseGlove as number | undefined) ?? 0),
    apply: (raw) => ({ ...raw, glove: { ...raw.glove, y: raw.glove.y + 0.2 } }),
  });

  it('a goalie overlay is applied with its weight and removed cleanly', () => {
    const d = bodyDims(188, 88), s = goalieSample(), ctx = emptyContext();
    let a = initialGoalieAnim();
    for (let i = 0; i < 30; i++) a = stepGoalieAnim(a, s, ctx, 1 / 60, []);
    const plain = poseGoalie(a, s, ctx, d, []);
    let weight = 0;
    const ov = [raise(() => weight)] as GoalieOverlay[];
    expect(poseGoalie(a, s, ctx, d, ov)).toEqual(plain);
    weight = 1; const full = poseGoalie(a, s, ctx, d, ov);
    weight = 0.5; const half = poseGoalie(a, s, ctx, d, ov);
    expect(full.glove.y - plain.glove.y).toBeCloseTo(0.2, 6);
    expect(half.glove.y - plain.glove.y).toBeCloseTo(0.1, 6);
    expect(full.blocker).toEqual(plain.blocker); expect(full.legs).toEqual(plain.legs);
    weight = 0; expect(poseGoalie(a, s, ctx, d, ov)).toEqual(plain);
  });

  it('its state lives in the goalie\'s slots and the pre-roll of a seek rebuilds it', () => {
    const { setup, pb } = sharedPlayback();
    const ov = [raise((sec) => Math.min(1, sec / 1))] as GoalieOverlay[];
    const sc = createGameScene(setup, { animation: { goalies: ov } }), plain = createGameScene(setup);
    const t = 25000;
    pb.seek(t); const gid = pb.frame().prev.goalies.home.id;
    // With the pre-roll (1.5 s played in) the slot has counted past a second: the glove is fully up.
    seekScene(pb, sc, t); seekScene(pb, plain, t);
    const up = sc.figure(gid)!.goaliePose!.glove.y - plain.figure(gid)!.goaliePose!.glove.y;
    // A plain seek starts the slot afresh: nothing shows yet.
    seekScene(pb, sc, t, 0); seekScene(pb, plain, t, 0);
    const fresh = sc.figure(gid)!.goaliePose!.glove.y - plain.figure(gid)!.goaliePose!.glove.y;
    expect(Math.abs(up)).toBeGreaterThan(0.1);
    expect(fresh).toBe(0);
    sc.dispose(); plain.dispose();
  });
});
