# vfx: builder notes (wave 2)

Wave 1 notes (`hurdles/waves/w1/build/vfx.md`) still describe the core pools, ramps, the ambient
layer and most APIs. This file covers what changed in wave 2.

## What exists

- **Kill burst** (`vfx.kill`, `src/vfx/effects.js`). It is bound to `combat:kill` for **every** target, `ownDeath`
  enemies included. The enemies' own death animations and their later `vfx.death` crumble run alongside it.
  The beats, in sim ticks after the kill:
  - **0**: the target's own white hit flash (combat) holds through hitstop. vfx adds a tight white pin light.
  - **2-3**: the body is redrawn as a solid **ink silhouette** for 2 ticks (`vfx.silhouette`).
    The silhouette is a front-drawn, hard-edged ghost copy of the enemy's `group`.
  - **2**: a **jagged starburst** (new `BURST` shape) with radius 1.3 x size: about 2.5x a husk's width.
    - The outer burst has 12 spikes of random alternating length, an `ember` body and a `torch` core,
      inside a 2-texel `ink` outline. A smaller `torch`/`white` burst sits inside it.
    - It pops past full size in 2 ticks, then holds. From about 45% of its life it is eaten from the
      inside out in steps, so only the spike tips are left at the end.
    - It draws over the bodies near it (depth bias 0.06), so a hero standing in front does not hide it.
  - Also on tick 2:
    - a hot `ember`/`torch` floor shockwave out to 1.9 x size, with an `ink` ring chasing it;
    - a `flame` light pop with radius 3 x size;
    - radial `killSpark` streaks, a third of them along the blow;
    - a **black smoke puff**: `ink` to `night` to `shadow` voxel cubes. They start 3 to 5 ticks
      late, out from behind the burst, then blow outward and swell (`P.grow`).
  - **5**: chunks in the body's `debris` colours that bounce and dissolve. Extra chunks go through
    `look.impact.chips`, and those **stay on the floor** for the rest of the room. Embers drift up for 1 to 2 s.
  - **9**: a slow column of dark smoke rises and swells over about 1.2 s.
  - **3 (floor)**: a **blast mark** made with `look.impact.splat`. Radiating soot spokes, 7 to 9 of them,
    start as `ember`/`flame` cells that cool to `night`/`shadow` after about 1.5 to 2 s. A `night`/`ink`
    soot disc sits under the body, and look's blood pool spreads over its middle. The mark stays until the scene exits.
  - **Size** comes from the target (`killSize`: max of h/1.5 and r/0.4, clamped to 0.45..3).
    A husk is 1, the brute 1.45, a mite 0.45 and the Warden 3. Everything scales with it.
    Targets without `ownDeath` (dummies, the Warden) also get the `vfx.death` crumble on top.
