import { describe, it, expect } from 'vitest';
import { BADGES, earnedBadges, GOALIE_BADGES, hasBadge } from '../src/badges';
import { passErrorOf, passRangeOf, receiveChance, stickInterceptChance } from '../src/passing';
import { shotSpeedOf, spreadOf } from '../src/actions';
import { movementOf } from '../src/skating';
import { fullDrainOf } from '../src/bench';
import { listOptions } from '../src/options';
import { tipChance } from '../src/tips';
import { blockChance } from '../src/shots';
import { hitChance, hitDegreeChances } from '../src/contests/hit';
import { engageChance } from '../src/engagements';
import { drawChance } from '../src/faceoff';
import { saveOutcomeChances } from '../src/rebounds';
import { saveChance } from '../src/goalie';
import { coverGapOf } from '../src/job-targets';
import { startContest } from '../src/contests/core';
import { pokeCheckContest } from '../src/contests/poke-check';
import { planOf } from '../src/commit';
import { SKATER_ATTRS } from '../src/attributes';
import { TUNING } from '../src/tuning';
import type { Badge, GameState, PlayerDef, SavePose, ShotType } from '../src/types';
import { at, def, defs, duel, duelStep, g, place, rate, runBattle, skater, slotState, st, stateWith } from './helpers';

describe('badges are earned (Task 12)', () => {
  it('by being clearly good at one thing: each at its threshold, not a point under', () => {
    expect(earnedBadges(def({ shootingPower: 88 }))).toEqual(['Heavy Slapshot']); expect(earnedBadges(def({ shootingPower: 87 }))).toEqual([]);
    expect(earnedBadges(def({ shootingAccuracy: 85, tendencies: { ...def().tendencies, shoot: 0.6 } }))).toEqual(['One-Timer']);
    expect(earnedBadges(def({ shootingAccuracy: 85, tendencies: { ...def().tendencies, shoot: 0.59 } }))).toEqual([]);
    expect(earnedBadges(def({ shootingAccuracy: 88, poise: 75 }))).toEqual(['Quick Release']);
    expect(earnedBadges(def({ puckHandling: 75, tendencies: { ...def().tendencies, netFront: 0.7 } }))).toEqual(['Net-Front Finisher']);
    expect(earnedBadges(def({ speed: 90 }))).toEqual(['Burner']); expect(earnedBadges(def({ agility: 90 }))).toEqual(['Elusive']);
    expect(earnedBadges(def({ stamina: 90 }))).toEqual(['Tireless']); expect(earnedBadges(def({ vision: 90 }))).toEqual(["Playmaker's Vision"]);
    expect(earnedBadges(def({ puckHandling: 90 }))).toEqual(['Stickhandler']);
    expect(earnedBadges(def({ passing: 85, position: 'LD' }))).toEqual(['Breakout Passer']); expect(earnedBadges(def({ passing: 85, position: 'LW' }))).toEqual([]);
    expect(earnedBadges(def({ shotBlocking: 88 }))).toEqual(['Shot Blocker']); expect(earnedBadges(def({ stickChecking: 88 }))).toEqual(['Stick Checker']);
    expect(earnedBadges(def({ bodyChecking: 88, weightKg: 95 }))).toEqual(['Big Hitter']); expect(earnedBadges(def({ bodyChecking: 88, weightKg: 94 }))).toEqual([]);
    expect(earnedBadges(def({ defensivePositioning: 90 }))).toEqual(['Shutdown']);
    expect(earnedBadges(def({ strength: 85, compete: 85 }))).toEqual(['Board Battler']);
    expect(earnedBadges(def({ strength: 88, balance: 80 }))).toEqual(['Net-Front Presence']);
    expect(earnedBadges(def({ faceoffs: 88 }))).toEqual(['Faceoff Specialist']);
    expect(earnedBadges(def({ position: 'G', goalie: { ...g(70), reboundControl: 78 } }))).toEqual(['Rebound Control']);
    expect(earnedBadges(def({ position: 'G', goalie: { ...g(70), glove: 78 } }))).toEqual(['Glove Hand']);
    expect(earnedBadges(def({ position: 'G', goalie: { ...g(70), glove: 77 } }))).toEqual([]);
  });
  it('a goalie earns only goalie badges, a skater only skater badges', () => {
    expect(earnedBadges(def({ position: 'G', speed: 99, goalie: { ...g(99) } }))).toEqual(['Rebound Control', 'Glove Hand']);
    expect(earnedBadges(def({ position: 'C', goalie: g(99) }))).toEqual([]);
  });
  it('at most four, strongest first', () => {
    const star = def({ position: 'C', shootingPower: 89, speed: 99, agility: 95, vision: 91, puckHandling: 97, faceoffs: 93 });
    expect(earnedBadges(star)).toEqual(['Burner', 'Stickhandler', 'Elusive', 'Faceoff Specialist']);
  });
  it('hasBadge reads the list (none when absent)', () => {
    expect(hasBadge(def({ badges: ['Burner'] }), 'Burner')).toBe(true); expect(hasBadge(def({}), 'Burner')).toBe(false);
    expect(BADGES.length).toBe(19);
  });
});

