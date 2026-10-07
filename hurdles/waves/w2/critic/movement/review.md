# Critic review: movement (Movement and camera), wave 2

## Reference

**Bright Lancer** by Slo Nod, https://slo-nod.itch.io/bright-lancer. It has 4.5 stars from 140 ratings and was pinned in wave 1.
It is a top-down pixel action game with a small hooded runner, 8-way running, a long streaking dash that ends in a tumble, and a camera that
follows and leads the runner. Those are the same verbs this piece owns.

**How the ref side was captured:** the ref strips are the wave-1 critic's live captures of the pinned build. The build was played with scripted WASD
and Space, recorded, and sampled at 10 fps, using a 480x270 window at the centre of the 1280x720 screen. The game has not changed, the
`hero` critic this wave found that the downloaded build still cannot get past the ship deck under SwiftShader, and the same five moments are
re-judged. So I reused those captures unchanged (`hurdles/waves/w1/critic/movement/ref/`).

**How ours was captured:** `/?showcase=movement&zoom=1&hud=0&trail=0&auto=0` at game scale, with no trail, labels or demo pilot. The sim was frozen,
input was injected with `__GR.debug.input`/`tap`, and the sim was stepped 6 ticks per frame (exactly 10 fps of sim time). Generator:
`shots/critic/movement/gen/strips.cjs` (`SET=sc`). **Zoom matching:** our hero is now about 90 px tall on a 1280x720 screen, and the ref hero is about 66 px.
So ours uses a 656x369 window at the centre of the screen (the ref uses 480x270), and both are shown at 320x180. This puts the hero at about
24% of the frame height on both sides.

**Why the packet is from the showcase and not an arena:** at matched zoom, a fixed centre window in our arenas loses the hero whenever it is
near a wall, because the arena camera barely moves (problem 1). That would penalise a framing a player never sees, so I report it here instead.
Be aware that the packet therefore flatters our camera relative to normal play.

## Verdict (not blind)

**The reference is better, by a small margin.** Our controller is now as crisp as the reference or crisper. Starts and stops take 3-4 ticks, the dash
covers 4 units in 10 ticks with a long streak and an impact burst, and slides never stick. But in normal play our camera is effectively parked,
while the reference's camera visibly carries every run and dash. Our dash also ends in a pale blob and a 6-tick crawl instead of a clean landing.

## Biggest gap

**Make the camera actually lead in arenas, where players spend the run.** In `/?scene=run&seed=3` (arena 1, 17x12 units, about one screen wide),
`__GR.debug.camera().x` is clamped to +/-1.10. While the hero runs from x=-3.1 to x=+6.4, the camera does not move at all
(`shots/critic/movement/gen/t4` log, and `shots/critic/movement/arena2/grid.png`, frames L2-L5). Near a wall it moves only because the `edgeX`
rule pushes it (cam -2.7 when the hero is at -8.2), and that leaves the hero about 20% from the screen edge. The 1.25-unit move lead and
0.35-unit facing lead are clamped away for roughly 60% of the room width. So in play the hero slides across a still screen, and the reference never looks like that.

Do this in `src/render/camera.js`:
- Set `padX` to at least `lead + dashLead + facingLead` (about 2.2) and `padZ` to about 1.4, so the bounds clamp no longer eats the lead in a room one screen wide.
  Panning 2 units over the walls into the dark surround is fine, because the void is already shown at the showcase edges.
- Lower `edgeX` from 0.7 to about 0.5, so that near walls the hero stays within the middle half of the screen (about 25% from the edge).
- Re-check with the arena-1 sweep: `camera().x` should track `hero.x + lead` across the whole room and stop only within about 2 units of a wall. When the hero runs
  right from the centre, the hero should sit about 1.25 units left of the screen centre (about 80 px at 1280 wide).

## Problems

1. **The arena camera is parked (see Biggest gap).** Where: `/?scene=run&seed=3`, then `debug.freeze`, `move('teleport',0,0)`, hold left or right.
   It hurts because the must-have "camera look-ahead toward movement and aim" is barely visible in play, and the movement loses the feeling of
   carrying the view that the reference has in every strip. The fix is in Biggest gap.

