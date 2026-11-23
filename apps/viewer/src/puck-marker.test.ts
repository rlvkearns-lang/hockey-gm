import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, RINK, type GameEventOf } from '@hockey/engine';
import { cameraTarget } from './cameras';
import { carryPoint } from './carry';
import { isCut, probeOf } from './cuts';
import { createCursor } from './playback';
import { initialMarker, inOpenIce, MARKER_OUT, MARKER_PX, markerRadius, puckHidden, stepMarker, type MarkerBody, type MarkerMode, type MarkerState } from './puck-marker';
import { createGameScene, seekScene } from './scene';
import { recorded, sharedPlayback, testSetup } from './test/game';

/** The puck marker, the puck held in a glove and the puck in the net after a goal (Task 6; split from scene-puck.test.ts so the two run side by side). */
describe('the puck marker and the held puck', () => {
  it('over a period from the broadcast camera: not shown where the puck is plainly visible in open ice (but for its 0.25 s fade as it comes clear), shown on 80% of board-battle dig frames, never with Off', () => {
    const rec = recorded(5), pb = createCursor(testSetup(5), rec);
    const end = rec.events.find((e) => e.type === 'periodEnd')!.tick;
    const runs: Record<MarkerMode, MarkerState> = { on: initialMarker(), auto: initialMarker(), off: initialMarker() };
    let open = 0, openShown = 0, dig = 0, digShown = 0, offShown = 0, shown = 0, clearSince = -1, fading = 0;
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
      if (inOpenIce(puck, skaters) && !puckHidden(cam, puck, bodies)) {
        if (clearSince < 0) clearSince = t;
        open++;
        // Shown only while it fades out, within MARKER_OUT of the puck coming clear.
        if (k > 0) { if ((t - clearSince) * DT <= MARKER_OUT + 1e-9) fading++; else openShown++; }
      } else clearSince = -1;
      if (st.contests.some((c) => c.kind === 'boardBattle' && c.stage === 'dig')) { dig++; if (k > 0) digShown++; }
    }
    expect(open).toBeGreaterThan(3000);
    expect(openShown).toBe(0);
    expect(fading).toBeLessThan(open * 0.1);
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
    // A frame known to be in open ice, settled (clear for over a second): the ring is hidden.
    let settledOpen = 0;
    for (let t = 3000; t < 9000 && settledOpen < 5; t += 37) {
      // (Only where the engine's puck is in open ice, far from everyone: a cheap look before playing the scene there.)
      cursor.seek(t);
      const e = cursor.frame().prev;
      if (e.phase !== 'live' || e.skaters.some((x) => x.onIce && Math.hypot(x.pos.x - e.puck.pos.x, x.pos.y - e.puck.pos.y) < 4)) continue;
      seekScene(cursor, sc, t);
      const p = sc.puckWorld(), cam = cameraTarget('broadcast', { puck: { x: p.x, y: p.y, z: p.z }, attackingRight: cursor.frame().prev.attackDir.home === 1 }).pos;
      sc.updateMarker(cam, 'auto', 0, true);
      if (!sc.marker().open) continue;
      for (let i = 0; i < 40; i++) { cursor.advance(1 / 30); sc.update(cursor.frame(), 1 / 30); sc.updateMarker(cam, 'auto', 1 / 30); if (!sc.marker().open) break; }
      if (!sc.marker().open) continue;
      expect(ring.visible, `open ice at ${cursor.frame().tick}`).toBe(false);
      settledOpen++;
    }
    expect(settledOpen).toBe(5);
    // The same size in the picture from near and far: MARKER_PX.radius pixels in a 720 px picture at 30 degrees.
    seekScene(cursor, sc, 5000);
    const pk = sc.puckWorld();
    // (From about 25 m out; nearer, it stays at its smallest, MARKER_RADIUS[0].)
    sc.updateMarker({ x: pk.x, y: 8 * 0.6, z: pk.z + 8 * 0.8 }, 'on', 0, true, { fov: 30, heightPx: 720 });
    expect(ring.scale.x).toBeCloseTo(0.22, 9);
    for (const d of [30, 45, 60]) {
      sc.updateMarker({ x: pk.x, y: d * 0.6, z: pk.z + d * 0.8 }, 'on', 0, true, { fov: 30, heightPx: 720 });
      const px = ring.scale.x * 720 / (2 * d * Math.tan(Math.PI / 12));
      expect(Math.abs(px - MARKER_PX.radius), `at ${d} m`).toBeLessThan(0.5);
      expect(ring.scale.x).toBeCloseTo(markerRadius(d, 30, 720), 9);
    }
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

  it('after a goal the puck rests in the net (from 0.5 s after it until the faceoff setup), and a seek there shows it; in live play it is the engine\'s', () => {
    let checked = 0;
    for (const seed of [5, 42]) {
      const { setup, pb: cursor } = sharedPlayback(seed);
      const sc = createGameScene(setup, { events: cursor.events });
      const inNet = (p: THREE.Vector3, end: number): boolean => p.x * end > RINK.goalLineX + 0.05 && p.x * end < RINK.goalLineX + RINK.netDepth && Math.abs(p.z) < RINK.netHalfWidth && p.y < 0.05;
      for (const g of cursor.events.filter((e) => e.type === 'goal')) {
        const end = g.pos.x >= 0 ? 1 : -1;
        seekScene(cursor, sc, g.tick - 6);
        for (let i = 0; i < 30 * 2; i++) {
          cursor.advance(1 / 30); sc.update(cursor.frame(), 1 / 30);
          const f = cursor.frame(), p = sc.puckWorld();
          if (f.prev.phase === 'live' && f.next.phase === 'live' && f.prev.carrierId === null && f.next.carrierId === null) {
            const k = isCut(probeOf(f.prev), f.next) ? 0 : f.alpha;
            expect(Math.abs(p.x - (f.prev.puck.pos.x + (f.next.puck.pos.x - f.prev.puck.pos.x) * k))).toBeLessThan(1e-9);
          }
          if (f.tick + f.alpha >= g.tick + 15 && f.prev.phase === 'stopped' && f.next.phase === 'stopped') {
            expect(inNet(p, end), `seed ${seed} goal ${g.tick} +${(f.tick + f.alpha - g.tick).toFixed(1)}: ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
            checked++;
          }
        }
        seekScene(cursor, sc, g.tick + 30);
        expect(inNet(sc.puckWorld(), end), `seed ${seed} goal ${g.tick}: a seek`).toBe(true);
      }
      sc.dispose();
    }
    expect(checked).toBeGreaterThan(9 * 25);
  });
});

