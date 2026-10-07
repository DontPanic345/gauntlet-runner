# Critic review: look (Render look), wave 2

## Reference
**Gaunt Valkyr** by Ember Paw Games, https://ember-paw-games.itch.io/gaunt-valkyr,
rated 4.9 stars from 94 ratings. This reference was pinned in wave 1 and I used it unchanged.

It is the right comparison because it is a top-down pixel action roguelite, fought in
sealed rooms under the same fixed overhead framing as ours. Its look is built on what this
piece owns: dark rooms carved out by real light, a strong value hierarchy, and actors
that pop off the floor.

It is not an HTML5 game, so I re-downloaded its page media from img.itch.zone:
- two 2560x1440 stills;
- three 400x225 gameplay GIFs, sampled with ffmpeg at 7.5 fps.

Pairs 01 and 02 reuse the wave-1 reference stills. Pair 03 is a frame from the "area clear"
GIF. Pairs 04 and 05 are new samples: the dark fight GIF, and the GIF where the camera
actually scrolls.

## Verdict (not blind)
The reference is better, by a smaller margin than in wave 1.
- Ours wins the curated showcase still, and its combat now has real juice.
- Ours loses the in-play frame. It is one flat band of mid-violet, with all the light
  crammed against the top edge.

## Biggest gap
**In play, light does not shape the frame.** Problem 1 gives the detail. In
`/?scene=run&seed=7` (`ours/02`, `ours/03`):
- the only light is the two braziers and the sconces against the top edge of the screen;
- the lower two-thirds of the arena, where the fight happens, is evenly lit mid-violet
  stone with no light and no shadow;
- the light pools that do exist are brown, dithered stains, not light.

The reference makes every frame a dark room with bright pools in it, and the player
always stands in or near one. To fix this:
1. **Lower the unlit ambient.** Drop it 1 to 2 palette steps, so that floor beyond about
   3 tiles from any light sits at `night` or deep violet, not mid-violet. The floor in the
   middle of an arena should be clearly darker than it is now.
2. **Give the hero a carried light.** Use a warm-neutral light with a radius of about
   2.5 tiles, centred on the hero, so the player is always the brightest point outside a
   brazier. Pulse it brighter for a few frames on each swing or hit, as the reference's
   muzzle flashes do.
3. **Spread the fixed lights through the arena.**
   - Add sconces on the east and west walls at mid-height.
   - Add at least one light source in the lower half of every arena.
   - Make sure no 4x4-tile patch of walkable floor is more than about 3 tiles from a light.
4. **Turn pool interiors into lit stone, not a brown multiply.**
   - Lift tile tops toward a warm stone ramp: lit stone, then amber, then pale yellow at
     the centre.
   - Use 2 or 3 hard bands.
   - Keep the dither only on a 1 to 2 texel boundary between bands, not across a 30 px
     ring as now.

Check the result on a 25% thumbnail of `ours/03`. You should see dark corners, 3 or more
bright pools, and the hero visibly lit.

## Problems
1. **The in-play frame is flat and mid-value, with light only at the top.**
   - Seen in `ours/03-arena-at-rest-hud.png` and `ours/02-combat-still-hud.png`.
     Steps: `/?scene=run&seed=7`, wait 4 s, hold W 2.3 s, wait 3.5 s.
   - Mean luminance in a crop around the top-left brazier is only about 54 to 69 out of
     255, and the rest of the floor is about the same value.
   - The reference (`ref/01`, `ref/04`) puts deep black next to bright pools, and its
     actors are always readable in the light.
   - What to do: see Biggest gap.
2. **Light pools are still brown dithered stains (carried over from wave 1).**
   - Seen in `shots/c2look/flcrop.png`, a crop of the in-play brazier.
   - Inside the pool, floor tiles turn a flat desaturated brown. A wide 50% checker ring
     makes up most of the pool's area, and no tile top gets a highlight.
   - On the north wall, sconce pools are perfect circles painted across the wall face and
     the floor alike (`shots/c2look/flick1516.png`). The light ignores geometry, so it
     reads as a decal.
   - What to do:
     - Shade by surface normal: faces toward the light are brighter, faces away stay dark.
     - Use banded falloff, as in Biggest gap step 4.
3. **The side walls are still smeared horizontal stripes (carried over from wave 1).**
   - Seen at the left and right edges of every play frame (`ours/03`), and in the right
     third of `shots/c2look/crops.png`.
   - The east and west walls show as stacked 1 to 2 px noisy stripes, like a texture
     stretched at a grazing angle. This is the most "tech demo" element in the frame.
   - What to do:
     - Render each side wall as a solid cap: a light 1-texel top edge plus a flat face
       colour.
     - Add at most one deliberate brick course per tile, or drop the texture on faces
       seen edge-on.
4. **The north wall is cropped in play (carried over from wave 1).**
   - In `ours/02` and `ours/03`, the banners, sconces and portcullis are cut off by the
     top edge and overlap the HUD's room-progress bar.
   - The best-looking part of the room (the lit wall with its props) is half off-screen,
     while the bottom 10% of the frame is the south gate.
   - What to do: rest the play camera about 1.5 tiles further north, or frame the arena so
     that the whole north wall face is in view.
