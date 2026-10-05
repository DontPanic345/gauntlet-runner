# movement: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/movement.md`) still describe the collision world, the
controller's structure and the camera. This file covers what changed in wave 2.

## What exists

- **Dash, re-timed as a burst** (`src/hero/controller.js`, `MOVE`):
  - 10 ticks, 4.0 units. Flat at peak speed (about 30 u/s) for 7 ticks, then 3 braking ticks at 50%, 26% and 12% of peak.
    About 3 units are covered in the first 6 ticks, which is one 10 fps frame. Wave 1 was 2.5 units in 11 ticks, with exponential decay.
  - I-frames cover the whole dash (10 ticks). The cooldown is 14 ticks (was 18).
  - **Recovery plant**: for 4 ticks after the dash, run speed is capped at 35%, and the exit speed is 35% of run speed (25% with no input).
    The hero's skid pose (`hero:skid`) now starts on the first braking tick (`anim.dash(dashFlat + 1)`), so the crouch lands while the body actually brakes.
  - **No dropped presses**: a press during a dash or its cooldown is held until the dash can fire. The hold is `max(dashBuffer, remaining dash + cooldown + 2)`, capped at `dashHold` = 30 ticks.
  - **Dash from against a wall**: if the input has a sideways part (more than 0.3), the dash runs along the wall. Otherwise it is a bump:
    `move:bonk` with `start: true`, a recoil of about one voxel, a kick plus a 1 px shake through `feedback`, a cape kick, and only a 6-tick cooldown.
    A head-on wall mid-dash now also ends the dash on its first tick (the wave 1 `t > 0` guard is gone).
- **Dash streak** (`DashStreak` in `controller.js`): a flat-coloured, unlit band at torso height, running from the dash start to just behind the hero.
  - It is stepped thicker toward the hero: a thin `sky` tail, a `sky` middle, a fat `frost` front, and a `white` core line.
  - During the burst it grows with the hero. After the flat ticks, the tail runs up to the head (34% per tick).
  - After the dash it drops the fat layer (tick 3), then the middle layer (tick 6, when the core turns `sky`), and it is gone at tick 10.
  - It is updated in `ctl.at(alpha)`, so its head tracks the interpolated hero. It is made lazily on the first dash and parented to `anim.rig.group`.
    Every scene using `HeroController` with an animator gets it with no setup.
- **Effects through the shared vfx pool** (controller, `MOVE_FX` flags):
  - landing-skid dust thrown forward when a dash ends (not when it ends on a bonk);
  - turn dust on a sharp running reversal (`move:turn`);
  - a small puff when a full-speed run comes to rest.
  The dash take-off burst and bonk dust are still vfx's `move` binding.
- **Round-pillar roll-off**: running within about 8 degrees of head-on into a circle collider pushes the body round it at 60% of run speed.
  It goes toward the side the body is already off-centre to, else toward the more open side (by raycast). The side is kept while contact lasts.
  Measured: from (-8, -3) holding W, the hero passes the pillar at (-8, -6) instead of sticking at z = -5.25.
- **Wall slide keeps speed**: with diagonal input, the speed along the wall is raised to at most 0.9x run speed. It is never lowered.
  Measured: 3.78 u/s against the left wall (was 2.97).
- **Camera** (`src/render/camera.js`):
  - The lead is split into a movement part and an aim part.
  - **Stop settle**: when the hero comes to rest, the goal moves to 30% of the camera's remaining catch-up, the movement lead is rebased to match,
    and the spring runs at 0.08 s for 12 ticks. The movement lead is then held for 36 ticks and relaxes slowly after that.
    Measured at zoom 1: after the hero's last moving tick, the view drifts 0.087 units (about 3 internal px). Wave 1 was about 0.7 units.
  - **Bounds padding**: room bounds are widened by `padX` 1.0 and `padZ` 0.8, so the camera leads even in arenas no wider than the screen.
    Measured in `?scene=run&seed=3`: camera x swings to ±1.35 while the hero runs wall to wall (wave 1: pinned at 0).
  - **Leash wins over the room clamp**: the hero stays within `edgeX` 0.7 / `edgeZ` 0.62 of the half-screen, and within `maxOffX`/`maxOffZ`, at any zoom.
- **Showcase** (`src/core/showcase-movement.js`):
  - It now uses the game's own effects: `vfx.bind(['move'])` plus the controller's streak and dust. The stand-in dust is no longer fed.
  - Blocks have a 1-voxel `night` base row (moss moved up a row), so the wall foot separates from the floor.
  - The demo's back-wall slide is shortened (UR 50 → 34 ticks), because the faster slide otherwise ran under a pillar. A full loop reports no `timeouts`.

