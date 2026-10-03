// Boon cards (piece `boons`): pixel-drawn card faces and backs, cached as canvases, plus the
// small 2D pixel helpers the choice screen and HUD share (ordered-dither fills, pixel discs,
// rich text). Everything is drawn in palette colours with hard edges: no alpha, no smoothing.
//
//   cardFace(id, stacks) -> canvas (CW x CH)      the icon is NOT on it: the screen draws it live
//   cardBack(rarity)     -> canvas
//   ditherPattern(g, level0to16, colour) -> CanvasPattern   (4x4 Bayer, for dims and dissolves)
//   richText(g, text, x, y, w, colour, hi, { align }) -> lines drawn     [word] = highlight

import { css } from '../render/palette.js';
import { drawText, textWidth, LINE_H } from '../core/pixelfont.js';
import { BOONS, RARITY, stacks as heldStacks, synergiesOf, has } from './boons.js';
import { iconCanvas } from './icons.js';

export const CW = 148, CH = 208;
export const MED = { x: CW / 2, y: 50, r: 29 };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER[(x & 3) + (y & 3) * 4] + 0.5) / 16;

function rect(g, c, x, y, w, h) { g.fillStyle = css(c); g.fillRect(x, y, w, h); }
/** A rectangle with bevelled (cut) corners. */
export function bevel(g, c, x, y, w, h, cut = 2) {
  g.fillStyle = css(c);
  g.fillRect(x + cut, y, w - cut * 2, h);
  g.fillRect(x, y + cut, w, h - cut * 2);
  for (let k = 1; k < cut; k++) g.fillRect(x + cut - k, y + k, w - (cut - k) * 2, h - k * 2);
}
export function disc(g, c, cx, cy, r) {
  g.fillStyle = css(c);
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
    g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}
/** Ordered-dither fill of a rect: density 0..1, optionally falling off with fn(x, y) -> 0..1. */
export function dither(g, c, x0, y0, w, h, density, fn = null) {
  g.fillStyle = css(c);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const d = fn ? fn(x, y) : density;
    if (d > bayer(x, y)) g.fillRect(x, y, 1, 1);
  }
}

const patterns = new Map();
/** A repeating 4x4 Bayer pattern with `level` of 16 pixels set in `colour`. */
export function ditherPattern(g, level, colour = 'ink') {
  level = Math.max(0, Math.min(16, Math.round(level)));
  const key = level + colour;
  let p = patterns.get(key);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const cg = c.getContext('2d');
  cg.fillStyle = css(colour);
  for (let i = 0; i < 16; i++) if (BAYER[i] < level) cg.fillRect(i & 3, i >> 2, 1, 1);
  p = g.createPattern(c, 'repeat');
  patterns.set(key, p);
  return p;
}

// ---- rich text ------------------------------------------------------------------------------
function tokens(text) {
  const out = [];
  let hi = false, cur = '';
  const flush = () => { if (cur) out.push({ t: cur, hi }); cur = ''; };
  for (const ch of text) {
    if (ch === '[') { flush(); hi = true; continue; }
    if (ch === ']') { flush(); hi = false; continue; }
    if (ch === ' ') { flush(); out.push({ t: ' ', hi }); continue; }
    cur += ch;
  }
  flush();
  // merge consecutive non-space segments into words made of parts
  const words = [];
  let w = null;
  for (const s of out) {
    if (s.t === ' ') { w = null; continue; }
    if (!w) { w = []; words.push(w); }
    w.push(s);
  }
  return words;
}
export function richText(g, text, x, y, maxW, colour, hi, { align = 'center' } = {}) {
  const words = tokens(text);
  const lines = [];
  let line = [];
  const lineText = (l) => l.map((w) => w.map((s) => s.t).join('')).join(' ');
  for (const w of words) {
    const tryL = [...line, w];
    if (line.length && textWidth(lineText(tryL)) > maxW) { lines.push(line); line = [w]; } else line = tryL;
  }
  if (line.length) lines.push(line);
  lines.forEach((l, i) => {
    const full = lineText(l);
    const W = textWidth(full);
    let cx = align === 'center' ? Math.round(x + (maxW - W) / 2) : x;
    let prefix = '';
    for (const w of l) {
      for (const s of w) {
        const px = cx + (prefix ? textWidth(prefix) + 1 : 0);
        drawText(g, s.t, px, y + i * LINE_H, s.hi ? hi : colour);
        prefix += s.t;
      }
      prefix += ' ';
    }
  });
  return lines.length;
}

