// HUD drawing helpers (piece `hud`): pixel sprites from text, framed panels, dither masks.
// Everything is drawn in palette colours with hard edges at internal resolution: no alpha
// blending, no smoothing. Sprites are authored as rows of characters and cached as canvases.
//
//   sprite(rows, map)            -> canvas    rows: ['.kk.', ...], map: { k: 'ink', ... }
//   outlined(mask, map, outline) -> canvas    a mask of shade letters, outlined in `outline`
//   panel(g, x, y, w, h, { tone, rim, edge })  the HUD frame: ink border, cut corners, a lit top
//   checker(g, x, y, w, h, phase)             punch a 50% checker out of a layer (dithered fade)
//   ditherFade(g, x, y, w, h, level0to16)     punch an ordered-dither fraction out of a layer

import { css } from '../../render/palette.js';

const cache = new Map();

/** A canvas from character rows. '.' or ' ' is transparent; every other char maps to a palette name. */
export function sprite(rows, map, key = null) {
  const k = key ?? rows.join('|') + JSON.stringify(map);
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(...rows.map((r) => r.length));
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const name = map[ch];
      if (!name) continue;
      g.fillStyle = css(name);
      g.fillRect(x, y, 1, 1);
    }
  });
  cache.set(k, c);
  return c;
}

/**
 * A sprite whose rows are an interior mask (shade letters), padded by one pixel and outlined
 * (8-connected) in `outline`. Returns a canvas (w + 2) x (h + 2).
 */
export function outlined(rows, map, outline = 'ink', key = null) {
  const k = 'o|' + (key ?? rows.join('|') + JSON.stringify(map)) + '|' + outline;
  let c = cache.get(k);
  if (c) return c;
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const filled = (x, y) => y >= 0 && y < h && x >= 0 && x < (rows[y]?.length ?? 0) && rows[y][x] !== '.' && rows[y][x] !== ' ';
  const out = [];
  for (let y = -1; y <= h; y++) {
    let line = '';
    for (let x = -1; x <= w; x++) {
      if (filled(x, y)) { line += rows[y][x]; continue; }
      let n = false;
      for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) { n = true; break; }
      line += n ? '\u0001' : '.';
    }
    out.push(line);
  }
  c = sprite(out, { ...map, '\u0001': outline }, k);
  cache.set(k, c);
  return c;
}

/** Same mask, every interior pixel one colour (flashes, silhouettes). */
export function tinted(rows, colour, outline = 'ink') {
  const map = {};
  for (const r of rows) for (const ch of r) if (ch !== '.' && ch !== ' ') map[ch] = colour;
  return outlined(rows, map, outline, rows.join('|') + '#' + colour);
}

export function rect(g, c, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = css(c);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A rectangle with cut corners (cut px). */
export function cutRect(g, c, x, y, w, h, cut = 1) {
  g.fillStyle = css(c);
  for (let k = 0; k <= cut; k++) {
    const inset = cut - k;
    if (k === cut) { g.fillRect(x, y + cut, w, h - cut * 2); break; }
    g.fillRect(x + inset, y + k, w - inset * 2, 1);
    g.fillRect(x + inset, y + h - 1 - k, w - inset * 2, 1);
  }
}

/**
 * The HUD frame: a 1px ink border with cut corners, a dark plate, a lit 1px rim along the top
 * and a darker one along the bottom. tone: the plate colour; rim: the top highlight.
 */
export function panel(g, x, y, w, h, { tone = 'night', rim = 'violet', edge = 'ink', shade = 'ink' } = {}) {
  x = Math.round(x); y = Math.round(y);
  cutRect(g, edge, x, y, w, h, 2);
  cutRect(g, tone, x + 1, y + 1, w - 2, h - 2, 1);
  rect(g, rim, x + 3, y + 1, w - 6, 1);
  rect(g, shade, x + 3, y + h - 2, w - 6, 1);
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => BAYER[(x & 3) + ((y & 3) << 2)];

/** Erase an ordered-dither fraction (level/16 of the pixels) of a rect on a layer canvas. */
export function ditherFade(g, x, y, w, h, level) {
  level = Math.max(0, Math.min(16, Math.round(level)));
  if (level <= 0) return;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (level >= 16) { g.clearRect(x, y, w, h); return; }
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (bayer(xx, yy) < level) g.clearRect(xx, yy, 1, 1);
}

/** Integer ease helpers. */
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
export const easeOutBack = (t) => { t = clamp01(t); const c = 1.7; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

/** A tiny deterministic rng for HUD particles (keeps the game's seeded streams untouched). */
export function prng(seed = 1) {
  let s = seed | 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** 2D pixel particles for HUD bursts (heart shards, sparkles). Tick-driven. */
export function createBits() {
  const list = [];
  return {
    list,
    add(p) { list.push({ life: 0, max: 30, g: 0.12, vx: 0, vy: 0, c: 'white', w: 1, ...p }); },
    tick() {
      for (const p of list) { p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.96; }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].life >= list[i].max) list.splice(i, 1);
    },
    draw(g) {
      for (const p of list) {
        const k = p.life / p.max;
        if (k > 0.7 && (p.life >> 1) & 1) continue;   // blink out, never fade
        const c = p.cs ? p.cs[Math.min(p.cs.length - 1, Math.floor(k * p.cs.length))] : p.c;
        rect(g, c, Math.round(p.x), Math.round(p.y), p.w, p.w);
      }
    },
  };
}
