/**
 * Calibration report: plays N games between two generated overall-70 teams (fresh rosters every game) and prints
 * per-team-per-game means. Usage: npm run calibrate -- --games 1000 [--home 70] [--away 70]
 */
import { runGames, summarise, winShare, goalsPer60ByType, battleWinShareByType, type GameRecord } from '../test/helpers';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} needs a positive number`);
  return v;
}

const games = Math.round(arg('games', 300));
const homeOverall = arg('home', 70), awayOverall = arg('away', 70);
const t0 = performance.now();
const rs = runGames(games, { homeOverall, awayOverall });
const wall = performance.now() - t0;
const m = summarise(rs);
const w = winShare(rs);

/** Per-game mean of a counted key (both teams). */
const perGame = (k: string): number => rs.reduce((a, r) => a + (r.counts[k] ?? 0), 0) / rs.length;
const contestsPerGame = (k: string): number => rs.reduce((a, r) => a + (r.contests[k] ?? 0), 0) / rs.length;
const f = (x: number, d = 2): string => x.toFixed(d);
const row = (label: string, value: string): void => console.log(`${label.padEnd(32)}${value}`);

console.log(`${games} games, home overall ${homeOverall}, away overall ${awayOverall}\n`);
console.log('per team per game');
row('goals', f(m.goals));
row('shots on goal', f(m.shots));
row('save %', f(m.savePct, 3));
row('hits', f(m.hits));
row('blocks', f(m.blocks));
row('giveaways', f(m.giveaways));
row('takeaways', f(m.takeaways));
row('faceoffs', f(m.faceoffs));
row('offsides', f(m.offsides));
row('icings', f(m.icings));
row('battles', f(m.battles));
console.log('\nper game (both teams)');
row('faceoffs', f(m.faceoffsTotal));
row('faceoff share outside 35-65%', `${f(m.faceoffShareOutside * 100, 1)}% of games`);
row('offsides', f(m.offsidesTotal));
row('icings', f(m.icingsTotal));
row('home win share', f(w.home, 3));
row('away win share', f(w.away, 3));
row('tie share', f(m.tieShare, 3));
row('ms per game', `${f(m.msPerGame, 0)} (wall ${f(wall / games, 0)} ms per game on worker threads)`);

console.log('\ndiagnostics, per game (both teams)');
row('missed shots / posts', `${f(perGame('miss'))} / ${f(perGame('post'))}`);
row('passes / dumps', `${f(perGame('pass') - perGame('pass:dump'))} / ${f(perGame('pass:dump'))}`);
row('freezes save/cover/trap', `${f(perGame('freeze:save'))} / ${f(perGame('freeze:cover'))} / ${f(perGame('freeze:trapped'))}`);
row('hits landed/absorbed/bounced', `${f(perGame('hit:landed'))} / ${f(perGame('hit:absorbed'))} / ${f(perGame('hit:bounced'))}`);
row('turnovers poke/loose/hit/bat/batL', ['poke', 'pokeLoose', 'hit', 'battle', 'battleLoose'].map((d) => f(perGame(`turnover:${d}`))).join(' / '));
row('turnovers intercepted/deflected', ['intercepted', 'deflected'].map((d) => f(perGame(`turnover:${d}`))).join(' / '));
row('box takeaways poke/battle/int.', ['poke', 'battle', 'intercepted'].map((d) => f(perGame(`takeaway:${d}`))).join(' / '));
row('box giveaways intercepted', f(perGame('giveaway:intercepted')));
row('battles pin/stick/sup/scr', ['pinned', 'stick', 'support', 'scramble'].map((d) => f(perGame(`battle:${d}`))).join(' / '));
row('line changes fly/stoppage', `${f(perGame('lineChange:onTheFly'))} / ${f(perGame('lineChange:stoppage'))}`);
row('contests started', ['pokeCheck', 'hit', 'boardBattle', 'netFront', 'looseRace'].map((k) => `${k} ${f(contestsPerGame(k), 1)}`).join(', '));
const g60 = goalsPer60ByType(rs), bw = battleWinShareByType(rs);
row('goals/60 by type', Object.keys(g60).sort().map((t) => `${t} ${f(g60[t]!)}`).join(', '));
row('battle win share by type', Object.keys(bw).sort().map((t) => `${t} ${f(bw[t]!, 3)}`).join(', '));
const goalsDist = new Map<number, number>();
for (const r of rs as GameRecord[]) { const n = r.score.home + r.score.away; goalsDist.set(n, (goalsDist.get(n) ?? 0) + 1); }
row('total goals: games', [...goalsDist.keys()].sort((a, b) => a - b).map((k) => `${k}:${goalsDist.get(k)}`).join(' '));
