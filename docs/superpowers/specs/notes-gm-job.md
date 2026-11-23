# Working notes: the GM job (stage 3)

Not a design yet. Lines marked **[my call]** are Claude's proposals the owner has not agreed to. Related notes on rival GM personalities, no-move talks, cap dumps and the coach are in `notes-people.md`.

## Finding trades (owner, 2026-11-23)

The owner wants all five of these:

- Trade block: list players you would move and see who other teams have listed.
- Team needs: each rival's needs are visible, as accurately as your scouts and your relationship with that GM allow.
- Shop a player: your assistant GM calls around and comes back with real offers.
- Ask for a player: name a target and the other GM says what it would take, or that he is unavailable.
- Incoming offers: rival GMs call unprompted, more around the deadline and the draft.

The owner's worry: waiting a day or two for "shop a player" might be annoying. He floated a "find trade" button and wants to see how it feels in play before deciding.

Proposed shape **[my call]**: "shop a player" gives a first round of answers at once (the teams that are plainly interested and their opening offers), with better or late offers arriving over the following day or two as calls are returned. A setting makes all answers instant. To be tuned once it can be played.

## Rejections and playing teams off each other (owner, 2026-11-23)

- Owner agreed: a rival GM who turns an offer down gives a reason and sometimes a counter, depending on his personality and what he thinks of you.
- Owner asked whether real GMs take one team's offer back to another team ("the Leafs just offered this; he is going unless you beat it"). They do, and it is allowed.

Proposed shape **[my call]**:

- "Give them a last call": with an offer in hand, the GM can go back to any interested team and ask them to beat it. They may raise, hold, or walk away, by personality and how much they want the player.
- The GM can choose how much to reveal (that there is an offer, roughly what it is, which team), or bluff an offer that does not exist. A bluff that is called or found out costs trust with that GM, and word can get around.
- The team whose offer is being shopped may find out and pull it, or set a deadline ("I need an answer by tonight").
- Rival GMs do the same to the player: "I have another offer for him; can you do better?" may be true or not.

## Contract negotiations (owner, 2026-11-23)

- A real negotiation, not a single accept/reject: a back-and-forth with an agent who has his own personality and represents several players.
- Things to trade with: years, salary and how it is spread, signing bonuses, no-trade and no-move clauses (full or partial), promises (role, power-play time, not being sent down), and timing (sign early or risk free agency).
- What the player wants comes from his five feelings in the people layer.
- The assistant GM can handle routine deals under limits the GM sets **[my call, same hand-off rules as elsewhere]**.
- Wanted from the real NHL rules: offer sheets, arbitration, buyouts. (Burying contracts in the minors was offered and not picked up; leave out unless asked.)

Proposed shape for arbitration **[my call]**: eligible restricted free agents can file; both sides submit a number; most cases settle before the hearing; if it goes to a hearing the team argues against its own player, which he may hold against the GM by personality; the award is short-term, and above a threshold the team may walk away and lose him. Exact eligibility and thresholds to be checked against the current agreement when this stage is designed.

## Cap and roster rules (owner, 2026-11-23)

- Keep as close to NHL realism as possible: a salary cap that rises over time, a cap floor, and the real roster and contract rules.
- Signing bonuses and performance bonuses are not a focus for now (leave out of the first version; a contract is years, salary per year and clauses).

## How the AI teams work (Claude's proposed approach, 2026-11-23, not yet agreed)

- One value model underneath everything. Every AI GM can put a number on any asset (a player on his contract, a prospect, a draft pick, cap space) in the same unit. It comes from what he expects the player to produce over the contract (using his own team's scouting estimates, so teams disagree), age, the contract's cost against that production, and his team's needs, then bent by the GM's personality (overvalues his own prospects, loves size, trusts numbers or his eyes).
- Each team has a direction: contending, on the bubble, retooling, rebuilding. It is set from the standings, the roster's age, the cap picture, the prospect pool and the owner's patience, and reviewed at set points in the year. Direction changes how much the present is worth against the future.
- Every decision is that value model applied through that direction: trades offered and accepted, free-agent bids, draft picks (his own board plus need), re-signing or letting players walk, buyouts, waiver claims, call-ups. The human's offers are judged by the same model.
- Guard rails against exploits: a sanity check against league-wide consensus value so nobody is fleeced by a quirk; quantity never beats quality (three depth players do not equal a star); roster and cap legality always enforced; a GM notices if the same trick is tried twice.
- Fallible like people, not exploitable like a formula: mistakes come from imperfect information and personality (overpaying a veteran, falling for a hot streak), not from a loophole.
- Difficulty is how good the AI's information and patience are, not hidden bonuses.
- Tested by running the league with no human for 20 or more seasons and checking its health: every team cap-legal, dynasties rise and fall, bad teams recover through the draft, contracts and trade volumes look like the real league, no team hoards one position; plus scripted attempts at known exploits from other management games.
- Build order: the value model, then team direction, then each kind of decision, starting with re-signing and free agency, then the draft, then trades.
- Owner agreed (2026-11-23): rival GMs are competent but human by default (a sharp player builds a contender in a few seasons, not one), with a harder setting available. The approach above is accepted as the starting point.

## Free agency (owner agreed, 2026-11-23)

- A free agent weighs the whole picture using the five feelings, not just the highest offer: money (and term), role (line-up spot and promises), winning (contender or not), people (friends, former teammates, the coach, the GM's reputation among players), place (hometown, family, the city). Personality sets the weights (ring-chaser, hometown discount, mercenary).
- Opening day is a rush: top players sign within hours.
- His agent tells the GM roughly where he stands ("in the mix, but he wants a fifth year"; "leaning elsewhere").
- The GM can lose a player despite the best offer, and is told why.
