import { DT, type GameEventOf } from '@hockey/engine';
import { isCut, probeOf } from '../cuts';
import { CONTACT_PLANE, HAND_FACE } from '../overlays/goalie';
import { createCursor, lerpAngle } from '../playback';
import { createGameScene } from '../scene';
import { buildTimeline } from '../timeline';
import { recorded, testSetup } from './game';

/**
 * A whole recorded game through the scene at 60 Hz, as the page plays it (with its timeline), measured against the
 * engine's truth. Live play is a frame whose two ticks are both `live` (the earlier tick drawn for the whole of a tick
 * the engine cuts in).
 *
 * The puck: in live play a loose puck (nobody carries it at either tick) is drawn exactly at the engine's (x, height,
 * z, blended between the ticks), except while a goalie stops it (the ruled fifth exception): from the moment it reaches
 * his plane until it rejoins the engine's puck, at most SAVE_AFTER ticks after the save's tick, within SAVE_REACH of
 * the engine's. Every live frame where the two differ is put to the latest save that could own it: `outside` counts
 * frames with no save to own them, `late` those more than SAVE_AFTER ticks after its tick, `early` those before its
 * tick where the engine's puck is still short of his plane along its way in (the saving part's contact plane,
 * CONTACT_PLANE, or the saving hand as drawn when it is out in front of that; with PLANE_SLACK), and `far` is the
 * largest difference in a window.
 *
 * The figures: in live play every skater's drawn facing (engine facing plus any drawn turn) against the engine's, from
 * FACING_AFTER_DROP s after the latest drop; the goalies' drawn turn; and in every frame every figure's drawn place
 * against its engine place.
 */

/** The fifth exception's bounds (the controller's ruling): ticks after the save's tick, and metres from the engine's puck. */
export const SAVE_AFTER = 6, SAVE_REACH = 1.6;
/** How far (m) past the contact plane the engine's puck may still be counted short of it (one 60 Hz frame of a fast shot is ~0.6 m; the plane is reckoned on the shot's path, which the engine's puck follows to millimetres). */
export const PLANE_SLACK = 0.05;
/** How far the glove's pocket (where a caught puck sits) reaches beyond the middle of the hand (goalie-rig.ts gPocket: 0.08 out, 0.14 up). */
export const POCKET_REACH = 0.16;
export const FACING_AFTER_DROP = 0.45;

