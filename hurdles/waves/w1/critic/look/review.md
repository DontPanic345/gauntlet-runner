PIN: https://ember-paw-games.itch.io/gaunt-valkyr | 4.9 stars (94 ratings) | top-down pixel action roguelite on itch's top-rated roguelite and dungeon-crawler lists; dark dungeons lit by dynamic light pools, with the same fixed overhead arena framing and the same "crypt lit by torches" job as our render look

# Critic review: look (Render look), wave 1

## Reference
**Gaunt Valkyr** by Ember Paw Games. https://ember-paw-games.itch.io/gaunt-valkyr.
4.9 stars from 94 ratings. It is listed on itch top-rated under both `tag-roguelite`
and `tag-dungeon-crawler`.

Why it is the right comparison: it is a top-down pixel-art action roguelite fought in
sealed rooms, with the same fixed overhead framing as ours. Its visual identity is
built on what this piece owns: dark rooms that real light sources carve out
(muzzle flashes and lamps light the floor and walls), strong value hierarchy, and
characters that pop off the floor. I also considered these:
- Nuclear Throne (4.7/511). It is more famous, but its itch page has only daylight
  stills and no motion media.
- Ancient Dungeon (4.8/127). It is a voxel crypt, but first-person VR, so its camera
  does not match ours.
- Tristram (4.7/576). It is a side view.

Gaunt Valkyr is not HTML5. I used the 2560x1440 page screenshots and its gameplay
GIFs, sampled by ffmpeg because `sheet.cjs video` fails on GIFs here (`ImageDecoder is
not defined`).

## Verdict (not blind)
The reference is better. Our showcase still is close on mood and palette, but in play
the reference reads far more clearly and its lighting is alive, while ours is a
flat, muddy field of floor.

## Biggest gap
**Value hierarchy. The floor is as loud as the actors.** The flagstones are a 1-texel
ink-black grout grid (`#0b0a12`, the same colour as character outlines) with random
light speckles in every tile. Most of the frame is mid-dark violet within a narrow
value band, so the hero, enemies, and props have nothing to separate from. The
reference does the opposite: a quiet, low-contrast floor, deep shadow under walls and
actors, and bright, saturated actors.

Concretely:
1. Draw floor grout one palette step darker than the tile, not `ink`. Keep `ink` for
   actor and prop silhouettes only.
2. Cut the speckle noise on floor tiles by about two thirds, and keep it within
   ±1 palette step of the tile colour.
3. Drop the floor's base value one step, so the floor sits below every actor's
   darkest face.
4. Give every actor and prop a solid (not dithered) contact-shadow ellipse in `night`
   directly under its feet.
5. Raise the actor rim (`rim` 0.55 → about 0.8, `frost`) so the side facing the
   camera always has a light edge against the dark floor.

Check the result with a 25% thumbnail of the play frame: the hero and each husk
must be findable in under a second.

## Problems
1. **Floor grid out-shouts the characters.** Seen in `ours/01-lit-arena-still.png`,
   `ours/02-combat-still-hud.png` and `shots/critic/look/crop-hero-clean.png`
   (`/?showcase=look`, press H).
   - The grout lines are as dark and as thick as the hero's outline.
   - The hero's dark lower body and boots sit on a grout line and lose their
     silhouette.
   - In play (`/?scene=run&seed=3`, hold W 1.4 s, wait for wave 1), the husks'
     lower halves disappear into the floor (`shots/critic/look/crop-combat.png`).

   This is the main reason a thumbnail reads as "tech demo floor plan" and not
   "game". Fix it as described in Biggest gap.
2. **Light pools are a flat brown wash, not light.** Seen in
   `shots/critic/look/flick/flick-pair.png`.
   - Each brazier tints a disc of floor a desaturated brown, made with dithering.
   - Nothing inside the pool gets a highlight: tile tops, the brazier rim, and
     pillar faces keep their unlit value with a brown multiply on top.
   - The reference's lights push surfaces toward bright warm yellow-white near the
     source, with a hard falloff into black.

   What to do instead:
   - Inside about 1.5 tiles of a torch, map lit faces up the warm ramp:
     `ember` → amber → pale yellow on the top faces nearest the flame.
   - Make vertical faces that point toward the light visibly brighter than faces
     that point away.
   - Keep the dither only for the outer falloff band.
3. **Torch flicker is nearly invisible.** I measured the mean luminance of the left
   brazier pool in `/?scene=run&seed=3`, frozen and stepped 6 ticks at a time: it
   moves only 45.0 to 48.0 out of 255 over a second (`shots/critic/look/flick/`).
   - After palette quantisation, most frames are identical.
   - Raise the flicker amplitude so the radius visibly breathes by about 1 texel
     ring and the inner pool swaps palette step about 3 to 5 times a second.
   - Add an occasional 2-frame dip.
