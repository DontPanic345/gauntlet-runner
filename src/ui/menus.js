// Menu toolkit (piece `title`): a keyboard/mouse/gamepad-navigable vertical list, the shared
// menu SFX, and small panel-drawing helpers used by the title screen, the settings screen and
// the pause menu. Deliberately a leaf module: it does not know about scenes or the title's own
// 3D environment, so `settings.js` and `title.js` can both build on it without a cycle.
//
//   import { createMenuList, menuSfx, drawPanel, drawFocusChevrons, ease } from './menus.js';
//   const menu = createMenuList({ items: [{id:'start', label:'START'}, ...], onConfirm, onCancel });
//   frame(): menu.frame()             // input, every rendered frame (works while paused)
//   ui(g):  menu.ui(g, x, y, w, itemH, t)   // draws the list, returns the total pixel height
//   menu.index / menu.setIndex(i) / menu.items

import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { loop } from '../core/loop.js';
import { drawText, textWidth, wrapText, LINE_H } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { sfxContext, tone, noise, makeNoiseBuffer, vary } from '../audio/mixer.js';

export const TAU = Math.PI * 2;
export const ease = {
  out: (u) => 1 - (1 - u) * (1 - u) * (1 - u),
  back: (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
  inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
};
export const clamp01 = (u) => Math.max(0, Math.min(1, u));

// ---- shared menu SFX (routed through the audio piece's mixer, same pattern as boonSfx) --------
let noiseBuf = null;
function ac() {
  const m = sfxContext();
  if (!m) return null;
  if (!noiseBuf) noiseBuf = makeNoiseBuffer(m.ctx, 13, 1);
  return m;
}
export const menuSfx = {
  hover() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime, v = vary('menu-hover', { pitch: 0.03, gain: 0.15 });
    tone(c, out, t, 0.045, { type: 'square', f0: 660 * v.pitch, f1: 760 * v.pitch, gain: 0.05 * v.gain, attack: 0.001 });
    noise(c, out, noiseBuf, t, 0.03, { type: 'highpass', f0: 4200, gain: 0.04 * v.gain, attack: 0.001 });
  },
  select() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime, v = vary('menu-select', { pitch: 0.02, gain: 0.1 });
    tone(c, out, t, 0.1, { type: 'square', f0: 520 * v.pitch, f1: 900 * v.pitch, gain: 0.09 * v.gain, attack: 0.001 });
    tone(c, out, t + 0.03, 0.16, { type: 'triangle', f0: 1040 * v.pitch, f1: 1040 * v.pitch, gain: 0.07 * v.gain, attack: 0.002 });
    noise(c, out, noiseBuf, t, 0.05, { type: 'highpass', f0: 5000, gain: 0.08, attack: 0.001 });
  },
  back() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime;
    tone(c, out, t, 0.1, { type: 'square', f0: 420, f1: 260, gain: 0.08, attack: 0.001 });
  },
  denied() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime;
    tone(c, out, t, 0.08, { type: 'square', f0: 160, f1: 130, gain: 0.09 });
    tone(c, out, t + 0.07, 0.1, { type: 'square', f0: 140, f1: 110, gain: 0.09 });
  },
  open() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime;
    noise(c, out, noiseBuf, t, 0.18, { type: 'bandpass', f0: 700, f1: 2200, q: 1.3, gain: 0.1, attack: 0.03 });
    tone(c, out, t, 0.22, { type: 'sine', f0: 220, f1: 340, gain: 0.08, attack: 0.02 });
  },
  slider() {
    const m = ac(); if (!m) return;
    const { ctx: c, out } = m, t = c.currentTime;
    tone(c, out, t, 0.04, { type: 'square', f0: 700, f1: 700, gain: 0.04, attack: 0.001 });
  },
};

// ---- panel chrome (matches the shrine's ink/gold framed look) ----------------------------------

/** A framed ink panel with a 1-px gold-ish top edge. `edge` is a palette name. */
export function drawPanel(g, x, y, w, h, { edge = 'slate', fill = 'shadow', inset = 'night' } = {}) {
  g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = css(fill); g.fillRect(x, y, w, h);
  g.fillStyle = css(edge); g.fillRect(x, y, w, 1);
  g.fillStyle = css(inset); g.fillRect(x, y + h - 1, w, 1);
}