## APIs

Everything in the wave 1 notes still holds. Changes and additions:

```js
import { HeroController, MOVE, MOVE_FX, DashStreak, STREAK, dashProfile } from './hero/controller.js';
MOVE.dashFlat, MOVE.dashBrake[], MOVE.dashHold, MOVE.dashRecover, MOVE.dashRecoverMove,
MOVE.dashBumpCooldown, MOVE.rollOff, MOVE.slideKeep        // new tuning (boons may edit ctl.T)
MOVE_FX = { streak, turnDust, stopDust, landDust }          // set false to hand an effect to another piece
dashProfile(T) -> number[]                                  // per-tick dash speeds (units/s)
ctl.recoverT                                                // ticks left of the post-dash plant
ctl.dashFrom                                                // {x, z} where the last dash started
ctl.fx                                                      // the DashStreak, or null before the first dash

import { CameraRig, CAMERA } from './render/camera.js';
CAMERA.edgeX, edgeZ, padX, padZ, stopSmooth, stopSettle, stopHold, stopRelax   // new options
cam.vLead, cam.aLead, cam.still, cam.settle
```

Events: `move:bonk` now also fires when a dash starts against a wall with no sideways input, with `start: true` in the payload.
`move:dashEnd` fires on the last braking tick, as before.

For **vfx** (rebuilt later this wave): the controller calls `vfx.dust` for turns, stops and the dash landing.
If vfx adds bindings for `move:turn`, `move:stop` or `move:dashEnd`, set the matching `MOVE_FX` flag false, so dust is not doubled.

## Debug hooks and showcase params

- `__GR.debug.move()` info adds `recover` and `streak` (`{phase, age, visible}`). `debug.move('tune', {...})` accepts every new `MOVE` key.
- `__GR.debug.camera()` info adds `still` and `settle`. `debug.camera({padX: 0, ...})` sets any new `CAMERA` key.
- Showcase params and keys are unchanged.
- **Strip recipe**: `__GR.frame` at a given demo tick varies between loads, so step until the state you want instead of using fixed tick numbers.
  For example, load `/?showcase=movement&zoom=1&hud=0&trail=0&at=pillars`, run `debug.freeze(true)`, step 1 tick at a time
  (waiting for `__GR.frame` to change) until `state().showcase.state === 'dash'`, then shoot and step 6 ticks per frame.
  The pillar station has three dashes (right, up, left) in its first 2 s.

## Cross-piece edits

- `src/hero/model.js` (hero): the afterimage ramp `GHOST_COLORS` changed from `cyan, teal, navy` to `frost, sky, cyan`.
  The headline asked for an afterimage that is bright against the dark floor, not a muted teal. That is a one-line change.
- `src/hero/anim.js` (hero): in loco, a turn bigger than 1.2 rad uses rate 0.7 and a 1.05 rad/tick cap (was 0.5 and 0.62), so a running reversal turns in about 3 ticks instead of 5 to 6.
  The judge's second gap was turns that show in-between angles. Everything else in the facing code is unchanged.

## Known gaps

- **The streak is a straight band.** If a dash slides along a wall and bends, the band stays on the original dash line, measured along the dash direction.
  It is made of axis boxes, so it has a stepped taper but no dithered fade, and it has no outline.
- **Dashes up or down the screen read weaker than sideways ones.** The band is foreshortened, and on a down-screen dash it sits mostly behind the hero's own body.
  Most of the bright mass there comes from the hero's afterimages.
- **The hero's afterimages and the streak overlap into one bright mass** for about 6 ticks after a sideways dash. It reads as a smear in a strip, but individual ghost silhouettes are not distinct.
  The hero stamps ghosts only on ticks 2 and 4 of the new dash (its rule is `t <= n - 4` with n = 8).
- **The recovery plant costs about 4 ticks of slow movement** after every dash. It makes the landing read, but in a fight it may feel sticky. I have not tested it against enemies.
- **The stop settle only fires at full rest.** During the 3 deceleration ticks the camera still follows normally, so about 0.18 units of motion happen there.
- **Padding lets the camera show a strip of void** (up to about 1 unit) past the side walls in arenas no wider than the screen. Arenas is rebuilt later this wave, and `cameraBounds` may change.
- **The pillar roll-off and slide-keep were tested only in the showcase**, on its pillars and its left wall. The wall-contact sprite overlap (critic problem 8, second half) is not addressed.
- **The facing change is a hero file edit.** I did not check the hero showcase's turn mode after it.
- **The showcase's local dust pool** (`makeDust`) is still built and ticked, but nothing feeds it.
