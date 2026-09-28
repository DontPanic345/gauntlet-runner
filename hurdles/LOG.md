# Hurdles log

Append-only. One entry per unit of work, newest last. Format:
`## YYYY-MM-DD — wN <phase>: <piece or scope>`, then 1 to 5 lines on what happened and
where the outputs are.

## 2026-09-25 — setup (run 1)

- Created the project: static `index.html` with an import map, three.js 0.186.1 in
  `node_modules/`, and a placeholder `src/main.js` (a spinning cube that implements
  a minimal `window.__GR`).
- Tooling: `tools/capture.cjs` (headless Chromium via global Playwright 1.62, WebGL
  through SwiftShader, about 60 fps on a trivial scene), `tools/sheet.cjs`, and
  `tools/blind.cjs`. All three were verified end to end on the placeholder.
- The user installed a full system ffmpeg (8.0.1, `/usr/bin/ffmpeg`), which handles
  mp4/h264 references and audio spectrograms. The ffmpeg bundled with Playwright is
  stripped, so never use it.
- itch.io is reachable over HTTPS from this machine.
- Decomposed the game into 15 pieces (`hurdles/pieces.json`): foundation (not judged)
  plus 14 judged pieces. The build wave has not run. `state.json` points at wave 1,
  phase `build`, with `foundation` first in the queue.

## 2026-09-25 — w1 build: foundation

- Builder built the engine skeleton in `src/core/` and `src/render/voxel/` and rewrote `src/main.js`. It includes a fixed 60 Hz loop, input with buffering, a scene machine, seeded RNG, a greedy mesher with AO, a showcase router with an unknown-id error screen, and `window.__GR`.
- Cross-piece edits: it created `src/render/palette.js` (owned by `look`) and changed `src/style.css`. Notes are in `waves/w1/build/foundation.md`.
- Smoke test: showcase, title and run all exit 0 with non-blank frames. The gamepad path is untested.

## 2026-09-25 — w1 build: budget stop

- The budget guard tripped after foundation: weekly usage was 97%, over the 95% limit, and resets Sat 26 Sep 21:00. The next session resumes the build queue at `look`.

## 2026-09-26 — w1 build: look

- Builder added `src/render/look.js`, `post.js`, `lights.js`, `showcase.js` and `showcase-models.js`: a post chain that renders at low resolution with outlines, edge highlights, torch glow, pit fog, vignette and a palette snap with dither. Also a pool of 8 flickering torch lights, three moods, and a crypt-vignette showcase where keys 1-6 toggle effects.
- Cross-piece edits to foundation files: `src/main.js`, `src/render/voxel/material.js`, `src/core/stage.js` and `src/core/showcase.js`. Notes are in `waves/w1/build/look.md`.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-26 — w1 build: hero

- Builder added `src/hero/model.js` (a hooded voxel runner with a spring cloak, hood tip and chain-simulated scarf) and `src/hero/anim.js`. The animations are idle, run with `hero:step` events, turn, dash, a 3-hit combo whose timings are exported as `ATTACKS`, hurt, death and spawn. There is also a `debug.hero` hook.
- Also created `src/hero/showcase.js`, which is outside `hero`'s owns list because the router expects `<dir>/showcase.js`. It is recorded in the notes and piece definitions are unchanged. Cross-piece edits: `src/core/showcase.js`, and `src/core/placeholders.js`, where the placeholder run now uses the real rig. Notes are in `waves/w1/build/hero.md`.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-26 — w1 build: movement

- Builder added `src/core/collision.js`, `src/hero/controller.js` (reaches speed in 3 ticks and stops in 4, and a buffered dash has 9 i-frames) and `src/render/camera.js` (a follow camera with lead, a dead-zone and a shared shake channel). The showcase is an obstacle course on an autopilot loop, with a ghost trail and a speed graph.
- Also created `src/core/showcase-movement.js`, which is outside `movement`'s owns list and is recorded in the notes. Cross-piece edits: `src/core/showcase.js`, and `src/core/placeholders.js`, where the placeholder run now uses the controller and camera. Notes are in `waves/w1/build/movement.md`.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-26 — w1 build: combat

- Builder added `src/combat/` (`combat.js`, `fx.js`, `sfx.js`, `dummy.js` and `showcase.js`): a 3-hit combo on the hero's `ATTACKS` timings with a fixed-tempo chain, swept-arc hitboxes, hitstop, flash, knockback, sparks, shake, synthesized sound and damage numbers, plus hurt and death with i-frames. The showcase has straw dummies and a telegraphing sparring dummy, with a demo autopilot and `&slow=0.25`.
- Cross-piece edits: `src/core/showcase.js`, and `src/core/placeholders.js`, which now uses combat and registers `debug.spawn('dummy'|'sparring')`. `enemies` must merge with that registration. Notes are in `waves/w1/build/combat.md`, including how to capture a combo (headless screenshots are too slow to chain presses).
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-26 — w1 build: budget stop

