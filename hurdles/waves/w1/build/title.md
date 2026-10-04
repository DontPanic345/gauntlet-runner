# title: builder notes (wave 1)

## What exists

- **Title scene** (`src/ui/title.js`, scene `title`, the default entry `/`). It renders at zoom 1, the game's scale.
  - **The Gauntlet's mouth.** A voxel cliff 176 voxels wide with a carved masonry face. In the middle is a round arch, 44 voxels wide and 52 tall, framed by a ring of voussoirs, imposts and plinths. The keystone carries a skull with recessed ember eyes, and ember runes are cut down the jambs.
  - **Through the arch.** A vaulted tunnel of stairs descends into the dark toward a burning pool. Its back wall is dark rock split by glowing fissures.
  - **Set dressing.** Twin mountain shoulders with moss on the skyline, a flagstone courtyard with a worn path, rubble, bones, a skull pile, candles, urns, pillars and a sarcophagus. Two banners use 3 cloth frames and stir on a sine, with a gust during tremors.
  - **The runner.** The hooded runner (the `hero` rig and `HeroAnim`) idles at the threshold facing the viewer, with breathing, blinks and the occasional look-around.
  - **Lights.** Two braziers with real flickering lights and vfx voxel fire. Inside the tunnel, the collapse glows ember: one deep light, pulsing, plus a dim spill on the stairs. A cold frost light falls on the runner.
  - **Particles.** vfx ambient dust (90 motes) and embers drifting out of the arch and off the braziers.
  - **Tremor.** Every 9 to 15 s the mountain shudders:
    - a 1.6 px shake through `feedback` (so the settings scale it);
    - a low rumble (`ui.rumble`, on the ambience bus);
    - grit falling from the arch lintel, and dust puffs at the jambs;
    - the logo rattles and sheds grey grit, and the glow surges.
- **Logo** (built in `title.js`, `buildLogo()`, drawn on the UI canvas). It is not a font:
  - **GAUNTLET.** Custom 7x9 two-stroke letterforms at 5x scale, dressed as carved stone slabs:
    - a white and bone top bevel, a frost left edge, and a dithered fog-to-mist body;
    - a 6 px extruded underside (stone, stoneDark, night) and a 1 px ink outline with a 2 px drop;
    - chisel nicks;
    - seeded **ember cracks**. Each crack pulses on its own clock (blood, ember, flame, gold, torch), ignites left to right over the first ~1.2 s, and sheds rising spark pixels.
  - **The sword.** A 360 px sword runs under GAUNTLET, with a gold pommel, a wrapped grip, a crossguard and a frost-edged blade.
  - **RUNNER.** Molten-metal letters at 4x scale: a torch-and-gold top fading through flame to ember, a blood underside, and a heat band that drifts across them.
  - **Motion.** A white glint sweeps the stone and the blade every 5.5 s, and the logo breathes 1 px.
- **Main menu**: START RUN, SETTINGS, CONTROLS, CREDITS. The items sit in a column at the bottom left, over a dithered ink shade.
  - **Focus.** An ink plaque springs between items with a stretching width. It has a hot ember left edge, an ember underline cooling to blood, and an animated 3-frame voxel flame cursor that squashes on each move and sheds sparks. The focused text kicks right on a spring and turns torch with a blood shadow.
  - **Selecting.** The plaque and text flash white, the item hops 1 px, and embers burst from it.
  - **Entering.** Items slide in staggered, with an ease-back.
  - **Start Run.** The `ui.start` sting plays (thump, whoosh, D-minor chord, music duck), with a 3 px shake and a settings-scaled torch flash. The menu dissolves away. The runner turns, then runs up the stairs into the arch, kicking dust. A dithered iris closes on the arch mouth and opens on the `run` scene. The send-off runs on sim ticks, so `debug.timeScale` slows it for captures.
