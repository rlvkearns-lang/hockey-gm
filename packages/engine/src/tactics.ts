/**
 * Team tactics (Task 11, design A6): what the coach asks for, resolved with its defaults, the factors a tactic applies to
 * the carrier's option values (options.ts) and to the jobs (jobs.ts, job-targets.ts), and the tactics that suit a
 * roster (naturalTactics, for generateTeam).
 *
 * Tactics shade, they never decide: every factor is a multiplier on an option's value (a positive value times it, a
 * negative one divided by it, as a habit does) or a shift of a job's spot, and every chance stays inside its clamp. The
 * men on the ice bend a tactic: an entry tactic's factors weaken for a line whose habits do not suit it (entryFactors).
 * The defaults play as the engine did before tactics. Per team only: per line and per game situation is a later step
 * (a line's or a situation's tactics would resolve here to the same ResolvedTactics).
 *
 * Every number is in TUNING.tactics.
 */
import { dpow } from './dmath';
import { TUNING } from './tuning';
import type { GameState, Lines, PlayerDef, Side, Tactics, Tendencies } from './types';

export type ResolvedTactics = Required<Tactics>;

/** What the four optional fields of Tactics are when absent: the play the engine had before tactics. */
export const DEFAULT_TACTICS: Pick<ResolvedTactics, 'zoneEntry' | 'offence' | 'defence' | 'pinch'> = Object.freeze({
  zoneEntry: 'mixed', offence: 'cycle', defence: 'collapse', pinch: 'sometimes',
});

/** `t` with every optional field filled in (a new object). */
export function resolveTactics(t: Tactics): ResolvedTactics {
  return {
    forecheck: t.forecheck,
    shiftSeconds: t.shiftSeconds,
    zoneEntry: t.zoneEntry ?? DEFAULT_TACTICS.zoneEntry,
    offence: t.offence ?? DEFAULT_TACTICS.offence,
    defence: t.defence ?? DEFAULT_TACTICS.defence,
    pinch: t.pinch ?? DEFAULT_TACTICS.pinch,
  };
}

const T = TUNING.tactics;
const isD = (slot: string | null): boolean => slot === 'LD' || slot === 'RD';

/**
 * What the men on the ice make of a tactic: the mean habit `habit` of `side`'s on-ice forwards (group 'F') or
 * defencemen ('D'), 0..1; 0.5 with none on the ice.
 */
export function lineHabit(state: GameState, side: Side, defs: Map<string, PlayerDef>, habit: keyof Tendencies, group: 'F' | 'D'): number {
  let sum = 0, n = 0;
  for (const s of state.skaters) {
    if (!s.onIce || s.side !== side || s.slot === null || isD(s.slot) !== (group === 'D')) continue;
    const d = defs.get(s.id);
    if (d === undefined) continue;
    sum += d.tendencies[habit];
    n++;
  }
  return n === 0 ? 0.5 : sum / n;
}

/**
 * Multipliers on the carrier's neutral-zone options: `carryIn` on a carry toward the zone, `dump` on the dump-in. The
 * tactic's factors (TUNING.tactics.entry: carry 1.25 / 0.6, mixed 1 / 1, dump 0.8 / 1.6) are bent by the line: each
 * factor f becomes f ** e, e = max(bend.min, bend.perHabit * h), where h is the line's habit for what the tactic asks
 * for (`carryHabit` under 'carry', `dumpHabit` under 'dump'): an average line (0.5) plays it as written, grinders asked
 * to carry play it at about half strength and still dump more than a skilled line would.
 */
export function entryFactors(t: ResolvedTactics, dumpHabit: number, carryHabit: number): { carryIn: number; dump: number } {
  const f = T.entry[t.zoneEntry];
  if (t.zoneEntry === 'mixed') return { carryIn: f.carryIn, dump: f.dump };
  const h = t.zoneEntry === 'carry' ? carryHabit : dumpHabit;
  const e = Math.max(T.bend.min, T.bend.perHabit * h);
  return { carryIn: dpow(f.carryIn, e), dump: dpow(f.dump, e) };
}

