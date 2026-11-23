import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, type GameEventOf, type GameSetup } from '@hockey/engine';
import { bodyDims, type BodyDims } from '../body';
import { initialGait, poseOf } from '../gait';
import { createCursor, type Playback, type Recording } from '../playback';
import { armReach, shoulderJoint, type SkaterPose, type Vec3 } from '../pose-mix';
import { createGameScene, PUCK_SCALE, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { drivePeriod } from '../test/period';
import { buildTimeline, type Timeline } from '../timeline';
import { boardsGap, MAX_OFFSET, radiusOfWeight, weightOfDims } from './contact';

/**
 * Poke checks, hits, falls and the body pass, through the real scene and recorded games (seeds 5 and 42), and one
 * pass over the first period of seed 5 through the animator and the body pass for the whole-period bounds.
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
  const hitsOf = (g: Game, result: string): GameEventOf<'hit'>[] =>
    g.rec.events.filter((e): e is GameEventOf<'hit'> => e.type === 'hit' && e.detail.result === result);

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
      const pre = engineAt(g, I - 1), hP = pre.skaters.find((s) => s.id === hitter)!, tP = pre.skaters.find((s) => s.id === target)!;
      const ul = Math.hypot(tP.pos.x - hP.pos.x, tP.pos.y - hP.pos.y), ux = (tP.pos.x - hP.pos.x) / ul, uz = (tP.pos.y - hP.pos.y) / ul;
      // The upper body relative to his engine place, along the line from the hitter, before contact and as it lands.
      const along: number[] = [], hips: Record<number, number> = {};
      play(g, I - 1, up + 9, (t) => {
        if (t === I - 1 || t === e.tick + 1) {
          const st = g.pb.frame().prev, s = st.skaters.find((k) => k.id === target)!;
          const m = world(g, target, shouldersMid(g.sc.figure(target)!.pose!, d));
          along.push((m.x - s.pos.x) * ux + (m.z - s.pos.y) * uz);
        }
        if (t === mid || t === up + 9) hips[t] = g.sc.figure(target)!.hipY;
      });
      expect(along[1]! - along[0]!, `${e.tick} upper body away`).toBeGreaterThan(0.1);
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

/** The whole-period run, once for this file: seed 5, first period, 60 Hz. */
type PeriodStats = {
  frames: number; worstOverlap: number; worstOverlapAt: string; worstBoards: number; worstOffset: number;
  lateOffset: number; lateAt: string; worstPlain: number; worstPlainAt: string; worstBodyContact: number; worstBodyContactAt: string; worstBody: number; worstBodyAt: string; worstContact: number; contactFrames: number; plainFrames: number; bad: number;
};
let stats: PeriodStats;

describe('the whole period (seed 5, 60 Hz, the animator and the body pass)', () => {
  beforeAll(() => {
    const s: PeriodStats = { frames: 0, worstOverlap: 0, worstOverlapAt: '', worstBoards: 0, worstOffset: 0, lateOffset: 0, lateAt: '', worstPlain: 0, worstPlainAt: '', worstBodyContact: 0, worstBodyContactAt: '', worstBody: 0, worstBodyAt: '', worstContact: 0, contactFrames: 0, plainFrames: 0, bad: 0 };
    const radius = new Map<string, number>(), lastContact = new Map<string, number>(), lastDown = new Map<string, number>();
    const last = new Map<string, { h0: Vec3; h1: Vec3; b: Vec3; f0: Vec3; f1: Vec3; hip: number }>();
    let r: ReturnType<typeof drivePeriod> | null = null;
    const res = drivePeriod(5, (f) => {
      const { bodies, ctx } = f;
      if (radius.size === 0) {
        for (const b of bodies) {
          const dims = b.kind === 'skater' ? ctx.skaters.get(b.id)!.dims : ctx.goalies.get(b.id)!.dims;
          radius.set(b.id, radiusOfWeight(weightOfDims(dims)));
        }
      }
      // Overlaps of drawn bodies, the boards, and the size of each offset.
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        if (!a.onIce) continue;
        const ax = a.pos.x + a.offset.x, az = a.pos.y + a.offset.z, ra = radius.get(a.id)!;
        s.worstBoards = Math.max(s.worstBoards, ra - boardsGap(ax, az, { x: 0, z: 0 }));
        s.worstOffset = Math.max(s.worstOffset, Math.hypot(a.offset.x, a.offset.z));
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          if (!b.onIce) continue;
          const rb = radius.get(b.id)!;
          const o = ra + rb - Math.hypot(b.pos.x + b.offset.x - ax, b.pos.y + b.offset.z - az);
          if (o > s.worstOverlap) { s.worstOverlap = o; s.worstOverlapAt = `${f.tick} ${a.id} ${b.id}`; }
          // In contact: their engine places within the two radii.
          if (ra + rb - Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) > 0) { lastContact.set(a.id, f.i); lastContact.set(b.id, f.i); }
        }
      }
      // Contact from the engine: in a contest, or down.
      for (const sk of f.skaters) {
        const st = sk.sample.state;
        if (st.contestId !== null || st.downT > 0) lastContact.set(sk.id, f.i);
      }
      for (const b of bodies) {
        if (!b.onIce) continue;
        const since = f.i - (lastContact.get(b.id) ?? -1e9);
        const off = Math.hypot(b.offset.x, b.offset.z);
        if (since >= 60 && off > s.lateOffset) { s.lateOffset = off; s.lateAt = `${f.tick} ${b.id}`; }
      }
      // Continuity: hands and blade per frame; impact and fall frames apart (from engine facts).
      for (const sk of f.skaters) {
        const p = sk.pose;
        if (!p) { last.delete(sk.id); continue; }
        const pn = f.prev.skaters.find((x) => x.id === sk.id)!, nn = f.next.skaters.find((x) => x.id === sk.id) ?? pn;
        if (pn.downT > 0 || nn.downT > 0) lastDown.set(sk.id, f.i);
        const inImpact = f.prev.contests.concat(f.next.contests).some((c) => c.kind === 'hit' && c.stage === 'impact' && c.participants.includes(sk.id));
        const contact = inImpact || f.i - (lastDown.get(sk.id) ?? -1e9) <= 42; // down, or within 0.7 s of getting his skates back
        const now = { h0: { ...p.arms[0].hand }, h1: { ...p.arms[1].hand }, b: { ...p.blade }, f0: { ...p.legs[0].foot }, f1: { ...p.legs[1].foot }, hip: p.hipY };
        const nums = [p.hipY, p.pitch, p.roll, now.h0.x, now.h0.y, now.h0.z, now.h1.x, now.h1.y, now.h1.z, now.b.x, now.b.y, now.b.z, p.legs[0].foot.x, p.legs[1].foot.z];
        if (nums.some((v) => !Number.isFinite(v))) s.bad++;
        const was = last.get(sk.id);
        if (was && !f.cut) {
          const mv = Math.max(dist(was.h0, now.h0), dist(was.h1, now.h1), dist(was.b, now.b));
          const body = Math.max(Math.abs(was.hip - now.hip), dist(was.f0, now.f0), dist(was.f1, now.f1));
          if (contact && body > s.worstBodyContact) { s.worstBodyContact = body; s.worstBodyContactAt = `${f.tick}+${f.alpha} ${sk.id}`; }
          if (!contact && body > s.worstBody) { s.worstBody = body; s.worstBodyAt = `${f.tick}+${f.alpha} ${sk.id}`; }
          if (contact) { s.worstContact = Math.max(s.worstContact, mv); s.contactFrames++; } else { if (mv > s.worstPlain) { s.worstPlain = mv; s.worstPlainAt = `${f.tick}+${f.alpha.toFixed(2)} ${sk.id}`; } s.plainFrames++; }
        }
        last.set(sk.id, now);
      }
    });
    r = res;
    s.frames = r.frames;
    stats = s;
  }, 120_000);

  it('no two drawn figures overlap by more than 0.15 m at any frame of a period, and none is drawn outside the boards', () => {
    expect(stats.frames).toBeGreaterThan(80000);
    expect(stats.worstOverlap, stats.worstOverlapAt).toBeLessThan(0.15);
    expect(stats.worstBoards).toBeLessThan(1e-6);
  });
  it('the drawn offset never exceeds 0.35 m and returns to under 0.02 m within a second of contact ending', () => {
    expect(stats.worstOffset).toBeLessThan(MAX_OFFSET + 1e-9);
    expect(stats.lateOffset, stats.lateAt).toBeLessThan(0.02);
  });
  it('outside the impact and fall frames the real-game continuity bound still holds; within them no part moves more than 0.6 m in one 60 Hz frame', () => {
    expect(stats.bad).toBe(0);
    expect(stats.contactFrames).toBeGreaterThan(1000);
    expect(stats.worstPlain, stats.worstPlainAt).toBeLessThan(0.35);
    expect(stats.worstContact).toBeLessThan(0.6);
    // Beyond the brief: outside them, hips and skates stay under 0.1 m a frame (overlays/stick.test.ts's bound).
    expect(stats.worstBody, stats.worstBodyAt).toBeLessThan(0.1);
  });
});

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

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
