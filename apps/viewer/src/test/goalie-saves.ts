import * as THREE from 'three';
import { DT, type GameEventOf, type GameSetup } from '@hockey/engine';
import { bodyDims } from '../body';
import { fitGoalie, goalieKeyRaw, type GoalieFigurePose } from '../goalie-pose';
import { createCursor, type Playback, type Recording } from '../playback';
import type { Vec3 } from '../pose-mix';
import { createGameScene, PUCK_SCALE, seekScene, type GameScene } from '../scene';
import { buildTimeline, type Timeline } from '../timeline';
import { recorded, testSetup } from './game';

/**
 * The saves of a recorded game played through the scene, and the measures of a goalie's drawn figure, shared by
 * overlays/goalie.test.ts and overlays/goalie.picture.test.ts. The puck's path on a shot is the engine's own: from where
 * the `release` event let it go (at display time R - 1, the last moment he had it) along the release velocity, falling
 * under gravity, which matches the engine's puck at every tick of the flight. Moments are display times (ticks, fractional).
 */

export type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene };
export const games = new Map<number, Game>();
export function game(seed: number): Game {
  let g = games.get(seed);
  if (!g) {
    const rec = recorded(seed), tl = buildTimeline(rec.events), setup = testSetup(seed);
    g = { rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl }) };
    games.set(seed, g);
  }
  return g;
}

export type W = { x: number; y: number; z: number }; // world: x and z on the ice (engine x, y), y the height
export const GRAVITY = 9.81;
/** The puck on a shot's path at display time t (from its release event). */
export function pathAt(rel: GameEventOf<'release'>, t: number): W {
  const tau = (t - (rel.tick - 1)) * DT, v = rel.detail.vel;
  return { x: rel.pos.x + v.x * tau, y: Math.max(0, v.z * tau - (GRAVITY / 2) * tau * tau), z: rel.pos.y + v.y * tau };
}
export const releaseOf = (tl: Timeline, tick: number | null, shooter: string): GameEventOf<'release'> | undefined => {
  if (tick === null) return undefined;
  const r = tl.last('release', tick, 0, shooter);
  return r && r.detail.kind === 'shot' ? r : undefined;
};

/** A point of his drawn figure (body frame) in the world: drawn at the engine facing plus the figure's own turn. */
export function world(v: { position: { x: number; z: number }; facing: number; goaliePose?: GoalieFigurePose | null }, p: Vec3): W {
  const f = v.facing + (v.goaliePose?.turn ?? 0), c = Math.cos(f), n = Math.sin(f);
  return { x: v.position.x + p.x * c - p.z * n, y: p.y, z: v.position.z + p.x * n + p.z * c };
}
export const d3 = (a: W, b: W): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Distance from p to the segment a-b. */
export function segDist(p: W, a: W, b: W): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return d3(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t });
}
/** The torso as a segment: the pelvis centre to the middle of the shoulders. */
export const torso = (g: GoalieFigurePose): [Vec3, Vec3] => [{ x: 0, y: g.hipY, z: 0 }, { x: (g.shoulders[0].x + g.shoulders[1].x) / 2, y: (g.shoulders[0].y + g.shoulders[1].y) / 2, z: (g.shoulders[0].z + g.shoulders[1].z) / 2 }];
export type View = { position: { x: number; z: number }; facing: number; goaliePose: GoalieFigurePose };
/** How far the puck at p is from the part a save names (glove or blocker hand, nearest pad, body for butterfly or cover). */
export function partDistance(v: View, part: string, p: W): number {
  const g = v.goaliePose, w = (q: Vec3) => world(v, q);
  const shin = (i: 0 | 1) => segDist(p, w(g.legs[i].knee), w(g.legs[i].ankle));
  if (part === 'glove') return d3(p, w(g.glove));
  if (part === 'blocker') return d3(p, w(g.blocker));
  if (part === 'pad') return Math.min(shin(0), shin(1));
  const [a, b] = torso(g);
  return Math.min(shin(0), shin(1), segDist(p, w(a), w(b)));
}
/** His nearest part to p: hands, pads, thighs, torso and the stick's paddle. */
export function nearestPart(v: View, p: W): number {
  const g = v.goaliePose, w = (q: Vec3) => world(v, q);
  const [a, b] = torso(g);
  const blade = { x: g.blade.heel.x + g.blade.dir.x * 0.7, y: g.blade.heel.y + g.blade.dir.y * 0.7, z: g.blade.heel.z + g.blade.dir.z * 0.7 };
  const parts = [
    d3(p, w(g.glove)), d3(p, w(g.blocker)), segDist(p, w(a), w(b)), segDist(p, w(g.blade.heel), w(blade)),
    ...([0, 1] as const).flatMap((i) => [segDist(p, w(g.legs[i].knee), w(g.legs[i].ankle)), segDist(p, w(g.legs[i].hip), w(g.legs[i].knee))]),
  ];
  return Math.min(...parts);
}
/** The glove and blocker of his stance key pose (fitted, for his hand). */
export function stanceHands(dims: ReturnType<typeof bodyDims>, catches: 'L' | 'R'): { glove: Vec3; blocker: Vec3 } {
  const s = fitGoalie(goalieKeyRaw('stance', dims, 1), dims, catches);
  return { glove: s.glove, blocker: s.blocker };
}
/** The drawn puck's half thickness (scene.ts: a real puck's 2.54 cm at PUCK_SCALE). */
export const PUCK_HALF = (0.0254 * PUCK_SCALE) / 2;
/** The middle of the open face of a goalie's glove pocket as drawn (world), and the way it faces. */
export function pocketFace(g: Game, id: string): { at: W; out: W } {
  const def = [...g.setup.home.players, ...g.setup.away.players].find((p) => p.id === id)!;
  const root = g.sc.root.getObjectByName(`goalie-${def.number}`)!;
  root.updateWorldMatrix(true, true);
  const pocket = root.getObjectByName('gPocket')!;
  const at = new THREE.Vector3(), q = new THREE.Quaternion();
  pocket.getWorldPosition(at); pocket.getWorldQuaternion(q);
  const out = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const k = def.heightCm / 188;
  at.addScaledVector(out, 0.015 * k);
  return { at: { x: at.x, y: at.y, z: at.z }, out: { x: out.x, y: out.y, z: out.z } };
}
export const goalieDims = (setup: GameSetup, id: string) => { const d = [...setup.home.players, ...setup.away.players].find((p) => p.id === id)!; return bodyDims(d.heightCm, d.weightKg); };

