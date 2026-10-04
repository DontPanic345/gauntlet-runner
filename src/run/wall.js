// Stone-block screen effects (piece `run-flow`), all on the 2D UI canvas at internal resolution:
//
//   createWall()      the transition: blocks drop in from above and stack into a wall that
//                     covers the screen, hold (a carved card on it), then fall away into the dark.
//   createCollapse()  the death: the frozen frame cracks along a brick grid from a point, then
//                     breaks into blocks that fall out of the screen in the order they cracked.
//
// Both use one brick grid (BW x BH cells, running bond), so the crack seams are the block edges.
// Everything runs on real time (they play over slow motion and while scenes swap).

import { display } from '../core/display.js';
import { css } from '../render/palette.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { ditherRect, ditherPattern } from '../ui/menus.js';

export const BW = 32, BH = 20;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- the brick grid -------------------------------------------------------------------------------
/** Cells covering W x H: {x, y, w, h, row, col, cx, cy}. Odd rows are offset half a brick. */
export function brickGrid(W, H) {
  const cells = [];
  const rows = Math.ceil(H / BH);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? -BW / 2 : 0;
    for (let x = off, c = 0; x < W; x += BW, c++) {
      const x0 = Math.max(0, x), x1 = Math.min(W, x + BW);
      cells.push({ x: x0, y: r * BH, w: x1 - x0, h: Math.min(BH, H - r * BH), row: r, col: c, cx: (x0 + x1) / 2, cy: r * BH + BH / 2 });
    }
  }
  return cells;
}

// ---- block art -------------------------------------------------------------------------------------
const TONES = [
  { face: 'stone', light: 'stoneLight', dark: 'stoneDark', grain: 'stoneDark' },
  { face: 'stoneDark', light: 'stone', dark: 'night', grain: 'shadow' },
  { face: 'dusk', light: 'violet', dark: 'shadow', grain: 'night' },
  { face: 'stone', light: 'stoneLight', dark: 'stoneDark', grain: 'dusk' },
];
let atlas = null;
const VARIANTS = 12;
/** A canvas of VARIANTS carved blocks, each BW x BH (mortar included on the bottom/right edge). */
function blockAtlas() {
  if (atlas) return atlas;
  atlas = document.createElement('canvas');
  atlas.width = BW * VARIANTS; atlas.height = BH;
  const g = atlas.getContext('2d');
  const rnd = mulberry(4242);
  for (let v = 0; v < VARIANTS; v++) {
    const T = TONES[v % TONES.length];
    const x = v * BW;
    g.fillStyle = css('ink'); g.fillRect(x, 0, BW, BH);                         // mortar
    g.fillStyle = css(T.face); g.fillRect(x + 1, 1, BW - 2, BH - 2);
    g.fillStyle = css(T.light); g.fillRect(x + 1, 1, BW - 2, 1); g.fillRect(x + 1, 1, 1, BH - 3);
    g.fillStyle = css(T.dark); g.fillRect(x + 2, BH - 3, BW - 3, 2); g.fillRect(x + BW - 3, 2, 2, BH - 4);
    // grain: a few dark flecks and a light chip
    for (let k = 0; k < 9; k++) {
      g.fillStyle = css(T.grain);
      g.fillRect(x + 3 + Math.floor(rnd() * (BW - 7)), 3 + Math.floor(rnd() * (BH - 7)), 1 + (rnd() < 0.3 ? 1 : 0), 1);
    }
    g.fillStyle = css(T.light); g.fillRect(x + 4 + Math.floor(rnd() * (BW - 10)), 3 + Math.floor(rnd() * 4), 2, 1);
    // a crack on some, a moss tuft on a few, an ember vein on one
    if (v % 3 === 1) {
      let cx = x + 6 + Math.floor(rnd() * (BW - 12)), cy = 2;
      g.fillStyle = css('ink');
      while (cy < BH - 3) { g.fillRect(cx, cy, 1, 1); cy++; if (rnd() < 0.45) cx += rnd() < 0.5 ? -1 : 1; }
    }
    if (v % 5 === 2) { g.fillStyle = css('moss'); g.fillRect(x + 2, BH - 4, 5, 1); g.fillRect(x + 3, BH - 5, 2, 1); g.fillStyle = css('leaf'); g.fillRect(x + 3, BH - 4, 1, 1); }
    if (v === 7) {
      let cx = x + 4, cy = 6 + Math.floor(rnd() * 6);
      for (let k = 0; k < BW - 9; k++) { g.fillStyle = css(k % 5 === 2 ? 'flame' : 'ember'); g.fillRect(cx + k, cy, 1, 1); if (rnd() < 0.3) cy += rnd() < 0.5 ? -1 : 1; cy = Math.max(3, Math.min(BH - 4, cy)); }
    }
  }
  return atlas;
}

