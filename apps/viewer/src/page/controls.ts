import type { GameSetup } from '@hockey/engine';
import type { ArenaQuality } from '../arena';
import { CAMERA_NAMES, type CameraName } from '../cameras';
import type { MarkerMode } from '../puck-marker';
import { $, text } from './hud';

/**
 * The watch page's controls (DOM only): Play, speeds, camera angles, the player picker, quality, the puck marker, To end, the seed
 * field and New game, the frame-counter switch, and the keys (Space plays or pauses, the arrows step five seconds,
 * 1 to 7 pick an angle, in the order of the camera buttons). Each control calls one of the page's actions; the page tells the controls what to show.
 */

/** What the controls ask the page to do. */
export type ControlActions = {
  togglePlay(): void;
  setSpeed(v: number): void;
  setCamera(name: CameraName): void;
  setQuality(q: ArenaQuality): void;
  /** The puck marker: On, Auto (when the puck is hidden or in a scrum) or Off. */
  setMarker(mode: MarkerMode): void;
  toEnd(): void;
  newGame(): void;
  follow(id: string): void;
  /** Seek `seconds` of game time from now (played in). */
  seekBy(seconds: number): void;
};
/** What the controls need to know of the page. */
export type ControlState = { hasGame(): boolean; busy(): boolean; preparing(): boolean };

export type Controls = {
  /** Turn the controls on or off. Without a game only Seed and New game work (the rest need one). */
  setControls(on: boolean): void;
  /** No picture can be made: every control off. */
  disableAll(): void;
  showPlaying(playing: boolean): void;
  showSpeed(v: number): void;
  /** The pressed angle; the picker shows the followed player only while following him. */
  showCamera(name: CameraName, followId: string): void;
  showFollow(id: string): void;
  showQuality(q: ArenaQuality): void;
  showMarker(mode: MarkerMode): void;
  /** The players to follow: each team's skaters and its starting goalie, by position and number. */
  fillFollow(setup: GameSetup): void;
  /** The seed typed in the field: a whole number, or null (with nothing silently put in its place). */
  readSeed(): number | null;
  /** Write the seed actually played back into the field. */
  showSeed(seed: number): void;
};

const ALL = 'main button, main input, main select';

export function createControls(act: ControlActions, page: ControlState): Controls {
  const playBtn = $<HTMLButtonElement>('play');
  const followSel = $<HTMLSelectElement>('follow');
  const seedInput = $<HTMLInputElement>('seed');
  const newGameBtn = $<HTMLButtonElement>('newGame');

  playBtn.addEventListener('click', () => act.togglePlay());
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => act.setSpeed(Number(b.dataset.speed))));
  document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.addEventListener('click', () => act.setCamera(b.dataset.camera as CameraName)));
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.addEventListener('click', () => act.setQuality(b.dataset.quality as ArenaQuality)));
  document.querySelectorAll<HTMLButtonElement>('[data-marker]').forEach((b) => b.addEventListener('click', () => act.setMarker(b.dataset.marker as MarkerMode)));
  $('toEnd').addEventListener('click', () => act.toEnd());
  $('toLow').addEventListener('click', () => act.setQuality('low'));
  newGameBtn.addEventListener('click', () => act.newGame());
  seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') act.newGame(); });
  followSel.addEventListener('change', () => act.follow(followSel.value));
  $<HTMLInputElement>('showFps').addEventListener('change', (e) => { $('fps').hidden = !(e.target as HTMLInputElement).checked; });

  /** Space presses a focused button or ticks a focused checkbox, as everywhere else; elsewhere it plays or pauses. */
  const pressable = (t: EventTarget | null): boolean => t instanceof HTMLButtonElement || (t instanceof HTMLInputElement && t.type === 'checkbox');
  const typing = (t: EventTarget | null): boolean => t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox');
  document.addEventListener('keydown', (e) => {
    if (!page.hasGame() || page.busy() || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.key === ' ') { if (pressable(e.target)) return; e.preventDefault(); if (!e.repeat) act.togglePlay(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); act.seekBy((e.key === 'ArrowRight' ? 1 : -1) * 5); return; }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= CAMERA_NAMES.length) { e.preventDefault(); act.setCamera(CAMERA_NAMES[n - 1]!); }
  });
  // Space on the time bar must not scroll the page or reach anything else when the key comes up.
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && !typing(e.target) && !pressable(e.target)) e.preventDefault(); });

  return {
    setControls(on) {
      document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(ALL).forEach((b) => {
        b.disabled = !on || (!page.hasGame() && b !== seedInput && b.id !== 'newGame') || (page.preparing() && (b === seedInput || b === newGameBtn));
      });
    },
    disableAll() {
      document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(ALL).forEach((b) => { b.disabled = true; });
    },
    showPlaying(playing) { text(playBtn, playing ? 'Pause' : 'Play'); },
    showSpeed(v) {
      document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
    },
    showCamera(name, followId) {
      followSel.value = name === 'follow' ? followId : '';
      document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.camera === name)));
    },
    showFollow(id) { followSel.value = id; },
    showQuality(q) {
      document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === q)));
    },
    showMarker(mode) {
      document.querySelectorAll<HTMLButtonElement>('[data-marker]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.marker === mode)));
    },
    fillFollow(setup) {
      const order = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 } as const;
      const posName = { G: 'Goalie', C: 'Centre', LW: 'Left wing', RW: 'Right wing', LD: 'Defence', RD: 'Defence' } as const;
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'Choose a player…';
      none.disabled = true;
      followSel.replaceChildren(none);
      for (const side of ['home', 'away'] as const) {
        const team = setup[side];
        const group = document.createElement('optgroup');
        group.label = team.name;
        // Skaters and the starting goalie (the only goalie on the ice).
        const players = team.players.filter((p) => p.position !== 'G' || p.id === team.lines.goalie);
        for (const p of players.sort((a, b) => order[a.position] - order[b.position] || a.number - b.number)) {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = `#${p.number} ${p.name} · ${posName[p.position]}`;
          group.appendChild(o);
        }
        followSel.appendChild(group);
      }
    },
    readSeed() {
      const raw = seedInput.value.trim();
      if (!/^-?\d+$/.test(raw)) return null;
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : null;
    },
    showSeed(seed) { seedInput.value = String(seed); },
  };
}
