import { readFileSync } from 'node:fs';
import { inject } from 'vitest';
import type { GameSetup } from '@hockey/engine';
import { createCursor, type Playback, type Recording } from '../playback';
import { OTHER_SEEDS, SHARED_SEED, testSetup } from './setup-of';

export { OTHER_SEEDS, SHARED_SEED, testSetup };

declare module 'vitest' {
  export interface ProvidedContext { recordingFile: string; otherRecordingFiles: Record<number, string>; onStepSeen: { count: number; inOrder: boolean }; cameraPathsFile: string }
}

let cached: Recording | null = null;
/** The shared game's recording (seed SHARED_SEED), read once per test file. */
export function sharedRecording(): Recording {
  cached ??= JSON.parse(readFileSync(inject('recordingFile'), 'utf8')) as Recording;
  return cached;
}
const others = new Map<number, Recording>();
/** A shared game's recording: SHARED_SEED or one of OTHER_SEEDS (recorded once per run by global-setup.ts). */
export function recorded(seed: number): Recording {
  if (seed === SHARED_SEED) return sharedRecording();
  let r = others.get(seed);
  if (!r) {
    const file = inject('otherRecordingFiles')[seed];
    if (!file) throw new Error(`seed ${seed} is not one of the shared recorded games`);
    r = JSON.parse(readFileSync(file, 'utf8')) as Recording;
    others.set(seed, r);
  }
  return r;
}
/** A fresh cursor over a shared game (by default the SHARED_SEED one). */
export function sharedPlayback(seed: number = SHARED_SEED): { setup: GameSetup; pb: Playback } {
  const setup = testSetup(seed);
  return { setup, pb: createCursor(setup, recorded(seed)) };
}
