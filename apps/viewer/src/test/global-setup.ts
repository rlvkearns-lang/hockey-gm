import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';
import { record } from '../playback';
import { cameraPathsOf } from './camera-paths';
import { OTHER_SEEDS, SHARED_SEED, testSetup } from './setup-of';

/**
 * Plays the games the scene and playback tests share (SHARED_SEED, and OTHER_SEEDS for the tests that need a second), once per test run, and leaves it in a file for every test
 * file to read (test files run in separate workers, so a module-level cache would not be shared).
 *
 * The file is kept between runs under node_modules/.cache, named by a hash of every source the recording depends on
 * (the engine's sources and the viewer's playback, cut and setup code), so a run after any change to them records
 * afresh and an unchanged run skips three seconds of simulation. Files are written under a temporary name and renamed,
 * and the directory is never deleted, so parallel runs cannot pull a cache out from under each other.
 */
const here = dirname(fileURLToPath(import.meta.url));
const viewer = resolve(here, '../..');
const sources = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
    }
  };
  walk(resolve(viewer, '../../packages/engine/src'));
  out.push(resolve(viewer, 'src/playback.ts'), resolve(viewer, 'src/cuts.ts'), resolve(here, 'setup-of.ts'), resolve(here, 'camera-paths.ts'), fileURLToPath(import.meta.url));
  return out;
};

/**
 * Write `text` to `file` through a temporary name of this run's own and a rename, so another run reading the cache at
 * the same moment (parallel local runs) sees the old file or the whole new one, never half of one.
 */
function writeAtomically(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * Remove cached recordings of other source versions that nobody has touched for a day (no run lasts that long, so
 * none is in use); the directory itself and anything newer are left alone.
 */
function pruneStale(dir: string, key: string): void {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const f of readdirSync(dir)) {
    if (f.includes(key)) continue;
    const p = join(dir, f);
    try { if (statSync(p).mtimeMs < dayAgo) rmSync(p, { force: true }); } catch { /* another run removed it first */ }
  }
}

export default function setup({ provide }: GlobalSetupContext): void {
  const hash = createHash('sha256');
  for (const f of sources()) hash.update(f).update(readFileSync(f));
  const dir = resolve(viewer, '../../node_modules/.cache/hockey-viewer-tests');
  const key = hash.digest('hex').slice(0, 16);
  const file = join(dir, `recording-${key}.json`), seenFile = join(dir, `onstep-${key}.json`), pathsFile = join(dir, `camera-paths-${key}.json`);
  const otherFiles: Record<number, string> = {};
  for (const seed of OTHER_SEEDS) otherFiles[seed] = join(dir, `recording-${key}-seed${seed}.json`);
  if (!existsSync(file) || !existsSync(seenFile) || !existsSync(pathsFile) || OTHER_SEEDS.some((s) => !existsSync(otherFiles[s]!))) {
    mkdirSync(dir, { recursive: true });
    // Which ticks onStep saw, for playback.test.ts (this run is the onStep run createPlayback makes).
    let seen = 0, inOrder = true;
    // (And the first period's puck and player paths for the camera measurements, test/camera-paths.ts.)
    const setup = testSetup(SHARED_SEED), paths = cameraPathsOf(setup);
    const rec = record(setup, { onStep: (st) => { if (st.tick !== seen) inOrder = false; seen++; paths.step(st); } });
    writeAtomically(seenFile, JSON.stringify({ count: seen, inOrder }));
    writeAtomically(pathsFile, JSON.stringify(paths.done()));
    writeAtomically(file, JSON.stringify(rec));
    for (const seed of OTHER_SEEDS) writeAtomically(otherFiles[seed]!, JSON.stringify(record(testSetup(seed))));
    pruneStale(dir, key);
  }
  provide('recordingFile', file);
  provide('cameraPathsFile', pathsFile);
  provide('otherRecordingFiles', otherFiles);
  provide('onStepSeen', JSON.parse(readFileSync(seenFile, 'utf8')) as { count: number; inOrder: boolean });
}
