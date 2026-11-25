# Engine round 2 Part A: what changed for the viewer

Written at the end of Part A (Task 14) for the viewer's re-baseline. It lists everything the engine now says that the
viewer used to guess, every event and state field that is new or means something else, and what the viewer must
change. Sources: the `Meaning changes:` lines of every commit on `engine-round-2` since `main`
(`git log main..engine-round-2 --grep "Meaning changes"`), the "Changes for the viewer" sections of the task reports
(Tasks 6 to 13b), and the diff of `packages/engine/src/types.ts` against `main`.

The engine's public surface is additive: nothing was removed from `src/index.ts`, no required field was added to
`SkaterState` or `GoalieState`, and `SavePose` and `ContestKind` have no new value. The viewer's typecheck passes
against this engine today. Its picture tests and sample-dependent numbers do not: play is different in every game.

## 1. Left and right: the viewer must flip its mapping

- The engine's convention (unchanged, now tested): a player's left is the side at `facing + PI/2` (counter-clockwise
  with +x right, +y up). Facing +x, his left is +y. The left winger lines up at +y when his team attacks +x.
- `PlayerDef.shoots: 'L'` means his stick blade is on his left. The carried puck is now on the blade: 0.9 m ahead of
  him and 0.4 m to his shooting side (`BLADE`, exported; it was 0.6 m straight ahead).
- `PlayerDef.catches?: 'L' | 'R'` (new, default `'L'`): a goalie's glove is on that side. A glove save is on the
  catching side; the `cross.side` of a save says where the puck met him (see section 2).
- The viewer draws engine `y` as world `+Z`, which mirrors left and right: a left shot's puck is drawn on the figure's
  right, and the glove on the wrong hand. The re-baseline flips the mapping (or negates y) and deletes the viewer's
  own `GOALIE_CATCHES` table: read `PlayerDef.catches` (and `shoots` for skaters) instead.

## 2. Events: new types and new or changed fields

New event types:

| type | detail | meaning |
|---|---|---|
| `tip` | `{ releaseTick, vel }` | an attacker in front deflected a shot; `playerId` the tipper, `otherId` the shooter; `vel` is the puck's new velocity |
| `stop` | `{ pose, kind, speed }` | the goalie stopped a puck that was not shot (a pass through his crease, a centring feed, a hard clear at his net); no shot on goal |
| `engagement` | `{ kind: 'boxOut' \| 'tieUp' \| 'ride' \| 'lean', seconds, result, a, b }` | a two-man battle for position ended (`result`: heldPosition, foughtThrough, spunOff, released, contest, whistle) |
| `outOfPlay` | `{ spot, where: 'glass' \| 'netting' \| 'bench' }` | the puck left the rink; play stops that tick; the faceoff is at `spot` (from where the puck was last played) |

Changed events:

- `release`: gains `shotType: 'wrist' | 'slap' | 'oneTimer' | 'backhand' | 'wraparound' | null` (null unless kind is
  `shot`). `kind` is still `'pass' | 'shot' | 'dump'`: a rim, a clear and a hard clear release as `dump` (a hard
  clear is lifted: `vel.z > 0`). Shot speeds are real: wrist and snap shots 70 to 90 mph by shooting power, slapshots
  84 to 104 (at most 107.8 mph with the Heavy Slapshot badge), one-timers near a slapshot, backhands three quarters
  of a wrist shot. A shot with a checker in stick reach leaves slower.
- `pass`: `kind` is `'pass' | 'dump' | 'rim' | 'clear'` (a clear was a `dump`; `dump` is now only a dump-in);
  `hand: 'forehand' | 'backhand' | 'behind' | null`; `distance` is to the pass's aim (the receiver's blade at
  arrival); optional `hard: true` on a `clear` that is fired off the glass or flipped down the ice.
- `shot`: emitted where the puck meets the goalie (his plane), not on the goal line, and only for a real shot
  (`releaseTick` is never null). Gains `cross: { side, height }` (where it crossed him: metres across from his centre,
  + to his left; metres up), `shotType`, `tippedFrom` (the shooter's id when it was tipped; `playerId` is then the
  tipper), `screened`, `rebound` (released within 3 s of a save on that net), and optional `screen` (0 to 1: the
  share of its flight his sight of it was blocked). `distance` is from the release (or tip) point to the net centre.
- `save`: gains `kind: 'held' | 'steered' | 'rebound'` and `cross`. A held save is followed by `freeze`; a steered
  puck goes to the corner; a rebound is left loose in front. The save's `pos` is at the goalie's plane.
