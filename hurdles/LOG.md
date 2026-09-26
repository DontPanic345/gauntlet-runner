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
