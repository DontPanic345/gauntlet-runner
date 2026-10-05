# hero: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/hero.md`) still describe the animator's structure and
most APIs. This file covers what changed in wave 2.

## What exists

- **New silhouette and palette** (`src/hero/model.js`). The hero is 12 voxels to the crown:
  legs 3, torso 3, mantle 1, hood 5. The head is big on purpose.
  - **Hood**: 7 wide, 5 tall and 5 deep, in `rose` with `plum` shadow rows. Its neck row is one voxel
    narrower on each side. The face is an `ink` opening with `sky` eyes. A two-piece hood point
    (`hoodTip`, `hoodTip2`) flops back from the crown, and each piece is on its own spring.
  - **Mantle** (new part `hero.mantle`): a `rose` capelet over the shoulders, with `plum` shoulder caps.
    The `cyan`/`teal` scarf wraps the throat, closed by a `gold` clasp.
  - **Cape**: three hinged panels (`capeA`, `capeB`, `capeC`). It is 6 voxels long and flares from
    6 to 7 wide. It is `red` with a `blood` tattered hem, one step darker than the hood, so the head
    separates from the body in back views.
  - **Body**: a `navy`/`blue` tunic under the cape, a `wood` belt and `gold` buckle, `slate`
    trousers, pale `fog` shin wraps (so the stride reads on a dark floor), and `wood` boots.
  - **Scarf tail**: `cyan` with a `teal` end. It is knotted at the side of the neck (off-hand,
    -x), and a side draught at rest lets it hang beside the body, so it shows in the default 3/4 view.
  - The wave 1 colours (navy hood, navy cloak, red scarf) are gone.
- **Cape and hood point motion** (`anim.js` `_secondary`). Each panel is a spring on its angle to the panel
  above it, and each lower panel lags the panel above, so speed changes travel down the cape as a wave.
  - It responds to drag (forward speed), lean, vertical speed and a turn swing (`capeRoll`).
  - It never hangs dead: a 1.6 s hem sway at rest, plus noise flutter.
  - `capeKick` impulses fire on dash (0.5), on hurt (0.55), and on each swing (0.4, or 0.2 on the overhead).
  - On death, the cape settles slowly over the lying body (springs at 0.35x stiffness).
- **Lingering smears**. `anim.smear` (which combat reads as the hitbox tick) is unchanged: active
  ticks only. A separate `anim.smearShow` draws the arc and keeps it on screen for 7 ticks after the last active
  frame: the last arc holds for 2 ticks, then a rim-only frame shows for 3, then a shorter hairline for 2
  (`hero.smear.{h,v}4..5`, exported count `SMEAR_FADE = 2`). That makes 11 ticks visible per swing,
  so a 10 fps strip catches every hit. The overhead's vertical arc is tilted 0.62 rad off the vertical plane,
  so it is never edge-on to the camera.
- **Combo poses**. The body yaw (`twist + tTwist`) stays within about 31 degrees of the aim on every hit,
  and the sword arm does the sweep. Hits 1 and 2 pull the blade behind the body in their wind-up
  (`aRy` ±2.35 / -1.7) and lunge about 0.3 units (`offF` 2.4 voxels). Hit 3 is a hop: a crouch at
  tick 3, then 4.2 voxels up at tick 10, landing at tick 13 (the same tick as `hero:slam`) into a squash
  (0.68 / 1.28). The squash holds until tick 16, then recovers. **`ATTACKS` timings are unchanged**, so
  combat's windows and hitboxes are as before.
- **Dash**: a 2-tick launch crouch (sy 0.8), then a stretch of 1.42 along travel with the head kept up
  (lean 0.3, headX -0.32, so the face stays visible), then a 5-tick braking skid into a crouch that leans back.
  Afterimages are stamped on ticks 2, 4 and 6 only (for the default 10-tick dash), so no ghost lingers ahead
  of the skidding body.
- **Idle**: breathing on a 1.6 s period. The pelvis bobs ±0.55 voxel, the arms rise, and the head lags a beat.
  The cape hem sways and the hood point bobs.
- **Run**: less forward lean (0.24) and the head pitched up (headX -0.38), so the face reads when
  running toward the camera. The cape lift was toned down (about 1 rad in total) so it curls out
  instead of becoming one flat plate.