/** Bouncing gold chevrons either side of a focused row, like the shrine's pointer. */
export function drawFocusChevrons(g, cx, y, t, spread) {
  const bob = Math.round(Math.abs(Math.sin(t * 5)) * 2);
  g.fillStyle = css('ink'); drawChevron(g, cx - spread - bob, y, 1, -1); drawChevron(g, cx + spread + bob, y, -1, -1);
  g.fillStyle = css('gold'); drawChevron(g, cx - spread - bob, y, 1, 0); drawChevron(g, cx + spread + bob, y, -1, 0);
}
function drawChevron(g, x, y, dir, oy) {
  g.fillRect(x, y - 3 + oy, 1, 7); g.fillRect(x + dir, y - 2 + oy, 1, 5); g.fillRect(x + dir * 2, y - 1 + oy, 1, 3);
}

/** A tiny diamond gem accent (dividers, corners), matching the shrine's card gems. */
export function drawGem(g, x, y, hi = 'gold', edge = 'slate') {
  g.fillStyle = css('ink'); g.fillRect(x - 3, y - 1, 7, 3); g.fillRect(x - 1, y - 3, 3, 7);
  g.fillStyle = css(edge); g.fillRect(x - 2, y, 5, 1); g.fillRect(x, y - 2, 1, 5);
  g.fillStyle = css(hi); g.fillRect(x, y, 1, 1);
}

// ---- a vertical, focusable list of items --------------------------------------------------------
//   items: [{ id, label, disabled?, sub? }]   sub: small right-aligned value string (e.g. a slider readout)
export function createMenuList({ items, onConfirm, onCancel, onFocus, wrap = true } = {}) {
  let sel = firstEnabled();
  let hoverIdx = -1;
  const t0 = { v: loop.realTime };
  let focusT = loop.realTime;  // time when the current item gained focus, for transition animation

  function firstEnabled() { for (let i = 0; i < items.length; i++) if (!items[i].disabled) return i; return 0; }
  function move(d) {
    if (!items.length) return;
    let n = sel, tries = 0;
    do { n = wrap ? (n + d + items.length) % items.length : Math.max(0, Math.min(items.length - 1, n + d)); tries++; }
    while (items[n]?.disabled && tries <= items.length);
    if (n !== sel && !items[n]?.disabled) { sel = n; focusT = loop.realTime; menuSfx.hover(); onFocus?.(sel, items[sel]); }
  }
  function confirm() {
    const it = items[sel];
    if (!it || it.disabled) { menuSfx.denied(); return; }
    menuSfx.select();
    onConfirm?.(it, sel);
  }

  const list = {
    get index() { return sel; },
    get items() { return items; },
    setIndex(i) { if (items[i] && !items[i].disabled) { sel = i; focusT = loop.realTime; } },
    setItems(next) { items = next; sel = Math.min(sel, Math.max(0, items.length - 1)); t0.v = loop.realTime; focusT = loop.realTime; },
    /** Replay the pop-in animation (e.g. when the screen this list lives on is (re)opened). */
    replay() { t0.v = loop.realTime; focusT = loop.realTime; },

    /** Call every rendered frame. `rect(i)` maps an item index to its clickable box (UI px). */
    frame(rect) {
      if (input.ui.pressed('up')) move(-1);
      if (input.ui.pressed('down')) move(1);
      if (input.ui.pressed('confirm') || input.ui.pressed('attack')) confirm();
      else if (input.ui.key('Space')) confirm();
      if (input.ui.pressed('cancel')) { menuSfx.back(); onCancel?.(); }
      if (!rect) return;
      const m = input.mouse;
      if (m.inside && input.mouseActive()) {
        const r = display.uiCanvas.getBoundingClientRect();
        const mx = ((m.x - r.left) / r.width) * display.width, my = ((m.y - r.top) / r.height) * display.height;
        let h = -1;
        for (let i = 0; i < items.length; i++) {
          if (items[i].disabled) continue;
          const b = rect(i);
          if (b && mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) h = i;
        }
        if (h !== hoverIdx) { hoverIdx = h; if (h >= 0 && h !== sel) { sel = h; focusT = loop.realTime; menuSfx.hover(); onFocus?.(sel, items[sel]); } }
        if (h >= 0 && input.ui.key('Mouse0')) { sel = h; confirm(); }
      } else hoverIdx = -1;
    },

    /** Draw a centred vertical list starting at (x, y), one row per itemH px. Returns total height. */
    ui(g, x, y, w, itemH, t) {
      items.forEach((it, i) => {
        const iy = y + i * itemH;
        const focused = i === sel;
        const pop = clamp01((t - t0.v - i * 0.05) / 0.22);
        if (pop <= 0) return;
        const oy = Math.round((1 - ease.out(pop)) * 14);
        const alpha = pop;
        g.save();
        g.globalAlpha = Math.round(alpha * 4) / 4 || 0.25;
        const bx = x, by = iy + oy, bw = w, bh = itemH - 4;
        
        // Focus transition animation: when this item gains focus, it shows a bright glow
        let focusBrightness = 0;
        if (focused) {
          const focusDur = 0.15;  // focus transition duration: 150ms for snappy feel
          const focusAge = t - focusT;
          const focusProgress = clamp01(focusAge / focusDur);
          focusBrightness = ease.out(focusProgress);  // fade in glow over 150ms
        }
        
        // Draw the panel with focus feedback
        if (focused) {
          drawPanel(g, bx, by, bw, bh, { edge: 'gold', fill: it.disabled ? 'shadow' : 'dusk' });
          
          // Horizontal sweep effect (existing)
          const sweep = ((t * 0.6 + i * 0.3) % 1.4) / 1.4;
          g.save(); g.beginPath(); g.rect(bx + 1, by + 1, bw - 2, bh - 2); g.clip();
          g.globalAlpha *= 0.22; g.fillStyle = css('white');
          for (let yy = 0; yy < bh; yy++) g.fillRect(Math.round(bx - 24 + sweep * (bw + 48) - yy * 0.5), by + yy, 6, 1);
          g.restore();
          
          // Add a bright glow outline during focus transition to show state change
          if (focusBrightness > 0.05) {
            g.fillStyle = css('torch');
            g.globalAlpha = Math.min(0.5, focusBrightness * 0.8);
            // Outline around the panel to highlight focus change
            g.fillRect(bx - 1, by - 1, bw + 2, 1);   // top
            g.fillRect(bx - 1, by + bh, bw + 2, 1);  // bottom
            g.fillRect(bx - 1, by, 1, bh);           // left
            g.fillRect(bx + bw, by, 1, bh);          // right
          }
        } else {
          drawPanel(g, bx, by, bw, bh, { edge: 'shadow', fill: it.disabled ? 'night' : 'shadow' });
        }
        
        const color = it.disabled ? 'slate' : focused ? 'gold' : 'bone';
        drawText(g, it.label, bx + 10, by + Math.round(bh / 2) - 3, color, { shadow: 'ink' });
        if (it.sub != null) drawText(g, String(it.sub), bx + bw - 10 - textWidth(String(it.sub)), by + Math.round(bh / 2) - 3, focused ? 'torch' : 'fog', { shadow: 'ink' });
        if (focused && !it.disabled) drawFocusChevrons(g, bx - 8, by + Math.round(bh / 2), t, 2);
        g.restore();
      });
      return items.length * itemH;
    },
  };
  return list;
}