- `goal`: follows its `shot` by up to 4 ticks (the puck travels from his plane to the line); a shot that beats him by
  a post has both on one tick. Gains `cross`, `shotType`, `tippedFrom`, `screened`, `rebound`. A `goal` with
  `releaseTick: null` is a puck that went in without a shot (no `shot` event before it).
- `screened` (on `shot`, `save`'s shot, `goal`): since Task 14 it means the goalie's sight of the puck was blocked for
  half its flight or more, by a skater of either team (his own defencemen screen him too). It was "an attacker on
  the line at the save, or a net-front battle just won".
- `miss`, `post`: gain `tippedFrom`. A shot cut short by a whistle or the horn ends with a `miss`. Missed shots stay
  in play and ring round the boards.
- `block`: `pos` is at the blocker (the puck stops there). A block can come on the tick of its `release`, by the
  stick of a checker within 1.8 m of the shooter.
- `hit`: gains `degree: 'bump' | 'stagger' | 'knockdown' | null`. A landed hit no longer always knocks the man down
  (about a third do) nor always frees the puck. A staggered man keeps his feet and skates at a fraction of his speed
  for a moment (`GameState.staggered`).
- `battle`: gains `winnerSupportId` and `loserSupportId` (the supporters, named and on their side).
- `contestEnd`: `winnerId` of a board battle is the man who won it; new `puckTo` says who has, or is being passed,
  the puck; optional `looseSpeed` when the puck is knocked loose. A net-front battle is decided by one round. A
  loose-race `contestEnd` (`won`, `toWinner`) comes when the winner reaches the puck, up to 1 s after the draw. A poke
  check that takes or frees the puck never shows its `resolve` stage.
- `turnover`: `how: 'deflected'` with `otherId` the clearer can be a hard clear knocked down; a pass of any speed can
  be picked off (`intercepted` / `deflected`).
- `freeze` with cause `cover`: the goalie may skate out of his arc to a loose puck in his crease and cover it; after
  a cover he skates back to the middle of his crease while the cover pose still runs.
- `icing`: happens now (about 5 to 6 a game); men heading off for a change are not in the race.
- `faceoffSetup`: lasts as long as the line-up takes (measured up to about 11 s; safety limit 25 s). Line-ups: only
  the centres inside the circle, wingers on the hash marks 5.2 m to each side of the dot, at an end-zone draw the
  attacking defencemen at the points and a defending defenceman at the net front; everybody faces the right way; the
  goalie stands in the middle of his crease facing up ice or the dot.
- `takeaway`: credited only when the man who lost the puck had held it 2.5 s (was 1.5 s).
- `lineChange`: a change on the fly can start with the puck loose and going up ice.

Record (box score): `PlayerLine` and `TeamLine` gain `attempts`, `missedShots`, `shotsBlocked`.

## 3. State: new fields and what a viewer can draw from them

| field | what it is | what to draw |
|---|---|---|
| `plans: SkaterPlan[]` (one per skater, same index) | his job (`Job`), held target, `effort: 'glide' \| 'skate' \| 'sprint'`, `slow`, what he follows (`spot` / `puck` / `man`, `markId`) | stride or glide animation from `effort`; who he is covering; job labels in a debug overlay |
| `teamPhase` | each team's committed phase (follows the raw one after 0.5 s) | team shape labels |
| `carrierPlan` | what the carrier has decided (`kind`: carry, pass, shoot, dump, protect, rim, clear, hardClear; `lane`, `toId`, `to`) | wind-up before a pass or shot; head turned to `toId` |
| `engagements: Engagement[]` | the pairs battling for position now (`a`, `b`, `kind`, `inside`, ties) | two bodies leaning on each other instead of the old separation; box-outs at the net |
| `staggered` | men who lost a step to a hit, until which tick | a stumble |
| `lastSave` | the last save on a net (`kind`), for 3 s | rebound scramble state |
| `shotInFlight` additions | `shotType`, `tippedBy`, `rebound`, `screened`, `sight` (ticks watched / blocked), `faced`, `cross`, `beat` | the shot's look in flight; a goalie beaten (`beat`) before the goal |
| `pendingPass` additions | `aim` (where the pass is going), `bobbled`, `oneTimer`, `cover` | the receiver reaching to `aim`; a bobble; a one-timer wind-up |
| `hardClear` | a hard clear on its way | a lifted puck off the glass |
| `lastPlayedAt` | the puck's place at its last touch | where an out-of-play faceoff will be |
| `oneTimerTaken` | a one-timer pass just taken | shoot without settling |
| `screenedUntilTick` | no longer written (always 0) | stop reading it |

`SkaterState.speedCap` means the share of his top speed he wants now (his effort), not a cap by job.

## 4. Existing fields that mean something else

- Speeds. Top skating speed is real: 19.9 mph (8.9 m/s) at a speed rating of 40, 22.2 mph at 70, 24.5 mph at 99. A
  skater on his feet is never above his top speed. His push fades as he nears it, so he is at half of it in 0.7 s and
  at 90% only after about 2 s of straight ice. In play he cruises: about 80% of live time under 75% of his top speed
  and under 1% at 90% or more; a "sprint" is hard skating at 80%, flat out only in a race for the puck, on a
  breakaway and getting back against one. Animation speeds tied to the old engine (everyone near top speed a quarter
  of the time) will look wrong: drive stride rate from the skater's actual speed and `plans[i].effort`.
- Skaters coast, ease or stop (`SlowMode`) and carve their turns: a turn at speed is an arc, not a pivot. They hold a
  job and a target for at least 0.4 s; defencemen back up facing the play.
- The carried puck is at the blade and moves at most 0.4 m a tick; no hand-over moves it more than 1.2 m (the
  largest measured is 1.18 m); a save leaves the puck where it met the goalie. The viewer's smoothing of puck jumps
  can go.
- `shot` / `save` / `goal` timing and place (section 2): saves are made at the goalie, the goal comes ticks later.
- Bodies in contact are no longer always pushed apart: engaged pairs are held at contact. Skaters cannot pass through
  a goalie.
- A hard puck into the boards comes off them slower; a puck out of play lies on the ice at the boards where it left
  for the 1.5 s stoppage.
- Generated rosters are different from before in every game (styles, badges, catching hand, tactics), so every
  sample-dependent number and picture hash changes.

## 5. Setup inputs that are new (all optional, with defaults)

- `Tactics`: `zoneEntry: 'carry' | 'dump' | 'mixed'` (default mixed), `offence: 'cycle' | 'pointShots' | 'rush'`
  (cycle), `defence: 'collapse' | 'pressure'` (collapse), `pinch: 'often' | 'sometimes' | 'rarely'` (sometimes);
  `forecheck` as before. `resolveTactics` (exported) fills in the defaults. `generateTeam` gives each team the
  tactics that suit its roster.
- `PlayerDef.style?: { primary, secondary }` (an override of the label), `badges?: Badge[]` (19 badges),
  `catches?: 'L' | 'R'`, `tendencies.block?: number`. `validateSetup` now fails a roster with a missing or lower-case
  `shoots`.
- New exports: `resolveTactics`, `ResolvedTactics`, `STYLES`, `styleOf` (primary and secondary style and the label,
  e.g. "Two-Way Forward / Sniper"), `styleLabel`, `StyleDef`, `BADGES`, `BLADE`. New type `'Shutdown Forward'` among
  the player types.

## 6. Viewer guesses each of these replaces

| the viewer guessed | read instead |
|---|---|
| which hand the goalie catches with (`GOALIE_CATCHES`) | `PlayerDef.catches` |
| where on the goalie a save was made, and the save animation | `save.pose`, `save.cross` (side and height), `save.kind` |
| whether a save was held or left a rebound | `save.kind`, then `freeze` or a loose puck; `shot.rebound` for the second chance |
| the kind of shot (from speed) | `release.shotType`, `shot.shotType` |
| deflections in front | the `tip` event, `tippedFrom` |
| the kind of pass (from speed and direction) | `pass.kind`, `pass.hand`, `pass.hard`, `pendingPass.aim`, `pendingPass.oneTimer` |
| how hard a hit was (everyone fell) | `hit.degree`, `staggered` |
| who won a board battle and who has the puck | `contestEnd.winnerId` and `puckTo`, `battle.winnerSupportId` / `loserSupportId` |
| bodies jostling (from overlap) | `engagements`, the `engagement` event |
| where the puck is on the carrier | the blade (`BLADE`, `shoots`); the engine's puck position is already there |
| what a skater is doing | `plans[i].job`, `effort`, `markId`; `carrierPlan`; `teamPhase` |
| why play stopped | `outOfPlay` (new), `icing`, `offside`, `freeze` causes, `stop` |
| faceoff line-ups | the skaters' positions during `faceoffSetup` (they skate to their spots and face the dot) |
| player labels | `styleOf(def).label`, `def.badges` |
