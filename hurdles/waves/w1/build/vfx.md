# vfx: builder notes (wave 1)

## What exists

- **Core** (`src/vfx/core.js`): one shared, fixed-size system with three pools.
  - **Particles**: up to 4096, stored as typed arrays (structure of arrays). Dead particles are swap-removed. Nothing is allocated per frame. They are drawn in one `InstancedMesh` draw call with a custom `ShaderMaterial`. There are three modes:
    - `SPRITE`: a camera-facing square, exactly n x n screen texels;
    - `CUBE`: a voxel cube with a lit top in the ramp colour and sides one palette step darker (`SHADE` map);
    - `STREAK`: a camera-facing line stretched along the particle's screen velocity.
  - **Shapes**: up to 256, in one instanced quad draw. A fragment shader draws them at internal resolution, with the local coordinate quantised to the shape's texel grid, so edges are hard pixel steps. The types are `RING`, `DISC` (optional ink rim), `STAR` (4-point flare with diagonals and a 1-texel ink outline), `ARC` (slash crescent: the head sweeps in, then the tail is eaten), and `PORTAL` (dashed spinning rim, swirl over an ink hole). A shape lies flat on the floor (with yaw) or faces the camera.
  - **Ghosts**: 24 afterimage slots. Each is a flat-coloured copy of the visible, outlined meshes of any posed `Object3D`, reusing their geometry. Ghost meshes are created lazily and reused after that.
