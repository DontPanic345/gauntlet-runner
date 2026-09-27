# Wave 1 — Integration report

## Played

- Read `GAME.md`, `PROTOCOL.md`, `pieces.json`, and all 15 files in `hurdles/waves/w1/build/`
  before touching anything, to know what each piece claims to own and its known gaps.
- Title screen (`/`): closed "PRESS START" vignette (blink timing verified), main menu
  navigation, Start.
- A full arena (`?scene=run&seed=7`, The Vestibule): entry, door seal, both waves fought and
  cleared (deterministic combo capture on a husk: windup → active → hit → flash → damage
  number → hp bar), room-clear ceremony, exit door, boon shrine (card flip-in, pick, take
  animation).
- The first corridor (gauntlet, index 0): entry "RUN!" beat, traps, the collapse catching the
  hero on purpose (to exercise `gauntlet:catch` → death), release beat on a second pass.
- The death sequence end to end: slow-mo, red vignette, four-sided iris wipe, cause-of-death
  text, hand-off to the game-over summary screen (verified it reads as "worth screenshotting").
- Instant restart from the summary screen (new seed) and confirmed a fresh run starts clean.
- A second arena (The Ossuary, via `debug.run('goto', 2)`) and a second corridor pass, to check
  the camera fix and general look generalise past the first room.
- The boss, via `?showcase=boss`: dark intro, phase 1 (sweep, the red telegraph disc), phase 3
  (cage bars up, a husk summoned, a 25-damage crit), and the full victory path via
  `?showcase=run-flow&at=victory` through to `?showcase=run-flow&at=summary&result=win`.
- Foundation's `must_have` list, checked directly (see below): the showcase router's error
  screen, pause/timeScale, and two separate 60-second idle captures (title and in-run) for
  console errors.
- Spot checks: `?showcase=arenas` fly-through (room variety), `?showcase=audio` (no errors,
  context running), `?showcase=hud` (boon tooltip positioning, isolated from the death-sequence
  bug below), a busy-fight capture with 7 enemies on screen at once for the draw-call/fps read.
- Final smoke pass after both fixes: title, `?scene=run`, and four showcases (movement, boss,
  arenas, gauntlet) — all still 0 console errors.

## Fixed

- **`src/render/camera.js` — `CameraRig._clamp()`**: the room-bounds clamp kept the camera's
  *centre* inside the room's raw `{minX,maxX,minZ,maxZ}`, which does nothing to stop the far
  half of the screen from showing empty void past a wall whenever the hero (and so the camera)
  is near a room edge — which is always, immediately after entering, since every arena's entry
  door sits on the perimeter. In practice this put a solid black band over roughly a quarter to
  a third of the screen at the start of every arena (confirmed with `?scene=run&seed=7`: the
  entry point at `x=4.7` against a room that only extends to about `x=6.5` left a `6.5` to
  `13.1` void visible). Fixed by insetting the clamp by half the visible viewport (computed from
  `display.width/height`, `PPU`, `display.zoom`, and the camera pitch for the z axis), collapsing
  to the room's centre on an axis where the room is narrower than the viewport (corridors, the
  boss's tight cinematic bounds) instead of producing an inverted range. Verified fixed in two
  arena templates (Vestibule, Ossuary) and confirmed the boss's already-tiny bounds and the
  corridor's narrow z-bounds are unaffected (they now just collapse to the same fixed centre they
  were already effectively at).
- **`src/boss/fight.js` — `BossFight.ui()`**: the boss's own "THE WARDEN FALLS / THE WAY DOWN IS
  OPEN" banner has a 999-tick lifetime (~16.6 s) and kept drawing after the player took the key,
  right on top of run-flow's own victory banner ("THE GAUNTLET IS BROKEN / ZONE I CLEARED"),
  which starts at the same moment (`boss:cleared`) in the same screen region. The two banners
  overlapped into an illegible mess of stacked text for the first few seconds of every victory.
  Fixed by gating the boss's own victory banner off once `this.cleared` is true (set at the exact
  tick `boss:cleared` fires), so run-flow's banner has the screen to itself. Verified with
  `?showcase=run-flow&at=victory`: the banner is now clean the whole way through.

## Foundation checklist

All five `must_have` items pass.

