import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTeam, type GameSetup } from '@hockey/engine';
import { createPlayback, type Playback } from './playback';
import { createGameScene } from './scene';
import { buildArena } from './arena';
import { buildRink } from './rink';

const setup = (seed: number): GameSetup => {
  const home = generateTeam(seed * 2 + 1, 'Harbour City', 'HBR');
  const away = generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK');
  return { home, away, seed, chemistry: [] };
};

describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { game = setup(5); pb = createPlayback(game); });

  it('shows exactly the players who are on the ice, at the engine positions', () => {
    const sc = createGameScene(game); pb.seek(3000); sc.reset(); sc.update(pb.frame(), 0);
    const st = pb.frame().prev;
    for (const s of st.skaters) {
      const f = sc.figure(s.id)!;
      expect(f.onIce).toBe(s.onIce);
      if (s.onIce) { expect(f.position.x).toBeCloseTo(s.pos.x, 3); expect(f.position.z).toBeCloseTo(s.pos.y, 3); }
    }
    expect(st.skaters.filter((s) => s.onIce).length).toBeGreaterThanOrEqual(10);
    // The figures drawn are the ones on the ice: hidden, not removed, when on the bench.
    let shown = 0;
    sc.root.traverse((o) => { if (o.name.startsWith('skater-') && o.visible) shown++; });
    expect(shown).toBe(st.skaters.filter((s) => s.onIce).length);
    for (const side of ['home', 'away'] as const) {
      const g = st.goalies[side], f = sc.figure(g.id)!;
      expect(f.onIce).toBe(true);
      expect(f.position.x).toBeCloseTo(g.pos.x, 3);
      expect(f.position.z).toBeCloseTo(g.pos.y, 3);
    }
    sc.dispose();
  });

  it('when nobody carries the puck the drawn puck is the engine puck; when carried it is within a stick length of the carrier', () => {
    const sc = createGameScene(game); let loose = 0, carried = 0;
    for (let t = 600; t < 9000; t += 37) {
      pb.seek(t); sc.reset();
      for (let i = 0; i < 20; i++) { pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60); }
      const f = pb.frame(), st = f.next, p = sc.puckWorld();
      if (st.carrierId == null && f.prev.carrierId == null) {
        const ex = f.prev.puck.pos.x + (st.puck.pos.x - f.prev.puck.pos.x) * f.alpha;
        const ez = f.prev.puck.pos.y + (st.puck.pos.y - f.prev.puck.pos.y) * f.alpha;
        if (Math.abs(p.x - ex) < 0.02 && Math.abs(p.z - ez) < 0.02) loose++;
        else throw new Error('loose puck drawn away from the engine puck at tick ' + t);
      } else if (st.carrierId != null && f.prev.carrierId === st.carrierId) {
        const c = sc.figure(st.carrierId)!;
        expect(Math.hypot(p.x - c.position.x, p.z - c.position.z)).toBeLessThan(1.6);
        carried++;
      }
    }
    expect(loose).toBeGreaterThan(20); expect(carried).toBeGreaterThan(20);
    sc.dispose();
  });

  /**
   * Play `seconds` from tick 1200 at `hz` and return the per-frame movement of the drawn puck beyond what the engine's
   * puck has done lately (shots fly; a puck picked up at speed is eased onto the blade at about the speed it had),
   * split into frames where a carry ends (the release slide) and the rest, sorted; and whether every frame with no
   * carrier at either tick drew exactly the engine's puck.
   */
  function puckMovement(hz: number, seconds: number): { release: number[]; other: number[]; exact: boolean } {
    const sc = createGameScene(game);
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
        const ex = f.prev.puck.pos.x + (f.next.puck.pos.x - f.prev.puck.pos.x) * f.alpha;
        const ez = f.prev.puck.pos.y + (f.next.puck.pos.y - f.prev.puck.pos.y) * f.alpha;
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
      console.log(hz, 'release worst', r.release[r.release.length - 1]!.toFixed(3), 'other worst', r.other[r.other.length - 1]!.toFixed(3), 'p999', pct(all, 0.999).toFixed(3), 'releases', r.release.length);
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

  it('a skater the engine takes off keeps moving toward the door for his last tick, never skating in place', () => {
    const sc = createGameScene(game); pb.seek(0); sc.reset(); sc.update(pb.frame(), 0);
    let exits = 0;
    for (let i = 0; i < 60 * 300; i++) {
      pb.advance(1 / 60);
      const before = new Map<string, THREE.Vector3>();
      for (const s of pb.frame().prev.skaters) before.set(s.id, sc.figure(s.id)!.position.clone());
      sc.update(pb.frame(), 1 / 60);
      const f = pb.frame();
      for (let k = 0; k < f.prev.skaters.length; k++) {
        const p = f.prev.skaters[k]!, n = f.next.skaters.find((x) => x.id === p.id)!;
        if (!p.onIce || n.onIce || f.alpha === 0) continue;
        const speed = Math.hypot(p.vel.x, p.vel.y);
        if (speed < 0.5) continue;
        const moved = sc.figure(p.id)!.position.distanceTo(before.get(p.id)!);
        expect(moved).toBeGreaterThan(speed / 60 * 0.5);
        exits++;
      }
    }
    expect(exits).toBeGreaterThan(3);
    sc.dispose();
  });

  it('a seek snaps: after reset and one update nothing is still blending from the old place', () => {
    const sc = createGameScene(game); pb.seek(2000); sc.reset(); sc.update(pb.frame(), 0);
    pb.seek(60000); sc.reset(); sc.update(pb.frame(), 0);
    const st = pb.frame().prev;
    for (const s of st.skaters) if (s.onIce) expect(sc.figure(s.id)!.position.x).toBeCloseTo(s.pos.x, 3);
    if (st.carrierId != null) {
      // Carried at the cut: on his blade at once, not easing in from the engine's spot.
      const c = sc.figure(st.carrierId)!, p = sc.puckWorld();
      expect(Math.hypot(p.x - c.position.x, p.z - c.position.z)).toBeLessThan(1.6);
    }
    sc.dispose();
  });

  it('the update path does not grow the scene', () => {
    const sc = createGameScene(game); pb.seek(1000); sc.reset();
    let n0 = 0; sc.root.traverse(() => n0++);
    for (let i = 0; i < 600; i++) { pb.advance(1 / 30); sc.update(pb.frame(), 1 / 30); }
    let n1 = 0; sc.root.traverse(() => n1++);
    expect(n1).toBe(n0);
    sc.dispose();
  });

  it('a skater stepping on gets a fresh gait, and one who left is hidden', () => {
    const sc = createGameScene(game); pb.seek(0); sc.reset(); sc.update(pb.frame(), 0);
    let ons = 0;
    const was = new Map<string, boolean>();
    for (let i = 0; i < 30 * 200; i++) {
      pb.advance(1 / 30); sc.update(pb.frame(), 1 / 30);
      const st = pb.frame().prev;
      for (const s of st.skaters) {
        const f = sc.figure(s.id)!;
        expect(f.onIce).toBe(s.onIce);
        if (s.onIce && was.get(s.id) === false) {
          ons++;
          // Drawn where the engine puts him (at the bench door), not where he was last seen.
          expect(Math.hypot(f.position.x - s.pos.x, f.position.z - s.pos.y)).toBeLessThan(0.5);
        }
        was.set(s.id, s.onIce);
      }
    }
    expect(ons).toBeGreaterThan(5);
    sc.dispose();
  });

  it('figures face the engine facing; goalies stay at their nets', () => {
    const sc = createGameScene(game); pb.seek(4500); sc.reset(); sc.update(pb.frame(), 0);
    const st = pb.frame().prev;
    for (const s of st.skaters) if (s.onIce) {
      const d = Math.atan2(Math.sin(sc.figure(s.id)!.facing - s.facing), Math.cos(sc.figure(s.id)!.facing - s.facing));
      expect(Math.abs(d)).toBeLessThan(1e-6);
    }
    for (const side of ['home', 'away'] as const) expect(Math.abs(sc.figure(st.goalies[side].id)!.position.x)).toBeGreaterThan(20);
    sc.dispose();
  });

  it('dispose leaves textures shared with the other figures alone until the last one goes', () => {
    const a = createGameScene(game), b = createGameScene(game);
    a.dispose();
    pb.seek(3000); b.reset(); expect(() => b.update(pb.frame(), 1 / 60)).not.toThrow();
    b.dispose();
  });
  it('the page can set how large the puck is drawn; its shadow scales with it', () => {
    const sc = createGameScene(game);
    const disc = sc.root.getObjectByName('puckDisc')!;
    const before = disc.scale.x;
    sc.setPuckScale(3);
    expect(disc.scale.x).toBeCloseTo(before * 2, 6); // 3x a real puck is twice the default 1.5x
    sc.setPuckScale(1);
    expect(disc.scale.x).toBeCloseTo(before / 1.5, 6);
    sc.dispose();
  });
});

