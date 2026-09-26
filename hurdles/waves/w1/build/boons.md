# boons: builder notes (wave 1)

## What exists

- **16 boons** (`src/progression/boons.js`), three rarities (common 5, rare 7, epic 4), up to 3 levels each (epics: orbit-blades and phoenix-spark 2). Each has an on-screen effect:
  - chain-spark: hits arc jagged 2D lightning to nearby foes (crackle on a lone target).
  - gale-boots: move speed up, wind streaks and dust behind the hero.
  - searing-brand: hits ignite the foe; flames rise from it and it takes damage over time (no flinch).
  - lodestone: larger pickup pull radius, extra shards per kill, pulls floor pickups in on acquire.
  - bloodrush: kills give haste with red speed streaks.
  - ember-trail: dash leaves burning patches (flames, scorch marks) that hurt foes.
  - third-wave: the overhead finisher launches a crescent shockwave of fire and dust.
  - ghost-dash: dash cuts through foes, leaves after-images, shorter cooldown, longer i-frames.
  - life-motes: kills and finishers shed red motes that fly to the hero; a pip meter by the feet; enough motes heal a heart.
  - retribution: a nova when the hero is hurt.
  - aegis: orbiting shards block one hit, then recharge (bar by the feet).
  - headsman: finisher deals more damage, with a gold crit burst.
  - storm-call: every Nth hit calls a sky lightning bolt (telegraphed, AoE).
  - volatile-soul: foes explode on death, and the blasts can chain.
  - orbit-blades: spectral blades circle the hero and cut foes.
  - phoenix-spark: a killing blow leaves 1 hp and fires a huge flame nova; refilled on `arena:clear`.
- **7 synergies** (`SYNERGIES`): Wildfire, Fire Wraith, Pyre, Thunder Wave, Bloodblades, Shatter, Stormrunner. Each changes behaviour, shows as a gold ribbon on offered cards, and pops a banner on activation.
- **Shrine** (`shrine.js`): pick 1 of 3 on the UI canvas.
  - Cards deal in face down, flip in turn with a rarity-coloured flash and sparks, hover lifts with a shine sweep and orbiting glints, take = squash, burst, rings, and the other cards fall away.
  - Reroll costs 5 shards; a failed reroll shakes.
  - Keyboard, mouse hover and click, and 1/2/3 all work.
- **Pickups** (`pickups.js`): soul shards and hearts.
  - Voxel models; they pop out of kills with bounces and dust, bob and glint, then vacuum toward the hero along a curve with a trail.
  - Shards collect on a pentatonic sound ladder (each shard within 0.5 s climbs a note); hearts play a heartbeat and chord and heal.
  - Hearts wait, and do not vacuum, when hp is full.
  - `arena:clear` pulls everything in.
- `sfx.js`: WebAudio stand-ins for all of the above.
- `?showcase=boons` (see below), and a working shrine and boons in the `?scene=run` placeholder.

## APIs

```js
import { createProgression } from '../progression/index.js';
const prog = createProgression(root, { ctl, health, rig, rng, bounds });
// scene: frame(dt){ prog.frame(dt) }  tick(){ if (prog.blocking) return; ...combat.tick()...; prog.tick() }
//        render(a){ prog.render(a) }  ui(g){ ...; prog.ui(g) }  exit(){ prog.dispose() }
prog.offerShrine({ onClose, offers?: [{id, level}], luck? })  // open the choice; the pick is applied to the hero
prog.boons.give(id) / has(id) / level(id) / list() / synergies() / refresh() / reset()
prog.pickups.drop({ x, z, shards, hearts }) / dropForEnemy(kind, x, z) / vacuumAll() / total / spend(n) / add(n)
prog.hud(g, x, y)   // held-boon strip and shard counter, for the hud piece
// also exported: BOONS, IDS, RARITY, SYNERGIES, rollOffers(rng, heldMap, n, {luck, exclude}), drawBoonStrip, drawShardCounter, drawIcon, boonSfx
```

