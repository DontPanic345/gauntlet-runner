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
