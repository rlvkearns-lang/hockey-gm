import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, generateTeam, simulateGame, type GameSetup } from '@hockey/engine';
import { createPlayback, lerpAngle, type Playback } from './playback';

const setup = (seed: number): GameSetup => {
  const home = generateTeam(seed * 2 + 1, 'Harbour City', 'HBR');
  const away = generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK');
  return { home, away, seed, chemistry: [] };
};

describe('playback', () => {
  let shared: Playback;
  beforeAll(() => { shared = createPlayback(setup(3)); });

  it('reaches the same final score as an unwatched sim', () => {
    const r = simulateGame(setup(3));
    expect(shared.result.score).toEqual(r.score);
    expect(shared.events.length).toBe(r.events.length);
  });

  it('seeking back and forward lands on the same state as playing through', () => {
    const a = createPlayback(setup(7)); a.seek(9000);
    const b = createPlayback(setup(7)); b.seek(20000); b.seek(300); b.seek(9000);
    expect(JSON.stringify(b.frame().next)).toBe(JSON.stringify(a.frame().next));
    // And it is the state the engine itself reaches by stepping.
    const g = createGame(setup(7));
    for (let i = 0; i < 9001; i++) g.step();
    expect(JSON.stringify(a.frame().next)).toBe(JSON.stringify(g.state));
  });

  it('a backward seek to a tick off a snapshot boundary matches playing straight through', () => {
    const p = createPlayback(setup(5));
    p.seek(9001);
    const straight = JSON.stringify(p.frame().next);
    p.seek(7777);
    expect(p.frame().tick).toBe(7777);
    expect(p.frame().next.tick).toBe(7778);
    p.seek(9001);
    expect(JSON.stringify(p.frame().next)).toBe(straight);
  });

  it('advance moves display time and alpha stays in [0, 1)', () => {
    shared.seek(100);
    shared.advance(0.05);
    const f = shared.frame();
    expect(f.tick).toBe(101);
    expect(f.alpha).toBeGreaterThanOrEqual(0); expect(f.alpha).toBeLessThan(1);
    expect(f.next.tick - f.prev.tick).toBe(1);
  });

  it('clamps at the end of the game', () => {
    shared.seek(shared.totalTicks + 500);
    expect(shared.frame().tick).toBe(shared.totalTicks);
    shared.advance(10);
    expect(shared.frame().tick).toBe(shared.totalTicks);
    shared.seek(-5);
    expect(shared.frame().tick).toBe(0);
  });

  it('lerpAngle goes the short way round', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});
