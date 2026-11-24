import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
import { createGame } from '../src/game';
import { TUNING } from '../src/tuning';
import { RINK } from '../src/rink';
import type { ContestKind, ContestStages, GameEvent, GameResult, GameState } from '../src/types';
import { gameSetup } from './helpers';

const GAME_TIMEOUT = 30_000;

const STAGES: { [K in ContestKind]: ContestStages[K][] } = {
  hit: ['close', 'impact', 'recover'],
  pokeCheck: ['reach', 'resolve', 'beaten'],
  boardBattle: ['protect', 'arrive', 'pin', 'dig', 'resolve'],
  netFront: ['jostle', 'free', 'tied'],
  looseRace: ['race', 'resolve'],
};

/** One whole game, with the state after every step handed to `onState`. */
function play(seed: number, onState?: (s: GameState) => void): GameResult {
  const g = createGame(gameSetup(seed));
  while (!g.done) { g.step(); onState?.(g.state); }
  return g.result();
}

describe('the interface a viewer builds on', () => {
  it('exports a deliberate surface: the game functions, setup checks, rosters, types\' runtime parts, geometry, constants', () => {
    expect(Object.keys(engine).sort()).toEqual([
      'BENCH_DOORS', 'BLADE', 'BRAIN_INTERVAL_TICKS', 'DT', 'FACEOFF_DOTS', 'GOALIE_ATTRS', 'PERIODS', 'PERIOD_SECONDS', 'PLAYER_TYPES', 'RINK',
      'SKATER_ATTRS', 'SetupError', 'bodyRadius', 'createGame', 'generateTeam', 'restoreGame', 'simulateGame', 'validateSetup', 'zoneOf',
    ]);
  });
  it('the tuning table is internal and frozen all the way down', () => {
    expect(Object.isFrozen(TUNING)).toBe(true);
    expect(Object.isFrozen(TUNING.goalie.save)).toBe(true);
    expect(Object.isFrozen(TUNING.shot.aimY)).toBe(true);
    expect(() => { (TUNING.brain as { maxShare: number }).maxShare = 1; }).toThrow();
  });

  describe('a whole game (seed 3)', () => {
    const seen = { contests: 0, kinds: new Set<string>(), bad: [] as string[] };
    let r: GameResult | null = null;
    const result = (): GameResult => {
      r ??= play(3, (s) => {
        for (const c of s.contests) {
          seen.contests++;
          seen.kinds.add(`${c.kind}:${c.stage}`);
          if (!(STAGES[c.kind] as string[]).includes(c.stage)) seen.bad.push(`${c.kind} in stage ${c.stage}`);
          for (const id of Object.values(c.roles)) if (id !== null && !s.skaters.some((k) => k.id === id)) seen.bad.push(`${c.kind} role ${String(id)}`);
        }
      });
      return r;
    };
    it('contests carry a kind and a stage from their own lists, and named roles that are skaters', () => {
      result();
      expect(seen.bad.slice(0, 5)).toEqual([]);
      expect(seen.contests).toBeGreaterThan(1000);
      for (const k of Object.keys(STAGES)) expect([...seen.kinds].some((x) => x.startsWith(`${k}:`))).toBe(true);
    }, GAME_TIMEOUT);
    it('every event has a structured detail and a position on (or just off) the ice', () => {
      const bad = result().events.filter((e) => typeof e.detail !== 'object' || e.detail === null
        || !(Math.abs(e.pos.x) <= RINK.halfLength + 0.5 && Math.abs(e.pos.y) <= RINK.halfWidth + 0.5));
      expect(bad.slice(0, 3)).toEqual([]);
    }, GAME_TIMEOUT);
    it('every contest that starts ends exactly once, later, with a result', () => {
      const starts = new Map<number, GameEvent>(), ends = new Map<number, GameEvent[]>();
      for (const e of result().events) {
        if (e.type === 'contestStart') starts.set(e.detail.contestId, e);
        if (e.type === 'contestEnd') ends.set(e.detail.contestId, [...(ends.get(e.detail.contestId) ?? []), e]);
      }
      expect(starts.size).toBeGreaterThan(500);
      const bad: string[] = [];
      for (const [id, s] of starts) {
        const es = ends.get(id) ?? [];
        if (es.length !== 1 || es[0]!.tick < s.tick || es[0]!.type !== 'contestEnd' || s.type !== 'contestStart' || es[0]!.detail.kind !== s.detail.kind) bad.push(`contest ${id}: ${es.length} ends`);
      }
      for (const id of ends.keys()) if (!starts.has(id)) bad.push(`contest ${id} ended without starting`);
      expect(bad.slice(0, 5)).toEqual([]);
      const results = new Set([...ends.values()].map((es) => (es[0]!.type === 'contestEnd' ? es[0]!.detail.result : '')));
      for (const want of ['landed', 'take', 'kept', 'won', 'whistle']) expect(results.has(want as never)).toBe(true);
    }, GAME_TIMEOUT);
    it('every pass, dump and shot has its release event, and shot outcomes point back to it', () => {
      const events = result().events;
      const releases = new Map<string, GameEvent>();
      for (const e of events) if (e.type === 'release') releases.set(`${e.tick}:${e.playerId}`, e);
      const bad: string[] = [];
      for (const e of events) {
        if (e.type === 'pass' && releases.get(`${e.tick}:${e.playerId}`)?.type !== 'release') bad.push(`pass at ${e.tick}`);
        if (e.type === 'miss' || e.type === 'post' || e.type === 'block' || e.type === 'tip' || ((e.type === 'shot' || e.type === 'goal') && e.detail.releaseTick !== null)) {
          const shooter = e.type === 'block' || e.type === 'tip' ? e.otherId : e.detail.tippedFrom ?? e.playerId;
          const rel = releases.get(`${e.detail.releaseTick}:${shooter}`);
          if (rel?.type !== 'release' || rel.detail.kind !== 'shot') bad.push(`${e.type} at ${e.tick} has no shot release`);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
      expect(events.filter((e) => e.type === 'release' && e.detail.kind === 'shot').length).toBeGreaterThan(40);
    }, GAME_TIMEOUT);
    // Task 7 (additive): a shot's release names its type; the box score keeps attempts.
    it('a shot release carries one of the shot types, any other release null; team and player lines carry attempts', () => {
      const r = result();
      const types = ['wrist', 'slap', 'oneTimer', 'backhand', 'wraparound'];
      for (const e of r.events) if (e.type === 'release') expect(e.detail.kind === 'shot' ? types.includes(e.detail.shotType ?? '') : e.detail.shotType === null).toBe(true);
      for (const t of [r.team.home, r.team.away]) expect(t.attempts).toBe(t.shots + t.missedShots + t.shotsBlocked);
      for (const p of r.players) expect(p.attempts).toBe(p.shots + p.missedShots + p.shotsBlocked);
    }, GAME_TIMEOUT);
    // Task 8 (additive): where a shot met the goalie, what the save did, tips.
    it('shots, saves and goals say where the puck met the goalie; a save says what it did with it; a tip names its shooter', () => {
      const r = result();
      const kinds = new Set<string>();
      for (const e of r.events) {
        if (e.type === 'shot' || e.type === 'goal' || e.type === 'save') { expect(Number.isFinite(e.detail.cross.side)).toBe(true); expect(e.detail.cross.height).toBeGreaterThanOrEqual(0); }
        if (e.type === 'save') kinds.add(e.detail.kind);
        if (e.type === 'shot' || e.type === 'goal') { expect(typeof e.detail.screened).toBe('boolean'); expect(typeof e.detail.rebound).toBe('boolean'); }
        if (e.type === 'tip') expect(e.otherId).not.toBe(e.playerId);
      }
      for (const k of ['held', 'steered', 'rebound']) expect(kinds.has(k)).toBe(true);
    }, GAME_TIMEOUT);
  });
});
