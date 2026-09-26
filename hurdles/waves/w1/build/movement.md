# movement: builder notes (wave 1)

## What exists

- **Collision** (`src/core/collision.js`): static 2D world on (x, z) with boxes, circles (pillars, posts) and a keep-inside ring (round arenas). Moving bodies are circles.
  - `move()` substeps at half the body radius, so a dash cannot tunnel through a thin wall. After each contact it keeps only the tangent part of the remaining motion, so bodies slide.
  - `resolve()` runs 4 passes, so inner corners settle without jitter.
  - A circle meeting a box corner gets a rounded contact normal, so clipping a corner deflects the body instead of stopping it.
  - It also has `blocked` and `raycast`.
- **Hero controller** (`src/hero/controller.js`, `HeroController`): drives `HeroAnim` and passes it the real velocity.
  - **Acceleration and friction**: exponential approach with a snap for the last 0.35 u/s. Run speed 4.2 u/s.
    - Start: 55% of the gap closed per tick, so 90% of speed on tick 3 and full speed on tick 4. The first tick moves the hero about 1 texel at zoom 1.
    - Stop (release): 50% per tick, at rest on tick 4, sliding about 2 texels.
    - Reversal: 62% per tick.
  - **8-way movement**: facing follows the input. While sliding along a wall, facing follows the actual velocity so the hero never runs "into" the stone.
  - **Dash**: buffered. A press waits 8 ticks for the cooldown to end, and a press during attack windup or active ticks is held until recovery starts.
    - The dash lasts 11 ticks and covers 2.5 units. Its speed profile bursts (about 36 u/s) and eases out to run speed if a direction is held, or skids if not.
    - The first 9 ticks are i-frames, and the cooldown is 18 ticks.
    - The dash cancels attack recovery, slides along walls, and ends early on a head-on wall (`move:bonk`, a small kick).
    - It adds a one-pixel kick through `feedback`. Afterimages come from `HeroAnim.dash`.
  - **Corner assist**: when you push head-on into an edge you nearly cleared (by up to 0.34 units), the body slips sideways round it at up to 0.9x run speed. This is what gets you into a 0.7 gap (the body is 0.6 wide) without pixel-perfect lining up.
  - **Aim vector** for combat: toward the cursor on the ground if the mouse moved in the last 2 s, otherwise along the facing direction.
  - **Attack lock**: movement drops to 12% during windup and active ticks and 45% during recovery, with a small lunge on the first active tick.
  - **Other hooks**: knockback impulse, stun, extra i-frames.
  - **Honest start/stop meter**: counts the ticks from the input change to 90% speed, or to rest.
- **Camera** (`src/render/camera.js`, `CameraRig`):
  - **Look-ahead**: toward the velocity (1.25 units at full speed, plus 0.6 during a dash) and toward the aim. Mouse aim adds up to 1.0 units, scaled by cursor distance; keyboard aim adds 0.35 along the facing direction. The look-ahead swings over about 0.2 s.
  - **Dead-zone**: 0.45 x 0.3 units.
  - **Ease**: a critically damped spring (0.16 s) with no overshoot.
  - **Limits**: a hard leash keeps the hero on screen, and optional room bounds stop the view.
  - **Shake**: comes only from the shared `feedback` channel, which `display.render` applies on top.
  - **Texel snapping**: the view is snapped by `display`. `render()` also returns an offset of up to one texel for the hero's group. That offset rounds the hero *relative to the view*, so the hero does not wobble by a pixel against the screen while the world scrolls in whole texels.
