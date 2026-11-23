import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTeam, type GameSetup } from '@hockey/engine';
import { createPlayback, type Playback } from './playback';
import { createGameScene } from './scene';
import { buildArena } from './arena';

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

  it('the drawn puck does not jump while the play runs (carried, released, picked up or won off another skater)', () => {
    const sc = createGameScene(game);
    pb.seek(1200); sc.reset(); sc.update(pb.frame(), 0);
    const last = sc.puckWorld();
    const jumps: number[] = [];
    const speeds: number[] = [];
    for (let i = 0; i < 60 * 180; i++) {
      pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
      const f = pb.frame(), p = sc.puckWorld();
      // The drawn puck may move as fast as the engine's puck has lately (shots fly; a puck picked up at speed is
      // eased onto the blade at about the speed it had); the excess over that is the jump.
      speeds.push(Math.hypot(f.next.puck.vel.x, f.next.puck.vel.y), Math.hypot(f.prev.puck.vel.x, f.prev.puck.vel.y));
      if (speeds.length > 30) speeds.splice(0, 2);
      if (f.next.phase === 'live' && f.prev.phase === 'live') jumps.push(Math.hypot(p.x - last.x, p.z - last.z) - Math.max(...speeds) / 60);
      last.copy(p);
    }
    jumps.sort((x, y) => x - y);
    // A release must reach the engine's puck by the end of its tick, so the slide off the blade takes at most two
    // 60 Hz frames: the gap from the blade to where the engine lets the puck go (well under a metre) shared by them.
    expect(jumps[Math.floor(jumps.length * 0.999)]!).toBeLessThan(0.45);
    expect(jumps[jumps.length - 1]!).toBeLessThan(1.2);
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
});
