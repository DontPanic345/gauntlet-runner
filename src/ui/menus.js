// Menu framework (piece `title`): pages of items navigated by keyboard, mouse and gamepad,
// with motion, sound and a clear focus state. The title screen, the pause menu and the
// settings / controls / credits pages are all built from it.
//
//   import { MenuStack, uiSound, drawPanel, ditherRect, wipe, drawPrompt } from './ui/menus.js';
//   const stack = new MenuStack({ onEmpty: () => ... });
//   stack.open({ id: 'main', style: 'title' | 'panel', title: 'SETTINGS', items: [...] });
//   frame(realDt): stack.frame(realDt)        ui(g): stack.draw(g)
//
// Item kinds:
//   { kind: 'action', label, onSelect(stack, item), hint, disabled }
//   { kind: 'slider', label, get() -> 0..1, set(v), steps: 10, demo(v) }   left/right, click, drag
//   { kind: 'choice', label, options: [{ value, label }], get(), set(v) }   left/right/confirm cycle
//   { kind: 'bind',   label, action }   rebinds the action's primary keyboard key (see settings.js)
//   { kind: 'gap' }                     vertical space, never focused
//
// Everything here animates in real time (loop.realTime / realDt), so it runs while the sim
// is paused. Colours are palette names only; fades are ordered dither, never alpha.

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { settings } from '../core/settings.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { sfx, SFX } from '../audio/bank.js';

// ---- UI sounds (registered into the audio bank, on the 'ui' bus) ---------------------------
// D minor pentatonic, in key with the title theme. Defined here so the title piece owns them;
// the bank renders them like any other sound (variants, jitter, warm-up after unlock).
const UI_SFX = {
  'ui.move': { group: 'UI', label: 'menu: move focus', bus: 'ui', gain: 1.6, pitch: 0.01, vol: 0.08, gap: 0.025, max: 3, layers: [
    { wave: 'square', f: 1174.66, duty: 0.25, d: 0.035, gain: 0.09, lpf: 5000 },
    { wave: 'tri', f: 587.33, d: 0.05, gain: 0.16 },
    { wave: 'noise', f: 4000, d: 0.008, gain: 0.05, hpf: 2000 },
  ] },
  'ui.select': { group: 'UI', label: 'menu: select', bus: 'ui', gain: 1.6, pitch: 0.008, vol: 0.06, gap: 0.04, layers: [
    { wave: 'tri', f: 587.33, d: 0.07, gain: 0.22 },
    { wave: 'square', f: 880, duty: 0.25, delay: 0.045, d: 0.14, gain: 0.08, lpf: 4200 },
    { wave: 'tri', f: 1174.66, delay: 0.045, d: 0.2, gain: 0.12, vib: 0.004, vibHz: 7 },
    { wave: 'noise', f: 5000, d: 0.012, gain: 0.08, hpf: 2500 },
  ] },
  'ui.back': { group: 'UI', label: 'menu: back', bus: 'ui', gain: 1.6, pitch: 0.008, vol: 0.06, gap: 0.04, layers: [
    { wave: 'tri', f: 880, d: 0.06, gain: 0.18 },
    { wave: 'square', f: 587.33, duty: 0.25, delay: 0.05, d: 0.12, gain: 0.07, lpf: 3000 },
    { wave: 'tri', f: 440, delay: 0.05, d: 0.16, gain: 0.12 },
  ] },
  'ui.tick': { group: 'UI', label: 'menu: slider tick', bus: 'ui', gain: 1.4, pitch: 0.005, vol: 0.05, gap: 0.02, max: 3, layers: [
    { wave: 'square', f: 1760, duty: 0.2, d: 0.018, gain: 0.08 },
    { wave: 'tri', f: 880, d: 0.04, gain: 0.14 },
  ] },
  'ui.deny': { group: 'UI', label: 'menu: blocked', bus: 'ui', gain: 1.6, pitch: 0.02, vol: 0.06, gap: 0.08, layers: [
    { wave: 'square', f: 146.83, duty: 0.5, d: 0.07, gain: 0.12, lpf: 900 },
    { wave: 'square', f: 138.59, duty: 0.5, delay: 0.07, d: 0.09, gain: 0.12, lpf: 900 },
  ] },
  'ui.open': { group: 'UI', label: 'pause: open', bus: 'ui', gain: 1.5, pitch: 0.005, vol: 0.05, layers: [
    { wave: 'tri', f: 293.66, a: 0.02, d: 0.28, gain: 0.2 },
    { wave: 'tri', f: 349.23, a: 0.02, delay: 0.03, d: 0.28, gain: 0.14 },
    { wave: 'square', f: 587.33, duty: 0.125, delay: 0.06, d: 0.2, gain: 0.04, lpf: 2400 },
    { wave: 'white', d: 0.12, a: 0.03, gain: 0.04, lpf: 1800, lpfSweep: -3 },
  ] },
  'ui.start': { group: 'UI', label: 'title: start run', bus: 'ui', gain: 1.5, pitch: 0.004, vol: 0.04, duck: [8, 0.9, 1.0], layers: [
    { wave: 'sine', f: 70, slide: -1.6, d: 0.9, gain: 0.6, drive: 0.4 },
    { wave: 'white', a: 0.08, d: 0.7, gain: 0.25, lpf: 500, lpfSweep: 2.5, res: 0.3, curve: 1.4 },
    { wave: 'tri', f: 293.66, delay: 0.02, s: 0.1, d: 0.7, gain: 0.18 },
    { wave: 'tri', f: 440, delay: 0.09, s: 0.1, d: 0.7, gain: 0.14 },
    { wave: 'tri', f: 587.33, delay: 0.16, s: 0.15, d: 0.9, gain: 0.14, vib: 0.005, vibHz: 5, vibDelay: 0.3 },
    { wave: 'square', f: 1174.66, duty: 0.125, delay: 0.16, d: 0.5, gain: 0.03, lpf: 3500 },
  ] },
  'ui.rumble': { group: 'UI', label: 'title: mountain tremor', bus: 'amb', gain: 1.2, pitch: 0.06, vol: 0.2, variants: 4, layers: [
    { wave: 'sine', f: 42, slide: -0.4, a: 0.15, s: 0.4, d: 1.1, gain: 0.45, drive: 0.6 },
    { wave: 'white', a: 0.2, s: 0.4, d: 1.0, gain: 0.18, lpf: 260 },
    { wave: 'noise', f: 1400, delay: 0.35, d: 0.04, gain: 0.08, repeat: 0.11, hpf: 500, lpf: 2600 },
  ] },
};
for (const k in UI_SFX) if (!SFX[k]) SFX[k] = UI_SFX[k];

