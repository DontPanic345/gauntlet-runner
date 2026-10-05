# arenas: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/arenas.md`) still describe the room runtime, the clear
ceremony, props' reactions, the wave director, sounds and most APIs. This file covers what changed.

## What exists

- **Seven templates, each with its own outline, size, material and set-piece** (`TEMPLATES` in `src/world/arena.js`):

  | id | name | theme | size | outline | set-piece |
  |----|------|-------|------|---------|-----------|
  | antechamber | THE ANTECHAMBER | crypt | 17x12 | stepped wall masses in all four corners, raised ledges either side of the exit | the fallen colossus: a giant hooded stone face lying face-up, cracked, moss in one eye |
  | cistern | THE CISTERN | sunken | 17x13 | water channels down both sides, ledges at the back | a round fountain with a broken spout |
  | shrine | THE DROWNED SHRINE | sunken | 19x12 | a round pool round the statue's island, water bays in the front corners | statue on the island, candles round the pool |
  | ossuary | THE OSSUARY | ossuary | 17x12 | burial ledges down both sides with sarcophagi on them, corner masses | the bone mound: a heap of skulls crowned with candles |
  | hall | THE HALL OF WARDENS | hall | 15x15 | a long nave, a colonnade each side, a dais by the back wall, front corners stepped in, exit off to one side | the Warden's throne |
  | crossing | THE BROKEN CROSSING | garden (OVERGROWN) | 19x13 | a cross of floor over collapsed corners (pits), ragged edges | the root tree, grown down through the vault |
  | maw | THE EMBER MAW | deep | 21x13 | rounded by stepped masses, a lava fissure in the middle; **two layouts** (the seed picks) | the lava fissure, a glowing rune ring round it, two braziers |

  `SLOTS`: arena 1 picks from antechamber and cistern, 2 from ossuary, shrine and antechamber, 3 from hall, crossing and cistern, 4 from crossing, ossuary, hall and shrine, 5 is the Maw (layout A or B). A run never repeats a template while others remain. Each room is also mirrored 50% of the time.
- **New tile kinds** (legend at `TEMPLATES`): `X` wall mass, `^` raised ledge (seeded dressing: candles, urns, bones or bare), `Z` ledge with a sarcophagus, `_` pit, `~` water (lava in the deep theme), and set-piece tiles `C T Y F M`. A template's `rows` can be a list of layouts (`variant`).
- **Six material themes** (`THEMES` in `src/world/tiles.js`), each with its own floor pattern, colours, wall masonry, pit and water colours, foreground rock and focal light colour:
  - crypt: dressed flagstones, flush joints, violet brick;
  - sunken: irregular cobbles (Voronoi), teal and moss stones near water, mossy teal brick, cold `sky` light on the set-piece;
  - ossuary: packed earth in soft blotches, a laid bone path, walls of stacked skulls;
  - hall: a slate and violet tiled checker in a border band, pale marble ashlar walls, a navy and gold carpet;
  - garden: moss, dirt and grass tufts with islands of old paving, roots hanging down the back wall, warm `torch` sunlight on the tree;
  - deep: big split basalt slabs (Voronoi), rough walls with ember veins, lava with drifting dark crust plates.
- **Floor zoning** instead of speckle everywhere: the worn path from gate to exit uses its own slabs, cracks radiate from the set-piece, moss creeps from the walls, stones near water are wet, and a dark contact strip runs along every wall foot. Per-voxel random speckle is gone, except a trace near walls in the crypt.
- **The floor model is 10 voxels thick**, so pits drop 1.25 units with layered strata walls. Pit and water shores are ragged and always inside their tiles (the collision box), so the visual edge is never outside the solid edge.
- **Carved focal inlays**: a one-voxel groove with a lit lip on its far side, in place of the flat painted ring. In the Maw, the rune ring is eight emissive segments that light in a chase round the circle. They all light during the clear.
- **Walls with depth**:
  - side-wall pilasters stand 3 voxels into the room every 3 tiles, with a capital, a dark foot and a collider;
  - masses have masonry faces in the theme's style, a ragged foot, capstones and moss;
  - ledges have a lit front lip and a dark foot;
  - capstones are laid in rows (no random speckle).
