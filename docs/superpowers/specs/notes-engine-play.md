# Working notes: how the hockey should look (owner feedback on the engine)

Not a design yet. Lines marked **[my call]** are Claude's proposals the owner has not agreed to.

## After the first watchable game, top-down debug view (owner, 2026-11-23)

- "Looks pretty good so far."
- Wants more cycling of the puck in the offensive zone.
- Wants dump and chase, depending on the coach's style and the players' styles.
- Wants point shots and tips (deflections in front).

Proposed shape **[my call]**:

- Team tactics become a real input (the spec already reserves "coach tactics"): zone entry (carry in / dump and chase / mixed), offensive-zone style (cycle low / shoot from the point / rush), forecheck pressure. A coach has preferences; the players on the ice bend them (a line of grinders dumps and cycles, a skilled line carries in).
- Cycle: forwards hold the puck along the boards below the circles, pass low to high and back, and wait for a lane, rather than shooting at the first chance.
- Point shots: defencemen at the blue line shoot through traffic; forwards go to the net front for them.
- Tips: a net-front forward can deflect a point shot (hand-eye from existing attributes), which changes its path and is harder to save; screens already exist.
- Known from the build: defencemen rarely skate backwards facing the puck; to be fixed.

Order (owner agreed, 2026-11-23): the 3D viewer is built first, on the engine's current style of play. Tactics, cycling, dump and chase, point shots and tips go into the next round of engine work with penalties and power plays, and the totals are re-tuned once after that.

## Injuries that match what was seen (owner, 2026-11-23)

- The injury should fit the play: a player boarded head first likely has a concussion, not a broken toe; a player who falls awkwardly on his foot might have a knee injury.

Proposed shape **[my call, not yet agreed]** (belongs to stage 1 step 3, injuries):

- The engine decides the mechanism first, from facts it already has: what kind of contact (open-ice hit, hit into the boards, blocked shot, awkward fall, puck or stick to the face, fight), how hard (speed and weight), where on the body, and how far from the boards.
- The body part and kind of injury are drawn from what that mechanism can cause (boarding: head, neck, shoulder; blocked shot: foot, ankle, hand; awkward fall or knee-on-knee: knee, ankle; and so on), with injury-proneness and luck deciding whether and how bad.
- The injury event carries the mechanism and body part, so the viewer animates that exact thing (the head-first fall into the boards, the player hobbling off on one leg, the trainer coming out) and the replay shows it. The cosmetic layer shows what the engine decided, so what is seen always matches what happened.
- Severity is not known at once: "left the game, upper body" first, then a diagnosis later from the medical staff, which ties into the people layer (playing hurt, coming back too early).

## Pain without injury, and players learning from it (owner, 2026-11-23; owner unsure)

- A player blocks a shot, is not injured but it visibly hurt; afterwards he might hesitate to block the same kind of shot. The owner floated this and was not sure.

Proposed shape **[my call, not yet agreed]**:

- "Stingers": contact that hurts without injuring. Shown in the viewer (shaking a hand out, slow to get up, a grimace to the bench), no time missed.
- A short-lived hesitation afterwards, sized by personality: a high-fortitude, high-compete player shrugs it off and blocks the next one; a timid one shies away for the rest of the game or a few games. It fades.
- Kept small on purpose: it shades the odds of attempting a block or going into a corner, never removes them, and stays within the parity rule.
- Longer term, the same idea covers a player coming back from a real injury who is tentative at first (already implied by the injury note).
- Owner agreed to the stinger shape above, kept small (2026-11-23).

## Player types that combine (owner, 2026-11-23)

- The owner wants types to combine, as in his original examples. His example: a heavy hitter who is also an elite shooter is a "sniping power forward".
- Current engine list (starting point, owner has seen it): forwards Sniper, Playmaker, Power Forward, Two-Way Forward, Speedster, Grinder, Enforcer; defencemen Offensive, Defensive, Two-Way; one Goalie type. Sub-types are currently labels only.

Proposed shape **[my call, not yet agreed]**:

- Every skater has a primary style and an optional secondary style from the same list for his position group. He is named secondary-then-primary: "Sniping Power Forward", "Playmaking Speedster", "Two-Way Sniper", "Physical Offensive Defenceman". No secondary means a pure type.
- The primary is what he is first; the secondary is a real lean. His habits (shoot, pass, carry, dump, hit, forecheck, go to the net, join the rush) are a blend weighted toward the primary, roughly two thirds to one third, and a generated player's attributes are nudged by both.
- The label describes the player rather than dictating him: it is worked out from his attributes and habits. It can therefore change over a career (a speedster who loses a step becomes a playmaker; a young grinder who develops a shot becomes a sniping grinder), and real players get theirs from their ratings, with a manual override.
- The old sub-types become traits: small specific habits a player may have a few of (one-timer, net-front presence, agitator, shot blocker, penalty killer, breakaway threat, puck-mover, stay-at-home). Traits change particular decisions, not the overall blend.
- Goalies get their own styles (butterfly, hybrid, stand-up or athletic, positional) and traits (puck handler, rebound control, big-game) when goalie play is deepened.
- Belongs with engine round 2, where tactics and habits are being reworked anyway.

