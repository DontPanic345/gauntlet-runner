# look: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/look.md`) still describe the post chain, lights, moods
and the older APIs. This file covers what changed in wave 2.

## What exists

- **Impact layer** (`src/render/impact.js`, new). `look.install()` creates it. It runs in every
  scene with no setup, driven only by combat events (`combat:hit`, `combat:kill`,
  `combat:heroHurt`). The sim side runs on the core `tick` event, so it holds through hitstop and pause.
  - **Droplets**: voxel-sized and half-voxel drops thrown along each blow. They arc, land and splat.
    Count and speed scale with `power`. A finisher throws a wider fan.
  - **Stains that stay**: flat floor cells on a half-voxel grid, lit by the scene's lights.
    A fresh cell is wet (`red`) and dries one palette step darker (`blood`) after about 1.5 to 2 s.
    A kill spreads a pool ring by ring under the body. A stain on an already-stained square
    recolours that square, so overlapping stains never z-fight. Capacity is 6144 cells, and when it
    is full the oldest are overwritten. Everything clears on base-scene exit (not on pause).
  - **Chips**: voxel debris in the target's `debris` colours. Chips bounce, skid, snap to a
    45° yaw, and then lie for the rest of the scene, one palette step darker (`CHIP_DIM`).
    Capacity is 260, and new chips replace the oldest.
  - **Stain colours** by target: husk, brute and default `red`/`blood`; Warden `rose`/`plum`;
    mite `teal`/`navy`; wisp `slate`/`dusk`; straw dummy `gold`/`woodLight`; the sparring dummy
    `woodLight`/`wood`; hero `red`/`blood`. A target can override this with `stain: ['wet', 'dry']`.
  - **Contact shadows**: a solid `night` ellipse, with a crisp alpha-tested edge, under
    `world.hero` and every standing target in `world.enemies`. It shrinks with the target's height `y`.
    These are skipped: wisps (they already have their own shadow), invisible, spawning, dead or
    dying enemies, and anything with `noContactShadow`.
  - **Kill frame**: for about 75 ms of real time after a non-mite kill, a disc around the body
    renders in two tones, `white` over `ink`, with a white rim. It is about 38 px across at zoom 1,
    then shrinks to 24 px. It is skipped when `settings.flashes < 0.5`.
  - **Kill shake**: `feedback.shake(2.5, 200)` on a non-mite kill, through the shared,
    settings-scaled channel.
- **Post** (`src/render/post.js`):
  - **`whiteHot`**: a pixel whose linear colour is ≥ 0.985 on every channel skips the shoulder
    and renders as exact `white`. Combat's full hit flash now reads pure white instead of a pale
    bone/white checker.
  - **Kill-frame uniforms** (`impact`, `impactHi`, `impactLo`).
  - `rim` was raised 0.55 → 0.8 and `shadowLift` 0.05 → 0.08 (critic: actors should pop off the
    floor, and far props should not become black holes).
- **Lights** (`src/render/lights.js`):
  - **Flicker** is stronger: a slow breath, a crackle, gusts, and a 2-step "gutter" dip at about
    60% roughly every 2 s per torch.
  - The **pool radius breathes** with the flicker (±~0.35 of the flicker deviation).
  - Point lights have a hotter core and a harder fall-off: `LIGHT_GAIN` 3.2 → 4.6 and
    `LIGHT_DECAY` 1.15 → 1.7 (both exported). Surfaces near a flame climb toward `gold`/`torch`.
  - Measured on the showcase brazier pool, stepping 5 ticks at a time: mean luma ranges 54 to 75,
    against the critic's 45 to 48.
- **`?showcase=look`** (`src/render/showcase.js`) now runs a **real fight** by default, in the
  same lit room:
  - The game's hero rig, controller, `HeroCombat` and `HeroHealth` fight the game's enemies
    (`createEnemies`): husks, a brute, and a mite swarm, kept topped up through their own spawn-ins.
  - It uses the real HUD (`createHud`, with track, shards and boons off) and the real damage numbers.
  - An autopilot drives the hero through the same source interface as a keyboard. It walks to
    the nearest enemy, runs the 3-hit combo, and dashes out every third combo. The fight is kept
    in the lit middle of the room.
  - God mode: the hero takes hits (flash, knockback, red numbers) but never dies.
  - Any move, attack or dash key takes the hero over (LIVE). B hands it back to the autopilot.
  - At zoom > 1 the camera follows the hero. At zoom 1 the slow pan is unchanged.
  - `&fight=0` gives the wave 1 still vignette with look's stand-in hero, skeleton and ooze.
- **Showcase floor** (`src/render/showcase-models.js`):
  - The grout bed is `stone` over `stoneDark`, not near-ink, so with AO it reads one step below
    the slabs.
  - Speckle is cut by about two thirds and kept within one step of the slab.
  - The arena ring is now a dull `dusk` inlay, broken into worn partial arcs.

## APIs

