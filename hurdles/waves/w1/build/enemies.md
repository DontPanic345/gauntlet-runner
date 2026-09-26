# enemies: builder notes (wave 1)

## What exists

Four archetypes in `src/enemies/`, each a combat `Hurtable` (so `HeroCombat` hits them through `takeHit`) with spawn-in, idle, move, telegraph, attack, hurt, death.

- **Husk** (green corpse, lurching gait): curves round to flank, raises both arms overhead over 30 ticks while a red sector fills on the floor and the body pulses ember, then slams (sector = hitbox, 1.12 reach + hero radius, 68 degrees each side). Staggers when hit (twice as long on a finisher). Death: falls over away from the blow, bounces, lies flashing, then crumbles into moss/leaf/bone chunks and dust.
- **Ember Wisp** (floating flame, dark eyes, flame crown): keeps 2.7 to 4.4 units from the hero and drifts round it. Telegraph is 40 ticks: the head swells, a white-hot core grows in front, and a dotted aim line on the floor tracks the hero, then locks for the last 16 ticks and blinks gold. It then fires a slow orb (3.3 u/s, 5 s life) that trails embers and bursts on walls or the hero. A dash i-frame passes through it harmlessly. Death: a white frame, then a shatter of ember/flame/gold, an ember fountain and a light pop.
- **Brute** (pale stone slab, bone horns, ember eyes): plods in; when it is 1.4 to 7.5 units away it rears back, arms up, and paws the ground three times (dust and small shake) while a red lane fills along the floor. The lane is cut short where it would meet a wall (uses `collision.raycast`). It locks direction 22 ticks before the charge, so a sidestep works. It charges (accelerates to 9.2 u/s), hurts for 2 hearts, and on hitting a wall or pillar it stuns itself for 120 ticks: hitstop, shake, dust and shockwave, dizzy stars circling, and 1.6x damage taken. It has super-armour: hits flash and squash it but do not interrupt it (only the stun leaves it open). Death: shudders, kneels, topples with a shockwave and shake, lies flashing, then bursts.
- **Mite** (pink beetle, white eyes): `spawnGroup('mite', x, z, 5)` makes the swarm of five. They scurry on zigzag paths with their own bias so the group fans out round the hero. Attack: squat and flicker over 17 ticks, a red disc marks the exact landing spot, then a 10-tick leap along an arc. One hit kills (hp 8, slash does about 10). Death: pop of pink/red/bone chips.
- **Common**
  - Spawn: an ember portal rune ring, then the body pops up with dust, a light flash and a squash (invulnerable for 46 ticks; `delay` staggers a group).
  - Everything animates by pose, not by swapping meshes: bob, lean, arm and leg swing, squash and tilt from `Hurtable`.
  - The hit flash is white; a telegraph pulse tints the body ember.
  - A small hp bar appears above an enemy for 2.5 s after a hit, and always while a brute is stunned (with a stun timer line).
- **Crowd rules** (`src/enemies/index.js`):
  - **Attack slots**: only 2 melee (husk and brute), 1 ranged, and 2 swarm attackers may be in a windup or strike at once (`ATTACK_SLOTS`, plus 1 at aggression 1.5 and up). The rest circle the hero at about 1.9 units and wait their turn.
  - **Flanking**: each husk carries a side (`flankSide`) and bends its approach toward it while far, so a group arrives from different directions.
  - **Separation**: any two bodies closer than 1.12x their combined radii are pushed apart every tick, with lighter bodies giving way to heavier ones. Enemies are also pushed out of the hero's body. A charging brute is not pushed.
- **Difficulty is data**: `src/enemies/data.js` has per-type hp, speed, turn, damage, reach, phase lengths and cooldowns. `knobs = {hp, speed, aggression}` scale them all live. Aggression shortens cooldowns and speeds orbs, and never shortens telegraphs.
- **Sounds** (`src/enemies/sfx.js`): synthesised stand-ins on `enemy:*` events (windup cue per type, attack, hurt, death, flop, paw, wall crash, orb burst, spawn pop). It uses its own AudioContext, created only after a user gesture.
- **Showcase** (`?showcase=enemies`): a looping reel of about 20 s (see below), and a fight mode where a bot plays the hero and dashes telegraphs.

