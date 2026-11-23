import { readFileSync } from 'node:fs';
import { inject } from 'vitest';
import type { CameraName, CameraPose } from '../cameras';
import type { CutKind } from '../cuts';
import { goalShow } from '../goal-show';
import { initialOperator, stepOperator, withCamera, type OperatorInput } from '../operator';
import { buildTimeline } from '../timeline';
import type { CameraPaths } from './camera-paths';
import { recorded, SHARED_SEED } from './game';

/**
 * The camera operator over the first period of the shared game (seed 5) at 60 Hz, fed as the watch page feeds it (the
 * engine's puck and its velocity, the scene's cut kinds, the goal show's hold, the board battle nearest the puck, the
 * followed player while he is on the ice), from the recorded puck and player paths (test/camera-paths.ts; no engine
 * pass, no scene). For each camera: how far and how often the frame moves.
 *
 * - look speed and acceleration: of the point the camera looks at (m/s, m/s^2), percentiles over the frames that are
 *   not a cut or the frame after one;
 * - pan reversals per minute: how often the look point's motion along x, or along z, turns round (counted only between
 *   moves faster than REVERSAL_SPEED, so standing still is not a turn);
 * - cuts: the frames the camera cut on (after the first);
 * - inFrame: the share of live frames with the puck inside the picture (16:9, the camera's field of view).
 */

export const REVERSAL_SPEED = 0.5;
export type CameraStats = { lookSpeed: { p50: number; p95: number; p99: number; max: number }; lookAccel: { p50: number; p95: number; p99: number }; reversalsPerMin: number; cuts: number; inFrame: number; minutes: number };

const pct = (v: number[], q: number): number => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0; };

/** Whether world point p is inside the picture (aspect 16:9) of `pose`. */
export function inPicture(pose: CameraPose, p: { x: number; y: number; z: number }, aspect = 16 / 9): boolean {
  const f = { x: pose.look.x - pose.pos.x, y: pose.look.y - pose.pos.y, z: pose.look.z - pose.pos.z }, fl = Math.hypot(f.x, f.y, f.z);
  const fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  // Right = forward x world up (three.js lookAt with up +y); straight down, the scene's own up hint decides, so any
  // horizontal pair will do for the bounds: take right along x.
  let rt = { x: -fw.z, y: 0, z: fw.x };
  const rl = Math.hypot(rt.x, rt.z);
  rt = rl > 1e-6 ? { x: rt.x / rl, y: 0, z: rt.z / rl } : { x: 1, y: 0, z: 0 };
  const up = { x: rt.y * fw.z - rt.z * fw.y, y: rt.z * fw.x - rt.x * fw.z, z: rt.x * fw.y - rt.y * fw.x };
  const d = { x: p.x - pose.pos.x, y: p.y - pose.pos.y, z: p.z - pose.pos.z };
  const along = d.x * fw.x + d.y * fw.y + d.z * fw.z;
  if (along <= 0) return false;
  const ty = Math.tan((pose.fov * Math.PI) / 360), tx = ty * aspect;
  const sx = (d.x * rt.x + d.y * rt.y + d.z * rt.z) / along, sy = (d.x * up.x + d.y * up.y + d.z * up.z) / along;
  return Math.abs(sx) < tx && Math.abs(sy) < ty;
}

function battleSpot(spots: readonly number[], x: number, z: number): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null, bd = Infinity;
  for (let i = 0; i < spots.length; i += 2) {
    const d = Math.hypot(spots[i]! - x, spots[i + 1]! - z);
    if (d < bd) { bd = d; best = { x: spots[i]!, y: 0, z: spots[i + 1]! }; }
  }
  return best;
}

let paths: CameraPaths | null = null;
/** The first period of the shared game's camera paths (recorded by the global setup: test/camera-paths.ts). */
export function cameraPaths(): CameraPaths {
  paths ??= JSON.parse(readFileSync(inject('cameraPathsFile'), 'utf8')) as CameraPaths;
  return paths;
}

