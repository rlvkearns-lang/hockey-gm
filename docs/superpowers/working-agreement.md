# Working agreement with the owner

Agreed with the owner on 2026-11-23.

## Keep building, stop only at the risky points

- Work continues while the owner is away. Each stage's design is written from the notes in `docs/superpowers/specs/notes-*.md`, with Claude's own choices marked **[my call]**, and building starts without waiting for approval. The owner reads designs and looks at results when he is back; anything he dislikes is reworked.
- Stop and wait for the owner at:
  - the 3D skating test (one skater striding, gliding, stopping, turning and skating backwards on the real engine), before anything else in the 3D viewer is built on it;
  - anything that cannot be undone: merging into `main`, deleting branches or files that are not Claude's own scratch, publishing anything outside the owner's private links.
- Never create a pull request unless the owner asks.
- The owner has invited push-back: say so when an idea is expensive or conflicts with an earlier decision; ideas judged weak can be parked quietly in the notes.

## Order of work

Updated 2026-11-24 after the owner watched a full game in 3D and agreed this order.

1. Done: the engine's first step (merged to `main`), and viewer milestones 1 and 2 (skating test; the whole game on the ice).
2. Now: viewer milestone 3 (passes, shots, saves, hits, board battles), plus a task making goals unmistakable and faceoffs line up.
3. Next: engine round 2, led by how the players play: decisions with the puck (a breakaway attacks the net; passes to the point only when the defenceman can take them), shot volume and rebounds, committing to a direction and coasting, defencemen shooting, the puck on the blade, goalies' catching hand, tactics, cycling, dump and chase, point shots and tips; then penalties, power plays, pulled goalie; with one re-tune. See `docs/superpowers/specs/notes-engine-play.md`.
4. Then: viewer milestone 4 (auto director, replays, on-screen information, pre-game, intermission and post-game) and milestone 5 (player card).
5. Then: engine round 3 (injuries that match the play, stingers, overtime, shootout, scrums, fights, game temperature).
6. Then: league, GM job, people, friends league.

## Where things are recorded

- Owner decisions and proposals: `docs/superpowers/specs/notes-*.md`.
- Approved designs: `docs/superpowers/specs/`. Plans: `docs/superpowers/plans/`.
- Build progress for a running plan: the git-ignored ledger under `.superpowers/sdd/`, plus `git log`.
- A scheduled task wakes the build session every three hours to carry on.

## Auto-run paused (owner, 2026-11-25)

The owner asked to stop the automatic running: it was using his credits too quickly. The scheduled check-in "Keep building hockey-gm" is switched off (not deleted). Nothing is built or reviewed unless he asks in the conversation. When he does ask, do the one step he asks for, on the cheapest model that can do it well, and say roughly how large the next step is before starting anything long.

Where things stand: engine round 2 Part A is built on the branch `engine-round-2` (all tasks done, fast tests green, NHL scorecard 44 of 44 in band on 1,000 games). Not yet done: the final whole-branch review and its fixes, merging into `main`, and rebuilding the 3D watch page on the new engine. Open items parked for that review are in the build ledger and in `docs/superpowers/reviews/engine-scorecard-round-2a.md`.
