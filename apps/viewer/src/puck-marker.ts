import { DT, type ContestState, type GameEventOf, type GameState } from '@hockey/engine';
import type { Vec3 } from './pose-mix';
import type { Timeline } from './timeline';

/**
 * The puck marker (pure: no three.js, no DOM): a thin light ring on the ice under the puck, shown when the puck is hard
 * to find from where the camera is (a body between the camera and the puck: a cheap test against an upright capsule
 * per figure, no reading back of the picture) or when it lies in a board battle or a net-front scrum; never while it
 * is plainly visible in open ice (once it has faded out). It fades in over MARKER_IN and out over MARKER_OUT. It is
 * drawn about the same size in the picture whatever the camera's distance: markerSize. The page's "Puck marker" setting
 * is On (always), Auto (as above) or Off (never).
 *
 * When a board battle or a net-front battle ends and a man who was in it has the puck, the ring under his blade (where
 * the carried puck is drawn) is highlighted for HIGHLIGHT_SECONDS, so who came away with it shows: the man the engine
 * gave the puck to at the battle's end (contestEnd `puck: 'toWinner'`), or one of its participants or supporters who
 * has it (a net-front battle, which is not fought for the puck, only while the puck is within SCRUM_REACH of its
 * spot). A man who was in no battle never lights it. A function of the moment, the timeline and the frame's engine
 * state (cameAwayWith).
 */

export type MarkerMode = 'on' | 'auto' | 'off';
export const MARKER_MODES: readonly MarkerMode[] = ['on', 'auto', 'off'];

/** Seconds the ring takes to fade in and out. */
export const MARKER_IN = 0.2, MARKER_OUT = 0.25;
/** The puck is in open ice when it is further than this (m) from every skater on the ice. */
export const OPEN_ICE = 2.5;
/** The puck lies in a board battle or a net-front scrum within this distance (m) of its spot. */
export const SCRUM_REACH = 2.5;
/** Seconds the ring under the winner's blade is highlighted after a battle. */
export const HIGHLIGHT_SECONDS = 1;

/** An upright body: where it stands (world x, z), its radius and height (m), and whether it is on the ice. */
export type MarkerBody = { x: number; z: number; r: number; h: number; on: boolean };

/**
 * Whether a body hides the puck at `puck` (world, y its height) from a camera at `cam`: the line of sight passes within
 * a body's radius of its upright axis (from the ice to its height), or over its top within its radius.
 */
export function puckHidden(cam: Vec3, puck: Vec3, bodies: readonly MarkerBody[]): boolean {
  const dx = puck.x - cam.x, dz = puck.z - cam.z, dy = puck.y - cam.y, l2 = dx * dx + dz * dz;
  for (const b of bodies) {
    if (!b.on) continue;
    // The point of the sight line nearest the body's axis seen from above, and how high the line is there.
    let t = l2 > 1e-12 ? ((b.x - cam.x) * dx + (b.z - cam.z) * dz) / l2 : 1;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hx = cam.x + dx * t - b.x, hz = cam.z + dz * t - b.z, y = cam.y + dy * t;
    const over = y > b.h ? y - b.h : y < 0 ? -y : 0;
    if (hx * hx + hz * hz + over * over < b.r * b.r) return true;
  }
  return false;
}

/** Whether the puck (world x, z) is more than OPEN_ICE from every skater on the ice. */
export function inOpenIce(puck: Vec3, skaters: readonly MarkerBody[]): boolean {
  for (const b of skaters) if (b.on && (b.x - puck.x) ** 2 + (b.z - puck.z) ** 2 <= OPEN_ICE * OPEN_ICE) return false;
  return true;
}

/** Whether the puck (world x, z) lies in a board battle or a net-front scrum under way. */
export function inScrum(puck: Vec3, contests: readonly ContestState[]): boolean {
  for (const c of contests) {
    if (c.kind !== 'boardBattle' && c.kind !== 'netFront') continue;
    if ((c.spot.x - puck.x) ** 2 + (c.spot.y - puck.z) ** 2 <= SCRUM_REACH * SCRUM_REACH) return true;
  }
  return false;
}

/** What the marker decides from for one frame. `skaters` are the skaters only (for open ice); `bodies` every figure. */
export type MarkerInput = {
  mode: MarkerMode; cam: Vec3; puck: Vec3;
  skaters: readonly MarkerBody[]; bodies: readonly MarkerBody[];
  contests: readonly ContestState[];
};

/** How much the ring shows (0..1); `hidden` and `scrum` say why, for the picture's tests. */
export type MarkerState = { k: number; hidden: boolean; scrum: boolean; open: boolean };
export const initialMarker = (): MarkerState => ({ k: 0, hidden: false, scrum: false, open: true });

