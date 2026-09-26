# vfx: builder notes (wave 1)

## What exists

- **Pooled cube-particle core** (`src/vfx/particles.js`): one InstancedMesh (2600 slots, one draw call), structure-of-arrays state, a dense live list with swap-remove, and colour and matrix written straight into the instance buffers. Nothing is allocated per frame or per particle. When the pool is full it recycles slots and never grows.
  - Per particle: position, velocity, drag, gravity, life, a size curve (pop from 45% size, hold, then shrink late with an ease-in), a palette colour ramp that steps by age (early stops are held shorter), and flags (`F_STRETCH` streak along velocity, `F_BOUNCE`, `F_FLAT`, `F_GROUND`, `F_TWINKLE`).
  - Pixel grid: sizes are in screen px at zoom 1 and round to whole pixels at draw time (under half a pixel is skipped). Positions snap to whole screen texels with the same maths as `look.snap`.
  - Interpolated between ticks. Ticks come from the scene, so hitstop and pause freeze it.
  - Unlit palette-colour `MeshBasicMaterial` on the no-outline layer (per look.md).
- **Effects library** (`src/vfx/effects.js`): hit-spark, slash smear, dust puff, dash (kick-off dust, speed lines, floor ring), dash after-image (a flat ghost of any Object3D that steps down a colour ramp and dithers out), death burst, spawn portal, embers (burst or fountain), light flash, shockwave ring, pickup sparkle. Each has a fast bright pop (a white frame, heavy drag) and a slower stepped tail. The portal, the fountain and the after-images run on small fixed emitter pools.
- **2D marks layer** (`src/vfx/marks.js`): things drawn on the UI canvas on the pixel grid, tick-driven, fixed pool. They are the impact star (with a broken ring and spokes), the slash-smear crescent (a head racing ahead of a thinning tail, ink outline), a dithered glow (sparse halo, checkerboard body, solid core, white heart, stepping down), twinkle sprites, and a floor-plane ring. The glow respects the `flashes` setting.
- **Ambient scene layer** (`src/vfx/ambient.js`): embers (rise, sway, cool gold to flame to ember to red, shrink to 1 px, flicker) and dust motes in a box that follows the camera and scales with zoom, so counts mean "on screen". It is analytic in time, so it holds through pause. It has moods: `crypt`, `calm`, `collapse` (many embers blown sideways plus falling grit), `boss` and `off`.
- **`?showcase=vfx`** (`src/vfx/showcase.js`): a looping, labelled reel of 12 entries (hit, smear, dust, dash, death, portal, embers, flash, shockwave, pickup, a 2000-particle stress run, and the ambient moods) on the foundation stage, with a stand-in runner as target or actor. The HUD shows the effect name, a note, reel pips, alive/peak particles, marks, JS ms and fps.

## APIs

```js
import { vfx } from '../vfx/index.js';

// once per scene, in enter(data, root):
vfx.attach(root, { ambient: 'crypt', capacity: 2600 });
// in the scene hooks:
tick()    { vfx.tick(); }        // 60 Hz sim step
render(a) { vfx.render(a); }     // before the GL draw
ui(g)     { vfx.ui(g); }         // after the GL draw (2D marks)
exit()    { vfx.detach(); }

// effects: x, y (up), z are world units
vfx.hit({ x, y, z, dx, dz, power = 1, style = 'hit' | 'hurt' | 'magic' | ..., spread })
vfx.smear({ x, y, z, yaw, radius = 0.95, sweep = 2.3, side = 1 | -1, power })   // yaw = middle of the arc, atan2(dx, dz)
vfx.dust({ x, z, y, dx, dz, n = 9, size = 5, speed = 1 })          // dx,dz: travel direction, so dust trails behind
vfx.dash({ x, z, dx, dz })
vfx.afterImage(object3D, { life = 0.3, ramp = ['white','sky','cyan','teal','navy'] })   // call every 2nd tick of a dash
vfx.death({ x, y, z, power = 1, colors: ['stone', ...palette names] })
vfx.portal({ x, z, radius = 0.9, dur = 0.85, style = 'void' | 'ember' })   // pops at the end
vfx.embers({ x, y, z, n = 14 })   or   vfx.embers({ x, y, z, dur, rate })  // fountain for dur seconds
vfx.flash({ x, y, z, color = 'torch', radius = 2.2, ms = 160, intensity, screen })  // dithered glow + look.flash; screen: true or alpha also does a feedback.flash
vfx.shockwave({ x, z, radius = 3, style = 'ring' | 'ember' | 'dust' })
vfx.pickup({ x, y, z, style = 'gold' | 'magic' | 'hurt' })
vfx.play(name, opts)              // by name: hit smear dust dash death portal embers flash shockwave pickup
vfx.ambient.mood('crypt' | 'collapse' | 'boss' | 'calm' | 'off');  vfx.ambient.set({ embers, dust, grit, wind: [x, z], rise })
vfx.clear(); vfx.stats; vfx.pool  // pool.add(x,y,z, vx,vy,vz, life, s0px, s1px, ramp('white,gold,ember'), flags, drag, grav) for custom recipes
```

