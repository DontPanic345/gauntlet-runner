# arenas: builder notes (wave 1)

## What exists

- **Five hand-authored room templates** (`src/world/arena.js`, `TEMPLATES`): The Vestibule, The Ossuary, The Pillared Hall, The Collapsed Gallery (chasm, breach in the wall, fallen column), The Warden's Antechamber (statues with ember eyes, blood ring, red rug). Each has its own floor pattern, wall style (brick / ossuary niches / ruin breach / carved frieze), door positions, focal props, banners, sconces and spawn pads.
- **Seeded variation** (`generateLayout(seed, index)`): mirroring left/right, prop jitter, chance-based dressing slots, banner colours. Pure data: same seed and index give the same room and the same wave plan. Template is `index % 5`.
- **Tiles** (`src/world/tiles.js`): the floor (slabs, rug, inlays, spawn-pad runes, blood, cracks, pebbles, moss, chasm holes, ragged front edge over the pit), back wall with two arches, side walls, portcullis gate, stone slab door, rune overlays, flame frames, trail tiles.
- **Props** (`src/world/props.js`): pillar, ruined pillar, statue, sarcophagus, altar, fallen column, brazier, barrel, crate, urn, bones, candles, rubble, banner, web. Solids feed collision. Hittable props are combat targets and react: stone clangs, sheds dust and chips; braziers flare and spray embers; barrels take two hits (first cracks, second breaks); crates, urns, bones, candles break into bouncing chunks and leave a decal. Banners sway and swing when the room is shaken.
- **Doors**: the entry gate drops when the hero steps in (shudder, falling grit, drop, slam with shake, hitstop, dust, sparks, shockwave, light pop, props nudged, bounce). The exit is a stone slab with a breathing ember rune. On clear the rune goes gold then cyan, floor runes light in sequence toward the door, the slab grinds up into the wall with dust and rumble, and a cyan light spills out.
- **Waves** (`src/world/waves.js`): five tiers of escalation (husks; +mites; +wisps, 3 waves; +brute; 4 waves with two brutes). Budget-based composition, seeded. The `WaveDirector` spawns through the enemies API, pauses between waves, skips ahead on a straggler.
- **Clear moment**: hitstop, slow-mo, screen flash, gold shockwave, pickup sparkle, "ROOM CLEARED" banner, then the door sequence above. Room name card on entering, "WAVE n / N" banner per wave.
- **Sound**: synthesised stand-ins in `arena.js` (`arenaSfx.enabled = false` mutes) on the events below.
- **Lighting**: sconce, brazier, two wall-wash and one fill light per room (uses the look torch pool; 8 max).

## APIs

```js
import { generateLayout, Arena, TEMPLATES, arenaSfx, currentArena } from './world/arena.js';
import { planWaves, describePlan, WaveDirector } from './world/waves.js';

const layout = generateLayout(seed, index);
const arena = new Arena(root, layout, { origin: {x, z}, cw?, title?: true, banners?: true, lights?: true });
arena.bind({ hero, sys });   // hero: x, z, dead. sys: createEnemySystem(...). Sets sys.bounds/collision. Makes the wave director.
// tick: arena.tick();  render: arena.render(alpha);  ui: arena.ui(g);  exit: arena.dispose();
arena.cw                     // CollisionWorld of the room: pass to HeroController (ctl.collision = arena.cw) and setCollision()
arena.entryPoint / exitPoint / center / bounds   // world coords; hero starts at entryPoint facing yaw 0
arena.targets()              // hittable props: HeroCombat targets: () => [...world.enemies, ...arena.targets()]
arena.state                  // ready | sealing | fight | clearing | clear | exited
arena.forceClear(); arena.seal(); arena.info(); arena.plan
```
Props set `noAssist = true` (see cross-piece edits) so they never pull the hero's aim.

Events: `arena:enter`, `arena:seal`, `arena:slam {x,z}`, `arena:wave {n,total,count}`, `arena:wavesDone`, `arena:clear {x,z}`, `arena:slabRise`, `arena:exitOpen`, `arena:exit {index}` (hero walked into the open exit: run-flow should move on), `arena:propHit`, `arena:propBreak`. `world.room` is kept in sync.

Run-flow must: create the enemy system with `list: world.enemies`, call `vfx.attach`, tick/render/ui both, and use the arena's `cw`.

## Debug hooks and showcase params

- `__GR.debug.arena()` room info; `('layout', seed, index)` layout data without building; `('seal')`, `('clear')`, `('wave', n)`, `('targets')`. `__GR.debug.plan(seed, index)` wave plan. `debug.goto(i)` (0..4) and `debug.spawn` work in the showcase.
- `?showcase=arenas&seed=N`: fly-through of rooms 1 to 5 with name cards, then a bot plays one room (default room 2: `&play=N`), smashing props between waves, clearing, and leaving. Params: `&arena=N` (skip to playing room N), `&fly=1`, `&bot=0` (you play; any key takes over), `&t=<s>`, `&zoom=1..3`, `&slow=<s>`, `&hud=0`.
- Keys: 1-5 room, F fly, C clear now, R restart, V kill all, B bot, H hud, Z zoom, T slow, WASD/J/K play. `state().showcase` has mode, room info, rooms list.

## Cross-piece edits

- `src/core/showcase.js`: set `load` for `arenas`.
- `src/combat/combat.js`: `_aimAssist` skips targets with `noAssist` (one line), so props are hittable but do not steer the swing.

## Known gaps

- `?scene=run` is still foundation's placeholder; arenas are not wired into normal play until run-flow uses `Arena`.
- Overall value range is dark (the look palette); floors read as one violet mass at 1x apart from the lit top third. Lower half of rooms has few warm accents.
- Enemies do not path around pillars (enemies piece gap); pillar-heavy rooms make them slide.
- The bot in the showcase is simple and can take damage; it revives on death.
- Light pool of 8 means lights can pop as the camera moves in rooms with many fires.
- Chasm collision is circles along the hole, not exact. No corridor/boss room layouts.
- Screen-shake and slam were verified in stills only for the flash and dust; timing was not measured on real hardware.