/** dark: 0..1 ink dither over it. b.img (a canvas) draws that block's piece of an image instead. */
function drawBlock(g, v, x, y, w = BW, h = BH, dark = 0, src = null) {
  if (src) g.drawImage(src.img, src.x, src.y, w, h, Math.round(x), Math.round(y), w, h);
  else g.drawImage(blockAtlas(), v * BW, 0, w, h, Math.round(x), Math.round(y), w, h);
  if (dark > 0) ditherRect(g, Math.round(x), Math.round(y), w, h, 'ink', dark * 16);
}

// ---- dust puffs (2D) ---------------------------------------------------------------------------------
function createDust() {
  const P = [];
  return {
    puff(x, y, n = 4, { spread = 14, up = 10, cols = ['fog', 'mist', 'slate'] } = {}) {
      for (let i = 0; i < n && P.length < 260; i++) {
        P.push({ x: x + (Math.random() - 0.5) * spread, y, vx: (Math.random() - 0.5) * 40, vy: -up * (0.4 + Math.random()), t: 0, life: 0.35 + Math.random() * 0.35, s: Math.random() < 0.35 ? 2 : 1, cols });
      }
    },
    step(dt) {
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.t += dt;
        if (p.t >= p.life) { P.splice(i, 1); continue; }
        p.vx *= 0.92; p.vy = p.vy * 0.92 + 8 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      }
    },
    draw(g) {
      for (const p of P) {
        const k = p.t / p.life;
        g.fillStyle = css(p.cols[Math.min(p.cols.length - 1, Math.floor(k * p.cols.length))]);
        g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      }
    },
    get count() { return P.length; },
    clear() { P.length = 0; },
  };
}

// =====================================================================================================
// the transition wall
// =====================================================================================================
/**
 * const wall = createWall();
 * wall.close({ card: { title, sub, kicker }, fast, onCovered })   blocks stack up; onCovered once fully covered
 * wall.open()                                                      the wall falls away
 * wall.draw(g, realDt)                                             every frame (after the scene UI)
 * wall.state: null | 'closing' | 'closed' | 'opening'
 */