## APIs

```js
import { createEnemySystem, ENEMIES, ATTACK_SLOTS, knobs, setKnobs, TYPES } from './enemies/index.js';

const sys = createEnemySystem(root, { hero, collision, bounds, list: world.enemies, ai: true, bars: true });
//   hero: anything with x, z, dead, hurt(amount, {x, z}) (HeroHealth). Assign sys.hero later if it changes.
//   collision: CollisionWorld (enemies slide on it; the brute's wall stun and orbs use it). bounds: {minX,maxX,minZ,maxZ}.
//   list: usually world.enemies. The system pushes enemies in and removes them when their death animation is done.
sys.spawn('husk'|'wisp'|'brute'|'mite', x, z, { delay?, yaw?, hpMul?, flank? }) -> Enemy
sys.spawnGroup('mite', x, z, n = 5, { radius?, delay? }) -> Enemy[]
sys.handleSpawn(type, x, z)          // debug.spawn contract, also 'mites'/'swarm' -> group of five; null for unknown types
sys.alive()                          // enemies not dead (dying ones stay in the list until gone)
sys.kill(id | type | 'all'); sys.clear(); sys.dispose()
sys.tick(); sys.render(alpha); sys.ui(g)     // in the scene's tick / render / ui
sys.ai = false                       // enemies stop chasing (they still finish attacks)
sys.allowed(cat); sys.slotsFull(cat); sys.slots   // attack slot sets: melee / ranged / swarm
sys.orbs                             // live wisp orbs {x, y, z, vx, vz, ...}
```

- **Enemy fields**: `kind`, `state` (`pending spawn move windup strike recover stagger dying`, plus `charge telegraph stunned` for the brute, `charge fire` for the wisp, `windup leap` for the mite), `hp`, `maxHp`, `dead`, `gone`, `solid`, `vulnerable`, `slot`, `kill()`, `startAttack()` (forces a telegraphed attack in the facing direction, harmless).
- **Scene must call `vfx.attach(root)`** and tick, render and ui the vfx, or portals, death bursts and dust do nothing (the vfx calls return false safely).
- **Hero contact**: enemies call `hero.hurt(amount, {x, z})`, so i-frames, dodge and death are combat's. Husk, wisp orb and mite deal 1; the brute deals 2.
- **Events** (`core/events.js`; the `audio` piece can hook them):
  - `enemy:spawn {enemy, kind, x, z}`, `enemy:pop`
  - `enemy:windup {enemy, kind}` and `enemy:attack {enemy, kind}`
  - `enemy:hurt {enemy, dmg, hp}` and `enemy:die {enemy, kind, x, z, hit}`
  - `enemy:flop` (husk or brute hits the floor), `enemy:paw` (brute stomp), `enemy:wallStun {enemy, x, z}`, `enemy:orbBurst {x, z, onHero, fizzle}`
  - Combat's own `combat:hit`, `combat:kill` and `combat:damage` fire as for any target.
- `enemySfx.enabled = false` (from `src/enemies/sfx.js`) mutes the stand-in sounds.
- Telegraph shapes for other pieces: `src/enemies/telegraph.js` (`makeTele`, `sectorCells`, `laneCells`, `discCells`).

## Debug hooks and showcase params

- `__GR.debug.spawn(type, x, z)`: `husk`, `wisp`, `brute`, `mite`, `mites` (group of five). It works in `?scene=run|boss` (foundation placeholder; `dummy` and `sparring` still work there) and in `?showcase=enemies`. It is not overridden in `?showcase=combat`, which keeps its own dummies.
- `__GR.debug.enemies(action, ...)` (exists once `src/enemies/index.js` is imported):
  - no action or `'list'`: types, knobs, slot counts, all enemies
  - `'knobs', {hp, speed, aggression}`
  - `'kill', 'all' | id | type`
  - `'attack', id | type | 'all'`: force a telegraphed attack on ones in `move`
  - `'ai', false`
  - `'group', type, x, z, n`
  - `'clear'`
