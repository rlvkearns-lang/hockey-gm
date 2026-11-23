import { describe, expect, it } from 'vitest';
import type { ContestState, GameEventOf } from '@hockey/engine';
import { createCursor } from '../playback';
import { createGameScene, seekScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline } from '../timeline';
import { initialSkaterAnim, OVERLAYS, poseSkater, stepSkater, type SkaterSample } from '../animator';
import { contextWith, sample } from '../test/anim';
import { BATTLE_OVERLAYS } from './battles';

/**
 * Board battles: their end and their mirror image. The whole-period measurements (one pass over the first period of
 * seed 5 through the animator and the body pass) are in period.picture.test.ts, and the seeks into a battle against play
 * in battles.picture.test.ts (npm run test:picture).
 */

describe('battles end and mirror cleanly', () => {
  it('a battle cut off by a period break leaves nothing on anyone after the break', () => {
    // A contest the engine closed with `whistle` at a period's end (seed 42 has a board battle there).
    for (const seed of [42, 5]) {
      const rec = recorded(seed), setup = testSetup(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
      const ends = new Set(tl.periodEnds);
      const cut = rec.events.find((e): e is GameEventOf<'contestEnd'> => e.type === 'contestEnd' && e.detail.result === 'whistle' && ends.has(e.tick));
      expect(cut, `seed ${seed}`).toBeDefined();
      const ids = tl.contest(cut!.detail.contestId)!.start.detail.participants;
      const withB = createGameScene(setup, { timeline: tl });
      const without = createGameScene(setup, { timeline: tl, animation: { skaters: OVERLAYS.filter((o) => !BATTLE_OVERLAYS.includes(o)) } });
      for (const sc of [withB, without]) seekScene(pb, sc, cut!.tick - 60);
      for (let i = 1; i <= 180; i++) { pb.seek(cut!.tick - 60 + i / 2); withB.update(pb.frame(), 1 / 60); without.update(pb.frame(), 1 / 60); }
      // 1.5 s after the break: every participant drawn exactly as with no battle overlays at all.
      for (const id of ids) {
        const a = withB.figure(id)!, b = without.figure(id)!;
        expect(a.onIce).toBe(b.onIce);
        if (a.pose && b.pose) expect(a.pose, `${seed} ${id}`).toEqual(b.pose);
      }
      withB.dispose(); without.dispose();
    }
  });

  it('a right shot in a battle is the mirror image of a left shot in the mirrored battle', () => {
    // A pin on the boards at +y with him the pinner, and the same mirrored across his facing (y to -y) with him a right
    // shot: his body-frame pose (left-shot frame, as the rig mirrors it) is the same.
    const make = (sgn: 1 | -1, right: boolean) => {
      const me = sample({ right, speed: 0.3 }), other = sample({ speed: 0.2 });
      (me as { id: string }).id = 'p1'; (other as { id: string }).id = 'p2';
      me.pos.x = 3; me.pos.y = sgn * 11.6; me.facing = sgn * 1.3;
      other.pos.x = 3.2; other.pos.y = sgn * 12.3; other.facing = sgn * 1.4;
      (me.state as { pos: { x: number; y: number }; facing: number }).pos = { ...me.pos }; (me.state as { facing: number }).facing = me.facing;
      me.vel.x = 0.3 * Math.cos(me.facing); me.vel.y = 0.3 * Math.sin(me.facing);
      const ctx = contextWith({});
      (ctx.skaters as Map<string, SkaterSample>).set('p1', me).set('p2', other);
      const contest = {
        id: 77, kind: 'boardBattle', stage: 'dig', stageT: 0.4, participants: ['p1', 'p2'], leader: 'p1', spot: { x: 3.3, y: sgn * 12.4 }, freeIds: [],
        roles: { a: 'p1', b: 'p2', carrier: null, stripped: null, first: 'p1', pinned: 'p2', digLast: 'p1', supportA: null, supportB: null, winner: null },
        data: { holdsPuck: true, slide: 0, held: 0, firstSet: true, balance: 2, nextAt: 1, digRounds: 1, clean: false },
      } as unknown as ContestState;
      (ctx as unknown as { contests: ContestState[] }).contests = [contest];
      (ctx.state as { contests: ContestState[] }).contests = [contest];
      ctx.puck.engine = { x: 3.3, y: 0, z: sgn * 12.4 }; ctx.puck.drawn = { ...ctx.puck.engine };
      let anim = initialSkaterAnim();
      for (let i = 0; i < 30; i++) { anim = stepSkater(anim, me, ctx, 1 / 30, BATTLE_OVERLAYS); ctx.time += 1 / 30; }
      return { pose: poseSkater(anim, me, ctx, me.dims, BATTLE_OVERLAYS), ctx };
    };
    const l = make(1, false), r = make(-1, true);
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);
    near(l.pose.pose.hipY, r.pose.pose.hipY); near(l.pose.pose.twist ?? 0, r.pose.pose.twist ?? 0); near(l.pose.pose.roll, r.pose.pose.roll);
    for (const k of ['x', 'y', 'z'] as const) {
      near(l.pose.pose.blade[k], r.pose.pose.blade[k]);
      near(l.pose.pose.arms[0].hand[k], r.pose.pose.arms[0].hand[k]); near(l.pose.pose.arms[1].hand[k], r.pose.pose.arms[1].hand[k]);
    }
    // And the drawn offset mirrors across his facing: x the same, the cross-ice part reversed.
    near(l.pose.offset.x, r.pose.offset.x); near(l.pose.offset.z, -r.pose.offset.z);
    // The stance is really on (not two plain skating poses).
    expect(Math.abs(l.pose.pose.pitch - 0.36)).toBeGreaterThan(0.2);
  });
});
