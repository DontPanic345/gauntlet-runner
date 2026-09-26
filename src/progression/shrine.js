// The boon shrine: pick 1 of 3 (piece `boons`). A screen drawn on the UI canvas in real time,
// so it works while the sim is frozen behind it.
//
//   import { createShrine } from './progression/shrine.js';
//   const shrine = createShrine({ rng, held: () => boons.held, pickups, onPick(offer), onClose() });
//   shrine.open()                       // rolls 3 offers (or shrine.open({ offers: [{id, level}] }))
//   frame(dt): shrine.frame(dt)         // input; call from scene.frame (runs while paused)
//   ui(g):     shrine.ui(g)             // draw over everything
//   shrine.active                       // true while it is up: the scene should freeze the sim
//
// Keys: A/D or arrows browse, Enter / J / E / click take, 1-3 take directly, R reroll (costs
// shards). Mouse hover selects. Cards arrive face down, flip in turn with a flash in the
// rarity colour, lift and shine when hovered, and burst when taken while the others fall away.

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { feedback } from '../core/feedback.js';
import { css } from '../render/palette.js';
import { drawText, textWidth, wrapText } from '../core/pixelfont.js';
import { BOONS, RARITY, rollOffers, synergiesFor } from './boons.js';
import { drawIcon, drawGlyph } from './icons.js';
import { drawShardCounter } from './pickups.js';
import { boonSfx } from './sfx.js';

