import type { GameSetup, GameState } from '@hockey/engine';
import { cutKind, isCut, probeOf, type CutKind } from '../cuts';

/**
 * The first period of the shared game as the cameras need it, tick by tick, recorded once by the suite's global setup
 * (global-setup.ts, during the recording it makes anyway), so the camera measurements (camera-run.ts) need no engine
 * pass of their own: the puck (place, height, velocity), the phase, which way the home team attacks, the board battles'
 * spots, the followed player (the home team's first centre: place, velocity, facing, on the ice), and the engine's cuts
 * (the cut kind the scene draws on reaching each tick, and whether the step to the next tick is a cut).
 */
export type CameraTick = {
  px: number; py: number; pz: number; vx: number; vy: number;
  live: boolean; homeRight: boolean; battles: number[];
  fx: number; fy: number; fvx: number; fvy: number; ff: number; fon: boolean;
  cut: CutKind | null; cutNext: boolean;
};
export type CameraPaths = { followId: string; ticks: CameraTick[] };

export function cameraPathsOf(setup: GameSetup): { step(st: Readonly<GameState>): void; done(): CameraPaths } {
  const followId = setup.home.players.find((p) => p.position === 'C')!.id;
  const ticks: CameraTick[] = [];
  let probe = null as ReturnType<typeof probeOf> | null, over = false;
  return {
    step(st) {
      if (over) return;
      if (st.period > 1) { over = true; return; }
      const last = ticks[ticks.length - 1];
      if (last && probe) last.cutNext = isCut(probe, st);
      const f = st.skaters.find((s) => s.id === followId)!;
      const battles: number[] = [];
      for (const c of st.contests) if (c.kind === 'boardBattle') battles.push(c.spot.x, c.spot.y);
      ticks.push({
        px: st.puck.pos.x, py: st.puck.pos.y, pz: st.puck.z, vx: st.puck.vel.x, vy: st.puck.vel.y,
        live: st.phase === 'live', homeRight: st.attackDir.home === 1, battles,
        fx: f.pos.x, fy: f.pos.y, fvx: f.vel.x, fvy: f.vel.y, ff: f.facing, fon: f.onIce,
        cut: probe ? cutKind(probe, st) : null, cutNext: false,
      });
      probe = probeOf(st, probe ?? undefined);
    },
    done: () => ({ followId, ticks }),
  };
}
