# Engine Round 2 Part A (how players play) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 5-on-5 game looks like hockey: skaters commit to a direction and a job, the carrier makes sensible decisions, there are point shots, rebounds and tips, the man who wins a battle comes away with the puck, players battle for position, teams and player types play differently, and an NHL scorecard shows how close the totals are.

**Architecture:** Still one pure TypeScript package (`packages/engine`) stepping a plain-JSON `GameState`. Intent moves out of per-tick recomputation into held state: each skater has a `SkaterPlan` (job, held target, effort) in `state.plans`, the carrier a `carrierPlan`, each team a committed phase; new focused modules (jobs, job targets, options, passing, blade, shots, rebounds, tips, engagements, tactics, styles, badges) replace the logic now packed into `team-play.ts`, `brain.ts` and `goalie.ts`. Every behaviour change is measured by a per-tick observer (`test/measures.ts`) that also feeds the calibration and the scorecard; totals are tuned once, in the last task.

**Tech Stack:** TypeScript (strict), npm workspaces, Vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-engine-round-2-design.md`, Part A (A1 to A8, Re-tune A, NHL scorecard). Background and measured findings: `docs/superpowers/specs/notes-engine-play.md`. Part B (penalties) is a later plan.

## Global Constraints

- Determinism: all randomness comes from the game's `Rng`; all transcendental maths goes through `packages/engine/src/dmath.ts` (`dexp, dlog, dsin, dcos, datan, datan2, dtanh, dpow, hypot3`) and `hypot2` from `vec.ts`. No `Math.random`, `Date`, `performance`, `Math.sin/cos/atan2/exp/pow/hypot` or `**` under `packages/engine/src` (`test/purity.test.ts` enforces it).
- Resumable: `GameState` is plain JSON and holds everything that decides the rest of the game. Any new state a task needs goes inside `GameState` (never in module variables or closures, except derived caches rebuilt from state), is initialised in `initialState` (`game.ts`) and in `stateWith` (`test/helpers.ts`), and is cleared in `stopPlay` (`faceoff.ts`) where it must not outlive a whistle. `test/resume.test.ts` must stay green.
- Parity clamps: contest win chances go through `winProb` (`contests/core.ts`), clamped to `[0.1, 0.9]`; every other chance is clamped to `[0.03, 0.97]`. Styles, badges and tactics shade odds; they never decide.
- Nothing is scripted: no set play, timed rotation or fixed sequence. Cycling, dump and chase, point shots and rebounds must come out of jobs and choices.
- Public surface (`src/index.ts`, and every type reachable from it) is additive only. No new required field on `SkaterState` or `GoalieState` and no new value in `SavePose` or `ContestKind` (the viewer and debug apps build typed literals and exhaustive records of these). Every change to an existing event's or field's meaning must be written in the task's commit message under a line `Meaning changes:` (Task 14 collects them).
- Nothing under `apps/viewer` is edited or run by hand. `apps/debug` is edited only where an engine type change breaks its typecheck or its tests pin old play.
- Tunable numbers go in `packages/engine/src/tuning.ts` in a named group. Before Task 14, set them once so the task's own tests pass; do not tune toward game totals.
- Performance ceiling: a full game simulates in 2.5 s or less (mean of three, `test/perf.test.ts`). Do not remove simulation detail to go faster.
- Units: metres, seconds, radians, kilograms; `x` along the rink, `y` across, `z` up. Attack-relative coordinates in this plan: `rx = x * attackDir[side]` (toward the attacked net; goal line at 27.13, blue line at 7.62), `ly = y * attackDir[side]` (to the attacker's left). `ps` is the puck's side, `ly >= 0 ? 1 : -1`.
- Left and right: a player's left is the side at `facing + PI/2` (counter-clockwise with +x right, +y up): facing +x, his left is +y. `shoots: 'L'` means the blade is on his left; a goalie with `catches: 'L'` has the glove on his left.
- Commands. After every task: `npm -w packages/engine run test`, `npm -w apps/debug run test`, `npm run typecheck`, `npm run test:browser` must pass. Also run `npm test` (the root script, which adds the viewer's suite): viewer failures caused by changed play are listed in the task report and not fixed; a viewer typecheck failure is a defect of the task. `npm run test:calibration` only where the task says.
- Golden re-pin: a task that changes play on purpose runs `npm -w packages/engine run golden:update`, then `npm run test:browser` (the browser must agree with Node), and commits `packages/engine/test/golden-expected.ts` with a line `Golden re-pinned: <reason>` in the commit message. A task that must not change play (Tasks 1 and 14's document steps) leaves the golden file untouched.
- Guard rails for every behaviour-changing task before Task 14 (asserted in `test/play.test.ts`, see Task 1): each of seeds 1, 2, 3 completes; goals per team per game between 1 and 5 on average; no `NaN` in the result; perf ceiling; determinism and resume tests green.
- Commit after every task with the message given. Commit trailers are added by the controller's rules file.

## Review Focus

1. **Stale commitment.** A held job or target leaves a skater skating to where the play was, or the puck sitting with nobody on it. Expect no live stretch over 15 s without a touch (`test/robustness.test.ts`), re-issues inside 0.4 s only on a named trigger, and no two skaters of a team with the same job. Pinned in Task 3 (hold rule) and Task 4 (unique jobs, standing still).
2. **State that does not survive a snapshot.** New state kept outside `GameState`, holding `undefined`, or not reset at a whistle makes a resumed game diverge. Expect `restoreGame` mid-hold, mid-phase-delay, mid-rebound and mid-engagement to finish identically. Pinned in Task 3 (new resume cases), extended in Tasks 8 and 10.
3. **Hard rules that break parity or turn into scripts.** "A breakaway never passes backward", forced protects, tactics and badges must remove or shade options, never fix an outcome. Expect no contest chance outside `[0.1, 0.9]`, no other chance outside `[0.03, 0.97]`, and no option kind above 0.97 in an ordinary state. Pinned in Task 5 and Task 12.
4. **Teleports and overlaps.** The puck jumping (race wins, pickups, saves, blocks, battle hand-overs) and bodies passing through the goalie. Expect no live tick where the puck moves further than its speed allows, 1.2 m at a hand-over. Pinned in Task 3 (race, goalie) and Task 9 (whole game).
5. **Event contract drift and left/right.** A `shot` without exactly one `save` or `goal`, attempts that do not add up, a field whose meaning moved without being listed, a glove on the wrong hand. Pinned in Task 6 (handedness), Task 7 (attempt identity) and Task 8 (shot pairing, crossing point).

---

## File Structure

```
packages/engine/src/
  types.ts          MODIFY  new state, event fields, tactics, styles, badges (types only)
  tuning.ts         MODIFY  one named group per new module
  skating.ts        MODIFY  stepSkater: coast / ease / stop, carving turns, backward speed
  commit.ts         CREATE  SkaterPlan storage, the hold rule, committed team phase, effort
  jobs.ts           CREATE  which jobs exist in each phase and who gets which (unique, sticky)
  job-targets.ts    CREATE  each job's spot and moving part (get open, cover, shadow a lane, gap, the office)
  lanes.ts          CREATE  passing-lane geometry shared by jobs, options and passing (open, shadowed, clear path)
  team-play.ts      MODIFY  shrinks to phase detection, small predicates and the assignJobs orchestrator
  options.ts        CREATE  the carrier's option list and its valuation
  brain.ts          MODIFY  shrinks to brainTick: choose (options.ts), commit (carrierPlan), execute (actions.ts)
  blade.ts          CREATE  where the stick blade is; forehand / backhand / behind
  passing.ts        CREATE  whether a pass can be made and received: lane, facing, weight, aim (point passes inside the line)
  actions.ts        MODIFY  executePass uses a PassPlan; executeRim, executeClear; shot types
  shots.ts          CREATE  a shot in flight: blocks at the blocker, misses, posts (moved from goalie.ts)
  tips.ts           CREATE  deflections in front
  rebounds.ts       CREATE  what a save does with the puck: held, steered, rebound
  goalie.ts         MODIFY  keeps movement, cover, saveChance; saves resolved at his plane; faces up ice at stoppages
  puck.ts           MODIFY  board restitution by impact speed (missed shots ring round)
  bodies.ts         MODIFY  goalie bodies; engaged pairs are held, not bounced
  engagements.ts    CREATE  continuous two-man battles for position
  contests/*.ts     MODIFY  loose-race pickup, board-battle hand-over and supporters, hit degrees, poke reach, net-front from the job
  tactics.ts        CREATE  tactic defaults, the factors tactics apply, a roster's natural tactics
  styles.ts         CREATE  style catalogue, habit blend, label
  badges.ts         CREATE  badge catalogue, how each is earned, its one effect
  player-types.ts   MODIFY  adds Shutdown Forward
  roster-gen.ts     MODIFY  primary + secondary style, badges, catching hand, tactics
  faceoff.ts        MODIFY  line-up spots and facing; setup lasts until players arrive
  bench.ts, referee.ts, validate.ts, stats.ts, game.ts, index.ts   MODIFY  wiring
packages/engine/test/
  measures.ts       CREATE  per-tick observer and the "looks like hockey" measures
  measures.test.ts  CREATE  the measures' definitions on hand-built input
  play.test.ts      CREATE  whole-game behaviour on seeds 1, 2, 3 (guard rails and each task's numbers)
  helpers.ts        MODIFY  GameRecord carries the measures; stateWith gets new state
  <module>.test.ts  CREATE  one per new source file
packages/engine/scripts/
  nhl-reference.ts  CREATE  NHL values, bands, source and season per number
  scorecard.ts      CREATE  ours beside the NHL's, in or out of band, written to a file
docs/superpowers/reviews/engine-scorecard-<label>.md      CREATE (Tasks 1 and 14)
docs/superpowers/specs/engine-round-2a-changes-for-viewer.md  CREATE (Task 14)
```

`team-play.ts` (366 lines), `brain.ts` (226) and `goalie.ts` (363) are each modified heavily, so each is split as above in the task that first rewrites it. `test/helpers.ts` (1,525 lines) is not grown: new test helpers go in the new test files or `test/measures.ts`.

---

### Task 1: Measures, baseline and the NHL scorecard

No engine behaviour changes in this task; the golden file must not change.

**Files:**
- Create: `packages/engine/test/measures.ts`, `packages/engine/test/measures.test.ts`, `packages/engine/test/play.test.ts`, `packages/engine/scripts/nhl-reference.ts`, `packages/engine/scripts/scorecard.ts`, `docs/superpowers/reviews/engine-scorecard-baseline.md` (generated)
- Modify: `packages/engine/test/helpers.ts` (`GameRecord`, `playRecord`, `Summary`, `summarise`), `packages/engine/scripts/calibrate.ts`, `packages/engine/test/perf.test.ts`, `packages/engine/test/calibration.test.ts` (budget only), root `package.json` (script `"scorecard": "tsx packages/engine/scripts/scorecard.ts"`)

**Interfaces:**
- Consumes: `createGame`, `Game.drainEvents`, `GameState`, `GameEvent`, `GameSetup`, `movementOf(def, 1).topSpeed`, `bodyRadius`, `RINK`, `DT`, `gameSetup(seed)` and `runGames`, `summarise`, `GameRecord` from `test/helpers.ts`.
- Produces (`test/measures.ts`):

```ts
/** Raw sums over one game; every field is a count or a sum so games add up field by field. */
export type PlayCounters = Record<PlayCounterKey, number>;
export type PlayCounterKey =
  | 'liveTicks' | 'skaterTicks' | 'stationaryTicks' | 'glideTicks' | 'topSpeedTicks' | 'sprintRuns' | 'sprintRunTicks'
  | 'backwardTicksWithPuck' | 'ticksWithPuck' | 'spotTicks' | 'retargets'
  | 'passes' | 'passesCompleted' | 'pointPasses' | 'pointPassesKept' | 'pointPassesCompleted'
  | 'attempts' | 'defenceAttempts' | 'saves' | 'reboundChances' | 'goals'
  | 'battlesDecided' | 'battleWinnerCameAway' | 'battleToWinner' | 'battleToWinnerIsWinner' | 'battlesNoWinner'
  | 'hitsLanded' | 'hitsKnockdown'
  | 'ozonePossessions' | 'ozoneTicks' | 'ozoneAttempts' | 'ozoneSamples' | 'ozoneTwoOpen' | 'ozoneDangerShadowed'
  | 'behindNetPossessions' | 'passesOutFront' | 'wrapAttempts'
  | 'contactOver03' | 'puckJumpTicks';
export type PlayMeasures = {
  stationaryShare: number; glideShare: number; topSpeedShare: number; sprintRunSeconds: number; backwardShareWithPuck: number; retargetShare: number;
  passCompletion: number; pointPassesPerGame: number; pointPassKeptShare: number; pointPassCompletion: number;
  attemptsPerTeam: number; defenceAttemptsPerTeam: number; reboundChancesPerGame: number;
  battleWinnerCameAwayShare: number; battleToWinnerIsWinnerShare: number; battlesNoWinnerPerGame: number; knockdownShare: number;
  ozoneSecondsPerPossession: number; attemptsPerOzonePossession: number; twoOpenShare: number; dangerShadowedShare: number;
  behindNetPossessionsPerGame: number; passesOutFrontPerGame: number; wrapAttemptsPerGame: number;
  contactsOver03PerGame: number; puckJumpsPerGame: number; maxPuckJump: number;
};
export type Observer = { tick(state: GameState, events: readonly GameEvent[]): void; counters(): PlayCounters; maxPuckJump(): number };
/** Call `tick` after every `game.step()` with `game.drainEvents()`. */
export function createObserver(setup: GameSetup): Observer;
export function measuresOf(games: { counters: PlayCounters; maxPuckJump: number }[]): PlayMeasures;
/** Plays `gameSetup(seed)` for each seed under an observer. */
export function measureGames(seeds: number[]): PlayMeasures;
/** The same games' counters, summed field by field. */
export function countGames(seeds: number[]): PlayCounters;
```

  Definitions (the observer implements exactly these; "counted skater" = on the ice, not the carrier, `downT === 0`, not `leaving`, not steered by a contest (in a contest and not in its `freeIds`)):
  - `stationaryTicks`: counted-skater live ticks with speed under 0.5 m/s. `topSpeedTicks`: speed at least 0.9 of `movementOf(def, 1).topSpeed`; a `sprintRun` is a maximal run of such ticks for one skater. `glideTicks`: speed at least 2 m/s and speed changed by less than 1 m/s² since the previous tick. `backwardTicksWithPuck` / `ticksWithPuck`: counted skaters of the side in `state.possession`, `mode === 'backward'`.
  - `spotTicks` / `retargets`: counted-skater ticks, and those on which `target` moved more than 0.05 m since the previous tick. (Task 3 narrows both to plans with `follow === 'spot'`.)
  - A pass (`pass` event, `detail.kind === 'pass'`) is completed when the next skater to carry the puck is its `otherId`. A point pass is one released with the passer's `rx > 7.62`, to a receiver in slot `LD` or `RD` at least 3 m behind the passer in `rx`; kept when the puck's `rx` stays above 7.57 until someone carries it, play stops, or 3 s pass.
  - `attempts`: `release` events with `kind === 'shot'`; `defenceAttempts`: those by a skater in slot `LD`/`RD`. `reboundChances`: attempts by the attacking side within 3 s after a `save`, with no stoppage and no defending carrier in between.
  - `battlesDecided`: `battle` events with `how` in `pinned, stick, support, scramble`. `battleWinnerCameAway`: of those, the event's `playerId` is the next carrier within 1.5 s. `battleToWinner`: `contestEnd` of kind `boardBattle` with `puck === 'toWinner'`; `battleToWinnerIsWinner`: of those, the puck went to the `battle` event's `playerId`. `battlesNoWinner`: board-battle `contestEnd` with result `released`, `lostTouch`, `abandoned` or `trapped`.
  - `hitsLanded`, `hitsKnockdown` (`hit` with `result === 'landed'`; the target's `downT > 0` on that tick).
  - An offensive-zone possession of side S: `state.possession === S` with the puck's `rx > 7.62`; it ends when either stops holding or play stops. `ozoneSamples` are taken every 6th tick of one with a carrier: `ozoneTwoOpen` when at least two teammates have an open lane (no opposing skater within 1.0 m of the segment puck to him, none within 1.5 m of him); `ozoneDangerShadowed` when the teammate with the highest `exp(-d / 9) * dx / d` (d: distance to the net centre, dx: its `rx` part) has an opposing skater within 1.2 m of his lane.
  - `behindNetPossessions`: a carrier with `rx > 27.43` and `|y| < 4` for 0.5 s without a break. `passesOutFront`: passes released from there to a receiver with `15.13 < rx < 26.13`, `|y| < 6`. `wrapAttempts`: an attempt by a player who was such a carrier within the last 1.5 s.
  - `contactOver03`: opposing pairs whose centres stay within the sum of their `bodyRadius` plus 0.25 m for 10 ticks in a row (counted once per stretch).
  - `puckJumpTicks`: live ticks (previous tick live too) where the puck moved more than `vmax * DT + 0.5` m, `vmax` the largest of the puck's speed before, after, and the carrier's; `maxPuckJump` is the largest excess.
- Produces (`test/helpers.ts`): `GameRecord` gains `play: PlayCounters` and `maxPuckJump: number`; `Summary` gains `play: PlayMeasures` and `attempts: number` (per team per game: `shot` + `miss` + `post` + `block` events, until Task 7 puts attempts in the record). `playRecord` runs the observer.
- Produces (`scripts/nhl-reference.ts`):

```ts
export type Reference = {
  key: string;            // e.g. 'goals', 'shots', 'attempts', 'savePct', 'hits', 'blocks', 'takeaways', 'giveaways', 'faceoffsTotal', 'favouriteWinShare', or a PlayMeasures key
  label: string;
  /** The NHL's value, or null where the league publishes nothing. */
  nhl: number | null;
  band: [number, number]; // our target band
  unit: string;
  source: string;         // publication and URL, or 'ours' with the reasoning for the band
  season: string | null;
  verified: boolean;      // false: "from memory, unverified"
};
export const NHL_REFERENCE: readonly Reference[];
```
- Produces (`scripts/scorecard.ts`): `npm run scorecard -- --label <label> [--games 300]` plays the calibration set (`runGames(n)` and `runGames(n, { homeOverall: 76, awayOverall: 66 })`), prints one table (measure, ours, NHL, band, in/out, source and season, "unverified" where so) and writes it to `docs/superpowers/reviews/engine-scorecard-<label>.md`. Exports `scorecardRows(summary: Summary, favouriteWinShare: number): { key: string; ours: number; ref: Reference; inBand: boolean }[]`.

- [ ] **Step 1: Write the failing tests** (`measures.test.ts`, `play.test.ts`)

```ts
// measures.test.ts: definitions on hand-built input. `scene()` builds a stateWith(...) state; `feed(obs, st, n, events?)` ticks it n times, st.tick++ each.
it('standing still is under 0.5 m/s for a skater who is not the carrier, down, leaving or steered', () => {
  const st = stateWith({ carrier: 'home', puckX: 0 }); const obs = createObserver(gameSetupOf(st));
  skater(st, 'away', 'LD').vel = { x: 0.4, y: 0 }; skater(st, 'away', 'RD').vel = { x: 0.6, y: 0 }; skater(st, 'away', 'C').downT = 1;
  for (const s of st.skaters) if (s.side === 'home' || s.slot === 'LW' || s.slot === 'RW') s.onIce = false;
  feed(obs, st, 30); const c = obs.counters();
  expect(c.skaterTicks).toBe(60); expect(c.stationaryTicks).toBe(30);
});
it('a pass is completed only when its intended receiver is the next carrier', () => { /* pass to home-C, home-LW picks it up */ expect(measuresOf([run]).passCompletion).toBe(0); });
it('a point pass that slides out over the blue line is not kept', () => { /* puck rx goes 20 -> 7.0 before anyone carries */ expect(c.pointPasses).toBe(1); expect(c.pointPassesKept).toBe(0); });
it('a rebound chance is an attempt within 3 s of a save with no stoppage and no defending carrier between', () => { expect(c.reboundChances).toBe(1); });
it('a puck that moves 3 m in a tick at 6 m/s is a jump of about 2.8 m', () => { expect(obs.maxPuckJump()).toBeGreaterThan(2.7); expect(obs.counters().puckJumpTicks).toBe(1); });
it('reference rows name a source, and unverified numbers say so', () => {
  for (const r of NHL_REFERENCE) { expect(r.source.length).toBeGreaterThan(3); if (r.nhl !== null) expect(r.season).not.toBeNull(); expect(r.band[0]).toBeLessThan(r.band[1]); }
  for (const k of ['goals', 'shots', 'attempts', 'savePct', 'hits', 'blocks', 'takeaways', 'giveaways', 'faceoffsTotal', 'favouriteWinShare', 'stationaryShare', 'pointPassKeptShare', 'battleWinnerCameAwayShare'])
    expect(NHL_REFERENCE.some((r) => r.key === k)).toBe(true);
});

