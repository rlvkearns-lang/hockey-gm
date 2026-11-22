import { createRng } from '../src/rng';
import { dist, type Vec2 } from '../src/vec';
import { DT, PERIOD_SECONDS, PERIODS } from '../src/constants';

const TICKS = Math.round((PERIOD_SECONDS * PERIODS) / DT);
const rng = createRng(1);
const agents: Vec2[] = Array.from({ length: 12 }, () => ({ x: rng.range(0, 60), y: rng.range(0, 26) }));

const start = performance.now();
let sink = 0;
for (let t = 0; t < TICKS; t++) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    for (let j = 0; j < agents.length; j++) if (i !== j) sink += dist(a, agents[j]!);
    sink += rng.next() + rng.gauss() + rng.range(-1, 1);
  }
}
const ms = performance.now() - start;
console.log(`ticks=${TICKS} total=${ms.toFixed(1)} ms (sink=${sink.toFixed(1)})`);
