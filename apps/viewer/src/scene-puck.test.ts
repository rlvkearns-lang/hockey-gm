import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, type GameEvent, type GameEventOf, type GameSetup } from '@hockey/engine';
import { cameraTarget } from './cameras';
import { carryPoint } from './carry';
import { createCursor, type Playback } from './playback';
import { initialMarker, inOpenIce, puckHidden, stepMarker, type MarkerBody, type MarkerMode, type MarkerState } from './puck-marker';
import { recorded, testSetup } from './test/game';
import { createGameScene, seekScene } from './scene';
import { isCut, probeOf } from './cuts';
import { sharedPlayback } from './test/game';
import { buildTimeline } from './timeline';

/** The drawn puck while play runs (moved here from scene.test.ts so the two files run side by side). */
describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

  /**
   * Play `seconds` from tick 1200 at `hz` and return the per-frame movement of the drawn puck beyond what the engine's
   * puck has done lately (shots fly; a puck picked up at speed is eased onto the blade at about the speed it had),
   * split into frames where a carry ends (the release slide) and the rest, sorted; and whether every frame with no
   * carrier at either tick drew exactly the engine's puck.
   */
  function puckMovement(hz: number, seconds: number, events?: readonly GameEvent[]): { release: number[]; other: number[]; exact: boolean } {
    const sc = createGameScene(game, events ? { events } : {});
    pb.seek(1200); sc.reset(); sc.update(pb.frame(), 0);
    const last = sc.puckWorld();
    const release: number[] = [], other: number[] = [], speeds: number[] = [];
    let exact = true;
    for (let i = 0; i < hz * seconds; i++) {
      pb.advance(1 / hz); sc.update(pb.frame(), 1 / hz);
      const f = pb.frame(), p = sc.puckWorld();
      speeds.push(Math.hypot(f.next.puck.vel.x, f.next.puck.vel.y), Math.hypot(f.prev.puck.vel.x, f.prev.puck.vel.y));
      if (speeds.length > Math.ceil(hz / 2) * 2) speeds.splice(0, 2);
      const excess = Math.hypot(p.x - last.x, p.z - last.z) - Math.max(...speeds) / hz;
      if (f.next.phase === 'live' && f.prev.phase === 'live') (f.prev.carrierId !== null && f.next.carrierId === null ? release : other).push(excess);
      if (f.prev.carrierId === null && f.next.carrierId === null) {
        // Across a tick the engine cuts in (the puck put on the dot) the engine's puck is its earlier place all tick.
        const k = isCut(probeOf(f.prev), f.next) ? 0 : f.alpha;
        const ex = f.prev.puck.pos.x + (f.next.puck.pos.x - f.prev.puck.pos.x) * k;
        const ez = f.prev.puck.pos.y + (f.next.puck.pos.y - f.prev.puck.pos.y) * k;
        if (Math.abs(p.x - ex) > 1e-9 || Math.abs(p.z - ez) > 1e-9) exact = false;
      }
      last.copy(p);
    }
    sc.dispose();
    const sort = (v: number[]): number[] => v.sort((x, y) => x - y);
    return { release: sort(release), other: sort(other), exact };
  }
  const pct = (v: number[], q: number): number => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;

  it('the drawn puck does not jump while the play runs (carried, released, picked up or won off another skater), at 30, 60 and 144 Hz', () => {
    // A release reaches the engine's puck by the end of its tick, sliding from the previous frame's spot at an even
    // speed: the gap from the blade to where the engine lets the puck go, shared by the frames of one tick.
    for (const [hz, worstRelease, worstOther, p999] of [[30, 0.35, 0.7, 0.6], [60, 0.25, 0.35, 0.27], [144, 0.2, 0.18, 0.15]] as const) {
      const r = puckMovement(hz, 120);
      const all = [...r.release, ...r.other].sort((x, y) => x - y);
      expect(r.exact).toBe(true);
      expect(r.release.length).toBeGreaterThan(20);
      expect(r.release[r.release.length - 1]!, `${hz} Hz release`).toBeLessThan(worstRelease);
      expect(r.other[r.other.length - 1]!, `${hz} Hz other`).toBeLessThan(worstOther);
      expect(pct(all, 0.999), `${hz} Hz 99.9th percentile`).toBeLessThan(p999);
    }
  });

  it('a release seen while paused (dt = 0) holds the puck where it was, then slides once play resumes', () => {
    const sc = createGameScene(game);
    // Find a release: a tick where the carrier is gone at the next tick.
    pb.seek(1200);
    let t = 1200;
    for (; t < 20000; t++) { pb.seek(t); const f = pb.frame(); if (f.prev.carrierId !== null && f.next.carrierId === null) break; }
    pb.seek(t - 10); sc.reset(); sc.update(pb.frame(), 0);
    for (let i = 0; i < 20; i++) { pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60); }
    const f = pb.frame();
    expect(f.prev.carrierId !== null && f.next.carrierId === null).toBe(true);
    const before = sc.puckWorld();
    sc.update(pb.frame(), 0); sc.update(pb.frame(), 0);
    expect(sc.puckWorld().distanceTo(before)).toBeLessThan(1e-9);
    pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
    // Next tick (no carrier at either tick): exactly the engine's puck.
    const g = pb.frame();
    if (g.prev.carrierId === null && g.next.carrierId === null) {
      const p = sc.puckWorld();
      expect(p.x).toBeCloseTo(g.prev.puck.pos.x + (g.next.puck.pos.x - g.prev.puck.pos.x) * g.alpha, 9);
    }
    sc.dispose();
  });

  // Task 2: the stick actions.
  it('with the stick actions on, the drawn puck still does not jump, at 30, 60 and 144 Hz', () => {
    for (const [hz, worstRelease, worstOther, p999] of [[30, 0.35, 0.7, 0.6], [60, 0.25, 0.35, 0.27], [144, 0.2, 0.18, 0.15]] as const) {
      const r = puckMovement(hz, 120, pb.events);
      const all = [...r.release, ...r.other].sort((x, y) => x - y);
      expect(r.exact).toBe(true);
      expect(r.release.length).toBeGreaterThan(20);
      expect(r.release[r.release.length - 1]!, `${hz} Hz release`).toBeLessThan(worstRelease);
      expect(r.other[r.other.length - 1]!, `${hz} Hz other`).toBeLessThan(worstOther);
      expect(pct(all, 0.999), `${hz} Hz 99.9th percentile`).toBeLessThan(p999);
    }
  });

  it('the released puck starts from the blade: at the moment the engine lets it go (display time T - 1, the tick before the release event\'s tick T) the drawn puck is within 0.25 m of the releaser blade', () => {
    // Measured one tick before the event's tick, on purpose: the engine lets the puck go during the step that ends on
    // the release event's tick T (in state T it is already a tick of flight from his stick, and from then the drawn puck
    // must be exactly the engine's), so the moment it leaves the stick is display time T - 1, the last moment he has
    // it. There the drawn puck is where it sits on his blade (carry.ts carryPoint), played into at 60 Hz with the log.
    for (const seed of [5, 42]) {
      const { setup, pb: cursor } = sharedPlayback(seed);
      const sc = createGameScene(setup, { timeline: buildTimeline(cursor.events) });
      const right = new Map([...setup.home.players, ...setup.away.players].map((d) => [d.id, d.shoots === 'R']));
      const rels = cursor.events.filter((e): e is GameEventOf<'release'> => e.type === 'release').slice(0, 60);
      let checked = 0, worst = 0, touches = 0;
      for (const rel of rels) {
        // A one-touch redirect: the engine handed him the puck in the tick before he let it go, up to two metres short
        // of his stick (it takes a pass that comes within reach during a tick), so it cannot be on his blade yet; the
        // puck is chased onto the blade (carry.ts CHASE_GAIN) and the stick goes to meet it (overlays/stick.ts).
        cursor.seek(rel.tick - 2);
        if (cursor.frame().prev.carrierId !== rel.playerId) { touches++; continue; }
        const start = rel.tick - 1 - 30;
        seekScene(cursor, sc, start);
        for (let i = 1; i <= 60; i++) { cursor.seek(start + i * 0.5); sc.update(cursor.frame(), 1 / 60); }
        const f = cursor.frame();
        expect(f.tick).toBe(rel.tick - 1); expect(f.alpha).toBe(0);
        // Picked off in the very tick it was let go (the puck goes straight to the man who took it), or across a cut.
        if (f.prev.carrierId !== rel.playerId || f.next.carrierId !== null || sc.cutNow()) continue;
        const fig = sc.figure(rel.playerId!)!, cp = carryPoint(fig.pose!), bz = right.get(rel.playerId!) ? -cp.z : cp.z;
        const c = Math.cos(fig.facing), n = Math.sin(fig.facing);
        const bx = fig.position.x + cp.x * c - bz * n, bzw = fig.position.z + cp.x * n + bz * c;
        const p = sc.puckWorld(), d = Math.hypot(p.x - bx, p.z - bzw);
        worst = Math.max(worst, d);
        expect(d, `seed ${seed} release at ${rel.tick}`).toBeLessThan(0.25);
        checked++;
      }
      sc.dispose();
      expect(checked).toBeGreaterThan(50);
      expect(touches).toBeLessThan(5);
      expect(worst).toBeLessThan(0.25);
    }
  });
});

