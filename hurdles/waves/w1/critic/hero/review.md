PIN: https://slo-nod.itch.io/bright-lancer | 4.5 stars (140 ratings) | top-down pixel-art action game on itch's top-rated hack-and-slash list, whose small hooded, caped hero has an expressive spear combo, dash, and cape motion; it is HTML5, so it can be captured live

# Critic review: hero (Hero model and animation), wave 1

## Reference
**Bright Lancer** by Slo Nod (Luke Nowland and Andrew Beauman), at https://slo-nod.itch.io/bright-lancer.
It has 4.5 stars from 140 ratings and appears on itch's top-rated `tag-hack-and-slash` list.

**Why it is the right comparison:** it is a three-quarter top-down pixel action game, and its player is a *small hooded, caped runner*,
which is nearly our hero's exact brief. On screen the character is about the same size as ours in play (about 60 px against
our 70 to 90 px at 1280x720). It has the same verbs: run, dash, and a three-hit melee combo. It is known for exactly what this piece owns:
a cape that flares on every action, big smear arcs, and a leaping finisher.

I also considered these:
- Gaunt Valkyr (4.9 from 94). It is pinned for `look`, but it is not HTML5 and its page has no character close-ups.
- Lucah: Born of a Dream (4.7 from 208). It is not HTML5.
- The Lair (4.6 from 174). It is a PICO-8 game whose hero is too small to compare animation with.

**How it was captured:** it is a Unity WebGL build at `html-classic.itch.zone/html/3228468/...`. Headless Chromium rejects the
proxy's CA, so I downloaded the build files with curl into `shots/critic/hero/blgame/` and served them through
capture.cjs's local server (`/shots/critic/hero/blgame/play.html`, container resized to 1280x720). I played it with keys
and mouse (WASD, LMB, Space), recorded webm video, and sampled it at 10 fps with ffmpeg. Our side used the showcase at
`?showcase=hero&zoom=1`, which matches gameplay scale, with the HUD hidden (H). The sim was frozen and advanced with `__GR.debug.step(6)` per
frame, which is exactly 10 fps of sim time, because a screenshot takes about 2 s under SwiftShader.

The opening of the reference has no enemies, so **hurt and death could not be matched**. They are judged below, but not
blind.

## Verdict (not blind)
**The reference is better**, and clearly. Its hero is a readable *character* in every frame, with a cape, hair, and a spear. Ours is a navy
box that animates inside its own outline.

## Biggest gap
**Give the hero a silhouette that reads as a character from every facing, and make the cloak carry the motion.** Shrink the
hood from about 60% of body height to about 40%, so a body and legs show under it. Add a real cloak hanging behind the body: a
separate 3 to 4 segment voxel chain, 5 to 7 voxels long, pinned at the shoulders and driven by the same lag spring as the scarf. It should trail
1 to 2 segments behind velocity on run, stream fully out on dash, and whip out on each swing. Then separate the hero's value and
hue from the blue-violet floor. Make the hood/cloak a lighter or warmer accent (for example a bone or rust cloak over a navy tunic, not
navy on navy) so the shape pops in a thumbnail. Today, from behind or the side, the hero is a featureless blue rectangle
(`shots/critic/hero/p2c/run-*.png`, `shots/critic/hero/c-dash.png`), and every animation has to be read through
that box.

## Problems
1. **The silhouette collapses to a box from behind and the side.** In play at 1x (`/?scene=run&seed=3`, any `p2c/run-*`,
   `p2c/atk-*`, pair 05), the hood is one navy cube covering most of the body. Facing away or sideways, nothing but
   a blue rectangle and a red scarf flap is visible, with no head shape, shoulders, limbs, or cloak. Players spend most of the run
   seeing the hero from behind or the side, so it hurts all the time. The reference hero is narrow, with a cape flaring off one side and a spear
   line, and it reads as a person at any facing. Do instead: the hood or cloak split from the Biggest gap, plus a 1-voxel taper at the
   hood's shoulders, so the back view has a head bump and shoulder line.
2. **The hero shares its value and hue with the floor.** Navy hood on blue-violet stone (`c-idle.png`, pair 05). The hero
   separates only by its glowing eyes, which disappear when it faces away. The reference uses magenta against green or brown, at full
   contrast. GAME.md demands that the player separate from the floor at a glance. Do instead: lift the hood/cloak 2 palette steps
   lighter, or move the large mass to a warm accent, and keep navy for the tunic only.
3. **The attack smears are too short to be seen.** In the showcase attack (`?showcase=hero&zoom=1`, key 5), sampled at 10 fps
   (`c-atk.png`), *no smear appears in any of 18 frames*. At 30 fps (`c-atk30.png`) each smear exists for only about 2 frames
   (about 4 ticks), and anticipation is 1 to 2 frames on hits 1 and 2. The reference's teal crescent shows up in its 10 fps strip on every hit
   and stays big (about 1.5x body height). Do instead: hold each smear 6 to 8 ticks, fading over the last 3. Make it at least 1.5x hero
   height. Make hit 1 and hit 2 anticipation at least 4 ticks with a visible pull-back of the blade *behind* the body.
