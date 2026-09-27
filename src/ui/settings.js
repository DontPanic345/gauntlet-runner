// The settings screen (piece `title`): master/music/sfx volume, screen-shake and flash-scale
// accessibility sliders, and a show-FPS toggle. Values live in `core/settings.js` (localStorage,
// already read live by every consumer: `feedback` reads `shake`/`flashes` per call, the audio
// mixer reads `masterVolume`/`musicVolume`/`sfxVolume` per note). This screen only ever calls
// `settings.set()`, so "persist + apply live" falls out of how those pieces already read it.
//
//   import { createSettingsScreen, drawFpsCorner } from './settings.js';
//   const s = createSettingsScreen({ onBack });
//   s.frame();   s.ui(g, x, y, w, t);   // same shape as menus.js screens

import { settings, SETTING_DEFAULTS } from '../core/settings.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { loop } from '../core/loop.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { drawPanel, drawFocusChevrons, menuSfx, ease, clamp01 } from './menus.js';

const NOTCHES = 14;
const ROW_H = 22;

const ROWS = [
  { id: 'masterVolume', label: 'MASTER VOLUME', kind: 'slider' },
  { id: 'musicVolume', label: 'MUSIC VOLUME', kind: 'slider' },
  { id: 'sfxVolume', label: 'SFX VOLUME', kind: 'slider' },
  { id: 'shake', label: 'SCREEN SHAKE', kind: 'slider' },
  { id: 'flashes', label: 'FLASHES', kind: 'slider' },
  { id: 'showFps', label: 'SHOW FPS', kind: 'bool' },
  { id: 'reset', label: 'RESET TO DEFAULTS', kind: 'action' },
  { id: 'back', label: 'BACK', kind: 'action' },
];

