import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, type GameEventOf } from '@hockey/engine';
import { goalEnd, goalShow, goalTagText, GOAL_LIGHT_SECONDS, GOAL_TAG_SECONDS } from './goal-show';
import { createCursor } from './playback';
import { createGameScene, seekScene } from './scene';
import { recorded, sharedPlayback, testSetup } from './test/game';
import { buildTimeline } from './timeline';

const SEEDS = [5, 42] as const;
const ticks = (s: number): number => Math.round(s / DT);

describe('what shows round a goal', () => {
  it('lights the net scored on from the goal for 3 s: off 0.2 s before and 4 s after, never during a save', () => {
    for (const seed of SEEDS) {
      const rec = recorded(seed), tl = buildTimeline(rec.events), pb = createCursor(testSetup(seed), rec);
      expect(tl.goals.length).toBeGreaterThan(2);
      for (const g of tl.goals) {
        // The net the scoring side attacks, from the engine's state at the goal.
        pb.seek(g.tick);
        const end = pb.frame().prev.attackDir[g.side!];
        expect(goalEnd(g), `${seed} goal at ${g.tick}`).toBe(end);
        for (const t of [g.tick, g.tick + 0.5, g.tick + ticks(1.5), g.tick + ticks(GOAL_LIGHT_SECONDS) - 1]) expect(goalShow(tl, t).light, `${seed} ${g.tick} +${t - g.tick}`).toBe(end);
        expect(goalShow(tl, g.tick - ticks(0.2)).light).toBeNull();
        expect(goalShow(tl, g.tick + ticks(4)).light).toBeNull();
      }
      const saves = rec.events.filter((e) => e.type === 'save');
      expect(saves.length).toBeGreaterThan(20);
      for (const s of saves) {
        if (tl.last('goal', s.tick, ticks(6))) continue;
        for (const t of [s.tick, s.tick + 10, s.tick + 60]) {
          const sh = goalShow(tl, t);
          expect(sh.light).toBeNull(); expect(sh.flash).toBeNull(); expect(sh.tag).toBeNull(); expect(sh.hold).toBeNull();
        }
        expect(goalShow(tl, s.tick).savePulse, `save at ${s.tick}`).toBeGreaterThan(0.9);
        expect(goalShow(tl, s.tick + ticks(1)).savePulse).toBe(0);
      }
    }
  });

  it('the score bug: the score at any tick is the engine\'s and the timeline\'s, the flash is on the scoring side, and the tag names the scorer and his assists', () => {
    for (const seed of SEEDS) {
      const rec = recorded(seed), tl = buildTimeline(rec.events), pb = createCursor(testSetup(seed), rec), setup = testSetup(seed);
      const at = new Set<number>();
      for (let t = 0; t <= rec.totalTicks; t += 997) at.add(t);
      for (const g of tl.goals) for (const d of [-1, 0, 1, 30]) at.add(g.tick + d);
      for (const t of at) {
        pb.seek(t);
        const sh = goalShow(tl, t);
        expect(sh.score).toEqual(tl.scoreAt(t));
        expect(sh.score, `${seed} tick ${t}`).toEqual(pb.frame().prev.score);
      }
      const all = [...setup.home.players, ...setup.away.players];
      for (const g of tl.goals) {
        const mid = goalShow(tl, g.tick + ticks(1));
        expect(mid.flash).toBe(g.side);
        expect(mid.flashK).toBeGreaterThan(0.4);
        // A clear flash at the goal, fading over the 3 s; the score digits pop once.
        expect(goalShow(tl, g.tick).flashK).toBeGreaterThan(0.95);
        expect(goalShow(tl, g.tick + ticks(2.9)).flashK).toBeLessThan(0.05);
        expect(goalShow(tl, g.tick + ticks(3)).flash).toBeNull();
        expect(goalShow(tl, g.tick + ticks(0.4)).pop).toBeGreaterThan(0.95);
        expect(goalShow(tl, g.tick + ticks(1)).pop).toBe(0);
        expect(goalShow(tl, g.tick + ticks(1)).hold!.k).toBeGreaterThan(0.99);
        expect(goalShow(tl, g.tick - 1).hold).toBeNull();
        expect(mid.tag).toBe(g);
        expect(goalShow(tl, g.tick + ticks(GOAL_TAG_SECONDS) - 1).tag).toBe(g);
        expect(goalShow(tl, g.tick + ticks(GOAL_TAG_SECONDS) + 1).tag).toBeNull();
        expect(goalShow(tl, g.tick - 1).tag).not.toBe(g);
        const words = goalTagText(g, setup), scorer = all.find((p) => p.id === g.playerId)!;
        expect(words.scorer).toContain(`#${scorer.number}`);
        expect(words.scorer).toContain(scorer.name.split(' ').pop()!);
        for (const id of g.assistIds) { const a = all.find((p) => p.id === id)!; expect(words.assists).toContain(`#${a.number} ${a.name.split(' ').pop()!}`); }
        if (g.assistIds.length === 0) expect(words.assists).toBe('Unassisted');
      }
    }
  });

  it('a seek into a goal shows its net\'s light lit (and only that one); a seek out of it shows them dark', () => {
    const { setup, pb } = sharedPlayback(5);
    const sc = createGameScene(setup, { events: pb.events });
    const tl = buildTimeline(pb.events);
    const lit = (end: 1 | -1): boolean => {
      const lamp = sc.root.getObjectByName(end === 1 ? 'goalLightE' : 'goalLightW') as THREE.Object3D;
      return lamp.userData.lit as number > 0.5;
    };
    for (const g of tl.goals.slice(0, 3) as GameEventOf<'goal'>[]) {
      seekScene(pb, sc, g.tick + ticks(1.5));
      expect(lit(goalEnd(g))).toBe(true);
      expect(lit(goalEnd(g) === 1 ? -1 : 1)).toBe(false);
      seekScene(pb, sc, g.tick + ticks(4.5));
      expect(lit(1)).toBe(false); expect(lit(-1)).toBe(false);
    }
    sc.dispose();
  });
});
