import { describe, it, expect } from 'vitest';
import { simulateGame } from '../../src/game';
import { distToBoards, FACEOFF_DOTS } from '../../src/rink';
import { bladePos } from '../../src/blade';
import { brainTick } from '../../src/brain';
import { startContest } from '../../src/contests/core';
import { boardBattleContest } from '../../src/contests/board-battle';
import { supportTarget } from '../../src/team-play';
import { segDistXY } from '../../src/vec';
import type { GameEvent, GameEventOf, PlayerDef } from '../../src/types';
import {
  battleWithThirdMan, count, def, even, heldPuckInGame, runBattle, runBattleLogged, runBattleWon, setup, share, shareOf, stagesOf, totalSeconds,
  trappedBattle, shieldAlongBoards, puckIntoFeet, battleWonOffCarrier, harness, harnessStep, place2, BATTLE_SPOT, type Harness,
} from '../helpers';

// ---- Task 9 harness: seeded battles played out, then 1 s more with a pass taken at the receiver's blade ----

type Seeded = {
  /** The battle event (undefined when the puck was trapped), the board battle's contestEnd, and every event. */
  battle: GameEventOf<'battle'>; end: GameEventOf<'contestEnd'>; events: GameEvent[];
  /** The carrier on the tick the battle ended, and the first carrier within 1 s after it (null: none). */
  carrierAfter: string | null; carrierWithin1s: string | null;
  /** The battle winner's distance (m) from the boards 0.5 s after it ended (null: no winner). */
  winnerOffBoards: number | null;
};

/** After a board battle: a pass is taken when it comes within the receiver's blade reach (0.75 m) this tick. */
function takePass(h: Harness, prev: { x: number; y: number }): void {
  const st = h.st, pass = st.pendingPass;
  if (st.carrierId !== null || pass === null) return;
  const r = st.skaters.find((k) => k.id === pass.toId)!;
  const b = bladePos(r.pos, r.facing, h.ds.get(r.id)!.shoots, { x: 0, y: 0 });
  if (segDistXY(b.x, b.y, prev.x, prev.y, st.puck.pos.x, st.puck.pos.y) <= 0.75) { st.carrierId = r.id; st.pendingPass = null; }
}

/**
 * A board battle at BATTLE_SPOT between `a` (home C) and `b` (away C) with harness seed `seed`, as runBattle sets it
 * up; `supportFor` 'both' gives each side a supporting LW. Played out, then 1 s more.
 */
