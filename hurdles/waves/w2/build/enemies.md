# enemies: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/enemies.md`) still describe the AI, the state machines, the
telegraph language, the events and most APIs. This file covers what changed in wave 2.

## What exists

- **Self-lit enemy material** (`src/enemies/material.js`, new). Every enemy body now uses
  `makeEnemyMaterial()`, which is the shared voxel material plus one extra rule: a lit voxel can
  never be darker than `palette colour x AO x selfLit x face`.
  - `face` is a fixed flat ramp: top 1.0, faces toward the camera 0.78, faces toward the upper-left key
    0.7, other sides 0.56, undersides 0.4.
  - `selfLit` defaults to 0.9. Torches still brighten the body above this floor.
  - Away from torches, enemies stay on their own palette colours instead of sinking toward the floor's
    values. AO keeps its dithered bands. The ramp is per face, so there is no smooth gradient.
  - The wisp's flame keeps the plain voxel material (it is all emissive).
- **New colour identity per archetype** (`src/enemies/models.js`). The top faces of each archetype
  carry its lightest colour.
  - **Husk**:
    - a leaf-green body (no more moss/dirt masses);
    - a bare `bone` skull head with a ragged `leaf` moss scalp and `frost` on the back;
    - ink sockets with glowing `gold`/`flame` eyes, 2 voxels tall;
    - `woodLight` rags, `white` claws, a `red` wound.
  - **Brute**: a purple bull-ogre.
    - Plum sides, with `rose` on shoulders, back, skull, thighs and face.
    - Pale `fog`/`frost` steel pauldrons, greaves and cap replace the dark iron.
    - `bone`/`white` fists and horns, a `wood` belt with a `gold` buckle, a `gold` nose ring.
    - Glowing `gold` eyes and an ember maw.
    - The face is now `rose`, so it no longer reads as a black hole from above.
  - **Ember Wisp**:
    - a cool emissive skull (`bone`/`white`, `sky` eyes, ink sockets), with an `ink` halo disc
      behind it (`enemies.wisp.ring`);
    - the flame runs `red` at the tips into `ember`, `flame` and `torch`, so it differs from
      the braziers' fire.
  - **Orbs**: `white` with a `rose`/`plum` band round the waist. They are never ember-coloured.
  - **Mite**: unchanged, except for `white` eyes.
- **Debris and death colours** (`data.js` `debris`) are now each archetype's lightest colours:
  - husk: leaf, bone, white, woodLight;
  - wisp: bone, red, white, flame;
  - brute: rose, bone, frost, plum;
  - mite: cyan, sky, teal.

  vfx's kill burst and look's resting chips read these, and the chips stay for the rest of the room.
  The second-beat crumbles are bigger: husk power 0.8 → 1.1 with a `leaf` ring, and brute 1.6 → 1.8.
  A mite's pop throws 14 chunks (was 9).
- **Telegraphs on the body, not only on the floor**:
  - **Husk windup**:
    - It snaps into the rear-back in 8 ticks (was about 13): up on its toes (hipY +1.1),
      torso tilted back, arms overhead, jaw wide.
    - The body flashes white for the first 7 ticks (0.7, then 0.35). This is the "it noticed you" beat.
    - It strobes red for the last 10 ticks.
  - **Wisp windup**:
    - The flame swells up to 40% and the skull scales up 20% (in 1/8 steps).
    - The skull pulses white at 6 Hz, then strobes for the last 12 ticks.
    - The aim line is the new `T.line`: a solid `rose` line, one tile wide, rasterised cell by cell,
      with an `ink` edge. A `torch` tip grows from the wisp to just past the hero. It reaches full
      length when it locks (12 ticks before the shot), then blinks gold. The wave 1 dotted line is gone.
  - **Brute charge windup**:
    - It crouches 2.3 voxels with its fists drawn back past the hips.
    - A glowing maw plate (`enemies.brute.maw`: ember, gold and flame) blinks under the snout.
      For the last 12 ticks and through the charge it is solid and 1.35x bigger.
  - **Mite windup**: it flattens (crouch 0.55), rears up, flashes white for 5 ticks, then blinks red.
- **Mites hop in sequence.** A mite may start a windup only `mite.attack.stagger` ticks (9) after
  the last mite did. A swarm therefore reads as a run of single hop discs, not five overlapping red
  rings. The lineup does the same: its mites start 4 ticks apart.
