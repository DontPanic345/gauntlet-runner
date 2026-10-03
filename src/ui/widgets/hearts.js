// Hearts (piece `hud`): the hero's health, one pixel heart per hp, top left.
//
// Every change animates (all tick-driven, so it holds through hitstop and steps with debug.step):
//   lose   the heart flashes white and hops, the red drains out of it top-down with a bright
//          surface line, then it cracks: shards burst and fall, the container is left cracked.
//          The whole row shakes. Losing several hearts at once staggers them by 5 ticks.
//   gain   the heart refills bottom-up in gold that cools to red, pops a pixel bigger and
//          throws a 4-point sparkle.
//   low    at 1 hp (or a quarter of max) the last heart beats lub-dub (a bigger sprite for a
//          few ticks per beat); `beat` exposes the pulse for the vignette and the sound.
//
//   const h = createHearts();   h.tick(health)   h.draw(g, x, y)   h.width   h.beat (0..1)

import { outlined, tinted, rect, createBits, prng } from './draw.js';

// 9x8 interior: o rose highlight, w white glint, r red, b blood shade
const HEART = [
  '.oor.rrr.',
  'owwrrrrrr',
  'owrrrrrrb',
  'rrrrrrrrb',
  '.rrrrrrb.',
  '..rrrrb..',
  '...rrb...',
  '....b....',
];
// 11x10 interior: the beat (one pixel bigger all round)
const HEART_BIG = [
  '.orrr.rrrr.',
  'owwrrrrrrrr',
  'owwrrrrrrrb',
  'orrrrrrrrrb',
  'rrrrrrrrrrb',
  '.rrrrrrrrb.',
  '..rrrrrrb..',
  '...rrrrb...',
  '....rrb....',
  '.....b.....',
];
const FULL = { o: 'rose', w: 'white', r: 'red', b: 'blood' };
const EMPTY = { o: 'dusk', w: 'dusk', r: 'shadow', b: 'night' };
const GOLD = { o: 'torch', w: 'white', r: 'gold', b: 'flame' };
// the crack left in a lost heart (interior coordinates)
const CRACK = [[4, 0], [4, 1], [3, 2], [4, 3], [5, 4], [4, 5], [4, 6]];

export const HEART_W = 11, HEART_H = 10, HEART_GAP = 2;
const BEAT = 52;   // ticks per heartbeat at low health (~69 bpm)

