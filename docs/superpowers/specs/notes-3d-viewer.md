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
- Owner saw a first rendered example (seed-built 3D head, lit, shrunk to 100 px: https://claude.ai/artifact/BBiwKQaq1wTqp24DUD96F7): "more in the right direction", but wants it more realistic (2026-11-23).
- Routes to more realism **[my call]**: (a) start from a properly sculpted human head model with blend shapes for variety and age, plus realistic skin textures and modelled hair (open-licensed base models exist, for example MakeHuman's, which is CC0); the same head is used on the ice. (b) AI-generated portrait images: most photographic, but hard to keep one face consistent as he ages and to match the 3D head, and needs an image service. Recommended: (a) as the base; (b) at most as an optional extra later. To be proven with a test early in the viewer work.

## Portraits on hold; the player card shows the 3D model (owner, 2026-11-23)

- Realistic face portraits are on hold for now.
- Lists (draft class, prospects, rosters) show no faces. A player's look appears only when his card is opened.
- The card does not need a face either: it can show his 3D model in an action pose, turning around.
- This supersedes, for now, the earlier notes on drawn portraits and the pixelated-portrait target. The face pack for real players stays a possible later extra.

Proposed shape **[my call]**:

- The card shows the same model used on the ice: his height and build, team jersey with name and number, handedness, in a pose that suits his type (a sniper mid-shot, a goalie in his stance, a defenceman skating backwards), slowly turning, with drag to rotate.
- In gear, with helmet and visor, most of the face is covered, so a simple head with the right skin tone, hair showing at the back and any beard is enough. That removes the hardest art problem from the project for now.
- Prospects and unsigned players wear a neutral or junior-team jersey; ageing shows in build rather than face.
- Reuses the viewer's skater model and poses, so it costs little beyond the 3D viewer work itself.

## Around the game (owner, 2026-11-23)

- Before: a short pre-game screen that can be skipped (line-ups, starting goalies, injured and scratched players, recent form **[contents my call]**).
- Intermissions: a quick summary that can be skipped.
- After: a proper post-game (three stars, final box score, injuries, goal replays to rewatch **[contents my call]**).
- The post-game can lead into a media scrum for players or coaches when there is drama or something important; otherwise it is skipped. (The scrum itself belongs to the people stage; the viewer only needs a place for it after the post-game.)

## Skating test verdict (owner, 2026-11-23)

- The owner looked at the skating test (https://claude.ai/artifact/J4J9gS8J8iVN4HtpKu7tGm): "Looks great honestly", "it looks really good so far". The skating approach (generated poses on a jointed figure) is approved; the rest of the 3D viewer can be built on it.
- Wanted: sprinting should look different from ordinary striding: head down, power.
- Wanted: the puck on the stick blade when a player carries it, rather than underneath him.

Proposed shape **[my call]**:

- Sprint: when a skater is at high effort and near top speed, a deeper forward lean, head down, longer and harder pushes, bigger arm drive, with the stick carried in one hand when he does not have the puck.
- Puck on the stick: the engine keeps the carried puck at a point close to the carrier. The viewer draws a carried puck on the blade, out in front and to his forehand side, moving with his stickhandling, and brings it back to the engine's exact position as it is released (pass, shot, loss), so nothing about the game changes. If the engine's own carry point proves too close to the body for battles and poke checks to look right, moving it is an engine change for round 2.

## Owner's feedback on milestone 3 (2026-11-24)

"Looks pretty good." His observations:

- A few players stand around too much and watch the puck. (Engine: goes to engine round 2 with the other play items.)
- The camera angles are a bit wonky.
- The overhead camera is dizzying.
- The broadcast camera moves too much.

What follows **[my call]**:

- Broadcast: behave like a television camera on a fixed platform. It pans to follow the play rather than chasing the puck: a wide dead zone in the middle of the frame so small puck movements do not move it, a slower and smoother pan, no pan reversals on a quick pass back and forth, zoom changes only for real events (a board battle, a goal) and eased slowly, a steady height and tilt.
- Overhead: stop it moving with the puck. Either a fixed view of the whole rink, or a view of one zone that changes only when play has clearly moved to another zone and stayed there, with a slow slide between them. No rotation, north always the same way.
- The other angles get the same treatment: the camera's job is to be calm; the players move, not the frame.
- Check every angle by counting how far and how often the frame moves over a period, and set limits.

## How the players look (owner, 2026-11-24)

Asked whether to bring the per-player look forward, the owner said "Whatever you think. In a perfect world I would love a bit higher quality body parts and stuff, with weight."

- **[my call]** The order stays: how players play (engine round 2) comes before how they look, because better-looking figures doing odd things would not help.
- A **figure quality pass** is added to the viewer work, done together with the player card (milestone 5), since the card shows the model close up and needs it anyway:
  - Body parts with real shape instead of plain blocks and capsules: shaped torso with shoulder pads under the jersey, tapered limbs, proper gloves, skates with blades, helmet with visor or cage, pants and socks as separate pieces, goalie pads with shape.
  - Weight in the picture: heavier players visibly thicker through the chest and legs, not only scaled; jerseys that hang; a lower, wider stance for big men.
  - Weight in the movement: heavier players take longer to start and stop, lean harder into turns, and move less when hit; lighter players are quicker on their edges. The animation reads the player's mass, it does not change the engine's result.
  - Per-player look: skin tone, hair and beards showing under the helmet, stick tape, number and name, generated crest.
- Still code-built figures (no imported models), so the style stays clean rather than photo-real. If the pass falls short of what the owner wants, the next step up is hand-made models, which is a bigger decision to raise with him then.
