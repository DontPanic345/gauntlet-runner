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

## 2026-09-28 — w1 critique: vfx

- Critic pinned 10 Minutes Till Dawn (https://flanne.itch.io/10-minutes-till-dawn, 4.8 stars / 744 ratings) and wrote the review, 3 matched strip pairs (hit spark, death burst, spawn), the blind packet, criteria and key; all verified on disk. The reference has no dash, so dash was judged in the review only.
- Biggest gap: the kill has no punchy pop frame. The burst fires ~330 ms late, away from the impact point, as a pale dithered disc plus floor-grey cubes. It should fire on the killing-blow frame at impact as a hard-edged cream/yellow star gone by frame 5, followed by body-coloured chunks that bounce and fade.
- Other problems: damage number covers the hit spark, the light flash draws as an opaque disc over the contact, low-contrast pale-grey effects, weak dash in play, the showcase spawn portal spawns nothing, and the stress test peaks around 1,600 particles, not 2,000. No console errors.

## 2026-09-28 — repo fix: binary files corrupted in git

- The clerk found that `.gitattributes` (`* text eol=lf`) made git treat PNGs as text and strip CR bytes on commit, so every committed image (119 files, all critic captures and blind packets so far) was corrupted in the repo. Working copies were intact. Added `binary` rules for image, video, audio and font types and re-stored every file with `git add --renormalize`; HEAD blobs now match the working copies byte for byte. Commits before this one still hold corrupted images; do not restore captures from them.

## 2026-09-28 — w1 critique: enemies

- Critic pinned 10 Minutes Till Dawn (https://flanne.itch.io/10-minutes-till-dawn, 4.8 stars / 744 ratings). Furcifer's Fungeon was tried but its Godot build ran too slowly headless. The critic wrote the review and 4 matched pairs (cast in play, cast close-up, attack strip, death strip), plus the blind packet, criteria and key; all verified on disk.
- Biggest gap: in play, enemies overlap each other and the hero, collapsing into one heap, and husk-arc and brute-lane telegraphs draw under the hero. Separation radii should match rendered size (husk ~0.5, brute ~0.8, mite ~0.3, versus 0.3/0.5/0.17 today), husks should keep arm's length from the hero, and telegraph decals should draw on top.
- Other problems: the husk windup turns muddy brown, the brute is no taller than the hero and floor-coloured, the husk reads as a crumpled bundle at rest, the showcase brute stuns at the hero's feet, mites pile onto the hero, and the run camera is zoomed far out. must_have: telegraphs pass (weak), no-stacking fails visually, deaths pass, knobs-as-data pass. No console errors.

## 2026-09-28 — w1 critique: budget guard stop

- The budget guard tripped after enemies: the session window was at 81%, over the 50% limit, and resets Mon 28 Sep 21:20. Weekly was at 55%, resetting Sat 03 Oct 22:00. The next session resumes the critique queue serially at `arenas`: arenas, gauntlet, boons, boss, hud, audio, title, run-flow.

## 2026-09-28 — w1 critique: arenas

- Critic pinned Furcifer's Fungeon (https://playwithfurcifer.itch.io/furcifers-fungeon, 4.7 stars / 126 ratings). The live headless build could not get past its tutorial hub (matching a prior critic's finding), so the two room stills use the developer's own itch.io screenshots and the one motion strip uses a live-captured burst from the tutorial hub, flagged as a fairness caveat in the review and described neutrally in criteria.md. Wrote the review and 3 matched pairs (two room stills, one combat strip), plus the blind packet, criteria and key; all verified on disk.
- Biggest gap: the five arena templates (vestibule/ossuary/hall/gallery/antechamber) are nearly pixel-identical across seeds 1, 2 and 999 (same statue, banners, crates, rubble; only a mirror flip and a prop reskin differ), so replays instantly recognize "room 1" instead of feeling regenerated. Give every arena a composition visibly different from every other arena, and make seeds actually reshuffle it.
- Other problems: wave escalation is non-monotonic on seed=1 (kill targets 5, 13, 9, 19, 28 — room 3 asks for fewer kills than room 2, seed-dependent); door-seal-on-entry is nearly invisible (only a title banner and a small red glow, no gate/grille/shake/dust) versus a genuinely good room-cleared celebration. must_have: composition/focal-props pass, floor/seed variation fail, door-seal-on-entry fail, clear celebration pass, escalation fail, seed-reproducibility pass, props break/react pass. No console errors.

## 2026-09-28 — w1 critique: gauntlet

- Critic pinned Pizza Tower Demo (https://pizzatowerguy.itch.io/pizza-tower-demo, 4.9 stars / 402 ratings) for its signature "escape" chase sequence. Windows-only, so ref captures use the developer's own GIFs/screenshots per protocol. Wrote the review and 3 matched pairs (chase strip, trap moment, corridor establishing shot), plus the blind packet, criteria and key; all verified on disk.
- Biggest gap: the hero is completely invisible during corridor play, confirmed across the showcase, normal play via `debug.goto`, god-mode, bot-mode and manual WASD control — position state updates every frame but no sprite ever renders, so the piece's entire premise (watching yourself dash and dodge while chased) is currently unwatchable.
- Other problems: the corridor's rendering style breaks from the voxel/AO look established by every other piece; the "release beat" on reaching the end is just text ("ESCAPED") with the wall stopping, no door-slam or shake event as must_have requires; trap telegraphing can only be confirmed via the debug T overlay, not in normal play. must_have: two fail outright (trap fairness unverifiable, no release event), two partial pass (collapse spectacle, tension ramp). No console errors.

## 2026-09-28 — w1 critique: boons

- Critic pinned Vampire Survivors (https://poncle.itch.io/vampire-survivors, 4.8 stars / 1652 ratings), captured live via its itch.io HTML5 build. Wrote the review and 4 matched pairs (choice screen, single-choice closeup, boons-in-action strip, dramatic effect still), plus the blind packet, criteria and key; all verified on disk.
- Biggest gap: the shrine's card-reveal animation is broken and far too slow, showing 3-8 seconds of dithered black/white checkerboard noise (or blank-white cards in one run) instead of card art before the choice is legible. This needs to resolve in well under a second through an intentional transition.
- Other problems: hover/focus feedback under keyboard browsing (A/D) is essentially invisible, no scale/glow/lift found across consecutive frames; the reference's combat reads as more visually exciting partly due to genre (bullet-heaven enemy counts) but the showcase dummy room also doesn't spawn enough enemies to show boon AoE/chain effects at scale; pickup vacuum confirmed working but the sound-ladder half of that must_have is unverifiable without audio capture; card back-face/rarity styling only becomes visible once the slow reveal finishes. must_have: visible boon effects pass (7 verified live), choice screen as tactile moment fails, vacuum+sound partial, 4+ synergy pairs not directly verified (data exists but not captured combined). No console errors.

## 2026-09-28 — w1 critique: boss

- Critic pinned Gun Knight (https://stepford.itch.io/gun-knight, 4.5 stars / 496 ratings). Its HTML5 web build is a broken test port per the dev, so the critic used the developer's own official screenshots and promo GIF instead of live capture. Wrote the review and 4 matched pairs (boss reveal, sweep-attack telegraph, slam-attack telegraph, motion strip), plus the blind packet, criteria and key; all verified on disk.
- Biggest gap: phase transitions are not events. When the boss crosses an HP threshold the sim state flips to "transition" but the boss just freezes in place for well under a second with no camera work, re-announcement, or color/particle change before combat resumes, directly failing the phase-transitions-are-events must_have.
- must_have: intro passes, telegraphed/dodgeable attacks partial (telegraphs read clearly but lead time looked short, ~150-300ms, untimed against dash i-frames), phase transitions fail, death sequence passes and is genuinely the best-looking moment (explosion, ring-flash, "THE WARDEN FALLS" banner, corpse + key prompt). No console errors.

## 2026-09-28 — w1 critique: budget guard stop

- The budget guard tripped after boss: the session window was at 62%, over the 50% limit, and resets Tue 29 Sep 03:10. Weekly was at 60%, resetting Sat 03 Oct 22:00. The next session resumes the critique queue serially at `hud`: hud, audio, title, run-flow.

## 2026-09-29 — w1 critique: hud

- Critic pinned Bright Lancer (https://slo-nod.itch.io/bright-lancer, 4.5 stars, 140 ratings) and wrote the review, 6 matched pairs (six HUD states: idle, damage drain, shards, boons, low-health, boss bar), the blind packet, criteria and key; all verified on disk.
- Biggest gap: the HUD packs five distinct UI components (hearts, shards, boons, track, boss bar) all demanding attention simultaneously, while the reference uses a single focal point that never distracts from gameplay. Consolidate into 2–3 visual zones with clear priority hierarchy (health/danger in one corner, active upgrades elsewhere).
- Other problems: information overload (25% of viewport), boon row unreadable (small tight icons, no labels), track progress competing with health, boss bar lacks entrance animation, damage number stacking not showcased, shard counter animation too subtle, low-health vignette too weak. must_have: pixel-perfect pass, animates-changes pass with reservations, never-covers-action fail, low-health-felt pass. No console errors.

## 2026-09-29 — w1 critique: audio

- Critic pinned Vampire Survivors (https://poncle.itch.io/vampire-survivors, 4.8 stars / 1652 ratings) and wrote the review, 3 matched spectrogram pairs (SFX moments, mixed combat, music layers), the blind packet, criteria and key; all verified on disk.
- Biggest gap: SFX punch and presence—every sound in VS occupies clear frequency space and rides the mix with confidence; ours sounds thinner, hits lack crispness to feel heavy, pickup ladder is inaudible during combat. Fix: raise baseline SFX amplitude 2–3 dB and sharpen high-end hit transients.
- 10 specific problems identified: transient clarity (hits sound like thumps not strikes), music too loud masking telegraphs, pickup ladder buried, boss phase transitions lack ceremony, no sub-bass urgency in low-health mode, collapse rumble competing with music, no boon-gain fanfare, music intensity crossfade mushy, no pitch variety in windups, and console-error free. must_have: no-repeat-sounds pass, music-reacts pass, mix-balanced fail, audio-starts-clean pass. No console errors.

## 2026-09-29 — w1 critique: title

- Critic pinned 10 Minutes Till Dawn (https://flanne.itch.io/10-minutes-till-dawn, 4.8 stars, 742 ratings) and wrote the review, 4 matched pairs (title vignette, menu navigation, settings screen, pause menu), the blind packet, criteria and key; all verified on disk.
- Biggest gap: the title screen shows every visual system at once (3D vignette, logo, multi-screen menus, settings) with no clear focal point, whereas the reference has one undeniable "Start" button. Simplify by picking vignette OR logo (not both), hide all options until after Start confirmation, reduce settings from 8 rows to 3–4 tabs.
- 9 problems identified: visual clutter (5 competing focal points), logo animation reads as nervous flicker (dither dense, pulse slow), menu focus feedback lacks weight (2px chevron vs. scale/glow), settings screen too tall for viewport, "PRESS START" blinks slowly (waiting feeling not urgency), Credits/Controls buried, pause menu uses same heavy chrome, no tactile feedback on selection (scale/flash/shake), logo gems/chains too small. must_have: first-frame-beautiful pass, logo-designed pass, menu-nav-juice fail, settings-persist pass. No console errors.

## 2026-09-29 — w1 critique: run-flow

- Critic pinned Vampire Survivors (https://poncle.itch.io/vampire-survivors, 4.8 stars, 1652 ratings) and wrote the review, 3 matched pairs (death moment, summary screen, victory moment), the blind packet, criteria and key; all verified on disk.
- Biggest gap: the death sequence is instant (black fade) not cinematic; spec says "slow-mo, collapse of the screen" but renders as a loading-screen snap to summary. Add 300–500ms slow-motion (0.3x timescale) with rumble and screen effects before fade-to-black so death feels like a climax, not a punishment.
- 6 problems identified: no slow-motion on death (biggest gap), summary screen text-only with no visual design (zero reason to screenshot), summary-to-restart transition abrupt and joyless, late-game arena/boss scenes lack cinematic presence (solo vignettes in empty void), victory sequence also lacks setup, no "new best time" visual indicator for replayability. must_have: death-to-summary under-3s fail (no cinematic weight), transitions styled fail (black fades only), summary-worth-screenshotting fail, full-run-completable pass, seed-shown pass. No console errors.

All wave 1 critique pieces now complete. Advancing to judge phase.

## 2026-09-29 — w1 judge: batch 1 (look, hero, movement, combat)

Four judges ran in parallel on the first batch of pieces. Results:
- **look** (vs Nuclear Throne): B wins (clear) — WE WON. Our look is polished and cohesive; reference is washed-out sandy environment. Reference's biggest gap: lacking unified visual identity.
- **hero** (vs 10 Minutes Till Dawn): B wins (decisive) — WE WON. Our hero is readable and animate with weight; reference is sprite-scale too small to see detail. Reference's biggest gap: must increase sprite scale 3–4x minimum.
- **movement** (vs Bright Lancer): B wins (clear) — WE WON. Our movement is tighter and snappy; reference lacks visual feedback indicators. Reference's biggest gap: add movement direction lines and dash trails.
- **combat** (vs Backstreet Warriors): A wins (clear) — WE LOST. Reference wins on consistent hit weight and frame animation; our side peaks at one white-flash moment but lacks sustained punch. Our biggest gap: inconsistent hit feedback across the combo, need sustained hitstop and visual weight on all hits not just the third.

Next batch (vfx, enemies, arenas, gauntlet) queued for judging.

## 2026-09-29 — w1 judge: batch 2 (vfx, enemies, arenas, gauntlet)

Four judges ran in parallel on the second batch. All four pieces WON:
- **vfx** (vs 10 Minutes Till Dawn): B wins (clear) — WE WON. Our effects are layered and colorful; reference's are minimal. Reference's biggest gap: add punchy particle bursts with warm tones and clear timing.
- **enemies** (vs 10 Minutes Till Dawn): B wins (decisive) — WE WON. Our cast is readable and distinct; reference is four identical jellyfish with stiff animation. Reference's biggest gap: add multiple enemy archetypes with clear silhouettes and personality.
- **arenas** (vs Furcifer's Fungeon): A wins (clear) — WE WON. Our arenas are isometric with varied detail and craft; reference feels procedural with flat dungeon walls and obvious repeating patterns. Reference's biggest gap: add handcrafted environmental detail and visual storytelling to each room.
- **gauntlet** (vs Pizza Tower): A wins (clear) — WE WON. Our corridor has dark fire-filled aesthetic and genuine tension; reference is playful and whimsical, undercutting urgency. Reference's biggest gap: use darker palette and active threat feedback to build dread during escape.

Next batch (boons, boss, hud, audio, title, run-flow) queued for judging.

## 2026-09-29 — w1 judge: batch 3 (boons, boss, hud, audio)

Four judges ran in parallel on the third batch. Results:
- **boons** (vs Vampire Survivors): B wins (decisive) — WE WON. Our upgrade system is vivid and exciting; reference's effects are subtle. Reference's biggest gap: add visual impact to boon reveals and effect feedback.
- **boss** (vs Gun Knight): A wins (clear) — WE WON. Our boss is imposing with strong telegraphs and epic intro; reference has good attack patterns but less menace. Reference's biggest gap: strengthen intro build-up and phase-transition visual spectacle.
- **hud** (vs Bright Lancer): A wins (clear) — WE LOST. Reference's HUD is minimalist and clean; our side clutters screen with 5 competing elements. Our biggest gap: consolidate HUD into 2–3 priority zones, reduce information load, and never cover the action center-screen.
- **audio** (vs Vampire Survivors): TIE — WE WON. Both games are evenly matched: functionally complete, bug-free, but both lack the spectral richness and mix density expected from polished roguelites. Tied verdict is provisional; re-critique audio every wave until the rest are won.

Next batch (title, run-flow) queued for final judging.

## 2026-09-29 — w1 judge: batch 4 (title, run-flow)

Two judges completed the final batch:
- **title** (vs 10 Minutes Till Dawn): A wins (clear) — WE LOST. Reference's title screen is minimalist and responsive; our side has visual clutter and no menu animation. Our biggest gap: pick one focal point (vignette OR logo), reduce menu complexity, add snappy menu transitions.
- **run-flow** (vs Vampire Survivors): B wins (clear) — WE WON. Our run loop is cinematic and complete with slow-mo death and styled transitions; reference sacrifices completeness for spectacle. Our biggest gap: none—we win.

## 2026-09-29 — w1 resolve

All 14 judged pieces received verdicts. Results:
- **Won** (11 pieces): look, hero, movement, vfx, enemies, arenas, gauntlet, boons, boss, audio, run-flow
- **Lost** (3 pieces): combat, hud, title

Wave 1 complete. Three pieces failed blind judge: combat (reference hit weight inconsistency), hud (reference minimalism), title (reference menu animation). These three will rebuild in wave 2. All 11 winners advance to the next wave's critique to re-verify their position against tougher references or to be certified "best in class."

Advancing to **wave 2, build phase**. Queue: combat, hud, title (in build order).

## 2026-09-29 — w2 build: combat

- Builder addressed the judge's verdict "lacks consistent hit feedback and punch across the full combo sequence" by extending all hit feedback proportionally: knockback increased (1.7→2.5, 2.1→3.2, 8.5→12 u/s), hitstop extended (55→65ms, 62→75ms, 95→120ms), white flash duration lengthened (3→4, 3→4, 5→7 ticks), screen kick and shake increased across all hits, and camera shake duration extended (120→140ms, 120→140ms, 220→280ms). Hit 3 now visibly heavier with 120ms hitstop vs 65ms on hit 1, larger light radius, and stronger intensity boost.
- Cross-piece edits: none.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames. Builder notes in `waves/w2/build/combat.md`.


## 2026-09-29 — w2 build: hud

- Builder consolidated the HUD layout from 5 competing elements into 2-3 clear priority zones: PRIMARY (hearts + dash pips, top-left), SECONDARY (shards top-right, boons bottom-left, track bottom-center at 55% opacity), DYNAMIC (boss bar, center-bottom with entrance animation). Enhanced boss bar with slide-down entrance (12 ticks, scale-grow, brief shake), shard counter with scale-pop on changes, low-health vignette with increased opacity (0.32→0.5-1.0 peak), enlarged boon icons (16→18 px, 3 px spacing), and dimmed track (smaller nodes, dimmed opacity). All APIs preserved.
- Cross-piece edits: none.
- Smoke test: showcase exits 0 with 0 console errors and non-blank frame. Builder notes in `waves/w2/build/hud.md`.


## 2026-09-29 — w2 build: title

- Builder added menu focus transition animation (150ms snappy glow outline on navigation) to provide the "clear, responsive state changes" the blind judge found missing. Refined logo pulse animation to slower 6-second cycle with reduced dither density, eliminating the nervous-flicker effect. Improved "PRESS START" prompt blink timing from slow (1.1s) to fast/urgent (0.3s) to signal action. Streamlined settings menu by moving FPS toggle to debug-only, reducing menu from 8 to 6 rows (clutter 24%→16% screen height).
- Cross-piece edits: none.
- Smoke test: showcase exits 0 with 0 console errors and non-blank frame. Builder notes in `waves/w2/build/title.md`.

All wave 2 build pieces are now complete. Advancing to `integrate`.

