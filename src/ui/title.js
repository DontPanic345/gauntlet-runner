// Title screen and pause menu (piece `title`).
//
// The title: the hooded runner stands at the Gauntlet's mouth, a carved arch in the mountain
// with the collapse burning far down its stairs. Braziers, embers, dust, a tremor now and then.
// Over it: the GAUNTLET-RUNNER logo (built pixel by pixel here, not typed in a font) and the
// main menu (Start, Settings, Controls, Credits). Start sends the runner down into the arch and
// irises to black into the run.
//
// The pause menu sits over the frozen run (Resume, Settings, Controls, Quit to title).
//
//   createTitleScene({ menu: 'main' | 'settings' | 'controls' | 'credits', intro: true })
//   scenes 'title' and 'pause' are defined on import (main.js imports this module).
//   __GR.debug.title(action?, arg) -> info; actions: 'open' page, 'focus' i, 'select',
//     'back', 'start', 'tremor', 'logo' (re-ignite)

import * as THREE from 'three';
import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { feedback } from '../core/feedback.js';
import { settings } from '../core/settings.js';
import { drawText } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { look } from '../render/look.js';
import { defineModel, voxelMesh, getModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { buildPropModels, bannerModels } from '../world/props.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { vfx } from '../vfx/vfx.js';
import { Rng } from '../core/rng.js';
import { MenuStack, Sparks, uiSound, ditherRect, wipe, easeOut, layer, blitLayer } from './menus.js';
import { settingsPage, controlsPage, creditsPage, confirmPage, menuBindHandler } from './settings.js';

const V = VOXEL;
const TAU = Math.PI * 2;
export const VERSION = 'V0.1';

// =====================================================================================================
// The logo
// =====================================================================================================
// Letters are drawn on a 7x9 grid with two-pixel strokes, scaled up, then dressed as carved stone
// slabs: lit top bevel, dithered body, an extruded underside, a one-pixel ink outline, and
// ember cracks that glow and shed sparks. RUNNER is molten metal riding a sword.
const GLYPHS = {
  G: ['.######', '#######', '##.....', '##.....', '##..###', '##..###', '##...##', '#######', '.#####.'],
  A: ['.#####.', '#######', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##'],
  U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '.#####.'],
  N: ['##...##', '###..##', '####.##', '#######', '##.####', '##..###', '##...##', '##...##', '##...##'],
  T: ['#######', '#######', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..'],
  L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######', '#######'],
  E: ['#######', '#######', '##.....', '##.....', '######.', '######.', '##.....', '#######', '#######'],
  R: ['######.', '#######', '##...##', '##...##', '######.', '#####..', '##.###.', '##..###', '##...##'],
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16;

function wordMask(word, s, track = 1) {
  const w = word.length * 7 * s + (word.length - 1) * track * s;
  const h = 9 * s;
  const m = new Uint8Array(w * h);
  const letters = [];
  [...word].forEach((ch, li) => {
    const gl = GLYPHS[ch];
    const ox = li * (7 + track) * s;
    letters.push({ ch, x: ox, w: 7 * s });
    for (let gy = 0; gy < 9; gy++) for (let gx = 0; gx < 7; gx++) {
      if (gl[gy][gx] !== '#') continue;
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) m[(gy * s + yy) * w + ox + gx * s + xx] = 1 + li;
    }
  });
  return { m, w, h, letters };
}

/** Build the static logo layers once. Returns { canvas, w, h, cracks, runner, sword... } */
function buildLogo() {
  const S1 = 5, S2 = 4;
  const top = wordMask('GAUNTLET', S1, 1);
  const bot = wordMask('RUNNER', S2, 1);
  const D1 = 6, D2 = 4;           // extrusion depth (px)
  const swordLen = 360;
  const W = Math.max(top.w, swordLen) + 8;
  const topX = Math.round((W - top.w) / 2), topY = 2;
  const swordY = topY + top.h + D1 + 9;
  const botX = Math.round((W - bot.w) / 2), botY = swordY - 9;
  const H = botY + bot.h + D2 + 4;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const g = cnv.getContext('2d');
  const px = (x, y, c) => { g.fillStyle = css(c); g.fillRect(x, y, 1, 1); };
  const at = (M, x, y) => (x < 0 || y < 0 || x >= M.w || y >= M.h ? 0 : M.m[y * M.w + x]);

  // union mask on the canvas for the outline pass
  const U = new Uint8Array(W * H);
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) U[y * W + x] = 1; };

  // ---- sword (behind RUNNER): pommel, grip, guard, blade, tip ------------------------------
  const sx0 = Math.round((W - swordLen) / 2);
  const sword = [];
  const sp = (x, y, c) => { sword.push([x, y, c]); mark(x, y); };
  for (let x = 0; x < swordLen; x++) {
    const X = sx0 + x;
    if (x < 6) { for (let y = -2; y <= 2; y++) if (Math.abs(y) + (x < 1 || x > 4 ? 1 : 0) <= 2) sp(X, swordY + y, y < 0 ? 'torch' : y === 0 ? 'gold' : 'flame'); }
    else if (x < 30) { for (let y = -1; y <= 1; y++) sp(X, swordY + y, (x % 4 === 0) ? 'woodLight' : y < 0 ? 'woodLight' : y === 0 ? 'wood' : 'dirt'); }
    else if (x < 35) { for (let y = -8; y <= 8; y++) sp(X, swordY + y, x === 30 ? 'bone' : x === 34 ? 'slate' : Math.abs(y) > 6 ? 'gold' : 'fog'); }
    else {
      const tipLen = 22;
      const remain = swordLen - x;
      const half = remain < tipLen ? Math.round(2 * remain / tipLen) : 2;
      for (let y = -half; y <= half; y++) sp(X, swordY + y, y === -half ? 'white' : y < 0 ? 'frost' : y === 0 ? 'fog' : y === half ? 'slate' : 'mist');
      if (x > 40 && x < swordLen - tipLen - 2 && half === 2) sword.push([X, swordY, 'mist']); // fuller
    }
  }
  // ---- extrusions (draw first, faces on top) ------------------------------------------------
  const ext = (M, ox, oy, D, cols) => {
    for (let d = D; d >= 1; d--) {
      const c = cols[Math.min(cols.length - 1, Math.floor((d - 1) / D * cols.length))];
      for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) if (at(M, x, y)) { px(ox + x, oy + y + d, c); mark(ox + x, oy + y + d); }
    }
  };
  // ---- outline pass first (ink, 1 px around the union, 2 px below) -----------------------------
  for (let y = 0; y < top.h; y++) for (let x = 0; x < top.w; x++) if (at(top, x, y)) for (let d = 0; d <= D1; d++) mark(topX + x, topY + y + d);
  for (let y = 0; y < bot.h; y++) for (let x = 0; x < bot.w; x++) if (at(bot, x, y)) for (let d = 0; d <= D2; d++) mark(botX + x, botY + y + d);
  g.fillStyle = css('ink');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (U[y * W + x]) continue;
    let near = false;
    for (let dy = -1; dy <= 2 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dy === 2 && dx !== 0) continue;
      const X = x + dx, Y = y - dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && U[Y * W + X]) { near = true; break; }
    }
    if (near) g.fillRect(x, y, 1, 1);
  }
  for (const [x, y, c] of sword) px(x, y, c);
  ext(top, topX, topY, D1, ['stone', 'stoneDark', 'night']);
  ext(bot, botX, botY, D2, ['blood', 'blood', 'night']);

  // ---- GAUNTLET faces: carved stone ---------------------------------------------------------
  for (let y = 0; y < top.h; y++) for (let x = 0; x < top.w; x++) {
    if (!at(top, x, y)) continue;
    const up = !at(top, x, y - 1), up2 = !at(top, x, y - 2), left = !at(top, x - 1, y), right = !at(top, x + 1, y);
    const down = !at(top, x, y + 1);
    let c;
    const k = y / top.h;
    if (up) c = 'white';
    else if (up2) c = 'bone';
    else if (left) c = 'frost';
    else if (down) c = 'slate';
    else if (right) c = 'mist';
    else c = k < 0.42 ? (bayer(x, y) < 0.15 ? 'frost' : 'fog') : k < 0.7 ? (bayer(x, y) < (k - 0.42) / 0.28 ? 'mist' : 'fog') : (bayer(x, y) < 0.2 ? 'slate' : 'mist');
    px(topX + x, topY + y, c);
  }
  // chisel marks: tiny dark nicks so the slabs read as stone, not plastic
  const R = new Rng('title.logo');
  for (let i = 0; i < 70; i++) {
    const x = R.int(0, top.w - 1), y = R.int(3, top.h - 3);
    if (at(top, x, y) && at(top, x + 1, y) && at(top, x, y - 1) && at(top, x, y + 1)) px(topX + x, topY + y, R.chance(0.5) ? 'slate' : 'mist');
  }
  // ---- cracks: random walks from a letter's edge into its body ---------------------------------
  const cracks = [];
  top.letters.forEach((L, li) => {
    const n = li % 3 === 1 ? 2 : 1;
    for (let c = 0; c < n; c++) {
      let x = L.x + R.int(2, L.w - 3), y = R.chance(0.5) ? 2 : top.h - 4;
      if (!at(top, x, y)) { const cands = []; for (let yy = 2; yy < top.h - 2; yy++) for (let xx = L.x; xx < L.x + L.w; xx++) if (at(top, xx, yy) === li + 1) cands.push([xx, yy]); [x, y] = R.pick(cands); }
      const pts = [];
      const dy = y < top.h / 2 ? 1 : -1;
      const len = R.int(12, 22);
      for (let s = 0; s < len; s++) {
        if (at(top, x, y)) pts.push([topX + x, topY + y]);
        const r = R.next();
        if (r < 0.45) y += dy; else if (r < 0.72) x += 1; else if (r < 0.95) x -= 1; else { x += R.chance(0.5) ? 1 : -1; y += dy; }
      }
      if (pts.length > 3) {
        for (const [X, Y] of pts) { px(X, Y, 'ink'); px(X + 1, Y, 'ink'); px(X, Y + 1, 'ink'); px(X + 1, Y + 1, 'blood'); }
        cracks.push({ pts, phase: R.range(0, TAU), speed: R.range(0.7, 1.4), li });
      }
    }
  });
  // ---- RUNNER faces: molten metal -------------------------------------------------------------
  const runner = [];
  for (let y = 0; y < bot.h; y++) for (let x = 0; x < bot.w; x++) {
    if (!at(bot, x, y)) continue;
    const up = !at(bot, x, y - 1), down = !at(bot, x, y + 1), left = !at(bot, x - 1, y);
    const k = y / bot.h;
    let c;
    if (up) c = 'torch';
    else if (left) c = 'gold';
    else if (down) c = 'blood';
    else c = k < 0.35 ? 'gold' : k < 0.62 ? (bayer(x, y) < (k - 0.35) / 0.27 ? 'flame' : 'gold') : k < 0.85 ? (bayer(x, y) < (k - 0.62) / 0.23 ? 'ember' : 'flame') : 'ember';
    px(botX + x, botY + y, c);
    runner.push([botX + x, botY + y, c, up]);
  }
  // masks for the glint sweep (stone faces only) and the heat band (RUNNER)
  const faceMask = document.createElement('canvas');
  faceMask.width = W; faceMask.height = H;
  const fg = faceMask.getContext('2d');
  fg.fillStyle = '#fff';
  for (let y = 0; y < top.h; y++) for (let x = 0; x < top.w; x++) if (at(top, x, y)) fg.fillRect(topX + x, topY + y, 1, 1);
  for (const [x, y] of sword) if (x > sx0 + 34) fg.fillRect(x, y, 1, 1);

  return { canvas: cnv, w: W, h: H, cracks, runner, faceMask, top: { x: topX, y: topY, w: top.w, h: top.h }, bot: { x: botX, y: botY, w: bot.w, h: bot.h }, swordY, sx0, swordLen };
}