- **Sub-pages** (`src/ui/settings.js`): carved-slab panels with rivets, a bevel, a header and an ember rule. The scene behind them is dimmed by an ordered dither (no alpha).
  - **Settings**:
    - master, music and SFX volume, screen shake and screen flashes, as 10-pip warm sliders (`< >` arrows kick when used, the changed pip pops white and taller, the tick sound's pitch follows the value);
    - BUTTON PROMPTS (AUTO / KEYBOARD / GAMEPAD), RESTORE DEFAULTS, and BACK.
    - Every change is saved to localStorage (`gr.settings.v1`, through `core/settings.js`) and applies at once. The mixer reads the volumes live. Changing shake fires a demo shake at the new strength, and changing flashes fires a demo flash, both through the scaled `feedback` channel.
  - **Controls**: every gameplay action, with its keyboard and mouse keys (rebindable) and its pad button (display only).
    - **Rebinding.** Confirm on a row shows a blinking PRESS A KEY. The next key becomes the primary keyboard key. If another gameplay action already uses that key, the two actions swap, and both rows flash. Escape, pad B or Start, or a mouse click cancels. Backquote, Tab, F5, F11, F12 and Meta are refused with a deny sound.
    - RESET KEYS restores the defaults. Bindings persist through `input.rebind` (`gr.bindings.v1`).
    - Footnotes cover mouse aiming and the 2 s facing rule.
  - **Credits**: who made it, and that everything is made in code; three.js (MIT) is listed. A small flame is drawn on the page.
- **Pause menu** (scene `pause`, defined in `title.js`). It sits over any pausable scene (run, gauntlet, boss).
  - The frozen frame is dithered toward ink, with heavier bands at the top and bottom.
  - The PAUSED panel shows a line with where you are (ARENA n OF 5, GAUNTLET n, THE WARDEN) and your HP.
  - Items: RESUME, SETTINGS, CONTROLS, QUIT TO TITLE. Quitting opens a confirm page (ABANDON RUN?), whose default focus is KEEP RUNNING. Confirming irises to the title.
  - The `ui.open` sound plays on open, and `ui.back` on resume.
  - Esc, P or Start goes back one page, and resumes from the root page.
- **Input everywhere.**
  - Keyboard: arrows or WASD move, with a held-key auto-repeat (0.34 s delay, then every 75 ms). Enter, J, E or Space selects. Esc or Backspace goes back. Left and Right adjust sliders and choices.
  - Mouse: hovering focuses an item, but only when the mouse actually moves, so a parked cursor never steals focus from the keys. A click activates. Clicking or dragging on a slider's pips sets its value. Clicking a choice cycles it. A right-click goes back.
  - Gamepad: the same actions through the bindings table (stick, d-pad, A, B, Start).
- **Prompts.** The footer prompt bar shows ↑↓ CHOOSE, ←→ ADJUST (on sliders and choices), SELECT or REBIND, and BACK or RESUME. It uses drawn key caps: keyboard caps that sink 1 px while held, coloured pad face buttons (A leaf, B red, X blue, Y gold), and a mouse icon. The glyph set follows the BUTTON PROMPTS setting, or the last device used.
- **UI sounds**, registered into the audio bank from `menus.js` (bus `ui`, in D minor with the title theme):
  - `ui.move`: pitch climbs D minor pentatonic with the item index;
  - `ui.select`, `ui.back`, `ui.tick`, `ui.deny`, `ui.open`, `ui.start`;
  - `ui.rumble` (bus `amb`).
- **Scene-transition iris** (`wipe` in `menus.js`): a Bayer-dithered closing and opening circle, drawn by `main.js` after the scene UI, so it survives a scene change.

## APIs

```js
// src/ui/menus.js
import { MenuStack, uiSound, wipe, drawPanel, drawKey, drawPrompt, promptDevice, codesFor, keyWidth,
         ditherRect, ditherPattern, layer, blitLayer, Sparks, Spring, drawFlame, easeOut, easeBack } from './ui/menus.js';
const stack = new MenuStack({ onEmpty(stack) {}, onBind: menuBindHandler, sparks });
stack.reset(page) / stack.open(page, { silent }) / stack.back({ silent })
stack.frame(realDt)  // in a scene's frame()
stack.draw(g)        // in its ui()
stack.page; stack.focusItem; stack.setFocus(i); stack.activate(item); stack.events  // last 32 {type, page, item}
// page: { id, style: 'title' | 'panel', title, w, lineH, items, focus, onBack(stack) -> true to swallow,
//         backLabel, footer: false, footerAlign, extraTop(g, box, stack), extraTopH, extraBottom(g, box, stack), extraH }
// items: action {label, onSelect(stack, item), hint, disabled, silent} | slider {label, get, set, steps, demo(v, old)}
//        choice {label, options: [{value, label}], get, set, demo(v)} | bind {label, action} | gap | label {label, color}
uiSound('ui.move', { step, rate, gain })                // any bank sound, D-minor pentatonic step helper
wipe.close(cx, cy, seconds, onClosed); wipe.open(seconds, cx?, cy?); wipe.active; wipe.state
drawPrompt(g, action | 'choose' | 'adjust', 'LABEL', x, y, color?, device?) -> width   // key cap(s) + label
drawKey(g, code, x, y) -> width; promptDevice() -> 'keyboard' | 'gamepad'
drawPanel(g, x, y, w, h, { title }) -> content box

// src/ui/settings.js
import { settingsPage, controlsPage, creditsPage, confirmPage, menuBindHandler, rebindPrimary, GAMEPLAY } from './ui/settings.js';
confirmPage({ title, text, yes(stack), yesLabel, noLabel })
rebindPrimary(action, code) -> { ok, old, swapped }   // swaps with any gameplay action using `code`

// src/ui/title.js
import { createTitleScene, VERSION } from './ui/title.js';
createTitleScene({ menu: 'main' | 'settings' | 'controls' | 'credits', intro: bool, ui: bool, zoom }) -> { def, stack, open(name), start(), tremor(), relight() }
// scenes 'title' and 'pause' are defined on import.
```

- `run-flow` and anyone else can use `wipe` for their own transitions, `drawPrompt` for in-game hints ("[E] OPEN"), and `confirmPage` / `MenuStack` for any menu (the gameover and victory screens).
- **Settings keys**: `masterVolume`, `musicVolume`, `sfxVolume`, `shake`, `flashes`, and `keyDisplay` (new). `showFps` exists in core settings but has no UI and nothing draws it.
- **Pause key ownership**: a scene def with `ownsPauseKey: true` gets Esc, P and Start itself while it is the paused scene. `main.js` then skips its own toggle.
- Events: none emitted. The stack keeps its own `events` log for tests.

## Debug hooks and showcase params

- `__GR.debug.title(action?, arg)` acts on whichever title or pause menu is open.
  - Actions:
    - no action or `'info'` returns `{scene, page, depth, focus, item, listening, events}`;
    - `'open', 'settings' | 'controls' | 'credits' | 'main'`;
    - `'focus', i`; `'select'` (activates the focused item); `'back'`;
    - `'start'` (the Start Run send-off), `'tremor'`, `'logo'` (re-ignites the cracks).
  - Use it for the pause menu too: while paused, `__GR.state()` reports the scene underneath.
- `__GR.state().title` on the title or its showcase: `{page, depth, focus, item, items, listening, starting, wipe, events, settings: {master, music, sfx, shake, flashes, keyDisplay}}`.
- `?showcase=title` is the title exactly as `/` opens it: the same code, in its own instance, with the title music. Params:
  - `&menu=settings|controls|credits|main` (alias `&page=`) opens on that page;
  - `&intro=0` starts with the cracks already lit;
  - `&ui=0` gives the 3D scene only, with no logo or menu;
  - `&zoom=2` is a close-up for inspecting the voxels. The layout is tuned for zoom 1.
- **Pause menu in normal play**: load `?scene=run` (or `boss`), wait for ready, then press Escape.
- **Recipes**:
  - **Start send-off strip.** Run `__GR.debug.timeScale(0.15)`, press Enter, then burst. The runner turns at tick 12 and the iris closes at tick 44. The iris itself runs in real time.
  - **Slider click.** At 1280x720, the MUSIC pips on `?showcase=title&menu=settings` sit at about page (710..866, 257).
  - **Keypresses.** Leave about 80 ms or more between scripted presses of different keys. Repeated presses of the same action in one frame are counted (`input.ui.count`).

## Cross-piece edits

- `src/main.js` (foundation): `import './ui/title.js'`, plus `import { wipe }` and `wipe.draw(display.ui, realDt)` after the scene UI, so the iris survives a scene change. The pause toggle line now skips when the paused scene sets `ownsPauseKey`, so Esc inside the pause menu's sub-pages means "back".
- `src/core/settings.js` (foundation): added the `keyDisplay: 'auto'` default.
- `src/core/input.js` (foundation): added `input.ui.count(action)`, the number of presses since the last frame. Headless runs at 6 to 15 fps merged two quick presses into one frame, so menus skipped steps. `ui.pressed` is unchanged.
- `src/core/showcase.js` (foundation): set `load` on the `title` row.
- `src/audio/director.js` (audio): `?showcase=title` now plays the title music, like `/`. Other showcases stay silent.
- The UI sounds are added to the audio bank's `SFX` table at import time from `menus.js`; `bank.js` itself is not edited.

## Known gaps

- **Nobody has heard the UI sounds** (or the rumble). They were checked only for playing: `debug.audio().sfx.recent` shows `ui.move` climbing in pitch, `ui.select`, `ui.tick` and `ui.back`. Their levels are guesses.
- **Gamepad is untested.** There is no pad in headless Chromium. Navigation goes through the bindings table and should work. Rebinding only captures keyboard keys; pad buttons are display only.
- **The arch interior reads as a bright horizontal band** (the pool far below, seen past the stairs) over darker steps. At thumbnail size it may read as "a fiery slot" rather than "stairs down into fire". The keystone skull's ember eyes come out rose-red after the post quantise.
- **The masonry and rock are dark.** Outside the braziers' pools most of the wall sits in the bottom four palette steps. That is moody, but the left and right thirds are close to flat.
- **The tremor is subtle at game scale.** The grit is 1 px and the shake is 1.6 px.
- **The runner is small** (about 44 px). That is deliberate, for scale against the gate, but his pose is the stock idle, with no title-specific pose.
- **The logo is drawn on the 2D canvas,** so the look's lights and fog never touch it. Its cracks are random walks and some read as squiggles. The N's diagonal bevel reads as a white slash.
- **First frame.** The cliff (about 320 ms) and courtyard (about 70 ms) mesh on first entry, before the first frame is drawn. The page shows palette `night` until then, with no LOADING text, but it is a stall.
- **The pause screen runs at whatever fps the frozen scene renders at.** The boss pit measured 6 fps headless, so its panel slide-in and the iris look steppy there. Real GPUs were not measured.
- **Rebinding is primary-key only.** You cannot add a second key or unbind one. Movement and attack keys can be rebound to keys that browsers also use (for example Ctrl).
- **No FPS toggle, no resolution or scale options, and no "reduce motion"** for the logo's breathing and sparks.
- **No gameover or victory menus.** Those belong to `run-flow`, which can reuse `MenuStack` and `wipe`.
