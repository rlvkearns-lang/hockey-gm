import { describe, it, expect } from 'vitest';
import { createObserver, measuresOf, type Observer } from './measures';
import { NHL_REFERENCE } from '../scripts/nhl-reference';
import { defs, skater, stateWith, tactics } from './helpers';
import type { GameEvent, GameEventOf, GameEventType, GameSetup, GameState, EventDetails, PlayerDef, TeamDef } from '../src/types';

/** A setup holding the ten skaters stateWith puts on the ice (their defs from helpers' `defs`). */
function gameSetupOf(st: GameState): GameSetup {
  const team = (side: 'home' | 'away'): TeamDef => ({
    id: side, name: side, abbr: side, tactics: tactics[side],
    players: st.skaters.filter((s) => s.side === side).map((s) => defs.get(s.id)!) as PlayerDef[],
    lines: { forwards: [], defence: [], goalie: `${side}-G` },
  });
  return { home: team('home'), away: team('away'), seed: 1, chemistry: [] };
}

/** An event of `type` on the state's current tick. */
function ev<T extends GameEventType>(st: GameState, type: T, o: { side: 'home' | 'away' | null; playerId: string | null; otherId?: string | null; detail: EventDetails[T] }): GameEvent {
  const e: GameEventOf<T> = {
    type, tick: st.tick, period: st.period, clock: st.clock, side: o.side, playerId: o.playerId, otherId: o.otherId ?? null,
    assistIds: [], pos: { x: st.puck.pos.x, y: st.puck.pos.y }, detail: o.detail,
  };
  return e as GameEvent;
}

/** Ticks the observer `n` times on `st` (st.tick++ before each); `events` arrive on the first of them. */
function feed(obs: Observer, st: GameState, n: number, events: GameEvent[] = []): void {
  for (let i = 0; i < n; i++) {
    st.tick++;
    for (const e of events) e.tick = st.tick;
    obs.tick(st, i === 0 ? events : []);
  }
}

const runOf = (obs: Observer): { counters: ReturnType<Observer['counters']>; maxPuckJump: number } => ({ counters: obs.counters(), maxPuckJump: obs.maxPuckJump() });