const PENTA = [0, 3, 5, 7, 10, 12, 15];
/** Play a UI sound. step: climbs D minor pentatonic (menu position). */
export function uiSound(name, { step = null, rate = 1, gain = 1 } = {}) {
  const r = step === null ? rate : rate * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);
  return sfx.play(name, { rate: r, gain });
}

// ---- dither (palette-safe fades) ----------------------------------------------------------------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const patterns = new Map();
/** A 4x4 ordered-dither pattern of one palette colour, `level` 0..16 pixels lit out of 16. */
export function ditherPattern(g, color, level) {
  level = Math.max(0, Math.min(16, Math.round(level)));
  const key = color + level;
  let p = patterns.get(key);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const cg = c.getContext('2d');
  cg.fillStyle = color === '#fff' ? '#fff' : css(color);
  for (let i = 0; i < 16; i++) if (BAYER[i] < level) cg.fillRect(i % 4, (i / 4) | 0, 1, 1);
  p = g.createPattern(c, 'repeat');
  patterns.set(key, p);
  return p;
}
/** Fill a rect with a dithered palette colour (level 0..16). */
export function ditherRect(g, x, y, w, h, color, level) {
  if (level <= 0) return;
  g.fillStyle = level >= 16 ? css(color) : ditherPattern(g, color, level);
  g.fillRect(x, y, w, h);
}

let layerCanvas = null, layerG = null;
/** An offscreen layer the size of the UI canvas (cleared). Draw into it, then blitFaded(). */
export function layer() {
  if (!layerCanvas) { layerCanvas = document.createElement('canvas'); layerG = layerCanvas.getContext('2d'); }
  if (layerCanvas.width !== display.width || layerCanvas.height !== display.height) {
    layerCanvas.width = display.width; layerCanvas.height = display.height;
  }
  layerG.setTransform(1, 0, 0, 1, 0, 0);
  layerG.globalCompositeOperation = 'source-over';
  layerG.imageSmoothingEnabled = false;
  layerG.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  return layerG;
}
/** Draw the layer onto g, dither-dissolved to k (0..1), offset by dx, dy. */
export function blitLayer(g, k = 1, dx = 0, dy = 0) {
  if (k <= 0) return;
  if (k < 1) {
    layerG.globalCompositeOperation = 'destination-in';
    layerG.fillStyle = ditherPattern(layerG, '#fff', k * 16);
    layerG.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
    layerG.globalCompositeOperation = 'source-over';
  }
  g.drawImage(layerCanvas, Math.round(dx), Math.round(dy));
}

// ---- small helpers ---------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeBack = (t) => { t = clamp(t, 0, 1); const s = 1.7; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };

/** A critically damped-ish spring (real time). */
export class Spring {
  constructor(v = 0, k = 380, d = 26) { this.v = v; this.target = v; this.vel = 0; this.k = k; this.d = d; }
  step(dt) {
    dt = Math.min(dt, 1 / 30);
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      this.vel += (this.k * (this.target - this.v) - this.d * this.vel) * h;
      this.v += this.vel * h;
    }
    return this.v;
  }
  set(v) { this.v = this.target = v; this.vel = 0; }
}

/** Panel: a carved slab with an iron rim. Returns the inner content box. */
export function drawPanel(g, x, y, w, h, { title = null, accent = 'ember' } = {}) {
  x = Math.round(x); y = Math.round(y);
  g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, w + 2, h + 4);        // outline + drop
  g.fillStyle = css('night'); g.fillRect(x, y, w, h + 2);                  // underside (depth)
  g.fillStyle = css('shadow'); g.fillRect(x, y, w, h);
  ditherRect(g, x + 1, y + 1, w - 2, h - 2, 'night', 3);                   // stone grain
  g.fillStyle = css('violet'); g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);   // bevel light
  g.fillStyle = css('dusk'); g.fillRect(x + 1, y + 1, w - 2, 1);
  g.fillStyle = css('ink'); g.fillRect(x + w - 1, y + 1, 1, h - 1);
  // rivets
  for (const [rx, ry] of [[x + 3, y + 3], [x + w - 6, y + 3], [x + 3, y + h - 6], [x + w - 6, y + h - 6]]) {
    g.fillStyle = css('ink'); g.fillRect(rx, ry, 3, 3);
    g.fillStyle = css('slate'); g.fillRect(rx, ry, 2, 2);
    g.fillStyle = css('fog'); g.fillRect(rx, ry, 1, 1);
  }
  let cy = y + 8;
  if (title) {
    drawText(g, title, x + w / 2, y + 9, 'bone', { scale: 2, align: 'center', shadow: 'ink' });
    // ember rule under the header: a hot centre cooling to the edges
    const rw = Math.min(w - 40, textWidth(title, 2) + 40), rx = Math.round(x + (w - rw) / 2), ry = y + 28;
    g.fillStyle = css('ink'); g.fillRect(rx - 1, ry - 1, rw + 2, 4);
    g.fillStyle = css('blood'); g.fillRect(rx, ry, rw, 2);
    g.fillStyle = css(accent); g.fillRect(rx + Math.round(rw * 0.2), ry, Math.round(rw * 0.6), 2);
    g.fillStyle = css('flame'); g.fillRect(rx + Math.round(rw * 0.38), ry, Math.round(rw * 0.24), 1);
    // diamond studs at the ends of the rule
    for (const sx of [rx - 4, rx + rw + 2]) { g.fillStyle = css('ink'); g.fillRect(sx, ry - 1, 3, 4); g.fillStyle = css('gold'); g.fillRect(sx + 1, ry, 1, 2); }
    cy = y + 38;
  }
  return { x: x + 10, y: cy, w: w - 20, h: h - (cy - y) - 8 };
}

