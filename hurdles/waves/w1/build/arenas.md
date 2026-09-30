# arenas: builder notes (wave 1)

## What exists

- **Templates** (`src/world/arena.js`, `TEMPLATES`): six hand-authored rooms, written as ASCII with one character per world tile (the legend is in the file).
  - Antechamber (crypt, 17x10): 4 pillars, 2 braziers, a ring inlay.
  - Drowned Shrine (sunken, 17x11): a statue on a teal rune circle ringed by candles, puddles.
  - Ossuary (tile floor, 17x11): tomb blocks, a skull-pile focal inside a square inlay, grates, bones.
  - Hall of Wardens (17x11): a red carpet runner from gate to exit, two rows of pillars, statues flanking the exit.
  - Crossing (tile floor, 17x11): corner block clusters, a cross inlay with grates, an off-centre exit.
  - Ember Maw (deep, 19x12): glowing ember cracks, a red rune circle with two braziers, broken pillars, a sarcophagus.
- **Slots**: `SLOTS` says which templates each of arenas 1-5 may use. A seed never repeats a template while others remain, and arena 5 is always the Maw.
- **Seeded variation** (`generateArena(index, seed)`, pure):
  - the template for each slot, and a 50% mirror (the exit moves with it);
  - every `?` slot (urns, bones, rubble, barrel, crate or nothing);
  - prop variants, quarter turns and 1-voxel jitter, urn cluster sizes;
  - loose rubble along the walls;
  - the floor: slab layout, cracks, moss, stains, puddles, bone chips.
- **Tiles** (`src/world/tiles.js`): each room is 5 voxel models, the floor, back wall, two side walls and front parapet, built from the layout and cached per `seed.index.template`.
  - Five themes set the slab colours, style (flagstone or square tile), grout, inlay colours, moss amount, bricks and banner colours.
  - Floor dressing: a lighter worn path from gate to exit, and the focal inlay (ring, rune star, cross or square). The hall theme adds its carpet.
  - Also on the floor: random-walk cracks (emissive ember in the deep theme), moss creeping from the walls, blood splats with a smear and droplets, puddles, drain grates, grit along the wall bases, the exit's stair going down into the dark, and the landing and gate slot in front.
  - Back wall: brick courses, pilasters, sconces, alcoves (skull and candle), chains, crumbled patches, cobwebs in the corners, and the exit arch with a keystone skull.
- **Props** (`src/world/props.js`): voxel models for urns (3 kinds), crate, barrel, bones, candles, brazier, pillars (2 whole variants and a broken stump), rubble, statue, sarcophagus, skull pile, banners (3 sway frames per colour set), and the wrecks (shards, planks, scattered bones, snuffed candles).
- **What reacts, and how:**
  - urns break in 1 hit; crates and barrels in 2 (the first hit cracks them: model swap, splinters, rock);
  - bones scatter on a hit or when the hero dashes through them;
  - candles are knocked over (smoke puff, flames out);
  - braziers rock, spit embers and flare their light;
  - pillars, statues, the sarcophagus and the skull pile shed chips and sift grit from the top.

  Every reaction has a white flash, a spring rock, a small hitstop and kick, and a synthesised sound. Brute crashes and slams break or shake props nearby, and wisp orbs that pop on a pot break it.
- **Doors and ceremony** (`Arena`). The hero starts on the landing outside the gate.
  - **The seal**, one step inside: iron spikes slam up out of a floor slot with overshoot. This plays a 6 px shake, an upward kick and 70 ms hitstop, a dust wall, a floor ring, stone chips and sparks, a light pop, and a boom and clang. Grit falls off the posts and walls, the banners flurry, the gate-post runes and the exit seal ignite ember, and the sconces roar up one by one from the exit outward, each with a pop, embers and a whoosh. The room's name card follows, then wave 1 at tick 84.
  - **The clear**, on the killing blow of the last wave:
    - 0.3x slow motion for 12 sim ticks, a white flash, a gold shockwave from the kill, and a big gold light;
    - every light flares, gold twinkles cross the floor, and the runes and seal turn gold;
    - an ARENA CLEARED banner with the clear sting;
    - the seal shatters (a burst plus sound);
    - the portcullis ratchets up in 5 jerks, each with a clank, shake and grit from the arch, while a gold light fades up inside the arch;
    - then "THE WAY DOWN IS OPEN".

    `tickCamera` leans the camera toward the gate during the slam and toward the exit while the portcullis rises, and never lets the hero leave the screen.
  - **The exit**: walking into the arch fires `arena:exit`.