let LOGO = null;
const sweepC = document.createElement('canvas');

/** Draw the logo with its live layers: crack glow, heat shimmer on RUNNER, a glint sweep. */
function drawLogo(g, x, y, t, sparks, { ignite = 1, surge = 0 } = {}) {
  if (!LOGO) LOGO = buildLogo();
  const L = LOGO;
  x = Math.round(x); y = Math.round(y);
  g.drawImage(L.canvas, x, y);
  // RUNNER heat: a hot band drifts across the letters
  const band = ((t * 38) % (L.bot.w + 80)) - 40;
  for (const [px, py, , up] of L.runner) {
    const d = Math.abs(px - L.bot.x - band - (py - L.bot.y) * 0.6);
    if (d < 3 && !up) { g.fillStyle = css(d < 1.5 ? 'torch' : 'gold'); g.fillRect(x + px, y + py, 1, 1); }
  }
  // cracks: each pulses on its own clock, ignite reveals them left to right
  for (const c of L.cracks) {
    const lit = Math.min(1, Math.max(0, ignite * 1.5 - (c.pts[0][0] / L.w) * 0.5));
    if (lit <= 0) continue;
    const lv = lit * (0.55 + 0.45 * Math.sin(t * c.speed * 2.2 + c.phase)) + surge;
    const col = lv < 0.25 ? 'blood' : lv < 0.55 ? 'ember' : lv < 0.85 ? 'flame' : 'gold';
    c.pts.forEach(([px, py], i) => {
      const hot = lv > 0.55 && i % 3 === Math.floor(t * 6) % 3;
      g.fillStyle = css(hot && lv > 0.8 ? 'torch' : col);
      g.fillRect(x + px, y + py, 2, 1);
    });
    if (sparks && lit >= 1 && Math.random() < 0.012 + surge * 0.3) {
      const [px, py] = c.pts[Math.floor(Math.random() * c.pts.length)];
      sparks.emit(x + px, y + py, { vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 14, life: 0.8 + Math.random() * 0.9 });
    }
  }
  // glint: a bright diagonal sweeps the stone every few seconds
  const period = 5.5, gt = (t % period) / 0.7;
  if (gt < 1) {
    if (sweepC.width !== L.w || sweepC.height !== L.h) { sweepC.width = L.w; sweepC.height = L.h; }
    const s = sweepC.getContext('2d');
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, L.w, L.h);
    const bx = -40 + gt * (L.w + 80);
    for (let yy = 0; yy < L.h; yy++) {
      const xx = Math.round(bx - yy * 0.7);
      s.fillStyle = css('white'); s.fillRect(xx, yy, 3, 1);
      s.fillStyle = css('bone'); s.fillRect(xx + 3, yy, 2, 1);
    }
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(L.faceMask, 0, 0);
    g.drawImage(sweepC, x, y);
  }
}

