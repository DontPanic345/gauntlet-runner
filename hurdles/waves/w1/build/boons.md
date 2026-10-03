# boons: builder notes (wave 1)

## What exists

All of it is in `src/progression/`.

- **16 boons in 4 rarity tiers** (`boons.js`), each with a stack limit and numbers per stack. The card text is generated from the same numbers the effects use.
  - **Common:** keen-edge (crits), fleet-foot, soul-hunger, bulwark, kindling, heavy-hand.
  - **Rare:** chain-spark, ember-trail, leech, storm-dash, echo-blade.
  - **Epic:** moon-wave, ember-orbit, reaper.
  - **Legendary:** starfall, phoenix.
- **6 synergies** (pairs that do something new, visibly):
  - thunderhead (chain-spark + storm-dash): dash thunder chains onward and strikes wider.
  - wildfire (kindling + ember-trail): burning foes explode on death.
  - twin-moons (moon-wave + echo-blade): the ghost also throws a moon wave.
  - harvest (leech + reaper): every reap heals a heart.
  - lightning-rod (keen-edge + chain-spark): arcs can crit, and a crit forks gold lightning to every foe in reach.
  - solar-flare (ember-orbit + kindling): the orbs ignite.
- **What each boon shows in combat** (`effects.js`):
  - **keen-edge:** a gold star, a ring, a small ember slash, a light pop and a `CRIT!` word.
  - **fleet-foot:** wind streaks while running, sky sparks off footsteps, and cyan afterimages on the dash.
  - **soul-hunger:** more shards spill, the magnet reaches further, and a ring pulses at the hero while collecting.
  - **bulwark:** three rune tablets orbit the hero. A blocked hit shatters them (sky burst, shockwave, `BLOCKED`, foes shoved back), and they regrow one by one.
  - **kindling:** flame sprites and embers rise off burning foes, with damage ticks.
  - **heavy-hand:** more knockback, and a bone-coloured quake ring plus dust when the finisher slams.
  - **chain-spark:** jagged 2D lightning with an ink outline and a fork, a cool spark at each target, one jump every 3 ticks.
  - **ember-trail:** the dash leaves burning floor tiles on the voxel grid, flickering and cooling to blood red, with fire particles.
  - **leech:** blood motes burst out of a kill and home into the hero. Every N motes heals 1, with a heal effect and `+1 HEART`.
  - **storm-dash:** a bolt from the sky where the dash ends, a sky shockwave, and bolts to up to 3 foes.
  - **echo-blade:** a cyan afterimage of the swing pose appears half a step behind the hero 9 ticks later. A cyan slash from it hits again.
  - **moon-wave:** the finisher throws a voxel crescent that pierces and sprays light.
  - **ember-orbit:** 2 to 4 gold coals orbit the hero with fire tails.
  - **reaper:** a skull hangs over foes under 35% health. The next hit on one plays a rose scythe arc, rising souls and `REAPED`.
  - **starfall:** every 6th hit puts a converging gold ring reticle on the nearest foe. A voxel star streaks down and bursts (gold flash, double ring, embers, shake, crit numbers).
  - **phoenix:** a killing blow is refused once per run. It plays a fire nova (flash, rings, wings of fire cubes, foes thrown and ignited), heavy shake and hitstop, and `REKINDLED`.
- **Pickups** (`pickups.js`): soul shards (a small glowing crystal) and hearts (they beat).
  - **Drops:** enemies drop shards and hearts, and so do urns, crates and barrels. A drop pops out in an arc, bounces twice with dust and a squash, then bobs and twinkles.
  - **Vacuum:** once settled, a pickup is pulled to the hero within the magnet radius, on a swirling curve with a trail. Collecting it puts a flare at the chest.
  - **Clear:** an arena clear vacuums the whole room.
  - **Sound ladder:** shards collected within 24 ticks of each other climb a pentatonic scale (15 steps).
  - **Hearts** only fly to a hurt hero.
