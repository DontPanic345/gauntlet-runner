// The 2D half of the vfx system: things that read better drawn on the UI canvas on the pixel
// grid than as voxels. Impact stars, slash smears, dithered light glows and twinkle sprites.
// All integer coordinates, palette colours, no anti-aliasing. Fixed pool, no allocation per frame.
// They are tick-driven, so they hold still through hitstop and pause with the rest of the sim.

import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { css } from '../render/palette.js';
import { settings } from '../core/settings.js';

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);
export const STAR = 0, SMEAR = 1, GLOW = 2, TWINKLE = 3, RING = 4;
const CAP = 160;

const pool = Array.from({ length: CAP }, () => ({ on: false, kind: 0, t: 0, max: 1, x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, d: 0, e: 0, col: 'white', dx: 0, dy: 0 }));
let cursor = 0;

export function addMark(kind, x, y, z, max, o = {}) {
  let m = null;
  for (let k = 0; k < CAP; k++) { const q = pool[(cursor + k) % CAP]; if (!q.on) { m = q; cursor = (cursor + k + 1) % CAP; break; } }
  if (!m) { m = pool[cursor]; cursor = (cursor + 1) % CAP; }
  m.on = true; m.kind = kind; m.t = 0; m.max = max; m.x = x; m.y = y; m.z = z;
  m.a = o.a ?? 0; m.b = o.b ?? 0; m.c = o.c ?? 0; m.d = o.d ?? 0; m.e = o.e ?? 0; m.col = o.col ?? 'white';
  m.dx = o.dx ?? 0; m.dy = o.dy ?? 0;
  return m;
}
export function tickMarks() {
  for (const m of pool) if (m.on && ++m.t >= m.max) m.on = false;
}
export function clearMarks() { for (const m of pool) m.on = false; }
export function markCount() { let n = 0; for (const m of pool) if (m.on) n++; return n; }

// world -> internal pixel, without allocating (display.worldToScreen returns a fresh object)
const S = { x: 0, y: 0 };
function proj(x, y, z) {
  const P = PPU * display.zoom, t = display.cameraTarget;
  const rs = Math.round(t.x * P) / P;
  const us = Math.round((t.y * cp - t.z * sp) * P) / P;
  S.x = Math.round(display.width / 2 + (x - rs) * P);
  S.y = Math.round(display.height / 2 - ((y * cp - z * sp) - us) * P);
  return S;
}

const R = (g, x, y, w, h) => g.fillRect(Math.round(x), Math.round(y), w, h);

// ---- star: 4 tapered rays and 4 diagonal ticks, flashing white then settling to colour -------
function star(g, m, z) {
  const p = proj(m.x, m.y, m.z);
  const t = m.t, big = m.a;                        // a = power
  const r = Math.round((5 + big * 4) * z);
  const grow = t === 0 ? 0.8 : t === 1 ? 1.25 : t === 2 ? 0.9 : 0.55;
  const len = Math.round(r * grow), th = (t < 2 ? 3 : 2) * z;
  const ink = css('ink');
  const draw = (pad, color) => {
    g.fillStyle = color;
    for (let i = 0; i <= len + pad; i++) {
      const w = Math.max(1, Math.round((th + pad * 2) * (1 - i / (len + 2))) | 1);
      const o = w >> 1;
      R(g, p.x + i, p.y - o, 1, w); R(g, p.x - i, p.y - o, 1, w);
      R(g, p.x - o, p.y + i, w, 1); R(g, p.x - o, p.y - i, w, 1);
    }
    if (t < 2) { const d = Math.round(len * 0.45) + pad; for (let i = 0; i <= d; i++) { const w = 1 + pad * 2, o = pad; R(g, p.x + i - o, p.y + i - o, w, w); R(g, p.x - i - o, p.y + i - o, w, w); R(g, p.x + i - o, p.y - i - o, w, w); R(g, p.x - i - o, p.y - i - o, w, w); } }
  };
  if (t <= 3) {
    draw(1, ink);
    draw(0, t === 0 ? css('white') : t === 1 ? css(m.col === 'white' ? 'torch' : m.col) : css('gold'));
    g.fillStyle = css('white'); R(g, p.x - z, p.y - z, 2 * z + 1, 2 * z + 1);
  }
  if (t >= 1 && t <= 4) {
    // a thin shock ring in the screen plane
    const rr_ = Math.round(r * (0.55 + t * 0.45)), n = Math.max(12, rr_ * 5);
    g.fillStyle = css(t < 3 ? 'torch' : 'gold');
    let lx = -1e9, ly = -1e9;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.round(p.x + Math.cos(a) * rr_), y = Math.round(p.y + Math.sin(a) * rr_ * 0.85); if (x === lx && y === ly) continue; lx = x; ly = y; if ((i * 6 / n | 0) & 1) continue; g.fillRect(x, y, z, z); }
  }
  if (t >= 2 && t <= 5) {
    // spokes: 8 dots flying off the contact point, then gone
    g.fillStyle = css(t < 4 ? 'torch' : 'flame');
    const rd = r * (0.9 + (t - 2) * 0.55), sz = (t < 4 ? 2 : 1) * z;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4 + (a & 1 ? 0.2 : 0), k = a & 1 ? 0.75 : 1;
      R(g, p.x + Math.cos(ang) * rd * k, p.y + Math.sin(ang) * rd * k * 0.85, sz, sz);
    }
  }
}

