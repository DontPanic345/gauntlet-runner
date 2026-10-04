PIN: https://aylanonsense.itch.io/just-one-boss | 4.7 stars, 557 ratings | the top-rated HTML5 "boss battle" game on itch: one boss, multi-stage, an intro reveal, every attack telegraphed and dodgeable on reaction

# Critic review: boss (The Warden), wave 1

## Reference

**Just One Boss** by aylanonsense. https://aylanonsense.itch.io/just-one-boss.
Rated 4.7 from 557 ratings. It ranks near the top of itch's top-rated "Boss battle" list, both overall
and for HTML5. Its iframe build (`html-classic.itch.zone/html/17273870/index.html`) was downloaded
and played live under a paused fake clock. A pixel-reading bot drove it through `pico8_buttons`.
Scripts are in `shots/critic/boss/refbot.cjs` and `clk.cjs`.

Why it is the right comparison: it does exactly this piece's job. It is a single boss fight
that is the whole game. It has an intro that assembles the boss on stage, escalating stages
(card throws, rainbow-head laser columns, multiple heads, floor-tile bombardment), and a famous
reputation for being hard but fair. Every attack is announced so clearly that a player can
read it at 128x128. It is not a 3/4 voxel game: it is a PICO-8 grid game. The
nearest 3/4-view action boss games with enough ratings (Ichorous 4.6/147, Hexblade 4.5/186,
Vampire Curse 4.7/60) all turned out to be side-view platformers and not playable in the browser.
Just One Boss is the strongest playable fit, and it is a hard bar for "fair".

## Verdict (not blind)

The reference wins narrowly. Ours has more spectacle per frame, but the Warden does not read as a
character, its hit flash whites it out, and the fight opens with an attack hidden under the name card.
On "fair", the reference is clearly ahead.

## Biggest gap

**The Warden does not read as a jailer-knight at play zoom, and its own hit flash erases it.**
From the fixed 3/4 camera, the model is a grey stack of boxes. It has two round shoulder blocks, a box
head, and stubby fist cubes. You can see a cyan visor and one yellow key. In close-up
(`evidence/intro-closeup.png`) it is still a slab of blocks. Airborne during the leap, it turns into
upside-down boxes (`evidence/leap-airborne-and-hero-behind-brazier.png`). Then every hit replaces the
whole model with a flat white silhouette, including the arm cubes as white rectangles. In phase 3,
where the player hits it constantly, about a third of all frames show a white blob instead of a
boss (`evidence/hitflash-whiteout.png`, `g-cage.png` / `g-summon.png` in `shots/critic/boss/`). The
reference boss is 20 pixels tall, yet you always know it is a grinning magician in a top hat with
two white gloves, and you can track both hands at a glance.

What to do:
1. **Hit flash.** Do not replace the material with solid white. Flash only the 1-px outline and
   lighten the albedo about 40% for 2 frames (33 ms), at most once every 150 ms. A flurry then
   reads as a flicker on the boss, not as the boss vanishing. Keep the full-white flash for
   stagger and phase break only.
2. **Silhouette for this camera.** The camera looks down, so the readable shapes are the ones that
   stick *up* and *out*. Give the helmet a tall crest or a pair of jailer's horns that rise clearly
   above the shoulders. Give it a big lit visor slit facing the camera, so the light reads as eyes.
   Hang a ring of 3–4 large keys from the belt, swinging, in the ember accent so they read from
   the top. The goal says "sweeping chain", so put a visible chain-and-weight in one hand that drags
   on the floor while it walks. Right now the sweep is a flat cyan/white crescent decal and no chain
   is ever visible (`evidence/sweep-swing.png`). Add a 2-tone rim light (cool top, warm bottom)
   so the body separates from the dark floor.
3. **Airborne pose.** During `air`, keep the model upright and readable: knees tucked and weapon
   raised. Draw it above a shrinking ground shadow, so the leap reads as height and not as a
   tumble of boxes.

## Problems (most important first)

1. **Hit flash whites out the boss.** See the Biggest gap. Seen in `?showcase=boss&phase=3&attack=cage&hud=0`
   from about 1.5 s on, every 66 ms burst. Also visible in `evidence/phase-break-flash.png`, where the
   whole boss is a white cut-out on a grey-washed screen.
2. **The first attack happens under the name card.** In `?showcase=boss&intro=1&hud=0` and in normal play
   (`/?scene=boss&seed=3`), the fight state starts while "THE WARDEN / JAILER OF THE DEEP GAUNTLET"
   still covers the middle third of the screen. The lash lane telegraph runs straight under the banner
   and the hero (`evidence/telegraph-under-namecard.png`, intro frame at about 7.75 s). In normal play,
   an idle hero has already been hit once by tick 668 (`__GR.state().boss.warden.landed = 1`, hp 4/5).
   This fails "fair" on the very first attack. Hold the first attack until the card has fully cleared,
   plus 0.5 s. Alternatively, slide the card to the top band, above the boss's head and away from the floor.
