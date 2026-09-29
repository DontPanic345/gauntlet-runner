# enemies: builder notes (wave 1)

## What exists

- **Four archetypes** in `src/enemies/`, each a rig of rigid voxel parts (`models.js`) posed procedurally every sim tick and interpolated at render. Each has its own material, so hit flashes and telegraph pulses light only that enemy.
  - **Husk** (`husk.js`): a hunched green corpse in brown rags, with a bone face, gold eyes and a hinged jaw. 30 hp, speed 1.3.
    - **Move**: lurching steps (one leg drags) toward its flanking slot. Its arms rise to reach for the hero inside about 3 units.
    - **Windup** (30 ticks): it rears back with both claws overhead and its jaw open, and a sector fills on the floor. The sector tracks the hero for 60% of the windup, then locks. The body pulses red for the last 10 ticks.
    - **Attack**: a double-claw slam with a lunge and a red `vfx.slash`.
    - **Recover**: 40 ticks hunched over, arms hanging.
    - **Death**: arms thrown up, a sideways-biased backward topple with a bounce, a twitch, then it sinks and crumbles into rot and bone, leaving a stain.
  - **Ember Wisp** (`wisp.js`): a coal skull inside a three-frame emissive flame, with a floor shadow. 22 hp.
    - **Move**: it stays 3.4 to 5.4 units from the hero. It backs off, closes in, and circles sideways, flipping direction at walls and every 2 to 4 s.
    - **Windup** (42 ticks): the flame swells, embers are sucked in, and a dotted aim line on the floor tracks the hero. The line locks and blinks for the last 12 ticks.
    - **Fire**: slow ember orbs (3.1 u/s) with a red ring of floor tiles under each. The wisp recoils. Orbs pop on walls and on the hero, scorch the floor, and a dash passes through them.
    - **Death**: the flame gutters and goes out in smoke, and the skull drops, bounces and shatters into cinders.
  - **Brute** (`brute.js`): a plum ogre with iron pauldrons, bone horns, a nose ring and red eyes. 160 hp, poise 50.
    - **Spawn**: a red landing disc fills, then it drops from above. Its landing makes a shockwave, a shake and a floor crack, then it roars.
    - **Charge windup** (50 ticks): it plants and paws the floor three times (dust and scrapes), and snorts. A lane fills on the floor from its feet to exactly where the run will end: the first wall, or 8 units. The lane tracks the hero for 60% of the windup, then locks.
    - **Charge**: 10.5 u/s with red afterimages and a footfall shake. A hit does 2 damage and throws the hero sideways.
    - **Crash**: it hits the wall, which gives a big shake, sparks, rubble and a crack. It bounces back and is **dazed** for 110 ticks with stars circling its head. It cannot be staggered while dazed, but it cannot act either.
    - **Skid**: if the lane ends on open floor, it skids to a stop.
    - **Slam**: when the hero is close, both fists go up (34 ticks, a disc fills), then come down in a shockwave.
    - **Death**: stagger, kneel, a face-first topple (a big thud), then it shatters.
  - **Mite** (`mite.js`): a round teal tick with glowing spots and eyes, and arched legs in a two-frame tripod gait. 8 hp, so one sword hit kills it. They come 5 at a time from one portal (`spawn('mites')`).
    - **Move**: a jittery scuttle that zig-zags and freezes for a few ticks, on a ring 1.85 units round the hero, just outside sword reach. The ring slowly turns.
    - **Windup** (16 ticks): it crouches, rears and blinks red, and a small disc fills where it will land.
    - **Hop**: 11 ticks, up to 1.75 units, then a bite on landing. Walking out of the disc avoids it.
    - **Recover**: 40 ticks next to the hero.
    - **Death**: it flips belly-up with its legs kicking, then pops in a teal spray and a goo stain.