- **Hit reaction** (`enemy.js` render):
  - The flash is two-tone: solid white for the first half of `flashTicks`, then the archetype's
    `hurtTint` (default `red`) at 50%, with the silhouette showing through.
  - A hit squashes the body along the blow (in the enemy's local frame): -30% along it,
    +15% across it, -8% in height. A landing still squashes straight down.
- **Bigger locomotion**:
  - Husk: walk bob up to 1.7 voxels (was 0.7), arm swing about ±31° (was ±20°), and a head roll
    on each step.
  - Brute: stomp drop up to 2 voxels (was 0.8). Each footfall sets a squash of 0.18 and throws 3 dust (was 2).
  - Mite: a 1-voxel skip every 0.4 s while running, on top of the leg flicker.
- **Wisp kiting** steers out of torch pools: fires only, meaning `look.lights.torches` with intensity
  ≥ 1 and `haze > 0`, within `wisp.avoidLight` (2.2). It also stays off the room's far edge, within
  `wisp.avoidTop` (1.8) of `bounds.minZ`, where the wave banner is drawn. Both values are data.
- **Spawns never land inside props.** `foes.spawn` and the swarm spawn move a requested point that is
  blocked (a pillar, brazier or wall) to the nearest free spot, searching rings out to 3 units. This
  is the critic's "brute in the brazier" problem.
- **Lineup layout** (`showcase.js`):
  - The slots are closer together (x -3.45 / -1.2 / 1.1 / 3.4), so the swarm fits at zoom 2.
  - Names, in each archetype's colour, and blurbs word-wrap to the slot width, so nothing collides at zoom 1.
  - The full lineup's zoom is capped at 2 (Z cycles 1-2). `&only=` still goes to 3.

## APIs

Everything in the wave 1 notes still holds. New or changed:

```js
import { makeEnemyMaterial, enemyLook } from './enemies/material.js';
makeEnemyMaterial()          // like makeVoxelMaterial(): same userData.flash / flashColor, plus the self-light floor
enemyLook.selfLit.value      // 0.9 default; 0 = plain scene lighting (live, all enemies)

tele.line(x, z, yaw, length, p, { t, locked, from = 0.45 })   // telegraph.js: the aim line
foes.freeSpot(x, z, r) -> [x, z]                                // nearest unblocked point
```

- New data fields (all optional, read live):
  - `wisp.avoidLight` and `wisp.avoidTop`;
  - `mite.attack.stagger`;
  - `<type>.hurtTint` (palette name; defaults to `red`).
- `ENEMY_DATA.brute.color` is now `rose` (was `plum`). The lineup uses `color` for name plates.
- Model parts added: `enemies.wisp.ring`, `enemies.brute.maw`.

## Debug hooks and showcase params

- `__GR.debug.enemies('lit', v)` sets the self-light floor live. `('lit', 0)` gives the wave 1 lighting,
  for before/after captures. `('lit')` returns the current value.
- No params removed. Strip recipes from wave 1 still work:
  - attack: N = 4, then step 6 at a time;
  - death: N = 16, then step 6 at a time.
- In the attack beat the mites now land over about 20 ticks after the others, not all on one tick.

## Cross-piece edits

None. Every change is under `src/enemies/`.

## Known gaps

- **The hero now reads darker than the enemies.** The hero is plain scene-lit, so away from torches its
  rose hood falls to plum next to the self-lit cast (see any in-play frame). That belongs to the `hero` and `look`
  pieces. `makeEnemyMaterial` is a drop-in they could reuse.
- **The brute and the hero share rose.** The brute's top faces are `rose`, the same as the hero's hood. Their sizes
  and silhouettes differ a lot, but in a crowded thumbnail the two warm-pink masses can touch.
- **The brute's head is mostly hidden from the default camera.** From above you see the steel cap, the horns, the
  gold eyes and the maw. The face is lighter now, but the head is small against the body. A bigger head or horns
  would read better as "bull".
- **The white hit frame is still one solid frame.** That is by design (1 white, 1 tinted). Combined with combat's
  white star, the hero's smear and vfx's burst, a finisher's first frame is still a large white shape.
- **The wisp's skull is partly hidden by its flame** at some angles. The ink halo sits behind the skull and shows
  as a dark band over it from the high camera.
- **The brute's charge lane still stair-steps on diagonals** (critic problem 7, second half). I did not
  snap the charge to 8 directions, because that changes where it runs.
- **The husk's floor sector** is unchanged: it still starts at the windup and is centred on the husk. The
  body tell is what changed. The sector's near edge is still under the husk's body.
- **Knockback distance** on normal hits is combat's `knock / weight`. I did not measure or retune it.
- **Torch avoidance** is a soft push. A wisp cornered between a brazier and the hero can still float in the pool.
- **The self-light floor flattens shading in the dark.** Away from lights, a body's look comes from the fixed face
  ramp, not from the room. This is intended for readability, but enemies do not darken in shadowed corners as
  much as props do.
- **The mite stagger is global per manager**, not per swarm. Two swarms share one rhythm.
