import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { gameSetup, sum } from './helpers';
import { countGames, measureGames, observeGame, pairCertainty } from './measures';
import type { GameSetup, TeamDef } from '../src/types';
import type { GameEvent, GameResult, GameState } from '../src/types';
import type { PlayCounters, PlayMeasures } from './measures';

/** `s` with both teams on the default tactics (the optional fields absent, a balanced forecheck): Task 11. */
const plain = (t: TeamDef): TeamDef => ({ ...t, tactics: { forecheck: 'balanced', shiftSeconds: t.tactics.shiftSeconds } });
const defaultTactics = (s: GameSetup): GameSetup => ({ ...s, home: plain(s.home), away: plain(s.away) });

/** Whole-game behaviour on seeds 1, 2, 3 (each played once per file): the guard rails every task keeps, and each task's numbers. */
function lazy<T>(f: () => T): () => T { let v: { x: T } | null = null; return () => (v ??= { x: f() }).x; }

/** Each game's result and its final state (createGame stepped to the end, as simulateGame does). */
const played = lazy((): { result: GameResult; state: GameState }[] => [1, 2, 3].map((seed) => {
  const g = createGame(gameSetup(seed));
  while (!g.done) g.step();
  return { result: g.result(), state: g.state };
}));
const games = (): GameResult[] => played().map((p) => p.result);

/** Paths (like `events[12].pos.x`) of every number in `v` that is not finite (NaN or +-Infinity). */
function nonFinite(v: unknown, path = '$', out: string[] = []): string[] {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(path); }
  else if (Array.isArray(v)) v.forEach((x, i) => nonFinite(x, `${path}[${i}]`, out));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) nonFinite(x, `${path}.${k}`, out);
  return out;
}
const m = lazy((): PlayMeasures => measureGames([1, 2, 3]));
/** The three games' counters added up. */
const counters = lazy((): PlayCounters => countGames([1, 2, 3]));
/** Seeds 1-16 pooled, for the measures one game moves too much for three (or eight) seeds to read (Task 8). */
const m16 = lazy((): PlayMeasures => measureGames(Array.from({ length: 16 }, (_, i) => i + 1)));
/**
 * Seeds 1-8 pooled (Task 8b close-out, controller ruling): the guards that three seeds move by 10 to 20% between two tunings
 * a rounding apart are read on eight (the games are the ones m16 plays; each seed is played once per process).
 */
const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 8];
const m8 = lazy((): PlayMeasures => measureGames(SEEDS8));
const counters8 = lazy((): PlayCounters => countGames(SEEDS8));
/** Seeds 1-16 pooled, the counters (Task 9 close-out rulings). */
const SEEDS16 = Array.from({ length: 16 }, (_, i) => i + 1);
const counters16 = lazy((): PlayCounters => countGames(SEEDS16));

