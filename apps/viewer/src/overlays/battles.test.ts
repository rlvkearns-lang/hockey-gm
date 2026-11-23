import { beforeAll, describe, expect, it } from 'vitest';
import { DT, type ContestState, type GameEventOf, type GameState } from '@hockey/engine';
import type { BodyDims } from '../body';
import { createCursor } from '../playback';
import { shoulderJoint, type SkaterPose, type Vec3 } from '../pose-mix';
import { createGameScene, seekScene } from '../scene';
import { contactFrames } from '../test/contact-frames';
import { recorded, testSetup } from '../test/game';
import { drivePeriod, type PeriodFrame, type PeriodSkater } from '../test/period';
import { buildTimeline } from '../timeline';
import { battleOn, battleSlotOf, KEEP_SECONDS } from './battles';
import { boardsGap, MAX_OFFSET, pairMin, radiusOfWeight, weightOfDims } from './contact';

/**
 * Board battles, net-front battles and loose-puck races, measured in ONE pass over the first period of seed 5 through
 * the animator and the body pass (test/period.ts), plus a seek-against-play check through the scene.
 */

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A body-frame point of his pose in the world (x, z: engine x, y), drawn where the body pass put him. */
function world(sk: PeriodSkater, p: Vec3): { x: number; z: number; y: number } {
  const s = sk.sample, b = sk.body, bz = s.right ? -p.z : p.z, c = Math.cos(s.facing), n = Math.sin(s.facing);
  return { x: b.pos.x + b.offset.x + p.x * c - bz * n, z: b.pos.y + b.offset.z + p.x * n + bz * c, y: p.y };
}
/** World heading (engine radians) his shoulders face. */
const torsoHeading = (sk: PeriodSkater): number => sk.sample.facing + (sk.sample.right ? -1 : 1) * (sk.pose!.twist ?? 0);
/** Pose distance: the largest move (m, body frame) of a hand, the blade, a skate, a shoulder, or the hip height. */
function poseDistance(a: SkaterPose, b: SkaterPose, d: BodyDims): number {
  let m = Math.abs(a.hipY - b.hipY);
  for (const i of [0, 1] as const) {
    m = Math.max(m, dist3(a.arms[i].hand, b.arms[i].hand), dist3(a.legs[i].foot, b.legs[i].foot), dist3(shoulderJoint(a, i, d), shoulderJoint(b, i, d)));
  }
  return Math.max(m, dist3(a.blade, b.blade));
}

type Pin = { cid: number; ordered: number; engineOrdered: number; hipGap: number; pinnedFace: number; pinnerFace: number; roles: number; support: number[] };
type Dig = { cid: number; win: number; lose: number; underfoot: boolean };
type Resolve = { cid: number; how: string; blade: number; underfoot: boolean };
type Net = { cid: number; face: number; bladeY: number; behind: number; lean: number; goalSide: boolean };
type Stats = {
  pins: Pin[]; digs: Dig[]; resolves: Resolve[]; nets: Net[];
  /** Participants still with a battle stance KEEP_SECONDS after their contest's end (board battles), and after a whistle. */
  stuck: string[]; whistleStuck: string[]; whistles: number; boardEnds: number;
  battleFrames: number; worstOverlap: number; worstOverlapAt: string; worstOffset: number; worstHands: number; worstHandsAt: string;
  worstBody: number; worstBodyAt: string; bad: number;
};
let stats: Stats;

