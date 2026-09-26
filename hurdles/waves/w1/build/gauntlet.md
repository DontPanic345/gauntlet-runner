# gauntlet: builder notes (wave 1)

## What exists

- **Corridor** (`src/world/corridor.js`): a 50 to 55 unit run along +x, 5 units deep, built from the arenas' tile builders (floor, brick back wall with two arches, side walls, sconces). The entry arch is a lowered portcullis (sealed behind you); the exit arch is open and lit ember, then cyan on release. Collision: back wall, end walls, front edge. `generateCorridor(seed, index)` is pure data: same seed and index give the same corridor. Index 0 to 3 is the corridor's place in a run: cycles get 6% shorter per index; index 0 has spikes, axes and fire vents; 1 to 3 add the crumbling bridge. Section order is seeded (index 0 always opens on spikes).
- **Collapse** (`src/world/collapse.js`): a heap of boulders with glowing ember seams and a lumpy leading edge, a long dark tail behind it (the corridor already buried), about 150 falling rocks (one InstancedMesh, they land on the heap and bounce on the floor ahead of it), dust rolling off the front, embers dragged forward in the draught, chips thrown ahead, an ember light and a flame light on the floor in front, a steady screen tremor that grows as it closes in, a surge of embers when it is near. Kills on contact. Anything it passes (traps, beam posts, bridge tiles) is buried: hidden, silent, harmless.
  - **Tension curve** (`TUNING` in collapse.js, editable live): base speed 3.1 u/s rising 25% over the corridor. It multiplies by how near you are: 1.0 at a gap of 7.5 units, +0.1 per unit closer, easing down to 0.75x when you are 15 or more units ahead. Standing nearly still with it close makes it lunge (x1.18). Speed is capped at 4.3 u/s, just over run speed (4.2), so a stall is punished but a clean run is not.
- **Traps** (`src/world/traps.js`), each with the same three phases (safe, warn about 0.6 s, live) and a distinct read for each:
  - `SpikeStrip`: floor grating. Warn: the holes glow ember and the spike tips flicker and rattle. Live: the spikes slam up (stepped extension), dust and sparks.
  - `Blades`: a wide axe head on a rod, hung from a beam over a lane band. Real pendulum: it hurts only while its edge is near the floor and near the hero in x. The floor shows its sweep as a dashed rail and lane edges; gold when it is about to come down, red hatch while low. Pairs of axes sit in the two lanes a quarter cycle apart, so one lane is always open.
  - `FireJet`: floor vent in rows of three (side, middle, side), alternating. Warn: glowing grate, a small flame, sparks and a rising ember light. Live: a tall flame column with a light and ember spray.
  - `CrumbleTile`: a bridge of tiles over a pit. Tiles with a cyan rune are sturdy; tiles with an ember crack are fragile and drop 14 ticks after you step on them (shake, dust, chips, then they fall away). A tile you did not step on still goes when the collapse reaches it. Falling costs 1 hp and puts you back at the pit's near edge. A dash carries you over gaps (it counts as airborne).
- **Timing overlay** (`T`): a bar per trap of one full cycle (slate = safe, gold = warning, red = hurts) with a white playhead, a label, X/O marks on the tiles (fragile/sturdy) and the collapse's speed, multiplier and gap.
- **Beats**: "RUN!" banner and about 0.75 s of tremor before the wall starts (`gauntlet:go`, screen shake, low horn). Crossing the threshold drops a thick stone gate behind you (shake, 70 ms hitstop, white flash, dust, sparks, light pop, bounce, `gauntlet:slam`); the collapse runs into it and crashes (`gauntlet:collapseSlam`, big shake, ember flash, debris). Then the release: the rumble fades over about 2.5 s, the mood returns to `crypt`, the exit arch turns cyan with sparkles, "ESCAPED" with the time and the closest the wall got. Walking into the arch fires `gauntlet:exit`.
- **Dodge reward**: if a dash i-frame beats a live trap: a 45 ms hitstop, a cyan sparkle on the hero, and a `gauntlet:dodge` event (counted).
- **Run meter** at the top of the screen: section colours, the wall filling red from the left, the hero pip, the exit tick.
- **Sound**: synthesised stand-ins in `corridor.js` (`gauntletSfx.enabled = false` mutes): a looping rumble bed driven by proximity (`chase.level`), trap warn and live sounds attenuated by distance, whoosh, tile crumble, fall, hit, dodge, horn, gate slam, crash, release chime.