// ---- faces ----------------------------------------------------------------------------------
const faces = new Map();

function frame(g, R, panel = 'shadow') {
  bevel(g, 'ink', 0, 0, CW, CH, 4);
  bevel(g, R.edge, 1, 1, CW - 2, CH - 2, 3);
  bevel(g, R.frame, 2, 2, CW - 4, CH - 4, 3);
  // a highlight along the top and left of the frame, a shade along the bottom and right
  rect(g, 'white', 5, 2, CW - 10, 1);
  rect(g, R.edge, 5, CH - 3, CW - 10, 1);
  bevel(g, R.edge, 4, 4, CW - 8, CH - 8, 2);
  bevel(g, panel, 5, 5, CW - 10, CH - 10, 2);
  // corner studs
  for (const [x, y] of [[7, 7], [CW - 10, 7], [7, CH - 10], [CW - 10, CH - 10]]) {
    rect(g, R.frame, x, y, 3, 3); rect(g, 'white', x, y, 1, 1);
  }
}

/** The face of a boon card at the stack it would become if taken (stacks held + 1). */
export function cardFace(id, held = heldStacks(id)) {
  const syns = synergiesOf(id);
  const active = syns.find((s) => has(s.partner));
  const key = `${id}|${held}|${active?.id ?? ''}`;
  let c = faces.get(key);
  if (c) return c;
  const B = BOONS[id], R = RARITY[B.rarity];
  c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  frame(g, R);
  // a glow down from the top in the rarity colour
  dither(g, R.edge, 5, 5, CW - 10, 80, 0, (x, y) => 0.55 * Math.max(0, 1 - (y - 5) / 80) * (1 - Math.abs(x - CW / 2) / (CW * 0.7)));
  // rays behind the medallion for rare and up
  if (R.order >= 1) {
    g.fillStyle = css(R.order >= 3 ? 'flame' : R.edge);
    const n = R.order >= 2 ? 16 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.1;
      const L = MED.r + (k % 2 ? 6 : 12) + R.order * 2;
      for (let r = MED.r; r < L; r++) g.fillRect(Math.round(MED.x + Math.cos(a) * r), Math.round(MED.y + Math.sin(a) * r), r < L - 3 ? 2 : 1, r < L - 3 ? 2 : 1);
    }
  }
  // medallion
  disc(g, 'ink', MED.x, MED.y, MED.r + 1);
  disc(g, R.frame, MED.x, MED.y, MED.r);
  disc(g, R.edge, MED.x, MED.y, MED.r - 2);
  disc(g, 'night', MED.x, MED.y, MED.r - 4);
  dither(g, R.edge, MED.x - MED.r, MED.y - MED.r, MED.r * 2, MED.r * 2, 0, (x, y) => { const d = Math.hypot(x - MED.x, y - MED.y) / (MED.r - 4); return d > 1 ? 0 : 0.5 * (1 - d); });
  rect(g, 'white', MED.x - 9, MED.y - MED.r + 1, 6, 1);
  // rarity tab over the top edge
  const lab = R.label, lw = textWidth(lab) + 10;
  bevel(g, 'ink', Math.round(CW / 2 - lw / 2) - 1, -1, lw + 2, 12, 2);
  bevel(g, R.frame, Math.round(CW / 2 - lw / 2), 0, lw, 10, 2);
  drawText(g, lab, CW / 2, 2, 'night', { align: 'center' });
  // name
  const name = B.name;
  const big = textWidth(name, 2) <= CW - 16;
  drawText(g, name, CW / 2, big ? 86 : 90, R.order >= 3 ? 'gold' : 'bone', { align: 'center', scale: big ? 2 : 1, outline: 'ink' });
  // divider
  rect(g, R.edge, 16, 105, CW - 32, 1);
  rect(g, R.frame, CW / 2 - 2, 104, 5, 3); rect(g, R.frame, CW / 2 - 1, 103, 3, 5);
  // description at the stack it becomes
  const n = Math.min(B.max, held + 1);
  richText(g, B.text(n, B.lv(n)), 10, 112, CW - 20, 'frost', B.color === 'bone' ? 'white' : B.color);
  // synergy row
  const syn = active ?? syns[0];
  if (syn) {
    const on = !!active;
    const y = 160;
    bevel(g, on ? 'gold' : 'violet', 8, y, CW - 16, 22, 2);
    bevel(g, on ? 'night' : 'night', 9, y + 1, CW - 18, 20, 2);
    if (on) dither(g, 'flame', 9, y + 1, CW - 18, 20, 0.12);
    const ic = iconCanvas(syn.partner, 1, { dim: !on });
    g.drawImage(ic, 11, y + 2);
    drawText(g, on ? 'SYNERGY: ' + syn.name : 'PAIRS WITH', 32, y + 3, on ? 'gold' : 'mist');
    drawText(g, on ? 'WITH ' + BOONS[syn.partner].name : BOONS[syn.partner].name, 32, y + 12, on ? 'torch' : 'fog');
  }
  // level pips and tag
  const tag = held === 0 ? 'NEW' : `LV ${held} > ${held + 1}`;
  drawText(g, tag, CW / 2, 186, held === 0 ? R.text : 'gold', { align: 'center' });
  const pw = B.max * 8 - 2, px0 = Math.round(CW / 2 - pw / 2);
  for (let k = 0; k < B.max; k++) {
    const x = px0 + k * 8, y = 196;
    rect(g, 'ink', x - 1, y - 1, 8, 6);
    rect(g, k < held ? R.frame : k === held ? 'white' : 'violet', x, y, 6, 4);
    if (k < held) rect(g, 'white', x, y, 2, 1);
  }
  faces.set(key, c);
  return c;
}

