PIN: https://slo-nod.itch.io/bright-lancer | 4.5 stars (140 ratings) | top-down pixel action game on itch's top-rated hack-and-slash list with a three-part spear combo (sweep, thrust, overhead) and a strong hurt reaction; it is HTML5, so it can be played live, and it is already the pinned reference for hero and movement

# Critic review: combat (Combat feel), wave 1

## Reference

**Bright Lancer** by Slo Nod, https://slo-nod.itch.io/bright-lancer. It has 4.5 stars from 140 ratings and is on
`itch.io/games/top-rated/tag-hack-and-slash` (pulled today). Its own pitch is "Hyper Light Drifter meets Hades", and its
combat is the main thing players praise.

**Why it is the right comparison:** it does the same job. It is a three-quarter top-down pixel game with a small hooded
melee hero, a three-hit combo against small enemies, and a full-screen reaction when you are hit. It runs in the browser,
so I played it live instead of using a trailer. It is also the pinned reference for `hero` and `movement`, so the game is
measured against one bar.

**Other candidates I checked:** Gaunt Valkyr (4.9 from 94) is a twin-stick shooter whose GIFs show gunfire, not melee.
Lucah (4.7 from 208) and Unsung Warriors (4.7 from 159) are not HTML5. Of the browser games on the same list, Reinbō
(4.8 from 41) and Himawari CATASTROPHE! (4.8 from 29) have fewer than 50 ratings.

**How it was captured:**
- **Reference:** the Unity build in `shots/critic/hero/blgame/`, served through capture.cjs and played with scripted
  WASD and mouse clicks while recording video. Its first enemies are small flying beetles at the north edge of the first
  island. The route and attacks are in `shots/critic/combat/ex10.json`. I sampled the webm at 10 fps with ffmpeg. The
  crop is 320x240 around the hero, or the full screen for the hurt strip.
- **Ours:** `/?scene=run&seed=3` (arena 1, the first wave of two husks). I used a scratch driver,
  `shots/critic/combat/clk.cjs`, which runs the page under Playwright's paused fake clock and advances it 100 ms per
  frame. Hitstop, shake and the screen flash all run in game time, so the slow SwiftShader screenshots do not eat them.
  Input went through `__GR.debug.input`, with attacks at 0, 230 and 460 ms, the same rhythm I clicked in the reference.
  The crop is 640x480 around the hero, or the full screen for the hurt strip. Our hero is drawn at about twice the
  reference's size, so the two windows show the hero at the same size.
- **Caveats, both of which favour us:** the reference frames come from VP8 video and are softer than our PNGs. The
  reference's target is a tiny beetle, which hides how strongly its enemies react. A blind loss for us is therefore
  meaningful.

## Verdict (not blind)

**The reference is better, narrowly.** Ours shows more impact signals: hitstop, flash, sparks, damage numbers and a
shockwave ring. But a reference hit reads as *a spear sweeping through an enemy*, and ours reads as *a white blob
popping next to a blue box*. The reference also makes getting hit unmistakable, and ours loses the hero in the crowd.

## Biggest gap

**Anchor every hit on the blade: the player must see the weapon pass through the enemy at the contact frame.** Today the
contact frame is a solid white silhouette of the enemy, larger than the enemy and merged with the hero, with a gold spark
floating on top (`ours/02-first-hit-contact.png`, `ours/03-third-hit-finisher.png`). Meanwhile the swing smear is drawn
above the hero's head, pointing up, even though the enemy is to the right (`shots/critic/combat/p1g.png`, frames 3 to 5).

Concretely:
1. On the contact tick, spawn a slash streak at the contact point, along the swing direction. Make it about 1.5
   hero-heights long and 3 to 4 internal pixels thick, white-hot core with a pale-blue edge, held for the whole hitstop
   and then shrinking over 2 to 3 frames. Hits 1 and 2 cut in opposite diagonals. Hit 3 cuts vertically, top to bottom.
2. Shorten the enemy's flash: solid white for 1 frame, then a 2-frame light tint that keeps the enemy's dark outline. The
   hero and the enemy must stay separable at a glance.
