# Notes for the league design (stage 2)

Working notes from conversation with the owner on 2026-11-23, to be folded into the stage 2 design document. Lines marked [my call] are Claude's choices.

## Day one of a new franchise
- Current real NHL season.
- Full organisations: NHL rosters, AHL rosters, and junior prospects.

## Which leagues are played
- Owner chose: NHL and AHL games are both played with the full engine (the farm team plays real games, can be watched, and call-up stats are earned). Junior and European leagues are generated: prospects there get believable stat lines and develop, seen through scouting reports whose quality depends on the scouts.
- Known cost: every game uses the full engine (about 1.5 to 2 s each), so adding the AHL roughly doubles sim time per season. Games run side by side on all processor cores.

## Open
- Where real data comes from (rosters, ratings derived from real statistics, contracts, draft picks, prospects): being researched.
