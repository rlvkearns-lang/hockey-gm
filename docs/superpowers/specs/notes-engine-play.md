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

Order (owner agreed, 2026-11-23): the 3D viewer is built first, on the engine's current style of play. Tactics, cycling, dump and chase, point shots and tips go into the next round of engine work with penalties and power plays, and the totals are re-tuned once after that.

## Injuries that match what was seen (owner, 2026-11-23)

- The injury should fit the play: a player boarded head first likely has a concussion, not a broken toe; a player who falls awkwardly on his foot might have a knee injury.

Proposed shape **[my call, not yet agreed]** (belongs to stage 1 step 3, injuries):

- The engine decides the mechanism first, from facts it already has: what kind of contact (open-ice hit, hit into the boards, blocked shot, awkward fall, puck or stick to the face, fight), how hard (speed and weight), where on the body, and how far from the boards.
- The body part and kind of injury are drawn from what that mechanism can cause (boarding: head, neck, shoulder; blocked shot: foot, ankle, hand; awkward fall or knee-on-knee: knee, ankle; and so on), with injury-proneness and luck deciding whether and how bad.
- The injury event carries the mechanism and body part, so the viewer animates that exact thing (the head-first fall into the boards, the player hobbling off on one leg, the trainer coming out) and the replay shows it. The cosmetic layer shows what the engine decided, so what is seen always matches what happened.
- Severity is not known at once: "left the game, upper body" first, then a diagnosis later from the medical staff, which ties into the people layer (playing hurt, coming back too early).

## Pain without injury, and players learning from it (owner, 2026-11-23; owner unsure)

- A player blocks a shot, is not injured but it visibly hurt; afterwards he might hesitate to block the same kind of shot. The owner floated this and was not sure.

Proposed shape **[my call, not yet agreed]**:

- "Stingers": contact that hurts without injuring. Shown in the viewer (shaking a hand out, slow to get up, a grimace to the bench), no time missed.
- A short-lived hesitation afterwards, sized by personality: a high-fortitude, high-compete player shrugs it off and blocks the next one; a timid one shies away for the rest of the game or a few games. It fades.
- Kept small on purpose: it shades the odds of attempting a block or going into a corner, never removes them, and stays within the parity rule.
- Longer term, the same idea covers a player coming back from a real injury who is tentative at first (already implied by the injury note).
