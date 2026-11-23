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

## Data source research (2026-11-23, mostly second-hand: the session's network blocked every host except github.com, so no live endpoint or terms page was checked)
- Rosters, bio, per-season stats, game logs, each team's prospect list, draft results and rankings: the NHL's own unofficial, undocumented web API (api-web.nhle.com, api.nhle.com/stats). Community endpoint reference: github.com/Zmalski/NHL-API-Reference (MIT, fetched and read). No key. Terms unclear; treat as personal use, cache locally, fetch slowly.
- Bulk statistics for deriving ratings: MoneyPuck downloadable CSVs (skaters, goalies, lines, shot-level from 2007), free for non-commercial use with credit (per search snippet). Hits, blocks, faceoffs, takeaways, zone starts would come from NHL play-by-play (unconfirmed).
- AHL: HockeyTech feeds behind theahl.com (undocumented JSON with a public client key); roster and stat views unconfirmed.
- Junior and European prospects: weakest area. Elite Prospects' API is paid and its terms reportedly exclude consumer use. CHL probably HockeyTech (unconfirmed). Nothing found for NCAA or European leagues.
- Contracts, clauses, retained salary: no confirmed free bulk source since CapFriendly closed in 2024. PuckPedia appears to have a keyed developer API (pricing and terms unconfirmed); CapWages and Spotrac show the data on their sites.
- Future draft pick ownership: no source found beyond those sites' pages.
- Community practice: fan-made roster files (ZenGM Hockey on Reddit, FHM mods on the OOTP forums). FHM itself is NHL-licensed.
- Gaps and fallbacks: contracts and pick ownership entered by hand, imported from a community file, or via a paid key; junior/European prospects' ratings derived from draft position and rankings with generated stat lines; the draft-eligible class generated.
- To do before designing the importer: re-run this research with the hosts allowed so endpoints and terms are verified first-hand.

## Ratings and scouting (owner, 2026-11-23)
- The GM sees his staff's estimate of a player's ratings, not the truth: sharper for players watched a lot, vaguer for a junior seen twice; better scouts narrow it faster and are wrong less often. An option turns this off to show true ratings.
- Written scouting reports: the GM sends scouts to watch a prospect and they come back with a report in a scout's voice. Owner's example: "He's got a good motor, but lacks some size, he should continue to grow... but his compete level is next to none, we need to get this guy..."
- [my call] A report is built from structured findings (what the scout saw, how sure he is, his recommendation), coloured by that scout's own tendencies and blind spots. The findings drive the game; the wording never changes an outcome.
