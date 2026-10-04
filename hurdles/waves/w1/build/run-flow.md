# run-flow: builder notes (wave 1)

## What exists

- **The `run` scene** (`src/run/arena-scene.js`) replaces foundation's placeholder. It plays one arena of the run.
  - A fresh run starts here when the scene is entered from outside a run (title, gameover, showcase, a cold `?scene=run`) or with `data.fresh`. A fresh run zeroes the record, resets the boons piece's progress, reseeds the world and sets `__GR.seed`.
  - The first run after page load uses the URL seed. Later runs get a random 5-digit seed.
  - Otherwise it keeps the hp carried from the last segment.
- **Drop-in** on every arena entry. The runner falls from about 12 units above the gate in the hero piece's stretched spawn pose, with 9 stones falling with it.
  - It lands at tick 16: dust ring, shockwave, shake, a frost light flash and a thud. The hero piece's landing pose then plays.
  - Any move, attack or dash 3 ticks after landing cuts the sword flourish (`anim._enter('loco', 5)`), so control comes on the landing.
  - The drop waits while a transition wall covers the screen.
  - A fresh run also shows a card under the room track for about 3 s: `RUN n`, `THE GAUNTLET`, `SEED s`.
- **Routing and transitions** (`src/run/flow.js`): the router sees a change between two gameplay scenes (`run`, `gauntlet`, `boss`). It then:
  - carries hp and maxHp, the seed and the boons snapshot in the scene data. On entering `gauntlet` or `boss` they are re-applied to `world.hero`, because those scenes build their own `HeroHealth` at full hp.
  - drops a **wall of stone blocks**. Blocks fall in from above the screen and stack bottom-first. Each has a pixel of slop, edges are dithered darker, and landings throw dust and a clack.
  - shows a carved card on the closed wall naming the next segment:
    - `ARENA 3 OF 5 • DEPTH 5 OF 10 / THE CROSSING / CRYPT`
    - `DEPTH 2 OF 10 / CORRIDOR 1 / RUN. THE MOUNTAIN IS FALLING.`
    - `THE WARDEN'S PIT`
  - switches scenes behind the wall, then lets the wall fall away into the dark, centre first, with the card falling with it.
  - Close takes about 0.65 s and hold is at least 0.16 s, plus scene build time. Opening takes about 0.5 s.
- **The death sequence:**
  - **0.00 s:** `combat:heroDeath`. Slow motion at x0.18, and the 3D frame drains to the cool ramp. Each pixel is remapped by luminance to ink…bone, dithered in over 0.5 s, and blood reds are kept.
  - **Also from 0.00 s:** a dithered ink vignette closes in, letterbox bars slide in, and the bottom bar shows `[R] RISE AGAIN`, the run time and `[J] SKIP`.
  - **0.45 s:** time eases to x0.7.
  - **0.5 s:** a clean 3D-only crop around the hero is kept as the summary's portrait.
  - **1.05 s:** the frame is captured and the `gameover` scene takes over.
  - J, Enter or Space after 0.12 s skips to the capture. R restarts at once.
- **`gameover`** (`src/run/endings.js`):
  - The frozen frame cracks along Voronoi shard edges, outward from the hero. The shards are pixel-masked on a 2-px grid, small near the hero and large at the edges. The crack front is torch, gold and flame, cooling to ember, blood and ink, with crack sounds as it runs.
  - At 0.5 s the shards fall into the dark, nearest first. They darken through two pre-dithered copies, throw dust, and come with a rumble and shake.
  - The dark behind is an ink void: a dithered ember glow far below, rising sparks and falling grit.
  - At about 1.05 s the summary slab drops in with a thud, and `YOU FELL` hammers in letter by letter.
- **`victory`:**
  - The pit's last frame slides down while gold light shafts pour in from above. Then comes a short white-out, scaled by the `flashes` setting (gold when flashes are off).
  - Then dawn over the mountain: a dithered sky from night to gold, a rising sun, two ridges, drifting clouds, two birds, and the runner at the cave mouth with a scarf in the wind and the keys glinting.
  - `YOU ESCAPED` hammers in, then the gold-trimmed summary slab rises.
- **The summary slab** (`src/run/summary.js`, 448 x 238). It counts in with a sound on each beat:
  - the portrait, a 2x crop of the real frame in a frame of the cause's colour;
  - the depth track: 5 arenas, 4 corridors and the Warden, lit node by node, with a bobbing skull where you fell or a crown on a win;
  - `FELL IN ARENA 3 • CROSSING`, and the cause at 2x in its colour;
  - six stats count up: time, foes slain, damage dealt, soul shards, hearts lost, close calls;
  - the boons taken pop in, as icons with rarity frames and stacks;
  - the lore line types on.
  - `NEW BEST` and `NEW DEEPEST` tags stamp in.
  - Under the slab: `RUN n • SEED s` and `BEST time • DEEPEST place`, and the prompts `[R] RUN AGAIN`, `[E] SAME SEED` and `[ESC] TITLE`.
