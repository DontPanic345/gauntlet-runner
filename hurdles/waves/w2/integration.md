# Wave 2 integration report

Screenshots are in `shots/int2/` (one folder per step) and the smoke frames are in
`shots/smoke/<id>/frame.png` (`root` = `/`, `run` = `/?scene=run&seed=1`). All play ran in headless
Chromium with software GL (4-6 fps in arenas on this machine). Input came from scripted keys and an
in-page autopilot that only injects bound actions through `debug.input` / `debug.tap`.

## Played

1. **Title** (`/`): the arch, braziers, logo and idle runner. Enter on START RUN, the iris, then the
   arena drop-in with the RUN 1 / THE GAUNTLET / SEED card (`01-title`, `04-full`).
2. **Arena 1, The Antechamber** (seed 1, god mode): walked in, the gate sealed, and all three waves
   were fought to the clear with no debug skip (husks, husk plus mite swarm, three husks;
   `02-run`). On a second run, wave 1 was fought and then `debug.arena('clear')` was used.
3. **Boon choice**: the shrine rose, E OFFER, CHOOSE A BOON, took Echo Blade with J. Its icon shows
   in the HUD boon row (`02-run/a1-chosen`, `04-full/a1-chosen`).
4. **Exit to corridor 1**: walked into the exit arch, then the stone-block wall and the CORRIDOR 1 card
   came up (`04-full/a1-wall`).
5. **Corridor 1** (spike wave, blades, jet ripple): held right and dashed through the traps. The
   collapse caught the god-moded hero twice. Then SAFE ("THE GAUNTLET HOLDS"), and the walk into
   the stair (`04-full/c1-*`).
6. **Arena 2, The Drowned Shrine** (19x12): the drop-in, the seal, two waves (wisp, husk, mite
   swarm). I ran wall to wall six times to check the camera's edge padding (`04-full/a2-*`). I also
   ran the narrowest room, the Hall of Wardens (15x15), wall to wall (`10-hall`).
7. **Death**: god off, then `debug.kill()`. Slow-mo, drain, crack, YOU FELL, then the summary (cause,
   lore, boons, depth track). **R** restarts: RUN 2, a new seed, the drop-in (`04-full/death-*`,
   `summary`, `restart-*`).
8. **Boss in normal play** (`?scene=run&seed=2` then `debug.scene('boss')`): the wall card, the intro
   and THE WARDEN banner, the fight with the autopilot, `debug.boss('phase')` twice (II, III THE
   CAGE), then `debug.boss('kill')`: death beams, THE WARDEN FALLS, then the **victory** dawn and
   summary (`06-boss`). Also `?showcase=boss&death=1` (`11-bossdeath`) and
   `?showcase=run-flow&at=victory` (`12-victory`).
9. **Kill frame**: in the `?showcase=vfx&fx=death` husk kill, the sim was frozen and stepped with
   `performance.now` pinned, so look's real-time 75 ms kill frame could be shot before and after the
   fix (`05-kill-before`, `05-kill-after`).
10. **Brute against the hero**: `?showcase=enemies&fight=brute` (`07-brute`).
11. **Performance**: frame and tick rate over 5 s in a 6-enemy fight (brute, 2 husks, mite swarm,
    wisp, plus wave spawns), a CDP CPU profile of the same fight, frame gaps through two room
    transitions, and the boss fight's rate (`03-perf`, `08-hitch`).

## Fixed

- **The hero read darker than the enemies** (hero / enemies / foundation).
  - `src/render/voxel/material.js`: the enemies' self-light floor shader patch moved here as
    `makeSelfLitMaterial(selfLitUniform)`, exported from `src/render/voxel/index.js`.
  - `src/enemies/material.js`: `makeEnemyMaterial()` now calls it. `enemyLook` and
    `debug.enemies('lit', v)` are unchanged.
  - `src/hero/model.js`: the rig uses `makeSelfLitMaterial(heroLook.selfLit)` (0.9, the same as
    enemies). `heroLook` is exported.
  - Away from torches, the rose hood now stays rose instead of sinking to plum. The flash API is
    unchanged.
- **The first kill frame was one white blob** (look / vfx). `src/render/look.js`: the kill frame's
  luma thresholds went from 0.22 / 0.40 to 0.72 / 0.60. At 0.22, any torch-lit floor inside the
  38 px disc also went white. Now only white-hot pixels (combat's body flash and the hero's smear)
  stay white and the rest of the disc goes ink. The first frame reads as a white body on an ink disc
  with a white rim. vfx's ink silhouette and burst follow after the hitstop, so the white/ink
  alternation is intact (`05-kill-after`).
- **The Warden got vfx's generic size-3 kill burst on top of its own staged death** (boss / vfx).
  The starburst, ring and scorch covered the whole pit, hero included, before the boss's beams.
  `src/boss/warden.js` now sets `noKillBurst = true`, which is vfx's documented opt-out. The Warden
  keeps the wave 1 `vfx.death` crumble plus its own beams and collapse (`11-bossdeath`).