3. **The hero is too small and gets lost.** The hero is about 1/6 of the Warden's height and dark blue on
   a dark floor. It vanishes behind the Warden's body when close (`evidence/hero-inside-boss.png`:
   the hero is drawn inside the boss's chest during the cage phase). It also vanishes behind the floor
   braziers (`evidence/leap-airborne-and-hero-behind-brazier.png`, frames 4–6: the hero stands
   under the lower-right brazier inside a red telegraph and is hidden by it). Give the hero a 1-px light
   rim or ground ring during the boss fight. Give the Warden a body collider so the hero cannot
   stand inside it. Either keep braziers off the playable ring or fade them to 40% when the hero
   is behind one.
4. **Phase transitions are only partly events.** 1 to 2 (`evidence/transition-1to2-sheet.png`): a grey
   full-screen wash, the white-out boss, a small "II" box that grows into a "II THE QUAKE" plate over the
   arena centre (`evidence/phase-card.png`), and then a roar ring. The model barely changes, apart from the
   chest turning orange. The phase-3 change does more (the braziers go red and a cage rises), which is good.
   What to do: make each phase visibly change the boss. Phase 2: armour plates crack off with a debris
   burst and the eyes go ember. Phase 3: chains wrap the body and it starts glowing from the cracks.
   Put the phase plate in the top band, not on top of the play area where the hero stands.
5. **The leap red screen frame swallows the HUD.** When the hero is hit by the leap
   (`evidence/leap-hit-redframe.png`), a thick red frame plus a red tint covers the whole screen for
   about 4 frames, and the hearts are hidden. Use a thinner 6–8 px vignette that does not cover the hearts.
6. **The intro close-up is mud.** The camera pushes in to the point where the voxels are 20+ screen
   px and the boss becomes unreadable grey blocks with no face (`evidence/intro-closeup.png`). The
   push-in is the right idea. Stop at about 1.6x and frame the helmet and visor, with the visor
   lighting up as it wakes. Right now the "wake" moment is lost in a mass of shoulder blocks.
7. **The intro staging is off-screen at both ends.** In the dark opening frames, the dormant Warden is
   jammed against the top edge and the hero is cut off at the bottom edge, behind the control hints
   (`shots/critic/boss/intro/intro-08.png`). The arena does not fit vertically at the intro zoom.
   Pull the opening shot back, or start it on the boss and pan down to the hero.
8. **The death aftermath goes flat.** The death burst itself is strong: radiating gold rays, a
   flash, rings, and the model breaking into parts (`evidence/death-burst.png`). It is the best
   moment in the piece. But 2 s later (`evidence/death-aftermath.png`), the cage is still standing,
   the empty HP bar still reads "III THE CAGE", and there is no victory card, music sting, or
   lighting change. Drop the cage with a crash, fade the boss bar out, bring the braziers back
   from red to warm gold, and show a "WARDEN FALLS" card in the top band.
9. **The telegraph language mixes styles.** The sweep and leap use dithered red checker zones (good,
   in the house style), but the sweep swing itself is a smooth flat cyan/white crescent with a
   big orange checker band (`evidence/sweep-swing.png`). It reads as UI, not as a weapon. Draw the chain
   and weight sweeping through the zone, with a short pixel smear behind it.

## must_have checklist

| Item | Result | Evidence |
|---|---|---|
| The intro makes you nervous: camera, name card, roar, arena lights up | **Partial pass.** Dark arena; braziers light one by one with runes; push-in; roar ring; name card. Undercut by the muddy close-up (P6), the off-screen staging (P7), and the fight starting under the card (P2). | `shots/critic/boss/g-intro2.png`, `evidence/intro-closeup.png`, `evidence/telegraph-under-namecard.png` |
| Every attack is learnable and dodgeable on reaction with a dash | **Fail as delivered.** The telegraphs themselves are good and long enough (sweep 58 ticks, lash 42, stomp 30, leap 36+28). But the first lash is hidden under the name card, the hero can be hidden by braziers or by the boss body inside a red zone, and the hit flash blanks the boss so its next windup pose cannot be read. | P2, P3, P1 |
| Phase transitions are events, not just a stat change | **Partial pass.** Flash, phase plate, roar ring; phase 3 recolours the arena and raises the cage. Phase 2 barely changes the boss itself. | `evidence/transition-1to2-sheet.png`, `shots/critic/boss/g-tr2.png` |
| The death sequence is the best-looking moment in the game | **Pass on the burst, fail on the follow-through.** The rays, flash, and break-apart are the best frames captured. The aftermath is flat (P8). | `evidence/death-sheet.png`, `evidence/death-burst.png`, `evidence/death-aftermath.png` |

## Console errors

None. Every capture reported 0 console or page errors: showcase intro, phases 1–3 with every
`attack=`, the death, the forced phase transitions, and `/?scene=boss&seed=3`.

## Blind packet

`hurdles/waves/w1/blind/boss/` has 5 pairs: the intro reveal still, a 12-frame intro strip at 250 ms,
a 12-frame phase-1 attack strip at 100 ms, a 12-frame later-phase attack strip at 100 ms, and a
late-phase still. Ours is cropped to a centred 720x720 square to match the reference's square frame.
The reference is nearest-upscaled. Pair 5 of the reference is the itch page's own 384 px screenshot,
because the bot did not survive past stage 2.
