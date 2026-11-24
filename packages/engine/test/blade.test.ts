import { describe, it, expect } from 'vitest';
import { bladePos, handFor, handSign, BLADE } from '../src/blade';
import { faceoffPosition } from '../src/faceoff';
import { poseFor } from '../src/goalie';
import { TUNING } from '../src/tuning';

describe('the stick blade and left and right (Task 6)', () => {
  it('left is counter-clockwise: facing +x, a left shot\'s blade is at +y and a right shot\'s at -y', () => {
    const o = { x: 0, y: 0 };
    expect(bladePos({ x: 0, y: 0 }, 0, 'L', o).y).toBeCloseTo(0.4, 9); expect(o.x).toBeCloseTo(0.9, 9);
    expect(bladePos({ x: 0, y: 0 }, 0, 'R', o).y).toBeCloseTo(-0.4, 9);
    expect(bladePos({ x: 0, y: 0 }, Math.PI, 'L', o).y).toBeCloseTo(-0.4, 9); // facing -x, his left is -y
  });
  it('the same convention everywhere: the left winger lines up on his centre\'s left, and a left-catching goalie gloves on his left', () => {
    const lw = faceoffPosition({ x: 0, y: 0 }, 'LW', 1), c = faceoffPosition({ x: 0, y: 0 }, 'C', 1); expect(lw.y).toBeGreaterThan(c.y);
    expect(poseFor('L', { netEnd: -1, dy: +0.5, z: 0.9 })).toBe('glove'); expect(poseFor('L', { netEnd: -1, dy: -0.5, z: 0.9 })).toBe('blocker');
    expect(poseFor('R', { netEnd: -1, dy: +0.5, z: 0.9 })).toBe('blocker'); expect(poseFor('L', { netEnd: 1, dy: -0.5, z: 0.9 })).toBe('glove');
  });
  it('forehand, backhand, behind', () => {
    const at0 = { x: 0, y: 0 };
    expect(handFor(at0, 0, 'L', { x: 10, y: -5 })).toBe('forehand'); expect(handFor(at0, 0, 'L', { x: 0, y: 10 })).toBe('backhand');
    expect(handFor(at0, 0, 'L', { x: -10, y: 0 })).toBe('behind'); expect(handFor(at0, 0, 'R', { x: 0, y: 10 })).toBe('forehand');
  });
  it('handSign and BLADE follow the tuning', () => {
    expect(handSign('L')).toBe(1); expect(handSign('R')).toBe(-1);
    expect(BLADE).toEqual({ forward: TUNING.blade.forward, side: TUNING.blade.side });
  });
});
