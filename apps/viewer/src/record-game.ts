import type { GameSetup } from '@hockey/engine';
import { record, type Recording } from './playback';

/** What the recording worker is sent, and what it answers. */
export type RecordRequest = { setup: GameSetup };
export type RecordReply = { ok: true; recording: Recording } | { ok: false; error: string };

/** Anything shaped like a Web Worker (a test can stand one in). */
export type WorkerLike = {
  postMessage(message: RecordRequest): void;
  terminate(): void;
  onmessage: ((e: { data: RecordReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

/** How the recording was made, and how long it took (ms of wall time). */
export type RecordedGame = { recording: Recording; where: 'worker' | 'main'; ms: number; workerProblem?: string };

/**
 * Play a whole game up front without freezing the page: in a background thread when `makeWorker` gives one, else (no
 * worker, the page was refused one, it failed or sent nothing usable) on this thread. The game is the same either way:
 * the engine is deterministic, and the worker runs the same `record`.
 */
export async function recordGame(setup: GameSetup, opts: { makeWorker?: () => WorkerLike } = {}): Promise<RecordedGame> {
  const t0 = now();
  let problem: string | undefined;
  if (opts.makeWorker) {
    try {
      const recording = await inWorker(opts.makeWorker, setup);
      return { recording, where: 'worker', ms: now() - t0 };
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  // Give the page a moment to paint its message before this thread is busy.
  await new Promise((r) => setTimeout(r, 0));
  const recording = record(setup);
  return { recording, where: 'main', ms: now() - t0, ...(problem !== undefined ? { workerProblem: problem } : {}) };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function inWorker(make: () => WorkerLike, setup: GameSetup): Promise<Recording> {
  return new Promise((resolve, reject) => {
    let w: WorkerLike;
    try { w = make(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
    const done = (): void => { w.onmessage = null; w.onerror = null; w.terminate(); };
    w.onmessage = (e) => {
      done();
      const d = e.data;
      if (d && d.ok && d.recording && Array.isArray(d.recording.snapshots) && d.recording.snapshots.length > 0) resolve(d.recording);
      else reject(new Error(d && !d.ok ? d.error : 'the worker sent no recording'));
    };
    w.onerror = (e) => {
      done();
      const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'the worker failed';
      reject(new Error(m || 'the worker failed'));
    };
    try { w.postMessage({ setup }); } catch (e) { done(); reject(e instanceof Error ? e : new Error(String(e))); }
  });
}
