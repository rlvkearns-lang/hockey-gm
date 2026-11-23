import { describe, it, expect } from 'vitest';
import { DT } from '../../src/constants';
import { def, pokeReleased, runPoke, share, startPoke, stepsUntilDone } from '../helpers';

describe('poke checks', () => {
  it('the better stick wins more poke checks, not all', () => {
    const p = share(2000, () => runPoke(def({ stickChecking: 92, defensivePositioning: 85 }), def({ puckHandling: 60 })));
    const q = share(2000, () => runPoke(def({ stickChecking: 55 }), def({ puckHandling: 92, poise: 88 })));
    expect(p).toBeGreaterThan(q + 0.15); expect(p).toBeLessThan(0.9); expect(q).toBeGreaterThan(0.1);
  });
  it('a poke check takes time and is visible in state', () => { const c = startPoke(); expect(c.stage).toBe('reach'); expect(stepsUntilDone(c)).toBeGreaterThanOrEqual(Math.floor(0.25 / DT)); });
  it('releasing the puck before the stick gets there ends it with no result', () => {
    const r = pokeReleased();
    expect(r.contests).toBe(0); expect(r.takeaways).toBe(0); expect(r.contestIds).toBe(0);
  });
});