- **Hurt**: a jolt, then a lean away from the blow that holds for 6 ticks (ticks 2 to 8) and recovers by tick 13.
  The keyed lean is split into pitch and roll by the hit's direction, so a blow from the side leans the hero
  sideways instead of doing nothing.
- **Death**: a bigger bounce on impact (offY 2.2 → 4.0 → 2.2, ticks 40 to 50). On the thud, the
  **sword leaves the hand** and skitters 3 voxels across the floor with one hop and a spin. It
  reattaches on `spawn()` / `reset()`.
- **Spawn**: the landing squash is capped at 0.66 / 1.28, with almost no lean, so the eyes stay visible.
- **Showcase**: mode notes are updated, and skid dust is added on `hero:skid`. Keys, params and modes are unchanged.

## APIs

Everything in the wave 1 notes still holds. Changes:

```js
import { createHeroRig, HERO_HEIGHT, SMEAR_FRAMES, SMEAR_FADE } from './hero/model.js';
HERO_HEIGHT            // now 12 * VOXEL (was 11)
rig.mantle, rig.hoodTip2, rig.capeA, rig.capeB, rig.capeC        // new parts
rig.cloakU, rig.cloakL // kept as aliases of capeA and capeC
rig.parts              // now 13 meshes (afterimage copies follow it)
rig.setSmear(kind, f)  // f may now be SMEAR_FRAMES .. SMEAR_FRAMES + SMEAR_FADE - 1 (the fade frames)

anim.smear             // UNCHANGED meaning: active-tick index or -1 (combat's hitbox)
anim.smearShow         // { kind, frame, mirror, tilt, age } or null: what is drawn (lingers past the active ticks)
anim.capeKick = n      // optional: add an outward cape impulse (0..1) from outside, e.g. a big hit
```

New event: `hero:skid {anim, x, z, yaw}` fires on the first tick after the dash's travel ends. Use it for
skid dust or sound.

## Debug hooks and showcase params

- No new hooks. `__GR.debug.hero(...)` is unchanged. `debug.hero('scarf')` returns the 5 scarf points.
- Strip recipe as in wave 1: `debug.freeze(true)`, then `debug.hero('mode', <id>)`, then `debug.step(n)` and a
  screenshot. The attack starts at mode tick 10, and the smear is visible from mode tick 15 to 25 for hit 1.
  The dash starts at mode tick 20 and the skid at tick 30. Hurt is at 12 and death at 12; the thud and sword drop are at tick 52.

## Cross-piece edits

None. Every change is in `src/hero/model.js`, `src/hero/anim.js` and `src/hero/showcase.js`.

## Known gaps

- **The top of the hood is a large flat rose plane.** At the 50 degree pitch it is the biggest thing on the
  hero. It reads well as a colour mass, but it has no surface detail. A stitched seam that I tried read as a
  cross patch, so I removed it.
- **The hood and cape are close in hue.** `rose` against `red` separates in value only by a step under the
  arena lighting. From directly behind, the hero is still mostly one warm mass, plus the cyan scarf.
- **The hurt flash's red phase** lands on a mostly red hero, so it reads less than it used to. The white
  first flash is unchanged.
- **The hero's colours overlap enemies'**: enemies use `red`, `bone` and `gold` heavily. `rose` is used only lightly
  (Warden stains). I did not check the hero against every enemy in a crowded fight.
- **The scarf tail is in shadow** at the default showcase angle (dark teal). It shows, but faintly, in idle.
- **Rigid parts and rotated voxels** are unchanged from wave 1: there are no knees or elbows, and
  rotated limbs stair-step.
- **The cape can clip** through the legs on the deepest back-swing of a run stride, and the hood point can
  touch the cape in some back views.
- **The overhead hop** is visual only (`offY`). Combat's hit timing is unchanged, and the contact shadow from
  `look.impact` stays at the sim position, which is correct for a hop. The hero sim does not leave the ground.
- **The dash crouch** happens while the controller is already moving the hero at dash speed (input still
  answers on frame 1), so it reads as a launch rather than a stand-still wind-up.
- **I did not re-time `ATTACKS`.** The critic asked for at least 4 ticks of anticipation. Hits 1 and 2 have 5 and 4
  wind-up ticks (unchanged), with a stronger pull-back pose. Longer wind-ups belong to combat's tuning.
