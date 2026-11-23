import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DT, RINK, type GameEventOf } from '@hockey/engine';
import { cameraTarget } from './cameras';
import { carryPoint } from './carry';
import { isCut, probeOf } from './cuts';
import { battleHighlight, cameAwayWith, HIGHLIGHT_SECONDS, MARKER_PX, markerRadius, SCRUM_REACH } from './puck-marker';
import { createCursor } from './playback';
import { createGameScene, seekScene } from './scene';
import { recorded, sharedPlayback, testSetup } from './test/game';
import { buildTimeline } from './timeline';

/**
 * The puck marker, the puck held in a glove and the puck in the net after a goal (Task 6; split from scene-puck.test.ts
 * so the two run side by side). The marker over a whole period is in puck-marker.picture.test.ts (npm run test:picture).
 */
describe('the puck marker and the held puck', () => {
  it('in the scene: a thin ring on the ice under the puck that bodies cover; On shows it, Off never; the man who comes away with the puck from a battle has it under his blade, highlighted', () => {
    const { setup, pb: cursor } = sharedPlayback(5);
    const sc = createGameScene(setup, { events: cursor.events });
    const tl = buildTimeline(cursor.events);
    let strangers = 0;
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
      // Half a second after the end: the carrier, if he was in the battle (the final review's I2), has the ring under his
      // blade; anyone else none.
      seekScene(cursor, sc, e.tick + 15);
      const carrier = cursor.frame().next.carrierId;
      sc.updateMarker(cam, 'auto', 0, true);
      if (!carrier) { expect(sc.marker().highlight, `battle ${e.detail.contestId} at ${e.tick}: nobody has it`).toBe(0); continue; }
      const st = cursor.frame().next;
      if (!cameAwayWith(tl, e, carrier, st, { x: st.puck.pos.x, z: st.puck.pos.y })) { expect(sc.marker().highlight, `battle ${e.detail.contestId}: ${carrier} was not in it`).toBe(0); strangers++; continue; }
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
    expect(strangers).toBeLessThan(highlighted);
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

  it('the highlight never lights under a man who was in no battle: a net-front battle ends while a defenceman carries it at the point, and none does', () => {
    const rec = recorded(5), setup = testSetup(5), pb = createCursor(setup, rec), tl = buildTimeline(rec.events);
    const pos = new Map([...setup.home.players, ...setup.away.players].map((d) => [d.id, d.position]));
    const sc = createGameScene(setup, { timeline: tl });
    let found = 0;
    for (const e of rec.events) {
      if (found >= 3) break;
      if (e.type !== 'contestEnd' || e.detail.kind !== 'netFront') continue;
      // A moment in the highlight's second when a defenceman who was not in it has the puck at the point (well away
      // from the net), and was in no other battle that ended in the last second (he may have come away from that one).
      let t = -1;
      for (let k = e.tick + 1; k < e.tick + 27 && t < 0; k += 2) {
        pb.seek(k);
        const st = pb.frame().next, c = st.carrierId;
        if (!c || !['LD', 'RD'].includes(pos.get(c)!) || tl.contest(e.detail.contestId)!.start.detail.participants.includes(c)) continue;
        if (Math.hypot(st.puck.pos.x - e.pos.x, st.puck.pos.y - e.pos.y) < SCRUM_REACH + 3) continue;
        if (rec.events.some((x) => { const end = x.type === 'contestStart' && x.detail.participants.includes(c) ? tl.contest(x.detail.contestId)?.end?.tick : undefined; return end !== undefined && end > k - 31 && end <= k; })) continue;
        t = k;
      }
      if (t < 0) continue;
      pb.seek(t);
      const st = pb.frame().next, c = st.carrierId!;
      expect(battleHighlight(tl, t, c, st, { x: st.puck.pos.x, z: st.puck.pos.y }), `net-front ${e.detail.contestId} at ${e.tick}`).toBe(0);
      seekScene(pb, sc, t);
      sc.updateMarker({ x: 0, y: 20, z: 30 }, 'auto', 0, true);
      expect(sc.marker().highlight).toBe(0);
      found++;
    }
    expect(found).toBeGreaterThan(0);
    sc.dispose();
  });

  it('over a period it lights only under a man who was in the battle (its participants and supporters as the engine has them, or the man it gave the puck to), a net-front one only by its spot', () => {
    const rec = recorded(5), pb = createCursor(testSetup(5), rec), tl = buildTimeline(rec.events);
    const end = rec.events.find((e) => e.type === 'periodEnd')!.tick;
    // Everyone the engine ever has in each board or net-front battle (its participants, supporters joining later).
    const inIt = new Map<number, Set<string>>();
    const counts = { lit: 0, ends: 0, litEnds: new Set<number>(), byWinner: 0, byOther: 0, boardEnds: 0, netEnds: 0, litBoard: new Set<number>(), litNet: new Set<number>() };
    for (let t = 1; t <= end; t++) {
      pb.seek(t);
      const st = pb.frame().prev;
      for (const c of st.contests) {
        if (c.kind !== 'boardBattle' && c.kind !== 'netFront') continue;
        const set = inIt.get(c.id) ?? new Set<string>();
        for (const id of c.participants) set.add(id);
        inIt.set(c.id, set);
      }
      if (st.carrierId === null) continue;
      const h = battleHighlight(tl, t, st.carrierId, st, { x: st.puck.pos.x, z: st.puck.pos.y });
      if (h === 0) continue;
      counts.lit++;
      // Which battle: the latest board or net-front battle he was in that ended within the highlight's second.
      let e = tl.last('contestEnd', t, Math.ceil(HIGHLIGHT_SECONDS / DT) + 1);
      while (e && !((e.detail.kind === 'boardBattle' || e.detail.kind === 'netFront') && (inIt.get(e.detail.contestId)?.has(st.carrierId) || (e.detail.puck === 'toWinner' && e.detail.winnerId === st.carrierId)))) {
        e = tl.last('contestEnd', e.tick - 1, e.tick - 1 - (t - Math.ceil(HIGHLIGHT_SECONDS / DT) - 1));
      }
      expect(e, `${t}: lit under ${st.carrierId}, who was in no battle that ended in the last second`).toBeDefined();
      if (e!.detail.kind === 'netFront') { expect(Math.hypot(st.puck.pos.x - e!.pos.x, st.puck.pos.y - e!.pos.y)).toBeLessThanOrEqual(SCRUM_REACH); counts.litNet.add(e!.detail.contestId); }
      else counts.litBoard.add(e!.detail.contestId);
      if (e!.detail.winnerId === st.carrierId) counts.byWinner++; else counts.byOther++;
    }
    for (const e of rec.events) if (e.type === 'contestEnd' && e.tick <= end) { if (e.detail.kind === 'boardBattle') counts.boardEnds++; if (e.detail.kind === 'netFront') counts.netEnds++; }
    console.log(JSON.stringify({ litFrames: counts.lit, boardEnds: counts.boardEnds, litBoard: counts.litBoard.size, netEnds: counts.netEnds, litNet: counts.litNet.size, underWinner: counts.byWinner, underOther: counts.byOther }));
    expect(counts.litBoard.size).toBeGreaterThan(5);
  });
});

