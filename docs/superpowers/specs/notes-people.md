# Notes for the people layer design (stage 4)

Working notes from conversation with the owner, to be folded into the stage 4 design document. Lines marked [my call] are Claude's proposals.

## From the original request
Relationships that get better and worse rather than a static good/bad. A player can sour on the club after not getting the contract he wanted. A player may want to stay because he just bought a house or his daughters just started school. A player who wants a change asks for a trade, and may refuse to play if he really wants out. A fan favourite may take less money to stay. Also: agents, rival GMs, slumps and hot streaks, mental health, player-to-player relationships, team drama, social networks, rumours, favoured cities and coaches, fan reaction.

## What moves a player's feeling about the club (owner, 2026-11-23)
Whether he grew up in the team's town, whether his friends are on the team, ice time, pay.

## Proposed model [my call]
- A player's feeling about the club is several separate things, not one bar: his role and ice time against what he expects; money and how negotiations went; winning, against where he is in his career; people (friends and linemates on the team, the coach, trust in the GM); place (hometown, family settled, a city he likes or dislikes).
- Personality sets how much each one weighs for him.
- Things that happen are remembered and fade at different speeds; a broken promise fades slowly.
- The GM can make promises (ice time, bringing in help, not trading him); keeping or breaking them matters.
- He lets the club know by stages: quiet, then to the coach, then his agent calls, then a private trade request, then public, then refusing to play.
- It reaches the ice through the engine's form and morale inputs, which already exist.

## How the GM learns what a player feels (owner, 2026-11-23)

- Feelings are read through people (coach, assistant GM, agent, the player himself), not shown as plain numbers. Same off switch as the estimated ratings: a setting that shows everything plainly.
- The owner does not want to talk to each player every time. Checking in must be something that can run by itself.
- Each player has a card that records what has been learned, so nothing needs asking twice.

Proposed shape **[my call, not yet agreed]**:

- Automatic check-ins: the coach and assistant GM make the rounds on a schedule, and report what they hear. How much they catch depends on their ability and on how open the player is. This uses the same delegation rules as the inbox.
- The card ("what we know") lists each thing learned, who it came from, when, and how sure it is. Old items are marked as out of date rather than removed.
- The GM is only told when something on a card changes or is serious. Talking to a player in person stays available and gets more than a second-hand report does, but is never required.

## Word getting around (owner, 2026-11-23)

- What the GM does to one player can reach others. Whether it does depends on the situation and on the player's personality.

Proposed shape **[my call, not yet agreed]**:

- The player decides whether to talk: a private, loyal type keeps it to himself; a vocal or bitter one tells the room; some go to the press.
- The situation decides how far it travels: a quiet broken promise may stay between two people; a public contract fight or a trade request is known by everyone.
- It spreads along friendships first (close friends, linemates, then the room, then players on other teams through former teammates and shared agents), weaker and later at each step.
- Listeners weigh it by who is telling it: a respected veteran is believed, a known complainer is not.
- It works both ways: kept promises and fair treatment get around too, and build a reputation that helps with free agents.

## Rival GMs (owner, 2026-11-23)

- Each rival GM has a lasting personality and remembers his dealings with the owner's GM.

Proposed shape **[my call, not yet agreed]**:

- Personality: how he values things (his own prospects, picks, veterans, size, skill), how much risk he takes, habits (never trades in his division, always wants the last word), and how patient his owner lets him be.
- Memory: fair deals build trust and get calls returned; being fleeced, or having an offer leaked, makes him wary or shuts the door for a while. Memories fade.
- Word gets around between GMs the same way it does between players.
- GMs can be fired and hired, taking their personality and their memory of the owner to a new team.

## The team owner above the GM (owner of the project, 2026-11-23)

- There is an owner mode that can be turned on or off. On: a team owner sets expectations, controls the budget, and can fire the GM. Off: the GM cannot be fired and plays on.

Proposed shape **[my call, not yet agreed]**:

- Team owners have personalities too (patient or impatient, spender or tight, meddler or hands-off) and can sell the team, bringing in a new owner with new expectations.
- Expectations are stated up front each season and reviewed at set points; job security is visible as a rough reading, not a number.
- Being fired is not the end: other teams can offer the GM a job, depending on his reputation.

## Social feed and rumours (owner, 2026-11-23; not the highest priority)

- A social-media style feed (like Twitter). Media personalities post rumours that may or may not be true, for example an insider saying a player wants out of his team.
- The GM can follow a rumour up: go to the player or his agent and find out whether it is true.

Proposed shape **[my call, not yet agreed]**:

