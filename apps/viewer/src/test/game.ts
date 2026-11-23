import { readFileSync } from 'node:fs';
import { inject } from 'vitest';
import type { GameSetup } from '@hockey/engine';
import { createCursor, type Playback, type Recording } from '../playback';
import { SHARED_SEED, testSetup } from './setup-of';

export { SHARED_SEED, testSetup };

declare module 'vitest' {
  export interface ProvidedContext { recordingFile: string; onStepSeen: { count: number; inOrder: boolean } }
}

let cached: Recording | null = null;
/** The shared game's recording (seed SHARED_SEED), read once per test file. */
export function sharedRecording(): Recording {
  cached ??= JSON.parse(readFileSync(inject('recordingFile'), 'utf8')) as Recording;
  return cached;
}
/** A fresh cursor over the shared game. */
export function sharedPlayback(): { setup: GameSetup; pb: Playback } {
  const setup = testSetup(SHARED_SEED);
  return { setup, pb: createCursor(setup, sharedRecording()) };
}
