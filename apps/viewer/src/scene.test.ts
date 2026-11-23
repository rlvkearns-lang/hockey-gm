import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GameSetup } from '@hockey/engine';
import type { Playback } from './playback';
import { createGameScene } from './scene';
import { sharedPlayback } from './test/game';

describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

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

  it('dispose frees the high-quality key light\'s shadow map', () => {
    const sc = createGameScene(game, { quality: 'high' });
    const lights: THREE.Light[] = [];
    sc.root.traverse((o) => { if (o instanceof THREE.Light && o.castShadow) lights.push(o); });
    expect(lights.length).toBeGreaterThan(0);
    // The renderer makes the map on the first shadowed render; stand one in, as it would.
    let freed = 0;
    for (const l of lights) { const rt = new THREE.WebGLRenderTarget(4, 4); rt.addEventListener('dispose', () => { freed++; }); l.shadow!.map = rt; }
    sc.dispose();
    expect(freed).toBe(lights.length);
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