/** A simple read-only paged text screen (Controls, Credits): title, wrapped lines, a Back footer. */
export function createTextScreen({ heading, lines, onBack }) {
  const t0 = { v: loop.realTime };
  const rowH = () => lines.reduce((h, l) => h + (l === '' ? LINE_H * 0.6 : LINE_H + 2), 0);
  return {
    reset() { t0.v = loop.realTime; },
    frame() {
      if (input.ui.pressed('cancel') || input.ui.pressed('confirm') || input.ui.key('Mouse0')) { menuSfx.back(); onBack?.(); }
    },
    ui(g, x, y, w) {
      const t = loop.realTime;
      const pop = clamp01((t - t0.v) / 0.25);
      const oy = Math.round((1 - ease.out(pop)) * 10);
      const contentTop = 34, footerGap = 22;
      const h = contentTop + rowH() + footerGap + 12;
      g.save(); g.globalAlpha = pop;
      drawPanel(g, x, y + oy, w, h, { edge: 'slate' });
      drawText(g, heading, x + w / 2, y + oy + 10, 'gold', { align: 'center', scale: 2, outline: 'ink' });
      let cy = y + oy + contentTop;
      for (const line of lines) {
        if (line === '') { cy += LINE_H * 0.6; continue; }
        const [label, value] = Array.isArray(line) ? line : [line, null];
        drawText(g, label, x + 14, cy, value != null ? 'frost' : 'bone', { shadow: 'ink' });
        if (value != null) drawText(g, value, x + w - 14 - textWidth(value), cy, 'gold', { shadow: 'ink' });
        cy += LINE_H + 2;
      }
      drawText(g, 'ENTER OR ESC: BACK', x + w / 2, cy + 8, 'mist', { align: 'center', shadow: 'ink' });
      g.restore();
      return h;
    },
  };
}

export function wrapLines(text, w) { return wrapText(text, w); }
