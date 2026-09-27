# run-flow: builder notes (wave 1)

## What exists

- **The sequencer** (`src/run/run.js`, `scenes.define('run', ...)`): replaces the foundation
  placeholder. A run is `PLAN = [arena0, corridor0, arena1, corridor1, arena2, corridor2, arena3,
  corridor3, arena4, boss]` (10 segments: 5 arenas, 4 corridors, the boss). One segment is live at
  a time; the previous one is fully disposed before the next is built (not a continuous world —
  each of `Arena`/`Corridor`/`BossFight` already builds its own room from scratch). The hero rig,
  controller, combat, camera, vfx, combat-fx, HUD and progression (boons/pickups) are created once
  per run and carried across every segment; only `ctl.collision`, the camera bounds and the combat
  target list are swapped per segment.
- **Intro drop-in**: the hero's existing `anim.spawn()` (fall, squash, rebound) plays over arena 0's
  ready state, with a fading "THE GAUNTLET / SEED N" card drawn on top for about 2 s. No input is
  locked out — a player who moves immediately just cuts the card short.
- **Boon shrine beat**: on `arena:exit` (the hero physically walks through the opened exit door),
  `prog.offerShrine(...)` opens right there in the cleared room. Boons and pickups persist across
  the whole run (one `createProgression` instance, never recreated).
- **Segment transitions** (`src/run/transition.js`, `SegmentWipe`): a close → hold → open ink
  curtain with a glowing ember seam and a few drifting embers, timed in real seconds (~0.66 s
  total) so it's unaffected by slow-mo. The old segment is disposed and the new one built at full
  coverage, so nothing pops. Triggered by the shrine closing, by `gauntlet:exit`, and by the debug
  `goto` hook.
- **Death sequence** (`src/run/death.js`): on `combat:heroDeath`, a `vfx.death()` burst plus a big
  shake, then real-time-driven slow-mo (dips to 0.3x, eases back to 1x), the HUD's own red
  vignette pushed further by a closing four-sided iris, and the cause of death fading in, in
  under 1.9 s total. Any of confirm/attack/dash skips straight to the end. Hands off to `gameover`.
- **Victory sequence** (`src/run/victory.js`): on `boss:cleared` (fired by the boss piece once the
  player actually reaches the key — the Warden's own death spectacle is that piece's job), a warm
  gold wash, ember/gold-pickup bursts around the hero, and a "THE GAUNTLET IS BROKEN / ZONE I
  CLEARED" banner over ~3.6 s, skippable. Hands off to `victory`.