5. **Actor faces carry a regular dot-grid dither.**
   - Seen in `shots/c2look/crops.png`, left and centre panels at 3x.
   - The hero's back and the husk's skull show an even grid of single darker dots on every
     flat face. It reads as halftone or knitted texture, not pixel art, and it muddies
     the actor silhouettes that should be the cleanest thing on screen.
   - What to do: apply no ordered dither on actor meshes. Shade actors with flat face
     values, plus AO steps on creases only.
6. **The floor emblem flashes into a pale disc on hits.**
   - Seen in `shots/c2look/fight2/b01.png`, `b04` and `b10` (`/?scene=run&seed=7`, spawn
     husks beside the hero, attack).
   - When the hero attacks over the skull mosaic, the whole mosaic turns into a flat
     pale-grey dithered oval about 2 tiles wide that hides the actors' feet. It reads as
     a rendering glitch.
   - What to do:
     - Clamp the hit or swing light's contribution on floor decals.
     - Or keep the hit flash on the actors only.
     - At most, light the floor one palette step.
7. **The big dark ring decal is still around the arena centre (wave-1 Problem 6, only
   recoloured).**
   - Seen in `ours/03`: a double ring, about 5x4 tiles, drawn in near-`ink`, framing the
     skull.
   - It competes with the actors' outlines and reads like a selection circle.
   - What to do: break it into worn partial arcs, one step darker than the floor, not
     `ink`.
8. **Unlit pillars and props are still near-black lumps (wave-1 Problem 5).**
   - The four arena pillars in `ours/03` are dark violet mushrooms with one face value.
   - What to do:
     - Raise the minimum prop light.
     - Or, better, place the fixed lights so that each pillar has a lit face (Biggest
       gap step 3).
9. **The arena entrance frame is a third void.**
   - Seen in `shots/c2look/run/r0.png` and `shots/c2look/gotosheet.png`
     (`/?scene=run&seed=7`, debug.goto 1 to 4, before moving).
   - While the hero stands at the south gate, the bottom 35% of the frame is the exterior
     of the south wall, drawn as a camouflage-like field of dark noise blobs.
   - What to do:
     - Render out-of-room space as flat `night`, with at most a sparse rock pattern.
     - Or rest the entry camera further north.
10. **The hero gets no contact shadow, and its back view reads as a pink block.**
    - Seen in `shots/c2look/crops.png`, left panel.
    - The shadow under the hero is lost in the dark band beneath it.
    - From behind, the hooded runner is a uniform pink cuboid with no hood edge or cloak
      read.
    - The hero model belongs to the hero piece, but the outline and rim lighting are this
      piece's job. A frost rim on the upper and side edges facing the camera would carry
      the silhouette.

What improved since wave 1:
- The floor grout is quieter.
- Torch flicker is now visible: pool radius and flame shape change between 1-tick steps
  (`shots/c2look/flick1516.png`).
- Husks now cast a solid drop shadow.
- Combat is far livelier.
- The showcase still is genuinely attractive.

## must_have checklist
- **Pixels never swim or shimmer when the camera moves (texel snapping): PASS.**
  - Method: froze `/?showcase=look` and stepped 1 tick at a time over 24 frames, then
    searched for the best integer shift on the north-wall band.
  - Every move is exactly 0 or 2 screen px (one texel). After the shift, 98.8 to 100% of
    pixels match.
  - The frames that matched only 81 to 94% line up with sconce-pool flicker changes I
    checked visually (`shots/c2look/flick1516.png`), not with swimming.
- **One palette used everywhere, UI included: PASS.** Unique colours per 1280x720 frame:
  showcase 30, in-play combat with HUD 32, arena at rest 32, entry frame with title card
  32. `src/render/palette.js` defines 32.
- **1-px outlines that read on both dark and lit surfaces: FAIL (weak).**
  - Outlines read in the pools and against lit floor.
  - On the dark band south of the skull, the hero's lower outline merges with the shadow
    beneath it (`crops.png`, left).
  - The dot-grid dither on actor faces (Problem 5) also eats into the inner edges.
- **Flickering torch light that actually lights nearby voxels: PASS.**
  - Flicker is now visible between 1-tick steps.
  - The pools tint nearby floor and walls. But they tint more than they light (Problem 2).
- **A still frame of an arena reads as a finished pixel-art game, not a tech demo: PASS
  for the showcase, FAIL in play.**
  - `ours/01` (showcase) reads as a finished game.
  - `ours/03` (real play) is flat and mid-value. It has striped side walls, a cropped
    north wall and a selection-ring decal (Problems 1, 3, 4 and 7).

## Console errors
None. Every capture logged 0 console lines and 0 page errors:
- `?showcase=look`: stills, pan, and 1-tick stepping;
- `?scene=run&seed=3` and `?scene=run&seed=7`: walking, debug.goto 1 to 4, spawned
  husks, held attacks, and freeze/step.

## Blind packet
`hurdles/waves/w2/blind/look/` has 5 pairs:
1. a lit dungeon still;
2. a combat still with HUD;
3. an arena at rest with HUD, both sides at 400x225 source size;
4. a dark fight strip;
5. a camera-move strip.

Both strips are 12 frames at 7.5 fps, with tiles at 400x225. Ours were frozen and stepped
8 ticks per frame.
