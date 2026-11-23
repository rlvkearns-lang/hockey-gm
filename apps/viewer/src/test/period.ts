import { DT, RINK, type GameSetup, type GameState, type SkaterState } from '@hockey/engine';
import {
  BODY_PASS, initialSkaterAnim, OVERLAYS, poseSkater, refreshSkater, stepSkater, turnRateOf,
  type AnimContext, type BodyPass, type DrawnBody, type GoalieSample, type Overlay, type SkaterAnim, type SkaterSample,
} from '../animator';
import { bodyDims } from '../body';
import { isCut, probeOf } from '../cuts';
import { createCursor, lerpAngle, type Recording } from '../playback';
import type { SkaterPose } from '../pose-mix';
import { buildTimeline, type Timeline } from '../timeline';
import { recorded, testSetup } from './game';

/**
 * One pass over the first period of a recorded game at 60 Hz through the animator and the body pass, without the
 * scene (no three.js), sampling every figure as the scene does: blended between the frame's two ticks, the earlier
 * tick across an engine cut, everyone afresh after a cut. Each frame, after the body pass, `onFrame` sees every
 * skater's sample, pose and drawn body, and both goalies' drawn bodies. The objects are reused between frames: copy
 * what you keep.
 */

export type PeriodSkater = { id: string; sample: SkaterSample; anim: SkaterAnim; pose: SkaterPose | null; body: DrawnBody };
export type PeriodFrame = {
  /** Frame index (1 is the first), display time (tick, alpha), the frame's two engine states and whether it is a cut. */
  i: number; tick: number; alpha: number; prev: GameState; next: GameState; cut: boolean;
  skaters: readonly PeriodSkater[];
  goalies: readonly DrawnBody[];
  /** Every drawn body (skaters, then goalies), as the body pass saw them. */
  bodies: readonly DrawnBody[];
  ctx: AnimContext;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const newBody = (id: string, kind: 'skater' | 'goalie', side: 'home' | 'away'): DrawnBody =>
  ({ id, kind, side, onIce: false, pos: { x: 0, y: 0 }, facing: 0, offset: { x: 0, z: 0 }, eased: { x: 0, z: 0 } });

export function drivePeriod(
  seed: number, onFrame: (f: PeriodFrame) => void,
  opts: { overlays?: readonly Overlay[]; bodyPass?: BodyPass; hz?: number } = {},
): { rec: Recording; setup: GameSetup; tl: Timeline; frames: number } {
  const rec = recorded(seed), setup = testSetup(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
  const overlays = opts.overlays ?? OVERLAYS, pass = opts.bodyPass ?? BODY_PASS, hz = opts.hz ?? 60;
  const end = rec.events.find((e) => e.type === 'periodEnd')!.tick;
  const defs = new Map([...setup.home.players, ...setup.away.players].map((d) => [d.id, d]));
  const cuts = new Set(rec.cuts);
  pb.seek(0);
  const first = pb.frame().prev;
  const skaterSamples = new Map<string, SkaterSample>(), goalieSamples = new Map<string, GoalieSample>();
  const ctx: AnimContext = {
    tick: 0, alpha: 0, time: 0, state: first, skaters: skaterSamples, goalies: goalieSamples,
    puck: { engine: { x: 0, y: 0, z: 0 }, drawn: { x: 0, y: 0, z: 0 }, carrierId: null }, contests: [], timeline: tl, rink: RINK, defends: { home: -1, away: 1 },
  };
  const skaters: PeriodSkater[] = first.skaters.map((s) => {
    const d = defs.get(s.id)!;
    const sample: SkaterSample = {
      id: s.id, side: s.side, right: d.shoots === 'R', dims: bodyDims(d.heightCm, d.weightKg), onIce: false, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
      facing: 0, accelAlong: 0, turnRate: 0, down: false, carrying: false, state: s,
    };
    skaterSamples.set(s.id, sample);
    return { id: s.id, sample, anim: initialSkaterAnim(), pose: null, body: newBody(s.id, 'skater', s.side) };
  });
  const goalies: DrawnBody[] = [];
  for (const side of ['home', 'away'] as const) {
    const g = first.goalies[side], d = defs.get(g.id)!;
    goalieSamples.set(g.id, { id: g.id, side, dims: bodyDims(d.heightCm, d.weightKg), pos: { x: 0, y: 0 }, facing: 0, state: g });
    goalies.push(newBody(g.id, 'goalie', side));
  }
  const bodies = [...skaters.map((s) => s.body), ...goalies];
  const frame: PeriodFrame = { i: 0, tick: 0, alpha: 0, prev: first, next: first, cut: false, skaters, goalies, bodies, ctx };
  const step = 30 / hz, dt = 1 / hz;
  let frames = 0;
  for (let i = 1; i * step <= end; i++) {
    pb.seek(i * step);
    const f = pb.frame(), prev = f.prev, a = f.alpha;
    const next = isCut(probeOf(prev), f.next) ? prev : f.next;
    const cut = cuts.has(prev.tick) && a === 0;
    ctx.tick = f.tick; ctx.alpha = a; ctx.time = (f.tick + a) * DT; ctx.state = next; ctx.contests = next.contests;
    ctx.defends.home = next.attackDir.home === 1 ? -1 : 1; ctx.defends.away = next.attackDir.away === 1 ? -1 : 1;
    ctx.puck.engine.x = lerp(prev.puck.pos.x, next.puck.pos.x, a); ctx.puck.engine.z = lerp(prev.puck.pos.y, next.puck.pos.y, a);
    ctx.puck.engine.y = Math.max(0, lerp(prev.puck.z, next.puck.z, a));
    ctx.puck.drawn.x = ctx.puck.engine.x; ctx.puck.drawn.y = ctx.puck.engine.y; ctx.puck.drawn.z = ctx.puck.engine.z;
    ctx.puck.carrierId = next.carrierId;
    for (let k = 0; k < skaters.length; k++) {
      const sk = skaters[k]!, s = sk.sample;
      const p = prev.skaters[k]!.id === sk.id ? prev.skaters[k]! : prev.skaters.find((x) => x.id === sk.id)!;
      const n0 = next.skaters[k]!.id === sk.id ? next.skaters[k]! : next.skaters.find((x) => x.id === sk.id);
      const n: SkaterState = n0 && n0.onIce ? n0 : p;
      s.onIce = p.onIce;
      s.pos.x = lerp(p.pos.x, n.pos.x, a); s.pos.y = lerp(p.pos.y, n.pos.y, a);
      s.vel.x = lerp(p.vel.x, n.vel.x, a); s.vel.y = lerp(p.vel.y, n.vel.y, a);
      s.facing = lerpAngle(p.facing, n.facing, a);
      s.accelAlong = p === n ? 0 : (Math.hypot(n.vel.x, n.vel.y) - Math.hypot(p.vel.x, p.vel.y)) / DT;
      s.turnRate = p === n ? 0 : turnRateOf(p.facing, n.facing);
      s.down = n.downT > 0; s.carrying = (n === p ? prev.carrierId : next.carrierId) === sk.id; s.state = n;
    }
    for (const side of ['home', 'away'] as const) {
      const p = prev.goalies[side], n = next.goalies[side], g = goalieSamples.get(p.id)!;
      g.pos.x = lerp(p.pos.x, n.pos.x, a); g.pos.y = lerp(p.pos.y, n.pos.y, a); g.facing = lerpAngle(p.facing, n.facing, a); g.state = n;
    }
    for (const sk of skaters) {
      if (cut) sk.anim = refreshSkater(sk.anim);
      sk.anim = stepSkater(sk.anim, sk.sample, ctx, dt, overlays);
    }
    for (const sk of skaters) {
      const s = sk.sample, b = sk.body;
      if (!s.onIce) { sk.pose = null; b.onIce = false; b.offset.x = 0; b.offset.z = 0; continue; }
      const r = poseSkater(sk.anim, s, ctx, s.dims, overlays);
      sk.pose = r.pose;
      b.onIce = true; b.pos.x = s.pos.x; b.pos.y = s.pos.y; b.facing = s.facing; b.offset.x = r.offset.x; b.offset.z = r.offset.z;
    }
    for (const b of goalies) {
      const g = goalieSamples.get(b.id)!;
      b.onIce = true; b.pos.x = g.pos.x; b.pos.y = g.pos.y; b.facing = g.facing; b.offset.x = 0; b.offset.z = 0;
    }
    pass(bodies, ctx, dt);
    frame.i = i; frame.tick = f.tick; frame.alpha = a; frame.prev = prev; frame.next = next; frame.cut = cut;
    onFrame(frame);
    frames++;
  }
  return { rec, setup, tl, frames };
}