// ---- smear: a crescent swept along an arc; head races ahead, tail catches up and thins -------
// a = yaw of the middle of the arc, b = radius (world), c = sweep (rad), d = side (+1/-1)
const SM_STEPS = 26;
const PTS = new Int32Array((SM_STEPS + 1) * 2);
function smear(g, m, zoom) {
  const t = m.t, T = m.max;
  const sw = m.c, side = m.d || 1;
  const e = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
  const head = e(Math.min(1, (t + 1) / 3));                       // 0..1 along the arc
  const tail = Math.max(0, Math.min(1, (t - 1) / (T - 1))) ;
  const tailE = tail * tail;
  if (tailE >= head) return;
  const maxTh = Math.max(3, Math.round((5 + m.e * 3) * zoom));
  const life = 1 - t / T;
  const cols = t < 2 ? ['white', 'torch'] : t < 4 ? ['torch', 'gold'] : ['gold', 'flame'];
  // two passes: ink outline (1 px fatter), then colour
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i <= SM_STEPS; i++) {
      const u = i / SM_STEPS;
      const s = tailE + (head - tailE) * u;                     // position along the sweep
      const phi = (-0.5 + s) * sw * side;
      const ang = m.a + phi;
      const p = proj(m.x + Math.sin(ang) * m.b, m.y, m.z + Math.cos(ang) * m.b);
      // thickest a little behind the head, thin at the tail, tapering at the very tip
      const prof = Math.pow(u, 0.9) * (u > 0.93 ? (1 - u) / 0.07 * 0.5 + 0.5 : 1);
      let th = Math.max(1, Math.round(maxTh * prof * (0.5 + 0.5 * life)));
      if (pass === 0) th += 2;
      g.fillStyle = pass === 0 ? css('ink') : css(u > 0.55 ? cols[0] : cols[1]);
      const o = th >> 1;
      R(g, p.x - o, p.y - o, th, th);
      if (i > 0 && pass === 1) R(g, ((PTS[i * 2 - 2] + p.x) >> 1) - o, ((PTS[i * 2 - 1] + p.y) >> 1) - o, th, th);   // fill the gap between samples
      if (pass === 1) { PTS[i * 2] = p.x; PTS[i * 2 + 1] = p.y; }
    }
  }
}