type OffenceFactors = { lowCycle: number; pointPass: number; pointShot: number; rushShot: number; hold: number };
const OFFENCE_KEYS = ['lowCycle', 'pointPass', 'pointShot', 'rushShot', 'hold'] as const;
/** Each offence tactic's factors relative to the default's (computed once). */
const RELATIVE: Record<ResolvedTactics['offence'], OffenceFactors> = (() => {
  const base = T.offence[DEFAULT_TACTICS.offence];
  const rel = (o: OffenceFactors): OffenceFactors => {
    const r = {} as OffenceFactors;
    for (const k of OFFENCE_KEYS) r[k] = o[k] / base[k];
    return Object.freeze(r);
  };
  return { cycle: rel(T.offence.cycle), pointShots: rel(T.offence.pointShots), rush: rel(T.offence.rush) };
})();

/**
 * Multipliers on the carrier's offensive-zone options for `t.offence`: the brief's factors (TUNING.tactics.offence:
 * cycle 1.3 / 1 / 0.8 / 1 / 1.2, pointShots 1 / 1.4 / 1.4 / 1 / 1, rush 0.8 / 0.9 / 1 / 1.3 / 0.8 for lowCycle,
 * pointPass, pointShot, rushShot, hold) divided by the default's, so the default (cycle) is all 1 and plays as before.
 * The object returned is shared and frozen.
 */
export function offenceFactors(t: ResolvedTactics): OffenceFactors {
  return RELATIVE[t.offence];
}

/** TUNING.patience's tactic factor for `offence`: cycle 1, pointShots 0.9, rush 0.8. */
export function patienceFactor(offence: ResolvedTactics['offence']): number {
  return T.patience[offence];
}

/** A multiplier on an option value: a positive value times `k`, a negative one divided by it. */
export function shade(v: number, k: number): number {
  return k === 1 ? v : v >= 0 ? v * k : v / k;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * The tactics that suit a roster, from its players' habits and attributes alone (no random draw: the roster does not
 * change). Forwards are the top nine (the first three lines), defencemen all of `lines.defence` (TUNING.tactics.natural):
 * - zoneEntry: the forwards' mean carry - dump habit over 0.15 'carry', under -0.05 'dump', else 'mixed';
 * - offence: 'pointShots' when the defencemen's mean shootingPower is 74 or more and their mean shoot habit 0.35 or more,
 *   'rush' when the forwards' mean speed is 73 or more and their mean joinRush habit 0.55 or more, else 'cycle';
 * - forecheck: the forwards' mean forecheck habit over 0.62 'aggressive', under 0.48 'passive', else 'balanced';
 * - defence: 'pressure' when the defencemen's mean bodyChecking is 72 or more, else 'collapse';
 * - pinch: the defencemen's mean joinRush habit over 0.5 'often', under 0.3 'rarely', else 'sometimes'.
 */
export function naturalTactics(players: readonly PlayerDef[], lines: Lines): Pick<ResolvedTactics, 'forecheck' | 'zoneEntry' | 'offence' | 'defence' | 'pinch'> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const pick = (ids: readonly string[]): PlayerDef[] => ids.map((id) => byId.get(id)).filter((p): p is PlayerDef => p !== undefined);
  const fwd = pick(lines.forwards.slice(0, 3).flat());
  const def = pick(lines.defence.flat());
  const N = T.natural;
  const fm = (f: (p: PlayerDef) => number): number => mean(fwd.map(f));
  const dm = (f: (p: PlayerDef) => number): number => mean(def.map(f));
  const lean = fm((p) => p.tendencies.carry - p.tendencies.dump);
  const fc = fm((p) => p.tendencies.forecheck);
  const join = dm((p) => p.tendencies.joinRush);
  return {
    zoneEntry: lean > N.entry.carry ? 'carry' : lean < N.entry.dump ? 'dump' : 'mixed',
    offence: dm((p) => p.attrs.shootingPower) >= N.pointShots.shootingPower && dm((p) => p.tendencies.shoot) >= N.pointShots.shoot ? 'pointShots'
      : fm((p) => p.attrs.speed) >= N.rush.speed && fm((p) => p.tendencies.joinRush) >= N.rush.joinRush ? 'rush' : 'cycle',
    forecheck: fc > N.forecheck.aggressive ? 'aggressive' : fc < N.forecheck.passive ? 'passive' : 'balanced',
    defence: dm((p) => p.attrs.bodyChecking) >= N.pressure.bodyChecking ? 'pressure' : 'collapse',
    pinch: join > N.pinch.often ? 'often' : join < N.pinch.rarely ? 'rarely' : 'sometimes',
  };
}