// ---- key display -----------------------------------------------------------------------------------
/** Which prompt glyphs to show: the `keyDisplay` setting, or the last device used. */
export function promptDevice() {
  const pref = settings.get('keyDisplay') ?? 'auto';
  if (pref === 'keyboard' || pref === 'gamepad') return pref;
  return input.device === 'gamepad' ? 'gamepad' : 'keyboard';
}

const PAD_FACE = { Pad0: ['A', 'leaf'], Pad1: ['B', 'red'], Pad2: ['X', 'blue'], Pad3: ['Y', 'gold'] };
const PAD_LABEL = { Pad4: 'LB', Pad5: 'RB', Pad6: 'LT', Pad7: 'RT', Pad8: 'SEL', Pad9: 'START', Pad12: '↑', Pad13: '↓', Pad14: '←', Pad15: '→' };
function keyLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'ESC', Enter: 'ENTER', NumpadEnter: 'ENTER',
    Space: 'SPACE', Backspace: 'BKSP', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL',
    AltLeft: 'ALT', AltRight: 'ALT', Tab: 'TAB', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\' };
  if (map[code]) return map[code];
  if (code.startsWith('Numpad')) return 'NUM' + code.slice(6);
  return code.toUpperCase().slice(0, 6);
}

/**
 * Draw one input glyph: a keyboard key cap, a mouse button or a gamepad button. The cap sinks
 * one pixel while that code is held. Returns the drawn width.
 */
export function drawKey(g, code, x, y) {
  x = Math.round(x); y = Math.round(y);
  const down = input.codeDown(code) ? 1 : 0;
  if (PAD_FACE[code]) {
    const [l, col] = PAD_FACE[code];
    const w = 11;
    g.fillStyle = css('ink'); g.fillRect(x + 2, y - 1, 7, 13); g.fillRect(x, y + 1, 11, 9); g.fillRect(x + 1, y, 9, 11);
    g.fillStyle = css('night'); g.fillRect(x + 2, y + 9, 7, 2);
    g.fillStyle = css(col); g.fillRect(x + 2, y + down, 7, 9); g.fillRect(x + 1, y + 1 + down, 9, 7);
    drawText(g, l, x + 6, y + 1 + down, 'ink', { align: 'center' });
    return w;
  }
  if (code.startsWith('Mouse')) {
    const w = 9, b = code === 'Mouse0' ? 0 : code === 'Mouse2' ? 1 : 2;
    g.fillStyle = css('ink'); g.fillRect(x, y - 1, w, 13);
    g.fillStyle = css('frost'); g.fillRect(x + 1, y, w - 2, 11);
    g.fillStyle = css('ink'); g.fillRect(x + 1, y + 4, w - 2, 1); g.fillRect(x + 4, y, 1, 4);
    g.fillStyle = css(down ? 'gold' : 'ember');
    if (b === 0) g.fillRect(x + 1, y, 3, 4); else if (b === 1) g.fillRect(x + 5, y, 3, 4); else g.fillRect(x + 4, y, 1, 4);
    return w;
  }
  const label = code.startsWith('Pad') ? (PAD_LABEL[code] ?? code.slice(3)) : keyLabel(code);
  const tw = textWidth(label);
  const w = Math.max(11, tw + 6);
  g.fillStyle = css('ink'); g.fillRect(x, y - 1, w, 14);
  g.fillStyle = css('night'); g.fillRect(x + 1, y + 9, w - 2, 3);                 // key side
  g.fillStyle = css(down ? 'slate' : 'dusk'); g.fillRect(x + 1, y + down, w - 2, 10);
  g.fillStyle = css(down ? 'mist' : 'violet'); g.fillRect(x + 1, y + down, w - 2, 1);   // top light
  drawText(g, label, x + Math.round((w - tw) / 2), y + 2 + down, down ? 'white' : 'bone');
  return w;
}

/** Width in pixels of drawKey(code). */
export function keyWidth(code) {
  if (PAD_FACE[code]) return 11;
  if (code.startsWith('Mouse')) return 9;
  return Math.max(11, textWidth(code.startsWith('Pad') ? (PAD_LABEL[code] ?? code.slice(3)) : keyLabel(code)) + 6);
}

// Pseudo-actions for prompts that show a pair of directions.
const PAIRS = { adjust: [['left', 'right'], 'ArrowLeft', 'ArrowRight', 'Pad14', 'Pad15'], choose: [['up', 'down'], 'ArrowUp', 'ArrowDown', 'Pad12', 'Pad13'] };

/** The codes to show for an action on a device ('adjust' / 'choose' give a direction pair). */
export function codesFor(action, device = promptDevice()) {
  if (PAIRS[action]) {
    const [, k1, k2, p1, p2] = PAIRS[action];
    return device === 'gamepad' ? [p1, p2] : [k1, k2];
  }
  const all = input.bindings[action] || [];
  if (device === 'gamepad') {
    const pads = all.filter((c) => /^Pad\d+$/.test(c));
    return pads.length ? [pads[0]] : [];
  }
  const keys = all.filter((c) => !c.startsWith('Pad') && !c.startsWith('Mouse'));
  return keys.slice(0, 1);
}

