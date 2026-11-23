import { DT, RINK, type GameEventOf, type GameSetup, type PlayerDef, type Side } from '@hockey/engine';
import type { Timeline } from './timeline';

/**
 * What the page and the scene show round a goal and a save (pure: no three.js, no DOM), as a function of the display
 * time and the event timeline only, so a seek into those seconds shows it and a seek out of them clears it:
 *
 * - the goal light behind the net scored on: lit from the goal's tick for GOAL_LIGHT_SECONDS;
 * - the score bug: the score as of the moment (the timeline's scoreAt), the scoring side's half flashing its colour
 *   for GOAL_FLASH_SECONDS, and a GOAL tag naming the scorer and the assists for GOAL_TAG_SECONDS;
 * - the camera's hold on the net and the scorer from the goal's tick (on with time constant GOAL_HOLD_IN; nothing
 *   about the camera before the goal depends on whether the shot goes in, so the camera gives nothing away) for
 *   GOAL_HOLD_SECONDS, easing back to the play over GOAL_HOLD_EASE;
 * - a save: the shots number pulses for SAVE_PULSE_SECONDS (nothing else; no words over the ice).
 */

export const GOAL_LIGHT_SECONDS = 3;
export const GOAL_FLASH_SECONDS = 3;
export const GOAL_TAG_SECONDS = 5;
export const GOAL_HOLD_SECONDS = 3;
/** Seconds the camera's hold takes to let go of the net once GOAL_HOLD_SECONDS are over. */
export const GOAL_HOLD_EASE = 1;
/** Time constant (s) of the camera's hold coming on at the goal's tick. */
export const GOAL_HOLD_IN = 0.06;
export const SAVE_PULSE_SECONDS = 0.6;
/** How often (s) the flash on the score bug pulses. */
const FLASH_PERIOD = 0.6;
/** Seconds of the score digits' pop. */
const POP_SECONDS = 0.8;

const LONGEST = Math.max(GOAL_LIGHT_SECONDS, GOAL_FLASH_SECONDS, GOAL_TAG_SECONDS, GOAL_HOLD_SECONDS + GOAL_HOLD_EASE);

export type GoalShow = {
  /** The score shown (the timeline's scoreAt the moment). */
  score: { home: number; away: number };
  /** The latest goal while anything of it shows, and the seconds since its tick. */
  goal: GameEventOf<'goal'> | null; since: number;
  /** The end (sign of world x) of the net whose light is lit, or null. */
  light: 1 | -1 | null;
  /** The side whose half of the score bug flashes, and how bright the flash is now (0..1, pulsing). */
  flash: Side | null; flashK: number;
  /** How much the scoring side's score digits pop (0..1, a single swell over POP_SECONDS from the goal). */
  pop: number;
  /** The GOAL tag's goal (scorer and assists), or null. */
  tag: GameEventOf<'goal'> | null;
  /** The camera's hold on the net scored on (null when none): the net (world, on the goal line) and its weight (0..1). */
  hold: { net: { x: number; y: number; z: number }; k: number; scorerId: string | null } | null;
  /** The save pulse on the shots number (0..1, 0 when none). */
  savePulse: number;
};

const smooth = (t: number): number => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * (3 - 2 * u); };

/** The end (sign of world x) of the net a goal went into: where the puck crossed the line. */
export const goalEnd = (goal: GameEventOf<'goal'>): 1 | -1 => (goal.pos.x >= 0 ? 1 : -1);

/** The middle of the goal line of the net a goal went into (world: x, z on the ice). */
export const goalNet = (goal: GameEventOf<'goal'>): { x: number; y: number; z: number } => ({ x: goalEnd(goal) * RINK.goalLineX, y: 0, z: 0 });

/** What shows at display time `time` (ticks, fractional). */
export function goalShow(tl: Timeline, time: number): GoalShow {
  const t = Number.isFinite(time) ? time : 0;
  const tick = Math.floor(t);
  const goal = tl.last('goal', tick, Math.ceil(LONGEST / DT) + 1) ?? null;
  const since = goal ? (t - goal.tick) * DT : Infinity;
  const live = goal !== null && since >= 0 && since < LONGEST;
  const save = tl.last('save', tick, Math.ceil(SAVE_PULSE_SECONDS / DT) + 1);
  const saveSince = save ? (t - save.tick) * DT : Infinity;
  const show: GoalShow = {
    score: tl.scoreAt(tick),
    goal: live ? goal : null, since: live ? since : Infinity,
    light: null, flash: null, flashK: 0, pop: 0, tag: null, hold: null,
    savePulse: saveSince >= 0 && saveSince < SAVE_PULSE_SECONDS ? 1 - smooth(saveSince / SAVE_PULSE_SECONDS) : 0,
  };
  if (!live || !goal) return show;
  if (since < GOAL_LIGHT_SECONDS) show.light = goalEnd(goal);
  if (since < GOAL_FLASH_SECONDS && goal.side) {
    show.flash = goal.side;
    // Full at the goal, pulsing, fading out over the 3 s; the score digits pop as it goes up.
    show.flashK = (0.85 + 0.15 * Math.cos((2 * Math.PI * since) / FLASH_PERIOD)) * (1 - smooth((since - 1) / (GOAL_FLASH_SECONDS - 1)));
    show.pop = since < POP_SECONDS ? Math.sin((Math.PI * since) / POP_SECONDS) : 0;
  }
  if (since < GOAL_TAG_SECONDS) show.tag = goal;
  if (since < GOAL_HOLD_SECONDS + GOAL_HOLD_EASE) {
    show.hold = { net: goalNet(goal), k: (1 - Math.exp(-since / GOAL_HOLD_IN)) * (1 - smooth((since - GOAL_HOLD_SECONDS) / GOAL_HOLD_EASE)), scorerId: goal.playerId };
  }
  return show;
}

/** A player as the tag names him: "#12 Surname" (his full name if it is one word). */
function named(def: PlayerDef | undefined, id: string): string {
  if (!def) return id;
  return `#${def.number} ${def.name.trim().split(/\s+/).pop() ?? def.name}`;
}

/** The GOAL tag's words: the scorer and, if any, the assists. */
export function goalTagText(goal: GameEventOf<'goal'>, setup: GameSetup): { scorer: string; assists: string } {
  const find = (id: string): PlayerDef | undefined => setup.home.players.find((p) => p.id === id) ?? setup.away.players.find((p) => p.id === id);
  const scorer = goal.playerId ? named(find(goal.playerId), goal.playerId) : '';
  const assists = goal.assistIds.length === 0 ? 'Unassisted' : `Assists: ${goal.assistIds.map((id) => named(find(id), id)).join(', ')}`;
  return { scorer, assists };
}
