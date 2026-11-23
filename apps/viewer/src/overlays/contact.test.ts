import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, type GameEventOf, type GameSetup } from '@hockey/engine';
import { bodyDims, type BodyDims } from '../body';
import { initialGait, poseOf } from '../gait';
import { createCursor, type Playback, type Recording } from '../playback';
import { armReach, shoulderJoint, type SkaterPose, type Vec3 } from '../pose-mix';
import { createGameScene, PUCK_SCALE, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';

/**
 * Poke checks, hits, falls and the body pass, through the real scene and recorded games (seeds 5 and 42). The
 * whole-period bounds are in period.picture.test.ts and the seek into a fall in contact.picture.test.ts (npm run
 * test:picture).
 */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene; dims: Map<string, BodyDims>; right: Map<string, boolean> };
const games = new Map<number, Game>();
function game(seed: number): Game {
  let g = games.get(seed);
  if (!g) {
    const rec = recorded(seed), tl = buildTimeline(rec.events), setup = testSetup(seed);
    const all = [...setup.home.players, ...setup.away.players];
    g = {
      rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl }),
      dims: new Map(all.map((d) => [d.id, bodyDims(d.heightCm, d.weightKg)])), right: new Map(all.map((d) => [d.id, d.shoots === 'R'])),
    };
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
const standHip = (d: BodyDims): number => poseOf(initialGait(), { speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false }, d).hipY;
/** A body-frame point of his drawn pose in the world (x, z), from where and how he is drawn. */
function world(g: Game, id: string, p: { x: number; z: number }): { x: number; z: number } {
  const f = g.sc.figure(id)!, bz = g.right.get(id) ? -p.z : p.z, c = Math.cos(f.facing), n = Math.sin(f.facing);
  return { x: f.position.x + p.x * c - bz * n, z: f.position.z + p.x * n + bz * c };
}
function shouldersMid(pose: SkaterPose, d: BodyDims): Vec3 {
  const a = shoulderJoint(pose, 0, d), b = shoulderJoint(pose, 1, d);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
const hitsOf = (g: Game, result: string): GameEventOf<'hit'>[] =>
  g.rec.events.filter((e): e is GameEventOf<'hit'> => e.type === 'hit' && e.detail.result === result);
const engineAt = (g: Game, tick: number): ReturnType<Playback['frame']>['prev'] => { g.pb.seek(tick); return g.pb.frame().prev; };

describe('poke checks', () => {
  it('during the reach stage of a poke check the checker blade is at the puck', () => {
    let checked = 0, atPuck = 0, full = 0, underfoot = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      const starts = g.rec.events.filter((e): e is GameEventOf<'contestStart'> => e.type === 'contestStart' && e.detail.kind === 'pokeCheck').slice(0, 20);
      for (const e of starts) {
        const mid = e.tick + 4; // the reach lasts 0.25 s (7.5 ticks) from the contest's first tick
        const c = engineAt(g, mid).contests.find((k) => k.id === e.detail.contestId);
        if (!c || c.stage !== 'reach' || c.kind !== 'pokeCheck') continue; // he let the puck go first
        const checker = c.roles.checker;
        play(g, mid, mid);
        const f = g.sc.figure(checker)!, pose = f.pose!, d = g.dims.get(checker)!;
        const blade = world(g, checker, pose.blade), puck = g.sc.puckWorld();
        const dist = Math.hypot(blade.x - puck.x, blade.z - puck.z);
        // A puck within 0.8 m of his centre (between or behind his skates) is nearer than a blade on the ice can come:
        // counted apart.
        checked++;
        if (dist < 0.35) { atPuck++; continue; }
        if (Math.hypot(puck.x - f.position.x, puck.z - f.position.z) < 0.8) { underfoot++; continue; }
        // Out of reach: the stick at full stretch, pointing at the puck.
        // Full stretch: the blade as far from his top-hand shoulder as the drawn figure puts it (the overlay keeps it
        // within 90% of arm plus shaft, short of the point where the arm's solution whips the hand), to within 5%.
        const sh = shoulderJoint(pose, 1, d);
        const bl = { x: pose.blade.x - sh.x, y: pose.blade.y - sh.y, z: pose.blade.z - sh.z };
        const arm = Math.hypot(bl.x, bl.y, bl.z);
        const reach = 0.9 * (armReach(d) * 0.98 + 0.86 * d.stick);
        const bx = blade.x - f.position.x, bz = blade.z - f.position.z, px = puck.x - f.position.x, pz = puck.z - f.position.z;
        const ang = Math.acos(Math.max(-1, Math.min(1, (bx * px + bz * pz) / (Math.hypot(bx, bz) * Math.hypot(px, pz)))));
        expect.soft(arm > 0.95 * reach && ang < 0.3, `${seed}@${mid} ${checker}: ${dist.toFixed(2)} m from the puck, which is ${Math.hypot(px, pz).toFixed(2)} m away; blade out ${Math.hypot(bx, bz).toFixed(2)}, shoulder to blade ${arm.toFixed(2)} of ${reach.toFixed(2)}, ${ang.toFixed(2)} rad off; puck at ${(Math.atan2(pz, px) - f.facing).toFixed(2)} rad from his facing, blade at ${(Math.atan2(bz, bx) - f.facing).toFixed(2)}, shoots ${g.right.get(checker) ? 'R' : 'L'}`).toBe(true);
        full++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(underfoot).toBeLessThan(5);
    expect(atPuck).toBeGreaterThan(full);
  });
});

describe('hits', () => {

  it('a landed hit moves the target upper body away from the hitter at impact, and a downed target is on the ice then standing again when downT ends', () => {
    const g = game(5);
    const end1 = g.tl.periodEnds[0]!;
    let checked = 0;
    for (const e of hitsOf(g, 'landed').filter((h) => h.tick < end1)) {
      const target = e.otherId!, hitter = e.playerId!, d = g.dims.get(target)!;
      const at = engineAt(g, e.tick), t0 = at.skaters.find((s) => s.id === target)!;
      if (!(t0.downT > 0)) continue;
      const D = t0.downT; // seconds left at the hit's tick
      const I = e.tick - 5, mid = e.tick + Math.round(D / 2 / DT), up = e.tick + Math.ceil(D / DT - 1e-6);
      expect(engineAt(g, up).skaters.find((s) => s.id === target)!.downT).toBe(0);
      const pre = engineAt(g, I - 3), hP = pre.skaters.find((s) => s.id === hitter)!, tP = pre.skaters.find((s) => s.id === target)!;
      const ul = Math.hypot(tP.pos.x - hP.pos.x, tP.pos.y - hP.pos.y), ux = (tP.pos.x - hP.pos.x) / ul, uz = (tP.pos.y - hP.pos.y) / ul;
      // The upper body relative to his engine place, along the line from the hitter: before contact, and its furthest
      // from the hitter from the hit's tick to 0.27 s after.
      let before = 0, after = -Infinity;
      const hips: Record<number, number> = {};
      play(g, I - 3, up + 9, (t) => {
        if (t === I - 3 || (t >= e.tick && t <= e.tick + 8)) {
          const st = g.pb.frame().prev, s = st.skaters.find((k) => k.id === target)!;
          const m = world(g, target, shouldersMid(g.sc.figure(target)!.pose!, d));
          const v = (m.x - s.pos.x) * ux + (m.z - s.pos.y) * uz;
          if (t === I - 3) before = v; else after = Math.max(after, v);
        }
        if (t === mid || t === up + 9) hips[t] = g.sc.figure(target)!.hipY;
      });
      expect(after - before, `${e.tick} upper body away`).toBeGreaterThan(0.1);
      expect(hips[mid]!, `${e.tick} hip at mid-down`).toBeLessThan(0.45);
      expect(Math.abs(hips[up + 9]! - standHip(d)), `${e.tick} hip 0.3 s after`).toBeLessThan(0.1);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('an absorbed hit leaves both skaters above 0.7 of standing hip height throughout', () => {
    let checked = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const e of hitsOf(g, 'absorbed').slice(0, 10 - checked)) {
        const ids = [e.playerId!, e.otherId!];
        let low = Infinity;
        play(g, e.tick - 15, e.tick + 30, () => {
          for (const id of ids) low = Math.min(low, g.sc.figure(id)!.hipY / standHip(g.dims.get(id)!));
        });
        expect(low, `${seed}@${e.tick}`).toBeGreaterThan(0.7);
        checked++;
      }
    }
    expect(checked).toBe(10);
  });
});

describe('hits that show their weight and speed', () => {
  it('the target is thrown further and goes down faster the more mass times speed the hit carries, and a lighter hitter recoils more', () => {
    type Row = { rc: number; ratio: number; peak: number; fall: number; recoil: number };
    const rows: Row[] = [];
    for (const seed of [5, 42]) {
      const g = game(seed);
      const mass = (id: string): number => [...g.setup.home.players, ...g.setup.away.players].find((p) => p.id === id)!.weightKg + 9;
      for (const e of hitsOf(g, 'landed')) {
        const T = e.tick, I = T - 5, hitter = e.playerId!, target = e.otherId!;
        const st = engineAt(g, I), h = st.skaters.find((k) => k.id === hitter)!, t = st.skaters.find((k) => k.id === target)!;
        const ul = Math.hypot(t.pos.x - h.pos.x, t.pos.y - h.pos.y), ux = (t.pos.x - h.pos.x) / ul, uz = (t.pos.y - h.pos.y) / ul;
        const closing = (h.vel.x - t.vel.x) * ux + (h.vel.y - t.vel.y) * uz, ratio = mass(hitter) / mass(target);
        // Shoulders along the hit line relative to his engine place (world).
        const along = (id: string): number => {
          const s2 = g.pb.frame().prev.skaters.find((k) => k.id === id)!;
          const m = world(g, id, shouldersMid(g.sc.figure(id)!.pose!, g.dims.get(id)!));
          return (m.x - s2.pos.x) * ux + (m.z - s2.pos.y) * uz;
        };
        let t0 = 0, h0 = 0, peak = -Infinity, back = 0, fall = Infinity;
        play(g, I - 3, T + 20, (tk) => {
          if (tk === I - 3) { t0 = along(target); h0 = along(hitter); }
          if (tk >= T && tk <= T + 10) peak = Math.max(peak, along(target) - t0);
          if (tk >= T - 1 && tk <= T + 20) back = Math.max(back, h0 - along(hitter));
          if (fall === Infinity && tk >= T - 1 && g.sc.figure(target)!.hipY < 0.5) fall = tk - (T - 1);
        });
        if (Number.isFinite(fall)) rows.push({ rc: ratio * Math.max(0, closing), ratio, peak, fall, recoil: back });
      }
    }
    expect(rows.length).toBeGreaterThan(50);
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    const byRc = [...rows].sort((a, b) => a.rc - b.rc), third = Math.floor(rows.length / 3);
    const low = byRc.slice(0, third), high = byRc.slice(-third);
    // Thrown further, down faster: the highest third of mass ratio times closing speed against the lowest.
    expect(mean(high.map((r) => r.peak)) - mean(low.map((r) => r.peak))).toBeGreaterThan(0.08);
    expect(mean(low.map((r) => r.fall)) - mean(high.map((r) => r.fall))).toBeGreaterThan(3);
    // A lighter hitter bounces off and staggers; a heavier one drives on through.
    const light = rows.filter((r) => r.ratio < 0.95), heavy = rows.filter((r) => r.ratio > 1.05);
    expect(light.length).toBeGreaterThan(5); expect(heavy.length).toBeGreaterThan(5);
    expect(mean(light.map((r) => r.recoil)) - mean(heavy.map((r) => r.recoil))).toBeGreaterThan(0.06);
  });
});

describe('the body pass and a held puck', () => {
  it('a puck a goalie holds stays in his glove\'s pocket when the body pass moves him', () => {
    // A body pass that moves every goalie 0.2 m (more than the real pass ever moves one holding the puck).
    const seed = 42, rec = recorded(seed), setup = testSetup(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
    const sc = createGameScene(setup, { timeline: tl, animation: { bodyPass: (bodies) => { for (const b of bodies) if (b.kind === 'goalie') { b.offset.x += 0.2; b.offset.z -= 0.1; } } } });
    let held = 0;
    for (const e of rec.events) {
      if (held >= 4) break;
      if (e.type !== 'save' || e.detail.pose !== 'glove' || tl.last('freeze', e.tick, 0, e.playerId!)?.detail.cause !== 'save') continue;
      seekScene(pb, sc, e.tick + 30);
      const def = [...setup.home.players, ...setup.away.players].find((p) => p.id === e.playerId)!;
      const root = sc.root.getObjectByName(`goalie-${def.number}`)!;
      root.updateWorldMatrix(true, true);
      const pocket = root.getObjectByName('gPocket')!, at = new THREE.Vector3(), q = new THREE.Quaternion();
      pocket.getWorldPosition(at); pocket.getWorldQuaternion(q);
      at.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), 0.015 * (def.heightCm / 188));
      const p = sc.puckWorld(), mid = new THREE.Vector3(p.x, p.y + (0.0254 * PUCK_SCALE) / 2, p.z);
      // As overlays/goalie.test.ts measures it: the puck's middle within 6 cm of the middle of the pocket's face.
      expect(mid.distanceTo(at), `${e.tick}`).toBeLessThan(0.06);
      held++;
    }
    expect(held).toBeGreaterThan(2);
    sc.dispose();
  });
});