- **No void round the room**: rough rock fills 3 tiles beyond each side wall, and a foreground rock band runs in front of the parapet (past the side walls) either side of the landing stair. After the seal, `tickCamera` eases the view's bottom edge up to the parapet, so the screen is all room.
- **The room is never still**: the water surface has three frames of sliding ripples and glints, cycled every 14 ticks, plus twinkles. Lava spits embers and pops. The lava has its own breathing ember light, and the Maw ring chases.
- **Props** (`src/world/props.js`):
  - new set-piece models: `colossus`, `throne`, `tree` (sheds leaves when hit), `fountain` and `mound`. All are solid and never break;
  - pillars are now round fluted columns with a round capital, so from above they no longer read as grey boxes;
  - props can stand on ledges (`y` option; no collider of their own);
  - broken pots, crates and bones leave chips on the floor for the rest of the room (`look.impact.chips`).
- **Door slam** (critic problem 3):
  - the spikes are taller (19 voxels) and accelerate up out of the slot over 5 ticks;
  - on the slam they overshoot by a voxel, then settle over 5 ticks with a bounce;
  - the camera kicks downward, and dust is thrown both into the room and out onto the landing;
  - the post lamps flare **red** on impact, then cool to ember 26 ticks later;
  - during the slam the camera leans 80% of the way to the gate, so it is in frame at zoom 2.
- **Banners**:
  - the room title waits while `opts.bannerHold()` is true (the run card), and the first wave waits for the title;
  - the wave sub-line sits on an ink plate.
- **Waves**: arena 1 now has 3 small waves: 2 husks, then husk and mite swarm (or 2 husks), then husks.
- **Pathing**: with pits and masses, a straight chase could wedge an enemy in a concave corner (seen in the Maw: a mite stuck for 25 s). The arena gives its enemy manager `foes.nav`. When an enemy's straight line to its seek target is blocked, `waypoint()` returns the next visible tile on a BFS path (8-way, no corner cutting, around solid props and set-pieces). With it, all seven templates clear under the demo pilot (seed 1, the arena 3 plan), with 0 console errors.

## APIs

Everything in the wave 1 notes still holds. New or changed:

```js
import { generateArena } from '../world/arena.js';
generateArena(index, seed, { template?, variant? })   // variant: force a layout of a multi-layout template
// layout fields added: variant, pilasters [{side, j}], lava [x, z] | null, carpetFrom
new Arena(root, L, { ..., bannerHold: () => bool })   // the room title waits while true
arena.waypoint(enemy, x, z) -> [x, z] | null          // also installed as arena.foes.nav
arena.water / arena.glowSegs / arena.lavaLight         // the animated layers (internal)

import { THEMES, SOLID_TILES, LOW_TILES, LEDGE_Y, PILASTER, GATE_H } from '../world/tiles.js';
SOLID_TILES   // { '#': 'block', X: 'wall', '^': 'ledge', _: 'pit', '~': 'water' }: the collision tag per tile
LOW_TILES     // '_~': their boxes carry `low: true` (feet stop, orbs fly over)

props.add(kind, x, z, { variant, turn, y })   // y: standing on a ledge (LEDGE_Y); no collider
PROP_DEFS.colossus / throne / tree / fountain / mound   // setPiece: true
```

- `enemies`: `Enemy.seek()` asks `this.mgr.nav?.(enemy, x, z)` for a waypoint first (see the cross-piece edits). Any scene that does not set `nav` behaves as before.
- `movement`: `CollisionWorld.blocked(x, z, r, overLow = false)`. With `overLow`, shapes marked `low` are ignored.
- `look`: stains and droplets still land at y = 0. Over a pit they float at floor height, and on a ledge they hide under it (see Known gaps).

## Debug hooks and showcase params

- `__GR.debug.arena('layout')`: the active room's resolved tile rows, wall string, size, variant and mirror.
- `__GR.debug.arena()` info now includes `variant`.
- `?showcase=arenas` new params:
  - `&tpl=<id>[,<id>...]`: force templates onto arenas 1, 2, and so on. One id makes every arena use it. Example: `/?showcase=arenas&room=1&tpl=maw&hud=0` is a still of the Maw;
  - `&var=0|1`: force a layout variant (the Maw has two);
  - `&cam=x,z`: hold the tour camera on a world point. Use it for close-ups with `&zoom=2`. Example: `&tpl=antechamber&zoom=2&cam=0,0.5` shows the colossus face.
