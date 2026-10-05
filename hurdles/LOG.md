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

## 2026-09-30 — w1 build: gauntlet

- Builder added `src/world/corridor.js`, `traps.js`, `collapse.js` and `showcase-gauntlet.js`: a side-scrolling corridor run over a cliff with 3 to 5 trap beats (spike plates, swinging blades, fire jets, crumbling floor over pits), all telegraphed in the enemies' floor language. A collapse chases the hero, with falling boulders and slabs, dust, embers, a rumble and a red kill line. It speeds up when the hero stalls and ends when the collapse smashes into a slab gate. In `?showcase=gauntlet` a demo pilot runs the corridor, T shows the timing overlay and L toggles slow-mo.
- Cross-piece edits: `src/core/showcase.js` (the router entry) and `src/core/placeholders.js` (`arena:exit` now goes to the new `gauntlet` scene). Notes are in `waves/w1/build/gauntlet.md`. The demo pilot is scripted to pause at each beat. Collapse speeds are tuned only against that pilot, and the sounds have not been listened to.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-09-30 — w1 build: budget stop

- The budget guard tripped after gauntlet: the session window was at 72%, over the 50% limit, and weekly was at 93%. The next run resumes the build queue at `boons`.

## 2026-10-03 — w1 build: boons

- Builder added `src/progression/` (`boons.js`, `icons.js`, `sfx.js`, `pickups.js`, `effects.js`, `cards.js`, `shrine.js`, `hud.js`, `index.js`, `showcase.js`): 16 boons in four rarity tiers with stack limits, each with its own effect in combat, and 6 synergy pairs that the cards, the boon bar and a banner announce. A shrine rises after an arena clear, and E opens a pick-1-of-3 card screen where the cards land, flip and flare by rarity, and the chosen card flies into the hero. Soul shards and hearts pop out, vacuum to the hero, and the shard pickup sound climbs a scale. `?showcase=boons` is a self-running shrine demo, and `&give=<ids>` gives a room of passive, respawning husks.
- Cross-piece edits: `src/combat/combat.js` (optional `modHit` and `guard` hooks), `src/core/placeholders.js` and `src/world/corridor.js` (they wire in the progression system), and `src/core/showcase.js` (the router entry). Notes are in `waves/w1/build/boons.md`. With bulwark's ward or phoenix unspent, `debug.kill()` and `debug.hurt()` are refused once. Shards cannot be spent yet. The post-clear shrine lives in the run placeholder for `run-flow` to take over. Lightning draws over walls, and the sounds have not been listened to.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-10-03 — w1 build: boss

- Builder added `src/boss/` (`models.js`, `sfx.js`, `warden.js`, `arena.js`, `fight.js`, `scene.js`, `showcase.js`): the Warden, a jailer-knight with a ball and chain, fought in three phases in a round pit. Phase I has a chain sweep, a lash that buries the ball (a punish window) and a stomp. Phase II adds a leap slam with a shockwave ring. Phase III adds a shrinking cage, husk summons and a double ring. Hits fill a poise bar, and breaking it staggers the Warden. Phase changes play out as events, and the fight has an intro, which can be skipped, and a death sequence that leads to the victory screen. It is reachable through `?scene=boss` and by walking out of arena 5. `?showcase=boss` plays a demo pilot that dodges two threats in three.
- Cross-piece edits: `src/main.js` (one import, which replaces the placeholder boss scene) and `src/core/showcase.js` (the router entry). `warden.js` adds `ENEMY_DATA.warden` to the enemies data table at runtime. A new hook, `debug.boss(...)`, was added. Notes are in `waves/w1/build/boss.md`. Known gaps: from the high camera the model reads mostly as helm and pauldrons, the back wall is dim, hp does not carry over from the run, tuning has only been tested against the pilot, and the sounds have not been listened to.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-10-03 — w1 build: budget stop

- The budget guard tripped after boss: the session window was at 66%, over the 50% limit. Weekly was at 9%. The next run resumes the build queue at `hud`.

## 2026-10-03 — w1 build: hud