export function createHearts() {
  const bits = createBits();
  const rnd = prng(911);
  const slots = [];    // per heart: { state: 'full'|'empty', anim: null | {kind, t, delay} }
  let lastHp = null, lastMax = null;
  let shakeT = 99, beatT = 0, low = false, lowT = 0, clock = 0;
  const api = { width: 0, beat: 0, low: false, lub: false };

  function ensure(max) {
    while (slots.length < max) slots.push({ full: true, anim: null, cracked: false });
    slots.length = max;
  }

  /** Pick up hp changes now (also called from the draw pass, so a hit shows inside hitstop). */
  api.sync = (health) => {
    if (!health) return;
    const hp = Math.max(0, health.hp), max = Math.max(1, health.maxHp);
    if (lastHp === null) { ensure(max); slots.forEach((s, i) => { s.full = i < hp; s.cracked = !s.full; }); lastHp = hp; lastMax = max; }
    if (max !== lastMax) {
      const old = lastMax;
      ensure(max);
      for (let i = old; i < max; i++) { slots[i].full = false; slots[i].cracked = false; slots[i].anim = { kind: 'new', t: 0, delay: (i - old) * 4 }; }
      lastMax = max;
    }
    if (hp < lastHp) {
      // lose from the top heart down
      let d = 0;
      for (let i = lastHp - 1; i >= hp; i--) { if (!slots[i]) continue; slots[i].anim = { kind: 'lose', t: 0, delay: d }; d += 5; }
      shakeT = 0;
      api.hurtT = 0;
    } else if (hp > lastHp) {
      let d = 0;
      for (let i = lastHp; i < hp; i++) { if (!slots[i]) continue; slots[i].anim = { kind: 'gain', t: 0, delay: d }; slots[i].full = true; d += 6; }
      api.healT = 0;
    }
    lastHp = hp;
  };

  api.hurtT = 99; api.healT = 99;
  api.tick = (health) => {
    if (!health) return;
    api.sync(health);
    const hp = Math.max(0, health.hp), max = Math.max(1, health.maxHp);
    api.hurtT++; api.healT++;
    for (const [i, s] of slots.entries()) {
      const a = s.anim;
      if (!a) continue;
      if (a.delay > 0) { a.delay--; continue; }
      a.t++;
      if (a.kind === 'lose' && a.t === 15) {
        s.full = false; s.cracked = true;
        burst(i);
      }
      if (a.kind === 'gain' && a.t === 2) s.cracked = false;
      if ((a.kind === 'lose' && a.t > 26) || (a.kind === 'gain' && a.t > 24) || (a.kind === 'new' && a.t > 20)) s.anim = null;
    }
    shakeT++; clock++;
    bits.tick();
    // low health: a lub-dub on the last standing heart
    const wasLow = low;
    low = hp > 0 && max > 1 && (hp <= 1 || hp <= max * 0.25);
    if (low && !wasLow) { beatT = BEAT - 1; lowT = 0; }   // the first lub lands on the next tick
    if (low) { beatT = (beatT + 1) % BEAT; lowT++; }
    api.low = low;
    api.lub = low && (beatT === 0 || beatT === 9);
    const since = beatT < 9 ? beatT : beatT - 9;
    const amp = beatT < 9 ? 1 : 0.6;
    api.beat = low ? amp * Math.max(0, 1 - since / 7) : 0;
    api.beatT = beatT;
    api.lowT = lowT;
    api.width = max * (HEART_W + HEART_GAP) - HEART_GAP;
  };

  function burst(i) {
    const cx = i * (HEART_W + HEART_GAP) + HEART_W / 2, cy = HEART_H / 2;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
      const sp = 0.6 + rnd() * 1.1;
      bits.add({ x: cx + (rnd() - 0.5) * 5, y: cy + (rnd() - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, g: 0.11,
        max: 26 + ((rnd() * 10) | 0), w: k < 3 ? 2 : 1, cs: k % 3 === 0 ? ['white', 'rose', 'red'] : ['rose', 'red', 'blood'] });
    }
  }

  api.draw = (g, x0, y0) => {
    const shake = shakeT < 12 ? ((shakeT & 2) ? 1 : -1) * (shakeT < 6 ? 2 : 1) : 0;
    const full = outlined(HEART, FULL), empty = outlined(HEART, EMPTY), white = tinted(HEART, 'white');
    for (const [i, s] of slots.entries()) {
      const x = x0 + i * (HEART_W + HEART_GAP) + shake, y = y0;
      const a = s.anim && s.anim.delay <= 0 ? s.anim : null;
      const isLast = low && i === lastHp - 1;
      if (a?.kind === 'lose') {
        const t = a.t;
        if (t < 3) { g.drawImage(white, x, y - 1); continue; }
        if (t < 15) {
          // drain: the red falls out of the heart from the top
          const lvl = Math.round(((t - 3) / 12) * (HEART_H - 2));     // rows emptied (interior)
          g.drawImage(empty, x, y);
          clipRows(g, full, x, y, 1 + lvl, HEART_H);
          if (lvl < HEART_H - 2) rowLine(g, HEART, x, y, lvl, (t >> 1) & 1 ? 'torch' : 'white');
          continue;
        }
        g.drawImage(empty, x, y + (t < 18 ? 1 : 0));
        drawCrack(g, x, y + (t < 18 ? 1 : 0), t < 20 ? 'white' : 'ink');
        continue;
      }
      if (a?.kind === 'gain') {
        const t = a.t;
        const gold = outlined(HEART, GOLD);
        const lvl = Math.round(Math.min(1, t / 10) * (HEART_H - 2));
        const pop = t >= 10 && t < 15 ? 1 : 0;
        if (pop) { g.drawImage(t < 12 ? tinted(HEART_BIG, 'white') : outlined(HEART_BIG, GOLD), x - 1, y - 1); }
        else {
          g.drawImage(empty, x, y);
          clipRows(g, t < 10 ? gold : t < 18 ? gold : full, x, y, HEART_H - 1 - lvl, HEART_H);
          if (lvl < HEART_H - 2) rowLine(g, HEART, x, y, HEART_H - 3 - lvl, 'white');
        }
        if (t >= 10 && t < 22) sparkle(g, x + HEART_W / 2, y + HEART_H / 2, t - 10);
        continue;
      }
      if (a?.kind === 'new') {
        const t = a.t;
        if ((t >> 1) & 1 && t < 12) continue;
        g.drawImage(empty, x, y + (t < 6 ? -2 : 0));
        continue;
      }
      if (s.full) {
        if (isLast && api.beat > 0.45) g.drawImage(outlined(HEART_BIG, FULL), x - 1, y - 1);
        else g.drawImage(full, x, y);
        // a slow glint walks across full hearts now and then
        const gl = (clock + i * 7) % 240;
        if (!low && gl < 3) rect(g, 'white', x + 3 + gl, y + 2, 1, 1);
      } else {
        g.drawImage(empty, x, y);
        if (s.cracked) drawCrack(g, x, y, 'ink');
      }
    }
    // shards fall from the row (drawn in row space)
    g.save();
    g.translate(x0, y0);
    bits.draw(g);
    g.restore();
  };

  return api;
}

/** Draw `src` but only rows [r0, r1) of it (sprite rows, outline included). */
function clipRows(g, src, x, y, r0, r1) {
  if (r1 <= r0) return;
  g.drawImage(src, 0, r0, src.width, r1 - r0, x, y + r0, src.width, r1 - r0);
}

/** A bright line across the interior at interior row `row` (the liquid's surface). */
function rowLine(g, mask, x, y, row, colour) {
  const r = mask[Math.max(0, Math.min(mask.length - 1, row))];
  if (!r) return;
  for (let i = 0; i < r.length; i++) if (r[i] !== '.') rect(g, colour, x + 1 + i, y + 1 + row, 1, 1);
}

function drawCrack(g, x, y, colour) {
  for (const [cx, cy] of CRACK) rect(g, colour, x + 1 + cx, y + 1 + cy, 1, 1);
}

function sparkle(g, cx, cy, t) {
  const r = 3 + t;
  const c = t < 4 ? 'white' : t < 8 ? 'gold' : 'flame';
  if (t > 8 && t & 1) return;
  cx = Math.round(cx); cy = Math.round(cy);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    rect(g, c, cx + dx * r, cy + dy * r, 1, 1);
    if (t < 6) rect(g, c, cx + dx * (r - 1), cy + dy * (r - 1), 1, 1);
  }
}