## APIs

```js
import { generateCorridor, Corridor, currentCorridor, gauntletSfx, SECTION_NAMES } from './world/corridor.js';
import { Collapse, chase, TUNING } from './world/collapse.js';
import { SpikeStrip, Blades, FireJet, CrumbleTile } from './world/traps.js';

const layout = generateCorridor(seed, index);       // {W, D, name, sections, traps, pit, order, triggerX, gateX, exitX, startX, ...}
const cor = new Corridor(root, layout, { overlay?: false, lights?: true });
ctl.collision = cor.cw; setCollision(cor.cw);       // the corridor's collision world
ctl.teleport(cor.entryPoint.x, cor.entryPoint.z, Math.PI / 2);   // yaw pi/2 faces +x; the run goes left to right
cor.bind({ hero });                                 // hero: a HeroHealth (x, z, ctl, hurt(), dead). Starts the "ready" beat.
cam.bounds = cor.cameraBounds; cam.follow = true;   // CameraRig limits that keep the ends off screen
// each sim tick AFTER combat/hero:  cor.tick();   each render: cor.render(alpha);   each ui: cor.ui(g);   exit: cor.dispose()
cor.state       // 'ready' | 'chase' | 'escape' | 'escaped' | 'exited' | 'failed'
cor.info()      // JSON snapshot; also in world.room = {index, kind:'corridor', id:'gauntlet', name, state, gap, front, progress}
cor.overlay     // boolean; the timing overlay
cor.jump(x)     // skip ahead with the chase running (showcase / tests)
chase           // {level 0..1, gap, speed, active}: read it for music and audio
```

Traps and the collapse run entirely on the corridor's tick count; the hero is only read (x, z, `ctl.state`, `ctl.speed`) and hurt through `hero.hurt(1, source)`, so dash i-frames and post-hurt i-frames from `combat` apply. Contact with the wall is `hero.hurt(99, ..., {force: true})`.

Events (all on `core/events.js`):

| event | payload | when |
|---|---|---|
| `gauntlet:enter` | `{index}` | built |
| `gauntlet:go` | `{index}` | the wall starts to move |
| `gauntlet:collapseStart` | `{x}` | same moment, for sound |
| `gauntlet:trap` | `{kind, phase: 'warn'\|'live'\|'safe', x, z}` | a trap changes phase (`kind` is spikes, blades, jet or tile) |
| `gauntlet:whoosh` | `{x, z}` | an axe comes down |
| `gauntlet:trapHit` | `{kind, x, z}` | a trap hurt the hero |
| `gauntlet:dodge` | `{kind, x, z}` | a dash beat a live trap |
| `gauntlet:fall` | `{x, z}` | fell through the bridge |
| `gauntlet:catch` | `{x, z}` | the wall reached the hero |
| `gauntlet:escape` | `{index}` | threshold crossed, gate falling |
| `gauntlet:slam` | `{x}` | the gate lands |
| `gauntlet:collapseSlam` | `{x}` | the wall hits the gate |
| `gauntlet:release` | `{time, minGap, index}` | the release beat |
| `gauntlet:exit` | `{index}` | walk-through; run-flow should move on |
| `gauntlet:fail` | `{index}` | the hero died here |

Run-flow should: pick `generateCorridor(seed, corridorNumber)` between arenas, call `vfx.attach(root, {ambient: 'collapse'})`, tick/render/ui the corridor, move on at `gauntlet:exit`, go to game over at `gauntlet:fail`. `dispose()` puts the look mood and ambient back to `crypt`.

