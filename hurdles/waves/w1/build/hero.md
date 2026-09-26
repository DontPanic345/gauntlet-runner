# hero: builder notes (wave 1)

## What exists

- **Voxel rig** (`src/hero/model.js`): the hooded runner is built from rigid voxel parts, each meshed once:
  - legs with boots, a torso (belt, tunic, scarf wrap), and a 7-wide hood with glowing `sky` eyes;
  - a droopy hood tip, two arms, and a short sword in the +x hand;
  - a two-panel navy cloak and a 4-segment scarf tail that lives in world space.

  The hood is about 11 voxels to the top and 13 to the tip. The parts are parented as root > body (squash) > pelvis > torso > head/arms/cloak, with the legs on the pelvis. All parts share one private material, so a hit flash lights the whole body. There are four face variants (`open`, `blink`, `hurt` squint, `dead`), swapped by geometry.
- **Smears**: 4-frame crescent swing arcs as emissive voxel models, with no outline. There is a horizontal set (1 voxel thick) and a vertical set (2 thick). The backhand is the horizontal set mirrored, and the overhead is the vertical set rotated onto the YZ plane.
- **Dash afterimages**: up to 4 flat-colour copies of the body pose that step down `cyan > teal > navy` and vanish. They are depth-offset so the live body always draws over them.
- **Procedural animator** (`src/hero/anim.js`, `HeroAnim`), running on sim ticks and interpolated at render:
  - **idle**: breathing of about 1 texel, weight sway, blinks every 2 to 5 s, and a look-around after about 4 s still;
  - **run**: contact, down, passing and up poses; the phase advances with ground speed; leg lift, arm counter-swing, hip twist and lean; blends to idle by speed;
  - **facing**: turn-rate limited (a 180 degree turn takes about 7 ticks), with a roll into turns and a squash-pivot on reversals while moving;
  - **dash**: stretch along the travel direction, dive lean, afterimages, and a 5-tick skid;
  - **3-hit combo**: slash, backhand and overhead. Each has keyframed anticipation, 4 smear frames on the active ticks, and a recovery with follow-through. The overhead has a crouch, a hop with a two-handed raise, then a squash on impact;
  - **hurt**: white then red flash, a wince face, and a flinch away from the hit direction;
  - **death**: jolt, stagger back, drop to the knees, head down, a forward topple with a bounce, and dead eyes;
  - **spawn-in**: a stretched drop from about 2 units up, a landing squash, a rebound, and a sword twirl.
- **Secondary motion**: springs drive the upper and lower cloak and the hood tip from forward speed, lean and vertical velocity, with a noise flutter. The scarf tail is a verlet chain pinned to the neck knot, pushed by relative wind, kept behind the cloak, and kept above the floor.
- **`?showcase=hero`** (`src/hero/showcase.js`): the hero on the `test.plinth` stage with 4 torches. It shows a big label for the current animation, a key list, and, during attacks, a windup / smear / recover timeline with a playhead. It also has footstep, dash, landing and slam dust puffs; these are showcase-only and driven by the `hero:*` events.
- **Normal play**: foundation's placeholder `run` and `boss` scenes now use this rig and animator. On entry the hero spawns in. J chains the combo, K dashes, `debug.hurt` plays the hurt animation, and `debug.kill` plays the death, then goes to gameover after about 80 ticks.

## APIs

```js
import { createHeroRig, HERO_HEIGHT, SMEAR_FRAMES } from './hero/model.js';
import { HeroAnim, ATTACKS, RUN_SPEED } from './hero/anim.js';

const rig = createHeroRig();          // add rig.group to a root at world origin (scarf and ghosts are world-space)
root.add(rig.group);
const anim = new HeroAnim(rig, { x, z, yaw, floorY: 0 });

// each sim tick: call one-shots FIRST, then anim.tick() on the same tick (a one-shot shows on that tick)
anim.attack(step)      // 0 slash, 1 backhand, 2 overhead. Returns ATTACKS[step]
anim.dash(ticks = 10)  // anim.hurt(fromYaw | null)   anim.die()   anim.spawn()   anim.reset(x, z, yaw)
anim.tick({ x, z, face, vx?, vz?, speed? })   // face = desired yaw (0 = +z). Velocity defaults to the position delta.
// each render frame:
anim.render(alpha)     // poses the rig, texel-snaps the root (look.snap), smear, flash, scarf, ghosts

anim.state   // 'loco' | 'attack' | 'dash' | 'hurt' | 'death' | 'spawn'
anim.busy; anim.canChain; anim.step; anim.dead; anim.info()
ATTACKS[i] = { name, windup, active, recover, total, cancel, smear, mirror, tilt }   // in ticks: combat reads these
rig.flash(colorName, 0..1); rig.setFace('open' | 'blink' | 'hurt' | 'dead')      // the animator already drives both
```

