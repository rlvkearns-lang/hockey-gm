import type * as THREE from 'three';
import { generateTeam, type GameSetup, type PlayerDef } from '@hockey/engine';
import type { ArenaQuality } from '../arena';
import { createCursor, type Playback } from '../playback';
import { recordGame, type WorkerLike } from '../record-game';
import { createGameScene, type GameScene } from '../scene';
import { buildTimeline, type Timeline } from '../timeline';
import type { Hud } from './hud';
import type { Renderer } from './renderer';
import { goalMarks, type Mark } from './timebar';

/**
 * The game on the watch page, from New game to the next: playing it up front (in a background thread when the browser
 * allows one; recordGame), building its scene, and replacing the renderer and scene for a change of quality. One at a
 * time: the game on screen keeps playing (and stays usable) until the new one is ready, and everything for the new
 * game is made before the old one is let go, so if anything fails the game on screen stays as it was.
 */

export type Game = {
  setup: GameSetup; playback: Playback; gs: GameScene; defs: Map<string, PlayerDef>;
  /** The event timeline, shared by the HUD, the time bar and the scene. */
  timeline: Timeline;
  goals: Mark[];
  scoreboard: THREE.Object3D | undefined;
};

/** What the lifecycle needs from the rest of the page. */
export type LifecycleHooks = {
  readSeed(): number | null;
  showSeed(seed: number): void;
  setControls(on: boolean): void;
  isPlaying(): boolean;
  setPlaying(on: boolean): void;
  /** The display time now (ticks). */
  position(): number;
  /** Show `tick`, played in. */
  seek(tick: number): void;
  showQuality(q: ArenaQuality): void;
  /** A change of quality starts the slow-picture count afresh. */
  resetSlow(): void;
  /** A new game is on screen (the old one, if any, is let go): show its teams, players and time bar, and its start. */
  started(game: Game): void;
};

export type Lifecycle = {
  game(): Game | null;
  busy(): boolean;
  preparing(): boolean;
  newGame(): Promise<void>;
  setQuality(q: ArenaQuality): Promise<void>;
  /** For the screenshot script: make the next New game or quality change fail, to check the page survives it. */
  failNext(what: 'game' | 'quality'): void;
  /** How the current game was played: wall time (ms), where, and what went wrong with the worker, if anything. */
  made(): { simulateMs: number; simulatedIn: 'worker' | 'main' | ''; workerProblem: string | null };
};

const nextPaint = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export function createLifecycle(renderer: Renderer, hud: Hud, page: LifecycleHooks, makeWorker: () => WorkerLike): Lifecycle {
  let game: Game | null = null;
  let busy = false;
  /** A new game is being played in the background; the current one stays on screen and usable until it is ready. */
  let preparing = false;
  let failNext: 'game' | 'quality' | null = null;
  const maybeFail = (what: 'game' | 'quality'): void => { if (failNext === what) { failNext = null; throw new Error(`test failure: ${what}`); } };
  let simulateMs = 0;
  let simulatedIn: 'worker' | 'main' | '' = '';
  let workerProblem: string | null = null;

  function buildScene(setup: GameSetup, timeline: Timeline): GameScene {
    const gs = createGameScene(setup, { quality: renderer.quality(), timeline });
    renderer.scene.add(gs.root);
    return gs;
  }
  function dropScene(gs: GameScene): void {
    renderer.scene.remove(gs.root);
    gs.dispose();
  }

  /** Replace the renderer and the game scene for quality `q`, staying at the same moment of the game. */
  function rebuild(q: ArenaQuality, at: number): void {
    page.showQuality(q);
    if (game && game.gs.root.parent) dropScene(game.gs);
    renderer.make(q);
    if (game) {
      game.gs = buildScene(game.setup, game.timeline);
      game.scoreboard = game.gs.root.getObjectByName('scoreboard');
      page.seek(at);
    }
  }

  async function setQuality(q: ArenaQuality): Promise<void> {
    if (busy || preparing || q === renderer.quality()) return;
    busy = true;
    const before = renderer.quality(), at = page.position();
    hud.slow(false);
    hud.hideProblem();
    page.resetSlow();
    const wasPlaying = page.isPlaying();
    page.setPlaying(false);
    page.setControls(false);
    try {
      await nextPaint();
      rebuild(q, at);
      maybeFail('quality');
    } catch (e) {
      console.error(e);
      // Go back to the quality that worked; if even that fails, there is no picture to show.
      try {
        rebuild(before, at);
        hud.showProblem(`Sorry, quality ${q === 'high' ? 'High' : 'Low'} could not be set up on this computer. Staying on ${before === 'high' ? 'High' : 'Low'}.`, game !== null);
      } catch (e2) {
        console.error(e2);
        game = null;
        hud.showProblem('Sorry, the picture could not be set up on this computer. Try reloading the page.', false);
      }
    } finally {
      busy = false;
      page.setControls(true);
      page.setPlaying(wasPlaying);
    }
  }

  async function newGame(): Promise<void> {
    if (busy || preparing) return;
    const seed = page.readSeed();
    if (seed === null) {
      hud.showProblem('The seed must be a whole number, like 42. Type one and press New game.', game !== null);
      return;
    }
    page.showSeed(seed); // the seed actually played, as the engine reads it
    preparing = true;
    page.setControls(true);
    hud.hideProblem();
    if (game) hud.preparing(`Preparing a new game (seed ${seed})… This one keeps going until it is ready.`);
    else hud.loading('Simulating…');
    try {
      await nextPaint();
      const setup: GameSetup = { home: generateTeam(seed * 2 + 1, 'Harbour City', 'HBR'), away: generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK'), seed, chemistry: [] };
      const made = await recordGame(setup, { makeWorker });
      // A quality change may have started while the game was being played; wait for it to finish.
      while (busy) await nextPaint();
      busy = true;
      const playback = createCursor(setup, made.recording);
      const defs = new Map<string, PlayerDef>();
      for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
      const timeline = buildTimeline(playback.events);
      const goals = goalMarks(timeline, defs, setup);
      maybeFail('game');
      const gs = buildScene(setup, timeline);
      // Made: let the old game go.
      page.setPlaying(false);
      const old = game;
      game = { setup, playback, gs, defs, timeline, goals, scoreboard: gs.root.getObjectByName('scoreboard') };
      if (old) dropScene(old.gs);
      simulateMs = made.ms;
      simulatedIn = made.where;
      workerProblem = made.workerProblem ?? null;
      page.started(game);
      hud.loading(null);
    } catch (e) {
      console.error(e);
      hud.showProblem(`Sorry, this game could not be set up (seed ${seed}). Try another seed and press New game.`, game !== null);
    } finally {
      busy = false;
      preparing = false;
      hud.preparing(null);
      page.setControls(true);
    }
  }

  return {
    game: () => game,
    busy: () => busy,
    preparing: () => preparing,
    newGame,
    setQuality,
    failNext: (what) => { failNext = what; },
    made: () => ({ simulateMs, simulatedIn, workerProblem }),
  };
}
