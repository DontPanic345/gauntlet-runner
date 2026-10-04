// The run summary (piece `run-flow`): the slab of stats both endings drop in.
//
//   const S = createSummary(result, { style: 'death' | 'victory', portrait });   portrait: cropPortrait(frame, x, y)
//   S.step(realDt)  S.draw(g, x, y)  S.finish()  S.done  S.t
//   S.W, S.H        the slab's size (448 x 238; the internal screen is about 640 x 360)
//
// It counts itself in on its own clock, so every part lands with a sound and a beat:
//   0.02  the portrait: a 2x crop of the real frame around the hero (the last thing you saw)
//   0.12  the depth track lights node by node up to where the run ended (a skull where you fell)
//   0.55  six stats count up, one after another (time, foes, damage / shards, hearts, close calls)
//   ~1.7  the boons taken pop in, in the order they were taken
//   then  the lore line types on (a chime first when it is a new one)
// finish() (a press while it counts) jumps to the end.

import { css } from '../render/palette.js';
import { drawText, textWidth, wrapText } from '../core/pixelfont.js';
import { ditherRect, drawPanel } from '../ui/menus.js';
import { drawIcon } from '../progression/icons.js';
import { BOONS, RARITY } from '../progression/boons.js';
import { CAUSES, fmtTime, NODE_COUNT, placeText } from './record.js';
import { runSound } from './sfx.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const easeBack = (t) => { t = clamp01(t); const s = 2.2; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };

const SKULL = ['.xxxxx.', 'xxxxxxx', 'xooxoox', 'xooxoox', 'xxx.xxx', '.xxxxx.', '.x.x.x.'];
const CROWN = ['x.x.x', 'xxxxx', 'xxxxx'];
function sprite(g, rows, x, y, col, hole = 'ink') {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const ch = rows[r][c];
    if (ch === '.') continue;
    g.fillStyle = css(ch === 'o' ? hole : col);
    g.fillRect(x + c, y + r, 1, 1);
  }
}

