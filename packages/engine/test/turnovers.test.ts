import { describe, it, expect } from 'vitest';
import { DT } from '../src/constants';
import { buildResult } from '../src/stats';
import { confirmTurnover, heldSeconds, watchTurnover } from '../src/turnovers';
import { TUNING } from '../src/tuning';
import type { GameEvent, GameState } from '../src/types';
import { gameSetup, stateWith } from './helpers';

const B = TUNING.boxScore;
const ticks = (s: number): number => Math.round(s / DT);

/** Home's RW has carried the puck for `held` s when away's C takes it off him cleanly (as poke-check.ts reports it). */
function cleanStrip(held: number): GameState {
  const st = stateWith({ carrier: 'home', puckX: 0 });
  st.touches = { side: 'home', ids: ['home-RW'], ticks: [0] };
  st.tick = ticks(held);
  watchTurnover(st, 'away', 'away-C', 'home-RW', 'poke', { held: heldSeconds(st, 'home-RW') });
  st.carrierId = 'away-C'; st.possession = 'away'; st.lastTouch = { id: 'away-C', side: 'away' };
  return st;
}

/** Runs confirmTurnover for `seconds` of ticks; the events it returns. */
function keep(st: GameState, seconds: number, each?: (st: GameState) => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks(seconds); i++) { st.tick++; each?.(st); const e = confirmTurnover(st); if (e) out.push(e); }
  return out;
}

describe('box-score takeaways and giveaways', () => {
  it('a clean strip that ends a possession counts as a takeaway once the taker\'s team has kept the puck', () => {
    const st = cleanStrip(B.controlSeconds + 1);
    expect(keep(st, B.keepSeconds - 0.2)).toEqual([]);
    const e = keep(st, 0.4);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ type: 'takeaway', side: 'away', playerId: 'away-C', otherId: 'home-RW', detail: { how: 'poke', atTick: ticks(B.controlSeconds + 1) } });
  });
  it('a strip of a puck the man had only just got is not a takeaway (a scramble, not a possession)', () => {
    expect(keep(cleanStrip(B.controlSeconds - 0.5), 4)).toEqual([]);
  });
  it('a strip after which the other team gets the puck straight back is not a takeaway', () => {
    expect(keep(cleanStrip(5), 4, (st) => { if (st.tick > ticks(5.5)) { st.possession = 'home'; st.carrierId = 'home-C'; } })).toEqual([]);
  });
  it('a pass picked off from a passer under no pressure is his giveaway; under pressure it is nobody\'s', () => {
    const calm = stateWith({ carrier: 'away', puckX: 0, carrierSlot: 'LD' });
    watchTurnover(calm, 'away', 'away-LD', 'home-C', 'intercepted', { passPressure: B.unforcedPressure - 0.2 });
    expect(keep(calm, B.keepSeconds + 0.1)).toEqual([expect.objectContaining({ type: 'giveaway', side: 'home', playerId: 'home-C', otherId: 'away-LD' })]);
    const rushed = stateWith({ carrier: 'away', puckX: 0, carrierSlot: 'LD' });
    watchTurnover(rushed, 'away', 'away-LD', 'home-C', 'intercepted', { passPressure: B.unforcedPressure + 0.2 });
    expect(keep(rushed, B.keepSeconds + 0.1)).toEqual([]);
  });
  it('the box score counts takeaways and giveaways, not raw turnovers', () => {
    const setup = gameSetup(1);
    const [a, b] = [setup.home.players[0]!.id, setup.away.players[0]!.id];
    const base = { tick: 1, period: 1, clock: 1000, assistIds: [], pos: { x: 0, y: 0 } };
    const turnover: GameEvent = { ...base, type: 'turnover', side: 'home', playerId: a, otherId: b, detail: { how: 'poke' } };
    const takeaway: GameEvent = { ...base, type: 'takeaway', side: 'home', playerId: a, otherId: b, detail: { how: 'poke', atTick: 1 } };
    const giveaway: GameEvent = { ...base, type: 'giveaway', side: 'away', playerId: b, otherId: a, detail: { how: 'intercepted', atTick: 1 } };
    const r = buildResult(setup, [turnover, turnover, takeaway, giveaway], new Map());
    expect(r.team.home.takeaways).toBe(1); expect(r.team.away.giveaways).toBe(1);
    expect(r.players.find((p) => p.id === a)!.takeaways).toBe(1); expect(r.players.find((p) => p.id === b)!.giveaways).toBe(1);
  });
  // Task 9 close-out ruling 6: a goalie's `stop` of a puck that was not shot is no save and no shot against.
  it('a goalie stopping a puck that was not shot is no save, no shot against and no shot', () => {
    const setup = gameSetup(1);
    const a = setup.home.players[0]!.id, goalie = setup.away.lines.goalie;
    const base = { tick: 1, period: 1, clock: 1000, assistIds: [], pos: { x: 0, y: 0 } };
    const stop: GameEvent = { ...base, type: 'stop', side: 'away', playerId: goalie, otherId: a, detail: { pose: 'pad', kind: 'held', speed: 6 } };
    const r = buildResult(setup, [stop], new Map());
    const g = r.players.find((p) => p.id === goalie)!;
    expect(g.saves).toBe(0); expect(g.shotsAgainst).toBe(0); expect(r.team.home.shots).toBe(0); expect(r.team.home.attempts).toBe(0);
  });
});
