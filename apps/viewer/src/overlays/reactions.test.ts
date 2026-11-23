import { describe, expect, it } from 'vitest';
import { DT, type GameEventOf, type GameSetup } from '@hockey/engine';
import { GOALIE_OVERLAYS, OVERLAYS, type GoalieOverlay, type Overlay } from '../animator';
import { bodyDims } from '../body';
import { createCursor, type Playback, type Recording } from '../playback';
import { shoulderJoint } from '../pose-mix';
import { createGameScene, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';

/**
 * Blocked shots and goal reactions through the real scene and recorded games (seeds 5 and 42). The reaction overlays'
 * weights are read through wrappers round the registered overlays (`celebrate` for skaters, `beaten` for goalies).
 */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene; weights: Map<string, number> };
const games = new Map<number, Game>();
function game(seed: number): Game {
  let g = games.get(seed);
  if (!g) {
    const rec = recorded(seed), tl = buildTimeline(rec.events), setup = testSetup(seed);
    // Every overlay's weight on every figure this frame, keyed `${overlay id}|${figure id}`.
    const weights = new Map<string, number>();
    const skaters = OVERLAYS.map((ov): Overlay => ({ ...ov, weight: (a, s, c) => { const w = ov.weight(a, s, c); weights.set(`${ov.id}|${s.id}`, w); return w; } }));
    const goalies = GOALIE_OVERLAYS.map((ov): GoalieOverlay => ({ ...ov, weight: (a, s, c) => { const w = ov.weight(a, s, c); weights.set(`${ov.id}|${s.id}`, w); return w; } }));
    g = { rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl, animation: { skaters, goalies } }), weights };
    games.set(seed, g);
  }
  return g;
}
function play(g: Game, from: number, to: number, hz: number, each: (t: number) => void): void {
  seekScene(g.pb, g.sc, from);
  const step = 1 / (hz * DT);
  for (let t = from + step; t <= to + 1e-9; t += step) { g.weights.clear(); g.pb.seek(t); g.sc.update(g.pb.frame(), 1 / hz); each(t); }
}
const dimsOf = (setup: GameSetup, id: string) => { const d = [...setup.home.players, ...setup.away.players].find((p) => p.id === id)!; return bodyDims(d.heightCm, d.weightKg); };

describe('blocked shots', () => {
  it('a blocker is in the shooting lane, low, when the puck reaches him', () => {
    // First 10 block events of each seed: at the moment the engine turns the puck back off him (display time T - 1,
    // the block event's tick T), his hips are under 0.75 of his standing hip height or his shoulders are turned more
    // than 60 degrees from the shot's line.
    for (const seed of [5, 42]) {
      const g = game(seed);
      const blocks = g.rec.events.filter((e): e is GameEventOf<'block'> => e.type === 'block').slice(0, 10);
      expect(blocks.length).toBe(10);
      for (const b of blocks) {
        const rel = g.tl.last('release', b.detail.releaseTick, 0, b.otherId!)!;
        seekScene(g.pb, g.sc, b.tick - 1);
        const v = g.sc.figure(b.playerId!)!, p = v.pose!, dims = dimsOf(g.setup, b.playerId!);
        // The shot's line in his body frame (mirrored for a right shot, as the pose is), and his shoulders' heading.
        const right = [...g.setup.home.players, ...g.setup.away.players].find((d) => d.id === b.playerId)!.shoots === 'R';
        const line = Math.atan2(rel.detail.vel.y, rel.detail.vel.x) - v.facing;
        const lineBody = (right ? -1 : 1) * Math.atan2(Math.sin(line), Math.cos(line));
        const shoulders = p.twist ?? 0; // the heading his shoulders face, in his body frame
        const turned = Math.abs(Math.atan2(Math.sin(lineBody + Math.PI - shoulders), Math.cos(lineBody + Math.PI - shoulders)));
        const low = p.hipY < 0.75 * dims.hipHeight;
        expect(low || turned > Math.PI / 3, `seed ${seed} block at ${b.tick}: hip ${p.hipY.toFixed(2)} of ${dims.hipHeight.toFixed(2)}`).toBe(true);
      }
    }
  });
});

describe('goal reactions', () => {
  it('after a goal the scorer has his hands above his shoulders within a second, and nobody is still celebrating at the next faceoff setup', () => {
    // Every goal: within 30 ticks of the goal both of the scorer's hands are above his shoulders. The celebration and
    // the beaten goalie's slump are gone before the puck is dropped (the faceoff that follows): no celebrate or beaten
    // weight on anyone just before the draw, or anywhere in the last 0.5 s before it.
    let n = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const goal of g.tl.goals) {
        const id = goal.playerId!;
        let up = false;
        play(g, goal.tick - 5, goal.tick + 30, 30, () => {
          const v = g.sc.figure(id);
          if (!v || !v.onIce || !v.pose) return;
          const p = v.pose, sh = Math.max(shoulderJoint(p, 0, dimsOf(g.setup, id)).y, shoulderJoint(p, 1, dimsOf(g.setup, id)).y);
          if (p.arms[0].hand.y > sh && p.arms[1].hand.y > sh) up = true;
        });
        expect(up, `seed ${seed} goal at ${goal.tick}`).toBe(true);
        const draw = g.tl.next('faceoff', goal.tick, 60 * 30)!;
        let left = 0;
        play(g, draw.tick - 16, draw.tick - 1, 30, () => {
          for (const [k, w] of g.weights) if ((k.startsWith('celebrate|') || k.startsWith('beaten|')) && w > 0) left++;
        });
        expect(left, `seed ${seed} goal at ${goal.tick}: still celebrating at the draw`).toBe(0);
        n++;
      }
    }
    expect(n).toBeGreaterThan(8);
  });

  // Beyond the brief's list.
  it('the beaten goalie slumps, and the scorer\'s teammates raise their sticks, while the play is stopped', () => {
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const goal of g.tl.goals) {
        let slump = 0, mates = 0;
        play(g, goal.tick + 20, goal.tick + 30, 30, () => {
          slump = Math.max(slump, g.weights.get(`beaten|${goal.otherId}`) ?? 0);
          mates = 0;
          for (const id of goal.onIce![goal.side!]) if (id !== goal.playerId && (g.weights.get(`celebrate|${id}`) ?? 0) > 0.5) mates++;
        });
        expect(slump, `seed ${seed} goal at ${goal.tick}`).toBeGreaterThan(0.9);
        expect(mates).toBeGreaterThan(1);
      }
    }
  });
});
