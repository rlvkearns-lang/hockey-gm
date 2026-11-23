# Hockey GM sim: 3D viewer design (stage 1, part 2)

Date: 2026-11-23
Status: written under the working agreement (`docs/superpowers/working-agreement.md`): building starts without waiting for approval, the owner reviews when he is back, and work stops for him at the skating test.

Lines marked **[my call]** are choices Claude made that the owner has not explicitly agreed to. Everything else came from the owner, mostly via `notes-3d-viewer.md`.

## Intent

Watching games in 3D is the main thing the owner wants that existing hockey management games lack. The engine now plays a full, deterministic 5-on-5 game. This part puts a picture on it: the same game, seen from the stands, with players who skate properly and battles that can be read from the picture alone.

## What this part delivers

A page in the browser where the owner picks a seed, watches the game in 3D from several camera angles or lets an automatic director choose, sees who is on the ice and the score, gets replays of goals, and ends on a post-game screen with three stars and the box score. Plus a player card that shows a player's 3D model.

It is built in milestones. The first is a skating test, and work stops there for the owner to judge it.

## Goals

1. **The picture shows the engine's game, exactly.** The viewer never decides anything. Same seed, same result as an unwatched sim.
2. **Proper skating.** Stride, glide, stop, turn, crossovers, backward skating. This is the biggest risk and is proven first.
3. **Readable battles.** For each staged contest the picture shows who is doing what: who pins, who digs, who arrives in support, who wins the race.
4. **Players look like who they are.** Height and build are obvious. Jersey, name and number. The prototype's simple-bodied look was approved and is kept.
5. **Cameras.** No free-fly camera. Pickable angles: broadcast side view following play, overhead, behind either net, ice level along the boards, follow one player. An automatic director cuts between them. The owner can switch between his own angle and the director at any time.
6. **Replays.** Goals always; big saves and big hits may get one. Another angle, slowed, skippable.
7. **On-screen information.** A score bug (score, clock, period, shots). Who is on the ice as three options that can each be turned off: names under the players, a strip along the bottom, a side panel with energy and shift time. Long shifts flagged in amber. Game stats under the picture behind a button. No running play-by-play over the ice.
8. **Around the game.** A short pre-game screen (skippable), a quick intermission summary (skippable), a proper post-game (three stars, box score, goal replays). A slot after the post-game for media scrums, filled in the people stage.
9. **Player card.** A player's 3D model in a pose that suits his type, slowly turning, draggable. No face portraits (on hold by the owner's decision).
10. **Runs on a laptop.** Smooth on integrated graphics at the low setting; better looking on a gaming PC at high. Settings change looks only.

## Not in this part

- Penalties, power plays, injuries, overtime, fights (engine rounds 2 and 3), and the condensed viewing lengths that come with round 2. This part has playback speed, pause, and skip to end.
- Sound (wanted later: rink and crowd, no commentary).
- Realistic faces and portraits (on hold).
- A living crowd (later, on high settings).
- Real team logos (generated crests come with the league stage; here teams have colours and a simple placeholder crest **[my call]**).
- Tactics, cycling, point shots, tips (engine round 2). The viewer shows whatever the engine plays.

## How it works **[my call throughout]**

**App.** A new workspace `apps/viewer` (TypeScript, Vite, three.js), importing the engine through its public surface only. It also builds to a single self-contained page so it can be shared as a link, like the debug view.

**Running the game.** The engine runs in a background thread. On load it plays the whole game once (about 1.5 seconds), keeping the event log and a snapshot every few seconds of game time. Playback then re-runs the engine from the nearest snapshot, which is exact because the engine is deterministic and can resume. This gives seeking, replays and a director that knows what is coming, with no second source of truth.

**Smooth motion.** The engine ticks 30 times a second. The viewer draws at the screen's rate by blending between the two nearest ticks.

