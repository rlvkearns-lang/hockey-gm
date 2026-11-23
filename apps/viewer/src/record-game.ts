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
  /** A reply that could not be read (it did not survive the copy between threads). */
  onmessageerror: ((e: unknown) => void) | null;
};

/** How long (ms) the worker may take to send the game back before the page gives up on it and plays it itself. */
export const RECORD_WATCHDOG_MS = 25000;

/** How the recording was made, and how long it took (ms of wall time). */
export type RecordedGame = { recording: Recording; where: 'worker' | 'main'; ms: number; workerProblem?: string };

/**
 * Play a whole game up front without freezing the page: in a background thread when `makeWorker` gives one, else (no
 * worker, the page was refused one, it failed or sent nothing usable) on this thread. The game is the same either way:
 * the engine is deterministic, and the worker runs the same `record`. A worker that has sent nothing after `watchdogMs`
 * (RECORD_WATCHDOG_MS), or whose reply cannot be read, is let go and the game is played here. `recordHere` is the
 * recorder used on this thread (`record`; a test can stand one in); an error from it is passed on.
 */
export async function recordGame(
  setup: GameSetup,
  opts: { makeWorker?: () => WorkerLike; recordHere?: (setup: GameSetup) => Recording; watchdogMs?: number } = {},
): Promise<RecordedGame> {
  const t0 = now();
  let problem: string | undefined;
  if (opts.makeWorker) {
    try {
      const recording = await inWorker(opts.makeWorker, setup, opts.watchdogMs ?? RECORD_WATCHDOG_MS);
      return { recording, where: 'worker', ms: now() - t0 };
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  // Give the page a moment to paint its message before this thread is busy.
  await new Promise((r) => setTimeout(r, 0));
  const recording = (opts.recordHere ?? record)(setup);
  return { recording, where: 'main', ms: now() - t0, ...(problem !== undefined ? { workerProblem: problem } : {}) };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function inWorker(make: () => WorkerLike, setup: GameSetup, watchdogMs: number): Promise<Recording> {
  return new Promise((resolve, reject) => {
    let w: WorkerLike;
    try { w = make(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
    let finished = false;
    const watchdog = setTimeout(() => { if (!finished) { done(); reject(new Error(`the worker sent nothing in ${Math.round(watchdogMs / 1000)} s`)); } }, watchdogMs);
    const done = (): void => { finished = true; clearTimeout(watchdog); w.onmessage = null; w.onerror = null; w.onmessageerror = null; w.terminate(); };
    w.onmessage = (e) => {
      done();
      const d = e.data;
      if (d && d.ok && d.recording && Array.isArray(d.recording.snapshots) && d.recording.snapshots.length > 0) resolve(d.recording);
      else reject(new Error(d && !d.ok ? d.error : 'the worker sent no recording'));
    };
    w.onmessageerror = () => {
      done();
      reject(new Error('the worker\'s reply could not be read'));
    };
    w.onerror = (e) => {
      done();
      const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'the worker failed';
      reject(new Error(m || 'the worker failed'));
    };
    try { w.postMessage({ setup }); } catch (e) { done(); reject(e instanceof Error ? e : new Error(String(e))); }
  });
}