3. Put the spark burst at the tip of the streak, not at the enemy's centre.

The reference shows the same idea with a crescent spear arc that wraps around the target (`ref/02-first-hit-contact.png`).
The smear is the hero piece's model, so coordinate with the hero builder. The streak, the flash and the spark live in
`src/combat/`.

## Problems

1. **The contact frame is unreadable.** See the biggest gap. Where: `/?scene=run&seed=3`, walk up into the arena and
   press J three times as the right-hand husk arrives. Evidence: `shots/critic/combat/o1z.png` and `p1g.png`. At the
   moment of impact you cannot see the sword, the hero's pose or the enemy. Only a white shape and a "10" are visible.
   That gives you "something happened", not "I cut it".

2. **Hits 1 and 2 have no visible knockback.** The husk moved 0.04 to 0.05 units on each of hits 1 and 2 (x 1.84 to
   1.88 to 1.91, in `shots/critic/combat/o2.log`). That is about 3 screen pixels. Dummy A in the showcase reports
   "KNOCK 0.14" after a slash. Only the finisher moves an enemy (1.4 units). So for two thirds of the combo, the enemy
   does not react except for the flash. Fix:
   - Knock the husk back 0.35 to 0.5 units on hit 1 and 0.5 to 0.7 on hit 2, over 4 to 6 ticks with ease-out, starting
     after hitstop.
   - Add a 6-tick stagger pose: lean away from the hit, then return.
   - If husks are meant to be heavy, still give them the lean and at least 0.2 units of travel.

3. **Hits 1 and 2 are the same hit.** Both deal 10 damage and both play `hit.mid` (seen in `debug.audio('info').sfx.recent`).
   Hitstop is 55 ms against 62 ms. Shake is 0 against 0.8. The white flash and the spark ring are identical. Only the
   finisher steps up (95 ms hitstop, shake 3, `hit.heavy` + `hit.finisher` + `slam`, a ring and a launch). The reference
   changes the move itself for each hit: a sweep, a thrust, then a vertical overhead (`ref/01-combo-strip.png`). Fix:
   - Give hit 2 its own sound: `hit.mid` at a higher pitch, or a `hit.light` + `hit.mid` layer.
   - Raise hit 2 to 70 ms hitstop and shake 1.5.
   - Make hit 2 cut the mirrored diagonal (see the biggest gap), so the three hits read as rising: light, medium, heavy.

4. **The damage numbers bury the impact.** The finisher's "25" is drawn over the contact point during hitstop, with
   small "10" numbers stacked above it from the earlier hits (`ours/03-third-hit-finisher.png`). The numbers stay for
   about 1 s after the kill (`p1g.png`, row 4). Fix:
   - Spawn numbers at least 12 internal pixels above the enemy's head and pop them upward and away from the hero.
   - Hide each number during hitstop and show it on the first frame afterwards.
   - Merge a combo's numbers into one running total, or fade old numbers within 400 ms.

5. **Getting hurt is visible only at the screen edge, not on the hero.** Where: `/?scene=run&seed=3`, stand still in the
   arena and let the right-hand husk attack (`ours/04-getting-hurt-strip.png`, frames 6 to 10). Today:
   - The red screen flash is alpha 0.16 for 110 ms, which is nearly invisible. The thin red border lasts about 0.4 s.
   - The hero is knocked back 0.07 units, so he stays wedged between two husks. The flashing hero is hidden among
     their green bodies.
   - The reference tints the whole hero red for about 0.7 s and covers the screen in a pink vignette
     (`ref/04-getting-hurt-strip.png`).
   Fix:
   - Knock the hero back 0.4 to 0.5 units away from the source, so he ends up clear of the enemy.
   - Flash the hero white for 2 frames, then red for 6 frames, keeping his dark outline.
   - Raise the edge vignette to alpha 0.35, fading over 350 ms.
   - Pop the lost heart in the HUD (scale 1.5, then shatter).
   - Keep it under one shake channel at 2.5. Our version is not disorienting, so don't overshoot.