/** "[KEY] LABEL" prompt. Returns its width. */
export function drawPrompt(g, action, label, x, y, color = 'fog', device = promptDevice()) {
  let cx = x;
  const codes = codesFor(action, device);
  for (const c of codes) cx += drawKey(g, c, cx, y) + 3;
  return cx - x + drawText(g, label, cx + 2, y + 2, color, { shadow: 'ink' }) + 2;
}
export function promptWidth(action, label, device = promptDevice()) {
  let w = 0;
  for (const c of codesFor(action, device)) w += keyWidth(c) + 3;
  return w + textWidth(label) + 4;
}

// ---- 2D ember sparks (UI juice) --------------------------------------------------------------------
export class Sparks {
  constructor(max = 160) { this.p = []; this.max = max; }
  burst(x, y, n = 8, { spread = 40, up = 30, cols = ['torch', 'gold', 'flame', 'ember', 'blood'], life = 0.5, grav = 60 } = {}) {
    for (let i = 0; i < n && this.p.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.4 + Math.random() * 0.6);
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - up * Math.random(), t: 0, life: life * (0.6 + Math.random() * 0.6), cols, grav });
    }
  }
  emit(x, y, { vx = 0, vy = -12, life = 1.4, cols = ['gold', 'flame', 'ember', 'blood'], grav = -6, wob = 6 } = {}) {
    if (this.p.length >= this.max) return;
    this.p.push({ x, y, vx, vy, t: 0, life, cols, grav, wob, ph: Math.random() * 6.28 });
  }
  step(dt) {
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.t += dt;
      if (q.t >= q.life) { this.p.splice(i, 1); continue; }
      q.vy += q.grav * dt;
      q.x += (q.vx + (q.wob ? Math.sin(q.t * 5 + q.ph) * q.wob : 0)) * dt;
      q.y += q.vy * dt;
    }
  }
  draw(g) {
    for (const q of this.p) {
      const k = q.t / q.life;
      const col = q.cols[Math.min(q.cols.length - 1, Math.floor(k * q.cols.length))];
      g.fillStyle = css(col);
      const s = k < 0.25 && q.life < 1 ? 2 : 1;
      g.fillRect(Math.round(q.x), Math.round(q.y), s, s);
    }
  }
}

// ---- the focus cursor: a small voxel-ish flame, 3 frames --------------------------------------------
const FLAME = [
  ['..t..', '..g..', '.gf..', '.ffg.', 'fefgf', 'eeffe', '.eee.'],
  ['...t.', '..gg.', '.gf..', '.fgf.', 'feffe', 'eeffe', '.eee.'],
  ['.t...', '.gg..', '..fg.', '.ffg.', 'ffgfe', 'effee', '.eee.'],
];
const FLAME_COL = { t: 'torch', g: 'gold', f: 'flame', e: 'ember' };
export function drawFlame(g, x, y, frame = 0, sx = 1) {
  const rows = FLAME[frame % 3];
  g.fillStyle = css('ink');
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 5; c++) if (rows[r][c] !== '.') {
    const px = sx < 0 ? 4 - c : c;
    g.fillRect(x + px - 1, y + r, 3, 1); g.fillRect(x + px, y + r - 1, 1, 3);
  }
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 5; c++) {
    const ch = rows[r][c];
    if (ch === '.') continue;
    g.fillStyle = css(FLAME_COL[ch]);
    g.fillRect(x + (sx < 0 ? 4 - c : c), y + r, 1, 1);
  }
}

// ---- menu stack ------------------------------------------------------------------------------------------
const REPEAT_DELAY = 0.34, REPEAT_EVERY = 0.075;

/** Internal-pixel mouse position (the canvases sit at the page origin, scaled by display.scale). */
function mousePx() {
  const r = display.uiCanvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: (input.mouse.x - r.left) / display.scale, y: (input.mouse.y - r.top) / display.scale };
}
const hit = (r, p) => r && p.x >= r[0] && p.x < r[0] + r[2] && p.y >= r[1] && p.y < r[1] + r[3];

export class MenuStack {
  /**
   * opts.onEmpty(): called when the root page is backed out of (return to the caller).
   * opts.sparks: a shared Sparks (else its own).
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.pages = [];
    this.sparks = opts.sparks ?? new Sparks();
    this.t = 0;
    this.hold = { up: 0, down: 0, left: 0, right: 0 };
    this.lastMouse = input.mouse.lastMove;
    this.swallow = 0;          // frames of input to ignore (after a rebind capture)
    this.listen = null;        // { item, off } while capturing a key
    this.out = null;           // { page, t0, dir } the page sliding away
    this.enabled = true;
    this.plaqueY = new Spring(0, 520, 34);
    this.plaqueW = new Spring(60, 420, 30);
    this.flash = 0;            // select flash (s)
    this.cursorSquash = 0;
    this.dragging = null;
    this.events = [];          // [{type, page, item}] since the last frame (for showcases / tests)
  }

  get page() { return this.pages[this.pages.length - 1] ?? null; }
  get focusItem() { const p = this.page; return p ? p.items[p.focus] : null; }

  /** Push a page (slides in). */
  open(page, { silent = false } = {}) {
    if (this.page) this.out = { page: this.page, t0: this.t, dir: -1 };
    page.items.forEach((it) => { it._off = it._off ?? new Spring(0, 600, 30); it._hop = 0; it._pop = it._pop ?? {}; });
    if (page.focus === undefined || !this.focusable(page.items[page.focus])) page.focus = page.items.findIndex((it) => this.focusable(it));
    page.t0 = this.t;
    page._frames = 1;   // pages opened from a menu press take input from the next frame on
    this.pages.push(page);
    this.snapPlaque = true;
    page.onOpen?.(this);
    if (!silent && this.pages.length > 1) uiSound('ui.select');
    return page;
  }
  /** Pop the current page (slides out). At the root, calls opts.onEmpty. */
  back({ silent = false } = {}) {
    const p = this.page;
    if (!p) return;
    if (p.onBack && p.onBack(this) === true) return;
    if (this.pages.length === 1) { this.opts.onEmpty?.(this); return; }
    this.pages.pop();
    this.out = { page: p, t0: this.t, dir: 1 };
    this.page.t0 = this.t;
    this.snapPlaque = true;
    if (!silent) uiSound('ui.back');
    this.emit('back', p);
  }
  /** Replace the whole stack with one page (no slide). */
  reset(page) {
    this.pages = []; this.out = null;
    this.open(page, { silent: true });
    page._frames = 0;   // a stack built mid-frame (pause opened by Esc) skips that frame's presses
  }

