# Hockey GM sim: engine round 2 design (how players play)

Date: 2026-11-24
Status: written under the working agreement (`docs/superpowers/working-agreement.md`): building starts without waiting for approval and the owner reviews when he is back.

Lines marked **[my call]** are choices Claude made that the owner has not explicitly agreed to. Everything else came from the owner, mostly via `notes-engine-play.md`.

## Intent

The engine plays a full 5-on-5 game with believable totals, and the 3D viewer now shows it. Watching it showed the owner what the totals hid: players stand and watch the puck, a man on a breakaway passes back to the point, few shots and no rebounds, the man who wins a board battle rarely skates away with the puck. His first wish for this project was to watch real hockey with readable battles. This round is about how the players play; penalties and special teams follow in the same round once the 5-on-5 game looks right.

The owner's words that drive it:

- "a few players standing around too much and puck watching"
- "players on a breakaway passing back to the point"; "passing diagonally back to the point, but the D can't collect, which goes offside"
- "not too many shot attempts, like no rebounds"
- "no one really goes into Gretzky's office, and the players without puck just stand around, they don't try to get open, and opposing players do the same, don't try to block passing lanes"
- "more cycling of the puck in the o-zone, dump and chase, depending on coach and player style... point shots, tips"
- "I'd want to know what is happening, how they're battling instead of one player just getting the puck and skating away"
- "the power forward doesn't ALWAYS beat the two way guy"

## What this round delivers

Two parts, each ending with a re-tune and a game the owner can watch.

- **Part A: the 5-on-5 game looks like hockey.** Movement that commits, every player with a job, sensible decisions with the puck, shots, rebounds and tips, board battles the winner wins, team tactics, and player types that combine.
- **Part B: penalties and special teams.** Penalties, power play and penalty kill, delayed penalty and pulled goalie, bench commands, the agitator.

Not in this round (round 3): injuries and stingers, overtime and shootout, scrums, fights, game temperature, standing up for teammates, milestone moments.

## Rules that stay

