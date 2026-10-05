PIN: https://poncle.itch.io/vampire-survivors | 4.8 stars (1,656 ratings) | the best-known roguelite on itch, whose whole loop is die, read the Results screen, go again; it has a GAME OVER screen, a STAGE COMPLETED victory, a Results summary (time, gold, level, kills, every item with its level) and achievement unlocks, and its HTML5 build can be played live

# Critic review: run-flow (wave 1)

## Reference

**Vampire Survivors** (poncle), https://poncle.itch.io/vampire-survivors, 4.8 stars from 1,656 ratings.
It is the right comparison because it is the itch roguelite people know for its run loop. You die,
a GAME OVER card comes up over the frozen field, then a Results sheet with time survived, gold,
level, kills and the full build, and an unlock if you earned one. Then you go again. A won run
gets a STAGE COMPLETED card. The web build (html-classic.itch.zone/html/5185382) was mirrored
and played live for death, Results and restart. The victory banner and the long-run Results
come from the itch page's screenshots, because a 30-minute win can't be reached headless.

Captures: `hurdles/waves/w1/critic/run-flow/{ours,ref}/`. Scratch frames are under
`shots/critic/run-flow/` (`o/` ours, `r/` reference).

## Verdict (not blind)

Ours is better. The reference's web build has a plain GAME OVER, a sparse Results sheet and a
five-click restart through the title screen. Ours has a staged death, a cause of death, a
route map, the seed, lore, and a one-key restart. The pieces that lose are the ones where the
hero should be the subject and isn't.

## Biggest gap

The hero is never framed in either ending: on death and on victory the camera stays on the wide
room shot, so the subject is a 6-10 px smudge (on death it can sit under the letterbox bar). The
summary portrait is then an illegible crop of that moment. Fix: at `combat:heroDeath` and at the
Warden's death, ease the camera over about 0.35 s to centre on the hero at 2x zoom (snapped to
the texel grid). Show a readable fall pose (knees, then face-down, cape settling) before the
cracks start. On victory, hold the dawn exit shot with the hero big in frame for about 1.5 s
before the panel slides in. Render the summary portrait from that framed shot (hero centred,
about 60% of the frame) instead of the current tight crop.

## Problems

1. **The death never shows the hero dying.** In `/?scene=run&seed=11`, die with
   `__GR.debug.run('die')` and step the run clock 0.1 s at a time (`o/death2/`, `o/death3/`,
   `ours/01-death-strip.png`). Frame 0 shows the hit. After that comes about 1 s of a
   desaturated, static room with the body a few grey pixels, then cracks, shatter and the
   summary. In `o/death2/d004.png` the hero died in the drop-in doorway and the body is half
   under the bottom letterbox bar. The reference keeps the player at the centre of the screen
   and leaves a red corpse there under GAME OVER. Instead: zoom and centre on the body as in
   Biggest gap. Keep the letterbox bars off the hero (shift the camera up if he is in the bottom
   15%). Spend the dead second on the body falling, not on a still room.
2. **The summary portrait is unreadable.** `ours/02-death-summary.png` and
   `shots/critic/run-flow/sc-summary/late.png` show it: "Crushed by a brute" comes with a
   140 px box of red and blue blocks that reads as noise, and in the `&at=death` showcase it is
   a red smear. It is the most screenshot-worthy slot on the card and it shows nothing. Frame it
   as in Biggest gap: the hero lying down plus the killer's silhouette, at a scale where
   both read. Or draw the killer's voxel model on a plain backdrop ("SLAIN BY" plus the brute).
3. **The run timer keeps running through the death sequence.** In the seed 11 run, the hero
   died at 00:16.80 (`debug.run()` just before `die`), but the summary says **00:19.95**
   (`o/death3/d069.png`). The letterbox bar's clock ticks 00:05.28 to 00:06.51 while the body
   lies there (`o/death2-early.png`). Every death adds about 3 s, which skews the best time and
   anything compared with it. Stop the run clock at `combat:heroDeath` and at the Warden's
   death.
4. **The victory payoff is covered at once.** In `?showcase=run-flow&at=victory`, stepped 0.1
   s at a time (`o/vic.png`, `o/vic-key.png`), the light shafts and white-out land well and the
   dawn mountain vista is lovely. But the hero is a speck at the cave mouth (bottom left,
   about 8 px). "YOU ESCAPED" starts typing within 0.1 s of the vista appearing, and the panel
   covers about 75% of it (`ours/04-victory-summary.png`). The reference's STAGE COMPLETED card
   at least sits over the field where the player is. Instead: hold the vista for 1.5 s with
   the hero walking out of the cave at readable size (or the camera on him), then slide the
   panel in from below. Keep the panel narrower or lower so the sun and the hero stay visible.
