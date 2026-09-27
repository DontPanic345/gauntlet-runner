# title: builder notes (wave 1)

## What exists

- **Title scene** (`src/ui/title.js`, `scenes.define('title', ...)`, also the default `/`): a
  torchlit crypt vignette borrowed from `look`'s stand-in vignette (`look.floor`, `look.wall`
  with its baked barred arch/banners/sconces, two `look.brazier` props, `look.rubble`), the
  `vfx` ambient `crypt` layer (embers, dust), and the real hero rig+animator (`hero`/`movement`'s
  `createHeroRig`/`HeroAnim`) spawning in and idling with its back to the arch. A slow camera
  pan (±1 unit, 26 s) keeps it from ever sitting fully still.
- **Logo lockup**: a framed ink/gold banner with corner gems, two hanging "chain" accents
  bridging the UI into the 3D scene, a pulsing dithered ember glow behind the text, a two-line
  "GAUNTLET / RUNNER" wordmark (outlined, two-tone), a gem-divider rule and a tagline. Drawn in
  `drawLogo()`, not a bare `drawText` call.
- **Screen flow**: closed (the "PRESS START" vignette, the first frame and the default showcase
  view) → main (Start/Settings/Controls/Credits) → Settings / Controls / Credits, each with a
  Back item and Esc-to-go-back-one-level. Start goes to `scenes.go('run')`.
- **Menu toolkit** (`src/ui/menus.js`): `createMenuList` (a focusable vertical list: keyboard
  up/down + confirm/attack, mouse hover + click, gamepad via the same bound actions, a gold
  focus panel with a shine sweep, bouncing chevrons, staggered pop-in), `menuSfx`
  (hover/select/back/denied/open/slider, synthesised through the audio piece's shared mixer,
  pitch/gain varied via `vary()` so repeats don't sound identical), `createTextScreen` (a
  read-only framed panel for Controls/Credits), and small chrome helpers (`drawPanel`,
  `drawFocusChevrons`, `drawGem`).