- **Stale wave 1 hero colours in other pieces** (hero palette change).
  - `src/vfx/vfx.js`: the hero death crumble (`combat:heroDeath`) threw navy/blue/bone chunks. It
    now throws rose/red/cyan.
  - `src/run/endings.js`: the victory dawn's tiny runner was a navy-hooded figure with a red scarf.
    It is now a rose/plum hood, a red cape and a cyan scarf (`12-victory/d`).
- **The enemies fight showcase showed no kill burst while play does** (enemies / vfx).
  `src/enemies/showcase.js`: the fight binds `vfx.bind(['move', 'kill'])` (was `['move']`), so a
  critic sees the same deaths as in arenas.

Checked and left alone:
- **The camera void strip** in narrow rooms is gone. The arenas rebuild fills 3 tiles of rock past
  each side wall and eases the bottom edge to the parapet. Running wall to wall in the Shrine (19
  wide) and the Hall (15 wide) shows rock, never void.
- **Move dust**: the controller's `MOVE_FX` dust and vfx's `move` binding do not overlap (vfx binds
  only `move:dash` and `move:bonk`).
- **Room build hitch**: the longest stall, 2.6 s headless, comes when the corridor builds. It
  happens inside the transition wall's `onCovered`, so the frozen frame is the fully closed wall
  with its card. Arena builds hide the same way. No fix needed.
- **Frame rate**: 4.4 fps and 21.8 ticks/s in the 6-enemy fight, 5.2 fps idle in a room, 2.8 fps in
  the boss fight. The CPU profile shows the main thread 89% idle: the cost is software GL, not
  JS. This machine is slower than wave 1's, so the numbers do not compare with wave 1's 7-9 fps.

## Foundation checklist

- **PASS** `window.__GR` contract: `ready`, `frame`, `scene`, `seed` and `state()`, with
  `{scene, hero{x,z,hp,maxHp}, room, enemies[], boons[]}`, are all present. On `/` every contract
  hook returns `{ok:false, error}` or a value without throwing, and on `?scene=run` every hook
  returns `ok`.
- **PASS** `?showcase=` router: `?showcase=nope` shows the NO SUCH SHOWCASE panel listing all 15
  showcases as READY.
- **PASS** models meshed once and cached: `debug.models()` lists 46 models in a run and 46 unique
  names. Meshes share cached geometry: one mesh, so one draw, per instance.
- **PASS** pause and time scale: 0 ticks over 1.5 s paused in `run`. Time scale 0.25 gives 4.9
  ticks/s against 20.1 at 1 (headless rate). The title is not pausable by design.
- **PASS** zero console errors: over 60 s idle on `/` and on `?scene=run&seed=1`, with the JS heap
  flat. There were also 0 console lines in every play session and smoke test above.

Smoke test after the fixes (`--wait-ready`): `foundation`, `look`, `hero`, `movement`, `vfx`,
`enemies`, `arenas`, `boss`, `run-flow`, `combat`, `title`, plus `/` and `/?scene=run&seed=1`. Every
one exits 0 with 0 console lines, and every frame is non-blank (`shots/int2/smoke-sheet.png`).

## Seams left

- **The brute and the hero share rose** (`enemies` / `hero`). The brute's top faces, face and
  shoulders are `rose`, which is the hero's hood. With both now self-lit, they are the same pink in
  a crowd (`07-brute/b`). The palette has no other light purple step: `mist` would sink into the
  slate floor. Picking the brute's new accent is a design call for the enemies builder (or the
  hero's), so I did not change it.
- **Rooms are dark between lights** (`look` / `arenas`). The front third of most rooms, and every
  room before the seal lights its braziers, sits in cool shadow. That needs a lighting design
  change, not a seam fix.
- **Green rings round the boss braziers on big flares** (`look` / `boss`). The boss's death and
  phase flares (`pit.flare('gold', 2.5)`, light up to about 5.6x) run through look's raised
  `LIGHT_GAIN` (3.2 to 4.6). The bright gold over the violet floor quantises to `moss`/`leaf`
  rings round each pool (`06-boss/death-0`). This is look's warm-grey ramp gap, which look already
  noted. Either look caps light energy before quantise or boss scales its flares.
- **A stale title label** (`title`): the corner still reads "V0.1 WAVE 1 BUILD". It is cosmetic. I
  left it so the won title piece is not re-opened for one string.
- **Dash buffer versus attack buffer** (`movement` / `combat`). A dash press is now held up to 30
  ticks (500 ms) until the dash can fire. An attack press queues for 8 ticks (plus the remaining
  dash). Both are deliberate "never drop a press" rules, but they differ from GAME.md's ~120 ms.
- **Wave 1 seams still open**: two hit-star styles per hit (combat's 2D mark plus vfx's burst), no
  drop-in for corridors and the boss, unused shards, dead placeholder scenes in
  `src/core/placeholders.js`, gamepad untested, audio unheard, and no real-GPU performance figures.
- **Re-critique triggers**: this pass edited files owned by `boss` (`src/boss/warden.js`, one line)
  and `run-flow` (`src/run/endings.js`, two colour lines). Both pieces won in wave 1, so the clerk's
  critique queue will pick them up again.
