import { describe, expect, it } from 'vitest';
import { DT, type SkaterState } from '@hockey/engine';
import { createMomentScanner, type ScanState } from './moments';

const skater = (p: Partial<SkaterState>): SkaterState => ({
  id: 'a', side: 'home', slot: 'LD', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: 0, target: { x: 0, y: 0 }, faceTarget: null,
  mode: 'forward', speedCap: 1, energy: 1, onIce: true, leaving: false, downT: 0, contestId: null, shiftStart: 0, toiTicks: 0, ...p,
});

describe('moment scanner', () => {
  it("finds a skater's sprint, stop, backward stretch and faceoff in order, and nothing for a skater never on the ice", () => {
    const sc = createMomentScanner();
    let tick = 0, vx = 0;
    const step = (accel: number, secs: number, cap: number): void => {
      for (let i = 0; i < Math.round(secs / DT); i++) {
        vx = accel > 0 ? Math.min(cap, vx + accel * DT) : Math.max(cap, vx + accel * DT);
        const st: ScanState = {
          tick, period: 1, clock: 1200 - tick * DT, phase: tick < 30 ? 'faceoffSetup' : 'live',
          skaters: [skater({ vel: { x: vx, y: 0 } }), skater({ id: 'bench', onIce: false })],
        };
        sc.onStep(st);
        tick++;
      }
    };
    step(0, 2, 0); // standing at the faceoff (drop at tick 30)
    step(8, 2.5, 8.5); // sprint up to 8.5 m/s
    step(-9, 1.2, 0); // hard stop
    step(-6, 4, -4); // away backward (facing stays 0) and hold 4 m/s
    step(5, 1, 0); // slow to a stand
    const ms = sc.momentsFor('a');
    const at = (k: string) => ms.find((m) => m.kind === k)?.tick ?? -1;
    for (const k of ['sprint', 'stop', 'backward', 'faceoff']) expect(at(k), k).toBeGreaterThanOrEqual(0);
    expect(at('faceoff')).toBe(0);
    expect(at('sprint')).toBeLessThan(at('stop'));
    expect(at('stop')).toBeLessThan(at('backward'));
    // A lead-in of a second before the backward stretch, which starts after the stop (2 + 2.5 + about 1 s in).
    expect(at('backward') * DT).toBeGreaterThan(4);
    expect(sc.momentsFor('bench')).toEqual([]);
  });
});
