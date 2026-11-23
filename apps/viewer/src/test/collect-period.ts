import { DT, type ContestState, type GameState } from '@hockey/engine';
import type { BodyDims } from '../body';
import type { GoalieFigurePose } from '../goalie-pose';
import { battleOn, battleSlotOf, KEEP_SECONDS } from '../overlays/battles';
import { boardsGap, pairMin, radiusOfWeight, weightOfDims } from '../overlays/contact';
import { stickWeight } from '../overlays/stick';
import { shoulderJoint, type SkaterPose, type Vec3 } from '../pose-mix';
import type { Timeline } from '../timeline';
import { contactFrames } from './contact-frames';
import type { PeriodFrame, PeriodSkater } from './period';

/**
 * What the whole-period measurements collect, frame by frame, from ONE pass over the first period of seed 5 through
 * the animator and the body pass (test/period.ts with the goalies animated): the stick actions' continuity, contact's
 * overlaps, offsets and continuity, the battles' stances and bounds, and the goalies' reach. Each collector was the
 * pass of its own test file before (overlays/stick, contact, battles and goalie .test.ts); the measures are unchanged.
 */

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
type Collector<S> = { onFrame(f: PeriodFrame): void; stats: S };

// ---- Stick actions (was overlays/stick.test.ts drivePeriod).

/** The largest move of a hand or the blade heel between two poses (body frame, m). */
const handsMove = (a: SkaterPose, b: SkaterPose): number => Math.max(dist3(a.arms[0].hand, b.arms[0].hand), dist3(a.arms[1].hand, b.arms[1].hand), dist3(a.blade, b.blade));
function finitePose(p: SkaterPose): boolean {
  const v = [p.blade, p.arms[0].hand, p.arms[1].hand, p.legs[0].foot, p.legs[1].foot];
  for (const q of v) if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z)) return false;
  return Number.isFinite(p.hipY) && Number.isFinite(p.pitch) && Number.isFinite(p.roll) && Number.isFinite(p.yaw) && Number.isFinite(p.stickAngle) && Number.isFinite(p.twist ?? 0);
}
const copyPose = (p: SkaterPose): SkaterPose => ({
  ...p, legs: [{ ...p.legs[0], foot: { ...p.legs[0].foot } }, { ...p.legs[1], foot: { ...p.legs[1].foot } }],
  arms: [{ hand: { ...p.arms[0].hand } }, { hand: { ...p.arms[1].hand } }], blade: { ...p.blade },
});

export type StickStats = { worst: number; worstBody: number; posed: number; active: number; bad: number; worstContact: number; worstContactBody: number; contactFrames: number };
/**
 * For every skater on the ice in every frame but his first on the ice and those across an engine cut: the largest move
 * in a frame of a hand or the blade heel, and of the hips or a skate; the frames in which a stick action shows on him;
 * the poses with a number that is not finite. Frames of a hit's impact or of a fall and getting up
 * (test/contact-frames.ts) are measured apart (worstContact, worstContactBody).
 */
export function stickCollector(): Collector<StickStats> {
  const stats: StickStats = { worst: 0, worstBody: 0, posed: 0, active: 0, bad: 0, worstContact: 0, worstContactBody: 0, contactFrames: 0 };
  const last = new Map<string, { pose: SkaterPose; on: boolean }>();
  const cf = contactFrames();
  return {
    stats,
    onFrame(f) {
      for (const sk of f.skaters) {
        const s = sk.sample;
        if (!s.onIce || !sk.pose) { last.delete(sk.id); continue; }
        const pose = sk.pose, on = stickWeight(sk.anim, s, f.ctx) > 0;
        stats.posed++;
        if (!finitePose(pose)) stats.bad++;
        const was = last.get(sk.id);
        const contact = cf.at((f.tick + f.alpha) * DT, f.prev, f.next, sk.id);
        if (was && !f.cut && contact) {
          stats.worstContact = Math.max(stats.worstContact, handsMove(was.pose, pose));
          stats.worstContactBody = Math.max(stats.worstContactBody, Math.abs(was.pose.hipY - pose.hipY), dist3(was.pose.legs[0].foot, pose.legs[0].foot), dist3(was.pose.legs[1].foot, pose.legs[1].foot));
          stats.contactFrames++;
        } else if (was && !f.cut) {
          stats.worst = Math.max(stats.worst, handsMove(was.pose, pose));
          if (on || was.on) stats.active++;
          stats.worstBody = Math.max(stats.worstBody, Math.abs(was.pose.hipY - pose.hipY), dist3(was.pose.legs[0].foot, pose.legs[0].foot), dist3(was.pose.legs[1].foot, pose.legs[1].foot));
        }
        last.set(sk.id, { pose: copyPose(pose), on });
      }
    },
  };
}