- **Waves** (`src/world/waves.js`): each wave has a threat budget that buys units by cost (husk 2, mites 3, wisp 3, brute 6), with per-arena caps and forced introductions (`ESCALATION`). Arena 1 is two husks, then a husk and a mite swarm. Arena 2 introduces the wisp. Arena 3 has the first brute, in its last wave. Arenas 4-5 have bigger budgets, and the last wave of arena 5 holds two brutes. The waves come from `Rng(seed/waves/index)`, so they are identical for a seed whatever the hero does.
  - The director places spawns on the template's `s` points, far from the hero and spread apart, 11 ticks apart. The next wave comes after a 45-tick breather when the room is empty, or when one straggler is left after 9 s.
  - Wave banners are drawn by the arena.
- **Lighting**: sconces (flame, radius 8.5), braziers (radius 9.5), and up to 3 cold "vault crack" shafts: a bright one over the focal and two over the room's halves. The exit glow is created only when the portcullis starts to rise, which keeps the room within look's 8-light pool. Braziers and sconces also get vfx ambient fires and embers, and dust motes fill the room.
- **Sound** (`arenaSfx` in `props.js`): synthesised slam, clank, seal, clear sting, ignite, pot, wood, bones, clink and puff. The context is only created after a user gesture.
- **Normal play**: `?scene=run` now plays real arenas (see cross-piece edits). Walking out of the exit loads the next arena, and after arena 5 the boss placeholder.

## APIs

```js
import { generateArena, Arena, cameraBounds, setActiveArena, getActiveArena, runTemplates,
         ARENA_COUNT, TEMPLATES, SLOTS } from '../world/arena.js';
const L = generateArena(index /*0..4*/, seed, { template? });   // pure layout: tiles, props, spawns, plan, name
const arena = setActiveArena(new Arena(root, L, { hero: () => ctl, foes?, waves = true, awake = false,
                                                 banners = true, autoSeal = true }));
setCollision(arena.collision);                 // walls, blocks, doors, solid props
new HeroController({ x: arena.start.x, z: arena.start.z, yaw: arena.start.yaw, collision: arena.collision, ... })
new CameraRig({ bounds: cameraBounds(L, zoom) })
combat targets: () => [...world.enemies, ...arena.targets()]
// tick (after combat.tick()):  arena.tickCamera(cam, ctl)  (instead of cam.tick)  then  arena.tick()
//   arena.tick() ticks its own EnemyManager (arena.foes) and the wave director (arena.waves)
// render: arena.render(alpha)     ui: arena.ui(g) (banners; pass banners:false if hud draws them)
// exit:   arena.dispose()
arena.state   // 'waiting' | 'sealing' | 'fight' | 'clearing' | 'open' | 'exited'
arena.seal(); arena.forceClear(); arena.cameraFocus() -> {x, z, k} | null; arena.info()
arena.bounds  // interior {minX, maxX, minZ, maxZ};  arena.exitX;  arena.L (layout)

import { planWaves, WaveDirector, describeUnits, ESCALATION, COST, PACE } from '../world/waves.js';
import { createProps, PROP_DEFS, arenaSfx, buildPropModels, bannerModels } from '../world/props.js';
import { THEMES, buildRoomModels, buildDoorModels } from '../world/tiles.js';
```

- `world.room` is kept up to date: `{index, kind: 'arena', id, name, seed, state, wave, waves, cleared}`.
- Props are combat targets whose `takeHit` returns false, so combat plays none of its own hit effects, damage numbers or hitstop for them. They carry `noAssist`.

Events:

- `arena:enter {arena}`
- `arena:seal {arena}`
- `arena:wave {n, total, units}`
- `arena:wavesDone`
- `arena:clear {arena, x, z}`
- `arena:open {arena}`
- `arena:exit {arena}`
- `prop:hit {prop, kind, x, z, cause}`
- `prop:break {prop, kind, x, z, cause}`: `run-flow` or `boons` can drop pickups here.

`audio` can silence the stand-ins with `arenaSfx.enabled = false`.

## Debug hooks and showcase params

- `__GR.debug.arena(action?)`:
  - no action: the active arena's info (template, mirror, state, waves, alive, gate, portcullis, props);
  - `'plan', seed?`: all five layouts' templates and wave plans for a seed, with no scene change;
  - `'seal'`, `'clear'` (every enemy dies and the clear moment plays), `'wave'` (the next wave now);
  - `'break', kind?`: break every breakable prop, or every one of a kind.