// ---- each badge's one effect (Task 12, Review Focus 3: small, real, in the right direction, inside the clamps) ----

/** A shot's speed (m/s) of `type` by `d`, before rushing (actions.ts shotSpeedOf). */
const shotSpeedFor = (d: PlayerDef, type: ShotType): number => shotSpeedOf(d, type);
/** A shot's spread (m) by `d` from 10 m, of `type`, under `pressure`, a rebound shot or not. */
const shotSpreadFor = (d: PlayerDef, type: ShotType, pressure = 0, rebound = false): number => spreadOf(d, 10, pressure, type, 0, 0, rebound);
/** Pass options he lists, with the puck in his own half and four teammates to pass to. */
function passOptionsOf(d: PlayerDef): number {
  const st = stateWith({ carrier: 'home', puckX: -8, puckY: 0, carrierSlot: 'C' });
  for (const s of st.skaters) if (s.side === 'away') s.onIce = false;
  st.onIce.away = [];
  place(st, 'home:LW', -1, 7); place(st, 'home:RW', -1, -7); place(st, 'home:LD', -4, 13); place(st, 'home:RD', -4, -13);
  const ds = new Map(defs); ds.set('home-C', { ...d, id: 'home-C', position: 'C' });
  return listOptions(st, ds.get('home-C')!, ds, []).filter((o) => o.kind === 'pass').length;
}
/** Poke checks by `checker` (away C, a stick length from the puck) on the still carrier `carrier`, on seeds 1..n (the same seeds with and without a badge): the share he wins. */
function pokeWinShare(checker: PlayerDef, carrier: PlayerDef, n: number, marks = false): number {
  let won = 0;
  for (let seed = 1; seed <= n; seed++) {
    const h = duel(checker, carrier, 1.5, 0, seed);
    if (marks) planOf(h.st, 'away-C').markId = 'home-C';
    const c = startContest(h.st, h.ds, h.rng, pokeCheckContest, ['away-C', 'home-C'], h.events);
    for (let i = 0; i < 300 && h.st.contests.includes(c); i++) duelStep(h);
    if (h.events.some((e) => e.type === 'turnover' && e.playerId === 'away-C')) won++;
  }
  return won / n;
}
/** Board battles between `a` and `b` (level, neither first in): the share `a` wins of those someone wins. */
function battleWinShare2(a: PlayerDef, b: PlayerDef, n: number): number {
  let wa = 0, decided = 0;
  for (let i = 0; i < n; i++) { const r = runBattle(a, b); if (r.winner !== null) { decided++; if (r.winner === 'a') wa++; } }
  return wa / decided;
}
const battleWinShare = (d: PlayerDef, n: number): number => battleWinShare2(d, def({}), n);
/** Chance the home centre `d` wins a draw against an even away centre. */
function drawChanceFor(d: PlayerDef): number {
  const st = stateWith({ carrier: null, puckX: 0 });
  const ds = new Map(defs); ds.set('home-C', { ...d, id: 'home-C', position: 'C' });
  return drawChance(st, ds);
}
const goalie = (o: Partial<PlayerDef> = {}): PlayerDef => def({ position: 'G', goalie: g(70), ...o });
const saveBase = { lateralMiss: 0.2, shotSpeed: 32, distance: 12, screened: false, goalieMovingSpeed: 0, height: 0.9 };

