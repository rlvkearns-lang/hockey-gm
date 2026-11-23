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

## Player faces (for the league and GM stages, and the 3D heads)
- Owner dislikes EA NHL's grey placeholder faces for generated players.
- Owner dislikes FHM's generated faces not matching age: an 18-year-old with a full beard who looks 36.
- [my call] Every generated player gets a face built from a seed stored with him, so it is the same face for his whole career. Age drives how it is drawn: an 18-year-old looks 18 (no heavy beard, full hairline), and the same face matures year by year (facial hair options open up, hairline, grey, lines). Drawn portraits, not photo-real. The 3D head in the viewer takes its skin tone, hair and beard from the same face so the two match.
- Owner (2026-11-23): with real NHL rosters, real players can simply use a photo of their face.
- [my call] Photos come from a "face pack" folder the owner supplies, matched to players by id; the game shows a player's photo when one is there and the generated portrait otherwise. Photos are not stored in the code repository (they are other people's copyrighted images; fine on the owner's own machine for personal use, not something to publish). A setting switches between "photos where available" and "drawn portraits for everyone" for a consistent look.

## Arena (owner, 2026-11-23)

- First version: a simple arena. Stands with a still crowd shown as coloured blocks, a scoreboard, team colours on the boards, the home team's generated crest at centre ice.
- Later upgrade, on higher graphics settings: a living arena. The crowd reacts to goals and to how the game is going; attendance reflects how the team is doing (ties into fan reaction and relocation).
- Reason: early animation effort goes to the players.

## Sound (owner, 2026-11-23)

- Wanted eventually, not soon. The first 3D version is silent.
- When added: rink sounds (skates, stick on puck, boards, posts, hits, whistle, goal horn) plus crowd (murmur that swells on chances and roars on goals).
- No commentary: the owner thinks AI voice generation would be a hassle.

## Art style (owner, 2026-11-23)

- The game does not need to look photorealistic. Character art can be paintings or high-quality pixel art.

Proposed shape **[my call, not yet agreed]**:

- One stylised look across the whole game, not realism.
- Portraits must be generated from parts (head shape, hair, brows, eyes, nose, beard, skin, wrinkles) so that every generated player gets a unique face that ages and matches his 3D head. That rules out one-off paintings; it suits either a clean illustrated style (flat shapes, soft shading, "painted" feel) or pixel art.
- Trade-off: pixel art is the easiest to generate well and has charm, but sits oddly next to a smooth 3D game view; an illustrated style matches simple stylised 3D players better. To be decided from a side-by-side mockup of the same generated face in each style, at several ages.
- Owner looked at a side-by-side mockup (illustrated vs pixel art, same generated player at 18/27/36): leans toward pixel art, at a higher resolution than the first chunky version (2026-11-23). Mockup: https://claude.ai/artifact/XKVfFgDrNMWM5CctqQxj8X with Low/Medium/High resolution options; final resolution not yet chosen. If pixel art is chosen, the interface should lean the same way so portraits and the 3D rink sit together **[my call]**.
- Owner then showed the look he actually means (2026-11-23): a real portrait photo pixelated to about 100 x 100 pixels — realistic shading and many tones, visibly pixelated, not hand-placed pixel art.
- Proposed **[my call]**: generated players get this look by rendering their own 3D head (lit, in team jersey, studio-style background) and shrinking it to about 100 pixels wide. The portrait then matches the player on the ice exactly and ages with the head model. Real photos from a face pack get the same pixelation, so real and generated players look like one set. Consequence: the 3D head needs more facial detail than a simple stylised head, since it is also the portrait source. The mockup page has a third section sketching the idea, but it is built from flat shapes and falls well short of the target; the real test is a rendered 3D head, to be shown early in the viewer work.