- Builder added `src/ui/hud.js`, `src/ui/damage-numbers.js`, `src/ui/showcase-hud.js` and `src/ui/widgets/` (`draw.js`, `hearts.js`, `dash.js`, `shards.js`, `track.js`, `boons.js`, `bossbar.js`, `vignette.js`, `sfx.js`): hearts that drain and shatter, a dash pip that refills, a shard odometer with a "+n" tally, a room track (5 arenas, 4 corridors, boss) with a hopping runner marker and wave pips, a boon row with tooltips (new boon, Tab, hover) and the synergy banner, a boss bar for any boss (drain chunk, notches, poise and stagger), stacking damage numbers (gold crits, red hero damage), and a dithered low-health vignette with a heartbeat. Panels dither aside when something is under them. It is the HUD in the run, gauntlet and boss scenes. `?showcase=hud` is a dummy fight with keys for every element and a partly scripted demo.
- Cross-piece edits: `src/core/placeholders.js` and `src/world/corridor.js` (HUD wiring, old HP text removed), `src/boss/scene.js` and `src/boss/fight.js` (an `externalHud` flag skips the fight's own hp and boss bar), and `src/core/showcase.js` (the router entry). Notes are in `waves/w1/build/hud.md`. The combat, boons and boss showcases still use the stand-in numbers and boon HUD. The heartbeat has not been listened to, and gamepad is untested.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-10-03 — w1 build: audio

- Builder added `src/audio/` (`engine.js`, `synth.js`, `synth-worker.js`, `bank.js`, `music.js`, `ambience.js`, `director.js`, `index.js`, `showcase.js`): one AudioContext with music, SFX, telegraph, UI and ambience buses, a shared reverb and a master limiter, starting on the first gesture. A bank of 43 jsfxr-style sounds with 4 to 8 variants each, plus pitch and volume jitter. Music in D minor: a title theme, an arena loop that layers up with combat intensity, a corridor chase layer with a proximity alarm, and a boss theme with phase layers. The music muffles at low health, in pause and on death, and ducks under telegraph cues. `?showcase=audio` is a sound board with meters, a spectrum and a scripted tour.
- Cross-piece edits: `src/main.js` (one import), `src/core/showcase.js` (the router entry), and a 3-line reroute to the shared context and bus in `src/combat/sfx.js`, `src/enemies/sfx.js`, `src/progression/sfx.js`, `src/boss/sfx.js`, `src/ui/widgets/sfx.js`, `src/world/props.js` and `src/world/traps.js`. `director.js` replaces the most frequent of those stand-in sounds by overriding their exported voice objects. Notes are in `waves/w1/build/audio.md`, including how critics record the master bus (`debug.audio('record', ms)`, `debug.audioStream()`).
- Balanced by measurement only; the music has not been listened to. Each song is an 8-bar loop, song switches can lag up to 0.6 s, and boss phase III music was only reached on the board.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-10-03 — w1 build: budget stop

- The budget guard tripped after audio: the session window was at 53%, over the 50% limit. Weekly was at 16%. The next run resumes the build queue at `title`.

## 2026-10-04 — w1 build: title

- Builder added `src/ui/title.js`, `menus.js`, `settings.js` and `showcase-title.js`: a voxel title scene (the hero rig idling before a carved arch with a skull keystone, braziers, banners, drifting embers and a periodic tremor), a logo drawn pixel by pixel from custom letterforms (carved GAUNTLET with ember cracks, a sword, molten RUNNER, a sweeping glint), and a main menu (Start Run, Settings, Controls, Credits) with a springing focus plaque, flame cursor and sounds. Start Run sends the runner into the arch and a dithered iris opens on the run. Settings (master/music/SFX volume, shake, flashes, button prompts) persist in localStorage and apply live. Controls rebinds each action's main key. A pause menu works over run, gauntlet and boss, with a confirm before quitting to the title. Keyboard, mouse and gamepad paths exist.
- Cross-piece edits: `src/main.js` (import, iris drawn after the scene UI, pause toggle yields to the pause menu), `src/core/input.js` (`input.ui.count`, so fast presses are not merged on slow frames), `src/core/settings.js` (`keyDisplay`), `src/core/showcase.js` (the router entry) and `src/audio/director.js` (title music in the showcase). Notes are in `waves/w1/build/title.md`. The UI sounds have not been listened to, gamepad is untested, and the scene takes about 400 ms to build behind a dark background.
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.

## 2026-10-04 — w1 build: run-flow

- Builder added `src/run/` (`index.js`, `record.js`, `flow.js`, `arena-scene.js`, `endings.js`, `summary.js`, `wall.js`, `sfx.js`, `showcase.js`): a scene router that moves between arena, corridor and boss behind a wall of stone blocks carrying a card for the next segment, with hp and seed carried across. Every arena entry drops the hero in from above, and a fresh run shows a RUN n / THE GAUNTLET / SEED card. Death plays slow motion, a violet colour drain and letterbox bars, then the frame cracks apart into a void and a summary slab drops in (a crop of the hero, a depth track with the cause of death, six counted stats, boon icons, a lore line, seed, best time and deepest room). Victory pours gold light into the pit, whites out (respecting the flashes setting) and shows a gold-trimmed summary. R restarts on a new seed, E on the same seed, Esc goes to the title. Meta (best time, best depth, kills, deaths by cause, 12 lore lines) persists in localStorage. `?showcase=run-flow&at=intro|transition|death|summary|victory` drives the real scenes, with staged history labelled on screen.
- Cross-piece edits: `src/core/scenes.js` (a `scenes.router` hook, `goNow()` and a `pending` getter, inert without a router), `src/main.js` (one import and the `flow.draw` call) and `src/core/showcase.js` (the router entry). Notes are in `waves/w1/build/run-flow.md`. The sounds have not been listened to, there is no gamepad restart button, cause of death is inferred from events, corridors and the boss have no drop-in, and time to control after R was not measured on real hardware (headless ran at 4 to 7 fps).
- Smoke test: showcase, title and run all exit 0 with 0 console errors and non-blank frames.
- Wave 1 build is complete. The next phase is integrate.

## 2026-10-04 — w1: budget stop

- The budget guard tripped after run-flow: the session window was at 69%, over the 50% limit. Weekly was at 25%. The next run starts the integrate phase.

## 2026-10-04 — w1 integrate

- The integrator played title → run → arena 1 (clear, shrine, boon choice) → corridor 1 → arena 2 → pause, then a death and an R restart, a corridor death and Esc to the title, and the boss from a run (intro, three phases, death, victory). It measured performance in a 6-enemy fight.
- Fixes: combat hit particles now go through the shared vfx pool and use the hud's real damage numbers (`src/combat/fx.js`, `combat.js`); the boss and boons showcases use the real HUD; the HUD hides during the boss intro and the boon choice, and the run card no longer draws under the pause panel; the corridor and boss clocks wait for the transition wall to open; a new opt-in `shakeUi` scene flag lets the gameover and victory screens shake (`src/core/scenes.js`, `feedback.js`, `run/endings.js`); the attack input buffer went from 200 ms to dash's 133 ms.
- Foundation: all five `must_have` items pass.
- Seams left: two impact stars on every hit (combat/vfx), the collapse kills on first touch (gauntlet), no drop-in for corridors and the boss (run-flow), shards have no use and the title shows no best time, dead placeholder scenes (foundation), dark between torches (look), gamepad untested, audio not listened to, and performance on a real GPU unmeasured (headless corridors run at 4 to 5 fps). The integrator said no piece needs a rebuild. The report is in `waves/w1/integration.md`.
- Smoke test: all 15 showcases, `/` and `/?scene=run&seed=1` exit 0 with 0 console errors and non-blank frames.
- The next phase is critique, with all 14 judged pieces queued.

## 2026-10-04 — w1 critique: look

- The critic found the floor as loud as the characters (ink-black grout, heavy speckle), so actors don't separate from the floor. Must-haves: outlines on dark surfaces and the finished-game still frame fail; texel snapping and palette pass; torch flicker is a weak pass. 4 pairs (2 stills, 2 strips). The reference isn't HTML5, so its side comes from page screenshots and GIFs. Pinned reference: https://ember-paw-games.itch.io/gaunt-valkyr (4.9 stars (94 ratings)).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/look/review.md`.

## 2026-10-04 — w1 critique: hero

- The critic found the hero reads as a plain navy box from behind and the side, close in value to the floor, and asks for a smaller hood, a lagging cloak and a lighter or warmer hood/cloak colour. Must-haves: silhouette at 1x fails; the other four pass, some weakly. 5 pairs (idle, run, dash and combo strips at 10 fps, plus an in-scene still). The reference's Unity build was played locally. Pinned reference: https://slo-nod.itch.io/bright-lancer (4.5 stars (140 ratings)).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/hero/review.md`.

## 2026-10-04 — w1 critique: movement

- The critic found the dash reads as a hop (2.5 units in 11 ticks, one visible frame) and asks for about 3.8 units over about 13 ticks with a smear, after-images, take-off dust and a landing skid. Must-haves: start/stop and dash pass (dash presses more than about 133 ms early are dropped); wall sliding fails on round pillars; camera look-ahead fails in arena play because the clamp removes the lead. 5 strip pairs at 10 fps. The reference is the same game as hero's (Bright Lancer), played live from the local copy. Pinned reference: https://slo-nod.itch.io/bright-lancer (4.5 stars (140 ratings)).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/movement/review.md`.

## 2026-10-04 — w1 critique: combat

- The critic found hits don't visibly land on the blade: the contact frame is a solid white silhouette and the smear is drawn above the hero's head. It asks for a slash streak at the contact point, cut along the swing, with a shorter tinted flash; the smear part needs the hero piece too. Must-haves: the per-hit impact set and getting hurt fail (hits 1 and 2 barely knock back and sound the same; the hurt flash is faint); the combo window is half (forgiving but mashy); no whiffs passes. 4 pairs (a combo strip, a first-hit still, a third-hit still and a hurt strip). The reference is Bright Lancer, played live. Pinned reference: https://slo-nod.itch.io/bright-lancer (4.5 stars (140 ratings)).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/combat/review.md`.

## 2026-10-04 — w1 critique: budget stop

- The budget guard tripped after combat: the session window was at 66%, over the 50% limit. Weekly was at 34%. The next run resumes the critique queue at `vfx`. Critic prompts were generated under the gitignored `shots/critic/`, so the next run regenerates them from `prompts/critic.md`.

## 2026-10-04 — w1 critique: vfx

- The critic found that kills aren't events. Effects are small, mostly white on a warm floor, gone within about 300 ms, and leave nothing on the floor. It asks for a white-then-black silhouette flip, a torch-orange starburst about 2.5x the enemy with rising black smoke, 10–16 body-coloured chunks that come to rest, and a splat decal that stays for the room. Must-haves: pooling passes (2544 particles at 0.1 ms sim; 60 fps unmeasurable headless); palette and grid pass; ambient layer passes; pop-then-fade is a weak pass (fade lasts 2–3 frames). 4 pairs: hit, death and dash strips at 10 fps of game time, plus a hit still. There is no spawn pair because the reference media shows none. Our side was captured on a paused fake clock, frame by frame. The reference isn't HTML5, so its side comes from its gameplay GIFs. Pinned reference: https://ember-paw-games.itch.io/gaunt-valkyr (4.9 stars (94 ratings)).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/vfx/review.md`.

## 2026-10-04 — w1 critique: enemies

- The critic found the enemies don't stand out from the dark violet arena floor in play. It asks for a lighter body, one bright accent per enemy (Husk eyes, a glowing Brute maw, a cool white Wisp core so it stops matching the torches), a 1-pixel dark outline and a contact shadow. All four must-haves pass. The telegraphs are the strong part, though in play the Husk and Mite warnings are late and small. Deaths are small and dim, and a hit turns the enemy into a white blob. 4 pairs from live play at 10 fps (a mixed-cast still, then telegraph, death and hit-reaction strips). The reference was downloaded and served locally because the capture tool's Chromium rejects the proxy certificate for itch's CDN. Pinned reference: https://playwithfurcifer.itch.io/furcifers-fungeon (4.7 stars, 4.69 from 126 ratings).
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/enemies/review.md`.

## 2026-10-04 — w1 critique: arenas

- The critic found all five arenas built on one identical shell (the same rectangle, doors, corner torches and flat walls), with no focal set-piece and no clustered edge props, so every room reads as one generic dark flagstone box. Must-haves: hand-made look is a partial fail. Door slam fails: the portcullis bars pop in between two frames with no fall, faint dust and no visible shake. The clear moment passes. Wave escalation and seeds pass, though seed variation is barely visible. Props react is a weak pass. Other problems: a dead void at the bottom of the frame, rune circles that look like debug overlays, and the run title drawn over the room banner. 4 pairs (3 room stills, plus a strip of the clear moment with the exit opening, at 200 ms per frame). The door slam is judged only in the review, because no fitting HTML5 reference shows one. Pinned reference: https://playwithfurcifer.itch.io/furcifers-fungeon (4.7 stars, 126 ratings), the same game as enemies, played live.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/arenas/review.md`.

## 2026-10-04 — w1 critique: budget stop

- The budget guard tripped after arenas: the session window was at 61%, over the 50% limit. Weekly was at 42%. The next run resumes the critique queue at `gauntlet`. Critic prompts are generated from `prompts/critic.md` into the gitignored `shots/critic/` with the repo path changed to `/home/user/gauntlet-runner`. Tooling tips worth passing on to critics: drive our game on Playwright's paused fake clock to step frame by frame (real-time headless runs at 6–11 fps), and download itch HTML5 builds with curl and serve them locally, because the capture tool's Chromium rejects the proxy certificate for itch's CDN.

## 2026-10-04 — w1 critique: gauntlet

- The critic found the chase only exists for a player who plays badly. Dashing straight through the traps (dash i-frames ignore raised spikes: 21 dodges, 3 fire-jet hits) cleared corridor 2 in 6.5 s with the collapse 33 units back and off screen almost the whole way. It asks for dashes that no longer phase through traps and a lead capped at about 7–9 units so the collapse stays in frame. Must-haves: the spectacular collapse is a partial fail (it glows and shakes, but reads as a static band of dark cubes, with nothing falling); traps telegraphing fairly fails (the loud red checkerboard is the safe warning state, the deadly raised spikes are dull grey, with 0.2–0.7 s of warning; the blades read as pistons); tension ramp is a technical pass but weak in feel (3.7 to 6.3 u/s when you stop, but easing lets the gap grow without limit); the release beat passes (the gate slams, SAFE, the rumble stops), though the frame is cluttered. Other problems: hero/floor contrast, stacked DODGE text, the hero vanishes when caught, and no grace period at the corridor entrance. No console errors. 4 pairs, all 12-frame strips at 100 ms on a paused fake clock except one still: crossing spikes, dashing past a hazard, killed by a hazard, a mid-section still.
- Pinned reference: https://maddymakesgamesinc.itch.io/celesteclassic (4.69 stars (1,000+ ratings)). It has no chasing wall: the critic found no highly rated HTML5 chase game (itch listing pages return 403 to curl and WebFetch), and the review notes that the blind result may favour us on the chase half of the question.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/gauntlet/review.md`.

## 2026-10-04 — w1 critique: boons

- The critic found that in combat the boons are tiny white-and-gold specks over the base combo, mostly alike and sometimes invisible. It asks for each boon to get its own big shape in its own colour, sized for normal play zoom: real fireballs for Ember Orbit, a thick bolt for Chain Spark, a travelling crescent for Moon Wave, visible blood droplets for Leech, and so on. Must-haves: every boon visible in combat fails (Leech, Heavy Hand, Keen Edge apart from its CRIT! text, Fleet Foot and Soul Hunger look like no boon at all; Ember Orbit is two tiny yellow squares; at zoom 1 almost nothing reads); the choice screen as a moment passes, and the critic judged it clearly better than the reference's; pickups vacuum passes (sound unheard); synergies pass (all six active). Other problems: about 200 ms of near-black before the cards appear, unhighlighted cards lose their icons, the two common cards look identical, shards are 2–3 px specks, the taken card is a flat white slab for one frame, all boons at once pile up as mush, and shards buy nothing. No console errors. 6 pairs: three of the choice screen (open, cards appearing, taking one) and three combat strips (an orbiting upgrade, every upgrade at once, pickups collected).
- Pinned reference: https://poncle.itch.io/vampire-survivors (4.8 stars (1,656 ratings)), whose HTML5 build was played live from a local copy, reaching matched moments through its own debug methods.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/boons/review.md`.

## 2026-10-04 — w1 critique: boss

- The critic found that at play zoom the Warden reads as a grey stack of boxes, not a jailer-knight, and its full-white hit flash turns the whole model into a white blob on every hit (about a third of all frames in phase 3). It asks for a flash on the outline only plus a brief lighten for 2 frames, and a silhouette rebuilt for the top-down camera: a horned or crested helmet with a lit visor, a ring of keys in the ember accent, a visible chain and weight that drives the sweep, and an upright pose in the air. Must-haves: intro is a partial pass (muddy close-up, opening shot cuts off boss and hero); every attack dodgeable on reaction fails (the opening lash telegraphs under the name card, an idle hero is hit by tick 668, and the small dark hero gets lost inside the boss body and behind braziers); phase transitions are a partial pass (phase 1 to 2 barely changes the boss, the phase card covers the play area); death passes on the burst but fails on the aftermath (the cage stays up, the empty boss bar remains, no victory card). Also: the leap's red hit frame hides the hearts, and the sweep is a flat cyan crescent, not a chain. No console errors. 5 pairs: intro still, intro strip, phase-1 attack strip, later-phase attack strip, late-phase still; the last reference image is the itch page's screenshot because the bot did not survive past stage 2.
- Pinned reference: https://aylanonsense.itch.io/just-one-boss (4.7 stars, 557 ratings), a grid game rather than three-quarter view, played live with a pixel-reading bot on a paused fake clock.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/boss/review.md`; cited screenshots in `critic/boss/evidence/`.

## 2026-10-04 — w1 critique: hud

- The critic found health and hurt can't be read at a glance: the hearts are about 14 px wide and the only hurt signal is a thin red border for 4 frames. It asks for hearts at 2x art size (about 28 px at 1280x720) in a tighter panel, a full-screen dithered red wash on every hit fading over about 300 ms with a 2 px panel shake, and at one heart or less a red pulsing panel frame, the last heart beating at 1.3x and an edge vignette about 3x deeper. Must-haves: pixel-perfect passes (exactly 2x at three resolutions, every HUD pixel a palette colour, crisp bitmap font); animated changes pass (the room track is weak); never covering the action fails; low health felt fails (heartbeat and vignette too faint). Other problems: colliding damage numbers (24 and 23 render as "223") and a crit box over the hero, a boon tooltip that auto-opens over the play field for about 4 s, an unlabelled room track, the boss phase tag reading as words, unexplained marks, the ARENA CLEARED banner across the floor, and dash shown as one bar rather than pips. No console errors. 4 pairs from the run on seed 3: a low-health fight still, a room-clear still, a 12-frame damage strip at 100 ms, and a full-health fight still at the GIF's 400x225 size.
- Pinned reference: https://ember-paw-games.itch.io/gaunt-valkyr (4.9 stars (94 ratings)), already pinned for look and vfx. The HTML5 options it checked first (Furcifer's Fungeon, Bright Lancer) have minimal HUDs and would have been easy wins. Gaunt Valkyr isn't HTML5, so its side comes from page screenshots and gameplay GIF frames; our frames were scaled to the same 400x225 before enlarging.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/hud/review.md`.

## 2026-10-04 — w1 critique: budget stop

- The budget guard tripped after hud: the session window was at 57%, over the 50% limit. Weekly was at 49%. The next run resumes the critique queue at `audio` (then title, run-flow). Critic prompts are generated from `prompts/critic.md` into the gitignored `shots/critic/`; reusable critic scripts from this run (fake-clock driver, caching itch proxy, crop tool, reference bot) lived in the gitignored `shots/critic/<piece>/` and do not survive a fresh clone.

## 2026-10-05 — w1 critique: audio

- The critic found that our music has no tune in a normal arena fight. Intensity stays at 0.41 to 0.56, so only the bed, drums and bass play, and the lead came in only after 4 extra enemies were spawned. It asks for a melody stem that plays from intensity 0, a loop of 16 bars or more with A and B sections, and recent hits and kills pushing intensity to 0.6 to 0.75 or more in an ordinary wave. Must-haves: no identical repeats passes (all 65 bank sounds varied over 3 plays); music reacting to game state is a weak pass (idle and fighting sound nearly the same); mix balance fails (enemy wind-up tells peak at -19.7 dBFS, at or below the music's peaks of -16.7, and the music never ducks for them); clean start passes but no clicks fails (the arp stem has a hard step at every note onset). Other problems: the music scheduler drops events when the page stalls (about 4 s of gap at the boss entry), a static title arpeggio (0.3 LU loudness range), a constant wall of sound in the chase mix, and game-over music that is nearly silent. The critic judged our SFX cleaner and punchier than the reference's (hits 14 to 16 dB over the music). No console errors. 4 pairs, each a spectrogram, a 1 s ruler and a waveform, loudness matched within 2.1 LU: the first 10 s after opening, 10 s standing still in a fight room, 10 s of active combat, and a 3 s combat close-up.
- Pinned reference: https://playwithfurcifer.itch.io/furcifers-fungeon (4.7 stars (126 ratings)), already pinned for enemies and arenas. Both sides were recorded losslessly through the same injected tap.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/audio/review.md`.

## 2026-10-05 — w1 critique: title

- The critic found the first frame murky, low-contrast and cluttered, with no single bold image. It asks for the title scene to be re-staged around one bright focal point: zoom the title camera in so the gate fills the centre third and the runner stands about 150 px tall (about 70 px now), silhouetted against a gate mouth that glows ember-orange and descends into the crypt, with the noisy side thirds crushed to near-black by a vignette so the logo and menu sit on clean darkness. Must-haves: the first frame fails (no unstyled HTML, but about 400 ms of a blank screen with a small LOADING, then a hard cut to a muddy frame); the designed logo passes (no dark outline); menu sound, motion and focus is a weak pass (keyboard, mouse and a stubbed gamepad all work with a tick per step, but the motion is small and the selected label's red shadow looks doubled); settings persist and apply live passes. Other problems: an unreadable gate interior, menu labels over a bone pile with no backing, a bug where the logo's black backing plate shows above the Settings, Controls and Credits panels, panels with no animate-in, embers drawn over the footer hint, and no preview for the shake and flash settings. The critic judged ours clearly better on menu navigation and settings. No console errors. 6 pairs on a paused clock at 1152x720, 3 of them strips: first frame, title idle strip, main menu, menu-navigation strip, opening-settings strip, settings screen.
- Pinned reference: https://poncle.itch.io/vampire-survivors (4.8 stars (1,656 ratings)), already pinned for boons, played live from its HTML5 build.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/title/review.md`.

## 2026-10-05 — w1 critique: run-flow

- The critic found that in both endings the camera stays on the wide room shot and never frames the hero, who is a 6–10 px smudge (on death he can sit half under the letterbox bar), and the summary portrait is unreadable. It asks for a 2x zoom centred on the hero over about 0.35 s on the hero's death and on the Warden's death, a readable fall pose before the cracks, a held dawn exit shot of about 1.5 s with the hero large before the panel, and the summary portrait rendered from that framed shot. Must-haves: death to control under 3 s passes (1.2 s headless); styled transitions pass with reservations (a stone wall and carved card on every segment change, but no camera move, and the restart is close to a cut); the summary worth screenshotting is a partial (strong layout, noisy portrait, and the victory panel covers about 75% of the dawn vista within 0.1 s); a full run completable with the seed shown passes. Other problems: the run timer keeps counting through the death sequence (died at 00:16.80, summary said 00:19.95), the intro drop-in barely exists, the seed is missing from the pause screen, a short-run summary is all zeros, "hearts lost" read 4 on a god-moded run at full HP, and the showcase label still shows with `&hud=0`. The critic judged ours better than the reference, not blind. No console errors. 5 pairs: a death strip (12 frames at 300 ms), the summary after a short death, the victory banner, the summary after a won run, and a restart strip (12 frames at 250 ms). The reference's victory banner and long-run Results come from the itch page's screenshots.
- Pinned reference: https://poncle.itch.io/vampire-survivors (4.8 stars (1,656 ratings)), played live from its HTML5 build.
- Packet, key and `criteria.md` are on disk. Review: `waves/w1/critic/run-flow/review.md`.
- Wave 1 critique is complete: all 14 judged pieces have packets. The next phase is judge.

## 2026-10-05 — w1 judge: look, hero, movement, combat

- Four blind judges, one per packet, run in parallel. Each one saw only its packet path and the piece's `judge_focus`. Their verdicts are in `waves/w1/verdicts/`; the clerk opens the keys at resolve.

## 2026-10-05 — w1 judge: vfx, enemies, arenas, gauntlet

- Four more blind judges, run in parallel the same way. Their verdicts are in `waves/w1/verdicts/`.

## 2026-10-05 — w1 judge: budget stop

- The budget guard tripped after the second judge batch: the session window was at 50%, at the 50% limit. Weekly was at 56%. 8 of the 14 verdicts are on disk. The next run judges boons, boss, hud, audio, title and run-flow, then resolves wave 1.

## 2026-10-05 — w1 judge: boons, boss, hud, audio

- Four blind judges, run in parallel the same way. Each one saw only its packet path and the piece's `judge_focus`. Their verdicts are in `waves/w1/verdicts/`.
