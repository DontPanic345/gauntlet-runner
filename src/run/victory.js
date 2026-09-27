// The victory sequence (piece `run-flow`): the beat after `boss:cleared` (the Warden's own death
// spectacle is the `boss` piece's job; this is what happens once the player actually holds the
// key). A warm gold wash, embers and pickup sparkles round the hero, and a banner announcing the
// zone is clear, before handing off to the `victory` summary scene. Not time-constrained like the
// death sequence, but still skippable.

import { loop } from '../core/loop.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { drawText } from '../core/pixelfont.js';
import { feedback } from '../core/feedback.js';
import { vfx } from '../vfx/index.js';

const BANNER_AT = 0.15;
const SUB_AT = 0.55;
const CUT_AT = 3.6;
const FADE_BEFORE = 0.5;

export function createVictorySequence({ heroPos = () => ({ x: 0, z: 0 }), onDone = null } = {}) {
  let active = false, done = false, t0 = 0, nextBurst = 0;
  const seq = {
    get active() { return active; },
    begin() {
      if (active) return;
      active = true; done = false; t0 = loop.realTime; nextBurst = 0;
      feedback.flash('gold', 260, 0.35);
      feedback.shake(3, 400);
    },
    skip() { if (active && !done) finish(); },
    /** Abandon the sequence without firing onDone (a debug jump elsewhere took over). */
    cancel() { if (!active) return; active = false; done = true; },
    frame() {
      if (!active || done) return;
      const t = loop.realTime - t0;
      if (t >= nextBurst) {
        const p = heroPos();
        vfx.embers({ x: p.x + (Math.random() - 0.5) * 3.4, y: 0.3, z: p.z + (Math.random() - 0.5) * 2.4, n: 3 });
        if (Math.random() < 0.55) vfx.pickup({ x: p.x + (Math.random() - 0.5) * 2, y: 0.6, z: p.z + (Math.random() - 0.5) * 2, style: 'gold' });
        nextBurst = t + 0.16 + Math.random() * 0.14;
      }
      if (input.ui.pressed('confirm') || input.ui.pressed('attack')) { finish(); return; }
      if (t >= CUT_AT) finish();
    },
    ui(g) {
      if (!active) return;
      const t = loop.realTime - t0;
      const W = display.width, H = display.height;
      const wash = Math.max(0, 0.32 - t * 0.07);
      if (wash > 0.008) { g.fillStyle = `rgba(255,216,107,${wash.toFixed(3)})`; g.fillRect(0, 0, W, H); }
      if (t > BANNER_AT) {
        const k = Math.min(1, (t - BANNER_AT) / 0.35);
        const fade = t > CUT_AT - FADE_BEFORE ? Math.max(0, (CUT_AT - t) / FADE_BEFORE) : 1;
        const oy = Math.round((1 - k) * -14);
        g.globalAlpha = k * fade;
        drawText(g, 'THE GAUNTLET IS BROKEN', Math.round(W / 2), Math.round(H * 0.26) + oy, 'gold', { align: 'center', scale: 2, outline: 'ink' });
        if (t > SUB_AT) {
          const k2 = Math.min(1, (t - SUB_AT) / 0.3);
          g.globalAlpha = k2 * fade;
          drawText(g, 'ZONE I CLEARED', Math.round(W / 2), Math.round(H * 0.26) + oy + 20, 'bone', { align: 'center', shadow: 'ink' });
        }
        g.globalAlpha = 1;
      }
    },
  };
  function finish() { done = true; active = false; onDone?.(); }
  return seq;
}