- Wiring done by `createProgression`: `enemy:die` drops shards and sometimes hearts; `arena:clear` pulls pickups in and refills phoenix/aegis.
- Events out: `boon:acquire {id, level, rarity}`, `boon:synergy {name}`, `boon:hit`, `boon:proc`, `pickup:drop|shard|heart|spend`, `shrine:open`.
- Events in: `combat:hit`, `combat:heroHurt`, `enemy:die`, `hero:slam`, `move:dash`, `arena:clear`.
- Extra boon damage goes through the target's `takeHit`, and sets `hit.boon` so the boon system ignores it. Damage over time bypasses `takeHit`.
- `audio` can set `boonSfx.enabled = false` and listen to the events.
- The boon system wraps `health.hurt` (aegis, phoenix) and writes `ctl.T.speed`, `dashCooldown` and `dashIframes`; `dispose()` restores them.
- `run-flow` should call `offerShrine` after `arena:clear` (freeze the sim while `prog.blocking`) and share one `prog` across rooms. Boons persist only if the same system, or a copy of its held map, is carried over: `createProgression` creates a fresh one, so run-flow should keep one instance or re-`give` the held boons.

## Debug hooks and showcase params

- `debug.give(id)` (contract hook). `__GR.debug.boons(action, a, b)` with actions:
  - none: info
  - `shrine`
  - `pick, i`
  - `reroll`
  - `drop, shards, hearts`
  - `shards, n`
  - `reset`
  - `ids`
- `state().boons` lists held ids. `state().showcase` gives held boons with levels, synergies, shards, the shrine phase and cards, and counts of fires, motes and burning foes.
- `?showcase=boons`: an attract loop of shrine, pick, hero shows it off on dummies, then the next round. Params:
  - `&held=a,b`, `&offers=a,b,c`, `&shards=n`, `&auto=0`
  - `&give=id[,id]&stacks=n`: dummy room where a bot fights real enemy waves and pickups drop and vacuum in
  - `&bot=0`, `&enemies=husk,mite,...`, `&waves=0`, `&zoom`, `&slow`, `&hud=0`
- Keys: E shrine, R restart, B bot, Z zoom, T slow, H hud. Any key takes over from the bot.
- In `?scene=run`, B opens the shrine.
- Headless note: the sim clock is clamped per frame, so the shrine's real-time timeline runs slower than wall time in headless Chromium. Wait about 5 s before pressing keys, or use `debug.boons('pick', i)`.

## Cross-piece edits

- `src/core/showcase.js`: `boons` row now loads `src/progression/showcase.js`.
- `src/combat/combat.js`: added `export const hooks = { damage }` and a two-line call in `strike()`, so Headsman can scale the finisher.
- `src/core/placeholders.js`: the run/boss placeholder creates the progression, freezes the sim while the shrine is open, ticks, renders and draws it, shows the HUD strip, and B opens the shrine.

## Known gaps

- Card art is 12x12 icons drawn in code. Some (gale-boots, ghost-dash, third-wave, life-motes) are only passable at a glance.
- Cards only render in the 640x360 layout, and the shrine has no gamepad-specific hints (confirm and left/right work through bindings).
- Boons are not persisted between scenes and there is no run-level save. Rarity `luck` exists in `rollOffers` but nothing feeds it.
- Enemy-side visuals: burning shows as flames only, with no tint on the enemy. Frost or slow boons are missing because enemies have no per-instance speed.
- Damage numbers for DoT come through `combat:damage` and can clutter with many burning foes.
- Effects were checked in headless Chromium at low fps: no GPU timing, no listening to sounds. Balance numbers are untuned.
- 2D lightning and the shrine draw on the UI canvas, so they overlay everything (no depth).
- The showcase hero is drawn from above at zoom 2, and the 3D shrine model is hidden behind the cards while choosing.
- Synergy pairs beyond the 7 (for example Headsman with Storm Call) do not exist.
- The Aegis and Phoenix wrappers only see `health.hurt` calls; damage that bypasses it (falls or crushes in corridors) is not blocked.