6. **Mashing is the best way to play.** Pressing J every 50 ms gives exactly the same three-hit combo at the same tempo
   as pressing in rhythm (attacks at ticks 107, 120 and 132, against 254, 267 and 279), and then it loops into a new
   combo. Presses 600 ms apart still chain, and presses 800 ms apart break the chain (`shots/critic/combat/p2/ev.txt`).
   The window is forgiving, but nothing rewards timing, so the must_have "not mashy" fails. Fix (pick one):
   - Accept a chain press only within the last 10 ticks of the current swing and the linger window, and drop earlier
     presses.
   - Or add a "clean" press in the late window that grants +15 ms hitstop and a brighter streak.

7. **The lunge walks the hero into the enemy, and one such swing whiffed.** In `shots/critic/combat/o1/c-01.png` and
   `c-02.png`, the first swing was pressed at 2.29 units, the hero lunged until his body overlapped the husk's reaching
   arms, and the swing still counted as a whiff (`hits 0, whiffs 1`). Showcase tests against a dummy connected at every
   range up to 2.0 units (`shots/critic/combat/p4g.png`, with `hitboxes=1`). So this is an edge case, not a pattern.
   Fix:
   - Stop the lunge 1.0 to 1.1 units from the nearest enemy in the facing cone, so sprites never interpenetrate.
   - When an enemy is within 2.4 units in that cone, steer the lunge toward it so the swing connects.

8. **Minor showcase issues.** At `?showcase=combat&zoom=1`, the labels for dummies B and C collide ("DUMMY BDUMMY C").
   The default zoom is 2, which is larger than gameplay scale, so the hits look bigger in the showcase than in a real
   run. Default the showcase to gameplay scale, or label the zoom.

## must_have checklist

- **Hitstop, white flash, knockback, spark and sound on every hit, all scaled by damage: FAIL.** Hitstop is 55, 62 and
  95 ms, so it scales. The white flash appears on every hit. Sparks are 7, 8 and 16. Sounds are `hit.mid`, `hit.mid`,
  then `hit.heavy` + `hit.finisher` + `slam` (`shots/critic/combat/p1/events.txt`, `p3/recent.txt`). But knockback on
  hits 1 and 2 is 0.04 to 0.05 units on a husk, which is invisible (problem 2). The flash does not scale, and hits 1 and
  2 are not told apart (problem 3).
- **Combo timing window forgiving but not mashy; the third hit feels heavier: half.** The window is forgiving: presses
  600 ms apart chain. The third hit is clearly heavier: 25 crit, 95 ms, shake 3, a launch of 1.4 units, a ring, and a
  heavier sound. But 50 ms mashing gives the same result as rhythm, so it is mashy (problem 6).
- **Getting hurt is unmistakable but not disorienting: FAIL (marginal).** It is not disorienting: 80 ms hitstop,
  shake 2.5, a faint flash, and the border. But the hero is not unmistakably hit. He barely moves and is lost between
  two enemies (problem 5, pair 04).
- **No whiffs where the visual clearly connected: PASS with a caveat.** Showcase tests connect at every range up to
  2.0 units, with the hitbox arc matching the smear. There was one whiff during a lunge that overlapped the enemy's
  arms (problem 7).

## Console errors

None from ours. That covers `?showcase=combat` in both demo and live mode, `?showcase=combat&hitboxes=1`, and
`/?scene=run&seed=3` across five scripted fights: 0 errors in every `console.log`. The reference's only errors were
`ERR_CERT_AUTHORITY_INVALID` resource loads, caused by the sandbox proxy.

## Files

- Matched sets: `hurdles/waves/w1/critic/combat/ours/` and `ref/`, with 4 pairs:
  - 01: combo strip, 12 frames at 10 fps.
  - 02: the first hit's contact still.
  - 03: the third hit's still.
  - 04: getting-hurt strip, 12 frames at 10 fps, full screen.
- Blind packet: `hurdles/waves/w1/blind/combat/` (with `criteria.md`). Key: `hurdles/waves/w1/keys/combat.json`.
- Scratch, probes and drivers: `shots/critic/combat/`. The driver is `clk.cjs`, the timing logs are in `p1/events.txt`
  and `p2/ev.txt`, and `p4g.png` is the reach test.
