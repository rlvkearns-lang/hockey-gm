# Notes for the 3D viewer design (part 2 of the first playable)

Working notes from conversation with the owner on 2026-11-23, to be folded into the viewer design document. Lines marked [my call] are Claude's choices the owner left to its discretion.

## Cameras
- No free-flying camera.
- Angles the viewer picks: broadcast side view that follows play, overhead, behind either net, ice level along the boards, follow one chosen player.
- An auto director mode that cuts between angles and can follow a flagged player. The viewer can switch between their own angle and the auto director at any time.
- Replays: goals always; big saves, big hits and injuries may get one; shown from another angle, slowed, skippable.

## On-screen information
- Who is on the ice, with all of these available as options that can each be turned off: names under the players, a strip along the bottom, a side panel (with energy and current shift time).
- Long shifts are flagged with an amber shift time beside the player's name.
- [my call] The auto director may glance at a long-shift player in a quiet moment; it never leaves live action near the puck to do so.
- No running play-by-play caption over the ice. The owner does not want a live game log on the picture.
- Score, clock and shots in a score bug.
- Game stats (team totals and player lines) sit under the picture, toggled by a button.

## From the engine design and the prototype feedback
- Player builds and overall look of the prototype were approved; bodies stay simple.
- Wanted: real skating (backward skating, crossovers, turns, stops), more detail in sticks, puck and bodies, and battles that can be read from the picture alone (who is pinning, who is digging).
- Physical detail in watched games only (bodies reacting to hits, sticks clashing, falls shaped by the hit), never changing the result.
- A laptop is the minimum; quality settings scale up for a mid-range gaming PC.

## Hit tuning steer (for the engine tuning task)
- Owner: use discretion. A 230 lb player hitting a 165 lb winger at high speed should win most of the time (near the 90% cap is right). Only ordinary mismatches should sit lower.

Mockup of the watch screen layout: https://claude.ai/artifact/8zAg7iarbD54vTWYPKJUGH