```js
import { look } from '../render/look.js';
look.impact.splat(x, z, { r = 0.3, colors = ['red', 'blood'], delay = 0, grow = 1.5, ragged = 0.35 })
  // a stain blob that stays (wet colour, then dry). Delay and grow are in ticks.
look.impact.spray(x, y, z, dx, dz, { n = 8, speed = 4, colors, spread = 0.7, up = 2.5 })
  // droplets that arc and splat where they land
look.impact.chips(x, y, z, dx, dz, { n = 3, colors: ['stone'], speed = 3, spread = 1.1 })
  // debris that bounces and stays
look.impact.options   // { stains, chips, shadows, killFrame, killShake }: all true. Set false to hand one over.
look.impact.clear(); look.impact.stats(); look.impact.seed(n)   // seed: the layer's own scatter stream (never the game rng)
look.impact.STAINS    // the per-kind colour table
// target fields read (all optional): kind/type, stain: [wet, dry], debris: [...], r, h, y,
//   lastHit.dx/dz, dead, dying, state, group.visible, noContactShadow
```

- **vfx** (this wave's gap: "lasting floor decals (scorch, splatter, debris)") should call
  `look.impact.splat` / `chips` instead of building a second decal system. A scorch is
  `splat(x, z, { r, colors: ['dusk', 'shadow'] })`.
- **enemies**: give a new type a `stain` pair, or add it to `STAINS`. The manager's own
  dissolving `foes.decal` is separate and still works.
- **A piece that adds its own blob shadow** should set `noContactShadow = true` on the target.
- Lights export `LIGHT_GAIN` and `LIGHT_DECAY`.

## Debug hooks and showcase params

- `__GR.debug.look({ impact: { stains: false, chips: false, shadows: false, killFrame: false, killShake: false } })`
  toggles the layer's parts. `debug.look()` now also returns `impactLayer`, which holds the options
  plus `{stains, pending, wet, drops, chips, chipsResting, shadows, shadowAt}`.
- New `postOptions`: `whiteHot` and `impact` (both true). They are settable through `debug.look`.
- `?showcase=look` params:
  - `&fight=0`: the still vignette;
  - `&seed=<n>`: fight scatter.

  Every wave 1 param (`pan`, `t`, `zoom`, `mood`, `hud`, `raw`) still works.
- Keys:
  - WASD/J/K take the hero (LIVE); B returns it to the autopilot.
  - The wave 1 keys (1-6, M, Space, Z, H, P) are unchanged.
- `state().showcase` adds `impact` (the stats) and `fight` = `{live, combos, alive, kills, hero}`.
- In the showcase fight, `debug.spawn(type, x, z)` spawns enemy types.
- Strip recipe: load `/?showcase=look`, wait about 8 s, then burst 12 shots at 133 ms. Add `&zoom=2`
  for the camera-follow close-up. The autopilot is not frame-deterministic in headless capture,
  because it runs at real time.

## Cross-piece edits

None. The showcase imports and calls hero, combat, enemies, hud and vfx through their public
APIs. No file outside `src/render/` (minus `src/render/voxel/`) was changed.

## Known gaps

- **The swing arc itself is not changed.** The headline asked for a bigger, longer swing with
  smear frames. That arc is `hero/model.js` (smear) and `vfx.slash`, and both pieces are rebuilt
  later this wave, so I left it to them. Enemy knockback distance is likewise `combat`/`enemies` tuning.
- **Damage popups** are the hud piece's existing numbers. The look piece adds none.
- **Stain density after a long fight.** After 30 s or more of continuous fighting in the showcase,
  the middle of the floor is heavily stained, and mite stains add blue patches. Whether that
  reads as "the fight marked the room" or as floor noise competing with actors is untested on a
  person. A fade of very old stains toward `stoneDark` would be the next step.
- **The kill frame is real-time (75 ms).** Stepped captures (`debug.step`) see it only by luck,
  and at 7.5 fps it lands in about one frame out of two kills.
- **Stains and contact shadows assume the floor top is at y = 0.** This is true for arenas, the
  showcase and the combat yard. A raised floor (ledges, corridor steps, boss dais) would hide
  them under it, or float them, by up to a voxel. Drops land at y = 0 even over pits.
- **Contact shadows read actors' sim position.** A body whose mesh is drawn away from its `x, z`
  (a lunge, a lying-down death) would get a misplaced shadow. That is why dying enemies get none.
- **The in-play floor is still the arenas piece's.** The critic's grout, speckle and ring fixes are
  applied only to look's showcase floor. `src/world/tiles.js` (arenas, rebuilt later this wave)
  still draws near-ink grout and the bright ring. The north wall crop in play is camera framing
  (`src/render/camera.js`, owned by movement) and is unchanged.
- **The warm light ramp** is brighter near flames, but lit stone still lands partly on
  `dirt`/`wood` browns between `gold` pools, because the palette has no warm grey step (the
  wave 1 palette gap is unchanged).
- **Stand-in props** in the showcase (bone piles, barrels as boxes) are unchanged from wave 1.
- **Performance** is untested on a real GPU. Four instanced meshes were added (6144 + 320 + 260 + 48
  instances). Per frame, the chip and drop matrices are rewritten. Headless capture showed no
  slowdown that I could see, but I did not time it.