describe('the puck marker and the held puck', () => {
  it('over a period from the broadcast camera: never shown where the puck is plainly visible in open ice, shown on 80% of board-battle dig frames, never with Off', () => {
    const rec = recorded(5), pb = createCursor(testSetup(5), rec);
    const end = rec.events.find((e) => e.type === 'periodEnd')!.tick;
    const runs: Record<MarkerMode, MarkerState> = { on: initialMarker(), auto: initialMarker(), off: initialMarker() };
    let open = 0, openShown = 0, dig = 0, digShown = 0, offShown = 0, shown = 0;
    const skaters: MarkerBody[] = [], bodies: MarkerBody[] = [];
    for (let t = 1; t <= end; t++) {
      pb.seek(t);
      const st = pb.frame().prev;
      const puck = { x: st.puck.pos.x, y: st.puck.z, z: st.puck.pos.y };
      const cam = cameraTarget('broadcast', { puck, attackingRight: st.attackDir.home === 1 }).pos;
      skaters.length = 0; bodies.length = 0;
      for (const s of st.skaters) skaters.push({ x: s.pos.x, z: s.pos.y, r: 0.28, h: 1.75, on: s.onIce });
      bodies.push(...skaters);
      for (const g of [st.goalies.home, st.goalies.away]) bodies.push({ x: g.pos.x, z: g.pos.y, r: 0.45, h: 1.5, on: true });
      for (const mode of ['auto', 'off'] as const) runs[mode] = stepMarker(runs[mode], { mode, cam, puck, skaters, bodies, contests: st.contests }, DT);
      const k = runs.auto.k;
      if (k > 0) shown++;
      if (runs.off.k > 0) offShown++;
      if (inOpenIce(puck, skaters) && !puckHidden(cam, puck, bodies)) { open++; if (k > 0) openShown++; }
      if (st.contests.some((c) => c.kind === 'boardBattle' && c.stage === 'dig')) { dig++; if (k > 0) digShown++; }
    }
    expect(open).toBeGreaterThan(3000);
    expect(openShown).toBe(0);
    expect(dig).toBeGreaterThan(300);
    expect(digShown / dig).toBeGreaterThanOrEqual(0.8);
    expect(offShown).toBe(0);
    // It is not on all the time either.
    expect(shown / end).toBeLessThan(0.5);
  });

  it('in the scene: a thin ring on the ice under the puck that bodies cover; On shows it, Off never; the man who comes away with the puck from a battle has it under his blade, highlighted', () => {
    const { setup, pb: cursor } = sharedPlayback(5);
    const sc = createGameScene(setup, { events: cursor.events });
    const ring = sc.root.getObjectByName('puckMarker') as THREE.Mesh;
    const mat = ring.material as THREE.MeshBasicMaterial;
    expect(mat.depthTest).toBe(true); expect(mat.depthWrite).toBe(false); expect(mat.transparent).toBe(true);
    // A battle won with the puck (the engine's carrier just after its end).
    const ends = cursor.events.filter((e): e is GameEventOf<'contestEnd'> => e.type === 'contestEnd' && e.detail.kind === 'boardBattle');
    let highlighted = 0, inBattle = 0;
    for (const e of ends.slice(0, 40)) {
      const start = cursor.events.find((x) => x.type === 'contestStart' && x.detail.contestId === e.detail.contestId)!;
      if (e.tick - start.tick < 30) continue;
      // In the battle, seen from the broadcast camera: shown (Auto), and On and Off as set.
      seekScene(cursor, sc, Math.round((start.tick + e.tick) / 2));
      const p = sc.puckWorld(), cam = cameraTarget('broadcast', { puck: { x: p.x, y: p.y, z: p.z }, attackingRight: cursor.frame().prev.attackDir.home === 1 }).pos;
      for (let i = 0; i < 12; i++) sc.updateMarker(cam, 'auto', 1 / 30);
      if (sc.marker().scrum) { expect(ring.visible).toBe(true); expect(mat.opacity).toBeGreaterThan(0.5); inBattle++; }
      expect(ring.position.y).toBeLessThan(0.02); expect(Math.hypot(ring.position.x - p.x, ring.position.z - p.z)).toBeLessThan(1e-9);
      sc.updateMarker(cam, 'off', 1 / 30);
      expect(ring.visible).toBe(false);
      sc.updateMarker(cam, 'on', 1 / 30);
      expect(ring.visible).toBe(true);
      // Half a second after the end: the carrier (if the engine gave someone the puck) has the ring under his blade.
      seekScene(cursor, sc, e.tick + 15);
      const carrier = cursor.frame().next.carrierId;
      sc.updateMarker(cam, 'auto', 0, true);
      if (!carrier) { expect(sc.marker().highlight, `battle ${e.detail.contestId} at ${e.tick}: nobody has it`).toBe(0); continue; }
      expect(sc.marker().highlight).toBe(1);
      expect(ring.visible).toBe(true);
      const fig = sc.figure(carrier)!, cp = carryPoint(fig.pose!), right = [...setup.home.players, ...setup.away.players].find((d) => d.id === carrier)!.shoots === 'R';
      const bz = right ? -cp.z : cp.z, c = Math.cos(fig.facing), n = Math.sin(fig.facing);
      const bx = fig.position.x + cp.x * c - bz * n, bzw = fig.position.z + cp.x * n + bz * c;
      expect(Math.hypot(ring.position.x - bx, ring.position.z - bzw), `battle ${e.detail.contestId}`).toBeLessThan(0.3);
      // Gone after a second and a half (unless the puck is hidden or in another scrum then).
      const later = cursor.events.some((x) => x.type === 'contestEnd' && x.tick > e.tick && x.tick <= e.tick + 45);
      seekScene(cursor, sc, e.tick + 45);
      sc.updateMarker(cam, 'auto', 0, true);
      if (!later) expect(sc.marker().highlight, `battle ${e.detail.contestId} at ${e.tick}`).toBe(0);
      highlighted++;
    }
    expect(inBattle).toBeGreaterThan(5);
    expect(highlighted).toBeGreaterThan(3);
    sc.dispose();
  });

  it('a puck held in the glove after a frozen glove save faces up the ice (within 60 degrees), at the pocket; flat on the ice under the glove when covered', () => {
    let checked = 0;
    for (const seed of [5, 42]) {
      const { setup, pb: cursor } = sharedPlayback(seed);
      const sc = createGameScene(setup, { events: cursor.events });
      const disc = sc.root.getObjectByName('puckDisc')!;
      const frozen = cursor.events.filter((e) => e.type === 'save' && e.detail.pose === 'glove'
        && cursor.events.some((f) => f.type === 'freeze' && f.tick === e.tick && f.playerId === e.playerId));
      for (const s of frozen.slice(0, 6)) {
        for (const dt of [10, 30, 43]) {
          seekScene(cursor, sc, s.tick + dt);
          const g = sc.figure(s.playerId!)!, p = sc.puckWorld();
          disc.updateWorldMatrix(true, false);
          const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(disc.getWorldQuaternion(new THREE.Quaternion()));
          const upIce = new THREE.Vector3(g.position.x > 0 ? -1 : 1, 0, 0);
          expect(p.y, `seed ${seed} save ${s.tick}+${dt}: in the glove, off the ice`).toBeGreaterThan(0.3);
          expect(normal.angleTo(upIce) * 180 / Math.PI, `seed ${seed} save ${s.tick}+${dt}`).toBeLessThan(60);
          // Its middle (as drawn, tilted about it) is where the puck is held (the pocket: overlays/goalie.test.ts).
          const mid = new THREE.Vector3(0, 0.0254 * 1.5 / 2, 0).applyMatrix4(disc.matrixWorld);
          expect(mid.distanceTo(new THREE.Vector3(p.x, p.y + 0.0254 * 1.5 / 2, p.z))).toBeLessThan(0.005);
          checked++;
        }
      }
      // A puck frozen by a save with anything but the glove lies flat on the ice under the glove.
      const other = cursor.events.find((e) => e.type === 'save' && e.detail.pose !== 'glove'
        && cursor.events.some((f) => f.type === 'freeze' && f.tick === e.tick && f.playerId === e.playerId))!;
      seekScene(cursor, sc, other.tick + 30);
      expect(sc.puckWorld().y).toBeLessThan(0.05);
      expect(disc.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
      sc.dispose();
    }
    expect(checked).toBeGreaterThan(20);
  });
});

