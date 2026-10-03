// Damage numbers (piece `hud`): the real ones, replacing combat's stand-ins (src/combat/fx.js,
// which scenes now create with { numbers: false } wherever this module runs).
//
//   const dn = createDamageNumbers();   dn.tick()  (per sim tick)   dn.ui(g)   dn.dispose()
//
// Driven by events only:
//   combat:damage {x, y, z, amount, crit, side, proc}   enemy hits, crits, procs, hero damage
//   combat:dodge  {x, z}                                 DODGE
//
// How they move (screen pixels, tick-driven so they hold through hitstop):
//   - pop: the first 2 ticks are white and one size bigger, then the real colour
//   - a hop up out of the hit, sideways away from the last number, then a hang and a slow drift
//   - they blink out at the end (never fade; no alpha)
//   - crits: gold, bigger, with a 4-point star behind them and a short jitter
//   - hero damage: red, big, over the hero's head; procs: small and frost (heals: the boons
//     piece's pickups already float their own +1)
//   - numbers that land on the same spot stack: older ones are pushed up so none overlap
// They are anchored to the world point they came from, so they ride the camera with the world.

import { events } from '../core/events.js';
import { display } from '../core/display.js';
import { drawText, textWidth, GLYPH_H } from '../core/pixelfont.js';
import { rect } from './widgets/draw.js';

const MAX = 48;

export function createDamageNumbers({ enabled = true } = {}) {
  const nums = [];
  const offs = [];
  let side = 1;
  let serial = 0;
  const on = (n, f) => offs.push(events.on(n, f));

  function add(n) {
    if (!api.enabled) return;
    side = -side;
    const p = display.worldToScreen(n.x, n.y, n.z);
    const zs = display.zoom >= 2 ? 1 : 0;
    const scale = Math.min(4, n.scale + zs);
    const h = GLYPH_H * scale + 2;
    // push older numbers that sit where this one will pop
    for (const o of nums) {
      if (o.t > 34) continue;
      const q = display.worldToScreen(o.x, o.y, o.z);
      const ox = q.x + o.px, oy = q.y + o.py - o.lift;
      if (Math.abs(ox - p.x) < 16 + textWidth(o.text, o.scale) / 2 && Math.abs(oy - (p.y - 12)) < h + 6) o.liftTo += h;
    }
    nums.push({ ...n, scale, t: 0, px: 0, py: 0, vx: n.vx ?? side * (n.crit ? 0.15 : 0.55), vy: n.vy ?? -(n.crit ? 3.1 : 2.6), lift: 0, liftTo: 0, id: serial++ });
    while (nums.length > MAX) nums.shift();
  }

  on('combat:damage', (e) => {
    if (e.side === 'hero') add({ x: e.x, y: e.y + 0.4, z: e.z, text: `-${e.amount}`, colour: 'red', scale: 2, kind: 'hero', vx: 0, vy: -2.2 });
    else if (e.proc) add({ x: e.x, y: e.y, z: e.z, text: String(e.amount), colour: e.crit ? 'gold' : 'frost', scale: e.crit ? 2 : 1, kind: 'proc', crit: e.crit });
    else add({ x: e.x, y: e.y, z: e.z, text: String(e.amount), colour: e.crit ? 'gold' : 'bone', scale: e.crit ? 2 : 1, kind: 'hit', crit: e.crit });
  });
  on('combat:dodge', (e) => add({ x: e.x, y: 1.7, z: e.z, text: 'DODGE', colour: 'sky', scale: 1, kind: 'word', vx: 0, vy: -1.6 }));

  const api = {
    enabled,
    get count() { return nums.length; },
    get texts() { return nums.map((n) => n.text); },
    tick() {
      for (const n of nums) {
        n.t++;
        n.px += n.vx; n.py += n.vy;
        n.vx *= 0.88;
        if (n.vy < 0) n.vy += n.kind === 'hero' ? 0.2 : 0.24; else n.vy = 0.06;   // hop, then hang and drift down a hair
        if (n.lift < n.liftTo) n.lift = Math.min(n.liftTo, n.lift + 2);
      }
      for (let i = nums.length - 1; i >= 0; i--) if (nums[i].t > life(nums[i])) nums.splice(i, 1);
    },
    ui(g) {
      for (const n of nums) {
        const t = n.t, L = life(n);
        if (t > L - 12 && (t >> 1) & 1) continue;
        const p = display.worldToScreen(n.x, n.y, n.z);
        const jitter = n.crit && t < 8 ? ((t & 1) ? 1 : -1) : 0;
        const x = Math.round(p.x + n.px + jitter), y = Math.round(p.y + n.py - n.lift - (n.crit ? 4 : 0));
        const sc = t < 2 && n.kind !== 'word' ? Math.min(5, n.scale + 1) : n.scale;
        if (n.crit && t < 9) star(g, x, y + Math.round(GLYPH_H * sc / 2), 5 + t, t < 3 ? 'white' : t < 6 ? 'gold' : 'flame');
        const colour = t < 2 ? 'white' : n.colour;
        drawText(g, n.text, x, y, colour, { align: 'center', scale: sc, outline: 'ink' });
      }
    },
    clear() { nums.length = 0; },
    dispose() { offs.forEach((f) => f()); offs.length = 0; nums.length = 0; },
  };
  return api;
}

function life(n) { return n.kind === 'hero' ? 60 : n.kind === 'heal' ? 56 : n.crit ? 54 : n.kind === 'proc' ? 34 : 44; }

function star(g, cx, cy, r, c) {
  for (let i = 1; i <= r; i++) {
    const w = i < r * 0.4 ? 2 : 1;
    rect(g, c, cx + i, cy, 1, w); rect(g, c, cx - i, cy, 1, w);
    rect(g, c, cx, cy + i, w, 1); rect(g, c, cx, cy - i, w, 1);
  }
  const d = Math.round(r * 0.45);
  for (let i = 1; i <= d; i++) { rect(g, c, cx + i, cy + i, 1, 1); rect(g, c, cx - i, cy + i, 1, 1); rect(g, c, cx + i, cy - i, 1, 1); rect(g, c, cx - i, cy - i, 1, 1); }
}