// ---- Goalie reach (was overlays/goalie.test.ts drivePeriod).

export type GoalieStats = { worst: number; frames: number; bad: number };
/** Both goalies: the largest move of the glove or the blocker in a frame (body frame), and the poses with a number that is not finite. */
export function goalieCollector(): Collector<GoalieStats> {
  const stats: GoalieStats = { worst: 0, frames: 0, bad: 0 };
  const last = new Map<string, { glove: Vec3; blocker: Vec3 }>();
  const fin = (v: Vec3): boolean => Number.isFinite(v.x + v.y + v.z);
  return {
    stats,
    onFrame(f) {
      for (const g of f.goaliePoses) {
        const pose: GoalieFigurePose = g.pose;
        stats.frames++;
        if (!fin(pose.glove) || !fin(pose.blocker) || !Number.isFinite(pose.hipY) || !fin(pose.legs[0].ankle) || !fin(pose.legs[1].ankle)) stats.bad++;
        const was = last.get(g.id);
        if (was && !f.cut) stats.worst = Math.max(stats.worst, dist3(was.glove, pose.glove), dist3(was.blocker, pose.blocker));
        last.set(g.id, { glove: { ...pose.glove }, blocker: { ...pose.blocker } });
      }
    },
  };
}

// ---- Contact (was overlays/contact.test.ts's whole-period beforeAll).

export type ContactStats = {
  frames: number; worstOverlap: number; worstOverlapAt: string; worstBoards: number; worstOffset: number;
  lateOffset: number; lateAt: string; worstPlain: number; worstPlainAt: string; worstBodyContact: number; worstBodyContactAt: string; worstBody: number; worstBodyAt: string; worstContact: number; contactFrames: number; plainFrames: number; bad: number;
  worstStep: number; worstStepAt: string; worstThrough: number;
};
export function contactCollector(): Collector<ContactStats> {
  const s: ContactStats = { frames: 0, worstOverlap: 0, worstOverlapAt: '', worstBoards: 0, worstOffset: 0, lateOffset: 0, lateAt: '', worstPlain: 0, worstPlainAt: '', worstBodyContact: 0, worstBodyContactAt: '', worstBody: 0, worstBodyAt: '', worstContact: 0, contactFrames: 0, plainFrames: 0, bad: 0, worstStep: 0, worstStepAt: '', worstThrough: 0 };
  const radius = new Map<string, number>(), lastContact = new Map<string, number>(), lastOffset = new Map<string, { x: number; z: number }>();
  const cf = contactFrames();
  const last = new Map<string, { h0: Vec3; h1: Vec3; b: Vec3; f0: Vec3; f1: Vec3; hip: number }>();
  return {
    stats: s,
    onFrame(f) {
      s.frames++;
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
          // (The two men of a hit may be drawn meeting through its impact: pairMin.)
          const o = pairMin(ctx, a.id, b.id, ra, rb) - Math.hypot(b.pos.x + b.offset.x - ax, b.pos.y + b.offset.z - az);
          // A skater whose engine place comes within 0.6 m of a goalie's is running right through him (the engine does not
          // keep skaters off goalies): the side the pass holds him to must flip as he goes by, and at OFFSET_SPEED
          // with 0.35 m each that leaves a larger overlap for a few frames (in dead play the goalie is not moved at all,
          // so the skater alone moves). Measured apart.
          const through = (a.kind === 'goalie') !== (b.kind === 'goalie') && Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) < 0.6;
          if (through) s.worstThrough = Math.max(s.worstThrough, o);
          else if (o > s.worstOverlap) { s.worstOverlap = o; s.worstOverlapAt = `${f.tick} ${a.id} ${b.id}`; }
          // In contact: their engine places within the two radii, or (the body pass holding them apart, or about to: it
          // looks 0.12 s ahead) their drawn places within the radii and a margin.
          const drawn = Math.hypot(b.pos.x + b.offset.x - ax, b.pos.y + b.offset.z - az);
          if (ra + rb - Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) > 0 || drawn < ra + rb + 0.05) { lastContact.set(a.id, f.i); lastContact.set(b.id, f.i); }
        }
      }
      // Contact from the engine: in a contest, or down.
      for (const sk of f.skaters) {
        const st = sk.sample.state;
        if (st.contestId !== null || st.downT > 0) lastContact.set(sk.id, f.i);
      }
      for (const b of bodies) {
        const was = lastOffset.get(b.id);
        if (!b.onIce) { lastOffset.delete(b.id); continue; }
        if (was && !f.cut) {
          const step = Math.hypot(b.offset.x - was.x, b.offset.z - was.z);
          if (step > s.worstStep) { s.worstStep = step; s.worstStepAt = `${f.tick}+${f.alpha} ${b.id}`; }
        }
        lastOffset.set(b.id, { x: b.offset.x, z: b.offset.z });
        const since = f.i - (lastContact.get(b.id) ?? -1e9);
        const off = Math.hypot(b.offset.x, b.offset.z);
        if (since >= 60 && off > s.lateOffset) { s.lateOffset = off; s.lateAt = `${f.tick} ${b.id}`; }
      }
      // Continuity: hands and blade per frame; impact and fall frames apart (from engine facts).
      for (const sk of f.skaters) {
        const p = sk.pose;
        if (!p) { last.delete(sk.id); continue; }
        const contact = cf.at((f.tick + f.alpha) * DT, f.prev, f.next, sk.id);
        const now = { h0: { ...p.arms[0].hand }, h1: { ...p.arms[1].hand }, b: { ...p.blade }, f0: { ...p.legs[0].foot }, f1: { ...p.legs[1].foot }, hip: p.hipY };
        const nums = [p.hipY, p.pitch, p.roll, now.h0.x, now.h0.y, now.h0.z, now.h1.x, now.h1.y, now.h1.z, now.b.x, now.b.y, now.b.z, p.legs[0].foot.x, p.legs[1].foot.z];
        if (nums.some((v) => !Number.isFinite(v))) s.bad++;
        const was = last.get(sk.id);
        if (was && !f.cut) {
          const mv = Math.max(dist3(was.h0, now.h0), dist3(was.h1, now.h1), dist3(was.b, now.b));
          const body = Math.max(Math.abs(was.hip - now.hip), dist3(was.f0, now.f0), dist3(was.f1, now.f1));
          if (contact && body > s.worstBodyContact) { s.worstBodyContact = body; s.worstBodyContactAt = `${f.tick}+${f.alpha} ${sk.id}`; }
          if (!contact && body > s.worstBody) { s.worstBody = body; s.worstBodyAt = `${f.tick}+${f.alpha} ${sk.id}`; }
          if (contact) { s.worstContact = Math.max(s.worstContact, mv); s.contactFrames++; } else { if (mv > s.worstPlain) { s.worstPlain = mv; s.worstPlainAt = `${f.tick}+${f.alpha.toFixed(2)} ${sk.id}`; } s.plainFrames++; }
        }
        last.set(sk.id, now);
      }
    },
  };
}