// =====================================================================================================
// The 3D backdrop: the Gauntlet's mouth
// =====================================================================================================
let modelsBuilt = false;
// One voxel is 1/8 unit. The arch is 44 voxels wide and 52 tall: the runner (11) is small beside it.
const CLIFF = { sx: 176, sy: 116, sz: 34, floorY: 12 };
const ARCH = { cx: 88, half: 22, spring: 12 + 30 };   // arch opening: centre x, half width, spring line (y)

function buildModels() {
  if (modelsBuilt) return;
  modelsBuilt = true;
  buildPropModels();
  const R = new Rng('title.cliff');
  const { sx, sy, sz, floorY } = CLIFF;
  const g = new VoxelGrid(sx, sy, sz);
  const front = sz - 1;
  const hash = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const cx = ARCH.cx, half = ARCH.half, spring = ARCH.spring;
  const inArch = (x, y, h = half) => {
    const dx = x + 0.5 - cx;
    if (y < spring) return Math.abs(dx) < h;
    return Math.hypot(dx, y + 0.5 - spring) < h;
  };
  const ringR = (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - spring);
  const apex = spring + half;
  // the ridge: twin shoulders of the mountain with a saddle over the gate, jagged
  const topAt = (x) => {
    const d = Math.abs(x + 0.5 - cx);
    return Math.round(apex + 13 + Math.max(0, d - 26) * 0.75 + (vn(x * 0.12, 3) - 0.5) * 8 + (vn(x * 0.5, 9) - 0.5) * 4);
  };
  const BW = 12, BH = 6;   // masonry block size
  const brick = (x, y) => {
    const row = Math.floor((y - floorY) / BH);
    const o = (row % 2) * (BW / 2);
    return { row, bx: Math.floor((x + o) / BW), mortar: (y - floorY) % BH === BH - 1 || (x + o) % BW === 0 };
  };
  for (let x = 0; x < sx; x++) {
    const tH = Math.min(sy - 1, topAt(x));
    for (let y = floorY; y <= tH; y++) {
      if (inArch(x, y)) continue;
      const dxA = Math.abs(x + 0.5 - cx);
      const masonry = dxA < half + 20 + ((y * 7) % 3) && y < apex + 8 - Math.max(0, dxA - half - 10) * 0.3;
      let fz, c;
      if (masonry) {
        const b = brick(x, y);
        const h = hash(b.bx * 3, b.row * 7);
        fz = front - 3 - (b.mortar ? 1 : 0) - (h < 0.15 ? 1 : 0) + (h > 0.93 ? 1 : 0);
        c = b.mortar ? 'stoneDark' : h < 0.22 ? 'violet' : h < 0.82 ? 'stone' : 'stoneLight';
        if (!b.mortar && hash(x, y) < 0.04) c = 'stoneDark';   // pitting
      } else {
        fz = front - 3 - Math.floor(vn(x * 0.2, y * 0.2) * 3.5) - (vn(x * 0.8, y * 0.8) > 0.8 ? 1 : 0);
        const n = vn(x * 0.25, y * 0.25);
        c = n < 0.3 ? 'stoneDark' : n < 0.6 ? 'stone' : n < 0.8 ? 'violet' : 'dusk';
      }
      // strata darken toward the summit: the mountain melts into the night
      if (y > apex + 14 && hash(x, y) < (y - apex - 14) / 30) c = 'shadow';
      const back = Math.max(0, front - 14 - Math.floor(vn(x * 0.1, y * 0.1) * 4));
      for (let z = back; z <= fz; z++) g.set(x, y, z, c);
      // weathering: moss on the skyline and on ledges, grime at the foot
      if (y === tH && R.chance(0.6)) g.set(x, y, fz, R.chance(0.6) ? 'moss' : 'leaf');
      else if (y < floorY + 3 && R.chance(0.35)) g.set(x, y, fz, 'dusk');
    }
  }
  // voussoirs: a ring of wedge stones around the arch, standing proud of the wall
  const RING = 7, SEGS = 15;
  for (let x = cx - half - RING - 1; x <= cx + half + RING + 1; x++) for (let y = floorY; y < apex + RING + 2; y++) {
    const dx = x + 0.5 - cx;
    let inRing = false, seg = 0, joint = false;
    if (y < spring) {
      inRing = Math.abs(dx) >= half && Math.abs(dx) < half + RING - 1;
      seg = Math.floor((y - floorY) / 6);
      joint = (y - floorY) % 6 === 5;
    } else {
      const r = ringR(x, y);
      inRing = r >= half && r < half + RING;
      const a = (Math.atan2(y + 0.5 - spring, dx) / Math.PI) * SEGS;
      seg = Math.floor(a);
      joint = Math.abs(a - Math.round(a)) < 0.07 * (half / r) * 1.6;
    }
    if (!inRing) continue;
    const edge = y >= spring ? ringR(x, y) < half + 1 : Math.abs(dx) < half + 1;
    for (let z = front - 6; z <= front - (joint ? 2 : 0); z++) g.set(x, y, z, joint ? 'stoneDark' : edge ? 'stoneLight' : seg % 2 ? 'stoneLight' : 'fog');
  }
  // impost blocks at the spring line, plinths at the foot of the jambs
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? cx - half - RING - 1 : cx + half, x1 = x0 + RING;
    g.box(x0, spring - 2, front - 6, x1, spring, front, 'stoneLight');
    g.box(x0, spring, front - 6, x1, spring, front, 'fog');
    g.box(x0, floorY, front - 6, x1, floorY + 3, front, 'stone');
    g.box(x0, floorY + 3, front - 6, x1, floorY + 3, front, 'stoneLight');
  }
  // keystone with a skull, ember eyes (every skull voxel doubled)
  const kw = 16, kh = 16, ky = apex - 3;
  g.box(cx - kw / 2, ky, front - 6, cx + kw / 2 - 1, ky + kh - 1, front, 'stoneLight');
  g.box(cx - kw / 2, ky + kh - 1, front - 6, cx + kw / 2 - 1, ky + kh - 1, front, 'fog');
  g.box(cx - kw / 2 + 1, ky + kh, front - 4, cx + kw / 2 - 2, ky + kh + 1, front - 1, 'stoneLight');
  const SKULL = ['.#####.', '#######', '#ee#ee#', '#ee#ee#', '###.###', '.#####.', '.#.#.#.'];
  SKULL.forEach((row, r) => [...row].forEach((ch, c) => {
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const X = cx - 7 + c * 2 + xx, Y = ky + kh - 2 - r * 2 - yy;
      if (ch === '#') g.set(X, Y, front, 'bone');
      else if (ch === 'e') { g.set(X, Y, front, null); g.set(X, Y, front - 1, 'ember', true); }
      else { g.set(X, Y, front, null); g.set(X, Y, front - 1, 'stoneDark'); }
    }
  }));
  // runes cut down the jambs: a few lit
  for (const side of [-1, 1]) {
    const rx = side < 0 ? cx - half - 4 : cx + half + 3;
    for (let k = 0; k < 5; k++) {
      const y = floorY + 6 + k * 6;
      const lit = (k + (side > 0 ? 1 : 0)) % 2 === 0;
      const col = lit ? 'ember' : 'blood';
      for (const [ox, oy] of [[0, 0], [0, 1], [0, 2], [0, 3], [-side, 1], [side, 3]]) g.set(rx + ox, y + oy, front, col, lit);
    }
  }
  // the tunnel: a vault going back, stairs down into the dark, the collapse burning at the bottom
  const RAMP = ['stone', 'stone', 'dusk', 'dusk', 'shadow', 'shadow', 'night', 'night', 'night', 'night', 'night', 'night', 'night'];
  for (let z = 0; z <= front; z++) {
    const depth = front - z;
    const step = Math.min(floorY, Math.floor(depth / 3));
    const fy = floorY - step;          // floor top (exclusive)
    for (let x = cx - half - 3; x <= cx + half + 2; x++) for (let y = 0; y <= apex + 3; y++) {
      if (!inArch(x, y)) { if (!g.get(x, y, z)) g.set(x, y, z, depth > 10 ? 'night' : 'shadow'); continue; }
      if (y >= fy) continue;
      const nosing = y === fy - 1 && depth % 3 === 0;
      const r = Math.min(RAMP.length - 2, Math.floor(depth / 3));
      g.set(x, y, z, nosing ? RAMP[Math.max(0, r - 1)] : y === fy - 1 ? RAMP[r] : RAMP[r + 1]);
    }
    for (let x = cx - half; x < cx + half; x++) {
      if (z < 7) {
        // the burning pool at the foot of the stairs
        const n = vn(x * 0.4, z * 0.6);
        g.set(x, fy - 1, z, n > 0.7 ? 'gold' : n > 0.4 ? 'flame' : 'ember', true);
      } else if (depth > 18 && R.chance(0.006 + depth * 0.001)) g.set(x, fy, z, 'ember', true);
    }
  }
  // the back of the tunnel: dark rock split by glowing fissures, a burning pool at the bottom
  for (let z = 0; z < 4; z++) for (let x = cx - half; x < cx + half; x++) for (let y = 0; y <= apex; y++) {
    if (!inArch(x, y)) continue;
    const n = vn(x * 0.3, y * 0.3 + z * 0.3);
    const fissure = Math.abs(vn(x * 0.15 + 7, y * 0.2) - 0.5) < 0.03 + Math.max(0, 8 - y) * 0.02;
    let c = n > 0.62 ? 'shadow' : 'night', em = false;
    if (y < 3) { c = n > 0.6 ? 'gold' : 'flame'; em = true; }
    else if (y < 5) { c = n > 0.45 ? 'flame' : 'ember'; em = true; }
    else if (fissure) { c = y < 12 ? 'flame' : y < 22 ? 'ember' : 'blood'; em = y < 22; }
    else if (y < 9 && n > 0.5) c = 'blood';
    g.set(x, y, z, c, em);
  }
  defineModel('title.cliff', { grid: g, origin: [sx / 2, floorY, sz] });

  // courtyard: worn flagstones, mortar, cracks and moss, a path worn toward the arch
  {
    const fx = 176, fz = 64;
    const f = new VoxelGrid(fx, 3, fz);
    const RF = new Rng('title.floor');
    const slabW = (r) => 10 + ((r * 7) % 5);
    for (let z = 0; z < fz; z++) {
      const row = Math.floor(z / 9);
      const off = (row * 5) % 9;
      for (let x = 0; x < fx; x++) {
        const mortar = z % 9 === 8 || (x + off) % slabW(row) === 0;
        const id = Math.floor((x + off) / slabW(row)) * 31 + row * 17;
        const h = hash(id, row);
        const path = Math.abs(x - fx / 2) < 18 - z * 0.12;
        let c = h < 0.2 ? 'violet' : h < 0.78 ? 'stone' : 'stoneLight';
        if (path && !mortar && h < 0.78) c = hash(x, z) < 0.5 ? 'stoneLight' : 'stone';
        f.box(x, 0, z, x, 1, z, 'stoneDark');
        if (!mortar) f.set(x, 2, z, c);
        else if (RF.chance(z < 10 ? 0.4 : 0.12)) f.set(x, 2, z, RF.chance(0.7) ? 'moss' : 'leaf');
      }
    }
    for (let k = 0; k < 30; k++) {
      let x = RF.int(4, fx - 5), z = RF.int(2, fz - 3);
      for (let s = 0; s < RF.int(4, 10); s++) { f.set(x, 2, z, null); x += RF.int(-1, 1); z += RF.chance(0.5) ? 1 : 0; }
    }
    defineModel('title.floor', { grid: f, origin: [fx / 2, 3, 0] });
  }
}