describe('arena', () => {
  it('builds stands, one crowd mesh and lights, fewer blocks on low', () => {
    const blocks = (g: THREE.Object3D): number => (g.getObjectByName('crowd')!.userData.blocks as number);
    const hi = buildArena('high'), lo = buildArena('low');
    let crowds = 0, lights = 0;
    hi.traverse((o) => { if (o.name === 'crowd') crowds++; if (o instanceof THREE.Light) lights++; });
    expect(crowds).toBe(1);
    expect(lights).toBeGreaterThan(0);
    expect(blocks(lo)).toBeLessThan(blocks(hi));
    expect(blocks(lo)).toBeGreaterThan(500);
  });

  it('keeps the side opposite the benches low, so a high camera there sees the whole ice', () => {
    const g = buildArena('high');
    g.updateMatrixWorld(true);
    // A camera high on the +z side (the benches are at engine y < 0, world z < 0), looking at the near boards.
    const cam = new THREE.Vector3(0, 16, 34);
    const ray = new THREE.Raycaster();
    const blockers: THREE.Object3D[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh && o.name !== 'glass' && o.name !== 'ceiling') blockers.push(o); });
    for (const x of [-25, -12, 0, 12, 25]) {
      const target = new THREE.Vector3(x, 0.1, 12);
      const dir = target.clone().sub(cam);
      const dist = dir.length();
      ray.set(cam, dir.normalize());
      ray.far = dist - 0.5;
      const hits = ray.intersectObjects(blockers, false);
      expect(hits.map((h) => h.object.name)).toEqual([]);
    }
  });
  it('is closed in: from every camera place, every direction meets the building (no view out into nothing)', () => {
    const g = new THREE.Group();
    const rink = buildRink();
    rink.getObjectByName('floor')!.visible = false; // as the scene: the arena lays its own floor
    g.add(buildArena('low'), rink);
    g.updateMatrixWorld(true);
    const solid: THREE.Object3D[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && o.name !== 'glass') solid.push(o); });
    const ray = new THREE.Raycaster();
    const places = [new THREE.Vector3(0, 15.5, 29), new THREE.Vector3(18, 15.5, 29), new THREE.Vector3(-30.2, 6, 0), new THREE.Vector3(30.2, 6, -2),
      new THREE.Vector3(6.5, 1.8, 10.75), new THREE.Vector3(-19, 1.8, 10.75), new THREE.Vector3(10, 28, 0.6), new THREE.Vector3(5, 3, -9)];
    let misses = 0;
    for (const from of places) for (let i = 0; i < 24; i++) for (let j = 0; j < 12; j++) {
      const yaw = (i / 24) * 2 * Math.PI, pitch = -1.2 + (j / 11) * 2.4;
      ray.set(from, new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)));
      ray.far = 400;
      if (ray.intersectObjects(solid, false).length === 0) misses++;
    }
    expect(misses).toBe(0);
  });
});