export function createSettingsScreen({ onBack } = {}) {
  let sel = 0;
  let hoverIdx = -1;
  let dragging = -1;
  const t0 = { v: loop.realTime };
  const flash = { i: -1, t: -99 };

  function nudge(row, dir) {
    if (row.kind === 'slider') {
      const v = clamp01(Math.round((settings.get(row.id) + dir * 0.05) * 100) / 100);
      settings.set(row.id, v);
      menuSfx.slider();
    } else if (row.kind === 'bool') {
      settings.set(row.id, !settings.get(row.id));
      menuSfx.hover();
    }
  }
  function activate(i) {
    const row = ROWS[i];
    if (row.kind === 'bool') { settings.set(row.id, !settings.get(row.id)); menuSfx.select(); }
    else if (row.id === 'reset') { settings.reset(); menuSfx.select(); flash.i = i; flash.t = loop.realTime; }
    else if (row.id === 'back') { menuSfx.back(); onBack?.(); }
    else menuSfx.select();
  }
  function move(d) { sel = (sel + d + ROWS.length) % ROWS.length; menuSfx.hover(); }

  function layout(x, y, w) {
    return ROWS.map((row, i) => ({ row, i, x, y: y + i * ROW_H, w, h: ROW_H - 4 }));
  }

  return {
    reset() { t0.v = loop.realTime; sel = 0; },
    get index() { return sel; },

    frame(x, y, w) {
      const rows = layout(x, y, w);
      if (input.ui.pressed('up')) move(-1);
      if (input.ui.pressed('down')) move(1);
      if (input.ui.pressed('left')) nudge(ROWS[sel], -1);
      if (input.ui.pressed('right')) nudge(ROWS[sel], 1);
      if (input.ui.pressed('confirm') || input.ui.pressed('attack')) activate(sel);
      if (input.ui.pressed('cancel')) { menuSfx.back(); onBack?.(); }

      const m = input.mouse;
      if (!input.codeDown('Mouse0')) dragging = -1;
      if (m.inside && input.mouseActive()) {
        const r = display.uiCanvas.getBoundingClientRect();
        const mx = ((m.x - r.left) / r.width) * display.width, my = ((m.y - r.top) / r.height) * display.height;
        let h = -1;
        for (const b of rows) if (mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) h = b.i;
        if (h !== hoverIdx) { hoverIdx = h; if (h >= 0 && h !== sel) { sel = h; menuSfx.hover(); } }
        const clicked = input.ui.key('Mouse0');
        if (h >= 0 && ROWS[h].kind === 'slider') {
          const track = sliderTrack(rows[h]);
          if (clicked && mx >= track.x - 4 && mx < track.x + track.w + 4) dragging = h;
          if (dragging === h) {
            const v = clamp01((mx - track.x) / track.w);
            const id = ROWS[h].id;
            if (Math.abs(settings.get(id) - v) > 0.005) { settings.set(id, Math.round(v * 20) / 20); menuSfx.slider(); }
          } else if (clicked) activate(h);
        } else if (h >= 0 && clicked) activate(h);
      } else hoverIdx = -1;
    },

    ui(g, x, y, w, t) {
      const rows = layout(x, y, w);
      drawText(g, 'SETTINGS', x + w / 2, y - 22, 'gold', { align: 'center', scale: 2, outline: 'ink' });
      for (const b of rows) {
        const pop = clamp01((t - t0.v - b.i * 0.04) / 0.2);
        if (pop <= 0) continue;
        const oy = Math.round((1 - ease.out(pop)) * 10);
        const focused = b.i === sel;
        g.save(); g.globalAlpha = Math.round(pop * 4) / 4 || 0.25;
        const by = b.y + oy;
        const denied = b.row.id === 'reset' && flash.i === b.i && loop.realTime - flash.t < 0.4;
        drawPanel(g, b.x, by, b.w, b.h, { edge: focused ? 'gold' : 'shadow', fill: denied ? 'dusk' : focused ? 'dusk' : 'shadow' });
        drawText(g, b.row.label, b.x + 10, by + Math.round(b.h / 2) - 3, focused ? 'gold' : 'bone', { shadow: 'ink' });
        if (b.row.kind === 'slider') drawSlider(g, b, sliderTrack(b), focused);
        else if (b.row.kind === 'bool') {
          const on = settings.get(b.row.id);
          drawText(g, on ? 'ON' : 'OFF', b.x + b.w - 34, by + Math.round(b.h / 2) - 3, on ? 'leaf' : 'slate', { shadow: 'ink' });
        } else void 0;
        if (focused) drawFocusChevrons(g, b.x - 8, by + Math.round(b.h / 2), t, 2);
        g.restore();
      }
      const help = 'UP DOWN ROW   LEFT RIGHT ADJUST   ENTER TOGGLE   ESC BACK';
      const hw = textWidth(help);
      drawText(g, help, x + w / 2 - hw / 2, y + rows.length * ROW_H + 8, 'mist', { shadow: 'ink' });
      return rows.length * ROW_H + 20;
    },
  };
}

function sliderTrack(b) {
  const tw = b.w - 100;
  return { x: b.x + 90, y: b.y + Math.round(b.h / 2) - 3, w: tw };
}
function drawSlider(g, b, track, focused) {
  const v = settings.get(b.row.id);
  g.fillStyle = css('ink'); g.fillRect(track.x - 1, track.y - 1, track.w + 2, 8);
  g.fillStyle = css('night'); g.fillRect(track.x, track.y, track.w, 6);
  const fillW = Math.round(track.w * v);
  g.fillStyle = css(focused ? 'gold' : 'slate');
  for (let i = 0; i < NOTCHES; i++) {
    const nx = track.x + Math.round((i / NOTCHES) * track.w);
    const nw = Math.max(1, Math.round(track.w / NOTCHES) - 1);
    if (nx - track.x < fillW) g.fillRect(nx, track.y + 1, nw, 4);
  }
  const knobX = track.x + fillW;
  g.fillStyle = css('bone'); g.fillRect(knobX - 1, track.y - 2, 2, 10);
  drawText(g, `${Math.round(v * 100)}%`, track.x + track.w + 8, track.y - 1, focused ? 'torch' : 'fog');
}

/** Small always-on-top FPS readout, drawn from `main.js` when `settings.showFps` is on. */
export function drawFpsCorner(g) {
  if (!settings.get('showFps')) return;
  const text = `${Math.round(loop.fps)} FPS`;
  drawText(g, text, display.width - 6 - textWidth(text), 4, 'gold', { shadow: 'ink' });
}

export { ROWS as SETTINGS_ROWS, SETTING_DEFAULTS };