/** Play the scene from 1.5 s before `from` (after a seek with its pre-roll) to `to` at `hz`, calling `each` every frame. */
export function play(g: Game, from: number, to: number, hz: number, each: (t: number) => void): void {
  seekScene(g.pb, g.sc, from);
  const step = 1 / (hz * DT);
  for (let t = from + step; t <= to + 1e-9; t += step) { g.pb.seek(t); g.sc.update(g.pb.frame(), 1 / hz); each(t); }
}

export type Save = { seed: number; save: GameEventOf<'save'>; rel: GameEventOf<'release'>; freeze: boolean; arrival: number; dist: number; puckGap: number };
export const saveCache = new Map<number, Save[]>();
/**
 * The first 15 saves of a game that came from a shot (a `release`), each played through at 240 Hz from 1 s before
 * its release to its tick: the moment the saving part is nearest the puck on its path (the arrival), that distance,
 * and how far the drawn puck is from the saving part then.
 */
export function saves(seed: number): Save[] {
  const hit = saveCache.get(seed);
  if (hit) return hit;
  const g = game(seed), out: Save[] = [];
  for (const e of g.rec.events) {
    if (out.length >= 15) break;
    if (e.type !== 'save') continue;
    const shot = g.tl.last('shot', e.tick, 0, e.playerId!, 'other')!;
    const rel = releaseOf(g.tl, shot.detail.releaseTick, e.otherId!);
    if (!rel) continue;
    let best = Infinity, at = 0, gap = 0;
    play(g, rel.tick - 1 - 30, e.tick, 240, (t) => {
      const v = g.sc.figure(e.playerId!) as unknown as View, p = pathAt(rel, t);
      const dd = partDistance(v, e.detail.pose, p);
      if (dd < best) { best = dd; at = t; const q = g.sc.puckWorld(); gap = partDistance(v, e.detail.pose, { x: q.x, y: q.y, z: q.z }); }
    });
    const freeze = g.tl.last('freeze', e.tick, 0, e.playerId!)?.detail.cause === 'save';
    out.push({ seed, save: e, rel, freeze, arrival: at, dist: best, puckGap: gap });
  }
  saveCache.set(seed, out);
  return out;
}

