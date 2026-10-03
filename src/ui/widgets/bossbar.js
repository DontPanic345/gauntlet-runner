// Boss health bar (piece `hud`): bottom centre, for any boss that can describe itself.
//
//   const bar = createBossBar();   bar.tick(src)   bar.draw(g, W, H)
//   src (or null): { name, hp, maxHp, phase, phaseName, phaseColor, notches: [2/3, 1/3],
//                    poise: 0..1, stagger: 0..1 | null (time left), locked: 0..1 | null, show: 0..1 }
//
// Every change animates:
//   hit        the lost slice flashes white, then holds as a torch-coloured chunk for ~0.4 s and
//              drains away; a big hit shakes the frame a pixel
//   notch      crossing a phase notch snaps its gold pin off in sparks, and the name plate flashes
//   poise      a thin bar under it fills flame -> gold; on a break it pulses gold with STAGGERED,
//              then shows grey while locked
//   show       it slides up from the bottom edge (the boss decides when, e.g. after an intro)
// The fill itself is never still: a slow dithered sheen runs along it.

import { drawText, textWidth } from '../../core/pixelfont.js';
import { rect, cutRect, createBits, prng, easeOut } from './draw.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export function createBossBar() {
  const bits = createBits();
  const rnd = prng(73);
  let t = 0, trail = null, hold = 0, last = null, flashT = 99, flashFrom = 0, shakeT = 99, plateT = 99, lastPhase = 0, src = null;
  const broken = new Set();
  let geom = null;

  const api = {
    /** Pick up hp/phase changes now (also from the draw pass, so a hit flashes inside hitstop). */
    sync(s) {
      src = s;
      if (!s) { trail = null; last = null; broken.clear(); return; }
      if (last === null) { last = s.hp; trail = s.hp; lastPhase = s.phase; for (const n of s.notches ?? []) if (s.hp <= s.maxHp * n) broken.add(n); }
      if (s.hp < last) {
        if (flashT >= 4) flashFrom = last;   // hits inside the flash extend the same slice
        flashT = 0;
        hold = 24;
        if (last - s.hp >= s.maxHp * 0.025) shakeT = 0;
        for (const n of s.notches ?? []) if (!broken.has(n) && s.hp <= s.maxHp * n) { broken.add(n); snap(n); }
      } else if (s.hp > last) { trail = s.hp; for (const n of s.notches ?? []) if (s.hp > s.maxHp * n) broken.delete(n); }
      if (s.phase !== lastPhase) { plateT = 0; lastPhase = s.phase; }
      last = s.hp;
    },
    tick(s) {
      t++;
      bits.tick();
      api.sync(s);
      if (!s) return;
      flashT++; shakeT++; plateT++;
      if (hold > 0) hold--;
      else if (trail > s.hp) trail = Math.max(s.hp, trail - Math.max(s.maxHp * 0.004, (trail - s.hp) * 0.09));
    },
  };

  function snap(n) {
    if (!geom) return;
    const x = geom.x0 + Math.round(geom.bw * n), y = geom.y0;
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
      bits.add({ x, y, vx: Math.cos(a) * (0.6 + rnd()), vy: Math.sin(a) * (0.8 + rnd()), g: 0.1, max: 22 + ((rnd() * 10) | 0), w: k < 2 ? 2 : 1, cs: ['white', 'gold', 'flame'] });
    }
  }

  api.draw = (g, W, H) => {
    const s = src;
    if (!s || !(s.show > 0)) return;
    const bw = Math.min(300, W - 150), x0 = Math.round((W - bw) / 2);
    const slide = Math.round((1 - easeOut(s.show)) * 44);
    const sh = shakeT < 8 ? ((shakeT & 2) ? 1 : -1) : 0;
    const y0 = H - 22 + slide;
    geom = { x0, y0, bw };
    const fw = (v) => Math.max(0, Math.min(bw, Math.round(bw * Math.max(0, v) / s.maxHp)));
    const X = x0 + sh;
    // ---- name plate and phase
    const plate = plateT < 24 && (plateT >> 1) & 1;
    const nw = textWidth(s.name) + 12;
    cutRect(g, 'ink', X - 3, y0 - 13, nw, 12, 2);
    cutRect(g, 'shadow', X - 2, y0 - 12, nw - 2, 11, 1);
    rect(g, 'violet', X, y0 - 12, nw - 6, 1);
    drawText(g, s.name, X + 3, y0 - 10, plate ? 'white' : 'bone');
    const ph = `${ROMAN[s.phase] ?? s.phase}  ${s.phaseName ?? ''}`.trim();
    const pw = textWidth(ph) + 12;
    cutRect(g, 'ink', X + bw + 3 - pw, y0 - 13, pw, 12, 2);
    cutRect(g, 'shadow', X + bw + 4 - pw, y0 - 12, pw - 2, 11, 1);
    drawText(g, ph, X + bw - 3, y0 - 10, plate ? 'white' : s.phaseColor ?? 'gold', { align: 'right' });
    // ---- frame: ink, an iron band with a lit top, end caps
    cutRect(g, 'ink', X - 4, y0 - 3, bw + 8, 13, 2);
    rect(g, 'stone', X - 3, y0 - 2, bw + 6, 11);
    rect(g, 'stoneLight', X - 2, y0 - 2, bw + 4, 1);
    rect(g, 'stoneDark', X - 2, y0 + 8, bw + 4, 1);
    rect(g, 'ink', X - 1, y0 - 1, bw + 2, 9);
    // the well
    rect(g, 'night', X, y0, bw, 7);
    for (let x = 0; x < bw; x += 2) rect(g, 'shadow', X + x + ((t >> 5) & 1), y0 + 6, 1, 1);
    // the trail chunk, then the hp
    const hpW = fw(s.hp), trW = fw(trail ?? s.hp);
    if (trW > hpW) {
      const flashW = flashT < 4 ? fw(flashFrom) : 0;
      rect(g, hold > 0 ? 'torch' : 'flame', X + hpW, y0, trW - hpW, 7);
      if (flashW > hpW) rect(g, 'white', X + hpW, y0, flashW - hpW, 7);
    }
    rect(g, 'red', X, y0, hpW, 7);
    rect(g, 'rose', X, y0, hpW, 1);
    rect(g, 'blood', X, y0 + 5, hpW, 2);
    // a slow sheen: a dithered band of rose that runs along the fill
    const sheen = (t * 2) % (bw + 60) - 30;
    for (let x = Math.max(0, sheen); x < Math.min(hpW, sheen + 12); x++) for (let y = 1; y < 5; y++) if (((x + y) & 1) === 0) rect(g, 'rose', X + x, y0 + y, 1, 1);
    if (hpW > 0) rect(g, 'white', X + hpW - 1, y0, 1, flashT < 6 ? 7 : 1);
    // phase notches: gold pins; a crossed one is gone, a dark nick left in the frame
    for (const n of s.notches ?? []) {
      const nx = X + Math.round(bw * n);
      rect(g, 'ink', nx, y0 - 1, 1, 9);
      if (!broken.has(n)) { rect(g, 'ink', nx - 1, y0 - 5, 3, 4); rect(g, 'gold', nx, y0 - 4, 1, 3); rect(g, 'ink', nx - 1, y0 + 8, 3, 3); rect(g, 'gold', nx, y0 + 8, 1, 2); }
      else rect(g, 'stoneDark', nx, y0 - 2, 1, 1);
    }
    // end caps: iron studs
    for (const cx of [X - 6, X + bw + 3]) { cutRect(g, 'ink', cx, y0 - 1, 4, 9, 1); rect(g, 'stoneLight', cx + 1, y0, 2, 7); rect(g, 'fog', cx + 1, y0, 1, 1); rect(g, 'stoneDark', cx + 1, y0 + 6, 2, 1); }
    // ---- poise
    const py = y0 + 11;
    rect(g, 'ink', X - 1, py - 1, bw + 2, 4);
    rect(g, 'night', X, py, bw, 2);
    if (s.stagger != null) {
      rect(g, (t >> 2) & 1 ? 'gold' : 'torch', X, py, Math.round(bw * s.stagger), 2);
      drawText(g, 'STAGGERED', W / 2, y0 - 24, (t >> 3) & 1 ? 'gold' : 'torch', { align: 'center', outline: 'ink' });
    } else if (s.locked != null) {
      rect(g, 'slate', X, py, Math.round(bw * (1 - s.locked)), 2);
    } else {
      const pv = Math.max(0, Math.min(1, s.poise ?? 0));
      rect(g, pv > 0.75 ? 'gold' : 'flame', X, py, Math.round(bw * pv), 2);
      if (pv > 0.75 && (t >> 2) & 1) rect(g, 'white', X + Math.round(bw * pv) - 1, py, 1, 2);
    }
    g.save(); bits.draw(g); g.restore();
  };

  return api;
}