- The budget guard tripped after combat: the session window was at 68%, over the 50% limit, and resets Sun 27 Sep 03:40. Weekly was at 10%. The next session resumes the build queue at `vfx`.

## 2026-09-27 — w1 build: vfx

- Builder added `src/vfx/` (`particles.js`, `ambient.js`, `marks.js`, `effects.js`, `index.js`, `showcase.js`): a pooled instanced cube-particle system, an effects library (hit, smear, dust, dash, death, portal, flash, shockwave, pickup), ambient embers and dust motes, and a looping labelled reel. Hooks: `vfx:play` event, `debug.vfx`, `debug.vfxStats`. Notes in `waves/w1/build/vfx.md`.
- Cross-piece edit: the `vfx` row in `src/core/showcase.js`. No other piece calls vfx yet, and 60 fps was not verified on a real GPU.
- Smoke test: showcase, title and run all exit 0 with 0 console errors.

## 2026-09-27 — w1 build: enemies

- Builder added `src/enemies/` (`data.js`, `models.js`, `telegraph.js`, `enemy.js`, `index.js`, `sfx.js`, `showcase.js`): four archetypes (husk, ember wisp, brute, mite swarm) with spawn-in, floor-marker telegraphs, attack slots and flanking, hurt and death, difficulty knobs (`&hp=`, `&speed=`, `&aggr=`), `debug.enemies`. Notes in `waves/w1/build/enemies.md`.
- Cross-piece edits: `src/core/showcase.js` (enemies row) and `src/core/placeholders.js` (attaches vfx and enemies; `debug.spawn` tries enemy types first, then dummy/sparring).
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: brute low contrast, wisp orbs not battable, no aggro range or pathfinding.

## 2026-09-27 — w1 build: arenas

- Builder added `src/world/` (`tiles.js`, `props.js`, `arena.js`, `waves.js`, `showcase-arenas.js`): seeded arena generation from templates, props (a barrel and crate break when hit), enemy waves, a slam entry, "ROOM CLEARED" and door opening, and five rooms in the showcase. Notes in `waves/w1/build/arenas.md`.
- Cross-piece edits: `src/core/showcase.js` (arenas row) and `src/combat/combat.js` (aim assist skips `noAssist` targets). Normal play is still the placeholder until run-flow uses `Arena`.
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: rooms are dark, enemies slide on pillars, slam frame not re-captured.

## 2026-09-27 — w1 build: budget stop

- The budget guard tripped after arenas: the session window was at 73%, over the 50% limit, and resets Sun 27 Sep 10:20. Weekly was at 16%. The next session resumes the build queue at `gauntlet`.

## 2026-09-27 — w1 build: gauntlet

- Builder added `src/world/corridor.js`, `traps.js`, `collapse.js` and `showcase-gauntlet.js`: a generated corridor with spike floors, swinging axes, fire jets and crumbling tiles that telegraph safe/warn/live phases, a collapse wall that speeds up when you are close and eases when you are far ahead, a gate-slam ending, and a `debug.gauntlet` hook. Showcase keys: T overlay, Q slow-mo. Notes in `waves/w1/build/gauntlet.md`.
- Cross-piece edit: the `gauntlet` row in `src/core/showcase.js`. Tuned by a bot only, never played by hand. Normal play does not use corridors until run-flow.
- Smoke test: showcase, title and run all exit 0. Builder-reported gaps: dark scene, noisy heap, blunt axes, pit fall is a teleport.

## 2026-09-27 — w1 build: boons

- Builder added `src/progression/` (`boons.js`, `icons.js`, `sfx.js`, `pickups.js`, `effects.js`, `shrine.js`, `index.js`, `showcase.js`): 16 boons in 3 rarity tiers with stacking and 7 synergies, a pick-1-of-3 shrine with card deal-in, flip, hover, pick burst and reroll, soul shard and heart pickups with vacuum and a sound ladder, `debug.give` and `debug.boons`. Notes in `waves/w1/build/boons.md`.
- Cross-piece edits: `src/core/showcase.js`, `src/combat/combat.js` (exported `hooks.damage`), `src/core/placeholders.js` (run placeholder runs progression; B opens the shrine).
- Smoke test: showcase, title and run all exit 0. Builder-reported gaps: some icons weak, no frost/slow boons, balance untuned, sounds never listened to, `phoenix-spark` give-run unverified.

## 2026-09-27 — w1 build: budget stop

