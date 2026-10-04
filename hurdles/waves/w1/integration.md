# Wave 1 integration report

Screenshots are in `shots/integration/` (numbered by step, with a `sheet.png` per step) and the
smoke frames are in `shots/smoke/<id>/frame.png` (`root` = `/`, `run` = `/?scene=run&seed=1`).

## Played

All play was headless Chromium (software GL, about 9 fps in arenas). Input came from scripted
keys and an in-page autopilot that only injects bound actions through `debug.input` /
`debug.tap` (8-way moves, J, K, E), the same path a keyboard takes.

1. **Title** (`/`): logo, arch, braziers and the idle runner. Enter on START RUN gives the send-off,
   then the iris closes and the arena drop-in plays (`01-title`).
2. **Arena 1, The Antechamber** (seed 1), played with no god mode (`02-arena1`) and again with god mode (`04-run`, `14-regression`).
   The hero walks in, the gate seals, wave 1 (husks) and wave 2 (husk plus mite swarm) come. Clear moment,
   shards vacuum, the shrine rises, E OFFER, **boon choice** (took Echo Blade), then the exit.
3. **Corridor 1** through the run-flow stone wall and card. Traps, the chase, the gate slam, SAFE,
   then the stair exit. HP 5 to 2 from traps in the no-god run.
4. **Arena 2, The Drowned Shrine**: two waves (wisp, husks, mites), clear, a second boon choice (Reaper).
   The autopilot then snagged on the statue on the way out. That is a bot pathing limit, not a game fault.
5. **Pause** over the run (Esc): panel, resume. **HP carry**: hurt to 3, `debug.run('next')` to
   the corridor (3/5), then to arena 2 (3/5) (`06-death/d0*`).
6. **Death** in arena 1 at 1 hp to two husks: slow-mo drain, letterbox, crack, YOU FELL, summary
   ("CUT DOWN BY A HUSK", lore line). Then **R restart**: a new seed, RUN 2 card, drop-in (`06-death/e0*`).
7. **Corridor death** (`debug.corridor('go', 0)`, standing still): "BURIED BY THE COLLAPSE" summary.
   **Esc** goes to the title through the iris (`12-corridor-death`).
8. **Boss in normal play**, routed from a run (`debug.scene('boss')`): the wall card "THE WARDEN'S
   PIT", intro (walk-in, braziers, close-up, roar), skipped with J, then the fight with the autopilot. Then
   `debug.boss('phase')` twice (II THE QUAKE, III THE CAGE with the ring and bars), then `debug.boss('kill')` for the
   death beams and burst, THE WARDEN FALLS, and the **victory** dawn and summary (`05-boss`).
9. **Boss showcase** `?showcase=boss&phase=2` and `&intro=1` after the HUD rewire (`11-boss-showcase`).
10. Combat showcase hit strip (freeze and step through the first demo combo, `07-combat-hit`), the boons
    showcase dummy room and choice (`08-boons`), and the unknown showcase id (`10-foundation/unknown`).
11. **Performance**: tick and frame rate over 5 s idle and in a 6-enemy fight (brute, 2 husks, mite swarm,
    wisp); a CDP CPU profile of corridor 4; and 63 s of idle with scene, geometry and heap counts.

## Fixed