4. **Side walls render as smeared horizontal streaks.** Seen in
   `shots/critic/look/sc/crop-right.png` (showcase, right edge after the pan) and
   `shots/critic/look/run/crop-left.png` (play, left wall).
   - The east and west walls, seen nearly edge-on, show as stacked 1 to 2 px
     stripes of noisy colour, like a texture stretched at a grazing angle.
   - Give side walls a readable top cap (a light 1-texel top edge plus a solid
     face colour), and give their visible face a deliberate brick pattern sized
     for the angle, or none at all.
5. **Unlit props become black holes.** Seen in `ours/01-lit-arena-still.png`: the
   rubble below the portcullis and the debris at the right edge.
   - These props render as near-`ink` blobs with no readable form.
   - Lift the minimum lit value of props by one step (`shadowLift` is 0.05 and
     could be about 0.12 for props), so far-from-torch props still show 2 or 3
     face values.
6. **The large purple ring decal fights everything.** Seen in
   `/?scene=run&seed=3` (`shots/critic/look/run/r0.png`, `ours/02`) and in the
   showcase around the hero.
   - A big violet double ring spans about 5x4 tiles in the middle of every arena.
   - It is the most saturated cool shape in the frame and reads like a UI selection
     circle.
   - Drop it 2 palette steps toward the floor colour, or break it into worn,
     partial arcs.
7. **The north wall is cropped in play, so the frame is about 85% floor.** Seen in
   `shots/critic/look/run2/fight0.png`.
   - The banners and the top of the back wall are cut off by the top edge, so the
     arena has almost no vertical surfaces in view.
   - The reference always shows walls with lit front faces and dark drop-shadows,
     which gives depth.
   - Bias the play camera's rest position so the full north wall face, with its
     torches, banners, and portcullis, is in frame.
8. **The hero's contact shadow is a dithered checker patch offset to the left.**
   Seen in `crop-hero-clean.png`. It reads as floor noise, not as a shadow. Use a
   solid ellipse under the feet (see Biggest gap, step 4).
9. **The skeleton reads poorly.** Seen in `/?showcase=look` (`sc/crop-hero.png`).
   - Its grey and tan voxels are close in value to the lit floor.
   - It overlaps a blood decal of a similar value, so its silhouette is a muddle.
   - This is mostly an enemy-model issue, but the outline and rim treatment should
     carry it.

## must_have checklist
- **pixels never swim or shimmer when the camera moves (texel snapping): PASS.**
  - I froze `/?showcase=look` and stepped 1 tick at a time over 15 frames. Between
    frames the image shifts by exactly 0 or 2 screen px (1 texel), and 99.8 to
    100% of sampled pixels are identical after the shift. The frames at 96 to 97%
    match the torch-flicker and dust-mote changes.
  - Scripts: `shots/critic/look/step/`, and the 7.5 fps pan in
    `shots/critic/look/pan8/`.
- **one palette used everywhere, UI included: PASS.**
  - I counted unique colours in full 1280x720 frames: showcase still 30, in-play
    combat with HUD 32, title card plus HUD 31.
  - `src/render/palette.js` defines 32 hex colours.
- **1-px outlines that read on both dark and lit surfaces: FAIL.**
  - Outlines read inside torch pools.
  - On the dark floor, the `ink` outline matches the grout lines and shadows, so
    silhouettes break: the hero's legs in `crop-hero-clean.png`, the husk's lower
    body in `crop-combat.png`.
- **flickering torch light that actually lights nearby voxels: PASS (weak).**
  - The pools do tint the floor and props near each brazier, and the flicker
    exists.
  - The amplitude is only about 6% of pool luminance (Problem 3), and lit faces
    get a brown wash, not highlights (Problem 2).
- **a still frame of an arena reads as a finished pixel-art game, not a tech demo:
  FAIL (in play), borderline (showcase).**
  - The curated showcase still is attractive.
  - The real in-play frame (`ours/02`, `run2/fight0.png`) is a noisy floor grid
    with a cropped back wall, a loud ring decal, and actors that do not pop.

## Console errors
None. Every capture (`showcase=look`, and `scene=run&seed=3` with movement,
attacks, and god mode) logged 0 console lines and 0 page errors.

## Blind packet
`hurdles/waves/w1/blind/look/` has 4 pairs:
1. a lit dungeon still, interface hidden
2. a combat still with HUD
3. a dark fight strip, 12 frames at 7.5 fps
4. a camera-move strip, 12 frames at 7.5 fps

Both sides of each strip are scaled to 400x225 tiles with area filtering. The
reference GIFs are natively 400x225.