function runBattleSeeded(a: PlayerDef, b: PlayerDef, o: { seed: number; supportFor?: 'a' | 'b' | 'both' }): Seeded {
  const on = ['home-C', 'away-C'];
  if (o.supportFor === 'a' || o.supportFor === 'both') on.push('home-LW');
  if (o.supportFor === 'b' || o.supportFor === 'both') on.push('away-LW');
  const h = harness(on, { 'home-C': a, 'away-C': b }, { seed: o.seed });
  const st = h.st, S = BATTLE_SPOT;
  st.puck = { pos: { x: S.x, y: S.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  place2(st, 'home-C', S.x - 0.6, S.y - 0.5, 0); place2(st, 'away-C', S.x + 0.6, S.y - 0.5, Math.PI);
  if (on.includes('home-LW')) place2(st, 'home-LW', S.x - 1.5, S.y - 1.75, 0);
  if (on.includes('away-LW')) place2(st, 'away-LW', S.x + 1.5, S.y - 1.75, Math.PI);
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  for (let i = 0; i < 300 && st.contests.includes(c); i++) harnessStep(h);
  const end = h.events.find((e): e is GameEventOf<'contestEnd'> => e.type === 'contestEnd' && e.detail.contestId === c.id)!;
  const battle = h.events.find((e): e is GameEventOf<'battle'> => e.type === 'battle' && e.detail.contestId === c.id)!;
  const carrierAfter = st.carrierId;
  let carrierWithin1s: string | null = carrierAfter, winnerOffBoards: number | null = null;
  for (let i = 1; i <= 30 && st.phase === 'live'; i++) {
    const prev = { x: st.puck.pos.x, y: st.puck.pos.y };
    harnessStep(h);
    takePass(h, prev);
    carrierWithin1s ??= st.carrierId;
    if (i === 15 && battle !== undefined) winnerOffBoards = distToBoards(st.skaters.find((k) => k.id === battle.playerId)!.pos);
  }
  return { battle, end, events: h.events, carrierAfter, carrierWithin1s, winnerOffBoards };
}

/** A battle at the side boards at (5, 12.4) with a supporting LW for each side: where team play and the battle send each. */
function battleWithBothSupports(): { homeSupportTarget: { x: number; y: number }; awaySupportTarget: { x: number; y: number }; homeSteered: { x: number; y: number }; awaySteered: { x: number; y: number } } {
  const h = harness(['home-C', 'away-C', 'home-LW', 'away-LW'], {}, { seed: 9 });
  const st = h.st, S = { x: 5, y: 12.4 };
  st.puck = { pos: { x: S.x, y: S.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  place2(st, 'home-C', S.x - 0.6, S.y - 0.5, 0); place2(st, 'away-C', S.x + 0.6, S.y - 0.5, Math.PI);
  place2(st, 'home-LW', S.x - 1.5, S.y - 5, 0); place2(st, 'away-LW', S.x + 1.5, S.y - 5, Math.PI);
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  const homeSupportTarget = { ...supportTarget(st, 'home')! }, awaySupportTarget = { ...supportTarget(st, 'away')! };
  const lw = (id: string) => st.skaters.find((k) => k.id === id)!;
  lw('home-LW').target = { ...homeSupportTarget }; lw('away-LW').target = { ...awaySupportTarget };
  for (let i = 0; i < 90 && !(c.roles.supportA && c.roles.supportB) && st.contests.includes(c); i++) harnessStep(h);
  harnessStep(h);
  return { homeSupportTarget, awaySupportTarget, homeSteered: { ...lw('home-LW').target }, awaySteered: { ...lw('away-LW').target } };
}

/** Of `n` even battles that end with a clean win (toWinner), the share whose winner is over 1 m off the boards 0.5 s later. */
function winnerOffBoardsShare(n: number): number {
  let k = 0, off = 0;
  for (let seed = 1; k < n && seed < 10 * n; seed++) {
    const b = runBattleSeeded(even, even, { seed: 5000 + seed });
    if (b.end.detail.puck !== 'toWinner' || b.winnerOffBoards === null) continue;
    k++;
    if (b.winnerOffBoards > 1) off++;
  }
  return off / k;
}

/**
 * Of `n` board battles on a carrier along the boards (home C, skating slowly up ice with away C on his shoulder and two
 * teammates open; his brain runs every tick), the share whose protect ends `released` (he let the puck go).
 */
function releasedShare(n: number): number {
  let released = 0;
  for (let seed = 1; seed <= n; seed++) {
    const h = harness(['home-C', 'away-C', 'home-LW', 'home-RW'], {}, { carrier: 'home', puckX: BATTLE_SPOT.x + 0.6, puckY: BATTLE_SPOT.y, carrierSlot: 'C', seed: 7000 + seed });
    const st = h.st, S = BATTLE_SPOT;
    place2(st, 'home-C', S.x, S.y - 0.1, 0);
    const c0 = st.skaters.find((k) => k.id === 'home-C')!;
    c0.vel = { x: 2, y: 0 }; c0.target = { x: S.x + 20, y: S.y - 0.1 }; c0.speedCap = 0.3;
    place2(st, 'away-C', S.x + 0.3, S.y - 1, Math.PI / 2);
    place2(st, 'home-LW', S.x + 2, S.y - 8, 0); place2(st, 'home-RW', S.x + 6, S.y - 14, 0);
    st.puck.pos = { x: S.x + 0.6, y: S.y - 0.1 };
    const c = startContest(st, h.ds, h.rng, boardBattleContest, ['away-C', 'home-C'], h.events);
    for (let i = 0; i < 60 && st.contests.includes(c) && c.stage === 'protect'; i++) harnessStep(h, () => brainTick(st, h.ds, h.rng, h.events));
    const end = h.events.find((e) => e.type === 'contestEnd' && e.detail.contestId === c.id);
    if (end?.type === 'contestEnd' && end.detail.result === 'released') released++;
  }
  return released / n;
}

/** Whole-game tests take about 1.5 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

const pf = def({ strength: 92, balance: 88, compete: 85, weightKg: 102, stickChecking: 62, puckHandling: 66 });
const twoWay = def({ strength: 70, balance: 74, compete: 82, weightKg: 88, stickChecking: 88, puckHandling: 76, agility: 82 });

describe('board battles', () => {
  it('the power forward wins most board battles against the two-way forward, not all', () => { const s = share(3000, () => runBattle(pf, twoWay).winner === 'a'); expect(s).toBeGreaterThan(0.55); expect(s).toBeLessThan(0.75); });
  it('they win in different ways', () => {
    const r = Array.from({ length: 3000 }, () => runBattle(pf, twoWay));
    expect(shareOf(r.filter(x => x.winner === 'a'), x => x.detail === 'pinned')).toBeGreaterThan(shareOf(r.filter(x => x.winner === 'b'), x => x.detail === 'pinned') + 0.2);
    expect(shareOf(r.filter(x => x.winner === 'b'), x => x.detail === 'stick')).toBeGreaterThan(0.4);
  });
  it('a battle goes through visible stages and lasts 2 to 6 seconds', () => { const log = stagesOf(runBattleLogged(pf, twoWay)); expect(log.map(l => l.stage).slice(0, 3)).toEqual(['arrive', 'pin', 'dig']); expect(totalSeconds(log)).toBeGreaterThanOrEqual(2); expect(totalSeconds(log)).toBeLessThanOrEqual(6.5); });
  it('the leader is exposed while it runs', () => { expect(runBattleLogged(pf, twoWay).some(s => s.stage === 'pin' && s.leader !== null)).toBe(true); });
  // Task 9: a win by support has the winner pass it to his supporter (the pass is on its way when the battle ends).
  it('support swings it', () => { const withHelp = share(3000, () => runBattle(twoWay, pf, { supportFor: 'a' }).winner === 'a'); expect(withHelp).toBeGreaterThan(share(3000, () => runBattle(twoWay, pf).winner === 'a') + 0.08); });
  it('first man in has an edge', () => { expect(share(3000, () => runBattle(even, even, { firstIn: 'a' }).winner === 'a')).toBeGreaterThan(0.53); });
  it('a stalemate is whistled dead', () => { expect(Array.from({ length: 3000 }, () => runBattle(even, even)).some(x => x.winner === null && x.detail === 'trapped')).toBe(true); });
  // Task 9: a clean win (0.75 of them) leaves the puck on the winner's stick; won by support, it is passed to the supporter.
  it('a clean win leaves the puck on the winner\'s stick, three times in four', () => {
    const r = Array.from({ length: 2000 }, () => runBattle(even, even)).filter((x) => x.winner !== null);
    const clean = shareOf(r, (x) => x.puckTo !== 'loose');
    expect(clean).toBeGreaterThan(0.65); expect(clean).toBeLessThan(0.85);
    expect(r.filter((x) => x.puckTo !== 'loose').every((x) => x.puckTo === 'winner')).toBe(true);
  });
  it('a carrier along the boards can shield the puck and skate out of it, the stronger one more often', () => {
    const strong = def({ strength: 90, puckHandling: 88, balance: 85, weightKg: 100 });
    const weak = def({ strength: 50, puckHandling: 55, balance: 55, weightKg: 78 });
    const s = Array.from({ length: 600 }, () => shieldAlongBoards(strong, even)), w = Array.from({ length: 600 }, () => shieldAlongBoards(weak, even));
    const kept = (r: string[]) => shareOf(r, (x) => x === 'kept');
    expect(kept(s)).toBeGreaterThan(kept(w) + 0.15); expect(kept(s)).toBeLessThan(0.95); expect(kept(w)).toBeGreaterThan(0.05);
    expect(shareOf(w, (x) => x === 'lost')).toBeGreaterThan(0.3);
  });
  it('a battle won off the man who was carrying the puck is a turnover (clean or loose)', () => {
    const e = battleWonOffCarrier(def({ strength: 55, puckHandling: 55, balance: 55 }), def({ strength: 85, stickChecking: 85, compete: 85 }));
    expect(e.find((x) => x.type === 'turnover')).toMatchObject({ playerId: 'away-C', otherId: 'home-C', detail: { how: expect.stringMatching(/^battle(Loose)?$/) } });
  });
  it('a moving puck slides into their feet over a few ticks rather than stopping dead', () => {
    const r = puckIntoFeet();
    expect(r.steps[0]).toBeGreaterThan(0.02); expect(r.steps[1]).toBeGreaterThan(0.02);
    expect(r.steps.slice(8).every((x) => x < 1e-9)).toBe(true); expect(r.offSpot).toBeLessThan(1e-9);
  });
  // Task 9 close-out ruling 1: the 220 bar predates battles having winners and protects not being given up. Task 9 adds
  // about 15 decided battles a game (no-winner battles 18.9 -> 4.1) and 6 protects (released 7 -> 0): under 270 a game,
  // the mean of seeds 1-8 (about 105 of them net-front battles).
  it('a full game has plenty of battles', () => {
    const n = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => count(simulateGame(setup(seed)), 'battle'));
    const mean = n.reduce((a, b) => a + b, 0) / n.length;
    expect(mean).toBeGreaterThan(40); expect(mean).toBeLessThan(270);
  }, 8 * GAME_TIMEOUT);

  it('every tick shows the stage, its time, and who is pinned once someone is', () => {
    const log = runBattleLogged(pf, twoWay);
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1]!, b = log[i]!;
      if (a.stage === b.stage) expect(b.stageT).toBeGreaterThan(a.stageT);
    }
    const dig = log.filter((l) => l.stage === 'dig');
    expect(dig.length).toBeGreaterThan(0);
    // During the dig the pinned man (his id) is shown, or null when nobody could pin the other.
    expect(dig.every((l) => l.pinned === dig[0]!.pinned)).toBe(true);
  });
  it('the puck sits still in their feet while it runs: nobody carries it and nobody else takes it', () => {
    const r = heldPuckInGame(setup(3));
    expect(r.ticks).toBeGreaterThan(300);
    expect(r.carried).toBe(0);
    expect(r.maxStep).toBeLessThan(1e-9);
    expect(r.supported).toBeGreaterThan(0);
  }, GAME_TIMEOUT);
  it('a trapped puck stops play at the nearest end-zone dot inside the blue line', () => {
    const r = trappedBattle();
    expect(r.phase).toBe('stopped');
    expect(r.freeze?.type === 'freeze' && r.freeze.detail.cause).toBe('trapped');
    expect(r.faceoffSpot).toEqual(FACEOFF_DOTS.end[3]);
    expect(r.contests).toBe(0);
  });
  it('the man who wins comes away with the puck: on every clean win without a win by support, he is the carrier', () => {
    let clean = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const b = runBattleSeeded(even, even, { seed, supportFor: seed % 2 ? undefined : 'both' });
      if (b.end.detail.puck !== 'toWinner') continue;
      clean++;
      expect(b.carrierAfter).toBe(b.battle.playerId); expect(b.end.detail.winnerId).toBe(b.battle.playerId); expect(b.end.detail.puckTo).toBe(b.battle.playerId);
    }
    expect(clean).toBeGreaterThan(400 * 0.6);
  });
  it('won by support, the winner passes it to his supporter: a real pass that arrives', () => {
    let n = 0, arrived = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const b = runBattleSeeded(even, even, { seed, supportFor: 'a' });
      if (b.battle === undefined || b.battle.detail.how !== 'support' || b.end.detail.puckTo === b.battle.playerId || b.end.detail.puckTo === null) continue;
      n++;
      expect(b.end.detail.puckTo).toBe(b.battle.detail.winnerSupportId);
      expect(b.end.detail.puck).toBe('loose');
      expect(b.events.some((e) => e.type === 'pass' && e.playerId === b.battle.playerId && e.otherId === b.end.detail.puckTo)).toBe(true);
      expect(b.events.some((e) => e.type === 'release' && e.playerId === b.battle.playerId && e.detail.toId === b.end.detail.puckTo)).toBe(true);
      if (b.carrierWithin1s === b.end.detail.puckTo) arrived++;
    }
    expect(n).toBeGreaterThan(50); expect(arrived / n).toBeGreaterThan(0.85);
  });
  it('the battle event names each side\'s supporter', () => {
    let named = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const b = runBattleSeeded(even, even, { seed, supportFor: 'both' });
      if (b.battle === undefined) continue;
      const winnerHome = b.battle.side === 'home';
      expect(b.battle.detail.winnerSupportId).toBe(winnerHome ? 'home-LW' : 'away-LW');
      expect(b.battle.detail.loserSupportId).toBe(winnerHome ? 'away-LW' : 'home-LW');
      named++;
    }
    expect(named).toBeGreaterThan(50);
    const lone = runBattleSeeded(even, even, { seed: 3 });
    if (lone.battle !== undefined) { expect(lone.battle.detail.winnerSupportId).toBeNull(); expect(lone.battle.detail.loserSupportId).toBeNull(); }
  });
  it('supporters stand on their own side of the scrum, at least 2.5 m apart', () => {
    const b = battleWithBothSupports();                        // side boards at (5, 12.4); home defends -x
    expect(b.homeSupportTarget.x).toBeLessThan(5); expect(b.awaySupportTarget.x).toBeGreaterThan(5);
    expect(Math.hypot(b.homeSupportTarget.x - b.awaySupportTarget.x, b.homeSupportTarget.y - b.awaySupportTarget.y)).toBeGreaterThan(2.5);
    // ...and the battle keeps them there once they have joined; both at least 1.2 m off the boards.
    expect(b.homeSteered.x).toBeLessThan(5); expect(b.awaySteered.x).toBeGreaterThan(5);
    for (const t of [b.homeSupportTarget, b.awaySupportTarget, b.homeSteered, b.awaySteered]) expect(distToBoards(t)).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
  it('the winner comes off the boards with it: half a second after a clean win he is over 1 m from them in 80% of battles', () => { expect(winnerOffBoardsShare(300)).toBeGreaterThan(0.8); });
  it('a carrier shielding the puck along the boards does not give it up for nothing: under 5% of protects end "released"', () => { expect(releasedShare(600)).toBeLessThan(0.05); });
  it('team play sends a free teammate to support the battle, and he joins it', () => {
    const r = battleWithThirdMan();
    expect(r.supportSpot).not.toBeNull();
    expect(r.distToSupportSpot).toBeLessThan(0.01);
    expect(r.joined).toBe(true);
  });
});
