// Gauntlet-Runner entry point. Wires the engine together and picks the first scene.
//
// Frame order (see core/loop.js):
//   frame:  input.beginFrame -> pause toggle -> scene.frame (menus, UI; runs while paused)
//   tick:   input.beginTick -> scene.tick                  (60 Hz, never while paused/hitstop)
//   render: scene.render(alpha) -> GL draw (+shake/flash) -> scene.ui(g) -> debug overlay
// Scene changes requested with scenes.go() apply between these steps, never mid-tick.
//
// URL: ?scene=title|run|boss  ?seed=<int>  ?showcase=<piece-id>[&...]  ?debug=1

import { display } from './core/display.js';
import { loop } from './core/loop.js';
import { input } from './core/input.js';
import { scenes } from './core/scenes.js';
import { reseed } from './core/rng.js';
import { events } from './core/events.js';
import { installContract, drawDebugOverlay } from './core/debug.js';
import { startShowcase } from './core/showcase.js';
import { drawText } from './core/pixelfont.js';
import './core/placeholders.js';
import { look } from './render/look.js';
import './audio/index.js'; // audio piece: mixer, SFX bank and music engine (side-effect import)

// ---- piece modules that define or override scenes: one import line each --------------
import './ui/title.js'; // title piece: title screen, main menu, settings, pause (scenes.define)
import { drawFpsCorner } from './ui/settings.js'; // title piece: the settings screen's showFps toggle

const params = new URLSearchParams(location.search);
const seedParam = parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : 1;
reseed(seed);

display.init(document.getElementById('app'));
look.install(); // render look: post chain, lights, shadows (src/render/look.js)
input.attach(window);
const GR = installContract(seed);

loop.start({
  frame(realDt) {
    input.beginFrame();
    scenes.flush();
    // Opens pause only; closing it is the pause menu's own job (Resume item, or Esc/cancel from
    // its top screen) — see title.md "Cross-piece edits": a menu that wants Esc to mean "back"
    // one level at a time can't share this line with a plain open/close toggle.
    if (input.ui.pressed('pause') && !scenes.paused && scenes.def?.pausable) scenes.pause();
    scenes.frame(realDt);
    scenes.flush();
  },
  tick() {
    input.beginTick(loop.tick);
    scenes.tick();
    scenes.flush();
    events.emit('tick', { tick: loop.tick });
  },
  render(alpha, realDt) {
    scenes.render(alpha, realDt);
    display.render(realDt);
    if (scenes.current) scenes.ui(display.ui, alpha);
    else drawText(display.ui, 'LOADING', display.width / 2, display.height / 2 - 4, 'mist', { align: 'center' });
    drawDebugOverlay();
    if (scenes.current) drawFpsCorner(display.ui); // title piece: settings.showFps, every scene
    if (!GR.ready && scenes.current) GR.ready = true;
  },
});

const showcase = params.get('showcase');
if (showcase !== null) {
  startShowcase(showcase, params);
} else {
  const want = params.get('scene') ?? 'title';
  if (want === 'boss') {
    // boss piece: the real fight (run-flow may replace this with its own define). ?intro=1 and ?phase=1|2|3 work here too.
    import('./boss/scene.js').then((m) => { scenes.define('boss', m.createBossScene({ intro: params.get('intro') === '1', phase: parseInt(params.get('phase') ?? '1', 10) || 1 })); scenes.go('boss'); })
      .catch((err) => { console.error('boss scene failed to load:', err); scenes.go('boss'); });
  } else scenes.go(['title', 'run'].includes(want) ? want : 'title');
}