**Skaters.** A jointed figure built in code from simple shapes: pelvis, torso, head with helmet, upper and lower arms, gloves, upper and lower legs, skates, and a stick. Proportions come from the player's height and weight. No imported models or motion data.

**Animation is generated, not recorded.** Each frame, a skater's pose is worked out from what the engine says he is doing:
- *Skating.* Speed, acceleration, turn rate, and whether he is going forward, backward or crossing over drive a stride cycle: push and glide when accelerating, a low glide when coasting, crossovers when turning hard, C-cuts when going backward, a sideways stop with the body leaning back when braking. Feet are placed so skates point along the glide and do not slide sideways. Body lean follows acceleration and turning.
- *Stick and puck.* The blade stays on the ice; when he carries the puck the blade is on it.
- *Actions.* Pass, shot (wind-up and follow-through timed to the engine's release moment), dump, poke check, hit and being hit, falling and getting up, blocking a shot.
- *Contests.* Each stage of each contest has its own stance driven by the engine's roles: the pinner leaning his man into the boards, the pinned man protecting the puck, sticks digging at feet, the supporter arriving, the winner coming away with it. Net-front shoving, races for loose pucks.
- *Goalies.* Stance, shuffles and slides across the crease, butterfly, glove and blocker saves, covering the puck.

**Watch-only physics.** Reactions to hits and falls are shaped by the hit's speed and direction for looks only. Nothing here feeds back into the engine.

**Rink and arena.** The rink to scale with lines, creases, nets, boards and glass. A simple arena: stands with a still crowd as coloured blocks, a scoreboard, team colours on the boards, a crest at centre ice.

**Cameras and director.** Each angle is a small rule for where the camera sits and looks, eased so it never jerks. The director scores what is happening (puck location, contests, rushes, scoring chances) and picks an angle, holding each shot long enough to read. In quiet moments it may glance at a long-shift player; it never leaves live action near the puck.

**Quality settings.** Low: no shadows, simple lighting, fewer crowd blocks. High: shadows, better lighting and materials, more detail.

## Milestones

1. **Skating test. Stop here for the owner.** The real engine playing a real game; one chosen skater shown as the full jointed figure with the camera following him, the rest as simple markers. Controls: pick the player, slow motion, pause. The owner judges whether stride, glide, stops, turns, crossovers and backward skating look right before anything else is built on it.
2. **The whole game on the ice.** Rink and arena, all skaters and both goalies as full figures, the puck, the manual camera angles, playback controls, score bug.
3. **Actions and battles.** Passes, shots, saves, pokes, hits, falls, and every contest stage, with watch-only reactions.
4. **Broadcast.** The director, replays, the on-ice information options, stats panel, pre-game, intermission and post-game with three stars, quality settings.
5. **Player card.** The spinning model in a type-appropriate pose.

## Success checks

- The same seed gives the same final score watched or unwatched, and after seeking backward and forward.
- The owner approves the skating test.
- The owner can watch a board battle and say how it was won without reading any text.
- Height and build differences are obvious at broadcast distance.
- Smooth on a laptop with integrated graphics at the low setting.

## Risks

- **Animation quality.** Generated skating may look robotic. Mitigation: it is milestone 1, judged by the owner before more is built; if it falls short, the fallback is hand-authored key poses blended by the same rules.
- **The engine's `mode` flag** describes intent, not actual motion (see `docs/superpowers/reviews/2026-11-23-engine-core-open-items.md`). The viewer works out skating style from actual velocity and facing, using `mode` only as a hint.
- **Engine gaps show up on screen.** Things the debug view hid (odd positioning, jittery facing) will be visible in 3D. Fixes that change results go to the engine with a re-tune, not into the viewer.
- **Only Chrome has been checked** for identical results across browsers.

## Left to the builder

Rig details and joint limits, the stride maths, the exact camera rules and director scoring, snapshot spacing, file layout inside `apps/viewer`, and test tooling. Pure logic (blending, pose maths, director choices, three stars) is unit-tested; the picture is checked with headless screenshots.