- **Restart in one key.** R works during the death sequence, the gameover and the victory.
  - The current screen is captured and breaks into blocks that fall away over the new run. The new run (a new seed) starts on the same frame, and its drop-in starts at once.
  - Expected time to control at 60 fps: about 0.35 s (15 fall ticks, the landing, 3 ticks), plus the arena build. It was **not measured in a real browser**; headless runs at 4–7 fps.
  - E restarts on the same seed. J or Enter first finishes the count, then restarts. Esc goes to the title through the title piece's iris.
- **The record and meta** (`src/run/record.js`):
  - Stats are collected from the event bus: time (only in `run`, `gauntlet` and `boss` ticks), kills by kind, damage dealt, hearts lost, close calls (`combat:dodge`), shards, boons and depth.
  - **Cause of death**, with the bus trusted in this order: `gauntlet:caught` (collapse), `gauntlet:hurt {cause}` (spikes, blade, fire), a pit fall that just ended, `enemy:attackHit {enemy}`, then the nearest living foe (wisp bolts fall back to "a wisp"), then the scene.
  - **Meta** in localStorage `gr.meta.v1`: runs, deaths, wins, best time (wins only), best depth, best kills, the count per cause, and unlocked lore.
  - **12 lore lines.** Each finished run unlocks the first locked line its depth allows; two lines need a win. If none is left, a known line is "REMEMBERED".
- **Sounds** (`src/run/sfx.js`): 14 sounds are added to the audio bank's `SFX` table at import, the same way the title piece adds its UI sounds: `run.block`, `close`, `open`, `crack`, `crumble`, `slab`, `tally` (a pentatonic ladder), `row`, `stamp`, `lore`, `type`, `rise`, `impact` and `dawn`. Nobody has listened to them.

## APIs

```js
import { flow, run, meta } from './run/index.js';        // main.js imports this once
flow.draw(g, realDt)          // main.js, every frame after scenes.ui (before the title's wipe.draw)
flow.restart({ sameSeed, seed })   // a new run now (what R does)
flow.covered                  // true while a transition wall hides the screen
flow.dying                    // the death sequence is running
flow.reset()                  // drop any death sequence, held capture or wall (showcase)
flow.info()                   // = debug.run()

import { run, startRun, endRun, abandonRun, meta, LORE, CAUSES, fmtTime, placeText, GAMEPLAY } from './run/record.js';
run.ticks / kills / killsBy / dmg / hurts / dodges / shards / boons / node / deepest / cause / hp / maxHp / seed / number
endRun('death' | 'victory') -> result   // frozen stats + best/newBest + lore {index, text, fresh, count, total}

import { createWall, createCollapse, brickGrid } from './run/wall.js';   // reusable screen effects
import { createSummary, cropPortrait } from './run/summary.js';
import { setPilot, activeRun, DROP } from './run/arena-scene.js';         // showcase pilot, live arena bundle
import { runSound } from './run/sfx.js';
```

- **Scene data:**
  - `run {room, fresh, seed, hp, maxHp, carry}`
  - `gameover {snapshot, ex, ey, result, portrait, skip, direct}`
  - `victory {snapshot, result, portrait, direct}`
- **For other pieces:** call `scenes.go(...)` as usual between gameplay scenes, and the router styles it. A scene that wants to end the run calls `scenes.go('gameover' | 'victory')`; the router holds it, so the death sequence or victory capture decides when it happens.
- **Event:** `run:skip` (emitted by `debug.run('skip')`).

## Debug hooks and showcase params

- **`__GR.debug.run(action?, a)`:**
  - no action: the run info (time, kills, damage, boons, depth, place, cause, transition and death state, meta);
  - `'die', cause?`: kill the hero now. A ward or phoenix is pushed through.
  - `'restart'` and `'retry'` (same seed);
  - `'next'`: the next segment through the router;
  - `'win'`: the victory sequence;
  - `'summary', 'death'|'victory'`;
  - `'skip'`;
  - `'meta'` and `'resetMeta'`;
  - `'clock', {scale, fixed, manual}` and `'advance', seconds`.
