import { it, expect } from 'vitest';
import { simulateGame } from '../src/game';
import { gameSetup } from './helpers';

/**
 * A fixed small workload that does the kind of work the engine does (float maths, square roots, small objects read and
 * written in arrays, short-lived copies), and none of the engine's code: its CPU time is this machine's speed right now. Returns a checksum
 * so it cannot be optimised away.
 */
function referenceWorkload(): number {
  const n = 64;
  let ps = Array.from({ length: n }, (_, i) => ({ x: (i * 7) % 60 - 30, y: (i * 13) % 26 - 13, vx: ((i * 5) % 11) - 5, vy: ((i * 3) % 7) - 3 }));
  let sum = 0;
  for (let t = 0; t < 400_000; t++) {
    // A fresh copy now and then: short-lived objects for the garbage collector, as the engine makes.
    if (t % 20 === 0) ps = ps.map((p) => ({ ...p }));
    for (let i = 0; i < n; i++) {
      const p = ps[i]!;
      // Steer toward the next one, cap the speed, bounce off the boards.
      const q = ps[(i + 1) % n]!;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      p.vx += (dx / d) * 0.1; p.vy += (dy / d) * 0.1;
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (v > 9) { p.vx *= 9 / v; p.vy *= 9 / v; }
      p.x += p.vx / 60; p.y += p.vy / 60;
      if (p.x > 30 || p.x < -30) p.vx = -p.vx;
      if (p.y > 13 || p.y < -13) p.vy = -p.vy;
      sum += d;
    }
  }
  return sum;
}

/** CPU seconds (user + system, this process) that `f` takes. */
function cpuSeconds(f: () => unknown): number {
  const c0 = process.cpuUsage();
  f();
  const c = process.cpuUsage(c0);
  return (c.user + c.system) / 1e6;
}

/**
 * The CPU time of five full games over the CPU time of the reference workload run five times in the same process, once
 * before each game (after one warm-up), so a slow or busy machine cancels out.
 * Recorded at Task 13b (2026-11-25, 7f1a4b9's play): 6.9 to 7.5 over four runs, 6.6 to 7.5 with three copies running at
 * once (when the wall clock read 2.27 to 2.48 s): PERF_RATIO_BASELINE. A change that makes the engine more than
 * PERF_RATIO_TOLERANCE slower than that fails; Task 14 and later tasks that change play on purpose re-record it.
 */
const PERF_RATIO_BASELINE = 7.1;
const PERF_RATIO_TOLERANCE = 0.25;

/**
 * `npm run test` runs this file on its own, after the rest of the suite.
 * 1. Wall clock, a loose check: the best (fastest) of five full games under 2.5 s.
 * 2. The stable one: five games' CPU time against the reference workload's (a ratio), within PERF_RATIO_TOLERANCE of
 *    the recorded baseline.
 */
it('a game runs within budget: best of five under 2.5 s wall clock, and five games\' CPU time against a reference workload within tolerance of its baseline', () => {
  referenceWorkload();
  const ms: number[] = [];
  let cpu = 0, ref = 0;
  for (let seed = 1; seed <= 5; seed++) {
    // The reference beside each game, so both see the machine as it is at that moment.
    ref += cpuSeconds(referenceWorkload);
    const t = performance.now();
    cpu += cpuSeconds(() => simulateGame(gameSetup(seed)));
    ms.push(performance.now() - t);
  }
  const ratio = cpu / ref;
  console.log(`perf: best game ${Math.min(...ms).toFixed(0)} ms, five games ${cpu.toFixed(2)} s CPU, reference ${ref.toFixed(2)} s CPU, ratio ${ratio.toFixed(1)} (baseline ${PERF_RATIO_BASELINE})`);
  expect(Math.min(...ms)).toBeLessThan(2500);
  expect(ratio).toBeLessThan(PERF_RATIO_BASELINE * (1 + PERF_RATIO_TOLERANCE));
}, 120_000);
