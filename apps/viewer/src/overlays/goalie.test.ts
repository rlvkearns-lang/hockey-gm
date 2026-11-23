import { describe, expect, it } from 'vitest';
import { DT, RINK, type GameEvent, type GameEventOf, type GameSetup, type GoalieState } from '@hockey/engine';
import { GOALIE_OVERLAYS, initialGoalieAnim, poseGoalie, refreshGoalie, stepGoalieAnim, type AnimContext, type GoalieAnim, type GoalieSample } from '../animator';
import { bodyDims } from '../body';
import { isCut, probeOf } from '../cuts';
import { fitGoalie, goalieKeyRaw, type GoalieFigurePose } from '../goalie-pose';
import { createCursor, lerpAngle, type Playback, type Recording } from '../playback';
import type { Vec3 } from '../pose-mix';
import { createGameScene, seekScene, type GameScene } from '../scene';
import { recorded, testSetup } from '../test/game';
import { buildTimeline, type Timeline } from '../timeline';

/**
 * Saves that reach the puck, through the real scene and recorded games (seeds 5 and 42). The puck's path on a shot is
 * the engine's own: from where the `release` event let it go (at display time R - 1, the last moment he had it) along
 * the release velocity, falling under gravity, which matches the engine's puck at every tick of the flight (the shot
 * is in the air the whole way; checked below). Moments are display times (ticks, fractional).
 */

type Game = { rec: Recording; tl: Timeline; setup: GameSetup; pb: Playback; sc: GameScene };
const games = new Map<number, Game>();
function game(seed: number): Game {
  let g = games.get(seed);
  if (!g) {
    const rec = recorded(seed), tl = buildTimeline(rec.events), setup = testSetup(seed);
    g = { rec, tl, setup, pb: createCursor(setup, rec), sc: createGameScene(setup, { timeline: tl }) };
    games.set(seed, g);
  }
  return g;
}

type W = { x: number; y: number; z: number }; // world: x and z on the ice (engine x, y), y the height
const GRAVITY = 9.81;
/** The puck on a shot's path at display time t (from its release event). */
function pathAt(rel: GameEventOf<'release'>, t: number): W {
  const tau = (t - (rel.tick - 1)) * DT, v = rel.detail.vel;
  return { x: rel.pos.x + v.x * tau, y: Math.max(0, v.z * tau - (GRAVITY / 2) * tau * tau), z: rel.pos.y + v.y * tau };
}
const releaseOf = (tl: Timeline, tick: number | null, shooter: string): GameEventOf<'release'> | undefined => {
  if (tick === null) return undefined;
  const r = tl.last('release', tick, 0, shooter);
  return r && r.detail.kind === 'shot' ? r : undefined;
};

