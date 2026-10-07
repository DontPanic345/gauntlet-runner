// The endings (piece `run-flow`): the 'gameover' and 'victory' scenes. Replace foundation's
// placeholders.
//
// gameover data: { snapshot (canvas), ex, ey (epicentre px), result, skip, direct }
//   0.00  the frozen last frame cracks along a brick grid, outward from the hero (hot seams cooling)
//   0.50  it breaks: blocks fall into the dark in the order they cracked (dust, rumble, shake)
//   1.05  the summary slab drops from above and lands with a thud; YOU FELL hammers in letter by letter
//   then  the summary counts in (src/run/summary.js); the dark keeps moving (embers, falling grit)
//   skip: the collapse runs at 2.4x and the slab comes straight away. direct: no collapse at all.
// victory data: { snapshot, result }
//   0.00  the pit's last frame; gold light pours in from above as the view rises out of it
//   1.00  a short white-out (scaled by the flashes setting), then dawn over the mountain: sky, sun,
//         ridges, the runner at the cave mouth with the keys
//   1.45  YOU ESCAPED, then the summary slab rises into place, gold-trimmed
// Keys on both: R (anywhere) or J / Enter after the count = a new run on a new seed;
//   E = the same seed again; Esc = title. J / Enter while it counts finishes the count.

import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { feedback } from '../core/feedback.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { css } from '../render/palette.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { ditherRect, drawKey, drawPrompt, promptWidth, keyWidth, Sparks, wipe } from '../ui/menus.js';
import { run, endRun, fmtTime, meta, placeText } from './record.js';
import { createCollapse } from './wall.js';
import { createSummary, cropPortrait } from './summary.js';
import { flow, rdt } from './flow.js';
import { runSound } from './sfx.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const easeBack = (t) => { t = clamp01(t); const s = 1.9; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };

export const COLLAPSE = { crack: 0.5, slab: 0.55, slabFall: 0.28 };
/** The victory timeline (seconds). */
export const VICTORY = { white: 0.95, dawn: 1.15, heading: 1.45, slab: 1.65 };
const V = VICTORY;

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- shared: the heading, the footer, the prompts, the keys ---------------------------------------
function drawHeading(g, text, cx, y, t, color, { scale = 4, stagger = 0.045, shade = 'blood' } = {}) {
  // letters hammer down one by one with a bounce
  let x = cx - textWidth(text, scale) / 2;
  let i = 0;
  for (const ch of text) {
    const w = textWidth(ch, scale);
    if (ch !== ' ') {
      const k = clamp01((t - i * stagger) / 0.16);
      if (k > 0) {
        const dy = Math.round((1 - easeBack(k)) * -26);
        const hot = k < 1 && k > 0.6;
        drawText(g, ch, x + scale, y + dy + scale, shade, { scale });
        drawText(g, ch, x, y + dy, hot ? 'white' : color, { scale, outline: 'ink' });
      }
    }
    x += w + scale;
    i++;
  }
}

function drawFooter(g, R, x, y, w, win) {
  const left = `RUN ${R.number}  •  SEED ${R.seed}`;
  drawText(g, left, x, y, 'fog', { shadow: 'ink' });
  // a staged (showcase) run never reaches the saved meta, so fold it in for display only
  const deep = Math.max(meta.bestDepth, R.deepest ?? 0);
  const bestT = R.staged && R.outcome === 'victory' ? (meta.bestTime ? Math.min(meta.bestTime, R.ticks) : R.ticks) : meta.bestTime;
  const bestDepth = deep >= 9 ? 'THE WARDEN' : placeText(deep, '').replace(/ •.*/, '');
  const right = bestT ? `BEST ${fmtTime(bestT)}  •  DEEPEST ${bestDepth}` : `DEEPEST ${bestDepth}  •  NO ESCAPE YET`;
  drawText(g, right, x + w, y, win ? 'gold' : 'mist', { align: 'right', shadow: 'ink' });
}