## Debug hooks and showcase params

- `__GR.debug.gauntlet(action, a, b)`: `'info'` (default), `'layout'`, `'teleport', x, z`, `'front', x` (move the wall), `'overlay', true|false`, `'escape'`, `'tune', key, value` (edit `TUNING`; no args lists it), `'jump', x` (hero to x with the chase running and the wall 7 behind). `debug.goto(0..3)` rebuilds corridor N in the showcase. `debug.spawn` says there are no enemies.
- `?showcase=gauntlet&seed=N` (default seed 3, index 1): a bot runs one corridor from the start to the exit, then the reel restarts (or restarts after a death). The bot reads the trap timings by simulating a second and a quarter ahead in six lanes and picks the lane that stays safe, waits, or dashes when the wall is close. It is not perfect: it takes about one hit per corridor and sometimes gambles, and it never falls in the pit.
  - `&index=0..3` which corridor of the run (default 1). `&at=spikes|blades|jets|pit|end` starts the chase in front of that section. `&overlay=1` starts with the overlay on. `&bot=0` you play (WASD, J attack, K or Space dash); any key takes over from the bot. `&skill=0..1` bot care (default 0.8). `&zoom=1..3`, `&slow=0.5`, `&hud=0`.
- Keys: `T` timing overlay, `R` restart, `N` next corridor, `1`-`4` pick a corridor, `B` bot on/off, `Q` slow-mo (S is move-down), `Z` zoom, `H` hud, `P`/Esc pause.
- `state().showcase` has the corridor's `info()`, the bot's current plan, and a `results` list of completed runs (time, closest gap).
- For deterministic stills: `debug.freeze(true)`, `debug.gauntlet('jump', x)`, then `debug.step(N)`.

## Cross-piece edits

- `src/core/showcase.js`: set `load` on the `gauntlet` row.

No other files outside the owned four were touched.

## Known gaps

- **The screen is dark.** The corridor is lit by sconces, wall washes, the wall's ember light and trap lights inside the shared pool of 8 point lights; floors read as brown-violet mass with the trap art carrying the contrast. Some `look` retuning of the `collapse` mood would help; I did not touch it.
- **The collapse's body is noisy.** Its leading edge (glowing seams, dust, embers) reads well; the heap behind it and the tail are dark voxel noise with red flecks. There is no ceiling: nothing falls from an overhead structure, rocks appear from above the screen edge. No dust curtain or screen-space darkening as it closes in.
- **Nothing hurts from the collapse except contact.** The falling rocks ahead of the wall are decoration and do not damage or telegraph on the floor.
- **Axes are blunt.** The axe head is a wide slab (a whole lane); at zoom 1 it reads, at zoom 2 it looks like a block. The rods are drawn from a beam that floats over the corridor with no ceiling around it, and the front posts hide the hero when she stands behind them. The sweep decal is loud.
- **Spikes read as stripes** from this camera angle; the warn glow does the work.
- **No enemies in corridors**, no pickups, no boons; the hero's attack does nothing here (it is not connected to traps).
- **Bridge fall is a teleport**, not a fall animation: 1 hp and back to the near edge. There is no checkpoint inside the corridor.
- **Tuning is by bot only.** Careful bot runs across 7 seeds and all four indices end with a closest gap of 1.8 to 5.8 units and 0 to 3 hits; no human playtest. The wall's speed cap (4.3) sits just over run speed, so a corridor cannot be outrun once you are within about 4 units, only recovered by dashing.
- **Sound is synthesised stand-ins**; the rumble bed and effects have not been listened to on real hardware, and the audio piece will replace them.
- **The corridor is not wired into `?scene=run`.** It is the run-flow piece's job; nothing here spawns from normal play yet.
- **Boss/other zones**: only one look (the crypt brick). No variants of wall or floor per corridor index.
