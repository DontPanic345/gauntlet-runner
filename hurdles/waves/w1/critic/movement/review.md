PIN: https://slo-nod.itch.io/bright-lancer | 4.5 stars (140 ratings) | top-down pixel action game on itch's top-rated hack-and-slash list, tagged fast-paced, with a long streaking dash and a following camera; HTML5, so it can be played live with scripted keys

# Critic review: movement (Movement and camera), wave 1

## Reference

**Bright Lancer** by Slo Nod (https://slo-nod.itch.io/bright-lancer). It has 4.5 stars from 140 ratings and is on itch's top-rated
hack-and-slash list, tagged top-down, fast-paced and action-RPG. It is also the pinned reference for `hero`.

**Why it is the right comparison:** it is a three-quarter top-down pixel action game with a small hooded runner. It has the same verbs we are judging:
8-way run, a dash with a long streak and an after-image, and a camera that follows and leads. The opening level (an airship deck with railings,
a cabin and a ramp down to a grass cliff) has walls to slide along. It runs in the browser, so I captured live frames instead of
a trailer. I looked for a stronger HTML5 game praised specifically for its dash. itch's listing pages sit behind a Cloudflare challenge for
curl, so I could not browse more, and the candidates the `hero` critic checked (Lucah, Gaunt Valkyr, Neophyte) are not HTML5.

**How it was captured:** the Unity WebGL build was already downloaded to `shots/critic/hero/blgame/` and served through capture.cjs
(`/shots/critic/hero/blgame/play.html`, 1280x720). I played it with scripted WASD and Space (`shots/critic/movement/blm2.json`), recorded a webm,
found each move from a frame-difference timeline, and sampled it at 10 fps with ffmpeg. Under SwiftShader the game renders about 10 unique
frames a second, so 10 fps is the finest honest rate. Our side used `/?showcase=movement&zoom=1&hud=0&trail=0` (game scale, no labels and no trail,
because the reference has neither). The sim was frozen, the same key timings were replayed, and `__GR.debug.step(6)` was used per frame (exactly 10 fps of sim time;
generator in `shots/critic/movement/gen/gen.py`). Both sides use the same fixed 480x270 crop at the centre of the screen, so camera motion is visible.

## Verdict (not blind)

**The reference is better.** Our start and stop timing is as crisp as its timing, but its dash reads as a real move, and ours reads as a small hop.
Its camera visibly carries the motion. In real arena play, ours does not move at all.

## Biggest gap

**Make the dash a long, readable streak instead of a 1-frame hop.** Today it moves 2.5 units in 11 ticks with a front-loaded profile: it starts at 30 u/s, and
half the distance is covered in about 3 ticks. That is about 40 px at strip scale, under two hero widths, and at 10 fps it shows up as one frame
with one cyan blob (`shots/critic/movement/o-dash2.png`, frames 8-9 and 13-14). The reference dash covers about 2.5x that on screen,
shows across 2-3 frames as a long tapered smear, and lands in a tumble (`shots/critic/movement/bl2/s-dash2.png`, frames 6-8 and 13-14).

Do this:
- Raise `dashDist` to about 3.8 and `dashTicks` to about 13.
- Use a flat-then-ease profile: hold about 90% of peak speed for the first 8 ticks, then ease out over 5, instead of the exponential decay.
- Keep `dashIframes` covering the flat part.
- Draw a smear that stretches from the start point to the hero for the first 4 ticks, a voxel band 2-3 voxels tall in the cloak colour, fading over 6 ticks.
- Add 3 to 4 after-images spaced evenly along the path instead of one blob.
- Kick up a dust puff at take-off, facing back along the dash.
- Add a 2-tick landing skid (dust plus a crouch) when the dash ends with input still held.

## Problems

1. **The dash is short and front-loaded, so it reads as a teleport-hop** (see Biggest gap). Measured per tick, the speed runs 30.0, 25.4, 21.1, 17.4, 14.1,
   11.3, 8.9, 7.1, 5.7, 4.7, then normal run speed (`shots/critic/movement/tick/evals.txt`, run from `/?showcase=movement`, freeze, step 1 per eval).
   It hurts because the dash is the headline verb of a movement piece, and the blind judge will see the other side's dash in every dash frame. The fix is in Biggest gap.

2. **In real play, the camera does not lead or follow at all.** In `/?scene=run&seed=3`, I ran the hero from x=-7.6 to x=+3.4 across the antechamber.
   `__GR.debug.camera().x` stayed within 0 +/- 0.1 the whole time, and `want.x` swung to +/-4.9 but was clamped away.
   Camera z only moved between 1.96 and 0.14 (`shots/critic/movement/run1`, `run2`, and the four identical framings in
   `shots/critic/movement/run0-grid.png`). The look-ahead, dead-zone and easing this piece owns exist only in the showcase room. It hurts because the
   must-have "camera look-ahead toward movement and aim" is invisible where players are. A locked arena camera also feels dead next to the reference.
   Do this: clamp the camera to the arena bounds **expanded by the lead amount** (about 1.25 units on x and 0.8 on z), so it can pan about +/-1.2 units over the
   arena walls and void edge. Keep the room's walls on screen. Alternatively, make the arenas wider than one screen. Then re-check that `camera().x` follows
   the hero in arena 1.

3. **Running straight at a round pillar sticks the hero dead.** In `/?showcase=movement`, teleport to (-8, -3) with `debug.move('teleport',-8,-3)` and hold W (`shots/critic/movement/col/evals.txt`).
   The hero stops at (-8, -5.25) with speed 0, `sliding:true` and contact [0,1], and stays there for as long as W is held. With a 0.1 offset, it slides around
   cleanly. Keyboard players line up with the slalom pillars exactly (they sit on a 2-unit grid), so this will happen in play. It hurts because the
   must-have says "never sticks". Do this: when the contact normal is within about 8 degrees of the input direction against a **circle** collider, add a
   tangential nudge, for example 60% of run speed toward the side that the facing, or else the hero's last lateral velocity, points to. That way the hero rolls off the pillar. Square
   blocks and flat walls can keep stopping dead (that is correct).

4. **The camera keeps moving after the hero stops, which softens the stop.** In `shots/critic/movement/o-startstop.png`, the hero stops at frame 10.
   Its screen position keeps drifting about 25 px through frames 10-14 while the camera finishes catching up to its goal and lead. Read as a strip, the stop
   looks like a slide, even though the sim stops in 4 ticks. Do this: when input drops to zero, freeze the movement part of the lead at its current value
   (decay it over about 0.6 s, not 0.2 s) and cut the camera spring's `smooth` to about 0.08 s for the catch-up. The world should stop when the hero stops.

5. **The room-edge clamp pushes the hero to the screen edge.** In the showcase, holding S then S+A into the left wall (`shots/critic/movement/o-wall/wall-12.png`)
   puts the hero about 40 px from the left edge of a 1280 px screen, half over the frame border. Near the pillar field the same happens on the right
   (`shots/critic/movement/o-cornerdash.png`: the hero leaves the centre window entirely from frame 15). Do this: keep `maxOffX` binding even when the room clamp
   applies. Let the clamp allow about 2 units beyond the wall face, so the hero is never closer than about 15% of the screen width to an edge.

6. **A dash pressed more than 133 ms before the cooldown ends is dropped.** With D held, I pressed K at cooldown 13. `dashQueued` counted 7 down to 1, expired, and no dash fired
   (`shots/critic/movement/tick/evals.txt`, lines after "--- buffer"). GAME.md says "No input dropped". Do this: hold a dash press until the cooldown ends plus 8 ticks
   (buffer = max(dashBuffer, cooldown remaining + 2)), or shorten the cooldown to 12 ticks so the 8-tick buffer covers most of it.

7. **A dash into a wall does nothing visible.** At the partition (x=3.4), a dash fired with speed 0 for its whole duration, spent its cooldown, and showed nothing but the
   after-image on the spot (`shots/critic/movement/tick/evals.txt`, the second dash). Do this: when a dash starts with contact against the input direction, redirect it along
   the wall tangent if the input has any tangential part. Otherwise play a 3-tick bump: a dust burst at the wall, a 1-voxel recoil and a tiny shake through the shared channel.

8. **Walls do not read as walls, so slides along them look like the hero stopping in an empty floor.** The partition and the L-block are value-matched to the
   floor, and the hero is navy on navy (`shots/critic/movement/o-wall2.png`, `o-corner.png`). In `o-corner.png` frames 9-12, the hero's sprite overlaps the
   top of the L's leg, so the slide looks like clipping. The colours mostly belong to the look and hero pieces. For this piece's showcase: give the obstacle tops a lighter cap
   row and a 1-voxel dark base line, so the slide surfaces separate from the floor. Offset the slide-contact radius so the sprite's widest voxel does not
   overlap the wall's top face in screen space (about +0.08 units on the side facing the camera).

9. **Wall slide speed is 71% of run speed with diagonal input** (`sliding:true`, speed 2.97, in `o-wall2` and the left-wall test). That is the plain projection.
   It is acceptable, but it reads as the hero being slowed by the wall. Consider renormalising the tangential part to about 90% of run speed while sliding.

## must_have checklist

- **start and stop within 2-4 frames: snappy, never floaty, never instant: PASS.** Measured per tick from rest (D held), the speed runs 2.31 > 3.35 > 3.82 > 4.2, reaching full speed on tick 4. On release it goes
  4.2 > 2.1 > 1.05 > 0.525 > 0, which is 4 ticks (`shots/critic/movement/tick/evals.txt`; `debug.move()` also reports startTicks 3 and stopTicks 4). The soft look of the stop comes from the camera (problem 4), not from the controller.
- **dash is buffered, has i-frames, and cancels attack recovery: PASS, with caveats.** It is buffered for 8 ticks (`dashQueued`), and a press made during a dash fired when the cooldown ended.
  It has `invulnerable:true` for 9 of its 11 ticks. A K press 8 ticks into an attack (J) fired a dash on the same tick. The caveat: a press made earlier than 8 ticks before the cooldown ends is dropped (problem 6).
- **sliding along walls and corners never sticks: FAIL (one case).** Flat walls slide (left wall, partition). The 0.9 and 0.7 gaps pass even 0.2 off centre, and
  square-block corners pass with a 0.08 nudge. But a head-on run at a round pillar sticks the hero indefinitely (problem 3).
- **camera look-ahead toward movement and aim, texel snapped: FAIL in play, pass in the showcase.** In the showcase the lead visibly swings (the hero sits about 65 px off centre
  toward facing at rest, and the camera overlay `V` shows the dead-zone and lead), and `relSnap:true`, with no swimming seen in the strips. In arena play the camera
  x is pinned at 0 and the lead is clamped away (problem 2).

## Console errors

None on our side in any capture: the showcase, `?scene=run&seed=3`, the tick test and the collision tests all logged 0 errors.
On the reference, the errors were the Unity loader's 404s and proxy CA errors from its analytics fetches, which do not affect play.

## Files

- Matched pairs: `hurdles/waves/w1/critic/movement/ours/`, `.../ref/` (01 start-stop, 02 reversal, 03 eight-way box, 04 double dash, 05 wall slide).
- Blind packet: `hurdles/waves/w1/blind/movement/` (with criteria.md). Key: `hurdles/waves/w1/keys/movement.json`.
- Scratch: `shots/critic/movement/` (o-* our bursts, bl2/ reference video and strips, tick/ and col/ per-tick logs, gen/ capture generator).