// placed set dressing: [model, x, z, yaw]
const DRESSING = [
  ['arena.rubble', -3.0, -2.35, 0.4], ['arena.rubble', 3.1, -2.3, 2.1], ['arena.rubble', -7.4, -2.0, 1.2],
  ['arena.bones', -3.6, -0.6, 0.9], ['arena.bones.scatter', 2.6, -0.2, 2.6], ['arena.skullpile', -6.4, -1.6, 0.3],
  ['arena.candles', -4.6, -2.3, 0], ['arena.candles', 4.5, -2.35, 0.5], ['arena.urn.1', 6.6, -2.0, 0.2],
  ['arena.pillar.2', -8.6, -1.8, 0], ['arena.pillar.1', 8.4, -1.8, 0], ['arena.shards', 1.4, 0.2, 0.3],
  ['arena.sarcophagus', 6.2, -0.4, 0.15], ['arena.urn.0', -5.3, -2.2, 1.1],
];

const CAM = { x: -1.2, y: 5.1, z: -2.6 };
const HERO = { x: 0.3, z: -1.75, yaw: 0.35 };
const BRAZIERS = [[-3.7, -2.2], [3.7, -2.2]];

/**
 * The title scene. opts.menu: page to open first ('main' | 'settings' | 'controls' | 'credits').
 * opts.intro: false skips the logo ignite.
 */