/** The marker for the next frame, `dt` seconds of display time on (`snap`: straight to what it should be, e.g. a seek). */
export function stepMarker(st: MarkerState, input: MarkerInput, dt: number, snap = false): MarkerState {
  if (input.mode === 'off') return { k: 0, hidden: false, scrum: false, open: false };
  const hidden = puckHidden(input.cam, input.puck, input.bodies);
  const scrum = inScrum(input.puck, input.contests);
  const open = !hidden && inOpenIce(input.puck, input.skaters);
  if (input.mode === 'on') return { k: 1, hidden, scrum, open };
  // Plainly visible in open ice: not shown (fading out over MARKER_OUT if it was).
  const want = !open && (hidden || scrum) ? 1 : 0, h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const k = snap ? want : want > st.k ? Math.min(want, st.k + h / MARKER_IN) : Math.max(want, st.k - h / MARKER_OUT);
  return { k, hidden, scrum, open };
}

/**
 * Whether `carrierId` came away with the puck from the battle that ended with `e`: the man the engine gave it to at the
 * end (`puck: 'toWinner'`), or one of the men in it. Its first two are in its `contestStart`; a supporter who joins a
 * board battle later is in no event, but the engine sets the same contest cooldown on everyone in it as it ends
 * (`contestCooldowns`, one entry per man and kind, until the same tick), so a man whose board-battle cooldown runs to
 * the same tick as one of its first two men's was in it. A net-front battle only while the puck (`puck`, engine x and
 * z) is within SCRUM_REACH of its spot (the event's place).
 */
export function cameAwayWith(tl: Timeline, e: GameEventOf<'contestEnd'>, carrierId: string, state: Readonly<GameState>, puck: { x: number; z: number }): boolean {
  if (e.detail.kind === 'netFront' && (puck.x - e.pos.x) ** 2 + (puck.z - e.pos.y) ** 2 > SCRUM_REACH * SCRUM_REACH) return false;
  if (e.detail.puck === 'toWinner' && e.detail.winnerId === carrierId) return true;
  const first = tl.contest(e.detail.contestId)?.start.detail.participants ?? [];
  if (first.includes(carrierId)) return true;
  if (e.detail.kind !== 'boardBattle') return false;
  let until = -1, mine = -2;
  for (const c of state.contestCooldowns) {
    if (c.kind !== 'boardBattle' || c.untilTick <= e.tick) continue;
    if (first.includes(c.id)) until = Math.max(until, c.untilTick);
    if (c.id === carrierId) mine = c.untilTick;
  }
  return mine === until;
}

/**
 * The highlight of the ring under the man who came away with the puck from a battle (0..1): on for HIGHLIGHT_SECONDS
 * after a board battle or net-front battle ends while a man who was in it has the puck (cameAwayWith; the latest such
 * battle), fading over its last 0.25 s; 0 otherwise. `state` is the frame's engine state and `puck` the engine's puck
 * (x, z).
 */
export function battleHighlight(tl: Timeline, time: number, carrierId: string | null, state: Readonly<GameState>, puck: { x: number; z: number }): number {
  if (carrierId === null) return 0;
  const tick = Math.floor(time), from = tick - Math.ceil(HIGHLIGHT_SECONDS / DT) - 1;
  // The latest board battle or net-front battle to end in that time that he came away from (other contests may have
  // ended since).
  let e = tl.last('contestEnd', tick, tick - from);
  while (e && ((e.detail.kind !== 'boardBattle' && e.detail.kind !== 'netFront') || !cameAwayWith(tl, e, carrierId, state, puck))) {
    e = e.tick > from ? tl.last('contestEnd', e.tick - 1, e.tick - 1 - from) : undefined;
  }
  if (!e) return 0;
  const t = (time - e.tick) * DT;
  if (t < 0 || t >= HIGHLIGHT_SECONDS) return 0;
  const u = (t - (HIGHLIGHT_SECONDS - 0.25)) / 0.25;
  return u <= 0 ? 1 : 1 - u * u * (3 - 2 * u);
}

/** The ring's radius and line width in the picture (CSS pixels; `heightPx` is the picture's CSS height). */
export const MARKER_PX = { radius: 12, width: 3 };
/** Its radius on the ice is kept within these (m): near the camera never smaller than a puck's surroundings. */
export const MARKER_RADIUS: readonly [number, number] = [0.22, 2.5];

/**
 * The ring's radius on the ice (m) for MARKER_PX.radius pixels in a picture `heightPx` tall from a camera `dist` metres
 * away with vertical field of view `fovDeg`, within MARKER_RADIUS. Its line is MARKER_PX.width / MARKER_PX.radius of it.
 */
export function markerRadius(dist: number, fovDeg: number, heightPx: number): number {
  const ppm = heightPx / (2 * Math.max(dist, 0.1) * Math.tan((fovDeg * Math.PI) / 360));
  const r = MARKER_PX.radius / ppm;
  return Math.min(MARKER_RADIUS[1], Math.max(MARKER_RADIUS[0], Number.isFinite(r) ? r : MARKER_RADIUS[0]));
}