- Insiders are people with a track record: some are well sourced and usually right, some guess, some are fed stories by agents or rival GMs who want something (an agent floating a trade rumour to push a contract).
- True rumours come from the same place as everything else in the people layer: a real feeling leaking out along the "word gets around" paths. False ones are invented or planted.
- What the GM learns from following up goes on the player's "what we know" card, and the insider's hit rate becomes visible over time.
- The GM's own dealings can leak too, and rumours about his players affect them (a player reading that he is on the block).
- The feed also carries fan reaction and ordinary news, and uses the same text approach as the rest (templates always, optional AI key).

- Owner agreed with the proposed shape above (2026-11-23), and added: the GM can leak information himself, or plant a story, to try to get something moving.

Proposed shape for the GM's own leaks **[my call, not yet agreed]**:

- The GM picks an insider and what to say (true or false): a player is available, another team is interested, contract talks are going well or badly.
- It can work: a rival GM calls, an agent softens, a market for a player appears.
- It can backfire: the player it is about finds out and is hurt or angry; the insider or the other party works out who planted it; repeated plants cost the GM trust with insiders, agents, rival GMs and his own room.
- The chance of being traced depends on the insider, on how many people could have known, and on whether the story turns out false.

## Reputation summary (owner, 2026-11-23)

- The owner asked for a table or tab summarising how the GM is viewed by the public, by fans, and by others.

Proposed shape **[my call, not yet agreed]**:

- One "Reputation" page with a row per audience: fans, media, the team owner (when owner mode is on), the GM's own players, players around the league (matters for free agents), agents, and rival GMs.
- Each row gives a rough reading in words (for example "trusted", "wary", "hostile"), the direction it is moving, and the two or three things that most shaped it lately ("kept his promise to Keane", "traded a fan favourite", "caught planting a story").
- Rows open to more detail: rival GMs one by one, agents one by one.
- Readings are impressions gathered the same way as player feelings, not exact numbers, with the same off switch for plain numbers.

## More ideas from the owner (2026-11-23)

The owner has invited Claude to push back on ideas or quietly park them.

- **Pay comparisons.** Teammates see what others sign for and may think they are worth that too.
- **Leaders and a natural captain.** A way to find out who the leaders in the room are. A captain should emerge naturally: someone who loves his team, teammates and city, or a traded-in veteran who was a leader elsewhere and becomes one at once.
- **"A Larkin situation", major drama, storylines.** Claude's reading **[my call, to confirm]**: a captain publicly criticising management (for example after a quiet trade deadline). More generally, multi-step stories that build over weeks.
- **Alerts** when a major trade or signing happens around the league.
- **No-move clauses.** A player with a full no-move can agree to a list of teams he would go to. When a team wants a player with a no-move, the GM has to sit down with him; by personality some take offence at being asked, some understand but refuse, some understand and waive.
- **Negative value and cap dumps.** Bad contracts that cost assets to move.

Proposed shape **[my call, not yet agreed]**:

- Pay comparisons feed the existing "money" feeling: a player compares himself with teammates and league peers of similar role and production, weighted by ego. A new signing can unsettle the room or reset a pending negotiation. Agents use comparables openly in talks.
- Leadership is a hidden standing each player has in a room, built from personality (cares about others, vocal or by example), tenure, performance, respect earned elsewhere (carried at reduced strength on a trade), and how he treats teammates. The coach and assistant GM report who the room follows; the "what we know" card shows it. The GM (or coach) names the captain; picking against the room's choice has a cost, picking the natural leader has a benefit. Leaders amplify word getting around, for or against the GM.
- Storylines are not scripted plots. They are chains the people layer produces by itself (a feeling escalates, leaks, the feed picks it up, the room takes sides), surfaced to the GM as one running story with a headline and a timeline rather than scattered messages. A captain calling out management is the top rung of the existing escalation ladder for a respected leader unhappy about "winning".
- Alerts use the inbox's three levels; league-wide major moves are "breaking news" on the feed with an optional pop-up.
- No-move handling: asking is itself an event with a memory. The outcome depends on personality, his five feelings, the destination (contender, hometown, friends there) and how the GM asks (honestly, with a reason, or by pressure). A list of acceptable teams can be negotiated into the contract or offered by the player later. Asking and being refused leaves a mark; asking through the agent first is the softer route.
- Contracts have a value that can be negative. Rival GMs price cap space; moving a bad deal costs a sweetener (pick, prospect) or retained salary, and teams with space and a patient owner act as takers. Belongs to stage 3 (GM job).