- Owner agreed (2026-11-23) to primary + secondary + traits. Add a shutdown forward type if it is different enough from two-way (Claude's call: yes, see below).
- Owner wants traits shown as badges on the player. His examples: shot blocker, heavy slapshot, one-timer, a speed one, "and more". He specifically wants an agitator badge that is independent of the enforcer type: a skilled player who gets under the other team's skin.

Proposed shape **[my call]**:

- New forward style, Shutdown Forward: defence first, sent out against the other team's best line, wins his matchup rather than the scoresheet. Different from Two-Way (good at both ends) and Grinder (energy and forecheck).
- Badges are traits the player has earned by being clearly good at one specific thing; most players have none to three, stars a few more. Each has a real, small effect in the engine and an icon on the card.
- Starting list. Shooting: Heavy Slapshot, One-Timer, Quick Release, Net-Front Finisher. Skating: Burner (straight-line speed), Elusive (edges and agility), Tireless. Puck: Playmaker's Vision, Stickhandler, Breakout Passer. Defending: Shot Blocker, Stick Checker, Big Hitter, Shutdown. Battles: Board Battler, Net-Front Presence, Faceoff Specialist. Mental: Clutch, Cool Head, Leader. Edge: Agitator, Fighter. Goalies: Puck Handler, Rebound Control, Glove Hand, Big-Game.
- Agitator: any type can have it. He provokes: opponents near him are more likely to take a retaliation penalty or lose focus, by their own discipline and poise; he draws penalties and sometimes takes one himself. Opposing players and fans dislike him, his own room and fans tend to love him (people layer). Needs penalties, so it arrives with engine round 2.
- Badges can be gained and lost over a career (a Burner slows down; a young player earns Shot Blocker), and a scout may see a badge coming in a prospect.
- Owner agreed to the Shutdown Forward, the badge list and the agitator shape above (2026-11-23).

## Moments, standing up for teammates, and games that heat up (owner, 2026-11-23)

- Special moments shown on the ice: a rookie's solo lap in warm-up before his first game; a rookie's first goal getting a big celebration with the whole team rushing to him.
- A rookie (or star) takes a hit, his team does not like it, and someone immediately drops the gloves.
- A game gets scrappier as it goes on.

Proposed shape **[my call]**:

- Moments: the engine marks milestones on its events (first game, first goal, hat trick, a milestone goal or point, a goalie's first win or a shutout, a last game). The viewer plays a matching celebration and the director gives it a replay; the result carries it to the league and people layers (a first goal is remembered by the player and fans).
- Game temperature: a number each game carries, starting from the rivalry and recent history between the teams, rising with big hits, hits on stars or rookies, scrums, a lopsided score late, agitators, and cheap shots, and cooling with time and with whistles going one team's way. Higher temperature means more hitting, more scrums after whistles, more retaliation penalties and more fights.
- Standing up for a teammate: after a heavy or questionable hit, teammates on the ice may respond, by their own personality (aggression, fighting, leadership, friendship with the man who was hit) and by who was hit (a rookie, a star, the goalie). The response ranges from a shove and a scrum to a fight. A team that never responds, or a player who does, is noticed by the room (people layer).
- All of this belongs with engine round 3 (scrums and fights), and uses penalties from round 2.
- Owner agreed to the moments, game temperature and standing-up-for-teammates shapes above (2026-11-23).

## Coaching during a game (owner, 2026-11-23)

- Optional. The default is automatic: the coach changes lines and pulls the goalie. The player can choose to step in: send out particular lines, and pull or switch the goalie whenever he likes.

Consequences and proposed shape **[my call]**:

- A game becomes seed + setup + a timed list of bench commands. With no commands it is exactly today's game. The engine gains a command input (next line out, line matching, pull or swap the goalie, later a timeout), applied at a given tick, in engine round 2 with tactics.
- The viewer currently plays the whole game ahead of time. With coaching it still does, until the player gives a command; then the game is re-run from that moment with the command added, which is fast and exact because the engine can resume from a snapshot. Replays and seeking keep working.
- Commands take effect the way they would on a real bench: at the next change or whistle, not instantly.
- It interacts with the line-up setting: under "coach decides", stepping in overrules the coach and he notices; under full manual control there is no cost.
- Friends league: a game between two human GMs is simmed once for both, so live coaching there needs both online together (the watch-party case) or is switched off; to settle when that stage is designed.

## Seen in 3D: players do not commit (Claude, 2026-11-23, for engine round 2)

- On a 3D body the engine's motion looks busy: a skater's style changes about every 0.8 s, "stops" only brake to a jog before he turns away, backward skating reaches 7 m/s, and sprints last under a second (about 5% of skating time) because players trim speed or turn almost as soon as they reach top speed. The engine re-decides where to go five times a second and brakes as hard as it accelerates.
- Proposed **[my call]**: in engine round 2, players commit to a direction and a speed for longer (re-decide less often unless something changes, coast and glide more, brake less hard, hold speed through the neutral zone on a rush), followed by the re-tune that round already needs. The owner judges how much it matters after watching a whole game in 3D.

- Correction from the viewer's final review (2026-11-23), checked against the engine source: only the puck carrier re-decides every 0.2 s. Every other skater is given a new target every tick (job assignment runs each live tick and targets are relative to the puck), team phase flips with no hysteresis, and there is no coasting: easing off is braking as hard as he can accelerate. Most jobs also cap speed at 0.8 to 0.9 of top speed, so those skaters can never sprint. Skaters are near top speed under 10% of the time, in runs of about 0.6 s.
- For engine round 2 **[my call]**: hold a job and its target for a while (hysteresis on team phase; re-issue a target only when it has moved enough or after a minimum time); do not ease off toward a moving target; turn by carving rather than shedding speed; separate gentle coasting from hard braking; review the role speed caps. Put the carried puck on the stick blade (forward and to the shooting side) and re-tune pokes, shot origins and net clipping. Read a goalie's catching hand from the player; add to save and goal events where the puck crossed (offset from the goalie and height) so the viewer can put the glove on the puck. All of this needs the re-tune that round already plans.
- Also for engine round 2 (seen by the viewer, 2026-11-23): winning a loose-puck race teleports the puck up to about 4 m to the winner in one tick; it should travel there.