export function createTitleScene(opts = {}) {
  let banners = [];
  let rig, anim, amb, grit, glow, stack, sparks, t, hero, tremorAt, tremorT, starting, surge, logoT0;

  function mainPage() {
    return {
      id: 'main', style: 'title', footerAlign: 'right',
      items: [
        { kind: 'action', id: 'start', label: 'START RUN', silent: true, onSelect: () => startRun() },
        { kind: 'action', id: 'settings', label: 'SETTINGS', onSelect: (s) => s.open(settingsPage(), { silent: true }) },
        { kind: 'action', id: 'controls', label: 'CONTROLS', onSelect: (s) => s.open(controlsPage(), { silent: true }) },
        { kind: 'action', id: 'credits', label: 'CREDITS', onSelect: (s) => s.open(creditsPage(), { silent: true }) },
      ],
    };
  }

  function startRun() {
    if (starting) return;
    starting = { t0: t, ticks: 0, wiped: false };
    stack.enabled = false;
    uiSound('ui.start');
    feedback.shake(3, 320);
    feedback.flash('torch', 160, 0.3);   // settings-scaled (flashes)
    surge = 1;
    glow.intensity = 3.4;
  }

  function tremor() {
    tremorT = 0;
    tremorAt = t + 9 + Math.random() * 6;
    feedback.shake(1.6, 700);
    uiSound('ui.rumble');
    grit.set({ grit: 90 });
    // dust shaken loose at the foot of both jambs
    for (const x of [-3.0, 3.0]) vfx.dust(x, -2.45, { n: 8, size: 1.2, dz: 1, spread: 0.6 });
    surge = Math.max(surge, 0.5);
  }

  const def = {
    enter(data, root) {
      buildModels();
      world.reset();
      world.room = null;
      display.setZoom(opts.zoom ?? 1);
      look.mood('crypt');
      t = 0; surge = 0; starting = null; tremorT = -1; tremorAt = 6 + Math.random() * 3;
      logoT0 = opts.intro === false ? -10 : 0;

      const cliff = voxelMesh('title.cliff');
      cliff.position.set(0, 0, -2.6);
      root.add(cliff);
      const floor = voxelMesh('title.floor');
      floor.position.set(0, 0, -2.6);
      root.add(floor);
      for (const [name, x, z, yaw] of DRESSING) {
        const m = voxelMesh(name);
        m.position.set(x, 0, z); m.rotation.y = yaw;
        root.add(m);
      }
      // banners either side of the arch; they stir now and then (3 cloth frames)
      banners = [];
      const cloth = bannerModels(['blood', 'plum', 'gold']);
      for (const [x, ph] of [[-5.3, 0], [5.3, 1.7]]) {
        const m = voxelMesh(cloth[0]);
        m.position.set(x, 5.0, -2.95);
        root.add(m);
        banners.push({ m, frames: cloth, ph, cur: 0 });
      }
      const fires = [];
      for (const [x, z] of BRAZIERS) {
        const b = voxelMesh('arena.brazier');
        b.position.set(x, 0, z);
        root.add(b);
        look.torch(b, { y: 1.55, color: 'flame', intensity: 1.2, radius: 5.2 });
        fires.push([x, 10 * V, z, 1.3]);
      }
      // the collapse's glow far down the stairs, and a warm spill on the top steps
      const deep = new THREE.Object3D(); deep.position.set(0, -0.6, -6.3); root.add(deep);
      glow = look.torch(deep, { color: 'ember', intensity: 2.2, radius: 8, flicker: 1.6 });
      const mouth = new THREE.Object3D(); mouth.position.set(0, -0.4, -4.6); root.add(mouth);
      look.torch(mouth, { color: 'ember', intensity: 0.6, radius: 3.2, flicker: 1.2, haze: 0 });
      // cold light from a crack high above, on the runner
      const shaft = new THREE.Object3D(); shaft.position.set(HERO.x - 0.3, 4.0, HERO.z + 0.9); root.add(shaft);
      look.torch(shaft, { color: 'frost', intensity: 0.9, radius: 5, flicker: 0, haze: 0 });

      amb = vfx.ambient({ preset: 'crypt', box: [-10, 8, 0.2, 6, -2.6, 2.6], dust: 90, fires, sources: [[0, 0.2, -3.2], [-1.4, 0.1, -3.4], [1.4, 0.1, -3.4], [0, -0.5, -4.5], ...fires.map((f) => [f[0], f[1] + 0.2, f[2]])], embers: 3 });
      grit = vfx.ambient({ preset: 'collapse', box: [-3.0, 3.0, 0.1, 7.4, -2.85, -2.55], dust: 0, embers: 0, floorEmbers: 0, grit: 0 });

      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: HERO.x, z: HERO.z, yaw: HERO.yaw });
      hero = { x: HERO.x, z: HERO.z, face: HERO.yaw };
      // settle the cloak and scarf before the first frame is drawn
      for (let i = 0; i < 40; i++) anim.tick({ x: hero.x, z: hero.z, face: hero.face, speed: 0 });

      sparks = new Sparks(220);
      stack = new MenuStack({ sparks, onBind: menuBindHandler, onEmpty: () => uiSound('ui.deny') });
      stack.reset(mainPage());
      const want = data?.menu ?? opts.menu;
      if (want === 'settings') stack.open(settingsPage(), { silent: true });
      else if (want === 'controls') stack.open(controlsPage(), { silent: true });
      else if (want === 'credits') stack.open(creditsPage(), { silent: true });
      if (want && want !== 'main') { stack.out = null; stack.page.t0 = -1; }
      active = api;
      display.setCameraTarget(CAM.x, CAM.y, CAM.z);
    },
    exit() {
      if (stack?.listen) stack.listen.off();
      if (active === api) active = null;
      amb?.stop(); grit?.stop();
    },
    tick() {
      // the runner: idle at the edge, or running down into the arch once Start is pressed
      // (on sim ticks, so debug.timeScale slows the whole send-off for captures)
      if (starting) {
        const st = ++starting.ticks;
        if (st > 12) {
          const tx = 0, tz = -4.4;
          const dx = tx - hero.x, dz = tz - hero.z, d = Math.hypot(dx, dz);
          const sp = Math.min(4.2, 1.5 + (st - 12) * 0.16) * DT;
          if (d > 0.05) { hero.x += dx / d * Math.min(sp, d); hero.z += dz / d * Math.min(sp, d); }
          hero.face = Math.atan2(dx, dz);
          if (st % 6 === 0) vfx.dust(hero.x, hero.z, { dx: -dx / d, dz: -dz / d, n: 3, size: 0.8 });
        } else hero.face = Math.PI;
        if (st === 44 && !starting.wiped) {
          starting.wiped = true;
          const p = display.worldToScreen(0, 0.4, -3.3);
          wipe.close(p.x, p.y, 0.6, () => { scenes.go('run', { room: 0 }); wipe.open(0.55); });
        }
      }
      anim.tick({ x: hero.x, z: hero.z, face: hero.face });
      if (tremorT >= 0) { tremorT++; if (tremorT === 50) grit.set({ grit: 0 }); }
    },
    frame(realDt) {
      t += realDt;
      surge = Math.max(0, surge - realDt * 0.9);
      if (glow && !starting) glow.intensity = 2.2 + surge * 1.4 + Math.sin(t * 0.9) * 0.25;
      if (t > tremorAt && !starting) tremor();
      stack.frame(realDt);
    },
    render(alpha) {
      anim.render(alpha);
      for (const b of banners) {
        // a slow sway with a gust now and then: frame 0 rest, 1 and 2 lean either way
        const w = Math.sin(t * 0.8 + b.ph) + (surge > 0.3 ? 1.2 : 0);
        const f = w > 0.75 ? 1 : w < -0.75 ? 2 : 0;
        if (f !== b.cur) { b.cur = f; b.m.geometry = getModel(b.frames[f]).geometry; }
      }
      display.setCameraTarget(CAM.x, CAM.y, CAM.z);
    },
    ui(g) {
      if (opts.ui === false) return;
      const W = display.width, H = display.height;
      const L = LOGO ?? (LOGO = buildLogo());
      const sub = stack.page?.style === 'panel';
      // the logo hangs over the dark above the mountain, breathing one pixel
      // centred over the arch (the camera is offset so the menu has the left third)
      const ax = display.worldToScreen(0, 0, -2.6).x;
      let lx = Math.round(Math.max(4, Math.min(W - L.w - 4, ax - L.w / 2))), ly = 10 + (Math.sin(t * 1.6) > 0.55 ? -1 : 0);
      if (tremorT >= 0 && tremorT < 42) {
        // the tremor rattles the logo too, and shakes grit off its underside
        const k = 1 - tremorT / 42;
        lx += Math.round(((tremorT >> 1) % 2 ? 1 : -1) * k * 1.6);
        if (!sub && Math.random() < 0.6 * k) sparks.emit(lx + L.top.x + Math.random() * L.top.w, ly + L.top.y + L.top.h + 6, { vx: 0, vy: 10, grav: 160, wob: 0, life: 0.7, cols: ['fog', 'mist', 'slate'] });
      }
      const ignite = easeOut((t - logoT0 - 0.15) / 1.1);
      if (!sub) {
        // a dithered shade down the left third so the menu reads over the rock
        for (let i = 0; i < 14; i++) ditherRect(g, i * 18, 0, 18, H, 'ink', Math.max(0, 9 - i * 0.75));
        drawLogo(g, lx, ly, t, sparks, { ignite, surge });
      }
      else ditherRect(g, 0, 0, W, H, 'ink', 6);   // a sub-page: dim the scene with dither
      if (starting) {
        // the menu dissolves away as the runner turns for the arch
        const k = 1 - Math.min(1, (t - starting.t0) / 0.35);
        const L2 = layer();
        stack.draw(L2);
        blitLayer(g, k, -(1 - k) * 30, 0);
      } else stack.draw(g);
      if (!sub) {
        drawText(g, `${VERSION}  WAVE 1 BUILD`, 10, H - 12, 'slate');
      }
    },
    state() {
      const p = stack?.page;
      return {
        title: {
          page: p?.id ?? null, depth: stack?.pages.length ?? 0,
          focus: p ? p.focus : null, item: p?.items[p.focus]?.id ?? null,
          items: p ? p.items.filter((it) => it.kind !== 'gap').map((it) => it.id ?? it.label) : [],
          listening: !!stack?.listen, starting: !!starting, wipe: wipe.state,
          events: stack?.events.slice(-6) ?? [],
          settings: { master: settingsVal('masterVolume'), music: settingsVal('musicVolume'), sfx: settingsVal('sfxVolume'), shake: settingsVal('shake'), flashes: settingsVal('flashes'), keyDisplay: settingsVal('keyDisplay') },
        },
      };
    },
  };
  const api = {
    def,
    get stack() { return stack; },
    open(name) {
      const pages = { settings: settingsPage, controls: controlsPage, credits: creditsPage };
      if (name === 'main') { while (stack.pages.length > 1) stack.back({ silent: true }); return true; }
      if (!pages[name]) return false;
      stack.open(pages[name]());
      return true;
    },
    start: () => startRun(),
    tremor: () => tremor(),
    relight() { logoT0 = t; },
  };
  return api;
}

