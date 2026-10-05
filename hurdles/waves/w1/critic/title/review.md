PIN: https://poncle.itch.io/vampire-survivors | 4.8 stars (1,656 ratings) | the best-known pixel-art roguelite on itch, with one of its most recognisable title screens (a blood-red moon, a looming Dracula, the hooded hero swooping in, a blinking prompt) followed by a main menu and an options screen with sound, music and flashing-VFX toggles; its HTML5 build can be played live

# Critic review: title (wave 1)

## Reference

**Vampire Survivors** (web demo v0.2.4) by poncle. https://poncle.itch.io/vampire-survivors.
4.8 stars from 1,656 ratings. HTML5 build: `html-classic.itch.zone/html/5185382/index.html`.

Why it is the right comparison: it is in the same genre (a pixel-art action roguelite)
and is far better rated and better known than any other candidate. Its title screen is
the one most players remember from itch, and its web build has the same pieces ours
has: a title, a main menu, an options screen with audio and accessibility toggles
(including "Flashing VFX"), and the same entry flow. I also checked Furcifer's Fungeon
(its first boot skips the menu and shows a painted splash, not pixel art) and Bright
Lancer (its title is a small logo on near-black with two text options, which is weaker).
I chose the strongest title screen, not the easiest one to beat.

To be fair in the other direction, the reference has real weaknesses. Its title barely
moves: only a blinking "PRESS TO START" and bobbing focus arrows. On its main menu,
keyboard arrows do not move focus at all (04-menu-navigation-strip shows nothing
changing). Its options screen is a plain lavender box of checkboxes.

## Verdict (not blind)

The reference wins the judging question. Its first frame is a bold, single-idea image
that makes you want to press Start. Ours is a murky, evenly noisy dark scene with a
tiny hero. Ours clearly wins on menu navigation and the settings screen, but the first
frame is the headline, and we lose it.

## Biggest gap

**Re-stage the title scene around one bright focal point.** Today the value range is
flat dark-grey from edge to edge, and the hero is about 70 px tall at 720p.
- **Camera.** Zoom the title camera in so the gate fills the centre third of the frame
  and the hero stands about 150 px tall (720p) on the threshold, seen from behind or
  three-quarter. Give him a readable pose: hood, cape and a blade catching light.
