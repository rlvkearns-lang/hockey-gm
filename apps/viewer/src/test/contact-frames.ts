import type { GameState } from '@hockey/engine';
import { GET_UP_TAIL_SECONDS } from '../overlays/contact';

/**
 * The impact and fall frames of the real-game continuity bounds, from engine facts only: a skater in a hit contest's
 * `impact` stage, or down (`downT > 0`), at either of the frame's two ticks, and the frames within GET_UP_TAIL seconds
 * after his downT is back to 0: the fall's own end, overlays/contact.ts GET_UP_TAIL_SECONDS (the fall overlay holds
 * until the gait has blended out of its down pose, GAIT.blendDown after downT reaches 0).
 * In those frames a hit and a fall may move a part of him faster than the ordinary bound (the brief allows 0.6 m a
 * frame); the bounds below are what the code achieves, with a margin.
 */
export const GET_UP_TAIL = GET_UP_TAIL_SECONDS;
/** Hands and blade (m per 60 Hz frame) in those frames: 0.32 m is the worst over seed 5's first period. */
export const CONTACT_FRAME_BOUND = 0.4;
/** Hips and skates (m per 60 Hz frame) in those frames: 0.17 m is the worst over seed 5's first period. */
export const CONTACT_FRAME_BODY_BOUND = 0.22;

export type ContactFrames = {
  /** Whether skater `id` is in an impact or fall frame at frame time `time` (seconds of display time, increasing). */
  at(time: number, prev: GameState, next: GameState, id: string): boolean;
};

export function contactFrames(): ContactFrames {
  const lastDown = new Map<string, number>();
  return {
    at(time, prev, next, id) {
      const p = prev.skaters.find((s) => s.id === id), n = next.skaters.find((s) => s.id === id);
      if ((p && p.downT > 0) || (n && n.downT > 0)) { lastDown.set(id, time); return true; }
      for (const st of [prev, next]) {
        for (const c of st.contests) if (c.kind === 'hit' && c.stage === 'impact' && c.participants.includes(id)) return true;
      }
      const d = lastDown.get(id);
      return d !== undefined && time - d <= GET_UP_TAIL;
    },
  };
}
