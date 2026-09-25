# foundation: builder notes (wave 1)

## What exists

- **Loop** (`src/core/loop.js`): 60 Hz fixed-step sim with an accumulator. Rendering is interpolated through `alpha`. It has a time scale, a pause that freezes the sim completely (no ticks run), real-time hitstop, and `step(n)` for deterministic captures. Long frames are clamped to 100 ms, and at most 6 steps run per frame.
- **Input** (`src/core/input.js`): keyboard, mouse and gamepad (standard mapping, left stick with deadzone, digital stick codes with hysteresis) all go through one rebinding table, `DEFAULT_BINDINGS`, which is persisted to localStorage. Events are queued with timestamps, so a tap shorter than a frame still registers. There are two consumers, sim (per tick) and UI (per frame, which also works while paused). Attack, dash and interact buffer for 7 ticks (117 ms). The buffer counts ticks, so hitstop does not age it. There is mouse-idle detection (2 s) for the "aim along facing" rule, and all keys are released on blur.
- **Scenes** (`src/core/scenes.js`): a state machine. `pause` is layered on top of a pausable scene and freezes the sim. Changes are deferred to safe points. Each scene gets its own `THREE.Group` root.
- **Placeholder scenes** (`src/core/placeholders.js`): title, run, boss, pause, gameover and victory, each labelled as a placeholder on screen. Run and boss have a stand-in hero with `world.hero` wired up, so `state()`, `hurt` and `kill` work. An hp of 0 goes to gameover.
- **Display** (`src/core/display.js`): WebGL at about 360 px internal height, with an integer CSS nearest-neighbour upscale. There is a 2D UI canvas on the same pixel grid. The camera is orthographic with a 50° pitch, PPU 32 (1 world unit = 8 voxels = 32 px at zoom 1), and camera motion snapped to texels. It also has integer zoom, `screenToGround`, `worldToScreen`, a replaceable `pipeline`, and a default light rig.
- **Feedback channel** (`src/core/feedback.js`): shake, directional kick, full-screen flash and hitstop, scaled by the `shake` and `flashes` settings.
- **Settings** (`src/core/settings.js`), **seeded RNG** (`src/core/rng.js`, sfc32 with `fork(label)` streams), **event bus** (`src/core/events.js`), **world snapshot** (`src/core/world.js`).
- **5x7 pixel font** (`src/core/pixelfont.js`), authored in code. It is proportional, with tabular digits, and rendered strings are cached.
- **Voxel models** (`src/render/voxel/`): a text-layer format and a `VoxelGrid` code form, and a greedy mesher with per-vertex AO. It only merges faces whose colour and all 4 AO corners match, and it flips the quad diagonal by AO. Emissive voxels use the `'name!'` form. The shared Lambert material applies AO in 4 ordered-dithered (Bayer 4x4) bands, draws emissive voxels unlit, and has an optional per-mesh flash. Each model is meshed once, cached, and drawn in one draw call per model instance.
- **Test models** (`src/render/voxel/testmodels.js`): `test.shrine`, `test.runner`, `test.ao`, `test.plinth`, `test.plate`, `test.floor`, `test.torch`.
- **Stage** (`src/core/stage.js`): floor, torches with jittering voxel flames, rising embers, and 1 to 2 texel dust motes. Only foundation's own screens use it.
- **Showcase router** (`src/core/showcase.js`) and **`?showcase=foundation`** (`src/core/showcase-foundation.js`).

## APIs

```js
import { loop, DT, Interp, lerp, lerpAngle } from './core/loop.js';
loop.tick; loop.alpha; loop.paused; loop.hitstop(ms); loop.setTimeScale(s); loop.step(n); loop.inHitstop
const p = new Interp({ x: 0, z: 0, yaw: 0 }).angle('yaw');  // tick: p.snap(); mutate p.cur   render: p.at(alpha)

import { input } from './core/input.js';
// sim (inside tick):
input.move() -> {x, z}   // z+ = screen down / toward camera, length <= 1
input.pressed(a); input.released(a); input.held(a); input.buffered(a); input.consume(a); input.bufferAge(a)
// UI (inside frame, works while paused):
input.ui.pressed(a); input.ui.key('KeyG')
input.mouse {x, y, nx, ny, lastMove}; input.mouseActive(); input.device
input.rebind(action, codes); input.resetBindings(); input.describe(action, device?) -> "J / LMB / PAD X"
// actions: up down left right attack dash interact pause confirm cancel

import { scenes } from './core/scenes.js';
scenes.define(name, { pausable, enter(data, root), exit(), tick(), frame(realDt), render(alpha, realDt), ui(g, alpha), state() });
scenes.go(name, data); scenes.pause(); scenes.resume(); scenes.current; scenes.base; scenes.paused

import { display } from './core/display.js';
display.setCameraTarget(x, y, z)   // snapped; call every render frame
display.setZoom(n); display.screenToGround(cssX, cssY, y); display.worldToScreen(x, y, z)
display.pipeline = (renderer, scene, camera) => ...   // `look` installs post here
display.lights {hemi, key, rim}; display.ui (2D ctx, internal res); display.width/height/scale; PPU

import { feedback } from './core/feedback.js';
feedback.shake(px, ms); feedback.kick(dx, dy, px); feedback.flash(color, ms, alpha); feedback.hitstop(ms)

import { rng, Rng } from './core/rng.js';   // rng.fork('arenas').int(1, 6) ... never draw from rng directly
import { events } from './core/events.js';  // on/once/off/emit
import { world } from './core/world.js';    // world.hero / enemies / room / boons for state()
import { settings } from './core/settings.js';
import { drawText, textWidth, wrapText, LINE_H } from './core/pixelfont.js';
import { debug } from './core/debug.js';    // debug.handle('spawn', fn); debug.add('newHook', fn)

import { defineModel, voxelMesh, getModel, VoxelGrid, VOXEL, voxelUniforms, makeVoxelMaterial } from './render/voxel/index.js';
voxelMesh(name, { ownMaterial: true }).material.userData.flash.value = 1;  // per-entity hit flash
```

