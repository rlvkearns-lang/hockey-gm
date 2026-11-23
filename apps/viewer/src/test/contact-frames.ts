import type { GameState } from '@hockey/engine';

/**
 * The impact and fall frames of the real-game continuity bounds, from engine facts only: a skater in a hit contest's
 * `impact` stage, or down (`downT > 0`), at either of the frame's two ticks, and the frames within GET_UP_TAIL seconds
 * after his downT is back to 0 (the animator's fall hands back to his skating over the gait's down blend, 0.65 s).
 * In those frames a hit and a fall may move a part of him faster than the ordinary bound (the brief's 0.6 m a frame).
 */
export const GET_UP_TAIL = 0.7;
/** The larger per-frame bound (m) that applies in those frames. */
export const CONTACT_FRAME_BOUND = 0.6;

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