describe('battles through a whole period (seed 5, 60 Hz, the animator and the body pass)', () => {
  beforeAll(() => {
    const s: Stats = {
      pins: [], digs: [], resolves: [], nets: [], stuck: [], whistleStuck: [], whistles: 0, boardEnds: 0,
      battleFrames: 0, worstOverlap: 0, worstOverlapAt: '', worstOffset: 0, worstHands: 0, worstHandsAt: '', worstBody: 0, worstBodyAt: '', bad: 0,
    };
    const rec = recorded(5), tl = buildTimeline(rec.events);
    // Per contest: participants ever seen, when pinned was first set, when digLast last changed, the frames to measure.
    type Track = { kind: string; ids: Set<string>; pinAt: number; midPin: number; digLast: string | null; digLastAt: number; dug: boolean; end: number; result: string; checkEnd: number; resolved: boolean; net: boolean };
    const tracks = new Map<number, Track>();
    const radius = new Map<string, number>();
    const cf = contactFrames();
    const lastBattle = new Map<string, number>();
    const onLast = new Map<string, boolean>();
    const last = new Map<string, { h0: Vec3; h1: Vec3; b: Vec3; f0: Vec3; f1: Vec3; hip: number }>();
    const byId = (f: PeriodFrame, id: string): PeriodSkater | undefined => f.skaters.find((k) => k.id === id);
    /** The puck within 0.3 m of where he is drawn: under his skates, nearer than a blade on the ice can come. */
    const underfoot = (k: PeriodSkater, pk: { x: number; z: number }): boolean => Math.hypot(pk.x - k.body.pos.x - k.body.offset.x, pk.z - k.body.pos.y - k.body.offset.z) < 0.3;
    const bySeen = (c: ContestState): Track => {
      let t = tracks.get(c.id);
      if (!t) {
        const e = tl.contest(c.id)?.end;
        t = { kind: c.kind, ids: new Set(), pinAt: -1, midPin: -1, digLast: null, digLastAt: -1, dug: false, end: e?.tick ?? Infinity, result: e?.detail.result ?? '', checkEnd: (e?.tick ?? Infinity) + Math.ceil(KEEP_SECONDS / DT), resolved: false, net: false };
        tracks.set(c.id, t);
      }
      return t;
    };
    drivePeriod(5, (f) => {
      const { ctx, bodies } = f;
      if (radius.size === 0) for (const b of bodies) radius.set(b.id, radiusOfWeight(weightOfDims(b.kind === 'skater' ? ctx.skaters.get(b.id)!.dims : ctx.goalies.get(b.id)!.dims)));
      const exact = f.alpha === 0;
      const st: GameState = f.next;
      for (const c of st.contests) {
        if (c.kind !== 'boardBattle' && c.kind !== 'netFront' && c.kind !== 'looseRace') continue;
        const t = bySeen(c);
        for (const id of c.participants) { t.ids.add(id); lastBattle.set(id, f.i); }
        if (c.kind === 'boardBattle') {
          const r = c.roles;
          if (r.pinned !== null && t.pinAt < 0) {
            t.pinAt = st.tick;
            const resolveAt = t.end - 9;
            t.midPin = Math.max(st.tick + 11, Math.round((st.tick + resolveAt) / 2));
          }
          if (r.digLast !== t.digLast) { t.digLast = r.digLast; t.digLastAt = st.tick; }
          // Mid-pin (the pin held, before the result): the first 15 battles in which a man is pinned.
          if (exact && st.tick === t.midPin && r.pinned !== null && c.stage !== 'resolve' && s.pins.length < 15) {
            const P = byId(f, r.pinned)!, Q = byId(f, r.pinned === r.a ? r.b : r.a)!;
            const n = { x: 0, z: 0 };
            boardsGap(c.spot.x, c.spot.y, n);
            const nh = Math.atan2(n.z, n.x);
            const pd = (k: PeriodSkater): number => (k.body.pos.x + k.body.offset.x) * n.x + (k.body.pos.y + k.body.offset.z) * n.z;
            const sup = [r.supportA, r.supportB].filter((x): x is string => x !== null).map((id) => byId(f, id)!).filter((k) => k.pose);
            s.pins.push({
              cid: c.id, ordered: pd(P) - pd(Q), engineOrdered: (P.body.pos.x - Q.body.pos.x) * n.x + (P.body.pos.y - Q.body.pos.y) * n.z, hipGap: P.pose!.hipY - Q.pose!.hipY,
              pinnedFace: Math.abs(wrap(torsoHeading(P) - nh)), pinnerFace: Math.abs(wrap(torsoHeading(Q) - nh)),
              roles: poseDistance(P.pose!, Q.pose!, P.sample.dims),
              support: sup.map((k) => Math.min(poseDistance(k.pose!, P.pose!, k.sample.dims), poseDistance(k.pose!, Q.pose!, k.sample.dims))),
            });
          }
          // The dig, the last round's winner settled on it for 0.3 s: the first 15 battles reaching it.
          if (exact && c.stage === 'dig' && r.digLast !== null && !t.dug && st.tick === t.digLastAt + 9 && s.digs.length < 15) {
            t.dug = true;
            const W = byId(f, r.digLast)!, L = byId(f, r.digLast === r.a ? r.b : r.a)!;
            const pk = ctx.puck.engine, bl = (k: PeriodSkater): number => { const w = world(k, k.pose!.blade); return Math.hypot(w.x - pk.x, w.z - pk.z); };
            s.digs.push({ cid: c.id, win: bl(W), lose: bl(L), underfoot: underfoot(W, pk) });
          }
          // The resolve, three ticks before its end: the winner's blade on the puck.
          if (exact && c.stage === 'resolve' && r.winner !== null && st.tick === t.end - 3 && !t.resolved) {
            t.resolved = true;
            const W = byId(f, r.winner)!, w = world(W, W.pose!.blade), pk = ctx.puck.engine;
            s.resolves.push({ cid: c.id, how: t.result, blade: Math.hypot(w.x - pk.x, w.z - pk.z), underfoot: underfoot(W, pk) });
          }
        } else if (c.kind === 'netFront' && exact && c.stage === 'jostle' && !t.net && s.nets.length < 15) {
          const start = tl.contest(c.id)!.start.tick;
          if (st.tick === start + 30) {
            t.net = true;
            const A = byId(f, c.roles.attacker)!, D = byId(f, c.roles.defender)!;
            const pk = ctx.puck.engine, ah = torsoHeading(A);
            const toPuck = Math.atan2(pk.z - (A.body.pos.y + A.body.offset.z), pk.x - (A.body.pos.x + A.body.offset.x));
            const ax = A.body.pos.x + A.body.offset.x, ay = A.body.pos.y + A.body.offset.z, dx = D.body.pos.x + D.body.offset.x - ax, dy = D.body.pos.y + D.body.offset.z - ay;
            // Leaning: his shoulders over toward the attacker from his hips (world, along the line to him).
            const sm = shoulderJoint(D.pose!, 0, D.sample.dims), sm1 = shoulderJoint(D.pose!, 1, D.sample.dims);
            const mid = world(D, { x: (sm.x + sm1.x) / 2, y: 0, z: (sm.z + sm1.z) / 2 }), hip = world(D, { x: 0, y: 0, z: 0 }), l = Math.hypot(dx, dy) || 1;
            // The engine has the defender on the far side of him from the puck (at his back once he faces it).
            const goalSide = (D.sample.pos.x - A.sample.pos.x) * (pk.x - A.sample.pos.x) + (D.sample.pos.y - A.sample.pos.y) * (pk.z - A.sample.pos.y) < 0;
            s.nets.push({
              cid: c.id, goalSide, face: Math.abs(wrap(ah - toPuck)), bladeY: A.pose!.blade.y,
              behind: (dx * Math.cos(ah) + dy * Math.sin(ah)) / l, lean: -((mid.x - hip.x) * dx + (mid.z - hip.z) * dy) / l,
            });
          }
        }
      }
      // KEEP_SECONDS after each contest's end: no battle stance on anyone who was in it.
      for (const [cid, t] of tracks) {
        if (!exact || st.tick !== t.checkEnd + 1) continue;
        const whistle = t.result === 'whistle' || t.result === 'trapped' || t.result === 'abandoned';
        if (t.kind === 'boardBattle') s.boardEnds++;
        if (whistle) s.whistles++;
        for (const id of t.ids) {
          const k = byId(f, id)!;
          // (Already in another battle is fine: that is his new stance.)
          // (Off the ice he is not drawn, and starts afresh when he steps on.)
          if (k.sample.onIce && battleOn(k.anim) && Object.values(battleSlotOf(k.anim)?.recs ?? {}).some((r) => r.cid === cid)) (whistle ? s.whistleStuck : s.stuck).push(`${cid} ${t.kind} ${t.result} ${id}`);
        }
        tracks.delete(cid);
      }
      // Bounds in battle frames: anyone in a battle, or within KEEP_SECONDS after.
      const inBattle = (id: string): boolean => f.i - (lastBattle.get(id) ?? -1e9) <= KEEP_SECONDS * 60 + 2;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        if (!a.onIce) continue;
        const ab = inBattle(a.id);
        if (ab) s.worstOffset = Math.max(s.worstOffset, Math.hypot(a.offset.x, a.offset.z));
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          if (!b.onIce || !(ab || inBattle(b.id))) continue;
          // As contact.test.ts measures it: a hit's pair may be drawn meeting (pairMin), and a skater running through his
          // goalie is measured apart there.
          if ((a.kind === 'goalie') !== (b.kind === 'goalie') && Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) < 0.6) continue;
          const o = pairMin(ctx, a.id, b.id, radius.get(a.id)!, radius.get(b.id)!) - Math.hypot(b.pos.x + b.offset.x - a.pos.x - a.offset.x, b.pos.y + b.offset.z - a.pos.y - a.offset.z);
          if (o > s.worstOverlap) { s.worstOverlap = o; s.worstOverlapAt = `${f.tick} ${a.id} ${b.id}`; }
        }
      }
      for (const sk of f.skaters) {
        const p = sk.pose;
        if (!p) { last.delete(sk.id); continue; }
        const contact = cf.at((f.tick + f.alpha) * DT, f.prev, f.next, sk.id);
        const now = { h0: { ...p.arms[0].hand }, h1: { ...p.arms[1].hand }, b: { ...p.blade }, f0: { ...p.legs[0].foot }, f1: { ...p.legs[1].foot }, hip: p.hipY };
        const was = last.get(sk.id);
        last.set(sk.id, now);
        // Battle frames: a battle stance on him at this frame or the last (inBattle above is for the bodies).
        const on = battleOn(sk.anim), wasOn = onLast.get(sk.id) ?? false;
        onLast.set(sk.id, on);
        if (!on && !wasOn) continue;
        if ([p.hipY, p.pitch, p.roll, p.twist ?? 0, now.h0.x, now.h0.y, now.h1.z, now.b.x, now.b.y, now.b.z, now.f0.x, now.f1.z].some((v) => !Number.isFinite(v))) s.bad++;
        if (!was || f.cut || contact) continue;
        s.battleFrames++;
        const hands = Math.max(dist3(was.h0, now.h0), dist3(was.h1, now.h1), dist3(was.b, now.b));
        const body = Math.max(Math.abs(was.hip - now.hip), dist3(was.f0, now.f0), dist3(was.f1, now.f1));
        if (hands > s.worstHands) { s.worstHands = hands; s.worstHandsAt = `${f.tick}+${f.alpha.toFixed(2)} ${sk.id}`; }
        if (body > s.worstBody) { s.worstBody = body; s.worstBodyAt = `${f.tick}+${f.alpha.toFixed(2)} ${sk.id}`; }
      }
    });
    stats = s;
  }, 120_000);

  it('in the pin stage the pinner is between the pinned man and open ice, facing the boards, and lower', () => {
    expect(stats.pins.length).toBe(15);
    // Where the engine itself has the pinned man further from the boards than his pinner by more than the drawn offsets
    // can make up (two men cannot be drawn through each other), counted apart: an engine fact (see the report).
    const inverted = stats.pins.filter((p) => p.engineOrdered < -2 * 0.35 + 0.05);
    expect(inverted.length, inverted.map((p) => `${p.cid}: ${p.engineOrdered.toFixed(2)} m`).join(', ')).toBeLessThan(3);
    for (const p of stats.pins) {
      if (!inverted.includes(p)) expect.soft(p.ordered, `${p.cid} pinned nearer the boards than the pinner (m)`).toBeGreaterThan(0);
      expect.soft(p.hipGap, `${p.cid} pinner hip lower (m)`).toBeGreaterThan(0.05);
      expect.soft(p.pinnedFace, `${p.cid} pinned torso to the boards (rad)`).toBeLessThan(50 * DEG);
      expect.soft(p.pinnerFace, `${p.cid} pinner torso to the boards (rad)`).toBeLessThan(50 * DEG);
    }
  });

  it('in the dig stage both blades are within 0.5 m of the puck, and the last round winner is nearer', () => {
    expect(stats.digs.length).toBeGreaterThan(9);
    // A puck under the last round winner's skates (nearer than a blade on the ice comes) is counted apart.
    expect(stats.digs.filter((d) => d.underfoot).length).toBeLessThan(3);
    for (const d of stats.digs) {
      if (d.underfoot) continue;
      expect.soft(d.win, `${d.cid} last round winner's blade`).toBeLessThan(0.5);
      expect.soft(d.lose, `${d.cid} the other blade`).toBeLessThan(0.5);
      expect.soft(d.win, `${d.cid} winner nearer`).toBeLessThan(d.lose);
    }
  });

  it('each role is visibly different: poses of pinner and pinned differ by more than 0.3 in pose distance at mid-pin, and a supporter differs from both', () => {
    let supporters = 0;
    for (const p of stats.pins) {
      expect.soft(p.roles, `${p.cid} pinner against pinned`).toBeGreaterThan(0.3);
      for (const d of p.support) { expect.soft(d, `${p.cid} supporter against both`).toBeGreaterThan(0.3); supporters++; }
    }
    expect(supporters).toBeGreaterThan(9);
  });

  it('at resolve the winner has the puck on his blade and the overlay is gone within 1.2 s of contestEnd for every participant', () => {
    expect(stats.resolves.length).toBeGreaterThan(15);
    expect(stats.resolves.filter((r) => r.underfoot).length).toBeLessThan(3);
    for (const r of stats.resolves) if (!r.underfoot) expect.soft(r.blade, `${r.cid} (${r.how}) winner's blade from the puck (m)`).toBeLessThan(0.3);
    expect(stats.boardEnds).toBeGreaterThan(40);
    expect(stats.stuck).toEqual([]);
  });

  it('a net-front attacker faces the puck with his blade on the ice; the defender is behind him and leaning', () => {
    expect(stats.nets.length).toBe(15);
    expect(stats.nets.filter((n) => n.goalSide).length).toBeGreaterThan(7);
    for (const n of stats.nets) {
      expect.soft(n.face, `${n.cid} attacker torso to the puck (rad)`).toBeLessThan(45 * DEG);
      expect.soft(n.bladeY, `${n.cid} attacker blade height`).toBeLessThan(0.02);
      // Behind him wherever the engine has the defender on the far side of him from the puck (else beside or in front).
      if (n.goalSide) expect.soft(n.behind, `${n.cid} defender behind him (cos)`).toBeLessThan(0);
      expect.soft(n.lean, `${n.cid} defender's shoulders over toward him (m)`).toBeGreaterThan(0.25);
    }
  });

  it('a battle cut off by a whistle or a period break leaves no overlay on anyone', () => {
    expect(stats.whistles).toBeGreaterThan(4);
    expect(stats.whistleStuck).toEqual([]);
  });

  it('battle frames keep the overlap, offset and continuity bounds of Task 4', () => {
    expect(stats.battleFrames).toBeGreaterThan(20000);
    expect(stats.bad).toBe(0);
    expect(stats.worstOverlap, stats.worstOverlapAt).toBeLessThan(0.15);
    expect(stats.worstOffset).toBeLessThan(MAX_OFFSET + 1e-9);
    expect(stats.worstHands, stats.worstHandsAt).toBeLessThan(0.35);
    expect(stats.worstBody, stats.worstBodyAt).toBeLessThan(0.1);
  });
});

