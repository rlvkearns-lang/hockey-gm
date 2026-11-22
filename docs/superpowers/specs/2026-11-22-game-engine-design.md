# Hockey GM sim: game engine design (stage 1 of 5)

Date: 2026-11-22
Status: approved by the owner on 2026-11-22

Lines marked **[my call]** are choices Claude made that the owner has not explicitly agreed to. Everything else came from the owner in conversation.

## Intent and why

The owner loves franchise hockey. Franchise Hockey Manager covers much of the GM job but not the human side, and only shows games as dots. EA's NHL franchise mode is shallow, and the owner has no way to play it. This is a personal project for the owner and possibly a few friends. It will probably never be sold.

The whole game is planned in five stages, each ending in something playable:

1. **Game engine** (this document): a watchable, full 60-minute game with a believable box score.
2. League: schedule, standings, lines, stat tracking, injuries, simming a season.
3. GM job: cap, contracts and clauses, trades (3-way, picks, retention), draft, scouting, staff.
4. People: relationships, life events, agents, rival GMs, rumours, drama, chemistry, slumps, fan reaction.
5. Friends: several human GMs in one shared league.

The engine comes first because watching games is the biggest difference the owner wants from existing games, it is the riskiest part, and everything else feeds it.

## What stage 1 delivers

A page in a web browser where the owner picks two test teams and either:

- watches the game in 3D, choosing how much of it to see, or
- sims it instantly,

and in both cases gets the same full box score and event log.

## Goals

