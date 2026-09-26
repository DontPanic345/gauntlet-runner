# combat: builder notes (wave 1)

## What exists

- **Combo** (`src/combat/combat.js`, `HeroCombat`): the 3-hit chain is slash, backhand, then the overhead finisher.
  - **Timings**: taken from `hero/anim.js` `ATTACKS`.
  - **Chaining**: a press at any point in an attack queues the next one. The queued attack starts on the current attack's `cancel` tick, so the tempo is fixed and mashing is no faster than pressing in rhythm.
  - **After an attack ends**, a press within `RULES.linger` (14 ticks) continues the chain. Later presses, and presses after the overhead, start again at the slash.
  - **During a dash or a hurt stun**, presses wait up to `RULES.queueTicks` (12 ticks, plus the dash length while dashing).
- **Hitboxes that follow the smear**:
  - **Horizontal swings**: each active tick covers the arc from the smear's tail to its current leading edge, with the angles copied from `SMEAR_SPEC` in `hero/model.js`. The edge is taken 10° ahead of the drawn one, and the target's angular width counts. Reach is the smear's outer rim (1.33 units) plus 0.12, plus the target's radius.
  - **The overhead**: a ±42° cone from active tick 1.
  - **The facing** used is the animator's actual pose yaw, not the controller's wish.
  - **Once per swing**: each target can be hit only once by a given swing.
- **Keyboard aim assist and step-in**: when a swing starts, it turns toward the nearest target within 2.3 units and 55° of facing. With mouse aim, the aim direction is left alone. The hero also steps up to 0.5 units toward that target, so a chain does not walk itself out of reach.
- **Hit resolution** (`strike`, `applyImpact`), all scaled by damage:
  - **Hitstop**: 55 / 62 / 95 ms, plus 8 ms per extra target, capped at 110. There is one global hitstop per tick.
  - **Target reaction**: a white flash held through the hitstop, then stepped down. Knockback of 1.7 / 2.1 / 8.5 u/s; the finisher also launches the target (lift 3.4). The target also rocks on a tilt spring and squashes.
  - **Screen**: a kick along the hit direction and a shake on hits 2 and 3, both through `feedback`. There is also a `look.flash` light pop at the contact point.
  - **Damage**: 10±1, 11±1, then 24±2 for the finisher, which is flagged `crit`.
- **Effects** (`src/combat/fx.js`, `createCombatFx`), all driven by events:
  - **Sparks**: voxel streaks stretched along their velocity and sprayed along the blade's travel. Their colour steps white, torch, gold, flame.
  - **Debris** in the target's own colours; dummies drop straw.
  - **A floor dust ring** on the overhead's `hero:slam`.
  - **Impact marks** (2D, pixel-drawn, tick-driven so they hold through the hitstop): a slash cut line along the blade's travel (vertical for the overhead chop), an impact star, then a ring and 4 dots.
  - **Stand-in damage numbers**: they pop and overshoot, then blink out. Crits are gold and larger, and hero damage is red.
  - **The hurt vignette**: red edges with a dithered inner band for about 0.4 s, scaled by the `flashes` setting.
- **Sound** (`src/combat/sfx.js`), synthesised with WebAudio:
  - swing whoosh per step, on `hero:swing`;
  - hit = click + thump + burlap crunch, scaled by power, with a heavy extra layer for the finisher;
  - the slam boom, hero hurt, dodge shing, the sparring dummy's windup creak, and its club whoosh.

  The AudioContext is only created after a user gesture, so no autoplay warning is logged.
- **Hero health** (`HeroHealth`, which is also a valid `world.hero`):
  - **Immunity**: dash i-frames (from `ctl.invulnerable`), plus 60 ticks of post-hurt i-frames. During the post-hurt i-frames the body flickers pale every 3 ticks and never disappears.
  - **A hurt** plays:
    - 80 ms hitstop and a 16% red full-screen flash;
    - the edge vignette, a 2.5 px shake, a kick, and a red light pop;
    - red sparks and a red impact star;
    - the hero anim's `hurt(fromYaw)`, an 8-tick stun, and knockback away from the source.
  - **At 0 hp**: `anim.die()`, a permanent stun, and `combat:heroDeath`. `world.god` keeps hp from dropping but still plays the hurt.