- **The shrine** (`shrine.js`): a stepped altar with rune inlays, a pillar and a bowl, and a floating soul crystal with a sky light. It rises out of the floor (shake, dust), shows an `E OFFER` prompt, flares when used, and goes dark after the pick.
- **The choice screen** (`shrine.js`, `cards.js`, `icons.js`), drawn in 2D at internal resolution in palette colours:
  1. Letterbox bars and a dither dim come in.
  2. Three motes arc from the shrine to the card slots. The card backs land with a drop, an overshoot, a thunk and dust.
  3. Each card flips in turn (squash, a white frame), then gives a rarity burst. A legendary flashes gold and gets slowly turning rays.
  4. The selection lifts, gets an outline with breathing corner brackets and a shimmer sweep, and its icon bobs. A tick sound plays per move. The other cards' art dims, but their text stays readable.
  5. On a pick, the card presses in and pops, and the other two fall away dissolving. The chosen card folds into its icon, which flies into the hero. The hero bursts in the rarity colour, and a banner says `BOON GAINED` or `LV n`.
- **Card content:** a rarity tab, a medallion with a 16x16 icon at 3x (with rays for rare and up), the name, the description at the stack it will become (highlighted numbers), a synergy row, and level pips (`NEW` or `LV 1 > 2`).
- **Choice input:**
  - A/D, arrows, 1 to 3, or mouse hover move the selection.
  - J, E, Enter, or a click on a card takes it.
  - A confirm pressed up to 0.15 s before the cards are ready is buffered.
  - The hero is locked while choosing. The world keeps running behind the screen.
- **HUD stand-in** (`hud.js`):
  - **Shard counter** (top right): pops on each shard, with a `+n` tally.
  - **Boon bar** (bottom left): rarity frames and stack pips. An icon flashes white and hops on a proc and greys out when its boon is spent or down. A gold gem marks synergy members. It also shows the leech mote meter, the ward regrow bar and the starfall hit counter.
  - **Synergy banner** when a pair completes.
- **Sound** (`sfx.js`): every boon, pickup and card event is synthesised in WebAudio and rate-limited.
- **Normal play:**
  - The `run` scene drops shards and hearts.
  - The arena clear vacuums the room, and 110 ticks later a shrine rises near the centre of the room. E opens the choice.
  - Boons persist across arena, corridor and arena, and work in the `gauntlet` corridors too.
  - Progress resets on title, gameover and victory.

## APIs

```js
import { createProgression } from './progression/index.js';
const prog = createProgression(root, { ctl, anim, rig, health, combat, arena?, hud = true, drops = true, shrineOnClear = false });
// tick (after combat.tick() and the room's tick): prog.tick()   frame: prog.frame()   render: prog.render(alpha)
// ui: prog.ui(g)   exit: prog.dispose()
prog.spawnShrine(x, z, { rise }); prog.openChoice(ids?); prog.choosing; prog.pickups.drop('shard'|'heart', x, z, n); prog.pickups.vacuum()

import { BOONS, RARITY, SYNERGIES, progress, giveBoon, resetProgress, rollChoice } from './progression/boons.js';
progress.held (Map id -> stacks), progress.order, progress.shards, progress.spent   // module-level run state
giveBoon(id, { quiet }) -> { ok, id, stacks, synergies }   rollChoice(3, { salt, exclude })
import { procHit } from './progression/effects.js';   // a boon-style hit: damage, number, kill event, no combat:hit
import { boonSfx } from './progression/sfx.js';      // boonSfx.enabled = false when `audio` takes over
```

- Events emitted:
  - `boon:gain {id, stacks, quiet, synergies}`
  - `boon:choice {ids}`
  - `boon:picked {id}`
  - `boon:proc {id, x, z}`
  - `pickup:shard {x, z, total, step}`
  - `pickup:heart {x, z, hp, healed}`
  - `pickup:drop {kind, n, x, z}`
  - `shrine:ready {x, z}`
- `combat:damage` from procs carries `proc: true`.
- **For `run-flow`:** pass `shrineOnClear: false` and call `prog.spawnShrine()` and `prog.openChoice()` yourself. Note that `createProgression` must be created per scene with that scene's hero.
- **For `hud`:** pass `hud: false` and read `progress` and the events above.

## Debug hooks and showcase params

- `debug.give(id)`:
  - the contract hook, now implemented;
  - also accepts `'all'` and `'a,b'`;
  - returns `{ok, results, boons}`.
- `__GR.debug.boons(action?, ...)`:
  - no action: held boons, shards, synergies, and the runtime, pickup, shrine and choice state;
  - `'list'`, `'choice', ids?`, `'select', i`, `'pick', i`, `'take', id`, `'reset'`, `'shards', n`;
  - `'drop', kind, x, z, n`, `'vacuum'`, `'shrine', x, z, rise?`, `'roll', n`, `'star'`;
  - `'uiSpeed', s`: slows the card screen's own clock, for strips.
