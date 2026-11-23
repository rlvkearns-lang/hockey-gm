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
- Development focus (owner, 2026-11-23): either way. The GM can set a focus per player, or leave it to the development staff, who choose by default. Same hand-off rules as everything else.

## After a playing career (owner, 2026-11-23)

- A retiring player either leaves for good or, if he chooses, stays in the game (scout, coach, assistant GM, agent **[roles are my call]**), keeping his personality and his history with the GM.
- Numbers are retired for all-time greats.

Proposed shape **[my call]**:

- Whether he stays, and as what, comes from his personality (a student of the game coaches; a well-connected talker becomes an agent; some want nothing more to do with hockey).
- The GM decides whose number to retire, with fans and the owner having expectations about the obvious ones; snubbing a legend or honouring a marginal player is noticed. A retired number is unavailable from then on, with a banner in the arena.
- Record books, award history and a hall of fame per team and league keep the long save's history.

## Draft gems (owner, 2026-11-23)

- A "gem" feature: in the draft, a scout flags a player he thinks is a steal in a later round, or who will develop early, and similar.

Proposed shape **[my call, not yet agreed]**:

- Scouts "pound the table" for a few players each: a short tag plus a line in his own voice. Tags: steal or sleeper (better than where he is ranked), ready early, late bloomer (needs patience), boom or bust, safe pick, and warnings (overrated, character or injury concern).
- Each scout only gets a handful per draft, so a flag means something.
- Underneath, prospects really do differ in hidden ways: how fast they develop, how sure their ceiling is, how they respond to coaching. A good scout's flag usually points at something real; a weaker scout's flags are noisier, and he can be confidently wrong.
- Flags depend on what the scout actually watched (his region and how many viewings), so sending scouts to the right places finds gems others miss.
- After a few years the GM sees each scout's record: gems that hit, busts he called, and misses. That becomes a reason to keep, promote or replace a scout.
- Rival teams have scouts too: a player your scout loves may go earlier than his ranking because someone else's scout loved him as well.

- Draft day (owner, 2026-11-23): by default the player makes every pick, with an option to hand off (for example the late rounds to the scouting staff).

## Generated players that make sense (owner, 2026-11-23)

- The owner dislikes generated players in EA's games whose details do not fit together: appearance, hair, birthplace and name all drawn independently.

Proposed shape **[my call]**:

