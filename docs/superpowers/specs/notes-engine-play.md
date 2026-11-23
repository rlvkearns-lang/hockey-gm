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