  focusable(it) { return !!it && it.kind !== 'gap' && it.kind !== 'label'; }
  emit(type, page, item = null) { this.events.push({ type, page: page?.id, item: item?.id ?? item?.label ?? null }); if (this.events.length > 32) this.events.shift(); }

  setFocus(i, { sound = true, dir = 1 } = {}) {
    const p = this.page;
    if (!p || i === p.focus) return;
    p.items[p.focus]?._off && (p.items[p.focus]._off.target = 0);
    p.focus = i;
    const it = p.items[i];
    it._off.v = -2 * dir * 0; it._off.vel = 160; it._off.target = 5;
    this.cursorSquash = 1;
    if (sound) uiSound('ui.move', { step: Math.min(6, i) });
    this.emit('focus', p, it);
  }
  move(dir) {
    const p = this.page;
    const n = p.items.length;
    let i = p.focus;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (this.focusable(p.items[i])) break;
    }
    this.setFocus(i, { dir });
  }

  /** Run one rendered frame of input and animation. */
  frame(dt) {
    this.t += dt;
    this.sparks.step(dt);
    this.flash = Math.max(0, this.flash - dt);
    this.cursorSquash = Math.max(0, this.cursorSquash - dt * 6);
    const p = this.page;
    if (p) for (const it of p.items) { it._off?.step(dt); it._hop = Math.max(0, (it._hop ?? 0) - dt * 8); for (const k in it._pop) it._pop[k] = Math.max(0, it._pop[k] - dt * 5); }
    this.plaqueY.step(dt); this.plaqueW.step(dt);
    if (this.swallow > 0) { this.swallow--; return; }
    if (this.listen) {
      // waiting for a key: a pad B / Start or a mouse click gives up (a pad cannot type a key)
      const U = input.ui;
      if (U.key('Pad1') || U.key('Pad9') || U.key('Mouse0') || U.key('Mouse2')) { this.listen.off(); this.listen = null; uiSound('ui.back'); }
      return;
    }
    if (!p || !this.enabled) return;
    if (p._frames++ < 1) return;          // ignore the press that opened the page

    const U = input.ui;
    const click = U.key('Mouse0'), rclick = U.key('Mouse2');
    const ok = U.pressed('confirm') || (U.pressed('attack') && !click) || U.pressed('interact') || (U.key('Space'));
    const back = U.pressed('cancel') || (U.pressed('pause') && !U.pressed('cancel')) || rclick;
    const rep = (a) => {
      if (U.pressed(a)) { this.hold[a] = 0; return true; }
      if (!input.held(a)) { this.hold[a] = 0; return false; }
      const before = this.hold[a];
      this.hold[a] += dt;
      if (this.hold[a] < REPEAT_DELAY) return false;
      return Math.floor((this.hold[a] - REPEAT_DELAY) / REPEAT_EVERY) > Math.floor(Math.max(0, before - REPEAT_DELAY) / REPEAT_EVERY) || before < REPEAT_DELAY;
    };

    // mouse: hover focuses (only when the mouse actually moved), click activates, drag slides
    const m = mousePx();
    const moved = input.mouse.lastMove !== this.lastMouse;
    this.lastMouse = input.mouse.lastMove;
    if (moved && input.mouse.inside) {
      const i = p.items.findIndex((it) => this.focusable(it) && !it.disabled && hit(it._rect, m));
      if (i >= 0 && i !== p.focus) this.setFocus(i);
    }
    if (this.dragging && input.codeDown('Mouse0')) this.slideTo(this.dragging, m.x);
    else this.dragging = null;
    if (click) {
      const i = p.items.findIndex((it) => this.focusable(it) && hit(it._rect, m));
      if (i >= 0) {
        if (i !== p.focus) this.setFocus(i, { sound: false });
        const it = p.items[i];
        if (it.kind === 'slider' && hit(it._bar, m)) { this.dragging = it; this.slideTo(it, m.x); }
        else if (it.kind === 'choice' && it._arrows) {
          const dir = m.x < it._arrows[0] ? -1 : 1;
          this.adjust(it, dir);
        } else this.activate(it);
        return;
      }
      if (p.backRect && hit(p.backRect, m)) { this.back(); return; }
    }

    if (back) { this.back(); return; }
    // every press counts, even two in one slow frame (input.ui.count)
    const nUp = Math.max(U.count?.('up') ?? 0, rep('up') ? 1 : 0), nDown = Math.max(U.count?.('down') ?? 0, rep('down') ? 1 : 0);
    for (let k = 0; k < nUp; k++) this.move(-1);
    for (let k = 0; k < nDown; k++) this.move(1);
    const it = p.items[p.focus];
    if (!it) return;
    if (rep('left')) this.adjust(it, -1);
    else if (rep('right')) this.adjust(it, 1);
    if (ok) this.activate(it);
  }

  slideTo(it, mx) {
    const [bx, , bw] = it._bar;
    const steps = it.steps ?? 10;
    const v = Math.round(clamp((mx - bx) / bw, 0, 1) * steps) / steps;
    if (Math.abs(v - it.get()) > 1e-6) this.setValue(it, v);
  }
  setValue(it, v) {
    const old = it.get();
    it.set(v);
    const steps = it.steps ?? 10;
    const pip = Math.round(v * steps);
    it._pop[pip] = 1;
    it._off.vel += (v > old ? 90 : -90);
    uiSound('ui.tick', { rate: 0.7 + v * 0.8 });
    it.demo?.(v, old);
    this.emit('change', this.page, it);
  }
  adjust(it, dir) {
    if (it.disabled) return;
    if (it.kind === 'slider') {
      const steps = it.steps ?? 10;
      const v = clamp(Math.round(it.get() * steps + dir) / steps, 0, 1);
      if (Math.abs(v - it.get()) < 1e-6) { uiSound('ui.deny'); it._nudge = dir * 3; return; }
      it._arrowKick = dir;
      it._arrowT = this.t;
      this.setValue(it, v);
    } else if (it.kind === 'choice') {
      const opts = it.options;
      const i = opts.findIndex((o) => o.value === it.get());
      const n = opts[(i + dir + opts.length) % opts.length];
      it.set(n.value);
      it._arrowKick = dir; it._arrowT = this.t;
      it._off.vel += dir * 120;
      uiSound('ui.tick', { rate: 1 + 0.1 * dir });
      it.demo?.(n.value);
      this.emit('change', this.page, it);
    }
  }
  activate(it) {
    if (it.disabled) { uiSound('ui.deny'); it._off.vel -= 200; this.emit('deny', this.page, it); return; }
    if (it.kind === 'choice') { this.adjust(it, 1); return; }
    if (it.kind === 'slider') { this.adjust(it, it.get() >= 1 ? -1 : 1); return; }
    this.flash = 0.12;
    it._hop = 1;
    const r = it._rect;
    if (r) this.sparks.burst(r[0] + 2, r[1] + r[3] / 2, 10, { spread: 44, up: 20, life: 0.45 });
    this.emit('select', this.page, it);
    if (it.kind === 'bind') { this.opts.onBind?.(this, it); return; }
    if (!it.silent) uiSound('ui.select');
    it.onSelect?.(this, it);
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  /** Draw the stack: the outgoing page sliding away, the current page sliding in. */
  draw(g) {
    const W = display.width, H = display.height;
    if (this.out) {
      const k = (this.t - this.out.t0) / 0.16;
      if (k >= 1) this.out = null;
      else {
        const L = layer();
        this.drawPage(L, this.out.page, false);
        blitLayer(g, 1 - k, this.out.dir * -1 * easeOut(k) * 26 * (this.out.dir > 0 ? -1 : 1), 0);
      }
    }
    const p = this.page;
    if (!p) return;
    const k = (this.t - p.t0) / 0.2;
    if (k < 1 && this.pages.length > 0 && !p.noSlide) {
      const L = layer();
      this.drawPage(L, p, true);
      blitLayer(g, easeOut(k * 1.4), (1 - easeOut(k)) * 22 * (this.out?.dir === 1 ? -1 : 1), 0);
    } else this.drawPage(g, p, true);
    this.sparks.draw(g);
    if (p.footer !== false) this.drawFooter(g, p, W, H);
  }

  drawFooter(g, p, W, H) {
    const it = p.items[p.focus];
    const parts = [];
    if (this.listen) parts.push(['cancel', 'CANCEL']);
    else {
      parts.push(['choose', 'CHOOSE']);
      if (it?.kind === 'slider' || it?.kind === 'choice') parts.push(['adjust', 'ADJUST']);
      if (it?.kind === 'bind') parts.push(['confirm', 'REBIND']);
      else if (it && it.kind !== 'slider') parts.push(['confirm', 'SELECT']);
      if (this.pages.length > 1 || p.backLabel) parts.push(['cancel', p.backLabel ?? 'BACK']);
    }
    const dev = promptDevice();
    let w = 0;
    for (const [a, l] of parts) w += promptWidth(a, l, dev) + 12;
    w -= 12;
    const y = p.footerY ?? H - 18;
    let x = p.footerAlign === 'left' ? 14 : Math.round(W - 14 - w);
    for (const [a, l] of parts) x += drawPrompt(g, a, l, x, y, 'fog', dev) + 12;
  }

  drawPage(g, p, live) {
    if (p.style === 'title') return this.drawTitlePage(g, p, live);
    return this.drawPanelPage(g, p, live);
  }

  /** The title screen's main list: no panel, big text over the scene, a sliding ember plaque. */
  drawTitlePage(g, p, live) {
    const H = display.height;
    const lh = 21;
    const n = p.items.length;
    const x0 = p.x ?? 30;
    const y0 = p.y ?? Math.round(H - 34 - n * lh);
    const appear = (this.t - (p.t0 ?? 0));
    p.items.forEach((it, i) => { it._rect = [x0 - 6, y0 + i * lh - 4, Math.max(120, textWidth(it.label, 2) + 34), lh - 2]; });
    const f = p.items[p.focus];
    if (f && live) {
      if (this.snapPlaque) { this.plaqueY.set(f._rect[1]); this.plaqueW.set(f._rect[2]); this.snapPlaque = false; }
      this.plaqueY.target = f._rect[1];
      this.plaqueW.target = textWidth(f.label, 2) + 40;
      const py = Math.round(this.plaqueY.v), pw = Math.round(this.plaqueW.v);
      const px = x0 - 8;
      // plaque: an ink slab with a hot left edge and a cooling ember underline
      g.fillStyle = css('ink'); g.fillRect(px, py, pw, lh - 3);
      ditherRect(g, px + pw, py, 10, lh - 3, 'ink', 8);
      ditherRect(g, px + pw + 10, py, 8, lh - 3, 'ink', 3);
      g.fillStyle = css(this.flash > 0 ? 'white' : 'ember'); g.fillRect(px, py, 2, lh - 3);
      g.fillStyle = css(this.flash > 0 ? 'torch' : 'blood'); g.fillRect(px + 2, py + lh - 4, pw - 2, 1);
      g.fillStyle = css(this.flash > 0 ? 'torch' : 'ember'); g.fillRect(px + 2, py + lh - 4, Math.round((pw - 2) * 0.55), 1);
      const fr = Math.floor(this.t * 9) % 3;
      const sq = this.cursorSquash;
      drawFlame(g, px + 6, py + 4 - Math.round(sq * 2) + (Math.sin(this.t * 4) > 0.6 ? -1 : 0), fr);
      if (Math.random() < 0.08) this.sparks.emit(px + 8, py + 3, { vx: (Math.random() - 0.5) * 6, vy: -14 - Math.random() * 10, life: 0.9 });
    }
    p.items.forEach((it, i) => {
      const foc = live && i === p.focus;
      const enter = easeBack((appear - 0.05 * i) / 0.32);
      const dx = Math.round((1 - enter) * -60 + (it._off?.v ?? 0) + (foc ? 14 : 0));
      const dy = (it._hop > 0.5 ? 1 : 0);
      if (enter <= 0) return;
      const y = y0 + i * lh + dy;
      const col = it.disabled ? 'slate' : foc ? (this.flash > 0 ? 'white' : 'torch') : 'fog';
      drawText(g, it.label, x0 + dx, y, col, { scale: 2, shadow: foc ? 'blood' : 'ink' });
      if (foc && it.hint) drawText(g, it.hint, x0 + dx + textWidth(it.label, 2) + 10, y + 4, 'mist', { shadow: 'ink' });
    });
  }

  /** A settings-style page: a carved panel with a header and label / value rows. */
  drawPanelPage(g, p, live) {
    const W = display.width, H = display.height;
    const rows = p.items;
    const lh = p.lineH ?? 18;
    const pw = Math.min(W - 24, p.w ?? 340);
    const ph = 46 + (p.extraTopH ?? 0) + rows.reduce((s, it) => s + (it.kind === 'gap' ? 6 : lh), 0) + (p.extraH ?? 0) + 10;
    const px = Math.round(p.x ?? (W - pw) / 2), py = Math.round(p.y ?? Math.max(8, (H - ph) / 2 - 6));
    const box = drawPanel(g, px, py, pw, ph, { title: p.title });
    let y = box.y;
    p.extraTop?.(g, box, this);
    y += p.extraTopH ?? 0;
    rows.forEach((it, i) => {
      if (it.kind === 'gap') { y += 6; return; }
      const foc = live && i === p.focus;
      it._rect = [box.x - 4, y - 3, box.w + 8, lh - 2];
      const off = Math.round(it._off?.v ?? 0) + (it._nudge ? Math.round(it._nudge) : 0);
      if (it._nudge) it._nudge = Math.abs(it._nudge) < 0.5 ? 0 : -it._nudge * 0.6;
      if (foc) {
        // focus bar: ink slab, ember edge, flame cursor
        g.fillStyle = css('ink'); g.fillRect(box.x - 4, y - 3, box.w + 8, lh - 2);
        g.fillStyle = css(this.flash > 0 ? 'white' : 'ember'); g.fillRect(box.x - 4, y - 3, 2, lh - 2);
        g.fillStyle = css('blood'); g.fillRect(box.x - 2, y + lh - 6, box.w + 6, 1);
        drawFlame(g, box.x + 1, y - 1 - Math.round(this.cursorSquash * 2), Math.floor(this.t * 9) % 3);
      }
      const lx = box.x + 10 + off + (foc ? 3 : 0);
      const ty = y + 1 + (it._hop > 0.5 ? 1 : 0);
      const lc = it.disabled ? 'slate' : foc ? 'torch' : 'frost';
      if (it.kind === 'label') { drawText(g, it.label, box.x + box.w / 2, ty, it.color ?? 'mist', { align: 'center' }); y += lh; return; }
      drawText(g, it.label, lx, ty, lc, { shadow: 'ink' });
      const rx = box.x + box.w - 4;
      if (it.kind === 'slider') this.drawSlider(g, it, rx, y, foc);
      else if (it.kind === 'choice') this.drawChoice(g, it, rx, y, foc);
      else if (it.kind === 'bind') this.drawBind(g, it, rx, y, foc);
      else if (it.value) drawText(g, it.value(), rx, ty, foc ? 'gold' : 'mist', { align: 'right', shadow: 'ink' });
      y += lh;
    });
    p.extraBottom?.(g, { x: box.x, y, w: box.w }, this);
  }

  drawSlider(g, it, rx, y, foc) {
    const steps = it.steps ?? 10;
    const v = it.get();
    const n = Math.round(v * steps);
    const pct = `${Math.round(v * 100)}%`;
    drawText(g, pct, rx, y + 1, foc ? 'gold' : 'mist', { align: 'right', shadow: 'ink' });
    const pipW = 6, gap = 2, bw = steps * (pipW + gap) - gap;
    const bx = Math.round(rx - 38 - bw);
    it._bar = [bx - 4, y - 3, bw + 8, 14];
    const kick = it._arrowT !== undefined && this.t - it._arrowT < 0.12 ? it._arrowKick : 0;
    if (foc) {
      drawText(g, '<', bx - 9 + (kick < 0 ? -2 : 0), y + 1, n > 0 ? 'gold' : 'slate');
      drawText(g, '>', bx + bw + 4 + (kick > 0 ? 2 : 0), y + 1, n < steps ? 'gold' : 'slate');
    }
    for (let i = 0; i < steps; i++) {
      const x = bx + i * (pipW + gap);
      const on = i < n;
      const pop = it._pop[i + 1] ?? 0;
      const h = 9 + (pop > 0.3 ? 2 : 0);
      const top = y + 7 - h + 1 + 1;
      g.fillStyle = css('ink'); g.fillRect(x - 1, top - 1, pipW + 2, h + 2);
      if (on) {
        // a warm ramp: low pips burn deep, high pips burn bright
        const c = pop > 0.6 ? 'white' : i < steps * 0.4 ? 'ember' : i < steps * 0.8 ? 'flame' : 'gold';
        g.fillStyle = css(c); g.fillRect(x, top, pipW, h);
        g.fillStyle = css(pop > 0.6 ? 'white' : 'torch'); g.fillRect(x, top, pipW, 1);
        g.fillStyle = css('blood'); g.fillRect(x, top + h - 1, pipW, 1);
      } else {
        g.fillStyle = css('night'); g.fillRect(x, top, pipW, h);
        g.fillStyle = css('dusk'); g.fillRect(x, top + h - 1, pipW, 1);
      }
    }
  }

  drawChoice(g, it, rx, y, foc) {
    const o = it.options.find((q) => q.value === it.get()) ?? it.options[0];
    const kick = it._arrowT !== undefined && this.t - it._arrowT < 0.12 ? it._arrowKick : 0;
    const tw = textWidth(o.label);
    const boxW = Math.max(it.minW ?? 70, tw + 10);
    const bx = rx - boxW - 8;
    drawText(g, o.label, bx + boxW / 2, y + 1, foc ? 'gold' : 'mist', { align: 'center', shadow: 'ink' });
    if (foc || it.alwaysArrows) {
      drawText(g, '<', bx - 4 + (kick < 0 ? -2 : 0), y + 1, foc ? 'gold' : 'slate');
      drawText(g, '>', bx + boxW + 1 + (kick > 0 ? 2 : 0), y + 1, foc ? 'gold' : 'slate');
    }
    it._arrows = [bx + boxW / 2];
  }

  drawBind(g, it, rx, y, foc) {
    const listening = this.listen?.item === it;
    const keys = (input.bindings[it.action] || []).filter((c) => !c.startsWith('Pad'));
    const pads = (input.bindings[it.action] || []).filter((c) => /^Pad\d+$/.test(c));
    // gamepad column (fixed, display only), right edge
    let x = rx;
    if (pads[0]) { x -= keyWidth(pads[0]); drawKey(g, pads[0], x, y - 2); }
    x = rx - (it.padCol ?? 40);
    // keyboard + mouse column, right-aligned before the pad column
    if (listening) {
      const blink = Math.floor(this.t * 4) % 2 === 0;
      drawText(g, 'PRESS A KEY', x, y + 1, blink ? 'gold' : 'ember', { align: 'right', shadow: 'ink' });
      return;
    }
    const list = keys.slice(0, 3);
    let w = 0;
    for (const c of list) w += keyWidth(c) + 3;
    let cx = x - w;
    for (const c of list) cx += drawKey(g, c, cx, y - 2) + 3;
    if (it._flashBind && this.t - it._flashBind < 0.3) {
      g.fillStyle = css('gold'); g.fillRect(x - w - 2, y + 11, w, 1);
    }
  }
}