5. **The Warden's death is not the hero's moment.** `o/vic-key.png` frames 1 to 3 show the
   killing blow's starburst and a shockwave ring, then the Warden slumps. The hero
   (bottom-centre, about 10 px) has no reaction: no pose, no lift, no slow motion on him. Add
   about 0.4 s of slow motion on the killing blow with the camera easing toward the space
   between the hero and the Warden.
6. **Restart is fast but reads as a hard cut, and there is no drop-in.** On the fake clock at
   250 ms per frame (`ours/05-restart-strip.png`, `o/frgrid.png`), the summary is followed by
   the new arena one frame later, with the "THE GAUNTLET" card. The hero is already standing in
   the bottom doorway, which is half off the playfield, and he stays there idle. The goal
   promises an "intro drop-in", but in `o/introgrid.png` the hero never falls in: the only sign
   is a small dust ring in the first real-time frame (`sc-intro/b-00.png`). Instead: have the
   hero drop from above into the middle of the room (shadow first, a 2-frame squash, a dust
   ring, and a small camera kick) in about 0.5 s, so a new run starts as an event and the hero
   starts where the player can see him.
7. **The seed is only visible at the edges of a run.** It is in tiny type under "THE GAUNTLET"
   for about 3 s at the start (`sc-intro/b-00.png`) and in the summary footer. It is not on the
   pause screen (`o/chain/pause.png` shows only "ARENA 1 OF 5 HP 5/5"), so a player can't read
   it mid-run to share. Add "SEED 12345" to the pause subtitle, and draw it larger on the run
   card.
8. **The summary is a sheet of zeros after a short run.** After a 17-20 s death in arena 1, the
   card is six zeros plus "NONE TAKEN. THE MOUNTAIN GAVE YOU NOTHING." (`o/death3/d069.png`).
   The writing is good, but there is no sense of progress toward anything. The reference shows
   the build and an unlock bar ("New Achievement! ... Unlocked: Pentagram",
   `ref/04-victory-summary.png`). Add one forward-looking line, such as "best: arena 3 · 2
   more depths to beat it" or "next lore at 3 runs", so a bad run still points at the next one.
9. **"Hearts lost" counted while invulnerable.** A god-moded run
   (`__GR.debug.god(true)` then `debug.run('next')` ten times) ends with HP 5/5 but the
   summary says **Hearts lost 4** (`o/chain/end.png`). Count only hearts actually lost, or
   label the stat "hits taken".
10. **The showcase label shows even with `&hud=0`.** "SHOWCASE: STAGED RUN HISTORY" stays in the
   top right of every staged summary (`o/vic/v089.png`), so a clean capture of the best-looking
   card isn't possible. Hide it with `hud=0`.

Sound was not judged. Nothing audio-specific was checked.

## must_have checklist

- **Death to back in control takes under 3 s if the player wants: PASS.** In real time,
  headless (6-11 fps), with `debug.run('die')`, then R after 150 ms, then D held, the hero was
  moving 1.2 s after death (`ours2.cjs timing`). From the summary, R is a single key into a new
  seed. The reference needs about 2.75 s and five clicks through the title screen
  (`ref/05-restart-strip.png`).
- **Transitions between segments are seamless and styled: PASS, with reservations.** The
  stone-block wall drops with a carved card ("CORRIDOR 1", "ARENA 2 OF 5 · DEPTH 3 OF 10 THE
  ANTECHAMBER", "THE WARDEN'S PIT") at every segment change, across a full god-moded chain of
  arena, corridor and boss to victory (`o/chain.png`, `g-transition.png`). There is no camera
  move. The restart from the summary is close to a cut (problem 6).
- **The run summary is a satisfying screen worth screenshotting: PARTIAL / FAIL on the
  portrait.** The layout, route map, cause line, coloured stats, boon icons with stacks, lore
  and the dawn backdrop on a win are all strong (`sc-summary/late.png`, `o/chain/end.png`).
  The portrait slot is noise (problem 2), and the win's best visual is covered (problem 4).
- **A full run is completable, and the seed is shown so runs can be shared: PASS.** From
  `/?scene=run&seed=5` with god mode, `debug.run('next')` ×10 went arena 1 → corridor 1 → ... →
  arena 5 → the Warden's pit → victory. The summary shows "RUN 1 · SEED 5" and "BEST 00:34.50 ·
  DEEPEST THE WARDEN" (`o/chain/end.png`). "E SAME SEED" is offered. The seed is not shown
  mid-run (problem 7).

## Console errors

None. The only console output is Chromium's "GPU stall due to ReadPixels" performance warnings,
caused by the screenshots. No page errors in any run (showcase intro, transition, death,
summary, victory; normal runs seeds 3, 4, 5 and 11).
