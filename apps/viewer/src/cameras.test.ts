import { describe, expect, it } from 'vitest';
import { BENCH_DOORS, RINK } from '@hockey/engine';
import { CAMERA_NAMES, cameraTarget, easeCamera, easePoint, type CameraInput, type CameraPose } from './cameras';

const input = (x: number, z: number): CameraInput => ({ puck: { x, y: 0, z }, attackingRight: true, followed: { pos: { x, y: 0, z }, facing: 0, vel: { x: 5, y: 0, z: 0 } } });

describe('cameras', () => {
  it('every angle stays above the ice and looks at something near the play', () => {
    for (const name of ['broadcast', 'overhead', 'netHome', 'netAway', 'iceLevel', 'follow'] as const) for (const [x, z] of [[0, 0], [25, 10], [-28, -12], [29, 0]] as const) {
      const c = cameraTarget(name, input(x, z));
      expect(c.pos.y).toBeGreaterThan(0.5); expect(Number.isFinite(c.pos.x + c.pos.z + c.look.x + c.look.z)).toBe(true);
      if (name !== 'netHome' && name !== 'netAway') expect(Math.hypot(c.look.x - x, c.look.z - z)).toBeLessThan(12);
    }
  });
  it('the broadcast camera pans with the puck but never past the ends of the rink', () => {
    const a = cameraTarget('broadcast', input(-20, 0)), b = cameraTarget('broadcast', input(20, 0)), e = cameraTarget('broadcast', input(200, 0));
    expect(b.look.x).toBeGreaterThan(a.look.x + 20); expect(e.look.x).toBeLessThan(31);
    expect(Math.sign(a.pos.z)).toBe(Math.sign(b.pos.z));
  });
  it('easing moves toward the target without overshooting, and snap jumps', () => {
    const from: CameraPose = { pos: { x: 0, y: 10, z: 20 }, look: { x: 0, y: 0, z: 0 }, fov: 40 }, to: CameraPose = { pos: { x: 30, y: 10, z: 20 }, look: { x: 30, y: 0, z: 0 }, fov: 40 };
    let c = from; for (let i = 0; i < 600; i++) { const n = easeCamera(c, to, 1 / 60, false); expect(n.pos.x).toBeGreaterThanOrEqual(c.pos.x); expect(n.pos.x).toBeLessThanOrEqual(30.0001); c = n; }
    expect(c.pos.x).toBeCloseTo(30, 1);
    expect(easeCamera(from, to, 1 / 60, true)).toEqual(to);
  });

  // Beyond the brief's list.
  const spots: [number, number][] = [];
  for (let x = -32; x <= 32; x += 4) for (let z = -14; z <= 14; z += 4) spots.push([x, z]);

  it('the broadcast camera is high on the side opposite the benches, and stays there wherever the play is', () => {
    const benchSide = Math.sign(BENCH_DOORS.home.y); // world z = engine y
    for (const [x, z] of spots) {
      const c = cameraTarget('broadcast', input(x, z));
      expect(Math.sign(c.pos.z)).toBe(-benchSide);
      expect(Math.abs(c.pos.z)).toBeGreaterThan(RINK.halfWidth + 8);
      expect(c.pos.y).toBeGreaterThan(10);
      expect(Math.abs(c.look.x)).toBeLessThan(RINK.halfLength);
    }
  });
  it('every angle stays inside the arena: under the roof lights, within the stands and above the ice', () => {
    for (const name of CAMERA_NAMES) for (const [x, z] of spots) for (const attackingRight of [true, false]) {
      const inp: CameraInput = { ...input(x, z), attackingRight, followed: { pos: { x, y: 0, z }, facing: (x + z) / 7, vel: { x: -z / 3, y: 0, z: x / 5 } } };
      const c = cameraTarget(name, inp);
      expect(c.pos.y).toBeGreaterThan(0.5); expect(c.pos.y).toBeLessThan(29);
      expect(Math.abs(c.pos.x)).toBeLessThan(RINK.halfLength + 20);
      expect(Math.abs(c.pos.z)).toBeLessThan(RINK.halfWidth + 22);
      expect(c.fov).toBeGreaterThan(15); expect(c.fov).toBeLessThan(75);
    }
  });
  it('the cameras that stand on the ice stay inside the boards', () => {
    const inside = (p: { x: number; z: number }): boolean => {
      const R = RINK.cornerRadius, cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
      const ax = Math.abs(p.x), az = Math.abs(p.z);
      if (ax > RINK.halfLength || az > RINK.halfWidth) return false;
      return !(ax > cx && az > cy && Math.hypot(ax - cx, az - cy) > R);
    };
    for (const name of ['iceLevel', 'follow'] as const) for (const [x, z] of spots) for (const facing of [0, 1.5, 3, -2]) {
      const inp: CameraInput = { ...input(x, z), followed: { pos: { x, y: 0, z }, facing, vel: { x: Math.cos(facing) * 6, y: 0, z: Math.sin(facing) * 6 } } };
      expect(inside(cameraTarget(name, inp).pos)).toBe(true);
    }
  });
  it('the cameras behind the nets sit behind the net each team defends, and swap when the teams change ends', () => {
    const r = cameraTarget('netHome', { ...input(0, 0), attackingRight: true });
    expect(r.pos.x).toBeLessThan(-RINK.goalLineX); expect(r.look.x).toBeGreaterThan(r.pos.x + 5);
    const l = cameraTarget('netHome', { ...input(0, 0), attackingRight: false });
    expect(l.pos.x).toBeGreaterThan(RINK.goalLineX); expect(l.look.x).toBeLessThan(l.pos.x - 5);
    const a = cameraTarget('netAway', { ...input(0, 0), attackingRight: true });
    expect(a.pos.x).toBeGreaterThan(RINK.goalLineX);
    // Above the net and inside the end boards, so neither the net nor the glass stands between it and the ice.
    for (const c of [r, l, a]) { expect(c.pos.y).toBeGreaterThan(RINK.netHeight + 2); expect(Math.abs(c.pos.x)).toBeLessThan(RINK.halfLength); }
  });
  it('overhead looks almost straight down, high over the puck\'s half, and sees the whole width of the ice', () => {
    for (const [x, z] of spots) {
      const c = cameraTarget('overhead', input(x, z));
      const h = c.pos.y - c.look.y;
      expect(Math.hypot(c.pos.x - c.look.x, c.pos.z - c.look.z)).toBeLessThan(h * 0.15);
      const halfSeen = h * Math.tan((c.fov * Math.PI) / 360);
      expect(halfSeen).toBeGreaterThan(RINK.halfWidth);
      expect(Math.sign(c.look.x) === Math.sign(x) || Math.abs(x) < 1).toBe(true);
    }
  });
  it('ice level is low, on the broadcast side, and never on top of the puck', () => {
    for (const [x, z] of spots) {
      const c = cameraTarget('iceLevel', input(x, z));
      expect(c.pos.y).toBeLessThan(2.2); expect(c.pos.z).toBeGreaterThan(0);
      expect(Math.hypot(c.pos.x - x, c.pos.z - z)).toBeGreaterThan(5);
    }
  });
  it('follow sits behind the player along his travel, or along his facing when he stands still', () => {
    const moving = cameraTarget('follow', { ...input(0, 0), followed: { pos: { x: 0, y: 0, z: 0 }, facing: Math.PI, vel: { x: 0, y: 0, z: 6 } } });
    expect(moving.pos.z).toBeLessThan(-3); expect(moving.look.z).toBeGreaterThan(0);
    const still = cameraTarget('follow', { ...input(0, 0), followed: { pos: { x: 0, y: 0, z: 0 }, facing: Math.PI, vel: { x: 0, y: 0, z: 0 } } });
    expect(still.pos.x).toBeGreaterThan(3);
    // Without a followed player it falls back to the broadcast view.
    expect(cameraTarget('follow', { puck: { x: 3, y: 0, z: 1 }, attackingRight: true })).toEqual(cameraTarget('broadcast', { puck: { x: 3, y: 0, z: 1 }, attackingRight: true }));
  });
  it('easing is frame-rate independent and eases the field of view too', () => {
    const from: CameraPose = { pos: { x: 0, y: 10, z: 20 }, look: { x: 0, y: 0, z: 0 }, fov: 40 }, to: CameraPose = { pos: { x: 10, y: 12, z: 20 }, look: { x: 10, y: 0, z: 0 }, fov: 30 };
    let a = from, b = from;
    for (let i = 0; i < 60; i++) a = easeCamera(a, to, 1 / 60, false);
    for (let i = 0; i < 20; i++) b = easeCamera(b, to, 1 / 20, false);
    expect(a.pos.x).toBeCloseTo(b.pos.x, 6); expect(a.fov).toBeCloseTo(b.fov, 6);
    expect(a.fov).toBeLessThan(40); expect(a.fov).toBeGreaterThan(30);
    expect(easeCamera(from, to, 0, false)).toEqual(from);
  });
  it('easePoint follows a point smoothly without overshoot', () => {
    let p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 120; i++) { const n = easePoint(p, { x: 10, y: 0, z: -4 }, 1 / 60, 0.25); expect(n.x).toBeGreaterThanOrEqual(p.x); expect(n.x).toBeLessThanOrEqual(10); p = n; }
    expect(p.x).toBeCloseTo(10, 1); expect(p.z).toBeCloseTo(-4, 1);
  });
});
