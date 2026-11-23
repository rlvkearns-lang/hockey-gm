import { describe, expect, it } from 'vitest';
import type { GameEventOf, GameSetup } from '@hockey/engine';
import { DT, RINK } from '@hockey/engine';
import { initialSkaterAnim, OVERLAYS, poseSkater, refreshSkater, stepSkater, turnRateOf, type AnimContext, type Overlay, type SkaterAnim, type SkaterSample } from '../animator';
import { bodyDims } from '../body';
import { isCut, probeOf } from '../cuts';
import { createCursor, lerpAngle, type Playback, type Recording } from '../playback';
import type { SkaterPose, Vec3 } from '../pose-mix';
import { createGameScene, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';
import { faceoffCrouch } from './faceoff';
import { STICK_OVERLAYS, stickSlotOf, stickWeight, type StickStyle } from './stick';

/**
 * The stick actions through the real scene and a recorded game: each helper plays the scene (with the game's event
 * timeline, as the watch page does) at 60 Hz up to a display tick and reads the drawn figure.
 */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene; weights: Map<string, number>; watch: { id: string } };
const games = new Map<Recording, Game>();
/** A recorded game (seed 5 or 42) with its timeline, a cursor and a scene over it, made once per file. */
function game(seed: number): Game {
  const rec = recorded(seed);
  let g = games.get(rec);
  if (!g) {
    const tl = buildTimeline(rec.events), setup = testSetup(seed);
    // The registered overlays, each wrapped to note its weight for the watched skater.
    const weights = new Map<string, number>(), watch = { id: '' };
    const skaters = OVERLAYS.map((ov): Overlay => ({
      ...ov,
      weight: (a, s, c) => { const w = ov.weight(a, s, c); if (s.id === watch.id) weights.set(ov.id, w); return w; },
    }));
    g = { rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl, animation: { skaters } }), weights, watch };
    games.set(rec, g);
  }
  return g;
}
const of = (rec: Recording): Game => games.get(rec)!;

/** His drawn pose with where and how he is drawn (position, facing, shot). */
type Drawn = SkaterPose & { x: number; z: number; facing: number; right: boolean };
function drawnOf(g: Game, id: string): Drawn {
  const f = g.sc.figure(id)!;
  const p = f.pose!;
  const right = [...g.setup.home.players, ...g.setup.away.players].find((d) => d.id === id)!.shoots === 'R';
  return {
    ...p, legs: [{ ...p.legs[0], foot: { ...p.legs[0].foot } }, { ...p.legs[1], foot: { ...p.legs[1].foot } }],
    arms: [{ hand: { ...p.arms[0].hand } }, { hand: { ...p.arms[1].hand } }], blade: { ...p.blade },
    x: f.position.x, z: f.position.z, facing: f.facing, right,
  };
}
/** Play from 1.5 s before `tick` (after a seek with its pre-roll) at 60 Hz to display time `tick`. */
function playTo(g: Game, tick: number, watch = ''): void {
  g.watch.id = watch; g.weights.clear();
  const start = tick - 45;
  seekScene(g.pb, g.sc, start);
  for (let i = 1; i <= 90; i++) { g.pb.seek(start + i * 0.5); g.sc.update(g.pb.frame(), 1 / 60); }
}
function poseAtTick(rec: Recording, _tl: Timeline, id: string, tick: number): Drawn {
  const g = of(rec); playTo(g, tick); return drawnOf(g, id);
}
function poseBySeek(rec: Recording, _tl: Timeline, id: string, tick: number): Drawn {
  const g = of(rec); seekScene(g.pb, g.sc, tick); return drawnOf(g, id);
}
/** The total weight of the stick overlays on him at display time `tick` (after play reaches it). */
function overlayWeight(rec: Recording, _tl: Timeline, id: string, tick: number): number {
  const g = of(rec); playTo(g, tick, id);
  let w = 0;
  for (const ov of STICK_OVERLAYS) w += g.weights.get(ov.id) ?? 0;
  return w;
}
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The largest move of a hand or the blade heel between two poses (body frame, m). */
const poseDistance = (a: SkaterPose, b: SkaterPose): number => Math.max(dist3(a.arms[0].hand, b.arms[0].hand), dist3(a.arms[1].hand, b.arms[1].hand), dist3(a.blade, b.blade));
/**
 * The blade heel behind him, or well ahead of him: along the way his shoulders face (body frame turned by the pose's
 * twist; an action turns his upper body toward where the puck goes, while his skates keep the engine's facing).
 */
