import { describe, expect, it } from 'vitest';
import { initialOperator, stepOperator, withCamera } from './operator';

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
      for (let i = 0; i < 8 * hz; i++) {
        const t = i / hz, x = -26 + 13 * t - (t > 4 ? 2 * 13 * (t - 4) : 0); // up the ice and back
        const r = stepOperator(st, { puck: { x, y: 0, z: 2 }, attackingRight: true }, i === 0 ? 0 : 1 / hz);
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
    let st = initialOperator('broadcast');
    st = stepOperator(st, { puck: { x: -15, y: 0, z: 0 }, attackingRight: true }, 1 / 60).state;
    const x0 = st.cam.pos.x;
    for (let i = 0; i < 600; i++) {
      const r = stepOperator(st, { puck: { x: 10, y: 0, z: 0 }, attackingRight: true }, 1 / 60);
      expect(r.pose.pos.x).toBeGreaterThanOrEqual(st.cam.pos.x - 1e-9);
      st = r.state;
    }
    expect(st.cam.pos.x).toBeGreaterThan(x0 + 5);
    const held = stepOperator(st, { puck: { x: -10, y: 0, z: 0 }, attackingRight: true }, 0);
    expect(held.pose).toEqual(st.cam);
  });
});
