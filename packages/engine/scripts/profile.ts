/** Fingerprints (FNV-1a of the JSON result) and timing for seeds 1-5. Usage: tsx scripts/profile.ts */
import { simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';

const setup = (seed: number) => ({ home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] });
const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

let total = 0;
for (let seed = 1; seed <= 5; seed++) {
  const t = performance.now();
  const r = simulateGame(setup(seed));
  const ms = performance.now() - t;
  total += ms;
  console.log(`seed ${seed}: ${hash(JSON.stringify(r))} ${ms.toFixed(0)} ms`);
}
console.log(`mean ${(total / 5).toFixed(0)} ms`);