const alongShoulders = (p: SkaterPose): number => p.blade.x * Math.cos(p.twist ?? 0) + p.blade.z * Math.sin(p.twist ?? 0);
const acrossShoulders = (p: SkaterPose): number => -p.blade.x * Math.sin(p.twist ?? 0) + p.blade.z * Math.cos(p.twist ?? 0);
const bladeBehindBody = (p: SkaterPose): boolean => alongShoulders(p) < -0.05;
const bladeAhead = (p: SkaterPose): boolean => alongShoulders(p) > 0.3;
/** A body-frame point of his pose (mirrored for a right shot) as a world offset from where he is drawn (x, z). */
function toWorld(d: Drawn, p: { x: number; z: number }): { x: number; z: number } {
  const bz = d.right ? -p.z : p.z, c = Math.cos(d.facing), n = Math.sin(d.facing);
  return { x: p.x * c - bz * n, z: p.x * n + bz * c };
}
/** The direction from his centre to his blade heel in the world (unit, x and z) at display time `tick`. */
function bladeDirWorld(rec: Recording, tl: Timeline, id: string, tick: number): { x: number; z: number } {
  const d = poseAtTick(rec, tl, id, tick), w = toWorld(d, d.blade), l = Math.hypot(w.x, w.z);
  return { x: w.x / l, z: w.z / l };
}
/** The direction from one skater to another (unit, world x and z) in the engine at `tick`. */
function directionTo(rec: Recording, fromId: string, toId: string, tick: number): { x: number; z: number } {
  const g = of(rec); g.pb.seek(tick);
  const st = g.pb.frame().prev, a = st.skaters.find((s) => s.id === fromId)!, b = st.skaters.find((s) => s.id === toId)!;
  const dx = b.pos.x - a.pos.x, dz = b.pos.y - a.pos.y, l = Math.hypot(dx, dz);
  return { x: dx / l, z: dz / l };
}
/** Every number of a pose is finite. */
function finitePose(p: SkaterPose): boolean {
  const v = [p.blade, p.arms[0].hand, p.arms[1].hand, p.legs[0].foot, p.legs[1].foot];
  for (const q of v) if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z)) return false;
  return Number.isFinite(p.hipY) && Number.isFinite(p.pitch) && Number.isFinite(p.roll) && Number.isFinite(p.yaw) && Number.isFinite(p.stickAngle) && Number.isFinite(p.twist ?? 0);
}
const releases = (rec: Recording): GameEventOf<'release'>[] => rec.events.filter((e): e is GameEventOf<'release'> => e.type === 'release');