function drawPrompts(g, y, k) {
  if (k <= 0) return;
  const W = display.width;
  const items = [['R', 'RUN AGAIN', 'bone'], ['interact', 'SAME SEED', 'fog'], ['cancel', 'TITLE', 'fog']];
  const widths = items.map(([a, l]) => (a === 'R' ? keyWidth('KeyR') + 5 + textWidth(l) + 2 : promptWidth(a, l)));
  const gap = 22;
  let x = Math.round((W - widths.reduce((a, b) => a + b, 0) - gap * (items.length - 1)) / 2);
  const dy = Math.round((1 - easeOut(k)) * 8);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  ditherRect(g, x - 10, y - 4 + dy, total + 20, 21, 'ink', 12);   // a dark band so the keys read over the glow
  items.forEach(([a, l, c], i) => {
    if (a === 'R') { const kw = drawKey(g, 'KeyR', x, y + dy); drawText(g, l, x + kw + 5, y + 2 + dy, c, { shadow: 'ink' }); }
    else drawPrompt(g, a, l, x, y + dy, c);
    x += widths[i] + gap;
  });
}

/** The keys both endings answer. Returns true if it acted. */
function endingKeys(S, armed) {
  if (!armed) return false;
  const go = input.ui.pressed('confirm') || input.ui.pressed('attack');
  if (go) {
    if (!S.done) { S.finish(); return true; }
    flow.restart();
    return true;
  }
  if (input.ui.pressed('interact')) { flow.restart({ sameSeed: true }); return true; }
  if (input.ui.pressed('cancel') && !wipe.active) {
    wipe.close(display.width / 2, display.height / 2, 0.45, () => { scenes.go('title'); wipe.open(0.5); });
    return true;
  }
  return false;
}

// ---- the dark behind the collapse --------------------------------------------------------------
function createVoid(seed = 3) {
  const sparks = new Sparks(220);
  const grit = [];
  const rnd = mulberry(seed);
  for (let i = 0; i < 46; i++) grit.push({ x: rnd(), y: rnd(), v: 20 + rnd() * 70, s: rnd() < 0.25 ? 2 : 1, c: rnd() < 0.5 ? 'dusk' : 'shadow' });
  let acc = 0;
  return {
    step(dt) {
      sparks.step(dt);
      acc += dt;
      while (acc > 0.05) {
        acc -= 0.05;
        const W = display.width, H = display.height;
        sparks.emit(Math.random() * W, H + 2, { vx: (Math.random() - 0.5) * 6, vy: -18 - Math.random() * 30, life: 2.5 + Math.random() * 2, cols: ['flame', 'ember', 'blood', 'plum'], grav: -2, wob: 7 });
      }
      for (const p of grit) { p.y += (p.v * dt) / display.height; if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); } }
    },
    draw(g, glow = 1) {
      const W = display.width, H = display.height;
      g.fillStyle = css('ink'); g.fillRect(0, 0, W, H);
      // a deep ember glow far below: a dithered ellipse, hotter toward its heart
      ditherRect(g, 0, 0, W, H, 'night', 5);
      const ecx = W / 2, ecy = H + 30, R = Math.max(W * 0.62, 320);
      const rings = [['plum', 3, 1.0], ['plum', 6, 0.82], ['blood', 5, 0.66], ['blood', 9, 0.5], ['ember', 4, 0.36], ['ember', 8, 0.24]];
      for (const [c, lvl, f] of rings) {
        const r = R * f;
        for (let y = Math.max(0, Math.floor(ecy - r * 0.55)); y < H; y += 2) {
          const dy = (y - ecy) / 0.55;
          if (Math.abs(dy) > r) continue;
          const hw = Math.round(Math.sqrt(r * r - dy * dy));
          ditherRect(g, Math.round(ecx - hw), y, hw * 2, 2, c, lvl * glow);
        }
      }
      for (const p of grit) { g.fillStyle = css(p.c); g.fillRect(Math.round(p.x * W), Math.round(p.y * H), p.s, p.s * 2); }
      sparks.draw(g);
    },
  };
}

