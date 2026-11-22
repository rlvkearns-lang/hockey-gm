# Engine Core (First Playable, part 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic hockey engine that plays a full 60-minute 5-on-5 game with real rules and staged contests, produces a realistic box score, and can be inspected in a plain top-down debug view.

**Architecture:** A pure TypeScript package (`packages/engine`) advances a `GameState` by a fixed time step. Team-play code gives each skater a job, a per-player brain picks actions from attributes and tendencies, contests run as multi-stage state machines, and a referee module applies the rules. A small Vite app (`apps/debug`) draws the state top-down for developers. The 3D viewer, skating animation and watch-only physics are part 2, a separate plan written after this one lands, because they build on this plan's `GameState`.

**Tech Stack:** TypeScript (strict), npm workspaces, Vitest, tsx, Vite (debug app only).

**Spec:** `docs/superpowers/specs/2026-11-22-game-engine-design.md` (this plan covers the engine half of "Order within stage 1", step 1).

## Global Constraints

- Engine code imports nothing from the DOM, three.js, or Node built-ins. `packages/engine/tsconfig.json` sets `"lib": ["ES2022"]` and `"types": []`.
- Determinism: all randomness comes from `Rng` (Task 1). No `Math.random`, `Date`, or `performance` anywhere under `packages/engine/src`. Fixed time step `DT`. No iteration over object keys whose order depends on insertion from random paths; use arrays.
- Units: metres, seconds, radians, kilograms. `x` runs along the rink length, `y` across its width, `z` is height. Home attacks `+x` in periods 1 and 3, `-x` in period 2.
- Attributes are integers 1 to 100.
- Parity: no contest or outcome is certain. Every probability derived from attributes passes through `winProb` (Task 10) or is clamped to `[0.03, 0.97]`.
- Sim quality before speed: a full game must finish in 3 seconds or less on the test machine. Do not remove simulation detail to go faster.
- None of `docs/prototype/shift-prototype.html` is reused as code. It is a visual reference only.
- Step 1 scope: 5-on-5 only. No penalties, overtime, shootout, injuries, fights or scrums. A game level after 60 minutes ends tied.
- Commit after every task with the message given.

## Review Focus

1. **Stuck play** (the prototype had this bug): the puck sits loose or trapped and nobody plays it. Expect no stretch of live play longer than 15 s without the puck being touched. Pinned in Task 12.
2. **Lopsided teams** (all-95 against all-10): expect the game to finish, the weak team to still win some contests and get shots, and no score above 20. Pinned in Task 12.
3. **Stepping in bursts** (how the viewer will drive the engine): expect `step()` called in irregular batches, with state read between, to give the identical result to `simulateGame`. Pinned in Task 5.
4. **Bad rosters** (too few players, duplicate ids, a line naming a missing player, attribute out of range): expect `createGame` to throw an error naming the problem, not to crash mid-game. Pinned in Task 2.
5. **Odd seeds** (0, negative, non-integer, larger than 2^32): expect a valid game, and different seeds to give different games. Pinned in Task 1.

---

## File Structure

```
package.json                     workspaces: packages/*, apps/*
tsconfig.base.json
packages/engine/
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts            public exports
    constants.ts        DT, period lengths, brain interval
    rng.ts              seeded random numbers
    vec.ts              Vec2 helpers
    types.ts            PlayerDef, TeamDef, GameSetup, GameState, GameEvent, GameResult
    attributes.ts       attribute keys, composites
    player-types.ts     type catalog and tendencies
    roster-gen.ts       fictional test teams
    validate.ts         setup validation
    rink.ts             geometry, boards, zones, faceoff dots
    puck.ts             puck physics
    skating.ts          skater movement and facing
    bodies.ts           body-to-body separation and impact
    team-play.ts        phase detection and per-slot targets
    brain.ts            puck-carrier and off-puck decisions
    actions.ts          pass, shot, dump execution
    goalie.ts           positioning and save resolution
    referee.ts          offside, icing, stoppages, faceoff spot
    faceoff.ts          faceoff setup and draw
    bench.ts            fatigue and line changes
    contests/
      core.ts           Contest interface, winProb, registry
      poke-check.ts  hit.ts  board-battle.ts  net-front.ts  loose-race.ts
    stats.ts            events to box score
    game.ts             createGame, step, simulateGame
  scripts/
    bench.ts            tick-rate measurement
    calibrate.ts        N-game summary
  test/                 one file per source file, same name + .test.ts
apps/debug/
  package.json  index.html  vite.config.ts  src/main.ts  src/draw.ts
```

---

### Task 1: Workspace, seeded RNG, tick-rate check

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/engine/src/{rng.ts,constants.ts,vec.ts,index.ts}`, `packages/engine/scripts/bench.ts`
- Test: `packages/engine/test/rng.test.ts`, `packages/engine/test/purity.test.ts`

**Interfaces:**
- Produces:
  - `createRng(seed: number): Rng` where `Rng = { next(): number; range(min: number, max: number): number; int(min: number, max: number): number; chance(p: number): boolean; gauss(): number; pick<T>(items: readonly T[]): T }`. `next()` is in `[0, 1)`, `int` is inclusive at both ends, `gauss()` has mean 0 and standard deviation 1.
  - `constants.ts`: `DT = 1 / 30`, `PERIOD_SECONDS = 1200`, `PERIODS = 3`, `BRAIN_INTERVAL_TICKS = 6`.
  - `vec.ts`: `type Vec2 = { x: number; y: number }` and `add, sub, scale, len, dist, norm, dot, rotate, angleOf, segDist(p, a, b)`.

- [ ] **Step 1: `git init`, create the workspace files, run `npm install`.** Root `package.json` scripts: `"test": "npm -w packages/engine run test"`, `"bench": "tsx packages/engine/scripts/bench.ts"`. Dev dependencies: `typescript`, `vitest`, `tsx`.

- [ ] **Step 2: Write the failing tests**

```ts
// rng.test.ts
it('same seed gives the same stream', () => {
  const a = createRng(42), b = createRng(42);
  expect(Array.from({ length: 100 }, () => a.next())).toEqual(Array.from({ length: 100 }, () => b.next()));
});
it('different seeds give different streams', () => {
  expect(createRng(1).next()).not.toBe(createRng(2).next());
});
it.each([0, -7, 3.9, 2 ** 40])('seed %s gives valid numbers', (seed) => {
  const r = createRng(seed);
  for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});
it('2**40 and 0 do not collide', () => { expect(createRng(2 ** 40).next()).not.toBe(createRng(0).next()); });
it('gauss has mean ~0 and sd ~1', () => {
  const r = createRng(5), xs = Array.from({ length: 20000 }, () => r.gauss());
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  expect(Math.abs(mean)).toBeLessThan(0.03); expect(Math.abs(sd - 1)).toBeLessThan(0.03);
});
it('int is inclusive', () => { const r = createRng(9); const seen = new Set(Array.from({ length: 500 }, () => r.int(1, 3))); expect([...seen].sort()).toEqual([1, 2, 3]); });

// purity.test.ts (this one test may use node:fs)
it('engine source never uses ambient randomness or time', () => {
  for (const file of allTsFilesUnder('packages/engine/src'))
    expect(readFileSync(file, 'utf8')).not.toMatch(/Math\.random|Date\.now|new Date|performance\./);
});
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, `createRng` not found.
- [ ] **Step 4: Implement `rng.ts`, `constants.ts`, `vec.ts`.** Hash the seed to 32-bit state with a string hash of `String(seed)` so non-integer and large seeds stay distinct; use a 32-bit generator such as sfc32; `gauss` by Box-Muller.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Write `scripts/bench.ts` and run `npm run bench`.** It runs 108,000 ticks; each tick, for 12 agents, computes distance to the other 11 and a few `Rng` draws. It prints total milliseconds. Expected: under 1,000 ms. If it is over, change `DT` to `1 / 20` and `BRAIN_INTERVAL_TICKS` to `4`, and record the measured number in a comment beside `DT`.
- [ ] **Step 7: Commit** `chore: workspace, seeded rng, tick-rate check`

