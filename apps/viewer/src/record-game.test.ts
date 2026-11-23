import { describe, expect, it } from 'vitest';
import type { Recording } from './playback';
import { recordGame, RECORD_WATCHDOG_MS, type RecordReply, type WorkerLike } from './record-game';
import { SHARED_SEED, sharedRecording, testSetup } from './test/game';

type Answer = (() => RecordReply) | 'error' | 'silent-error' | 'messageerror' | 'silent';
/** A stand-in worker that answers with `reply` (or fails, or never answers) on the next turn. */
function fakeWorker(answer: Answer): { make: () => WorkerLike; terminated: () => boolean } {
  let terminated = false;
  const w: WorkerLike = {
    onmessage: null, onerror: null, onmessageerror: null,
    terminate() { terminated = true; },
    postMessage() {
      setTimeout(() => {
        if (answer === 'error') w.onerror?.({ message: 'boom' });
        else if (answer === 'silent-error') w.onerror?.({});
        else if (answer === 'messageerror') w.onmessageerror?.({});
        else if (answer === 'silent') return;
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

  it('falls back to this thread when there is no worker, it cannot be made, it fails, it sends nothing usable, its message cannot be read, or it says nothing', async () => {
    const cases: [string, undefined | Answer | 'refused'][] = [
      ['none', undefined],
      ['refused', 'refused'],
      ['error', 'error'],
      ['silent-error', 'silent-error'],
      ['said no', () => ({ ok: false, error: 'engine said no' })],
      ['empty', () => ({ ok: true, recording: { snapshots: [] } as unknown as Recording })],
      ['messageerror', 'messageerror'],
      ['silent', 'silent'],
    ];
    // The fallback is told apart from an error passed on: this thread's recorder is a stand-in that returns a marker
    // recording, so the call resolves with it, from 'main', and says what went wrong with the worker.
    const marker = sharedRecording();
    for (const [name, answer] of cases) {
      let ranHere = 0;
      const fake = answer === undefined || answer === 'refused' ? null : fakeWorker(answer);
      const makeWorker = answer === 'refused' ? (): WorkerLike => { throw new Error('refused'); } : fake?.make;
      const r = await recordGame(testSetup(SHARED_SEED), {
        ...(makeWorker ? { makeWorker } : {}),
        recordHere: () => { ranHere++; return marker; },
        watchdogMs: 30,
      });
      expect(r.where, name).toBe('main');
      expect(r.recording, name).toBe(marker);
      expect(ranHere, name).toBe(1);
      if (answer !== undefined) expect(r.workerProblem, name).toBeTruthy();
      if (fake) expect(fake.terminated(), name).toBe(true);
    }
  });

  it('an error on this thread itself is passed on, not hidden', async () => {
    const r = await recordGame(testSetup(SHARED_SEED), { makeWorker: fakeWorker('error').make, recordHere: () => { throw new Error('no game'); } }).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toBe('no game');
  });

  it('waits 25 s for the worker before giving up on it', () => {
    expect(RECORD_WATCHDOG_MS).toBe(25000);
  });
});
