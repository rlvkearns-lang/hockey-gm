import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createGame, restoreGame, simulateGame, DT } from '@hockey/engine';
import { createCursor, lerpAngle, type Playback, type Recording } from './playback';
import { SHARED_SEED, sharedPlayback, sharedRecording, testSetup as setup } from './test/game';

describe('playback', () => {
  let shared: Playback;
  let rec: Recording;
  beforeAll(() => {
    rec = sharedRecording();
    shared = createCursor(setup(SHARED_SEED), rec);
  });

  it('onStep sees every tick of the first run once, in order', () => {
    // The shared game was recorded with onStep counting the ticks it saw (test/global-setup.ts).
    const seen = inject('onStepSeen');
    expect(seen.count).toBe(rec.totalTicks + 1);
    expect(seen.inOrder).toBe(true);
  });

  it('reaches the same final score as an unwatched sim', () => {
    const r = simulateGame(setup(SHARED_SEED));
    expect(shared.result.score).toEqual(r.score);
    expect(shared.events.length).toBe(r.events.length);
  });

  it('seeking back and forward lands on the same state as playing through', () => {
    const a = createCursor(setup(SHARED_SEED), rec); a.seek(9000);
    const b = createCursor(setup(SHARED_SEED), rec); b.seek(20000); b.seek(300); b.seek(9000);
    expect(JSON.stringify(b.frame().next)).toBe(JSON.stringify(a.frame().next));
    // And it is the state the engine itself reaches by stepping.
    const g = createGame(setup(SHARED_SEED));
    for (let i = 0; i < 9001; i++) g.step();
    expect(JSON.stringify(a.frame().next)).toBe(JSON.stringify(g.state));
  });

  it('a backward seek to a tick off a snapshot boundary matches playing straight through', () => {
    const p = createCursor(setup(SHARED_SEED), rec);
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

  it('a recording is plain data: it survives a JSON round trip (as a worker would post it) and plays the same', () => {
    const copy = JSON.parse(JSON.stringify(rec)) as Recording;
    const a = createCursor(setup(SHARED_SEED), copy);
    shared.seek(40000); a.seek(40000);
    expect(JSON.stringify(a.frame().next)).toBe(JSON.stringify(shared.frame().next));
    expect(copy.totalTicks).toBe(rec.totalTicks);
    expect(copy.cuts).toEqual(rec.cuts);
  });

  it('restoring a snapshot with no event log gives the same later events and the same final result as with the log so far', () => {
    const s = rec.snapshots[Math.floor((rec.totalTicks - 20000) / rec.every)]!;
    const withLog = restoreGame(setup(SHARED_SEED), s.state, rec.events.slice(0, s.eventCount));
    const without = restoreGame(setup(SHARED_SEED), s.state, []);
    while (!withLog.done) withLog.step();
    while (!without.done) without.step();
    expect(JSON.stringify(without.drainEvents())).toBe(JSON.stringify(withLog.drainEvents()));
    expect(JSON.stringify(without.state)).toBe(JSON.stringify(withLog.state));
    expect(withLog.result().score).toEqual(rec.result.score);
    expect(without.state.score).toEqual(rec.result.score);
  });

  it('after several seeks, playing on to the end reaches the recording\'s final score', () => {
    const p = createCursor(setup(SHARED_SEED), rec);
    for (const t of [50000, 300, 90000, 12345, rec.totalTicks - 9000]) { p.seek(t); p.frame(); }
    // Play the last five minutes of game time at 30 frames a second.
    while (p.frame().tick < p.totalTicks) p.advance(1 / 30);
    const end = p.frame().next;
    expect(end.phase).toBe('final');
    expect(end.score).toEqual(rec.result.score);
    expect(end.tick).toBe(rec.totalTicks);
  });

  it('records the ticks the engine cuts at: every faceoff set-up and every change of ends', () => {
    expect(rec.cuts.length).toBeGreaterThan(20);
    const p = createCursor(setup(SHARED_SEED), rec);
    for (const c of rec.cuts.slice(0, 12)) {
      p.seek(c - 1);
      const f = p.frame();
      const restart = f.next.phase === 'faceoffSetup' && f.prev.phase !== 'faceoffSetup';
      const ends = f.next.attackDir.home !== f.prev.attackDir.home;
      const far = Math.hypot(f.next.puck.pos.x - f.prev.puck.pos.x, f.next.puck.pos.y - f.prev.puck.pos.y) > 60 * DT + 0.3;
      expect(restart || ends || far).toBe(true);
    }
    // Period starts are among them.
    const periodEnds = rec.events.filter((e) => e.type === 'periodEnd').map((e) => e.tick);
    for (const t of periodEnds.slice(0, -1)) expect(rec.cuts.some((c) => c > t && c <= t + 2)).toBe(true);
  });
});
