import { describe, expect, it } from 'vitest';
import { BENCH_DOORS, RINK } from '@hockey/engine';
import { BOARD_TOP, type CameraName, type CameraPose } from './cameras';
import { cutKind, emptyProbe, isCut, probeOf, type CutKind } from './cuts';
import { goalShow } from './goal-show';
import { initialOperator, stepOperator, withCamera } from './operator';
import { createCursor } from './playback';
import { recorded, testSetup } from './test/game';
import { buildTimeline, type Timeline } from './timeline';
import { inPicture, runCameras } from './test/camera-run';

describe('camera operator', () => {
  it('eases on a jump cut and hard-cuts on a restart or a change of ends', () => {
    let st = initialOperator('broadcast'); const inp = (x: number, cut?: 'restart' | 'ends' | 'jump') => ({ puck: { x, y: 0, z: 0 }, attackingRight: true, cut, zoom: 1 });
    for (let i = 0; i < 120; i++) st = stepOperator(st, inp(-10), 1 / 60).state;
    const jump = stepOperator(st, inp(8, 'jump'), 1 / 60); expect(jump.cut).toBe(false);
    const restart = stepOperator(st, inp(8, 'restart'), 1 / 60); expect(restart.cut).toBe(true);
  });
  it('the cut rule does not depend on frame rate', () => {
    const run = (hz: number) => { let st = initialOperator('overhead'), cuts = 0; for (let t = 0; t < 4; t += 1 / hz) { const r = stepOperator(st, { puck: { x: -20 + t * 18, y: 0, z: 0 }, attackingRight: true, zoom: 1 }, 1 / hz); st = r.state; if (r.cut) cuts++; } return cuts; };
    expect(run(30)).toBe(run(60)); expect(run(60)).toBe(run(144));
  });

  // Beyond the brief's list.
  it('the cut rule does not depend on frame rate in a run that does cut (ice level changing spot as the puck runs the ice)', () => {
    const run = (hz: number): number => {
      let st = initialOperator('iceLevel'), cuts = 0;
      for (let i = 0; i < 16 * hz; i++) {
        const u = (i / hz) % 8, x = -26 + 13 * u - (u > 4 ? 2 * 13 * (u - 4) : 0); // up the ice and back, twice
        // (Along the near boards, where it must change spot not to be on top of the puck.)
        const r = stepOperator(st, { puck: { x, y: 0, z: 9 }, attackingRight: true }, i === 0 ? 0 : 1 / hz);
        st = r.state; if (r.cut && i > 0) cuts++;
      }
      return cuts;
    };
    const c30 = run(30);
    expect(c30).toBeGreaterThan(1);
    expect(run(60)).toBe(c30); expect(run(144)).toBe(c30);
  });
  it('a camera target that jumps 5 to 7 m within one engine tick is judged the same at every frame rate', () => {
    // The follow camera behind a skater whom something carries `jump` metres sideways within one tick, either all at
    // once at the tick or spread across its frames; he otherwise skates at 6 m/s.
    const run = (hz: number, jump: number, spread: boolean): number => {
      let st = withCamera(initialOperator('follow'), 'follow'), cuts = 0;
      const t0 = 1, tick = 1 / 30;
      for (let i = 0; i < 2 * hz; i++) {
        const t = i / hz;
        const k = spread ? Math.min(1, Math.max(0, (t - t0) / tick)) : t >= t0 ? 1 : 0;
        const pos = { x: -10 + 6 * t, y: 0, z: jump * k };
        const r = stepOperator(st, { puck: pos, attackingRight: true, followed: { pos, facing: 0, vel: { x: 6, y: 0, z: 0 } } }, i === 0 ? 0 : 1 / hz);
        st = r.state; if (r.cut && i > 0) cuts++;
      }
      return cuts;
    };
    for (const spread of [false, true]) {
      for (const jump of [4, 6, 7]) {
        const want = jump > 5 ? 1 : 0;
        for (const hz of [30, 60, 144]) expect(run(hz, jump, spread), `${jump} m ${spread ? 'spread' : 'at once'} at ${hz} Hz`).toBe(want);
      }
    }
  });
  it('a change of ends cuts even while a goal holds the camera on the net (a goal on a period\'s last tick); a restart does not', () => {
    let st = initialOperator('broadcast');
    const hold = { net: { x: 26, y: 0, z: 0 }, k: 1 };
    const at = (cut?: 'ends' | 'restart') => ({ puck: { x: 20, y: 0, z: 0 }, attackingRight: true, goal: hold, cut });
    for (let i = 0; i < 60; i++) st = stepOperator(st, at(), 1 / 60).state;
    expect(stepOperator(st, at('ends'), 1 / 60).cut).toBe(true);
    expect(stepOperator(st, at('restart'), 1 / 60).cut).toBe(false);
  });
  it('a change of ends, a new angle or a seek cuts; an angle whose spot jumps (ice level) cuts there at any frame rate', () => {
    let st = initialOperator('iceLevel');
    const at = (x: number) => ({ puck: { x, y: 0, z: 0 }, attackingRight: true });
    for (let i = 0; i < 60; i++) st = stepOperator(st, at(-20), 1 / 60).state;
    expect(stepOperator(st, { ...at(-20), cut: 'ends' as const }, 1 / 60).cut).toBe(true);
    expect(stepOperator(st, { ...at(-20), snap: true }, 1 / 60).cut).toBe(true);
    expect(stepOperator(withCamera(st, 'broadcast'), at(-20), 1 / 60).cut).toBe(true);
    for (const hz of [30, 60, 144]) {
      // The puck runs the length of the ice at 12 m/s: ice level changes spot on the way, cutting each time.
      let s = initialOperator('iceLevel'), cuts = 0;
      for (let t = 0; t < 4; t += 1 / hz) { const r = stepOperator(s, at(-24 + t * 12), 1 / hz); s = r.state; if (r.cut && t > 0) cuts++; }
      expect(cuts, `${hz} Hz`).toBeGreaterThan(0);
      expect(cuts, `${hz} Hz`).toBeLessThan(4);
    }
  });
  it('eases toward the play and never past it; paused (dt 0) it holds still', () => {
    // (The broadcast camera stands on a fixed platform and turns to the play: its look point moves, not its place.)
    let st = initialOperator('broadcast');
    st = stepOperator(st, { puck: { x: -15, y: 0, z: 0 }, attackingRight: true }, 1 / 60).state;
    const x0 = st.cam.look.x;
    for (let i = 0; i < 600; i++) {
      const r = stepOperator(st, { puck: { x: 10, y: 0, z: 0 }, attackingRight: true }, 1 / 60);
      expect(r.pose.look.x).toBeGreaterThanOrEqual(st.cam.look.x - 1e-9);
      expect(r.pose.look.x).toBeLessThanOrEqual(10 + 1e-9);
      st = r.state;
    }
    expect(st.cam.look.x).toBeGreaterThan(x0 + 5);
    const held = stepOperator(st, { puck: { x: -10, y: 0, z: 0 }, attackingRight: true }, 0);
    expect(held.pose).toEqual(st.cam);
  });

  // Task 5 fix round 1: board battles from the broadcast camera.
  describe('a board battle from the broadcast camera', () => {
    const NEAR = -(Math.sign(BENCH_DOORS.home.y) || -1);
    /** The operator's pose after 3 s of play round a battle at (x, z) (puck at the spot), 60 Hz. */
    const settle = (x: number, z: number, battle: boolean) => {
      let st = initialOperator('broadcast');
      let pose = st.cam;
      for (let i = 0; i < 180; i++) {
        const r = stepOperator(st, { puck: { x, y: 0, z }, attackingRight: true, zoom: 1, battle: battle ? { x, y: 0, z } : null }, i === 0 ? 0 : 1 / 60);
        st = r.state; pose = r.pose;
        if (i > 0) expect(r.cut, `no cut onto the battle (${x})`).toBe(false);
      }
      return pose;
    };
    /** Whether world point p is inside the picture (16:9) of `pose`. */
    const inFrame = (pose: ReturnType<typeof settle>, p: { x: number; y: number; z: number }): boolean => {
      const f = { x: pose.look.x - pose.pos.x, y: pose.look.y - pose.pos.y, z: pose.look.z - pose.pos.z }, fl = Math.hypot(f.x, f.y, f.z);
      const fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
      const rt = { x: -fw.z, y: 0, z: fw.x }, rl = Math.hypot(rt.x, rt.z); rt.x /= rl; rt.z /= rl;
      const up = { x: rt.z * fw.y - 0, y: rt.x * fw.z - rt.z * fw.x, z: 0 - rt.x * fw.y };
      const d = { x: p.x - pose.pos.x, y: p.y - pose.pos.y, z: p.z - pose.pos.z };
      const along = d.x * fw.x + d.y * fw.y + d.z * fw.z;
      const ty = Math.tan((pose.fov * Math.PI) / 360) * 0.9, tx = ty * (16 / 9);
      const sx = (d.x * rt.x + d.z * rt.z) / along, sy = (d.x * up.x + d.y * up.y + d.z * up.z) / along;
      return along > 0 && Math.abs(sx) < tx && Math.abs(sy) < ty;
    };
    it('on the near boards the battle is in the picture and the boards do not hide the men below the thigh', () => {
      for (let x = -21; x <= 21; x += 3) {
        const z = NEAR * (RINK.halfWidth - 0.4), pose = settle(x, z, true);
        expect(inFrame(pose, { x, y: 0.5, z }), `spot ${x} in frame`).toBe(true);
        // The line of sight to a point 0.5 m up at the spot passes over the boards' top edge.
        const zb = NEAR * RINK.halfWidth, k = (zb - pose.pos.z) / (z - pose.pos.z);
        const yAt = pose.pos.y + (0.5 - pose.pos.y) * k;
        expect(yAt, `line of sight over the near boards at x ${x}`).toBeGreaterThan(BOARD_TOP);
      }
    });
    it('on any boards it frames the battle tighter, and eases back when it ends', () => {
      for (const z of [NEAR * (RINK.halfWidth - 0.4), -NEAR * (RINK.halfWidth - 0.4)]) {
        const plain = settle(5, z, false), close = settle(5, z, true);
        expect(close.fov).toBeLessThan(plain.fov * 0.7);
        expect(inFrame(close, { x: 5, y: 0.5, z })).toBe(true);
      }
      // After the battle: back to the plain framing without a cut.
      let st = initialOperator('broadcast');
      const z = NEAR * (RINK.halfWidth - 0.4);
      for (let i = 0; i < 120; i++) st = stepOperator(st, { puck: { x: 0, y: 0, z }, attackingRight: true, zoom: 1, battle: { x: 0, y: 0, z } }, 1 / 60).state;
      let last = st.cam;
      for (let i = 0; i < 240; i++) { const r = stepOperator(st, { puck: { x: 0, y: 0, z }, attackingRight: true, zoom: 1, battle: null }, 1 / 60); expect(r.cut).toBe(false); st = r.state; last = r.pose; }
      expect(Math.abs(last.fov - settle(0, z, false).fov)).toBeLessThan(0.5);
    });
  });

  /**
   * Operators played at 60 Hz over a recorded game from tick `t0` to `t1` as the page drives them (the engine's puck,
   * the scene's cut kinds, the goal show from each run's timeline), one engine pass for all `runs`; `each` gets the run's
   * index, the display time, the pose and whether it cut.
   */
  function runOperators(seed: number, runs: readonly { tl: Timeline; cam: CameraName }[], t0: number, t1: number, each: (r: number, t: number, pose: CameraPose, cut: boolean) => void): void {
    const pb = createCursor(testSetup(seed), recorded(seed));
    const ops = runs.map((r) => withCamera(initialOperator(r.cam), r.cam));
    const shown = emptyProbe();
    for (let i = 0; t0 + i / 2 <= t1; i++) {
      const t = t0 + i / 2;
      pb.seek(t);
      const f = pb.frame(), prev = f.prev;
      const next = isCut(probeOf(prev), f.next) ? prev : f.next;
      let cut: CutKind | null = null;
      if (shown.tick >= 0 && prev.tick !== shown.tick) cut = cutKind(shown, prev);
      if (prev.tick !== shown.tick) probeOf(prev, shown);
      const a = next === prev ? 0 : f.alpha;
      const puck = { x: prev.puck.pos.x + (next.puck.pos.x - prev.puck.pos.x) * a, y: 0, z: prev.puck.pos.y + (next.puck.pos.y - prev.puck.pos.y) * a };
      runs.forEach((run, k) => {
        const show = goalShow(run.tl, t);
        const scorer = show.hold && show.hold.scorerId ? next.skaters.find((s) => s.id === show.hold!.scorerId) : undefined;
        const r = stepOperator(ops[k]!, {
          puck, attackingRight: prev.attackDir.home === 1, cut, snap: i === 0,
          goal: show.hold ? { net: show.hold.net, k: show.hold.k, scorer: scorer && scorer.onIce ? { x: scorer.pos.x, y: 0, z: scorer.pos.y } : null } : null,
        }, i === 0 ? 0 : 1 / 60);
        ops[k] = r.state;
        each(k, t, r.pose, r.cut);
      });
    }
  }
  const CAMS: CameraName[] = ['broadcast', 'overhead', 'netHome', 'netAway', 'iceLevel'];

  it('after a goal holds on the net scored on (from 0.4 s after it to 3 s), with no cut to the restart, then eases to the restart with at most one cut', () => {
    let checked = 0, worstAtGoal = 0, worstHold = 0;
    for (const seed of [5, 42]) {
      const rec = recorded(seed), tl = buildTimeline(rec.events);
      for (const g of tl.goals) {
        const net = { x: Math.sign(g.pos.x) * RINK.goalLineX, z: 0 };
        const worst = CAMS.map(() => 0), cutsAfter = CAMS.map(() => 0), cutsDuring = CAMS.map(() => 0), lastLook = CAMS.map(() => ({ x: 0, z: 0 }));
        const hold = g.tick + 90;
        runOperators(seed, CAMS.map((cam) => ({ tl, cam })), g.tick - 60, g.tick + 165, (k, t, pose, cut) => {
          // (The overhead camera shows the zone, not a point: the net in its picture counts as on the net.)
          const d = CAMS[k] === 'overhead' ? (inPicture(pose, { x: net.x, y: 0, z: net.z }) ? 0 : 99) : Math.hypot(pose.look.x - net.x, pose.look.z - net.z);
          if (t === g.tick) worstAtGoal = Math.max(worstAtGoal, d);
          if (t >= g.tick + 12 && t <= hold) worst[k] = Math.max(worst[k]!, d);
          if (t > g.tick && t <= hold && cut) cutsDuring[k]!++;
          else if (t > hold && cut) cutsAfter[k]!++;
          lastLook[k] = { x: pose.look.x, z: pose.look.z };
        });
        CAMS.forEach((cam, k) => {
          worstHold = Math.max(worstHold, worst[k]!);
          expect(worst[k], `${seed} goal ${g.tick} ${cam}`).toBeLessThan(6);
          expect(cutsDuring[k], `${seed} goal ${g.tick} ${cam} cuts in the hold`).toBe(0);
          expect(cutsAfter[k], `${seed} goal ${g.tick} ${cam} cuts after`).toBeLessThanOrEqual(1);
          // By 5.5 s the broadcast camera watches the restart at centre ice.
          if (cam === 'broadcast') expect(Math.abs(lastLook[k]!.x), `${seed} goal ${g.tick}`).toBeLessThan(6);
          checked++;
        });
      }
    }
    console.log(`goal hold: look point from the net, worst at the goal's tick ${worstAtGoal.toFixed(2)} m, worst from 0.4 s to 3 s after ${worstHold.toFixed(2)} m`);
    expect(checked).toBeGreaterThan(40);
  });

  it('before a goal the camera does exactly what it would if the shot had not gone in (no tell): 1.5 s before each goal, the same with that goal out of the log', () => {
    let frames = 0;
    for (const seed of [5, 42]) {
      const rec = recorded(seed), tl = buildTimeline(rec.events);
      for (const g of tl.goals) {
        const without = buildTimeline(rec.events.filter((e) => e !== g));
        const runs = CAMS.flatMap((cam) => [{ tl, cam }, { tl: without, cam }]);
        const poses: CameraPose[][] = runs.map(() => []);
        runOperators(seed, runs, g.tick - 75, g.tick - 0.5, (k, t, pose) => { if (t >= g.tick - 45) poses[k]!.push(pose); });
        CAMS.forEach((cam, k) => {
          expect(poses[2 * k], `${seed} goal ${g.tick} ${cam}`).toEqual(poses[2 * k + 1]);
          frames += poses[2 * k]!.length;
        });
      }
    }
    expect(frames).toBeGreaterThan(40 * 80);
  });

  // The owner's feedback on milestone 3: "overhead is dizzying, broadcast moves too much". Every camera calm.
  describe('calm cameras', () => {
    const at = (x: number, z = 0) => ({ puck: { x, y: 0, z }, attackingRight: true, zoom: 1 });
    it('the broadcast camera does not move for a quick pass back and forth, and pans only once the play leaves the middle of the picture', () => {
      let st = initialOperator('broadcast');
      for (let i = 0; i < 120; i++) st = stepOperator(st, at(0), i === 0 ? 0 : 1 / 60).state;
      const still = st.cam;
      // Passes back and forth across 8 m, twice a second, for 3 s: the frame does not move.
      for (let i = 0; i < 180; i++) { const r = stepOperator(st, at(4 * Math.sin((2 * Math.PI * i) / 30)), 1 / 60); st = r.state; expect(r.pose).toEqual(still); }
      // The play moves 15 m up the ice: it pans, smoothly and without overshoot, and stops.
      let last = st.cam.look.x, moved = 0;
      for (let i = 0; i < 300; i++) { const r = stepOperator(st, at(15), 1 / 60); st = r.state; expect(r.pose.look.x).toBeGreaterThanOrEqual(last - 1e-9); moved = r.pose.look.x; last = r.pose.look.x; }
      expect(moved).toBeGreaterThan(5);
      expect(st.cam.pos).toEqual(still.pos); // a fixed platform: it turns, it does not travel
    });
    it('the overhead camera stays on its zone until the play has been in another for a second, then slides there without a cut; the whole-rink overhead never moves', () => {
      let st = initialOperator('overhead');
      for (let i = 0; i < 60; i++) st = stepOperator(st, at(0), i === 0 ? 0 : 1 / 60).state;
      const zone0 = st.cam;
      // Into the offensive zone for 0.8 s and back out: no move.
      for (let i = 0; i < 48; i++) { const r = stepOperator(st, at(14), 1 / 60); st = r.state; expect(r.pose).toEqual(zone0); }
      for (let i = 0; i < 60; i++) { const r = stepOperator(st, at(2), 1 / 60); st = r.state; expect(r.pose).toEqual(zone0); }
      // In for 3 s: still for a second, then a slide (no cut, never turned: the same height and offset across).
      let cuts = 0;
      for (let i = 0; i < 180; i++) {
        const r = stepOperator(st, at(14 + Math.sin(i / 9)), 1 / 60); st = r.state; if (r.cut) cuts++;
        if (i < 58) expect(r.pose).toEqual(zone0);
        expect(r.pose.pos.y).toBe(zone0.pos.y); expect(r.pose.pos.z - r.pose.look.z).toBeCloseTo(zone0.pos.z - zone0.look.z, 9);
      }
      expect(cuts).toBe(0);
      expect(st.cam.look.x).toBeGreaterThan(zone0.look.x + 5);
      let wide = initialOperator('overheadWide'), first: CameraPose | null = null;
      for (let i = 0; i < 600; i++) { const r = stepOperator(wide, at(-28 + (56 * i) / 600, 10 * Math.sin(i / 50)), i === 0 ? 0 : 1 / 60); wide = r.state; first ??= r.pose; expect(r.pose).toEqual(first); }
    });
    it('the follow camera follows his travel, not his body: turning on the spot does not swing it', () => {
      let st = withCamera(initialOperator('follow'), 'follow');
      const him = (facing: number, vx: number) => ({ ...at(0), followed: { pos: { x: 0, y: 0, z: 0 }, facing, vel: { x: vx, y: 0, z: 0 } } });
      for (let i = 0; i < 120; i++) st = stepOperator(st, him(0, 5), i === 0 ? 0 : 1 / 60).state;
      const before = st.cam;
      // He stops and turns round (his facing swings through half a turn): the camera stays where it was.
      for (let i = 0; i < 90; i++) { const r = stepOperator(st, him((Math.PI * i) / 90, 0), 1 / 60); st = r.state; expect(Math.hypot(r.pose.pos.x - before.pos.x, r.pose.pos.z - before.pos.z)).toBeLessThan(0.05); }
    });
    it('over a period of seed 5 every camera moves calmly: look speed and acceleration, pan reversals and cuts within their limits, and the broadcast camera keeps the puck in the picture', () => {
      // Measured over the first period of seed 5 at 60 Hz (test/camera-run.ts). Before (the cameras of milestone 3):
      // look speed p50/p95/p99 (m/s), acceleration p95/p99 (m/s^2), pan reversals a minute, cuts, puck in picture:
      //   broadcast 3.7/12.4/16.1, 36/199, 51.3, 16, 99.8%; overhead 3.0/10.6/15.0, 21/34, 33.0, 16;
      //   behind the home net 5.5/14.4/16.4, 28/41, 37.8, 16; ice level 4.7/14.0/16.2, 29/42, 38.1, 304;
      //   follow 5.0/11.2/15.4, 34/120, 57.6, 140.
      // After, with a margin: the limits below. (The whole-rink overhead never moves; its cuts are the restarts'.)
      const lim: Record<string, { sp: [number, number, number]; ac: [number, number]; rev: number; cuts: number }> = {
        broadcast: { sp: [2.5, 12, 17], ac: [22, 32], rev: 15, cuts: 25 },
        overhead: { sp: [0.5, 6, 8], ac: [7.5, 7.5], rev: 6, cuts: 25 },
        overheadWide: { sp: [1e-9, 1e-9, 1e-9], ac: [1e-9, 1e-9], rev: 0, cuts: 25 },
        netHome: { sp: [4.5, 16, 20], ac: [21, 21], rev: 30, cuts: 25 },
        netAway: { sp: [4.5, 16, 20], ac: [21, 21], rev: 32, cuts: 25 },
        iceLevel: { sp: [4.5, 16, 20], ac: [21, 21], rev: 33, cuts: 185 },
        follow: { sp: [5, 11, 11.5], ac: [12.5, 12.5], rev: 35, cuts: 50 },
      };
      const r = runCameras(Object.keys(lim) as CameraName[]);
      console.log(JSON.stringify(r));
      for (const [cam, l] of Object.entries(lim)) {
        const m = r[cam]!;
        expect(m.lookSpeed.p50, `${cam} speed p50`).toBeLessThanOrEqual(l.sp[0]);
        expect(m.lookSpeed.p95, `${cam} speed p95`).toBeLessThanOrEqual(l.sp[1]);
        expect(m.lookSpeed.p99, `${cam} speed p99`).toBeLessThanOrEqual(l.sp[2]);
        expect(m.lookAccel.p95, `${cam} accel p95`).toBeLessThanOrEqual(l.ac[0]);
        expect(m.lookAccel.p99, `${cam} accel p99`).toBeLessThanOrEqual(l.ac[1]);
        expect(m.reversalsPerMin, `${cam} reversals a minute`).toBeLessThanOrEqual(l.rev);
        expect(m.cuts, `${cam} cuts`).toBeLessThanOrEqual(l.cuts);
      }
      expect(r.broadcast!.inFrame).toBeGreaterThanOrEqual(0.99);
    });
  });
});