2. **The dash ends in a flat, pale-cyan blob and a crawl, so it does not land as one clean event.** Measured from rest, the dash runs 30.46 u/s for 7 ticks, then 15.2 and 7.9 u/s,
   then **6 ticks at 1.47 u/s** (`dashRecover` and `dashExit`), and only then returns to run speed (`shots/critic/movement/t11` log `od 4-6`, and `od-strip.png`). On screen, frames 4-7
   of `od-strip.png` show a large pale-cyan cloud behind a crouched hero for about 130 ms. At 10 fps it reads as the hero stalling inside a paint smear
   (pair 04 frames 7 and 16 in `hurdles/waves/w2/critic/movement/ours/04-double-dash-strip.png`). The reference shows a tapered streak for 2 frames, then a tumble
   that keeps moving. Do instead:
   - Make the trailing smear a tapered band 2 voxels tall that narrows to the tail, rather than a cloud as tall as the hero. Fade it over 4 ticks, not about 8.
   - Keep the exit speed at 60-70% of run speed while a direction is held (`dashExit` 0.65, `dashRecover` 2), so a run-dash-run chain never visibly dips.
     Keep the crouch pose, but drive it from the anim and not from the speed.
   - Keep the 0.35 exit speed only when no direction is held (the skid to a stop).

3. **The hero can walk back into the sealed south doorway and vanish behind the portcullis.** Where: `/?scene=run&seed=3`, then `move('teleport',0,2.5)`, wait for the
   seal (`state:"sealing"`), and hold down. The hero walks to z=5.85, about 2.1 units past the room's south wall line (3.7), and only the tip of the hood shows
   above the bars (`shots/critic/movement/gate/gate-down.png`, and `shots/critic/movement/run/run-down.png`). Backing off right after entering is a common
   move, and an invisible hero during wave 1 is a readability failure. Do instead: when a door seals, add a box collider at the wall line (z = room maxZ, across the
   door width), and push the hero out of the alcove on seal. The collider list is arenas', so coordinate with that piece. `collision.js` only needs to accept the
   added box at runtime (`addBox` and `remove` already exist).

4. **On wall contact, the "lead" becomes a large bookkeeping value that points away from the hero.** When the hero stops against a wall, `still` hits 1 and `vLead` is
   set to `goal - hero - aLead`, which is the clamped camera offset. In the arena that is +6.0 or -5.9 units (the `lead` values in the t4 log at `left105`, `right225` and `up30`).
   It is held for 36 ticks and then relaxes over about a second. In the showcase, after a wall push and a teleport, the camera sat 2.2 units on the side away
   from the hero's facing (`shots/critic/movement/full/center-full.png`: the hero at x=-2 faces left, and the camera is at +0.18). It hurts because the next run starts with
   the camera drifting the wrong way. Do instead: cap the captured stop lead at `lead + facingLead` (about 1.6), and do not capture it at all when
   `contact` is set (the hero stopped because of a wall, not because the player let go).

5. **Arena seal re-frame yanks the view away from the hero.** In arena 2 (`debug.goto(1)`), the camera z went from 3.24 to 0.54 over about 20 ticks the moment the wave began.
   The hero, standing still at z=4.09, was left 3.6 units below centre, which is the `edgeZ` limit (t10 log, `right5` to `right-stop`, and `shots/critic/movement/corr/grid.png`).
   Showing the arena on seal is a reasonable idea, but doing it while the player is standing still reads as the camera losing them. Do instead: ease the bounds
   change over about 0.5 s (60% of the way in the first 0.25 s) and cap the hero's offset at about 0.45 of the half-height during the transition.

6. **The hero sprite overlaps thin walls it is sliding along.** In `shots/critic/movement/t11/wd-strip.png` (dash into the x=3.7 partition) and in pair 05,
   the hood covers the partition's top face, so the slide reads as the hero being half inside the wall. Wave 1 raised this too (problem 8). Do instead: for walls on the camera-facing
   and side faces, add about 0.08 units to the body radius against `wall` boxes only, or draw the partition cap after the hero when the hero is behind its front face.