- **Deterministic strips.** All run-flow animation runs on its own real-time clock. Use `debug.freeze(true)` plus `debug.run('clock', {manual: true})`, then `debug.run('advance', 0.1)` between shots. Each advance runs 1/30 s per rendered frame, so wait for it to be consumed (about 100–500 ms headless).
- **Getting to the death:**
  - From a real fight: load `?showcase=run-flow&at=death`. Poll until `debug.run().death !== null`, then freeze and use the manual clock.
  - Directly: `?scene=run`, then `debug.run('die', 'husk')`.
- **`state()`:**
  - in `run`: `run` (the record) and `drop {t, landed}`;
  - in `gameover`: `gameover {t, slab, summary: {t, done}, collapse, result}`;
  - in `victory`: `victory {...}`.
- **`?showcase=run-flow`** drives the real scenes.
  - **Params:** `&at=intro|transition|death|summary|victory` (default `intro`), `&seed=N` (default 7), `&hud=0` (no label).
    - `intro`: a fresh run's drop-in and card, then live.
    - `transition`: a god-moded tour arena 1 → corridor 1 → … → the pit, about 3.4 s per segment on the run-flow clock (rooms skipped), then it loops.
    - `death`: arena 3 with one heart. A simple pilot walks in and fights (it lands crits and kills) until a foe lands the last hit. Then the real sequence and summary.
    - `summary`: arena 3. A brute is spawned beside the runner and `debug.run('die', 'brute')` kills the hero, so the blow is scripted, not landed. The summary is then shown fully counted.
    - `victory`: the pit with no intro. The killing blow is dealt by `debug.boss('kill')`, then the boss piece's death sequence, then the victory.
  - **Staged history.** In `death`, `summary` and `victory` the run's history before that point is staged (time, foes, damage, boons, shards). The screen says `SHOWCASE: STAGED RUN HISTORY`, and staged runs never write meta.
  - **Keys:** 1–5 jump between modes, and H toggles the label. Moving or attacking takes the hero off the pilot.

## Cross-piece edits

- `src/core/scenes.js` (foundation): added `scenes.router` (a hook called by `go(name, data, from)`; returning true takes the change over), `scenes.goNow()` (go without the router) and `get pending`. With no router, behaviour is unchanged.
- `src/main.js` (foundation): one import (`./run/index.js`) and `flow.draw(display.ui, realDt)` after the scene UI, before `wipe.draw`.
- `src/core/showcase.js` (foundation): `load` on the `run-flow` row.
- No edits to corridor.js, boss/scene.js or the HUD. The hp carry is re-applied to `world.hero` in a `scene:enter` listener, before the HUD's first sync, so the hearts never animate a loss. The `run` placeholder in `src/core/placeholders.js` is still defined, but this piece redefines `run`, `gameover` and `victory` after it. The `boss` and `pause` placeholders were already replaced by their pieces.
- Uses `anim._enter` (hero piece, private) to cut the spawn flourish on input, and `director.enterMode('silent')` (audio) on restart, because the director ignores re-entering the same mode and would leave the death filter on.

## Known gaps

- **Time to control after R is not measured on real hardware.** It is under 1 s on paper. The arena build on a new seed (meshing) happens in the hold, and nobody has timed it on a GPU.
- **The death drain is a per-frame `getImageData` of the GL canvas** (640x360) for about 1 s. Its cost on slow machines has not been measured. The Voronoi cut (about 4.6M distance tests) happens once, at capture.
- **Sounds have only been checked for errors.** Their levels are guesses against the other pieces.
- **The cause of death is inferred.** Wisp bolts and anything else without an event fall back to the nearest foe, and a slam in a crowd can name the wrong enemy. `debug.kill()` with no foe nearby says "STRUCK DOWN".
- **No gamepad key for restart.** R is keyboard-only. On a pad, A skips, then finishes the count, then restarts; Y is "same seed". This is untested on a pad.
- **The transition hold is at least 0.16 s,** plus however long the next scene's `enter` blocks. A slow scene build shows as a longer hold.
- **The corridors and the boss get no drop-in.** They keep their own entries: the corridor's walk-in, and the boss intro (476 ticks, skippable).
- **The summary layout is fixed at 448 px wide,** so windows narrower than about 460 internal px would clip it. Only 16:9 was looked at.
- **The victory's dawn is a 2D painting,** not the voxel world, and the runner on the ridge is a 6x9 sprite.
- **Lore is only shown on the summary.** The title screen does not show best time, depth or lore yet; that would need a small edit in the title piece.
- **Shards still have no use.** The summary only counts them.
- **The showcase pilot is crude.** It walks straight at the nearest foe and side-steps when stuck. In `summary` mode the killing blow is scripted.