const settingsVal = (k) => settings.get(k);

let active = null;   // the live title or pause api, for debug.title

// =====================================================================================================
// Pause menu
// =====================================================================================================
function createPauseScene() {
  let stack, t0 = 0, t = 0;
  const roomLine = () => {
    const r = world.room;
    if (!r) return '';
    if (r.kind === 'boss') return 'THE WARDEN';
    if (r.kind === 'corridor') return `GAUNTLET ${((r.index ?? 1) | 0)}`;
    return `ARENA ${((r.index ?? 0) | 0) + 1} OF 5`;
  };
  const api = {
    get stack() { return stack; },
    open(name) {
      const pages = { settings: settingsPage, controls: controlsPage, credits: creditsPage };
      if (!pages[name]) return false;
      stack.open(pages[name]());
      return true;
    },
  };
  const def = {
    ownsPauseKey: true,   // main.js leaves Esc / P / Start to this menu while it is open
    enter() {
      t0 = loop.realTime; t = 0;
      stack = new MenuStack({ onBind: menuBindHandler, onEmpty: () => { uiSound('ui.back'); scenes.resume(); } });
      stack.reset({
        id: 'pause', style: 'panel', title: 'PAUSED', w: 230, backLabel: 'RESUME',
        extraTopH: 16,
        extraTop(g, box) {
          const s = roomLine();
          const h = world.hero;
          const line = [s, h ? `HP ${h.hp}/${h.maxHp}` : ''].filter(Boolean).join('   ');
          if (line) drawText(g, line, box.x + box.w / 2, box.y - 1, 'mist', { align: 'center' });
        },
        items: [
          { kind: 'action', id: 'resume', label: 'RESUME', silent: true, onSelect: () => { uiSound('ui.back'); scenes.resume(); } },
          { kind: 'action', id: 'settings', label: 'SETTINGS', onSelect: (s) => s.open(settingsPage(), { silent: true }) },
          { kind: 'action', id: 'controls', label: 'CONTROLS', onSelect: (s) => s.open(controlsPage(), { silent: true }) },
          { kind: 'gap' },
          {
            kind: 'action', id: 'quit', label: 'QUIT TO TITLE',
            onSelect: (s) => s.open(confirmPage({ title: 'ABANDON RUN?', text: 'YOUR PROGRESS IN THIS RUN IS LOST.', yesLabel: 'QUIT TO TITLE', noLabel: 'KEEP RUNNING', yes: () => { wipe.close(display.width / 2, display.height / 2, 0.45, () => { scenes.go('title'); wipe.open(0.5); }); s.enabled = false; } }), { silent: true }),
          },
        ],
      });
      uiSound('ui.open');
      active = api;
    },
    exit() { if (stack?.listen) stack.listen.off(); if (active === api) active = null; },
    frame(realDt) { t += realDt; stack.frame(realDt); },
    ui(g) {
      const W = display.width, H = display.height;
      const k = Math.min(1, (loop.realTime - t0) / 0.14);
      // dim the frozen run with an ordered dither of ink (palette-safe), heavier at the edges
      ditherRect(g, 0, 0, W, H, 'ink', Math.round(k * 8));
      ditherRect(g, 0, 0, W, 18, 'ink', Math.round(k * 12));
      ditherRect(g, 0, H - 26, W, 26, 'ink', Math.round(k * 12));
      stack.draw(g);
    },
    state() { const p = stack?.page; return { pauseMenu: { page: p?.id, item: p?.items[p.focus]?.id ?? null, depth: stack?.pages.length } }; },
  };
  api.def = def;
  return api;
}