- The budget guard tripped after boons: the session window was at 54%, over the 50% limit, and resets Sun 27 Sep 15:20. Weekly was at 21%. The next session resumes the build queue at `boss`.

## 2026-09-27 — w1 build: boss

- Builder added `src/boss/` (`models.js`, `arena.js`, `warden.js`, `fight.js`, `scene.js`, `sfx.js`, `showcase.js`, `index.js`): the Warden, a 3-phase fight (sweeping chain, slams with shockwaves, husk summons and a cage) with telegraphed attacks, an intro with name card, phase transitions, a death sequence, a bot-played showcase (`&intro=1`, `&phase=1|2|3`, `&death=1`) and `debug.boss`. `?scene=boss` now runs the real fight. Notes in `waves/w1/build/boss.md`.
- Cross-piece edits: `src/core/showcase.js` (boss row) and `src/main.js` (lazy-loads the boss scene for `?scene=boss`).
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: Warden top-heavy at zoom 1, awkward recover poses, standalone hero death revives after ~2s, stand-in sounds, never hand-played.

## 2026-09-27 — w1 build: hud

- Builder added `src/ui/hud.js`, `damage-numbers.js`, `showcase-hud.js` and `widgets/` (sprites, hearts, vignette, shards, boonrow, track, bossbar): hearts with a drain trail, a dash pip, a ticking shard counter, a boon row with tooltips, a 10-node room track, a boss bar, damage numbers, a low-health heartbeat and vignette, and dimming of elements the hero stands behind. Notes in `waves/w1/build/hud.md`.
- Cross-piece edits: `src/core/showcase.js`, `src/core/placeholders.js` (run/boss placeholder uses the HUD, combat stand-in numbers off), `src/boss/scene.js` (HUD replaces hero pips) and `src/boss/fight.js` (`drawBar` uses the shared boss-bar renderer).
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: engine font, small icons, track index base unconfirmed, corridor progress not fed, heartbeat silent.

## 2026-09-27 — w1 build: budget stop

- The budget guard tripped after hud: the session window was at 58%, over the 50% limit, and resets Sun 27 Sep 20:20. Weekly was at 26%. The next session resumes the build queue at `audio`.

## 2026-09-27 — w1 build: audio

- Builder added `src/audio/` (`mixer.js`, `bank.js`, `music.js`, `index.js`, `showcase.js`): one shared AudioContext/mixer with SFX and music buses (duck + muffle), a "never twice in a row" pitch/gain jitter helper, footsteps/dash whoosh/enemy spawn barks, and four reactive music tracks (title, field, chase, boss) driven by arena/gauntlet/boss/combat events and low-health/pause. Notes in `waves/w1/build/audio.md`.
- Cross-piece edits: `src/combat/sfx.js`, `src/enemies/sfx.js`, `src/boss/sfx.js`, `src/progression/sfx.js`, `src/world/arena.js`, `src/world/corridor.js` (each now sources its AudioContext from the shared mixer instead of opening its own; existing sound design unchanged), `src/main.js` (imports `audio/index.js`), `src/core/showcase.js` (wires the audio showcase).
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: no per-tile footstep material, enemy barks spawn-only, music intensity is event-heuristic not full-state, no spatialisation.

## 2026-09-27 — w1 build: title

- Builder added `src/ui/` (`title.js`, `menus.js`, `settings.js`, `showcase-title.js`): a torchlit title vignette (borrowed crypt models, ambient embers/dust, the real hero rig idling), a designed logo lockup, a closed->main->settings/controls/credits screen flow, a reusable menu toolkit (keyboard/mouse/gamepad list navigation with focus/hover juice and sfx), a live settings screen persisted to localStorage, and a pause scene reusing the same toolkit. Notes in `waves/w1/build/title.md`.
- Cross-piece edits: `src/main.js` (registers the title/pause scenes, wires `drawFpsCorner` into the render loop, and changes the pause-toggle line to open-only, fixing a same-frame Esc double-fire bug where Esc both opened and closed the pause menu), `src/core/showcase.js` (title showcase wiring).
- Smoke test: showcase, title and run all exit 0 with 0 console errors. Builder-reported gaps: title scene deliberately not pausable (its own Esc-stack), no rebind UI, gamepad untested physically, borrowed environment art.

## 2026-09-27 — w1 build: budget guard stop

- The budget guard tripped after title: the session window was at 66%, over the 50% limit, and resets Mon 28 Sep 01:20. Weekly was at 31%. The next session resumes the build queue at `run-flow`, the last piece before `integrate`.

## 2026-09-28 — w1 build: run-flow