- **Hit spark** (`vfx.hitSpark`):
  - The thin gold four-point star and the white core disc are replaced by a small jagged burst:
    a `white` core, an `ember` rim (or the palette's rim colour), and a fat ink outline.
    Its radius is 0.42 + 0.1 x power, and it is drawn 0.12 units past the contact point along the blow.
  - The first 4 streaks are 2 px thick and longer.
  - The light (when `light: true`) is a tight `white` pop.
- **Hit binding** (`vfx.bind(['combat'])`, bound by `combat/fx.js` in every scene):
  - After the target's white flash, one **ink silhouette frame** is drawn for 2 ticks. This gives
    the white/black alternation.
  - A tight white pin light (radius about 1.2 to 1.6, 50 ms) sits on top of combat's warm pool light.
- **Death crumble** (`vfx.death`, which the enemies call when a corpse breaks):
  - The gold star and torch disc are replaced by a small burst.
  - A dark smoke puff is added.
  - 3 to 6 chips go through `look.impact.chips`, so they stay on the floor.
- **Spawn portal**:
  - It opens in about 5 ticks with an overshoot (was 13).
  - A flat ring flings out at the opening.
  - Motes are pulled inward along a swirl from outside the rim the whole time it is open.
  - Its floor light pulses every 12 ticks.
  - The rising motes and the pop are as before.
- **Dash**: a faint `stoneLight`/`stone` scuff decal is left where the dash kicked off (`look.impact.splat`, r 0.13).
  Everything else in the dash is unchanged.
- **Core** (`src/vfx/core.js`):
  - shape type `BURST`;
  - particle field `P.grow`: the size swells to (1 + grow) over the life;
  - `stampGhost(obj, ramp, life, delay, { front, hard })`: `front` draws the ghost over the live body
    (a uniform clip-space bias), and `hard` turns off the dither fade;
  - ramps `smoke`, `smokeHi`, `flashWhite`, `flashInk` and `killSpark`.
- **`?showcase=vfx`**: HIT, KILL BURST (`fx=death`) and SPAWN now use the game's **real enemies**
  (`createEnemies`, puppets with `ai = false`), struck through combat's `strike()` / `applyImpact()`,
  with the real `createCombatFx` (2D marks, damage numbers) and `vfx.bind(['kill'])`. What they show is
  what play shows: look's stains, droplets and chips, combat's flash, and the hud numbers.
  - HIT: two real 3-hit combos on a husk (hp 9999).
  - KILL BURST: a husk killed by the combo (tick ~57), a brute (hp set to 30) killed by the combo (~207),
    then a mite swarm killed by one overhead (~333). The floor marks stay for the whole entry
    (420 ticks), and each entry starts on a clean floor.
  - SPAWN: a husk spawn-in (rose portal) at tick 15 and a mite swarm (cool portal) at tick 100.
  - The other entries are unchanged.

## APIs

```js
import { vfx } from '../vfx/vfx.js';
vfx.kill(x, y, z, { size = 1, colors, obj, dx, dz, decals = true, palette: 'ember'|'cool'|'rose' })
   // the kill burst. Bound to combat:kill already: call it yourself only for kills that do not go through combat
vfx.silhouette(obj3d, { color: 'ink'|'white'|<ramp>, ticks = 2, delay = 0 })
   // a solid frame over a body. Skipped when settings.flashes < 0.5
vfx.killSize(target) -> 0.45..3     vfx.bodyOf(target) -> Object3D|null (group, body, rig.group or mesh)
vfx.core.BURST                      // addShape(BURST, FACING|FLOOR, x, y, z, life, body, core, radius, coreFrac, spikes, seed)
vfx.core.P.grow[i] = g              // particle swells to (1+g) over its life
vfx.core.stampGhost(obj, ramp, life, delay, { front, hard })
```

- The **`kill` bind group** now plays `vfx.kill` for every `combat:kill`. `ownDeath` only skips the
  extra `vfx.death` crumble (the enemies play their own). A scene that binds `kill` gets the
  burst with no other change. Scenes that bind it: run/arena, corridor, boss fight, and the look,
  hud, boons and arenas showcases.
- **enemies** (rebuilt next): your death animations no longer need a big burst of their own at the
  moment of death, because the kill burst covers it. The crumble `vfx.death(...)` call later in the
  animation is now a smaller second beat: a small burst, chunks, a smoke puff and resting chips.
  Give new types a `debris` colour list, which the burst uses for chunks. A target with
  `noKillBurst = true` skips the burst (for props or anything that dies quietly).
- **Settings**: with `flashes` < 0.5, there are no silhouette frames and the burst's white inner core is dropped.

## Debug hooks and showcase params

- `__GR.debug.vfx('play', 'kill', x, y, z, { size, colors })` triggers the burst (no silhouette,
  because there is no object). `'silhouette'` returns an error that explains it needs an Object3D.
- `?showcase=vfx` params and keys are unchanged. `&fx=death` is now the real kill reel (420 ticks).
- **Strip recipe for the kill**: load `/?showcase=vfx&fx=death&hud=0`, then `debug.freeze(true)`, then press
  Space (replay). Step 50, then step 1 or 2 at a time with a screenshot: the husk dies at about tick 57,
  and the burst runs from about 59 to 73. The brute dies at about 207 and the mites at about 336.
  Under Playwright's fake clock (`page.clock.install` plus `runFor`), the real-ms parts also show:
  look's kill frame and light pops.
- **In play**: `/?scene=run&seed=3`, then `debug.god(true)` and `debug.enemies('tune','husk',{hp:1})`.
  Walk up 0.9 s, `debug.spawn('husk', hero.x+0.2, hero.z-1.15)`, wait 1.7 s, then press J.

## Cross-piece edits

- `src/render/post.js` (look), 2 lines. The reserved fire colours (`ember`, `flame`) are meant to
  pass through quantise untouched, but the highlight shoulder ran first and moved an exact
  `ember` (red channel 1.0) about 0.034 away, outside the 0.03 match. Every `ember`/`flame` effect pixel
  was then re-quantised to `red`/`rose` dither: the starburst read pink, and fire particles read red.
  The fix also tests the pixel's raw drawn colour (before haze, vignette and shoulder) against the
  reserved colours, within 0.01. This changes how brazier fire and ember particles look everywhere:
  they now render as the intended orange. A lit surface lands on an exact reserved colour only by accident.

## Known gaps

- **Look's kill frame and this burst overlap.** On the kill tick, look's two-tone disc (white over ink,
  about 38 px, 75 ms real time) shows together with combat's white flash, the hero's white smear and the
  white damage number. That first frame is still one big white blob, as the wave 1 critic noted for hits.
  The ink silhouette and the burst come after it. I did not turn off look's kill frame
  (`look.impact.options.killFrame`), because it is look's judged feature. Whether to keep both is open.
- **Hit contact frame**: the white blob of enemy flash + hero smear + combat's 2D white star + number
  is unchanged. Those belong to hero, combat and hud. vfx's own burst now sits past the contact point
  along the blow, and in the brighter frames it lands after the blob.
- **Stain budget**: a husk kill writes about 450 stain cells (scorch plus look's blood and hit stains).
  look's pool holds 6144, so after about 12 to 14 kills in one room the oldest marks start to be
  overwritten. A long arena or the look showcase's endless fight shows this. Fewer, larger cells,
  or a separate decal mesh for scorches, would fix it.
- **Scorch spokes merge** into one irregular dark star at game zoom. They read as a blast mark, not
  as distinct rays. The ember-to-black cooling only reads in the first 1.5 s, and only where no torch light is.
- **The burst is a camera-facing shape centred on the body**, at the target's position at the kill tick. A body
  knocked hard away (the finisher) has moved about half a unit by the time the burst shows, so the burst sits
  between the hero and the toppling corpse.
- **The ink silhouette is a flat copy of the pose at the kill tick.** It does not follow the body during
  its 2 ticks, so on a fast knockback it is offset by about 1 px.
- **The Warden's burst** (size 3) was only checked through `debug.vfx('play','kill', ...)`, not through a real
  combat kill. The boss's own death sequence plays alongside it, and I did not look at how they stack.
- **Spawn portal pull motes** are 1 to 2 px and hard to see at zoom 1. The light pulse only shows in real time.
- **Performance** is unchanged in kind (pooled, no per-frame allocation). A kill allocates a few small objects
  for its scheduled beats. A 5-mite swarm kill adds about 300 particles. Not timed on a real GPU.
- **Showcase entries**: HIT knocks the husk back, and as a puppet it walks home between swings, so some swings
  in the second combo connect at the edge of reach. In KILL BURST, the floor from earlier kills in the entry
  stays (on purpose), so the mites die on a floor already marked.