// ---- register --------------------------------------------------------------------------------------
const titleApi = createTitleScene({});
scenes.define('title', titleApi.def);
const pauseApi = createPauseScene();
scenes.define('pause', pauseApi.def);

debug.add('title', (action, arg) => {
  const a = active;
  if (!a) return { ok: false, error: 'no title or pause menu is open' };
  const s = a.stack;
  switch (action) {
    case undefined: case null: case 'info': break;
    case 'open': if (!a.open(arg)) return { ok: false, error: `no page "${arg}" (settings, controls, credits, main)` }; break;
    case 'focus': s.setFocus(Math.max(0, Math.min(s.page.items.length - 1, arg | 0))); break;
    case 'select': s.activate(s.focusItem); break;
    case 'back': s.back(); break;
    case 'start': if (!a.start) return { ok: false, error: 'not on the title' }; a.start(); break;
    case 'tremor': if (!a.tremor) return { ok: false, error: 'not on the title' }; a.tremor(); break;
    case 'logo': a.relight?.(); break;
    default: return { ok: false, error: `unknown action "${action}"` };
  }
  const p = s.page;
  return { ok: true, scene: scenes.current, page: p?.id, depth: s.pages.length, focus: p?.focus, item: p?.items[p.focus]?.id ?? null, listening: !!s.listen, events: s.events.slice(-6) };
});