- `?showcase=enemies` (reel by default). Params:
  - `&fight=husk|wisp|brute|mite|all`, `&n=<count>` (mite: number of groups of five)
  - `&bot=0` (start LIVE; any key takes over from the bot)
  - `&at=spawn|idle|husk|wisp|mite|brute|death`: start the reel at a beat, with a full cast already standing
  - `&zoom=1..3`, `&slow=<s>`, `&hud=0` (clean stills), `&bars=0`
  - `&hp= &speed= &aggr=`: difficulty knobs
  - `&cx= &cz=`: camera look-at. **Note:** the camera rig still clamps toward the hero, so this only nudges the view.
- **Reel beats** (about 20 s at 60 Hz): spawn all four, the cast with names, husk telegraph and slam, wisp telegraph and orb, mite squat and leap, brute lane and charge into the wall (stun), then deaths of each in turn. Name plates and a one-line "tell" are shown under each.
- **Keys**: 1 husk, 2 wisp, 3 brute, 4 mite swarm, 5 all, V kill all, C clear, B toggle bot, L reel/fight, G difficulty cycle (easy/normal/hard), Z zoom, T slow, H hud, J/K/WASD play.
- `__GR.state().showcase` = `{id, mode, beat, reelT, bot, wave, kills, zoom, knobs, slots, enemies[], health}`. `state().enemies` lists every entry of `world.enemies` including dying ones (`hp` 0).
- **Capturing telegraphs**: freeze and step. `debug.freeze(true)`, then `debug.step(n)` with a wait and a shot after each. Use `&at=husk|wisp|mite|brute|death` to land on the beat.

## Cross-piece edits

- `src/core/showcase.js`: set `load` on the `enemies` row.
- `src/core/placeholders.js` (foundation): the run/boss placeholder now attaches `vfx`, creates an enemy system (`world.enemies` is its list), ticks, renders and draws it, and `debug.spawn` tries the enemy types first, then falls back to combat's `dummy` and `sparring`. Non-managed enemies (the dummies) are still ticked by the placeholder. `run-flow` replaces this scene, and it should do the same three things.

## Known gaps

- **Look**
  - The palette quantise darkens cool colours: the brute reads as dark grey-blue against the floor, and the husk's eyes and the wisp's dither look speckled at zoom 1.
  - The wisp reads as a burning skull-ball from the fixed camera. Its tail streams back and up, but is short.
  - Hit reactions for husk, wisp and mite are a stagger and a lean; there are no hurt poses beyond that.
- **Behaviour**
  - Wisp orbs cannot be hit or reflected by the hero (they are not combat targets).
  - There is no ranged line-of-sight check for the wisp: it fires through pillars (the orb bursts on the pillar).
  - AI does not path round obstacles (it steers straight and slides). It is fine in open rooms and would need help around pillar clusters.
  - The brute's charge lane starts at its own position; with more than one brute both may claim a melee slot at once.
  - Enemies have no aggro range: they always chase (`sys.ai = false` freezes them). Arenas that want dormant enemies must set that per room.
  - Enemy-vs-enemy separation is per pair, so a tight crowd of more than about 12 can still jostle for a few ticks before settling.
- **Feel**
  - The bot in fight mode is deliberately simple: it dodges husk, brute, mite and orb telegraphs about once every 34 ticks and clears waves without damage most of the time.
  - Numbers, sparks and hp bars come from combat's stand-in fx and this system's own bars; the `hud` piece should replace them (`bars: false`).
  - The death bursts use vfx's shared recipe with the enemy's palette; only the husk (flop), brute (topple) and wisp (white frame, then shatter) have custom sequences before it.
- **Sound**: stand-ins, checked for errors only, not listened to.
- **Not verified**: 60 fps with a full arena on a GPU (headless is software), gamepad, and zoom 1 stills of every state.