- **Settings screen** (`src/ui/settings.js`): master/music/sfx volume, screen-shake and flash
  sliders, a Show FPS toggle, Reset to Defaults, and Back. Keyboard (up/down row, left/right
  adjust, Enter toggles a bool), mouse (click-and-drag the slider track, or click a row), all
  live via `core/settings.js` (`settings.set()` — every consumer already reads it live: the
  audio mixer's `sfxVol()`/`musicVol()` per note, `feedback.shake()`/`flash()` per call) and
  persisted to localStorage by that same module. `drawFpsCorner()` draws the FPS readout and is
  called every scene from `main.js` (see Cross-piece edits), not just from title/pause.
- **Pause** (`createPauseScene`, replaces foundation's placeholder `pause`): Resume / Settings /
  Controls / Quit to Title, over a dimmed frozen frame of the scene beneath. Reuses the same
  menu toolkit and settings/controls screens as the title.
- **Controls screen** content is generated from the live keybinding table (`input.describe()`),
  not hard-coded text, so it always matches `DEFAULT_BINDINGS` (or a future rebind).
- `?showcase=title` (`src/ui/showcase-title.js`) is exactly the default title scene; `&menu=`
  jumps straight to `main|settings|controls|credits` for judging a sub-screen in isolation.

## APIs other pieces should call

```js
import { createTitleScene, createPauseScene } from './ui/title.js';
// scenes.define('title', createTitleScene({ forceMenu? }))   // forceMenu: showcase-only
// scenes.define('pause', createPauseScene())
```
Nobody else should need to call into this piece directly: `scenes.go('title')` /
`scenes.go('run')` / `scenes.pause()` are how other pieces already navigate. `run-flow` will
likely want to call `scenes.go('title')` from its game-over/victory screens (already how "Quit
to Title" works here) and may want its own end screens to be non-pausable for the same reason
title is (see Known gaps / the Esc conflict below).

```js
import { createMenuList, menuSfx, createTextScreen, drawPanel, drawFocusChevrons, drawGem, ease, clamp01 }
  from './ui/menus.js';
import { createSettingsScreen, drawFpsCorner } from './ui/settings.js';
```
These are reusable if another piece ever wants an in-game menu (e.g. a future "are you sure?"
confirm) rather than reinventing list navigation and sfx.

## Debug hooks and showcase params

- `__GR.debug.menu(action, arg)`: acts on whichever menu is currently open (title or pause).
  `action`: `'open'` (arg = screen name: main/settings/controls/credits), `'nav'`
  (arg = up/down/left/right), `'confirm'`, `'cancel'`. Always returns `{ok, screen, index}`.
  Existing generic hooks work too: `debug.input('down', true/false)`,
  `debug.tap('confirm', n)`, or raw `input.injectCode`.
- `state().menu` = `{screen, index}` on both the title and pause scenes.
- `?showcase=title&menu=main|settings|controls|credits`: opens straight into that screen instead
  of the closed "press start" vignette.

## Cross-piece edits

- `src/main.js`: one import line (`import './ui/title.js'`, in the marked spot) to register the
  title/pause scenes, one import for `drawFpsCorner`, and one line in `render()` to call it every
  frame so the Settings screen's "Show FPS" toggle works from any scene, not just title/pause.
  Also changed the pause-toggle line: it now only *opens* pause (`!scenes.paused`), never
  toggles it closed. Reason: Esc is bound to both the `pause` action and the `cancel` action;
  with the old "toggle" line, the same Esc press that opened the pause menu was also seen by the
  menu's own `cancel` handling and closed it again in the same frame (paused and instantly
  un-paused, so no visible effect). Closing/back-navigation is now entirely the pause menu's own
  job (its `RESUME` item, or Esc/`cancel` from its top screen; a `justOpened` guard inside
  `createPauseScene` also eats the opening press so the menu doesn't act on it a second time).
  This also fixes Esc from a *nested* pause screen (e.g. Settings-inside-pause): it now goes back
  one level, instead of the old line always fully resuming from any depth. Foundation's own notes
  (`foundation.md`, Known gaps) flagged this exact line as something a menu piece would need to
  take over.
- `src/core/showcase.js`: set `load` on the `title` row to `../ui/showcase-title.js` (the
  documented one-line convention).

## Known gaps

- **The title scene is intentionally not `pausable`.** It has its own screen stack, and Esc
  there means "back one level" inside that stack. If a later piece adds more non-gameplay
  scenes with their own sub-screens (e.g. `run-flow`'s game-over/summary), the same
  Esc-means-two-things conflict will show up there too; the fix is the same shape (don't mark it
  pausable, or take over the pause-toggle line the way this piece did).
- **No rebind UI.** The Controls screen is read-only (labels come live from
  `input.describe()`, so they'd update if bindings changed) but there is no in-game way to
  actually change a binding yet; `input.rebind()`/`resetBindings()` already exist for whoever
  builds that.
- **Gamepad is exercised structurally, not physically.** Every menu reads `input.ui.pressed()`
  for the same actions gameplay uses, so a gamepad drives menus exactly like keyboard once
  bound — but headless Chromium has no pad to press, so this has only been read-through, not
  seen working (same caveat foundation and hero recorded for gamepad).
- **The environment is borrowed, not authored.** The floor/wall/brazier/rubble are `look`'s
  showcase stand-ins (`src/render/showcase-models.js`), imported read-only (not edited) for the
  crypt-vignette look explicitly built for that purpose. That file's own known gaps apply here
  too (the wall's arch is a small, distant silhouette at this camera's pitch; `look.rubble` reads
  as plain rocks, which is why `look.bones` was left out — it reads as a small creature per
  `look.md`). `arenas` may eventually want its own title-caliber environment; this one is
  "finished" only in the sense of being complete and polished with what already exists.
- **The hero faces away from the camera** (into the arch, cloak/hood toward the viewer) for the
  "at the Gauntlet's mouth" framing. This reads well for silhouette-against-torchlight but means
  the idle face/eye detail `hero` built (blinks, look-arounds) is never actually seen on the
  title screen.
- **No boss/victory/credits-roll cameo.** The title is a single static vignette; it doesn't vary
  by save state, unlocked lore, or best time (that's `run-flow`'s "light meta", not built yet).
- **Settings screen has no scrollbar / overflow handling.** At 8 rows it fits the 640x360 frame
  with room to spare; a piece that adds more settings rows later should check it still fits.
- **Tested only via `tools/capture.cjs` in headless Chromium** (keyboard scripts, mouse
  move/click, `debug.menu`), not by a human with a real mouse/gamepad or at window sizes other
  than the capture default.