/** A point of his drawn figure (body frame) in the world. */
function world(v: { position: { x: number; z: number }; facing: number }, p: Vec3): W {
  const c = Math.cos(v.facing), n = Math.sin(v.facing);
  return { x: v.position.x + p.x * c - p.z * n, y: p.y, z: v.position.z + p.x * n + p.z * c };
}
const d3 = (a: W, b: W): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Distance from p to the segment a-b. */
function segDist(p: W, a: W, b: W): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return d3(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t });
}
/** The torso as a segment: the pelvis centre to the middle of the shoulders. */
const torso = (g: GoalieFigurePose): [Vec3, Vec3] => [{ x: 0, y: g.hipY, z: 0 }, { x: (g.shoulders[0].x + g.shoulders[1].x) / 2, y: (g.shoulders[0].y + g.shoulders[1].y) / 2, z: (g.shoulders[0].z + g.shoulders[1].z) / 2 }];
type View = { position: { x: number; z: number }; facing: number; goaliePose: GoalieFigurePose };
/** How far the puck at p is from the part a save names (glove or blocker hand, nearest pad, body for butterfly or cover). */
function partDistance(v: View, part: string, p: W): number {
  const g = v.goaliePose, w = (q: Vec3) => world(v, q);
  const shin = (i: 0 | 1) => segDist(p, w(g.legs[i].knee), w(g.legs[i].ankle));
  if (part === 'glove') return d3(p, w(g.glove));
  if (part === 'blocker') return d3(p, w(g.blocker));
  if (part === 'pad') return Math.min(shin(0), shin(1));
  const [a, b] = torso(g);
  return Math.min(shin(0), shin(1), segDist(p, w(a), w(b)));
}
/** His nearest part to p: hands, pads, thighs, torso and the stick's paddle. */
function nearestPart(v: View, p: W): number {
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
function stanceHands(dims: ReturnType<typeof bodyDims>, catches: 'L' | 'R'): { glove: Vec3; blocker: Vec3 } {
  const s = fitGoalie(goalieKeyRaw('stance', dims, 1), dims, catches);
  return { glove: s.glove, blocker: s.blocker };
}
const goalieDims = (setup: GameSetup, id: string) => { const d = [...setup.home.players, ...setup.away.players].find((p) => p.id === id)!; return bodyDims(d.heightCm, d.weightKg); };

/** Play the scene from 1.5 s before `from` (after a seek with its pre-roll) to `to` at `hz`, calling `each` every frame. */
function play(g: Game, from: number, to: number, hz: number, each: (t: number) => void): void {
  seekScene(g.pb, g.sc, from);
  const step = 1 / (hz * DT);
  for (let t = from + step; t <= to + 1e-9; t += step) { g.pb.seek(t); g.sc.update(g.pb.frame(), 1 / hz); each(t); }
}

type Save = { seed: number; save: GameEventOf<'save'>; rel: GameEventOf<'release'>; freeze: boolean; arrival: number; dist: number; puckGap: number };
const saveCache = new Map<number, Save[]>();
/**
 * The first 15 saves of a game that came from a shot (a `release`), each played through at 240 Hz from 1 s before
 * its release to its tick: the moment the saving part is nearest the puck on its path (the arrival), that distance,
 * and how far the drawn puck is from the saving part then.
 */
function saves(seed: number): Save[] {
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

describe('goalie saves', () => {
  it('the shot path used here is the engine\'s puck at every tick of the flight', () => {
    const g = game(5);
    for (const s of saves(5).slice(0, 6)) {
      for (let k = s.rel.tick; k < s.save.tick; k++) {
        g.pb.seek(k); const st = g.pb.frame().prev, p = pathAt(s.rel, k);
        expect(Math.hypot(st.puck.pos.x - p.x, st.puck.pos.y - p.z, st.puck.z - p.y)).toBeLessThan(5e-3);
      }
    }
  });

  it('on a save the saving part is at the puck when it arrives', () => {
    // First 15 saves from shots of each seed: the part the save names (glove hand, blocker hand, nearest pad, body for
    // a butterfly) comes within 0.25 m (0.4 m for a butterfly body save) of the engine's puck on its path, at a moment
    // before the save's tick; and the drawn puck is at the part then, within the same distance.
    for (const seed of [5, 42]) {
      const list = saves(seed);
      expect(list.length).toBe(15);
      for (const s of list) {
        const lim = s.save.detail.pose === 'butterfly' ? 0.4 : 0.25;
        expect(s.dist, `seed ${seed} ${s.save.detail.pose} save at ${s.save.tick}`).toBeLessThan(lim);
        expect(s.arrival).toBeLessThanOrEqual(s.save.tick);
        expect(s.arrival).toBeGreaterThan(s.save.tick - 2.5);
        expect(s.puckGap, `seed ${seed} drawn puck at ${s.save.tick}`).toBeLessThan(lim);
      }
    }
  });

  it('the goalie starts moving toward the shot before it arrives, and is back in his stance 1.5 s after a save with no rebound shot', () => {
    let before = 0, after = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const s of saves(seed)) {
        const id = s.save.playerId!, dims = goalieDims(g.setup, id);
        const hands = (t: number): number => {
          seekScene(g.pb, g.sc, t);
          const v = g.sc.figure(id)!.goaliePose!, st = stanceHands(dims, v.catches);
          return Math.max(d3(v.glove, st.glove), d3(v.blocker, st.blocker));
        };
        expect(hands(s.arrival - 4), `seed ${seed} save at ${s.save.tick}: 4 ticks before`).toBeGreaterThan(0.08);
        before++;
        // Back in the stance: a save with no freeze, and no shot, save or cover after it within those 1.5 s.
        const end = s.arrival + 45;
        const busy = s.freeze || [g.tl.next('release', s.save.tick, end - s.save.tick), g.tl.next('save', s.save.tick, end - s.save.tick, id), g.tl.next('freeze', s.save.tick, end - s.save.tick, id)].some((x) => x && (x.type !== 'release' || x.detail.kind === 'shot'));
        if (busy) continue;
        expect(hands(end), `seed ${seed} save at ${s.save.tick}: 1.5 s after`).toBeLessThan(0.03);
        after++;
      }
    }
    expect(before).toBe(30);
    expect(after).toBeGreaterThan(6);
  });

  it('on a goal the goalie reaches and is beaten: his nearest part to the crossing point is over 0.2 m away', () => {
    // Every goal of both seeds with a release: at the moment the puck on its path crosses his plane (the upright plane
    // through his centre, square to the way he faces), no part of him (hands, pads, thighs, torso, stick paddle) is
    // within 0.2 m of it; and he did move to it (a hand or a pad moved from his stance).
    let n = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const goal of g.tl.goals) {
        const rel = releaseOf(g.tl, goal.detail.releaseTick, goal.playerId!);
        if (!rel) continue;
        const id = goal.otherId!, dims = goalieDims(g.setup, id);
        let near = Infinity, best = Infinity, reach = 0;
        play(g, rel.tick - 1, goal.tick, 240, (t) => {
          const v = g.sc.figure(id) as unknown as View, p = pathAt(rel, t);
          const fwd = Math.abs((p.x - v.position.x) * Math.cos(v.facing) + (p.z - v.position.z) * Math.sin(v.facing));
          if (fwd < best) { best = fwd; near = nearestPart(v, p); }
          const st = fitGoalie(goalieKeyRaw('stance', dims, 1), dims, v.goaliePose.catches), gp = v.goaliePose;
          reach = Math.max(reach, d3(gp.glove, st.glove), d3(gp.blocker, st.blocker), d3(gp.legs[0].ankle, st.legs[0].ankle), d3(gp.legs[1].ankle, st.legs[1].ankle));
        });
        expect(best, `seed ${seed} goal at ${goal.tick}: the path crosses his plane`).toBeLessThan(0.1);
        expect(near, `seed ${seed} goal at ${goal.tick}`).toBeGreaterThan(0.2);
        expect(reach, `seed ${seed} goal at ${goal.tick}: he reached`).toBeGreaterThan(0.1);
        n++;
      }
    }
    expect(n).toBeGreaterThan(6);
  });

  // Beyond the brief's list.
  it('a frozen glove save holds the puck in the glove until the faceoff setup, and a covered puck under him', () => {
    let glove = 0, cover = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const s of saves(seed)) {
        if (!s.freeze) continue;
        const id = s.save.playerId!;
        for (const dt of [10, 30, 43]) {
          seekScene(g.pb, g.sc, s.save.tick + dt);
          const v = g.sc.figure(id) as unknown as View, p = g.sc.puckWorld();
          const gw = world(v, v.goaliePose.glove);
          // In the glove: in its pocket, which is about 0.12 m out from the middle of the hand.
          if (s.save.detail.pose === 'glove') { expect(d3({ x: p.x, y: p.y, z: p.z }, gw), `seed ${seed} glove hold ${s.save.tick}+${dt}`).toBeLessThan(0.16); glove++; }
          else if (dt === 30) { expect(Math.hypot(p.x - gw.x, p.z - gw.z), `seed ${seed} cover ${s.save.tick}`).toBeLessThan(0.15); expect(p.y).toBeLessThan(0.05); cover++; }
        }
      }
    }
    expect(glove).toBeGreaterThan(5); expect(cover).toBeGreaterThan(1);
  });

  it('a seek into a save shows the pose play shows', () => {
    for (const s of [...saves(5).slice(0, 5), ...saves(42).slice(0, 5)]) {
      const g = game(s.seed), id = s.save.playerId!;
      for (const off of [-3, 0, 4]) {
        const t = Math.round(s.arrival) + off;
        let played: GoalieFigurePose | null = null;
        play(g, t - 30, t, 60, () => { played = structuredClone(g.sc.figure(id)!.goaliePose!); });
        seekScene(g.pb, g.sc, t);
        const sought = g.sc.figure(id)!.goaliePose!;
        expect(d3(sought.glove, played!.glove), `${s.seed} ${s.save.tick} ${off}`).toBeLessThan(0.05);
        expect(d3(sought.blocker, played!.blocker)).toBeLessThan(0.05);
      }
    }
  });

  it('goalie reach never moves a hand more than 0.4 m in one 60 Hz frame and produces no NaN over a period', () => {
    const r = drivePeriod(5);
    expect(r.frames).toBeGreaterThan(60000);
    expect(r.bad).toBe(0);
    expect(r.worst).toBeLessThan(0.4);
  });
});