export function createSummary(R, { style = 'death', portrait = null } = {}) {
  const win = style === 'victory';
  const W = 448, H = 238;
  let t = 0, done = false;
  const T = {};
  // timeline
  T.portrait = 0.02;
  T.track = 0.12; T.trackStep = 0.055;
  const lit = win ? NODE_COUNT - 1 : R.node;
  T.place = T.track + (lit + 1) * T.trackStep + 0.05;
  T.stats = Math.max(0.6, T.place + 0.12); T.statStep = 0.16;
  const STATS = [
    { label: 'TIME', value: R.ticks, fmt: fmtTime, color: win ? 'gold' : 'bone', best: win && R.newBest?.time },
    { label: 'FOES SLAIN', value: R.kills, color: 'bone', best: R.newBest?.kills },
    { label: 'DAMAGE DEALT', value: R.dmg, color: 'bone' },
    { label: 'SOUL SHARDS', value: R.shards, color: 'sky' },
    { label: 'HEARTS LOST', value: R.hurts, color: 'rose' },
    { label: 'CLOSE CALLS', value: R.dodges, color: 'frost' },
  ];
  T.boons = T.stats + STATS.length * T.statStep + 0.1; T.boonStep = 0.07;
  T.lore = T.boons + Math.max(1, R.boons.length) * T.boonStep + 0.2;
  const loreLines = wrapText(R.lore?.text ?? '', W - 52).slice(0, 2);
  const loreChars = loreLines.join('').length;
  T.end = T.lore + 0.3 + loreChars / 70;
  const fired = new Set();
  const once = (key, fn) => { if (!fired.has(key)) { fired.add(key); fn(); } };
  let tallyAcc = 0;
  const cause = win ? { text: 'THE WARDEN FALLS', color: 'gold' } : (CAUSES[R.cause] ?? CAUSES.unknown);

  const api = {
    W, H,
    get t() { return t; },
    get done() { return done; },
    get timeline() { return { ...T }; },
    finish() { if (!done) { t = T.end + 0.01; done = true; fired.add('all'); } },
    step(dt) {
      t += dt;
      if (t >= T.end) done = true;
      if (fired.has('all')) return;
      // sounds on the beats
      for (let i = 0; i <= lit; i++) if (t >= T.track + i * T.trackStep) once('n' + i, () => runSound('run.tally', { step: Math.min(10, i) }));
      if (t >= T.place) once('place', () => runSound('run.row', { rate: 0.7 }));
      STATS.forEach((s, i) => {
        const t0 = T.stats + i * T.statStep, t1 = t0 + T.statStep * 0.8;
        if (t >= t0 && t < t1) { tallyAcc += dt; if (tallyAcc > 0.035) { tallyAcc = 0; runSound('run.tally', { step: 3 + i, gain: 0.7 }); } }
        if (t >= t1) once('s' + i, () => { runSound('run.row', { step: i }); if (s.best) runSound('run.stamp'); });
      });
      R.boons.forEach((b, i) => { if (t >= T.boons + i * T.boonStep) once('b' + i, () => runSound('run.row', { rate: 1.5 + i * 0.05, gain: 0.7 })); });
      if (t >= T.lore) once('lore', () => { if (R.lore?.fresh) runSound('run.lore'); });
      if (t >= T.lore + 0.3 && t < T.end) { tallyAcc += dt; if (tallyAcc > 0.06) { tallyAcc = 0; runSound('run.type'); } }
    },

    draw(g, x, y) {
      x = Math.round(x); y = Math.round(y);
      drawPanel(g, x, y, W, H, { accent: win ? 'gold' : 'ember' });
      const cx = x + 14, cw = W - 28;
      // ---- the last thing you saw: a 2x crop of the real frame -------------------------
      const PW = 104, PH = 80;
      const px = cx, py = y + 12;
      g.fillStyle = css('ink'); g.fillRect(px - 1, py - 1, PW + 2, PH + 3);
      g.fillStyle = css(win ? 'gold' : cause.color); g.fillRect(px, py, PW, PH);
      g.fillStyle = css('ink'); g.fillRect(px + 1, py + 1, PW - 2, PH - 2);
      if (portrait) {
        const k = clamp01((t - T.portrait) / 0.25);
        g.drawImage(portrait, px + 2, py + 2, PW - 4, PH - 4);
        if (k < 1) ditherRect(g, px + 2, py + 2, PW - 4, PH - 4, 'ink', (1 - k) * 16);
      } else {
        ditherRect(g, px + 2, py + 2, PW - 4, PH - 4, 'shadow', 8);
        sprite(g, SKULL, px + PW / 2 - 3, py + PH / 2 - 4, win ? 'gold' : 'slate');
      }
      // corner brackets, like a photo pinned to the slab
      g.fillStyle = css(win ? 'torch' : 'bone');
      const br = (bx, by, dx, dy) => { g.fillRect(dx > 0 ? bx : bx - 4, by, 5, 1); g.fillRect(bx, dy > 0 ? by : by - 4, 1, 5); };
      br(px - 2, py - 2, 1, 1); br(px + PW + 1, py - 2, -1, 1); br(px - 2, py + PH + 2, 1, -1); br(px + PW + 1, py + PH + 2, -1, -1);
      // ---- the depth track ----------------------------------------------------------------
      const rx = cx + PW + 16, rw = cw - PW - 16;
      const ty = y + 24;
      const step = (rw - 16) / (NODE_COUNT - 1);
      const nx = (i) => Math.round(rx + 8 + i * step);
      for (let i = 0; i < NODE_COUNT - 1; i++) {
        const k = clamp01((t - T.track - i * T.trackStep) / T.trackStep);
        const x0 = nx(i), x1 = nx(i + 1);
        g.fillStyle = css('ink'); g.fillRect(x0, ty + 3, x1 - x0, 3);
        g.fillStyle = css('dusk'); g.fillRect(x0, ty + 4, x1 - x0, 1);
        if (i < lit && k > 0) { g.fillStyle = css(win ? 'gold' : 'flame'); g.fillRect(x0, ty + 4, Math.round((x1 - x0) * k), 1); }
      }
      for (let i = 0; i < NODE_COUNT; i++) {
        const on = i <= lit && t >= T.track + i * T.trackStep;
        const just = on && t < T.track + i * T.trackStep + 0.12;
        const X = nx(i);
        const boss = i === NODE_COUNT - 1, cor = i % 2 === 1;
        const base = on ? (win ? 'gold' : i === lit ? 'red' : 'flame') : 'violet';
        if (boss) {
          g.fillStyle = css('ink'); g.fillRect(X - 5, ty - 1, 11, 11);
          sprite(g, SKULL, X - 3, ty + 1, on ? (win ? 'gold' : 'bone') : 'slate', 'ink');
        } else if (cor) {
          g.fillStyle = css('ink'); g.fillRect(X - 4, ty + 1, 9, 7);
          g.fillStyle = css(just ? 'white' : base); g.fillRect(X - 3, ty + 2, 7, 5);
          g.fillStyle = css(on ? 'ink' : 'dusk'); g.fillRect(X - 2, ty + 4, 5, 1);
        } else {
          g.fillStyle = css('ink'); g.fillRect(X - 5, ty - 1, 11, 11);
          g.fillStyle = css(just ? 'white' : base); g.fillRect(X - 4, ty, 9, 9);
          g.fillStyle = css(on ? 'torch' : 'slate'); g.fillRect(X - 4, ty, 9, 1);
        }
        if (i === lit && on) {
          const bob = Math.round(Math.sin(t * 5) * 1.5);
          if (win) sprite(g, CROWN, X - 2, ty - 7 + bob, 'gold');
          else {
            g.fillStyle = css('ink'); g.fillRect(X - 5, ty - 13 + bob, 11, 10);
            sprite(g, SKULL, X - 3, ty - 12 + bob, (Math.floor(t * 4) % 2) ? 'red' : 'rose', 'ink');
          }
        }
      }
      drawText(g, 'IN', nx(0), ty + 13, 'slate', { align: 'center' });
      drawText(g, 'WARDEN', nx(NODE_COUNT - 1) + 4, ty + 13, 'slate', { align: 'right' });
      if (R.newBest?.depth && !win && t >= T.place) {
        const k = clamp01((t - T.place) / 0.15);
        tag(g, 'NEW DEEPEST', Math.min(nx(lit) + 10, rx + rw - 70), ty + 13, 'gold', k);
      }
      // ---- where, and how -------------------------------------------------------------------
      if (t >= T.place) {
        const k = easeOut((t - T.place) / 0.2);
        const dx = Math.round((1 - k) * 10);
        const place = win ? 'ALL TEN DEPTHS RUN' : (R.place ?? placeText(R.node));
        drawText(g, (win ? '' : 'FELL IN ') + place, rx + dx, y + 52, 'fog', { shadow: 'ink' });
        const big = textWidth(cause.text, 2) <= rw;
        drawText(g, cause.text, rx + dx, y + 64, k < 1 && k > 0.5 ? 'white' : cause.color, { scale: big ? 2 : 1, shadow: 'ink' });
      }
      rule(g, cx, y + 98, cw);
      // ---- stats ------------------------------------------------------------------------------
      const colW = Math.floor(cw / 3);
      STATS.forEach((s, i) => {
        const t0 = T.stats + i * T.statStep;
        if (t < t0) return;
        const k = clamp01((t - t0) / (T.statStep * 0.8));
        const sx = cx + (i % 3) * colW + 6, sy = y + 105 + Math.floor(i / 3) * 31;
        const v = Math.round(s.value * easeOut(k));
        const settled = k >= 1;
        const flash = settled && t < t0 + T.statStep * 0.8 + 0.08;
        const drop = Math.round((1 - easeBack(clamp01((t - t0) / 0.12))) * -5);
        drawText(g, s.label, sx, sy + drop, 'mist');
        drawText(g, s.fmt ? s.fmt(v) : String(v), sx, sy + 10 + drop, flash ? 'white' : s.color, { scale: 2, shadow: 'ink' });
        if (s.best && settled) {
          const kk = clamp01((t - t0 - T.statStep * 0.8) / 0.12);
          tag(g, 'NEW BEST', sx + textWidth(s.fmt ? s.fmt(s.value) : String(s.value), 2) + 8, sy + 13, 'gold', kk);
        }
      });
      rule(g, cx, y + 168, cw);
      // ---- boons -----------------------------------------------------------------------------
      const by = y + 173;
      drawText(g, 'BOONS', cx + 2, by + 6, 'mist');
      if (!R.boons.length) {
        if (t >= T.boons) drawText(g, 'NONE TAKEN. THE MOUNTAIN GAVE YOU NOTHING.', cx + 52, by + 6, 'slate');
      } else {
        const maxN = Math.floor((cw - 52) / 22);
        R.boons.slice(0, maxN).forEach((b, i) => {
          const t0 = T.boons + i * T.boonStep;
          if (t < t0) return;
          const k = clamp01((t - t0) / 0.1);
          const bx = cx + 50 + i * 22, bb = by - Math.round((1 - easeBack(k)) * 6);
          const rar = RARITY[BOONS[b.id]?.rarity]?.frame ?? 'fog';
          g.fillStyle = css('ink'); g.fillRect(bx - 1, bb - 1, 22, 22);
          g.fillStyle = css(rar); g.fillRect(bx, bb, 20, 20);
          g.fillStyle = css('night'); g.fillRect(bx + 1, bb + 1, 18, 18);
          drawIcon(g, b.id, bx + 1, bb + 1, { tint: k < 0.5 ? 'white' : null });
          if (b.stacks > 1) drawText(g, `${b.stacks}`, bx + 16, bb + 14, 'gold', { outline: 'ink' });
        });
        if (R.boons.length > maxN) drawText(g, `+${R.boons.length - maxN}`, cx + 50 + maxN * 22, by + 6, 'fog');
      }
      // ---- lore ------------------------------------------------------------------------------------
      const ly = y + 197;
      g.fillStyle = css('ink'); g.fillRect(cx, ly, cw, 34);
      ditherRect(g, cx + 1, ly + 1, cw - 2, 32, win ? 'plum' : 'night', 8);
      g.fillStyle = css(win ? 'gold' : 'violet'); g.fillRect(cx, ly, 2, 34);
      if (t >= T.lore && R.lore) {
        const L = R.lore;
        const k = clamp01((t - T.lore) / 0.15);
        const head = `LORE ${L.count} OF ${L.total}`;
        drawText(g, head, cx + 10, ly + 4, L.fresh ? 'gold' : 'mist');
        if (L.fresh) tag(g, 'NEW', cx + 10 + textWidth(head) + 7, ly + 4, 'gold', k, true);
        else drawText(g, 'REMEMBERED', cx + 10 + textWidth(head) + 8, ly + 4, 'slate');
        let n = Math.floor(Math.max(0, t - T.lore - 0.3) * 70);
        loreLines.forEach((line, i) => {
          if (n <= 0) return;
          const s = line.slice(0, n);
          n -= line.length;
          drawText(g, s, cx + 10, ly + 15 + i * 9, L.fresh ? 'bone' : 'fog', { shadow: 'ink' });
          if (n < 0 && Math.floor(t * 6) % 2 === 0) { g.fillStyle = css('gold'); g.fillRect(cx + 10 + textWidth(s) + 1, ly + 15 + i * 9, 2, 7); }
        });
      }
    },
  };

  function rule(g, x, y, w) {
    g.fillStyle = css('ink'); g.fillRect(x, y, w, 1);
    g.fillStyle = css('dusk'); g.fillRect(x, y + 1, w, 1);
  }
  /** A stamped tag: a filled box with ink text. k 0..1 (slams from a bigger box). */
  function tag(g, text, x, y, col, k = 1, small = false) {
    const tw = textWidth(text);
    const grow = Math.round((1 - clamp01(k)) * 4);
    const bx = Math.round(x - 3 - grow), by = Math.round(y - 2 - grow), bw = tw + 6 + grow * 2, bh = 11 + grow * 2;
    g.fillStyle = css('ink'); g.fillRect(bx - 1, by - 1, bw + 2, bh + 3);
    g.fillStyle = css(k < 1 ? 'white' : col); g.fillRect(bx, by, bw, bh);
    g.fillStyle = css(win ? 'flame' : 'blood'); if (!small) g.fillRect(bx, by + bh, bw, 1);
    drawText(g, text, Math.round(x), Math.round(y), 'ink');
  }
  return api;
}

/** A crop of a frame around (x, y): the summary's portrait (w x h source pixels). */
export function cropPortrait(image, x, y, w = 50, h = 38) {
  if (!image) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const sx = Math.round(Math.max(0, Math.min(image.width - w, x - w / 2)));
  const sy = Math.round(Math.max(0, Math.min(image.height - h, y - h / 2)));
  g.drawImage(image, sx, sy, w, h, 0, 0, w, h);
  return c;
}
