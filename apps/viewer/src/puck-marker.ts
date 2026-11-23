import { DT, type ContestState } from '@hockey/engine';
import type { Vec3 } from './pose-mix';
import type { Timeline } from './timeline';

/**
 * The puck marker (pure: no three.js, no DOM): a thin light ring on the ice under the puck, shown when the puck is hard
 * to find from where the camera is (a body between the camera and the puck: a cheap test against an upright capsule
 * per figure, no reading back of the picture) or when it lies in a board battle or a net-front scrum; never while it
 * is plainly visible in open ice. It fades in over MARKER_IN and out over MARKER_OUT. The page's "Puck marker" setting
 * is On (always), Auto (as above) or Off (never).
 *
 * When a board battle or a net-front battle ends and a man has the puck (the engine's carrier: the man it gave the puck
 * to, or the one who picked it up after), the ring under his blade (where the carried puck is drawn) is highlighted
 * for HIGHLIGHT_SECONDS, so who came away with it shows. A function of the moment and the timeline.
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
  // Plainly visible in open ice: never shown, not even fading out.
  if (open) return { k: 0, hidden, scrum, open };
  const want = hidden || scrum ? 1 : 0, h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const k = snap ? want : want > st.k ? Math.min(want, st.k + h / MARKER_IN) : Math.max(want, st.k - h / MARKER_OUT);
  return { k, hidden, scrum, open };
}

/**
 * The highlight of the ring under the man who came away with the puck from a battle (0..1): on for HIGHLIGHT_SECONDS
 * after a board battle or net-front battle ends while a man has the puck, fading over its last 0.25 s; 0 otherwise.
 */
export function battleHighlight(tl: Timeline, time: number, carrierId: string | null): number {
  if (carrierId === null) return 0;
  const tick = Math.floor(time), from = tick - Math.ceil(HIGHLIGHT_SECONDS / DT) - 1;
  // The latest board battle or net-front battle to end in that time (other contests may have ended since).
  let e = tl.last('contestEnd', tick, tick - from);
  while (e && e.detail.kind !== 'boardBattle' && e.detail.kind !== 'netFront') e = e.tick > from ? tl.last('contestEnd', e.tick - 1, e.tick - 1 - from) : undefined;
  if (!e) return 0;
  const t = (time - e.tick) * DT;
  if (t < 0 || t >= HIGHLIGHT_SECONDS) return 0;
  const u = (t - (HIGHLIGHT_SECONDS - 0.25)) / 0.25;
  return u <= 0 ? 1 : 1 - u * u * (3 - 2 * u);
}