| must_have | result |
|---|---|
| `window.__GR` contract exactly as specified | **pass** — `ready`, `frame`, `scene`, `seed`, `state()`, and every `debug.*` hook (`timeScale`, `god`, `spawn`, `goto`, `give`, `hurt`, `kill`, plus every piece's additions) worked across dozens of captures. |
| `?showcase=<piece-id>` unknown ids show a readable error, not a blank canvas | **pass** — `?showcase=nonexistent-piece-xyz` renders a "NO SUCH SHOWCASE" panel listing all 15 registered showcases, each marked READY. |
| voxel models meshed once and cached; one draw call per model | **pass** by inspection and build notes (`render/voxel/` caches per model, merges AO-matched quads). Could not independently confirm the exact draw-call count live: the debug overlay's `DRAWS`/`TRIS` readout only reflects the *last* of `look`'s several render passes, because three.js's `renderer.info` auto-resets on every `renderer.render()` call and the post chain calls it more than once per frame (see Seams left). No visual evidence of broken instancing (no z-fighting, no duplicated geometry) in any capture. |
| pause freezes the sim completely; time-scale hook for slow-motion captures | **pass** — isolated test: `debug.pause(true)` then `__GR.frame` held byte-for-byte flat across a clean 2 s wait; `debug.timeScale(0.25)` accepted live. (An earlier sloppier test that checked `frame` immediately around the `pause()` call, not after it had taken effect, looked like a leak — it wasn't; ticks were just accruing from eval-call overhead *before* pause engaged.) |
| zero console errors on load and during 60 s of idle | **pass** — two independent 60-second idle captures, one on the title screen and one sitting in a freshly-entered arena, both report 0 console lines / 0 errors. |

## Seams left

- **Two parallel particle/effect systems** (owner: `combat`, cross-referenced by `vfx`).
  `src/combat/fx.js` still runs its own sparks, debris, 2D impact marks, stand-in damage numbers
  and the hurt vignette, entirely separate from the shared pooled system in `src/vfx/`. Every
  other piece that spawns effects (enemies, boons, arenas, gauntlet, boss) already calls into
  `vfx`; combat is the holdout. The `vfx` piece's own build notes flag this explicitly as
  unfinished follow-up work it deliberately left for `combat`/`hero`/`enemies` to do. Visually the
  two systems don't clash badly (same palette, same pixel-snap rules), so I left it rather than
  rewire `combat/fx.js` myself — that's a redesign of a judged piece's owned files, not a seam
  fix, and the critics are better placed to weigh whether it's worth the piece's next wave.
- **Boon tooltip clipped by the death-sequence iris** (owners: `hud` / `run-flow`). If the player
  dies within about 3 seconds of picking up a boon (easy to hit: pick a boon, then get caught by
  the very next corridor's collapse), the HUD's "just acquired" tooltip is still auto-showing
  when `death.ui()`'s four-sided ink iris closes over the screen. The iris draws after the HUD
  by design and happens to cover the tooltip's left portion, clipping the boon name and
  description mid-word for a moment. Rare timing window, purely cosmetic, but a clean fix needs
  the HUD to expose a way to suppress transient popups once the death sequence begins, which
  isn't in its current API — flagging rather than improvising one.
- **Arenas' own fly-through showcase camera shows void** (owner: `arenas`). `?showcase=arenas`'s
  fly-through mode calls `display.setCameraTarget` directly instead of going through
  `CameraRig`, so it never picks up the bounds fix above. At least "The Pillared Hall" (room 3)
  shows real background void past its walls partway through its dwell pan. Doesn't affect normal
  play (which now goes through the fixed `CameraRig`), but a critic using the showcase's default
  fly-through — the way `judge_focus` says stills should be taken — could catch it. Left for
  `arenas` since the room may also just be narrower than the other four and worth a look either
  way.
- **Headless performance numbers aren't representative of anything real**. In this sandboxed
  headless Chromium (software GL), `__GR.frame` advanced at roughly 14–47 ticks/second depending
  on scene complexity, well under the 60 Hz target, and a 7-enemy fight showed "14 FPS" in the
  debug overlay. Every single piece's build notes already disclaim real-GPU testing for this
  exact reason, and I have no access to real hardware here either. Not treating this as a bug to
  fix; flagging it so whoever next has a real GPU knows to actually check frame pacing once.
