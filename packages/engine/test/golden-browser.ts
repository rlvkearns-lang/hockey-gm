/** Browser entry for scripts/test-browser.ts: plays the golden games and leaves the outcome on `window.__golden`. */
import { GOLDEN_SEEDS, goldenRun, type Golden } from './golden';
import { GOLDEN_EXPECTED } from './golden-expected';

const results: Record<number, Golden> = {};
const t0 = performance.now();
for (const seed of GOLDEN_SEEDS) results[seed] = goldenRun(seed);
const ms = performance.now() - t0;
const ok = GOLDEN_SEEDS.every((s) => JSON.stringify(results[s]) === JSON.stringify(GOLDEN_EXPECTED[s]));
(globalThis as unknown as { __golden: unknown }).__golden = { ok, results, ms, userAgent: navigator.userAgent };
