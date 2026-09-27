// The death sequence (piece `run-flow`): a slow-motion beat on the hit that killed the hero,
// then the screen collapses to black around a closing red vignette, with the cause of death
// fading in, before handing off to the `gameover` scene.
//
// Timed in real seconds (not sim ticks) so it stays a fixed, predictable length no matter what
// `loop.timeScale` the moment is running at: total budget is well under the 3 s must-have, and
// any of confirm/attack/dash skips straight to the end.

import { loop } from '../core/loop.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { drawText } from '../core/pixelfont.js';
import { drawVignette } from '../ui/widgets/vignette.js';
import { drawIrisWipe } from './transition.js';

const SLOW_SCALE = 0.3;     // how deep the slow-mo dips
const HOLD_SLOW = 0.5;      // seconds spent at the deepest slow-mo
const CLOSE_END = 1.25;     // vignette + iris fully closed by this many seconds in
const TEXT_AT = 0.75;       // cause-of-death line starts fading in
const CUT_AT = 1.85;        // hard cap: onDone fires by here even if nothing else happened

export function createDeathSequence({ causeLabel = () => 'the dark claimed you', onDone = null } = {}) {
  let active = false, done = false, t0 = 0;
  const seq = {
    get active() { return active; },
    begin() {
      if (active) return;
      active = true; done = false; t0 = loop.realTime;
      loop.setTimeScale(SLOW_SCALE);
    },
    /** Player wants control back now: jump straight to the end. */
    skip() { if (active && !done) finish(); },
    /** Abandon the sequence without firing onDone (a debug jump elsewhere took over). */
    cancel() { if (!active) return; active = false; done = true; loop.setTimeScale(1); },
    frame() {
      if (!active || done) return;
      const t = loop.realTime - t0;
      if (t > HOLD_SLOW) {
        const k = Math.min(1, (t - HOLD_SLOW) / Math.max(0.001, CLOSE_END - HOLD_SLOW));
        loop.setTimeScale(SLOW_SCALE + k * (1 - SLOW_SCALE));
      }
      if (input.ui.pressed('confirm') || input.ui.pressed('attack') || input.ui.pressed('dash')) { finish(); return; }
      if (t >= CUT_AT) finish();
    },
    ui(g) {
      if (!active) return;
      const t = loop.realTime - t0;
      const W = display.width, H = display.height;
      const vig = Math.min(1, t / (CLOSE_END * 0.85));
      drawVignette(g, W, H, vig, 'blood');
      const irisK = Math.max(0, (t - HOLD_SLOW * 0.55) / Math.max(0.001, CLOSE_END - HOLD_SLOW * 0.55));
      drawIrisWipe(g, W, H, Math.min(1, irisK), { color: 'ink' });
      if (t > TEXT_AT) {
        const a = Math.min(1, (t - TEXT_AT) / 0.35);
        g.globalAlpha = a;
        drawText(g, causeLabel().toUpperCase(), Math.round(W / 2), Math.round(H / 2) - 3, 'red', { align: 'center', outline: 'ink' });
        g.globalAlpha = 1;
      }
    },
  };
  function finish() {
    done = true; active = false;
    loop.setTimeScale(1);
    onDone?.();
  }
  return seq;
}
