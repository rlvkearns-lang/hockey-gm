import { describe, it, expect } from 'vitest';
import { dist } from '../src/vec';
import { resolveBodies, resolveGoalies, routeAroundGoalies } from '../src/bodies';
import { DT } from '../src/constants';
import { resolveNets } from '../src/rink';
import { movementOf, stepSkater } from '../src/skating';
import { at, def, mv, stateWith } from './helpers';

describe('bodies', () => {
  it('bodies do not overlap and the lighter one gives more', () => {
    const big = at(0, 0), small = at(0.3, 0); const c = resolveBodies([big, small], id => id === big.id ? mv(110) : mv(78));
    expect(dist(big.pos, small.pos)).toBeGreaterThanOrEqual(0.74); expect(Math.abs(small.pos.x - 0.3)).toBeGreaterThan(Math.abs(big.pos.x)); expect(c.length).toBe(1);
  });
  it('reports closing speed and ignores bodies that are apart', () => {
    const a = at(0, 0), b = at(0.5, 0), far = at(10, 0); a.vel = { x: 3, y: 0 };
    const c = resolveBodies([a, b, far], () => mv(85));
    expect(c).toHaveLength(1); expect(c[0]!.closing).toBeCloseTo(3);
  });
  it('separates bodies sitting at exactly the same spot', () => {
    const a = at(5, 2), b = at(5, 2);
    const c = resolveBodies([a, b], () => mv(85));
    expect(c).toHaveLength(1);
    expect(Number.isFinite(a.pos.x) && Number.isFinite(b.pos.x) && Number.isFinite(a.pos.y) && Number.isFinite(b.pos.y)).toBe(true);
    expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 * mv(85).radius - 1e-9);
  });
  it('a goalie on his line is gone round on the far side of it; one off his line is not', () => {
    const goalie = { pos: { x: 26.5, y: 0 } } as never;
    const out = { x: 0, y: 0 };
    expect(routeAroundGoalies({ x: 27, y: 0.1 }, { x: 20, y: 0 }, 0.38, [goalie], out)).toBe(true);
    expect(out.y).toBeGreaterThan(0.55 + 0.38); expect(Math.abs(out.x - 26.5)).toBeLessThan(0.3);   // beside him, on the skater's side
    expect(routeAroundGoalies({ x: 27, y: 2.5 }, { x: 20, y: 2.5 }, 0.38, [goalie], out)).toBe(false);
  });
  it('a skater pinned between his goalie and the net frame gets out of the crease', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const g = st.goalies.away; g.pos = { x: 26.4, y: 0 };
    const s = at(26.95, 0.05); s.target = { x: 18, y: 0 }; const m = movementOf(def({}), 1); const wp = { x: 0, y: 0 };
    let out = false;
    for (let t = 0; t < 45 && !out; t++) {
      const tx = s.target.x, ty = s.target.y;
      if (routeAroundGoalies(s.pos, s.target, 0.38, [g], wp)) s.target = { x: wp.x, y: wp.y };
      stepSkater(s, m, DT); s.target = { x: tx, y: ty };
      resolveNets(s.pos, s.vel, 0.38); resolveGoalies([s], [mv(85)], [g]);
      out = Math.hypot(s.pos.x - g.pos.x, s.pos.y - g.pos.y) > 1.5;
    }
    expect(out).toBe(true);
  });
});