describe('stick actions', () => {
  it('a shooter winds up before the release and follows through after it', () => {
    const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'shot')!;
    const before = poseAtTick(rec, tl, rel.playerId!, rel.tick - 6), at = poseAtTick(rec, tl, rel.playerId!, rel.tick), after = poseAtTick(rec, tl, rel.playerId!, rel.tick + 5), idle = poseAtTick(rec, tl, rel.playerId!, rel.tick - 40);
    expect(bladeBehindBody(before)).toBe(true); expect(bladeAhead(after)).toBe(true);
    expect(poseDistance(before, idle)).toBeGreaterThan(0.25); expect(Number.isFinite(at.hipY)).toBe(true);
  });
  it('the follow-through of a pass points toward the receiver', () => {
    const { rec, tl } = game(42); const rel = rec.events.find((e): e is GameEventOf<'release'> => e.type === 'release' && e.detail.kind === 'pass' && e.detail.toId !== null)!;
    const dir = bladeDirWorld(rec, tl, rel.playerId!, rel.tick + 3), to = directionTo(rec, rel.playerId!, rel.detail.toId!, rel.tick);
    expect(dir.x * to.x + dir.z * to.z).toBeGreaterThan(0.5);
  });
  it('no stick overlay is left on: a second after his last release a skater is back to his plain gait pose', () => {
    // "His last release": one after which, by a second later, he has not let the puck go again, is not about to, and
    // has no pass on its way to him (those show their own actions).
    const { rec, tl } = game(5); let checked = 0;
    for (const rel of rec.events.filter(e => e.type === 'release').slice(0, 40)) {
      if (tl.next('release', rel.tick, 45 + 18, rel.playerId!) || tl.next('pass', rel.tick, 45, rel.playerId!, 'other')) continue;
      expect(overlayWeight(rec, tl, rel.playerId!, rel.tick + 45)).toBeLessThan(0.02); checked++;
    }
    expect(checked).toBeGreaterThan(25);
  });
  it('through a whole period the per-frame move of hands and blade stays under 0.35 m at 60 Hz and nothing is NaN', () => {
    const r = drivePeriod(5);
    expect(r.posed).toBeGreaterThan(300000);
    expect(r.active).toBeGreaterThan(20000); // frames of a skater with a stick action showing
    expect(r.bad).toBe(0);
    expect(r.worst).toBeLessThan(0.35);
    // Beyond the brief: the actions leave the hips and the skates to the gait (the scene's real-game bound is 10 cm).
    expect(r.worstBody).toBeLessThan(0.1);
  });
  it('seeking into the middle of a wind-up shows the wind-up', () => {
    const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'shot')!;
    expect(poseDistance(poseBySeek(rec, tl, rel.playerId!, rel.tick - 4), poseAtTick(rec, tl, rel.playerId!, rel.tick - 4))).toBeLessThan(0.15);
  });

  // Beyond the brief's list.
  it('both hands: the wind-up goes back on his stick side and the follow-through goes where the puck went, for left and right shots', () => {
    const g = game(42);
    const shoots = new Map([...g.setup.home.players, ...g.setup.away.players].map((d) => [d.id, d.shoots]));
    for (const hand of ['L', 'R'] as const) {
      // The engine lets shots go in any direction from his facing; one more than 120 degrees off it (behind him) is
      // drawn turned as far as his upper body goes, so it cannot point where the puck went.
      const offFacing = (e: GameEventOf<'release'>): number => {
        g.pb.seek(e.tick - 1); const k = g.pb.frame().prev.skaters.find((x) => x.id === e.playerId)!;
        return Math.abs(Math.atan2(Math.sin(Math.atan2(e.detail.vel.y, e.detail.vel.x) - k.facing), Math.cos(Math.atan2(e.detail.vel.y, e.detail.vel.x) - k.facing)));
      };
      const shots = releases(g.rec).filter((e) => e.detail.kind === 'shot' && shoots.get(e.playerId!) === hand && offFacing(e) < 2.1).slice(0, 4);
      expect(shots.length).toBeGreaterThan(2);
      for (const rel of shots) {
        const back = poseAtTick(g.rec, g.tl, rel.playerId!, rel.tick - 6), follow = poseAtTick(g.rec, g.tl, rel.playerId!, rel.tick + 4);
        // To his left (a left shot) or his right (a right shot) of the way his shoulders face (in the world: his facing
        // plus the pose's twist, mirrored for a right shot), and behind them.
        const w = toWorld(back, back.blade), sh = back.facing + (back.right ? -1 : 1) * (back.twist ?? 0);
        const lateral = -Math.sin(sh) * w.x + Math.cos(sh) * w.z;
        expect(lateral * (hand === 'L' ? -1 : 1), `${hand} ${rel.tick} stick side`).toBeGreaterThan(0.2);
        expect(bladeBehindBody(back), `${hand} ${rel.tick} behind ${alongShoulders(back)}`).toBe(true);
        const f = toWorld(follow, follow.blade), l = Math.hypot(f.x, f.z), v = rel.detail.vel, lv = Math.hypot(v.x, v.y);
        expect((f.x * v.x + f.z * v.y) / (l * lv), `${hand} ${rel.tick} follow-through`).toBeGreaterThan(0.5);
      }
    }
  });
  it('the shot types come from the record: a one-timer is a quick release, a slapshot a hard one', () => {
    const g = game(42);
    const seen: Record<StickStyle, number> = { wrist: 0, slap: 0, oneTimer: 0, forehand: 0, backhand: 0, flip: 0, around: 0 };
    const p75 = (() => { const v = releases(g.rec).filter((e) => e.detail.kind === 'shot').map((e) => Math.hypot(e.detail.vel.x, e.detail.vel.y)).sort((a, b) => a - b); return v[Math.floor(v.length * 0.75)]!; })();
    const styles = stylesOf(g, releases(g.rec).filter((e) => e.detail.kind === 'shot').slice(0, 30));
    for (const [rel, style] of styles) {
      seen[style]++;
      if (style === 'slap') expect(Math.hypot(rel.detail.vel.x, rel.detail.vel.y)).toBeGreaterThanOrEqual(p75);
      if (style === 'oneTimer') {
        // He did not have the puck 0.27 s before the release.
        g.pb.seek(rel.tick - 8); expect(g.pb.frame().prev.carrierId).not.toBe(rel.playerId);
      }
    }
    expect(seen.wrist).toBeGreaterThan(seen.slap);
  });
});