- **`?showcase=movement`** (`src/core/showcase-movement.js`): a 32x20-unit course with brick walls, a low front ledge, and 8 flickering torches. It contains:
  - 5 round slalom pillars;
  - an L-shaped wall (an inner corner, plus a bar end to slide off);
  - a partition with a 0.9 gap and a 0.7 gap;
  - a field of 12 square pillars.

  Other features:
  - **Ghost trail**: one floor dot per tick for 2 s, bigger every 6th tick. Dot spacing shows speed, and the colours show run, dash and attack.
  - **Speed graph** of the last 2 s: sky while dashing with i-frames, cyan for the rest of the dash, rose/plum during attacks.
  - **Readouts**: live START/STOP frame counts, the dash state, a cooldown bar, and SLIDING / CORNER ASSIST / I-FRAMES tags.
  - **Station labels** drawn on the floor.
  - **Overlays**: colliders and the contact normal, and the camera dead-zone with its lead point.
  - **Demo**: by default an autopilot drives the same controller with **8-way (keyboard-style) input only**, through every station, in a loop of about 34 s: start/stop, turns, slalom, dash, inner corner, sliding off a wall end, the 0.7 gap (entered 0.27 off-centre, so the assist shows), dashes round pillar corners, attack then dash-cancel (twice), wall slide into a corner and along the back wall, and a dash through the 0.9 gap. The route is deterministic (fixed-step sim), and no step times out. Any bound key or click switches to LIVE.
