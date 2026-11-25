/**
 * Task 13b: the valuation's measured numbers read again from play (test/valuation-fit.ts): the traffic lift
 * (TUNING.value.traffic), what follows a shot (TUNING.value.after), the shot badges (TUNING.badges.value) and the goal
 * chance by distance. Runs gameSetup(seed) for the seeds given, in four processes.
 * Usage: npx tsx scripts/fit-valuation.ts [1-32]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameSetup } from '../test/helpers';
import { afterShares, attemptsOf, badgeLifts, distanceFit, trafficLift, type Attempt } from '../test/valuation-fit';

const args = process.argv.slice(2);
if (args[0] === '--worker') {
  // (Exit only once the pipe has taken it all: a large write is flushed asynchronously.)
  process.stdout.write(JSON.stringify(args[1]!.split(',').map(Number).flatMap((s) => attemptsOf(gameSetup(s)))), () => process.exit(0));
} else {
const [a, b] = (args[0] ?? '1-32').split('-').map(Number);
const seeds = Array.from({ length: b! - a! + 1 }, (_, i) => a! + i);
const groups: number[][] = [[], [], [], []];
seeds.forEach((s, i) => groups[i % 4]!.push(s));
const self = fileURLToPath(import.meta.url);
const parts = await Promise.all(groups.filter((g) => g.length).map((g) => new Promise<Attempt[]>((res, rej) => {
  const p = spawn('npx', ['tsx', self, '--worker', g.join(',')], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => (code === 0 ? res(JSON.parse(out)) : rej(new Error(`worker ${code}`))));
})));
const as = parts.flat();
console.log(`${seeds.length} games, ${as.length} attempts`);
console.log('traffic lift', JSON.stringify(trafficLift(as)));
console.log('after', JSON.stringify(afterShares(as)));
console.log('badges', JSON.stringify(badgeLifts(as)));
console.log('distance', JSON.stringify(distanceFit(as)));
}
