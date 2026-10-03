# boss: builder notes (wave 1)

## What exists

- **The Warden** (`src/boss/warden.js`, models in `src/boss/models.js`). It is a jailer-knight about 38 voxels tall (3.5x the hero), built as a rig of rigid parts:
  - legs with a thigh and a shin each, so it can kneel;
  - a torso, a red mantle and cape, pauldrons, a great helm with a little birdcage on top, and arms;
  - an emissive gold key ring on the belt;
  - a spiked iron ball on a 13-link chain from its right fist.
  - Eye colour follows the phase: sky in I, gold in II, ember in III. A matching eye light follows the head.
  - It extends the enemies piece's `Enemy` (pose lerp, hit flash, floor telegraphs through the manager), with its own `takeHit`, poise, movement clamp and death.
- **Three phases**, with hp thresholds at 2/3 and 1/3. At a threshold the hp clamps to the line and the phase change plays (see below).
  - **I THE CHAIN**:
    - **sweep**: a 58-tick windup with the ball whirled overhead. A 230° fan of reach 4.7 fills on the floor, then the ball sweeps it in 9 ticks, with a two-layer arc smear and floor sparks.
    - **lash**: a 42-tick windup with the ball drawn back. A lane fills toward the hero, tracks it for 60%, then locks. The ball flies down the lane and buries itself in the floor, then the Warden is **stuck** for 54 ticks heaving on the chain, then 14 ticks pulling it free. Both are punish windows.
    - **stomp**: only when the hero hugs it. A 2.15-radius disc round its feet, 30-tick windup.
  - **II THE QUAKE**: adds the **leap**. It crouches while a disc fills on the hero (tracking for 60%), then leaps. The landing does 2 damage inside the disc. 16 ticks later a **shockwave ring** rolls out at 4.6 u/s; its start line flashes on the floor first. The answer is to dash *into* the ring. After landing it is stuck for 64 ticks.
  - **III THE CAGE**: once, on entry: a bell, then the outer ring of the pit fills red from the edge inward for 96 ticks. Then eight arcs of bars burst up at r 4.3 in turn. A hero still outside is hurt, thrown inside, and the play ring shrinks to the cage. After that it **summons** two husks (it unhooks its keys and rattles them overhead), at most 3 alive, with a 10 s cooldown. Leaps now send **two** rings.
- **Stagger**: hits build poise (a thin bar under the hp bar). At 90 it breaks: any windup is cancelled and it drops to one knee for 160 ticks, pulsing gold and taking 1.5x damage (the extra shows as a crit number). Poise is then locked for 4 s. It is untouchable in the air and during the scripted moments (intro, phase break).
- **Phase change** (`breakPhase`), about 120 ticks:
  - hitstop, a flash, a big shake, and 0.35x slow motion for 46 ticks;
  - the camera leans toward the Warden;
  - a pauldron tears off (right in II, left in III) and tumbles and clatters across the floor, where it stays;
  - armour chunks fly;
  - the eyes re-ignite in the new colour; in III the breastplate and helm change to models cracked open with ember light;
  - a roar: three rings, the hero shoved back, every brazier flares (red light in III, and the runes turn red);
  - a phase card ("II / THE QUAKE").
- **Death**, about 260 ticks to THE WARDEN FALLS:
  - hitstop, a white flash, 0.3x slow motion, and any husks crumble;
  - it reels, then sinks to its knees with a thud;
  - **beams of light** (16 billboard quads in torch, white and gold) break out of it one every 6 ticks, lengthening and flickering, while embers spit and light pulses grow and the shake builds;
  - at +112 it **bursts**: a white-out, three gold rings, two `vfx.death` bursts and a beam flare. The whole rig flies apart as physics pieces (helm, pauldrons, arms, cape, keys, torso, legs, half the chain links), which bounce, spin, clatter (sound plus sparks) and settle into an armour pile that stays.
  - after the burst: the soul chime; the cage sinks; the braziers burn gold; the keys lie glowing (a gold light plus twinkles); then the THE WARDEN FALLS card and a victory sting.
- **The Warden's Pit** (`src/boss/arena.js`):
  - a round stone drum (r 6.4, play r 5.65) of concentric flagstones over darkness, with a drain grate, cracks and old blood;
  - the back wall of cells (gold eyes glint in two), banners, and the Warden's niche with chain rings;
  - a bridge in from the south with a gate of bars that slams up;
  - six iron cage-braziers on the rim (a lit and an unlit model each, a light, ambient fire);
  - a 12-segment rune ring (dark, lit and hot models);
  - the eight cage arcs;
  - ambient `boss` motes, and `look.mood('boss')`.