// =======================================================================================================
// gameover
// =======================================================================================================
scenes.define('gameover', (() => {
  let finishOnSlab = false, lastDt = 1 / 60, t = 0, col = null, S = null, R = null, voidBg = null, skip = false, slabT = -1, slammed = false, crumbled = false, lastLit = 0, armT = 0;
  const offs = [];
  return {
    shakeUi: true,   // a 2D scene: the crumble's feedback.shake moves the drawn frame (foundation channel)
    enter(data) {
      world.reset();
      display.setZoom(1);
      display.setCameraTarget(0, 0, 0);
      R = data?.result ?? run.result ?? endRun('death');
      skip = !!data?.skip;
      col = data?.snapshot && !data?.direct ? createCollapse(data.snapshot, data.ex ?? display.width / 2, data.ey ?? display.height / 2, { seed: R.seed }) : null;
      S = createSummary(R, { style: 'death', portrait: data?.portrait ?? (data?.snapshot ? cropPortrait(data.snapshot, data.ex ?? 0, data.ey ?? 0) : null) });
      voidBg = createVoid(R.seed);
      t = 0; slabT = col ? -1 : 0; slammed = !col; crumbled = !col; lastLit = 0; armT = 0;
      if (!col) { S.finish(); }
      offs.push(events.on('run:skip', () => { skip = true; finishOnSlab = true; if (slabT >= 0) S.finish(); }));
      finishOnSlab = false;
    },
    exit() { offs.forEach((f) => f()); offs.length = 0; col = null; },
    frame(realDt) {
      const dt = rdt(realDt);
      if (scenes.paused) return;
      lastDt = dt;
      const sp = skip ? 2.4 : 1;
      t += dt * sp;
      armT += dt;
      voidBg.step(dt);
      if (col) {
        const ck = clamp01(t / COLLAPSE.crack);
        col.crack(ck);
        const n = col.lit();
        if (n - lastLit > 18 || (n > 0 && lastLit === 0)) { runSound('run.crack', { rate: 0.8 + ck * 0.6 }); lastLit = n; }
        if (t >= COLLAPSE.crack) {
          if (!crumbled) { crumbled = true; runSound('run.crumble'); feedback.shake(5, 600); }
          col.fall(t - COLLAPSE.crack);
          if (slabT < 0 && t >= COLLAPSE.crack + COLLAPSE.slab) slabT = 0;
        }
      }
      if (slabT >= 0) {
        slabT += dt;
        if (!slammed && slabT >= COLLAPSE.slabFall) { slammed = true; runSound('run.slab'); feedback.shake(3, 220); if (finishOnSlab) S.finish(); }
        if (slammed) S.step(dt);
      }
      // a press during the collapse skips to the slab
      if (slabT < 0 && armT > 0.15 && (input.ui.pressed('confirm') || input.ui.pressed('attack') || input.ui.pressed('dash'))) { skip = true; t = Math.max(t, COLLAPSE.crack); }
      else endingKeys(S, slabT > 0.1 && armT > 0.2);
    },
    ui(g) {
      const W = display.width, H = display.height;
      voidBg.draw(g, clamp01(t / 0.8));
      if (col && !col.done) col.draw(g, lastDt, t < COLLAPSE.crack ? 'cracks' : 'fall');
      if (slabT < 0) return;
      const sx = Math.round((W - S.W) / 2), sy = Math.round(Math.max(56, (H - S.H) / 2 + 14));
      const k = clamp01(slabT / COLLAPSE.slabFall);
      const y = sy - Math.round((1 - k * k) * (sy + S.H + 10));
      // the slab's shadow on the dark below it
      if (k > 0.3) ditherRect(g, sx + 6, sy + S.H + 4, S.W - 12, 4, 'ink', 10 * k);
      S.draw(g, sx, y);
      // the heading
      const ht = slabT - COLLAPSE.slabFall + 0.05;
      if (ht > 0) {
        drawHeading(g, 'YOU FELL', W / 2, Math.max(8, sy - 46), ht, 'red');
      }
      // footer and prompts
      if (slammed) {
        const fk = clamp01((slabT - COLLAPSE.slabFall) / 0.3);
        if (fk > 0) drawFooter(g, R, sx + 4, sy + S.H + 10, S.W - 8, false);
        drawPrompts(g, Math.min(H - 18, sy + S.H + 26), clamp01((slabT - COLLAPSE.slabFall - 0.15) / 0.25));
      }
      if (R.staged) drawText(g, 'SHOWCASE: STAGED RUN HISTORY', W - 6, 6, 'slate', { align: 'right' });
    },
    state() { return { run: flow.info(), gameover: { t: +t.toFixed(2), slab: +slabT.toFixed(2), summary: S ? { t: +S.t.toFixed(2), done: S.done } : null, collapse: col ? { done: col.done } : null, result: R } }; },
  };
})());