---

### Task 2: Player model, type catalog, test rosters, validation

**Files:**
- Create: `packages/engine/src/{types.ts,attributes.ts,player-types.ts,roster-gen.ts,validate.ts}`
- Test: `packages/engine/test/{roster-gen.test.ts,validate.test.ts}`

**Interfaces:**
- Consumes: `createRng`, `Rng`.
- Produces:
  - `SKATER_ATTRS` (readonly tuple): `shootingAccuracy, shootingPower, passing, vision, iq, poise, speed, acceleration, agility, balance, strength, fortitude, compete, stamina, puckHandling, stickChecking, bodyChecking, aggression, shotBlocking, faceoffs, discipline, defensivePositioning, fighting, injuryProneness`. `type SkaterAttrs = Record<(typeof SKATER_ATTRS)[number], number>`.
  - `GOALIE_ATTRS`: `reflexes, positioning, reboundControl, glove, blocker, lateral, puckHandling, poise`. `type GoalieAttrs`.
  - `type Position = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'`; `type Side = 'home' | 'away'`.
  - `type Tendencies = { shoot: number; pass: number; carry: number; dump: number; hit: number; forecheck: number; netFront: number; joinRush: number }`, each 0 to 1.
  - `type PlayerDef = { id: string; name: string; number: number; position: Position; shoots: 'L' | 'R'; heightCm: number; weightKg: number; type: string; subType: string | null; attrs: SkaterAttrs; goalie: GoalieAttrs | null; tendencies: Tendencies; form: number; morale: number; fatigue: number }` (`form`, `morale` in -1..1 default 0; `fatigue` 0..1 default 0).
  - `type Lines = { forwards: [string, string, string][]; defence: [string, string][]; goalie: string }` (4 forward lines in LW, C, RW order; 3 pairs in LD, RD order).
  - `type Tactics = { forecheck: 'passive' | 'balanced' | 'aggressive'; shiftSeconds: { forwards: number; defence: number } }`.
  - `type TeamDef = { id: string; name: string; abbr: string; players: PlayerDef[]; lines: Lines; tactics: Tactics }`.
  - `type GameSetup = { home: TeamDef; away: TeamDef; seed: number; chemistry: { a: string; b: string; value: number }[] }`.
  - `PLAYER_TYPES: Record<string, { positions: Position[]; subTypes: string[]; attrBias: Partial<SkaterAttrs>; tendencies: Tendencies; build: { heightCm: [number, number]; weightKg: [number, number] } }>` with exactly these keys: `Sniper, Playmaker, Power Forward, Two-Way Forward, Speedster, Grinder, Enforcer, Offensive Defenceman, Shutdown Defenceman, Two-Way Defenceman, Goalie`.
  - `generateTeam(seed: number, name: string, abbr: string, overall?: number): TeamDef` (12 forwards, 6 defencemen, 2 goalies; `overall` default 70 is the mean attribute before type bias).
  - `validateSetup(setup: GameSetup): void` (throws `Error` whose message names the first problem).
  - `composite(attrs: SkaterAttrs, weights: Partial<Record<keyof SkaterAttrs, number>>): number` (weighted mean, weights need not sum to 1).

- [ ] **Step 1: Write the failing tests**

```ts
// roster-gen.test.ts
it('builds a legal 20-man team, same every time for a seed', () => {
  const t = generateTeam(7, 'Harbour City', 'HBR');
  expect(t.players.length).toBe(20);
  expect(t.lines.forwards.length).toBe(4); expect(t.lines.defence.length).toBe(3);
  expect(generateTeam(7, 'Harbour City', 'HBR')).toEqual(t);
  for (const p of t.players) for (const k of SKATER_ATTRS) { expect(p.attrs[k]).toBeGreaterThanOrEqual(1); expect(p.attrs[k]).toBeLessThanOrEqual(100); expect(Number.isInteger(p.attrs[k])).toBe(true); }
});
it('types look different', () => {
  const ps = Array.from({ length: 40 }, (_, i) => generateTeam(i, 'T', 'T').players).flat();
  const mean = (type: string, k: keyof SkaterAttrs) => avg(ps.filter(p => p.type === type).map(p => p.attrs[k]));
  expect(mean('Sniper', 'shootingAccuracy')).toBeGreaterThan(mean('Grinder', 'shootingAccuracy') + 10);
  expect(mean('Power Forward', 'strength')).toBeGreaterThan(mean('Speedster', 'strength') + 10);
  expect(avg(ps.filter(p => p.type === 'Power Forward').map(p => p.weightKg))).toBeGreaterThan(avg(ps.filter(p => p.type === 'Speedster').map(p => p.weightKg)) + 8);
});
it('overall shifts the whole team', () => {
  expect(teamMean(generateTeam(1, 'A', 'A', 85))).toBeGreaterThan(teamMean(generateTeam(1, 'A', 'A', 55)) + 20);
});

// validate.test.ts : each case starts from a valid setup and breaks one thing
it.each([
  ['duplicate id', s => { s.home.players[1].id = s.home.players[0].id; }, /duplicate/i],
  ['line names a missing player', s => { s.home.lines.forwards[0][0] = 'nobody'; }, /nobody/],
  ['attribute out of range', s => { s.away.players[3].attrs.speed = 140; }, /speed/],
  ['goalie on a forward line', s => { s.home.lines.forwards[0][1] = s.home.lines.goalie; }, /goalie/i],
  ['too few forward lines', s => { s.home.lines.forwards.length = 2; }, /forward lines/i],
  ['same player on two lines', s => { s.home.lines.forwards[1][0] = s.home.lines.forwards[0][0]; }, /twice/i],
])('rejects %s', (_n, breakIt, msg) => { const s = validSetup(); breakIt(s); expect(() => validateSetup(s)).toThrow(msg); });
it('accepts a generated setup', () => { expect(() => validateSetup(validSetup())).not.toThrow(); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL, modules missing.
- [ ] **Step 3: Implement the five files.** `validateSetup` accepts 3 or 4 forward lines and 2 or 3 defence pairs, so a short bench is legal; fewer is an error. Sub-types are free text chosen from each type's `subTypes` list (for example Sniper: `Two-Way`, `One-Timer`; Power Forward: `Aggressor`, `Net-Front`; Offensive Defenceman: `Shoot-First`, `Puck-Mover`).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: player model, type catalog, test rosters, setup validation`

---

### Task 3: Rink geometry and puck physics

**Files:**
- Create: `packages/engine/src/{rink.ts,puck.ts}`
- Test: `packages/engine/test/{rink.test.ts,puck.test.ts}`

**Interfaces:**
- Consumes: `Vec2`, `DT`.
- Produces:
  - `RINK = { halfLength: 30.48, halfWidth: 12.955, cornerRadius: 8.53, goalLineX: 27.13, blueLineX: 7.62, netHalfWidth: 0.915, netHeight: 1.22, netDepth: 1.0, creaseRadius: 1.83 }`.
  - `FACEOFF_DOTS: { centre: Vec2; neutral: Vec2[]; end: Vec2[] }` (neutral at `x = ±6.1, y = ±6.7`; end at `x = ±21.03, y = ±6.7`).
  - `type Zone = 'D' | 'N' | 'O'`; `zoneOf(x: number, attackDir: 1 | -1): Zone`.
  - `resolveBoards(pos: Vec2, vel: Vec2, radius: number, restitution: number): boolean` (mutates, returns true on contact).
  - `type Puck = { pos: Vec2; z: number; vel: Vec2; vz: number }`.
  - `type PuckEvent = { kind: 'boards' } | { kind: 'post'; end: 1 | -1 } | { kind: 'onNet'; end: 1 | -1; y: number; z: number; speed: number } | { kind: 'overNet'; end: 1 | -1 }`.
  - `stepPuck(puck: Puck, dt: number): PuckEvent[]`. Constants: ice friction decay `0.38 /s` on speed while `z === 0`, gravity `9.81`, boards restitution `0.55`. `onNet` fires when the puck crosses a goal line from the front between the posts and under the bar; `stepPuck` does not decide save or goal and stops the puck at the line. A puck reaching the net from the side or back bounces off.

