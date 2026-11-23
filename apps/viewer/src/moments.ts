import { DT, type GameState, type SkaterState } from '@hockey/engine';
import { initialGait, motionOf, stepGait, type GaitState, type Style } from './gait';

/**
 * Moments worth judging, found by running every skater's gait over the whole pre-run game (one call per tick, from
 * createPlayback's onStep): each skater's longest stretch of backward skating, his hardest stop, his longest
 * crossover, his fastest sprint, and a faceoff he is on the ice for. The style is the one the figure would show, since
 * it is the same gait the page runs.
 */

export type MomentKind = 'backward' | 'stop' | 'crossover' | 'sprint' | 'faceoff';
export type Moment = { kind: MomentKind; label: string; tick: number; period: number; clock: number };
export type ScanState = Pick<GameState, 'tick' | 'period' | 'clock' | 'phase' | 'skaters'>;

/** Seconds of lead-in before a moment, so the gait (reset after a seek) settles and the change can be seen. */
const LEAD_IN = 1;
const FACEOFF_LEAD_IN = 4;

const LABELS: Record<MomentKind, string> = {
  backward: 'Backward skating', stop: 'Hard stop', crossover: 'Crossover', sprint: 'Sprint', faceoff: 'Faceoff',
};

type Run = { style: Style; start: number; period: number; clock: number; startSpeed: number; peak: number };
type Best = { score: number; tick: number; period: number; clock: number };
type Track = { gait: GaitState; prev: Pick<SkaterState, 'vel' | 'facing' | 'downT'>; run: Run | null; best: Partial<Record<MomentKind, Best>> };

export type MomentScanner = { onStep(state: ScanState): void; momentsFor(id: string): Moment[] };

export function createMomentScanner(): MomentScanner {
  const tracks = new Map<string, Track>();
  const faceoffs: { tick: number; period: number; clock: number; ids: Set<string> }[] = [];
  let setupStart: { tick: number; period: number; clock: number } | null = null;
  let lastPhase: ScanState['phase'] | null = null;

  const offer = (t: Track, kind: MomentKind, score: number, run: Run): void => {
    const cur = t.best[kind];
    if (!cur || score > cur.score) t.best[kind] = { score, tick: run.start, period: run.period, clock: run.clock };
  };

  /** Score a finished run (seconds long, speeds in m/s) for the kinds it could stand for. */
  const close = (t: Track, run: Run, endTick: number): void => {
    const secs = (endTick - run.start) * DT;
    if (run.style === 'backward' && secs >= 0.8) offer(t, 'backward', secs, run);
    if (run.style === 'stop' && secs >= 0.3) offer(t, 'stop', run.startSpeed, run);
    if (run.style === 'crossover' && secs >= 0.6 && run.peak > 4) offer(t, 'crossover', secs + run.peak * 0.1, run);
    if (run.style === 'stride' && secs >= 1) offer(t, 'sprint', run.peak, run);
  };

  function onStep(s: ScanState): void {
    if (s.phase === 'faceoffSetup' && lastPhase !== 'faceoffSetup') setupStart = { tick: s.tick, period: s.period, clock: s.clock };
    if (s.phase === 'live' && lastPhase === 'faceoffSetup' && setupStart) {
      faceoffs.push({ ...setupStart, tick: Math.max(setupStart.tick, s.tick - Math.round(FACEOFF_LEAD_IN / DT)), ids: new Set(s.skaters.filter((k) => k.onIce).map((k) => k.id)) });
    }
    lastPhase = s.phase;
    for (const k of s.skaters) {
      let t = tracks.get(k.id);
      if (!k.onIce) {
        if (t?.run) { close(t, t.run, s.tick); t.run = null; }
        if (t) t.gait = initialGait();
        continue;
      }
      if (!t) { t = { gait: initialGait(), prev: k, run: null, best: {} }; tracks.set(k.id, t); }
      const prev = { ...k, vel: t.prev.vel, facing: t.prev.facing, downT: t.prev.downT };
      const m = motionOf(prev, k, DT);
      t.gait = stepGait(t.gait, m, DT);
      t.prev = { vel: { x: k.vel.x, y: k.vel.y }, facing: k.facing, downT: k.downT };
      const style = t.gait.style;
      if (!t.run || t.run.style !== style) {
        if (t.run) close(t, t.run, s.tick);
        t.run = { style, start: s.tick, period: s.period, clock: s.clock, startSpeed: m.speed, peak: m.speed };
      } else t.run.peak = Math.max(t.run.peak, m.speed);
    }
  }

  function momentsFor(id: string): Moment[] {
    const t = tracks.get(id);
    const out: Moment[] = [];
    const lead = Math.round(LEAD_IN / DT);
    for (const kind of ['backward', 'stop', 'crossover', 'sprint'] as const) {
      const b = t?.best[kind];
      if (b) out.push({ kind, label: LABELS[kind], tick: Math.max(0, b.tick - lead), period: b.period, clock: b.clock });
    }
    // Not the opening draw if there is another: after a stoppage he skates to his spot, which is worth seeing.
    const f = faceoffs.find((x) => x.ids.has(id) && x.tick > 0) ?? faceoffs.find((x) => x.ids.has(id));
    if (f) out.push({ kind: 'faceoff', label: LABELS.faceoff, tick: f.tick, period: f.period, clock: f.clock });
    return out;
  }

  return { onStep, momentsFor };
}