// ---- screen wipe (scene transitions) ---------------------------------------------------------------------
// A dithered iris: closes to ink around a point, then (optionally) opens on the next scene.
// main.js draws it after the scene UI, so it survives a scene change.
//   wipe.close(cx, cy, seconds, onDone)    wipe.open(seconds)    wipe.active
let wipeState = null;   // { mode: 'close'|'open', t, dur, cx, cy, done, fired }
let wipeImg = null, wipeBuf = null;
export const wipe = {
  get active() { return !!wipeState; },
  get state() { return wipeState ? { mode: wipeState.mode, k: +(Math.min(1, wipeState.t / wipeState.dur)).toFixed(3) } : null; },
  close(cx, cy, dur = 0.6, done = null) { wipeState = { mode: 'close', t: 0, dur, cx, cy, done, fired: false }; },
  open(dur = 0.5, cx = null, cy = null) { wipeState = { mode: 'open', t: 0, dur, cx: cx ?? display.width / 2, cy: cy ?? display.height / 2, done: null, fired: false }; },
  cancel() { wipeState = null; },
  /** Advance and draw. Called once per rendered frame by main.js (after scenes.ui). */
  draw(g, realDt = 1 / 60) {
    const s = wipeState;
    if (!s) return;
    s.t += Math.min(realDt, 0.05);
    const k = Math.min(1, s.t / s.dur);
    const W = display.width, H = display.height;
    const R = Math.hypot(Math.max(s.cx, W - s.cx), Math.max(s.cy, H - s.cy)) + 12;
    // radius of the clear circle
    const e = s.mode === 'close' ? 1 - easeOut(k) ** 0.9 : easeOut(k);
    const r = e * R;
    if (!wipeImg || wipeImg.width !== W || wipeImg.height !== H) { wipeImg = g.createImageData(W, H); wipeBuf = new Uint32Array(wipeImg.data.buffer); }
    const ink = 0xff120a0b; // palette 'ink' #0b0a12 as little-endian ABGR
    const band = 14;
    for (let y = 0; y < H; y++) {
      const dy = y - s.cy;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - s.cx, dy) - r;
        let on;
        if (d <= 0) on = false;
        else if (d >= band) on = true;
        else on = BAYER[(y & 3) * 4 + (x & 3)] < (d / band) * 16;
        wipeBuf[row + x] = on ? ink : 0;
      }
    }
    // composite: draw onto a scratch canvas, then over the frame
    const c = wipe._c ?? (wipe._c = document.createElement('canvas'));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.getContext('2d').putImageData(wipeImg, 0, 0);
    g.drawImage(c, 0, 0);
    if (k >= 1) {
      if (s.mode === 'close') {
        g.fillStyle = css('ink'); g.fillRect(0, 0, W, H);
        if (!s.fired) { s.fired = true; const fn = s.done; s.done = null; fn?.(); }
        // hold black until someone opens (or the hold times out)
        if (s.t > s.dur + 1.5) wipeState = null;
      } else wipeState = null;
    }
  },
};