- [ ] **Step 1: Write the failing tests**

```ts
it('zoneOf follows the attack direction', () => { expect(zoneOf(20, 1)).toBe('O'); expect(zoneOf(20, -1)).toBe('D'); expect(zoneOf(0, 1)).toBe('N'); });
it('boards keep a body inside, including corners', () => {
  const p = { x: 40, y: 20 }, v = { x: 5, y: 5 }; expect(resolveBoards(p, v, 0.4, 0)).toBe(true);
  expect(Math.hypot(p.x - (30.48 - 8.53), p.y - (12.955 - 8.53))).toBeCloseTo(8.53 - 0.4, 3);
});
it('a sliding puck slows and stops', () => { const k = puckAt(0, 0, 10, 0); run(k, 20); expect(len(k.vel)).toBeLessThan(0.05); expect(k.pos.x).toBeGreaterThan(15); expect(k.pos.x).toBeLessThan(30.48); });
it('a rim travels around the corner', () => { const k = puckAt(20, 12.5, 25, 0); run(k, 1.5); expect(k.pos.y).toBeLessThan(5); expect(k.vel.x).toBeLessThan(0); });
it('a shot between the posts reports onNet with its crossing point', () => {
  const ev = runUntilEvent(puckAt(20, 0.3, 30, 0, 0.2, 1));
  expect(ev).toMatchObject({ kind: 'onNet', end: 1 }); expect(ev.y).toBeCloseTo(0.3, 1); expect(ev.speed).toBeGreaterThan(25);
});
it('a shot at the post bounces out', () => { expect(runUntilEvent(puckAt(20, 0.95, 30, 0)).kind).toBe('post'); });
it('a high shot goes over', () => { expect(runUntilEvent(puckAt(24, 0, 30, 0, 0.5, 9)).kind).toBe('overNet'); });
it('a puck cannot enter the net from behind', () => { const k = puckAt(29, 0, -20, 0); run(k, 0.5); expect(k.pos.x).toBeGreaterThan(27.13 + 1.0 - 0.01); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement `rink.ts` and `puck.ts`.** Sub-step the puck when it moves more than 0.3 m in a tick so fast shots cannot tunnel through a post or the boards.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: rink geometry and puck physics`

---

### Task 4: Skater movement and bodies

**Files:**
- Create: `packages/engine/src/{skating.ts,bodies.ts}`; modify `types.ts` (add `SkaterState`)
- Test: `packages/engine/test/{skating.test.ts,bodies.test.ts}`

**Interfaces:**
- Consumes: `PlayerDef`, `Vec2`, `resolveBoards`.
- Produces:
  - `type SkaterState = { id: string; side: Side; slot: Position | null; pos: Vec2; vel: Vec2; facing: number; target: Vec2; faceTarget: Vec2 | null; speedCap: number; energy: number; onIce: boolean; leaving: boolean; downT: number; contestId: number | null; shiftStart: number }`.
  - `type Movement = { topSpeed: number; accel: number; turnRate: number; backwardFactor: number; mass: number; radius: number }`; `movementOf(def: PlayerDef, energy: number): Movement`. Top speed `7.2 + speed * 0.022` m/s (9.4 at 100), accel `5 + acceleration * 0.06`, turn rate `2.2 + agility * 0.03` rad/s, backward factor `0.72 + agility * 0.0012`, mass is `weightKg + 9` (equipment), radius `0.38 + (weightKg - 85) * 0.002`. Below energy 0.5, top speed and accel scale down linearly to 85% at energy 0.
  - `stepSkater(s: SkaterState, m: Movement, dt: number): void`. The body can only accelerate along its facing (forward, or backward at `backwardFactor`), turns at `turnRate` (slower at speed: divide by `1 + speed / 6`), and sheds sideways velocity at `6 /s` (edges). When `faceTarget` is set and differs from the travel direction by more than 100°, the skater skates backward. `downT > 0` means no control, friction only.
  - `resolveBodies(skaters: SkaterState[], move: (id: string) => Movement): { a: string; b: string; closing: number }[]` separates overlapping bodies in proportion to mass and returns contacts with closing speed.

- [ ] **Step 1: Write the failing tests**

```ts
it('faster players reach a higher top speed', () => { expect(speedAfter(def({ speed: 95 }), 6)).toBeGreaterThan(speedAfter(def({ speed: 50 }), 6) + 0.7); });
it('a skater cannot turn on the spot at speed', () => {
  const s = movingAt(8, 0); s.target = { x: s.pos.x, y: s.pos.y + 20 }; stepFor(s, 0.5);
  expect(s.vel.x).toBeGreaterThan(3);            // still carrying speed forward
  expect(Math.abs(s.facing)).toBeLessThan(1.2);  // has not snapped to 90 degrees
});
it('skates backward when told to face the play while retreating', () => {
  const s = at(0, 0); s.target = { x: -15, y: 0 }; s.faceTarget = { x: 20, y: 0 }; stepFor(s, 2);
  expect(s.vel.x).toBeLessThan(-3); expect(Math.cos(s.facing)).toBeGreaterThan(0.8);
});
it('backward is slower than forward', () => { expect(backwardSpeedAfter(4)).toBeLessThan(speedAfter(def({}), 4) * 0.85); });
it('tired legs are slower', () => { expect(movementOf(def({}), 0.1).topSpeed).toBeLessThan(movementOf(def({}), 1).topSpeed * 0.92); });
it('a downed skater does not move under his own power', () => { const s = at(0, 0); s.downT = 1; s.target = { x: 10, y: 0 }; stepFor(s, 0.5); expect(len(s.vel)).toBeLessThan(0.1); });
it('bodies do not overlap and the lighter one gives more', () => {
  const big = at(0, 0), small = at(0.3, 0); const c = resolveBodies([big, small], id => id === big.id ? mv(110) : mv(78));
  expect(dist(big.pos, small.pos)).toBeGreaterThanOrEqual(0.74); expect(Math.abs(small.pos.x - 0.3)).toBeGreaterThan(Math.abs(big.pos.x)); expect(c.length).toBe(1);
});
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: skater movement with facing, backward skating, body contact`

---

### Task 5: Game loop, faceoffs, possession, events