Events go on `core/events.js`. Every payload includes `{ anim, x, z, yaw }`:

- `hero:step {foot, speed}`: a foot hits the ground. Use it for footstep dust and sound.
- `hero:swing {step, attack}`: the first active tick of an attack. The hitbox and whoosh go here.
- `hero:slam`: the overhead lands, 3 ticks after its swing.
- `hero:dash`, `hero:land` (spawn landing), `hero:ready` (spawn finished), `hero:thud` (the body hits the floor on death), and `hero:dead` (the death animation has finished).

## Debug hooks and showcase params

- `__GR.debug.hero(action?, arg?)`: acts on the most recently created `HeroAnim`.
  - Actions: `attack` (arg = step), `dash` (arg = ticks), `hurt` (arg = fromYaw), `die`, `spawn`, `reset`, `scarf` (returns the tail points), and `mode` (showcase only, arg = a mode id or `all`).
  - It returns `anim.info()`: `{anim, state, t, step, yaw, face, runW, phase, smear, dead}`.
- Showcase params:
  - `&anim=all|idle|run|turn|dash|attack|hurt|death|spawn` (default `all` cycles everything, about 24 s);
  - `&zoom=1..4` (default 3);
  - `&yaw=<deg>` (default -25);
  - `&slow=0.5|0.25|0.1`;
  - `&hud=0`.
- Showcase keys:
  - 1-8 pick an animation, and 9 cycles all of them.
  - J attacks (a queued press chains the combo), K dashes, and L hurts, in any mode.
  - Left/Right turn the hero 45 degrees, Z cycles the zoom, T cycles slow motion, H hides the labels, and P/Esc pauses.
- `state().showcase` = `{id, mode, cycle, modeTick, zoom, viewYaw, ...anim.info()}`.
- Deterministic strip recipe: `debug.freeze(true)`, then `debug.hero('mode', 'attack')` (restarts the mode at tick 0), then alternate `debug.step(2)` and a screenshot. The attack starts at mode tick 10. Hurt fires at tick 12, death at tick 12, spawn at tick 0, and the dash at tick 20.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `hero` row.
- `src/core/placeholders.js` (foundation): the run/boss placeholder now uses `createHeroRig` and `HeroAnim` instead of `test.runner`. It spawns on entry, the dash and attack call the animator (the combo chains on `canChain`), a lost hp point plays `hurt`, and 0 hp plays `die` and then goes to gameover after 80 ticks instead of at once. The `movement` and `run-flow` pieces replace this scene anyway.
- `src/hero/showcase.js` is a new file that is not in `hero`'s `owns` list, because the router convention is `<dir>/showcase.js`. I suggest adding it to `owns`.

## Known gaps

- **Rigid parts**: there are no knees or elbows. Legs swing as one block, so the kneel in the death animation is a pelvis drop with the legs thrown forward, and reads more like sitting.
- **Rotated voxels**: parts rotate freely, so a limb at an angle is a rotated cube and shows stair-step edges and sub-texel shimmer. Only the root is texel-snapped.
- **The camera hides a forward lean**: at the 50 degree pitch, leaning forward shows the top of the hood and hides the face. I countered this with head pitch in the attacks. The death is face-down, so the dead eyes are never visible.
- **Dash from the top**: the dash pose still reads as a flat blue slab. The afterimages overlap heavily over a short dash, and one lingers at the end point after the skid.
- **The vertical smear** for the overhead is nearly edge-on when the hero faces the camera.
- **Run sword**: while running, the sword trails almost horizontally from the hand. It is readable, but it looks stiff.
- **No run start/stop poses**, no idle-to-run lean-in, and no landing or recoil pose for a blocked attack. Hurt uses one pose set, scaled by direction.
- **Dust** in the showcase is a stand-in. `vfx` should listen to `hero:*` and replace it. There is no audio.
- **Shared tuning**: `RUN_SPEED` (4.2) and `STRIDE` are tuned to the placeholder movement speed. `movement` should pass the real velocity, or retune `STRIDE` so the feet do not skate.
- **Timing belongs to combat**: `ATTACKS` timings are this piece's proposal. In the placeholder the hero keeps full move speed while attacking, which combat and movement should restrict.
- **Showcase lighting**: the showcase adds two front torches for light, so the hero is better lit there than in the dark arena corners in play.