- **Shared behaviour** (`enemy.js`, `manager.js`):
  - **Hit-stun**: every hit adds to `poiseDmg`, which drains over about 1 s. Reaching the archetype's `poise` (0 for all but the brute), or a finisher against poise under 40, staggers it. A stagger cancels the attack, removes its telegraph, returns its token, and stuns it for `hurt` ticks (x1.6 on a finisher). Below poise, a hit only flashes, rocks and knocks the enemy. There is also a recoil in the pose (head and torso snap away from the hit).
  - **Spawn protection**: an enemy ignores hits while in its `spawn` state.
  - **Attack tokens**: a melee windup needs tokens (husk 1, mite 0.5, brute 2). The cap is `TOKENS.base + perAggression * (aggression - 1)`, which is 3 at the defaults. Wisps do not use tokens.
  - **Flanking slots**: melee enemies within 9 units of the hero have their angles round the hero relaxed apart (4 passes, a minimum separation of `min(1.9 rad, 2π/n)`), and each heads for its slot. A crowd therefore surrounds the hero rather than queueing.
  - **Separation**: a soft steering push between neighbours, then a hard pairwise overlap resolve (weighted by `weight`, and collision-aware). No enemy body stays inside the hero's (except a charging brute, which hits instead). Enemies are not solid to the hero.
  - **Walls**: enemies slide on the room's `CollisionWorld`. Knockback slides too (`Hurtable.collision`).
- **One telegraph language** (`telegraph.js`), drawn as floor tiles on the world voxel grid and rebuilt every tick in one instanced draw:
  - the outline appears at once in red;
  - the fill grows outward as a 50% checker of blood with a solid red front, so how full it is shows how soon the attack lands;
  - the outline blinks gold for the last quarter;
  - on the hit frame the whole zone flashes gold and red.

  **The drawn shape is the hitbox**, drawn from the origin locked at the end of the windup. The same pool draws the orb markers and the **floor decals**: rot, scorch, goo, blood and cracks, which dissolve tile by tile.
- **Sounds** (`sfx.js`): synthesised in WebAudio. There is a distinct tell per archetype:
  - husk: a groan;
  - wisp: a rising whine;
  - brute: a snort and roar for the charge, a creak for the slam;
  - mite: chitters.

  Also: swipe, fire, orb pop, charge rumble, wall crash, dizzy tweets, slam, bite, hop, a death per type, thud and crumble. The context is created only after a user gesture.
- **Normal play**: the run/boss placeholder now creates a manager. `debug.spawn('husk'|'wisp'|'brute'|'mite'|'mites', x, z)` works there, alongside combat's `'dummy'|'sparring'`.

## APIs

```js
import { createEnemies, spawnHandler, ENEMY_DATA, DIFFICULTY, TOKENS } from '../enemies/index.js';
const foes = createEnemies(root, { collision: cw, bounds /* {minX,maxX,minZ,maxZ} */, hero /* () => world.hero */ });
foes.spawn('husk' | 'wisp' | 'brute' | 'mite', x, z, { instant?, yaw?, delay? }) -> Enemy
foes.spawn('mites', x, z) -> Enemy[5]            // one portal, flung out to a ring
foes.tick();          // each sim tick, AFTER the hero's combat.tick()
foes.render(alpha);   // each frame
foes.dispose();       // scene exit (also removes them from world.enemies)
foes.alive            // how many are still fighting (0 = the room is clear; dying ones do not count)
foes.list; foes.orbs; foes.clear(); foes.decal(x, z, 'rot'|'scorch'|'goo'|'blood'|'crack', {r, life}); foes.info()
debug.handle('spawn', spawnHandler(foes, fallback?))   // our types, else fallback(type, x, z)
```

- **Enemies join `world.enemies` themselves.** They are ordinary combat targets (they extend `Hurtable`) and are removed when their death animation ends. `e.dead` is true from the killing blow, and `e.dying` is true during the death animation.
- **Tuning is data** (`src/enemies/data.js`):
  - `ENEMY_DATA[type]`: hp, speed, accel, radius, weight, aggression, poise, hurt ticks, token cost, and every attack's windup, active, recover, range, reach, arc, cooldown and damage (plus the charge's speed, stun and width; the orb's count, spread, speed and life; the mite's hop length and ring distance).
  - `DIFFICULTY = { hp, speed, aggression, damage }`: global multipliers. `aggression` divides cooldowns and adds tokens. It **never shortens a telegraph**.
  - Everything is read live every tick, except hp, which is read at spawn.