- Pure, deterministic, same seed same game in every runtime; resumable from a snapshot; maths through `dmath.ts`.
- The parity rule: contest win chances stay clamped to [0.1, 0.9] and other chances to [0.03, 0.97]. Styles and badges shade odds; they never decide.
- Nothing is scripted. Cycling, dump and chase, point shots and rebounds come out of players' jobs and choices, not from set plays that run on rails.
- The viewer still decides nothing. Where the viewer had to guess (who supported a battle, where a shot crossed, a goalie's catching hand), the engine now says so in its events.

## Part A: the 5-on-5 game

### A1. Movement that commits

Found: every skater but the carrier gets a new target each tick, team phase flips with no memory, easing off is braking at full strength, most jobs cap speed at 0.8 to 0.9 of top speed, and skaters are near top speed under 10% of the time.

- A skater holds his job and target until it has moved enough, a minimum time has passed, or something real changes (possession, a pass to him, a loose puck he is closest to). **[my call]** minimum hold about 0.4 s for position targets.
- Team phase (attacking, defending, loose puck, transition) changes with a short delay so one bobble does not flip all ten skaters.
- Three ways to slow down: coast (glide, gentle loss of speed), ease (light braking), stop (hard). Players coast by default and stop hard only when they must.
- Turning carves: speed is mostly kept through a turn, with the turn radius set by speed and agility, rather than braking, turning and re-accelerating.
- Speed caps by job go; effort is chosen by need (a forechecker sprints, a defenceman holding the line glides) and limited by energy.
- Backward skating is slower than forward and used where it belongs: defenders facing the play while retreating.
- Winning a loose-puck race no longer moves the puck up to 4 m in one tick; he skates to it and picks it up.
- Skaters cannot pass through goalies.

### A2. Every player has a job

Found: players away from the puck stand and face it; both supporters stand on the same spot; the net-front defender is on the wrong side.

Each skater always holds one named job, chosen from the situation, his position, the team's tactics and his own habits. The list **[my call]**:

- With the puck in the offensive zone: carrier; low support (available along the boards for the cycle); net front (screen, tip, rebound); high forward (the safety valve, first man back); the two point men (hold the line, slide along it to open a lane, pinch when it is safe).
- On the rush: carrier; lane drivers going to the net; the trailer; defencemen joining or holding by their style.
- Breaking out: the retriever; the outlet on the boards; the centre curling low; the far winger stretching.
- Without the puck: first forechecker pressures; second takes away the pass or the body; third stays high; in the defensive zone each man covers a man or a lane (wingers on the points, centre low, defencemen at the net and the corner); backcheckers pick up a man.
- A job always has a moving part: get open (move into a lane the carrier can reach), stay between a man and the net, close a gap, go to the bench. Nobody's job is "stand here and look at the puck".
- Getting open is active: an attacker without the puck keeps moving to a spot the carrier can actually pass to (out of a defender's shadow, into space), and moves again when he is covered.
- Taking lanes away is active: a defender without the puck puts his body or stick in the passing lane between the carrier and the most dangerous option near him, as well as staying with his man; a stick in the lane makes that pass less likely to be tried and more likely to be picked off or deflected.
- Behind the net ("Gretzky's office") is a real place to play from: the carrier can take the puck there or receive a cycle pass there, hold it with the net as protection, pass out to the slot or to either side, or wrap around. Defenders have to choose whether to chase him behind the net or hold the front; the goalie has to follow post to post.
- Jobs are handed out so that two men never hold the same one, and they stick (A1).

### A3. Decisions with the puck

Found: the carrier re-chooses every 0.2 s among options scored without regard to danger, direction or whether the receiver can actually take the pass.

- Every option (shoot, pass to each teammate, carry to a lane, cycle, dump, protect, clear) gets a value: how much closer to a goal it brings the team, times the chance it works, minus what a failure costs from here.
- A clear path to the net is taken. A breakaway or odd-man rush never passes backward; the choice is shoot, deke or pass across to a man in a better spot.
- A pass is only an option when the receiver can get it: the lane is open, the pass is within what the passer can do from the way he is facing (backhand and behind-the-back passes are weaker and less accurate), and it arrives on the receiver's stick with the right weight. Passes to the point are aimed inside the line; the point man moves to keep it in.
- Under pressure down low the choices are protect, cycle, shoot or eat it along the boards, not a blind throw to the point.
- The carried puck sits on the stick blade, forward and to the shooting side (left and right now match the picture; a goalie's catching hand comes from the player). Poke checks, shot origins and net geometry are adjusted to that.
- Vision, poise and decision ratings shape how many options a player sees and how well he values them, so a smart player looks smart and a limited one sometimes forces it.

### A4. Shots, rebounds and tips

Found: about 29 shots on goal per team but few attempts, defencemen rarely shoot, no rebounds, no second chances.

- More attempts from scoring areas; defencemen shoot from the point when there is traffic and a lane; one-timers off a pass across.
- A save has an outcome: caught and held, controlled to a corner, or a rebound in front. Which one depends on the shot (speed, height, screen, tip) and the goalie (rebound control). The rebound is a real loose puck that attackers and defenders go for.
- Tips: a net-front forward with his stick in the lane can deflect a point shot (hand-eye). A tip changes the puck's path late and is harder to save; it can also miss the net.
- Screens exist already and now come from the net-front job.
- Shot blocks stop the puck at the blocker. Missed shots ring around the boards and stay in play.
- Shot, save and goal events say where the puck crossed the goalie (side and height) and what kind of save it was.
- The record keeps attempts (on goal, missed, blocked) as well as shots on goal.

### A5. Battles the winner wins

Found: of board battles with a winner who is given the puck, 49 of 51 hand it to the winner's supporter; 26 to 29 a game end with no winner; every landed hit puts the target down.

- The man who wins a board battle comes away with the puck most of the time. A supporter takes it when the win is by support, with a real pass or pick-up the viewer can show.
- Fewer battles end with nobody winning.
- Supporters stand on their own team's side of the scrum; the event names them.
- At the net front the defender plays between the attacker and the net.
- A landed hit has degrees: a bump, a stagger (loses a step, keeps his feet) or a knockdown, by speed, weight, balance and whether he saw it coming. A much heavier man is rarely put down.
- The poke checker reaches from a stick length away, not from on top of the puck.
- Parity stays: the stronger man wins more often, never always.

### A6. Team tactics

The coach sets, per team (later per line and per game situation) **[my call on the exact list]**:

- Zone entry: carry in, dump and chase, or mixed.
- Offensive zone: cycle low, shoot from the point, or attack off the rush.
- Forecheck: aggressive (two men deep), balanced, or passive (trap).
- Defensive zone: collapse to the net or pressure the puck.
- Pinching by the defence: often, sometimes, rarely.

Tactics shift the values in A3 and the jobs in A2; the players on the ice bend them. A line of grinders asked to carry in will still dump more than a skilled line; a skilled line asked to dump will still carry when the entry is there. `generateTeam` gives each team a tactic set that suits its roster, so two teams look different.

### A7. Player types that combine

Agreed with the owner: primary style, optional secondary style, and badges.

- Styles. Forwards: Sniper, Playmaker, Power Forward, Two-Way Forward, Shutdown Forward, Speedster, Grinder, Enforcer. Defencemen: Offensive, Defensive, Two-Way. Named secondary then primary ("Sniping Power Forward").
- Each style is a set of habits (shoot, pass, carry, dump, hit, forecheck, go to the net, join the rush, block). A player's habits are about two thirds primary and one third secondary. Habits shade the choices in A2 and A3.
- The label is worked out from the player's attributes and habits, with an override.
- Badges in this part, each with a small real effect: Heavy Slapshot, One-Timer, Quick Release, Net-Front Finisher, Burner, Elusive, Tireless, Playmaker's Vision, Stickhandler, Breakout Passer, Shot Blocker, Stick Checker, Big Hitter, Shutdown, Board Battler, Net-Front Presence, Faceoff Specialist; goalies: Rebound Control, Glove Hand. **[my call]** Clutch, Cool Head, Leader, Big-Game, Puck Handler and Fighter wait for the parts of the game that give them meaning; Agitator arrives in Part B.
- Goalies get a catching hand now; goalie styles wait.

### A8. Faceoffs and stoppages

- Skaters line up facing the right way: centres square over the dot, wingers on the circle, defencemen behind, all on their own side.
- Setup takes as long as it takes for players to arrive, without the 8 s timeout cases.
- After a frozen puck or a goal the goalie stays facing up ice.

### Re-tune A

Targets per team per game at 5-on-5 **[my call, from recent NHL seasons scaled to 60 minutes of 5-on-5]**: about 2.4 to 2.6 goals, 28 to 31 shots on goal, 55 to 62 attempts, save percentage near .915 to .920, 20 to 25 hits, 13 to 16 blocks, takeaways and giveaways near today's. A meaningful share of goals come from rebounds and tips (about a fifth to a quarter together) and from the point through traffic. The 76-against-66 team still wins about three quarters. Skaters spend clearly more time gliding and at top speed than today. Game time stays near 1.5 s to simulate (ceiling 2.5 s).

New measures added to the calibration so "looks like hockey" can be checked: share of time each skater spends near-stationary while play is live; share of passes completed and of point passes kept in; rebounds per game; share of board battles where the winner comes away with it; zone time and shots per offensive-zone possession.

### NHL scorecard

The owner (2026-11-24): "I just want it to simulate the real NHL as close as possible... I want to compare what we have to the NHL."

- The calibration run prints one scorecard: each measure with our value beside the NHL's, and whether it is inside the target band. Totals (goals, shots, attempts, save percentage, hits, blocks, takeaways, giveaways, faceoffs, how often the better team wins) and the "looks like hockey" measures above.
- **[my call]** The NHL column is checked against published league statistics when the scorecard is built, with the source and season written beside each number; where the NHL publishes nothing (time standing still, lanes covered) the target is stated as ours, with the reasoning.
- The scorecard is shown to the owner after each part of the round, and kept as a file so later rounds can be compared with it.

## Part B: penalties and special teams

- **Penalties.** Minors (tripping, hooking, slashing, holding, interference, high-sticking, roughing, boarding, delay of game for the puck over the glass), double minors and majors where they fit. A penalty comes out of a real action going wrong: a poke that trips, a reach that hooks when beaten, a late or high hit, a hold in a battle. The chance depends on the action, the player's discipline and how badly he was beaten. Referees miss some. No fighting majors yet.
- **Delayed penalty.** Play goes on until the offending team touches the puck; the other goalie goes to the bench for an extra attacker.
- **Penalty box and the clock.** Time served, release on a power-play goal for a minor, coincident penalties, 4-on-4, 5-on-3, the player stepping out of the box into the play.
- **Power play.** Units set by the coach; a setup in the zone (**[my call]** 1-3-1 and umbrella to start), with entries, the half-wall, the bumper and the net-front man as jobs in the A2 sense, not a script.
- **Penalty kill.** Units; box or diamond; pressure by tactic; clears down the ice (no icing when short-handed); short-handed rushes.
- **Pulled goalie.** Late and trailing, the coach pulls him by his own boldness and the score; empty-net play and empty-net goals.
- **Bench commands.** A game is seed plus setup plus a timed list of commands (next line out, match lines, pull or swap the goalie). With none it is today's automatic coach. Commands take effect at the next change or whistle.
- **Agitator badge.** Opponents near him are more likely to retaliate, by their own discipline; he draws penalties and takes some.
- **Other badges with meaning now:** Cool Head (fewer retaliation penalties), Puck Handler for goalies.
- **Record.** Power-play and penalty-kill numbers, penalty minutes, time on ice by situation.

### Re-tune B

Targets per team per game **[my call]**: about 3 power plays, 20 to 22% converted, total goals about 3.0 to 3.2 with shots near 30; a few empty-net goals a season's worth of games; short-handed goals rare. 5-on-5 numbers from re-tune A hold.

## How it is built **[my call throughout]**

- On a new branch from `main`, inside `packages/engine`, keeping the public surface and adding to it (new event fields and kinds, tactics and commands in the setup, attempts in the record). Changes to existing event meanings are listed for the viewer.
- Order inside Part A: movement (A1), then jobs (A2), then decisions (A3), then shots and rebounds (A4), battles (A5), tactics (A6), types (A7), faceoffs (A8), re-tune. Each is its own plan task with its own tests; the golden tests are re-pinned by each task that changes play on purpose.
- Part B is planned after re-tune A, in a second plan.
- After each part: one viewer re-baseline task (re-pin picture hashes and sample-dependent numbers, read the new event fields in place of the viewer's guesses, add tips, rebounds, staggers and penalties to the picture as far as milestone 3's overlays allow), the watch page republished, and the board-battle blind test re-run (target: the winner named right in 10 of 12).

## Success checks

- The owner watches a game and no longer sees players standing and puck-watching, breakaway passes to the point, or point passes sliding out of the zone.
- He sees rebounds, second chances, point shots with traffic and tips.
- He can tell two teams' styles apart (a dump-and-chase team and a carry-in team) without being told.
- He can say who won a board battle, and that man usually has the puck.
- The numbers above hold, with parity.

## Risks

- **Everything moves at once.** Changing movement, jobs and decisions shifts every total. Mitigation: the fixed order above, new measures, and one re-tune per part instead of tuning after each task.
- **Smarter decisions can make play mechanical.** Mitigation: ratings add error and blind spots; luck stays in every contest.
- **Speed.** Valuing every option for the carrier costs time. Mitigation: only the carrier evaluates options, at his decision rate; the ceiling is checked in the calibration.
- **The viewer falls behind.** Its picture tests pin today's engine. Mitigation: the re-baseline task after each part; nothing in the viewer is changed during the engine work.

## Left to the builder

The value function's exact terms and weights, hold times and hysteresis values, job assignment method, the geometry of lanes and coverage, rebound physics, penalty rates by action, power-play formation details, file layout, and test tooling.