- `debug.goto(i)`: works in `?scene=run`, where it loads arena i, and in the showcase. `debug.spawn` goes to the arena's manager.
- `?showcase=arenas&seed=N`: a tour of arenas 1-5, 5 s each, with a card (name, theme, template, mirror, size, each wave's units) and a shutter wipe between rooms. Then arena 3 is played by the DEMO pilot. The pilot uses keyboard-style input and tile-grid paths; it dodges 2 threats in 3 and smashes pots between waves and after the clear. The hero cannot die in DEMO, and the HUD says so. After the exit it returns to the tour.
  - Params:
    - `&mode=tour|play`;
    - `&room=1..5` holds the tour on one room (stills);
    - `&play=1..5` picks the played arena;
    - `&at=seal`: the hero starts just inside and the gate slams at tick 150 or on `debug.arena('seal')`;
    - `&at=clear`: the waves are cut to one husk;
    - `&auto=0`, `&dur=<s>`, `&zoom=1..3`, `&slow=<s>`;
    - `&hud=0`: the arena's own banners still show.
  - Keys:
    - tour: Left/Right changes room, Space holds, Enter plays this room;
    - play: B demo, R restart, N next room;
    - both: M tour/play, Z zoom, T slow, H hud.
  - `state().showcase = {id, mode, room, hold, auto, t, zoom, arena, hero, pilot}`.
- **Strip recipes** (deterministic):
  - **Door slam**: load `?showcase=arenas&at=seal&play=1&hud=0&zoom=2`. Wait about 800 ms, then run `debug.freeze(true)`, `debug.step(30)` and `debug.arena('seal')`. Step 1-3 ticks between shots. The spikes rise over ticks 3-5 and slam at about 5-6; the title card is at 24.
  - **Clear**: load `?showcase=arenas&at=clear&play=1&hud=0`. Run `debug.freeze(true)` and `debug.step(200)`, then `debug.arena('clear')`, then step. The banner is at +16, the seal shatters at +58, the portcullis moves over +76 to +156, and the state is `open` at +156.

  Stepping skips hitstop and the real-time light pops.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `arenas` row.
- `src/core/placeholders.js` (foundation): the `run` placeholder now builds a real arena for `data.room` (default 0) with the run seed. Changes:
  - it uses the arena's collision, start point, camera bounds, `tickCamera` and enemy manager, and props as combat targets;
  - it draws the arena's banners;
  - `arena:exit` goes to the next room, and after the fifth to `boss`;
  - it registers `debug.goto`.

  `boss` keeps foundation's stage. `run-flow` replaces this scene anyway.
- `src/combat/combat.js` (combat): one condition in `_aimAssist` skips targets with `noAssist`, so keyboard aim assist and the step-in never pull toward a pot.

## Known gaps

- **Still dark between the lights.** Look's 8-light pool limits a room to about 2 sconces, 2 braziers and 3 cold shafts. The floor away from them is dark violet, and enemies there lean on their emissive eyes. More warm light would need a bigger pool or a mood tweak (look's).
- **Side walls are plain.** Seen from above they are only capstones and bricks, with no sconces, niches or banners, because their faces point away from the camera. The front parapet is a simple low wall.
- **Six templates.** Arenas 1-4 each choose from 2-3 templates, and arena 5 always uses one. Across seeds, variation comes from the mirror, the `?` slots and the floor noise, not from new compositions. A second pass should add 2-3 more templates, and per-template optional sub-layouts.
- **The slam is small at game scale.** The spikes are only 13 voxels tall, and the gate sits at the bottom of the view. Most of the punch is shake, sparks and the post runes; the dust wall is modest.
- **Props are small at zoom 1.** Urns and the smaller wrecks read as a few pixels. Broken props leave flat wrecks that are easy to miss.
- **Pillars and blocks occlude.** Anything north of a pillar is hidden behind it; there is no see-through.
- **Tile-style floors are busy.** The ossuary, hall and crossing floors are a regular checker with dark grout, which reads as a grid.
- **The waves have no floor tell of their own.** They rely on each enemy's spawn-in (portals, the brute's landing disc). The straggler rule (9 s) is untuned.
- **Candles and puddles are static.** No flame flicker particles on the candles and no glints on the water.
- **The demo pilot.** It is god-moded, and its paths are coarse (tile BFS with no knowledge of props' exact shapes). It occasionally hugs a pillar for a moment.
- **Sounds are first-pass.** They were checked for console errors only.
- **Performance** was checked headless only: about 7-10 fps, the same as the enemies showcase. A floor model takes about 75 ms to build, so the tour hitches briefly when it changes room.