- **Death effects**: enemies set `ownDeath = true`, and vfx's `kill` binding now skips those targets (see cross-piece edits). An enemy's death burst plays at the end of its own death animation, not on the killing blow.

Events (`core/events.js`):
- `enemy:spawn {enemy, kind, x, z}`
- `combat:enemyWindup {enemy, x, z}`: the same event as combat's sparring dummy.
- `enemy:commit {enemy}`: a husk or mite windup is about to land.
- `enemy:fire {enemy, x, z, yaw}`, `enemy:charge {enemy, x, z, yaw, length}`, `enemy:crash {enemy, x, z}`, `enemy:slam {enemy, x, z}`, `enemy:land {enemy, x, z}`.
- `enemy:attackHit {enemy, ok, reason}`: the attack reached the hero; `ok` is false for a dodge or i-frames.
- `enemy:orbPop {x, z, why}`
- `enemy:hurt {enemy, x, z, dmg, hp}`
- `enemy:death {enemy, x, z, kind}`: `combat:kill` also fires from combat's `strike`.

`audio` can take over sound with `enemySfx.enabled = false` plus these events.

## Debug hooks and showcase params

- **`__GR.debug.enemies(action?, ...)`**:
  - no action: the live manager's info (each enemy's state, hp, token and slot; token use; kills);
  - `'data'`: the tuning tables;
  - `'tune', 'brute', {charge: {speed: 14}}`: live-edit; nested objects merge;
  - `'difficulty', {aggression: 1.5}`;
  - `'freeze', true`: AI and movement stop, and poses hold;
  - `'killall'`: every enemy plays its death;
  - `'clear'`.
- **`debug.spawn(type, x, z)`** in the run/boss placeholder and in `?showcase=enemies` (both modes). Types: `husk wisp brute mite mites`. In the placeholder, `dummy` and `sparring` still work.
- **`?showcase=enemies`** is the LINEUP: the four archetypes side by side, named, with a live state tag under each. They loop through six beats together:
  1. SPAWN;
  2. IDLE;
  3. MOVE (each paces a small ellipse);
  4. TELEGRAPH + ATTACK: windups start at ticks 2, 10, 22 and 36 so that **all four tells are on the floor at once** at about tick 45, and all four land together;
  5. HURT: a plain hit at tick 20, a finisher at tick 80;
  6. DEATH: the killing blow lands at tick 18.

  In the lineup the enemies are puppets: the real archetype code, driven by `act()`, attacking a stand-in point in front of them at the curb. The brute's charge in the lineup crashes into the front curb, which shows the self-stun.
- **Lineup params**:
  - `&phase=spawn|idle|move|attack|hurt|death` holds one beat, looping. Every beat except spawn starts with everyone reset on their marks.
  - `&only=husk|wisp|brute|mite` shows one archetype, centred, at zoom 3.
  - `&zoom`, `&slow`, `&hud=0`.
- **Lineup keys**: 1-6 pick a beat, Left/Right step through the beats, L holds, Space restarts the beat, Z zooms, T slows, H hides the HUD, P/Esc pauses.
- **`?showcase=enemies&fight=husk|wisp|brute|mite|mites|wave`** is FIGHT mode: the real hero (controller, combat, health) against real AI in a 14 x 7.6 unit crypt arena with a front curb. The group respawns 80 ticks after it is cleared, at the spawn spots farthest from the hero. `wave` is a brute, 2 husks, a swarm and a wisp.
  - **DEMO autopilot** (the default; keyboard-style input only) plays it the intended way: it holds a spacing, waits for the telegraph, dashes out, and punishes the recovery (it chases wisps). It dodges 2 threats in 3 and deliberately eats the third (`TANK IT`), so both outcomes are on show. Any key goes LIVE; B returns to the demo.
  - **Params**: `&auto=0`, `&zoom`, `&slow`, `&hud=0`, `&numbers=0`.
  - **Keys**: WASD, J, K, B demo, R respawn, 1-6 pick the fight, Z, T, H, P/Esc.
  - **HUD**: a state tag and an hp bar over each enemy; hits taken, dodged, kills, round and tokens.
