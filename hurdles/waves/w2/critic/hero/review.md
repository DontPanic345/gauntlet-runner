# Critic review: hero (Hero model and animation), wave 2

## Reference
**Bright Lancer** by Slo Nod (Luke Nowland and Andrew Beauman), at https://slo-nod.itch.io/bright-lancer. It has 4.5 stars from 140 ratings
(re-checked on the page 2026-10-07). It was pinned in wave 1.

**Why it is the right comparison:** it is a three-quarter top-down pixel action game whose player is a small hooded, caped lancer with a
dash and a three-hit combo. That is nearly this piece's brief, and the character is the game's best-known asset.

**How it was captured:** the Unity WebGL build (`html-classic.itch.zone/html/3228468/...`) was downloaded again into
`shots/critic2/hero/blgame/` and served locally (`play.html`, 1280x720). It loads and plays (`shots/critic2/hero/r1sheet.png` to `r5sheet.png`). Under
headless SwiftShader, though, the opening airship level renders as a split view, and in five scripted attempts (Space, Shift, right-click
and other keys) I could not get the hero off the ship. **The ref side of the packet therefore reuses the wave-1 critic's live captures of
the same pinned game** (`hurdles/waves/w1/critic/hero/ref/`: idle, run, dash and combo strips at 18 frames and 10 fps, 320x240 crops that follow the
hero, plus a 640x360 still). Ours was recaptured this wave in the same format. **Hurt and death are again unmatched**, because the
reference opening has no enemies. They are judged below, not blind.

**How ours was captured:** the sim was frozen and advanced with `__GR.debug.step(6)` per frame, which is exactly 10 fps of sim time. Each
crop is 320x240 and follows the hero (pink-pixel centroid), the same way the reference camera follows its hero.
- Idle, dash and combo come from `?showcase=hero&zoom=1&hud=0` (game scale), with modes set through `debug.hero('mode', ...)`.
- Run comes from real play, `/?scene=run&seed=3`, with the hero teleported to open floor and run with `debug.input`
  in four directions.
- The still is a play frame (`shots/critic2/hero/play3/run-13.png`).

Scratch output is in `shots/critic2/hero/`: `*-strip-t.png` (showcase), `p3-*.png` and `play-*.png` (gameplay), and `z3-*.png` (3x zoom detail).

## Verdict (not blind)
**The reference is still better**, though by a smaller margin than in wave 1. Ours now pops off the floor (the rose hood against blue-violet stone),
and its smears are big. But it reads as *a pink hood with feet*, not as a person. The reference hero reads as a slim character with a cape and a
spear in every frame.

## Biggest gap
**Fix the proportions: the hood is still the whole character.** At game scale the rose hood (including its tip) is about 55% of the hero's
height, about 150 of 270 px at 3x (`shots/critic2/hero/z3-run-detail.png`). It is one flat-coloured box that hides the face, shoulders and arms, and the
legs are 2-voxel brown stubs under it. So:
- From the side, every dash and every horizontal run shows a pink mitten, with the hood tip poking forward like a thumb and the
  cyan scarf hanging down where a leg should be (`p3-dash.png` row 2, `play-run.png`, `play3/still.png`).
- From behind, it is a pink box sitting on a flat red cape slab that fans out like a table (`z3-run-detail.png` bottom row).

What to do:
- Shrink the hood to about 4 of the 12 voxels, about 35% of the height, and cut the tip to 1 to 2 voxels that point *back* and droop.
- Open a 2-voxel-deep face inside the hood brim, with a skin or shadow tone around the eyes, so the head reads as a head.
- Give the body 7 to 8 voxels: a shoulder line wider than the hood by 1 voxel each side, visible arms, and legs at least 3 voxels long in a
  dark contrasting trouser colour.
- Make the cape a separate, darker red chain hung from the shoulders, narrower than the body from the front, so it frames the body
  rather than replacing it.

The test is this: the side profile at 1x must show head, torso, arm and two legs as distinct shapes.

## Problems
1. **The hood swallows the body, and the side and back views read as objects, not a person.** This is the Biggest gap, seen in
   `shots/critic2/hero/p3-run.png` (frames 2 to 9), `dash-strip-t.png` (frames 0 to 1 and 6 to 11), `play-run.png`, `play3/still.png` and
   `z3-run-detail.png`. Next to the green husks in the same frame (`play3/still.png`), the enemies read more like characters than the
   hero does. It hurts because players see the hero from the side and back most of the run, and the judge sees a pink blob in 4 of the 5 pairs.
2. **The dash stretch lays the hero flat, so it reads as falling over.** In `dash-strip-t.png` frame 2 (and frame 14), the body is
   rotated or stretched into a horizontal pink slab lying on the floor. Frame 3 is a cyan afterimage blob, and then the dash is over. At 10 fps
   the dash gets 2 frames of motion, then 6 or more frames of standing in side profile with the scarf dangling. The reference keeps the character
   upright and compact, with a cape streak and speed lines behind, and ends in a spin ring. Do instead:
   - Stretch along travel by at most 1.25x while keeping the hood upright (lean the torso 20 to 25 degrees; do not rotate the whole rig).
   - Stream the cape flat behind at head height.
   - Hold a 3-frame (at 10 fps) skid crouch with the off-arm out for balance, then settle.
