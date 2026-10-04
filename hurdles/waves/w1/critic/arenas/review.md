PIN: https://playwithfurcifer.itch.io/furcifers-fungeon | 4.7 stars (126 ratings) | top-down pixel-art action roguelite (itch tags roguelite, pixel-art; on the top-rated web roguelite list) whose combat spaces are dense, hand-placed, richly lit pixel environments (a painted forest, then torch-lit stone dungeon rooms) with an animated exit that opens when an area is done; HTML5 (Godot), so it can be played live

# Critic review: arenas (Arenas and environment), wave 1

## Reference

**Furcifer's Fungeon** by Play With Furcifer, https://playwithfurcifer.itch.io/furcifers-fungeon. The page shows 4.7 stars
from 126 ratings (checked today). It is on itch's top-rated web list under `tag-roguelite`. It is already the pinned
reference for `enemies`.

**Why it is the right comparison:** it is a top-down pixel action roguelite fought area by area, and its environments are
what a stranger notices first. Every screen has a composed edge (a tree line, a stone wall with torches), a focal feature
(a pond, a mud patch, a shrine, a sign), dense ground detail, and warm light against cool shadow. Its later floors are
torch-lit stone dungeon rooms, which is exactly our job. It runs in the browser, so I captured live frames rather than
marketing art.

**Candidates I tried and rejected (all played or downloaded):**
- **Gaunt Valkyr** (4.9 from 94, pinned for look and vfx). Not HTML5. Its page has two stills (one is a title card) and
  three 400x225 GIFs, so it can't support several room stills. Its levels are open procedural caves, not authored rooms.
- **Enter the Chronosphere** (4.8 from 62). It loads, but it is a turn-based, click-to-move 7DRL with an abstract hub.
- **Gun Knight** (4.5 from 498). Its HTML5 build opens with "made to test porting to HTML5, has missing features and
  graphical issues", and it is portrait. Using it would not be fair.
- **WASarD** (4.7 from 54), **Nefarius** (4.7 from 173), **Curse of the Lich King** (4.7 from 146, PICO-8). Their room
  art is plainer than Furcifer's, so they would be an easier bar.

**Honest limitation:** I found no top-rated HTML5 action roguelite whose rooms visibly slam shut on entry. Furcifer's first
zone is a connected forest with no sealing doors. Its "area complete" ceremony is the exit: a giant die rises out of the
void, with a bounce, to bridge to the next area. So the strip pair compares the **clear-and-exit-opens** moment, which
both games have, and not the slam. Our slam is judged only in this review (Problem 3 and the checklist).

**How it was captured:**
- **Reference:** the Godot build (`html-classic.itch.zone/html/8189862/`), served locally, driven at 960x540 with a
  long-lived Playwright session (`shots/critic/enemies/live.cjs`, with a URL/dir patch). I played through the tutorial
  room and into the forest. Pair 04 was shot on Playwright's paused fake clock: I pressed pick-up on the reward that
  completes the room, then took 200 ms of game time per frame (`shots/critic/arenas/ref/D-*.png`). Pairs 01 and 02 are
  live frames from the first forest area (`shots/critic/arenas/ref/f4.png`, `f6.png`). Pair 03 is the page's 1920x1080
  dungeon-room screenshot (`img.itch.zone` g3), area-downscaled to 960x540.
- **Ours:** `/?scene=run&seed=1` on the fake-clock driver (`shots/critic/arenas/clk.cjs`) at 1280x720. Steps: hold W 1.4 s
  to enter, wait about 4 s for wave 1, then shoot. For arenas 2, 3 and 5, `__GR.debug.goto(n)`, then the same.
  Pair 01 is arena 1 (antechamber), pair 02 is arena 3 (hall), pair 03 is arena 5 (maw). The strip is
  `/?showcase=arenas&seed=1&at=clear&play=1&hud=0`, with frames `clear2/c-06..c-20` every second frame (200 ms).
- **Fairness:** both sides show full, uncropped play frames with HUD. Ours is not cropped, because the whole-room
  composition is the thing being judged and cropping would hide it. As a result, our actors look smaller than theirs (our
  hero is about 8% of frame height, their goose about 20%), which is how each game plays. The criteria ask the judge to
  ignore characters and attack effects.

## Verdict (not blind)

