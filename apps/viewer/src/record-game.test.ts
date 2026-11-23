import { describe, expect, it } from 'vitest';
import type { Recording } from './playback';
import { recordGame, type RecordReply, type WorkerLike } from './record-game';
import { SHARED_SEED, sharedRecording, testSetup } from './test/game';

/** A stand-in worker that answers with `reply` (or fails) on the next turn. */
function fakeWorker(answer: (() => RecordReply) | 'error' | 'silent-error'): { make: () => WorkerLike; terminated: () => boolean } {
  let terminated = false;
  const w: WorkerLike = {
    onmessage: null, onerror: null,
    terminate() { terminated = true; },
    postMessage() {
      setTimeout(() => {
        if (answer === 'error') w.onerror?.({ message: 'boom' });
        else if (answer === 'silent-error') w.onerror?.({});
        else w.onmessage?.({ data: answer() });
      }, 0);
    },
  };
  return { make: () => w, terminated: () => terminated };
}

describe('recordGame', () => {
  it('uses the worker\'s recording when it sends one, and lets the worker go', async () => {
    const rec = sharedRecording();
    const f = fakeWorker(() => ({ ok: true, recording: rec }));
    const r = await recordGame(testSetup(SHARED_SEED), { makeWorker: f.make });
    expect(r.where).toBe('worker');
    expect(r.recording).toBe(rec);
    expect(f.terminated()).toBe(true);
  });

  it('falls back to this thread when there is no worker, it cannot be made, it fails or it sends nothing usable', async () => {
    const cases: (undefined | (() => WorkerLike))[] = [
      undefined,
      () => { throw new Error('refused'); },
      fakeWorker('error').make,
      fakeWorker('silent-error').make,
      fakeWorker(() => ({ ok: false, error: 'engine said no' })).make,
      fakeWorker(() => ({ ok: true, recording: { snapshots: [] } as unknown as Recording })).make,
    ];
    // The fallback is the same record() the shared game was made with; a setup it rejects at once shows it was
    // reached (the main-thread run throws), without playing a whole second game here.
    const bad = { ...testSetup(SHARED_SEED), seed: Number.NaN };
    for (const make of cases) {
      const r = await recordGame(bad, make ? { makeWorker: make } : {}).catch((e: unknown) => e);
      expect(r).toBeInstanceOf(Error);
    }
  });
});