- **Duplicated particle systems.** Normal play used `combat/fx.js`'s private InstancedMesh sparks,
  debris and slam ring, and `vfx`'s combat channel was never bound.
  - `src/combat/fx.js`: `createCombatFx` takes `particles` (default **false**). When false it
    binds `vfx.bind(['combat'])` itself, rebinds after a `vfx:clear`, and unbinds on dispose.
    The 2D cut and star marks and the hurt vignette stay.
  - `numbers: true` now draws the **hud piece's real damage numbers** (`createDamageNumbers`) instead of
    the stand-ins. Every scene and showcase (run, gauntlet, boss, combat, enemies, arenas, boons, hud)
    therefore shows the same hit sparks and the same numbers.
  - `src/run/arena-scene.js`, `src/world/corridor.js`, `src/boss/fight.js`: rely on that binding.
    The boss fight now also binds vfx `kill`, so the hero's death burst matches the run.
  - `src/combat/showcase.js`: the dummy-landing dust ring moved to `vfx.land` (combat's own particles are off).
- **Showcases showing stand-in HUDs while normal play uses the hud piece.**
  - `src/boss/showcase.js`: it now uses `createHud` with `wardenSource` for the hearts, dash pip, boss bar
    and damage numbers, with `externalHud` set, exactly as `?scene=boss` does. Its labels moved
    below the hearts panel.
  - `src/ui/widgets/bossbar.js`: an optional `lift` on the boss source, so the showcase help line does not cover the bar.
  - `src/progression/showcase.js`: `createProgression(..., hud: false)` plus the real `createHud`
    (track off). Its labels and the held-boon panels moved below the hearts, and the key line is
    right-aligned, clear of the boon row.
- **HUD over cinematics and the choice screen.**
  - `src/ui/hud.js`: un-hiding the HUD restarts its slide-in.
  - `src/boss/scene.js` and `src/boss/showcase.js`: the HUD is hidden during the Warden intro and slides in when the fight starts.
  - `src/run/arena-scene.js`: the HUD is hidden while the boon choice is open, because the dash pip
    poked out under the letterbox. The run card is no longer drawn under the pause panel, where it overlapped "PAUSED".
- **Transition wall versus scene clocks.** The arena's drop-in waited for `flow.covered`, but the
  corridor's 75-tick intro and the boss intro ran behind run-flow's stone wall. A routed corridor
  therefore gave the player well under a second on screen before the collapse started.
  `src/world/corridor.js` (gauntlet scene) and `src/boss/scene.js` now hold their tick while
  `flow.covered`. Measured after the fix: the wall uncovers at tick 82 and `gauntlet:start` comes at 157, so all
  75 ticks are on screen. The boss gate seal comes 66 ticks after uncovering, as scripted.
- **Shake in 2D-only scenes did nothing.** `feedback.shake` only moved the 3D camera, so run-flow's
  gameover crumble (`shake(5, 600)`) and slab thud were invisible.
  - `src/core/feedback.js`: adds `feedback.lastOffset`.
  - `src/core/scenes.js`: a scene can set `shakeUi: true` to have its `ui()` drawn with the same
    settings-scaled offset.
  - `src/run/endings.js`: `gameover` and `victory` set it.
- **Input buffering mismatch.** Attack presses queued for 12 ticks (200 ms) while dash presses
  wait 8 (133 ms) and the core buffer is 7. `src/combat/combat.js`: `RULES.queueTicks` is now 8,
  matching `MOVE.dashBuffer`, which is close to GAME.md's ~120 ms. A press during the 8-tick hurt stun
  still lands, and the dash case still adds the dash length.

Checked and left alone because they are already single systems: screen shake, flashes and hitstop
all go through `core/feedback` / `loop.hitstop` (no other camera shake, no other full-screen flash). There is
one input layer (title, HUD Tab and the settings rebind capture read keys only for UI). There is one AudioContext
(the stand-in voices are routed through `audio/engine`). Colours come only from the palette (the white literals are
tint masks and instance base colours). Hitstop is consistent for player hits (55-110 ms), hero hurts and traps (80 ms)
and props (small); boon procs skip it by design.

## Foundation checklist

- **PASS** `window.__GR` contract as in PROTOCOL.md: `ready`, `frame`, `scene`, `seed` (updated
  on each fresh run), `state()` with `{scene, hero{x,z,hp,maxHp}, room, enemies[], boons[]}`, and
  `debug.timeScale/god/spawn/goto/give/hurt/kill`. They were all called on `/` (with no handler they return `{ok:false, error}`
  and throw nothing) and on `?scene=run` (all `ok`).
- **PASS** `?showcase=<id>` router: `?showcase=nope` shows a readable NO SUCH SHOWCASE panel
  listing all 15 showcases as READY.
- **PASS** voxel models as text or arrays in `src/`, meshed once and cached: `debug.models()` lists each
  model once by name (for example `arena.floor.1.0.antechamber`, `hero.*`). Instances share the cached geometry
  with one mesh, so one draw, per model instance. Collapse rocks are instanced.
- **PASS** pause freezes the sim: 0 ticks over 1.5 s paused in `run`, and 0 ticks over 1 s with
  `debug.freeze`. Time scale 0.25 gave 13.7 ticks/s against 52.3 at 1. Title is not pausable by design, and
  `debug.pause` there is a no-op.
- **PASS** zero console errors on load and over 62 s idle on `/` and on `?scene=run&seed=1`.
  Over 63 s idle the frame rate held at about 9 fps with flat object, geometry, texture and heap counts, so there is no leak.

Smoke test after the fixes: `node tools/capture.cjs --url "/?showcase=<id>" --out shots/smoke/<id>
--wait-ready` for all 15 showcase ids, plus `/` (`shots/smoke/root`) and `/?scene=run&seed=1`
(`shots/smoke/run`). All exit 0 with 0 console lines, and every frame is non-blank.

## Seams left

- **Performance is unmeasured on a real GPU** (all pieces). Headless runs at about 9 fps in arenas, 7-8 fps in a 6-enemy
  fight (sim 35 ticks/s with hitstop), and 4-5 fps in corridors (`gauntlet`: about 1000 rock instances
  plus shadows). JS cost is small: under 5 ms a frame in a fight, about 10 ms of tick work a frame in a
  corridor at 6 ticks a frame. The CPU profile shows almost all time in software GL, so no JS fix was needed.
- **Two impact stars per hit** (`combat`/`vfx`): combat's 2D cut-and-star mark and vfx's ink-outlined
  `hitSpark` star land on the same point. Together they read as one impact, but they are two star styles.
  Whether to keep the 2D mark is a combat or vfx call.
- **The collapse kills on one touch, right after RUN!** (`gauntlet`): a hero who has not moved when the ceiling
  gives way is buried at once (a full-hp hurt). With the wall fix the 75-tick warning is now all on screen, but
  there is no grace hit. This is a design question for the gauntlet critic.
- **No drop-in for corridors and the boss** (`run-flow`): they keep their own entries. The flow is consistent, but
  the arena's landing beat is not repeated.
- **Shards have no use** (`boons` / `run-flow`), and **the title shows no best time or lore** (`title`). Both are known gaps,
  and both are features rather than seams.
- **Dead placeholder scenes** (`foundation`): `src/core/placeholders.js` still defines the
  run/boss/gameover/victory stand-ins, which later imports override. They are harmless, but dead code.
- **Lighting is dark between pools** (`look` / `arenas`): the 8-light pool still leaves arena floors and
  the boss back wall murky. That needs a design change in `look`, not a seam fix.
- **Gamepad is untested everywhere** (headless has no pad).
- **Audio is unheard** (all pieces with sound). No errors were logged, and nothing was listened to.
