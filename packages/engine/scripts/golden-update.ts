/**
 * Rewrites test/golden-expected.ts from this runtime. Run only after a deliberate change of results (tuning, new
 * behaviour), then check that `npm run test:browser` agrees: npm run golden:update
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GOLDEN_SEEDS, goldenRun, type Golden } from '../test/golden';

const out: Record<number, Golden> = {};
for (const seed of GOLDEN_SEEDS) out[seed] = goldenRun(seed);
const file = fileURLToPath(new URL('../test/golden-expected.ts', import.meta.url));
writeFileSync(file, `import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = ${JSON.stringify(out, null, 2)};
`);
console.log(JSON.stringify(out, null, 2));