- A generated player is built in order, each step depending on the last: where he is from (weighted by where hockey players really come from), then his family background (most players share their country's majority background; a realistic share have a different or mixed heritage, as real rosters do), then his name from pools that fit that country and background, then his appearance (skin tone, hair colour and texture, eye colour) from what fits that background.
- Age-dependent details follow age, not chance: grey hair and a receding hairline only on older players, beards filling in with age.
- Mixed and immigrant backgrounds stay possible and are handled deliberately (for example a Canadian-born player with a Nigerian surname), rather than by random mismatch.
- Height and weight are drawn together and fit position; birthplace fits the leagues he came through (a Swedish junior from a Swedish town).
- Owner agreed (2026-11-23), and stressed: players born in a country should reflect that country's real mix of backgrounds (Canadian-born players should not all be white).

## Draft lottery and rivalries (owner, 2026-11-23)

- A draft lottery like the NHL's.
- Rivalries between teams that grow over time.

Proposed shape **[my call]**:

- Lottery: non-playoff teams weighted by finish, shown as an event with the reveal, and the real limits on how far a team can jump. Rules as a setting so they can follow the current NHL format.
- Rivalry is a number between each pair of teams that rises with playoff series, close and nasty games, big hits and fights, lopsided trades and offer sheets between them, and geography; it fades slowly without fuel. A rivalry game starts hotter (see game temperature in `notes-engine-play.md`), draws more fan and media attention, and matters more to players' and fans' feelings. Rivalries also form between individual players.
- Owner agreed to the lottery and rivalry shapes above (2026-11-23).

## The farm team (owner agreed, 2026-11-23)

- Call-ups and send-downs between the NHL and AHL, with waivers in (a veteran sent down can be claimed by another team).
- The AHL coach runs the AHL team; the GM can make requests ("play the kid on the top line"), as with the NHL coach.
- Development depends on where a player plays: big AHL minutes can beat sitting in the NHL press box; too good for the level and he stalls, over his head and he loses confidence.
- AHL games can be watched in 3D like any other, or followed through results and staff reports.
- The assistant GM can manage the farm team entirely, bringing only call-up recommendations and injury replacements; handed off by default **[my call]**.
- Prospects' feelings apply: stuck in the minors too long he gets frustrated; called up and scratched every night he may ask to go back down.

## Ways to start a new game (owner agreed, 2026-11-23)

- Take over a real team; start an expansion team (both from earlier notes).
- Fantasy draft: every player goes into one pool and all teams draft from scratch. Likely the best start for the friends league.
- Fictional league: made-up teams, cities and players. Also the fallback if real roster data proves hard to get.
- Unemployed GM: start with no team and wait for an offer; pairs with owner mode.
- Not included: historical seasons (each needs its own roster data).

## Tournaments, events and awards (owner agreed, 2026-11-23)

- Core to the league stage: end-of-season awards (voted with some of real voting's bias; they feed contract demands, fan opinion and the hall of fame) and the World Juniors (the scouting showcase; prospects play for their countries; a strong tournament moves a draft-eligible player's stock; the GM's own prospects can be watched in 3D).
- Lighter additions afterwards: Olympics and other international play (stars leave, come back tired, hurt or riding high; players care about selection), prospect tournaments and development camp.
- All-Star weekend: the owner does not care about it. Leave it out, or at most a line in the news **[my call]**.
- Tournaments are simulated with the generated-player system rather than as full leagues **[my call]**.

## Development and ageing (owner, 2026-11-23)

- Surprises (late-round stars, top-pick busts) at about the real NHL rate.
- True ability can be known, but it must be earned: nobody is merely "estimating" that an established superstar is a franchise player.

Proposed shape **[my call]**, the first block presented to the owner without objection:

- Every attribute has its own curve: skating and athletic ability peak early and fade first; shot and puck skills peak mid-twenties and hold; hockey sense, positioning, faceoffs and poise grow into the late twenties and decline last.
- Each player has his own timing (early developer, late bloomer, ages gracefully, falls off a cliff), which scouts can only estimate.
- Growth toward potential is earned each year from ice time and role at a level that challenges him, staff quality, work ethic, linemates, health and luck. Serious injuries can lower a ceiling; a bad fit can stall a prospect.
- Ratings move a little through the season rather than in one summer jump; staff report who is progressing and who has stalled.
- Certainty is earned by evidence. What a player is now becomes certain with NHL games played: after a few full seasons his current ratings are simply known, to every team. What he could still become stays an estimate while he is young and narrows as he ages, reaching "known" once there is nothing left to grow into. A proven star is shown as proven; an 18-year-old never is. Time in the GM's own organisation speeds this up for his own players.

## Season calendar (2026-11-23)

Proposed and not objected to **[my call]**: the game moves a day at a time; advance by a day, to the next game, or to a chosen date, stopping for anything on the GM's "must see" list. The year's events: training camp and pre-season, opening night, trade deadline, playoffs, lottery, draft, free agency opening, arbitration hearings, development camp, a quiet late summer. The off-season moves in smaller steps with more stops.

Owner on training camp and pre-season: much of it can be handled by the assistant GM, with a report afterwards. The GM can leave instructions beforehand in plain terms (for example "give this prospect some NHL minutes, and send him down unless he truly surprises"), and the report says what happened and why (who made the team, who was sent to the AHL or back to junior or college, who surprised, who disappointed).

Proposed shape **[my call]**: camp exists as a short phase that can be played in full (watch pre-season games, make the cuts) or handed off. Handed off, the GM sets a few standing instructions per player or leaves it to the assistant GM's judgement, and gets one camp report with decisions he can overrule before opening night.