export function createWall({ sound = () => {} } = {}) {
  let st = null, t = 0, cells = [], card = null, onCovered = null, fast = false, W = 0, H = 0, soundT = 0;
  const dust = createDust();
  const api = {
    get state() { return st; },
    get t() { return t; },
    get fast() { return fast; },
    close({ card: c = null, fast: f = false, onCovered: cb = null } = {}) {
      W = display.width; H = display.height;
      cells = brickGrid(W, H);
      const rows = Math.ceil(H / BH);
      const rnd = mulberry(Date.now() & 0xffff);
      const rowGap = f ? 0.006 : 0.01;
      for (const b of cells) {
        b.v = rnd() < 0.035 ? 7 : (() => { let v; do v = Math.floor(rnd() * VARIANTS); while (v === 7); return v; })();
        // rubble, not masonry: a pixel of slop per block, darker toward the screen edges
        b.jx = Math.round(rnd() * 2 - 1); b.jy = rnd() < 0.3 ? 1 : 0;
        const e = Math.hypot((b.cx - W / 2) / (W / 2), (b.cy - H / 2) / (H / 2));
        b.shade = Math.max(0, Math.min(0.6, (e - 0.55) * 0.9));
        b.delay = (rows - 1 - b.row) * rowGap + rnd() * (f ? 0.03 : 0.05);
        b.y0 = -BH - 6 - rnd() * 24;   // every block falls in from above the screen
        b.src = null;
        b.landed = false; b.fall = null;
      }
      st = 'closing'; t = 0; card = c; onCovered = cb; fast = f; soundT = 0;
      sound('run.close');
    },
    open() {
      if (!st) return;
      const rnd = mulberry((Date.now() >> 3) & 0xffff);
      const cx = W / 2, cy = H / 2;
      for (const b of cells) {
        const d = Math.hypot((b.cx - cx) / W, (b.cy - cy) / H * 0.6);
        b.drop = { delay: d * (fast ? 0.18 : 0.32) + rnd() * 0.06, vx: (b.cx - cx) * 0.25 + (rnd() - 0.5) * 20, vy: -20 - rnd() * 40, x: b.x, y: b.y, puffed: false };
      }
      st = 'opening'; t = 0;
      sound('run.open');
    },
    /** No wall: this image (the screen as it was) breaks into blocks and falls away at once. */
    shatter(img, { fast: f = true, card: c = null } = {}) {
      W = display.width; H = display.height;
      cells = brickGrid(W, H);
      for (const b of cells) { b.v = 0; b.jx = 0; b.jy = 0; b.shade = 0; b.src = { img, x: b.x, y: b.y }; }
      card = c; fast = f; st = 'closed';
      api.open();
    },
    cancel() { st = null; dust.clear(); },
    /** True once every block is in place. */
    get covered() { return st === 'closed'; },
    draw(g, dt) {
      dust.step(dt);
      if (!st) { dust.draw(g); return; }
      t += dt;
      if (st === 'closing' || st === 'closed') {
        const G = fast ? 5200 : 3400;
        let all = true;
        if (st === 'closed') { g.fillStyle = css('ink'); g.fillRect(0, 0, W, H); }
        for (const b of cells) {
          if (st === 'closed') { drawBlock(g, b.v, b.x + b.jx, b.y + b.jy, b.w, b.h, b.shade); continue; }
          const tt = t - b.delay;
          if (tt <= 0) { all = false; continue; }
          let y = b.y0 + 0.5 * G * tt * tt;
          if (y >= b.y) {
            if (!b.landed) {
              b.landed = true; b.landT = t;
              if (b.row % 3 === 0 && b.col % 2 === 0) dust.puff(b.cx, b.y + b.h, 2, { spread: BW, up: 12 });
              if ((soundT += 1) % 9 === 0) sound('run.block', { rate: 0.8 + Math.random() * 0.4 });
            }
            const s = t - b.landT;
            y = b.y - (s < 0.08 ? Math.round(Math.sin(s / 0.08 * Math.PI) * 2) : 0);   // a tiny bounce
          } else all = false;
          drawBlock(g, b.v, b.x + b.jx, y + b.jy, b.w, b.h, b.shade);
        }
        if (all && st === 'closing') { st = 'closed'; t = 0; const cb = onCovered; onCovered = null; cb?.(); }
        if (st === 'closed') drawCard(g, card, 0);
      } else if (st === 'opening') {
        const G = fast ? 2600 : 1500;
        let any = false;
        for (const b of cells) {
          const d = b.drop, tt = t - d.delay;
          let x = b.x, y = b.y, dark = 0;
          if (tt > 0) {
            if (!d.puffed) { d.puffed = true; if (b.col % 3 === 0 && b.row % 2 === 0) dust.puff(b.cx, b.y, 2, { spread: BW, up: 6 }); }
            x = d.x + d.vx * tt; y = d.y + d.vy * tt + 0.5 * G * tt * tt;
            dark = Math.min(0.75, tt * (fast ? 2.4 : 1.6));
          }
          if (y < H + 2) {
            any = true;
            drawBlock(g, b.v, x + (b.jx ?? 0), y + (b.jy ?? 0), b.w, b.h, Math.max(dark, b.shade ?? 0), b.src);
            if (b.src && tt > 0) { g.fillStyle = css('ink'); g.fillRect(Math.round(x), Math.round(y), b.w, 1); g.fillRect(Math.round(x), Math.round(y), 1, b.h); }
          }
        }
        // the card falls with the wall's middle
        const ct = Math.max(0, t - (fast ? 0.05 : 0.12));
        if (card && 0.5 * G * ct * ct < H) drawCard(g, card, 0.5 * G * ct * ct, Math.min(0.7, ct * 1.6));
        if (!any) st = null;
      }
      dust.draw(g);
    },
  };

  function drawCard(g, c, dy = 0, dark = 0) {
    if (!c) return;
    const titleW = textWidth(c.title, 2);
    const subW = c.sub ? textWidth(c.sub) : 0;
    const w = Math.max(titleW, subW, c.kicker ? textWidth(c.kicker) : 0) + 40;
    const h = c.sub ? 50 : 36;
    const x = Math.round((W - w) / 2), y = Math.round(H / 2 - h / 2 + dy);
    // a carved plaque set into the wall
    g.fillStyle = css('ink'); g.fillRect(x - 2, y - 2, w + 4, h + 5);
    g.fillStyle = css('night'); g.fillRect(x, y, w, h + 2);
    g.fillStyle = css('shadow'); g.fillRect(x, y, w, h);
    g.fillStyle = css('violet'); g.fillRect(x, y, w, 1);
    g.fillStyle = css(c.accent ?? 'ember'); g.fillRect(x + 8, y + h - 4, w - 16, 1);
    g.fillStyle = css('blood'); g.fillRect(x + 8, y + h - 3, w - 16, 1);
    let cy = y + 7;
    if (c.kicker) { drawText(g, c.kicker, W / 2, cy, c.kickerColor ?? 'fog', { align: 'center', shadow: 'ink' }); cy += 11; }
    drawText(g, c.title, W / 2, cy, c.color ?? 'bone', { align: 'center', scale: 2, shadow: 'ink' });
    cy += 18;
    if (c.sub) drawText(g, c.sub, W / 2, cy, c.subColor ?? 'mist', { align: 'center', shadow: 'ink' });
    if (dark > 0) ditherRect(g, x - 2, y - 2, w + 4, h + 5, 'ink', dark * 16);
  }
  return api;
}

