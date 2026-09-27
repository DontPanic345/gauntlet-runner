// Floating damage numbers, drawn on the UI canvas at the internal resolution.
//
//   const nums = createDamageNumbers();     // listens to combat:damage and combat:dodge
//   nums.tick();  nums.ui(g);  nums.dispose();
//   nums.spawn({ x, y, z, text, color, scale, crit })      // direct use
//
// Behaviour: a number pops one size up in white for 3 ticks, arcs up and outward, hangs, then
// cools through fog and mist before it goes. Small chip damage (DoT, sparks) merges into one
// running tally per spot instead of a cloud. Crits are gold, large, and shake for a moment.
// Numbers in the same place stack upward. Hero damage is red with a minus sign.
// Positions are stored in the world and projected every frame, so the camera can move.

import { display } from '../core/display.js';
import { events } from '../core/events.js';
import { drawText } from '../core/pixelfont.js';
import { settings } from '../core/settings.js';

const LIFE = 56;
const MAX = 32;

export function createDamageNumbers({ merge = true } = {}) {
  const list = [];
  const offs = [];
  let side = 1;

  function spawn({ x, y, z, text, color = 'bone', scale = 1, crit = false, hero = false, tally = 0, life = LIFE, dx = null }) {
    if (tally) {
      const n = list.find((m) => m.tally && m.t < 26 && Math.hypot(m.x - x, m.z - z) < 0.7 && Math.abs(m.wy - y) < 0.9);
      if (n) { n.tally += tally; n.text = String(n.tally); n.t = Math.min(n.t, 4); n.scale = Math.max(n.scale, tally > 4 ? 2 : 1); return n; }
    }
    // stack: nudge up for every fresh number already sitting here
    let slot = 0;
    for (const m of list) if (m.t < 14 && Math.hypot(m.x - x, m.z - z) < 0.8) slot++;
    side = -side;
    const n = { x, wy: y, z, text: String(text), color, scale, crit, hero, tally, life, t: 0, slot,
      dx: dx ?? (crit || hero ? 0 : side * (4 + (list.length % 3) * 2)) };
    list.push(n);
    if (list.length > MAX) list.shift();
    return n;
  }

  offs.push(events.on('combat:damage', (e) => {
    const amt = Math.round(e.amount);
    if (e.side === 'hero') { spawn({ x: e.x, y: e.y, z: e.z, text: `-${amt}`, color: 'red', scale: 2, hero: true }); return; }
    if (e.crit) { spawn({ x: e.x, y: e.y, z: e.z, text: `${amt}!`, color: 'gold', scale: 3, crit: true }); return; }
    if (merge && amt <= 4) { spawn({ x: e.x, y: e.y, z: e.z, text: String(amt), color: 'flame', scale: 1, tally: amt }); return; }
    spawn({ x: e.x, y: e.y, z: e.z, text: String(amt), color: amt >= 18 ? 'flame' : 'bone', scale: amt >= 18 ? 2 : 1 });
  }));
  offs.push(events.on('combat:dodge', (e) => { spawn({ x: e.x, y: 1.6, z: e.z, text: 'DODGE', color: 'sky', scale: 1, dx: 0 }); }));

  return {
    spawn,
    get count() { return list.length; },
    tick() {
      for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; n.t++; if (n.t >= n.life) list.splice(i, 1); }
    },
    ui(g) {
      const z2 = display.zoom >= 2 ? 1 : 0;
      const shk = settings.get('shake');
      for (const n of list) {
        const p = display.worldToScreen(n.x, n.wy, n.z);
        const t = n.t;
        // rise: fast ease-out for 9 ticks, then a slow drift
        const k = Math.min(1, t / 9), rise = (1 - (1 - k) * (1 - k)) * 15 + Math.max(0, t - 9) * 0.12;
        const cool = n.life - t;
        let scale = Math.min(4, n.scale + z2 + (t < 3 ? 1 : 0));
        if (cool < 12 && scale > 1 && !n.crit) scale = Math.max(1, scale - 1);
        let col = t < 3 ? 'white' : n.color;
        if (cool < 8) col = cool < 4 ? 'mist' : 'fog';
        if (cool < 12 && cool % 4 === 3) continue;                 // the last blinks
        let sx = 0, sy = 0;
        if (n.crit && t < 8 && shk > 0) { sx = (t % 2 ? 1 : -1) * 2; sy = t % 3 === 0 ? 1 : 0; }
        // outward arc for ordinary hits
        const arc = n.dx * Math.min(1, t / 12);
        const y = Math.round(p.y - rise * (z2 ? 1.4 : 1) - n.slot * (8 + scale * 2) - (n.crit ? 6 : 0) + sy);
        drawText(g, n.text, p.x + Math.round(arc) + sx, y, col, { align: 'center', scale, outline: 'ink' });
      }
    },
    clear() { list.length = 0; },
    dispose() { offs.forEach((f) => f()); offs.length = 0; list.length = 0; },
  };
}