const backs = new Map();
export function cardBack(rarity = 'common') {
  let c = backs.get(rarity);
  if (c) return c;
  const R = RARITY[rarity];
  c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  frame(g, { ...R, frame: 'slate', edge: R.edge }, 'dusk');
  // a diamond lattice
  g.fillStyle = css('violet');
  for (let y = 6; y < CH - 6; y++) for (let x = 6; x < CW - 6; x++) {
    const u = (x - CW / 2), v = (y - CH / 2);
    if (((u + v) % 14 + 14) % 14 === 0 || ((u - v) % 14 + 14) % 14 === 0) g.fillRect(x, y, 1, 1);
  }
  // an emblem: a soul crystal in a ring
  disc(g, 'ink', CW / 2, CH / 2, 25);
  disc(g, R.edge, CW / 2, CH / 2, 24);
  disc(g, 'night', CW / 2, CH / 2, 21);
  g.drawImage(iconCanvas('shard', 3), Math.round(CW / 2 - 27), Math.round(CH / 2 - 24));
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const x = Math.round(CW / 2 + Math.cos(a) * 36), y = Math.round(CH / 2 + Math.sin(a) * 36);
    rect(g, 'ink', x - 3, y - 3, 7, 7); rect(g, R.frame, x - 2, y - 2, 5, 5); rect(g, 'white', x - 2, y - 2, 1, 1);
  }
  backs.set(rarity, c);
  return c;
}

/** A whole card as a white (or any colour) silhouette, for the flash frames. */
const sils = new Map();
export function silhouette(colour = 'white') {
  let c = sils.get(colour);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  bevel(c.getContext('2d'), colour, 0, 0, CW, CH, 4);
  sils.set(colour, c);
  return c;
}
