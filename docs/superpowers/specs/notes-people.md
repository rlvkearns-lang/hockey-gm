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