4. **The combo reads as the hero spinning in place.** Each hit rotates the whole body to a new facing (`c-atk30.png` row 1 to 2:
   facing right, then back-left, then front), so the combo looks like random turning rather than three escalating blows in one
   direction. The reference keeps facing the target, lunges forward a step per hit, and the finisher is a *leap* with a ground
   shadow and a landing crouch. Do instead: keep the body yaw within about 30 degrees of the aim direction, alternate the blade side
   instead, add a 0.2 to 0.3 unit forward lunge per hit, and make hit 3 a hop (about 4 voxels up, shadow stays on the ground) into a
   2-frame squash on landing.
5. **The dash has no stretch and no wind-up, and shows the hero as a flat slab.** In `c-dash.png`, frames 0 to 2 are a static side
   profile. The dash is then a teal afterimage smear, then 6 or more frames of standing sideways, with the scarf as the only moving
   part. The reference dash stretches the character into a long streak with speed lines, then lands into a tumble with a spin ring
   (`ref/03`). Do instead: a 2-tick crouch (squash 0.8 vertically), then the body stretched 1.4x along travel and the cloak streaming
   flat behind. End with a 3 to 4 tick skid crouch and a dust puff, then a settle.
6. **The idle is almost frozen.** In `c-idle.png`, 18 frames over 1.8 s are nearly identical. The breathing is 1 voxel at most and the scarf
   hangs hidden behind the body from the default facing. The world rule is "never fully still", and the hero is the most-watched thing.
   Do instead: a 2-voxel breathing bob of hood and shoulders on a 1.5 s period, a cloak hem that sways continuously, and the
   scarf tip visible beside the body in the default 3/4 view.
7. **The run cycle can't be read at gameplay scale.** In `c-run.png`, the legs are 1 to 2 voxel brown nubs under the hood, so the contact and
   passing poses only show at showcase 3x zoom (`sh-run.png`). At 1x the run is a bobbing box with a flapping scarf. The
   reference shows clear alternating legs and a cape that streams back. Do instead: legs at least 3 voxels long, visible below the
   hood, with a stride that clears the body outline at contact, and a 1-voxel body dip on the down pose.
8. **The spawn squash reads as falling over.** In `c-spawn.png` frame 2 (and frame 14), the landing squash flattens the hero
   so far it looks like it is lying on its side. Do instead: cap the squash at about 0.65 vertical and 1.3 horizontal, and keep the
   eyes visible.
9. **The hurt reaction is lost in play.** In `p2c/hurt-*.png` (gameplay, husks attacking), the hero's pose barely changes. There is a
   1-frame white flash and a "-1", but no visible flinch or knock-back lean, so the hit reads as the HUD's doing, not the
   character's. In the showcase (`c-hurt.png`), the wince eyes are nice but last only about 2 frames at 10 fps. Do instead: a 6 to 8 tick
   lean away from the hit source (about 20 degrees), with the cloak whipping forward, then a recovery.
10. **The death ends as a flat box.** In `c-death.png`, a flash and wince, then a topple face-down into a lying blue block with no bounce and no
    cloak settle. It is acceptable timing, but there is no appeal in the final pose. Do instead: one small bounce on impact, a 1-frame dust ring, the cloak drifting
    down over the body for 10 ticks, and the sword skittering a voxel or two away.

## must_have checklist
- **Silhouette readable at 1x internal resolution: FAIL.** It is readable as *an object* from the front thanks to the glowing eyes, but
  from behind or the side at gameplay scale it is a featureless navy rectangle close in value to the floor (`p2c/run-08.png`,
  pair 05, problems 1 and 2).
- **Scarf or cloak with lagging secondary motion: PASS (weak).** The red scarf lags and flaps on run and dash (`c-run.png`,
  `c-dash.png`). It is small, hidden in idle, and is the only secondary motion.
- **Run cycle with contact and passing poses, footstep dust hook: PASS (weak).** The poses exist at 3x (`sh-run.png`), and footstep
  specks show at the feet in play (`p2c/run-*`). But the legs are too short to read at 1x (problem 7).
- **Each attack swing has anticipation, smear and recovery frames: PASS (barely).** All three exist at 30 fps (`c-atk30.png`), but
  smears last about 4 ticks and anticipation 1 to 2 frames, so they are invisible at 10 fps (problem 3).
- **Facing changes turn quickly but never pop: PASS.** `c-turn.png` shows reversals rotating through the 3/4 back view over 2 to 3
  frames with no snap.

## Console errors
None on our side in any capture (`shots/critic/hero/s1`, `p2`, `sc`, `a2`: 0 errors). The only errors on the reference side
were ERR_CERT_AUTHORITY_INVALID for itch's external `htmlgame.js` and analytics, which did not affect play.

## Packet
5 pairs: idle strip, run strip, dash strip, attack combo strip (all 18 frames at 10 fps, 320x240 crops at gameplay scale), and one
in-scene still at 640x360. Hurt and death are unmatched (see above).
