import { describe, it, expect } from 'vitest';
import { simulateGame } from '../../src/game';
import { FACEOFF_DOTS } from '../../src/rink';
import {
  battleWithThirdMan, count, def, even, heldPuckInGame, runBattle, runBattleLogged, runBattleWon, setup, share, shareOf, stagesOf, totalSeconds,
  trappedBattle, shieldAlongBoards, puckIntoFeet, battleWonOffCarrier,
} from '../helpers';

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
  it('support swings it and gets the puck', () => { const withHelp = share(3000, () => runBattle(twoWay, pf, { supportFor: 'a' }).winner === 'a'); expect(withHelp).toBeGreaterThan(share(3000, () => runBattle(twoWay, pf).winner === 'a') + 0.08); expect(runBattleWon(twoWay, pf, { supportFor: 'a' }).puckTo).toBe('support'); });
  it('first man in has an edge', () => { expect(share(3000, () => runBattle(even, even, { firstIn: 'a' }).winner === 'a')).toBeGreaterThan(0.53); });
  it('a stalemate is whistled dead', () => { expect(Array.from({ length: 3000 }, () => runBattle(even, even)).some(x => x.winner === null && x.detail === 'trapped')).toBe(true); });
  it('support decides who gets a clean puck, not whether it comes out clean', () => {
    const r = Array.from({ length: 2000 }, () => runBattle(even, even, { supportFor: 'a' })).filter((x) => x.winner !== null);
    const clean = shareOf(r, (x) => x.puckTo !== 'loose');
    expect(clean).toBeGreaterThan(0.5); expect(clean).toBeLessThan(0.7);
    expect(r.filter((x) => x.winner === 'a' && x.puckTo !== 'loose').every((x) => x.puckTo === 'support')).toBe(true);
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
  it('a full game has plenty of battles', () => { const r = simulateGame(setup(3)); expect(count(r, 'battle')).toBeGreaterThan(40); expect(count(r, 'battle')).toBeLessThan(220); }, GAME_TIMEOUT);

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
  it('team play sends a free teammate to support the battle, and he joins it', () => {
    const r = battleWithThirdMan();
    expect(r.supportSpot).not.toBeNull();
    expect(r.distToSupportSpot).toBeLessThan(0.01);
    expect(r.joined).toBe(true);
  });
});
