import { describe, expect, it } from 'vitest';
import type { GameEventOf, GameSetup } from '@hockey/engine';
import { RINK } from '@hockey/engine';
import { OVERLAYS, type Overlay } from '../animator';
import { createCursor, type Playback, type Recording } from '../playback';
import type { SkaterPose, Vec3 } from '../pose-mix';
import { createGameScene, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';
import { faceoffCrouch } from './faceoff';
import { SLAP_DISTANCE, STICK_OVERLAYS, stickSlotOf, type StickStyle } from './stick';

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
  it('seeking into the middle of a wind-up shows the wind-up', () => {
    const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'shot')!;
    expect(poseDistance(poseBySeek(rec, tl, rel.playerId!, rel.tick - 4), poseAtTick(rec, tl, rel.playerId!, rel.tick - 4))).toBeLessThan(0.15);
  });

  // Beyond the brief's list. (The seek sweep over shots, passes and dumps is in stick.picture.test.ts.)
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
        // At the back of the wind-up (a slapshot's comes earlier than a wrist shot's): the frame of 6, 9 or 12 ticks
        // before the release where the blade is furthest back.
        const follow = poseAtTick(g.rec, g.tl, rel.playerId!, rel.tick + 4);
        const back = [6, 9, 12].map((k) => poseAtTick(g.rec, g.tl, rel.playerId!, rel.tick - k)).sort((x, y) => alongShoulders(x) - alongShoulders(y))[0]!;
        // To his left (a left shot) or his right (a right shot) of the way his shoulders face (in the world: his facing
        // plus the pose's twist, mirrored for a right shot), and behind them.
        const w = toWorld(back, back.blade), sh = back.facing + (back.right ? -1 : 1) * (back.twist ?? 0);
        const lateral = -Math.sin(sh) * w.x + Math.cos(sh) * w.z;
        expect(lateral * (hand === 'L' ? -1 : 1), `${hand} ${rel.tick} stick side`).toBeGreaterThan(0.2);
        // Behind him: behind his shoulders, or (a one-timer opened to the pass, the shoulders turned well round) behind
        // his hips.
        expect(bladeBehindBody(back) || back.blade.x < -0.05, `${hand} ${rel.tick} behind ${alongShoulders(back)} ${back.blade.x}`).toBe(true);
        const f = toWorld(follow, follow.blade), l = Math.hypot(f.x, f.z), v = rel.detail.vel, lv = Math.hypot(v.x, v.y);
        expect((f.x * v.x + f.z * v.y) / (l * lv), `${hand} ${rel.tick} follow-through`).toBeGreaterThan(0.5);
      }
    }
  });
  it('the shot types come from where and how the shot was taken', () => {
    for (const seed of [5, 42]) {
      const g = game(seed);
      const seen: Record<StickStyle, number> = { wrist: 0, snap: 0, slap: 0, oneTimer: 0, forehand: 0, backhand: 0, flip: 0, around: 0 };
      const styles = stylesOf(g, releases(g.rec).filter((e) => e.detail.kind === 'shot').slice(0, 40));
      for (const [rel, style] of styles) {
        seen[style]++;
        g.pb.seek(rel.tick - 1);
        const st = g.pb.frame().prev, net = st.attackDir[rel.side!] * RINK.goalLineX, dist = Math.hypot(net - rel.pos.x, rel.pos.y);
        const had = (back: number): boolean => { g.pb.seek(rel.tick - back); return g.pb.frame().prev.carrierId === rel.playerId; };
        if (style === 'slap') { expect(dist).toBeGreaterThanOrEqual(SLAP_DISTANCE); expect(had(16)).toBe(true); }
        if (style === 'oneTimer') expect(had(8)).toBe(false); // he did not have the puck 0.27 s before the release
        if (style === 'snap' || style === 'oneTimer') expect(had(16)).toBe(false);
        if (style === 'wrist') expect(had(15)).toBe(true);
      }
      expect(seen.wrist + seen.snap + seen.slap + seen.oneTimer).toBe(40);
      expect(seen.slap).toBeGreaterThan(1);
      expect(seen.wrist).toBeGreaterThan(seen.slap);
    }
  });
});

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