7. **Low impact: the dash cooldown is the full 14 ticks even when a wall cuts the dash short after 1 tick.** A dash into the partition from 0.9 units away moved
   0.9 units, then spent `dashCooldown` 14 (only a zero-distance dash gets `dashBumpCooldown` 6), in the t2 and t11 logs (`wd`). Scale the cooldown with the fraction of the dash
   actually travelled, with a floor of 6 ticks.

What is fixed since wave 1 (verified): the dash is now 4 units in 10 ticks with a flat profile, a long streak, an origin ring and an after-smear. A head-on run at a round pillar rolls
off (`rollOff`; zero stuck ticks from dx=0, 0.2 or 0.4 in the t12 log). A press during cooldown is held until the dash can fire (a press at cd 13 fired at cd 0). A dash into
a wall shows an impact burst. A wall slide runs at 90% of run speed (3.78 u/s). The camera stops within about 1 frame of the hero, with about 0.35 units of drift left (pair 01).

## must_have checklist

- **start and stop within 2-4 frames: snappy, never floaty, never instant: PASS.** From rest the speed runs 2.31, 3.35, 3.82, 4.20 (full on tick 4). On release it runs 2.10,
  1.05, 0.53, 0 (rest on tick 4). A reversal reaches full speed the other way on tick 4 (t1 log). In pairs 01 and 02, the hero stops within 1 frame at 10 fps and the camera settles 1 frame later.
- **dash is buffered, has i-frames, and cancels attack recovery: PASS.** Buffered: a press at cooldown 13 is held (`dashQueued` 14 down to 2) and fires on the tick the cooldown ends.
  A press during the attack windup (t=1) is held and fires at attack t=8. I-frames: `invulnerable:true` for all 10 dash ticks. Cancel: K pressed in recovery (attack t=9) dashes on the same tick (t1 and t11 logs).
- **sliding along walls and corners never sticks: PASS.** Flat walls slide at 3.78 u/s. The 0.7 gap is passable from up to 0.4 units off centre, and the 0.9 gap from up to 0.55.
  Square-block corners clear with 0.5 or more of overlap, the cornerAssist covers 0.34, and a face-on hit correctly stops. Round pillars roll off from dead centre. The inner L corner stops, which is correct (t12 log). The one real "stuck"
  case is the arena door alcove (problem 3), which is a collider-placement bug and not a slide bug.
- **camera look-ahead toward movement and aim, texel snapped: PASS in the showcase, weak in play.** In the showcase the lead swings by 1.25 units with movement plus 0.6 on a dash (pair 04: the camera
  jumps ahead with each dash), and `relSnap:true` gives no swimming in any strip. In arenas the bounds clamp limits it to +/-1.1 units, and it is invisible across most of the
  room (problem 1). I mark this a pass only because it now moves at all in play, where wave 1 measured 0.

## Console errors

None. Every capture logged 0 errors: the showcase strips, `?scene=run&seed=3` (arena 1, arena 2 via `goto(1)`), the tick tests, the collision probes and the
gate test. The ref captures are reused from wave 1 (there, only the Unity loader's 404s and analytics CA errors, which do not affect play).

## Files

- Matched pairs: `hurdles/waves/w2/critic/movement/ours/` and `.../ref/` (01 start-stop, 02 reversal, 03 eight-way box, 04 double dash, 05 wall slide).
- Blind packet: `hurdles/waves/w2/blind/movement/` (with criteria.md). Key: `hurdles/waves/w2/keys/movement.json`.
- Scratch: `shots/critic/movement/`. `gen/` holds the harness `h.cjs`, the per-tick tests `t1`-`t13` and `strips.cjs`. `ours-frames/` and `strips/` are the arena-play strips
  (not in the packet; they show the parked camera). `arena*/`, `corr/` and `gate/` are the camera and door evidence, and `t11/` holds the dash frames.
