# boss: builder notes (wave 1)

## What exists
- **The Warden** (`src/boss/warden.js`, `models.js`): a voxel jailer-knight about 3x hero height (model scale 1.32), horned barrel helm with a T slit and glowing eyes, spiked pauldrons, key belt, red tabard, a prisoner cage on his back, chain and spiked ball made of interlocked links. A combat `Hurtable`, hit through `takeHit`. Armored (x0.6) except in punish windows (x1.35 to 1.8, gold stars circle his head); enough chip damage in 3 s staggers him.
- **Phase 1, the chain**: SWEEP (red ring fills, bright wedge marks the start, 1 revolution; inside 1.6 units of him or outside 4.3 is safe, or dash through), LASH (red lane locks 22 ticks before the throw, ball crater + reel-in).
- **Phase 2, the maul**: SLAM (red disc on where you stand, locks 26 ticks before impact, then a shockwave ring you dash through), double slam, LEAP (crouch, disc, land, ring, kneel).
- **Phase 3, the cage**: 30 iron bars rise round the rim, SUMMON (rune marks, up to 3 husks via the enemies system), and everything mixed, the sweep does 2 revolutions.
- **Phase transitions** (invulnerable, about 150 ticks): hitstop, white flash, stagger to a knee, armour cracks glow ember, shockwave rings and light pops, he rises and roars, a ring throws the hero back, banner text. Phase 3 also raises the cage and re-lights the braziers.
- **Intro** (372 ticks): dark arena, letterbox, slow pan, heavy steps, head rises, eyes ignite, roar with white flash, braziers ignite in sequence, name card "THE WARDEN / JAILER OF THE DEEP", camera cut back, boss bar fills. E skips after 50 ticks.
- **Death** (about 200 ticks): hitstop, white flash, slow-mo, camera cut, the maul flies out, he reels, kneels while armour plates fly off in beats of ember light and rings, rises into a column of light, bursts (debris spray, gold rings, braziers turn gold, cage drops), his helm bounces, the gaol key rises from the crater, "THE WARDEN FALLS" banner with fanfare. Walk into the key to emit `boss:cleared`.
- **Round arena** (`arena.js`): pit floor with blood sigil, apron, cell-lined ellipse of walls, 6 braziers with real lights, cage, `Zone` (telegraph painter), `Rings` (shockwaves, also the hitbox), floor crack decals.
- **Boss bar**, phase notches, banners, screen flashes; synthesised sounds (`sfx.js`) on `boss:*` events.
- **Bot** in the showcase plays the hero (dodges, dashes rings, punishes windows). Any key takes over.

## APIs
```js
import { createBossScene, BossFight, Warden, TUNE, INTRO_TICKS } from './boss/index.js';
scenes.define('boss', createBossScene({ intro: true, phase: 1 }));   // whole scene: hero, combat, enemies, vfx, fight
// or use the parts:  new BossFight(root, { hero: health, ctl, cw, sys, heroRig: rig, phase, intro, hpMul, zoom })
//   fight.tick() / fight.render(alpha) (after anim.render) / fight.ui(g) / fight.dispose()
//   fight.state: intro | fight | dying | won ; fight.boss ; fight.info()
```
Options for `createBossScene`: `{phase 1|2|3, intro, bot, hud, hp (fraction), zoom, showcase, knobs, hpMul}`.
Events: `boss:intro`, `boss:fightStart`, `boss:phase {to}`, `boss:phaseStart`, `boss:windup {attack}`, `boss:attack`, `boss:slam`, `boss:land`, `boss:lashHit`, `boss:summon`, `boss:hurt {hp, dmg, armored}`, `boss:crit`, `boss:clang`, `boss:stagger`, `boss:punish`, `boss:roar`, `boss:step`, `boss:ring`, `boss:heroHit {tag}`, `boss:deathHit`, `boss:deathBurst`, `boss:defeated`, `boss:key`, `boss:cleared` (run-flow: move to the ending). Tuning is data in `TUNE` (warden.js), live editable.
Hero damage: sweep 1, lash 1, slam crater 2, rings 1, leap 2. Boss hp 640.

## Debug hooks and showcase params
- `?showcase=boss` (bot plays, no intro), `&intro=1`, `&phase=1|2|3`, `&death=1` (phase 3, one hit from death), `&hp=<0..1>`, `&bot=0`, `&hud=0`, `&slow=<x>`, `&zoom=1..3`, `&cx= &cz=` (camera centre for close-ups, e.g. `zoom=2&cz=-3.6`), `&attack=sweep|lash|slam|slam2|leap|summon` (first attack).
- Keys: 1 2 3 phase, I intro, X kill, B bot, R restart, H hud, E skip intro.
- `__GR.debug.boss(action, arg)`: state, phase n, attack name, hp fraction, kill, intro, skip, restart, god, tune, part name. `state().showcase` has the fight info.
- `?scene=boss` now runs the real fight (`?intro=1`, `?phase=` work).

## Cross-piece edits
- `src/core/showcase.js`: `boss` load wired.
- `src/main.js`: `?scene=boss` lazy-loads `boss/scene.js` and defines the `boss` scene (run-flow should define its own instead).

## Known gaps
- Standalone hero death just revives after 110 ticks; no game-over flow (run-flow owns that).
- Seen from the 50 degree camera the Warden reads best at zoom 2; at zoom 1 his legs are hidden and he looks top-heavy. Recover poses (bent over after a slam or sweep) look awkward from above.
- Cracks and armor are overlays and particles; no per-part armour loss during the fight.
- Husk summon uses stock husks; no boss-specific minions. Bot is simple and can die.
- Sounds are stand-ins; no music. Transition spectacle was judged from stills and one video, not tuned by feel.
- The intro's darkest part is still quite dark; dash reaction windows are as designed but untested by a human.
- Performance not measured on a GPU (Zone repaints up to 5000 cells per tick).
