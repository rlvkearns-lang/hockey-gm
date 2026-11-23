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

1. Finish the engine fix round (final review of `engine-core`), then republish the debug view.
2. 3D viewer (stage 1, part 2), starting with the skating test.
3. Engine round 2: penalties, power plays, pulled goalie, tactics, cycling, dump and chase, point shots, tips, condensed viewing.
4. Engine round 3: injuries that match the play, stingers, overtime, shootout, scrums, fights.
5. League, then GM job, then people, then friends league.

## Where things are recorded

- Owner decisions and proposals: `docs/superpowers/specs/notes-*.md`.
- Approved designs: `docs/superpowers/specs/`. Plans: `docs/superpowers/plans/`.
- Build progress for a running plan: the git-ignored ledger under `.superpowers/sdd/`, plus `git log`.
- A scheduled task wakes the build session every three hours to carry on.