// =======================================================================================================
// victory
// =======================================================================================================
function createDawn(seed) {
  const rnd = mulberry(seed * 7 + 1);
  const far = [], near = [];
  // two ridges: midpoint noise across the screen width (0..1 coords)
  const ridge = (n, base, amp) => { const a = []; let y = base; for (let i = 0; i <= n; i++) { y += (rnd() - 0.5) * amp; y = Math.max(base - amp, Math.min(base + amp, y)); a.push(y); } return a; };
  far.push(...ridge(64, 0.66, 0.06));
  near.push(...ridge(40, 0.8, 0.05));
  const sparks = new Sparks(80);
  const clouds = [];
  for (let i = 0; i < 7; i++) clouds.push({ x: rnd(), y: 0.12 + rnd() * 0.3, w: 30 + rnd() * 70, c: rnd() < 0.5 ? 'rose' : 'plum', v: 2 + rnd() * 5 });
  let t = 0;
  return {
    step(dt) { t += dt; sparks.step(dt); for (const c of clouds) c.x = (c.x + (c.v * dt) / display.width) % 1.2; if (Math.random() < dt * 6) sparks.emit(display.width * 0.13 + (Math.random() - 0.5) * 10, display.height * 0.76, { vy: -8 - Math.random() * 10, life: 2, cols: ['torch', 'gold', 'flame'], grav: -1, wob: 4 }); },
    draw(g) {
      const W = display.width, H = display.height;
      const horizon = Math.round(H * 0.7);
      // the sky: dithered bands from night to gold at the horizon
      const bands = [['night', 0], ['navy', 0.12], ['plum', 0.3], ['rose', 0.46], ['flame', 0.58], ['gold', 0.66]];
      g.fillStyle = css('night'); g.fillRect(0, 0, W, H);
      for (let i = 1; i < bands.length; i++) {
        const [c, y0] = bands[i];
        const top = Math.round(H * y0);
        ditherRect(g, 0, top - 10, W, 10, c, 4);
        ditherRect(g, 0, top - 5, W, 5, c, 10);
        g.fillStyle = css(c); g.fillRect(0, top, W, horizon - top + 4);
      }
      // the sun: rising slowly behind the far ridge
      const sx = Math.round(W * 0.87), sy = Math.round(horizon - 8 - Math.min(16, t * 4));
      for (const [r, c] of [[34, 'flame'], [27, 'gold'], [21, 'torch']]) {
        g.fillStyle = css(c);
        for (let y = -r; y <= r; y++) { const hw = Math.round(Math.sqrt(r * r - y * y)); g.fillRect(sx - hw, sy + y, hw * 2, 1); }
      }
      // rays: slow-turning dithered spokes
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI + (i / 8) * Math.PI + Math.sin(t * 0.3) * 0.05;
        for (let d = 40; d < 220; d += 3) {
          const x = Math.round(sx + Math.cos(a) * d), y = Math.round(sy + Math.sin(a) * d);
          if (y > horizon) continue;
          if (((x + y) & 3) === 0 && d % 6 === 0) { g.fillStyle = css('torch'); g.fillRect(x, y, 1, 1); }
        }
      }
      // clouds
      for (const c of clouds) { const cx = Math.round(c.x * W - 40), cy = Math.round(c.y * H); ditherRect(g, cx, cy, Math.round(c.w), 3, c.c, 9); ditherRect(g, cx + 8, cy - 2, Math.round(c.w * 0.6), 2, c.c, 6); }
      // ridges
      const ridgeDraw = (pts, col, rim) => {
        const n = pts.length - 1;
        for (let x = 0; x < W; x++) {
          const u = (x / W) * n, i = Math.floor(u), f = u - i;
          const y = Math.round((pts[i] * (1 - f) + pts[Math.min(n, i + 1)] * f) * H);
          g.fillStyle = css(col); g.fillRect(x, y, 1, H - y);
          if (rim) { g.fillStyle = css(rim); g.fillRect(x, y, 1, 1); }
        }
      };
      ridgeDraw(far, 'violet', 'rose');
      ridgeDraw(near, 'shadow', 'plum');
      // the cave mouth on the near ridge, and the runner standing in the light at its lip
      const hx = Math.round(W * 0.13), hy = Math.round(H * 0.76);
      g.fillStyle = css('ink');
      for (let y = 0; y < 22; y++) { const hw = Math.round(Math.sqrt(Math.max(0, 22 * 22 - (y - 22) ** 2)) * 0.7); g.fillRect(hx - hw, hy - 4 + y - 18, hw * 2, 1); }
      g.fillStyle = css('shadow'); g.fillRect(hx - 30, hy + 4, 60, H - hy);
      g.fillStyle = css('plum'); g.fillRect(hx - 30, hy + 4, 60, 1);
      // the runner: a hooded figure (cloak, scarf in the wind), the key ring glinting
      const fig = ['..kk..', '.kbbk.', '.kbbk.', 'kbbbbk', 'kbbbbk', 'kbbbbk', '.kbbk.', '.k..k.', '.k..k.'];
      const fx = hx - 3, fy = hy - 5;
      for (let r = 0; r < fig.length; r++) for (let c = 0; c < 6; c++) {
        const ch = fig[r][c];
        if (ch === '.') continue;
        g.fillStyle = css(ch === 'k' ? 'ink' : r < 3 ? (c < 3 ? 'rose' : 'plum') : 'red');   // the wave 2 hero: rose hood, red cape
        g.fillRect(fx + c, fy + r, 1, 1);
      }
      // scarf
      const wave = Math.round(Math.sin(t * 6) * 1);
      g.fillStyle = css('cyan'); g.fillRect(fx + 6, fy + 3, 3, 1); g.fillRect(fx + 9, fy + 3 + wave, 2, 1);
      // the keys
      if (Math.floor(t * 3) % 3 !== 0) { g.fillStyle = css('gold'); g.fillRect(fx - 1, fy + 5, 1, 2); g.fillStyle = css('torch'); g.fillRect(fx - 2, fy + 5, 1, 1); }
      sparks.draw(g);
      // a pair of birds, far off
      for (let i = 0; i < 2; i++) {
        const bx = Math.round(((t * 9 + i * 70) % (W + 40)) - 20), by = Math.round(H * 0.25 + i * 14 + Math.sin(t * 2 + i) * 3);
        const flap = Math.floor(t * 5 + i) % 2;
        g.fillStyle = css('ink'); g.fillRect(bx - 2, by - flap, 2, 1); g.fillRect(bx, by, 1, 1); g.fillRect(bx + 1, by - flap, 2, 1);
      }
    },
  };
}

