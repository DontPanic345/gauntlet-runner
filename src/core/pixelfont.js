// A 5x7 bitmap font authored in code (no third-party font), drawn onto a 2D canvas at the
// game's internal resolution so text sits on the same pixel grid as the 3D frame.
// Proportional letters, tabular digits (readouts do not jitter). Lowercase draws as uppercase.
//
//   drawText(ctx, 'HELLO', x, y, 'bone', { shadow: 'ink', align: 'center', scale: 2 })
//   textWidth('HELLO', scale)            LINE_H = 9 (at scale 1)
//
// The `hud` piece may vendor a nicer OFL pixel font later; this one is the engine's fallback
// and what debug overlays use.

import { css } from '../render/palette.js';

const G = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.',
  7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.....|.....|.....|.....|.....|.....|..#..',
  ',': '.....|.....|.....|.....|.....|..#..|.#...',
  ':': '.....|.....|..#..|.....|.....|..#..|.....',
  ';': '.....|.....|..#..|.....|.....|..#..|.#...',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '\\': '#....|#....|.#...|..#..|...#.|....#|....#',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '[': '.###.|.#...|.#...|.#...|.#...|.#...|.###.',
  ']': '.###.|...#.|...#.|...#.|...#.|...#.|.###.',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  "'": '..#..|..#..|.....|.....|.....|.....|.....',
  '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|#####',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  '|': '..#..|..#..|..#..|..#..|..#..|..#..|..#..',
  '^': '..#..|.#.#.|#...#|.....|.....|.....|.....',
  '↑': '..#..|.###.|#.#.#|..#..|..#..|..#..|..#..',
  '↓': '..#..|..#..|..#..|..#..|#.#.#|.###.|..#..',
  '←': '.....|..#..|.#...|#####|.#...|..#..|.....',
  '→': '.....|..#..|...#.|#####|...#.|..#..|.....',
  '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
  '•': '.....|.....|.###.|.###.|.###.|.....|.....',
  '█': '#####|#####|#####|#####|#####|#####|#####',
};

export const GLYPH_H = 7;
export const LINE_H = 9;
const CELL = 6; // atlas cell width

const glyphs = {}; // char -> { col, x0, w }
const chars = Object.keys(G);
let atlas = null;
const tinted = new Map();

function build() {
  atlas = document.createElement('canvas');
  atlas.width = chars.length * CELL;
  atlas.height = GLYPH_H;
  const g = atlas.getContext('2d');
  g.fillStyle = '#fff';
  chars.forEach((ch, i) => {
    const rows = G[ch].split('|');
    let minX = 5, maxX = -1;
    rows.forEach((row, y) => {
      for (let x = 0; x < 5; x++) {
        if (row[x] === '#') { g.fillRect(i * CELL + x, y, 1, 1); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      }
    });
    const tabular = /[0-9]/.test(ch);
    if (tabular || maxX < 0) { minX = 0; maxX = 4; }
    glyphs[ch] = { col: i * CELL, x0: minX, w: maxX - minX + 1 };
  });
}

function tint(color) {
  let c = tinted.get(color);
  if (c) return c;
  if (!atlas) build();
  c = document.createElement('canvas');
  c.width = atlas.width; c.height = atlas.height;
  const g = c.getContext('2d');
  g.drawImage(atlas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color.startsWith('#') ? color : css(color);
  g.fillRect(0, 0, c.width, c.height);
  tinted.set(color, c);
  return c;
}

function glyphFor(ch) {
  if (!atlas) build();
  if (ch === ' ') return null;
  return glyphs[ch] || glyphs[ch.toUpperCase()] || glyphs['?'];
}

/** Width in pixels of a single line of text. */
export function textWidth(text, scale = 1) {
  let w = 0;
  for (const ch of String(text)) {
    const g = glyphFor(ch);
    w += (g ? g.w : 3) + 1;
  }
  return Math.max(0, w - 1) * scale;
}

/**
 * Draw one line of text. (x, y) is the top-left of the glyph box (after alignment).
 * color / shadow are palette names or '#rrggbb'. shadow draws a 1-px drop shadow (down-right).
 * Returns the drawn width.
 */
export function drawText(ctx, text, x, y, color = 'bone', opts = {}) {
  const { shadow = null, align = 'left', scale = 1, outline = null } = opts;
  text = String(text);
  const w = textWidth(text, scale);
  const sx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const sy = Math.round(y);
  if (!text) return 0;
  // Rendered strings are cached as small canvases (one drawImage per string per frame).
  const key = `${color}|${shadow}|${outline}|${scale}|${text}`;
  let c = cache.get(key);
  if (c) { cache.delete(key); cache.set(key, c); } // LRU touch
  else {
    const pad = scale; // room for shadow / outline
    c = document.createElement('canvas');
    c.width = w + pad * 2; c.height = GLYPH_H * scale + pad * 2;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        blit(g, text, pad + dx * scale, pad + dy * scale, outline, scale);
      }
    } else if (shadow) blit(g, text, pad + scale, pad + scale, shadow, scale);
    blit(g, text, pad, pad, color, scale);
    cache.set(key, c);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  ctx.drawImage(c, sx - scale, sy - scale);
  return w;
}

const cache = new Map();
const CACHE_MAX = 600;

function blit(ctx, text, x, y, color, scale) {
  const img = tint(color);
  ctx.imageSmoothingEnabled = false;
  let cx = x;
  for (const ch of text) {
    const g = glyphFor(ch);
    if (!g) { cx += 4 * scale; continue; }
    ctx.drawImage(img, g.col + g.x0, 0, g.w, GLYPH_H, cx, y, g.w * scale, GLYPH_H * scale);
    cx += (g.w + 1) * scale;
  }
}

/** Word-wrap text to a pixel width; returns an array of lines. */
export function wrapText(text, maxW, scale = 1) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (textWidth(t, scale) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