Events: `scene:enter`, `scene:exit`, `pause`, `input:press {action, device, code, tick, t}`, `input:device`, `tick`, `feedback:shake`, `feedback:flash`.

Wiring rules for later pieces:
- To replace a placeholder scene, call `scenes.define('title' | 'run' | ..., def)` in your module and add one `import` line in `src/main.js` (there is a marked spot for it).
- To enable your showcase, set `load: () => import('../<your dir>/showcase.js')` on your row in `SHOWCASES` in `src/core/showcase.js`. The module's default export is `(params) => sceneDef`.
- `main.js` toggles pause on the `pause` action. A pause menu should call `scenes.resume()` for its own Resume item.
- Palette names in `src/render/palette.js` are stable. `look` may retune the hex values.

## Debug hooks and showcase params

- Contract hooks: `__GR.ready`, `frame`, `scene`, `seed`, `state()`, and `debug.timeScale`, `god`, `spawn`, `goto`, `give`, `hurt`, `kill`. `spawn`, `goto` and `give` return `{ok:false, error}` until a piece registers a handler. `hurt` and `kill` default to acting on `world.hero`.
- Additions: `__GR.paused`, `__GR.fps`, `__GR.renderFrame`, and `debug.pause(on)`, `freeze(on)` (freezes the sim without the pause scene), `step(n)`, `scene(name, data)`, `input(action, down)`, `tap(action, ticks)`, `hitstop(ms)`, `models()`, `overlay(on)`, `handle(name, fn)`, `add(name, fn)`, `handlers()`.
- `state()` also includes `paused`, `tick`, `timeScale`, and any fields the scene's `state()` returns. The foundation showcase returns `showcase: {model, zoom, angle, hop, grounded}`.
- `?debug=1` shows the overlay at the bottom centre. Backquote toggles it in any scene.
- `?showcase=foundation` params: `&model=shrine|runner|ao`, `&zoom=1..4`, `&spin=0`, `&hud=0`. Keys: 1-3 or E switch the model, J hops (buffered), K spins (dash), A/D turn, G toggles the greedy-quad wireframe, Z toggles game scale, T cycles slow-motion (1, 0.5, 0.25, 0.1), H runs the hitstop test, P/Esc pauses, and `.` steps one tick while paused.
- A deterministic buffer test: `debug.freeze(true)`, then `debug.input('attack', true)`, `step(1)`, release, `step(21)`, press again, `step(1)`. The log then shows `BUFFER→HOP +3T`.

## Cross-piece edits

- `src/render/palette.js` (owned by `look`): I created it with the 32-colour named palette, plus `css()` and `hex()`, because the mesher, the font and the overlays needed a palette to exist. `look` may change the hex values but should keep the names.
- `src/style.css` (not owned by any piece): the canvases are no longer forced to 100%. They are now positioned at their integer-scaled size with `image-rendering: pixelated`, and the page background is palette `night`.

## Known gaps

- **Gamepad is untested.** Headless Chromium has no pad. The code follows the standard mapping, but nobody has pressed a real button on it.
- **The latency readout is measured in JS.** It runs from the event timestamp to the frame that drew the response, and does not include compositor or display latency. Screenshot bursts stall rendering and inflate it (I saw up to 73 ms while bursting, and 8 to 27 ms otherwise).
- **No outlines or post-processing.** Those belong to `look`. The default lights are a starting point, and the models read somewhat flat and grey without outlines.
- **AO stops at mesh boundaries.** Nothing darkens where a model meets the floor or plinth, so there are no contact shadows.
- **The input layer has no rebinding UI or conflict detection.** `rebind` accepts any codes, and `title`'s settings screen needs to add both.
- **The foundation showcase does not demonstrate camera texel snapping.** Its camera is static. The run placeholder moves the camera, and `movement` owns the real camera.
- **Pause toggling is hardwired in `main.js`.** A menu that wants Esc to mean "back" inside the pause menu will need to take over that line.
- **The run/boss placeholder hero** is a crude stand-in (constant speed and a flat dash) that exists only so the contract works. `hero`, `movement` and `run-flow` replace it.