1. **One engine, two modes.** The same engine runs with 3D graphics (watched) or with the picture off at high speed (unwatched). A given game produces the identical result in either mode.
2. **Every game is a full 60-minute simulation.** A viewing-length setting controls how much is shown, like a condensed broadcast: live stretches with cuts past dead time, and every goal, big save, fight and injury shown. Settings **[my call]**: 3, 5, 10 or 20 (everything) minutes per period, plus a playback speed control and "skip to end".
3. **Real hockey rules.** Offside, icing, faceoffs, line changes on the fly and at whistles, penalties with power plays and penalty kills, pulled goalie. **[my call]** Regular-season overtime (3-on-3) and shootout are included.
4. **Players behave according to who they are.** Attributes, type and sub-type drive decisions and outcomes. A sniper looks for shots, a playmaker looks for passes, a power forward wins battles with his body, a quick stick-checker wins them with his stick.
5. **Attributes shift the odds, they never guarantee the result.** A power forward wins a board battle against a two-way forward more often, not every time. This holds for every contest and every outcome: the better shooter scores more, the better goalie saves more, the weaker player still wins some. Situation matters too (who arrived first, speed, angle, fatigue, support), and a player can win a contest in a way that suits him, such as the smaller man getting his stick on the puck before he is pinned. No matchup may be a foregone conclusion.
6. **Contests are visible and take time.** The owner must be able to see *how* a puck battle is being fought, not just who came away with it. Board battles, net-front shoving, a defender angling a rusher, poke checks, hits, faceoff scrums, loose-puck races, post-whistle scrums and fights each play out in stages over a few seconds, with attributes deciding each stage. Example board battle: two players arrive, one pins the other, sticks dig at the puck in their feet, a third player supports, the puck squirts free or is won clean.
7. **Proper skating.** Jointed skaters that stride, glide, stop, turn, do crossovers and skate backwards, plus shooting, passing, checking, falling and goalie saves. Bodies stay simple-looking. Different heights and builds must be obvious (the prototype's look was approved).
8. **The puck is a real object.** Carried on the blade, knocked off it, sliding with friction, rattling around the boards, deflecting off sticks, skates and bodies, rebounding off the goalie and posts.
9. **Physical detail in watched games.** The owner wants watched games to have the physical feel of a full-physics game: bodies reacting to hits, sticks clashing, falls that depend on how the hit landed. See "Physics in two layers" below for how this coexists with goal 1.
10. **Realistic totals.** Over many games between average teams the numbers land near real NHL levels (see Success checks).
11. **Things that happen on the ice reach the rest of the game.** An injury on a play is an event with the player, the cause and the time, shown on screen when watching and recorded in the result. Later stages decide what it means.
12. **Any game can be replayed.** A game is fully determined by its inputs and a saved seed.

## Non-goals for stage 1

- League, schedule, season stats, saves (stage 2).
- Real NHL teams and players. Stage 1 uses generated fictional test rosters **[my call]**. Real data is a stage 2 question.
- Any GM features, the people layer, or multiplayer.
- The user controlling players or coaching during a game. Lines and tactics are inputs set before the game **[my call]**. The design must not make in-game coaching impossible later.
- Sound, commentary, crowd animation, realistic faces or likenesses.
- Phones and tablets. Laptop and desktop only.

## Anti-goals

These would make it a failure even if it technically works:

- A watched game ending differently from the same game simmed unwatched.
- A puppet show: play between the big moments that is obviously faked.
- Any matchup with a certain winner: the stronger player always winning the battle, the better team always winning the game.
- Contests settled invisibly, with one player simply skating away with the puck.
- Arcade scores (the prototype's 7 to 15 goals a period).
- Being unplayable on the owner's laptop. A gaming PC may look better, but must never be required.

## Constraints

- Runs in a web browser with nothing to install. An ordinary laptop is the minimum and must run it smoothly. Graphics quality settings scale up for a mid-range gaming PC (shadows, better lighting, more detailed players, animated crowd, heavier watch-only physics). The settings change only how it looks, never the game or its results. The owner is open to a downloadable version; **[my call]** stay in the browser for now, and wrap it as a desktop app later if wanted, which needs no rewrite.
- **[my call]** TypeScript, with three.js for 3D (the prototype used three.js).
- **[my call]** The engine is a separate module with no graphics or browser dependencies, so it can run in a background thread now and on a server in stage 5.
- **[my call]** Deterministic: seeded random numbers and a fixed time step.
- **[my call]** Speed of unwatched games: sim quality comes before speed. Aim for about a second per game on a laptop, and accept up to a few seconds if that is what full detail costs (a league night of 16 games can run in parallel). The engine must not be thinned out, with contests moved into the cosmetic layer, to hit a speed number. Measure this with a quick performance test before building the hockey logic, since it sets the time step.

## Approaches considered

**A. Full physics.** Every body, stick and puck is a physical object and the hockey emerges from collisions. Most potential for unscripted moments. Rejected as the core: extremely hard to make players look competent, hard to steer toward realistic scores, and too slow to sim the roughly 1,300 other games in a season, which would force a second engine of different quality.

**B. Player brains, staged contests, real puck (chosen).** Each player decides what to do from attributes, type and situation. Contests play out in stages. The puck follows simple real physics. Animation shows what the sim decided. The same engine runs fast with the picture off, and totals can be tuned. Cost: variety depends on how many situations and animations get built, so early versions repeat themselves.

**C. Result first, replay after.** A statistical model decides the events and a 3D re-enactment is choreographed to match. Best stats, cheapest. Rejected: what you watch is a puppet show, and it rules out in-game coaching later.

The owner chose B, and asked for A's physical feel in watched games only, while keeping one engine for watched and unwatched games.

## Physics in two layers **[my call]**

The owner's two wishes pull against each other: physics as rich as A in watched games, and the same engine with the picture off. If rich physics changed outcomes, watched and unwatched games would differ. The resolution:

- **Engine physics (every game).** Cheap physics that affects results: the puck (slide, bounce, deflection, height), and players as bodies with mass, speed and momentum, so a hit depends on size, speed and angle.
- **Watch-only physics (watched games).** A cosmetic layer on top: jointed bodies reacting to contact, sticks clashing, falls and stumbles shaped by the hit, the puck wobbling on edge. It is driven by what the engine decided and can never change it.

## Parts

**Engine**
- Game state and fixed-step clock.
- Referee: offside, icing, penalties, stoppages, faceoff locations, overtime, shootout.
- Team play: breakout, neutral zone, forecheck, offensive-zone cycle, defensive coverage, power play and penalty kill shapes.
- Player brain: picks an action from role, attributes, tendencies and what he can see.
- Contest system: the staged contests in goal 6.
- Puck physics and player bodies.
- Goalie: positioning, save types, rebound control, freezes.
- Bench: fatigue-driven shifts and line changes.
- Injury and penalty generation.
- Event log and stat counting.

**Viewer**
- 3D rink and arena, jointed skaters and goalies, animation.
- Watch-only physics.
- Cameras: broadcast, overhead, ice level (as in the prototype).
- On-screen information: score, clock, shots, an event ticker, who is on the ice, penalty clocks, and an injury notice when a player is hurt.
- Director: for condensed viewing, decides which stretches to show to fit the chosen length. **[my call]** Since nobody intervenes mid-game in stage 1, the engine can run the whole game first and the director picks from it.

**Input to a game:** two teams with rosters, each player's attributes, type and tendencies, lines, tactics, a seed, and the rule set.

**Output from a game:** final score, team and player box score (goals, assists, shots, time on ice, hits, blocks, faceoffs, penalty minutes, plus/minus, saves), a timed event log, and injuries.

## Player model

Attributes the owner listed: shooting accuracy, shooting power, passing, vision, IQ, poise, speed, acceleration, agility, balance, fortitude, compete, stamina, puck handling, stick checking, body checking, aggression, shot blocking, fighting, injury-proneness.

**[my call]** Added: strength, faceoffs, discipline, defensive positioning, height, weight, handedness. Goalies get their own set: reflexes, positioning, rebound control, glove, blocker, lateral movement, puck handling, poise.

Types and sub-types, as the owner described them (sniping two-way forward, power forward aggressor, shoot-first defenceman, enforcer, playmaking speedster and so on). **[my call]** A type is a label plus a set of tendencies (shoot or pass, carry or dump, hit or contain) that the player brain uses, alongside the attributes. The owner gave examples, not a fixed list. The builder proposes a starting list of roughly 8 to 12 types with sub-types for forwards, defencemen and goalies, as data that is easy to change, and the owner reviews it.

**Hooks for later stages [my call].** The engine accepts, with neutral defaults: chemistry between specific players, each player's form and morale, fatigue carried into the game, and coach tactics. Stage 4 fills these in. A player refusing to play, or playing poorly because he wants out, arrives through these inputs.

## Success checks

- Over 1,000 unwatched games between average teams: about 3 goals and 30 shots per team per game, save percentage near .900, about 3 power plays per team with roughly 20% success, faceoffs near 50%, and sensible hits, blocks and penalty minutes.
- Attributes matter in the expected direction: a better team wins more often but upsets are common, a sniper outscores a grinder given the same ice time, a big physical player wins more board battles. In each case the weaker side still wins a real share: **[my call]** as a starting point for tuning, a clear attribute edge in a one-on-one contest should give roughly 60 to 70% of wins, not 90%.
- The same seed gives the identical box score watched at any viewing length and unwatched.
- Smooth on a mid-range laptop without a dedicated graphics card at the low quality setting, and visibly better on a mid-range gaming PC at the high setting.
- The owner can watch a puck battle and say how it was won without reading the ticker.

## Order within stage 1

Agreed with the owner. Each step ends in something the owner can watch.

1. **First playable.** A full 5-on-5 game with real rules (offside, icing, faceoffs, line changes), proper skating, goalies, the box score, and the core contests at full quality: board battles, hits, poke checks, net-front battles and loose-puck races.
2. **Second.** Penalties with power plays and penalty kills, pulled goalie, and the condensed viewing lengths.
3. **Third.** Injuries on the play, overtime and shootout, post-whistle scrums and fights.

The success checks apply in full at the end of step 3. Step 1 is checked against the 5-on-5 parts of them.

## Left to the builder

Time step, data structures, how animation is produced (procedural, hand-made poses, or clips), the skater rig, how the director scores what is worth showing, the exact probabilities and tuning method, test tooling, and the order of work inside each step above.

**Biggest risk [my call]:** animation. There is no ready supply of hockey motion data, so skating and contest animation will likely be built by hand or generated in code. It should be proven early, right after the engine can play a basic game.

## Prototype

A throwaway 5-on-5 prototype was built during brainstorming. The owner approved the player builds and overall look, and asked for real skating, more detail in sticks, puck and bodies, and readable battles. None of its code is to be kept. It is saved for reference at `docs/prototype/shift-prototype.html` (open it in a browser with internet access): use it for the approved player proportions, the three cameras and the on-screen layout.