describe('seeking into a battle', () => {
  it('a seek into the middle of a dig shows the poses play shows', () => {
    const seed = 5, rec = recorded(seed), setup = testSetup(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
    const played = createGameScene(setup, { timeline: tl }), seeked = createGameScene(setup, { timeline: tl });
    const starts = rec.events.filter((e): e is GameEventOf<'contestStart'> => e.type === 'contestStart' && e.detail.kind === 'boardBattle');
    let checked = 0, worst = 0, worstAt = '';
    for (const e of starts) {
      if (checked >= 4) break;
      const end = tl.contest(e.detail.contestId)?.end;
      if (!end || end.detail.result === 'protected' || end.tick - e.tick < 70) continue;
      const t = end.tick - 20; // in the dig, with the stances well under way (a battle can outlast the pre-roll)
      seekScene(pb, played, t - 150, 0);
      for (let i = 1; i <= 300; i++) { pb.seek(t - 150 + i / 2); played.update(pb.frame(), 1 / 60); }
      seekScene(pb, seeked, t);
      const ids = e.detail.participants;
      for (const id of ids) {
        const a = played.figure(id)!.pose!, b = seeked.figure(id)!.pose!;
        // The stance's own parts: the blade (where the dig puts it), the free hand, the shoulders' turn. (The hips and the
        // top hand solved from the blade also carry the gait's stride, which no engine state pins: scene-seek.test.ts.)
        const m = Math.max(dist3(a.arms[0].hand, b.arms[0].hand), dist3(a.blade, b.blade), Math.abs((a.twist ?? 0) - (b.twist ?? 0)));
        if (m > worst) { worst = m; worstAt = `${t} ${id}`; }
      }
      checked++;
    }
    played.dispose(); seeked.dispose();
    expect(checked).toBe(4);
    // The gait's stride phase is not pinned by any engine state (scene-seek.test.ts); the battle stances are.
    expect(worst, worstAt).toBeLessThan(0.08);
  });
});
