/// <reference lib="webworker" />
import { record } from './playback';
import type { RecordReply, RecordRequest } from './record-game';

/** The recording worker: plays the game it is sent and posts the recording back (record-game.ts). */
self.onmessage = (e: MessageEvent<RecordRequest>) => {
  let reply: RecordReply;
  try { reply = { ok: true, recording: record(e.data.setup) }; } catch (err) { reply = { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  (self as unknown as { postMessage(m: RecordReply): void }).postMessage(reply);
};