// ---- Battles (was overlays/battles.test.ts's whole-period beforeAll).

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

export type Pin = { cid: number; ordered: number; engineOrdered: number; hipGap: number; pinnedFace: number; pinnerFace: number; roles: number; support: number[] };
export type Dig = { cid: number; win: number; lose: number; underfoot: boolean };
export type Resolve = { cid: number; how: string; blade: number; underfoot: boolean };
export type Net = { cid: number; face: number; bladeY: number; behind: number; lean: number; goalSide: boolean };
export type BattleStats = {
  pins: Pin[]; digs: Dig[]; resolves: Resolve[]; nets: Net[];
  /** Participants still with a battle stance KEEP_SECONDS after their contest's end (board battles), and after a whistle. */
  stuck: string[]; whistleStuck: string[]; whistles: number; boardEnds: number;
  battleFrames: number; worstOverlap: number; worstOverlapAt: string; worstOffset: number; worstHands: number; worstHandsAt: string;
  worstBody: number; worstBodyAt: string; bad: number;
};
export function battleCollector(tl: Timeline): Collector<BattleStats> {
  const s: BattleStats = {
    pins: [], digs: [], resolves: [], nets: [], stuck: [], whistleStuck: [], whistles: 0, boardEnds: 0,
    battleFrames: 0, worstOverlap: 0, worstOverlapAt: '', worstOffset: 0, worstHands: 0, worstHandsAt: '', worstBody: 0, worstBodyAt: '', bad: 0,
  };
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
  return {
    stats: s,
    onFrame(f) {
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
          // As the contact collector measures it: a hit's pair may be drawn meeting (pairMin), and a skater running
          // through his goalie is measured apart there.
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
    },
  };
}
