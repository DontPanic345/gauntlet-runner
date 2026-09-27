// Pixel sprites and frame helpers shared by the HUD widgets. Everything is authored as text,
// coloured by palette name, and drawn with integer fillRects on the UI canvas (internal
// resolution, so it is integer-scaled and nearest-neighbour by construction).
//
//   const s = sprite(ROWS, LETTER_MAP)
//   drawSprite(g, s, x, y, { flash: 'white', minRow: 3, outline: 'ink', dy: -1 })
//   plate(g, x, y, w, h, { edge: 'slate' })     notched, bevelled frame used by every panel

import { css } from '../../render/palette.js';

const cache = new Map();

/** Parse text rows into { w, h, px: [[x, y, colourName]], outline: [[x, y]] }. */
export function sprite(rows, map) {
  const px = [];
  const has = new Set();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.' || c === ' ') continue;
      px.push([x, y, map[c] ?? c]);
      has.add(x + ',' + y);
    }
  });
  const outline = [];
  const seen = new Set();
  for (const [x, y] of px) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (has.has(k) || seen.has(k)) continue;
      seen.add(k);
      outline.push([x + dx, y + dy]);
    }
  }
  return { w: rows[0].length, h: rows.length, px, outline };
}

/** The outline ring `n` pixels out (n = 1 is the normal outline). Cached per sprite. */
export function ring(spr, n) {
  const key = 'ring' + n;
  if (spr[key]) return spr[key];
  const inside = new Set(spr.px.map(([x, y]) => x + ',' + y));
  const out = [];
  const seen = new Set();
  for (const [x, y] of spr.px) {
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > n + 1 || Math.abs(dx) + Math.abs(dy) < n) continue;
      const k = (x + dx) + ',' + (y + dy);
      if (inside.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push([x + dx, y + dy]);
    }
  }
  spr[key] = out;
  return out;
}

/**
 * Draw a sprite with its top-left at (x, y).
 *   flash: colour name that replaces every pixel      minRow: skip rows above this (fill wipes)
 *   outline: colour name for the 1px outline (null = none)   map: per-colour replacement {red: 'rose'}
 */
export function drawSprite(g, spr, x, y, { flash = null, minRow = 0, maxRow = 1e9, maxCol = 1e9, outline = 'ink', map = null, dy = 0 } = {}) {
  x = Math.round(x); y = Math.round(y + dy);
  if (outline) {
    g.fillStyle = css(outline);
    for (const [ox, oy] of spr.outline) if (oy >= minRow - 1 && oy <= maxRow + 1 && ox <= maxCol + 1) g.fillRect(x + ox, y + oy, 1, 1);
  }
  let last = null;
  for (const [px, py, c] of spr.px) {
    if (py < minRow || py > maxRow || px > maxCol) continue;
    const name = flash ?? (map && map[c]) ?? c;
    if (name !== last) { g.fillStyle = css(name); last = name; }
    g.fillRect(x + px, y + py, 1, 1);
  }
}

/** Draw only the given ring pixels (an echo or glow around a sprite). */
export function drawRing(g, spr, n, x, y, colour) {
  g.fillStyle = css(colour);
  for (const [ox, oy] of ring(spr, n)) g.fillRect(Math.round(x) + ox, Math.round(y) + oy, 1, 1);
}

/**
 * A framed plate: ink outer edge, a lit top-left and dark bottom-right bevel, and notched
 * corners. Used by every HUD panel so the whole HUD reads as one object.
 */
export function plate(g, x, y, w, h, { edge = 'slate', fill = 'night', light = 'violet', notch = true } = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  g.fillStyle = css('ink');
  g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
  g.fillStyle = css(fill);
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  // bevel: light on top and left, dark at bottom and right
  g.fillStyle = css(light);
  g.fillRect(x + 2, y + 1, w - 4, 1); g.fillRect(x + 1, y + 2, 1, h - 4);
  g.fillStyle = css(edge === 'slate' ? 'dusk' : edge);
  g.fillRect(x + 2, y + h - 2, w - 4, 1); g.fillRect(x + w - 2, y + 2, 1, h - 4);
  if (notch) {
    // corner rivets
    g.fillStyle = css(edge);
    for (const [cx, cy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) g.fillRect(cx, cy, 1, 1);
  }
}

// ---- art --------------------------------------------------------------------------------------

const C = { r: 'red', R: 'rose', b: 'blood', w: 'white', c: 'cyan', s: 'sky', u: 'blue', k: 'ink', g: 'gold', f: 'flame', e: 'ember', t: 'torch', o: 'bone', m: 'mist', z: 'frost', d: 'shadow', v: 'violet', l: 'slate' };

const mk = (id, rows) => { if (!cache.has(id)) cache.set(id, sprite(rows, C)); return cache.get(id); };

/** 9x8 heart. Fill wipes upward by row: minRow = 8 - ceil(fill * 8). */
export const HEART = mk('heart', [
  '.rrr.rrr.',
  'rRRrrrrrb',
  'rRrrrrrrb',
  'rrrrrrrrb',
  '.rrrrrrb.',
  '..rrrrb..',
  '...rrb...',
  '....b....',
]);
/** The empty socket: same silhouette in cold colours. */
export const HEART_EMPTY = mk('heartE', [
  '.ddd.ddd.',
  'dvvddddd.',
  'dvddddddd',
  'ddddddddd',
  '.ddddddd.',
  '..ddddd..',
  '...ddd...',
  '....d....',
]);
/** 9x5 dash pill: fills left to right as the dash recharges (maxCol). */
export const PIP = mk('pip', [
  '.sssssss.',
  'swwcccccu',
  'sccccccuu',
  '.ccuuuuu.',
  '..uuuuu..',
]);
export const PIP_EMPTY = mk('pipE', [
  '.vvvvvvv.',
  'vdddddddd',
  'dddddddd',
  '.ddddddd.',
  '..ddddd..',
].map((r) => r.padEnd(9, 'd')));

/** Route node icons, 9x9 at most. Arena: a gate. Corridor: chevrons. Boss: horned skull. */
export const NODE_ARENA = mk('nArena', [
  '.lllll.',
  'lllllll',
  'llkkkll',
  'llkkkll',
  'llkkkll',
  'llkkkll',
  'lllllll',
]);
export const NODE_CORRIDOR = mk('nCorr', [
  'e..e...',
  'ee.ee..',
  '.ee.ee.',
  '..ee.ee',
  '.ee.ee.',
  'ee.ee..',
  'e..e...',
]);
export const NODE_BOSS = mk('nBoss', [
  'b.......b',
  'bb.zzz.bb',
  '.bzzzzzb.',
  '..zkzkz..',
  '..zzzzz..',
  '...z.z...',
]);

/** Sparkle plus for shard glints and heal bursts. */
export function plus(g, x, y, colour, r = 1) {
  g.fillStyle = css(colour);
  g.fillRect(x - r, y, r * 2 + 1, 1); g.fillRect(x, y - r, 1, r * 2 + 1);
}