describe('play measures: definitions', () => {
  it('standing still is under 0.5 m/s for a skater who is not the carrier, down, leaving or steered', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    skater(st, 'away', 'LD').vel = { x: 0.4, y: 0 }; skater(st, 'away', 'RD').vel = { x: 0.6, y: 0 }; skater(st, 'away', 'C').downT = 1;
    for (const s of st.skaters) if (s.side === 'home' || s.slot === 'LW' || s.slot === 'RW') s.onIce = false;
    feed(obs, st, 30); const c = obs.counters();
    expect(c.skaterTicks).toBe(60); expect(c.stationaryTicks).toBe(30);
  });

  it('a skater steered by a contest is not counted; one free in it is', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    for (const s of st.skaters) if (s.side === 'home' || s.slot !== 'LD' && s.slot !== 'RD') s.onIce = false;
    skater(st, 'away', 'LD').contestId = 7; skater(st, 'away', 'RD').contestId = 7;
    st.contests = [{ id: 7, kind: 'netFront', stage: 'jostle', stageT: 0, participants: ['away-LD', 'away-RD'], leader: null, spot: { x: 0, y: 0 }, freeIds: ['away-RD'], roles: { attacker: 'away-LD', defender: 'away-RD' }, data: { rounds: 0, outX: 0, outY: 0 } }];
    feed(obs, st, 10);
    expect(obs.counters().skaterTicks).toBe(10);
  });

  it('a pass is completed only when its intended receiver is the next carrier', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    st.carrierId = null;
    feed(obs, st, 1, [ev(st, 'pass', { side: 'home', playerId: 'home-RW', otherId: 'home-C', detail: { kind: 'pass', distance: 5, hand: 'forehand' } })]);
    feed(obs, st, 3);
    st.carrierId = 'home-LW';
    feed(obs, st, 1);
    const run = runOf(obs);
    expect(run.counters.passes).toBe(1);
    expect(measuresOf([run]).passCompletion).toBe(0);
    // and the same pass taken by home-C is completed
    st.carrierId = null;
    feed(obs, st, 1, [ev(st, 'pass', { side: 'home', playerId: 'home-LW', otherId: 'home-C', detail: { kind: 'pass', distance: 5, hand: 'forehand' } })]);
    st.carrierId = 'home-C';
    feed(obs, st, 1);
    expect(obs.counters().passesCompleted).toBe(1);
  });

  it('a point pass that slides out over the blue line is not kept', () => {
    const st = stateWith({ carrier: 'home', puckX: 20, carrierSlot: 'C' }); const obs = createObserver(gameSetupOf(st));
    st.carrierId = null;
    feed(obs, st, 1, [ev(st, 'pass', { side: 'home', playerId: 'home-C', otherId: 'home-LD', detail: { kind: 'pass', distance: 6, hand: 'forehand' } })]);
    for (let k = 1; k <= 10; k++) { st.puck.pos.x = 20 - 1.3 * k; feed(obs, st, 1); }
    st.carrierId = 'home-LD';
    feed(obs, st, 1);
    const c = obs.counters();
    expect(c.pointPasses).toBe(1); expect(c.pointPassesKept).toBe(0); expect(c.pointPassesCompleted).toBe(0);
    expect(c.passesCompleted).toBe(1);
  });

  it('a point pass held inside the line until the defenceman takes it is kept', () => {
    const st = stateWith({ carrier: 'home', puckX: 20, carrierSlot: 'C' }); const obs = createObserver(gameSetupOf(st));
    st.carrierId = null;
    feed(obs, st, 1, [ev(st, 'pass', { side: 'home', playerId: 'home-C', otherId: 'home-LD', detail: { kind: 'pass', distance: 6, hand: 'forehand' } })]);
    for (let k = 1; k <= 10; k++) { st.puck.pos.x = 20 - 0.5 * k; feed(obs, st, 1); }
    st.carrierId = 'home-LD';
    feed(obs, st, 1);
    const c = obs.counters();
    expect(c.pointPasses).toBe(1); expect(c.pointPassesKept).toBe(1); expect(c.pointPassesCompleted).toBe(1);
  });

  it('a rebound chance is an attempt within 3 s of a save with no stoppage and no defending carrier between', () => {
    const shot = (st: GameState): GameEvent => ev(st, 'release', { side: 'home', playerId: 'home-C', detail: { kind: 'shot', toId: null, vel: { x: 30, y: 0, z: 0 }, shotType: 'wrist' } });
    const save = (st: GameState): GameEvent => ev(st, 'save', { side: 'away', playerId: 'away-G', otherId: 'home-RW', detail: { pose: 'pad', kind: 'rebound', cross: { side: -0.4, height: 0.1 } } });
    const st = stateWith({ carrier: 'home', puckX: 20 }); const obs = createObserver(gameSetupOf(st));
    st.carrierId = null;
    feed(obs, st, 30, [save(st)]);
    feed(obs, st, 1, [shot(st)]);
    let c = obs.counters();
    expect(c.saves).toBe(1); expect(c.attempts).toBe(1); expect(c.reboundChances).toBe(1);
    // a defending carrier in between: no rebound chance
    feed(obs, st, 1, [save(st)]);
    st.carrierId = 'away-LD'; feed(obs, st, 1); st.carrierId = null;
    feed(obs, st, 1, [shot(st)]);
    // more than 3 s later: none
    feed(obs, st, 1, [save(st)]); feed(obs, st, 95);
    feed(obs, st, 1, [shot(st)]);
    // a stoppage in between: none
    feed(obs, st, 1, [save(st)]); st.phase = 'stopped'; feed(obs, st, 1); st.phase = 'live';
    feed(obs, st, 1, [shot(st)]);
    c = obs.counters();
    expect(c.attempts).toBe(4); expect(c.reboundChances).toBe(1);
  });

  it('a puck that moves 3 m in a tick at 6 m/s is a jump of about 2.8 m', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    st.puck.vel = { x: 6, y: 0 };
    feed(obs, st, 1);
    st.puck.pos.x += 3;
    feed(obs, st, 1);
    expect(obs.maxPuckJump()).toBeGreaterThan(2.7); expect(obs.maxPuckJump()).toBeLessThan(2.9);
    expect(obs.counters().puckJumpTicks).toBe(1);
  });

  it('two opponents in contact for 10 ticks in a row count once', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    for (const s of st.skaters) if (s.slot !== 'C') s.onIce = false;
    skater(st, 'home', 'C').pos = { x: 0, y: 0 }; skater(st, 'away', 'C').pos = { x: 0.9, y: 0 };
    feed(obs, st, 9);
    expect(obs.counters().contactOver03).toBe(0);
    feed(obs, st, 20);
    expect(obs.counters().contactOver03).toBe(1);
  });

  it('a battle winner comes away when he is the next carrier within 1.5 s; toWinner checks the man who won it', () => {
    const st = stateWith({ carrier: null, puckX: 20 }); const obs = createObserver(gameSetupOf(st));
    const battle = ev(st, 'battle', { side: 'home', playerId: 'home-LW', otherId: 'away-RD', detail: { how: 'pinned', contestId: 3 } });
    const end = ev(st, 'contestEnd', { side: null, playerId: 'home-C', detail: { contestId: 3, kind: 'boardBattle', result: 'pinned', winnerId: 'home-C', puck: 'toWinner' } });
    st.carrierId = 'home-C';
    feed(obs, st, 1, [battle, end]);
    let c = obs.counters();
    expect(c.battlesDecided).toBe(1); expect(c.battleWinnerCameAway).toBe(0);
    expect(c.battleToWinner).toBe(1); expect(c.battleToWinnerIsWinner).toBe(0);
    st.carrierId = null;
    feed(obs, st, 1, [ev(st, 'battle', { side: 'home', playerId: 'home-LW', otherId: 'away-RD', detail: { how: 'stick', contestId: 4 } })]);
    feed(obs, st, 20); st.carrierId = 'home-LW'; feed(obs, st, 1);
    feed(obs, st, 1, [ev(st, 'contestEnd', { side: null, playerId: null, detail: { contestId: 5, kind: 'boardBattle', result: 'lostTouch', winnerId: null, puck: 'unchanged' } })]);
    c = obs.counters();
    expect(c.battlesDecided).toBe(2); expect(c.battleWinnerCameAway).toBe(1); expect(c.battlesNoWinner).toBe(1);
  });

  it('every measure is finite on an empty run', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const obs = createObserver(gameSetupOf(st));
    for (const v of Object.values(measuresOf([runOf(obs)]))) expect(Number.isFinite(v)).toBe(true);
  });

  it('reference rows name a source, and unverified numbers say so', () => {
    for (const r of NHL_REFERENCE) { expect(r.source.length).toBeGreaterThan(3); if (r.nhl !== null) expect(r.season).not.toBeNull(); expect(r.band[0]).toBeLessThan(r.band[1]); }
    for (const k of ['goals', 'shots', 'attempts', 'savePct', 'hits', 'blocks', 'takeaways', 'giveaways', 'faceoffsTotal', 'favouriteWinShare', 'stationaryShare', 'pointPassKeptShare', 'battleWinnerCameAwayShare'])
      expect(NHL_REFERENCE.some((r) => r.key === k)).toBe(true);
  });
});