// =====================================================================================================
// the collapse: a frozen frame shatters from a point and falls apart
// =====================================================================================================
/**
 * const col = createCollapse(image, ex, ey)   image: a canvas W x H (the frozen frame); (ex, ey) epicentre px
 * col.crack(k)          0..1: how far the cracks have run out from the epicentre
 * col.fall(t)           seconds since the fall began; shards drop nearest-first
 * col.draw(g, dt, mode) mode 'cracks' (the frame, whole, with cracks) | 'fall'
 * col.done              every shard is off screen
 * The frame is cut into Voronoi shards on a 2-px grid (chunky, pixel-exact edges): small shards
 * round the epicentre, big ones at the edges. Each shard is a masked sprite with an ink rim,
 * plus two pre-dithered darker copies for the fall into the dark (palette-safe, no alpha).
 */
export function createCollapse(image, ex, ey, { seed = 7, shards: N = 80 } = {}) {
  const W = image.width, H = image.height;
  const C = 2;                                  // grid cell (px)
  const GW = Math.ceil(W / C), GH = Math.ceil(H / C);
  const rnd = mulberry(seed);
  // seeds: dense near the epicentre, sparse at the edges
  const maxR = Math.hypot(Math.max(ex, W - ex), Math.max(ey, H - ey));
  const pts = [];
  for (let i = 0; i < N; i++) {
    let x, y;
    if (i < N * 0.62) { const r = Math.pow(rnd(), 1.5) * maxR, a = rnd() * Math.PI * 2; x = ex + Math.cos(a) * r; y = ey + Math.sin(a) * r * 0.8; }
    else { x = rnd() * W; y = rnd() * H; }
    pts.push({ x: Math.max(0, Math.min(W - 1, x)) / C, y: Math.max(0, Math.min(H - 1, y)) / C });
  }
  // nearest seed per grid cell (a slightly squashed metric gives longer, flatter shards)
  const id = new Int16Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < pts.length; i++) {
      const dx = gx - pts[i].x, dy = (gy - pts[i].y) * 1.25;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    id[gy * GW + gx] = best;
  }
  // shards: bounding boxes, masked sprites
  const sh = pts.map((p, i) => ({ i, x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 }));
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const s = sh[id[gy * GW + gx]];
    s.n++; s.x0 = Math.min(s.x0, gx); s.y0 = Math.min(s.y0, gy); s.x1 = Math.max(s.x1, gx); s.y1 = Math.max(s.y1, gy);
  }
  const src = image.getContext('2d').getImageData(0, 0, W, H).data;
  const INK = [0x0b, 0x0a, 0x12];
  const shards = [];
  const edgeAt = (gx, gy, me) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      if (id[y * GW + x] !== me) return true;
    }
    return false;
  };
  for (const s of sh) {
    if (!s.n) continue;
    const x = s.x0 * C, y = s.y0 * C, w = Math.min(W, (s.x1 + 1) * C) - x, h = Math.min(H, (s.y1 + 1) * C) - y;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(w, h);
    const d = img.data;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const gx = ((x + px) / C) | 0, gy = ((y + py) / C) | 0;
      if (id[gy * GW + gx] !== s.i) continue;
      const o = (py * w + px) * 4, so = ((y + py) * W + x + px) * 4;
      // a 1-px ink rim on the shard's own edge cells (the crack, seen from either side)
      const rim = edgeAt(gx, gy, s.i) && ((px + x) % C === 0 || (py + y) % C === 0);
      if (rim) { d[o] = INK[0]; d[o + 1] = INK[1]; d[o + 2] = INK[2]; }
      else { d[o] = src[so]; d[o + 1] = src[so + 1]; d[o + 2] = src[so + 2]; }
      d[o + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    const darker = (lvl) => {
      const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      const g2 = c2.getContext('2d');
      g2.drawImage(cv, 0, 0);
      g2.globalCompositeOperation = 'source-atop';
      g2.fillStyle = ditherPattern(g2, 'ink', lvl);
      g2.translate(-x & 3, -y & 3);
      g2.fillRect(0, 0, w + 4, h + 4);
      return c2;
    };
    const p = pts[s.i];
    const dist = Math.hypot(p.x * C - ex, (p.y * C - ey) / 0.8) / maxR;
    shards.push({
      x, y, w, h, cv, dim: darker(7), dark: darker(12), dist,
      cx: p.x * C, cy: p.y * C,
      vx: Math.sign(p.x * C - ex || 1) * (6 + rnd() * 30) * (0.4 + dist),
      vy: -(30 + rnd() * 60) * (1 - dist * 0.6),
      delay: dist * 0.75 + rnd() * 0.1, puffed: false,
    });
  }
  // crack pixels: the shared edges, each lit when the front (a ragged circle) passes it
  const cracks = [];
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const me = id[gy * GW + gx];
    const r = gx + 1 < GW && id[gy * GW + gx + 1] !== me, b = gy + 1 < GH && id[(gy + 1) * GW + gx] !== me;
    if (!r && !b) continue;
    const px = gx * C + (r ? C - 1 : 0), py = gy * C + (b ? C - 1 : 0);
    const k = Math.hypot(px - ex, (py - ey) / 0.8) / maxR + (rnd() - 0.5) * 0.04;
    cracks.push({ x: r ? gx * C + C - 1 : gx * C, y: b ? gy * C + C - 1 : gy * C, w: r ? 1 : C, h: b ? 1 : C, k, r, b });
  }
  cracks.sort((a, b) => a.k - b.k);
  const dust = createDust();
  let crackK = 0, fallT = -1, done = false;
  const seamColor = (age) => (age < 0.025 ? 'torch' : age < 0.06 ? 'gold' : age < 0.12 ? 'flame' : age < 0.22 ? 'ember' : age < 0.4 ? 'blood' : 'ink');
  const api = {
    W, H, shards,
    get done() { return done; },
    get fallT() { return fallT; },
    crack(k) { crackK = k; },
    fall(t) { fallT = t; },
    /** How many crack pixels are lit (for crack sounds). */
    lit() { let lo = 0, hi = cracks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cracks[m].k <= crackK) lo = m + 1; else hi = m; } return lo; },
    draw(g, dt, mode = 'cracks') {
      dust.step(dt);
      if (mode === 'cracks') {
        g.drawImage(image, 0, 0);
        // the hot front glows wider than the cooled cracks behind it
        for (const c of cracks) {
          if (c.k > crackK) break;
          const age = crackK - c.k;
          const col = seamColor(age);
          g.fillStyle = css(col);
          g.fillRect(c.x, c.y, c.w + (c.r && age < 0.06 ? 1 : 0), c.h + (c.b && age < 0.06 ? 1 : 0));
        }
        // a white-hot spark where it began
        if (crackK > 0 && crackK < 0.25) { g.fillStyle = css('white'); g.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3); }
      } else {
        const G = 1200;
        let any = false;
        // falling shards drop *into* the screen: drawn under the ones still standing
        for (let pass = 0; pass < 2; pass++) {
          for (const s of shards) {
            const tt = fallT - s.delay;
            const moving = tt > 0;
            if ((pass === 0) !== moving) continue;
            if (!moving) { any = true; g.drawImage(s.cv, s.x, s.y); continue; }
            if (!s.puffed) { s.puffed = true; dust.puff(s.cx, s.cy, 3, { spread: Math.min(s.w, 30), up: 8, cols: ['frost', 'fog', 'mist', 'slate'] }); }
            const X = Math.round(s.x + s.vx * tt), Y = Math.round(s.y + s.vy * tt + 0.5 * G * tt * tt);
            if (Y >= H + 2) continue;
            any = true;
            g.drawImage(tt < 0.12 ? s.cv : tt < 0.3 ? s.dim : s.dark, X, Y);
          }
        }
        if (!any && fallT > 0.2) done = true;
      }
      dust.draw(g);
    },
  };
  return api;
}
