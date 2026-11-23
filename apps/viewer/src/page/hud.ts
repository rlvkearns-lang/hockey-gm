import type { GameEventOf, GameSetup, GameState, PlayerDef } from '@hockey/engine';
import { goalTagText, type GoalShow } from '../goal-show';
import type { Timeline } from '../timeline';

/**
 * The watch page's words on screen (DOM only, no three.js): the score bug (with a goal's flash and GOAL tag and a
 * save's pulse on the shots, goal-show.ts), the period and clock under the time bar,
 * the final summary, the bench note of the follow camera, the title, the frame counter and the messages (loading,
 * a problem, a new game being prepared, the slow-picture hint). Plain functions over the page's elements.
 */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const ORDINAL = ['', '1st', '2nd', '3rd'];
export const periodName = (p: number): string => ORDINAL[p] ?? (p === 4 ? 'OT' : `P${p}`);
export const clockText = (s: number): string => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** Set an element's text only when it changes (no needless layout). */
export const text = (el: HTMLElement, s: string): void => { if (el.textContent !== s) el.textContent = s; };

export function phaseLabel(st: GameState): { period: string; clock: string } {
  if (st.phase === 'final') return { period: 'Final', clock: '' };
  if (st.phase === 'intermission') return { period: `End of ${periodName(st.period)}`, clock: '' };
  return { period: periodName(st.period), clock: clockText(st.clock) };
}

/** What the HUD shows of one frame of a game. */
export type HudFrame = {
  setup: GameSetup; timeline: Timeline; result: { score: { home: number; away: number }; tied: boolean };
  /** The frame's earlier state, its later one, and whether the frame is the game's end. */
  prev: GameState; next: GameState; atEnd: boolean;
  /** What shows round a goal or a save at this moment (goal-show.ts goalShow). */
  show: GoalShow;
};

export type Hud = {
  /** Show the score bug, period and clock, shots and (at the end) the summary for this frame; returns the phase label. */
  update(f: HudFrame): { period: string; clock: string };
  /** The new game's team names (score bug and title). */
  teams(setup: GameSetup): void;
  /** The follow camera's note while its player is on the bench (`def` undefined: none chosen), or hidden (null). */
  benchNote(off: { def: PlayerDef | undefined } | null): void;
  /** A plain message under the picture (the current game stays as it was), or the picture's own message without one. */
  showProblem(message: string, hasGame: boolean): void;
  hideProblem(): void;
  /** The picture's own message ('Simulating…', no 3D, ...), or hidden (null). */
  loading(message: string | null): void;
  loadingShown(): boolean;
  /** The note that a new game is being prepared while this one plays on, or hidden (null). */
  preparing(message: string | null): void;
  fps(fps: number): void;
  /** The hint to switch to Low quality. */
  slow(show: boolean): void;
  /** The score bug's text, the period and clock line and the summary, for the screenshot script. */
  read(): { bug: string; when: string | null; summary: string | null };
};

export function createHud(): Hud {
  const loadingEl = $('loading'), problemEl = $('problem'), preparingEl = $('preparing');
  const summaryEl = $('summary'), benchEl = $('benchNote'), fpsEl = $('fps'), slowEl = $('slow');
  const goalEl = $('bugGoal'), shotsEl = $('bugShots');
  const teamEl = { home: $('bugHomeTeam'), away: $('bugAwayTeam') };
  /** Set a CSS number on an element only when it changes. */
  const setVar = (el: HTMLElement, name: string, v: number): void => {
    const s = v > 0.005 ? v.toFixed(2) : '0';
    if (el.style.getPropertyValue(name) !== s) el.style.setProperty(name, s);
  };
  let tagOf: GameEventOf<'goal'> | null = null;
  return {
    update(f) {
      const st = f.prev, sh = f.show;
      const ph = phaseLabel(f.atEnd ? f.next : st);
      text($('bugHomeScore'), String(sh.score.home));
      text($('bugAwayScore'), String(sh.score.away));
      setVar(teamEl.home, '--flash', sh.flash === 'home' ? sh.flashK : 0);
      setVar(teamEl.away, '--flash', sh.flash === 'away' ? sh.flashK : 0);
      setVar(teamEl.home, '--pop', sh.flash === 'home' ? sh.pop : 0);
      setVar(teamEl.away, '--pop', sh.flash === 'away' ? sh.pop : 0);
      setVar(shotsEl, '--pulse', sh.savePulse);
      if (sh.tag !== tagOf) {
        tagOf = sh.tag;
        goalEl.hidden = !tagOf;
        if (tagOf) {
          const words = goalTagText(tagOf, f.setup);
          text($('bugGoalWho'), words.scorer);
          text($('bugGoalAssists'), words.assists);
          goalEl.className = `bug-goal ${tagOf.side ?? ''}`;
        }
      }
      text($('bugPeriod'), ph.period);
      text($('bugClock'), ph.clock);
      $('bugClock').hidden = ph.clock === '';
      const shots = f.timeline.shotsAt(st.tick);
      text($('bugShots'), `Shots ${shots.home} – ${shots.away}`);
      text($('when'), ph.clock ? `${ph.period} · ${ph.clock}` : ph.period);
      summaryEl.hidden = !f.atEnd;
      if (f.atEnd) {
        const r = f.result, ts = f.timeline.shotsAt(Infinity);
        text(summaryEl, `Final: ${f.setup.home.name} ${r.score.home}, ${f.setup.away.name} ${r.score.away}${r.tied ? ' (a tie)' : ''} · Shots ${ts.home} – ${ts.away}`);
      }
      return ph;
    },
    teams(setup) {
      text($('bugHome'), setup.home.abbr);
      text($('bugAway'), setup.away.abbr);
      const title = $('title');
      const h = document.createElement('span'); h.className = 'home'; h.textContent = setup.home.name;
      const v = document.createElement('span'); v.className = 'vs'; v.textContent = ' vs ';
      const a = document.createElement('span'); a.className = 'away'; a.textContent = setup.away.name;
      title.replaceChildren(h, v, a);
    },
    benchNote(off) {
      benchEl.hidden = !off;
      if (off) benchEl.textContent = off.def ? `#${off.def.number} ${off.def.name} is on the bench` : 'No player chosen';
    },
    showProblem(message, hasGame) {
      if (hasGame) {
        loadingEl.hidden = true;
        problemEl.textContent = message;
        problemEl.hidden = false;
      } else {
        loadingEl.textContent = message;
        loadingEl.hidden = false;
        problemEl.hidden = true;
      }
    },
    hideProblem() { problemEl.hidden = true; },
    loading(message) {
      if (message === null) { loadingEl.hidden = true; return; }
      loadingEl.textContent = message;
      loadingEl.hidden = false;
    },
    loadingShown: () => !loadingEl.hidden,
    preparing(message) {
      if (message === null) { preparingEl.hidden = true; return; }
      preparingEl.textContent = message;
      preparingEl.hidden = false;
    },
    fps(fps) { text(fpsEl, fps > 0 ? `${Math.round(fps)} fps` : '– fps'); },
    slow(show) { slowEl.hidden = !show; },
    read: () => ({ bug: $('bug').innerText, when: $('when').textContent, summary: summaryEl.hidden ? null : summaryEl.textContent }),
  };
}