- Builder added `src/run/` (`run.js`, `transition.js`, `death.js`, `victory.js`, `summary.js`, `meta.js`, `showcase.js`): the real run sequencer replacing the placeholder, chaining 5 arenas and 4 corridors into the boss via `PLAN`, with one persistent hero/controller/combat/camera/vfx/hud/progression instance and boons carried across segments. A wipe transition covers segment changes, a death sequence (slow-mo, closing vignette, cause of death, skippable, well under 3s), a victory sequence, a shared screenshotable summary (time, kills, room reached, boons, seed, best time, lore line), localStorage best-time/lore meta, and instant restart (new seed or same seed). `debug.run(...)` hook added.
- Cross-piece edits: `src/main.js` (registers run/gameover/victory scene definitions from `run.js`, replacing the placeholder), `src/core/showcase.js` (run-flow row now loads `../run/showcase.js`).
- Smoke test: showcase, title and run all exit 0 with 0 console errors, non-blank frames. Builder-reported gaps: pickup bounds not set per room, world freezes during the death sequence (deliberate freeze-frame), cause-of-death is a last-event heuristic, no lore codex screen, untested with a gamepad or as one continuous 8-12 minute playthrough.

All wave 1 pieces are now built. Advancing to `integrate`.

## 2026-09-28 — w1 integrate

- Integrator played the full loop: title -> main menu -> an arena (both waves, cleared, boon shrine) -> corridor (collapse chase, a death) -> gameover summary -> instant restart -> a second arena/corridor pair -> the boss (all 3 phases via showcase) -> victory sequence -> victory summary. Ran the foundation must_have checklist and two 60s-idle console-error checks; all 5 must_haves pass.
- Fixed `src/render/camera.js` (`CameraRig._clamp`): the room-bounds camera clamp kept the camera centre inside the raw room bounds instead of insetting by half the visible viewport, showing a black void (up to ~35% of the screen) past the wall at arena entry. Now insets by the actual half-viewport, accounting for zoom and pitch.
- Fixed `src/boss/fight.js` (`BossFight.ui`): the boss's own "THE WARDEN FALLS" banner kept drawing after `boss:cleared`, overlapping run-flow's victory banner. Now suppressed once `this.cleared` is true.
- Seams left for critics: combat's private particle/fx system (`src/combat/fx.js`) still runs parallel to the shared `vfx` pooled system (too large a rewrite for a seam fix); a rare HUD boon-tooltip/death-iris clip if you die within ~3s of a pickup; arenas' fly-through showcase camera bypasses `CameraRig` and still shows void in one room template; headless sim tick rate is only 14-47 ticks/s (software GL, no real-GPU testing available). Full report in `hurdles/waves/w1/integration.md`.
- Budget guard tripped after integrate: session window was at 67%, over the 50% limit, resets Mon 28 Sep 06:20; weekly 37%. The next session starts the critique phase (queue: look, hero, movement, combat, vfx, enemies, arenas, gauntlet, boons, boss, hud, audio, title, run-flow — every judged piece, none yet won).

## 2026-09-28 — w1 critique: look, hero, movement, combat

- Four critics ran in parallel, each pinning a reference and writing a review, matched blind packet, key and criteria: `look` vs Nuclear Throne (4.69★/511), `hero` vs 10 Minutes Till Dawn (4.8★/742), `movement` vs Bright Lancer (4.5★/140), `combat` vs Backstreet Warriors (4.8★/60). References copied into `pieces.json`.
- Biggest gaps: look's torch light is a flat post decal that doesn't touch nearby voxels, and the default post pass is strictly worse than off; hero's dash visibly disassembles into floating parts mid-travel and hit-3's smear frame is a solid white blob; movement's dash after-image reads as visual noise rather than motion, and the hero renders very small in a real arena room; combat's third hit isn't heavier than the first and knockback swings 60x instead of scaling with damage.
- All four: reviews, `waves/w1/critic/<id>/{ours,ref}`, `waves/w1/blind/<id>/{A,B,pair-NN.png,criteria.md}`, `waves/w1/keys/<id>.json` verified on disk before commit.

## 2026-09-28 — w1 critique: budget guard stop

- The budget guard tripped after the first critique batch (look, hero, movement, combat): the session window was at 86%, over the 50% limit, and resets Mon 28 Sep 11:20. Weekly was at 44%. The next session resumes the critique queue at the next batch of up to 4: vfx, enemies, arenas, gauntlet, boons, boss, hud, audio, title, run-flow.

## 2026-09-28 — w1 critique: budget guard stop (no units run)

- The budget guard tripped at session start: the session window was at 50%, at the 50% limit, and resets Mon 28 Sep 16:20. Weekly was at 48%, resetting Sat 03 Oct 22:00. No critic was spawned. The next session resumes the critique queue serially at `vfx`: vfx, enemies, arenas, gauntlet, boons, boss, hud, audio, title, run-flow.