// play.test.ts: seeds 1, 2, 3 once per file.
const games = lazy(() => [1, 2, 3].map((seed) => simulateGame(gameSetup(seed))));
const m = lazy(() => measureGames([1, 2, 3]));
/** The three games' counters added up (measures.ts also exports `countGames(seeds): PlayCounters`). */
const counters = lazy(() => countGames([1, 2, 3]));
describe('guard rails', () => {
  it('three games complete with 1 to 5 goals a team on average and no NaN', () => {
    const goals = games().reduce((a, r) => a + r.score.home + r.score.away, 0) / 6;
    expect(goals).toBeGreaterThanOrEqual(1); expect(goals).toBeLessThanOrEqual(5);
    expect(JSON.stringify(games())).not.toMatch(/NaN/);
  }, 60_000);
  it('every measure is a finite number, shares within 0 to 1', () => {
    for (const [k, v] of Object.entries(m())) { expect(Number.isFinite(v), k).toBe(true); if (k.endsWith('Share') || k === 'passCompletion' || k === 'pointPassCompletion') { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  }, 60_000);
});
```
  Also change `test/perf.test.ts` and the budget test in `calibration.test.ts` from `3000` to `2500`.

- [ ] **Step 2: Run `npm -w packages/engine run test`.** Expected: FAIL, `createObserver` not found.
- [ ] **Step 3: Implement `test/measures.ts`** to the definitions above; add `play` to `GameRecord`/`Summary`; print every measure from `scripts/calibrate.ts` under a heading `how it plays`.
- [ ] **Step 4: Fill `scripts/nhl-reference.ts`.** One row per total in the design's Re-tune A list (5-on-5, per team per 60 minutes) and one per `PlayMeasures` key that has a target in Task 14. Look each NHL number up from published league statistics (NHL.com stats pages, Natural Stat Trick, Hockey-Reference) if the network allows, with the URL and season in `source`/`season` and `verified: true`; if the network does not allow, enter the number from memory with `verified: false` (the scorecard prints "from memory, unverified"). Where the NHL publishes nothing (`stationaryShare`, `twoOpenShare`, `dangerShadowedShare`, `retargetShare`, `puckJumpsPerGame`, `battleWinnerCameAwayShare`), `nhl: null`, `source: 'ours: <one sentence of reasoning>'`. Bands are the ones asserted in Task 14.
- [ ] **Step 5: Implement `scripts/scorecard.ts`; run tests.** Expected: PASS. Golden test unchanged and green.
- [ ] **Step 6: Record the baseline.** Run `npm run scorecard -- --label baseline --games 300` and commit the file it writes. Expected values near (12-game sample taken while planning): attempts 52.6 a team, defence attempts 2.0 a team, stationary share 0.175, glide share 0.25, top-speed share 0.144, sprint run 0.78 s, retarget share 0.39, pass completion 0.865, 89 point passes a game with 0.48 kept and 0.37 completed, rebound chances 2.3 a game, battle winner came away 0.23, puck to the battle winner on `toWinner` 0.04, battles with no winner 35.8 a game, knockdown share 1.00, 4.0 s and 0.30 attempts per offensive-zone possession, two open 0.40, danger shadowed 0.76, behind-net possessions 4 a game, passes out front 0.6, wraparounds 0.5, contacts over 0.3 s 1,770 a game, 810 puck jumps a game, largest 5.5 m. A value far from these means a definition is wrong: fix the observer, not the number.
- [ ] **Step 7: Commit** `test: play measures, baseline and the NHL scorecard`

---

### Task 2: A1 Skating that coasts and carves

**Files:**
- Modify: `packages/engine/src/skating.ts`, `packages/engine/src/types.ts`, `packages/engine/src/tuning.ts`, `packages/engine/src/game.ts` (passes the default drive), `packages/engine/test/skating.test.ts`, `packages/engine/test/helpers.ts` (`stepFor` takes a drive)
- Test: `packages/engine/test/skating.test.ts`, `packages/engine/test/play.test.ts`

**Interfaces:**
- Consumes: `SkaterState`, `Movement`, `TUNING.skating`, `dexp`, `datan2`, `dcos`, `dsin`, `resolveBoards`.
- Produces:

```ts
// types.ts
export type SlowMode = 'coast' | 'ease' | 'stop';
// skating.ts
/** How he slows when he is going faster than he wants, and whether he means to stop at his target or skate through it. */
export type Drive = { slow: SlowMode; through: boolean };
export const DEFAULT_DRIVE: Drive; // { slow: 'coast', through: false }
export type Movement = { topSpeed: number; accel: number; turnRate: number; backwardFactor: number; mass: number; radius: number;
  /** Hard-stop deceleration and the largest sideways acceleration his edges hold in a turn (m/s^2). */ brake: number; carve: number };
export function stepSkater(s: SkaterState, m: Movement, dt: number, drive?: Drive): void;
```
  `TUNING.skating` gains `glideDecel: 0.6`, `easeDecel: 2.5`, `brake: { base: 6, perPoint: 0.03 }` (agility), `carve: { base: 4.5, perPoint: 0.05 }` (agility), `carveLoss: 0.1`, `backward: { base: 0.6, perPoint: 0.0012 }` (agility; replaces the literal `0.72 + agility * 0.0012`).
- Algorithm (forward mode; the squared-up branch keeps its ellipse and uses the same slow-down rules):
  - Turn: `maxTurn = min(m.turnRate, m.carve / max(speed, 1.5)) * dt` (replaces `turnRate / (1 + speed / 6)`).
  - Wanted speed `v = m.topSpeed * clamp(speedCap, 0, 1)`, with no factor for how well he points at the target. Two limits lower it: arrival, unless `drive.through`: `sqrt(2 * a * max(0, dist - 0.3))` with `a = m.brake` for `slow === 'stop'`, else `easeDecel`; and reach, when the target is off his line by angle `off`: `sqrt(m.carve * dist / (2 * max(0.05, sin(min(off, PI / 2)))))` (the fastest speed whose turning circle passes through the target).
  - Below `v` he accelerates at `m.accel`. Above `v` he slows at: `glideDecel` (coast), `easeDecel` (ease), `m.brake` (stop); when it is the arrival or reach limit that he is above, at `easeDecel`, or `m.brake` for `slow === 'stop'`.
  - After turning, speed along his blades is multiplied by `dexp(-carveLoss * |turn this tick|)`.

- [ ] **Step 1: Write the failing tests**

```ts
const fresh = movementOf(def({}), 1);
const slowing = (slow: SlowMode): number => { const s = movingAt(8, 0); s.target = { x: 200, y: 0 }; s.speedCap = 0; stepFor(s, 1, fresh, { slow, through: true }); return len(s.vel); };
it('three ways to slow down: coasting barely slows, easing is light braking, stopping is hard', () => {
  expect(slowing('coast')).toBeGreaterThan(7.0); expect(slowing('coast')).toBeLessThan(7.7);
  expect(slowing('ease')).toBeGreaterThan(5.0); expect(slowing('ease')).toBeLessThan(6.0);
  expect(slowing('stop')).toBeLessThan(1.5);
});
it('coasting is the default', () => { const s = movingAt(8, 0); s.target = { x: 200, y: 0 }; s.speedCap = 0; stepFor(s, 1); expect(len(s.vel)).toBeGreaterThan(7.0); });
it('told to stop at a spot, he stops on it', () => {
  const s = movingAt(8, 0); s.target = { x: 6, y: 0 }; stepFor(s, 2.5, fresh, { slow: 'stop', through: false });
  expect(Math.hypot(s.pos.x - 6, s.pos.y)).toBeLessThan(0.5); expect(len(s.vel)).toBeLessThan(0.5);
});
it('skating through a target, he does not ease off toward it', () => {
  const s = movingAt(8, 0); s.target = { x: 4, y: 0 }; let atTarget = 0;
  for (let t = 0; t < 30 && s.pos.x < 4; t++) { stepFor(s, DT, fresh, { slow: 'coast', through: true }); atTarget = len(s.vel); }
  expect(atTarget).toBeGreaterThan(8 * 0.9);
});
const minSpeedTo = (target: Vec2, d = def({})): { min: number; widest: number } => {
  const s = movingAt(8, 0); s.target = target; let min = 8, widest = 0; const m = movementOf(d, 1);
  for (let t = 0; t < 30 * 6 && Math.hypot(s.pos.x - target.x, s.pos.y - target.y) > 1; t++) { stepFor(s, DT, m, { slow: 'coast', through: true }); min = Math.min(min, len(s.vel)); widest = Math.max(widest, s.pos.x); }
  return { min, widest };
};
it('a turn is carved: speed is mostly kept', () => {
  expect(minSpeedTo({ x: 12, y: 14 }).min).toBeGreaterThan(8 * 0.8);   // a quarter turn
  expect(minSpeedTo({ x: -15, y: 12 }).min).toBeGreaterThan(8 * 0.6);  // back the way he came
});
it('the turn radius comes from speed and agility: 4 to 10 m at 8 m/s, tighter for the agile', () => {
  const r = (agility: number): number => minSpeedTo({ x: -15, y: 12 }, def({ agility })).widest; // how far he runs on before he is round
  expect(r(70)).toBeGreaterThan(4); expect(r(70)).toBeLessThan(10);
  expect(r(95)).toBeLessThan(r(45) * 0.85);
});
it('backward is clearly slower than forward and under 6.6 m/s', () => {
  expect(backwardSpeedAfter(4)).toBeLessThan(speedAfter(def({}), 4) * 0.75); expect(backwardSpeedAfter(4)).toBeLessThan(6.6);
});
it('never NaN: on his target, at rest, with no speed cap', () => { const s = at(0, 0); s.speedCap = 0; stepFor(s, 1); expect(Number.isFinite(s.pos.x + s.vel.x + s.facing)).toBe(true); });
```
  Keep the existing tests; `'a skater cannot turn on the spot at speed'` and `'eases off and settles at the target'` must still pass as written.

- [ ] **Step 2: Run.** Expected: FAIL (`stepFor` takes no drive; coasting brakes hard).
- [ ] **Step 3: Implement** `stepSkater` and `movementOf` as specified. `game.ts` `moveSkaters` passes `DEFAULT_DRIVE` for now (Task 3 passes each skater's own).
- [ ] **Step 4: Run all checks; guard rails in `play.test.ts` green.**
- [ ] **Step 5: Re-pin the golden file.** Reason: skaters coast, carve and skate backward more slowly.
- [ ] **Step 6: Commit** `feat: skaters coast, ease or stop, and carve their turns`

---

### Task 3: A1 Commitment: held targets, team phase with memory, effort by need

**Files:**
- Create: `packages/engine/src/commit.ts`, `packages/engine/test/commit.test.ts`
- Modify: `packages/engine/src/types.ts`, `tuning.ts`, `team-play.ts`, `game.ts`, `bench.ts` (a skater stepping on or leaving), `faceoff.ts` (`headForLineup`, `stopPlay`), `bodies.ts`, `contests/loose-race.ts`, `test/helpers.ts` (`stateWith`), `test/measures.ts`, `test/play.test.ts`, `test/resume.test.ts`, `test/contests/loose-race.test.ts`

**Interfaces:**
- Consumes: `Drive`, `SlowMode`, `stepSkater(s, m, dt, drive)` (Task 2); `assignJobs`, `phaseFor`, `steeredByContest`, `supportTarget` (`team-play.ts`); `GoalieState`; `Movement.radius`.
- Produces (`types.ts`):

```ts
/** Every job a skater can hold. No two skaters of a team hold the same one, except the utility jobs change, lineUp, tagUp, contest, down. */
export type Job =
  | 'carrier'
  | 'lowSupport' | 'netFront' | 'highForward' | 'pointStrong' | 'pointWeak' | 'office'          // with the puck, offensive zone
  | 'driveWide' | 'driveMiddle' | 'trailer' | 'dJoin' | 'dHold' | 'dHoldWeak'                    // with the puck, rush
  | 'outlet' | 'centreLow' | 'stretch' | 'dPartner'                                              // with the puck, breakout
  | 'f1' | 'f2' | 'f3' | 'dLineStrong' | 'dLineWeak'                                             // without it, their zone
  | 'backcheckA' | 'backcheckB' | 'dGapStrong' | 'dGapWeak'                                      // without it, neutral zone
  | 'dCorner' | 'dNet' | 'dzCentre' | 'wingStrong' | 'wingWeak'                                  // without it, own zone
  | 'chase' | 'receive' | 'battleSupport'                                                        // the puck is loose or on its way
  | 'press' | 'shape'                                                                            // Task 3 only; Task 4 removes both
  | 'change' | 'lineUp' | 'tagUp' | 'contest' | 'down';                                          // utility
export type Effort = 'glide' | 'skate' | 'sprint';
/** Why a target was last issued. `review` is the routine one (minimum hold passed and the spot moved enough); the rest are triggers. */
export type ReplanReason = 'start' | 'possession' | 'passToMe' | 'loosePuckMine' | 'phase' | 'whistle' | 'contestEnd' | 'gotUp' | 'steppedOn' | 'offside' | 'review';
/** What a skater has committed to. `state.plans[i]` belongs to `state.skaters[i]`. */
export type SkaterPlan = {
  job: Job; jobTick: number;
  /** When his target was last issued and why; the side that had possession then. */
  targetTick: number; reason: ReplanReason; possession: Side | null;
  /** `spot`: a held place on the ice; `puck` / `man`: he tracks it every tick (`markId` for a man). */
  follow: 'spot' | 'puck' | 'man'; markId: string | null;
  effort: Effort; slow: SlowMode; through: boolean;
};
export type TeamPhaseState = { phase: TeamPhase; sinceTick: number; pending: TeamPhase | null; pendingTick: number };
// GameState gains:
plans: SkaterPlan[];
teamPhase: Record<Side, TeamPhaseState>;
```
  `SkaterState.speedCap` keeps its type; its meaning becomes "the share of top speed he wants now (his effort)", no longer a cap by job.
- Produces (`commit.ts`):

```ts
export function initialPlans(skaters: number): SkaterPlan[];
export function initialTeamPhase(): Record<Side, TeamPhaseState>;
export function planOf(state: GameState, id: string): SkaterPlan;
/** Once per live tick, before jobs: the committed phase follows the raw one (phaseFor's rule on carrier-or-possession) only after it has differed for TUNING.commit.phaseDelay. */
export function updateTeamPhase(state: GameState): void;
export function committedPhase(state: GameState, side: Side): TeamPhase;
/** Sets a committed phase at once (faceoff drops, period starts). */
export function setTeamPhase(state: GameState): void;
export type Want = { job: Job; pos: Vec2; face: Vec2 | null; follow: SkaterPlan['follow']; markId: string | null; effort: Effort; slow: SlowMode; through: boolean };
/**
 * Applies the hold rule to skater i and writes his target, faceTarget and speedCap. A `follow: 'spot'` target and the
 * job itself change only (a) on a trigger, named in `trigger`, or (b) when TUNING.commit.holdSeconds have passed since
 * `targetTick` and `want.pos` is more than TUNING.commit.moveEnough from the held target (reason `review`). Returns true when re-issued.
 */
export function commitTo(state: GameState, i: number, want: Want, trigger: ReplanReason | null): boolean;
/** The trigger that holds for skater i now against his plan, or null. */
export function triggerFor(state: GameState, i: number, wantJob: Job): ReplanReason | null;
/** speedCap for an effort and energy: TUNING.effort.glide / skate / sprint; a sprint needs energy >= sprintMinEnergy unless the job is chase, receive, f1 or press. */
export function speedFor(effort: Effort, job: Job, energy: number): number;
/** The effort a positional job needs: sprint beyond TUNING.effort.sprintFrom m from the spot, glide within glideWithin, else skate. */
export function effortToReach(distance: number): Effort;
```
  `TUNING.commit = { holdSeconds: 0.4, moveEnough: 1.5, phaseDelay: 0.5, chaserMargin: 1 }`; `TUNING.effort = { glide: 0.55, skate: 0.8, sprint: 1, sprintFrom: 8, glideWithin: 3, sprintMinEnergy: 0.2 }`; `TUNING.goalieBody = { radius: 0.55 }`.
  Triggers: `possession` (`state.possession !== plan.possession`), `passToMe` (he is `pendingPass.toId` and not yet `receive`), `loosePuckMine` (the puck is loose and he becomes his side's chaser), `phase` (his team's committed phase changed since `targetTick`), `whistle` (play stopped or resumed since), `contestEnd` (his job was `contest` and no contest steers him now), `gotUp` (his job was `down`), `steppedOn` (set by `bench.ts` when he steps on), `offside` (a delayed offside against his team began or ended since).
- Produces (`team-play.ts`): `assignJobs` keeps its signature; it calls `updateTeamPhase`, uses `committedPhase` in place of `phaseOf`, and routes every skater's target through `commitTo`. Jobs in this task: `carrier`, `press` (today's presser), `chase`, `receive` (the pass's intended receiver), `battleSupport`, `tagUp`, `change`, `lineUp`, `contest`, `down`, `shape` (everyone else, target from today's `shape()`). The chaser changes only when another skater of his side is closer by more than `chaserMargin`. All `speedCap = 0.8 / 0.85 / 0.9` literals in `shape()` and `FORECHECK_PRESS_CAP` go: effort is `sprint` for `press`, `chase`, `receive`, `battleSupport`, `tagUp`, else `effortToReach(distance to the spot)`. `keepLegal`'s easing at the blue line becomes `slow: 'stop'`, `through: false`. `follow` is `puck` for `chase`, `man` for `press`, else `spot`; `through` is true for `puck`/`man`.
- Produces (`game.ts`): `moveSkaters` passes each skater's `{ slow, through }` from his plan; a skater steered by a contest gets `{ slow: 'stop', through: false }`. After `resolveBodies`: `resolveGoalies`.
- Produces (`bodies.ts`): `resolveGoalies(skaters: SkaterState[], moves: readonly Movement[], goalies: readonly GoalieState[]): void` pushes each on-ice skater out to `TUNING.goalieBody.radius + his radius` from each goalie's centre (only the skater moves) and removes his velocity toward the goalie.
- Produces (`contests/loose-race.ts`): after the draw, `resolve` lasts until the winner is within `REACH` (0.9 m) of the puck, then ends `won` / `toWinner`; if he is not there within 1.0 s, or anyone else has the puck, it ends `off`. The loser is steered 1.5 m to the far side of the winner's line (he yields). `ContestStages.looseRace` is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// commit.test.ts
it('one bobble does not flip the phase; a real change of possession does, after about half a second', () => {
  const st = stateWith({ carrier: 'home', puckX: 20 }); setTeamPhase(st);
  expect(committedPhase(st, 'home')).toBe('ozone'); expect(committedPhase(st, 'away')).toBe('dzone');
  st.carrierId = 'away-LD'; st.possession = 'away';
  for (let t = 0; t < 6; t++) { st.tick++; updateTeamPhase(st); }            // 0.2 s
  st.carrierId = 'home-RW'; st.possession = 'home';
  for (let t = 0; t < 30; t++) { st.tick++; updateTeamPhase(st); expect(committedPhase(st, 'home')).toBe('ozone'); }
  st.carrierId = 'away-LD'; st.possession = 'away'; let flipped = -1;
  for (let t = 1; t <= 30 && flipped < 0; t++) { st.tick++; updateTeamPhase(st); if (committedPhase(st, 'home') !== 'ozone') flipped = t; }
  expect(flipped).toBeGreaterThanOrEqual(12); expect(flipped).toBeLessThanOrEqual(18);
});
it('a held spot is not re-issued inside 0.4 s when the wanted spot drifts, and is after it once it has moved 1.5 m', () => {
  const st = stateWith({ carrier: 'home', puckX: 20 }); const i = st.skaters.findIndex((s) => s.id === 'home-LD');
  const want = (x: number): Want => ({ job: 'shape', pos: { x, y: 8 }, face: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false });
  commitTo(st, i, want(9), 'start');
  for (let t = 1; t <= 11; t++) { st.tick++; expect(commitTo(st, i, want(9 + t), null)).toBe(false); expect(st.skaters[i]!.target.x).toBe(9); }
  st.tick++; expect(commitTo(st, i, want(9.8), null)).toBe(false);                 // 0.4 s passed, moved 0.8 m: kept
  expect(commitTo(st, i, want(12), null)).toBe(true); expect(st.plans[i]!.reason).toBe('review');
});
it('a trigger re-issues at once and names itself', () => {
  const st = stateWith({ carrier: 'home', puckX: 20 }); const i = st.skaters.findIndex((s) => s.id === 'away-C');
  assignJobs(st, defs, tactics); st.tick++; st.carrierId = null; st.pendingPass = { fromId: 'away-LD', toId: 'away-C', untilTick: st.tick + 30, tried: [], pressure: 0 }; st.possession = 'away';
  assignJobs(st, defs, tactics);
  expect(st.plans[i]!.job).toBe('receive'); expect(['passToMe', 'possession']).toContain(st.plans[i]!.reason); expect(st.plans[i]!.targetTick).toBe(st.tick);
});
it('effort is chosen by need: a sprint to a far spot, a glide near it, and no sprint on empty legs', () => {
  expect(effortToReach(12)).toBe('sprint'); expect(effortToReach(5)).toBe('skate'); expect(effortToReach(2)).toBe('glide');
  expect(speedFor('sprint', 'shape', 0.1)).toBeLessThan(1); expect(speedFor('sprint', 'chase', 0.1)).toBe(1);
});
it('a skater is pushed out of the goalie', () => {
  const st = stateWith({ carrier: null, puckX: 0 }); const s = skater(st, 'away', 'C'); s.pos = { x: -26.4, y: 0.1 }; s.vel = { x: -3, y: 0 };
  resolveGoalies([s], [mv(85)], [st.goalies.home]);
  expect(Math.hypot(s.pos.x - st.goalies.home.pos.x, s.pos.y - st.goalies.home.pos.y)).toBeGreaterThanOrEqual(0.55 + 0.38 - 1e-9); expect(s.vel.x).toBeGreaterThanOrEqual(0);
});

// loose-race.test.ts
it('the winner skates to the puck and picks it up: it never jumps to him', () => {
  for (let seed = 1; seed <= 200; seed++) { const r = runRaceTicks({ aLead: 0.3, seed });   // per-tick puck positions and the end event
    if (r.end.detail.result !== 'won') continue;
    expect(r.puckStepAtEnd).toBeLessThanOrEqual(0.9 + 0.6 + 0.2); }
});

// play.test.ts: the observer gains these counters (measures.ts): 'holdViolations' (a follow 'spot' target re-issued less than 12 ticks
// after the last with reason 'review'), 'goalieOverlapTicks' (an on-ice skater closer than 0.55 + bodyRadius - 1e-6 to a goalie after a step),
// 'raceJumpTicks' (a looseRace ending 'won' on a tick the puck moved over 1.7 m). spotTicks/retargets now count plans with follow 'spot' only.
it('A1: nobody re-issues a held target inside 0.4 s without a trigger', () => { expect(counters().holdViolations).toBe(0); });
it('A1: targets are held: under 10% of spot ticks see the target move (was 39%)', () => { expect(m().retargetShare).toBeLessThan(0.10); });
it('A1: more gliding and more top speed than before: glide over 30% (was 25%), top speed over 17% (was 14%), sprints over 1.2 s (was 0.8)', () => {
  expect(m().glideShare).toBeGreaterThan(0.30); expect(m().topSpeedShare).toBeGreaterThan(0.17); expect(m().sprintRunSeconds).toBeGreaterThan(1.2);
});
it('A1: skaters never overlap a goalie, and a race win never moves the puck to the winner', () => { expect(counters().goalieOverlapTicks).toBe(0); expect(counters().raceJumpTicks).toBe(0); });

// resume.test.ts: two more cases in `cases`
['mid-hold (a spot target issued under 0.2 s ago)', (s) => s.plans.some((p, i) => s.skaters[i]!.onIce && p.follow === 'spot' && s.tick - p.targetTick > 0 && s.tick - p.targetTick < 6), 20_000],
['with a phase change pending', (s) => s.teamPhase.home.pending !== null || s.teamPhase.away.pending !== null, 50_000],
```

- [ ] **Step 2: Run.** Expected: FAIL (`commit.ts` missing).
- [ ] **Step 3: Implement** `commit.ts`, the `assignJobs` rewiring, `resolveGoalies`, the loose-race change, plan resets in `bench.ts` (`stepOn`: job `shape`, reason `steppedOn`; leaving: job `change`) and `faceoff.ts` (`lineUp`, reason `whistle`; `dropPuck` calls `setTeamPhase`).
- [ ] **Step 4: Run all checks, and the stuck-play check:** `npm -w packages/engine exec vitest run --config vitest.calibration.config.ts test/robustness.test.ts`. Expected: PASS (no 15 s without a touch).
- [ ] **Step 5: Re-pin the golden file.** Reason: targets and team phase are held; effort by need; race winners skate to the puck; goalies are solid.
- [ ] **Step 6: Commit** `feat: skaters commit to a job and a target; team phase has memory`. Meaning changes: `SkaterState.speedCap` is the effort he wants, not a cap by job; a `looseRace` `contestEnd` with `won` now comes when the winner reaches the puck, up to 1 s after the draw.

---

### Task 4: A2 Every player has a job

**Files:**
- Create: `packages/engine/src/jobs.ts`, `packages/engine/src/job-targets.ts`, `packages/engine/src/lanes.ts`, `packages/engine/test/jobs.test.ts`, `packages/engine/test/lanes.test.ts`
- Modify: `packages/engine/src/team-play.ts` (drops `shape`, `press`, `chase`, `OZONE_SPOTS`, `ozoneSpotPos`, the cycle rotation), `types.ts` (removes `'press' | 'shape'` from `Job`), `tuning.ts`, `goalie.ts` (`goalieSpot`), `contests/net-front.ts` (trigger), `test/team-play.test.ts`, `test/helpers.ts` (`spotName` goes), `test/measures.ts`, `test/play.test.ts`

**Interfaces:**
- Consumes: `Job`, `SkaterPlan`, `Want`, `commitTo`, `triggerFor`, `committedPhase`, `effortToReach` (Task 3); `Tactics`; `Tendencies`; `composite`; `RINK`; `segDistXY`.
- Produces (`lanes.ts`):

```ts
/** Metres of clear ice round the segment from `from` to `to`: the smallest distance from any on-ice, standing opponent of `side` to it. */
export function laneWidth(state: GameState, side: Side, from: Vec2, to: Vec2): number;
/** A lane is open at TUNING.lanes.open (1.0 m) or more, with no opponent within TUNING.lanes.space (1.5 m) of `to`. */
export function laneOpen(state: GameState, side: Side, from: Vec2, to: Vec2): boolean;
/** No standing opponent ahead of `s` within TUNING.lanes.clearPath (2.5 m) of his line to the centre of the net he attacks. */
export function clearPathToNet(state: GameState, s: SkaterState): boolean;
/** The carrier's most dangerous teammate: the one with the highest dexp(-d / 9) * dx / d (d to the net centre, dx its rx part); null with no teammate in the zone. */
export function dangerMan(state: GameState, carrier: SkaterState): SkaterState | null;
```
- Produces (`jobs.ts`):

```ts
export const UTILITY_JOBS: readonly Job[]; // ['change', 'lineUp', 'tagUp', 'contest', 'down']
export const FORWARD_JOBS: readonly Job[]; export const DEFENCE_JOBS: readonly Job[]; // which group may hold which job
/** The jobs to hand out to `side`'s free skaters now, most important first (never `carrier`, never a utility job). */
export function jobsFor(state: GameState, side: Side, tactics: Tactics): Job[];
/**
 * Gives every free skater of `side` one job, no two the same. For each job in jobsFor order: the free, unassigned skater of the
 * right group with the lowest cost, cost = distance to the job's anchor, less TUNING.jobs.keep (3 m) if he holds that job now.
 * A forward takes a defence job (and the reverse) only when nobody of the right group is free. Skaters left over take the next
 * unused job of the phase's list. Returns the job per skater index (null for skaters not assigned here).
 */
export function assignTeamJobs(state: GameState, side: Side, defs: Map<string, PlayerDef>, tactics: Tactics): (Job | null)[];
```
  Job lists by committed phase (first is most important; a job in brackets is used only in the stated case):
  - `ozone`: `netFront`, `lowSupport`, `highForward`, `pointStrong`, `pointWeak`; [`office` in place of `lowSupport` when the carrier is above the goal line with `|ly| > 6` and no opponent is behind the net]; when a forward carries low (`rx > 20`), `highForward` comes first.
  - `rush`: `driveWide`, `driveMiddle`, `trailer`, then for the defencemen `dJoin` (only for a defenceman with `tendencies.joinRush >= 0.6`), `dHold`, `dHoldWeak`.
  - `breakout`: `outlet`, `centreLow`, `stretch`, `dPartner` (and `chase` for the retriever while the puck is loose).
  - `forecheck`: `f1`, `f2`, `f3`, `dLineStrong`, `dLineWeak`. `neutralDefence`: `f1`, `dGapStrong`, `dGapWeak`, `backcheckA`, `backcheckB`. `dzone`: `dCorner`, `dNet`, `dzCentre`, `wingStrong`, `wingWeak`.
  - Loose puck: each side's first man is `chase`, a pass's receiver is `receive`, a board battle's would-be supporter `battleSupport`; the rest keep the committed phase's jobs.
- Produces (`job-targets.ts`): `jobWant(state: GameState, s: SkaterState, job: Job, defs: Map<string, PlayerDef>, tactics: Tactics, out: Want): Want`. Anchors in attack-relative metres `(rx, ly)`, and each job's moving part:

  | Job | Anchor | Moving part |
  |---|---|---|
  | `netFront` | on the line net centre to puck, 1.8 m from the net | stays in the shot lane, shifts with the puck; first man to a rebound |
  | `lowSupport` | the boards on the puck's side, 7 m from the carrier, below him if he is above `rx` 21, else above | get open |
  | `office` | `(28.3, -ps * 1.2)` behind the net | get open; faces the slot |
  | `highForward` | `(16, ps * 2)` | get open; first man back when the puck is lost |
  | `pointStrong` / `pointWeak` | `(9.1, ps * 8.5)` / `(9.1, -ps * 4)` | slides along the line (`ly` within 4 m of the anchor) to the widest lane; face the puck |
  | `driveWide` / `driveMiddle` | `(puck rx + 3, -ps * 8)` / `(puck rx + 2, ps * 1)`, never past `rx` 6.6 until the puck is in | `through`, sprint; then the far post / the net front |
  | `trailer` | `(puck rx - 7, ps * 3)` | get open |
  | `dJoin`, `dHold`, `dHoldWeak` | `(puck rx - 9, -ps * 7)`, `(puck rx - 14, ps * 4)`, `(puck rx - 14, -ps * 4)` | hold the gap behind the play |
  | `outlet` | `(-14, ps * 11)` | get open on the wall |
  | `centreLow` | `(-19, ps * 3)` | curls through it (`through`), then up the middle |
  | `stretch` | `(-2, -ps * 9)`, onside | get open |
  | `dPartner` | `(-25, -ps * 4)` | get open for the reverse |
  | `f1` | the carrier | pressure: `follow: 'man'`, from the middle of the ice |
  | `f2` | aggressive: 3 m off the carrier on the boards side; balanced: the lane to the carrier's strong-side wall option; passive: `(3, ps * 8)` | take away the pass or the body |
  | `f3` | `(13, 0)` (passive `(-2, 0)`) | stays above the puck, shadows the middle lane |
  | `dLineStrong` / `dLineWeak` | aggressive `(9.1, ±7)`, balanced `(7, ±7)`, passive `(-3, ±4)` | backward when the play turns |
  | `dGapStrong` | the carrier's lane, `6 + (100 - reads) * 0.05 + approach * 0.6` m goal-side (today's gap) | backward, facing the carrier |
  | `dGapWeak` | the weak-side lane, level with his partner | picks up the widest attacker; backward |
  | `backcheckA` / `backcheckB` | the nearest unmarked attacker without the puck | cover a man |
  | `dCorner` | the carrier when the puck is below `rx` -19 on his side; else `(-23.5, ps * 5)` | pressure, or contain 2.5 m goal-side |
  | `dNet` | the attacker nearest the net front (within 4 m), else `(-25.1, -ps * 0.8)` | between that man and the net |
  | `dzCentre` | `(-20, ps * 1.5)` | cover the low man; shadow the lane to the slot |
  | `wingStrong` / `wingWeak` | the opposing point man on that side | cover a man, shading to the lane |

  The moving parts are these functions, exported for the tests:

```ts
/**
 * Get open: the best of the anchor and 8 spots at `radius` round it for a pass from the carrier: widest laneWidth, at least
 * TUNING.lanes.space from any opponent, inside the boards, onside. He keeps his held spot while laneOpen holds for it; when it
 * stops holding (he is covered, or a defender's shadow is on the lane) the hold rule's `review` moves him.
 */
export function openSpot(state: GameState, s: SkaterState, anchor: Vec2, radius: number, out: Vec2): Vec2;
/** Cover a man: the spot `gap` m from `mark` toward the defender's own net, moved toward the carrier-to-mark lane by TUNING.cover.laneWeight (0.5) of the way so his stick is in it. */
export function coverSpot(state: GameState, s: SkaterState, mark: SkaterState, gap: number, out: Vec2): Vec2;
/** Take a lane away: the point of the carrier's lane to `dangerMan` nearest `s`, when that is within TUNING.cover.shadowReach (3 m) of his cover spot; null otherwise. */
export function shadowSpot(state: GameState, s: SkaterState, out: Vec2): Vec2 | null;
```
  `faceTarget` is set (so a skater may skate backward) only for `dGapStrong`, `dGapWeak`, `dLineStrong`, `dLineWeak`, `dNet`, `pointStrong`, `pointWeak`, `office`, `netFront` and a covering job within 4 m of its man; every other job skates forward.
  Chase or hold the front: with a carrier behind the net (`rx < -27.43` in the defenders' terms), `dCorner` chases him round the net when he is within 3 m of the carrier or the carrier has stood there over 1.5 s, else he holds the near post (`(-26.6, ps * 1.3)`); `dNet` always holds the front. (Task 11 lets the `defence` tactic shift this.)
- Produces (`goalie.ts`): with the puck behind the goal line the goalie hugs the post on the puck's side as today, and when the puck's `y` changes sign he crosses to the other post at his lateral speed (no change needed to `goalieSpot`; pinned by a test below). **What must change for play behind the net:** today `carryTarget` (`brain.ts`) sends any carrier with `rx > 25.63` straight back out, the board-battle trigger (`T.triggerBoards` 1.2 m) covers most of the 2.35 m lane between the net and the end boards, and no job ever stands there. This task adds the `office` job; Task 5 adds the carrier's choices there and exempts a carrier behind the net from the board-battle trigger unless an opponent is within 1.2 m of him. `resolveNets`, `clipToNets` and `chase`'s route round the net already keep bodies and the puck out of the frame.
- Produces (`contests/net-front.ts`): the trigger asks for `planOf(state, s.id).job === 'netFront'` within `T.spotRange` of his target, in place of `ozoneSpotPos(..., 'netFront')`.

- [ ] **Step 1: Write the failing tests**

```ts
// jobs.test.ts
const jobsOf = (st: GameState, side: Side): Job[] => st.skaters.flatMap((s, i) => (s.onIce && s.side === side ? [st.plans[i]!.job] : []));
it.each([['home', 22], ['home', 2], ['home', -20], ['away', 22], ['away', 2], ['away', -20]] as const)('carrier %s at x %s: five different jobs a side', (side, x) => {
  const st = stateWith({ carrier: side, puckX: x }); setTeamPhase(st); assignJobs(st, defs, tactics);
  for (const sd of ['home', 'away'] as const) { const js = jobsOf(st, sd); expect(new Set(js).size).toBe(5); for (const j of js) expect(['press', 'shape']).not.toContain(j); }
});
it('in the offensive zone: net front, low support, high forward and two points', () => {
  const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9, carrierSlot: 'LD' }); setTeamPhase(st); assignJobs(st, defs, tactics);
  expect(jobsOf(st, 'home').sort()).toEqual(['carrier', 'highForward', 'lowSupport', 'netFront', 'pointWeak'].sort());
});
it('in his own zone each man covers a man or a lane: wingers on the points, a defenceman at the net', () => {
  const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9 }); setTeamPhase(st); assignJobs(st, defs, tactics);
  expect(jobsOf(st, 'away').sort()).toEqual(['dCorner', 'dNet', 'dzCentre', 'wingStrong', 'wingWeak'].sort());
  const w = st.plans[st.skaters.findIndex((s) => s.id === 'away-LW')]!; expect(w.markId === 'home-LD' || w.markId === 'home-RD').toBe(true);
});
it('the net-front defender stands between his man and the net', () => {
  const st = stateWith({ carrier: 'home', puckX: 12, puckY: 9, carrierSlot: 'LD' }); place(st, 'home:C', 24.5, 0.8); setTeamPhase(st); assignJobs(st, defs, tactics);
  const i = st.plans.findIndex((p, k) => p.job === 'dNet' && st.skaters[k]!.side === 'away'); const t = st.skaters[i]!.target;
  expect(segDistXY(t.x, t.y, 24.5, 0.8, 27.13, 0)).toBeLessThan(0.3); expect(t.x).toBeGreaterThan(24.5);
});
it('the first forechecker goes at the puck, the third stays high', () => {
  const st = stateWith({ carrier: 'away', puckX: 22 }); setTeamPhase(st); assignJobs(st, defs, tactics);
  const tx = (job: Job): number => st.skaters[st.plans.findIndex((p, k) => p.job === job && st.skaters[k]!.side === 'home')]!.target.x;
  expect(tx('f1')).toBeGreaterThan(tx('f3') + 5);
});
it('a man holding a job keeps it when another is 2 m nearer its spot, and loses it at 4 m', () => { /* keep bonus 3 m */ });
it('getting open is active: a covered man moves to a spot the carrier can reach', () => {
  const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9 }); const out = { x: 0, y: 0 };
  const hf = skater(st, 'home', 'C'); place(st, 'home:C', 16, 2); place(st, 'away:C', 18.5, 5);        // a defender on the lane
  expect(laneOpen(st, 'home', st.puck.pos, hf.pos)).toBe(false);
  openSpot(st, hf, { x: 16, y: 2 }, 3, out);
  expect(laneOpen(st, 'home', st.puck.pos, out)).toBe(true); expect(Math.hypot(out.x - 16, out.y - 2)).toBeGreaterThan(1.5);
});
it('taking a lane away: a covering winger shades into the lane to his point man, stick in it', () => {
  const st = stateWith({ carrier: 'home', puckX: 24, puckY: 9 }); const out = { x: 0, y: 0 }; const mark = skater(st, 'home', 'LD'); place(st, 'home:LD', 9.1, 8.5);
  coverSpot(st, skater(st, 'away', 'RW'), mark, 3, out);
  expect(segDistXY(out.x, out.y, st.puck.pos.x, st.puck.pos.y, 9.1, 8.5)).toBeLessThan(1.2);            // within a stick of the lane
});
it('behind the net is a place: the office is filled when the puck is on the half wall and nobody is back there', () => {
  const st = stateWith({ carrier: 'home', puckX: 18, puckY: 11 }); setTeamPhase(st); assignJobs(st, defs, tactics);
  const i = st.plans.findIndex((p, k) => p.job === 'office' && st.skaters[k]!.side === 'home'); expect(i).toBeGreaterThanOrEqual(0); expect(st.skaters[i]!.target.x).toBeGreaterThan(27.5);
});
it('the goalie follows a carrier behind his net post to post', () => {
  const st = stateWith({ carrier: 'home', puckX: 28.6, puckY: 2 }); const g = st.goalies.away;
  for (let t = 0; t < 30; t++) goalieTick(st, goalieDefs, DT);
  expect(g.pos.y).toBeGreaterThan(0.6);
  st.puck.pos.y = -2; let ticks = 0; while (g.pos.y > -0.6 && ticks < 90) { goalieTick(st, goalieDefs, DT); ticks++; }
  expect(ticks).toBeGreaterThan(6); expect(ticks).toBeLessThan(45);                                     // 0.2 to 1.5 s: he has to move
});

// play.test.ts: new counters 'duplicateJobTicks' (a live tick on which two on-ice skaters of a side hold the same non-utility job),
// 'netFrontDefenderTicks' / 'netFrontDefenderBetween' (ticks a dNet has a mark within 2 m; of those, he is within 0.8 m of the segment mark-to-net and nearer the net).
it('A2: no two skaters of a team ever hold the same job', () => { expect(counters().duplicateJobTicks).toBe(0); });
it('A2: standing still is under 9% of a skater\'s live time (was 17.5%)', () => { expect(m().stationaryShare).toBeLessThan(0.09); });
it('A2: at least two attackers are open in over 50% of offensive-zone time (was 40%)', () => { expect(m().twoOpenShare).toBeGreaterThan(0.50); });
it('A2: the most dangerous option is shadowed in 60% to 90% of it (was 76%)', () => { expect(m().dangerShadowedShare).toBeGreaterThan(0.60); expect(m().dangerShadowedShare).toBeLessThan(0.90); });
it('A2: the net-front defender is between his man and the net in over 85% of the time he has one', () => { const c = counters(); expect(c.netFrontDefenderBetween / c.netFrontDefenderTicks).toBeGreaterThan(0.85); });
it('A2: the side with the puck skates forward: under 3% of its time backward', () => { expect(m().backwardShareWithPuck).toBeLessThan(0.03); });
```
  In `test/team-play.test.ts`, delete `'forwards rotate in the offensive zone'` (a timed rotation is a script) and keep the rest green; `'retreating defencemen face the puck'` (`skating.test.ts`) must stay above 0.8.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `lanes.ts`, `jobs.ts`, `job-targets.ts`; `assignJobs` becomes: `updateTeamPhase`, utility jobs, `assignTeamJobs` per side, `jobWant`, `keepLegal`, `commitTo`. `TUNING.jobs = { keep: 3 }`, `TUNING.lanes = { open: 1.0, space: 1.5, clearPath: 2.5 }`, `TUNING.cover = { gap: 1.2, laneWeight: 0.5, shadowReach: 3 }`.
- [ ] **Step 4: Run all checks and the robustness file (as in Task 3).**
- [ ] **Step 5: Re-pin the golden file.** Reason: every skater holds a named job with a moving part.
- [ ] **Step 6: Commit** `feat: every skater has a job: get open, cover a man, take a lane, play behind the net`. Meaning changes: none to events; `state.plans[i].job` no longer takes the values `press` or `shape`.

---

### Task 5: A3 Decisions with the puck: every option has a value

**Files:**
- Create: `packages/engine/src/options.ts`, `packages/engine/test/options.test.ts`
- Modify: `packages/engine/src/brain.ts` (keeps `brainTick`, `canReceivePass`; `decideCarrier` becomes a thin call into `options.ts`), `actions.ts` (`executeRim`, `executeClear`), `types.ts`, `tuning.ts`, `contests/board-battle.ts` (trigger exemption behind the net), `test/brain.test.ts`, `test/helpers.ts` (`stateWith`), `test/measures.ts`, `test/play.test.ts`, `apps/debug/src/events.ts` only if its typecheck needs the new `kind` values

**Interfaces:**
- Consumes: `laneWidth`, `laneOpen`, `clearPathToNet`, `dangerMan` (`lanes.ts`); `planOf`, `SkaterPlan.job` (to find `lowSupport`, `office`, `netFront`, the point men); `pressureOn`, `goalieShade`, `executePass`, `executeShot`, `executeDump` (`actions.ts`); `scoreMargin`; `Tactics`; `TUNING.brain` (its score-effect and hold values stay in use).
- Produces (`types.ts`):

```ts
/** What the carrier has committed to (the brain re-values every BRAIN_INTERVAL_TICKS; the committed option gets TUNING.value.stick). */
export type CarrierPlan = { id: string; kind: 'carry' | 'pass' | 'shoot' | 'dump' | 'protect' | 'rim' | 'clear'; lane: CarryLane | null; toId: string | null; to: Vec2 | null; tick: number };
export type CarryLane = 'net' | 'wide' | 'middle' | 'office' | 'wrap' | 'hold';
// GameState gains:
carrierPlan: CarrierPlan | null;
// EventDetails: `pass.kind` and `release.kind` gain the values 'rim' (hard round the boards, to a man or an area) and 'clear' (out of his own zone, no receiver).
pass: { kind: 'pass' | 'dump' | 'rim' | 'clear'; distance: number | null };
release: { kind: 'pass' | 'shot' | 'dump' | 'rim' | 'clear'; toId: string | null; vel: { x: number; y: number; z: number } };
```
- Produces (`options.ts`):

```ts
export type Situation = {
  rx: number; ly: number; zone: 'D' | 'N' | 'O'; pressure: number;
  /** Nobody between him and the net (clearPathToNet) once he is past his own blue line. */
  breakaway: boolean;
  /** Attackers level with or ahead of the puck (within 5 m behind it) outnumber the defenders goal-side of it, two or fewer of them. */
  oddMan: boolean;
  /** Under pressure (0.5 or more) below the faceoff dots (rx > 21.03). */
  pressuredLow: boolean;
  /** Behind the goal line he attacks, within 4 m of the middle. */
  behindNet: boolean;
};
export type Option =
  | { kind: 'shoot'; value: number }
  | { kind: 'pass'; toId: string; value: number }
  | { kind: 'carry'; lane: CarryLane; to: Vec2; value: number }
  | { kind: 'rim'; toId: string | null; value: number }
  | { kind: 'dump'; value: number } | { kind: 'protect'; value: number } | { kind: 'clear'; value: number };
export function readSituation(state: GameState, s: SkaterState): Situation;
/** How much having the puck at (rx, ly) is worth to the team that has it: about its chance to score on this possession, 0 to about 0.2. */
export function threat(rx: number, ly: number): number;
/** Every option he has, each with value = chance it works * (threat it leads to - threat here) - (1 - that chance) * what losing it here costs. Refills and returns `out`. */
export function listOptions(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, tactics: Tactics, out: Option[]): Option[];
/** His pick: each value is seen with an error (TUNING.value.noise: base + perPoint * (100 - iq), more under pressure, less with poise), then the best seen is taken. */
export function chooseOption(options: readonly Option[], me: PlayerDef, sit: Situation, plan: CarrierPlan | null, rng: Rng): Option;
```
  `decideCarrier(state, me, defs, rng, tactics?)` keeps its name and returns a `Decision`, which gains `{ kind: 'rim'; toId: string | null }` and `{ kind: 'clear' }`, and `carry` gains `lane: CarryLane`.
  Rules the option list obeys (they remove options; they never fix the pick among those left):
  - **Clear path.** With `breakaway`, the list is: `shoot` (inside 12 m), `carry` lane `net` (a deke: inside 6 m its target cuts 1.5 m across the goalie), and a `pass` only to a teammate level or ahead (`rx` no more than 1 m behind his) whose `threat` is higher. No `dump`, `rim`, `clear`, and no `protect`.
  - **Odd-man rush.** With `oddMan`: `shoot`, `carry` lanes `net` and `wide`, and a `pass` only to a teammate level or ahead.
  - **Pressured low.** With `pressuredLow`: `protect`, `rim` (the cycle: to `lowSupport` or `office` if one is there, else round the boards), `shoot`, a `pass` to a man below the dots; no pass to a point man or to anyone above `rx` 15.
  - **Behind the net.** With `behindNet`: `carry` lane `hold` (he stays, the net between him and the nearest opponent; `protect` is not needed while the frame shields him), `pass` out front to the slot or to either side, `carry` lane `wrap` (to `(26.7, ±1.3)` on the post the goalie is further from; valued by how far the goalie is from that post), `rim`. A carrier low on the wall with nobody behind the net has a `carry` lane `office` (to `(28.3, ±1.5)`).
  - **Otherwise.** `shoot` (in the zone, within `TUNING.brain.maxShotDistance`); `pass` to the best `1 + floor(vision / 25)` teammates by seen value (a teammate behind his back, more than 100 degrees off his facing, is seen only with vision 60 or more), never one who would be offside; `carry` lanes `net`, `wide`, `middle`; `dump` (neutral zone) or `clear` (own zone); `protect`.
  - A pass's chance of working falls with a shadowed lane: `laneWidth` under `TUNING.lanes.open` multiplies it by `TUNING.value.shadowed` (0.5), under 0.5 m by 0.2. Habits multiply values (`tendencies.shoot`, `pass`, `carry`, `dump`, each as `0.6 + 0.8 * tendency`); `TUNING.scoreEffects` and the hold-time boost keep their present effect on `shoot` and `pass`.
  `TUNING.value = { noise: { base: 0.004, perPoint: 0.0002, pressure: 0.006, perPoise: 0.00004 }, stick: 0.004, shadowed: 0.5, turnoverCost: 0.6, hold: 0.002 }` (builder's starting values).
- Produces (`actions.ts`): `executeRim(state, fromId, toId: string | null, defs, rng, out)`: the puck goes hard along the boards (16 to 20 m/s, aimed at the boards 3 m ahead so it rings round) toward the low corner or the man named; `pass` event kind `rim`, `pendingPass` to `toId` when given. `executeClear(state, fromId, defs, rng, out)`: off the boards and out past his own blue line; `pass` event kind `clear`.
- Produces (`brain.ts`): `brainTick` writes `state.carrierPlan`; a carrier who has just received the puck decides on his first tick with it, not at the next multiple of `BRAIN_INTERVAL_TICKS`. `state.carrierPlan` is cleared when nobody carries.
- Produces (`contests/board-battle.ts`): a carried puck with the carrier behind the net (`|rx| > 27.43`, `|y| < 4`) starts no board battle unless an opponent is within 1.2 m of the carrier.

- [ ] **Step 1: Write the failing tests**

```ts
// options.test.ts. `decisions(st, d, n)` runs decideCarrier for seeds 1..n and returns the Decisions.
const breakaway = (x: number): GameState => {
  const st = stateWith({ carrier: 'home', puckX: x, carrierSlot: 'C' });
  for (const s of st.skaters) { if (s.side === 'away') s.pos = { x: x - 6 - Math.abs(s.pos.y), y: s.pos.y }; else if (s.id !== 'home-C') s.pos.x = x - 8; }
  place(st, 'home:LD', x - 14, 6); place(st, 'home:RD', x - 14, -6); return st;
};
it('a breakaway never passes backward, never dumps and never just protects: 2,000 seeds at three spots', () => {
  for (const x of [3, 12, 21]) { const st = breakaway(x); expect(readSituation(st, skater(st, 'home', 'C')).breakaway).toBe(true);
    for (const d of decisions(st, def({}), 2000)) {
      expect(['dump', 'protect', 'rim', 'clear']).not.toContain(d.kind);
      if (d.kind === 'pass') expect(skaterById(st, d.toId).pos.x).toBeGreaterThanOrEqual(x - 0.6 - 1);
      if (d.kind === 'carry') expect(d.lane).toBe('net');
    } }
});
it('a clear path to the net is taken: outside shooting range he carries at the net at least 95% of the time', () => {
  const ds = decisions(breakaway(3), def({}), 2000); expect(ds.filter((d) => d.kind === 'carry' && d.lane === 'net').length / 2000).toBeGreaterThanOrEqual(0.95);
});
it('a 2-on-1 passes only across or ahead', () => {
  const st = breakaway(10); place(st, 'home:LW', 10.5, 7); place(st, 'away:LD', 17, 2);
  expect(readSituation(st, skater(st, 'home', 'C')).oddMan).toBe(true);
  const ds = decisions(st, def({}), 2000); expect(ds.some((d) => d.kind === 'pass' && d.toId === 'home-LW')).toBe(true);
  for (const d of ds) if (d.kind === 'pass') expect(d.toId).toBe('home-LW');
});
it('under pressure down low he protects, cycles or shoots: never a throw to the point', () => {
  const st = stateWith({ carrier: 'home', puckX: 24, puckY: 10, carrierSlot: 'LW' }); place(st, 'away:LD', 24.4, 9.2); place(st, 'home:LD', 9.1, 8.5); place(st, 'home:RD', 9.1, -4);
  for (const d of decisions(st, def({}), 2000)) { expect(['protect', 'rim', 'shoot', 'pass', 'carry']).toContain(d.kind); if (d.kind === 'pass') expect(['home-LD', 'home-RD']).not.toContain(d.toId); }
});
it('behind the net he holds it, passes out front or wraps: all three happen, and he is not sent straight back out', () => {
  const st = stateWith({ carrier: 'home', puckX: 28.9, puckY: 1, carrierSlot: 'C' }); place(st, 'home:LW', 22, 1); place(st, 'away:LD', 26, 0.5);
  const ds = decisions(st, def({}), 2000); const share = (f: (d: Decision) => boolean): number => ds.filter(f).length / 2000;
  expect(share((d) => d.kind === 'carry' && d.lane === 'hold')).toBeGreaterThan(0.15);
  expect(share((d) => d.kind === 'pass')).toBeGreaterThan(0.10);
  expect(share((d) => d.kind === 'carry' && d.lane === 'wrap')).toBeGreaterThan(0.03);
});
it('a shadowed lane is tried less: a defender\'s stick in the lane at least halves the passes into it', () => {
  const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 }); place(st, 'home:C', 22, 0); for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 5, y: s.pos.y };
  const open = decisions(st, playmaker, 2000).filter((d) => d.kind === 'pass' && d.toId === 'home-C').length;
  place(st, 'away:C', 20.2, 5.4);                                                                        // 0.5 m off the lane
  const shadowed = decisions(st, playmaker, 2000).filter((d) => d.kind === 'pass' && d.toId === 'home-C').length;
  expect(open).toBeGreaterThan(200); expect(shadowed).toBeLessThan(open * 0.5); expect(shadowed).toBeGreaterThan(0);
});
it('a smart player takes the best option more often than a limited one, who sometimes forces it', () => {
  const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 }); /* one clearly best pass, one covered */
  const best = (d: PlayerDef): number => decisions(st, d, 2000).filter((x) => x.kind === 'pass' && x.toId === 'home-C').length / 2000;
  expect(best(def({ iq: 95, vision: 95, poise: 95 }))).toBeGreaterThan(best(def({ iq: 35, vision: 35, poise: 35 })) + 0.1);
});
it('threat grows toward the net: own zone under neutral zone under the point under the slot', () => {
  expect(threat(-20, 0)).toBeLessThan(threat(0, 0)); expect(threat(0, 0)).toBeLessThan(threat(10, 8)); expect(threat(10, 8)).toBeLessThan(threat(22, 0)); expect(threat(22, 0)).toBeLessThan(0.25);
});
it('valuing the options costs under 0.15 ms a decision', () => {
  const st = stateWith({ carrier: 'home', puckX: 18, puckY: 10 }); const out: Option[] = []; const t = performance.now();
  for (let i = 0; i < 20_000; i++) listOptions(st, sniper, defs, tactics.home, out);
  expect((performance.now() - t) / 20_000).toBeLessThan(0.15);
});

// play.test.ts: new counters 'breakawayBackPasses' (a pass whose passer had clearPathToNet on the tick before, to a receiver over 1 m behind him),
// 'carrierDecisions' / 'carrierFlips' (brain ticks; those where carrierPlan.kind or lane changed from the tick before with the same carrier).
it('A3: no breakaway pass backward in three games', () => { expect(counters().breakawayBackPasses).toBe(0); });
it('A3: the carrier keeps his mind: under 35% of his decisions change what he is doing', () => { expect(counters().carrierFlips / counters().carrierDecisions).toBeLessThan(0.35); });
it('A2/A3: behind the net is used: at least 8 possessions there, 2 passes out front and 0.3 wraparounds a game', () => {
  expect(m().behindNetPossessionsPerGame).toBeGreaterThanOrEqual(8); expect(m().passesOutFrontPerGame).toBeGreaterThanOrEqual(2); expect(m().wrapAttemptsPerGame).toBeGreaterThanOrEqual(0.3);
});
```
  The existing `brain.test.ts` tests stay, with two rewrites: `'vision changes which lane he picks, not how often he passes'` becomes `expect(Math.abs(rate('pass', def({ vision: 95 }), slotState) - rate('pass', def({ vision: 20 }), slotState))).toBeLessThan(0.15)`; `'no option is ever certain'` stays as written (an ordinary state, no rule above applies).

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** A wraparound is a `carry` lane `wrap` followed, on arrival within 1.0 m of the post, by a `shoot` (the shot option is valued there from how far the goalie is from that post).
- [ ] **Step 4: Run all checks, the robustness file, and `npm run typecheck` (the debug app's event descriptions must accept `rim` and `clear`).**
- [ ] **Step 5: Re-pin the golden file.** Reason: the carrier values his options; breakaways attack the net; play behind the net.
- [ ] **Step 6: Commit** `feat: the carrier weighs every option by what it gains and what it risks`. Meaning changes: `pass.kind` and `release.kind` can be `rim` or `clear` (a clear was a `dump` before); a `dump` is now only a dump-in.

---

### Task 6: A3 Passes that can be received, the puck on the blade, left and right

**Files:**
- Create: `packages/engine/src/blade.ts`, `packages/engine/src/passing.ts`, `packages/engine/test/blade.test.ts`, `packages/engine/test/passing.test.ts`
- Modify: `packages/engine/src/actions.ts` (`executePass`, `tryIntercept`), `options.ts` (pass options come from `planPass`), `game.ts` (`carryPuck`, `tryPickup`), `goalie.ts` (`savePose`), `job-targets.ts` (`receive`), `contests/poke-check.ts` (distances from the puck), `types.ts`, `validate.ts`, `roster-gen.ts`, `tuning.ts`, `index.ts`, `test/golden.ts` (`hashTeam` adds `catches`), `test/interface.test.ts` (export list), `test/measures.ts`, `test/play.test.ts`, `apps/debug/src/events.test.ts` (typed `pass` literals gain `hand`)

**Interfaces:**
- Consumes: `laneWidth` (`lanes.ts`); `listOptions` (Task 5); `PlayerDef.shoots`; `interceptChance`; `canReceivePass`; `SkaterPlan.job`.
- Produces (`types.ts`): `PlayerDef.catches?: 'L' | 'R'` (goalies; default `'L'`, today's behaviour). `EventDetails.pass` gains `hand: PassHand | null` (null for `dump`, `rim`, `clear`); `export type PassHand = 'forehand' | 'backhand' | 'behind'`. `pendingPass` gains `aim: Vec2` and `bobbled: boolean`.
- Produces (`blade.ts`):

```ts
/** +1 when the blade is on his left (shoots 'L'), -1 on his right. */
export function handSign(shoots: 'L' | 'R'): 1 | -1;
/** Where his stick blade is: TUNING.blade.forward (0.9 m) ahead of his centre along his facing and TUNING.blade.side (0.4 m) to his shooting side. Writes `out`. */
export function bladePos(pos: Vec2, facing: number, shoots: 'L' | 'R', out: Vec2): Vec2;
/**
 * How he has to play a puck toward `to`: with phi the angle from his facing to it, positive toward his blade side,
 * forehand for -110 to +40 degrees, backhand for +40 to +140, behind for the rest.
 */
export function handFor(pos: Vec2, facing: number, shoots: 'L' | 'R', to: Vec2): PassHand;
export const BLADE: { forward: number; side: number }; // exported from index.ts for the viewer
```
- Produces (`passing.ts`):

```ts
export type PassPlan = { toId: string; aim: Vec2; speed: number; hand: PassHand; arriveSeconds: number; arriveSpeed: number; lane: number; chance: number };
/**
 * The pass from `from` to `to`, or null when it is not an option: the receiver cannot take a pass (canReceivePass), it is out of
 * range for the hand (forehand TUNING.brain.passRange; backhand 15 m; behind 8 m), an opponent can reach the lane before the puck
 * (his distance to the path less TUNING.pass.stickReach 1.2 m, over 4 m/s, is under the puck's time to that point), or it would
 * arrive faster than TUNING.pass.maxReceiveSpeed (16 m/s).
 * Aim: the receiver's blade where he will be when it arrives. A point man (job pointStrong / pointWeak, or a defenceman within
 * 3 m of the offensive blue line) is aimed at no nearer the line than TUNING.pass.pointInside (1.5 m).
 * Weight: speed = clamp(8 + 0.9 * distance, 10, TUNING.pass.speed for his passing), times 0.75 backhand, 0.6 behind.
 */
export function planPass(state: GameState, from: SkaterState, to: SkaterState, defs: Map<string, PlayerDef>, out: PassPlan): PassPlan | null;
/** Chance the receiver handles it: 0.97, less 0.02 per m/s over 12, less 0.15 arriving from behind him (over 120 degrees off his facing), plus 0.002 per point of puckHandling over 70; clamped to [0.03, 0.97]. */
export function receiveChance(receiver: PlayerDef, arriveSpeed: number, fromBehind: boolean): number;
/** Interception chance for an opponent whose stick blade is within TUNING.pass.stickLane (0.75 m) of the path: interceptChance * TUNING.pass.stickFactor (1.5), clamped to [0.03, 0.97]. A body within interceptRange but no stick in the lane keeps interceptChance. */
export function stickInterceptChance(d: PlayerDef, speed: number): number;
```
  `executePass(state, fromId, toId, defs, rng, out)` keeps its signature and builds on `planPass` (falling back to a forehand plan when it returns null, so a forced pass is still thrown); direction error is multiplied by 1.6 (backhand) or 2.2 (behind).
- Produces (`game.ts`): `carryPuck` puts the puck at `bladePos` (then `clipToNets` and the boards, as today); `CARRY_REACH` goes. `tryPickup`: a loose puck is taken by the nearest eligible skater whose blade is within `TUNING.blade.pickupReach` (0.75 m) of it, or whose centre is within 0.45 m (in his feet); a pass's receiver takes it when it came within `pickupReach` of his blade this tick, then one draw against `receiveChance`: on a miss it bobbles off his stick (2 to 4 m/s, turned up to 1 rad) and `pendingPass.bobbled` is set (no second draw).
- Produces (`job-targets.ts`): `receive`'s target is `pendingPass.aim`, moved along the puck's path so that he meets it; a point man never targets a spot nearer the blue line than 0.8 m and stays between the puck and the line.
- Produces (`goalie.ts`): `savePose` reads the goalie's `catches`: a high save on his catching side is `glove`, on the other `blocker`.
- Produces (`roster-gen.ts`): goalies get `catches`, `'L'` for 88% and `'R'` for 12%, drawn from a stream of its own (`createRng(seed + 0.25)`) so no other roster value changes. `validate.ts`: `catches`, when present, must be `'L'` or `'R'` (`bad-player`).
- Produces (`contests/poke-check.ts`): the trigger and the reach limit measure from the checker to the puck (on the blade), not to the carrier's centre.

- [ ] **Step 1: Write the failing tests**

```ts
// blade.test.ts
it('left is counter-clockwise: facing +x, a left shot\'s blade is at +y and a right shot\'s at -y', () => {
  const o = { x: 0, y: 0 };
  expect(bladePos({ x: 0, y: 0 }, 0, 'L', o).y).toBeCloseTo(0.4, 9); expect(o.x).toBeCloseTo(0.9, 9);
  expect(bladePos({ x: 0, y: 0 }, 0, 'R', o).y).toBeCloseTo(-0.4, 9);
  expect(bladePos({ x: 0, y: 0 }, Math.PI, 'L', o).y).toBeCloseTo(-0.4, 9);                               // facing -x, his left is -y
});
it('the same convention everywhere: the left winger lines up on his centre\'s left, and a left-catching goalie gloves on his left', () => {
  const lw = faceoffPosition({ x: 0, y: 0 }, 'LW', 1), c = faceoffPosition({ x: 0, y: 0 }, 'C', 1); expect(lw.y).toBeGreaterThan(c.y);
  expect(poseFor('L', { netEnd: -1, dy: +0.5, z: 0.9 })).toBe('glove'); expect(poseFor('L', { netEnd: -1, dy: -0.5, z: 0.9 })).toBe('blocker');
  expect(poseFor('R', { netEnd: -1, dy: +0.5, z: 0.9 })).toBe('blocker'); expect(poseFor('L', { netEnd: 1, dy: -0.5, z: 0.9 })).toBe('glove');
});
it('forehand, backhand, behind', () => {
  const at0 = { x: 0, y: 0 };
  expect(handFor(at0, 0, 'L', { x: 10, y: -5 })).toBe('forehand'); expect(handFor(at0, 0, 'L', { x: 0, y: 10 })).toBe('backhand');
  expect(handFor(at0, 0, 'L', { x: -10, y: 0 })).toBe('behind'); expect(handFor(at0, 0, 'R', { x: 0, y: 10 })).toBe('forehand');
});

// passing.test.ts
it('a point pass is aimed at least 1.5 m inside the line and stays in: 500 seeds, 95% reach the defenceman in the zone', () => {
  let kept = 0;
  for (let seed = 1; seed <= 500; seed++) { const h = pointPass(seed);      // passer low on the wall at (22, 11), nobody near; LD holding (8.2, 8.5); steps until someone carries or 3 s
    expect(h.aim.x).toBeGreaterThanOrEqual(7.62 + 1.5 - 1e-9); if (h.minPuckX > 7.57 && h.carrier === 'home-LD') kept++; }
  expect(kept / 500).toBeGreaterThanOrEqual(0.95);
});
it('a pass he cannot make is not an option: a lane a defender can close, a 20 m backhand, a 12 m pass behind him', () => {
  const out = {} as PassPlan; const st = stateWith({ carrier: 'home', puckX: 0 }); const from = skater(st, 'home', 'RW');
  place(st, 'home:C', 12, 0); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).not.toBeNull();
  place(st, 'away:C', 6, 0.3); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).toBeNull();
  place(st, 'away:C', -20, 0); place(st, 'home:C', -12, 0); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).toBeNull();   // 12 m straight behind
});
it('backhand and behind-the-back passes are slower and wilder', () => {
  expect(passMiss('backhand')).toBeGreaterThan(passMiss('forehand') * 1.3); expect(passMiss('behind')).toBeGreaterThan(passMiss('backhand') * 1.2);
  expect(passSpeed('backhand')).toBeLessThan(passSpeed('forehand') * 0.8);
});
it('the right weight: a pass arrives at 6 to 16 m/s whatever its length', () => { for (const d of [4, 10, 20, 30]) { const p = planAt(d)!; expect(p.arriveSpeed).toBeGreaterThan(6); expect(p.arriveSpeed).toBeLessThanOrEqual(16); } });
it('receiving is never certain and never hopeless', () => {
  expect(receiveChance(def({ puckHandling: 100 }), 8, false)).toBe(0.97); expect(receiveChance(def({ puckHandling: 30 }), 16, true)).toBeGreaterThan(0.5); expect(receiveChance(def({ puckHandling: 1 }), 40, true)).toBe(0.03);
});
it('a stick in the lane picks off or deflects more passes than a body near it, inside the clamps', () => {
  const stick = interceptShareWith({ bladeOffLane: 0.3 }, 2000), body = interceptShareWith({ bladeOffLane: 1.5, bodyOffLane: 0.85 }, 2000);
  expect(stick).toBeGreaterThan(body * 1.3); expect(stick).toBeLessThanOrEqual(0.97); expect(body).toBeGreaterThanOrEqual(0.03);
  expect(stickInterceptChance(def({ stickChecking: 100, defensivePositioning: 100 }), 12)).toBeLessThanOrEqual(0.97);
});

// play.test.ts: new counters 'carryTicks' / 'carryWrongSide' (live ticks with a carrier; those where cross(facing, puck - pos) * handSign < 0), 'pickupSnapMax' (largest puck move on a tick carrierId became non-null).
it('A3: the carried puck is on the shooting side in over 99% of carrying ticks', () => { expect(counters().carryWrongSide / counters().carryTicks).toBeLessThan(0.01); });
it('A3: point passes stay in: over 90% kept (was 48%) and over 75% completed (was 37%)', () => { expect(m().pointPassKeptShare).toBeGreaterThan(0.90); expect(m().pointPassCompletion).toBeGreaterThan(0.75); });
it('A3: passes are completed 75% to 92% of the time (was 86.5%)', () => { expect(m().passCompletion).toBeGreaterThan(0.75); expect(m().passCompletion).toBeLessThan(0.92); });
it('A3: a pickup moves the puck at most 1.2 m', () => { expect(counters().pickupSnapMax).toBeLessThanOrEqual(1.2); });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `TUNING.blade = { forward: 0.9, side: 0.4, pickupReach: 0.75 }`; `TUNING.pass` gains `stickReach: 1.2, stickLane: 0.75, stickFactor: 1.5, maxReceiveSpeed: 16, pointInside: 1.5, backhand: { speed: 0.75, error: 1.6, range: 15 }, behind: { speed: 0.6, error: 2.2, range: 8 }`. `tryIntercept` gives each opponent one try, with `stickInterceptChance` when his blade is in the lane, `interceptChance` when only his body is.
- [ ] **Step 4: Run all checks and the robustness file.**
- [ ] **Step 5: Re-pin the golden file.** Reason: the puck is carried on the blade; passes are aimed, weighted and can be bobbled; goalies have a catching hand.
- [ ] **Step 6: Commit** `feat: passes the receiver can take, the puck on the stick blade, one left and right`. Meaning changes: the carried puck is at the blade (0.9 m ahead, 0.4 m to the shooting side), not 0.6 m straight ahead; a `glove` save is on the goalie's `catches` side; a pickup needs the blade within 0.75 m.

---

### Task 7: A4 Attempts: point shots, one-timers, blocks at the blocker, misses that stay in play

**Files:**
- Create: `packages/engine/src/shots.ts` (takes `tryBlock` and `trackShot` out of `goalie.ts`), `packages/engine/test/shots.test.ts`
- Modify: `packages/engine/src/actions.ts` (`executeShot`), `options.ts` (shot value), `brain.ts`, `puck.ts`, `goalie.ts`, `game.ts`, `stats.ts`, `types.ts`, `tuning.ts`, `test/goalie.test.ts`, `test/puck.test.ts`, `test/interface.test.ts`, `test/measures.ts`, `test/play.test.ts`, `apps/debug/src/events.test.ts` (typed `release` literal gains `shotType`)

**Interfaces:**
- Consumes: `listOptions`, `Situation`, `CarrierPlan` (Task 5); `handFor`, `bladePos` (Task 6); `pendingPass`; `SkaterPlan.job === 'netFront'`; `laneWidth`; `BLOCK = TUNING.block`.
- Produces (`types.ts`):

```ts
export type ShotType = 'wrist' | 'slap' | 'oneTimer' | 'backhand' | 'wraparound';
// ShotInFlight gains: shotType: ShotType
// EventDetails.release gains: shotType: ShotType | null   (null unless kind is 'shot')
// pendingPass gains: oneTimer: boolean
export type PlayerLine = { /* existing fields */ attempts: number; missedShots: number; shotsBlocked: number };
export type TeamLine = { /* existing fields */ attempts: number; missedShots: number; shotsBlocked: number };
```
  `attempts` = `shots` + `missedShots` + `shotsBlocked`; `missedShots` counts `miss` and `post` events; `shotsBlocked` counts a team's (a player's) own attempts that were blocked. `shots` and `blocks` keep their meaning.
- Produces (`actions.ts`): `executeShot(state, shooterId, defs, rng, out, shotType?: ShotType)`. Type when not given: `wraparound` (released within 1.2 m of a post with `carrierPlan.lane === 'wrap'`), `oneTimer` (he received a pass flagged `oneTimer` at most 2 ticks ago), `slap` (11 m or more out, pressure under 0.3), `backhand` (`handFor` to the net centre is not `forehand`), else `wrist`. Effects (`TUNING.shot.types`): slap speed × 1.12, spread × 1.15; one-timer speed × 1.05, spread × 1.25; backhand speed × 0.75, spread × 1.4; wraparound speed 9 m/s along the ice at the near post.
- Produces (`options.ts`): the `shoot` option's value is `xg + (1 - xg) * TUNING.value.rebound` where `xg` is his chance to score from here and, for a shot from 11 m or more, is raised by traffic (a teammate with job `netFront` within 3 m of the net centre: + `TUNING.value.traffic`) and needs a lane (`laneWidth` from the puck to the net centre at least `TUNING.block.path`; without one the value is halved). A pass to a teammate in a scoring area (`threat` over `TUNING.value.oneTimerThreat`) across the slot line (the pass crosses `y = 0` inside `rx` 18) is flagged `oneTimer`, and its receiver's first decision values `shoot` with `TUNING.value.oneTimerBonus`.
- Produces (`shots.ts`):

```ts
/**
 * A shot in flight below BLOCK.maxZ: each defender whose body the puck's path this tick passes within BLOCK.path (0.55 m) of, more
 * than BLOCK.clearOfShooter from the shooter, gets one chance. On a block the puck is moved to the point of its path nearest him
 * (it stops at the blocker) and leaves at BLOCK.keep of its speed, turned by up to BLOCK.spread either side of straight back.
 */
export function tryBlock(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out?: GameEvent[]): boolean;
export function trackShot(state: GameState, puckEvents: PuckEvent[], out?: GameEvent[]): void; // as today
```
  `TUNING.block.path` 0.9 → 0.55 and `base` 0.25 → 0.40 (a first setting; totals are Task 14's).
- Produces (`puck.ts`): the boards' restitution falls with the speed into them: `BOARDS_RESTITUTION` (0.55) at 8 m/s or less, linearly down to 0.2 at 25 m/s or more; the speed along the boards keeps 0.9. A puck above the ice that hits the boards keeps its height and falls (no puck leaves the rink).
- Produces (`stats.ts`): fills the new record fields from `shot`, `miss`, `post` and `block` events.

- [ ] **Step 1: Write the failing tests**

```ts
// shots.test.ts
it('a blocked shot stops at the blocker: within his body radius plus 0.3 m, every time', () => {
  for (let seed = 1; seed <= 300; seed++) { const b = blockedShot(seed);          // a point shot at a defender standing 6 m out in its lane, shotBlocking 100; until the block
    if (!b.block) continue; expect(Math.hypot(b.puck.x - b.blocker.x, b.puck.y - b.blocker.y)).toBeLessThanOrEqual(bodyRadius(85) + 0.3); }
  expect(blockShare(def({ shotBlocking: 100 }), 600)).toBeLessThanOrEqual(0.97); expect(blockShare(def({ shotBlocking: 1 }), 600)).toBeGreaterThanOrEqual(0.03);
});
it('a missed shot rings round the boards and stays in play', () => {
  for (const y of [-1.9, 1.6, 2.5]) { const p = puckAt(9, 6, 0, 0); aimAt(p, { x: 27.13, y }, 35); let maxOff = 0;
    for (let t = 0; t < 45; t++) { run(p, DT); if (t > 12) maxOff = Math.max(maxOff, distToBoards(p.pos)); }
    expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(30.48); expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(12.955);
    expect(maxOff).toBeLessThan(4.5);                                             // it follows the boards; it does not come back out through the slot
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeGreaterThan(3); }
});
it('a defenceman at the point shoots when there is traffic and a lane, and holds it when there is neither', () => {
  const st = stateWith({ carrier: 'home', puckX: 9.5, puckY: 6, carrierSlot: 'LD' }); for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 20, y: -9 };
  place(st, 'home:C', 25.4, 0.2); setJob(st, 'home-C', 'netFront');
  const withTraffic = rate('shoot', def({}), st);
  place(st, 'home:C', 15, -9); setJob(st, 'home-C', 'highForward'); place(st, 'away:LD', 14, 4.5);     // nobody in front, a defender in the lane
  expect(withTraffic).toBeGreaterThan(0.12); expect(rate('shoot', def({}), st)).toBeLessThan(withTraffic * 0.4);
});
it('a pass across the slot to a man in a scoring area is one-timed more often than not', () => { expect(oneTimerShare(600)).toBeGreaterThan(0.5); expect(oneTimerShare(600)).toBeLessThanOrEqual(0.97); });
it('shot types: a slapshot is harder and wilder than a wrist shot, a backhand softer', () => {
  expect(shotSpeed('slap')).toBeGreaterThan(shotSpeed('wrist') * 1.08); expect(shotSpread('slap')).toBeGreaterThan(shotSpread('wrist')); expect(shotSpeed('backhand')).toBeLessThan(shotSpeed('wrist') * 0.8);
});

// play.test.ts
it('A4: the record keeps attempts: on goal + missed + blocked, for teams and players', () => {
  for (const r of games()) { for (const side of ['home', 'away'] as const) { const t = r.team[side]; expect(t.attempts).toBe(t.shots + t.missedShots + t.shotsBlocked); }
    expect(sum(r.players.map((p) => p.attempts))).toBe(r.team.home.attempts + r.team.away.attempts); expect(r.team.home.shotsBlocked).toBe(r.team.away.blocks); }
});
it('A4: defencemen shoot: at least 6 attempts a team a game from the defence (was 2)', () => { expect(m().defenceAttemptsPerTeam).toBeGreaterThanOrEqual(6); });
it('A4: attempts are 45 to 75 a team a game and shots on goal 22 to 40 (guard rail, not the target)', () => {
  expect(m().attemptsPerTeam).toBeGreaterThan(45); expect(m().attemptsPerTeam).toBeLessThan(75);
  const sog = sum(games().map((r) => r.team.home.shots + r.team.away.shots)) / 6; expect(sog).toBeGreaterThan(22); expect(sog).toBeLessThan(40);
});
it('A4: every release of a shot names its type', () => { for (const r of games()) for (const e of r.events) if (e.type === 'release') expect(e.detail.shotType === null).toBe(e.detail.kind !== 'shot'); });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Move `tryBlock`/`trackShot` and their tests' imports; `goalie.ts` re-exports nothing.
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Re-pin the golden file.** Reason: point shots, one-timers, shot types, blocks at the blocker, boards that hold a hard puck.
- [ ] **Step 6: Commit** `feat: more attempts: point shots through traffic, one-timers, blocks that stop at the blocker`. Meaning changes: a `block` event's `pos` is at the blocker; `release` carries `shotType`; `PlayerLine`/`TeamLine` carry attempts.

---

### Task 8: A4 Saves with an outcome, rebounds and tips

**Files:**
- Create: `packages/engine/src/rebounds.ts`, `packages/engine/src/tips.ts`, `packages/engine/test/rebounds.test.ts`, `packages/engine/test/tips.test.ts`
- Modify: `packages/engine/src/goalie.ts` (`resolveOnNet`, `saveChance`, new `faceShot`), `shots.ts`, `game.ts` (`liveTick`), `brain.ts`, `job-targets.ts` (`netFront`, `dNet` go to a rebound), `faceoff.ts` (`stopPlay` clears `lastSave`), `types.ts`, `tuning.ts`, `stats.ts`, `test/goalie.test.ts`, `test/interface.test.ts`, `test/resume.test.ts`, `test/measures.ts`, `test/play.test.ts`, `test/helpers.ts` (`detailKey` adds the save kind), `apps/debug/src/events.test.ts` (typed `save`/`goal` literals)

**Interfaces:**
- Consumes: `ShotInFlight`, `ShotType`, `tryBlock`, `trackShot` (Task 7); `bladePos` (Task 6); `PlayerDef.catches`; `SkaterPlan.job`; `recordTouch`; `stopPlay`; `G = TUNING.goalie`.
- Produces (`types.ts`):

```ts
export type SaveKind = 'held' | 'steered' | 'rebound';
/** Where the puck met the goalie: `side` metres from his centre toward his left (negative: his right), `height` metres above the ice. */
export type Crossing = { side: number; height: number };
// ShotInFlight gains: tippedBy: string | null; tipTried: string[]; rebound: boolean; screened: boolean; faced: boolean
// GameState gains: lastSave: { side: Side /* the goalie's */; tick: number; kind: SaveKind } | null
// EventDetails:
shot: { distance: number; releaseTick: number | null; speed: number; cross: Crossing; shotType: ShotType | null; tippedFrom: string | null; screened: boolean; rebound: boolean };
save: { pose: SavePose; kind: SaveKind; cross: Crossing };
goal: { distance: number; releaseTick: number | null; cross: Crossing; shotType: ShotType | null; tippedFrom: string | null; screened: boolean; rebound: boolean };
miss: { distance: number; releaseTick: number; tippedFrom: string | null };
post: { distance: number; releaseTick: number; tippedFrom: string | null };
/** New event: playerId deflected otherId's shot in front; `vel` is the puck's velocity after it. */
tip: { releaseTick: number; vel: { x: number; y: number; z: number } };
```
  After a tip the shot belongs to the tipper: `shot`, `goal`, `miss` and `post` have `playerId` = the tipper and `tippedFrom` = the shooter (who gets the first assist through the touch chain); `releaseTick` is still the shooter's release. `rebound`: released within `TUNING.rebound.windowSeconds` (3 s) of a save on that net, `state.lastSave` still set (it is cleared when the defending side carries the puck, the puck leaves the zone, or play stops).
- Produces (`goalie.ts`):

```ts
/**
 * Saves are made where the goalie is, not on the goal line. While a shot is in flight toward the net he defends and its path this
 * tick crosses his plane (x = his x) on its way to a spot inside the posts and under the bar: the puck is moved to that crossing,
 * `shot` is emitted, and saveChance decides. A save emits `save` and hands the puck to saveOutcome (rebounds.ts) from that point.
 * A goal sets shot.faced and lets the puck go on; `goal` is emitted when it crosses the goal line (resolveOnNet, 1 to 3 ticks
 * later, with no second `shot`). Returns true when it faced the shot this tick. A puck that reaches the goal line without having
 * been faced (not a shot, or released from inside his plane) is resolved by resolveOnNet as today.
 */
export function faceShot(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[]): boolean;
```
  `SaveInput` gains `tipped?: boolean` (− `G.save.tipped`, 0.9) and `recovering?: number` (0 to 1, his `poseT` over the pose length: − `G.save.recovering` 0.8 at 1). `screened` is true when the net-front contest's screen is on (as today) or an attacker stands within 0.6 m of the shot's line between 0.8 and 4 m in front of the goalie. `game.ts` calls `tryTip`, then `tryBlock`, then `faceShot`, then `stepPuck`.
- Produces (`rebounds.ts`):

```ts
export type SaveFacts = { pose: SavePose; speed: number; screened: boolean; tipped: boolean; reboundControl: number };
/** Chances of each outcome; each within [0.03, 0.97] and summing to 1. held: G.freeze[pose] less 0.004 per m/s over 25, less 0.08 screened, less 0.12 tipped; of the rest, steered: 0.35 + 0.005 * (reboundControl - 50), less 0.1 tipped. */
export function saveOutcomeChances(f: SaveFacts): Record<SaveKind, number>;
/**
 * Draws the outcome and moves the puck from the save point. held: `freeze` and a whistle, as today. steered: toward the corner on
 * the side it came to, 55 to 80 degrees off straight out, 6 to 9 m/s. rebound: within 50 degrees of straight out (wider with poor
 * rebound control), 2.5 to 6 m/s, so that it is still in front half a second later. Sets state.lastSave. Returns the kind.
 */
export function saveOutcome(state: GameState, goalieSide: Side, f: SaveFacts, cross: Crossing, rng: Rng, out: GameEvent[]): SaveKind;
```
- Produces (`tips.ts`):

```ts
/** Hand-eye for a tip: puckHandling .5, shootingAccuracy .3, iq .2. Chance: TUNING.tip.base (0.10) + TUNING.tip.perPoint (0.004) * (handEye - 50), clamped to [0.03, 0.97]. */
export function tipChance(d: PlayerDef): number;
/**
 * A shot in flight below TUNING.tip.maxZ (1.2 m), released TUNING.tip.minDistance (9 m) or more out, not yet tipped: each attacker
 * but the shooter within 4.5 m of the net centre, in front of the goal line, not down and not tied up, whose stick blade is within
 * TUNING.tip.reach (0.9 m) of the puck's path this tick gets one try (shot.tipTried). A tip moves the puck to the point of its
 * path nearest his blade, turns it by gauss * TUNING.tip.turn (0.12 rad), changes vz by gauss * TUNING.tip.lift (2.5 m/s), keeps
 * 0.85 of its speed, records his touch, sets shot.tippedBy and emits `tip`. It may now miss the net.
 */
export function tryTip(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out?: GameEvent[]): boolean;
```
- Produces (`brain.ts`, `job-targets.ts`): while `state.lastSave` is a `rebound`, the attackers' `netFront` man and the defenders' `dNet` are their sides' chasers (trigger `loosePuckMine`); an attacker who picks the puck up within 5 m of the net decides at once (Task 5's first-tick rule).

- [ ] **Step 1: Write the failing tests**

```ts
// rebounds.test.ts
it('a save is held, steered to a corner or leaves a rebound; none is certain and they sum to 1', () => {
  for (const pose of ['glove', 'blocker', 'pad', 'butterfly'] as const) for (const rc of [1, 50, 100]) {
    const c = saveOutcomeChances({ pose, speed: 32, screened: false, tipped: false, reboundControl: rc });
    for (const k of ['held', 'steered', 'rebound'] as const) { expect(c[k]).toBeGreaterThanOrEqual(0.03); expect(c[k]).toBeLessThanOrEqual(0.97); }
    expect(c.held + c.steered + c.rebound).toBeCloseTo(1, 9); }
});
it('rebound control matters: a 90 leaves at least 15 points fewer rebounds than a 30; a hard, screened, tipped shot leaves more', () => {
  const rb = (o: Partial<SaveFacts>): number => saveOutcomeChances({ pose: 'pad', speed: 32, screened: false, tipped: false, reboundControl: 60, ...o }).rebound;
  expect(rb({ reboundControl: 30 }) - rb({ reboundControl: 90 })).toBeGreaterThan(0.15); expect(rb({ speed: 40, screened: true, tipped: true })).toBeGreaterThan(rb({}) + 0.1);
});
it('a rebound is still in front half a second later; a steered puck is in the corner a second later', () => {
  const where = outcomesOf(2000);                       // each: kind, puck position 0.5 s and 1 s after the save with nobody near
  const front = where.filter((w) => w.kind === 'rebound'), corner = where.filter((w) => w.kind === 'steered');
  expect(shareOf(front, (w) => Math.hypot(27.13 - w.at05.x, w.at05.y) < 4 && w.at05.x < 27.13)).toBeGreaterThan(0.9);
  expect(shareOf(corner, (w) => Math.abs(w.at1.y) > 5 && Math.hypot(27.13 - w.at1.x, w.at1.y) > 5)).toBeGreaterThan(0.85);
});
it('the save is made at the goalie: the puck stops at his plane and comes out from there, never from behind him', () => {
  for (let seed = 1; seed <= 300; seed++) { const s = savedShot(seed);     // a shot from the slot, stepped to its save
    expect(Math.abs(s.saveEvent.pos.x - s.goalie.x)).toBeLessThan(0.05); expect(s.puckStepOnSaveTick).toBeLessThanOrEqual(s.shotSpeed * DT + 0.05);
    expect(s.saveEvent.detail.cross.height).toBeGreaterThanOrEqual(0); expect(Math.abs(s.saveEvent.detail.cross.side)).toBeLessThan(1.6); }
});
it('the crossing point says which hand: a left-catching goalie\'s glove saves are on his left', () => {
  for (const s of manySaves(600, 'L')) if (s.detail.pose === 'glove') expect(s.detail.cross.side).toBeGreaterThan(0);
  for (const s of manySaves(600, 'R')) if (s.detail.pose === 'glove') expect(s.detail.cross.side).toBeLessThan(0);
});
// tips.test.ts
it('a net-front man with his stick in the lane tips 5% to 40% of point shots; hand-eye helps', () => {
  expect(tipShare(def({}), 2000)).toBeGreaterThan(0.05); expect(tipShare(def({}), 2000)).toBeLessThan(0.40);
  expect(tipShare(def({ puckHandling: 95, shootingAccuracy: 95, iq: 95 }), 2000)).toBeGreaterThan(tipShare(def({ puckHandling: 40, shootingAccuracy: 40, iq: 40 }), 2000) * 1.5);
  expect(tipChance(def({ puckHandling: 100, shootingAccuracy: 100, iq: 100 }))).toBeLessThanOrEqual(0.97);
});
it('a tip changes the path late, is harder to save, and can miss the net', () => {
  const t = tippedShots(3000), plain = untippedShots(3000);              // the same point shot, with and without a tip
  expect(shareOf(t, (s) => s.turnedRad > 0.017)).toBeGreaterThan(0.8);
  expect(shareOf(t, (s) => s.end === 'miss' || s.end === 'post')).toBeGreaterThan(0.05);
  const goalRate = (xs: typeof t): number => xs.filter((s) => s.end === 'goal').length / xs.filter((s) => s.end === 'goal' || s.end === 'save').length;
  expect(goalRate(t)).toBeGreaterThan(goalRate(plain) * 1.3);
});
it('a tipped goal is the tipper\'s, the shooter has the first assist, and it points back to the shooter\'s release', () => {
  const g = tippedGoal(); expect(g.playerId).toBe('home-C'); expect(g.detail.tippedFrom).toBe('home-LD'); expect(g.assistIds[0]).toBe('home-LD');
});

// play.test.ts
it('A4: every shot on goal is followed by exactly one save or goal by the same goalie, and no save or goal comes without its shot', () => {
  for (const r of games()) { let open: GameEvent | null = null;
    for (const e of r.events) { if (e.type === 'shot') { expect(open).toBeNull(); open = e; } else if (e.type === 'save' || e.type === 'goal') { expect(open).not.toBeNull(); expect(e.tick - open!.tick).toBeLessThanOrEqual(4); open = null; } }
    expect(open).toBeNull(); }
});
it('A4: rebounds exist: 15% to 50% of saves leave one, and there are at least 6 second chances a game (was 2.3)', () => {
  const saves = games().flatMap((r) => r.events.filter((e) => e.type === 'save')); const rb = saves.filter((e) => e.type === 'save' && e.detail.kind === 'rebound').length / saves.length;
  expect(rb).toBeGreaterThan(0.15); expect(rb).toBeLessThan(0.50); expect(m().reboundChancesPerGame).toBeGreaterThanOrEqual(6);
});
it('A4: tips happen: at least 2 a game, some on goal', () => { const tips = sum(games().map((r) => count(r, 'tip'))) / 3; expect(tips).toBeGreaterThanOrEqual(2); });

// resume.test.ts: one more case
['with a rebound loose in front', (s) => s.lastSave !== null && s.lastSave.kind === 'rebound' && s.carrierId === null, 10_000],
```
  Update `test/interface.test.ts`: the shooter of an outcome event is `e.detail.tippedFrom ?? e.playerId` (for `block`, `e.otherId`).

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `TUNING.rebound = { windowSeconds: 3 }`, `TUNING.tip = { base: 0.10, perPoint: 0.004, reach: 0.9, maxZ: 1.2, minDistance: 9, turn: 0.12, lift: 2.5, keep: 0.85 }`; `TUNING.goalie.save` gains `tipped: 0.9, recovering: 0.8`; the old rebound numbers (`reboundSpeed`, `reboundPoseSpeed`, `reboundSpread`, `blockerTurn`, `padTurn`, `reboundMaxAngle`) move under `TUNING.goalie.rebound` with the new ranges.
- [ ] **Step 4: Run all checks and the robustness file.**
- [ ] **Step 5: Re-pin the golden file.** Reason: saves are made at the goalie and have an outcome; rebounds and tips.
- [ ] **Step 6: Commit** `feat: saves are held, steered or leave a rebound; tips in front`. Meaning changes: `shot` and `save` are emitted where the puck meets the goalie (their `pos` is at his plane, not on the goal line); a `goal` follows its `shot` by up to 4 ticks instead of sharing its tick; after a tip, `playerId` of `shot`/`goal`/`miss`/`post` is the tipper; new event type `tip`.

---

### Task 9: A5 Battles the winner wins

**Files:**
- Modify: `packages/engine/src/contests/board-battle.ts`, `contests/hit.ts`, `contests/poke-check.ts`, `contests/net-front.ts`, `contests/core.ts` (`ContestResult`, `applyResult`, `contestEndEvent`), `team-play.ts` (`supportTarget`), `options.ts` (a carrier shielding in a board battle), `game.ts` (stagger), `types.ts`, `tuning.ts`, `faceoff.ts` (`stopPlay`), `test/contests/*.test.ts`, `test/measures.ts`, `test/play.test.ts`, `test/helpers.ts` (`stateWith`), `apps/debug/src/events.test.ts` (typed `hit`/`battle` literals)

**Interfaces:**
- Consumes: `executePass`-style release (`actions.ts`), `bladePos`, `planOf`, `Contest`, `ContestResult`, `winProb`, `boardsNormal`, `movementOf(def, 1).mass`.
- Produces (`types.ts`):

```ts
export type HitDegree = 'bump' | 'stagger' | 'knockdown';
// EventDetails:
hit: { result: 'landed' | 'absorbed' | 'bounced'; contestId: number; /** How hard a landed hit was; null otherwise. */ degree: HitDegree | null };
battle: { how: 'protect' | 'pinned' | 'stick' | 'support' | 'scramble' | 'netFront'; contestId: number; /** Each side's supporting player in a board battle (null: none, or not a board battle). */ winnerSupportId: string | null; loserSupportId: string | null };
contestEnd: { contestId: number; kind: ContestKind; result: ContestOutcome; winnerId: string | null; puck: 'toWinner' | 'loose' | 'unchanged'; /** Who has or is being passed the puck as a result (null: nobody). */ puckTo: string | null };
// ContestData.hit gains: degree: HitDegree | null
// GameState gains: staggered: { id: string; untilTick: number }[]
```
- Produces (`contests/core.ts`): `ContestResult` gains `puckTo?: string | null`. For a board battle `winnerId` is always the man who won it.
- Produces (`contests/board-battle.ts`):
  - A clean win (`T.cleanShare`, 0.6 → 0.75) ends `toWinner` with the puck on the **winner's** stick, whatever support he had. Only when the win is by support (`how === 'support'`: his side had a supporter and the other did not) does the winner move it to his supporter: a real pass from the spot (6 to 8 m/s, `pass` and `release` events, `pendingPass` to the supporter), `puck: 'loose'`, `puckTo` the supporter.
  - During `resolve` the winner is steered 1.2 m off the boards (he comes away with it); the loser stays.
  - A carrier in `protect` holds the puck for that half second: `listOptions` returns only `protect` while he is `roles.carrier` of a board battle in `protect`.
  - Supporters stand on their own side: `supportTarget(state, side)` and the battle's own steering put a supporter `T.supportOff` (2 m) from the spot toward **his own net** (the unit vector from the spot to the centre of the net his side defends), kept at least 1.2 m off the boards.
- Produces (`contests/net-front.ts`): the defender's target is on the segment from the attacker to the net centre, the sum of their radii from the attacker (as today), and the round is only drawn while he is within 0.8 m of that segment; `faceTarget` the attacker.
- Produces (`contests/hit.ts`):

```ts
/**
 * How hard a landed hit is. x = (closing - 6) * 0.25 + (hitterMass - targetMass) / 8 - (target balance - 70) / 20 - (sawIt ? 0.8 : 0) + margin
 * (margin 0..1: how clearly the roll was won). knockdown with chance clamp(logistic(x - 0.2), 0.03, 0.97); otherwise stagger with
 * chance clamp(logistic(x + 1.2), 0.03, 0.97); otherwise a bump. `sawIt`: the hitter is within 100 degrees of the target's facing at contact.
 */
export function hitDegreeChances(closing: number, hitterMass: number, targetMass: number, targetBalance: number, sawIt: boolean, margin: number): { knockdown: number; stagger: number };
```
  Knockdown: as a landed hit today. Stagger: he keeps his feet, his velocity is cut to 0.6, he is added to `state.staggered` for 0.5 s (`speedCap` at most 0.4, applied in `game.ts`), and a carrier loses the puck with chance 0.5. Bump: a nudge (0.3 of the push); a carrier loses the puck with chance 0.15. The constants live in `TUNING.hit.degree`.
- Produces (`contests/poke-check.ts`): the checker reaches from a stick length: while reaching, his target is the point `T.standOff` (1.5 m) from the puck on his side of it, facing the puck; the poke resolves only with him between 0.9 and `T.stickReach` (1.9 m, measured to the puck) from it, else `outOfReach`. On `take` the puck goes to his blade.

- [ ] **Step 1: Write the failing tests**

```ts
// board-battle.test.ts
it('the man who wins comes away with the puck: on every clean win without a win by support, he is the carrier', () => {
  let clean = 0;
  for (let seed = 1; seed <= 400; seed++) { const b = runBattleSeeded(even, even, { seed, supportFor: seed % 2 ? undefined : 'both' });
    if (b.end.detail.puck !== 'toWinner') continue; clean++;
    expect(b.carrierAfter).toBe(b.battle.playerId); expect(b.end.detail.winnerId).toBe(b.battle.playerId); expect(b.end.detail.puckTo).toBe(b.battle.playerId); }
  expect(clean).toBeGreaterThan(400 * 0.6);
});
it('won by support, the winner passes it to his supporter: a real pass that arrives', () => {
  let n = 0, arrived = 0;
  for (let seed = 1; seed <= 400; seed++) { const b = runBattleSeeded(even, even, { seed, supportFor: 'a' }); if (b.battle.detail.how !== 'support' || b.end.detail.puckTo === b.battle.playerId || b.end.detail.puckTo === null) continue;
    n++; expect(b.end.detail.puckTo).toBe(b.battle.detail.winnerSupportId); expect(b.events.some((e) => e.type === 'pass' && e.playerId === b.battle.playerId && e.otherId === b.end.detail.puckTo)).toBe(true);
    if (b.carrierWithin1s === b.end.detail.puckTo) arrived++; }
  expect(n).toBeGreaterThan(50); expect(arrived / n).toBeGreaterThan(0.85);
});
it('supporters stand on their own side of the scrum, at least 2.5 m apart', () => {
  const b = battleWithBothSupports();                        // side boards at (5, 12.4); home defends -x
  expect(b.homeSupportTarget.x).toBeLessThan(5); expect(b.awaySupportTarget.x).toBeGreaterThan(5);
  expect(Math.hypot(b.homeSupportTarget.x - b.awaySupportTarget.x, b.homeSupportTarget.y - b.awaySupportTarget.y)).toBeGreaterThan(2.5);
});
it('the winner comes off the boards with it: half a second after a clean win he is over 1 m from them in 80% of battles', () => { expect(winnerOffBoardsShare(300)).toBeGreaterThan(0.8); });
it('a carrier shielding the puck along the boards does not give it up for nothing: under 5% of protects end "released"', () => { expect(releasedShare(600)).toBeLessThan(0.05); });
// hit.test.ts
it('a landed hit has degrees, and a much heavier man who sees it coming is rarely put down', () => {
  const k = (o: { hitterKg: number; targetKg: number; sawIt: boolean }): Record<string, number> => landedDegrees(o, 2000);   // shares of bump / stagger / knockdown among landed hits, closing 8 m/s
  const heavy = k({ hitterKg: 82, targetKg: 100, sawIt: true }), light = k({ hitterKg: 100, targetKg: 82, sawIt: false }), level = k({ hitterKg: 90, targetKg: 90, sawIt: false });
  expect(heavy.knockdown).toBeLessThan(0.20); expect(heavy.knockdown).toBeGreaterThanOrEqual(0.03);
  expect(light.knockdown).toBeGreaterThan(0.75); expect(light.knockdown).toBeLessThanOrEqual(0.97);
  for (const d of ['bump', 'stagger', 'knockdown']) expect(level[d]).toBeGreaterThan(0.03);
  expect(k({ hitterKg: 90, targetKg: 90, sawIt: true }).knockdown).toBeLessThan(level.knockdown - 0.1);
});
it('a staggered man keeps his feet and loses a step', () => { const s = staggerHit(); expect(s.target.downT).toBe(0); expect(s.speedAfter).toBeLessThan(s.speedBefore * 0.7); expect(s.capForHalfSecond).toBeLessThanOrEqual(0.4); });
// poke-check.test.ts
it('the checker reaches from a stick length: at the poke he is 0.9 to 1.9 m from the puck', () => {
  for (let seed = 1; seed <= 300; seed++) { const p = pokeSeeded(seed); if (p.result === 'outOfReach' || p.result === 'released') continue; expect(p.checkerToPuck).toBeGreaterThanOrEqual(0.9); expect(p.checkerToPuck).toBeLessThanOrEqual(1.9 + 1e-9); }
});
// net-front.test.ts
it('the defender plays between the attacker and the net: within 0.6 m of that line for 85% of the battle after its first half second', () => { expect(netFrontBetweenShare(60)).toBeGreaterThan(0.85); });

// play.test.ts
it('A5: the battle winner comes away with it in over 60% of decided battles (was 23%)', () => { expect(m().battleWinnerCameAwayShare).toBeGreaterThan(0.60); });
it('A5: when a battle gives the puck to someone, it is the winner in over 85% (was 4%)', () => { expect(m().battleToWinnerIsWinnerShare).toBeGreaterThan(0.85); });
it('A5: fewer battles end with nobody winning: under 14 a game (was 36)', () => { expect(m().battlesNoWinnerPerGame).toBeLessThan(14); });
it('A5: 30% to 70% of landed hits put the man down (was 100%)', () => { expect(m().knockdownShare).toBeGreaterThan(0.30); expect(m().knockdownShare).toBeLessThan(0.70); });
it('no teleport: on a live tick the puck never moves further than its speed allows, 1.2 m when it changes hands', () => {
  // measures.ts: puckJumpTicks now counts ticks where the move exceeds vmax * DT + 0.05, or 1.2 m on a tick carrierId became non-null (stoppages excluded).
  expect(counters().puckJumpTicks).toBe(0); expect(m().maxPuckJump).toBeLessThanOrEqual(1.2);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** If the no-teleport test finds a jump this task did not list (an intercepted pass, a blocked shot, a faceoff draw), fix that code path here: the test is the contract.
- [ ] **Step 4: Run all checks and the robustness file.**
- [ ] **Step 5: Re-pin the golden file.** Reason: battle winners come away with the puck; hit degrees; pokes from a stick length.
- [ ] **Step 6: Commit** `feat: the battle winner wins the puck; hits have degrees; pokes reach`. Meaning changes: a board battle's `contestEnd.winnerId` is the man who won it (it was whoever got the puck); `puckTo` says who got it; a win by support ends `puck: 'loose'` with a pass to the supporter; a `landed` hit no longer always knocks down (`degree`).

---

### Task 10: A5 Battling for position: engagements

How it is today: `resolveBodies` (`bodies.ts`) pushes any two overlapping bodies apart in one pass, the lighter giving more, and forgets them; the only lasting tie-up is the net-front contest's `state.tiedUpUntil` (a staged contest for one attacker at one spot, read through `isTiedUp`). This task adds the light, continuous version for any two opponents; the staged contests stay.

**Files:**
- Create: `packages/engine/src/engagements.ts`, `packages/engine/test/engagements.test.ts`
- Modify: `packages/engine/src/bodies.ts`, `game.ts` (`liveTick` order: jobs, brain, contests, **engagements**, movement), `passing.ts` (`receiveChance`), `actions.ts` (shot spread), `options.ts` (shoot value), `tips.ts`, `contests/board-battle.ts` and `contests/net-front.ts` (taking over an engagement), `faceoff.ts` (`stopPlay`), `types.ts`, `tuning.ts`, `test/resume.test.ts`, `test/measures.ts`, `test/play.test.ts`, `test/helpers.ts` (`stateWith`)

**Interfaces:**
- Consumes: `resolveBodies`'s contacts; `effective`, `winProb`, `contestRating`'s inputs (`contests/core.ts`); `steeredByContest`; `planOf(...).markId`; `movementOf(def, 1).mass` and `.radius`; `receiveChance`, `tipChance`; `state.staggered`.
- Produces (`types.ts`):

```ts
/** Two opponents battling for position (engagements.ts). Lighter than a contest: nobody is steered; both are slowed and limited. */
export type Engagement = {
  /** The pair; `a` comes first in `state.skaters`. */
  a: string; b: string;
  sinceTick: number;
  /** boxOut: near a net, one keeping the other from it; tieUp: a defender on the man he covers; ride: one of them has the puck; lean: anything else. */
  kind: 'boxOut' | 'tieUp' | 'ride' | 'lean';
  /** Who has inside position (between the other man and the net or puck they both want); null while it is even. */
  inside: string | null;
  /** How tied up each is, 0 (free) to 1 (stick and body held). */
  tieA: number; tieB: number;
  /** Who won the last draw, and the tick of the next. */
  lastWon: string | null; nextDrawTick: number;
};
// GameState gains: engagements: Engagement[]
/** New event, when an engagement that lasted 0.3 s or more ends: playerId had inside position at the end (null: nobody), otherId is the other man. */
engagement: { kind: Engagement['kind']; seconds: number; result: 'heldPosition' | 'foughtThrough' | 'spunOff' | 'released' | 'contest' | 'whistle' };
```
- Produces (`engagements.ts`):

```ts
/** 0..1: how tied up `id` is now (0 when he is in no engagement). */
export function tieOf(state: GameState, id: string): number;
export function engagementOf(state: GameState, id: string): Engagement | null;
/** Chance `a` wins a draw: winProb of (strength .35, balance .3, compete .35, with energy, form and morale as in `effective`) difference, plus mass difference / TUNING.engage.massPerPoint (4), plus TUNING.engage.insideEdge (5) for the man inside. */
export function engageChance(a: PlayerDef, sa: SkaterState, b: PlayerDef, sb: SkaterState, inside: 'a' | 'b' | null): number;
/**
 * Once per live tick after contests. Starts an engagement for two opponents in body contact (centres within their radii plus
 * TUNING.engage.contact, 0.15 m), each on the ice, standing, not leaving, not steered by a contest and in no other engagement.
 * Every TUNING.engage.drawSeconds (0.4 s) one draw: the loser's tie rises by 0.3 (at most 1), the winner's falls by 0.2 (at
 * least 0); two wins in a row take inside position. Each man's speedCap is multiplied by 1 - TUNING.engage.slow (0.5) * his tie.
 * It ends: `released` when they are more than contact + 1.0 m apart or either leaves the ice or goes down; `foughtThrough` /
 * `spunOff` when a man with tie 0.15 or less whose target is over 3 m from the other wins a draw (fought through if he is then
 * nearer the puck or the attacked net than the other, else spun off); `heldPosition` when the inside man's opponent gives up
 * (his job changes); `contest` when a staged contest takes either man; `whistle`.
 */
export function engagementTick(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out?: GameEvent[]): void;
```
- Produces (`bodies.ts`): `resolveBodies` takes the engaged pairs: an engaged pair is held at contact (overlap is still removed, but a man moving away from the other keeps only `1 - his tie` of his velocity away, so a tied-up man cannot simply skate off); pairs that are not engaged separate as today.
- Limits on a tied-up man (each still possible): `receiveChance` × `(1 - 0.6 * tie)`; shot spread × `(1 + tie)` and the `shoot` option's value × `(1 - 0.5 * tie)`; `tipChance` × `(1 - 0.6 * tie)`; his loose-puck pickup reach × `(1 - 0.5 * tie)`; every chance re-clamped to `[0.03, 0.97]`.
- Into a staged contest: when a board battle starts with an engaged man in it, the pair's inside man is its `roles.first` (the first-man edge); when a net-front battle starts on an engaged pair, the inside man has +5 in the first round. `state.tiedUpUntil` and `isTiedUp` are unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// engagements.test.ts
it('opponents who come together engage instead of bouncing apart', () => {
  const h = pairInContact(even, even);                         // home C and away LD skating into each other at the net front, 1.5 s
  expect(h.state.engagements).toHaveLength(1); expect(h.secondsInContact).toBeGreaterThan(1.0);             // today they part within 0.3 s
  const e = h.state.engagements[0]!; expect([e.a, e.b].sort()).toEqual(['away-LD', 'home-C']); expect(e.kind).toBe('boxOut');
});
it('the stronger, heavier man gets inside position more often, never always', () => {
  const strong = def({ strength: 92, balance: 88, compete: 85, weightKg: 100 }), light = def({ strength: 55, balance: 60, compete: 60, weightKg: 78 });
  const s = insideShare(strong, light, 600); expect(s).toBeGreaterThan(0.6); expect(s).toBeLessThanOrEqual(0.9);
  expect(engageChance(strong, st({}), light, st({}), 'a')).toBeLessThanOrEqual(0.9); expect(engageChance(light, st({}), strong, st({}), null)).toBeGreaterThanOrEqual(0.1);
});
it('being tied up slows him and limits him, and never to nothing', () => {
  const h = tiedUp(1);                                         // home C with tie 1
  expect(h.speedCapFactor).toBeCloseTo(0.5, 9);
  expect(receiveChanceFor(h)).toBeLessThan(receiveChance(def({}), 10, false) * 0.5); expect(receiveChanceFor(h)).toBeGreaterThanOrEqual(0.03);
  expect(tipChanceFor(h)).toBeLessThan(tipChance(def({})) * 0.5); expect(tipChanceFor(h)).toBeGreaterThanOrEqual(0.03);
  expect(shotSpreadFor(h)).toBeCloseTo(shotSpreadFor(tiedUp(0)) * 2, 6);
});
it('a tied-up man cannot simply skate away; a free one can', () => { expect(metresApartAfter(tiedUp(1), 1)).toBeLessThan(1.0); expect(metresApartAfter(tiedUp(0), 1)).toBeGreaterThan(2.5); });
it('he can fight through: with the puck arriving behind his man, a free-enough attacker gets loose within 3 s in 25% to 75% of tries', () => { const s = foughtThroughShare(even, even, 400); expect(s).toBeGreaterThan(0.25); expect(s).toBeLessThan(0.75); });
it('the puck arriving turns it into a board battle, with the inside man first in', () => { const b = engagementIntoBattle(); expect(b.endResult).toBe('contest'); expect(b.battle.roles.first).toBe(b.insideId); });
it('each skater is in at most one engagement, and none with a man a contest is steering', () => { /* every tick of one game */ });

// play.test.ts: new counters 'engagedTicks' (live ticks with at least one engagement), 'contactOver03Free' / 'contactOver03Engaged'
// (opposing pairs in contact for 10 ticks with neither steered by a contest; of those, engaged with each other on the 10th tick).
it('A5: battling is constant: some pair is engaged in over 30% of live time', () => { expect(counters().engagedTicks / counters().liveTicks).toBeGreaterThan(0.30); });
it('A5: opponents in contact for over 0.3 s are engaged, not separated, in over 80% of cases', () => { expect(counters().contactOver03Engaged / counters().contactOver03Free).toBeGreaterThan(0.80); });
it('A5: 250 to 1,500 engagements a game', () => { const n = sum(games().map((r) => count(r, 'engagement'))) / 3; expect(n).toBeGreaterThan(250); expect(n).toBeLessThan(1500); });

// resume.test.ts: one more case
['mid-engagement', (s) => s.engagements.some((e) => s.tick - e.sinceTick > 15 && e.inside !== null), 25_000],
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `TUNING.engage = { contact: 0.15, drawSeconds: 0.4, slow: 0.5, massPerPoint: 4, insideEdge: 5, tieUp: 0.3, tieDown: 0.2, weights: { strength: 0.35, balance: 0.3, compete: 0.35 } }`.
- [ ] **Step 4: Run all checks (the perf ceiling with engagements on) and the robustness file.**
- [ ] **Step 5: Re-pin the golden file.** Reason: opponents in contact engage and battle for position.
- [ ] **Step 6: Commit** `feat: players battle for position: tie-ups, box-outs, leaning`. Meaning changes: bodies in contact are no longer always pushed apart; new state `engagements`; new event type `engagement`.

---

### Task 11: A6 Team tactics

**Files:**
- Create: `packages/engine/src/tactics.ts`, `packages/engine/test/tactics.test.ts`
- Modify: `packages/engine/src/types.ts`, `validate.ts`, `roster-gen.ts`, `options.ts`, `jobs.ts`, `job-targets.ts`, `game.ts`, `index.ts`, `test/validate.test.ts`, `test/roster-gen.test.ts`, `test/interface.test.ts`, `test/golden.ts` (`hashTeam` adds the tactics), `test/measures.ts`, `test/play.test.ts`

**Interfaces:**
- Consumes: `listOptions(state, me, defs, tactics, out)`, `jobsFor`, `jobWant` (they already take `Tactics`); `Tendencies`; `TeamDef`.
- Produces (`types.ts`): the existing `Tactics` gains four optional fields, so every existing setup stays valid:

```ts
export type Tactics = {
  forecheck: 'passive' | 'balanced' | 'aggressive';
  shiftSeconds: { forwards: number; defence: number };
  /** Default 'mixed'. */ zoneEntry?: 'carry' | 'dump' | 'mixed';
  /** Default 'cycle'. */ offence?: 'cycle' | 'pointShots' | 'rush';
  /** Default 'collapse'. */ defence?: 'collapse' | 'pressure';
  /** Default 'sometimes'. */ pinch?: 'often' | 'sometimes' | 'rarely';
};
```
- Produces (`tactics.ts`):

```ts
export type ResolvedTactics = Required<Tactics>;
export const DEFAULT_TACTICS: Pick<ResolvedTactics, 'zoneEntry' | 'offence' | 'defence' | 'pinch'>;
export function resolveTactics(t: Tactics): ResolvedTactics;                       // exported from index.ts
/** What the men on the ice make of a tactic: the mean habit of `side`'s on-ice forwards (or defencemen), 0..1. */
export function lineHabit(state: GameState, side: Side, defs: Map<string, PlayerDef>, habit: keyof Tendencies, group: 'F' | 'D'): number;
/** Multipliers on option values. A tactic's factor is bent by the line: factor ** (0.5 + lineHabit for the habit it asks for), so grinders asked to carry still dump more than a skilled line. */
export function entryFactors(t: ResolvedTactics, dumpHabit: number, carryHabit: number): { carryIn: number; dump: number };  // carry: 1.25 / 0.6, mixed: 1 / 1, dump: 0.8 / 1.6 before bending
export function offenceFactors(t: ResolvedTactics): { lowCycle: number; pointPass: number; pointShot: number; rushShot: number; hold: number };  // cycle 1.3/1/0.8/1/1.2; pointShots 1/1.4/1.4/1/1; rush 0.8/0.9/1/1.3/0.8
/** The tactics that suit a roster, from its players' habits and attributes alone (no random draw). */
export function naturalTactics(players: readonly PlayerDef[], lines: Lines): Pick<ResolvedTactics, 'forecheck' | 'zoneEntry' | 'offence' | 'defence' | 'pinch'>;
```
  Effects on jobs: `offence: 'cycle'` puts `lowSupport` first in the offensive-zone list, `pointShots` puts `netFront` first and holds the point men 1 m further in, `rush` gives `dJoin` to a defenceman with `joinRush >= 0.45`. `forecheck`: aggressive sends `f2` deep as a second man on the puck, passive holds `f1` at the top of the circles (Task 4's table). `defence: 'pressure'`: `dCorner` and `dzCentre` both go at a carrier below the dots, the wingers cover their points tight (gap 1.2 m), and `dCorner` chases a carrier behind the net at once; `collapse`: wingers sag halfway to the slot (gap 4 m), `dCorner` contains, and both defencemen hold the posts against a carrier behind the net. `pinch`: a point man goes down the wall for a loose or contested puck on his side within 9 m (often), 6 m (sometimes), 3 m (rarely), and only while his team's `highForward` is above him.
  `naturalTactics` rules: `zoneEntry` from the top nine forwards' mean `carry - dump` (over 0.15 `carry`, under -0.05 `dump`, else `mixed`); `offence` `pointShots` when the defencemen's mean `shootingPower` is 74 or more and mean `shoot` habit 0.35 or more, `rush` when the forwards' mean `speed` is 73 or more and mean `joinRush` 0.55 or more, else `cycle`; `forecheck` from the forwards' mean `forecheck` habit (over 0.62 aggressive, under 0.48 passive); `defence` `pressure` when the defencemen's mean `bodyChecking` is 72 or more; `pinch` from the defencemen's mean `joinRush` (over 0.5 often, under 0.3 rarely). `generateTeam` sets all five from it (no extra random draw, so rosters do not change).
- Produces (`validate.ts`): each optional field, when present, must be one of its values (`bad-tactics`).

- [ ] **Step 1: Write the failing tests**

```ts
// tactics.test.ts. `entries(setup, side, n)` plays n games and counts, for `side`: carry-ins (its carrier crosses the offensive blue line with the puck) and dump-ins (a 'dump' or 'rim' released in the neutral zone).
const withTactics = (s: GameSetup, side: Side, t: Partial<Tactics>): GameSetup => ({ ...s, [side]: { ...s[side], tactics: { ...s[side].tactics, ...t } } });
it('a setup without the new fields is valid and plays with the defaults', () => {
  const s = gameSetup(1); expect(() => validateSetup(withTactics(s, 'home', { zoneEntry: undefined }))).not.toThrow();
  expect(resolveTactics({ forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 55 } })).toMatchObject({ zoneEntry: 'mixed', offence: 'cycle', defence: 'collapse', pinch: 'sometimes' });
  expect(() => validateSetup(withTactics(s, 'home', { zoneEntry: 'chip' as never }))).toThrow(/zoneEntry/);
});
it('a dump-and-chase team and a carry-in team look different: dump-ins are over 45% of one\'s entries and under 25% of the other\'s', () => {
  const dump = entries(withTactics(gameSetup(1), 'home', { zoneEntry: 'dump' }), 'home', 4), carry = entries(withTactics(gameSetup(1), 'home', { zoneEntry: 'carry' }), 'home', 4);
  expect(dump.dumpIns / (dump.dumpIns + dump.carryIns)).toBeGreaterThan(0.45); expect(carry.dumpIns / (carry.dumpIns + carry.carryIns)).toBeLessThan(0.25);
});
it('the players bend the tactic: grinders asked to carry still dump 1.3 times as often as a skilled line; a skilled line asked to dump still carries a quarter of its entries', () => {
  const f = (habit: { dump: number; carry: number }, zoneEntry: 'carry' | 'dump'): number => { const e = entryFactors(resolveTactics({ ...tactics.home, zoneEntry }), habit.dump, habit.carry); return e.dump / (e.dump + e.carryIn); };
  expect(f({ dump: 0.6, carry: 0.3 }, 'carry')).toBeGreaterThan(f({ dump: 0.2, carry: 0.6 }, 'carry') * 1.3);
  const skilled = entries(allOfType(gameSetup(1), 'home', 'Playmaker', { zoneEntry: 'dump' }), 'home', 4); expect(skilled.carryIns / (skilled.dumpIns + skilled.carryIns)).toBeGreaterThan(0.25);
});
it('a cycle team holds the zone longer than a rush team; a point-shot team shoots more from the defence', () => {
  const play = (offence: 'cycle' | 'pointShots' | 'rush'): PlayMeasuresBySide => measureSide(withTactics(gameSetup(1), 'home', { offence }), 'home', 4);
  expect(play('cycle').ozoneSecondsPerPossession).toBeGreaterThan(play('rush').ozoneSecondsPerPossession * 1.2);
  expect(play('pointShots').defenceAttemptsPerGame).toBeGreaterThan(play('cycle').defenceAttemptsPerGame * 1.4);
});
it('an aggressive forecheck has two men deep; a trap has none', () => {
  const deep = (forecheck: Tactics['forecheck']): number => twoDeepShare(withTactics(gameSetup(1), 'home', { forecheck }), 'home', 2);  // share of its forecheck time with two forwards below the far hash marks (rx > 21)
  expect(deep('aggressive')).toBeGreaterThan(0.40); expect(deep('passive')).toBeLessThan(0.10);
});
it('against a carrier behind the net a pressure team chases and a collapse team holds the front', () => { expect(chaseShare('pressure')).toBeGreaterThan(0.7); expect(chaseShare('collapse')).toBeLessThan(0.3); });
it('point men pinch more when told to, and only with a forward above them', () => { expect(pinches('often', 4)).toBeGreaterThan(pinches('rarely', 4) * 2); expect(pinchesWithoutCover(4)).toBe(0); });
it('generated teams get tactics that suit them: deterministic, and across 40 seeds every setting takes at least two values', () => {
  const ts = Array.from({ length: 40 }, (_, i) => resolveTactics(generateTeam(i + 1, 'T', 'T').tactics));
  for (const k of ['forecheck', 'zoneEntry', 'offence', 'defence', 'pinch'] as const) expect(new Set(ts.map((t) => t[k])).size).toBeGreaterThanOrEqual(2);
  expect(generateTeam(7, 'T', 'T').tactics).toEqual(generateTeam(7, 'T', 'T').tactics);
  expect(generateTeam(7, 'T', 'T').players).toEqual(playersBeforeThisTask(7));       // the roster itself is unchanged: same ids, names and attributes as the golden roster hash
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `game.ts` resolves each side's tactics once in `run`.
- [ ] **Step 4: Run all checks.**
- [ ] **Step 5: Re-pin the golden file.** Reason: generated teams have tactics, and tactics shade options and jobs.
- [ ] **Step 6: Commit** `feat: team tactics: zone entry, offence, forecheck, defence, pinching`. Meaning changes: `Tactics` has four new optional fields; `generateTeam` no longer always gives a balanced forecheck.

---

### Task 12: A7 Player types that combine: styles, habits and badges

**Files:**
- Create: `packages/engine/src/styles.ts`, `packages/engine/src/badges.ts`, `packages/engine/test/styles.test.ts`, `packages/engine/test/badges.test.ts`
- Modify: `packages/engine/src/types.ts`, `player-types.ts` (adds `'Shutdown Forward'`), `roster-gen.ts`, `validate.ts` (`SetupProblem` gains `'bad-style' | 'bad-badge'`), `index.ts`, and one line in each module a badge touches (listed below), `test/golden.ts` (`hashTeam` adds style and badges), `test/roster-gen.test.ts`, `test/validate.test.ts`, `test/interface.test.ts`

**Interfaces:**
- Consumes: `PLAYER_TYPES`, `Tendencies`, `SkaterAttrs`, `composite`; and the functions each badge shades: `movementOf` (`skating.ts`), `drainEnergy` (`bench.ts`), `executeShot` / shot types (`actions.ts`), `planPass`, `receiveChance`, `stickInterceptChance` (`passing.ts`), `listOptions` (`options.ts`), `tipChance` (`tips.ts`), `tryBlock` (`shots.ts`), `saveChance` / `saveOutcomeChances`, `hitChance` / `hitDegreeChances`, the poke, board-battle and net-front ratings, `engageChance`, `drawChance` (`faceoff.ts`).
- Produces (`types.ts`):

```ts
export type ForwardStyle = 'Sniper' | 'Playmaker' | 'Power Forward' | 'Two-Way Forward' | 'Shutdown Forward' | 'Speedster' | 'Grinder' | 'Enforcer';
export type DefenceStyle = 'Offensive Defenceman' | 'Defensive Defenceman' | 'Two-Way Defenceman';
export type Style = ForwardStyle | DefenceStyle;
export type Badge =
  | 'Heavy Slapshot' | 'One-Timer' | 'Quick Release' | 'Net-Front Finisher' | 'Burner' | 'Elusive' | 'Tireless'
  | "Playmaker's Vision" | 'Stickhandler' | 'Breakout Passer' | 'Shot Blocker' | 'Stick Checker' | 'Big Hitter' | 'Shutdown'
  | 'Board Battler' | 'Net-Front Presence' | 'Faceoff Specialist' | 'Rebound Control' | 'Glove Hand';
// Tendencies gains:  /** Default 0.5. */ block?: number
// PlayerDef gains:
/** His style, when set by hand (the override); when absent it is worked out from his attributes and habits (styleOf). */
style?: { primary: Style; secondary: Style | null };
/** Default none. */
badges?: Badge[];
```
  `PlayerDef.type` stays (a `PLAYER_TYPES` key; for a generated player, his primary style's key: `'Defensive Defenceman'` maps to the existing key `'Shutdown Defenceman'`); `subType` stays in the type and is `null` for generated players (badges replace it).
- Produces (`styles.ts`):

```ts
export type StyleDef = { group: 'F' | 'D'; adjective: string; habits: Required<Tendencies>; attrBias: Partial<SkaterAttrs>; typeKey: string };
export const STYLES: Record<Style, StyleDef>;   // adjectives: Sniping, Playmaking, Power, Two-Way, Shutdown, Speedy, Grinding, Physical; Offensive, Defensive, Two-Way
/** Two thirds primary, one third secondary (all primary when secondary is null), habit by habit. */
export function blendHabits(primary: Style, secondary: Style | null): Required<Tendencies>;
/** Secondary's adjective then the primary's name: "Sniping Power Forward"; the primary's name alone when pure. */
export function styleLabel(primary: Style, secondary: Style | null): string;
/**
 * His style: `def.style` when set; otherwise each style of his group is scored by how well his attributes match its attrBias
 * (mean of bias-weighted attribute differences from his own mean) and his habits match its habits (1 - mean absolute difference);
 * the best is primary, and the next is secondary when its score is at least 0.85 of the best. Goalies: null.
 */
export function styleOf(def: PlayerDef): { primary: Style; secondary: Style | null; label: string } | null;
```
  `'Shutdown Forward'`: habits shoot 0.25, pass 0.45, carry 0.3, dump 0.5, hit 0.5, forecheck 0.55, netFront 0.2, joinRush 0.2, block 0.8; bias `defensivePositioning: 18, stickChecking: 12, shotBlocking: 10, iq: 8, compete: 8, discipline: 6, shootingAccuracy: -8, puckHandling: -6`; build 182 to 194 cm, 86 to 98 kg. Each existing type's `block` habit: Sniper 0.2, Playmaker 0.2, Power Forward 0.5, Two-Way Forward 0.6, Speedster 0.2, Grinder 0.7, Enforcer 0.5, Offensive Defenceman 0.4, Defensive Defenceman 0.85, Two-Way Defenceman 0.6.
- Produces (`badges.ts`):

```ts
export const BADGES: readonly Badge[];
export const hasBadge = (d: PlayerDef, b: Badge): boolean => d.badges?.includes(b) ?? false;
/** The badges his ratings earn, at most four, strongest first. */
export function earnedBadges(d: PlayerDef): Badge[];
```

  | Badge | Earned by | Its one effect |
  |---|---|---|
  | Heavy Slapshot | shootingPower ≥ 88 | slapshot speed × 1.08 |
  | One-Timer | shootingAccuracy ≥ 85, shoot habit ≥ 0.6 | one-timer spread × 0.8 instead of × 1.25 |
  | Quick Release | shootingAccuracy ≥ 88, poise ≥ 75 | pressure counts 0.6 in his shot spread; the goalie's reaction time × 0.9 |
  | Net-Front Finisher | netFront habit ≥ 0.7, puckHandling ≥ 75 | tip chance + 0.08; spread × 0.85 on a rebound shot |
  | Burner | speed ≥ 90 | top speed × 1.03 |
  | Elusive | agility ≥ 90 | carve × 1.1; the poke checker's carrier edge + 4 against him |
  | Tireless | stamina ≥ 90 | energy drain × 0.85 |
  | Playmaker's Vision | vision ≥ 90 | sees one more pass option; option-value error × 0.7 |
  | Stickhandler | puckHandling ≥ 90 | + 5 in a poke check's hands rating |
  | Breakout Passer | passing ≥ 85, position C, LD or RD | passes from his own zone: error × 0.75, range + 5 m |
  | Shot Blocker | shotBlocking ≥ 88 | block chance + 0.08 |
  | Stick Checker | stickChecking ≥ 88 | + 5 in a poke check's stick rating; stick-in-lane factor 1.7 instead of 1.5 |
  | Big Hitter | bodyChecking ≥ 88, weight ≥ 95 kg | + 5 hitter rating; + 0.4 on the hit-degree score |
  | Shutdown | defensivePositioning ≥ 90 | + 4 in poke and strip ratings against the man he marks; covers 0.3 m tighter |
  | Board Battler | strength ≥ 85, compete ≥ 85 | + 5 in pin and dig ratings |
  | Net-Front Presence | strength ≥ 88, balance ≥ 80 | + 6 in the net-front body rating and + 4 in engagements within 5 m of a net |
  | Faceoff Specialist | faceoffs ≥ 88 | + 5 faceoffs rating |
  | Rebound Control (G) | reboundControl ≥ 85 | held and steered chances + 0.06 each |
  | Glove Hand (G) | glove ≥ 85 | save log-odds + 0.25 on his catching side above 0.5 m; held chance + 0.08 on glove saves |

  Every shaded chance is re-clamped (`winProb` for ratings, `[0.03, 0.97]` otherwise).
- Produces (`roster-gen.ts`): a skater's primary style is drawn as his type is today (from the styles of his position, now including Shutdown Forward); with chance 0.6 a secondary style, another of his group; attributes are biased by the primary's `attrBias` plus half the secondary's; `tendencies` = `blendHabits` plus the existing noise (and `block`); `style` is left unset (it is worked out); `badges = earnedBadges(def)`; `type` = the primary's `typeKey`; `subType` = `null`. `validate.ts`: a set `style` must be of his position group (`bad-style`); `badges` must be known, and a goalie badge only on a goalie (`bad-badge`); `tendencies.block`, when present, 0 to 1.
- `index.ts` exports `STYLES`, `BADGES`, `styleOf`, `styleLabel`.

- [ ] **Step 1: Write the failing tests**

```ts
// styles.test.ts
it('habits are two thirds primary and one third secondary', () => {
  const h = blendHabits('Power Forward', 'Sniper'); expect(h.shoot).toBeCloseTo((2 * 0.55 + 0.8) / 3, 9); expect(h.hit).toBeCloseTo((2 * 0.8 + 0.2) / 3, 9);
  expect(blendHabits('Grinder', null)).toEqual(STYLES.Grinder.habits);
});
it('named secondary then primary', () => {
  expect(styleLabel('Power Forward', 'Sniper')).toBe('Sniping Power Forward'); expect(styleLabel('Speedster', 'Playmaker')).toBe('Playmaking Speedster');
  expect(styleLabel('Sniper', 'Two-Way Forward')).toBe('Two-Way Sniper'); expect(styleLabel('Grinder', null)).toBe('Grinder');
});
it('the label is worked out from the player, with an override', () => {
  const pf = def({ position: 'RW', strength: 92, bodyChecking: 88, balance: 82, shootingAccuracy: 90, shootingPower: 86, speed: 62, agility: 60, tendencies: blendHabits('Power Forward', 'Sniper') });
  expect(styleOf(pf)!.label).toBe('Sniping Power Forward');
  expect(styleOf({ ...pf, style: { primary: 'Grinder', secondary: null } })!.label).toBe('Grinder');
  expect(styleOf(def({ position: 'G' }))).toBeNull();
  expect(styleOf(def({ position: 'LD', defensivePositioning: 92, shotBlocking: 90, stickChecking: 85, tendencies: blendHabits('Defensive Defenceman', null) }))!.primary).toBe('Defensive Defenceman');
});
it('generated players: every style appears, about 60% have a secondary, most have 0 to 3 badges', () => {
  const ps = Array.from({ length: 30 }, (_, i) => generateTeam(i + 1, 'T', 'T')).flatMap((t) => t.players.filter((p) => p.position !== 'G'));
  const styles = ps.map((p) => styleOf(p)!); for (const s of Object.keys(STYLES)) expect(styles.some((x) => x.primary === s)).toBe(true);
  const withSecond = styles.filter((s) => s.secondary !== null).length / styles.length; expect(withSecond).toBeGreaterThan(0.3); expect(withSecond).toBeLessThan(0.8);
  expect(shareOf(ps, (p) => (p.badges ?? []).length <= 3)).toBeGreaterThan(0.9); expect(shareOf(ps, (p) => (p.badges ?? []).length >= 1)).toBeGreaterThan(0.1);
});
// badges.test.ts: one row per badge: the metric it shades, with and without it, and the largest effect allowed.
const CASES: [Badge, (d: PlayerDef) => number, { atLeast: number; atMost: number }][] = [
  ['Heavy Slapshot', (d) => shotSpeedOf(d, 'slap'), { atLeast: 1.05, atMost: 1.10 }],
  ['One-Timer', (d) => 1 / shotSpreadOf(d, 'oneTimer'), { atLeast: 1.3, atMost: 1.7 }],
  ['Burner', (d) => movementOf(d, 1).topSpeed, { atLeast: 1.02, atMost: 1.04 }],
  ['Tireless', (d) => 1 / drainOf(d), { atLeast: 1.1, atMost: 1.25 }],
  ['Shot Blocker', (d) => blockChanceOf(d), { atLeast: 1.1, atMost: 1.5 }],
  ['Faceoff Specialist', (d) => drawChanceFor(d), { atLeast: 1.02, atMost: 1.25 }],
  ['Board Battler', (d) => battleWinShare(d, 400), { atLeast: 1.03, atMost: 1.4 }],
  /* ... one row for each of the 19 badges, in the table's order ... */
];
it.each(CASES)('%s has a small real effect', (badge, metric, band) => {
  const base = def({}), ratio = metric({ ...base, badges: [badge] }) / metric(base);
  expect(ratio).toBeGreaterThanOrEqual(band.atLeast); expect(ratio).toBeLessThanOrEqual(band.atMost);
});
it('every badge is in the table of cases', () => { expect(CASES.map((c) => c[0]).sort()).toEqual([...BADGES].sort()); });
it('the power forward does not always beat the two-way guy: with Board Battler and 20 kg on him he wins 55% to 90% of board battles', () => {
  const pf = def({ strength: 95, balance: 88, compete: 88, weightKg: 104, badges: ['Board Battler'] }), tw = def({ strength: 68, balance: 72, compete: 74, weightKg: 84 });
  const s = battleWinShare2(pf, tw, 600); expect(s).toBeGreaterThan(0.55); expect(s).toBeLessThanOrEqual(0.9);
});
it('badges never break the clamps: every chance a badge shades stays within its limits for a 100-rated player holding all of them', () => { /* tipChance, block chance, receiveChance, stickInterceptChance, saveOutcomeChances <= 0.97; winProb-based <= 0.9 */ });
it('a bad style or badge is rejected before play', () => {
  expect(() => validateSetup(withPlayer({ position: 'LD', style: { primary: 'Sniper', secondary: null } }))).toThrow(/style/);
  expect(() => validateSetup(withPlayer({ badges: ['Clutch' as never] }))).toThrow(/badge/); expect(() => validateSetup(withPlayer({ position: 'C', badges: ['Glove Hand'] }))).toThrow(/badge/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Each badge's effect is one guarded line at the place the table names, reading `hasBadge`.
- [ ] **Step 4: Run all checks.** The calibration tests that group by `type` still find `Sniper`, `Grinder`, `Power Forward`, `Speedster`.
- [ ] **Step 5: Re-pin the golden file.** Reason: generated rosters change (Shutdown Forward, secondary styles, badges), and badges shade play.
- [ ] **Step 6: Commit** `feat: styles that combine, habits and badges`. Meaning changes: every generated roster differs from before; `subType` is `null` for generated players; `tendencies.block` exists.

---

### Task 13: A8 Faceoffs and stoppages

**Files:**
- Modify: `packages/engine/src/faceoff.ts`, `game.ts` (`stepOnce`), `goalie.ts` (`moveGoalie`), `bench.ts` (stepping on at a stoppage), `tuning.ts`, `test/game.test.ts`, `test/goalie.test.ts`, `test/measures.ts`, `test/play.test.ts`; create `packages/engine/test/faceoff.test.ts`

**Interfaces:**
- Consumes: `commitTo` with job `lineUp` (Task 3), `Drive`, `finishChanges`, `linedUp`, `FACEOFF_DOTS`.
- Produces (`faceoff.ts`):

```ts
/** Line-up spots, metres behind the dot toward his own end and to his left: C 0.6 / 0; LW 0.9 / 4.6; RW 0.9 / -4.6 (on the circle); LD 5 / 2.5; RD 5 / -2.5. Everyone is on his own side of the dot. */
export function faceoffPosition(spot: Vec2, slot: Position | null, dir: 1 | -1): Vec2;
/** The way he faces at the draw: a centre at the dot, everyone else straight up ice (his attack direction). Radians. */
export function faceoffFacing(spot: Vec2, slot: Position | null, dir: 1 | -1, pos: Vec2): number;
/** No change under way, every on-ice skater within LINEUP_TOLERANCE of his spot, slower than 0.5 m/s and within 0.35 rad of his faceoffFacing. */
export function linedUp(state: GameState): boolean;
export const FACEOFF_MIN_SECONDS = 3;
/** A safety net only: the tests show it is never reached. */
export const FACEOFF_MAX_SECONDS = 25;
```
  `headForLineup` gives each skater job `lineUp`, effort `skate` (sprint beyond 20 m), `slow: 'stop'`, and a `faceTarget` 10 m along his `faceoffFacing` from his spot once he is within 1.5 m of it. The puck drops when `linedUp` holds (after `FACEOFF_MIN_SECONDS`); a line change still under way holds it up until it finishes by itself.
- Produces (`goalie.ts`): when play is not live, the goalie skates to the middle of his crease (`LINE_GAP` + 0.6 m out, `y = 0`) and turns to face up ice (phase `stopped`) or the faceoff spot (phase `faceoffSetup`); he never turns to a stopped puck behind him.

- [ ] **Step 1: Write the failing tests**

```ts
// faceoff.test.ts
it('everyone lines up on his own side of the dot: centres over it, wingers on the circle, defencemen behind', () => {
  for (const dot of [FACEOFF_DOTS.centre, ...FACEOFF_DOTS.neutral, ...FACEOFF_DOTS.end]) for (const dir of [1, -1] as const) {
    const at = (slot: Position): Vec2 => faceoffPosition(dot, slot, dir);
    for (const slot of ['C', 'LW', 'RW', 'LD', 'RD'] as const) expect((at(slot).x - dot.x) * dir).toBeLessThan(0);
    expect(Math.hypot(at('C').x - dot.x, at('C').y - dot.y)).toBeLessThan(0.8);
    if (Math.abs(dot.y) < 1) { expect(Math.hypot(at('LW').x - dot.x, at('LW').y - dot.y)).toBeGreaterThan(4.3); expect(Math.hypot(at('LW').x - dot.x, at('LW').y - dot.y)).toBeLessThan(4.9); }
    expect((dot.x - at('LD').x) * dir).toBeGreaterThan(4); }
});
it('at every drop of a game, every skater faces the right way: within 20 degrees of up ice, the centres at the dot', () => {
  const bad: string[] = []; const g = createGame(gameSetup(4)); let prev = g.state.phase;
  while (!g.done) { g.step(); const s = g.state;
    if (prev === 'faceoffSetup' && s.phase === 'live') for (const k of s.skaters) { if (!k.onIce) continue; const dir = s.attackDir[k.side];
      const off = Math.abs(wrapAngle(k.facing - (dir === 1 ? 0 : Math.PI))); if (off > (20 * Math.PI) / 180) bad.push(`${k.id} at tick ${s.tick}: ${off.toFixed(2)} rad`); }
    prev = s.phase; }
  expect(bad.slice(0, 5)).toEqual([]);
}, 30_000);
it('setup takes as long as the players take to arrive: nobody is moved by force, and it is over within 20 s', () => {
  const g = createGame(gameSetup(5)); let setup = 0, longest = 0, forced = 0, n = 0, total = 0; let before = new Map<string, Vec2>();
  while (!g.done) { const was = g.state.phase; if (was === 'faceoffSetup') before = new Map(g.state.skaters.map((k) => [k.id, { ...k.pos }]));
    g.step(); const s = g.state;
    if (was === 'faceoffSetup' && s.phase === 'live') { n++; total += setup; longest = Math.max(longest, setup); setup = 0;
      for (const k of s.skaters) { const b = before.get(k.id)!; if (k.onIce && Math.hypot(k.pos.x - b.x, k.pos.y - b.y) > 0.5) forced++; } }
    else if (s.phase === 'faceoffSetup') setup += DT; }
  expect(forced).toBe(0); expect(longest).toBeLessThan(20); expect(total / n).toBeLessThan(9);
}, 30_000);
it('after a frozen puck or a goal the goalie faces up ice, never the puck behind him', () => {
  const g = createGame(gameSetup(6)); let worst = 0;
  while (!g.done) { g.step(); const s = g.state; if (s.phase !== 'stopped' || s.phaseT < 0.6) continue;
    for (const side of ['home', 'away'] as const) worst = Math.max(worst, Math.abs(wrapAngle(s.goalies[side].facing - (s.attackDir[side] === 1 ? 0 : Math.PI)))); }
  expect(worst).toBeLessThan(0.2);
}, 30_000);
```
  Existing tests that rely on the 8 s cap (`test/game.test.ts`, `test/bench.test.ts`) are rewritten to the new rule, keeping what they check.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks and the robustness file.**
- [ ] **Step 5: Re-pin the golden file.** Reason: faceoff line-ups, facing and setup time; goalies face up ice at stoppages.
- [ ] **Step 6: Commit** `feat: faceoffs line up facing the right way, as long as it takes`. Meaning changes: `faceoffSetup` can last longer than 8 s; line-up spots moved (wingers on the circle, defencemen 5 m back).

---

### Task 14: Re-tune A, the scorecard and the changes for the viewer

Tuning only: this task changes numbers in `packages/engine/src/tuning.ts` and nothing else under `src`. If a target cannot be reached by tuning, stop and report which target, the nearest value reached and what would have to change in which module; do not edit behaviour.

**Files:**
- Modify: `packages/engine/src/tuning.ts`, `packages/engine/test/calibration.test.ts`, `packages/engine/scripts/nhl-reference.ts` (bands only, if the owner's targets below differ from Task 1's), `packages/engine/test/golden-expected.ts`
- Create: `docs/superpowers/reviews/engine-scorecard-round-2a.md` (generated), `docs/superpowers/specs/engine-round-2a-changes-for-viewer.md`

**Interfaces:**
- Consumes: `runGames`, `summarise` (with `Summary.play` and `Summary.attempts`), `winShare`, `goalsPer60ByType`, `battleWinShareByType` (`test/helpers.ts`); `scorecardRows`, `npm run scorecard` (Task 1); the goal fields `rebound`, `tippedFrom`, `screened`, `distance` (Task 8), counted per record in `GameRecord.counts` under `goal:rebound`, `goal:tipped`, `goal:pointTraffic` (a goal from 11 m or more that was screened or tipped): add these three keys to `playRecord`.
- Produces: the calibration asserts the design's targets; the scorecard file is the deliverable shown to the owner; the changes document lists what the viewer must re-read.

- [ ] **Step 1: Write the failing tests** (`calibration.test.ts`; the 300-game sets are fixed, so these are exact for the committed tuning)

```ts
it('5-on-5 totals match the design\'s targets', () => {
  const m = summarise(runGames(300));
  expect(m.goals).toBeGreaterThanOrEqual(2.4);    expect(m.goals).toBeLessThanOrEqual(2.6);
  expect(m.shots).toBeGreaterThanOrEqual(28);     expect(m.shots).toBeLessThanOrEqual(31);
  expect(m.attempts).toBeGreaterThanOrEqual(55);  expect(m.attempts).toBeLessThanOrEqual(62);
  expect(m.savePct).toBeGreaterThanOrEqual(0.915); expect(m.savePct).toBeLessThanOrEqual(0.920);
  expect(m.hits).toBeGreaterThanOrEqual(20);      expect(m.hits).toBeLessThanOrEqual(25);
  expect(m.blocks).toBeGreaterThanOrEqual(13);    expect(m.blocks).toBeLessThanOrEqual(16);
  // "near today's": within 30% of the baseline in docs/superpowers/reviews/engine-scorecard-baseline.md (about 6.7 and 4.8 in the planning sample)
  expect(m.takeaways).toBeGreaterThan(BASELINE.takeaways * 0.7); expect(m.takeaways).toBeLessThan(BASELINE.takeaways * 1.3);
  expect(m.giveaways).toBeGreaterThan(BASELINE.giveaways * 0.7); expect(m.giveaways).toBeLessThan(BASELINE.giveaways * 1.3);
  expect(m.faceoffsTotal).toBeGreaterThan(42); expect(m.faceoffsTotal).toBeLessThan(72);
  expect(m.offsidesTotal).toBeGreaterThan(2);  expect(m.offsidesTotal).toBeLessThan(11);
  expect(m.icingsTotal).toBeGreaterThan(3);    expect(m.icingsTotal).toBeLessThan(13);
  expect(m.tieShare).toBeGreaterThan(0.15);    expect(m.tieShare).toBeLessThan(0.30);
}, GAMES_TIMEOUT);
it('a fifth to a quarter of goals come from rebounds and tips, and some from the point through traffic', () => {
  const rs = runGames(300); const goals = rs.reduce((a, r) => a + r.score.home + r.score.away, 0); const n = (k: string): number => rs.reduce((a, r) => a + (r.counts[k] ?? 0), 0);
  const second = (n('goal:rebound') + n('goal:tipped')) / goals; expect(second).toBeGreaterThanOrEqual(0.18); expect(second).toBeLessThanOrEqual(0.27);
  const point = n('goal:pointTraffic') / goals; expect(point).toBeGreaterThanOrEqual(0.06); expect(point).toBeLessThanOrEqual(0.20);
}, GAMES_TIMEOUT);
it('the 76 still beats the 66 about three quarters of the time, and loses plenty', () => {
  const w = winShare(runGames(300, { homeOverall: 76, awayOverall: 66 })); expect(w.home).toBeGreaterThanOrEqual(0.70); expect(w.home).toBeLessThanOrEqual(0.80); expect(w.away).toBeGreaterThan(0.10);
}, GAMES_TIMEOUT);
it('it looks like hockey', () => {
  const p = summarise(runGames(300)).play;
  expect(p.stationaryShare).toBeLessThan(0.08);                                                   // was 0.175
  expect(p.glideShare).toBeGreaterThan(0.33); expect(p.topSpeedShare).toBeGreaterThan(0.18); expect(p.sprintRunSeconds).toBeGreaterThan(1.5);   // were 0.25, 0.144, 0.78
  expect(p.passCompletion).toBeGreaterThan(0.75); expect(p.passCompletion).toBeLessThan(0.90);
  expect(p.pointPassKeptShare).toBeGreaterThan(0.90); expect(p.pointPassCompletion).toBeGreaterThan(0.75);
  expect(p.reboundChancesPerGame).toBeGreaterThanOrEqual(8); expect(p.reboundChancesPerGame).toBeLessThanOrEqual(20);
  expect(p.battleWinnerCameAwayShare).toBeGreaterThan(0.60); expect(p.battleToWinnerIsWinnerShare).toBeGreaterThan(0.85); expect(p.battlesNoWinnerPerGame).toBeLessThan(14);
  expect(p.knockdownShare).toBeGreaterThan(0.30); expect(p.knockdownShare).toBeLessThan(0.70);
  expect(p.defenceAttemptsPerTeam).toBeGreaterThanOrEqual(12); expect(p.defenceAttemptsPerTeam).toBeLessThanOrEqual(20);
  expect(p.ozoneSecondsPerPossession).toBeGreaterThan(4.0); expect(p.attemptsPerOzonePossession).toBeGreaterThan(0.33);                           // were 4.0 and 0.30
  expect(p.twoOpenShare).toBeGreaterThan(0.50); expect(p.dangerShadowedShare).toBeGreaterThan(0.60); expect(p.dangerShadowedShare).toBeLessThan(0.90);
  expect(p.behindNetPossessionsPerGame).toBeGreaterThanOrEqual(8); expect(p.passesOutFrontPerGame).toBeGreaterThanOrEqual(2); expect(p.wrapAttemptsPerGame).toBeGreaterThanOrEqual(0.5);
  expect(p.puckJumpsPerGame).toBe(0);
}, GAMES_TIMEOUT);
it('a game runs within budget: 2.5 s', () => { const t0 = performance.now(); for (let i = 0; i < 5; i++) simulateGame(setup(i)); expect((performance.now() - t0) / 5).toBeLessThan(2500); }, 60_000);
```
  Keep the existing faceoff-share, freak-score, sniper-over-grinder and power-forward battle tests as they are.

- [ ] **Step 2: Run `npm run test:calibration`.** Expected: FAIL on some bands.
- [ ] **Step 3: Tune `tuning.ts`** group by group with `npm run calibrate -- --games 300` (shot volume and quality first, then saves and rebounds, then contests, then pace) until `npm run test:calibration` passes, including `test/robustness.test.ts`.
- [ ] **Step 4: Run all checks; re-pin the golden file.** Reason: Re-tune A.
- [ ] **Step 5: Regenerate the scorecard:** `npm run scorecard -- --label round-2a --games 300`. Every row with a band must read "in"; commit `docs/superpowers/reviews/engine-scorecard-round-2a.md`. This file, beside `engine-scorecard-baseline.md`, is what the owner is shown.
- [ ] **Step 6: Write `docs/superpowers/specs/engine-round-2a-changes-for-viewer.md`** from the `Meaning changes:` lines of Tasks 2 to 13 (`git log --grep "Meaning changes"`) and the type diff of `packages/engine/src/types.ts` against `main`. Sections: (1) the left/right convention and what the viewer must flip (the engine's left is `facing + PI/2`; the viewer draws engine `y` as world `+Z`, which mirrors it; `GOALIE_CATCHES` goes, `PlayerDef.catches` is read); (2) every new or changed event field and event type, with its type and meaning (`pass.kind`/`hand`, `release.kind`/`shotType`, `shot`, `save`, `goal`, `miss`, `post`, `tip`, `hit.degree`, `battle` supporters, `contestEnd.puckTo` and `winnerId`, `engagement`); (3) every new state field (`plans`, `teamPhase`, `carrierPlan`, `lastSave`, `staggered`, `engagements`, `pendingPass.aim/bobbled/oneTimer`, `ShotInFlight` additions) and what a viewer can draw from it; (4) changed meanings of existing fields (`speedCap`, the carried puck's place, where and when `shot`/`save`/`goal` are emitted, `block.pos`, loose-race timing, faceoff spots and setup length, bodies in contact); (5) new setup inputs and their defaults (`Tactics` fields, `PlayerDef.style`, `badges`, `catches`, `tendencies.block`) and the new exports; (6) the viewer guesses each of these replaces.
- [ ] **Step 7: Commit** `tune: re-tune A; scorecard and changes for the viewer`

---

## Self-Review

**Spec coverage.**

| Design section | Tasks |
|---|---|
| A1 hold job and target, minimum 0.4 s; phase with a delay | 3 |
| A1 coast / ease / stop; carving; backward slower | 2 |
| A1 no speed caps by job, effort by need and energy; backward where it belongs | 3 (effort), 4 (who faces the play) |
| A1 race winner skates to the puck; skaters cannot pass through goalies | 3 |
| A2 job list, a moving part for every job, unique and sticky | 3 (the type, stickiness), 4 |
| A2 getting open is active; taking lanes away; behind the net | 4 (jobs, lanes, the office, chase or hold, goalie post to post), 5 (the carrier's choices there, shadowed lanes tried less), 6 (a stick in the lane intercepts more), 11 (chase or hold by tactic) |
| A3 value per option; clear path; no backward pass on a breakaway or odd-man rush; pressured low; vision, poise, decisions | 5 |
| A3 pass only when it can be received; facing; weight; point passes inside the line; puck on the blade; left and right; catching hand | 6 |
| A4 more attempts, point shots, one-timers; blocks at the blocker; misses stay in play; attempts in the record | 7 |
| A4 save outcomes, rebounds, tips, screens from the net-front job, crossing point and save kind | 8 |
| A5 winner comes away; fewer no-winner battles; supporters named and on their side; net-front defender; hit degrees; poke reach | 9 |
| A5 constant battling for position; contact no longer just separates | 10 |
| A6 the five tactics; players bend them; `generateTeam` picks | 11 |
| A7 primary and secondary styles, habits two thirds to one third, label with override, the 19 badges, catching hand | 12 (catching hand in 6) |
| A8 line-ups and facing; setup as long as it takes; goalie faces up ice | 13 |
| Re-tune A targets and the new measures | 1 (measures), 14 (targets) |
| NHL scorecard | 1 (built, baseline), 14 (regenerated) |
| Viewer hand-over | 14 (changes document) |

**Measured claims and where each is pinned.** Standing still: 4, 14. Gliding, top speed, sprint length, held targets: 3, 14. Re-issue inside 0.4 s only on a trigger: 3. No two skaters with one job: 4. Two attackers open, danger man shadowed: 4, 14. Behind the net: 4, 5, 14. Breakaway never passes backward: 5 (2,000 seeds at three spots, and whole games). Point passes kept in: 6, 14. Handedness: 6. Attempt identity, defence attempts: 7, 14. Shot pairing, rebounds, tips: 8, 14. Battle winner has the puck after `toWinner`: 9, 14. Heavier target rarely knocked down: 9. No teleport: 3 (races), 6 (pickups), 9 (every live tick). Goalie overlap: 3. Engaged, not separated: 10. Tactics tell teams apart: 11. Badges small and inside the clamps: 12. Faceoff facing and setup: 13.

**Type consistency.** `SlowMode` (types.ts) and `Drive` (skating.ts) are defined in Task 2 and used in 3, 4, 13. `Job`, `SkaterPlan`, `Want`, `commitTo` are defined in Task 3; Task 4 removes `press` and `shape` from `Job` and adds no name (every Task 4 job is already in the union, including `office`). `Tactics` is the existing type throughout; Tasks 4, 5 pass it as it is and Task 11 adds optional fields and `resolveTactics`. `Decision`/`CarrierPlan`/`CarryLane` (Task 5) are read in Task 7 (`lane === 'wrap'`). `PassHand`, `bladePos`, `handFor`, `planPass`, `receiveChance`, `stickInterceptChance` (Task 6) are consumed in 7, 8, 10, 12. `ShotType` and the `ShotInFlight.shotType` field come in Task 7; Task 8 adds `tippedBy`, `tipTried`, `rebound`, `screened`, `faced`, and the event fields that reuse `ShotType`. `ContestResult.puckTo` and the `contestEnd` field are both Task 9. `Engagement` and `tieOf` are Task 10; Task 12's Net-Front Presence reads `engageChance`. Record fields `attempts`, `missedShots`, `shotsBlocked` (Task 7) feed `Summary.attempts` (declared in Task 1 as `shots + miss + post + block` counts until Task 7 fills the record; Task 7 switches it to the record field). `PlayCounters` grows by named keys in Tasks 3 to 10; each task states its keys.

**Proportion.** Fourteen tasks: one for measures, two for A1 (physics, then commitment), one for A2, two for A3, two for A4, two for A5 (staged battles, then engagements), one each for A6, A7, A8, and the re-tune. The largest are Task 4 (the job table) and Task 8 (saves at the goalie's plane, three outcomes, tips, six event shapes); if either overruns in review, Task 4 splits at "jobs and assignment" / "moving parts, lanes and the office", and Task 8 at "saves at the plane with outcomes" / "tips and the rebound chase". No task changes totals on purpose before Task 14.

## Notes for the controller

1. **The viewer's suite will go red during Part A.** Root `npm test` runs `apps/viewer`'s fast tests, about twenty of which play engine games and pin sample-dependent numbers. The plan gates each task on the engine and debug suites plus the full typecheck, and has the viewer's failures listed, not fixed, as the design's "nothing in the viewer is changed during the engine work" requires. The viewer's typecheck is kept green by adding no required field to `SkaterState` or `GoalieState` and no value to `SavePose`/`ContestKind` (the viewer builds typed literals and a `Record<SavePose, number>`); that is why per-skater intent lives in `state.plans` and not on the skater.
2. **Left and right cannot be fixed in the engine alone.** The engine is already consistent (left is `facing + PI/2`; the left winger is at `+y` attacking `+x`; the glove is on that side). The mirror is the viewer drawing engine `y` as world `+Z`. Task 6 fixes the convention and tests it; the viewer's re-baseline has to flip its mapping and drop `GOALIE_CATCHES`. Until then a left shot's puck is drawn on the figure's right.
3. **"A breakaway never passes backward" is a rule on the option list, not a chance**, so the `[0.03, 0.97]` clamp does not apply to it. The pick among the options left stays noisy. If the owner wants even that to be a (tiny) chance, it is one line in `options.ts`.
4. **Saves move from the goal line to the goalie [plan's call].** The design asks for no teleports and for "where the puck crossed the goalie"; today the save is decided on the goal line behind him and the rebound is put back 0.45 m in front of him (up to 1.75 m in one tick). Task 8 resolves shots at his plane, so `shot` and `save` are emitted there and a `goal` follows its `shot` by up to 4 ticks. This is the largest event-contract change in the plan.
5. **Baselines measured while planning differ from the notes in places** (12 games, the calibration's rosters): skaters are within 10% of top speed 14% of the time by the plan's definition (the notes say under 10%); rebounds exist today (26 unfrozen saves a game leave the puck in front) but only 2.3 are shot at, so the plan measures second chances, not loose pucks; attempts are already 52.6 a team (the target 55 to 62 is a small rise; the gap is defencemen, 2 attempts a team); 89 point passes a game with 48% kept in; the supporter is handed the puck in 38 of 40 clean battle wins although only 2.75 wins a game are by support; the most dangerous option is already "shadowed" 76% of the time by this geometry, so that measure is a band, and the real test of lane-taking is that a stick in the lane is tried less (Task 5) and picked off more (Task 6).
6. **The Re-tune A bands are tight together** (goals 2.4 to 2.6, shots 28 to 31, save percentage .915 to .920). They are asserted on the fixed 300-game set, which is deterministic; another sample of the same tuning could fall just outside. "Hits" in the engine's record counts absorbed and bounced checks as well as landed ones (26 a team today), which is what the 20 to 25 band is applied to.
7. **Not in the design, added because the tests need them:** shot types on the `release` event (so One-Timer and Heavy Slapshot have something to shade and the viewer stops guessing), `rim` and `clear` as pass kinds, and a bobbled reception (a small chance, so "arrives on the stick" is not certain). Not added: shot wind-ups; Quick Release is defined without one.
8. **Kept from today where the design names something else:** the `PLAYER_TYPES` key `'Shutdown Defenceman'` stays and maps to the style `'Defensive Defenceman'`; no `transition` value is added to `TeamPhase` (the delay does that job); tactics are per team only. Adding Shutdown Forward changes every generated roster at Task 12, so every test team changes there.
9. **The NHL column depends on network access at Task 1.** If the implementer cannot reach the league's statistics, every NHL number is marked "from memory, unverified" in the data file and on the scorecard; someone with access should verify them before the owner reads it as a comparison.
10. **Branching.** The design says a new branch from `main`; the design file itself is committed on `viewer-3d` (64abea7). The engine branch needs a base that has both the merged engine and these documents.
11. **The performance test allows 3,000 ms today**; Task 1 lowers it to the design's 2,500 ms ceiling so every task is held to it. Engagements (Task 10) and the option valuation (Task 5) are the two places most likely to cost time; both have their own checks.