/**
 * Drive the animator (no scene) through the first period of a recorded game at 60 Hz, sampling every skater on the
 * ice as the scene does (blended between the frame's ticks, the earlier tick across an engine cut, everyone afresh
 * after a cut), and measure the largest move in a frame of a hand or the blade heel while a stick action shows on
 * him (in this frame or the last), and of the hips or a skate; and count poses with a number that is not finite.
 */
function drivePeriod(seed: number): { worst: number; worstBody: number; posed: number; active: number; bad: number } {
  const g = game(seed), pb = g.pb;
  const end = g.rec.events.find((e) => e.type === 'periodEnd')!.tick;
  const defs = new Map([...g.setup.home.players, ...g.setup.away.players].map((d) => [d.id, d]));
  const samples = new Map<string, SkaterSample>(), anims = new Map<string, SkaterAnim>(), last = new Map<string, { pose: SkaterPose; on: boolean }>();
  const cuts = new Set(pb.cuts);
  pb.seek(0);
  const ctx: AnimContext = {
    tick: 0, alpha: 0, time: 0, state: pb.frame().next, skaters: samples, goalies: new Map(),
    puck: { engine: { x: 0, y: 0, z: 0 }, drawn: { x: 0, y: 0, z: 0 }, carrierId: null }, contests: [], timeline: g.tl, rink: RINK, defends: { home: -1, away: 1 },
  };
  let worst = 0, worstBody = 0, posed = 0, active = 0, bad = 0;
  for (let i = 1; i <= end * 2; i++) {
    pb.seek(i * 0.5);
    const f = pb.frame(), prev = f.prev, a = f.alpha;
    const next = isCut(probeOf(prev), f.next) ? prev : f.next;
    const cut = cuts.has(prev.tick) && a === 0;
    ctx.tick = f.tick; ctx.alpha = a; ctx.time = (f.tick + a) * DT; ctx.state = next; ctx.contests = next.contests;
    ctx.defends.home = next.attackDir.home === 1 ? -1 : 1; ctx.defends.away = next.attackDir.away === 1 ? -1 : 1;
    ctx.puck.engine.x = lerp(prev.puck.pos.x, next.puck.pos.x, a); ctx.puck.engine.z = lerp(prev.puck.pos.y, next.puck.pos.y, a);
    ctx.puck.engine.y = Math.max(0, lerp(prev.puck.z, next.puck.z, a));
    ctx.puck.drawn.x = ctx.puck.engine.x; ctx.puck.drawn.y = ctx.puck.engine.y; ctx.puck.drawn.z = ctx.puck.engine.z;
    ctx.puck.carrierId = next.carrierId;
    for (const p of prev.skaters) {
      const n0 = next.skaters.find((x) => x.id === p.id), n = n0 && n0.onIce ? n0 : p, d = defs.get(p.id)!;
      samples.set(p.id, {
        id: p.id, side: p.side, right: d.shoots === 'R', dims: bodyDims(d.heightCm, d.weightKg), onIce: p.onIce,
        pos: { x: lerp(p.pos.x, n.pos.x, a), y: lerp(p.pos.y, n.pos.y, a) }, vel: { x: lerp(p.vel.x, n.vel.x, a), y: lerp(p.vel.y, n.vel.y, a) },
        facing: lerpAngle(p.facing, n.facing, a), accelAlong: p === n ? 0 : (Math.hypot(n.vel.x, n.vel.y) - Math.hypot(p.vel.x, p.vel.y)) / DT,
        turnRate: p === n ? 0 : turnRateOf(p.facing, n.facing), down: n.downT > 0, carrying: (n === p ? prev.carrierId : next.carrierId) === p.id, state: n,
      });
    }
    for (const p of prev.skaters) {
      const s = samples.get(p.id)!;
      let anim = anims.get(p.id) ?? initialSkaterAnim();
      if (cut) anim = refreshSkater(anim);
      anim = stepSkater(anim, s, ctx, 1 / 60);
      anims.set(p.id, anim);
      if (!s.onIce) { last.delete(p.id); continue; }
      const pose = poseSkater(anim, s, ctx, s.dims).pose, on = stickWeight(anim, s, ctx) > 0;
      posed++;
      if (!finitePose(pose)) bad++;
      const was = last.get(p.id);
      if (was && !cut && !s.down) {
        if (on || was.on) { worst = Math.max(worst, poseDistance(was.pose, pose)); active++; }
        worstBody = Math.max(worstBody, Math.abs(was.pose.hipY - pose.hipY), dist3(was.pose.legs[0].foot, pose.legs[0].foot), dist3(was.pose.legs[1].foot, pose.legs[1].foot));
      }
      last.set(p.id, { pose, on });
    }
  }
  return { worst, worstBody, posed, active, bad };
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The type each shooter's slot gave his release, as play reaches its contact (read through a tracker that keeps it). */
function stylesOf(g: Game, rels: GameEventOf<'release'>[]): Map<GameEventOf<'release'>, StickStyle> {
  const out = new Map<GameEventOf<'release'>, StickStyle>();
  let want: GameEventOf<'release'> | null = null;
  const track = STICK_OVERLAYS[0]!;
  const spy: Overlay = {
    ...track,
    weight: (a, s, c) => {
      if (want && s.id === want.playerId) { const act = stickSlotOf(a)?.acts.find((x) => x.tick === want!.tick); if (act) out.set(want, act.style); }
      return track.weight(a, s, c);
    },
  };
  const sc = createGameScene(g.setup, { timeline: g.tl, animation: { skaters: [faceoffCrouch as Overlay, spy, ...STICK_OVERLAYS.slice(1)] } });
  for (const rel of rels) {
    want = rel;
    const start = rel.tick - 45;
    seekScene(g.pb, sc, start);
    for (let i = 1; i <= 88; i++) { g.pb.seek(start + i * 0.5); sc.update(g.pb.frame(), 1 / 60); }
  }
  sc.dispose();
  return out;
}
