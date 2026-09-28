# title: builder notes (wave 2)

## What exists

All of wave 1 persists. Changes in this wave:

- **Menu focus transition animation** (`src/ui/menus.js`, lines ~183-210 in `createMenuList`'s `ui()` method):
  When a menu item gains focus (via keyboard up/down or mouse hover), it now shows a 150ms
  glow/outline fade-in using a `torch` colour. This provides the **snappy, responsive state
  change** the blind judge flagged as missing. The glow is calculated from `focusT` (set on each
  focus change) to create a clear "you just moved here" visual feedback that complements the
  existing audio hover cue and chevron animation.

- **Logo pulse animation simplification** (`src/ui/title.js`, `drawLogo()` function, lines ~87-90):
  The ember glow pulse now cycles once every **6 seconds** (was ~3.8 seconds). This reduces the
  visible dither flicker that read as "nervous energy" in the critic's review. The dither pattern
  check density is also reduced (multiplied by 2.5 instead of 3.0), further lowering the
  TV-static artifact. The slow pulse now reads as a confident, subtle glow rather than nervous
  flickering. Hanging chain accents and corner gems were removed from the logo to reduce visual
  clutter on the first screen (they were very small detail work invisible at capture resolution).

- **"PRESS START" prompt timing** (`src/ui/title.js`, line ~156): Blink period changed from 1.1s
  (0.68s on, 0.42s off) to 0.3s (0.2s on, 0.1s off). This creates a faster, more **urgent** signal
  that action is needed, rather than a slow waiting-room feel.

- **Settings screen streamlined** (`src/ui/settings.js`): Removed the "SHOW FPS" toggle from the
  player-facing settings menu (6 rows instead of 8; ~16% of screen height instead of 24%). The
  toggle still exists in `core/settings.js` and is still drawn by `drawFpsCorner()` when enabled,
  but players won't see it in Settings—it's now debug-only (accessible via the debug console if
  needed). This reduces settings menu clutter and focuses the interface on user-facing controls
  (volumes and accessibility).

## APIs other pieces should call

Unchanged from wave 1: no new public APIs were added. The menu toolkit remains a stable leaf module.

```js
import { createTitleScene, createPauseScene } from './ui/title.js';
import { createMenuList, menuSfx, createTextScreen, drawPanel, drawFocusChevrons, drawGem, ease, clamp01 }
  from './ui/menus.js';
import { createSettingsScreen, drawFpsCorner } from './ui/settings.js';
```

## Debug hooks and showcase params

Unchanged from wave 1:
- `__GR.debug.menu(action, arg)`: drives menus on title or pause.
- `state().menu` = `{screen, index}`.
- `?showcase=title&menu=main|settings|controls|credits`: jump to a screen.

## Cross-piece edits

No new cross-piece edits in this wave. Wave 1's edits to `src/main.js` (pause toggle, FPS render)
and `src/core/showcase.js` (title row `load` path) remain in place and unchanged.

## Known gaps

- **Menu focus glow is 2D only.** The outline draws over the menu panel but doesn't depth-sort
  relative to the vignette behind it. This is correct here (it should float on top) but a future
  in-game menu (e.g. run-flow's pause-over-gameplay) might need the menu to composite under
  certain UI layers. Currently unsupported; would need a z-aware panel drawing mode.

- **Logo gem accents were dropped to reduce clutter.** If a future wave wants them back for
  polish, they're still in the draw function commented out—just uncomment the four `drawGem` calls
  and the corner gem in the tagline divider. They're tiny at capture resolution but add perceived
  craftsmanship at full scale.

- **Settings screen still doesn't scroll/paginate.** At 6 rows it comfortably fits 640x360, so
  this remains unblocked. Any future settings additions should verify they still fit, or implement
  scrolling then.

- **No keyboard shortcut for the FPS toggle.** Since it's no longer in the UI, there's no in-game
  way to enable it except via the debug console (`__GR.debug...` or browser DevTools). This is
  intentional—FPS counter is for profiling, not a player feature. A debug keybind (e.g. Shift+F)
  could be added to `input.js` if needed.

- **The title scene remains not pausable**, and wave 2 made no changes there. The caveat from
  wave 1 still applies: if `run-flow` adds game-over or summary screens with sub-menus, those
  will face the same Esc-means-two-things conflict and need the same solution (non-pausable, own
  escape handling).

- **Gamepad remains untested in practice.** The menu code paths are there and should work, but
  no human has yet pressed an actual gamepad button through a title menu.

- **Tested only in headless Chromium.** The focus glow animation was verified at 60 FPS via
  capture burst (keys: down/down/down/up), and the pulse animation at various capture speeds, but
  not on a real GPU or at different viewport sizes.