- **`Hurtable`** base class: knockback velocity with friction, a launch with gravity and landing squash, a tilt spring, a stepped flash, a hit counter and `lastHit`. Enemies can extend it.
- **Dummies** (`src/combat/dummy.js`):
  - **`TrainingDummy`**: a straw sack on a weighted drum base, with a painted target and a chalk home mark. It slides, rocks and squashes when hit. After resting for 50 ticks away from home, it hops back in hops of up to 0.42 units. It counts hits and measures `knockDist`.
  - **`SparringDummy`**: an iron pot helm, ember eyes and a club. When the hero is within 2.5 units it attacks:
    1. **Windup** (42 ticks): a floor telegraph of voxel tiles fills its reach, and the edge blinks for the last 10 ticks. The telegraph is the hitbox: 1.65 reach plus the hero's radius, ±80°.
    2. **Swing** (6 ticks).
    3. **Recover** (34 ticks), then a 70-tick cooldown.

    The overhead finisher staggers it out of a windup.
- **`?showcase=combat`** (`src/combat/showcase.js`): a crypt training yard, 13x9 units with a curb, 6 torches, and sawdust under the dummies. It holds 3 straw dummies (A alone; B and C side by side) and sparring dummy S.
  - **DEMO autopilot**: it drives the real controller and combat through keyboard-style presses 13 ticks apart. The stations are:
    1. two full combos on A;
    2. one combo at x0.25;
    3. one slash through B and C together;
    4. getting hit by S;
    5. dashing through S's swing (DODGE);
    6. a counter-combo on S.

    Any key takes over (LIVE).
  - **HUD**:
    - each dummy's hit count, which pops on a hit, plus its name and `KNOCK x.xx`;
    - hero hp pips that shake and flash on a hurt;
    - I-FRAMES (HURT or DASH) and HITS / WHIFFS counters;
    - a combo timeline: step pips, and a bar at 3 px per tick showing windup, active and recovery, the chain window (the green line), the playhead, and press markers.
- **Normal play** (`?scene=run|boss`, the foundation placeholder) now runs through `HeroCombat`, `HeroHealth` and the fx. `debug.spawn('dummy'|'sparring', x, z)` puts targets in the room.

## APIs

```js
import { HeroCombat, HeroHealth, Hurtable, COMBO, RULES, strike, applyImpact, sectorHits, swingRange } from './combat/combat.js';
const health = new HeroHealth({ ctl, anim, rig, hp: 5 });          // world.hero = health
const combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies, source? });
// tick:   combat.tick()        = combat.pre(); ctl.tick(); combat.post(); health.tick()
// render: anim.render(alpha); health.render();                       // hurt flicker
health.hurt(amount, {x, z} | null, { force }) -> {ok, hp} | {ok:false, reason:'dodged'|'iframes'|'dead'}
health.heal(n); health.revive(); health.invuln; health.dead; health.iframeT
combat.press(); combat.info(); combat.log; combat.debugHitbox

// A target is any object with { x, z, r, dead, takeHit(hit) -> false to ignore }.
// Optional: h (height, for numbers), hitY (spark height), debris: ['gold', ...] palette names.
// hit = { dmg, dx, dz (push dir), tx, tz (blade travel), power, step, finisher, knock, lift, stopMs, flashTicks }
class Enemy extends Hurtable { tick() { this.tickBody(); ... }  render(a) { const s = this.at(a); ...; mat.flash = this.flashLevel(); } }
// An enemy hitting something else: const h = strike(target, {x, z}, {dmg, knock, stop, kick, shake}); applyImpact([h], spec)
// An enemy hitting the hero: world.hero.hurt(1, { x, z })   (handles i-frames, dodge, death)

import { createCombatFx } from './combat/fx.js';   // const cfx = createCombatFx(root, { numbers: true })
// cfx.tick(); cfx.render(alpha); cfx.ui(g); cfx.dispose(); cfx.sparks(...) / debris(...) / ring(...)
import { combatSfx } from './combat/sfx.js';      // combatSfx.enabled = false when `audio` takes over
import { TrainingDummy, SparringDummy, SPAR } from './combat/dummy.js';
```

Events (`core/events.js`):

- `combat:attack {step, name, x, z, yaw}`
- `combat:hit {target, x, y, z, dx, dz, tx, tz, dmg, power, finisher, step, stopMs}`
- `combat:damage {x, y, z, amount, crit, side:'enemy'|'hero'}`: the damage-number hook for `hud`.
- `combat:kill {target, x, z}`
- `combat:heroHurt {x, z, amount, hp, maxHp, dx, dz, source}`
- `combat:dodge {x, z, source}`
- `combat:heroDeath {x, z}`
- `combat:whiff {step}`
- `combat:enemyWindup {enemy, x, z}` and `combat:dummyLand {x, z, v}`: these come from the dummies.