- `state().showcase`:
  - lineup: `{id, mode: 'lineup', phase, t, hold, only, zoom, enemies: [info]}`;
  - fight: `{id, mode: 'fight', fight, auto, round, tally, hero, enemies: [info], orbs, tokens, tokenCap, kills}`.
- **Strip recipe** (deterministic):
  1. Load `?showcase=enemies&phase=attack&hud=0`.
  2. Wait for ready, then run `debug.freeze(true)`.
  3. Press Space (restarts the beat at t = 0 with everyone on their marks).
  4. Run `debug.step(N)`, then alternate `debug.step(k)` with a screenshot.

  Useful N:
  - attack: 4, every 6. All the tells are up at about 45, and they land at about 52.
  - death: 16, every 6.
  - spawn: 30, every 8.
  - hurt: 76, every 3.

  Stepping skips hitstop and real-time light pops.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `enemies` row.
- `src/core/placeholders.js` (foundation): the run/boss placeholder creates an enemy manager on the room's collision world. It registers `debug.spawn` through `spawnHandler(foes, <combat's dummy spawner>)`, so both sets of types work and neither registration clobbers the other. It ticks and renders the manager (dummies still tick and render themselves) and disposes it on exit.
- `src/vfx/vfx.js` (vfx): the `kill` binding's `combat:kill` handler skips targets with `ownDeath`. Without this, every enemy death would get vfx's generic burst on the killing blow as well as its own.

## Known gaps

- **Dark in the arena.** The enemies are lit like everything else, and away from torches the lit colours (the brute's plum, the husk's moss) sink toward the floor. Emissive eyes, the wisp and the mites' glow carry them. The showcase room adds three cold overhead lights to compensate. Real arenas (the `arenas` piece) need enough light, or I should add a per-enemy rim or glow.
- **Rigid parts, rotated voxels.** As with the hero, there are no elbows or knees. Rotated parts show stair-stepped edges and sub-texel shimmer, and only the root is texel-snapped.
- **The high camera hides faces.** The husk's and brute's heads are pitched up against their hunch so their faces show. Anything facing away shows the top of the head and the back. The mites were redesigned twice for the top-down read; at zoom 1 they are still small teal blobs with glowing dots.
- **Enemy speed is not compensated for the camera pitch.** Like the hero's, it is isotropic in world units, so it reads slower vertically on screen.
- **The demo is too good against mites.** A swarm usually dies to two or three sweeps. Mites are fodder by design (one hit kills), but in the demo they rarely land a bite. The swarm is more threatening in the `wave` fight, where the hero cannot focus it.
- **No line-of-sight for the wisp** beyond a clear raycast to the hero at the moment it starts a windup. The orb can then be blocked by a pillar the hero steps behind (which is intended).
- **The flanking slots ignore walls.** A slot can sit inside a wall; the enemy then presses against the wall at the closest point.
- **Aim assist targets invisible spawning enemies.** Combat's assist does not know about spawn protection, so it can turn the hero toward a portal.
- **Sounds are first-pass.** They were checked only for console errors, not listened to at length.
- **Performance** is untested on real hardware. Headless it runs at the same frame rate as the other showcases. The telegraph pool rebuilds up to about 1500 tiles per tick when every tell is up.
- **Lineup labels overlap the telegraphs.** The name plates sit on the floor in front of each archetype, where the brute's lane and the husk's sector also go. The labels are outlined, but they cover part of the fill. Use `&hud=0` for clean strips.
- **Afterimages on the charge** are flat pink silhouettes of the whole body (vfx's `ghostRed`). They read as speed but hide detail behind the brute.
- **One zone only.** There are no elite variants, no wave director (that is `arenas` / `run-flow`), and no enemy-vs-enemy friendly fire (a charging brute passes through other enemies).