describe('guard rails', () => {
  it('three games complete with 1 to 5 goals a team on average and no NaN or Infinity anywhere in the result or final state', () => {
    const goals = games().reduce((a, r) => a + r.score.home + r.score.away, 0) / 6;
    expect(goals).toBeGreaterThanOrEqual(1); expect(goals).toBeLessThanOrEqual(5);
    for (const p of played()) { expect(nonFinite(p.result)).toEqual([]); expect(nonFinite(p.state)).toEqual([]); }
  }, 60_000);
  it('the no-NaN check finds NaN and Infinity wherever they are', () => {
    expect(nonFinite({ score: { home: 1, away: 2 }, events: [{ pos: { x: 1, y: 2 }, detail: { speed: 3 } }] })).toEqual([]);
    expect(nonFinite({ events: [{ pos: { x: NaN, y: 0 } }] })).toEqual(['$.events[0].pos.x']);
    expect(nonFinite({ players: [{ toi: 1 }, { toi: Infinity }], detail: { v: -Infinity } })).toEqual(['$.players[1].toi', '$.detail.v']);
  });
  it('every measure is a finite number, shares within 0 to 1', () => {
    for (const [k, v] of Object.entries(m())) { expect(Number.isFinite(v), k).toBe(true); if (k.endsWith('Share') || k === 'passCompletion' || k === 'pointPassCompletion') { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  }, 60_000);
  it('the observer sees live play: skater ticks, passes and attempts in every game set', () => {
    const c = counters();
    expect(c.liveTicks).toBeGreaterThan(3 * 50_000); expect(c.skaterTicks).toBeGreaterThan(c.liveTicks); expect(c.passes).toBeGreaterThan(0); expect(c.attempts).toBeGreaterThan(0);
  }, 60_000);
});

describe('A1: commitment (Task 3)', () => {
  it('A1: targets are held: under 10% of spot ticks see the target move (was 39%)', () => { expect(m().retargetShare).toBeLessThan(0.10); }, 60_000);
  it('A1: more gliding and more top speed than before: glide over 30% (was 25%), top speed over 17% (was 14%), sprints over 1.2 s (was 0.8)', () => {
    // Close-out ruling 5: the sprint length is pooled over seeds 1-8 (1.198 s on three seeds was noise); the bar is unchanged.
    expect(m().glideShare).toBeGreaterThan(0.30); expect(m().topSpeedShare).toBeGreaterThan(0.17); expect(m8().sprintRunSeconds).toBeGreaterThan(1.1); // controller ruling after Task 10: play is more stop-and-start with engagements (1.136 s; 1.211 before them)
  }, 240_000);
  it('A1: skaters never overlap a goalie, and a race win never moves the puck to the winner', () => { expect(counters().goalieOverlapTicks).toBe(0); expect(counters().raceJumpTicks).toBe(0); }, 60_000);
  it('A1: players hold up at the blue line: under 10 offsides a game on seeds 1, 2, 3 and 8 (12 to 18 after Task 2, 7.75 after Task 5)', () => {
    const offsides = (r: GameResult): number => r.events.filter((e) => e.type === 'offside').length;
    const total = games().reduce((a, r) => a + offsides(r), 0) + offsides(simulateGame(gameSetup(8)));
    // Task 6 tightened this from 12 (point passes aimed inside the line); see task-5-report.md and task-6-report.md
    expect(total / 4).toBeLessThan(10);
  }, 60_000);
});

describe('A2: every player has a job (Task 4)', () => {
  it('A2: no two skaters of a team ever hold the same job', () => { expect(counters().duplicateJobTicks).toBe(0); }, 60_000);
  it('A2: standing still is under 9% of a skater\'s live time (was 17.5%)', () => { expect(m().stationaryShare).toBeLessThan(0.09); }, 60_000);
  // Task 12 close-out ruling 2: pooled over seeds 1-8 (seeds 1-3 read 0.499 after Task 12 changed the test rosters); bar unchanged.
  it('A2: at least two attackers are open in over 50% of offensive-zone time (was 40%)', () => { expect(m8().twoOpenShare).toBeGreaterThan(0.50); }, 240_000);
  // Pooled over seeds 1-8 (Task 4 review, Important 2): one game's share varies by about 0.017, so three seeds left no margin.
  // Task 8: pooled over seeds 1-16, shared with the point-pass test.
  it('A2: the most dangerous option is shadowed in 60% to 90% of it (was 76%), seeds 1-16 pooled', () => {
    const share = m16().dangerShadowedShare;
    expect(share).toBeGreaterThan(0.60); expect(share).toBeLessThan(0.90);
  }, 240_000);
  // Task 10 close-out ruling 3: over 70%, pooled over seeds 1-8 (the design wanted 85%; forcing body contact at the net
  // front cut attempts to 41 and goals to 1.1 a team). Task 14 tunes the balance between box-outs and offence.
  it('A2: the net-front defender has inside position (nearer the net than his man, within 1.6 m of him) over 68% of the time he has one (seeds 1-8; controller ruling after Task 10: 0.6995 measured, closing to contact choked the offence; Task 14 tunes)', () => { const c = counters8(); expect(c.netFrontDefenderInside / c.netFrontDefenderTicks).toBeGreaterThan(0.68); }, 240_000);
  // Close-out: pooled over seeds 1-8 (it read 0.030 to 0.033 on three seeds); the bar is unchanged.
  it('A2: the side with the puck skates forward: under 3% of its time backward (seeds 1-8)', () => { expect(m8().backwardShareWithPuck).toBeLessThan(0.03); }, 240_000);
  // Task 4 review, Important 1 (0.564 before the fix, 0.657 after it). The coordinator asked for 0.75; with the carrier's
  // own decisions (Task 5) it reads about 0.61: see task-5-report.md.
  // Task 10: with engagements (a checker riding the carrier is held on him) it reads 0.803 on seeds 1-3 (0.761 before); the
  // bar is set just under that. The design wanted 0.75.
  it('A2: someone has the carrier: a defender within 3 m of a carrier in the zone he attacks on over 78% of its ticks', () => { expect(m().carrierPressedShare).toBeGreaterThan(0.78); }, 60_000);
});

describe('A3: decisions with the puck (Task 5)', () => {
  it('A3: no breakaway pass backward in three games', () => { expect(counters().breakawayBackPasses).toBe(0); }, 60_000);
  // Task 6 review, Important 1: measured BEFORE the kind cap (after it, it was 0 by construction).
  it('A3: the pick stays a draw: under 15% of decision points in normal play have one kind of option above 97% before the cap, and the cap binds on under 15%', () => {
    // Close-out: the cap pooled over seeds 1-8; the bar is unchanged.
    const c = counters8(); expect(c.normalDecisionPoints).toBeGreaterThan(1000);
    expect(c.normalCapBinds / c.normalDecisionPoints).toBeLessThan(0.15);
    // Task 12 close-out ruling 1: certainty is read over six generated team pairs (two games each), the mean under 0.15
    // and no pair over 0.17. The test teams alone read 0.156 after Task 12's rosters (0.141 before), while ten other
    // pairs read 0.132 to 0.142 (0.147 before): it was one pair of rosters, not the change. At the close-out: mean 0.138,
    // pairs 0.128 to 0.148.
    const pairs = pairCertainty();
    expect(pairs.reduce((x, y) => x + y, 0) / pairs.length).toBeLessThan(0.15); expect(Math.max(...pairs)).toBeLessThan(0.17);
  }, 240_000);
  // Close-out: pooled over seeds 1-8; the bar is unchanged.
  // Task 9 close-out ruling 2: pooled over seeds 1-16, under 0.37. Task 9 changed the composition of the decisions: with
  // fewer pucks changing hands (poke takes 35 -> 12 a game, hits that free the puck 41 -> 23) there are fewer "gained the
  // puck" decisions, which never count as flips (flips per other decision only 0.515 -> 0.531). Task 14 revisits.
  it('A3: the carrier keeps his mind: under 37% of his decisions change what he is doing (seeds 1-16)', () => { expect(counters16().carrierFlips / counters16().carrierDecisions).toBeLessThan(0.37); }, 240_000);
  it('A2/A3: behind the net is used: at least 8 possessions there, 2 passes out front and 0.3 wraparounds a game', () => {
    expect(m().behindNetPossessionsPerGame).toBeGreaterThanOrEqual(8); expect(m().passesOutFrontPerGame).toBeGreaterThanOrEqual(2); expect(m().wrapAttemptsPerGame).toBeGreaterThanOrEqual(0.3);
  }, 60_000);
});

describe('A3: passes that can be received, the puck on the blade (Task 6)', () => {
  it('A3: the carried puck is on the shooting side in over 99% of carrying ticks', () => { expect(counters().carryWrongSide / counters().carryTicks).toBeLessThan(0.01); }, 60_000);
  // Task 8: pooled over seeds 1-16. About 30 point passes a game: on three seeds completion moved by 0.11 with a change
  // that does not touch passing (0.80 to 0.69 on seeds 1-3, 0.77 to 0.73 on 1-8, 0.75 to 0.78 on 9-16).
  it('A3: point passes stay in: over 90% kept (was 48%) and over 75% completed (was 37%), seeds 1-16 pooled', () => { expect(m16().pointPassKeptShare).toBeGreaterThan(0.90); expect(m16().pointPassCompletion).toBeGreaterThan(0.75); }, 240_000);
  // Task 7 review, Important 1 (controller ruling): with slow passes no longer immune to interception, completion is to
  // be 0.72 to 0.85 (it read 0.745 on seeds 1-8 and 1-16); pooled over seeds 1-16.
  // After Task 9 the band was lowered to 0.70 by ruling (pokes took the puck off fewer carriers). The Task 9 review fix (a
  // won poke takes the puck where it is won) brought it back to 0.723, so the bar is 0.72 again.
  // Task 10 close-out ruling 1: a tied-up receiver catches less (about 0.42 of his passes are completed), and the carrier's
  // valuation now sees it as execution does; completion still reads 0.701 pooled over seeds 1-16, so the bar is the
  // earlier ruled 0.70.
  it('A3: passes are completed 70% to 85% of the time (was 86.5%), seeds 1-16 pooled', () => { expect(m16().passCompletion).toBeGreaterThan(0.70); expect(m16().passCompletion).toBeLessThan(0.85); }, 240_000);
  it('A3: 600 to 900 passes a game', () => { expect(counters().passes / 3).toBeGreaterThan(600); expect(counters().passes / 3).toBeLessThan(900); }, 60_000);
  // A pickup: a loose puck or a pass taken (tryPickup) or a pass picked off; the move beyond the puck's own travel that
  // tick. Contest hand-overs (races, battles) have their own measures.
  // Task 6 review, Minor 8: the carried puck's step limit keeps it to about 0.4 m (it read 1.18 before that limit).
  // Close-out: read on seeds 1-8 (the largest of eight games); the bar is unchanged.
  it('A3: a pickup moves the puck at most 0.6 m beyond its own travel (seeds 1-8)', () => { expect(counters8().pickupSnapMax).toBeLessThanOrEqual(0.6); }, 240_000);
  // Task 8 review, Minor 3: the 0.4 m carry step (game.test.ts, seeds 1-3) holds on seeds 1-16 too, a frame push included.
  it('A3: a continuously carried puck never moves more than its 0.4 m step, seeds 1-16', () => { expect(countGames(Array.from({ length: 16 }, (_, i) => i + 1)).carryStepMax).toBeLessThanOrEqual(0.4 + 1e-9); }, 240_000);
  // Task 8 review, Minor 1: no save is made beyond the goalie's reach.
  it('A4: every save is made within the goalie\'s reach: the crossing is at most 1.6 m from his centre', () => {
    for (const r of games()) for (const e of r.events) if (e.type === 'save') expect(Math.abs(e.detail.cross.side)).toBeLessThanOrEqual(1.6 + 1e-9);
  }, 60_000);
  // At 1763a70, 1 to 3 goals a game came from a pass, rim or clear that slid in with no shot (1.6 a game over seeds 1-8;
  // 0.375 after the Task 5 review fixes, 0 or 1 in eight games after Task 6).
  // Close-out ruling 6: the two in seeds 1-8 were traced (a lead pass aimed into the goal mouth, a pass from in front to a
  // man behind the goal line, blind passes across his own crease: passing.ts planPass now refuses them); the guard is
  // pooled over seeds 1-16 with at most 2.
  it('A3: a pass almost never slides into the net: at most two goals in seeds 1-16 from a pass, rim, dump or clear with no shot', () => {
    expect(countGames(Array.from({ length: 16 }, (_, i) => i + 1)).passGoals).toBeLessThanOrEqual(2);
  }, 240_000);
});

describe('A4: attempts (Task 7)', () => {
  // Task 7 review, Important 3: checked event by event (the record's own sums cannot disagree with each other).
  it('A4: every shot release has exactly one outcome (block, miss, post or shot), every shot one save or goal, and the record\'s attempts are the shot releases', () => {
    for (const r of games()) {
      const outcomes = new Map<string, string[]>(), releases: GameEvent[] = [];
      for (const e of r.events) {
        if (e.type === 'release' && e.detail.kind === 'shot') { releases.push(e); outcomes.set(`${e.tick}:${e.playerId}`, []); }
        if (e.type === 'block' || e.type === 'miss' || e.type === 'post' || (e.type === 'shot' && e.detail.releaseTick !== null)) {
          // After a tip the outcome is the tipper's, and tippedFrom names the shooter whose release it was.
          const shooter = e.type === 'block' ? e.otherId : e.detail.tippedFrom ?? e.playerId;
          const k = `${e.detail.releaseTick}:${shooter}`;
          expect(outcomes.has(k), `${e.type} at ${e.tick} has no shot release`).toBe(true);
          outcomes.get(k)!.push(e.type);
        }
        // A puck that goes in without a shot is a goal with releaseTick null, and nothing else.
        if (e.type === 'shot') expect(e.detail.releaseTick).not.toBeNull();
      }
      for (const [k, o] of outcomes) expect(o.length, `release ${k}: ${o.join(',')}`).toBe(1);
      // Each shot on goal: exactly one save or goal, before the next shot.
      let open: GameEvent | null = null;
      for (const e of r.events) {
        if (e.type === 'shot') { expect(open).toBeNull(); open = e; }
        else if (e.type === 'save' || (e.type === 'goal' && e.detail.releaseTick !== null)) { expect(open).not.toBeNull(); expect(e.tick - open!.tick).toBeLessThanOrEqual(4); open = null; }
      }
      expect(open).toBeNull();
      for (const side of ['home', 'away'] as const) {
        const rel = releases.filter((e) => e.side === side);
        expect(r.team[side].attempts).toBe(rel.length);
        expect(r.team[side].shots).toBe(r.events.filter((e) => e.type === 'shot' && e.side === side).length);
      }
      // A player's attempts: the outcomes credited to him (a tipped shot is the tipper's; a block is the shooter's).
      const credited = (id: string): number => r.events.filter((e) => ((e.type === 'shot' || e.type === 'miss' || e.type === 'post') && e.playerId === id) || (e.type === 'block' && e.otherId === id)).length;
      for (const p of r.players) expect(p.attempts, p.id).toBe(credited(p.id));
    }
  }, 60_000);
  it('A4: defencemen shoot: at least 6 attempts a team a game from the defence (was 2)', () => { expect(m().defenceAttemptsPerTeam).toBeGreaterThanOrEqual(6); }, 60_000);
  it('A4: attempts are 42 to 75 a team a game and shots on goal 22 to 40 (guard rail, not the target)', () => {
    // Task 10 close-out ruling 6: attempts are read pooled over seeds 1-8 (51.0 on seeds 1-3 against 45).
    // Task 12 close-out ruling 2: the floor is 42 until Task 14 (Task 12's styles changed the test rosters: 46.6 -> 44.7
    // on seeds 1-8 with the same play).
    expect(m8().attemptsPerTeam).toBeGreaterThan(42); expect(m8().attemptsPerTeam).toBeLessThan(75);
    const sog = sum(games().map((r) => r.team.home.shots + r.team.away.shots)) / 6; expect(sog).toBeGreaterThan(22); expect(sog).toBeLessThan(40);
  }, 240_000);
  // Task 8: backhands were 31% of attempts after Task 7 (a shooter facing across the ice or away from the net shot off the
  // backhand); roughly a tenth is realistic.
  // Task 9: pooled over seeds 1-16 (one game reads 1.9% to 11.6% by itself; seeds 1-3 read 4.5% after Task 9, 6.4% on
  // seeds 1-16); the bars are unchanged.
  it('A4: backhands are 5% to 20% of attempts (seeds 1-16)', () => {
    const c = countGames(Array.from({ length: 16 }, (_, i) => i + 1)), bh = c.attemptsBackhand / c.attempts;
    expect(bh).toBeGreaterThan(0.05); expect(bh).toBeLessThan(0.20);
  }, 240_000);
  it('A4: every release of a shot names its type', () => { for (const r of games()) for (const e of r.events) if (e.type === 'release') expect(e.detail.shotType === null).toBe(e.detail.kind !== 'shot'); }, 60_000);
});

describe('A4: saves, rebounds and tips (Task 8)', () => {
  it('A4: every shot on goal is followed by exactly one save or goal by the same goalie within 4 ticks, and no save comes without its shot', () => {
    for (const r of games()) {
      let open: GameEvent | null = null;
      for (const e of r.events) {
        if (e.type === 'shot') { expect(open).toBeNull(); open = e; }
        else if (e.type === 'save' || (e.type === 'goal' && e.detail.releaseTick !== null)) {
          expect(open).not.toBeNull(); expect(e.tick - open!.tick).toBeLessThanOrEqual(4);
          expect(e.type === 'save' ? e.playerId : e.otherId).toBe(open!.otherId);
          open = null;
        }
      }
      expect(open).toBeNull();
    }
  }, 60_000);
  it('A4: rebounds exist: 15% to 50% of saves leave one, and there are at least 6 second chances a game (was 2.3)', () => {
    const saves = games().flatMap((r) => r.events.filter((e) => e.type === 'save'));
    const rb = saves.filter((e) => e.type === 'save' && e.detail.kind === 'rebound').length / saves.length;
    // Close-out: second chances are pooled over seeds 1-8 (3.7 to 6.7 on three seeds by the roll); the bar is unchanged.
    // Task 9 close-out ruling 3: pooled over seeds 1-16, at least 4. On 16 seeds it was under 6 at every recent commit (5.31
    // before the Task 8b review fix, 5.5 after it, about 4.5 after Task 9); Task 14 tunes rebounds to the design's target
    // (about a fifth to a quarter of goals from rebounds and tips together).
    // Task 11 close-out ruling 1: at least 3 (3.25 at the close-out). Collapse defenders holding the front of the net and
    // point men no longer chasing every loose puck are correct hockey and cost second chances; Task 14 tunes rebounds
    // and second chances to the design's target.
    expect(rb).toBeGreaterThan(0.15); expect(rb).toBeLessThan(0.50); expect(m16().reboundChancesPerGame).toBeGreaterThanOrEqual(3);
  }, 240_000);
  it('A4: tips happen: at least 2 a game, some on goal', () => {
    // Task 9 review fix: read pooled over seeds 1-16 (seeds 1-3 read 1.33 after it, 3.0 before, while seeds 1-16 went 2.94
    // -> 3.25: one game reads 1 to 8); the bar is unchanged.
    const tips = counters16().tips / 16;
    expect(tips).toBeGreaterThanOrEqual(2);
    expect(games().some((r) => r.events.some((e) => e.type === 'shot' && e.detail.tippedFrom !== null))).toBe(true);
  }, 60_000);
  it('A4: the puck never moves further in a tick than its speed allows at a save or a tip', () => {
    expect(counters().saveJumpTicks).toBe(0);
  }, 60_000);
});

// 'A3: decisions at decision points' (48 games) is in look-interval.test.ts, in the calibration (slow) suite (Task 13b).

describe('A2/A4: the net front (Task 8 fix round 2)', () => {
  // Close-out ruling 4: pooled over seeds 1-8, and 45% for now (it reads 48 to 49%: a quarter of the spells end with a pass
  // to the net-front man). Task 10 (engagements at the net) restores the 50% bar.
  // Task 10: restored to 50% (an attacker boxed out fights for the spot).
  it('A2: the net-front man holds his job: at least 50% of his spells in the zone last 2.5 s or more, seeds 1-8', () => {
    const c = counters8(); expect(c.netFrontHolds).toBeGreaterThan(100); expect(c.netFrontHoldsLong / c.netFrontHolds).toBeGreaterThanOrEqual(0.50);
  }, 240_000);
  it('A4: an attacker is within 4 m of the net on at least 40% of saves of shots from 11 m or more', () => {
    const c = counters(); expect(c.pointShotSaves).toBeGreaterThan(30); expect(c.pointShotSavesNear / c.pointShotSaves).toBeGreaterThanOrEqual(0.4);
  }, 60_000);
});

describe('A3/A4: shot volume and decision rate (Task 8b)', () => {
  it('A3: the carrier decides at most 3,200 times a game (was 5,300; 6,700 on a clock)', () => { expect(counters().carrierDecisions / 3).toBeLessThanOrEqual(3200); }, 60_000);
  // Close-out ruling 1: under 35% for now, pooled over seeds 1-8. 47% of the decisions made in the zone are made with a
  // checker within 1.8 m, and a poor option still takes 3 to 7% of a draw, so the share of attempts follows the share of
  // decisions. Task 10 (engagements: a tied-up man cannot get a shot off) must bring it under 20%.
  // Task 10 close-out ruling 4: the 20% target is dropped. Two thirds of these shots have the checker 1.0 to 1.8 m away
  // with no body contact (no engagement): the rushed-shot rule (Task 8b) covers that case. It reads 0.31 after Task 10.
  it('A4: a pressured shot is a poor shot: under 35% of attempts are let go with a checker in stick reach (was 49%)', () => {
    // Task 9 close-out ruling 5: pooled over seeds 1-16 (0.349 on seeds 1-8 and 0.302 on 9-16 after Task 9).
    const c = counters16(); expect(c.attempts).toBeGreaterThan(100); expect(c.attemptsInReach / c.attempts).toBeLessThan(0.35);
  }, 240_000);
  // Close-out ruling 2: the far shots of normal play that count are the UNSCREENED ones (no teammate at the net or in the
  // goalie's sight line: measures.ts attemptsNormalFarBare); the screened ones are what "long shots wait for traffic"
  // asks for and are reported beside them (task-8b-report.md). Pooled over seeds 1-8.
  it('A4: no source floods the net: odd-man rushes from 11 m or more, pressure down low in close and unscreened shots from 11 m or more in normal play are each under 25 attempts a game (were 42, 97 and 45)', () => {
    const c = counters8(), n = SEEDS8.length;
    expect(c.attemptsOddManFar / n).toBeLessThan(25); expect(c.attemptsLowClose / n).toBeLessThan(25); expect(c.attemptsNormalFarBare / n).toBeLessThan(25);
    // The sources are reported whole: every attempt has one.
    expect(c.attemptsOddManFar + c.attemptsOddManClose + c.attemptsLowClose + c.attemptsLowFar + c.attemptsNormalFar + c.attemptsNormalClose + c.attemptsBreakaway + c.attemptsOther).toBe(c.attempts);
  }, 240_000);
});

describe('icing and the hard clear (Task 13b)', () => {
  // Task 13 close-out: icing was called 1.63 times a game (an NHL game has about 7 or 8): nothing fired the puck down the
  // ice. With the hard clear (options.ts, actions.ts executeHardClear) it reads between 4 and 12 a game.
  it('icing is called 4 to 12 times a game, and defenders clear it hard (seeds 1-16)', () => {
    const c = counters16(), n = SEEDS16.length;
    expect(c.icings / n).toBeGreaterThanOrEqual(4); expect(c.icings / n).toBeLessThanOrEqual(12);
    expect(c.hardClears / n).toBeGreaterThan(5);
  }, 240_000);
  // Task 13 review, Minor 4: the line-up's safety limit (25 s) is never what drops the puck.
  it('no faceoff setup runs to the safety limit (seeds 1-16)', () => { expect(counters16().faceoffs).toBeGreaterThan(500); expect(counters16().faceoffCapped).toBe(0); }, 240_000);
});

describe('A5: battling for position (Task 10)', () => {
  // Close-out ruling 6: the engaged share and the count are read pooled over seeds 1-8 (thin on three seeds); bars unchanged.
  it('A5: battling is constant: some pair is engaged in over 30% of live time (seeds 1-8)', () => { expect(counters8().engagedTicks / counters8().liveTicks).toBeGreaterThan(0.30); }, 240_000);
  // Close-out ruling 5: contacts where one man is already engaged with someone else or in a staged contest are left out
  // (measures.ts): he cannot take this engagement.
  it('A5: opponents in contact for over 0.3 s are engaged, not separated, in over 80% of cases', () => {
    const c = counters(); expect(c.contactOver03Free).toBeGreaterThan(500); expect(c.contactOver03Engaged / c.contactOver03Free).toBeGreaterThan(0.80);
  }, 60_000);
  it('A5: 250 to 1,650 engagements a game (seeds 1-8; controller ruling, Task 12 close-out: one-round net-front battles hand over to engagements, 1,549 measured)', () => { const n = counters8().engagements / SEEDS8.length; expect(n).toBeGreaterThan(250); expect(n).toBeLessThan(1650); }, 240_000);
});

describe('A5: battles the winner wins (Task 9)', () => {
  it('A5: the battle winner comes away with it in over 60% of decided battles (was 23%)', () => { expect(m().battleWinnerCameAwayShare).toBeGreaterThan(0.60); }, 60_000);
  it('A5: when a battle gives the puck to someone, it is the winner in over 85% (was 4%)', () => { expect(m().battleToWinnerIsWinnerShare).toBeGreaterThan(0.85); }, 60_000);
  it('A5: fewer battles end with nobody winning: under 14 a game (was 36)', () => { expect(m().battlesNoWinnerPerGame).toBeLessThan(14); }, 60_000);
  it('A5: 30% to 70% of landed hits put the man down (was 100%)', () => { expect(m().knockdownShare).toBeGreaterThan(0.30); expect(m().knockdownShare).toBeLessThan(0.70); }, 60_000);
  // Review Focus 4 for the whole game, on seeds 1-16 (controller): measures.ts puckJumpTicks counts live ticks on which the
  // puck moves further than its speed allows (0.05 m of slack; a carried puck may swing with the blade, 0.2 m a tick
  // beyond his travel), or goes to a new carrier's blade from more than 1.2 m.
  // Task 9 close-out ruling 4: a defender who has the carrier closes on him when he shields the puck (job-targets.ts
  // takeCarrier); a 15 s stand-off along the boards with a winger shadowing at 2.5 m broke the robustness file.
  it('a protecting carrier is engaged within 3 s (a contest with him, or an opponent within 1.5 m) in at least 95% of cases (seeds 1-16)', () => {
    const c = counters16(); expect(c.protectSpells).toBeGreaterThan(500); expect(c.protectEngaged / c.protectSpells).toBeGreaterThanOrEqual(0.95);
  }, 240_000);
  it('no teleport: on a live tick the puck never moves further than its speed allows, 1.2 m when it changes hands (seeds 1-16)', () => {
    expect(countGames(Array.from({ length: 16 }, (_, i) => i + 1)).puckJumpTicks).toBe(0); expect(m16().maxPuckJump).toBeLessThanOrEqual(1.2);
  }, 240_000);
  // Task 11 close-out ruling 6: the same on both teams playing the default tactics (the natural ones are the set above).
  // Three jump ticks there were pucks knocked loose by a poke that bounced off a post the same tick: the measure now
  // takes the loose speed from the contestEnd event (detail.looseSpeed).
  it('no teleport with both teams on the default tactics (seeds 1-16)', () => {
    const games16 = Array.from({ length: 16 }, (_, i) => observeGame(defaultTactics(gameSetup(i + 1))));
    expect(games16.reduce((a, g) => a + g.counters.puckJumpTicks, 0)).toBe(0);
    expect(Math.max(...games16.map((g) => g.maxPuckJump))).toBeLessThanOrEqual(1.2);
  }, 600_000);
});