const CASES: [Badge, (d: PlayerDef) => number, { atLeast: number; atMost: number }][] = [
  ['Heavy Slapshot', (d) => shotSpeedFor(d, 'slap'), { atLeast: 1.05, atMost: 1.10 }],
  ['One-Timer', (d) => 1 / shotSpreadFor(d, 'oneTimer'), { atLeast: 1.3, atMost: 1.7 }],
  ['Quick Release', (d) => 1 / shotSpreadFor(d, 'wrist', 1), { atLeast: 1.03, atMost: 1.3 }],
  ['Net-Front Finisher', (d) => tipChance(d), { atLeast: 1.2, atMost: 1.6 }],
  ['Burner', (d) => movementOf(d, 1).topSpeed, { atLeast: 1.02, atMost: 1.04 }],
  ['Elusive', (d) => movementOf(d, 1).carve, { atLeast: 1.05, atMost: 1.15 }],
  ['Tireless', (d) => 1 / fullDrainOf(d), { atLeast: 1.1, atMost: 1.25 }],
  ["Playmaker's Vision", (d) => passOptionsOf(d), { atLeast: 1.2, atMost: 1.5 }],
  ['Stickhandler', (d) => 1 - pokeWinShare(def({}), d, 600), { atLeast: 1.02, atMost: 1.3 }],
  ['Breakout Passer', (d) => 1 / passErrorOf(d, 0, 'forehand', true), { atLeast: 1.2, atMost: 1.4 }],
  ['Shot Blocker', (d) => blockChance(d), { atLeast: 1.1, atMost: 1.5 }],
  ['Stick Checker', (d) => stickInterceptChance(d, 15), { atLeast: 1.1, atMost: 1.2 }],
  ['Big Hitter', (d) => hitChance(d, at(0, 0), def({}), at(1, 0), 4), { atLeast: 1.03, atMost: 1.3 }],
  ['Shutdown', (d) => pokeWinShare(d, def({}), 600, true), { atLeast: 1.03, atMost: 1.4 }],
  ['Board Battler', (d) => battleWinShare(d, 400), { atLeast: 1.03, atMost: 1.4 }],
  ['Net-Front Presence', (d) => engageChance(d, st({ pos: { x: 25, y: 0 } }), def({}), st({ pos: { x: 25.5, y: 0 } }), null), { atLeast: 1.03, atMost: 1.4 }],
  ['Faceoff Specialist', (d) => drawChanceFor(d), { atLeast: 1.02, atMost: 1.25 }],
  ['Rebound Control', (d) => { const c = saveOutcomeChances({ pose: 'pad', speed: 30, screened: false, tipped: false, reboundControl: d.goalie!.reboundControl, reboundControlBadge: hasBadge(d, 'Rebound Control') }); return c.held + c.steered; }, { atLeast: 1.05, atMost: 1.4 }],
  ['Glove Hand', (d) => saveChance({ ...saveBase, goalie: d.goalie!, gloveHand: hasBadge(d, 'Glove Hand') }), { atLeast: 1.005, atMost: 1.1 }],
];