- `?showcase=boons` is the shrine and the choice screen in the Antechamber. In DEMO it rises, walks up, offers, browses and picks (it prefers upgrades, then the rarest card), re-arms, and resets after 6 picks, so later rolls show upgrade and synergy cards.
- `?showcase=boons&give=<id>[,id...]` is the dummy room. Use `id:2` for stacks, or `all`.
  - Four puppet husks stand still and never attack. They die, drop loot and respawn through portals.
  - The DEMO pilot combos, dashes through the group, and for bulwark and phoenix takes a labelled scripted hit.
  - The top-left panels show each held boon's card text and proc count.
- Params:
  - both modes: `&auto=0`, `&zoom=1..3` (default 2), `&hud=0`, `&slow=<s>`, `&seed=<n>`;
  - choice mode: `&offer=a,b,c`, `&at=open`, `&uislow=<s>`.
- Keys:
  - choice: WASD, E, A/D, 1-3, J/E/Enter, R reroll, B demo/live;
  - room: WASD, J, K, B, R respawn, Z, T, H.
- `state().showcase = {id, mode, auto, give, gives, pilot, zoom, progression}`. `state().boons` is filled.
- **Strip recipe:**
  1. Load `?showcase=boons&give=X&hud=0` with `--wait-ready`.
  2. Run `debug.freeze(true)`, then `debug.step(N - __GR.frame)`, then alternate `step(4)` with a shot.
  3. Useful N: about 76 for the first combo, about 175 for the first dash (dash boons), about 236 for the scripted hit (bulwark, phoenix), about 262 for the first star.
  4. For the choice screen, use `&at=open&uislow=0.2` and a burst every 120 ms.

## Cross-piece edits

- `src/combat/combat.js` (combat):
  - In `HeroCombat.post`, an optional `this.modHit?.({target, spec, dmg, step})` can return `{dmg, spec}`. It is used for crits and knockback.
  - In `HeroHealth.hurt`, after the i-frame check, an optional `this.guard?.(amount, source)` refuses the hurt when it returns true. It is used for the ward and the phoenix.
  - Both are no-ops when unset.
- `src/core/placeholders.js` (foundation): the run/boss placeholder creates `createProgression` (with `shrineOnClear` in run), and ticks, renders, frames, draws and disposes it. I added a `frame()` to the scene for the choice input.
- `src/world/corridor.js` (gauntlet): the `gauntlet` scene creates a progression with `drops: false`, so held boons work in corridors. It is one import plus tick, render, frame, ui and dispose.
- `src/core/showcase.js` (foundation): set `load` on the `boons` row.

## Known gaps

- **`debug.kill()` can be refused.** With a ward up or an unspent phoenix, `debug.kill()` and `debug.hurt()` are refused once, because they go through `HeroHealth.hurt`. A second call kills.
- **Procs skip `combat:hit`.** So vfx's and combat's own hit sparks do not play on boon damage (each boon draws its own). Overlapping damage numbers from procs and sword hits can stack into unreadable pairs such as "105".
- **Damage over time flinches enemies.** Burn ticks and trail ticks go through `takeHit`, so they add poise damage and a tiny flinch.
- **Fleet foot's running wind is subtle.** At zoom 1 it reads mainly through the dash afterimages.
- **Small effects at game scale.** The reaper skull, the ward runes and the shards are small at zoom 1. The showcase runs at zoom 2.
- **Bolts are 2D, on the UI canvas.** They draw over everything, including walls and the HUD, and are not quantised.
- **The moon wave is a rotated voxel model.** It shows stair-step shimmer at diagonal yaws.
- **Shards have no use yet.** Nothing spends them: no shop or reroll cost. That belongs to `run-flow` or a later piece.
- **The pool is limited.** Rolls never offer more than 3 cards, and there are no rarity boosts by depth.
- **The pick screen is not juiced on the 3D side.** The world keeps running behind it rather than being slowed.
- **The shrine light takes a slot.** It is one more of look's 8 pooled lights. In a lit arena it can push a farther torch out.
- **The showcase is not a fight.** Puppet husks never attack, so bulwark and phoenix are demonstrated with a labelled scripted hurt. With live enemies, `debug.spawn` works in the dummy room.
- **The sounds are first-pass.** They were checked for console errors only, not listened to at length.
- **Card art is generated with nearest-neighbour scaling during the flip.** That is intended pixel art, but mid-flip pixels are uneven.
