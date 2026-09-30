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

## 2026-09-29 — rollback: every wave from here on is Opus

- The cron clerk ran without `--model`, so it used whatever default an interactive `/model` had saved. From 27 Sep 07:21 the clerk runs were on Sonnet 5, and from 29 Sep 03:21 they were on Haiku 4.5, along with every agent they spawned. The Haiku waves produced broken packets: the w3 combat reference side was the itch.io cover art repeated, and the hud "win" was against a reference that never loaded.
- The loop is rolled back to `a7661a3`, the last commit before the first non-Opus run. That undoes the Sonnet/Haiku w1 builds (vfx through run-flow), w1 integrate, critique and judge, and all of w2 and w3. The old history is kept on branch `backup/pre-opus-rollback`.
- Kept from after that point: the binary `.gitattributes` rules, serial critics in PROTOCOL.md, and the cron timeout fix.
- `tools/hurdles-cron.sh` now pins `--model opus --effort medium` and runs the clerk as an interactive session in a detached tmux session (`tmux attach -t hurdles` to watch), replacing `-p` and `tools/watch-agent.sh`. The next session resumes the w1 build queue at `vfx`.

## 2026-09-29 — w1 build: vfx

- Builder added `src/vfx/` (`core.js`, `effects.js`, `ambient.js`, `vfx.js`, `showcase.js`): one fixed-size particle pool (3 draw calls), an effects library (hit spark, slash, dust, dash, death, spawn portal, embers, flash, shockwave, pickup), an ambient layer with crypt/collapse/boss presets, and a 12-effect labelled reel at `?showcase=vfx`.
- Cross-piece edits: `src/main.js` (import plus a per-frame `vfx.render`), `src/core/showcase.js` (the vfx router entry), and `src/core/placeholders.js` (`vfx.bind(['move','kill'])`). Combat's own `fx.js` and the hero's dash ghosts are not switched over yet. Turning on `vfx.bind(['combat'])` would double the hit effects. Notes are in `waves/w1/build/vfx.md`.
- The builder could not verify 60 fps at 2000 particles: headless software GL runs at 12 to 16 fps with or without particles.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-29 — w1 build: enemies

- Builder added `src/enemies/`: four archetypes (husk, ember wisp, brute, mite swarm), each a voxel model animated in code. Telegraphs share one floor language in which the drawn zone is the hitbox. Enemies take hit-stun (the brute has a stagger threshold) and take turns attacking so they don't bunch up. Difficulty is set in `data.js`. `?showcase=enemies` shows a lineup, and `&fight=husk|wisp|brute|mite|mites|wave` puts the hero against one type, with a demo autopilot.
- Cross-piece edits: `src/core/showcase.js` (the router entry), `src/core/placeholders.js` (runs the enemy manager, and `debug.spawn` now merges with combat's dummy/sparring), and `src/vfx/vfx.js` (the kill handler skips `ownDeath` enemies). Notes are in `waves/w1/build/enemies.md`. The builder did not listen to the sound effects.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-29 — w1 build: budget stop

- The budget guard tripped after enemies: the session window was at 72%, over the 50% limit, and resets Tue 29 Sep 23:19. Weekly was at 78%. The next session resumes the build queue at `arenas`.

## 2026-09-30 — w1 build: arenas

- Builder added `src/world/` (`arena.js`, `tiles.js`, `props.js`, `waves.js`, `showcase-arenas.js`): six hand-authored room templates, picked per seed then mirrored and varied. Entering a room seals it with iron spikes that slam up out of the floor, with shake, dust and a boom. The waves are seeded and escalate across the 5 arenas. The clear moment has slow motion, a flash, the exit seal breaking and the portcullis rising. Some props break when hit and others react without breaking. `?showcase=arenas` does a fly-through of the arenas and then plays one.
- Cross-piece edits: `src/core/showcase.js` (the router entry), `src/core/placeholders.js` (the run placeholder now plays real arenas, walks through the exit to the next one, and `debug.goto` works), and `src/combat/combat.js` (aim assist skips props). Notes are in `waves/w1/build/arenas.md`, and the known gaps listed there include rooms that are dark away from the 8-light pool.
- The container restarted partway through the build, and the builder was resumed from its work on disk.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.