describe('badges: each has one small real effect (Task 12)', () => {
  it.each(CASES)('%s has a small real effect', (badge, metric, band) => {
    const base = GOALIE_BADGES.includes(badge) ? goalie() : def({}), ratio = metric({ ...base, badges: [badge] }) / metric(base);
    expect(ratio).toBeGreaterThanOrEqual(band.atLeast); expect(ratio).toBeLessThanOrEqual(band.atMost);
  }, 120_000);
  it('every badge is in the table of cases', () => { expect(CASES.map((c) => c[0]).sort()).toEqual([...BADGES].sort()); });
  it('the second effects: a quick release beats the goalie\'s reaction, a finisher is truer on a rebound, an elusive carrier is harder to poke, a stick checker pokes better, a big hitter hits harder, a breakout passer reaches further from his own zone, a glove hand holds more glove saves, a shutdown man covers tighter', () => {
    expect(saveChance({ ...saveBase, goalie: g(70), quickRelease: true })).toBeLessThan(saveChance({ ...saveBase, goalie: g(70) }));
    const fin = def({ badges: ['Net-Front Finisher'] });
    expect(shotSpreadFor(fin, 'wrist', 0, true) / shotSpreadFor(fin, 'wrist', 0, false)).toBeCloseTo(0.85, 9);
    expect(shotSpreadFor(def({}), 'wrist', 0, true)).toBe(shotSpreadFor(def({}), 'wrist', 0, false));
    expect(pokeWinShare(def({}), def({ badges: ['Elusive'] }), 600)).toBeLessThan(pokeWinShare(def({}), def({}), 600));
    expect(pokeWinShare(def({ badges: ['Stick Checker'] }), def({}), 600)).toBeGreaterThan(pokeWinShare(def({}), def({}), 600));
    const deg = (b: number) => hitDegreeChances(6, 100, 90, 70, false, 0.2, b).knockdown;
    expect(deg(TUNING.badges.bigHitterDegree)).toBeGreaterThan(deg(0)); expect(deg(TUNING.badges.bigHitterDegree) / deg(0)).toBeLessThan(1.6);
    expect(passRangeOf(def({ badges: ['Breakout Passer'] }), 'forehand', true)).toBe(passRangeOf(def({}), 'forehand', true) + 5);
    expect(passRangeOf(def({ badges: ['Breakout Passer'] }), 'forehand', false)).toBe(passRangeOf(def({}), 'forehand', false));
    expect(passErrorOf(def({ badges: ['Breakout Passer'] }), 0, 'forehand', false)).toBe(passErrorOf(def({}), 0, 'forehand', false));
    const held = (gh: boolean, pose: SavePose) => saveOutcomeChances({ pose, speed: 30, screened: false, tipped: false, reboundControl: 70, gloveHandBadge: gh }).held;
    expect(held(true, 'glove') - held(false, 'glove')).toBeCloseTo(0.08, 9); expect(held(true, 'pad')).toBe(held(false, 'pad'));
    expect(coverGapOf(def({}), 4) - coverGapOf(def({ badges: ['Shutdown'] }), 4)).toBeCloseTo(0.3, 9);
  }, 120_000);
  it('the power forward does not always beat the two-way guy: with Board Battler and 20 kg on him he wins 55% to 90% of board battles', () => {
    const pf = def({ strength: 95, balance: 88, compete: 88, weightKg: 104, badges: ['Board Battler'] }), tw = def({ strength: 68, balance: 72, compete: 74, weightKg: 84 });
    const s = battleWinShare2(pf, tw, 600); expect(s).toBeGreaterThan(0.55); expect(s).toBeLessThanOrEqual(0.9);
  }, 120_000);
  it('badges never break the clamps: every chance a badge shades stays within its limits for a 100-rated player holding all of them', () => {
    const attrs = Object.fromEntries(SKATER_ATTRS.map((k) => [k, 100])) as Record<string, number>;
    const all = def({ ...attrs, weightKg: 110, badges: BADGES.filter((b) => !GOALIE_BADGES.includes(b)) }), weak = def(Object.fromEntries(SKATER_ATTRS.map((k) => [k, 1])));
    expect(tipChance(all)).toBeLessThanOrEqual(0.97); expect(blockChance(all)).toBeLessThanOrEqual(0.97);
    expect(stickInterceptChance(all, 1)).toBeLessThanOrEqual(0.97); expect(receiveChance(all, 5, false)).toBeLessThanOrEqual(0.97);
    expect(hitChance(all, at(0, 0), weak, at(1, 0), 9)).toBeLessThanOrEqual(0.9);
    expect(engageChance(all, st({ pos: { x: 25, y: 0 } }), weak, st({ pos: { x: 25.5, y: 0 } }), 'a')).toBeLessThanOrEqual(0.9);
    expect(drawChanceFor(all)).toBeLessThanOrEqual(0.9);
    for (const k of Object.values(hitDegreeChances(12, 130, 60, 1, false, 1, TUNING.badges.bigHitterDegree))) expect(k).toBeLessThanOrEqual(0.97);
    const gAll = g(100);
    for (const pose of ['glove', 'blocker', 'pad', 'butterfly'] as const) {
      const c = saveOutcomeChances({ pose, speed: 10, screened: false, tipped: false, reboundControl: 100, reboundControlBadge: true, gloveHandBadge: true });
      for (const v of Object.values(c)) { expect(v).toBeGreaterThanOrEqual(0.03); expect(v).toBeLessThanOrEqual(0.97); }
      expect(c.held + c.steered + c.rebound).toBeCloseTo(1, 9);
    }
    expect(saveChance({ ...saveBase, goalie: gAll, distance: 30, shotSpeed: 10, gloveHand: true })).toBeLessThanOrEqual(0.97);
    expect(saveChance({ ...saveBase, goalie: g(1), distance: 2, shotSpeed: 45, quickRelease: true, lateralMiss: 1.5 })).toBeGreaterThanOrEqual(0.03);
  });
});