- **Run summary** (`src/run/summary.js`, shared by the `gameover` and `victory` scenes): a framed
  panel — heading, cause of death or "ZONE I CONQUERED", time survived, kills, the deepest room
  reached, boons taken (icons via the boons piece's `drawIcon`), the seed in large text with a
  "share this number" hint, best victory time with a "NEW!" ribbon, and any lore line unlocked
  this run. Confirm restarts with a fresh random seed; Interact restarts with the *same* seed
  (replay); Cancel returns to the title.
- **Instant restart**: both restart paths are a single `scenes.go('run', {seed})` — no asset
  loading, so it's a frame or two. A ~0.3 s debounce on the ending screens stops the death
  sequence's own skip-press from bleeding into an accidental restart.
- **Light meta** (`src/run/meta.js`, localStorage `gr.meta.v1`): best victory time, run/victory
  counts, and 6 short lore lines unlocked as the deepest segment reached increases (5 by depth, 1
  only on an actual win). Shown on the summary the run they unlock.
- **Cause-of-death tracking**: `enemy:attack {kind}`, `gauntlet:trapHit {kind}`,
  `gauntlet:catch`, and `boss:heroHit {tag}` are listened to throughout the run and the most
  recent one labels the death ("trampled by a Brute", "The Warden — crushed by a ground slam", …).
  Falls back to "the dark claimed you" if nothing fired (e.g. a debug-forced death).
- **`?showcase=run-flow&at=death|victory|summary`**: redirects into the *real* `run` scene with a
  fast-forward flag (`at=death` forces a real `heroHealth.hurt(99)` a moment in; `at=victory`
  builds the boss segment directly, skips its intro, calls the real `boss.kill()`, and
  teleports the hero onto the rising key so `boss:cleared` fires the same way a real playthrough
  would) or, for `at=summary`, straight into the real `gameover`/`victory` scene with a
  representative stats payload (`&result=win` for the victory flavour). Nothing here is a parallel
  demo; it's the production code path, just nudged.

## APIs other pieces should call

Nobody needs to call into `run-flow` directly — it is the top of the dependency graph. It calls
into `arenas`, `gauntlet`, `boons`, `boss`, `hud` and `title` exactly per their own documented
APIs (`Arena`/`Corridor`/`BossFight`, `createProgression`, `createHud`, `scenes.go('title')`).

```js
import { PLAN } from './run/run.js';   // the 10-segment shape, if another piece ever needs it
```

## Debug hooks and showcase params

- `__GR.debug.run(action, arg)`:
  - no action / `'info'`: `{phase, seg:{type,index}, segIdx, seed, kills, cause, elapsed}`
  - `'skip'`: skip the current death or victory sequence straight to its ending
  - `'die'`: force the hero dead right now (goes through the real death sequence and rules)
  - `'win'`: force `boss:cleared` right now (goes through the real victory sequence)
  - `'goto', n`: wipe-transition straight to `PLAN[n]` (0..9), cancelling any in-flight death/
    victory sequence first so it can't fire a stale `finishRun` after the jump
- `?showcase=run-flow` params: `&at=death|victory|summary` (default `death`), `&result=win|lose`
  (for `at=summary`, default `lose` unless `at=victory`), `&seed=<n>` (for `at=death|victory`,
  default 48213).
- `?scene=run&seed=N` is normal play; `debug.spawn(type, x, z)` delegates to the active segment's
  enemy system (arena/boss) or reports there is nowhere to spawn (corridor).

## Cross-piece edits

- `src/main.js`: one import line, `import './run/run.js';`, next to the other piece-registration
  imports, after `title`'s (so `run`/`gameover`/`victory` are defined once and override
  foundation's placeholders, the documented convention every scene-owning piece already uses).
- `src/core/showcase.js`: set `load` on the `run-flow` row to `() => import('../run/showcase.js')`
  (the documented one-line convention; it was `null` before this piece existed).

No other files were touched. `src/boss/scene.js` (the standalone `?scene=boss` entry point) is
untouched and still works on its own; `run-flow` builds `BossFight` directly for the run's boss
segment rather than going through that scene, so the two don't interact.

## Known gaps

- **Pickup bounds aren't set per room.** `createProgression` is given `bounds: null` once at run
  start (it persists across differently-shaped rooms, so no single static box fits); shards or
  hearts could in principle drift toward a wall before the room's own collision stops them. Not
  observed in testing, but the boons piece's own `pk.bounds` hook exists for a future pass to set
  it per segment.
- **Enemies/objects freeze during the death sequence.** On `combat:heroDeath` the current
  segment's own `tick()` (arena director, corridor traps/collapse, boss AI) stops advancing so the
  vignette closes over a clean, readable freeze-frame; only the hero's own animation, particles and
  the HUD keep ticking. This is deliberate (a freeze-frame reads better and is simpler to reason
  about than winding everything down), but it does mean an enemy mid-lunge just stops in place for
  ~1.9 s rather than completing its motion.
- **One tick of overrun at the death/victory trigger.** `combat:heroDeath`/`boss:cleared` fire
  synchronously from inside the segment's own `tick()` call (itself inside `run.js`'s `tick()`),
  so the rest of that same tick (enemy system, vfx, hud) still runs once more before the `dying`/
  `winning` gate takes effect on the next tick. Cosmetic only.
- **Cause-of-death attribution is a "last relevant event wins" heuristic**, not a hit-to-death
  causal trace: it listens to `enemy:attack`/`gauntlet:trapHit`/`gauntlet:catch`/`boss:heroHit`
  and keeps the most recent label. In the ordinary case (one clean killing blow) this reads right;
  a death from chip damage after several different attackers could in principle mislabel the
  actual finishing blow.
- **The camera doesn't do anything bespoke for the transitions beyond snapping to the new
  segment's entry point** (`cam.reset(...)`) under full wipe cover — the must-have's "camera
  moves" is covered by that snap plus the wipe itself and (for the boss) `BossFight`'s own
  cinematic camera; there's no additional push/zoom authored here on top of it.
- **Only one lore line is shown per run even if a big jump unlocks several** (e.g. a debug
  `goto(9)` on a fresh save unlocks all 5 depth-gated lines plus the win-only one at once, but the
  summary only prints the first). A normal, non-debug-jumping playthrough unlocks at most one or
  two per run, so this wasn't a priority to fix.
- **No credits/lore codex screen.** The unlocked lore only ever appears once, on the summary
  screen for the run that unlocked it; there's nowhere to review it afterward (`getMeta()` in
  `meta.js` does expose everything a future "codex" screen would need).
- **Not tested with a human on a gamepad**, same caveat every other piece has recorded; menu/
  ending navigation goes through `input.ui.pressed()` so it should follow gamepad bindings once
  they're pressed, but this was only exercised via keyboard-shaped scripts.
- **A full 8-12 minute run start-to-finish was not played back to back.** Testing covered every
  segment type, the shrine → transition → corridor chain, the corridor collapse killing the hero,
  the boss → victory → summary chain, instant restart (both seed choices), and a debug `goto`
  mid-death-sequence edge case (fixed: it now cancels the in-flight sequence so it can't fire a
  stale ending after the jump) — all via `?scene=run` and `?showcase=run-flow`, all zero console
  errors. A real continuous playthrough of all 10 segments in one sitting was not additionally
  captured.
