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

## Written text: reports, agents, GMs, rumours (owner chose C, 2026-11-23)
- Templates always work (offline, free). If the owner adds an AI key, an AI model writes the text from the same structured findings, and can carry real back-and-forth conversations with agents and rival GMs. Needs internet and has a small running cost. The game stays fully playable without it.
- Each scout is a person with tendencies and blind spots; two scouts can disagree about the same player.

## Moving through a season and delegation (2026-11-23)
- Owner: some things should be passed to assistant GMs. Example: a fourth-line grinder picked up as a free agent who is upset about his ice time. The owner wants to be aware of it but hand it off.
- [my call, proposed to owner] An inbox with three levels: must decide (stops the sim), yours if you want it (the assistant GM handles it after a short wait unless the owner steps in), and for information. Delegation rules the owner sets (for example: complaints from depth players, AHL lineups, waiver claims, contracts under a set value). The assistant acts and leaves a one-line note of what he did and how it went. Assistant GMs are hired staff with their own ability and personality, so a good one settles things and a poor one can make them worse. Sim controls: next day, next game, next event, to a date; always stops for must-decide items, and the owner can tune what counts.

## Team looks, expansion and relocation (owner, 2026-11-23)

- Team look: generated crests by default (the owner has no design skills and does not want to supply art). The optional logo pack stays possible **[my call]**.
- A custom expansion team can be designed by the player (name, city, colours, crest and jerseys picked from generated options).
- Expansion is a switch. When on, it unfolds as a story: rumours that a city (for example Houston) wants a team, then breaking news, then a generated team joins.
- Teams can relocate.
- The player can start his own expansion team right at the start of a game.

Proposed shape **[my call, not yet agreed]**:

- Expansion as events over time: rumours on the social feed, a league vote, an announcement a season ahead, an expansion draft with protected lists, then the new team's first season. Divisions and schedule adjust.
- Relocation the same way: a struggling market (attendance, arena, owner) leads to rumours, then a move with a new name and look; fans and players react (a player who bought a house there).
- Starting as an expansion GM: design the team, hire staff, go through the expansion draft and entry draft, with patient owner expectations for the first years.
- Designing a look is choosing, not drawing: pick colours, pick a crest from several generated from the name and city, pick a jersey pattern.
- Expansion drafts (owner, 2026-11-23): the player's team submits a protected list and can lose a player, like the real thing. The assistant GM can handle it if the player chooses to hand it off.

## In-depth and underlying stats (owner, 2026-11-23)

- The owner wants the option to see in-depth, underlying stats.

Proposed shape **[my call, not yet agreed]**:

- The engine plays every shift, so these are measured, not invented: shot attempts for and against while a player is on the ice (Corsi, Fenwick), expected goals from where and how each shot was taken, scoring-chance counts, on-ice shooting and save percentage (luck), zone starts, zone entries and exits, quality of teammates and opponents, with-or-without-you between linemates, per-60 rates, and by game situation.
- Engine-only extras real leagues do not have: battles won by kind, races won, passes completed under pressure.
- Shot maps and heat maps per player, line and team; game-by-game rolling charts.
- For goalies: goals saved above expected, by shot location and type, rebound control.
- Basic view by default; an "advanced" switch reveals the rest. Scouts and the assistant GM can cite these in reports.
- Requires the engine to record a position on every event (being added in the current fix round) and the league stage to store per-game on-ice data.
- Owner agreed (2026-11-23): rival GMs use these numbers to differing degrees as part of their personality ("analytics" types versus "old school"), so undervalued players can be found before others notice.

## Saves (owner, 2026-11-23)

- The owner is not sure where saves should live, and asked whether save files can be transferred and loaded. Yes.
- Proposed **[my call]**: solo play uses a save file the player can keep, copy between machines and load; the game also autosaves in the browser between explicit saves. The online, log-in-anywhere version arrives with the friends league (it needs a server anyway), and a solo save can be uploaded to it.

## Predicted stats (owner, 2026-11-23)

- The owner wants predicted stats, and thinks it would be too annoying if they depended on having a good scout.
- Proposed **[my call]**: a projected stat line is always available for every player, with no scout needed. For established players it rests on their record, so it is solid for everyone. For prospects and players with little track record it rests on what is known, so it comes with a range and a confidence mark rather than being hidden.

## Prospect summaries and confidence (owner, 2026-11-23)

- Each prospect gets a short headline summary from scouting, for example "High ceiling, flashy player" or "projects as a top-line centre", with more detail available when he has been scouted a lot.
- A confidence mark, as stars or colours, for how sure the scouts are: full stars / blue means he has been scouted heavily and "we know what and who he is"; two stars / red means "we think he could be this good, but we don't know".
- The owner wants confidence shown for the pick overall, for his ceiling, and for his play style.

Proposed shape **[my call]**:

- Prospect card, top to bottom: headline (projected role + a few words on style), projected ceiling and likely outcome each with its own confidence, play style with its own confidence, projected stat line with a range, then the full written report(s) if any.
- Confidence comes from how much he has been watched (games seen, by how many scouts, how recently), how good those scouts are, and how settled he is (an 18-year-old is less certain than a 22-year-old however much he is watched).
- Both stars and colour together, so it reads at a glance and works for colour-blind players; more scouting visibly fills stars in.
- Scouts can be confidently wrong: a weaker scout shows high confidence too easily. Over time the player sees each scout's hit rate.

- Owner agreed (2026-11-23): keep the confidently wrong scouts.

## Per-attribute potential (a friend of the owner, via screenshot of OOTP, 2026-11-23)

- The friend's point: one of the best things in OOTP is seeing where a prospect's growth can come from. Each rating shows current and potential side by side (for example Control 20 / 45, Cutter 35 / 80, as two-part bars), so you can see "this guy will never have good command and we know it". In hockey games you only get an overall potential and have to guess what a centre's faceoffs or skating might grow to.

Proposed shape **[my call, not yet agreed]**:

- Every attribute has a current value and a potential, each as scouted estimates, shown as a two-part bar: filled to current, outlined to potential.
- Potential differs by attribute in a believable way: skating and size-based things are largely set young; hockey sense, faceoffs, defensive positioning and strength grow later; some players have one tool with a huge ceiling and others that are capped.
- The same confidence marks apply per attribute (a potential nobody has watched much is a wide guess).
- Development then has something to aim at: the coach and development staff can focus a player on an attribute with room to grow; ice time, linemates, league level and personality (work ethic) decide how much of the gap closes; some potential is never reached, and late bloomers exist.
- The prospect headline ("high ceiling, flashy") is derived from this picture rather than written separately.