describe('the carrier values what the shot badges do (Task 12 close-out: valuation matches execution)', () => {
  const clone = (s: GameState): GameState => structuredClone(s);
  /** Home LD at the point with the puck, defenders back around the net, home LW (job netFront) in front. */
  const pointState = (): GameState => {
    const st = stateWith({ carrier: 'home', puckX: 13, puckY: 6, carrierSlot: 'LD' });
    const put = (side: 'home' | 'away', slot: 'LW' | 'RW' | 'C' | 'LD' | 'RD', x: number, y: number): void => { const k = skater(st, side, slot); k.pos = { x, y }; k.target = { x, y }; };
    put('home', 'LW', 24.6, 0.6); put('home', 'RW', 23, -7); put('home', 'C', 20, 6); put('home', 'RD', 12, -7);
    put('away', 'LD', 25, -1.5); put('away', 'RD', 23, 5); put('away', 'C', 21, -2); put('away', 'LW', 16, 8); put('away', 'RW', 16, -8);
    planOf(st, 'home-LW').job = 'netFront';
    return st;
  };
  /** His share of shots among 2,000 first looks without and with `badge` (on him, or on home LW in front of the net). */
  const shift = (st: GameState, badge: Badge, who: 'carrier' | 'home-LW' = 'carrier'): { without: number; with: number } => {
    if (who === 'carrier') return { without: rate('shoot', def({}), st), with: rate('shoot', def({ badges: [badge] }), st) };
    const saved = defs.get('home-LW')!;
    const without = rate('shoot', def({}), st);
    defs.set('home-LW', { ...saved, badges: [badge] });
    try { return { without, with: rate('shoot', def({}), st) }; } finally { defs.set('home-LW', saved); }
  };
  // Seeds 1-2000 at the close-out: slapshot from the point 0.722 -> 0.743; a wrist shot with a checker 1.2 m off 0.084 ->
  // 0.100; a point shot with a Net-Front Finisher in front 0.722 -> 0.747.
  const modest = (r: { without: number; with: number }, label: string): void => {
    expect(r.with, label).toBeGreaterThan(r.without); expect(r.with / r.without, label).toBeLessThan(1.5);
    expect(r.with, label).toBeLessThan(0.9); expect(r.without, label).toBeGreaterThan(0.03);
  };
  it('a One-Timer man shoots a one-timer more often, a Heavy Slapshot man a slapshot from the point, a Quick Release man under pressure, and a point man with a Net-Front Finisher in front; modestly, and still a draw', () => {
    const ot = pointState(); ot.oneTimerTaken = { id: ot.carrierId!, tick: ot.tick };
    // On a one-timer he shoots almost always (TUNING.value.oneTimerBonus; 0.97 either way): the badge shows in the
    // shot's value, a little higher, not in the choice.
    const shotValue = (d: PlayerDef): number => { const me = { ...d, id: ot.carrierId!, position: 'LD' as const }; const ds = new Map(defs); ds.set(me.id, me); return listOptions(ot, me, ds, []).find((o) => o.kind === 'shoot')!.value; };
    expect(shotValue(def({ badges: ['One-Timer'] }))).toBeGreaterThan(shotValue(def({})));
    expect(rate('shoot', def({ badges: ['One-Timer'] }), ot)).toBeLessThan(0.98);
    modest(shift(pointState(), 'Heavy Slapshot'), 'slapshot');
    const qr = clone(slotState); const c = qr.skaters.find((k) => k.id === qr.carrierId)!; const k = skater(qr, 'away', 'C'); k.pos = { x: c.pos.x + 1.2, y: c.pos.y + 0.3 }; k.target = { ...k.pos };
    modest(shift(qr, 'Quick Release'), 'quick release');
    modest(shift(pointState(), 'Net-Front Finisher', 'home-LW'), 'finisher in front');
  }, 240_000);
});

describe('the block habit (Task 12 close-out)', () => {
  it('a man keener to get in front of shots blocks more of those that pass him, inside the clamps; the default 0.5 changes nothing', () => {
    const at = (block: number, shotBlocking = 70): number => blockChance(def({ shotBlocking, tendencies: { ...def().tendencies, block } }));
    expect(at(0.5)).toBe(blockChance(def({})));
    expect(at(0.85)).toBeGreaterThan(at(0.5)); expect(at(0.2)).toBeLessThan(at(0.5));
    expect(at(0.85) - at(0.2)).toBeCloseTo(0.13, 9);
    expect(at(1, 100)).toBeLessThanOrEqual(0.97); expect(at(0, 1)).toBeGreaterThanOrEqual(0.03);
  });
});
