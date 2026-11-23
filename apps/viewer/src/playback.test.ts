import { describe, expect, it } from 'vitest';
import { createGame, generateTeam, simulateGame, type GameSetup } from '@hockey/engine';
import { createPlayback, lerpAngle } from './playback';

const setup = (seed: number): GameSetup => {
  const home = generateTeam(seed * 2 + 1, 'Harbour City', 'HBR');
  const away = generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK');
  return { home, away, seed, chemistry: [] };
};

describe('playback', () => {
  it('reaches the same final score as an unwatched sim', () => {
    const p = createPlayback(setup(42));
    const r = simulateGame(setup(42));
    expect(p.result.score).toEqual(r.score);
    expect(p.events.length).toBe(r.events.length);
  });

  it('seeking back and forward lands on the same state as playing through', () => {
    // One playback: the first seek forward from tick 0 is the straight run; the later seeks go far ahead, back, and forward again.
    const p = createPlayback(setup(7));
    p.seek(9000);
    const straight = JSON.stringify(p.frame().next);
    p.seek(20000); p.seek(300); p.seek(9000);
    expect(JSON.stringify(p.frame().next)).toBe(straight);
    // And it is the state the engine itself reaches by stepping.
    const g = createGame(setup(7));
    for (let i = 0; i < 9001; i++) g.step();
    expect(straight).toBe(JSON.stringify(g.state));
  });

  it('advance moves display time, alpha stays in [0, 1) and the end clamps', () => {
    const p = createPlayback(setup(3));
    p.seek(100);
    p.advance(0.05);
    const f = p.frame();
    expect(f.tick).toBe(101);
    expect(f.alpha).toBeGreaterThanOrEqual(0); expect(f.alpha).toBeLessThan(1);
    expect(f.next.tick - f.prev.tick).toBe(1);

    p.seek(p.totalTicks + 500);
    expect(p.frame().tick).toBe(p.totalTicks);
    p.advance(10);
    expect(p.frame().tick).toBe(p.totalTicks);
    p.seek(-5);
    expect(p.frame().tick).toBe(0);
  });

  it('lerpAngle goes the short way round', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});