const CW = 112, CH = 186, GAP = 20;
const REROLL_COST = 5;
const TAU = Math.PI * 2;
const ease = {
  out: (u) => 1 - (1 - u) * (1 - u) * (1 - u),
  back: (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
  inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
};
const clamp01 = (u) => Math.max(0, Math.min(1, u));

export function createShrine({ rng, held = () => new Map(), pickups = null, onPick = () => {}, onClose = () => {}, rerollCost = REROLL_COST } = {}) {
  let cards = [];
  let sel = 1, phase = 'off', t0 = 0, tPick = 0, picked = -1, rerolls = 0, tReroll = -99, tDenied = -99;
  let sparks = [];
  let rings = [];
  let title = { t0: 0 };
  let hoverMouse = -1;
  const shard = { x: 0, y: 0 };

  const now = () => loop.realTime;
  const layout = () => {
    const W = display.width, H = display.height;
    const total = 3 * CW + 2 * GAP;
    const x0 = Math.round((W - total) / 2), y0 = Math.round(H / 2 - CH / 2 + 10);
    return { W, H, x0, y0 };
  };
  const cardX = (i) => layout().x0 + i * (CW + GAP);

  function makeCard(o, i, delay) {
    const b = BOONS[o.id];
    const c = document.createElement('canvas');
    c.width = CW; c.height = CH;
    const held_ = held();
    const syn = synergiesFor(o.id, held_ instanceof Map ? [...held_.keys()] : [...held_]).find((s) => s.active) ?? null;
    return { id: o.id, level: o.level, b, rarity: b.rarity, canvas: c, g: c.getContext('2d'), start: delay, flipped: false, flipSound: false,
      hover: 0, lift: 0, flash: 0, syn, seed: rng.next() * 100, fall: 0, alpha: 1, rise: 0 };
  }

  const shrine = {
    get active() { return phase !== 'off'; },
    get phase() { return phase; },
    get selected() { return sel; },
    get cards() { return cards; },
    rerollCost,

    open({ offers = null, luck = 0, quick = false } = {}) {
      const h = held();
      const offs = offers ?? rollOffers(rng, h, 3, { luck });
      const base = quick ? 0.05 : 0.32;
      cards = offs.map((o, i) => makeCard(o, i, base + i * (quick ? 0.09 : 0.15)));
      sel = 1; phase = 'in'; t0 = now(); picked = -1; sparks = []; rings = [];
      title.t0 = t0;
      boonSfx.slide();
    },
    close() { phase = 'off'; cards = []; },
    /** Move the cursor to card i (attract mode, tests). */
    hover(i) { if (phase === 'choose' && cards[i] && i !== sel) { sel = i; boonSfx.hover(); } },
    /** Take card i (also what a click or Enter does). */
    pick(i) {
      if (phase !== 'choose' || !cards[i]) return false;
      phase = 'picked'; picked = i; tPick = now();
      const c = cards[i];
      const { x0, y0 } = layout();
      const cx = x0 + i * (CW + GAP) + CW / 2, cy = y0 + CH / 2;
      const R = RARITY[c.rarity];
      const cols = c.rarity === 'epic' ? ['white', 'torch', 'gold', 'flame', 'plum'] : c.rarity === 'rare' ? ['white', 'sky', 'cyan', 'blue'] : ['white', 'frost', 'fog', 'bone'];
      const n = c.rarity === 'epic' ? 90 : c.rarity === 'rare' ? 64 : 44;
      for (let k = 0; k < n; k++) {
        const a = rng.next() * TAU, sp = 60 + rng.next() * 190;
        sparks.push({ x: cx, y: cy, vx: Math.sin(a) * sp, vy: Math.cos(a) * sp * 0.8 - 40, life: 0, max: 0.5 + rng.next() * 0.6, col: cols[(rng.next() * cols.length) | 0], s: rng.chance(0.3) ? 3 : 2, g: 260 });
      }
      rings.push({ x: cx, y: cy, t: 0, max: 0.5, col: R.edge, r0: 20, r1: 210 });
      rings.push({ x: cx, y: cy, t: -0.08, max: 0.6, col: 'white', r0: 10, r1: 130 });
      boonSfx.select(c.rarity);
      feedback.flash(c.rarity === 'epic' ? 'gold' : c.rarity === 'rare' ? 'sky' : 'white', 120, c.rarity === 'epic' ? 0.4 : 0.28);
      feedback.shake(c.rarity === 'epic' ? 4 : 2.5, 220);
      feedback.hitstop(70);
      onPick({ id: c.id, level: c.level, index: i, rarity: c.rarity });
      return true;
    },
    /** Spend shards for three new cards. */
    reroll() {
      if (phase !== 'choose') return false;
      if (!pickups || !pickups.spend(rerollCost)) { tDenied = now(); boonSfx.denied(); return false; }
      rerolls++; tReroll = now();
      const h = held();
      const prev = cards.map((c) => c.id);
      const offs = rollOffers(rng, h, 3, { exclude: prev });
      const use = offs.length === 3 ? offs : rollOffers(rng, h, 3);
      cards = use.map((o, i) => makeCard(o, i, 0.04 + i * 0.1));
      phase = 'in'; t0 = now(); sparks = []; rings = [];
      boonSfx.reroll();
      return true;
    },

    frame() {
      if (phase === 'off') return;
      const k = input.ui.key, pr = input.ui.pressed;
      const T = now() - t0;
      const allFlipped = cards.every((c) => c.flipped);
      if (phase === 'in' && allFlipped && T > 0.5) phase = 'choose';
      if (phase === 'in' && !allFlipped) {
        // keys are honoured early: you can take a card the moment it is face up
        const i = k('Digit1') ? 0 : k('Digit2') ? 1 : k('Digit3') ? 2 : -1;
        if (i >= 0 && cards[i].flipped) { phase = 'choose'; }
      }
      if (phase !== 'choose') return;
      // mouse
      const m = input.mouse;
      if (m.inside && input.mouseActive()) {
        const r = display.uiCanvas.getBoundingClientRect();
        const mx = ((m.x - r.left) / r.width) * display.width, my = ((m.y - r.top) / r.height) * display.height;
        const { x0, y0 } = layout();
        let h = -1;
        for (let i = 0; i < 3; i++) { const x = x0 + i * (CW + GAP); if (mx >= x && mx < x + CW && my >= y0 - 10 && my < y0 + CH) h = i; }
        if (h !== hoverMouse) { hoverMouse = h; if (h >= 0 && h !== sel) { sel = h; boonSfx.hover(); } }
        const rb = rerollRect();
        if (k('Mouse0')) {
          if (h >= 0) { shrine.pick(h); return; }
          if (mx >= rb.x && mx < rb.x + rb.w && my >= rb.y && my < rb.y + rb.h) { shrine.reroll(); return; }
        }
      }
      if (pr('left')) { sel = (sel + 2) % 3; boonSfx.hover(); }
      if (pr('right')) { sel = (sel + 1) % 3; boonSfx.hover(); }
      if (k('Digit1')) { sel = 0; shrine.pick(0); return; }
      if (k('Digit2')) { sel = 1; shrine.pick(1); return; }
      if (k('Digit3')) { sel = 2; shrine.pick(2); return; }
      if (pr('confirm') || pr('attack') || pr('interact')) shrine.pick(sel);
      else if (k('KeyR')) shrine.reroll();
    },

    ui(g) {
      if (phase === 'off') return;
      const { W, H, x0, y0 } = layout();
      const t = now();
      const T = t - t0;
      let outK = 0;
      if (phase === 'picked') {
        const u = t - tPick;
        if (u > 1.25) outK = clamp01((u - 1.25) / 0.3);
        if (u > 1.55) { phase = 'off'; cards = []; onClose(); return; }
      }
      // ---- backdrop: stepped dim, never a smooth gradient
      const inK = clamp01(T / 0.35);
      const dim = Math.round(0.74 * inK * (1 - outK) * 5) / 5;
      g.fillStyle = `rgba(11,10,18,${dim})`;
      g.fillRect(0, 0, W, H);
      // dither vignette: checker of ink pixels toward the edges
      g.fillStyle = css('ink');
      const vk = inK * (1 - outK);
      for (let y = 0; y < H; y += 2) {
        const dy = Math.abs(y - H / 2) / (H / 2);
        for (let x = (y >> 1) & 1; x < W; x += 2) {
          const dx = Math.abs(x - W / 2) / (W / 2);
          if (Math.max(dx * 0.85, dy) * vk > 0.78 + ((x * 7 + y * 13) % 5) * 0.03) g.fillRect(x, y, 1, 1);
        }
      }
      // slow motes drifting up behind the cards
      for (let i = 0; i < 26; i++) {
        const px = ((i * 97 + 31) % W), sp = 8 + (i % 5) * 4, py = H - ((t * sp + i * 41) % (H + 20)) + 10;
        g.fillStyle = css(i % 3 ? 'slate' : 'ember');
        if (i % 4 === 0) g.fillStyle = css('ember');
        g.fillRect(px + Math.round(Math.sin(t * 0.7 + i) * 3), Math.round(py), 1, 1);
      }

      // ---- title
      {
        const u = ease.back(clamp01((t - title.t0) / 0.45));
        const ty = Math.round(26 - (1 - u) * 34 - outK * 30);
        drawText(g, 'THE SHRINE OFFERS', W / 2, ty - 12, 'fog', { align: 'center', shadow: 'ink' });
        drawText(g, 'CHOOSE A BOON', W / 2, ty + 2, 'gold', { align: 'center', scale: 3, outline: 'ink' });
        // underline with gems
        const uw = Math.round(120 * clamp01((t - title.t0 - 0.2) / 0.3));
        g.fillStyle = css('plum'); g.fillRect(W / 2 - uw, ty + 33, uw * 2, 1);
        if (uw > 20) { g.fillStyle = css('ink'); g.fillRect(W / 2 - 5, ty + 30, 11, 7); g.fillStyle = css('gold'); g.fillRect(W / 2 - 4, ty + 31, 9, 5); g.fillStyle = css('torch'); g.fillRect(W / 2 - 2, ty + 32, 5, 3); }
      }

      // ---- cards
      const ready = phase === 'choose';
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const lt = T - c.start;
        if (lt < 0) continue;
        const slide = clamp01(lt / 0.38);
        const flipStart = c.start + 0.42 + 0.04 * i, flipDur = 0.26;
        const fu = clamp01((T - flipStart) / flipDur);
        if (fu > 0.5 && !c.flipped) {
          c.flipped = true; c.flash = 1;
          boonSfx.flip(c.rarity);
          const R = RARITY[c.rarity], cx = x0 + i * (CW + GAP) + CW / 2, cy = y0 + CH / 2;
          const n = c.rarity === 'epic' ? 34 : c.rarity === 'rare' ? 20 : 10;
          for (let k = 0; k < n; k++) {
            const a = rng.next() * TAU, sp = 30 + rng.next() * (c.rarity === 'epic' ? 150 : 90);
            sparks.push({ x: cx + Math.sin(a) * 30, y: cy + Math.cos(a) * 44, vx: Math.sin(a) * sp, vy: Math.cos(a) * sp - 20, life: 0, max: 0.35 + rng.next() * 0.35, col: k % 3 ? R.hi : 'white', s: 2, g: 120 });
          }
          if (c.rarity === 'epic') { feedback.flash('gold', 100, 0.14); feedback.shake(2, 150); }
        }
        // hover and pick animation state
        const isSel = ready && i === sel, chosen = phase === 'picked' && i === picked;
        c.hover += ((isSel || chosen ? 1 : 0) - c.hover) * 0.28;
        c.flash = Math.max(0, c.flash - 0.1);
        let yOff = Math.round((1 - ease.back(slide)) * 110);
        let alpha = clamp01(lt / 0.15);
        let lift = -Math.round(c.hover * 9);
        let sx = 1, sy = 1;
        if (phase === 'picked') {
          const u = t - tPick;
          if (chosen) {
            // anticipation squash, then a pop up and hold
            const a = clamp01(u / 0.08), p = clamp01((u - 0.08) / 0.2);
            sy = 1 - 0.06 * a * (1 - p) + 0.0 * p; sx = 1 + 0.04 * a * (1 - p);
            lift = -Math.round(9 + ease.out(p) * 16);
            alpha = 1 - outK;
          } else {
            const p = clamp01(u / 0.45);
            yOff += Math.round(ease.out(p) * 150);
            alpha = 1 - p;
          }
        } else alpha *= 1 - outK;
        if (phase === 'in' && c.flipped) lift = 0;
        // idle float
        const float = phase === 'choose' && !isSel ? Math.round(Math.sin(t * 1.6 + i * 2) * 1) : 0;
        // face-up amount: flip squeezes the card to a sliver and back
        const fw = fu <= 0 ? 1 : Math.abs(Math.cos(fu * Math.PI));
        const showFace = fu >= 0.5;
        drawCard(c, showFace, t, i, isSel || chosen, (isSel || chosen ? 1 : 0) * 1, chosen ? t - tPick : -1);
        // blit
        const wpx = Math.max(2, Math.round(CW * fw * sx)), hpx = Math.round(CH * sy);
        const cx = x0 + i * (CW + GAP) + CW / 2, top = y0 + yOff + lift + float + (CH - hpx);
        if (alpha <= 0.02) continue;
        // ground shadow: a dithered ellipse under the card
        drawShadow(g, cx, y0 + CH + 6 + yOff * 0.2, CW * 0.9 * fw, alpha * (isSel ? 0.7 : 0.5), 8 - c.hover * 3);
        g.save();
        g.globalAlpha = Math.round(alpha * 4) / 4 || 0.25;
        g.imageSmoothingEnabled = false;
        g.drawImage(c.canvas, 0, 0, CW, CH, Math.round(cx - wpx / 2), top, wpx, hpx);
        g.restore();
        if ((isSel || chosen) && ready) {
          // pointer chevron above the card, bouncing
          const by = top - 9 - Math.round(Math.abs(Math.sin(t * 5)) * 3);
          g.fillStyle = css('ink'); g.fillRect(cx - 5, by - 1, 11, 3); g.fillRect(cx - 3, by + 2, 7, 2); g.fillRect(cx - 1, by + 4, 3, 2);
          g.fillStyle = css('gold'); g.fillRect(cx - 4, by, 9, 1); g.fillRect(cx - 2, by + 1, 5, 1); g.fillRect(cx, by + 2, 1, 1);
        }
      }

      // ---- 2D sparks and rings
      const dt = Math.min(0.05, loop.frameMs / 1000);
      for (const r of rings) {
        r.t += dt;
        if (r.t < 0) continue;
        const u = r.t / r.max;
        if (u >= 1) continue;
        const rad = r.r0 + (r.r1 - r.r0) * ease.out(u);
        g.fillStyle = css(u > 0.6 ? 'slate' : r.col);
        const n = Math.round(rad * 1.5);
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU; g.fillRect(Math.round(r.x + Math.sin(a) * rad), Math.round(r.y + Math.cos(a) * rad * 0.8), 2, 2); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max) { sparks.splice(i, 1); continue; }
        s.vy += s.g * dt; s.vx *= 0.985; s.x += s.vx * dt; s.y += s.vy * dt;
        const u = s.life / s.max;
        g.fillStyle = css(u > 0.7 ? 'slate' : s.col);
        const sz = u > 0.6 ? 1 : s.s;
        g.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
      }

      // ---- footer: keys, reroll, shards
      if (phase === 'choose' || phase === 'in') {
        const rb = rerollRect();
        const afford = pickups ? pickups.total >= rerollCost : false;
        const denied = now() - tDenied < 0.35;
        const ox = denied ? Math.round(Math.sin((now() - tDenied) * 70) * 2) : 0;
        g.fillStyle = css('ink'); g.fillRect(rb.x - 1 + ox, rb.y - 1, rb.w + 2, rb.h + 2);
        g.fillStyle = css(denied ? 'blood' : afford ? 'dusk' : 'shadow'); g.fillRect(rb.x + ox, rb.y, rb.w, rb.h);
        g.fillStyle = css(afford ? 'slate' : 'dusk'); g.fillRect(rb.x + ox, rb.y, rb.w, 1);
        drawText(g, 'R', rb.x + 5 + ox, rb.y + 4, afford ? 'gold' : 'slate');
        drawText(g, 'REROLL', rb.x + 14 + ox, rb.y + 4, afford ? 'bone' : 'mist');
        drawGlyph(g, 'shard', rb.x + rb.w - 26 + ox, rb.y + 3);
        drawText(g, String(rerollCost), rb.x + rb.w - 15 + ox, rb.y + 4, denied ? 'rose' : afford ? 'sky' : 'slate');
        const help = 'A D BROWSE     ENTER OR J TAKE     1 2 3 DIRECT';
        drawText(g, help, W / 2, H - 20, 'mist', { align: 'center', shadow: 'ink' });
      }
      if (pickups) drawShardCounter(g, W - 46, 12, pickups);
      void shard;
    },
  };

  function rerollRect() {
    const { W, y0 } = layout();
    return { x: Math.round(W / 2 - 40), y: y0 + CH + 16, w: 80, h: 14 };
  }

  function drawShadow(g, cx, y, w, a, h) {
    g.fillStyle = `rgba(11,10,18,${Math.round(a * 4) / 5})`;
    const hh = Math.max(3, Math.round(h));
    for (let k = 0; k < hh; k += 2) {
      const ww = Math.round(w * Math.sqrt(1 - Math.pow((k - hh / 2) / (hh / 2), 2)) / 2);
      g.fillRect(Math.round(cx - ww), Math.round(y + k), ww * 2, 2);
    }
  }

  // ---- a card, drawn into its own small canvas -----------------------------------------------
  function drawCard(c, face, t, i, hot, hotK, pickAge) {
    const g = c.g;
    g.clearRect(0, 0, CW, CH);
    const R = RARITY[c.rarity];
    const px = (x, y, w, h, col) => { g.fillStyle = css(col); g.fillRect(x, y, w, h); };
    // silhouette with clipped corners
    const body = (col, inset = 0) => {
      px(inset + 2, inset, CW - 2 * inset - 4, CH - 2 * inset, col);
      px(inset, inset + 2, CW - 2 * inset, CH - 2 * inset - 4, col);
      px(inset + 1, inset + 1, CW - 2 * inset - 2, CH - 2 * inset - 2, col);
    };
    if (!face) {
      body('ink'); body('violet', 1); body('shadow', 3);
      // diamond rune lattice
      for (let y = 6; y < CH - 6; y++) for (let x = 6; x < CW - 6; x++) {
        const dx = Math.abs(x - CW / 2), dy = Math.abs(y - CH / 2);
        const d = (dx + dy * 0.62) % 14;
        if (d < 1 && dx + dy * 0.62 < 60) { g.fillStyle = css('dusk'); g.fillRect(x, y, 1, 1); }
      }
      px(CW / 2 - 9, CH / 2 - 9, 19, 19, 'ink'); px(CW / 2 - 8, CH / 2 - 8, 17, 17, 'violet'); px(CW / 2 - 6, CH / 2 - 6, 13, 13, 'ink');
      px(CW / 2 - 1, CH / 2 - 4, 3, 9, 'slate'); px(CW / 2 - 4, CH / 2 - 1, 9, 3, 'slate');
      return;
    }
    // frame
    body('ink');
    body(hot ? R.edge : R.edgeDark, 1);
    body('night', 3);
    // bevel highlight on the top-left edge
    px(3, 2, CW - 6, 1, hot ? R.hi : R.edge); px(2, 3, 1, CH - 8, hot ? R.hi : R.edge);
    px(4, CH - 3, CW - 8, 1, 'ink');
    // header strip
    px(4, 4, CW - 8, 12, R.edgeDark);
    px(4, 4, CW - 8, 1, R.edge);
    const rn = R.name;
    drawText(g, rn, CW / 2, 7, R.hi, { align: 'center', shadow: 'ink' });
    const rw = textWidth(rn);
    gem(g, CW / 2 - rw / 2 - 8, 10, R.hi, R.edge); gem(g, CW / 2 + rw / 2 + 8, 10, R.hi, R.edge);
    // icon plate
    const py = 19, ph = 68, pw = CW - 8;
    px(4, py, pw, ph, 'ink');
    px(5, py + 1, pw - 2, ph - 2, R.panel);
    // checker texture (two tones), a little animated shimmer
    for (let y = py + 1; y < py + ph - 1; y++) for (let x = 5; x < 5 + pw - 2; x++) {
      const k = (x + y) & 1;
      const tw = ((x * 13 + y * 7 + Math.floor(t * 3 + c.seed)) % 41) === 0;
      if (k && (x + y) % 4 === 1) { g.fillStyle = css('ink'); g.globalAlpha = 0.28; g.fillRect(x, y, 1, 1); g.globalAlpha = 1; }
      if (tw) { g.fillStyle = css(R.hi); g.fillRect(x, y, 1, 1); }
    }
    const cx = CW / 2, cy = py + 33;
    // aura by rarity
    if (c.rarity === 'epic') {
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * TAU + t * 0.5;
        for (let d = 22; d < 40; d += 2) { g.fillStyle = css(d < 26 ? 'gold' : 'plum'); g.fillRect(Math.round(cx + Math.sin(a) * d), Math.round(cy + Math.cos(a) * d * 0.8), 1, 1); }
      }
    } else if (c.rarity === 'rare') {
      for (let r = 0; r < 8; r++) {
        const a = (r / 8) * TAU - t * 0.8;
        g.fillStyle = css(r % 2 ? 'sky' : 'cyan'); g.fillRect(Math.round(cx + Math.sin(a) * 30), Math.round(cy + Math.cos(a) * 25), 2, 2);
      }
    }
    // pulsing halo (stepped rings of dots)
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + c.seed);
    const hr = 27 + Math.round(pulse * 3) + (hot ? 4 : 0);
    g.fillStyle = css(R.edgeDark);
    for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU; if (k % 2) g.fillRect(Math.round(cx + Math.sin(a) * hr), Math.round(cy + Math.cos(a) * hr * 0.85), 1, 1); }
    // the icon: bobs, and grows a step when hovered
    const sc = hot ? 5 : 4, isz = 12 * sc;
    const bob = Math.round(Math.sin(t * 2.2 + c.seed) * 1.5) - (hot ? 1 : 0);
    if (hot) {
      // sparkles orbiting the hovered icon
      for (let k = 0; k < 4; k++) {
        const a = t * 2.4 + k * (TAU / 4), rr = 36 + Math.sin(t * 5 + k) * 2;
        g.fillStyle = css(k % 2 ? R.hi : 'white'); g.fillRect(Math.round(cx + Math.sin(a) * rr), Math.round(cy + Math.cos(a) * rr * 0.75), 2, 2);
      }
    }
    drawIcon(g, c.id, Math.round(cx - isz / 2), Math.round(cy - isz / 2) + bob, sc);
    // shine sweep on hover: a diagonal band crossing the plate
    if (hot) {
      const u = ((t * 0.9 + c.seed) % 1.6) / 1.6;
      const bx = -20 + u * (pw + 60);
      g.save();
      g.beginPath(); g.rect(5, py + 1, pw - 2, ph - 2); g.clip();
      g.fillStyle = css('white'); g.globalAlpha = 0.34;
      for (let y = 0; y < ph; y++) g.fillRect(Math.round(bx - y * 0.6), py + y, 5, 1);
      g.restore(); g.globalAlpha = 1;
    }
    // synergy ribbon
    if (c.syn) {
      const ry = py + ph - 13, tag = c.syn.name;
      const tw = textWidth(tag) + 22;
      px(Math.round(cx - tw / 2) - 1, ry - 1, tw + 2, 12, 'ink');
      px(Math.round(cx - tw / 2), ry, tw, 10, 'plum');
      px(Math.round(cx - tw / 2), ry, tw, 1, 'gold');
      drawIcon(g, c.syn.other, Math.round(cx - tw / 2) + 1, ry - 1, 1, { outline: false });
      const blink = Math.floor(t * 4) % 2;
      drawText(g, tag, Math.round(cx - tw / 2) + 15, ry + 2, blink ? 'torch' : 'gold', { shadow: 'ink' });
    }
    // level chip
    if (c.level > 1) {
      px(6, py + 3, 22, 9, 'ink'); px(7, py + 4, 20, 7, 'dusk');
      drawText(g, `LV${c.level}`, 9, py + 4, 'gold');
    }
    // name
    const name = c.b.name;
    drawText(g, name, CW / 2, 93, 'white', { align: 'center', outline: 'ink' });
    // divider with gem
    px(10, 105, CW / 2 - 16, 1, R.edgeDark); px(CW / 2 + 6, 105, CW / 2 - 16, 1, R.edgeDark);
    gem(g, CW / 2, 105, R.hi, R.edge);
    // description
    const lines = wrapText(c.b.desc(c.level), CW - 16);
    lines.slice(0, 6).forEach((ln, k) => drawText(g, ln, 8, 111 + k * 9, hot ? 'bone' : 'frost', { shadow: 'ink' }));
    // footer: new / upgrade pips
    px(8, CH - 17, CW - 16, 1, 'dusk');
    if (c.level === 1) {
      drawText(g, 'NEW', 8, CH - 12, 'leaf', { shadow: 'ink' });
    } else {
      drawText(g, `LV${c.level - 1}`, 8, CH - 12, 'fog', { shadow: 'ink' });
      px(28, CH - 9, 5, 1, 'gold'); px(31, CH - 11, 1, 5, 'gold'); px(30, CH - 10, 1, 3, 'gold');
      drawText(g, `LV${c.level}`, 36, CH - 12, 'gold', { shadow: 'ink' });
    }
    for (let k = 0; k < c.b.max; k++) { px(CW - 10 - (c.b.max - 1 - k) * 6, CH - 11, 4, 4, 'ink'); px(CW - 9 - (c.b.max - 1 - k) * 6, CH - 10, 2, 2, k < c.level ? R.edge : 'shadow'); }
    // flip flash: a dithered white wash that thins out
    if (c.flash > 0.04) {
      g.fillStyle = css(c.rarity === 'epic' ? 'torch' : c.rarity === 'rare' ? 'sky' : 'white');
      const dens = c.flash > 0.7 ? 2 : c.flash > 0.35 ? 3 : 4;
      for (let y = 1; y < CH - 1; y++) for (let x = 1 + (y & 1); x < CW - 1; x += dens === 1 ? 1 : 2) if (dens !== 4 || (y & 3) === 0) g.fillRect(x, y, 1, 1);
    }
    // hover / pick brightening
    if (pickAge >= 0 && pickAge < 0.3) {
      g.globalAlpha = 0.6 * (1 - pickAge / 0.3);
      g.fillStyle = css('white'); g.fillRect(0, 0, CW, CH); g.globalAlpha = 1;
      // keep the notched corners clear
      g.clearRect(0, 0, 2, 2); g.clearRect(CW - 2, 0, 2, 2); g.clearRect(0, CH - 2, 2, 2); g.clearRect(CW - 2, CH - 2, 2, 2);
    }
    void i; void hotK;
  }

  function gem(g, x, y, hi, edge) {
    g.fillStyle = css('ink'); g.fillRect(x - 3, y - 1, 7, 3); g.fillRect(x - 1, y - 3, 3, 7);
    g.fillStyle = css(edge); g.fillRect(x - 2, y, 5, 1); g.fillRect(x, y - 2, 1, 5);
    g.fillStyle = css(hi); g.fillRect(x, y, 1, 1);
  }

  return shrine;
}