- **The gate.** Make its mouth the brightest thing on screen: a deep stair or tunnel
  falling away into hot ember-orange light (#ff7a2f into yellow), with embers streaming
  out toward the camera. Today it shows a back wall, a smeared gold bar and red
  scribbles.
- **The hero.** Silhouette him black against that glow.
- **The surround.** Crush the outer left and right thirds to near-black with a strong
  radial vignette, and remove the dithered brick noise there, so the frame reads as
  dark → warm centre → hero silhouette. The logo then sits on clean darkness above the
  gate, and the menu sits on clean darkness at the left.

In short, one big warm shape against black, as the reference's blood moon does, instead
of 40 small props at the same value.

## Problems (most important first)

1. **The first frame has no focal point, and every value is in the same dark band.**
   - **Seen:** `ours/01-first-frame.png` and `/?showcase=title`. Most of the frame is
     dark blue-grey bricks with checkerboard dither, and the props (bone piles, crates,
     banners, a grey slab at bottom right, a pot at right) all sit at the same mid-dark
     value. In a thumbnail it reads as mud with a skull in it. The reference (pair 01)
     is one saturated colour field, two huge figures and a centred logo.
   - **Fix:** see Biggest gap. Cut the side props by at least half. Darken and
     desaturate whatever stays, so the gate and the torches carry all the light.
2. **The Gauntlet's "mouth" does not read as a mouth.**
   - **Seen:** The arch interior (`ours/01-first-frame.png`, roughly x 480 to 830,
     y 330 to 450 at 1152 wide) shows a flat back wall, a dim orange disc, a smeared
     gold horizontal bar with red and yellow pixel scribbles across it, and loose red
     squares below. It looks like a glitched texture, not a passage descending into a
     crypt.
   - **Fix:** Model a real depth cue: stairs descending into the floor, or a corridor
     with receding wall segments that get darker and then glow. Remove the gold bar,
     or make it an actual portcullis or lintel with a clean silhouette.
3. **The hero is tiny and passive.**
   - **Seen:** The runner is about 70 px tall, faces the camera and idles beside the
     menu (`o/first.png`, `ours/02-title-idle-strip.png`: he barely changes across
     12 frames). The goal names "the runner at the Gauntlet's mouth", but he is the
     least readable element on screen.
   - **Fix:** Make him bigger (closer camera), turn him toward the gate or three-quarter
     toward it, and give him cape and hood motion and a slow breathing loop that is
     visible at strip resolution. Add a rim light from the gate glow.
4. **The menu labels sit directly on noisy scene props.**
   - **Seen:** `o/menu_crop.png` and `o/hover_crop.png`: "CONTROLS" and "CREDITS" run
     into a grey voxel bone pile. The unselected labels are thin, low-contrast lavender
     on dither noise.
   - **Fix:** Put a soft dark scrim behind the menu column: a left-edge gradient from
     about 85% black to 0 over 420 px, dithered in palette steps, not smooth. Or move the
     props out of that area. Give the labels a 1 px dark outline.
5. **The selected label looks misregistered.**
   - **Seen:** `o/menu_crop.png`. "SETTINGS" in cream has a crimson copy offset about
     2 px down-right, which reads as a double image or a chromatic glitch, not as a
     shadow. The L-bracket and the small flame are fine but thin.
   - **Fix:** Use a solid 1 px dark outline plus a 1 px dark drop shadow straight down,
     and keep the warm fill. Add a select pop: 1.0 → 1.15 → 1.0 scale or a 2-frame white
     flash on change, and a flame that flickers bigger for 100 ms.
6. **Bug: a hard black rectangle shows above every sub-panel.**
   - **Seen:** `ours/06-settings-screen.png` (x about 450 to 850, y about 75 to 135 at
     1152 wide), `a/enter.png` (Controls) and `c/credits.png`. A flat black box hangs
     over the dimmed background above the panel. It is the logo's backing plate, left
     visible after the logo hides.
   - **Fix:** Hide or fade that plate together with the logo, or let the panel dim cover
     it.
7. **Panels and screens do not animate in.**
   - **Seen:** `ours/05-open-settings-strip.png`. The settings panel is complete in the
     first frame, 60 ms after Enter. Going from title to sub-menu is a hard cut: the
     logo vanishes and the camera jumps to a floor view. This breaks the GAME.md rule
     "everything that appears animates in". (The reference's options also pop in, so
     this pair is about even, but ours should beat it.)
   - **Fix:** Give it a 150 ms ease-out: the panel scales 0.92 → 1.0 and slides up 12 px
     while the dim fades in, the logo slides up and out, and the camera eases rather
     than cuts. Reverse the same motion on Back.
8. **The very first frames are bare.**
   - **Seen:** `o/early_sheet.png`. Frames from 0 to about 300 ms are a blank dark
     screen; at about 250 ms a small grey "LOADING" appears in the centre
     (`o/early250_crop.png`). Then at about 400 ms there is a hard cut to the full
     scene with no fade. There is no unstyled HTML, but the first thing a player sees
     is not beautiful.
   - **Fix:** Draw the logo (it is static pixel art) as the HTML first paint over the
     same dark colour. Then fade the 3D scene up from black behind it over 400 ms, and
     slide the menu items in one after another (40 ms stagger).
9. **The logo loses its edges.**
   - **Seen:** `o/logo_crop.png`. The logo is clearly designed, with stone letters,
     ember cracks and a sword, but "GAUNTLET" has no dark outline, so its grey-blue
     letters sink into the grey-brown wall behind them. The sword blade crosses in
     front of "RUNNER", over the U and N. A diagonal white shine sweep cuts through the
     U (`a/t0.png`). At thumbnail size the red and orange crack pixels read as noise.
   - **Fix:** Add a 2 px near-black outline and a 3 px dark drop shadow to both words,
     plus a soft ember back-glow behind "RUNNER". Put the blade behind the letters. Use
     fewer, larger cracks.
10. **Ember particles draw over UI text.**
    - **Seen:** In the Controls and Settings footers, an ember sparkle sits on top of
      "CHOOSE" (`a/enter.png` at about x 900, y 695; `m_ours/settings.png` at about
      x 820, y 695).
    - **Fix:** Render particles below the UI layer, or clip them away from the hint bar.
11. **Settings work but have no juice.**
    - **Seen:** `ours/06-settings-screen.png`. The bottom third of the panel is empty.
      Changing Screen Shake or Screen Flashes shows no preview. "BUTTON PROMPTS AUTO"
      shows no arrows when unfocused, so it does not look adjustable.
    - **Fix:** When shake changes, shake the panel by the new amount. When flashes
      change, pulse a flash at the new intensity. Fill the empty space with a one-line
      description of the focused option. Show dim ‹ › on every adjustable row.
12. **Minor:** the footer "V0.1 WAVE 1 BUILD" is development text on the hero frame. Move
    it into the Credits screen, or make it very dim.

What ours already does better than the reference:
- Keyboard focus moves, and mouse hover moves it too (`o/hover_crop.png`).
- A stubbed standard gamepad navigates the menu, opens screens with A, and the prompts
  switch to A/B glyphs (`o/pad.png`).
- Settings use real sliders and add shake, flash and prompt options.
- The title scene has living light: torch flicker, embers and a shine sweep.
- There is a pause menu with Settings and Controls (`c/pause.png`).

Keep all of this while fixing the composition.

**Sound** (not judgeable blind): title music plays, and every menu step plays `ui.tick`
with pitch variation (seen in `__GR.debug.audio().sfx.recent`). Good. Only 15 of 288
SFX are rendered 1 s after load, so the very first UI ticks may be silent on a slow
machine.

## must_have checklist

1. **The first frame after load is already beautiful; no flash of unstyled content.**
   **FAIL.** There is no unstyled HTML. But for about 400 ms the screen is blank dark
   with a small "LOADING" (`o/early_sheet.png`), then it hard-cuts in. Once settled,
   the frame is busy and murky, not beautiful (problems 1 to 3).
2. **The logo is designed, not just a font.** **PASS.** Custom stone and ember
   lettering in two tiers with a sword (`o/logo_crop.png`). The edge and legibility
   issues are in problem 9.
3. **Menu navigation has sound, motion and a clear focus state.** **PASS (weak).**
   - Focus: an L-bracket, a flame and a highlight bar, and the selected label slides
     right (`ours/04-menu-navigation-strip.png`).
   - Sound: `ui.tick` plays on each step.
   - Input: keyboard, mouse hover and gamepad all work.
   - The motion is small and there is no pop. The shadow looks doubled (problem 5).
4. **Settings persist in localStorage and apply live.** **PASS.**
   - Persist: setting Screen Shake to 50% survived a reload
     (`gr.settings.v1` = `{"shake":0.5,...}`).
   - Apply live: setting Master Volume to 0 dropped the audio meter peak from 0.18 to
     0.00 at once. It works from the pause menu too.

## Console errors

None. There were no page errors or console errors on `?showcase=title`,
`?showcase=title&menu=settings`, or `?scene=run&seed=3` with pause. The only console
output was headless-GPU "GPU stall due to ReadPixels" performance warnings, which come
from the screenshots, not from the game.

## Evidence

Scratch captures are in `shots/critic/title/` (gitignored). Paths in this review are
relative to it, except `ours/` and `ref/`, which are this folder. Matched pairs are in
`ours/` and `ref/`. Both were captured at a 1152x720 viewport so the reference canvas
fills the frame, and both on Playwright's paused clock, so the strips have identical
timing.