**Files:**
- Create: `packages/engine/src/{game.ts,faceoff.ts,stats.ts}`; modify `types.ts`, `index.ts`
- Test: `packages/engine/test/game.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces:
  - `type Phase = 'faceoffSetup' | 'live' | 'stopped' | 'intermission' | 'final'`.
  - `type GameState = { tick: number; period: number; clock: number; phase: Phase; phaseT: number; attackDir: { home: 1 | -1; away: 1 | -1 }; puck: Puck; carrierId: string | null; lastTouch: { id: string; side: Side } | null; possession: Side | null; skaters: SkaterState[]; goalies: { home: GoalieState; away: GoalieState }; contests: ContestState[]; score: { home: number; away: number }; faceoffSpot: Vec2; onIce: { home: string[]; away: string[] } }`. `GoalieState` and `ContestState` are declared here as `{ id: string; pos: Vec2; facing: number; pose: 'stance' | 'butterfly' | 'glove' | 'blocker' | 'pad' | 'cover'; poseT: number }` and `{ id: number; kind: string; stage: string; stageT: number; participants: string[]; leader: string | null; spot: Vec2 }`; later tasks fill them.
  - `type GameEvent = { tick: number; period: number; clock: number; type: 'faceoff' | 'pass' | 'shot' | 'save' | 'goal' | 'miss' | 'post' | 'block' | 'hit' | 'takeaway' | 'giveaway' | 'battle' | 'offside' | 'icing' | 'freeze' | 'lineChange' | 'periodEnd'; side: Side; playerId: string | null; otherId: string | null; assistIds: string[]; detail: string }`.
  - `type PlayerLine = { id: string; goals: number; assists: number; shots: number; hits: number; blocks: number; takeaways: number; giveaways: number; faceoffsWon: number; faceoffsLost: number; plusMinus: number; toiSeconds: number; battlesWon: number; battlesLost: number; saves: number; shotsAgainst: number }`.
  - `type GameResult = { score: { home: number; away: number }; tied: boolean; team: Record<Side, { shots: number; hits: number; blocks: number; faceoffsWon: number; giveaways: number; takeaways: number }>; players: PlayerLine[]; events: GameEvent[]; seed: number }`.
  - `createGame(setup: GameSetup): Game` with `Game = { readonly state: GameState; readonly done: boolean; step(): void; drainEvents(): GameEvent[]; result(): GameResult }`. `createGame` calls `validateSetup`.
  - `simulateGame(setup: GameSetup): GameResult`.
  - `stats.ts`: `buildResult(setup: GameSetup, events: GameEvent[], toi: Map<string, number>): GameResult`.
  - Internal hook used by later tasks: `game.ts` calls, in this order each live tick, `benchTick`, `assignJobs`, `brainTick`, `contestTick`, `stepSkaters`, `resolveBodies`, `goalieTick`, `stepPuck` plus pickup, `refereeTick`. In this task the ones not yet written are no-op functions exported from their future files.

  Behaviour in this task: three 20-minute periods, teams switch ends, centre-ice faceoff to start each period. Faceoff setup lasts 3 s, then the draw is won with `winProb` stand-in `0.5` and the puck goes back to a defenceman. With no brain yet, the nearest skater on each team skates at the puck; a skater within 0.9 m of a loose puck slower than 12 m/s picks it up, and the carrier skates toward the attacking net.

- [ ] **Step 1: Write the failing tests**

```ts
const setup = (seed = 1) => ({ home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] });
it('plays exactly three 20-minute periods', () => {
  const g = createGame(setup()); let ticks = 0; while (!g.done) { g.step(); ticks++; if (ticks > 2e6) throw new Error('runaway'); }
  expect(g.state.phase).toBe('final'); expect(g.result().events.filter(e => e.type === 'periodEnd').length).toBe(3);
});
it('same seed, same game; different seed, different game', () => {
  expect(simulateGame(setup(5))).toEqual(simulateGame(setup(5)));
  expect(simulateGame(setup(5)).events).not.toEqual(simulateGame(setup(6)).events);
});
it('stepping in irregular bursts with reads between matches simulateGame', () => {
  const g = createGame(setup(5)), r = createRng(99); let seen = 0;
  while (!g.done) { for (let i = r.int(1, 400); i > 0 && !g.done; i--) g.step(); seen += g.drainEvents().length; JSON.stringify(g.state); }
  expect(g.result()).toEqual(simulateGame(setup(5))); expect(seen).toBe(g.result().events.length);
});
it('teams switch ends in the second period', () => { const g = createGame(setup()); const d1 = g.state.attackDir.home; runToPeriod(g, 2); expect(g.state.attackDir.home).toBe(-d1); });
it('five skaters and a goalie per side, all inside the boards, every tick', () => {
  const g = createGame(setup(3));
  while (!g.done) { g.step(); for (const side of ['home', 'away'] as const) expect(g.state.onIce[side].length).toBeLessThanOrEqual(5 + 3);   // up to 3 extra mid-change
    for (const s of g.state.skaters) if (s.onIce) { expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(30.48); expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(12.955); expect(Number.isFinite(s.pos.x)).toBe(true); } }
});
it('time on ice adds up', () => { const r = simulateGame(setup()); const total = sum(r.players.filter(isSkaterOf('home')).map(p => p.toiSeconds)); expect(total).toBeGreaterThan(3600 * 5 * 0.97); expect(total).toBeLessThan(3600 * 5 * 1.06); });
it('rejects a bad setup before play', () => { const s = setup(); s.home.lines.goalie = 'nobody'; expect(() => createGame(s)).toThrow(/nobody/); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement `game.ts`, `faceoff.ts`, `stats.ts`.** The game owns one `Rng` created from `setup.seed`; pass it explicitly to every module.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: game loop, periods, faceoffs, possession, event log`

---

### Task 6: Team play and the player brain

**Files:**
- Create: `packages/engine/src/{team-play.ts,brain.ts,actions.ts}`; modify `game.ts`
- Test: `packages/engine/test/{team-play.test.ts,brain.test.ts}`

**Interfaces:**
- Consumes: `GameState`, `PlayerDef`, `Tactics`, `zoneOf`, `composite`, `Rng`.
- Produces:
  - `type TeamPhase = 'breakout' | 'rush' | 'ozone' | 'forecheck' | 'neutralDefence' | 'dzone' | 'looseChase'`; `phaseFor(state: GameState, side: Side): TeamPhase`.
  - `assignJobs(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>): void` sets every on-ice skater's `target`, `faceTarget` and `speedCap`. Defenders with the play coming at them get a `faceTarget` on the puck so they retreat backward. In `ozone`, the three forwards rotate through corner, net-front and high-slot spots (the cycle) and defencemen hold the points. Attackers without the puck never enter the offensive zone ahead of it.
  - `type Decision = { kind: 'carry'; to: Vec2 } | { kind: 'pass'; toId: string } | { kind: 'shoot' } | { kind: 'dump' } | { kind: 'protect' }`.
  - `decideCarrier(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, rng: Rng): Decision`. Options are scored, then one is drawn at random in proportion to score (not always the best), with scores multiplied by the player's tendencies: `shoot`, `pass`, `carry`, `dump`. Vision and IQ decide how many passing options he sees: he considers the best `1 + floor(vision / 25)` lanes. Poise reduces the score penalty for being pressured.
  - `brainTick(state, defs, rng): void` runs `decideCarrier` for the carrier every `BRAIN_INTERVAL_TICKS` and executes through `actions.ts`.
  - `actions.ts`: `executePass(state, fromId, toId, defs, rng)`, `executeShot(state, shooterId, defs, rng)`, `executeDump(state, fromId, defs, rng)`. Pass speed `13 + passing * 0.09` m/s with angular error from `passing`; shot speed `22 + shootingPower * 0.2` m/s, aim point inside the net with spread from `shootingAccuracy`, distance and pressure. Each emits its `GameEvent`.

- [ ] **Step 1: Write the failing tests**

```ts
it('phases track the puck', () => {
  expect(phaseFor(stateWith({ carrier: 'home', puckX: -20 }), 'home')).toBe('breakout');
  expect(phaseFor(stateWith({ carrier: 'home', puckX: 20 }), 'home')).toBe('ozone');
  expect(phaseFor(stateWith({ carrier: 'home', puckX: 20 }), 'away')).toBe('dzone');
});
it('defencemen face the puck while backing up against a rush', () => {
  const st = stateWith({ carrier: 'away', puckX: 5 }); assignJobs(st, defs, tactics);
  const d = skater(st, 'home', 'LD'); expect(d.faceTarget).not.toBeNull(); expect(d.target.x).toBeLessThan(d.pos.x);
});
it('nobody is sent offside', () => {
  const st = stateWith({ carrier: 'home', puckX: 2 }); assignJobs(st, defs, tactics);
  for (const s of onIce(st, 'home')) if (s.id !== st.carrierId) expect(s.target.x).toBeLessThanOrEqual(7.62);
});
it('forwards rotate in the offensive zone', () => {
  const spots = new Set<string>(); const st = stateWith({ carrier: 'home', puckX: 22 });
  for (let t = 0; t < 30 * 40; t++) { st.tick++; assignJobs(st, defs, tactics); spots.add(spotName(st, 'home', 'C')); }
  expect(spots.size).toBeGreaterThanOrEqual(3);
});
it('a sniper in the slot shoots more than a playmaker does', () => {
  expect(rate('shoot', sniper, slotState)).toBeGreaterThan(rate('shoot', playmaker, slotState) + 0.1);
  expect(rate('pass', playmaker, slotState)).toBeGreaterThan(rate('pass', sniper, slotState));
});
it('no option is ever certain', () => { for (const k of ['shoot', 'pass', 'carry'] as const) { expect(rate(k, sniper, slotState)).toBeLessThan(0.97); } });
it('better passers put the puck closer to the target', () => { expect(meanMiss(def({ passing: 95 }))).toBeLessThan(meanMiss(def({ passing: 45 })) * 0.7); });
```
(`rate` runs `decideCarrier` 2,000 times with different seeds and returns the share of each kind.)

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Replace Task 5's chase-the-puck stand-in.
- [ ] **Step 4: Run all tests.** Expected: PASS, including Task 5's determinism and invariant tests.
- [ ] **Step 5: Commit** `feat: team play phases and attribute-driven player brain`

---

### Task 7: Goalies, saves, goals

**Files:**
- Create: `packages/engine/src/goalie.ts`; modify `game.ts`, `stats.ts`
- Test: `packages/engine/test/goalie.test.ts`

**Interfaces:**
- Consumes: `PuckEvent` `onNet`, `GoalieAttrs`, `GameState`, `Rng`.
- Produces:
  - `goalieTick(state, defs, rng, dt): void`: the goalie moves along an arc between puck and net centre at a speed from `lateral`, squares up at a rate from `positioning`, and covers a slow loose puck in the crease (emits `freeze`, phase becomes `stopped`).
  - `saveChance(input: { goalie: GoalieAttrs; lateralMiss: number; shotSpeed: number; distance: number; screened: boolean; goalieMovingSpeed: number; height: number }): number`, clamped to `[0.03, 0.97]`.
  - `tryBlock(state, defs, rng): boolean`, called each tick while a shot is in flight below 1.1 m: a defending skater within 0.5 m of the puck's path, and more than 1.5 m from the shooter, blocks it with chance `clamp(0.12 + shotBlocking * 0.004, 0.03, 0.97)` (once per defender per shot). A block emits `block` and leaves the puck loose.
  - `GameState` gains `screenedUntilTick: Record<Side, number>` (set by Task 11; a shot on a goalie whose side is screened passes `screened: true`).
  - `resolveOnNet(state, ev, defs, rng): 'goal' | 'save'`. A save picks a pose (`glove`, `blocker`, `pad`, `butterfly`) from where the puck crossed, then freezes or rebounds by `reboundControl`. A goal credits the shooter and up to two previous same-team touches as assists, updates plus/minus for everyone on the ice, and sets phase `stopped` with the faceoff at centre.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { goalie: g(70), lateralMiss: 0.2, shotSpeed: 32, distance: 12, screened: false, goalieMovingSpeed: 0, height: 0.4 };
it('better goalies save more, never everything', () => { expect(saveChance({ ...base, goalie: g(95) })).toBeGreaterThan(saveChance({ ...base, goalie: g(50) }) + 0.03); expect(saveChance({ ...base, goalie: g(100), distance: 50 })).toBeLessThanOrEqual(0.97); });
it('being out of position, screens, speed and close range all hurt', () => {
  for (const worse of [{ lateralMiss: 0.9 }, { screened: true }, { shotSpeed: 42 }, { distance: 4 }, { goalieMovingSpeed: 4 }]) expect(saveChance({ ...base, ...worse })).toBeLessThan(saveChance(base));
});
it('an open net is nearly always a goal but a set goalie on a point shot nearly always saves', () => { expect(saveChance({ ...base, lateralMiss: 1.6 })).toBeLessThan(0.2); expect(saveChance({ ...base, distance: 18, lateralMiss: 0.05 })).toBeGreaterThan(0.95); });
it('goals credit scorer, assists and plus/minus', () => {
  const r = simulateUntilFirstGoal(setup(11)); const goal = r.events.find(e => e.type === 'goal')!;
  expect(goal.playerId).not.toBeNull(); expect(goal.assistIds.length).toBeLessThanOrEqual(2); expect(goal.assistIds).not.toContain(goal.playerId);
  expect(sum(r.players.map(p => p.plusMinus))).toBe(0); expect(r.players.find(p => p.id === goal.playerId)!.goals).toBe(1);
});
it('shot blockers block more', () => { expect(share(3000, () => blockAttempt(def({ shotBlocking: 92 })))).toBeGreaterThan(share(3000, () => blockAttempt(def({ shotBlocking: 40 }))) + 0.15); });
it('shots, saves and goals reconcile', () => { const r = simulateGame(setup(4)); expect(r.team.home.shots).toBe(count(r, 'save', 'away') + r.score.home); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: goalies, save resolution, goals and assists`

---

### Task 8: Referee: offside, icing, stoppages

**Files:**
- Create: `packages/engine/src/referee.ts`; modify `game.ts`, `faceoff.ts`
- Test: `packages/engine/test/referee.test.ts`

**Interfaces:**
- Consumes: `GameState`, `RINK`, `FACEOFF_DOTS`.
- Produces: `refereeTick(state, prevPuckX: number): GameEvent | null`.
  - **Offside:** when the puck fully crosses the attacking blue line, any attacker already wholly in the zone is offside unless he carried it in. Delayed offside: play continues while the offending team does not touch the puck and its players clear the zone; touching it stops play. Faceoff at the nearest neutral dot.
  - **Icing:** a puck shot from behind the centre line that crosses the far goal line untouched and not on net is icing when a defender (not the goalie) would reach the end-zone dot line first (hybrid icing). Faceoff in the offending team's zone, and that team may not change lines (`state.noChange: Side | null`, added to `GameState`).
  - **Other stoppages:** goalie freeze, goal, puck trapped (Task 11 emits it). Every stoppage sets `phase: 'stopped'` for 1.5 s, then `faceoffSetup` at the stated spot.
  - `faceoff.ts`: the draw uses the two centres' `faceoffs` attribute through `winProb` (Task 10 replaces the 0.5 stand-in; until then use `0.5 + (a - b) / 400` clamped to `[0.3, 0.7]`).

- [ ] **Step 1: Write the failing tests**

```ts
it('calls offside when an attacker is in the zone before the puck', () => {
  const st = live({ carrier: 'home:C', carrierX: 7.0 }); place(st, 'home:LW', 10, 5); carryTo(st, 8.5);
  expect(refereeUntilCall(st)).toMatchObject({ type: 'offside', side: 'home' }); expect(Math.abs(st.faceoffSpot.x)).toBeCloseTo(6.1, 1);
});
it('no offside when everyone trails the puck', () => { const st = live({ carrier: 'home:C', carrierX: 7.0 }); carryTo(st, 9); expect(refereeUntilCall(st, 60)).toBeNull(); });
it('delayed offside is waved off if they clear the zone', () => { const st = dumpedInWith(offsideWinger()); moveOut(st, 'home:LW'); expect(refereeUntilCall(st, 90)).toBeNull(); });
it('icing from behind centre, faceoff back in the shooters zone, no change allowed', () => {
  const st = live({ carrier: 'home:LD', carrierX: -5 }); shootDownIce(st);
  expect(refereeUntilCall(st)).toMatchObject({ type: 'icing', side: 'home' }); expect(st.faceoffSpot.x).toBeCloseTo(-21.03, 1); expect(st.noChange).toBe('home');
});
it('not icing from past centre, or when it goes on net', () => { expect(icingAfter(shotFrom(2))).toBeNull(); expect(icingAfter(shotFrom(-5, { onNet: true }))).toBeNull(); });
it('not icing when the attacker wins the race', () => { expect(icingAfter(shotFrom(-5), { attackerAhead: true })).toBeNull(); });
it('a full game has a believable number of whistles', () => { const r = simulateGame(setup(8)); expect(count(r, 'offside')).toBeLessThan(20); expect(count(r, 'icing')).toBeLessThan(25); expect(count(r, 'faceoff')).toBeGreaterThan(20); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add a `dump` consideration to `brain.ts`: a carrier under pressure in his own half prefers a pass or carry over an icing.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: offside, hybrid icing, stoppages and faceoff spots`

---

### Task 9: Fatigue and line changes

**Files:**
- Create: `packages/engine/src/bench.ts`; modify `game.ts`
- Test: `packages/engine/test/bench.test.ts`

**Interfaces:**
- Consumes: `Lines`, `Tactics.shiftSeconds`, `SkaterState.energy`, `state.noChange`.
- Produces: `benchTick(state, setup, rng, dt): void`.
  - Energy drains with skating effort (faster at speed, slower with high `stamina`) and recovers on the bench. A 45 s shift at full effort takes an average-stamina player from 1.0 to about 0.55; 90 s on the bench restores about 0.4.
  - Forward lines rotate 1-2-3-4 and pairs 1-2-3, weighted so line 1 plays more: target ice-time shares for forwards 36% / 30% / 21% / 13%, pairs 41% / 34% / 25%. With a short bench, drop the missing unit and rescale the remaining shares to 100%.
  - Changes on the fly happen only when the team has the puck in the neutral or offensive zone, or the puck is deep in the far end; a unit changes when its shift exceeds `shiftSeconds` or its mean energy drops below 0.45. The player nearest the bench goes first; his replacement steps on when he is within 1.5 m of the door. Changes also happen at stoppages unless `noChange` names the team.
  - Bench doors: home at `(-7, -12.2)`, away at `(7, -12.2)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('skating hard drains energy; stamina slows the drain', () => { expect(energyAfterShift(def({ stamina: 50 }), 45)).toBeLessThan(0.65); expect(energyAfterShift(def({ stamina: 95 }), 45)).toBeGreaterThan(energyAfterShift(def({ stamina: 50 }), 45) + 0.05); });
it('the bench restores energy', () => { expect(energyAfterRest(0.5, 90)).toBeGreaterThan(0.85); });
it('ice time follows the line order', () => {
  const r = simulateGame(setup(2)), toi = (id: string) => r.players.find(p => p.id === id)!.toiSeconds, L = setup(2).home.lines;
  expect(toi(L.forwards[0][1])).toBeGreaterThan(toi(L.forwards[3][1]) + 240);
  expect(toi(L.forwards[0][1])).toBeGreaterThan(15 * 60); expect(toi(L.forwards[0][1])).toBeLessThan(23 * 60);
  expect(toi(L.defence[0][0])).toBeGreaterThan(20 * 60); expect(toi(L.defence[0][0])).toBeLessThan(27 * 60);
});
it('shifts are a sensible length', () => { const s = shiftLengths(simulateGame(setup(2))); expect(median(s.forwards)).toBeGreaterThan(30); expect(median(s.forwards)).toBeLessThan(60); });
it('no change for the team that iced it', () => { const st = afterIcingBy('home'); const before = [...st.onIce.home]; runThroughFaceoff(st); expect(st.onIce.home).toEqual(before); });
it('never changes while defending in its own zone', () => { for (const c of lineChangeEvents(simulateGame(setup(6)), 'onTheFly')) expect(c.detail).not.toMatch(/dzone/); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `lineChange` events put the team phase in `detail`.
- [ ] **Step 4: Run all tests.** Expected: PASS (Task 5's time-on-ice sum still holds).
- [ ] **Step 5: Commit** `feat: fatigue, shifts and line changes`

---

### Task 10: Contest framework, parity curve, poke checks and hits

**Files:**
- Create: `packages/engine/src/contests/{core.ts,poke-check.ts,hit.ts}`; modify `game.ts`, `faceoff.ts`, `brain.ts`
- Test: `packages/engine/test/contests/{core.test.ts,poke-check.test.ts,hit.test.ts}`

**Interfaces:**
- Consumes: `GameState`, `ContestState`, `PlayerDef`, `composite`, `Movement`, `Rng`.
- Produces:
  - `winProb(edge: number): number = clamp(1 / (1 + Math.exp(-edge / 24)), 0.1, 0.9)`, where `edge` is a difference in rating points. A 15-point edge gives about 0.65.
  - `effective(def: PlayerDef, state: SkaterState, weights): number`: `composite` adjusted by energy (up to -8 at energy 0), `form` and `morale` (up to ±4 each), and `chemistry` where a contest involves a teammate.
  - `interface Contest { readonly kind: string; start(ctx: ContestCtx): ContestState; update(c: ContestState, ctx: ContestCtx, dt: number): ContestResult | null }` with `ContestCtx = { state: GameState; defs: Map<string, PlayerDef>; rng: Rng; emit(e: GameEvent): void }` and `ContestResult = { winnerId: string | null; puck: 'toWinner' | 'loose' | 'unchanged'; looseVel?: Vec2 }`.
  - `contestTick(state, defs, rng, dt): void` starts contests when their trigger holds, advances them, applies results. A skater in a contest has `contestId` set and is not given a job by `assignJobs`.
  - **Poke check** (`kind: 'pokeCheck'`), stages `reach` (0.25 s) then `resolve`. Trigger: a defender within 1.6 m of the carrier, in front of or beside him, at most once per 1.5 s per defender. Edge: defender `stickChecking 0.6, defensivePositioning 0.25, iq 0.15` against carrier `puckHandling 0.6, poise 0.25, balance 0.15`, then minus 12 (the carrier is favoured). Success: 50% the checker takes it (`takeaway`), 50% loose. Failure by a wide margin (roll in the bottom 15%): the defender is beaten and loses a step (`speedCap` halved for 0.7 s).
  - **Hit** (`kind: 'hit'`), stages `close` (until contact or 1.2 s), `impact` (0.15 s), `recover`. Trigger: a defender with `tendencies.hit * aggression / 100` above a random draw, within 3 m of a carrier or a player who released the puck less than 0.6 s ago, closing at more than 2 m/s. Edge: hitter `bodyChecking 0.5, strength 0.3, balance 0.2` plus `(hitterMass * closingSpeed - targetMass * 2) / 12`, against target `balance 0.45, strength 0.35, poise 0.2`. Hitter wins: target `downT` 0.6 to 1.4 s scaled by margin, puck loose, `hit` event. Target wins: he absorbs it and keeps the puck; on a roll in the bottom 10% the hitter bounces off and goes down for 0.5 s. A missed hit takes the hitter out of the play for 0.8 s.
  - `faceoff.ts` now uses `winProb(effective(faceoffs) difference)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('parity curve', () => { expect(winProb(0)).toBeCloseTo(0.5, 5); expect(winProb(15)).toBeGreaterThan(0.62); expect(winProb(15)).toBeLessThan(0.68); expect(winProb(500)).toBe(0.9); expect(winProb(-500)).toBe(0.1); expect(winProb(10) + winProb(-10)).toBeCloseTo(1, 5); });
it('tired or out-of-form players are worse, a little', () => { const w = { strength: 1 }; expect(effective(d, st({ energy: 0 }), w)).toBeCloseTo(effective(d, st({ energy: 1 }), w) - 8, 0); });
it('the better stick wins more poke checks, not all', () => {
  const p = share(2000, () => runPoke(def({ stickChecking: 92, defensivePositioning: 85 }), def({ puckHandling: 60 })));
  const q = share(2000, () => runPoke(def({ stickChecking: 55 }), def({ puckHandling: 92, poise: 88 })));
  expect(p).toBeGreaterThan(q + 0.15); expect(p).toBeLessThan(0.9); expect(q).toBeGreaterThan(0.1);
});
it('a poke check takes time and is visible in state', () => { const c = startPoke(); expect(c.stage).toBe('reach'); expect(stepsUntilDone(c)).toBeGreaterThanOrEqual(Math.floor(0.25 / DT)); });
it('size and speed make hits land; the small man still wins some', () => {
  const big = share(2000, () => runHit(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6));
  const small = share(2000, () => runHit(def({ bodyChecking: 60, strength: 58, weightKg: 78 }), def({ balance: 88, strength: 90, weightKg: 104 }), 6));
  expect(big).toBeGreaterThan(small + 0.2); expect(small).toBeGreaterThanOrEqual(0.1); expect(big).toBeLessThanOrEqual(0.9);
});
it('a landed hit puts the target down and frees the puck', () => { const st = hitThatLands(); expect(target(st).downT).toBeGreaterThan(0.5); expect(st.carrierId).toBeNull(); });
it('enforcers hit more often than playmakers over a game', () => { const r = simulateGame(setup(3)); expect(hitsPer60(r, 'Enforcer', 'Grinder')).toBeGreaterThan(hitsPer60(r, 'Playmaker', 'Sniper')); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: staged contests, parity curve, poke checks and hits`

---

### Task 11: Board battles, net-front battles, loose-puck races

**Files:**
- Create: `packages/engine/src/contests/{board-battle.ts,net-front.ts,loose-race.ts}`; modify `contests/core.ts` (registry), `team-play.ts`
- Test: `packages/engine/test/contests/{board-battle.test.ts,net-front.test.ts,loose-race.test.ts}`

**Interfaces:**
- Consumes: `Contest`, `winProb`, `effective`, `ContestState`.
- Produces three more `Contest` implementations. Each `ContestState.stage` and `leader` must change as the contest goes, so the viewer can show who is winning and how.
  - **Board battle** (`boardBattle`). Trigger: the puck within 1.2 m of the boards, slower than 6 m/s, with one player from each team within 2 m. Stages:
    1. `arrive` (0.3 to 0.8 s): who gets there first, from distance and speed. First man gets +6 edge for the rest of the battle.
    2. `pin` (0.8 to 1.6 s): body against body. Edge: `strength 0.45, balance 0.3, compete 0.25` plus `(massA - massB) / 4`. The winner becomes `leader` and holds the other on the boards.
    3. `dig` (1.0 to 2.5 s): sticks and feet at the puck. Edge: `stickChecking 0.35, puckHandling 0.3, compete 0.2, agility 0.15`. A pinned player digs at -10. So a strong player wins by pinning, a quick stick can win the puck while pinned.
    4. `support`: at any point after `arrive`, the first teammate of either side within 2.5 m joins, giving his side +8 and making that side's win send the puck to him.
    5. `resolve`: the `dig` winner wins it clean (`toWinner`) with probability 0.6, or it squirts loose along the boards. If neither side wins `dig` after two rounds (each round is one `winProb` draw that must be won twice by the same side to end), the puck is trapped: emit `freeze` with `detail: 'trapped'` and stop play for a faceoff at the nearest end or neutral dot.
    Emits `battle` with `detail` one of `pinned`, `stick`, `support`, `scramble`. Counts `battlesWon` and `battlesLost`.
  - **Net-front** (`netFront`). Trigger: an attacking forward at his net-front spot with a defender within 1.5 m while his team has the puck in the zone. Stages `jostle` (repeats every 1.2 s) and `tied` or `free`. Edge: `strength 0.4, balance 0.3, compete 0.3` plus mass term, against the same. The attacker winning a round holds position, sets `screenedUntilTick` for the defending side 1.2 s ahead, and is first to a rebound (+10 in a following loose race). The defender winning moves him 1.5 m out and ties up his stick (he cannot receive a pass or get a rebound for 1.2 s). No puck change by itself.
  - **Loose-puck race** (`looseRace`). Trigger: a loose puck slower than 12 m/s, not near the boards, with one player from each team who would both arrive within 0.4 s of each other. Stages `race` then `resolve`. Edge: arrival-time difference times 40, plus `compete 0.4, agility 0.3, balance 0.3`. Winner takes it; a roll within 0.08 of the threshold makes it a 50/50 bounce that stays loose.
  - `team-play.ts`: `supportTarget(state, side): Vec2 | null` sends the nearest free teammate to support an active board battle.

- [ ] **Step 1: Write the failing tests**

```ts
const pf = def({ strength: 92, balance: 88, compete: 85, weightKg: 102, stickChecking: 62, puckHandling: 66 });
const twoWay = def({ strength: 70, balance: 74, compete: 82, weightKg: 88, stickChecking: 88, puckHandling: 76, agility: 82 });
it('the power forward wins most board battles against the two-way forward, not all', () => { const s = share(3000, () => runBattle(pf, twoWay).winner === 'a'); expect(s).toBeGreaterThan(0.55); expect(s).toBeLessThan(0.75); });
it('they win in different ways', () => {
  const r = Array.from({ length: 3000 }, () => runBattle(pf, twoWay));
  expect(shareOf(r.filter(x => x.winner === 'a'), x => x.detail === 'pinned')).toBeGreaterThan(shareOf(r.filter(x => x.winner === 'b'), x => x.detail === 'pinned') + 0.2);
  expect(shareOf(r.filter(x => x.winner === 'b'), x => x.detail === 'stick')).toBeGreaterThan(0.4);
});
it('a battle goes through visible stages and lasts 2 to 6 seconds', () => { const log = stagesOf(runBattleLogged(pf, twoWay)); expect(log.map(l => l.stage).slice(0, 3)).toEqual(['arrive', 'pin', 'dig']); expect(totalSeconds(log)).toBeGreaterThanOrEqual(2); expect(totalSeconds(log)).toBeLessThanOrEqual(6.5); });
it('the leader is exposed while it runs', () => { expect(runBattleLogged(pf, twoWay).some(s => s.stage === 'pin' && s.leader !== null)).toBe(true); });
it('support swings it and gets the puck', () => { const withHelp = share(3000, () => runBattle(twoWay, pf, { supportFor: 'a' }).winner === 'a'); expect(withHelp).toBeGreaterThan(share(3000, () => runBattle(twoWay, pf).winner === 'a') + 0.08); expect(runBattleWon(twoWay, pf, { supportFor: 'a' }).puckTo).toBe('support'); });
it('first man in has an edge', () => { expect(share(3000, () => runBattle(even, even, { firstIn: 'a' }).winner === 'a')).toBeGreaterThan(0.53); });
it('a stalemate is whistled dead', () => { expect(Array.from({ length: 3000 }, () => runBattle(even, even)).some(x => x.winner === null && x.detail === 'trapped')).toBe(true); });
it('a net-front winner screens the goalie', () => { const st = netFrontWonByAttacker(); expect(isScreened(st)).toBe(true); });
it('a tied-up forward cannot take a pass', () => { const st = netFrontWonByDefender(); expect(canReceive(st, attackerId)).toBe(false); });
it('the closer man usually wins the race', () => { expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeGreaterThan(0.7); expect(share(2000, () => runRace({ aLead: 0.3 }).winner === 'a')).toBeLessThanOrEqual(0.9); });
it('a full game has plenty of battles', () => { const r = simulateGame(setup(3)); expect(count(r, 'battle')).toBeGreaterThan(40); expect(count(r, 'battle')).toBeLessThan(220); });
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: board battles, net-front battles, loose-puck races`

---

### Task 12: Calibration to realistic 5-on-5 totals, robustness

**Files:**
- Create: `packages/engine/scripts/calibrate.ts`, `packages/engine/src/tuning.ts`; modify whichever modules hold the constants being tuned (move them into `tuning.ts`)
- Test: `packages/engine/test/{calibration.test.ts,robustness.test.ts}`

**Interfaces:**
- Consumes: `simulateGame`, `generateTeam`.
- Produces:
  - `tuning.ts`: one exported `TUNING` object holding every tunable number from Tasks 6 to 11 (shot-choice weights, save-chance coefficients, contest trigger rates, hit frequency, pass error). Modules read from it.
  - `npm run calibrate -- --games 1000` prints per-team-per-game means for goals, shots, save %, hits, blocks, giveaways, takeaways, faceoffs, offsides, icings, battles, home win share, tie share, and mean milliseconds per game.

- [ ] **Step 1: Write the tests** (calibration uses 300 games of two `overall: 70` teams with different roster seeds each game; allow up to 120 s for the file)

```ts
it('5-on-5 totals look like hockey', () => {
  const m = summarise(runGames(300));
  expect(m.goals).toBeGreaterThan(2.1);   expect(m.goals).toBeLessThan(3.0);
  expect(m.shots).toBeGreaterThan(26);    expect(m.shots).toBeLessThan(34);
  expect(m.savePct).toBeGreaterThan(0.900); expect(m.savePct).toBeLessThan(0.928);
  expect(m.hits).toBeGreaterThan(14);     expect(m.hits).toBeLessThan(30);
  expect(m.blocks).toBeGreaterThan(9);    expect(m.blocks).toBeLessThan(19);
  expect(m.faceoffsTotal).toBeGreaterThan(42); expect(m.faceoffsTotal).toBeLessThan(72);
  expect(m.offsidesTotal).toBeGreaterThan(2);  expect(m.offsidesTotal).toBeLessThan(11);
  expect(m.icingsTotal).toBeGreaterThan(3);    expect(m.icingsTotal).toBeLessThan(13);
  expect(m.tieShare).toBeGreaterThan(0.15);    expect(m.tieShare).toBeLessThan(0.30);
});
it('the better team wins more, and loses plenty', () => { const w = winShare(runGames(300, { homeOverall: 76, awayOverall: 66 })); expect(w.home).toBeGreaterThan(w.away + 0.12); expect(w.away).toBeGreaterThan(0.15); });
it('snipers outscore grinders per 60 minutes', () => { const g = goalsPer60ByType(runGames(300)); expect(g['Sniper']).toBeGreaterThan(g['Grinder'] * 1.5); });
it('heavier, stronger players win more battles, under 75%', () => { const b = battleWinShareByType(runGames(300)); expect(b['Power Forward']).toBeGreaterThan(b['Speedster'] + 0.05); expect(b['Power Forward']).toBeLessThan(0.75); });
it('a game runs within budget', () => { const t0 = performance.now(); for (let i = 0; i < 5; i++) simulateGame(setup(i)); expect((performance.now() - t0) / 5).toBeLessThan(3000); });

// robustness.test.ts
it('the puck is never left alone', () => {
  for (let seed = 0; seed < 30; seed++) { const g = createGame(setup(seed)); let idle = 0, last = '';
    while (!g.done) { g.step(); const s = g.state; const key = s.carrierId + '|' + (s.lastTouch?.id ?? '');
      if (s.phase !== 'live' || key !== last || s.contests.length > 0) idle = 0; else idle += DT; last = key; expect(idle).toBeLessThan(15); } }
});
it('a hopeless mismatch still plays like a game', () => {
  const r = simulateGame({ ...setup(1), home: generateTeam(1, 'A', 'A', 95), away: generateTeam(2, 'B', 'B', 10) });
  expect(r.score.home + r.score.away).toBeLessThanOrEqual(20); expect(r.team.away.shots).toBeGreaterThan(3); expect(sum(playersOf(r, 'away').map(p => p.battlesWon))).toBeGreaterThan(0);
});
it('no NaN ever reaches the result', () => { for (let s = 0; s < 30; s++) expect(JSON.stringify(simulateGame(setup(s)))).not.toMatch(/NaN|null,null/); });
```

- [ ] **Step 2: Run them.** Expected: the calibration bands FAIL at first (untuned). Robustness tests should pass; fix the engine, not the test, if they do not.
- [ ] **Step 3: Write `calibrate.ts`, move constants into `tuning.ts`, and tune.** Change one group of numbers at a time and re-run `npm run calibrate -- --games 300`, in this order, because each depends on the one before: shot volume (shot-choice weights, possession length), then save percentage (save-chance coefficients), then hits and blocks, then whistles. Never tune by widening `winProb`'s clamp or its divisor of 24.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: calibrate 5-on-5 totals, robustness checks`

---

### Task 13: Top-down debug view

**Files:**
- Create: `apps/debug/{package.json,index.html,vite.config.ts,src/main.ts,src/draw.ts}`; add root script `"debug": "npm -w apps/debug run dev"`
- Test: `apps/debug/src/draw.test.ts`

**Interfaces:**
- Consumes: `createGame`, `generateTeam`, `GameState`, `GameEvent`, `DT`, `RINK`.
- Produces: a developer tool, not the product view (the spec's 3D viewer is part 2). `draw(ctx: CanvasRenderingContext2D, state: GameState, defs: Map<string, PlayerDef>, scale: number): void` and `labelFor(c: ContestState, defs): string`.
  - Rink to scale with lines, dots, creases, nets.
  - Each skater a circle sized by `Movement.radius`, team colour, number, a facing tick, dimmed when `energy < 0.45`, an X when down. The carrier is ringed.
  - Each active contest: a line between participants and a label from `labelFor`, for example `Board battle · pin · Osgood leading`.
  - Controls: seed input, play/pause, speed 1×/4×/16×, step one tick, "sim to end". A scrolling event list and the live box score from `game.result()`.
  - The loop runs `game.step()` enough times per animation frame to match the chosen speed.

- [ ] **Step 1: Write the failing test**

```ts
it('labels a contest with kind, stage and leader', () => {
  expect(labelFor({ id: 1, kind: 'boardBattle', stage: 'pin', stageT: 0.4, participants: ['a', 'b'], leader: 'a', spot: { x: 0, y: 0 } }, defsWith({ a: 'Dmitri Osgood', b: 'Finn Aldous' }))).toBe('Board battle · pin · Osgood leading');
  expect(labelFor({ id: 2, kind: 'looseRace', stage: 'race', stageT: 0, participants: ['a', 'b'], leader: null, spot: { x: 0, y: 0 } }, defsWith({ a: 'A B', b: 'C D' }))).toBe('Loose-puck race · race');
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement the app.**
- [ ] **Step 4: Run tests, then `npm run debug`, open the page, and watch one full period at 4×.** Expected: tests PASS; on screen, breakouts, zone entries, a cycle, line changes at the benches, defencemen retreating facing the puck, and board battles whose labels step through arrive, pin, dig. Write down anything that looks wrong as an issue for part 2 rather than fixing viewer-only cosmetics here.
- [ ] **Step 5: Commit** `feat: top-down debug view`