The reference is better. Ours has a real mood and a sensible symmetrical layout, but every room is the same dark
rectangle of grout-lined flagstones with a few grey boxes on the axes. Each of the reference's screens is a densely
painted place with a focal point, layered edges and light that pulls the eye.

## Biggest gap

**The rooms have no authored focal set-piece or edge dressing, so all five read as one generic box.** All five arenas
share the identical shell: the same rectangle, the same top portcullis with skull, the same two corner wall torches, the
same bottom double-stub gate, and flat noise-textured side walls. Each differs only by a decal in the middle (a rune
ring, a carpet, a pool) and grey cubes scattered on a grid (see `shots/critic/arenas/sc/room1-5.png`). The reference
gives every area:
- a strong silhouette edge: a tree line with depth, or a wall with lit torches and broken pillars;
- one or two big focal features: a pond with a lily pad, a mud pit, a shrine, a sign;
- dense small dressing in clusters: grass tufts, flowers, mushrooms, fireflies;
- light pools that sit on those features.

Concretely, for the builder, per template in `src/world/arena.js` / `props.js` / `tiles.js`:
1. **Give each template its own shell.** Vary room size and aspect, and cut notches or alcoves into the walls: an
   L-shaped or cross-shaped floor for the Crossing, a long nave for the Hall, a round pit for the Maw. Put the
   portcullis off-centre in at least two of them. No two arenas may share an outline.
2. **One hero set-piece per room, at least 3x3 tiles and at least 2 voxels taller than the hero.** For example: a
   collapsed statue with rubble for the Antechamber, an altar with a candle cluster and hanging chains for the Shrine,
   a sarcophagus row for the Ossuary, a cracked ember fissure with a glow and rising embers for the Maw. Light it with
   its own warm pool.
3. **Dress the wall bases and corners in clusters, not single cubes.** Use groups of 3 to 6 props (bones, skull piles,
   pots, rubble, cobweb corners, moss), with at least one cluster per wall segment. Kill the lone grey "pedestal box"
   props that dot the floor on the grid. They read as placeholder geometry.
4. **Give the side walls depth.** Replace the flat noisy vertical strips (left and right edges of every frame) with
   visible brick courses, a top cap, and a dark base shadow, like the top wall already has.
5. **Floor variation by zone.** Use a different tile type in the room's centre zone versus its paths (worn path tiles,
   cracked tiles near the set-piece, moss near walls), instead of one flagstone pattern with random speckle everywhere.

## Problems

1. **Every arena is the same room.** Seen in `shots/critic/arenas/sc/room1.png` through `room5.png`
   (`/?showcase=arenas&seed=1&room=N&hud=0`, wait 1.5 s).
   - The outline, doors, corner torches and wall art are identical in all five.
   - Only a centre decal and a few props change.

   Played in sequence, arena 4 feels like arena 1 with a different rug. Fix it as described in Biggest gap, steps 1 and 2.
2. **Seeds barely change a room, and the template order is almost fixed.** Arena 1 is always "The Antechamber" and
   arena 5 is always "The Ember Maw". Seeds 3 and 7 produce the identical order (antechamber, ossuary, crossing, hall,
   maw), checked via `planWaves`/`runTemplates` in `shots/critic/arenas/esc`. The seed 1 and seed 3 antechambers
   (`sc/room1.png` against `run/r0.png`) have the same braziers, pillars, rune ring and banners. Only small edge props
   move. The goal says "templates with variation", and the variation is too small to notice.
   - Let the seed pick from at least 2 variants per slot.
   - Mirror the layout.
   - Swap the set-piece.
   - Re-roll the prop clusters.
3. **The door slam has no slam.** Seen in `shots/critic/arenas/seal2_door.png` (33 ms frames,
   `/?showcase=arenas&seed=1&at=seal&play=1`).
   - The portcullis bars pop in fully formed between two frames. There is no fall, no impact squash and no bounce.
   - The ceremony after that is a white flash and two ring decals on the lamps, plus a faint grey ellipse of "dust".
   - Seen from the gameplay camera, the bars are short stubs at the bottom edge, about 150 px wide in a 1280 frame, so
     the moment is easy to miss.

   What to do instead:
   - Drop the gate from above the frame over 3 to 4 frames, with ease-in.
   - Land it with a 1-frame overshoot (bars 1 voxel too low), then settle.
   - Throw a fan of stone chunks and a 6 to 10 particle dust burst along the floor, both sides of the gate.
   - Kick the camera 2 to 3 texels downward through the shared shake channel.
   - Flash the two door lamps from ember to red as the gate lands, not before.