`vfx` and `hud` can replace `fx.js` by listening to the same events (`createCombatFx(root, { numbers: false })` turns the stand-in numbers off).

## Debug hooks and showcase params

- `__GR.debug.combat(action?, arg)`:
  - With no action, it returns `combat.info()` plus `health`.
  - `'press'` queues an attack.
  - `'combo'` returns `COMBO` and `RULES`.
  - `'tune', {step: 2, dmg: 30}` or `'tune', {rules: {linger: 20}}` edits them live.
- `debug.hurt(n)` and `debug.kill()`: when a `HeroHealth` is `world.hero`, they go through the real rules (feedback, i-frames, death). `hurt` ignores i-frames (it is a debug command) and respects `god`. Otherwise foundation's default behaviour applies.
- `debug.spawn('dummy'|'sparring', x, z)` works in the combat showcase and in the run/boss placeholder.
- `?showcase=combat` params:
  - `&auto=0` starts LIVE, facing dummy A.
  - `&at=combo|cleave|hurt|dodge|counter`.
  - `&zoom=1..3` (default 2).
  - `&slow=<s>`.
  - `&hitboxes=1` shows the live swing sector in gold, S's reach in rose, and the target circles.
  - `&spar=0` stops S from attacking.
  - `&numbers=0` hides the stand-in damage numbers.
  - `&hud=0` hides the labels.
- Showcase keys: J attack, K dash, WASD move, B demo, X hitboxes, R reset dummies, Z zoom, T slow-mo, H hud, P/Esc pause.
- `state().showcase` = `{id, mode, step, label, timeouts, zoom, combat, health, hero, anim, dummies:[{id, hits, lastDmg, knockDist, state?...}]}`.
- **Capturing a combo**: headless screenshot bursts are much slower than the sim; a 30 ms burst really takes about 200 ms per shot. In a LIVE capture, three J presses separated by bursts therefore arrive too far apart to chain. To capture a combo:
  - use the DEMO (the chain is timed in sim ticks);
  - or use `&slow=0.25`;
  - or freeze and step: `debug.freeze(true)`, then `debug.step(45 - __GR.frame)`, then repeat `debug.step(2)` with a shot after each, which walks through the first demo combo.

  Stepping skips hitstop (the stop is real time), so use `--video` to see it.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `combat` row.
- `src/core/placeholders.js` (foundation): the run/boss placeholder now uses `HeroHealth` as `world.hero`, and `HeroCombat.tick()` instead of its own attack/hurt/death logic. It creates the combat fx, ticks and renders `world.enemies`, and registers `debug.spawn('dummy'|'sparring')`. The death still goes to gameover about 80 ticks after the hero falls. `run-flow` replaces this scene anyway.

## Known gaps

- **Enemy hit-stun is not defined.** Dummies only slide and rock. Real enemies must decide on flinch and stagger themselves (`takeHit` gets everything they need).
- **Hitstop is global.** The hero freezes too, which is intended, but there is no per-entity freeze or shake of the target during the stop.
- **The flash quantises to a pale checker.** The white hit flash goes through `look`'s palette quantise, so on straw it reads as a pale checker rather than pure white. The quantise also shifts the unlit ember colour, so the telegraph uses red and gold instead of ember.
- **The overhead hitbox is a flat cone.** It ignores height, so it hits a target the vertical smear visually passes above only if the target is inside the cone. The overhead smear is also nearly edge-on when facing the camera (a hero gap), so the finisher's read leans on the flash, sparks and numbers.
- **Mashing is not penalised.** It gets the same fixed tempo as rhythm; nothing rewards timing, such as a perfect-timing bonus.
- **Aim assist ignores obstacles.** There is no line-of-sight check. The step-in can pull the hero toward a target behind a pillar (collision still stops the body).
- **Dummy hp is `Infinity`**, which shows as `null` in `state().enemies`.
- **`debug.spawn` can be clobbered.** The showcase and the placeholder register the handler on scene enter and replace any handler `enemies` registers at import. When `enemies` lands, the placeholder's registration should be removed.
- **The sounds are first-pass.** They were only checked for errors, not listened to at length; the `audio` piece should retune or replace them. The volume applies at trigger time only.
- **No gamepad testing**, as for foundation.
- **The sparring dummy's model is rough.** At zoom 1 the club lies across the base while idle, and the model reads as a squat block from above.