- The tour card shows ` B` after the template id when the second layout is in use.
- Strip recipes (deterministic, unchanged in method):
  - **Door slam**: load `/?showcase=arenas&seed=1&at=seal&play=1&hud=0&zoom=2`, wait 1.5 s, run `debug.freeze(true)`, `debug.step(30)`, wait, then `debug.arena('seal')`. Step 1 tick per shot. The spikes show from about step 3, rise over steps 3-6, and slam (red lamps, chunks, dust) at about 6. The settle runs to about 11.
  - **Clear**: as in wave 1. `&tpl=` works with it, for example `&at=clear&play=5`.
- **Fast-forward play check**: load `/?showcase=arenas&seed=1&mode=play&play=3&tpl=<id>`. Run `debug.freeze(true)`, then repeat `debug.step(600)` and wait about 3.5 s. Read `state().showcase.arena.state` until it is `clearing` or `open`.

## Cross-piece edits

- `src/core/collision.js` (movement): `blocked()` takes an optional 4th argument `overLow` that skips shapes marked `low`. It is a one-line behaviour change, and the default is unchanged.
- `src/enemies/manager.js` (enemies): the orb wall check passes `overLow = true`, so wisp orbs fly over pits and water instead of popping at the edge.
- `src/enemies/enemy.js` (enemies): `seek()` first asks `this.mgr.nav?.(this, x, z)` for a waypoint. It is 2 lines, and is a no-op when no `nav` is set.
- `src/run/arena-scene.js` (run-flow): passes `bannerHold: () => !!card && card.t < 200` to the Arena, so the room's title no longer draws over "THE GAUNTLET" (critic problem 7).

## Known gaps

- **Still dark between lights.** The pool is 8 lights. A room has 2 sconces, up to 2 braziers, 3 shafts and maybe the lava light. The front third of most rooms sits in cool shadow. The floors were lifted a palette step and the walls dropped a step for separation, but the reference is much brighter.
- **The antechamber is the least changed room.** It has a new outline and set-piece, but it keeps the crypt flagstones and violet brick of wave 1. Its corner masses read as part of the wall more than as a silhouette.
- **The root tree's canopy** is lit from below by its shaft (the light sits at y 3 and the crown is higher), so the crown reads as a dark green mass. Its trunk is mostly hidden by the crown from the game camera.
- **Pits are black voids** with a strata wall on the far side. Only the Maw's pit has a floor (lava). The crossing's corners read as "collapsed into dark" rather than as a visible depth.
- **Stains and drops ignore the room's shape** (look's impact layer assumes y = 0). A droplet thrown over a pit or lava lies at floor height above it, and stains on a ledge top are hidden.
- **Pathing is tile-coarse.** The BFS runs on whole tiles, and set-pieces block every tile their box touches. Wisps kite with their own steering and use the hook only when they seek. A wisp can still hover at a pit edge for a while. In the Maw test, the last husk-or-wisp straggler took about 17 s to come to the hero.
- **The flush crypt and hall joints** still read as a grid at zoom 1 (AO darkens the joint). The hall in particular is a regular checker by design.
- **Water and lava ripples** are three static frames swapped, not a real surface animation. There is no splash when something is knocked toward the water, because nothing can enter it.
- **Performance**: in headless software GL, a room's models take 110-200 ms to build and 80-240 ms to mesh. They are cached per seed and room, and the build happens behind the room transition, so the tour hitches when it changes room. The floor model of the 21x13 Maw is the largest (about 52k quads in total with the walls).
- **Template coverage**: 7 templates and 8 layouts. Only the Maw has two layouts. Arenas 1-4 vary by template choice, mirror, `?` slots and ledge dressing, not by alternative layouts of the same template.
- **Tuning untested on people**: the arena 1 third wave, the 26-tick red lamp and the camera clamp after the seal.