3. **The combo still spins the body between hits.** In `attack-strip-t.png` (frames 1 to 6) and `play3` `p3-atk.png` (frames 0 to 6), hit 1 faces
   up-right, away from the camera, hit 2 faces front-left, and the recovery faces away again. The hood's flat back fills the frame on hits
   1 and 3, so the swing happens *behind* a pink box. This is wave-1 problem 4, only partly fixed (the hop finisher and the lunges now exist:
   frame 6, with its shadow). Do instead: clamp body yaw to within 30 degrees of the aim direction for all three hits, and alternate the blade side
   (forehand, backhand, overhead) rather than the facing.
4. **The idle is nearly frozen at game scale.** `idle-strip-t.png` has 18 frames that are almost identical. The look-around turns the
   hood by a few pixels, and the breathing is under 1 px at 1x. The reference idle has visible cape and hair sway. Do instead: a 2-voxel hood
   and shoulder bob on about a 1.5 s period, a cape hem that sways 1 voxel continuously, and a scarf tail that flutters in view beside the body.
5. **The sword hand is a saturated yellow blob that reads as a separate item.** The gold glove and hilt form a bright yellow lump that,
   at 1x from behind, looks like a held torch or flame (`p2-idle.png`, `p3-idle.png`, `idle-strip-t.png`). Ember and yellow is the game's
   danger accent. Do instead: give the glove a tunic or leather tone, keep gold only for a 1-voxel guard, and let the blade be the bright part.
6. **The tunic is visual noise.** From the front, the torso is a checker of cyan, teal, yellow and blue voxels (`z3-attack-detail.png`
   top-left) with no readable belt, chest or arm shapes. Do instead: 2 values of one tunic colour, plus a 1-voxel belt line.
7. **The death ends in an unreadable lump.** In `death-strip-t.png` (showcase), the collapse is good: flash, red jolt, knees, fall, and the sword
   drops and skitters. But the final pose is a rose box with no head, limbs or face, which reads as a dropped sack. In play (`play-death.png`),
   run-flow's death sequence takes over within about 2 frames, so the hero's own death animation is barely seen. That is a seam to raise with run-flow.
   Do instead: fall to one side so the face and an arm show, and let the cape drape over the legs.
8. **The hurt flinch is weak in play.** In `p3-hurt.png`, the hit reads through the white flash, the "-1" and the hit star (the vfx and hud pieces), then
   grey invulnerability flicker. The pose barely leans. The showcase (`hurt-strip-t.png` frame 2) has a real flinch with wince eyes, but only
   for about 1 frame at 10 fps. Do instead: hold the flinch 4 frames at 10 fps (about 24 ticks), with a 20-degree lean away and the hood knocked back.
9. **The spawn has no visible landing.** `spawn-strip-t.png` (sampled every 3 ticks) shows a white silhouette falling, then the hero standing
   fully coloured. There is no squash frame or dust between them. Do instead: one 2 to 3 tick squash (0.75 vertical) and a dust ring on contact.

What improved since wave 1:
- The hood and cape now separate from the floor at a glance.
- Smears are large white-to-cyan wedges that linger as a cyan ribbon, visible on hits 1 and 2 at 10 fps.
- Hit 3 is a hop with a ground shadow.
- Turns still never pop.

## must_have checklist
- **Silhouette readable at 1x internal resolution: FAIL.** From the front it is now readable: the rose hood and cyan eyes separate from
  the floor (`05` still, `idle-strip-t.png`). From the side and back it is a pink mitten or a box over a slab with no readable head, torso or legs
  (`p3-run.png`, `dash-strip-t.png`, `play3/still.png`). The silhouette does not tell you the pose.
- **Scarf or cloak with lagging secondary motion: PASS.** The 3-panel cape and the cyan scarf lag and stream on run, turn and dash (`z3-turn.png`,
  `z3-run-detail.png`, `dash-strip-t.png`). The scarf hanging limp in side view reads as a leg (problem 1).
- **Run cycle with contact and passing poses, footstep dust hook: PASS (weak).** Contact and passing poses show at 3x
  (`z3-run-detail.png`), and footstep puffs and specks appear in the showcase and in play. At 1x the legs are hidden under the hood and cape, so the cycle
  reads as a bob (`p3-run.png`).
- **Each attack swing has anticipation, smear and recovery frames: PASS.** Wind-up (the blade raised behind), a large smear and a recovery
  all show in `z3-attack.png` (sampled every 2 ticks) and in the 10 fps strip (frames 1 to 6). The body yaw swing between hits muddies it (problem 3).
- **Facing changes turn quickly but never pop: PASS.** In `z3-turn.png` (sampled every 3 ticks), reversals pass through 2 to 3 in-between yaws with no snap.

## Console errors
None on our side in any capture (`shots/critic2/hero/s1`, `st`, `st2`, `z3`, `play`, `play2`, `play3`: 0 errors). None on the reference side
in the local runs (only Unity info logs).

## Packet
There are 5 pairs (`hurdles/waves/w2/blind/hero`): idle, run, dash and combo strips (18 frames at 10 fps, 320x240 crops that follow the hero at game
scale), and one 640x360 in-scene still. The ref side is the wave-1 live capture of the pinned game (see Reference). Hurt and death are unmatched.