- **Normal play** (`?scene=run|boss`, foundation's placeholder): now uses the controller, a ring collider plus the torch posts, and the follow camera.

## APIs

```js
import { CollisionWorld, setCollision, getCollision } from './core/collision.js';
const cw = new CollisionWorld();
cw.addBox(minX, minZ, maxX, maxZ, tag?); cw.addRect(cx, cz, w, d); cw.addCircle(x, z, r); cw.addRing(x, z, R); cw.remove(shape); cw.clear()
cw.move(body /* {x, z, r}, mutated */, dx, dz) -> { hit, nx, nz, normals: [[nx, nz, shape]...], moved }
cw.resolve(body); cw.blocked(x, z, r); cw.raycast(x, z, dx, dz, maxDist, r) -> distance; cw.shapes
setCollision(cw)  // the room's world; the controller falls back to getCollision() when none is passed. Clear it on exit.

import { HeroController, MOVE } from './hero/controller.js';
const ctl = new HeroController({ x, z, yaw, anim /* HeroAnim */, collision?, source? = input, tuning?: {...MOVE overrides} });
// tick: combat first (ctl.attack(step) if it swings), then ctl.tick() (it calls anim.tick for you)
ctl.tick(); ctl.at(alpha) -> {x, z}
ctl.x, z, vx, vz, speed, face, aim {x, z}, aimSource 'mouse'|'facing'|'script', state 'move'|'dash'|'attack'
ctl.invulnerable, dashReady, recovering, sliding, contact, T (live tuning: boons may edit it)
ctl.attack(step) -> ATTACKS[step] | null   // use this, not anim.attack, so the movement lock and dash-cancel apply
ctl.lockAttack({windup, active, recover}); ctl.impulse(vx, vz); ctl.stun(ticks); ctl.iframes(ticks); ctl.teleport(x, z, yaw?)
ctl.source = { move(), consume(action), buffered(action), aim?(ctl) }   // AI or replays

import { CameraRig, CAMERA } from './render/camera.js';
const cam = new CameraRig({ bounds?: {minX, maxX, minZ, maxZ}, ...CAMERA overrides });
cam.reset(x, z); cam.tick(ctl) /* each sim tick */;
const off = cam.render(alpha, ctl.at(alpha)); rig.group.position.set(off.x, off.y, off.z);  // each render frame, after anim.render
```

Events (`core/events.js`). Every payload has `{ctl, x, z}`:
- `move:start`, `move:stop`: leaving and reaching a standstill.
- `move:turn {yaw}`: a sharp reversal while running.
- `move:dash {dx, dz}`, `move:dashEnd {dx, dz}`.
- `move:dashReady`: the cooldown is over.
- `move:bonk {nx, nz}`: the dash hit a wall head-on.

`vfx` and `audio` should listen to these. The dust in the showcase is a stand-in.

`world.hero` in the run placeholder and in the showcase has an `invuln` getter (the dash i-frames) for combat.

## Debug hooks and showcase params

- `__GR.debug.move(action?, a, b)`: acts on the latest controller and returns `ctl.info()`.
  - Actions: `'teleport', x, z` / `'dash'` (queue a press) / `'impulse', vx, vz` / `'tune', {speed: 5}` / `'tuning'`.
  - `ctl.info()` includes `startTicks` and `stopTicks`.
- `__GR.debug.camera(opts?)`: returns the rig's info (`goal`, `lead`, `want`, `target`). opts: any `CAMERA` key, plus `follow` and `relSnap` (bools).
- `?showcase=movement` params:
  - `&auto=0`: start LIVE.
  - `&at=start|turns|slalom|corner|gap|pillars|cancel|slide|dashgap`: start the demo at a station.
  - `&zoom=1..3`: default 2; 1 is game scale.
  - `&slow=0.5|0.25|0.1`.
  - `&colliders=1`, `&cam=1`, `&trail=0`, `&hud=0`.
- Showcase keys:
  - WASD/arrows move, K/Space dash, J attack (the 3-hit combo).
  - B restarts the demo, C shows colliders, V shows the camera overlay, G toggles the trail.
  - Z zoom, T slow-mo, H HUD, P/Esc pause.
- `state().showcase` = `{id, mode, step, label, timeouts, zoom, ...ctl.info(), camera}`. `timeouts` lists route steps that failed to reach their waypoint (it should stay empty).
- Deterministic stills: `debug.freeze(true)`, then `debug.step(N - __GR.frame)`, then screenshot.
  Useful demo ticks: 90 stop, 245 turns, 470 slalom, 592 dash, 822 inner corner, 1300 0.7 gap (assist), 1342 pillar dash, 1490 dash-cancel, 1790 wall slide, 1895 gap dash.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `movement` row.
- `src/core/placeholders.js` (foundation): the run/boss placeholder now uses `HeroController`, a `CollisionWorld` (a ring of radius 4.9 plus the 4 torch posts) and a `CameraRig` instead of its inline movement. A hurt also stuns for 6 ticks. `run-flow` replaces this scene anyway.
- New file `src/core/showcase-movement.js` is not in `movement`'s `owns`. Its three owned files live in three directories, so the `<dir>/showcase.js` convention does not fit. I suggest adding it to `owns`.

## Known gaps

- **The screen feels dark.** The course is lit by 8 torches (the pool limit) across a 32x20 room. Stretches between torches, and the block tops, read murky at zoom 2. The walls and pillars are my own quick brick stand-ins; `arenas` owns the real environment.
- **Tall geometry hides the hero.** Nothing is drawn through walls. With the hero just north of a block or pillar, the block's front face hides the lower body (and the trail). A silhouette pass would fix this, but that is `look` territory.
- **Screen-space speed is uneven.** Movement is isotropic in world units, so because of the 50 degree pitch, moving up or down the screen looks about 23% slower than moving sideways. I have not compensated for it.
- **The corner assist only fires on near head-on pushes** (the input is within about 37 degrees of the wall normal). A diagonal push into a gap entrance slides past the gap rather than into it. That is deliberate, to avoid a magnetic feel, but open to taste.
- **The dash direction is committed.** There is no steering mid-dash and no dash-attack. The afterimages are the hero piece's (4 ghosts on ticks 1/4/7/10). The dash has no sound, and its dust is showcase-only.
- **The camera has no zoom punch or slow-in on big moments**, and its room bounds are simple rectangles. Keyboard aim leads only 0.35 units, so aim lead is mostly a mouse feature.
- **Hero-relative texel rounding covers only the hero.** Enemies still snap to the world grid and can wobble by a pixel against a moving camera. I did not measure the hero's render position frame by frame to confirm it moves monotonically on screen; the claim rests on the maths in `camera.js`.
- **The run scene uses a ring bound only.** Real arena colliders come from `arenas` through `setCollision`.
- **Gamepad aim** (the right stick) is not read. Aim is mouse or facing only.
