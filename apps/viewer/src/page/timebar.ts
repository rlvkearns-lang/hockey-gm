import { DT, type GameSetup, type PlayerDef, type Side } from '@hockey/engine';
import type { Timeline } from '../timeline';
import { $, clockText, periodName } from './hud';

/**
 * The time bar (DOM only): the period labels and splits, the goal marks above it (each a button that plays the goal
 * from just before), and the range input itself. Dragging it seeks plainly at each step and plays the moment in once
 * it rests or the drag ends; keys on it seek one step, played in.
 */

/** Seconds before a goal that its mark on the time line jumps to. */
export const GOAL_LEAD = 6;
/** While the time bar is dragged, seeks are plain; this long (ms) after it stops moving, the moment is played in. */
const SCRUB_SETTLE_MS = 150;
/** Goal marks closer than this (px) on the time line are stacked. */
const MARK_PX = 15;

/** A goal's mark: when, whose, and what its label says. */
export type Mark = { tick: number; side: Side; text: string };

/** The goal marks of a game, with their labels (scorer, assists, clock and period). */
export function goalMarks(timeline: Timeline, defs: ReadonlyMap<string, PlayerDef>, setup: GameSetup): Mark[] {
  const marks: Mark[] = [];
  for (const e of timeline.goals) {
    if (!e.side) continue;
    const who = e.playerId ? defs.get(e.playerId)?.name ?? '' : '';
    const assists = e.assistIds.length === 0 ? 'unassisted' : `assisted by ${e.assistIds.map((id) => defs.get(id)?.name ?? id).join(' and ')}`;
    marks.push({ tick: e.tick, side: e.side, text: `Goal, ${setup[e.side].abbr}: ${who}, ${assists}. ${clockText(e.clock)} ${periodName(e.period)}` });
  }
  return marks;
}

export type Timebar = {
  /** Lay out the periods and the goal marks for a game of `totalTicks`. */
  draw(totalTicks: number, periodEnds: readonly number[], goals: readonly Mark[]): void;
  /** Show display time `pos` (ticks) of `totalTicks`; `label` is the spoken period and clock. Not while dragged. */
  show(pos: number, totalTicks: number, label: { period: string; clock: string }): void;
  /** Whether the bar is being dragged. */
  scrubbing(): boolean;
};

/**
 * `seek(tick, settle)` shows a moment (settle: played in); `playGoal(tick)` plays a goal from GOAL_LEAD seconds before.
 */
export function createTimebar(on: { seek(tick: number, settle: boolean): void; playGoal(tick: number): void }): Timebar {
  const scrub = $<HTMLInputElement>('scrub');
  let scrubbing = false;
  /** Whether the bar's value changed during this drag (a press and release without a move seeks nothing). */
  let moved = false;
  let settleTimer = 0;
  /** The drag ended (or was cancelled by the browser): play the moment in, now, if the drag moved it. */
  const endScrub = (): void => {
    if (!scrubbing) return;
    scrubbing = false;
    clearTimeout(settleTimer);
    if (moved) on.seek(Number(scrub.value), true);
    moved = false;
  };
  scrub.addEventListener('pointerdown', () => { scrubbing = true; moved = false; });
  window.addEventListener('pointerup', endScrub);
  window.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('input', () => {
    if (!scrubbing) { on.seek(Number(scrub.value), true); return; } // keys on the time bar: one step, played in
    // Dragging: a plain seek per step keeps up with the pointer; once it rests, the moment is played in.
    moved = true;
    on.seek(Number(scrub.value), false);
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => { if (scrubbing) on.seek(Number(scrub.value), true); }, SCRUB_SETTLE_MS);
  });

  return {
    draw(totalTicks, periodEnds, goals) {
      const total = Math.max(1, totalTicks);
      scrub.max = String(totalTicks);
      const pct = (t: number): string => `${(100 * t) / total}%`;
      const periods = $('periods');
      const parts: HTMLElement[] = [];
      let start = 0;
      const ends = periodEnds.length > 0 ? periodEnds : [total];
      ends.forEach((end, i) => {
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = periodName(i + 1);
        label.style.left = pct((start + Math.min(end, total)) / 2);
        parts.push(label);
        if (end < total - 1) {
          const split = document.createElement('span');
          split.className = 'split';
          split.style.left = pct(end);
          parts.push(split);
        }
        start = end;
      });
      periods.replaceChildren(...parts);
      // Goals close together stack upward, so each mark can be seen and clicked.
      const width = Math.max(1, $('goals').clientWidth);
      let lastX = -Infinity, level = 0, maxLevel = 0;
      $('goals').replaceChildren(...goals.map((g) => {
        const x = (g.tick / total) * width;
        level = x - lastX < MARK_PX ? level + 1 : 0;
        if (level === 0) lastX = x;
        maxLevel = Math.max(maxLevel, level);
        const b = document.createElement('button');
        b.className = g.side;
        b.style.left = pct(g.tick);
        b.style.top = `${-1 - level * MARK_PX}px`;
        b.title = g.text;
        b.setAttribute('aria-label', `${g.text}. Watch it from just before.`);
        b.addEventListener('click', () => on.playGoal(g.tick - GOAL_LEAD / DT));
        return b;
      }));
      $('timeline').style.marginTop = `${14 + maxLevel * MARK_PX}px`;
    },
    show(pos, totalTicks, ph) {
      if (!scrubbing) {
        const v = String(Math.round(pos));
        if (scrub.value !== v) scrub.value = v;
      }
      scrub.style.setProperty('--pct', `${(100 * pos) / Math.max(1, totalTicks)}%`);
      scrub.setAttribute('aria-valuetext', ph.clock ? `${ph.period} period, ${ph.clock} left` : ph.period);
    },
    scrubbing: () => scrubbing,
  };
}