- **Look rules built in**:
  - Colours come only from palette names. Ramps are stepped lists of palette colours, never blends.
  - Every particle and shape centre snaps to the screen texel grid (odd viewport sizes are handled). Sizes round to whole texels at the current zoom.
  - Fades are an ordered-dither dissolve anchored to the world (`voxelUniforms.ditherOrigin`, the same origin as look's dither). There is no alpha blending.
  - Everything is on `LAYER_NO_OUTLINE` with no shadow.
  - Particles carry a small depth bias toward the camera, so a spark at a contact point draws over the body it came from. Facing shapes carry a larger bias; floor shapes carry almost none.
- **Timing model** per particle:
  - `pop`: a size multiplier for the first 2 ticks, which gives the fast pop;
  - `shrinkAt`: after this life fraction, the size steps down in whole texels;
  - `fadeIn` and `fadeAt`: the dither dissolve in and out.

  It also has drag, gravity, a floor bounce that comes to rest, a start delay, and wobble. Shapes have per-type choreography: a stepped pop-and-shrink for star and disc, an eased expand and thin-out for the ring, a back-eased open, spin and collapse for the portal.
- **Scheduling**: `later(ticks, fn, args)` uses a fixed ring of 128 slots, so a multi-beat effect (flash, then ring 3 ticks later, then souls 8 ticks later) holds and pauses with the sim.
- **Effects library** (`src/vfx/effects.js`):
  - `hitSpark`: a white core, then an ink-outlined star, a ring, streaks fanned along the blow, back-spray, bouncing chips, and a light pop.
  - `slash`: an arc smear plus flecks off the leading edge.
  - `dust`, `step`, `land`: voxel dust.
  - `dash`: kick-off dust, a floor ring, speed lines, and optional afterimages. `afterimage` stamps one.
  - `death`: a white disc, then a star, a light, voxel chunks in the body's colours that bounce and settle, streaks, a floor ring and dust 3 ticks later, and soul wisps 8 ticks later.
  - `spawnPortal`: open, spin, rising motes, then collapse into a flare, a spark pillar, a ring and dust. It returns `popTick`.
  - `embers`, `flash`, `shockwave`, `sparkle` (pickup), `twinkle`, `heal`.
- **Ambient layer** (`src/vfx/ambient.js`): dust motes that dither in and out and drift, embers from sources, voxel fire (`fires`), floor embers, and falling grit. Presets are `crypt`, `collapse` and `boss`. The layer stops itself when the scene exits.
- **`?showcase=vfx`** (`src/vfx/showcase.js`): a looping, labelled reel of 12 entries in a lit crypt corner, using the real hero rig and animator plus look's skeleton stand-in: hit, slash, dust, dash, death, spawn, embers, flash, shock, pickup, ambient, stress. The stress entry keeps about 2400 particles alive and shows the particle count, JS sim and upload ms, and average and minimum fps.
- **Normal play**: the run/boss placeholder calls `vfx.bind(['move', 'kill'])`, which gives footstep scuffs, dash dust and speed lines, bonk puffs, and landing and thud rings. It also covers death bursts on `combat:kill` and `combat:heroDeath`.

## APIs

```js
import { vfx } from '../vfx/vfx.js';
// positions are world units (y up); sizes inside effects are px at zoom 1 (1 unit = 32 px, 1 voxel = 4 px)
vfx.hitSpark(x, y, z, { dx, dz, power = 1, palette: 'hit'|'hurt'|'cool'|'rose'|'ember', light = true })
vfx.slash(x, y, z, yaw, { span = 2.4, radius = 1.2, thick = 0.38, palette: 'blade'|'enemy'|'ember'|'cool'|'rose', mirror = 1|-1, life = 0.2, sparks = true })
vfx.dust(x, z, { dx, dz, n = 6, size = 1, y, palette: 'dust'|'dustDark'|'dustWarm', spread })
vfx.step(x, z, { dx, dz })            vfx.land(x, z, { size })
vfx.dash(x, z, dx, dz, { obj?, ticks = 10, every = 4, palette: 'ghost'|'ghostRed'|'ghostGold' })
vfx.afterimage(obj3d, { palette = 'ghost', life = 0.24 })
vfx.death(x, y, z, { colors: ['bone', ...palette names], power = 1, soul = true, ring = 'mist' })
vfx.spawnPortal(x, z, { dur = 1.1, radius = 0.85, palette: 'rose'|'ember'|'cool' }) -> { ticks, popTick }  // show the enemy on popTick
vfx.embers(x, y, z, { n = 14, spread, up, palette })
vfx.flash(x, y, z, { color = 'torch', size = 1, light = true })
vfx.shockwave(x, z, { radius = 2, color = 'fog', hot = 'white', dust = true })
vfx.sparkle(x, y, z, { palette = 'gold', color = 'gold' })   vfx.twinkle(x, y, z, { color, size })   vfx.heal(x, y, z)

const amb = vfx.ambient({ preset: 'crypt'|'collapse'|'boss', box: [x0, x1, y0, y1, z0, z1], sources: [[x, y, z]], fires: [[x, y, z, size]], dust, embers, floorEmbers, grit })
amb.set({ ... }); amb.stop(); amb.alive

const unbind = vfx.bind(['move', 'combat', 'kill'])   // standard effects from events; auto-unbinds on scene exit
vfx.seed(n)            // reseed the vfx random stream (identical replays; never touches the game rng)
vfx.later(ticks, fn, args)   vfx.clear()   vfx.stats()   vfx.count

// low level, still pooled and on palette:
const i = vfx.core.add(x, y, z, vx, vy, vz, lifeSec, sizePx, rampName, vfx.core.SPRITE|CUBE|STREAK);
vfx.core.P.grav[i] = 20; P.drag[i] = 0.9; P.bounce[i] = 0.4; P.stretch[i] = 0.05; P.pop / fadeAt / shrinkAt / delay / wob ...
vfx.core.addShape(type, orient, x, y, z, lifeSec, col, col2, a, b, c, d)   // see shapeFrame() in core.js
vfx.core.ramp('myRamp', [['white', 0.1], ['sky', 0.5], ['teal', 1]])     // 'base/shade' sets a cube's side colour
```

- **Bind groups**:
  - `move`: `move:dash`, `move:bonk`, `hero:step`, `hero:land`, `hero:thud`.
  - `combat`: `combat:hit` (sparks, plus chips from `target.debris`), `hero:slam` (shockwave), `combat:heroHurt`, `combat:dodge`. This is meant to replace the 3D particles in `combat/fx.js`.
  - `kill`: `combat:kill`, `combat:heroDeath`.
- **For combat to switch over**: call `vfx.bind(['combat'])` and stop `fx.js` making `sparks`, `debris` and `ring`. Its 2D marks, numbers and vignette can stay, or move to `hud`. I did not make that edit, so the two sets would currently double up if both were on. `hitSpark` has `light: false` in the binding, because combat already calls `look.flash`.
- **Hero afterimages**: `hero/model.js` has its own dash ghosts. `vfx.afterimage(rig.group)` can replace them (it skips the rig's non-outlined smear and ghost meshes). The showcase hides the hero's own ghosts and uses the vfx ones.
- **Events emitted**: `vfx:clear` (everything cleared; layers and bindings stop).
- **Lifecycle**: the system ticks on the core `tick` event and is drawn by `vfx.render(alpha)` from `main.js`. It clears when the base scene exits (not on pause). Callers never dispose anything.

## Debug hooks and showcase params

- `__GR.debug.vfx(action?, ...)`:
  - no action returns `{particles, cap, shapes, shapeCap, spawned, dropped, peak, tickMs, renderMs}`;
  - `'play', name, x, y, z, opts` triggers any effect (`opts.yaw` for slash, `opts.dx`/`dz` for dash);
  - `'list'`, `'clear'`, `'seed', n`.
- `?showcase=vfx` params:
  - `&fx=hit|slash|dust|dash|death|spawn|embers|flash|shock|pickup|ambient|stress` starts on that entry and holds it;
  - `&loop=0` auto-advances instead of holding;
  - `&zoom=1..3` (default 2);
  - `&slow=<s>`;
  - `&ambient=0`;
  - `&hud=0`;
  - `&stress=<n>` (default 2400).
- Keys:
  - Left/Right or A/D: previous or next effect; 1-9, 0, `-`, `=` jump to one;
  - Space or J: replay; L: hold or auto-advance; B: ambient on/off;
  - Z: zoom; T: slow-mo; H: HUD; P/Esc: pause.
- `state().showcase` = `{id, effect, index, t, dur, hold, zoom, ambient, particles, shapes, dropped, tickMs, renderMs, fps, effects}`.
- **Every entry reseeds the vfx stream**, so replays are identical.
- **Frame-strip recipe**:
  1. Load `?showcase=vfx&fx=<id>&hud=0` and wait for it to start.
  2. Run `debug.freeze(true)`, then press Space (the replay restarts the entry at t = 0).
  3. Run `debug.step(N)`, then alternate `debug.step(2)` with a screenshot.

  Useful N:
  - hit: 26 (the spark lands at about 27);
  - slash: 12;
  - dash: 19;
  - death: 60 (the burst lands at about 67);
  - spawn: 15, every 9;
  - shock: 34 (slam), then 95 (boss stomp);
  - pickup: 84.

  Stepping skips hitstop and real-time light pops (`look.flash` is timed in ms), so still frames show less light than live play.

## Cross-piece edits

- `src/main.js` (foundation): one import, and `vfx.render(alpha)` after `scenes.render`. There is no per-frame render event to hook.
- `src/core/showcase.js` (foundation): set `load` on the `vfx` row.
- `src/core/placeholders.js` (foundation): one import, and `vfx.bind(['move', 'kill'])` in the run/boss placeholder's `enter`, so normal play shows movement dust and death bursts.

## Known gaps

- **60 fps at 2000 particles is not verified.** Headless software GL runs this page at 12-16 fps with or without particles, so the particles are not the bottleneck there. With about 2500 particles alive, the JS cost is about 0.3 ms of sim plus 0.3 ms of buffer writes per frame. Nothing has been timed on a real GPU.
- **Combat has not switched over.** `combat/fx.js` still makes its own sparks, debris and slam ring, and the hero still makes its own dash ghosts. The `combat` bind group and `afterimage` are ready, but I did not edit those pieces.
- **Dash afterimages overlap.** Stamps every 4 ticks at dash speed overlap into a cyan smear rather than distinct silhouettes. Distinct ghosts would need a sparser stamp or a darker step per ghost.
- **Some effects are small at game scale.** The footstep dust and the ember bursts are small at zoom 1 and easy to miss on the dark floor. The showcase runs at zoom 2.
- **Light pops cannot be seen in stepped captures.** `look.flash` is timed in real ms.
- **Arcs are floor-parallel only.** There is no vertical or tilted arc for overhead chops.
- **The portal's interior is mostly ink.** Its swirl bands read at zoom 2, but at zoom 1 it may look like a dark hole with a pink rim.
- **Fire is particles, not shapes.** The brazier fire in the showcase comes from the ambient `fires` option. It reads as a lumpy heap of hot cubes rather than distinct flame tongues.
- **The shape shader branches on type.** It is not profiled with many large shapes at once. The pool is capped at 256, and extra shapes are dropped and counted in `dropped`.
- **The stress fountain spawns at the origin.** It shows the pool at capacity, not many effects spread across a room.