scenes.define('victory', (() => {
  let t = 0, snap = null, S = null, R = null, dawn = null, slabT = -1, armT = 0, dawned = false, rays = null;
  return {
    shakeUi: true,   // a 2D scene: shakes move the drawn frame (foundation channel)
    enter(data) {
      world.reset();
      display.setZoom(1);
      display.setCameraTarget(0, 0, 0);
      R = data?.result ?? run.result ?? endRun('victory');
      snap = data?.snapshot && !data?.direct ? data.snapshot : null;
      S = createSummary(R, { style: 'victory', portrait: data?.portrait ?? null });
      dawn = createDawn(R.seed);
      t = snap ? 0 : V.dawn; slabT = -1; armT = 0; dawned = !snap;
      if (!snap) { runSound('run.dawn'); S.finish(); }
      rays = [];
      const rnd = mulberry(R.seed + 5);
      for (let i = 0; i < 14; i++) rays.push({ x: rnd(), w: 6 + rnd() * 26, d: rnd() * 0.6, lvl: 4 + rnd() * 8 });
    },
    frame(realDt) {
      const dt = rdt(realDt);
      if (scenes.paused) return;
      t += dt; armT += dt;
      dawn.step(dt);
      if (t >= V.white && !dawned) { dawned = true; runSound('run.dawn'); }
      if (t >= V.slab && slabT < 0) { slabT = 0; runSound('run.slab', { rate: 1.2 }); }
      if (slabT >= 0) { slabT += dt; if (slabT > 0.35) S.step(dt); }
      if (slabT < 0 && armT > 0.2 && (input.ui.pressed('confirm') || input.ui.pressed('attack'))) { t = Math.max(t, V.slab); dawned = true; }
      else endingKeys(S, slabT > 0.4);
    },
    ui(g) {
      const W = display.width, H = display.height;
      if (t < V.dawn && snap) {
        // rising out of the pit: the frame slides down and gold light pours in from above
        const k = easeOut(t / V.dawn);
        const dy = Math.round(k * 46);
        g.fillStyle = css('torch'); g.fillRect(0, 0, W, H);
        g.drawImage(snap, 0, dy);
        ditherRect(g, 0, 0, W, dy + 6, 'gold', 12);
        for (const r of rays) {
          const kk = clamp01((t - r.d) / 0.6);
          if (kk <= 0) continue;
          ditherRect(g, Math.round(r.x * W - r.w / 2), 0, Math.round(r.w), Math.round(H * kk), 'torch', r.lvl * kk);
        }
        // white-out at the end (scaled by the flashes setting; with flashes off it is a gold dissolve)
        const wk = clamp01((t - V.white) / (V.dawn - V.white));
        if (wk > 0) {
          ditherRect(g, 0, 0, W, H, 'gold', wk * 16);
          ditherRect(g, 0, 0, W, H, 'torch', wk * 16 * settings.get('flashes'));
        }
        return;
      }
      dawn.draw(g);
      const fade = 1 - clamp01((t - V.dawn) / 0.3);
      if (fade > 0 && snap) ditherRect(g, 0, 0, W, H, settings.get('flashes') > 0.5 ? 'torch' : 'gold', fade * 16);
      const sx = Math.round((W - S.W) / 2), sy = Math.round(Math.max(56, (H - S.H) / 2 + 14));
      // heading over the sky
      drawHeading(g, 'YOU ESCAPED', W / 2, Math.max(8, sy - 46), t - V.heading, 'gold', { shade: 'flame' });
      if (slabT >= 0) {
        const k = easeBack(slabT / 0.35);
        const y = Math.round(sy + (1 - k) * (H - sy + 10));
        S.draw(g, sx, y);
        if (slabT > 0.35) {
          drawFooter(g, R, sx + 4, sy + S.H + 10, S.W - 8, true);
          drawPrompts(g, Math.min(H - 18, sy + S.H + 26), clamp01((slabT - 0.5) / 0.25));
        }
      }
      if (R.staged) drawText(g, 'SHOWCASE: STAGED RUN HISTORY', W - 6, 6, 'mist', { align: 'right' });
    },
    state() { return { run: flow.info(), victory: { t: +t.toFixed(2), slab: +slabT.toFixed(2), summary: S ? { t: +S.t.toFixed(2), done: S.done } : null, result: R } }; },
  };
})());