/** The cameras `cams` over the first period of the shared game (seed SHARED_SEED) at 60 Hz, from its recorded paths. */
export function runCameras(cams: readonly CameraName[], opts: { zoom?: number } = {}): Record<string, CameraStats> {
  const tl = buildTimeline(recorded(SHARED_SEED).events), P = cameraPaths(), T = P.ticks;
  const ops = cams.map((c) => withCamera(initialOperator(c), c));
  type Acc = { speeds: number[]; accels: number[]; last: CameraPose | null; lastV: { x: number; z: number } | null; dirX: number; dirZ: number; reversals: number; cuts: number; live: number; seen: number; sinceCut: number };
  const acc: Acc[] = cams.map(() => ({ speeds: [], accels: [], last: null, lastV: null, dirX: 0, dirZ: 0, reversals: 0, cuts: 0, live: 0, seen: 0, sinceCut: 9 }));
  const dt = 1 / 60;
  let frames = 0;
  for (let i = 0; i * 0.5 < T.length - 1; i++) {
    const t = i * 0.5, tick = Math.floor(t);
    const prev = T[tick]!, n = T[tick + 1]!, next = prev.cutNext ? prev : n, a = next === prev ? 0 : t - tick;
    // The scene's cut, on the frame that first draws a tick.
    const cut: CutKind | null = i > 0 && t === tick ? prev.cut : null;
    const l = (u: number, v: number): number => u + (v - u) * a;
    const puck = { x: l(prev.px, next.px), y: Math.max(0, l(prev.pz, next.pz)), z: l(prev.py, next.py) };
    const puckVel = { x: l(prev.vx, next.vx), y: 0, z: l(prev.vy, next.vy) };
    const show = goalShow(tl, t);
    const input: OperatorInput = {
      puck, puckVel, attackingRight: prev.homeRight, cut, snap: i === 0, zoom: opts.zoom ?? 1,
      battle: battleSpot(next.battles, puck.x, puck.z),
      // (The scorer is not in the paths: the hold watches the net.)
      goal: show.hold ? { net: show.hold.net, k: show.hold.k, scorer: null } : null,
    };
    if (prev.fon) {
      input.followed = {
        pos: { x: l(prev.fx, next.fx), y: 0, z: l(prev.fy, next.fy) },
        facing: prev.ff + Math.atan2(Math.sin(next.ff - prev.ff), Math.cos(next.ff - prev.ff)) * a,
        vel: { x: l(prev.fvx, next.fvx), y: 0, z: l(prev.fvy, next.fvy) },
      };
    }
    const live = prev.live && next.live;
    frames++;
    cams.forEach((_, k) => {
      const r = stepOperator(ops[k]!, input, i === 0 ? 0 : dt);
      ops[k] = r.state;
      const s = acc[k]!, pose = r.pose;
      if (r.cut && i > 0) { s.cuts++; s.sinceCut = 0; } else s.sinceCut++;
      if (live) { s.live++; if (inPicture(pose, puck)) s.seen++; }
      if (s.last && s.sinceCut >= 2) {
        const v = { x: (pose.look.x - s.last.look.x) / dt, z: (pose.look.z - s.last.look.z) / dt };
        s.speeds.push(Math.hypot(v.x, v.z));
        if (s.lastV && s.sinceCut >= 3) s.accels.push(Math.hypot(v.x - s.lastV.x, v.z - s.lastV.z) / dt);
        for (const ax of ['x', 'z'] as const) {
          const sp = v[ax], key = ax === 'x' ? 'dirX' : 'dirZ';
          if (Math.abs(sp) > REVERSAL_SPEED) {
            const d = Math.sign(sp);
            if (s[key] !== 0 && d !== s[key]) s.reversals++;
            s[key] = d;
          }
        }
        s.lastV = v;
      } else s.lastV = null;
      s.last = pose;
    });
  }
  const minutes = (frames * dt) / 60;
  const out: Record<string, CameraStats> = {};
  cams.forEach((c, k) => {
    const s = acc[k]!;
    out[c] = {
      lookSpeed: { p50: pct(s.speeds, 0.5), p95: pct(s.speeds, 0.95), p99: pct(s.speeds, 0.99), max: Math.max(...s.speeds) },
      lookAccel: { p50: pct(s.accels, 0.5), p95: pct(s.accels, 0.95), p99: pct(s.accels, 0.99) },
      reversalsPerMin: s.reversals / minutes, cuts: s.cuts, inFrame: s.seen / Math.max(1, s.live), minutes,
    };
  });
  return out;
}