- Every effect takes `feel: true` to also fire shake and a screen flash through `feedback`. It is off by default so a caller that already does its own hitstop and shake does not double up.
- `style` is `hit, hurt, magic, void, ember, gold, ice`, or any comma list of palette names (`'white,gold,ember'`).
- Event: `events.emit('vfx:play', { name: 'hit', x, y, z, dx, dz, power })` plays an effect without importing vfx (it does nothing if no scene has attached).
- Calling any effect while nothing is attached returns `false` and does not throw.
- Palette rules: every colour is a name from `palette.js` and goes through `hex()`. There are no free colours.

## Debug hooks and showcase params

- `__GR.debug.vfx(name, x, z, opts)` plays an effect and returns `{ok, stats}`. `__GR.debug.vfxStats()` returns `{alive, peak, capacity, recycled, marks, emitters, ambient, mood, msTick, msRender}`. Both exist only once `src/vfx/index.js` has been imported (the showcase does; other scenes must import vfx to get them). Without an attached scene they return `{ok:false, error}`.
- `?showcase=vfx` params: `&fx=<id|index>` (hit smear dust dash death portal embers flash shockwave pickup stress ambient; stays on it), `&auto=0` (hold on the first), `&zoom=1..3` (default 2), `&slow=<s>`, `&hud=0` (clean stills), `&feel=0` (no shake, screen flash or hitstop), `&mood=<ambient mood>`, `&n=<particles per tick for stress>` (default 40, about 2000 alive).
- Keys: Right/D next, Left/A previous, 1-9 and 0 jump, Q stress, E ambient, Space hold or loop the current effect, R replay, T slow-mo, Z zoom, H HUD, P/Esc pause.
- `__GR.state().showcase` gives `{effect, index, t, hold, zoom, vfx: stats}`.
- Deterministic stills: `debug.freeze(true)`, press R, then `debug.step(n)` and screenshot. The effect's local tick is in `state().showcase.t`.

## Cross-piece edits

- `src/core/showcase.js`: set `load` on the `vfx` row to `() => import('../vfx/showcase.js')`, the one-line wiring the router asks for.

## Known gaps

- **Nothing outside the showcase calls it yet.** Combat still uses its own `src/combat/fx.js` (stars, sparks, debris, damage numbers, hurt vignette). The next step is combat, hero and enemies calling `vfx.hit`, `vfx.smear`, `vfx.death`, `vfx.dust` and `vfx.dash` and dropping their private particles. I did not edit those files.
- **The 60 fps claim is not verified on a GPU.** Headless Chromium renders in software (about 22 fps with no particles, 13 fps at 2500). The measured JS cost of `vfx.tick` plus `render` at 2000 to 2600 live particles is about 0.4 ms. The mesh is one instanced draw call of about 31k triangles.
- **2D marks always draw over everything**, including the hero and any wall between the camera and the effect, because they live on the UI canvas. Glows and rings can cover the target. A depth-aware version would need them as 3D sprites.
- **Rotated streaks are cubes at arbitrary angles**, so diagonal sparks are not strictly pixel-clean lines. They read fine at speed but would be sharper as line-plotted pixels.
- **The ambient layer does not react to the scene.** It does not avoid walls or ceilings, and the collapse wind is a fixed vector. Arenas and gauntlet should set mood and wind, and may want to spawn embers from real torches. The foundation stage still draws its own embers and dust on top of it in the showcase.
- **Smoke and dust are cubes, so they read as blocks.** They are sized and coloured to hide it, but a small dithered sprite puff would look better. Dust tails are low-contrast against the dark floor.
- **After-images copy only the meshes visible at call time** and use a flat colour ramp with a dither-out. There is no per-part colour and no scarf trail. The hero already has its own ghosts in `hero/model.js`, and this is the generic version for enemies and the boss.
- **Light pops depend on `look.lights`.** They are skipped if the light pool is unavailable and never cost more than one `look.flash` per effect.
- **The particle RNG is a private LCG, not `rng.fork`.** Effects are cosmetic, but they will not replay identically from a seed.
- **No audio.** The `audio` piece should hook the same events.