// ---- dithered glow: concentric ellipses, each band a checkerboard, so light steps instead of fades
const patCache = new Map();
// phase 0/1: the two checkerboards (half the pixels); phase 2: sparse (one pixel in four)
function pattern(g, color, phase) {
  const key = color + phase;
  let p = patCache.get(key);
  if (!p) {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const x = c.getContext('2d');
    x.fillStyle = color;
    if (phase === 2) { x.fillRect(0, 0, 1, 1); x.fillRect(2, 2, 1, 1); }
    else for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) if (((xx + yy) & 1) === phase) x.fillRect(xx, yy, 1, 1);
    p = g.createPattern(c, 'repeat');
    patCache.set(key, p);
  }
  return p;
}
function ellipseRows(g, cx, cy, rx, ry, fill) {
  g.fillStyle = fill;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.0001)));
    if (w > 0) g.fillRect(cx - w, cy + y, w * 2, 1);
  }
}
// a = radius (world units), col = colour name. Light steps down in bands as it dies:
// a sparse outer halo, a checkerboard body, a solid core, a white heart.
function glow(g, m, zoom) {
  const fl = settings.get('flashes');
  if (fl <= 0) return;
  const p = proj(m.x, m.y, m.z);
  const k = m.t / m.max;
  const P = PPU * zoom;
  const r = m.a * P * (0.5 + 0.5 * Math.min(1, k * 4)) * (k > 0.5 ? 1 - (k - 0.5) * 1.3 : 1);
  if (r < 3) return;
  const ph = m.t & 1;
  const c0 = css(m.col === 'ember' ? 'flame' : m.col);
  const c1 = css(m.col === 'ember' ? 'ember' : m.col === 'torch' ? 'gold' : m.col);
  const c2 = css(m.col === 'ember' ? 'blood' : m.col === 'torch' ? 'flame' : 'fog');
  const ry = (f) => Math.max(1, Math.round(r * f * 0.72));
  ellipseRows(g, p.x, p.y, Math.round(r), ry(1), pattern(g, c2, 2));
  if (k < 0.75) ellipseRows(g, p.x, p.y, Math.round(r * 0.66), ry(0.66), pattern(g, c1, ph));
  if (k < 0.4) ellipseRows(g, p.x, p.y, Math.round(r * 0.36), ry(0.36), k < 0.15 ? c0 : pattern(g, c0, 1 - ph));
  if (k < 0.2) ellipseRows(g, p.x, p.y, Math.round(r * 0.16), ry(0.16), css('white'));
}

// ---- twinkle: a 4-point sprite that grows and shrinks in whole pixels, drifting up ------------
// dx, dy = drift in px/tick; a = size scale
const TW = [1, 3, 5, 3, 1];
function twinkle(g, m, zoom) {
  const p = proj(m.x, m.y, m.z);
  const k = m.t / m.max;
  const i = Math.min(TW.length - 1, Math.floor(k * TW.length));
  const arm = Math.round(TW[i] * (m.a || 1) * (zoom > 1 ? 1.5 : 1));
  const x = p.x + Math.round(m.dx * m.t), y = p.y + Math.round(m.dy * m.t);
  const col = css(m.col);
  g.fillStyle = css('ink');
  if (arm >= 3) { R(g, x - arm - 1, y - 1, arm * 2 + 3, 3); R(g, x - 1, y - arm - 1, 3, arm * 2 + 3); }
  g.fillStyle = arm >= 3 ? col : css('white');
  R(g, x - arm, y, arm * 2 + 1, 1); R(g, x, y - arm, 1, arm * 2 + 1);
  g.fillStyle = css('white'); R(g, x, y, 1, 1);
}

// ---- ring: an ellipse outline on the floor plane, 1-2 px, stepping outward (a = end radius) ---
function ring(g, m, zoom) {
  const k = m.t / m.max, p = proj(m.x, m.y, m.z);
  const P = PPU * zoom;
  const dr = m.b || 0.8, tt = m.t, r = m.a * P * (m.b ? (1 - Math.pow(dr, tt)) / (1 - Math.pow(dr, m.max)) : 1 - (1 - k) * (1 - k) * (1 - k));
  if (r < 2) return;
  const w = k < 0.25 ? 2 : 1;
  g.fillStyle = css(k < 0.4 ? m.col : 'fog');
  const n = Math.max(16, Math.round(r * 4));
  let lx = -1e9, ly = -1e9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(p.x + Math.cos(a) * r), y = Math.round(p.y + Math.sin(a) * r * sp);
    if (x === lx && y === ly) continue;
    lx = x; ly = y;
    if (((i >> 2) & 3) === 3 && k > 0.25) continue;               // the ring breaks up as it dies
    g.fillRect(x, y, w, w);
  }
}

export function drawMarks(g) {
  const zoom = display.zoom;
  for (const m of pool) {
    if (!m.on) continue;
    switch (m.kind) {
      case STAR: star(g, m, zoom); break;
      case SMEAR: smear(g, m, zoom); break;
      case GLOW: glow(g, m, zoom); break;
      case TWINKLE: twinkle(g, m, zoom); break;
      case RING: ring(g, m, zoom); break;
    }
  }
}
