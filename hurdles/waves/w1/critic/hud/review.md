PIN: https://ember-paw-games.itch.io/gaunt-valkyr | 4.9 stars (94 ratings) | top-down pixel action roguelite on itch's top-rated roguelite lists whose in-run HUD has the same job as ours: health with a drain bar, an item and upgrade icon row, a currency counter that ticks, a kill counter, an area marker ("AREA 2", "3-3"), and a full-screen hurt wash. It is already pinned for look and vfx.

# Critic review: hud (HUD and in-game UI), wave 1

## Reference

**Gaunt Valkyr** by Ember Paw Games, https://ember-paw-games.itch.io/gaunt-valkyr, 4.9 stars from 94 ratings.

Why this one: no HTML5 action roguelite I could find has a HUD this complete. Furcifer's Fungeon (HTML5, 4.7)
shows only a coin bar, and Bright Lancer (HTML5, 4.5) shows only a health ring, so both would be easy wins. I
loaded Furcifer's Fungeon live to check this. Gaunt Valkyr covers every element our goal lists except a boss bar
and tooltips, and its HUD is loud and readable, which is the hard thing to beat. The drawback is that it is not
HTML5, so the evidence comes from the page media. The two stills are the page screenshots `2560x1440` (scaled to
exactly 1280x720) and a 1273x711 desktop capture, cropped to the game area. The damage strip and the small still
come from the 400x225, 10 fps gameplay GIF (`img.itch.zone/.../8659049.gif`, frames 29 to 40, where health goes from
6/8 to 3/8). To match presentation, I scaled our frames down to the same 400x225 before enlarging both sides with
nearest-neighbour scaling.

Ours: `/?scene=run&seed=3` on Playwright's paused fake clock (`shots/critic/hud/clk.cjs`). The steps were: hold W for
1.1 s, `debug.give` kindling, chain-spark and leech, `debug.boons('shards',37)`, wait 4.5 s so the boon tooltip closes,
spawn a brute, a husk, two mites and a wisp around the hero, then press J every 300 ms and take a screenshot every
100 ms. For pair 01 I used `debug.hurt(4)` first, and for pair 02 `debug.arena('clear')`. I also checked
`/?showcase=hud` with every key and `/?scene=boss&seed=3`.

Packet pairs: 01 low health mid-fight still, 02 room-clear still, 03 damage-taken strip (12 frames, 100 ms apart),
04 full-health mid-fight still at 400x225.

## Verdict (not blind)

The reference is ahead, narrowly. Ours is more finished up close (heart drain and shatter, shard counter that rolls
like an odometer, tooltips, 100% palette-bound pixels). At a glance, though, during a fight and in a thumbnail, it
reads worse: health is small, hurt barely shows, and text panels and stacked numbers land on top of the action.

## Biggest gap

Health and hurt are not readable at a glance. At 1280x720 each heart is about 14 px wide, inside a 150x60 panel that
is about 40% empty. The only hurt signal is a 4-frame red border about 6 px thick. Even at one heart, the screen just
gets faint dithered red corners. In the reference, "1/8" is drawn in 24 px numerals on a 200 px bar, and a hit tints
the whole screen red for about a second (`ref/03`, frames 5 to 12, against `ours/03`, frames 4 to 7).

The fix:
- **Bigger hearts.** Draw the hearts at 2x their current art size (about 28 px on screen at 1280x720) and shrink the
  panel to fit them.
- **Damage drain.** Keep the current white flash, then the drain and shatter.
- **Hit wash.** On every hit, add a full-screen palette-red wash in 50% ordered dither: 2 frames solid, then fade out
  over about 300 ms. Shake the heart panel 2 px for 120 ms.
- **Low health (one heart or less).** Persistent changes:
  - The panel frame turns palette red and pulses with the heartbeat.
  - The last heart beats at 1.3x scale.
  - The dithered edge vignette gets about 3x deeper (about 48 px at 1280x720) and pulses with the same beat.

At thumbnail size, a stranger should be able to tell "I just got hit" and "I am nearly dead" without looking for
the hearts.

## Problems

1. **Health and hurt read weakly at a glance.** See the biggest gap.
   - Evidence: `ours/03-damage-taken-strip.png` (the hit is frame 4) next to the reference strip; `ours/01-mid-fight-low-health-still.png` (1 HP);
     `shots/critic/hud/g-lo.png` (the showcase low-health sequence).
   - The heart drain itself is good: white flash, then the heart drains from the top, then it shatters into
     particles (`shots/critic/hud/g-hithearts.png`).
   - The problem is scale and reach. All of it happens inside a 14 px heart in the corner, and the screen reaction is
     a thin frame that reads like a UI border, not like pain.

2. **Damage numbers collide and cover the hero.**
   - What I saw: two crit numbers on the same target (24 and 23) spawn on the same point and render as **"223"**
     (`shots/critic/hud/run8/l-17.png`, crop `shots/critic/hud/g-n.png`, top right). The crit pop frame is a white
     numeral in a black outline box about 110x50 px, drawn straight over the hero.
   - Over the next frames the two numbers stay overlapped ("2 23", then a tight "24 / 23" stack).
   - Why it hurts: the number is wrong to read, and it hides the hero at the moment of contact.
   - Fix:
     - Give each target a stack slot, so each new number on the same target spawns 10 px higher than the last live one,
       with x jitter of ±6 px.
     - Merge hits on one target within 120 ms into a single summed number that bumps instead of spawning.
     - Cap the crit pop at 1.5x scale, drop the black fill, and keep the 1 px outline.
     - Never spawn a number centred on the hero. The hero's own "-1" should go to the hero's upper left, in red.

