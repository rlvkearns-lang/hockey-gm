/** Worker thread for runGames (helpers.ts): plays its share of calibration games and posts the records back. */
import { workerData, type MessagePort } from 'node:worker_threads';
import { playRecord, type CalibrationOpts, type GameRecord } from './helpers';

const { indices, opts, port, done } = workerData as { indices: number[]; opts: CalibrationOpts; port: MessagePort; done: Int32Array };
try {
  const records: GameRecord[] = indices.map((i) => playRecord(i, opts));
  port.postMessage({ records });
  Atomics.add(done, 0, 1);
} catch (e) {
  port.postMessage({ error: e instanceof Error ? e.stack ?? e.message : String(e) });
  Atomics.store(done, 0, -1000);
}
Atomics.notify(done, 0);