- **The intro** (`src/boss/fight.js`, `INTRO`; 476 ticks, skippable with attack, interact or confirm after tick 60):
  1. The hero walks in over the bridge, and the gate slams up behind.
  2. The camera drifts to the far side, where the Warden kneels chained to the wall with dark eyes.
  3. The braziers light one by one round the rim, and the rune ring wakes segment by segment with chimes.
  4. A cut to zoom 2: the eyes ignite.
  5. It rises, strains, and snaps the chains (the links scatter).
  6. A cut wide: the ROAR (rings, shake, a flash, the braziers flare, the hero is shoved).
  7. The name card slams in ("THE WARDEN / JAILER OF THE DEEP GAUNTLET", typed on), and the boss bar slides up.
- **Boss UI** (in `fight.js`):
  - hero hp pips, top left;
  - a boss bar at the bottom: name, the phase numeral and name, phase notches at 1/3 and 2/3, a white trail chunk that holds then drains, and a poise bar that shows STAGGERED or grey while locked;
  - the name card, the phase card, and the win card.
- **Sound** (`src/boss/sfx.js`): synthesised, with one tell per attack (a rising whirl, the chain drawn back, an armour creak, an inhale, a key rattle, a bell). Also impacts, the roar, the gate, ignites, rune chimes, chain snaps, armour clatter, death beams, the burst, the soul chime and the victory sting. Not listened to at length.
- **Normal play**: `?scene=boss` (and walking out of arena 5) plays the intro and then the fight. Held boons work there (the boons piece's progression, with no drops). A win goes to `victory` about 5 s after THE WARDEN FALLS; a death goes to `gameover {cause: 'warden'}`.

## APIs

```js
import { createBossFight, INTRO, activeFight } from './boss/fight.js';
const F = createBossFight(root, { intro, phase: 1..3, source /* input source */, hp, maxHp, force /* attack name */,
                                  passive, numbers, zoom, focus });
// tick: F.tick()   frame: F.frame()   render: F.render(alpha)   ui: F.ui(g)   exit: F.dispose()
F.state            // 'intro' | 'fight' | 'dying' | 'won' | 'lost';  F.wonT (ticks since THE WARDEN FALLS)
F.warden F.pit F.mgr F.ctl F.anim F.rig F.health F.combat   F.skipIntro()  F.reviveHero()  F.barLift = px
F.info()

import { Warden, WARDEN } from './boss/warden.js';   // WARDEN: all tuning (hp, cooldowns per phase, every attack's numbers)
warden.act(name)   // 'sweep'|'lash'|'stomp'|'leap'|'summon'|'cage' from a calm state
warden.force / warden.passive / warden.phase / warden.ringR / warden.waves / warden.open
import { BossPit, BRAZIERS } from './boss/arena.js';   // seal(), ignite(k), wakeRune(k), runesHot(), flare(color, k), cageUp(), cageDown()
import { bossSfx } from './boss/sfx.js';             // bossSfx.enabled = false when `audio` takes over
```

Events (all carry `{boss}`):
- intro: `boss:seal`, `boss:wake`, `boss:chains`, `boss:roar {intro}`, `boss:begin`, `boss:fight`;
- attacks: `boss:attack {name}` at a windup's start (as well as `combat:enemyWindup`), and `boss:strike {name, x, z}` when it lands;
- state changes: `boss:stagger`, `boss:phase {phase, name}`, `boss:cage`, `boss:cageUp {r}`, `boss:summon {n}`;
- the end: `boss:death`, `boss:burst {x, z}`, `boss:defeated`, and `boss:heroDown`.

The Warden also emits the usual `enemy:hurt` and `enemy:death {kind: 'warden'}`. `run-flow` can take the scene over by calling `createBossFight` itself, or simply go to `'boss'` with `{intro, phase, hp, maxHp}`.

## Debug hooks and showcase params

- **`__GR.debug.boss(action?, ...)`**:
  - no action: `F.info()`;
  - `'attack', name`;
  - `'force', name|null`;
  - `'passive', on`;
  - `'phase'`: break into the next phase now;
  - `'stagger'`;
  - `'hp', n`;
  - `'kill'`: the full death sequence;
  - `'skip'`: skip the intro;
  - `'tune', {sweep: {windup: 70}}`: live-edit `WARDEN`.
- `debug.spawn(type, x, z)` works in the boss scene and showcase (the enemies manager).
- `state()` in `?scene=boss` includes `boss: F.info()`. `world.room = {index: 5, kind: 'boss', id: 'warden', ...}`.
- **`?showcase=boss`** runs the real fight with a DEMO pilot that uses keyboard-style input. The pilot dodges two threats in three and eats the third (TANK IT), dashes *through* rings, gets inside the cage, punishes openings, and gets back up if it falls.
  - Params:
    - `&phase=1|2|3`, `&intro=1`;
    - `&attack=sweep|lash|stomp|leap|summon|cage` (the Warden only uses that attack);
    - `&death=1` (phase III at 22 hp, passive; the pilot lands the killing blow and the sequence loops);
    - `&auto=0` to start LIVE, and `&dodge=1` to make the pilot dodge everything;
    - `&passive=1`;
    - `&zoom=1..3`, and `&focus=1` for a camera that frames the Warden (close-ups with `&zoom=2`);
    - `&slow=<s>`, `&numbers=0`;
    - `&hud=0` hides the showcase labels; the boss UI stays.
  - Keys:
    - WASD, J, K when LIVE;
    - 1/2/3 restart at a phase, 4 the intro, 5 the death;
    - B demo, R restart, T slow, H hud, P/Esc pause.
  - `state().showcase = {id, mode, auto, start, attack, pilot, ...F.info()}`.
- **Strip recipe**: load with `&hud=0`, then `debug.freeze(true)`. `debug.step(n)` runs at most 60 ticks per rendered frame, so wait for `__GR.frame` to reach the target before shooting. Useful first ticks after the freeze:
  - **sweep**: `&attack=sweep&dodge=1`; the windup fill is around tick 80 and the sweep around 100-110.
  - **lash**: `&attack=lash`; the windup is around tick 60-90.
  - **leap**: `&phase=2&attack=leap&dodge=1`; the disc is around tick 60-90, the land around 95-100, and the ring 110-160.
  - **phase change**: pre-eval `debug.boss('phase')`, then every 9 ticks.
  - **cage**: from `&phase=2`, `debug.boss('phase')`, then step about 120 to 230.
  - **death**: `&death=1`; the kill is around tick 80-130 (it depends on the pilot), then every 14 ticks for about 300. Or use `debug.boss('kill')`, then step.
  - **intro**: `&intro=1`, every 30 ticks for 480.

  Stepping skips hitstop and the real-time light pops.

## Cross-piece edits

- `src/main.js` (foundation): one import line in the marked spot, `import './boss/scene.js'`, which redefines the `'boss'` scene after the placeholder.
- `src/core/showcase.js` (foundation): set `load` on the `boss` row.
- No file edit, but a runtime addition: `warden.js` adds `ENEMY_DATA.warden` (the enemies piece's data table) at import, because `Enemy`'s constructor reads its archetype row there. The Warden is not in `CLASSES` or `SPAWN_TYPES`, so `debug.spawn('warden')` does not exist.

## Known gaps

- **Model readability from above.** The camera is high, so the Warden reads mostly as helm top, pauldrons and mantle. The face and visor show only when it stands upright, and kneeling poses show the helm's crown. At zoom 1 it reads as a red-and-steel knight. At zoom 2 the rigid boxy limbs show: no elbows, no hands that open.
- **The ball is small and dark** against the floor when it is not moving. The sweep reads through its smear and floor sparks; the lash reads through the lane and the chain lying on the floor.
- **The back wall is dark.** The light pool is full: 6 braziers, the eye light and a cold shaft make 8. Only the emissive prisoner eyes, the banners and the rim light carry the wall.
- **Hit flashes are whole-body.** Combat's white hit flash and the telegraph tell turn the entire Warden one colour, because the palette quantise snaps even a low flash to the flash colour. The tell is therefore only a 2-in-8-tick pulse.
- **The stagger has no unique visual** beyond the kneel, the gold pulse and the bar text: no open visor.
- **The intro is one fixed script.** It ignores where the hero is if a player moves early; the hero is input-locked until tick 476 unless skipped.
- **Collision is crude.** The hero is blocked by a single circle (r 0.87) round the Warden. The ball and chain have no collision, and the chain clips through the hero and the floor bars. Wall-chain links in the intro can look stretched.
- **Death physics pieces** are simple: one rest height per piece and a snapped orientation when settling, so some pieces sit slightly in or above the floor. They also tumble inside the cage bars, since there are no bar collisions.
- **Tuning is first-pass.** The DEMO pilot (which never misses a read and tanks one threat in three) wins in about 100 s of sim with 3 staggers and loses 3-5 hp. No human has played it at length. There is no difficulty scaling beyond the `WARDEN` table, and hp does not carry over from the run (`run-flow` should pass `hp`/`maxHp`).
- **Sounds** were checked only for console errors, not listened to.
- **Determinism**: the Warden's choices are seeded, but the death showcase's kill tick depends on the pilot's timing against the freeze frame, so strips can shift by a few ticks between runs.
- **Performance** was checked headless only. The ring telegraph scans up to about 12k cells per tick per ring.