3. **The boon tooltip and synergy banner cover the play field.**
   - What I saw: in a real run, every boon gain opens the full tooltip (about 360x170 px) over the lower-left of the
     arena for about 4 s (`shots/critic/hud/run5/fight-b.png`: a mite is fighting under it). In the showcase, the
     tooltip plus the "SYNERGY THUNDERHEAD" banner (about 520x90 px, centred above the hero) cover about a quarter of
     the arena (`shots/critic/hud/sc2/tab2.png`).
   - Why it hurts: this breaks "never covers the action".
   - Fix: on gain, show a one-line toast (icon, name, "LV 1") for 1.5 s, attached to the boon row. Open the full card
     only on Tab or while paused. Move the synergy banner to the top band over the back wall (y < 110 at 720p), cap it
     at 2 lines, and fade it after 1.5 s.

4. **The room progress track cannot be read without explanation.**
   - What I saw: the top-centre track is a row of tiny grey squares and diamonds plus a skull, with no text
     (`shots/critic/hud/g-rm.png`, `ours/02`). Advancing a node changes almost nothing visible from frame to frame.
     The small white marker floats above the panel, outside its frame.
   - By contrast, the reference prints "AREA 2" or "3-3" in plain text.
   - Fix:
     - Add a label under the track, such as "ARENA 2/5 · CORRIDOR NEXT", in the HUD font.
     - Give each node type its own 9 to 11 px icon: crossed blades for an arena, a falling rock for a corridor, a skull
       for the boss.
     - Animate the advance: the marker slides along the line over 300 ms and the new node pops at 1.4x scale.
     - Put the marker inside the frame.

5. **Boss bar labels are confusing.**
   - What I saw: the right-hand tag reads "I  STANDING" in the showcase and "I  THE CHAIN" against the Warden
     (`shots/critic/hud/cr/b2bb.png`). In this font the roman numeral looks like the letter I, so it reads as words
     ("I standing").
   - There is also a thin orange bar under the boss bar that nothing explains (`shots/critic/hud/g-bh.png`).
   - Fix: write "PHASE 1 · THE CHAIN", or show phase pips on the bar's notches. Either label the orange bar (STAGGER)
     or remove it.

6. **Unexplained micro-marks and loose deltas.**
   - Where: `ours/02-room-cleared-still.png`, `shots/critic/hud/run7/m-36.png`.
   - What I saw:
     - Dots under every boon icon.
     - A row of red dots above Leech.
     - The shard delta ("+3", "+21") hangs below the shard panel, outside its frame.
     - The shard panel has a wide empty gap between the gem and the digits.
   - Fix: label the boon dots or make them self-explanatory (the level as filled pips with "LV" on hover). Put the
     delta inside the panel, to the left of the total, and fade it after 0.8 s. Right-size the panel so the gem sits
     next to the number.

7. **The "ARENA CLEARED" banner sits across the floor where the hero walks.**
   - What I saw: the banner is a full-width black band at about y=440 to 520 (720p), so the hero walks under it and
     the shards drop under it (`shots/critic/hud/g-c.png`, frames 5 to 12).
   - Fix: move it to the top band over the wall, or keep it at the current spot for 1.0 s and then slide it up and
     out.

8. **Dash is a bar, not pips.**
   - The goal asks for dash pips. One bar works for one charge, and the ready flash plus the cyan refill read well
     (`shots/critic/hud/g-dash.png`).
   - It will not show multiple charges, for example with storm-dash stacks. Draw one pip per charge, each with its
     own refill.

## must_have checklist

- **Pixel-perfect: integer-scaled, palette-bound, pixel font: PASS.**
  - Scaling: the HUD canvas is exactly half the viewport at 1280x720 (640x360), 1366x768 (683x384) and 1000x600
    (500x300), with `image-rendering: pixelated`.
  - Palette: of 53,570 drawn HUD pixels in the showcase, every one is an exact colour from
    `src/render/palette.js`, and none is semi-transparent.
  - Font: a crisp bitmap font.
- **Every number and bar animates its changes: PASS, weak on the room track.**
  - Hearts flash, drain and shatter, and heal in gold.
  - Shards fly to the counter, which rolls like an odometer.
  - The boss bar has a lagging chip segment and a moving dither shimmer.
  - The dash bar refills, with a white ready flash.
  - The room track advance is nearly invisible (problem 4).
- **Never covers the action; readable at a glance mid-fight: FAIL.** The auto-opening tooltip and the synergy banner
  cover the play field (problem 3), damage numbers collide over the hero (problem 2), the clear banner lies across the
  floor (problem 7), and health is too small to read at a glance (problem 1).
- **Low health is felt (heartbeat pulse and vignette) without being noisy: FAIL.** Both exist: the last heart beats,
  and dithered red corners pulse. They are not noisy, but they are not felt either. In `ours/01` at 1 HP, a viewer
  has to find a single 14 px heart to know.

## Console errors

None in any run: showcase, run scene, boss scene, three viewport sizes. The reference was media only.