export type Truth = {
  frames: number; liveFrames: number;
  puck: { off: number; outside: number; outsideAt: string; late: number; lateAt: string; early: number; earlyAt: string; far: number; farAt: string; firstRel: number; lastRel: number; saves: number };
  facing: { worst: number; worstAt: string; goalieTurn: number };
  place: { worst: number; worstAt: string };
};

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function truthOfGame(seed: number): Truth {
  const setup = testSetup(seed), rec = recorded(seed), tl = buildTimeline(rec.events), pb = createCursor(setup, rec);
  const sc = createGameScene(setup, { timeline: tl });
  const goalieIds = new Set([setup.home.lines.goalie, setup.away.lines.goalie]);
  const skaterIds = [...setup.home.players, ...setup.away.players].map((p) => p.id).filter((id) => !goalieIds.has(id));
  const faceoffs = rec.events.filter((e) => e.type === 'faceoff').map((e) => e.tick);
  const t: Truth = {
    frames: 0, liveFrames: 0,
    puck: { off: 0, outside: 0, outsideAt: '', late: 0, lateAt: '', early: 0, earlyAt: '', far: 0, farAt: '', firstRel: Infinity, lastRel: -Infinity, saves: 0 },
    facing: { worst: 0, worstAt: '', goalieTurn: 0 },
    place: { worst: 0, worstAt: '' },
  };
  const savesSeen = new Set<number>();
  pb.seek(0); sc.reset(); sc.update(pb.frame(), 0);
  let fi = 0, lastDrop = -1e9;
  const hz = 60;
  for (let i = 1; i * (30 / hz) <= rec.totalTicks; i++) {
    pb.advance(1 / hz);
    const f = pb.frame();
    sc.update(f, 1 / hz);
    t.frames++;
    while (fi < faceoffs.length && faceoffs[fi]! <= f.tick + 1) lastDrop = faceoffs[fi++]!;
    const cut = isCut(probeOf(f.prev), f.next), prev = f.prev, next = cut ? prev : f.next, k = cut ? 0 : f.alpha, a = f.alpha;
    const now = f.tick + a;
    const live = prev.phase === 'live' && next.phase === 'live';
    if (live) t.liveFrames++;
    // The puck.
    if (live && prev.carrierId === null && next.carrierId === null) {
      const p = sc.puckWorld();
      const ex = prev.puck.pos.x + (next.puck.pos.x - prev.puck.pos.x) * k, ez = prev.puck.pos.y + (next.puck.pos.y - prev.puck.pos.y) * k;
      const ey = Math.max(0, prev.puck.z + (next.puck.z - prev.puck.z) * k);
      const d = Math.hypot(p.x - ex, p.y - ey, p.z - ez);
      if (d > 1e-9) {
        t.puck.off++;
        const at = `${seed}@${now.toFixed(2)}`;
        const sv = tl.last('save', Math.floor(now) + 3, 3 + SAVE_AFTER + 1) as GameEventOf<'save'> | undefined;
        if (!sv) { t.puck.outside++; t.puck.outsideAt ||= `${at}: ${d.toFixed(3)} m`; }
        else {
          savesSeen.add(sv.tick);
          const rel = now - sv.tick;
          t.puck.firstRel = Math.min(t.puck.firstRel, rel); t.puck.lastRel = Math.max(t.puck.lastRel, rel);
          if (rel > SAVE_AFTER) { t.puck.late++; t.puck.lateAt ||= `${at} save ${sv.tick}: ${d.toFixed(3)} m`; }
          if (d > t.puck.far) { t.puck.far = d; t.puck.farAt = `${at} save ${sv.tick} (${sv.detail.pose})`; }
          if (rel < 0) {
            // Before the save's tick: the engine's puck has reached his contact plane along its way in (its flight from
            // the earlier tick, at that tick's velocity: blended toward the save's tick it would run back to where the
            // engine puts the rebound).
            const side = prev.goalies.home.id === sv.playerId ? 'home' : 'away';
            const gp = prev.goalies[side], gn = next.goalies[side];
            const gx = gp.pos.x + (gn.pos.x - gp.pos.x) * k, gz = gp.pos.y + (gn.pos.y - gp.pos.y) * k;
            const v = prev.puck.vel, sp = Math.hypot(v.x, v.y) || 1;
            const fx = prev.puck.pos.x + v.x * a * DT, fz = prev.puck.pos.y + v.y * a * DT;
            const ahead = (x: number, z: number): number => -((x - gx) * v.x + (z - gz) * v.y) / sp;
            // His plane: the contact plane of the save's part, or the face of the saving hand as drawn (HAND_FACE in front
            // of its middle) if it is out in front of that (the glove's pocket is up to POCKET_REACH beyond the hand).
            let plane = CONTACT_PLANE[sv.detail.pose];
            const gv = sc.figure(sv.playerId!);
            if (gv?.goaliePose && (sv.detail.pose === 'glove' || sv.detail.pose === 'blocker')) {
              const h = sv.detail.pose === 'glove' ? gv.goaliePose.glove : gv.goaliePose.blocker, c = Math.cos(gv.facing), n = Math.sin(gv.facing);
              plane = Math.max(plane, ahead(gv.position.x + h.x * c - h.z * n, gv.position.z + h.x * n + h.z * c) + HAND_FACE + (sv.detail.pose === 'glove' ? POCKET_REACH : 0));
            }
            const was = ahead(fx, fz);
            if (was > plane + PLANE_SLACK) { t.puck.early++; t.puck.earlyAt ||= `${at} save ${sv.tick}: ${(was - plane).toFixed(3)} m short of the plane`; }
          }
        }
      }
    }
    // The figures.
    for (const id of skaterIds) {
      const v = sc.figure(id);
      if (!v || !v.onIce) continue;
      const sp = prev.skaters.find((s) => s.id === id)!, sn0 = next.skaters.find((s) => s.id === id)!;
      if (!sp.onIce || !sn0.onIce) continue; // (a man leaving is drawn on along his velocity for his last tick)
      const ex = sp.pos.x + (sn0.pos.x - sp.pos.x) * a, ez = sp.pos.y + (sn0.pos.y - sp.pos.y) * a;
      const off = Math.hypot(v.position.x - ex, v.position.z - ez);
      if (off > t.place.worst) { t.place.worst = off; t.place.worstAt = `${seed}@${now.toFixed(2)} ${id}`; }
      if (live && (now - lastDrop) * DT >= FACING_AFTER_DROP) {
        const df = Math.abs(wrap(v.facing - lerpAngle(sp.facing, sn0.facing, a)));
        if (df > t.facing.worst) { t.facing.worst = df; t.facing.worstAt = `${seed}@${now.toFixed(2)} ${id}`; }
      }
    }
    for (const side of ['home', 'away'] as const) {
      const gp = prev.goalies[side], gn = next.goalies[side], v = sc.figure(gp.id);
      if (!v) continue;
      const off = Math.hypot(v.position.x - (gp.pos.x + (gn.pos.x - gp.pos.x) * a), v.position.z - (gp.pos.y + (gn.pos.y - gp.pos.y) * a));
      if (off > t.place.worst) { t.place.worst = off; t.place.worstAt = `${seed}@${now.toFixed(2)} ${gp.id}`; }
      if (live) t.facing.goalieTurn = Math.max(t.facing.goalieTurn, Math.abs(v.goaliePose?.turn ?? 0));
    }
  }
  t.puck.saves = savesSeen.size;
  sc.dispose();
  return t;
}