4. **Large dead band below every room.** In play (`final/r1b.png`, `r3.png`, `r5.png`), the bottom 70 to 130 px of the
   720 px frame is flat near-black void plus the entry stair stub. That is about 10 to 18% of the screen showing nothing.
   - Clamp the camera so the near wall sits on the bottom edge once the door is sealed.
   - Or build a foreground wall lip (a dark silhouette of the near wall's top, with a few props) to frame the room, the
     way the reference frames its screens with a foreground tree line.
5. **The floor reads as a grid, not a place.** Every room uses the same large flagstones with ink-dark grout and
   random speckle, edge to edge (`final/*.png`). The reference's ground has clusters and patches (grass, mud, a pond)
   that steer the eye.
   - Cluster the floor variation around features (see Biggest gap, step 5).
   - Drop random speckle in open areas, so the set-pieces carry the detail.
6. **Centre rune decals look like debug overlays.** The Maw's red rune circle (`rooms/g4b.png`, `final/r5.png`) and
   the Antechamber's violet ring (`sc/room1.png`) are thin one-colour pixel scrawls that lie flat over everything,
   including the grout, with no inset, wear or glow variation.
   - Carve them into the floor: a darker inset groove with a lit edge on one side.
   - Make the Maw's ring glow and pulse from ember at the braziers, fading around the circle.
7. **Wave banner collides with the run title, and with bright set-pieces.** At run start (`run_door.png`, frames 0 to 2,
   `/?scene=run&seed=3`), "THE GAUNTLET" and "THE ANTECHAMBER" draw on top of each other. In the Maw
   (`rooms/g4b.png`), "WISP, 2 HUSKS, MITE SWARM" sits on the bright brazier glow and is barely legible.
   - Queue the arena banner until the run title has gone.
   - Give the wave sub-line a dark backing plate.
8. **Props are small, grey and undifferentiated.** The pedestal cubes, crates and bone piles are all about 1 tile, in
   the same desaturated grey-brown, and break into a few planks (`props_h3.png`, `props_p0.png`). They do break and
   drop gems, which is good, but they don't add colour or silhouette.
   - Make breakables visibly distinct: warm wood crates, clay urns with a colour band.
   - Give them a 2-frame shatter with chunks that bounce and stay on the floor.
9. **Arena 1 is a weak first impression.** It always has 2 waves of 2 units (`husk+husk / mites+husk`), so the first
   fight is over before the room has done anything. Add a third, small wave, or make the clear moment wait for a beat
   so the room ceremony lands.

## must_have checklist

- **Rooms look hand-made, not random (composition, focal props, floor variation): partial fail.** Each room is
  symmetrical and deliberate, so it is not random. But all five share one shell, there is no focal set-piece, and the
  floor is uniform (Problems 1, 2 and 5).
- **Doors slam shut on entry with shake and dust; the clear moment is celebrated: half pass.**
  - Slam: fail. The bars pop in with no motion, the dust is faint, and no shake is visible in `seal2_door.png`.
  - Clear: pass. A gold ring burst on the last kill, an "ARENA CLEARED" banner, the door lamps turning gold, the top
    portcullis lifting with a ring and sparks, and banners lowering (`clear2_sheet.png`, `clear4.png`).
- **Wave composition escalates across the 5 arenas and is seed-reproducible: pass.**
  - Escalation: wave counts are 2, 2, 3, 3, 3. Sizes grow from 2 units to 5 or 6. Brutes appear from arena 3, and
    two brutes in arena 5.
  - Reproducibility: the same seed gives an identical plan (seed 3 run twice), and seeds 1 and 7 differ
    (`shots/critic/arenas/esc`).
- **Props break or react when hit where it makes sense: pass (weak).** Hitting a crate in arena 1 with J breaks it into
  planks and drops gems (the counter goes 0 to 3) (`props_sheet.png`, `props_h3.png`). The breakup is small and quick.

## Console errors

None. All ten capture runs logged 0 errors and 0 page errors (`shots/critic/arenas/*/console.log`).
