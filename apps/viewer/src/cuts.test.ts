import { describe, expect, it } from 'vitest';
import { createGame, DT, generateTeam, type GameState } from '@hockey/engine';
import { emptyProbe, goalieJumped, isCut, jumped, lastCutAtOrBefore, probeOf, puckJumped, skaterJumped } from './cuts';

const state = (): GameState => {
  const g = createGame({ home: generateTeam(11, 'Harbour City', 'HBR'), away: generateTeam(12, 'Northern Peaks', 'NPK'), seed: 5, chemistry: [] });
  for (let i = 0; i < 200; i++) g.step();
  return structuredClone(g.state);
};

describe('engine cuts', () => {
  it('ordinary motion over one or several ticks is not a cut', () => {
    const a = state(), b = structuredClone(a);
    b.tick += 1; b.puck.pos.x += 30 * DT; b.goalies.home.pos.y += 0.1; b.skaters[0]!.pos.x += 9 * DT;
    expect(isCut(probeOf(a), b)).toBe(false);
    b.tick += 9; b.puck.pos.x += 40 * 9 * DT;
    expect(isCut(probeOf(a), b)).toBe(false);
  });

  it('play restarting at a faceoff, the teams changing ends, or a teleport is a cut', () => {
    const a = state();
    const restart = structuredClone(a); restart.tick++; a.phase = 'stopped'; restart.phase = 'faceoffSetup';
    expect(isCut(probeOf(a), restart)).toBe(true);
    expect(puckJumped(probeOf(a), restart)).toBe(true);
    const ends = structuredClone(a); ends.tick++; ends.attackDir = { home: -a.attackDir.home as 1 | -1, away: a.attackDir.home };
    expect(isCut(probeOf(a), ends)).toBe(true);
    expect(goalieJumped(probeOf(a), ends, 'home')).toBe(true);
    const tp = structuredClone(a); tp.tick++; tp.goalies.away.pos.x += 5;
    expect(isCut(probeOf(a), tp)).toBe(true);
    expect(goalieJumped(probeOf(a), tp, 'away')).toBe(true);
    expect(goalieJumped(probeOf(a), tp, 'home')).toBe(false);
    const i = a.skaters.findIndex((s) => s.onIce);
    const sk = structuredClone(a); sk.tick++; sk.skaters[i]!.pos.y += 4;
    expect(isCut(probeOf(a), sk)).toBe(true);
    expect(skaterJumped(probeOf(a), sk, i)).toBe(true);
  });

  it('a skater stepping on at the door is not a cut; the same tick or an earlier one never is', () => {
    const a = state();
    const i = a.skaters.findIndex((s) => !s.onIce);
    const b = structuredClone(a); b.tick++; b.skaters[i]!.onIce = true; b.skaters[i]!.pos = { x: 50, y: -40 };
    expect(isCut(probeOf(a), b)).toBe(false);
    expect(isCut(probeOf(a), a)).toBe(false);
    expect(isCut(emptyProbe(), b)).toBe(false);
  });

  it('jumped allows the distance a speed covers, plus slack; lastCutAtOrBefore finds the latest cut', () => {
    expect(jumped(0, 0, 60 * DT, 0, 1, 60)).toBe(false);
    expect(jumped(0, 0, 60 * DT + 0.5, 0, 1, 60)).toBe(true);
    expect(jumped(NaN, NaN, 9, 9, 1, 1)).toBe(false);
    expect(lastCutAtOrBefore([10, 20, 30], 5)).toBe(-1);
    expect(lastCutAtOrBefore([10, 20, 30], 20)).toBe(20);
    expect(lastCutAtOrBefore([10, 20, 30], 29)).toBe(20);
    expect(lastCutAtOrBefore([10, 20, 30], 99)).toBe(30);
  });
});