/**
 * Both goalies through the first period of a recorded game at 60 Hz, through the animator only (no scene; sampled as
 * the scene samples them, starting afresh across an engine cut): the largest move of the glove or the blocker in a
 * frame (body frame), and the poses with a number that is not finite.
 */
function drivePeriod(seed: number): { worst: number; frames: number; bad: number } {
  const g = game(seed), pb = g.pb;
  const end = g.rec.events.find((e: GameEvent) => e.type === 'periodEnd')!.tick;
  const cuts = new Set(pb.cuts);
  pb.seek(0);
  const st0 = pb.frame().next;
  const samples = new Map<string, GoalieSample>(), anims = new Map<string, GoalieAnim>(), last = new Map<string, GoalieFigurePose>();
  for (const side of ['home', 'away'] as const) {
    const s = st0.goalies[side];
    samples.set(s.id, { id: s.id, side, dims: goalieDims(g.setup, s.id), pos: { x: s.pos.x, y: s.pos.y }, facing: s.facing, state: s });
    anims.set(s.id, initialGoalieAnim());
  }
  const ctx: AnimContext = {
    tick: 0, alpha: 0, time: 0, state: st0, skaters: new Map(), goalies: samples,
    puck: { engine: { x: 0, y: 0, z: 0 }, drawn: { x: 0, y: 0, z: 0 }, carrierId: null }, contests: [], timeline: g.tl, rink: RINK, defends: { home: -1, away: 1 },
  };
  const fin = (v: Vec3) => Number.isFinite(v.x + v.y + v.z);
  let worst = 0, frames = 0, bad = 0;
  for (let i = 1; i <= end * 2; i++) {
    pb.seek(i * 0.5);
    const f = pb.frame(), prev = f.prev, a = f.alpha;
    const next = isCut(probeOf(prev), f.next) ? prev : f.next;
    const cut = cuts.has(prev.tick) && a === 0;
    ctx.tick = f.tick; ctx.alpha = a; ctx.time = (f.tick + a) * DT; ctx.state = next; ctx.contests = next.contests;
    ctx.defends.home = next.attackDir.home === 1 ? -1 : 1; ctx.defends.away = next.attackDir.away === 1 ? -1 : 1;
    ctx.puck.engine.x = prev.puck.pos.x + (next.puck.pos.x - prev.puck.pos.x) * a; ctx.puck.engine.z = prev.puck.pos.y + (next.puck.pos.y - prev.puck.pos.y) * a;
    ctx.puck.engine.y = Math.max(0, prev.puck.z + (next.puck.z - prev.puck.z) * a);
    ctx.puck.carrierId = next.carrierId;
    for (const side of ['home', 'away'] as const) {
      const p = prev.goalies[side], n: GoalieState = next.goalies[side], s = samples.get(p.id) ?? samples.get(n.id)!;
      s.pos.x = p.pos.x + (n.pos.x - p.pos.x) * a; s.pos.y = p.pos.y + (n.pos.y - p.pos.y) * a; s.facing = lerpAngle(p.facing, n.facing, a); s.state = n;
    }
    for (const s of samples.values()) {
      let anim = anims.get(s.id)!;
      if (cut) anim = refreshGoalie(anim);
      anim = stepGoalieAnim(anim, s, ctx, 1 / 60);
      anims.set(s.id, anim);
      const pose = poseGoalie(anim, s, ctx, s.dims);
      frames++;
      if (!fin(pose.glove) || !fin(pose.blocker) || !Number.isFinite(pose.hipY) || !fin(pose.legs[0].ankle) || !fin(pose.legs[1].ankle)) bad++;
      const was = last.get(s.id);
      if (was && !cut) worst = Math.max(worst, d3(was.glove, pose.glove), d3(was.blocker, pose.blocker));
      last.set(s.id, pose);
    }
  }
  expect(GOALIE_OVERLAYS.length).toBeGreaterThan(0);
  return { worst, frames, bad };
}
